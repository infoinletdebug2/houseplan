#!/usr/bin/env bash
# One Codex image at a time (blueprint D): stdin from /dev/null, skip existing.
# usage: bash gen.sh screens|photos
cd "$(dirname "$0")"
SET="$1"
OUT="$SET"
mkdir -p "$OUT"
PHOTO="Photorealistic editorial photograph for a premium home-building budget app. Soft natural light, warm plaster (#F4EFE7) and pale oak tones, deep spruce green (#17332E) accents, shallow depth of field, calm and high-end. Absolutely no text, letters, numbers, logos, labels, watermarks, people, faces or hands."
DISC="Cinematic, low-key, deep shadows; the subject sits in the upper two-thirds and the bottom third darkens smoothly toward deep spruce ink (#10241F)."
HERO="The subject sits in the upper 60%; the lower 40% is calm and fades toward warm plaster."
UI="Premium, distinctive, editorial product design (not a generic template): one display serif for headlines, a clean sans for body, generous spacing, 44pt touch targets, crisp legible text. Show only the phone screen, no hands, plain light-grey backdrop around it."
while IFS=$'\t' read -r name aspect desc; do
  [ -z "$name" ] && continue
  [ -f "$OUT/$name.png" ] && { echo "skip $name"; continue; }
  case "$SET" in
    screens) prompt="$desc $UI" ;;
    *) prompt="${desc/DISCOVERY/$DISC}"; prompt="${prompt/HERO/$HERO} $PHOTO" ;;
  esac
  echo "gen $name $(date +%H:%M:%S)"
  codex exec --skip-git-repo-check -s danger-full-access -C "$(pwd -W)/$OUT" \
    "Use your image generation tool to create ONE image at aspect $aspect and save it in the current directory as $name.png (exactly that file name; if the tool saves elsewhere, copy it here). Do not create or modify any other files. Image: $prompt" < /dev/null >> "codex-$SET.log" 2>&1
  ls -la "$OUT/$name.png" 2>/dev/null || echo "MISSING $name"
done < "$SET.tsv"
echo "done $SET"
