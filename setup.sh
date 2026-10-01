#!/bin/bash
# Creates .venv with yt-dlp and the web UI. Re-run any time to update yt-dlp (YouTube changes often).
# Needs Python 3.10+ and ffmpeg (brew install ffmpeg). Override the Python with: PY=/path/to/python3 ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

PY="${PY:-$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3 || true)}"
if [ -z "$PY" ]; then
  echo "Error: Python 3.10+ not found. Install it with: brew install python" >&2
  exit 1
fi
if ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
  echo "Error: $PY is Python $("$PY" -c 'import platform; print(platform.python_version())'); 3.10 or newer is needed." >&2
  echo "Install one with: brew install python   (or pass PY=/path/to/python3.12 ./setup.sh)" >&2
  exit 1
fi

echo "==> Using $PY ($("$PY" -c 'import platform; print(platform.python_version())'))"
"$PY" -m venv .venv
.venv/bin/python -m pip install -q -U pip
.venv/bin/python -m pip install -q -U -r requirements.txt
echo "==> Installed yt-dlp $(.venv/bin/python -c 'import yt_dlp.version as v; print(v.__version__)')"

if ! command -v ffmpeg >/dev/null; then
  echo "Warning: ffmpeg is required for trimming but was not found. Install it with: brew install ffmpeg" >&2
fi

echo "==> Ready."
echo "    Web UI:        ./run.sh        (then open http://127.0.0.1:7870; add --lan for your phone)"
echo "    Command line:  ./trim.sh 'https://www.youtube.com/watch?v=...' --start 1:30 --end 2:45"
