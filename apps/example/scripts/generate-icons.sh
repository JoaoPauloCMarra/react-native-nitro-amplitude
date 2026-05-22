#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets"
BG="#07131E"
INK="#1B2742"
CYAN="#0F8DB8"
CYAN_DARK="#0B6B95"
CYAN_LIGHT="#25B7D3"
MAGENTA="#E03170"
MAGENTA_DARK="#C91355"
WHITE="#F8FAFC"
PAPER="#E5E7EB"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required to generate app icons."
  exit 1
fi

draw_mark() {
  magick "$1" \
    -draw "fill '$INK' roundrectangle 372,138 652,292 38,38" \
    -draw "fill '$PAPER' roundrectangle 404,174 620,264 18,18" \
    -draw "fill '$INK' roundrectangle 178,218 420,326 34,34" \
    -draw "fill '$PAPER' roundrectangle 232,252 382,292 14,14" \
    -draw "fill '$INK' roundrectangle 604,218 846,326 34,34" \
    -draw "fill '$PAPER' roundrectangle 642,252 792,292 14,14" \
    -draw "fill '$CYAN_DARK' path 'M 274,408 L 394,288 L 630,288 L 750,408 L 750,782 Q 750,892 640,892 L 384,892 Q 274,892 274,782 Z'" \
    -draw "fill '$CYAN' path 'M 354,428 L 430,352 L 594,352 L 670,428 L 670,782 Q 670,838 614,838 L 410,838 Q 354,838 354,782 Z'" \
    -draw "fill none stroke '$INK' stroke-width 26 path 'M 274,408 L 394,288 L 630,288 L 750,408 L 750,782 Q 750,892 640,892 L 384,892 Q 274,892 274,782 Z'" \
    -draw "fill '$MAGENTA_DARK' rectangle 274,520 750,704" \
    -draw "fill '$MAGENTA' rectangle 354,520 670,704" \
    -draw "fill none stroke '$INK' stroke-width 20 rectangle 274,520 750,704" \
    -draw "fill '$WHITE' path 'M 394,650 L 394,574 L 436,574 L 510,654 L 510,574 L 554,574 L 554,650 L 514,650 L 438,568 L 438,650 Z'" \
    -draw "fill '$WHITE' path 'M 582,650 L 582,574 L 674,574 L 674,610 L 626,610 L 626,620 L 668,620 L 668,650 Z'" \
    -draw "fill '$WHITE' path 'M 670,552 L 730,612 L 670,672 L 670,638 L 634,638 L 634,586 L 670,586 Z'" \
    -draw "fill '#111827' circle 650,422 650,270" \
    -draw "fill '$PAPER' circle 650,422 650,316" \
    -draw "fill '#111827' path 'M 650,314 L 728,466 L 682,466 L 650,392 L 618,466 L 572,466 Z'" \
    -draw "fill '#111827' roundrectangle 622,426 678,448 11,11" \
    -draw "fill '$CYAN_LIGHT' fill-opacity 0.55 roundrectangle 322,466 338,798 8,8" \
    -draw "fill '$CYAN_LIGHT' fill-opacity 0.55 roundrectangle 690,466 706,798 8,8" \
    -draw "fill '$WHITE' fill-opacity 0.20 path 'M 354,428 L 430,352 L 594,352 L 548,408 L 426,408 L 354,480 Z'" \
    "$2"
}

draw_monochrome_mark() {
  magick "$1" \
    -draw "fill '#FFFFFF' fill-opacity 0.28 roundrectangle 372,138 652,292 38,38" \
    -draw "fill '#FFFFFF' roundrectangle 404,174 620,264 18,18" \
    -draw "fill '#FFFFFF' fill-opacity 0.28 roundrectangle 178,218 420,326 34,34" \
    -draw "fill '#FFFFFF' roundrectangle 232,252 382,292 14,14" \
    -draw "fill '#FFFFFF' fill-opacity 0.28 roundrectangle 604,218 846,326 34,34" \
    -draw "fill '#FFFFFF' roundrectangle 642,252 792,292 14,14" \
    -draw "fill '#FFFFFF' fill-opacity 0.72 path 'M 274,408 L 394,288 L 630,288 L 750,408 L 750,782 Q 750,892 640,892 L 384,892 Q 274,892 274,782 Z'" \
    -draw "fill '#FFFFFF' path 'M 354,428 L 430,352 L 594,352 L 670,428 L 670,782 Q 670,838 614,838 L 410,838 Q 354,838 354,782 Z'" \
    -draw "fill none stroke '#FFFFFF' stroke-width 26 path 'M 274,408 L 394,288 L 630,288 L 750,408 L 750,782 Q 750,892 640,892 L 384,892 Q 274,892 274,782 Z'" \
    -draw "fill '#FFFFFF' rectangle 274,520 750,704" \
    -draw "fill '#000000' path 'M 394,650 L 394,574 L 436,574 L 510,654 L 510,574 L 554,574 L 554,650 L 514,650 L 438,568 L 438,650 Z'" \
    -draw "fill '#000000' path 'M 582,650 L 582,574 L 674,574 L 674,610 L 626,610 L 626,620 L 668,620 L 668,650 Z'" \
    -draw "fill '#000000' path 'M 670,552 L 730,612 L 670,672 L 670,638 L 634,638 L 634,586 L 670,586 Z'" \
    -draw "fill '#FFFFFF' circle 650,422 650,270" \
    -draw "fill '#000000' circle 650,422 650,316" \
    -draw "fill '#FFFFFF' path 'M 650,314 L 728,466 L 682,466 L 650,392 L 618,466 L 572,466 Z'" \
    -draw "fill '#FFFFFF' roundrectangle 622,426 678,448 11,11" \
    "$2"
}

magick -size 1024x1024 "gradient:$BG-#101827" \
  -draw "fill '#092036' circle 512,512 512,156" \
  -draw "fill '#150F2A' fill-opacity 0.45 circle 696,676 696,250" \
  miff:- | draw_mark - "$ASSETS/icon.png"

magick -size 1024x1024 xc:none miff:- | draw_mark - "$ASSETS/adaptive-icon.png"
magick -size 1024x1024 xc:none miff:- | draw_monochrome_mark - "$ASSETS/adaptive-icon-monochrome.png"
magick "$ASSETS/icon.png" "$ASSETS/splash-icon.png"

echo "Generated app icons in $ASSETS"
