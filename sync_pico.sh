#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PICO_DIR="$ROOT_DIR/pico"

rm -rf "$PICO_DIR"
mkdir -p "$PICO_DIR/web"

cp -f "$ROOT_DIR/main.py" "$ROOT_DIR/config.py" "$PICO_DIR/"

cp -a "$ROOT_DIR/web/." "$PICO_DIR/web/"
