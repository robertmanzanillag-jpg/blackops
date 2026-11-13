#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_DIR="${INPUT_SOURCE_DIR:-$ROOT_DIR/promo_video_edits/01_originales}"
OUTPUT_DIR="${PROMO_OUTPUT_DIR:-$ROOT_DIR/promo_video_edits/03_listos_para_subir}"

OBJECTIVE="${OBJECTIVE:-nightlife}"
MAX_VIDEOS="${MAX_VIDEOS:-0}"
CLIPS_PER_VIDEO="${CLIPS_PER_VIDEO:-5}"
TARGET_SECONDS="${TARGET_SECONDS:-15}"
CUTS="${CUTS:-3}"
WIDTH="${WIDTH:-1080}"
HEIGHT="${HEIGHT:-1920}"
STYLE="${STYLE:-full}"
HOOK_TEXT="${HOOK_TEXT:-BEST APP TO GO OUT}"
CTA_TEXT="${CTA_TEXT:-JOIN THE GUESTLIST}"
FONT_STYLE="${FONT_STYLE:-bold}"
CUSTOM_TEXT="${CUSTOM_TEXT:-0}"

mkdir -p "$OUTPUT_DIR"
if [ -z "${INPUT_SOURCE_DIR:-}" ]; then
  mkdir -p "$INPUT_DIR"
fi

escape_drawtext() {
  printf "%s" "$1" | sed "s/'/ /g; s/:/ /g; s/%/ percent/g; s/\\\\/ /g"
}

video_base_filter() {
  local label="$1"
  if [ "$STYLE" = "post" ]; then
    printf "%s" "${label}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    return
  fi

  printf "%s" "${label}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1"
}

text_filter() {
  local hook
  local cta
  hook="$(escape_drawtext "$HOOK_TEXT")"
  cta="$(escape_drawtext "$CTA_TEXT")"

  printf "%s" "drawtext=text='${hook}':x=(w-text_w)/2:y=150:fontcolor=white:fontsize=72:font='Arial Bold':box=1:boxcolor=black@0.62:boxborderw=28,drawtext=text='${cta}':x=(w-text_w)/2:y=h-250:fontcolor=white:fontsize=54:font='Arial Bold':box=1:boxcolor=black@0.62:boxborderw=22"
}

create_text_overlay() {
  local overlay_path="$1"
  OVERLAY_PATH="$overlay_path" OVERLAY_WIDTH="$WIDTH" OVERLAY_HEIGHT="$HEIGHT" OVERLAY_HOOK="$HOOK_TEXT" OVERLAY_CTA="$CTA_TEXT" OVERLAY_FONT_STYLE="$FONT_STYLE" node -e '
    const sharp = require("sharp");
    const width = Number(process.env.OVERLAY_WIDTH || 1080);
    const height = Number(process.env.OVERLAY_HEIGHT || 1920);
    const escapeXml = (value) => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const hook = escapeXml(process.env.OVERLAY_HOOK || "BEST APP TO GO OUT");
    const cta = escapeXml(process.env.OVERLAY_CTA || "JOIN THE GUESTLIST");
    const styles = {
      bold: { family: "Arial Black, Arial, Helvetica, sans-serif", weight: 900, hook: 68, cta: 52, fill: "white", box: "black", opacity: 0.66, stroke: "none", shadow: false },
      clean: { family: "Arial, Helvetica, sans-serif", weight: 800, hook: 62, cta: 46, fill: "white", box: "#101010", opacity: 0.52, stroke: "none", shadow: false },
      luxury: { family: "Georgia, Times New Roman, serif", weight: 700, hook: 62, cta: 46, fill: "#f7e7b4", box: "#050505", opacity: 0.58, stroke: "none", shadow: true },
      impact: { family: "Impact, Arial Black, Arial, sans-serif", weight: 900, hook: 76, cta: 56, fill: "#ffffff", box: "#000000", opacity: 0.72, stroke: "#000000", shadow: false },
      neon: { family: "Arial Black, Arial, Helvetica, sans-serif", weight: 900, hook: 66, cta: 50, fill: "#d9ff3f", box: "#080808", opacity: 0.64, stroke: "#ff2fb3", shadow: true },
    };
    const style = styles[String(process.env.OVERLAY_FONT_STYLE || "bold").toLowerCase()] || styles.bold;
    const shadow = style.shadow ? `<filter id="glow"><feGaussianBlur stdDeviation="5" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : "";
    const filter = style.shadow ? `filter="url(#glow)"` : "";
    const stroke = style.stroke !== "none" ? `stroke="${style.stroke}" stroke-width="7" paint-order="stroke"` : "";
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>${shadow}</defs>
        <style>
          .label { fill: ${style.fill}; font-family: ${style.family}; font-weight: ${style.weight}; text-anchor: middle; letter-spacing: 0; }
        </style>
        <rect x="${width * 0.08}" y="104" width="${width * 0.84}" height="132" rx="20" fill="${style.box}" opacity="${style.opacity}"/>
        <text x="${width / 2}" y="188" class="label" font-size="${style.hook}" ${stroke} ${filter}>${hook}</text>
        <rect x="${width * 0.1}" y="${height - 318}" width="${width * 0.8}" height="112" rx="18" fill="${style.box}" opacity="${style.opacity}"/>
        <text x="${width / 2}" y="${height - 246}" class="label" font-size="${style.cta}" ${stroke} ${filter}>${cta}</text>
      </svg>
    `;
    sharp(Buffer.from(svg)).png().toFile(process.env.OVERLAY_PATH).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  '
}

template_for_file() {
  local filename
  filename="$(basename "$1" | tr '[:upper:]' '[:lower:]')"

  if [ "$OBJECTIVE" != "auto" ]; then
    printf "%s|%s|%s" "$OBJECTIVE" "$HOOK_TEXT" "$CTA_TEXT"
    return
  fi

  if [ "$CUSTOM_TEXT" = "1" ]; then
    printf "custom|%s|%s" "$HOOK_TEXT" "$CTA_TEXT"
    return
  fi

  case "$filename" in
    *yacht*)
      printf "yacht|YACHT PARTY WEEKEND|DM FOR ACCESS"
      ;;
    *pool*)
      printf "pool|POOL PARTY THIS WEEK|GET ON THE LIST"
      ;;
    *dinner*|*restaurant*)
      printf "dinner|PROMO DINNERS TONIGHT|RESERVE YOUR SPOT"
      ;;
    *guestlist*|*nightclub*|*club*)
      printf "guestlist|GUESTLIST OPEN|TAP IN TONIGHT"
      ;;
    *)
      printf "nightlife|BEST APP TO GO OUT|JOIN THE GUESTLIST"
      ;;
  esac
}

videos=()
while IFS= read -r -d '' video_path; do
  videos+=("$video_path")
done < <(find "$INPUT_DIR" -type f \( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" \) -print0)

if [ "${#videos[@]}" -eq 0 ]; then
  echo "No encontre videos en: $INPUT_DIR"
  echo "Agrega .mp4, .mov o .m4v y vuelve a correr el Promo Video Agent."
  exit 0
fi

processed_videos=0

for input in "${videos[@]}"; do
  input_lower="$(basename "$input" | tr '[:upper:]' '[:lower:]')"
  case "$input_lower" in
    *screenshot*|*screenrecording*|*screen-recording*|*screen_recording*|*captura-de-pantalla*|*captura_de_pantalla*)
      echo "Salto captura/screen recording: $input"
      continue
      ;;
  esac

  if [ "$MAX_VIDEOS" -gt 0 ] && [ "$processed_videos" -ge "$MAX_VIDEOS" ]; then
    break
  fi

  base="$(basename "$input")"
  name="${base%.*}"
  template="$(template_for_file "$input")"
  clip_objective="${template%%|*}"
  template_rest="${template#*|}"
  HOOK_TEXT="${template_rest%%|*}"
  CTA_TEXT="${template_rest#*|}"
  overlay_file="${TMPDIR:-/tmp}/promo_overlay_$$_${processed_videos}.png"
  create_text_overlay "$overlay_file"

  duration="$(
    ffprobe -v error \
      -show_entries format=duration \
      -of default=noprint_wrappers=1:nokey=1 \
      "$input"
  )"

  has_audio="$(
    ffprobe -v error \
      -select_streams a:0 \
      -show_entries stream=index \
      -of csv=p=0 \
      "$input" | head -n 1
  )"

  if awk "BEGIN { exit !($duration > 0) }"; then
    true
  else
    echo "Duracion invalida, salto: $input"
    continue
  fi

  for ((clip = 1; clip <= CLIPS_PER_VIDEO; clip++)); do
    safe_objective="$(printf "%s" "$clip_objective" | tr -cd '[:alnum:]_-')"
    output="$OUTPUT_DIR/${name}_${safe_objective}_clip$(printf "%02d" "$clip")_${TARGET_SECONDS}s.mp4"

    if awk "BEGIN { exit !($duration > $TARGET_SECONDS) }"; then
      max_start="$(awk "BEGIN { printf \"%.6f\", $duration - $TARGET_SECONDS }")"
      if [ "$CLIPS_PER_VIDEO" -eq 1 ]; then
        start="0"
      else
        start="$(awk "BEGIN { printf \"%.6f\", ($max_start * ($clip - 1)) / ($CLIPS_PER_VIDEO - 1) }")"
      fi
    else
      start="0"
    fi

    if awk "BEGIN { exit !($CUTS > 1 && $duration > $TARGET_SECONDS) }"; then
      segment_len="$(awk "BEGIN { printf \"%.6f\", $TARGET_SECONDS / $CUTS }")"
      filter=""
      concat_inputs=""

      for ((i = 0; i < CUTS; i++)); do
        segment_start="$(awk "BEGIN { printf \"%.6f\", $start + ($segment_len * $i) }")"
        segment_end="$(awk "BEGIN { printf \"%.6f\", $segment_start + $segment_len }")"

        filter+="$(video_base_filter "[0:v]trim=start=${segment_start}:end=${segment_end},setpts=PTS-STARTPTS,")[v${i}];"
        concat_inputs+="[v${i}]"

        if [ -n "$has_audio" ]; then
          filter+="[0:a]atrim=start=${segment_start}:end=${segment_end},asetpts=PTS-STARTPTS[a${i}];"
          concat_inputs+="[a${i}]"
        fi
      done

      if [ -n "$has_audio" ]; then
        filter+="${concat_inputs}concat=n=${CUTS}:v=1:a=1[vraw][a];[vraw][1:v]overlay=0:0[v]"
        map_args=(-map "[v]" -map "[a]")
      else
        filter+="${concat_inputs}concat=n=${CUTS}:v=1:a=0[vraw];[vraw][1:v]overlay=0:0[v]"
        map_args=(-map "[v]")
      fi

      ffmpeg -y -i "$input" -i "$overlay_file" \
        -filter_complex "$filter" \
        "${map_args[@]}" \
        -t "$TARGET_SECONDS" \
        -c:v libx264 -preset medium -crf 18 \
        -pix_fmt yuv420p \
        -c:a aac -b:a 192k \
        -movflags +faststart \
        "$output"
    else
      ffmpeg -y -ss "$start" -i "$input" -i "$overlay_file" \
        -filter_complex "$(video_base_filter "[0:v]")[vraw];[vraw][1:v]overlay=0:0[v]" \
        -map "[v]" -map 0:a? \
        -t "$TARGET_SECONDS" \
        -c:v libx264 -preset medium -crf 18 \
        -pix_fmt yuv420p \
        -c:a aac -b:a 192k \
        -movflags +faststart \
        "$output"
    fi

    echo "Listo: $output"
  done

  processed_videos=$((processed_videos + 1))
done
