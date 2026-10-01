"""Video Trimmer web UI: a small FastAPI server around trim.py.

Run with ./run.sh (this Mac only) or ./run.sh --lan (phones on the same Wi-Fi), then open http://127.0.0.1:7870
"""
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import trim as trimmer

HERE = Path(__file__).resolve().parent
CLIPS_DIR = Path(os.environ.get("VT_CLIPS", trimmer.DEFAULT_OUT)).expanduser().resolve()
MEDIA_TYPES = {".mp4": "video/mp4", ".m4a": "audio/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
               ".mp3": "audio/mpeg", ".opus": "audio/ogg"}

app = FastAPI(title="Video Trimmer", docs_url=None, redoc_url=None)
executor = ThreadPoolExecutor(max_workers=2)
jobs = {}
jobs_lock = threading.Lock()


class ProbeRequest(BaseModel):
    url: str


class TrimRequest(BaseModel):
    url: str
    full: bool = False  # whole video; start/end are ignored
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, gt=0)
    audio: bool = False
    precise: bool = False
    max_height: int | None = None


def check_url(url):
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "Paste a full link starting with https://")
    return url


def clip_path(name):
    """Resolve a clip name to a path inside CLIPS_DIR, refusing anything outside it."""
    path = (CLIPS_DIR / name).resolve()
    if path.parent != CLIPS_DIR or not path.is_file():
        raise HTTPException(404, "Clip not found")
    return path


def update_job(job_id, **fields):
    with jobs_lock:
        jobs[job_id].update(fields)


def run_job(job_id, req):
    def on_status(stage, d):
        if stage == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            done = d.get("downloaded_bytes") or 0
            update_job(job_id, stage="Downloading section",
                       percent=round(100 * done / total) if total else None)
        else:
            update_job(job_id, stage="Processing", percent=None)

    try:
        path = trimmer.trim(req.url, req.start, req.end, CLIPS_DIR, req.audio, req.precise, req.max_height,
                            quiet=True, on_status=on_status)
        update_job(job_id, status="done", stage="Done", percent=100, file=path.name)
    except trimmer.TrimError as e:
        update_job(job_id, status="error", stage="Failed", error=str(e))
    except Exception as e:  # keep the job record useful even for unexpected failures
        update_job(job_id, status="error", stage="Failed", error=f"{type(e).__name__}: {e}")


@app.post("/api/probe")
def probe(req: ProbeRequest):
    try:
        return trimmer.probe(check_url(req.url))
    except trimmer.TrimError as e:
        raise HTTPException(422, str(e))


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)


SEARCH_TTL = 600  # seconds; type-to-search repeats queries often, and each one is a real request to YouTube
search_cache = {}


@app.post("/api/search")
def search(req: SearchRequest):
    key = " ".join(req.query.lower().split())
    hit = search_cache.get(key)
    if hit and time.time() - hit[0] < SEARCH_TTL:
        return hit[1]
    try:
        results = trimmer.search(req.query)
    except trimmer.TrimError as e:
        raise HTTPException(422, str(e))
    if len(search_cache) > 200:
        search_cache.clear()
    search_cache[key] = (time.time(), results)
    return results


@app.post("/api/trim")
def start_trim(req: TrimRequest):
    req.url = check_url(req.url)
    if req.full:
        req.start = req.end = None
    elif req.start is None or req.end is None or req.end <= req.start:
        raise HTTPException(400, "The end time must be after the start time.")
    job_id = uuid.uuid4().hex[:12]
    with jobs_lock:
        # forget finished jobs after an hour so the record doesn't grow forever
        for old_id in [j for j, v in jobs.items() if v["status"] != "running" and time.time() - v["started"] > 3600]:
            del jobs[old_id]
        jobs[job_id] = {"id": job_id, "status": "running", "stage": "Starting", "percent": None,
                        "started": time.time(), "file": None, "error": None}
    executor.submit(run_job, job_id, req)
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Unknown job")
        return {**job, "elapsed": round(time.time() - job["started"], 1)}


@app.get("/api/clips")
def list_clips():
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    files = [p for p in CLIPS_DIR.iterdir() if p.is_file() and p.suffix.lower() in MEDIA_TYPES]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return [{"name": p.name, "size": p.stat().st_size, "modified": p.stat().st_mtime,
             "kind": "audio" if MEDIA_TYPES[p.suffix.lower()].startswith("audio") else "video"} for p in files]


@app.get("/clips/{name}")
def get_clip(name: str, download: bool = False):
    path = clip_path(name)
    return FileResponse(path, media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
                        filename=path.name if download else None,
                        content_disposition_type="attachment" if download else "inline")


@app.delete("/api/clips/{name}")
def delete_clip(name: str):
    clip_path(name).unlink()
    return {"deleted": name}


app.mount("/", StaticFiles(directory=HERE / "static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("VT_HOST", "127.0.0.1")
    port = int(os.environ.get("VT_PORT", "7870"))
    uvicorn.run(app, host=host, port=port, log_level="warning")
