#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

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

const args = parseArgs(process.argv.slice(2));
if (!args['video-id']) {
  throw new Error('Missing required --video-id');
}

const repoRoot = process.cwd();
const dataDir = path.join(repoRoot, 'docs/experiments/research/data', args['video-id']);
const manifestPath = path.join(dataDir, 'manifest.json');
const promptsPath = path.join(dataDir, 'prompts.json');
const framesPath = path.join(dataDir, 'frames.json');

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

const errors = [];

const [manifest, prompts, frames] = await Promise.all([
  readJson(manifestPath),
  readJson(promptsPath),
  readJson(framesPath),
]);

if (manifest.videoId !== args['video-id']) {
  errors.push(`manifest.videoId mismatch: expected ${args['video-id']}, got ${manifest.videoId}`);
}
if (prompts.videoId !== args['video-id']) {
  errors.push(`prompts.videoId mismatch: expected ${args['video-id']}, got ${prompts.videoId}`);
}
if (frames.videoId !== args['video-id']) {
  errors.push(`frames.videoId mismatch: expected ${args['video-id']}, got ${frames.videoId}`);
}

if (!Array.isArray(prompts.prompts) || prompts.prompts.length === 0) {
  errors.push('prompts.prompts must be a non-empty array');
}
if (!Array.isArray(frames.frames) || frames.frames.length === 0) {
  errors.push('frames.frames must be a non-empty array');
}

const promptIds = new Set();
for (const prompt of prompts.prompts || []) {
  if (!prompt.id || !prompt.title || !prompt.promptText) {
    errors.push(`prompt missing required fields: ${JSON.stringify(prompt)}`);
    continue;
  }

  if (promptIds.has(prompt.id)) {
    errors.push(`duplicate prompt id: ${prompt.id}`);
  }
  promptIds.add(prompt.id);

  if (!['high', 'medium', 'low'].includes(prompt.confidence)) {
    errors.push(`invalid prompt confidence (${prompt.id}): ${prompt.confidence}`);
  }

  if (!Array.isArray(prompt.sourceKinds) || prompt.sourceKinds.length === 0) {
    errors.push(`prompt sourceKinds missing (${prompt.id})`);
  }

  if (!prompt.evidence || typeof prompt.evidence !== 'object') {
    errors.push(`prompt evidence missing (${prompt.id})`);
  }
}

for (const frame of frames.frames || []) {
  if (!frame.id || typeof frame.seconds !== 'number') {
    errors.push(`frame missing required fields: ${JSON.stringify(frame)}`);
    continue;
  }

  if (!Array.isArray(frame.matchedPromptIds)) {
    errors.push(`frame.matchedPromptIds must be array (${frame.id})`);
    continue;
  }

  for (const promptId of frame.matchedPromptIds) {
    if (!promptIds.has(promptId)) {
      errors.push(`frame ${frame.id} references unknown prompt id ${promptId}`);
    }
  }
}

if (manifest?.stats?.promptCount !== (prompts.prompts || []).length) {
  errors.push(`manifest.stats.promptCount mismatch: expected ${(prompts.prompts || []).length}, got ${manifest?.stats?.promptCount}`);
}
if (manifest?.stats?.frameCount !== (frames.frames || []).length) {
  errors.push(`manifest.stats.frameCount mismatch: expected ${(frames.frames || []).length}, got ${manifest?.stats?.frameCount}`);
}

if (errors.length > 0) {
  console.error('[video-prompts] validation failed');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('[video-prompts] validation passed');
console.log(`- videoId: ${args['video-id']}`);
console.log(`- prompts: ${(prompts.prompts || []).length}`);
console.log(`- frames: ${(frames.frames || []).length}`);
console.log(`- manifest: ${manifestPath}`);
