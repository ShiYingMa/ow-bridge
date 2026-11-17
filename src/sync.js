import { workBuddyReasoning } from './reasoning.js';
import { clientModelID } from './model-status.js';
import { replaceWithRetry } from './atomic.js';
import { parseJson } from './json.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const OWNER = 'buddy-bridge-v1';
const LOCK_STALE_MS = 5 * 60 * 1000;
export async function atomicWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  // WorkBuddy models, status.json and settings.json all land here, so a Windows sharing conflict
  // must not turn a routine refresh into an import failure.
  try { await fs.writeFile(temp, text, { mode: 0o600, flag: 'wx' }); await replaceWithRetry(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}

function buildEntry(m, endpoint, key, vendor) {
  return {
    id: clientModelID(m), name: clientModelID(m), vendor, url: endpoint, apiKey: key,
    supportsToolCall: m.toolcall !== false && !m.chatOnly, supportsImages: m.images === true, ...workBuddyReasoning(m),
    buddyBridgeOwner: OWNER,
    ...((m.input ?? m.context) ? { maxInputTokens: m.input ?? m.context } : {}),
    ...(m.output ? { maxOutputTokens: m.output } : {}),
  };
}

export function mergeModels(document, models, endpoint, key, { allowEmpty = false } = {}) {
  if (!models.length && !allowEmpty) throw new Error('Empty model discovery; existing configuration preserved');
  const list = Array.isArray(document) ? document : document?.models;
  if (!Array.isArray(list)) throw new Error('Unrecognized WorkBuddy models.json; left unchanged');
  const kept = list.filter(m => m.buddyBridgeOwner !== OWNER);
  const conflicts = new Set(kept.map(m => m.id));
  const entries = models.filter(m => !conflicts.has(m.id) && !conflicts.has(clientModelID(m)))
    .map(m => buildEntry(m, endpoint, key, 'Custom'));
  const combined = [...kept, ...entries];
  if (Array.isArray(document)) return combined;
  const updated = { ...document, models: combined };
  if (Array.isArray(document.availableModels)) {
    const old = new Set(list.filter(m => m.buddyBridgeOwner === OWNER && !kept.includes(m)).map(m => m.id));
    updated.availableModels = [...new Set([...document.availableModels.filter(id => !old.has(id)), ...entries.map(m => m.id)])];
  }
  return updated;
}

// CodeBuddy（腾讯云代码助手）读取的是对象结构 { models, availableModels }，
// 且把 vendor 为 "user" 的条目识别为用户自定义模型；与 WorkBuddy 的数组/"Custom" 口径不同。
export function mergeCodeBuddyModels(document, models, endpoint, key, { allowEmpty = false } = {}) {
  if (!models.length && !allowEmpty) throw new Error('Empty model discovery; existing configuration preserved');
  const list = Array.isArray(document) ? document : document?.models;
  if (!Array.isArray(list)) throw new Error('Unrecognized CodeBuddy models.json; left unchanged');
  const kept = list.filter(m => m.buddyBridgeOwner !== OWNER);
  const conflicts = new Set(kept.map(m => m.id));
  const entries = models.filter(m => !conflicts.has(m.id) && !conflicts.has(clientModelID(m)))
    .map(m => buildEntry(m, endpoint, key, 'user'));
  const combined = [...kept, ...entries];
  return { ...(Array.isArray(document) ? {} : document), models: combined, availableModels: combined.map(m => m.id) };
}

export async function syncModels(file, models, endpoint, key, options = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const lockFile = `${file}.buddy-bridge.lock`;
  await fs.stat(lockFile).then(async stat => {
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) await fs.unlink(lockFile).catch(() => {});
  }, () => {});
  const lock = await fs.open(lockFile, 'wx', 0o600).catch(() => { throw new Error('Model sync already running; no changes made'); });
  try {
    const old = await fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT' && !options.requireExisting) return null; throw e; });
    const document = old === null ? [] : parseJson(old);
    const merge = options.merge || mergeModels;
    const merged = merge(document, models, endpoint, key, options);
    const count = (Array.isArray(merged) ? merged : merged.models).filter(m => m.buddyBridgeOwner === OWNER).length;
    if (JSON.stringify(merged) === JSON.stringify(document)) return { changed: false, count };
    const current = await fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT' && !options.requireExisting) return null; throw e; });
    if (current !== old) throw new Error('WorkBuddy configuration changed during sync; retry refresh');
    let backup;
    if (old !== null) {
      backup = `${file}.buddy-bridge-${Date.now()}.bak`;
      await fs.writeFile(backup, old, { mode: 0o600, flag: 'wx' });
    }
    await atomicWrite(file, JSON.stringify(merged, null, 2) + '\n');
    return { changed: true, count, backup };
  } finally { await lock.close(); await fs.unlink(lockFile).catch(() => {}); }
}
