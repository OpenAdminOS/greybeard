// Exercise the actual distribution payload with a separate, empty local profile.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { artifactNames } from './contracts.mjs';
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'greybeard-packaged-'));
const root = resolve(import.meta.dirname, '../..');
const version = JSON.parse(await readFile(join(root, 'desktop/package.json'), 'utf8')).version;
const artifact = join(root, 'dist/companion', artifactNames(process.platform, version)[0]);
const env = { ...process.env, GREYBEARD_APP_DATA: join(directory, 'data'), GREYBEARD_HOME: directory };
for (const key of ['ELECTRON_RUN_AS_NODE', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'AZURE_CLIENT_SECRET', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'GH_TOKEN', 'GITHUB_TOKEN']) delete env[key];
let app, mount;
try {
  let executablePath;
  if (process.platform === 'darwin') {
    mount = join(directory, 'mount'); await mkdir(mount);
    await run('hdiutil', ['attach', artifact, '-mountpoint', mount, '-nobrowse', '-readonly'], { env });
    expect(await readlink(join(mount, 'Applications'))).toBe('/Applications');
    const installed = join(directory, 'Greybeard.app');
    await run('ditto', [join(mount, 'Greybeard.app'), installed], { env });
    await run('codesign', ['--verify', '--deep', '--strict', installed], { env });
    executablePath = join(installed, 'Contents/MacOS/GreybeardCompanion');
  } else if (process.platform === 'linux') {
    await run(artifact, ['--appimage-extract'], { cwd: directory, env, maxBuffer: 8 * 1024 * 1024 });
    executablePath = join(directory, 'squashfs-root/greybeard-companion');
  } else if (process.env.CI === 'true') {
    const installed = join(directory, 'Installed');
    await run(artifact, ['/S', `/D=${installed}`], { env });
    executablePath = join(installed, 'Greybeard.exe');
  } else {
    // A local Windows packaging check must not replace the user's registered installation.
    executablePath = join(root, 'dist/companion/win-unpacked/Greybeard.exe');
  }
  app = await electron.launch({ executablePath, env });
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  const window = await app.firstWindow();
  await expect(window.locator('#memory-count')).toHaveText('0');
  expect(await window.evaluate(() => typeof window.require)).toBe('undefined');
  expect(await window.evaluate(() => typeof window.greybeardDesktop.exportMemory)).toBe('function');
  expect(new URL(window.url()).hostname).toBe('127.0.0.1');
  await expect(window.locator('#memory-list article')).toHaveCount(0);
  console.log('Distributed companion payload opened its isolated bundled service and memory controls.');
} finally {
  if (app) await app.close();
  if (mount) await run('hdiutil', ['detach', mount]);
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
