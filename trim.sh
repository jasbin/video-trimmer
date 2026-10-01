#!/bin/bash
# Runs trim.py with this folder's venv, from anywhere: ./trim.sh URL --start 1:30 --end 2:45
exec "$(dirname "$0")/.venv/bin/python" "$(dirname "$0")/trim.py" "$@"
