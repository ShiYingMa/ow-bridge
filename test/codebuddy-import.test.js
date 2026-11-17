import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OWNER } from '../src/sync.js';

test('import-codebuddy writes selected models to the CodeBuddy file without touching WorkBuddy config', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-codebuddy-'));
  const wbConfig = path.join(root, 'workbuddy.json');
  const cbConfig = path.join(root, '.codebuddy', 'models.json');
  const manual = { id: 'personal', apiKey: 'keep' };
  await fs.writeFile(wbConfig, JSON.stringify([manual]));
  const catalog = { models: [{ id: 'opencode/a', name: 'A' }, { id: 'opencode/b', name: 'B' }], failed: [] };
  await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify(catalog));
  await fs.writeFile(path.join(root, 'service.pid'), String(process.pid));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['--loader', new URL('./fixtures/runtime-loader.mjs', import.meta.url).href, 'src/main.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, BUDDY_DATA_DIR: root, BUDDY_PORT: String(port), BUDDY_MODELS_FILE: wbConfig, BUDDY_CODEBUDDY_MODELS_FILE: cbConfig, BUDDY_NO_SYNC: '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let logs = ''; child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
  const exited = new Promise(resolve => child.once('exit', resolve));
  async function waitFor(predicate) {
    for (let i = 0; i < 300; i++) {
      let state;
      try { state = JSON.parse(await fs.readFile(path.join(root, 'status.json'), 'utf8')); } catch {}
      if (state && predicate(state)) return state;
      if (child.exitCode !== null) throw new Error(logs);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('CodeBuddy lifecycle timeout: ' + logs);
  }
  try {
    await waitFor(s => s.phase === 'ready' && !s.probe.running);
    const key = (await fs.readFile(path.join(root, 'api-key'), 'utf8')).trim();
    async function post(route, payload = {}) {
      const response = await fetch(`http://127.0.0.1:${port}/admin/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
      return result;
    }
    await post('selection', { model: 'opencode/a', selected: true });
    await post('selection', { model: 'opencode/b', selected: true });
    const result = await post('import-codebuddy');
    assert.equal(result.changed, true);
    assert.equal(result.count, 2);
    const cb = JSON.parse(await fs.readFile(cbConfig, 'utf8'));
    assert.ok(Array.isArray(cb.models), 'CodeBuddy models.json must be an object with a models array');
    assert.deepEqual(cb.models.map(m => m.id), ['OC · A', 'OC · B']);
    assert.equal(cb.availableModels, undefined, 'no whitelist is generated');
    for (const entry of cb.models) {
      assert.equal(entry.buddyBridgeOwner, OWNER);
      assert.equal(entry.vendor, 'user');
      assert.equal(entry.apiKey, key);
      assert.ok(entry.url.endsWith('/v1/chat/completions'), entry.url);
    }
    assert.deepEqual(JSON.parse(await fs.readFile(wbConfig, 'utf8')), [manual], 'CodeBuddy import must not modify the WorkBuddy configuration');
    child.send('shutdown'); await exited;
    assert.deepEqual(JSON.parse(await fs.readFile(wbConfig, 'utf8')), [manual], 'Exit preserves WorkBuddy manual entry');
    assert.deepEqual(JSON.parse(await fs.readFile(cbConfig, 'utf8')).models.map(m => m.id), ['OC · A', 'OC · B'], 'CodeBuddy entries are kept after exit');
  } finally {
    if (child.exitCode === null) { child.send('shutdown'); await exited; }
    await fs.rm(root, { recursive: true, force: true });
  }
});
