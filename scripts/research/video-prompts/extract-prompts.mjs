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

function detectCategory(text) {
  const value = text.toLowerCase();
  if (/\b(system prompt|identity|persona|agent rules|agents\.md|memory\.md)\b/.test(value)) return 'system';
  if (/\b(rubric|score|criteria|grading|evaluation)\b/.test(value)) return 'rubric';
  if (/\b(workflow|pipeline|process|automation|inbox|triage|crm|routing)\b/.test(value)) return 'workflow';
  if (/\b(template|markdown file|md file|boilerplate|checklist)\b/.test(value)) return 'template';
  return 'other';
}

function normalizeText(value) {
  return value
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value) {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((token) => token.length >= 4),
  );
}

function overlapScore(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }

  return shared;
}

function similarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  const denom = left.size + right.size - shared;
  return denom === 0 ? 0 : (shared / denom);
}

function parseCodeBlocks(markdown) {
  const blocks = [];
  const regex = /```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push({
      index: match.index,
      content: match[1].trim(),
    });
  }
  return blocks;
}

function headingBefore(markdown, atIndex) {
  const prefix = markdown.slice(0, atIndex);
  const headings = [...prefix.matchAll(/^#{1,6}\s+(.+)$/gm)];
  if (headings.length === 0) return null;
  return headings[headings.length - 1][1].trim();
}

function confidenceFromSources(sourceKinds) {
  const hasCanonical = sourceKinds.includes('canonical');
  const hasTranscript = sourceKinds.includes('transcript');
  const hasOcr = sourceKinds.includes('ocr');

  if (hasCanonical && (hasTranscript || hasOcr)) return { label: 'high', score: 0.98 };
  if (hasCanonical) return { label: 'high', score: 0.9 };
  if (hasTranscript && hasOcr) return { label: 'high', score: 0.82 };
  if (hasTranscript) return { label: 'medium', score: 0.65 };
  return { label: 'low', score: 0.5 };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'openclaw-video-prompts/1.0',
      Accept: 'application/vnd.github+json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'openclaw-video-prompts/1.0',
      Accept: 'text/plain,text/markdown,text/html;q=0.9,*/*;q=0.8',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

function parseGistId(url) {
  const match = url.match(/gist\.github\.com\/[a-zA-Z0-9_-]+\/([a-f0-9]+)/i);
  return match?.[1] ?? null;
}

function promptMentionsFromTranscript(lines) {
  const keywordRe = /\b(prompt|system prompt|instructions|agents\.md|memory\.md|workflow|pipeline|template|rubric|score|automation|telegram|crm|inbox|sponsor)\b/i;
  const hits = lines
    .filter((line) => keywordRe.test(line.text || ''))
    .map((line) => ({
      seconds: Number(line.seconds) || 0,
      timestamp: line.timestamp || toTimestamp(Number(line.seconds) || 0),
      text: String(line.text || '').trim(),
    }));

  const merged = [];
  for (const hit of hits) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(hit.seconds - prev.endSeconds) <= 12) {
      prev.endSeconds = hit.seconds;
      prev.text = `${prev.text} ${hit.text}`.replace(/\s+/g, ' ').trim();
      continue;
    }

    merged.push({
      startSeconds: hit.seconds,
      endSeconds: hit.seconds,
      timestamp: hit.timestamp,
      text: hit.text,
    });
  }

  return merged
    .filter((item) => item.text.length >= 60)
    .slice(0, 40)
    .map((item, index) => ({
      id: `mention-transcript-${String(index + 1).padStart(3, '0')}`,
      title: `Transcript mention at ${item.timestamp}`,
      promptText: item.text,
      category: detectCategory(item.text),
      sourceKinds: ['transcript'],
      evidence: {
        canonical: [],
        transcript: [
          {
            timestamp: item.timestamp,
            seconds: item.startSeconds,
            snippet: item.text.slice(0, 240),
          },
        ],
        ocr: [],
      },
    }));
}

function promptMentionsFromOcr(frames) {
  const keywordRe = /\b(prompt|system|agent|workflow|rubric|template|memory|inbox|crm|telegram)\b/i;
  return frames
    .filter((frame) => keywordRe.test(frame.ocrSnippet || ''))
    .filter((frame) => (frame.ocrSnippet || '').length >= 35)
    .slice(0, 40)
    .map((frame, index) => ({
      id: `mention-ocr-${String(index + 1).padStart(3, '0')}`,
      title: `OCR mention at ${frame.timestamp}`,
      promptText: frame.ocrSnippet,
      category: detectCategory(frame.ocrSnippet),
      sourceKinds: ['ocr'],
      evidence: {
        canonical: [],
        transcript: [],
        ocr: [
          {
            frameId: frame.id,
            timestamp: frame.timestamp,
            seconds: frame.seconds,
            snippet: String(frame.ocrSnippet || '').slice(0, 240),
          },
        ],
      },
    }));
}

function attachBestEvidence(prompt, transcriptMentions, ocrMentions) {
  let bestTranscript = null;
  let bestTranscriptScore = 0;

  for (const mention of transcriptMentions) {
    const score = overlapScore(prompt.promptText, mention.promptText);
    if (score > bestTranscriptScore) {
      bestTranscript = mention;
      bestTranscriptScore = score;
    }
  }

  if (bestTranscript && bestTranscriptScore >= 2) {
    prompt.evidence.transcript.push(bestTranscript.evidence.transcript[0]);
    if (!prompt.sourceKinds.includes('transcript')) {
      prompt.sourceKinds.push('transcript');
    }
    bestTranscript._linked = true;
  }

  let bestOcr = null;
  let bestOcrScore = 0;
  for (const mention of ocrMentions) {
    const score = overlapScore(prompt.promptText, mention.promptText);
    if (score > bestOcrScore) {
      bestOcr = mention;
      bestOcrScore = score;
    }
  }

  if (bestOcr && bestOcrScore >= 2) {
    prompt.evidence.ocr.push(bestOcr.evidence.ocr[0]);
    if (!prompt.sourceKinds.includes('ocr')) {
      prompt.sourceKinds.push('ocr');
    }
    bestOcr._linked = true;
  }
}

const args = parseArgs(process.argv.slice(2));
const required = [
  'url',
  'video-id',
  'slug',
  'mode',
  'transcript-raw',
  'transcript-normalized',
  'metadata',
  'hotspots',
  'frames-ndjson',
  'canonical-links',
  'out-canonical',
  'out-manifest',
  'out-prompts',
  'out-frames',
];
for (const key of required) {
  if (!args[key]) throw new Error(`Missing required argument --${key}`);
}

const transcriptRaw = JSON.parse(await fs.readFile(args['transcript-raw'], 'utf8'));
const transcriptNormalized = JSON.parse(await fs.readFile(args['transcript-normalized'], 'utf8'));
const metadata = JSON.parse(await fs.readFile(args.metadata, 'utf8'));
const hotspots = JSON.parse(await fs.readFile(args.hotspots, 'utf8'));
const links = (await fs.readFile(args['canonical-links'], 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const frameLinesRaw = (await fs.readFile(args['frames-ndjson'], 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const frames = frameLinesRaw.map((line) => JSON.parse(line));

const canonicalFetch = [];
const canonicalDocs = [];
for (const link of links) {
  const gistId = parseGistId(link);

  if (gistId) {
    try {
      const gist = await fetchJson(`https://api.github.com/gists/${gistId}`);
      const files = Object.values(gist.files || {});
      canonicalFetch.push({
        url: link,
        sourceKind: 'gist',
        status: 'ok',
        gistId,
        fileCount: files.length,
      });

      for (const file of files) {
        const content = String(file.content || '').trim();
        if (!content) continue;
        canonicalDocs.push({
          url: link,
          sourceKind: 'gist',
          fileName: file.filename,
          title: gist.description || file.filename,
          content,
        });
      }
    } catch (error) {
      canonicalFetch.push({
        url: link,
        sourceKind: 'gist',
        status: 'error',
        error: String(error?.message || error),
      });
    }
    continue;
  }

  if (/forwardfuture\.ai/i.test(link)) {
    try {
      const normalizedUrl = link.replace(/^https?:\/\//i, '');
      const markdown = await fetchText(`https://r.jina.ai/http://${normalizedUrl}`);
      canonicalFetch.push({
        url: link,
        sourceKind: 'article',
        status: 'ok',
        charCount: markdown.length,
      });

      canonicalDocs.push({
        url: link,
        sourceKind: 'article',
        fileName: 'article.md',
        title: link,
        content: markdown,
      });
    } catch (error) {
      canonicalFetch.push({
        url: link,
        sourceKind: 'article',
        status: 'error',
        error: String(error?.message || error),
      });
    }
    continue;
  }

  canonicalFetch.push({
    url: link,
    sourceKind: 'other',
    status: 'skipped',
  });
}

const canonicalPrompts = [];
for (const doc of canonicalDocs) {
  const blocks = parseCodeBlocks(doc.content);
  for (const block of blocks) {
    if (block.content.length < 120) continue;
    const heading = headingBefore(doc.content, block.index);
    const title = heading || `${doc.fileName} prompt block`;

    canonicalPrompts.push({
      id: `canonical-${String(canonicalPrompts.length + 1).padStart(3, '0')}`,
      title,
      promptText: block.content,
      category: detectCategory(`${title}\n${block.content}`),
      sourceKinds: ['canonical'],
      evidence: {
        canonical: [
          {
            url: doc.url,
            sourceKind: doc.sourceKind,
            fileName: doc.fileName,
            title,
            snippet: block.content.slice(0, 240),
          },
        ],
        transcript: [],
        ocr: [],
      },
      notes: null,
    });
  }
}

const transcriptMentions = promptMentionsFromTranscript(transcriptNormalized.lines || []);
const ocrMentions = promptMentionsFromOcr(frames);

for (const prompt of canonicalPrompts) {
  attachBestEvidence(prompt, transcriptMentions, ocrMentions);
}

const residualMentions = [...transcriptMentions, ...ocrMentions]
  .filter((item) => !item._linked)
  .slice(0, 20);

const merged = [];
for (const candidate of [...canonicalPrompts, ...residualMentions]) {
  const similar = merged.find((existing) => similarity(existing.promptText, candidate.promptText) >= 0.78);
  if (!similar) {
    merged.push(structuredClone(candidate));
    continue;
  }

  for (const kind of ['canonical', 'transcript', 'ocr']) {
    const targetList = similar.evidence[kind];
    for (const entry of candidate.evidence[kind]) {
      const key = JSON.stringify(entry);
      const exists = targetList.some((existingEntry) => JSON.stringify(existingEntry) === key);
      if (!exists) targetList.push(entry);
    }
  }

  for (const sourceKind of candidate.sourceKinds) {
    if (!similar.sourceKinds.includes(sourceKind)) {
      similar.sourceKinds.push(sourceKind);
    }
  }
}

const prompts = merged
  .map((prompt, index) => {
    const sourceKinds = Array.from(new Set(prompt.sourceKinds));
    const confidence = confidenceFromSources(sourceKinds);
    return {
      id: `prompt-${String(index + 1).padStart(3, '0')}`,
      title: prompt.title,
      category: prompt.category,
      promptText: prompt.promptText,
      sourceKinds,
      confidence: confidence.label,
      confidenceScore: confidence.score,
      evidence: {
        canonical: prompt.evidence.canonical,
        transcript: prompt.evidence.transcript,
        ocr: prompt.evidence.ocr,
      },
      notes: prompt.notes,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const promptIdByFrame = new Map();
for (const prompt of prompts) {
  for (const ocr of prompt.evidence.ocr || []) {
    const list = promptIdByFrame.get(ocr.frameId) || [];
    if (!list.includes(prompt.id)) list.push(prompt.id);
    promptIdByFrame.set(ocr.frameId, list);
  }
}

const framesOut = {
  version: '1.0',
  videoId: args['video-id'],
  generatedAt: new Date().toISOString(),
  frames: frames.map((frame) => ({
    id: frame.id,
    source: frame.source,
    reason: frame.reason,
    seconds: frame.seconds,
    timestamp: frame.timestamp || toTimestamp(frame.seconds),
    frameLocalPath: frame.frameLocalPath,
    ocrLocalPath: frame.ocrLocalPath,
    ocrSnippet: frame.ocrSnippet,
    matchedPromptIds: promptIdByFrame.get(frame.id) || [],
  })),
};

const promptsOut = {
  version: '1.0',
  videoId: args['video-id'],
  generatedAt: new Date().toISOString(),
  prompts,
};

const manifestOut = {
  version: '1.0',
  videoId: args['video-id'],
  slug: args.slug,
  source: {
    url: args.url,
    title: metadata.title || null,
    channel: metadata.channel || metadata.uploader || null,
    durationSeconds: metadata.duration || null,
    webpageUrl: metadata.webpage_url || args.url,
  },
  run: {
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    tooling: {
      summarize: process.env.VP_TOOL_SUMMARIZE || null,
      ytdlp: process.env.VP_TOOL_YTDLP || null,
      ffmpeg: process.env.VP_TOOL_FFMPEG || null,
      tesseract: process.env.VP_TOOL_TESSERACT || null,
    },
  },
  artifacts: {
    prompts: `docs/experiments/research/data/${args['video-id']}/prompts.json`,
    frames: `docs/experiments/research/data/${args['video-id']}/frames.json`,
    rawLocalDir: `.local/video-research/${args['video-id']}`,
  },
  sources: {
    transcript: {
      summarizeFile: `.local/video-research/${args['video-id']}/transcript.raw.json`,
      normalizedFile: `.local/video-research/${args['video-id']}/transcript.normalized.json`,
      lineCount: transcriptNormalized.lines?.length || 0,
      wordCount: transcriptRaw?.extracted?.wordCount || transcriptRaw?.metrics?.wordCount || null,
    },
    canonical: canonicalFetch,
    hotspots: {
      file: `.local/video-research/${args['video-id']}/hotspots.json`,
      count: hotspots.hotspots?.length || 0,
    },
  },
  stats: {
    promptCount: prompts.length,
    frameCount: framesOut.frames.length,
    canonicalSourceCount: canonicalFetch.filter((entry) => entry.status === 'ok').length,
  },
};

const canonicalRawOut = {
  generatedAt: new Date().toISOString(),
  links,
  fetch: canonicalFetch,
  docs: canonicalDocs.map((doc) => ({
    url: doc.url,
    sourceKind: doc.sourceKind,
    fileName: doc.fileName,
    title: doc.title,
    charCount: doc.content.length,
    content: doc.content,
  })),
};

await fs.writeFile(args['out-canonical'], JSON.stringify(canonicalRawOut, null, 2) + '\n', 'utf8');
await fs.writeFile(args['out-prompts'], JSON.stringify(promptsOut, null, 2) + '\n', 'utf8');
await fs.writeFile(args['out-frames'], JSON.stringify(framesOut, null, 2) + '\n', 'utf8');
await fs.writeFile(args['out-manifest'], JSON.stringify(manifestOut, null, 2) + '\n', 'utf8');

console.log(`[video-prompts] prompt-extraction complete (${prompts.length} prompts)`);
