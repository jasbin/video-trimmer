#!/bin/bash
# ./run.sh        web UI on this Mac only:  http://127.0.0.1:7870
# ./run.sh --lan  also reachable from phones on the same Wi-Fi
cd "$(dirname "$0")"
if [ "$1" = "--lan" ]; then
  export VT_HOST=0.0.0.0
  ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
  echo "==> On your phone (same Wi-Fi), open: http://${ip:-<this-mac-ip>}:7870"
else
  echo "==> Open http://127.0.0.1:7870"
fi
exec .venv/bin/python server.py
