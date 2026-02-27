---
summary: "Video-specific prompt extraction pack for YouTube 3110hx3ygp0"
read_when:
  - Reviewing extracted prompts and evidence for Matthew Berman's OpenClaw workflow video
  - Replaying or extending this exact extraction run
  - Auditing canonical vs transcript vs OCR evidence for prompt entries
title: "Video Prompts 3110hx3ygp0"
---

# Video Prompts 3110hx3ygp0

Source video:

- URL: `https://youtu.be/3110hx3ygp0`
- Title: `I've spent 5 BILLION tokens perfecting OpenClaw...`
- Channel: `Matthew Berman`
- Duration: `2400` seconds (`40m`)

## Output pack

Generated artifacts:

- `docs/experiments/research/data/3110hx3ygp0/manifest.json`
- `docs/experiments/research/data/3110hx3ygp0/prompts.json`
- `docs/experiments/research/data/3110hx3ygp0/frames.json`

Run summary (`manifest.json`):

- Prompts extracted: `51`
- Frames analyzed: `43`
- Canonical sources resolved: `4`

## Canonical sources used

Resolved as canonical lanes:

- `https://gist.github.com/mberman84/663a7eba2450afb06d3667b8c284515b`
- `https://gist.github.com/mberman84/885c972f4216747abfb421bfbddb4eba`
- `https://forwardfuture.ai`
- `https://tools.forwardfuture.ai`

## Prompt breakdown

By category:

- `workflow`: `20`
- `system`: `9`
- `rubric`: `6`
- `other`: `16`

By evidence source:

- `canonical+ocr+transcript`: `30`
- `canonical+ocr`: `1`
- `transcript`: `20`

## High-signal extracted prompts

Canonical prompt entries include:

- `prompt-001`: `AGENTS.md`
- `prompt-005`: `TOOLS.md`
- `prompt-007`: `MEMORY.md`
- `prompt-008`: `SUBAGENT-POLICY.md`
- `prompt-009`: `1. Personal CRM`
- `prompt-010`: `2. Meeting Intelligence`
- `prompt-011`: `3. Knowledge Base (RAG System)`
- `prompt-012`: `4. Content Pipeline`
- `prompt-014`: `6. Security`
- `prompt-015`: `7. Cron Jobs and Automation`
- `prompt-018`: `10. Inbound Sales / Lead Pipeline`
- `prompt-023`: `15. Self-Improvement`
- `prompt-025`: `17. Agent Prompt File Organization`
- `prompt-031`: `The Prompt`

Transcript-only mention entries are captured as `prompt-032` through `prompt-051` with timestamp evidence.

## Frame and OCR evidence

Matched chapter/keyword frames with linked prompt IDs include:

- `chapter-006` (`00:12:28`, `MD File Breakdown`) -> `prompt-002`, `prompt-025`, `prompt-026`
- `chapter-012` (`00:21:53`, `Security (HUGE)`) -> `prompt-008`, `prompt-009`, `prompt-011`, `prompt-012`
- `chapter-017` (`00:29:40`, `Usage & Cost Tracking`) -> `prompt-013`, `prompt-019`, `prompt-027`, `prompt-029`
- `chapter-020` (`00:32:55`, `Separating Personal/Work`) -> `prompt-003`, `prompt-020`, `prompt-022`, `prompt-024`, `prompt-031`
- `keyword-018` (`00:28:27`, `Keyword hit: crm`) -> `prompt-001`, `prompt-007`, `prompt-017`

## Reproduce this run

```bash
bash scripts/research/video-prompts/run.sh \
  --url "https://youtu.be/3110hx3ygp0" \
  --video-id "3110hx3ygp0" \
  --slug "video-prompts-3110hx3ygp0" \
  --mode metadata-only \
  --yt-dlp-bin "/Users/sdluffy/Library/Python/3.14/bin/yt-dlp"

node scripts/research/video-prompts/validate-pack.mjs --video-id 3110hx3ygp0
```

## Notes

- Raw assets are intentionally local-only under `.local/video-research/3110hx3ygp0/`.
- This run used a user-local `yt-dlp` binary because Homebrew was not writable on this host.
- `yt-dlp` emitted a JavaScript runtime warning; extraction still succeeded, but install guidance for JS runtimes should be considered for future hardening.
