import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCodeBuddyModels, OWNER } from '../src/sync.js';

const models = [{ id: 'opencode/a', name: 'A', context: 1000, output: 500 }];
const endpoint = 'http://127.0.0.1:41980/v1/chat/completions';

test('codebuddy merge produces an object with models array and vendor "user"', () => {
  const merged = mergeCodeBuddyModels([], models, endpoint, 'key');
  assert.ok(Array.isArray(merged.models));
  assert.deepEqual(merged.models.map(m => m.id), ['OC · A']);
  assert.equal(merged.availableModels, undefined, 'no whitelist is generated for a fresh document');
  const entry = merged.models[0];
  assert.equal(entry.vendor, 'user');
  assert.equal(entry.buddyBridgeOwner, OWNER);
  assert.equal(entry.url, endpoint);
  assert.equal(entry.apiKey, 'key');
});

test('codebuddy merge keeps unowned entries, drops stale owned ones, and preserves object metadata', () => {
  const manual = { id: 'personal', apiKey: 'private', url: 'existing' };
  const old = { models: [manual, { id: 'opencode/old', buddyBridgeOwner: OWNER }], availableModels: ['personal', 'opencode/old'], other: true };
  const merged = mergeCodeBuddyModels(old, models, endpoint, 'key');
  assert.equal(merged.other, true);
  assert.deepEqual(merged.models[0], manual);
  assert.deepEqual(merged.models.map(m => m.id), ['personal', 'OC · A']);
  assert.deepEqual(merged.availableModels, ['personal', 'opencode/old'], 'existing whitelist is preserved as-is');
});

test('codebuddy merge tolerates a legacy array document', () => {
  const manual = { id: 'personal', apiKey: 'keep' };
  const merged = mergeCodeBuddyModels([manual], models, endpoint, 'key');
  assert.deepEqual(merged.models.map(m => m.id), ['personal', 'OC · A']);
});

test('codebuddy merge leaves a manual ID collision untouched', () => {
  const custom = { id: 'OC · A', apiKey: 'mine' };
  const merged = mergeCodeBuddyModels([custom], models, endpoint, 'key');
  assert.deepEqual(merged.models, [custom]);
});

test('codebuddy merge rejects empty discovery unless allowEmpty', () => {
  assert.throws(() => mergeCodeBuddyModels([], [], endpoint, 'key'), /Empty model/);
  assert.doesNotThrow(() => mergeCodeBuddyModels([], [], endpoint, 'key', { allowEmpty: true }));
});
