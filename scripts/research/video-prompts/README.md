# Video Prompt Pipeline

Reusable local pipeline to extract and normalize prompts from a YouTube video into Git-tracked metadata packs.

## What it produces

- `docs/experiments/research/data/<videoId>/manifest.json`
- `docs/experiments/research/data/<videoId>/prompts.json`
- `docs/experiments/research/data/<videoId>/frames.json`

Raw media/transcript OCR assets stay local under `.local/video-research/<videoId>/` and are not committed.

## Dependencies

- `ffmpeg`
- `summarize`
- `tesseract`
- `jq`
- `node`
- `yt-dlp`

Notes:

- Homebrew install for `yt-dlp` is preferred.
- If Homebrew is not writable on this machine, pass `--yt-dlp-bin /absolute/path/to/yt-dlp`.

## Run

```bash
bash scripts/research/video-prompts/run.sh \
  --url "https://youtu.be/3110hx3ygp0" \
  --video-id "3110hx3ygp0" \
  --slug "video-prompts-3110hx3ygp0" \
  --mode metadata-only
```

## Validate only

```bash
node scripts/research/video-prompts/validate-pack.mjs --video-id 3110hx3ygp0
```

## Data model summary

- `manifest.json`: run metadata, source provenance, artifact pointers, aggregate stats.
- `prompts.json`: normalized prompt entries with confidence and evidence links.
- `frames.json`: chapter/hotspot frame index, OCR snippets, and prompt linkage.
