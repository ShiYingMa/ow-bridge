import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { resolveCodeBuddyModelsFile } from '../src/codebuddy-config.js';

test('codebuddy models file defaults to ~/.codebuddy/models.json and honors explicit override', () => {
  const home = path.join(os.tmpdir(), 'fake-codebuddy-home');
  assert.equal(resolveCodeBuddyModelsFile({ home, env: {} }), path.join(home, '.codebuddy', 'models.json'));
  const custom = path.join(home, '自定义', 'models.json');
  assert.equal(resolveCodeBuddyModelsFile({ home, env: { BUDDY_CODEBUDDY_MODELS_FILE: custom } }), custom);
  assert.equal(resolveCodeBuddyModelsFile({ home, env: { BUDDY_CODEBUDDY_MODELS_FILE: '   ' } }), path.join(home, '.codebuddy', 'models.json'), 'Blank override falls back to the default location');
});
