const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController } = require('./updates.cjs');
function fixture(mode = 'notify') {
  const updater = new EventEmitter(); const calls = [];
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('update-available', { version: '0.1.1' }); };
  updater.downloadUpdate = async () => { calls.push('download'); updater.emit('update-downloaded', { version: '0.1.1' }); };
  updater.quitAndInstall = () => calls.push('install');
  const controller = createUpdateController(updater, { packaged: true, readMode: async () => mode, beforeInstall: async () => calls.push('backup-and-close') });
  return { updater, calls, controller };
}
test('manual mode makes no background call; notify does not download', async () => {
  for (const [mode, expected] of [['manual', []], ['notify', ['check']]]) {
    const f = fixture(mode); await f.controller.schedule(); f.controller.stop(); assert.deepEqual(f.calls, expected);
    assert.equal(f.updater.autoInstallOnAppQuit, false); assert.equal(f.updater.allowDowngrade, false);
  }
});
test('automatic stages a full update but installs only after backup on explicit restart', async () => {
  const f = fixture('automatic'); await f.controller.schedule(); f.controller.stop();
  assert.deepEqual(f.calls, ['check', 'download']); assert.equal((await f.controller.status()).status, 'ready');
  await f.controller.install(); assert.deepEqual(f.calls, ['check', 'download', 'backup-and-close', 'install']);
});
test('failed download and failed backup cannot trigger replacement', async () => {
  const f = fixture(); f.updater.downloadUpdate = async () => { throw new Error('invalid signature'); };
  await f.controller.check(); await f.controller.download(); assert.equal((await f.controller.status()).status, 'error');
  await assert.rejects(f.controller.install()); assert.equal(f.calls.includes('install'), false);
  const g = fixture(); const c = createUpdateController(g.updater, { packaged: true, readMode: async () => 'manual', beforeInstall: async () => { throw new Error('disk full'); } });
  await c.check(); await c.download(); await assert.rejects(c.install(), /disk full/); assert.equal(g.calls.includes('install'), false);
});
test('previous full application backup preserves resources and leaves memory alone', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises'); const { tmpdir } = require('node:os'); const { join } = require('node:path');
  const { createAppBackup } = require('./backup.cjs'); const root = await mkdtemp(join(tmpdir(), 'greybeard-recovery-'));
  try { const installation = join(root, 'app'); const appData = join(root, 'data'); await mkdir(join(installation, 'resources'), { recursive: true }); await mkdir(appData); await writeFile(join(installation, 'resources/core'), 'old runtime'); await writeFile(join(appData, 'memory.db'), 'current memory');
    const previous = await createAppBackup({ appData, installation, platform: 'win32' }); assert.equal(await readFile(join(previous, 'Greybeard/resources/core'), 'utf8'), 'old runtime'); assert.equal(await readFile(join(appData, 'memory.db'), 'utf8'), 'current memory');
  } finally { await rm(root, { recursive: true, force: true }); }
});
