import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { artifactNames, verifyArtifacts } from './verify.mjs';
const require = createRequire(import.meta.url);

test('companion bundles the service at the paths used by installed launchers', () => {
  const config = require('../../desktop/electron-builder.cjs');
  assert.equal(config.appId, 'com.ugurlabs.greybeard');
  assert.equal(config.mac.extraFiles[0].to, 'MacOS/greybeard');
  assert.equal(config.win.extraResources[0].to, 'bin/greybeard.exe');
  assert.equal(config.linux.extraResources[0].to, 'bin/greybeard');
  assert.deepEqual(config.mac.target.map(t => t.target), ['dmg', 'zip']);
  assert.equal(config.nsis.oneClick, true);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.publish.token, undefined);
  assert.equal(config.publish.private, undefined);
});

test('final verification rejects tampered application update bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'greybeard-packaging-'));
  try {
    const directory = join(root, 'dist/companion');
    await mkdir(directory, { recursive: true }); await mkdir(join(root, 'desktop'));
    await writeFile(join(root, 'desktop/package.json'), JSON.stringify({ version: '0.1.0' }));
    const name = artifactNames('linux', '0.1.0')[0];
    const payload = Buffer.from('synthetic appimage fixture');
    await writeFile(join(directory, name), payload);
    await writeFile(join(directory, 'latest-linux.yml'), `version: 0.1.0\nfiles:\n  - url: ${name}\n    sha512: ${createHash('sha512').update(payload).digest('base64')}\n    size: ${payload.length}\n`);
    await verifyArtifacts({ root, platform: 'linux' });
    const report = JSON.parse(await readFile(join(directory, 'verification-linux.json'), 'utf8'));
    assert.equal(report.signature.status, 'sha256-integrity-only');
    assert.equal(report.signature.publisher, null);
    await writeFile(join(directory, name), 'tampered');
    await assert.rejects(() => verifyArtifacts({ root, platform: 'linux' }), /does not match/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('update manifests cannot refer outside the artifact directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'greybeard-packaging-'));
  try {
    const directory = join(root, 'dist/companion');
    await mkdir(directory, { recursive: true }); await mkdir(join(root, 'desktop'));
    await writeFile(join(root, 'desktop/package.json'), JSON.stringify({ version: '0.1.0' }));
    await writeFile(join(directory, artifactNames('linux', '0.1.0')[0]), 'fixture');
    await writeFile(join(directory, 'latest-linux.yml'), 'version: 0.1.0\nfiles:\n  - url: ../private-file\n    sha512: invalid\n    size: 1\n');
    await assert.rejects(() => verifyArtifacts({ root, platform: 'linux' }), /Unexpected file reference/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
