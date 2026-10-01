# Video Trimmer

Downloads **only a section** of a YouTube video (or any site yt-dlp supports), not the whole file.
Built on [yt-dlp](https://github.com/yt-dlp/yt-dlp), the maintained fork of youtube-dl, plus ffmpeg.

Only download videos you have the right to use.

## Setup (once)

Needs Python 3.10+ and ffmpeg (`brew install ffmpeg`).

```bash
./setup.sh          # creates .venv with yt-dlp and the web UI
```

## Web UI

```bash
./run.sh            # then open http://127.0.0.1:7870
./run.sh --lan      # also reachable from your phone on the same Wi-Fi
```

Type a search (e.g. `transformers explained`) and press **Search**, then tap a result, or paste a link and
press **Load**. Pick the section with the slider, type times, or play the video and tap
**Set to now**. **Preview section** plays just that part. To get everything instead, switch the Section card
to **Whole video**: the button becomes **Download video** / **Download audio**. Choose Video or Audio, quality and Precise cut,
then **Trim clip**. Finished clips appear under **Clips**, where you can play, download or delete them.
Clips are saved in `clips/` (set `VT_CLIPS=/some/folder` to change it). The folder is git-ignored.

`--lan` has no login: anyone on the same Wi-Fi can download and delete clips, so use it only on networks you trust.

## Command line

```bash
./trim.sh "https://www.youtube.com/watch?v=VIDEO_ID" --start 1:30 --end 2:45
```

| Option | What it does |
|---|---|
| `--start`, `--end` | Section to keep. Seconds (`90`), `MM:SS` (`1:30`) or `HH:MM:SS` (`1:02:03.5`) |
| `--out FOLDER` | Where to save (default: `clips/` in this folder) |
| `--audio` | Audio only, saved as `.m4a` |
| `--precise` | Frame-accurate cut (re-encodes at the cut points, slower). Without it, cuts snap to the nearest keyframe, usually within a second or two |
| `--max-height 720` | Limit resolution (e.g. 720, 1080) |
| `--full` | Download the whole video (or the whole audio with `--audio`) instead of a section |

Files are named after the video, the range and any options that change the result, e.g.
`Video title [1m30s-2m45s].mp4` or `Video title [1m30s-2m45s precise 720p].mp4`, so different trims never
overwrite each other. Times past the end of the video are clamped to its length.
Video is saved as H.264 + AAC MP4 when available, so it plays in QuickTime, on any iPhone and in editors.

## Keeping it working

YouTube changes often. If downloads start failing, update yt-dlp:

```bash
.venv/bin/python -m pip install -U "yt-dlp[default]"
```
