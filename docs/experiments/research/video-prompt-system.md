---
summary: "Reusable local pipeline for extracting video prompts with summarize + video-frames + OCR"
read_when:
  - Building repeatable video-to-prompt research packs
  - Extracting canonical prompts from linked gists/articles and validating transcript mentions
  - Producing Git-tracked metadata while keeping raw media local-only
title: "Video Prompt System"
---

# Video Prompt System

This workflow builds a local-first prompt extraction pack from a YouTube video.

The pipeline is implemented in `scripts/research/video-prompts/` and uses:

- `summarize` for transcript extraction (`--youtube auto --extract-only --json`)
- `yt-dlp` for metadata, subtitle timing, and local video download
- `skills/video-frames/scripts/frame.sh` for deterministic frame capture
- `tesseract` for OCR prompt signals from extracted frames

## Contract

CLI entrypoint:

```bash
bash scripts/research/video-prompts/run.sh \
  --url <youtube_url> \
  --video-id <video_id> \
  --slug <slug> \
  --mode metadata-only
```

Generated Git-tracked artifacts:

- `docs/experiments/research/data/<videoId>/manifest.json`
- `docs/experiments/research/data/<videoId>/prompts.json`
- `docs/experiments/research/data/<videoId>/frames.json`

Local-only (not committed):

- `.local/video-research/<videoId>/` (raw transcript, subtitles, video, OCR text, canonical fetch cache)

## Data lanes

1. Canonical lane
   - Extract links from video description.
   - Resolve prompt-rich sources (gists/articles).
   - Parse fenced prompt blocks as canonical prompt text.
2. Transcript lane
   - Use timed VTT subtitles to normalize transcript lines into `timestamp + text` records.
   - Detect prompt mentions and preserve timestamp evidence.
3. Frame lane
   - Select chapter plus keyword hotspots.
   - Extract still frames.
   - OCR each frame and attach prompt evidence where text overlap is strong.

## Confidence model

- `high`: canonical with transcript and/or OCR corroboration.
- `medium`: transcript-only mention candidate.
- `low`: OCR-only candidate.

This ordering enforces `transcript+ocr > transcript-only > ocr-only`, with canonical evidence ranked highest.

## Validation

```bash
node scripts/research/video-prompts/validate-pack.mjs --video-id <video_id>
```

Validation checks:

- cross-file `videoId` consistency
- non-empty prompt/frame sets
- prompt evidence shape and confidence labels
- frame `matchedPromptIds` refer to known prompts
- manifest counts match prompt/frame files

## Current run

For the current worked example, see [Video Prompts 3110hx3ygp0](/experiments/research/video-prompts-3110hx3ygp0).
