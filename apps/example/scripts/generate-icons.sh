#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets"
BRAND_BG="#07131E"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required to generate app icons."
  exit 1
fi

render_opaque() {
  local input="$1"
  local output="$2"
  magick -background "$BRAND_BG" -density 384 "$input" -resize 1024x1024 "$output"
}

render_transparent() {
  local input="$1"
  local output="$2"
  magick -background none -density 384 "$input" -resize 1024x1024 "$output"
}

render_opaque "$ASSETS/icon-source.svg" "$ASSETS/icon.png"
render_transparent "$ASSETS/adaptive-foreground.svg" "$ASSETS/adaptive-icon.png"
render_transparent "$ASSETS/adaptive-monochrome.svg" "$ASSETS/adaptive-icon-monochrome.png"
render_opaque "$ASSETS/icon-source.svg" "$ASSETS/splash-icon.png"

echo "Generated app icons in $ASSETS"
