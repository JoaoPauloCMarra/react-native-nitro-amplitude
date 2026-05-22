#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets"
BG="#07131E"
BG_ALT="#10243B"
INK="#101827"
CYAN="#20D1E8"
CYAN_DARK="#0C7FA5"
CYAN_SOFT="#8FF3FF"
MAGENTA="#F23D84"
MAGENTA_DARK="#A91958"
VIOLET="#6D5DF2"
AMBER="#FFB347"
WHITE="#F8FAFC"
MIST="#D9F7FF"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required to generate app icons."
  exit 1
fi

draw_signal_core() {
  magick "$1" \
    -draw "fill '$INK' fill-opacity 0.32 circle 512,512 512,136" \
    -draw "fill '$VIOLET' fill-opacity 0.26 circle 350,300 350,134" \
    -draw "fill '$CYAN_DARK' fill-opacity 0.30 circle 690,706 690,322" \
    -draw "fill none stroke '$CYAN' stroke-opacity 0.88 stroke-width 30 ellipse 512,512 280,360 -28,238" \
    -draw "fill none stroke '$MAGENTA' stroke-opacity 0.88 stroke-width 26 ellipse 512,512 360,250 126,396" \
    -draw "fill none stroke '$AMBER' stroke-opacity 0.90 stroke-width 18 ellipse 512,512 326,326 228,326" \
    -draw "fill '$INK' stroke '#24395C' stroke-width 20 circle 512,512 512,224" \
    -draw "fill '#111A2F' circle 512,512 512,264" \
    -draw "fill '#EAFBFF' circle 512,512 512,322" \
    -draw "fill '$INK' path 'M 512,330 L 650,704 L 588,704 L 560,620 L 464,620 L 436,704 L 374,704 Z'" \
    -draw "fill '$WHITE' path 'M 512,438 L 478,560 L 546,560 Z'" \
    -draw "fill none stroke '$CYAN_DARK' stroke-width 22 stroke-linecap round stroke-linejoin round path 'M 372,618 C 414,548 448,548 480,618 S 550,688 604,548 S 690,432 728,500'" \
    -draw "fill none stroke '$MAGENTA' stroke-width 16 stroke-linecap round stroke-linejoin round path 'M 344,726 L 444,726 L 512,648 L 592,726 L 702,726'" \
    -draw "fill '$CYAN_SOFT' circle 285,330 285,296" \
    -draw "fill '$MAGENTA' circle 755,308 755,266" \
    -draw "fill '$AMBER' circle 804,640 804,602" \
    -draw "fill '$WHITE' circle 260,682 260,648" \
    -draw "fill '$INK' fill-opacity 0.28 circle 285,330 285,306" \
    -draw "fill '$INK' fill-opacity 0.25 circle 755,308 755,281" \
    -draw "fill '$INK' fill-opacity 0.22 circle 804,640 804,614" \
    -draw "fill '$INK' fill-opacity 0.20 circle 260,682 260,660" \
    -draw "fill '$WHITE' fill-opacity 0.32 path 'M 390,292 C 444,256 552,250 626,288 C 558,268 472,278 410,326 Z'" \
    -draw "fill '$CYAN_SOFT' fill-opacity 0.24 roundrectangle 308,792 716,826 17,17" \
    "$2"
}

draw_monochrome_core() {
  magick "$1" \
    -draw "fill '#FFFFFF' fill-opacity 0.20 circle 512,512 512,136" \
    -draw "fill none stroke '#FFFFFF' stroke-opacity 0.78 stroke-width 30 ellipse 512,512 280,360 -28,238" \
    -draw "fill none stroke '#FFFFFF' stroke-opacity 0.72 stroke-width 26 ellipse 512,512 360,250 126,396" \
    -draw "fill none stroke '#FFFFFF' stroke-opacity 0.62 stroke-width 18 ellipse 512,512 326,326 228,326" \
    -draw "fill '#FFFFFF' circle 512,512 512,224" \
    -draw "fill '#000000' path 'M 512,330 L 650,704 L 588,704 L 560,620 L 464,620 L 436,704 L 374,704 Z'" \
    -draw "fill '#FFFFFF' path 'M 512,438 L 478,560 L 546,560 Z'" \
    -draw "fill none stroke '#FFFFFF' stroke-width 22 stroke-linecap round stroke-linejoin round path 'M 372,618 C 414,548 448,548 480,618 S 550,688 604,548 S 690,432 728,500'" \
    -draw "fill none stroke '#FFFFFF' stroke-width 16 stroke-linecap round stroke-linejoin round path 'M 344,726 L 444,726 L 512,648 L 592,726 L 702,726'" \
    -draw "fill '#FFFFFF' circle 285,330 285,296" \
    -draw "fill '#FFFFFF' circle 755,308 755,266" \
    -draw "fill '#FFFFFF' circle 804,640 804,602" \
    -draw "fill '#FFFFFF' circle 260,682 260,648" \
    -draw "fill '#FFFFFF' fill-opacity 0.34 roundrectangle 308,792 716,826 17,17" \
    "$2"
}

magick -size 1024x1024 "gradient:$BG-$BG_ALT" \
  -draw "fill '#163E60' fill-opacity 0.50 circle 252,278 252,58" \
  -draw "fill '#190F35' fill-opacity 0.62 circle 812,218 812,72" \
  -draw "fill '#073B4C' fill-opacity 0.42 circle 782,790 782,472" \
  -draw "fill '#08111F' fill-opacity 0.28 circle 270,824 270,562" \
  miff:- | draw_signal_core - "$ASSETS/icon.png"

magick -size 1024x1024 xc:none miff:- | draw_signal_core - "$ASSETS/adaptive-icon.png"
magick -size 1024x1024 xc:none miff:- | draw_monochrome_core - "$ASSETS/adaptive-icon-monochrome.png"
magick "$ASSETS/icon.png" "$ASSETS/splash-icon.png"

echo "Generated app icons in $ASSETS"
