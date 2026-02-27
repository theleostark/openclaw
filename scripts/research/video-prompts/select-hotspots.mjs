#!/usr/bin/env node
import fs from 'node:fs/promises';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function toTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function parseVttTimestamp(value) {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':').map((part) => Number(part));
  if (parts.some((n) => Number.isNaN(n))) return null;

  if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }

  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1];
  }

  return null;
}

function cleanVttText(raw) {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseVtt(content) {
  const lines = content.split(/\r?\n/);
  const cues = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (!line || !line.includes('-->')) continue;

    const [startRaw, endRaw] = line.split('-->').map((part) => part.trim().split(' ')[0]);
    const start = parseVttTimestamp(startRaw);
    const end = parseVttTimestamp(endRaw);
    if (start == null || end == null) continue;

    const textLines = [];
    let cursor = i + 1;
    while (cursor < lines.length && lines[cursor].trim() !== '') {
      textLines.push(lines[cursor]);
      cursor += 1;
    }

    i = cursor;
    const text = cleanVttText(textLines.join(' '));
    if (!text) continue;

    cues.push({
      startSeconds: start,
      endSeconds: end,
      text,
      timestamp: toTimestamp(start),
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const cue of cues) {
    const key = `${Math.round(cue.startSeconds)}:${cue.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cue);
  }
  return deduped;
}

function splitFallbackTranscript(rawText) {
  const compact = rawText.replace(/\s+/g, ' ').trim();
  if (!compact) return [];

  const chunks = compact
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return chunks.map((text, index) => {
    const seconds = index * 10;
    return {
      startSeconds: seconds,
      endSeconds: seconds + 10,
      text,
      timestamp: toTimestamp(seconds),
    };
  });
}

function selectKeywordHotspots(lines) {
  const keywordRe = /\b(prompt|system prompt|instructions|agents\.md|memory\.md|workflow|pipeline|template|rubric|score|automation|telegram|crm|inbox|sponsor)\b/i;
  const hits = lines
    .map((line) => {
      const match = line.text.match(keywordRe);
      if (!match) return null;
      const keywordCount = (line.text.match(keywordRe) || []).length;
      const score = (line.text.length / 140) + keywordCount;
      return {
        ...line,
        keyword: match[1].toLowerCase(),
        score,
      };
    })
    .filter(Boolean);

  const grouped = [];
  for (const hit of hits) {
    const prev = grouped[grouped.length - 1];
    if (prev && Math.abs(hit.startSeconds - prev.endSeconds) <= 12) {
      prev.endSeconds = hit.endSeconds;
      prev.text = `${prev.text} ${hit.text}`.replace(/\s+/g, ' ').trim();
      prev.score += hit.score;
      continue;
    }

    grouped.push({
      startSeconds: hit.startSeconds,
      endSeconds: hit.endSeconds,
      text: hit.text,
      keyword: hit.keyword,
      score: hit.score,
      timestamp: hit.timestamp,
    });
  }

  return grouped
    .sort((a, b) => b.score - a.score || a.startSeconds - b.startSeconds)
    .slice(0, 18)
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .map((item, index) => ({
      id: `keyword-${String(index + 1).padStart(3, '0')}`,
      seconds: Math.floor(item.startSeconds),
      timestamp: toTimestamp(item.startSeconds),
      source: 'keyword',
      reason: `Keyword hit: ${item.keyword}`,
      score: Number(item.score.toFixed(2)),
      snippet: item.text.slice(0, 240),
    }));
}

const args = parseArgs(process.argv.slice(2));
const required = ['video-id', 'transcript', 'metadata', 'subtitle', 'out', 'out-transcript'];
for (const key of required) {
  if (!args[key]) {
    throw new Error(`Missing required argument --${key}`);
  }
}

const transcriptRaw = JSON.parse(await fs.readFile(args['transcript'], 'utf8'));
const metadata = JSON.parse(await fs.readFile(args['metadata'], 'utf8'));
const subtitleContent = await fs.readFile(args['subtitle'], 'utf8');

const subtitleLines = parseVtt(subtitleContent);
const fallback = splitFallbackTranscript(transcriptRaw?.extracted?.content ?? '');
const transcriptLines = subtitleLines.length > 0 ? subtitleLines : fallback;

const normalizedTranscript = {
  videoId: args['video-id'],
  source: subtitleLines.length > 0 ? 'vtt' : 'summarize-fallback',
  generatedAt: new Date().toISOString(),
  lines: transcriptLines.map((line, index) => ({
    id: `line-${String(index + 1).padStart(5, '0')}`,
    seconds: Math.floor(line.startSeconds),
    timestamp: toTimestamp(line.startSeconds),
    text: line.text,
  })),
};

const chapterHotspots = Array.isArray(metadata?.chapters)
  ? metadata.chapters.map((chapter, index) => ({
      id: `chapter-${String(index + 1).padStart(3, '0')}`,
      seconds: Math.floor(Number(chapter.start_time) || 0),
      timestamp: toTimestamp(Number(chapter.start_time) || 0),
      source: 'chapter',
      reason: chapter.title || `Chapter ${index + 1}`,
      score: 10,
    }))
  : [];

const keywordHotspots = selectKeywordHotspots(transcriptLines);
const usedChapterSeconds = new Set(chapterHotspots.map((item) => item.seconds));
const dedupedKeywordHotspots = keywordHotspots.filter((item) => !usedChapterSeconds.has(item.seconds));

const hotspots = {
  videoId: args['video-id'],
  generatedAt: new Date().toISOString(),
  stats: {
    chapterHotspots: chapterHotspots.length,
    keywordHotspots: dedupedKeywordHotspots.length,
    transcriptLines: normalizedTranscript.lines.length,
    transcriptSource: normalizedTranscript.source,
  },
  hotspots: [...chapterHotspots, ...dedupedKeywordHotspots],
};

await fs.writeFile(args['out-transcript'], JSON.stringify(normalizedTranscript, null, 2) + '\n', 'utf8');
await fs.writeFile(args.out, JSON.stringify(hotspots, null, 2) + '\n', 'utf8');

console.log(`[video-prompts] hotspot-selection complete (${hotspots.hotspots.length} hotspots)`);
