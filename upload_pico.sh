#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PICO_DIR="$ROOT_DIR/pico"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found in PATH" >&2
  exit 1
fi

if ! python3 -m mpremote --version >/dev/null 2>&1; then
  echo "mpremote not available (try: python3 -m pip install mpremote)" >&2
  exit 1
fi

if [[ -z "$PORT" ]]; then
  PORT="$(ls /dev/cu.usbmodem* 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$PORT" ]]; then
  echo "No Pico serial port found. Set PORT=/dev/cu.usbmodemXXXX and retry." >&2
  exit 1
fi

CLEAN_PY=$(cat <<'PY'
import os

def rm(path):
    try:
        st = os.stat(path)
    except OSError:
        return
    if st[0] & 0x4000:
        for name in os.listdir(path):
            if name not in (".", ".."):
                rm(path + "/" + name)
        try:
            os.rmdir(path)
        except OSError:
            pass
    else:
        try:
            os.remove(path)
        except OSError:
            pass

for p in ("main.py", "config.py", "web"):
    rm(p)
PY
)

# Ensure pico/ staging folder is up to date before upload.
"$ROOT_DIR/sync_pico.sh"

MPREMOTE_ARGS=(
  connect "$PORT"
  exec "$CLEAN_PY"
  +
  fs cp "$PICO_DIR/main.py" :
  +
  fs cp "$PICO_DIR/config.py" :
  +
  fs mkdir web
  +
  fs cp "$PICO_DIR/web/index.html" :web/index.html
  +
  fs cp "$PICO_DIR/web/app.js" :web/app.js
  +
  fs cp "$PICO_DIR/web/style.css" :web/style.css
  +
  reset
)

python3 -m mpremote "${MPREMOTE_ARGS[@]}"
