#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  bash scripts/research/video-prompts/run.sh \
    --url <youtube_url> \
    --video-id <id> \
    [--slug <slug>] \
    [--mode metadata-only] \
    [--yt-dlp-bin /path/to/yt-dlp]
USAGE
  exit 2
}

die() {
  echo "[video-prompts] ERROR: $*" >&2
  exit 1
}

require_bin() {
  local bin="$1"
  command -v "$bin" >/dev/null 2>&1 || die "Missing required binary: $bin"
}

b64_decode() {
  if base64 --decode </dev/null >/dev/null 2>&1; then
    base64 --decode
  else
    base64 -D
  fi
}

seconds_to_hms() {
  local total="$1"
  local h=$((total / 3600))
  local m=$(((total % 3600) / 60))
  local s=$((total % 60))
  printf '%02d:%02d:%02d' "$h" "$m" "$s"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FRAME_SCRIPT="$REPO_ROOT/skills/video-frames/scripts/frame.sh"
DEFAULT_YTDLP="$HOME/Library/Python/3.14/bin/yt-dlp"

url=""
video_id=""
slug=""
mode="metadata-only"
ytdlp_bin="${YTDLP_BIN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      url="${2:-}"
      shift 2
      ;;
    --video-id)
      video_id="${2:-}"
      shift 2
      ;;
    --slug)
      slug="${2:-}"
      shift 2
      ;;
    --mode)
      mode="${2:-}"
      shift 2
      ;;
    --yt-dlp-bin)
      ytdlp_bin="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      ;;
  esac
done

[[ -n "$url" ]] || die "Missing --url"
[[ -n "$video_id" ]] || die "Missing --video-id"
[[ "$mode" == "metadata-only" ]] || die "Unsupported mode: $mode (expected metadata-only)"

if [[ -z "$slug" ]]; then
  slug="video-prompts-${video_id}"
fi

if [[ -z "$ytdlp_bin" ]]; then
  if command -v yt-dlp >/dev/null 2>&1; then
    ytdlp_bin="$(command -v yt-dlp)"
  elif [[ -x "$DEFAULT_YTDLP" ]]; then
    ytdlp_bin="$DEFAULT_YTDLP"
  fi
fi

[[ -n "$ytdlp_bin" && -x "$ytdlp_bin" ]] || die "Missing yt-dlp. Install via brew (preferred) or set --yt-dlp-bin to a valid path."
[[ -f "$FRAME_SCRIPT" ]] || die "Missing frame extractor: $FRAME_SCRIPT"

for bin in ffmpeg summarize tesseract jq node; do
  require_bin "$bin"
done

RAW_DIR="$REPO_ROOT/.local/video-research/$video_id"
DATA_DIR="$REPO_ROOT/docs/experiments/research/data/$video_id"
SUBTITLE_DIR="$RAW_DIR/subtitles"
VIDEO_DIR="$RAW_DIR/video"
FRAME_DIR="$RAW_DIR/frames"
OCR_DIR="$RAW_DIR/ocr"

mkdir -p "$RAW_DIR" "$DATA_DIR" "$SUBTITLE_DIR" "$VIDEO_DIR" "$FRAME_DIR" "$OCR_DIR"

TRANSCRIPT_RAW="$RAW_DIR/transcript.raw.json"
TRANSCRIPT_NORMALIZED="$RAW_DIR/transcript.normalized.json"
METADATA_RAW="$RAW_DIR/video.meta.json"
LINKS_FILE="$RAW_DIR/description.links.txt"
HOTSPOTS_FILE="$RAW_DIR/hotspots.json"
FRAMES_NDJSON="$RAW_DIR/frames.ndjson"
CANONICAL_RAW="$RAW_DIR/canonical-sources.raw.json"
MANIFEST_JSON="$DATA_DIR/manifest.json"
PROMPTS_JSON="$DATA_DIR/prompts.json"
FRAMES_JSON="$DATA_DIR/frames.json"

echo "[video-prompts] Repo root: $REPO_ROOT"
echo "[video-prompts] Raw dir: $RAW_DIR"
echo "[video-prompts] Data dir: $DATA_DIR"
echo "[video-prompts] yt-dlp: $ytdlp_bin"

echo "[video-prompts] 1/8 Extract transcript with summarize"
summarize "$url" --youtube auto --extract-only --json > "$TRANSCRIPT_RAW"

echo "[video-prompts] 2/8 Pull video metadata with yt-dlp"
"$ytdlp_bin" --dump-single-json "$url" > "$METADATA_RAW"

echo "[video-prompts] 3/8 Extract description links"
jq -r '.description // ""' "$METADATA_RAW" \
  | perl -ne 'while(/https?:\/\/[^\s\)\]]+/g){$u=$&;$u=~s/[.,]$//;print "$u\n"}' \
  | sort -u > "$LINKS_FILE"

echo "[video-prompts] 4/8 Download subtitles (timed transcript lane)"
"$ytdlp_bin" --skip-download --write-auto-sub --write-sub --sub-langs "en.*,en" --sub-format vtt \
  -o "$SUBTITLE_DIR/%(id)s.%(ext)s" "$url"

SUBTITLE_FILE=""
for candidate in "$SUBTITLE_DIR/${video_id}.en-orig.vtt" "$SUBTITLE_DIR/${video_id}.en.vtt"; do
  if [[ -f "$candidate" ]]; then
    SUBTITLE_FILE="$candidate"
    break
  fi
done
if [[ -z "$SUBTITLE_FILE" ]]; then
  SUBTITLE_FILE="$(find "$SUBTITLE_DIR" -maxdepth 1 -type f -name "${video_id}*.vtt" | head -n 1 || true)"
fi
[[ -n "$SUBTITLE_FILE" ]] || die "No subtitle file found for $video_id"

echo "[video-prompts] 5/8 Select chapter + prompt hotspots"
node "$SCRIPT_DIR/select-hotspots.mjs" \
  --video-id "$video_id" \
  --transcript "$TRANSCRIPT_RAW" \
  --metadata "$METADATA_RAW" \
  --subtitle "$SUBTITLE_FILE" \
  --out "$HOTSPOTS_FILE" \
  --out-transcript "$TRANSCRIPT_NORMALIZED"

echo "[video-prompts] 6/8 Download video for frame extraction"
"$ytdlp_bin" -f 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]/best' \
  --merge-output-format mp4 \
  -o "$VIDEO_DIR/%(id)s.%(ext)s" "$url"

VIDEO_FILE="$(find "$VIDEO_DIR" -maxdepth 1 -type f -name "${video_id}.*" ! -name '*.part' | head -n 1 || true)"
[[ -n "$VIDEO_FILE" ]] || die "Unable to locate downloaded video in $VIDEO_DIR"

echo "[video-prompts] 7/8 Extract frames + OCR"
: > "$FRAMES_NDJSON"
while IFS= read -r encoded; do
  hotspot_json="$(printf '%s' "$encoded" | b64_decode)"

  id="$(printf '%s' "$hotspot_json" | jq -r '.id')"
  seconds="$(printf '%s' "$hotspot_json" | jq -r '.seconds')"
  source="$(printf '%s' "$hotspot_json" | jq -r '.source')"
  reason="$(printf '%s' "$hotspot_json" | jq -r '.reason')"

  ts="$(seconds_to_hms "$seconds")"
  frame_path="$FRAME_DIR/${id}.jpg"
  ocr_path="$OCR_DIR/${id}.txt"

  bash "$FRAME_SCRIPT" "$VIDEO_FILE" --time "$ts" --out "$frame_path" >/dev/null
  if ! tesseract "$frame_path" stdout --psm 6 > "$ocr_path" 2>/dev/null; then
    : > "$ocr_path"
  fi

  ocr_snippet="$(tr '\n' ' ' < "$ocr_path" | sed 's/[[:space:]]\+/ /g' | sed 's/^ *//;s/ *$//' | cut -c1-500)"

  jq -cn \
    --arg id "$id" \
    --arg source "$source" \
    --arg reason "$reason" \
    --arg timestamp "$ts" \
    --arg frameLocalPath ".local/video-research/$video_id/frames/${id}.jpg" \
    --arg ocrLocalPath ".local/video-research/$video_id/ocr/${id}.txt" \
    --arg ocrSnippet "$ocr_snippet" \
    --argjson seconds "$seconds" \
    '{id:$id,source:$source,reason:$reason,seconds:$seconds,timestamp:$timestamp,frameLocalPath:$frameLocalPath,ocrLocalPath:$ocrLocalPath,ocrSnippet:$ocrSnippet}' \
    >> "$FRAMES_NDJSON"
done < <(jq -r '.hotspots[] | @base64' "$HOTSPOTS_FILE")

echo "[video-prompts] 8/8 Synthesize prompts pack"
export VP_TOOL_SUMMARIZE="$(summarize --version 2>/dev/null | head -n 1 || true)"
export VP_TOOL_YTDLP="$($ytdlp_bin --version 2>/dev/null || true)"
export VP_TOOL_FFMPEG="$(ffmpeg -version | head -n 1)"
export VP_TOOL_TESSERACT="$(tesseract --version | head -n 1)"

node "$SCRIPT_DIR/extract-prompts.mjs" \
  --url "$url" \
  --video-id "$video_id" \
  --slug "$slug" \
  --mode "$mode" \
  --transcript-raw "$TRANSCRIPT_RAW" \
  --transcript-normalized "$TRANSCRIPT_NORMALIZED" \
  --metadata "$METADATA_RAW" \
  --hotspots "$HOTSPOTS_FILE" \
  --frames-ndjson "$FRAMES_NDJSON" \
  --canonical-links "$LINKS_FILE" \
  --out-canonical "$CANONICAL_RAW" \
  --out-manifest "$MANIFEST_JSON" \
  --out-prompts "$PROMPTS_JSON" \
  --out-frames "$FRAMES_JSON"

node "$SCRIPT_DIR/validate-pack.mjs" --video-id "$video_id"

echo "[video-prompts] Completed"
echo "[video-prompts] Manifest: $MANIFEST_JSON"
echo "[video-prompts] Prompts:  $PROMPTS_JSON"
echo "[video-prompts] Frames:   $FRAMES_JSON"
