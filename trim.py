"""Download just a section of a YouTube (or other yt-dlp supported) video.

Only the requested range is downloaded, not the whole video. Uses yt-dlp (the maintained fork of youtube-dl)
and ffmpeg.

Usage:
    python trim.py URL --start 1:30 --end 2:45
    python trim.py URL --start 90 --end 165 --out ~/Desktop/clips
    python trim.py URL --start 0:10 --end 0:40 --audio          # audio only (m4a)
    python trim.py URL --start 0:10 --end 0:40 --precise        # frame-accurate cut (re-encodes, slower)
    python trim.py URL --start 5 --end 20 --max-height 720      # cap resolution
    python trim.py URL --full                                   # whole video
    python trim.py URL --full --audio                           # whole audio track (m4a)

Times accept seconds (90, 12.5), MM:SS (1:30) or HH:MM:SS (1:02:03.5).
"""
import argparse
import shutil
import sys
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError, download_range_func

DEFAULT_OUT = Path(__file__).resolve().parent / "clips"


def parse_time(value):
    """'90' / '1:30' / '01:02:03.5' -> seconds (float)."""
    try:
        parts = [float(p) for p in str(value).strip().split(":")]
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a time: {value!r} (use seconds, MM:SS or HH:MM:SS)")
    if not 1 <= len(parts) <= 3 or any(p < 0 for p in parts):
        raise argparse.ArgumentTypeError(f"not a time: {value!r} (use seconds, MM:SS or HH:MM:SS)")
    seconds = 0.0
    for p in parts:
        seconds = seconds * 60 + p
    return seconds


def stamp(seconds):
    """Seconds -> compact label for file names, e.g. 90.5 -> '1m30.5s'."""
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    s_text = f"{s:g}"
    return (f"{int(h)}h" if h else "") + (f"{int(m)}m" if h or m else "") + f"{s_text}s"


class TrimError(Exception):
    pass


def build_options(start, end, out, audio=False, precise=False, max_height=None, quiet=False):
    """yt-dlp options. start/end of None means the whole video."""
    full = start is None
    # The name records every option that changes the result, so different downloads never overwrite each other
    tags = (["full"] if full else [f"{stamp(start)}-{stamp(end)}"] + (["precise"] if precise else [])) + \
           ([f"{max_height}p"] if max_height and not audio else [])
    opts = {
        "outtmpl": str(Path(out) / f"%(title).80B [{' '.join(tags)}].%(ext)s"),
        "updatetime": False,  # file date = when you downloaded it, not the video's upload date
        "noplaylist": True,
        "quiet": quiet,
        "no_warnings": quiet,
        "noprogress": quiet,
        "windowsfilenames": True,  # keep names safe everywhere
    }
    if not full:
        opts["download_ranges"] = download_range_func(None, [(start, end)])
        opts["force_keyframes_at_cuts"] = precise
    if audio:
        opts["format"] = "bestaudio[ext=m4a]/bestaudio/best"
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}]
    else:
        cap = f"[height<={max_height}]" if max_height else ""
        # Prefer H.264 + AAC so the clip plays everywhere (QuickTime, any iPhone, editors) without re-encoding;
        # fall back to other MP4 codecs (AV1/VP9 need newer devices), then to whatever is best.
        opts["format"] = (f"bv*{cap}[vcodec^=avc1]+ba[ext=m4a]/bv*{cap}[ext=mp4]+ba[ext=m4a]/"
                          f"b{cap}[ext=mp4]/bv*{cap}+ba/b{cap}")
        opts["merge_output_format"] = "mp4"
    return opts


def probe(url):
    """Title, channel, duration, thumbnail and YouTube id of a video, without downloading it."""
    try:
        with YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as e:
        raise TrimError(str(e).removeprefix("ERROR: "))
    return {
        "title": info.get("title") or "Untitled",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration": info.get("duration") or 0,
        "thumbnail": info.get("thumbnail") or "",
        "youtube_id": info.get("id") if (info.get("extractor_key") or "").lower().startswith("youtube") else None,
        "webpage_url": info.get("webpage_url") or url,
        "is_live": bool(info.get("is_live")),
    }


def search(query, limit=12):
    """Top YouTube results for `query`: [{id, title, channel, duration, thumbnail, url}], fast (no per-video lookups)."""
    query = " ".join(query.split())
    if not query:
        return []
    opts = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "skip_download": True}
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    except DownloadError as e:
        raise TrimError(str(e).removeprefix("ERROR: "))
    results = []
    for e in info.get("entries") or []:
        video_id = e.get("id")
        if not video_id or e.get("live_status") in ("is_live", "is_upcoming"):
            continue
        results.append({
            "id": video_id,
            "title": e.get("title") or "Untitled",
            "channel": e.get("channel") or e.get("uploader") or "",
            "duration": e.get("duration") or 0,
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
            "url": f"https://www.youtube.com/watch?v={video_id}",
        })
    return results


def trim(url, start=None, end=None, out=DEFAULT_OUT, audio=False, precise=False, max_height=None, quiet=False,
         on_status=None):
    """Download [start, end] of `url` into `out` (the whole video if both are None); returns the saved file's Path.
    Raises TrimError.

    The video's details are fetched first so the range is checked (and the end clamped to the video's length)
    before anything is downloaded.
    """
    full = start is None and end is None
    if not full and (start is None or end is None):
        raise TrimError("Give both a start and an end time, or neither for the whole video.")
    if not full and end <= start:
        raise TrimError("The end time must be after the start time.")
    if not shutil.which("ffmpeg"):
        raise TrimError("ffmpeg is required (install with: brew install ffmpeg).")
    out = Path(out).expanduser()
    out.mkdir(parents=True, exist_ok=True)

    try:
        # process=False: read the details without picking formats, so the real download below chooses them
        with YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
            info = ydl.extract_info(url, download=False, process=False)
    except DownloadError as e:
        raise TrimError(str(e).removeprefix("ERROR: "))
    if info.get("is_live"):
        raise TrimError("Live streams can't be downloaded. Try again once the stream has ended.")
    duration = info.get("duration")
    if duration and not full:
        if start >= duration:
            raise TrimError(f"The start time is past the end of the video ({stamp(duration)} long).")
        end = min(end, duration)
        if start <= 0.5 and end >= duration - 0.5:
            # the "section" is the whole video: download it normally (faster, real progress, named [full])
            full, start, end = True, None, None

    saved = []

    def downloading(d):
        if on_status and d.get("status") == "downloading":
            on_status("downloading", d)

    def processed(d):
        if d.get("status") == "started" and on_status:
            on_status("processing", d)
        if d.get("status") == "finished":
            saved.append(d["info_dict"].get("filepath"))

    opts = build_options(start, end, out, audio, precise, max_height, quiet)
    opts["progress_hooks"] = [downloading]
    opts["postprocessor_hooks"] = [processed]
    partials_before = set(out.glob("*.part*")) | set(out.glob("*.temp.*"))
    try:
        with YoutubeDL(opts) as ydl:
            result = ydl.process_ie_result(info, download=True)
    except DownloadError as e:
        # don't leave half-written files behind in the clips folder
        for leftover in (set(out.glob("*.part*")) | set(out.glob("*.temp.*"))) - partials_before:
            leftover.unlink(missing_ok=True)
        raise TrimError(str(e).removeprefix("ERROR: "))
    candidates = [d.get("filepath") for d in (result or {}).get("requested_downloads") or []] + saved[::-1]
    for p in candidates:
        if p and Path(p).exists():
            return Path(p)
    raise TrimError("The download finished but no file was produced.")


def main():
    parser = argparse.ArgumentParser(description="Download only a section of a video with yt-dlp.")
    parser.add_argument("url", help="Video URL (YouTube or any site yt-dlp supports)")
    parser.add_argument("--start", "-s", type=parse_time, help="Start time (e.g. 1:30)")
    parser.add_argument("--end", "-e", type=parse_time, help="End time (e.g. 2:45)")
    parser.add_argument("--full", "-f", action="store_true", help="Download the whole video instead of a section")
    parser.add_argument("--out", "-o", type=Path, default=DEFAULT_OUT, help=f"Output folder (default: {DEFAULT_OUT})")
    parser.add_argument("--audio", "-a", action="store_true", help="Save audio only (.m4a)")
    parser.add_argument("--precise", "-p", action="store_true",
                        help="Frame-accurate cut: re-encode at the cut points (slower). "
                             "Without it, cuts snap to the nearest keyframe (usually within a second or two).")
    parser.add_argument("--max-height", type=int, help="Limit video resolution, e.g. 720 or 1080")
    args = parser.parse_args()

    if args.full:
        if args.start is not None or args.end is not None:
            parser.error("use either --full or --start/--end, not both")
        print(f"Downloading the whole {'audio' if args.audio else 'video'} -> {args.out.expanduser()}")
    else:
        if args.start is None or args.end is None:
            parser.error("give --start and --end, or --full for the whole video")
        print(f"Downloading {stamp(args.start)} to {stamp(args.end)} "
              f"({args.end - args.start:g}s){' as audio' if args.audio else ''} -> {args.out.expanduser()}")
    try:
        path = trim(args.url, args.start, args.end, args.out, args.audio, args.precise, args.max_height)
    except TrimError as e:
        sys.exit(f"Download failed: {e}")
    print(f"Saved: {path}")


if __name__ == "__main__":
    main()
