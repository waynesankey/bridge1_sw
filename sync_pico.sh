#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PICO_DIR="$ROOT_DIR/pico"

rm -rf "$PICO_DIR"
mkdir -p "$PICO_DIR/web"

# Auto-increment SW_VERSION in config.py before copying
ver=$(grep -oE 'SW_VERSION\s*=\s*[0-9]+' "$ROOT_DIR/config.py" | grep -oE '[0-9]+$')
new_ver=$((ver + 1))
sed -i '' "s/SW_VERSION = $ver/SW_VERSION = $new_ver/" "$ROOT_DIR/config.py"
echo "SW_VERSION: $ver -> $new_ver"

cp -f "$ROOT_DIR/main.py" "$ROOT_DIR/config.py" "$ROOT_DIR/mdns_responder.py" "$PICO_DIR/"

cp -a "$ROOT_DIR/web/." "$PICO_DIR/web/"
