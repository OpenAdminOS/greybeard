import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { artifactNames, verifyArtifacts, signatureDiagnostics } from './verify.mjs';
const require = createRequire(import.meta.url);

test('companion bundles the service at the paths used by installed launchers', () => {
  const config = require('../../desktop/electron-builder.cjs');
  assert.equal(config.appId, 'com.ugurlabs.greybeard');
  assert.equal(config.mac.extraFiles, undefined); // Copy only after the shell is renamed.
  assert.equal(config.mac.executableName, undefined); // Preserve Greybeard.app product filename.
  assert.equal(config.afterPack, './scripts/desktop/after-pack.cjs');
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


test('Mac packaging preserves both executable payloads before signing without casefold collisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'greybeard-mac-layout-'));
  try {
    const appOutDir = join(root, 'dist/companion/mac-arm64');
    const contents = join(appOutDir, 'Greybeard.app/Contents');
    await mkdir(join(contents, 'MacOS'), { recursive: true });
    await mkdir(join(root, 'dist/executable'), { recursive: true });
    await writeFile(join(contents, 'MacOS/Greybeard'), 'original-electron-shell');
    await writeFile(join(root, 'dist/executable/greybeard-darwin-arm64'), 'original-node-service');
    await writeFile(join(contents, 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>com.ugurlabs.greybeard</string><key>CFBundleExecutable</key><string>Greybeard</string></dict></plist>');
    const hook = require('./after-pack.cjs');
    await hook.prepareMacBundle({ appOutDir, projectDir: root, replaceExecutable: async plist => {
      const text = await readFile(plist, 'utf8');
      await writeFile(plist, text.replace('<key>CFBundleExecutable</key><string>Greybeard</string>', '<key>CFBundleExecutable</key><string>GreybeardCompanion</string>'));
    } });
    assert.equal(await readFile(join(contents, 'MacOS/GreybeardCompanion'), 'utf8'), 'original-electron-shell');
    assert.equal(await readFile(join(contents, 'MacOS/greybeard'), 'utf8'), 'original-node-service');
    assert.match(await readFile(join(contents, 'Info.plist'), 'utf8'), /CFBundleExecutable<\/key><string>GreybeardCompanion/u);
    assert.notEqual('GreybeardCompanion'.toLowerCase(), 'greybeard'.toLowerCase());
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('signature failure diagnostics expose only controlled signer fields', () => {
  const log = [
    'arbitrary stderr with private paths or credentials must not be echoed',
    'GREYBEARD_SIGNATURE_DIAGNOSTIC not-json',
    'GREYBEARD_SIGNATURE_DIAGNOSTIC ' + JSON.stringify({code:'publisher-mismatch',file:'C:\\private\\Greybeard.exe',status:'Valid',publisher:'Other Publisher',timestamp:true,secret:'never-include'}),
    'GREYBEARD_SIGNATURE_DIAGNOSTIC ' + JSON.stringify({code:'untrusted-freeform-code',file:'bad.exe'})
  ].join('\n');
  assert.deepEqual(signatureDiagnostics(log), [{code:'publisher-mismatch',file:'Greybeard.exe',status:'Valid',publisher:'Other Publisher',timestamp:true}]);
});


test('embedded Authenticode signer and timestamp regressions', t => {
  const available = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
  if (available.error?.code === 'ENOENT' && process.platform !== 'win32') { t.skip('PowerShell is unavailable; this required Windows regression runs on the Windows runner.'); return; }
  assert.equal(available.status, 0, 'PowerShell must be available for Windows signature verification');
  const result = spawnSync('pwsh', ['-NoProfile', '-File', 'scripts/desktop/authenticode-signers.test.ps1'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /timestamp binding and PE bounds regressions passed/u);
});

test('publication stages complete checksummed assets and refuses changed payloads', { skip: process.platform === 'win32' }, async () => {
  // Publication runs on Ubuntu; the local gh fixture never contacts GitHub.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'greybeard-publication-')));
  try {
    const directory = join(root, 'dist/companion');
    const tools = join(root, 'tools');
    for (const path of [directory, tools, join(root, 'scripts/desktop'), join(root, 'docs/0.1')]) await mkdir(path, { recursive: true });
    for (const name of ['publish.mjs', 'contracts.mjs']) await writeFile(join(root, 'scripts/desktop', name), await readFile(new URL(name, import.meta.url)));
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.1' }));
    await writeFile(join(root, 'docs/0.1/release-notes.md'), '# Greybeard 0.1.1\n\nFixture release notes.\n');
    for (const name of ['install.sh', 'install.ps1']) await writeFile(join(root, name), `fixture ${name}`);
    const payload = Buffer.from('synthetic application payload');
    for (const platform of ['darwin', 'win32', 'linux']) {
      const files = [];
      for (const name of artifactNames(platform, '0.1.1')) {
        await writeFile(join(directory, name), payload);
        files.push({ name, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') });
      }
      await writeFile(join(directory, `verification-${platform}.json`), JSON.stringify({ version: '0.1.1', platform, release: true, wholeApplication: true, signature: { status: 'verified', notarized: true }, payloadVerification: { zipApplication: true, dmgApplication: true, executableHashesMatch: true }, files }));
      await writeFile(join(directory, `SHA256SUMS-${platform}.txt`), 'fixture platform manifest');
    }
    const calls = join(root, 'calls.jsonl');
    await writeFile(join(tools, 'gh'), `#!/usr/bin/env node\nconst fs = require('node:fs'); const args = process.argv.slice(2); if (args[0] === 'api') process.stdout.write('[]'); else fs.appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify(args) + '\\n');\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${tools}:${process.env.PATH}`, FIXTURE_CALLS: calls, RELEASE_REQUESTED: 'true', PUBLISH_REQUESTED: 'true', RELEASE_TAG: 'v0.1.1', GITHUB_REPOSITORY: 'fixture/repository', GITHUB_SHA: 'fixture-commit' };
    const run = () => spawnSync(process.execPath, [join(root, 'scripts/desktop/publish.mjs'), 'publish'], { env, encoding: 'utf8' });
    const published = run();
    assert.equal(published.status, 0, published.stderr);
    const operations = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(operations.length, 2);
    assert.deepEqual(operations[0].slice(0, 3), ['release', 'create', 'v0.1.1']);
    assert.ok(operations[0].includes('--draft'));
    assert.ok(operations[1].includes('--draft=false'));
    assert.ok(operations[1].includes('--latest'));
    const manifest = (await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n');
    assert.equal(manifest.length, 12);
    for (const entry of manifest) {
      const [digest, name] = entry.split('  ');
      assert.equal(createHash('sha256').update(await readFile(join(directory, name))).digest('hex'), digest);
      assert.ok(operations[0].includes(join(directory, name)));
    }
    assert.ok(operations[0].includes(join(directory, 'SHA256SUMS.txt')));
    await writeFile(join(directory, artifactNames('darwin', '0.1.1')[0]), 'changed after verification');
    const refused = run();
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /changed after verification/);
    assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
