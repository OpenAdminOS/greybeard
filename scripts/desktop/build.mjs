import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { build } from 'electron-builder';
import { verifyArtifacts } from './verify.mjs';

const root = resolve(import.meta.dirname, '../..');
process.chdir(root);
const release = process.env.GREYBEARD_DESKTOP_RELEASE === 'true';
const rootVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const appVersion = JSON.parse(await readFile('desktop/package.json', 'utf8')).version;
if (rootVersion !== appVersion) throw new Error('Desktop and core package versions must match.');
if (!['linux-x64', 'win32-x64', 'darwin-arm64'].includes(`${process.platform}-${process.arch}`)) throw new Error('Build on the supported target platform and architecture.');
await access(join(root, 'dist/executable', `greybeard-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`));
let temporary;
try {
  if (release && process.platform === 'darwin') {
    for (const key of ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) if (!process.env[key]) throw new Error(`Missing ${key}. Signed releases have no unsigned fallback.`);
    const identity = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    if (identity.status !== 0 || !identity.stdout.includes('(D259ULY2B4)')) throw new Error('Expected Apple Developer ID signing identity was not prepared.');
    temporary = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'greybeard-notary-'));
    const keyPath = join(temporary, 'AuthKey.p8');
    // APPLE_API_KEY stores PEM in this repository; electron-builder expects a path.
    await writeFile(keyPath, process.env.APPLE_API_KEY, { mode: 0o600 });
    process.env.APPLE_API_KEY = keyPath;
    process.env.APPLE_TEAM_ID = 'D259ULY2B4';
  }
  if (release && process.platform === 'win32') {
    for (const key of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']) if (!process.env[key]) throw new Error(`Missing ${key}. Signed releases have no unsigned fallback.`);
  }
  if (!release) process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  // Artifacts are uploaded only after all platform jobs verify. Never let a build publish.
  await build({ config: join(root, 'desktop/electron-builder.cjs'), publish: 'never' });
  await verifyArtifacts({ root, release, finalizeMac: release });
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
