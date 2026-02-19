#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-}"
APPLY=0
DRY_RUN=0
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_BASE="$ROOT_DIR/pico_pull"
OUT_SET=0
TMP_DIR=""
SNAP_DIR=""

usage() {
  cat <<'EOF'
Usage: ./download_pico.sh [--apply] [--dry-run] [--port /dev/cu.usbmodemXXXX] [--out DIR]

Options:
  --apply          Copy recovered files into this repo after validation.
  --dry-run        List Pico files and validate availability without applying.
  --port PORT      Serial port for Pico.
  --out DIR        Snapshot output directory (default: ./pico_pull).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --out)
      OUT_BASE="${2:-}"
      OUT_SET=1
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

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

STAMP="$(date +%Y%m%d_%H%M%S)"

REQUIRED=(
  "main.py"
  "config.py"
  "web/index.html"
  "web/app.js"
  "web/style.css"
)

OPTIONAL=(
  "web/monster_light.png"
  "web/monster_dark.png"
  "web/monster_light.svg"
  "web/monster_dark.svg"
)

copy_from_pico() {
  local src="$1"
  local dst="$2"
  python3 -m mpremote connect "$PORT" fs cp ":$src" "$dst"
}

list_remote_tree() {
  local code
  code=$(cat <<'PY'
import os
DIR_MASK = 0x4000

def list_dir(path, label):
    print("[" + label + "]")
    try:
        names = os.listdir() if path == "" else os.listdir(path)
    except Exception as exc:
        print("  <missing> " + str(exc))
        return
    names.sort()
    if not names:
        print("  <empty>")
        return
    for name in names:
        full = name if path == "" else path + "/" + name
        try:
            st = os.stat(full)
            mode = st[0]
            size = st[6]
            if mode & DIR_MASK:
                print("  DIR  " + full + "/")
            else:
                print("  FILE " + full + " (" + str(size) + " bytes)")
        except Exception as exc:
            print("  ?    " + full + " (" + str(exc) + ")")

list_dir("", "root")
list_dir("web", "web")
PY
)
  python3 -m mpremote connect "$PORT" exec "$code"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ "$OUT_SET" -eq 1 ]]; then
    mkdir -p "$OUT_BASE"
    TMP_DIR="$(mktemp -d "$OUT_BASE/.dryrun_${STAMP}_XXXX")"
  else
    TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pico_pull_dryrun_${STAMP}_XXXX")"
  fi
  mkdir -p "$TMP_DIR/web"

  echo "Dry run on Pico port $PORT"
  echo "Dry-run staging: $TMP_DIR"
  echo "Remote file listing:"
  list_remote_tree

  echo
  echo "Checking required files ..."
  missing_required=0
  for rel in "${REQUIRED[@]}"; do
    dst="$TMP_DIR/$rel"
    mkdir -p "$(dirname "$dst")"
    if copy_from_pico "$rel" "$dst" >/dev/null 2>&1 && [[ -s "$dst" ]]; then
      echo "  ok   $rel"
    else
      echo "  miss $rel"
      missing_required=1
    fi
  done

  echo "Checking optional files ..."
  for rel in "${OPTIONAL[@]}"; do
    dst="$TMP_DIR/$rel"
    mkdir -p "$(dirname "$dst")"
    if copy_from_pico "$rel" "$dst" >/dev/null 2>&1; then
      echo "  ok   $rel"
    else
      echo "  miss $rel"
    fi
  done

  if [[ "$missing_required" -ne 0 ]]; then
    echo "Dry run result: missing required files on Pico."
    exit 2
  fi
  echo "Dry run result: required files are present."
  exit 0
fi

mkdir -p "$OUT_BASE"
TMP_DIR="$(mktemp -d "$OUT_BASE/.pull_${STAMP}_XXXX")"
SNAP_DIR="$OUT_BASE/$STAMP"
mkdir -p "$TMP_DIR/web"

echo "Pulling required files from Pico on $PORT ..."
for rel in "${REQUIRED[@]}"; do
  dst="$TMP_DIR/$rel"
  mkdir -p "$(dirname "$dst")"
  if ! copy_from_pico "$rel" "$dst"; then
    fail "Could not fetch required file: $rel"
  fi
  if [[ ! -s "$dst" ]]; then
    fail "Fetched empty required file: $rel"
  fi
  echo "  ok  $rel"
done

echo "Pulling optional files ..."
for rel in "${OPTIONAL[@]}"; do
  dst="$TMP_DIR/$rel"
  mkdir -p "$(dirname "$dst")"
  if copy_from_pico "$rel" "$dst" >/dev/null 2>&1; then
    echo "  ok  $rel"
  else
    rm -f "$dst"
    echo "  miss $rel"
  fi
done

if rg -q "monster_light\\.png" "$TMP_DIR/web/index.html" && [[ ! -f "$TMP_DIR/web/monster_light.png" ]]; then
  fail "index.html references monster_light.png but it was not recovered"
fi
if rg -q "monster_dark\\.png" "$TMP_DIR/web/index.html" && [[ ! -f "$TMP_DIR/web/monster_dark.png" ]]; then
  fail "index.html references monster_dark.png but it was not recovered"
fi

mv "$TMP_DIR" "$SNAP_DIR"
echo "Snapshot saved: $SNAP_DIR"

if [[ "$APPLY" -eq 1 ]]; then
  echo "Applying snapshot into repo ..."
  cp -f "$SNAP_DIR/main.py" "$ROOT_DIR/main.py"
  cp -f "$SNAP_DIR/config.py" "$ROOT_DIR/config.py"
  cp -f "$SNAP_DIR/web/index.html" "$ROOT_DIR/web/index.html"
  cp -f "$SNAP_DIR/web/app.js" "$ROOT_DIR/web/app.js"
  cp -f "$SNAP_DIR/web/style.css" "$ROOT_DIR/web/style.css"

  for rel in "monster_light.png" "monster_dark.png" "monster.svg" "monster_dark.svg"; do
    if [[ -f "$SNAP_DIR/web/$rel" ]]; then
      cp -f "$SNAP_DIR/web/$rel" "$ROOT_DIR/web/$rel"
    fi
  done

  echo "Applied recovered files to repo working tree."
fi

exit 0
