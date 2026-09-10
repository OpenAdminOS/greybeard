import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
if (process.platform === 'win32') { console.log('Windows automatic activation requires a separately signed replacement helper; not supported by this candidate.'); process.exit(0); }
const directory = await mkdtemp(join(tmpdir(), 'greybeard-update-executable-'));
try {
  const binary = join(directory, 'greybeard');
  await copyFile(resolve('dist/executable', `greybeard-${process.platform}-${process.arch}`), binary);
  const data = join(directory, 'data');
  const updates = join(data, 'updates');
  await mkdir(updates, { recursive: true, mode: 0o700 });
  const keys = generateKeyPairSync('ed25519');
  const keyFile = join(directory, 'publisher.pem');
  await writeFile(keyFile, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const staged = join(updates, 'greybeard-2');
  await copyFile(binary, staged);
  const bytes = await readFile(staged);
  const raw = Buffer.from(JSON.stringify({ schema: 1, version: '0.1', sequence: 2, expires: '2099-01-01', platform: process.platform, arch: process.arch, url: 'https://releases.example/app', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  const pending = { executable: binary, staged, raw: raw.toString('base64'), signature: sign(null, raw, keys.privateKey).toString('base64') };
  await writeFile(join(updates, 'pending.json'), JSON.stringify(pending));
  const env = { PATH: '', HOME: directory, GREYBEARD_HOME: directory, GREYBEARD_APP_DATA: data, GREYBEARD_UPDATE_PUBLIC_KEY_FILE: keyFile };
  const run = spawnSync(binary, ['--help'], { cwd: directory, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /activated/);
  assert.match(run.stdout, /Greybeard/);
  assert.equal(await readFile(join(updates, 'sequence'), 'utf8'), '2');
  assert.deepEqual(await readFile(`${binary}.previous`), bytes);
  await writeFile(join(updates, 'pending.json'), JSON.stringify({ ...pending, signature: Buffer.alloc(64).toString('base64') }));
  const rejected = spawnSync(binary, ['--help'], { cwd: directory, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.match(rejected.stderr, /signature verification failed/);
  assert.match(rejected.stdout, /Greybeard/);
  console.log('Packaged update smoke passed: trusted local signature, atomic activation, previous executable retained, invalid pending signature leaves current executable usable.');
} finally { await rm(directory, { recursive: true, force: true }); }
