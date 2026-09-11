import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { artifactNames } from './contracts.mjs';
export { artifactNames } from './contracts.mjs';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 40 * 60000 });
  // Arguments may include notary credential identifiers: do not log exec exceptions.
  if (result.status !== 0) throw new Error(`${command} verification failed (exit ${result.status ?? 'unknown'}).`);
  return result.stdout;
}
export async function verifyArtifacts({ root, release = false, finalizeMac = false, platform = process.platform }) {
  const directory = join(root, 'dist/companion');
  const version = JSON.parse(await readFile(join(root, 'desktop/package.json'), 'utf8')).version;
  const expected = artifactNames(platform, version);
  for (const name of expected) await access(join(directory, name));
  let signature = { status: 'candidate', publisher: null, notarized: false };
  if (platform === 'darwin' && release) {
    const app = join(directory, 'mac-arm64/Greybeard.app');
    run('codesign', ['--verify', '--deep', '--strict', app]);
    for (const target of [app, join(app, 'Contents/MacOS/greybeard'), join(directory, expected[0])]) {
      const display = spawnSync('codesign', ['--display', '--verbose=4', target], { encoding: 'utf8' });
      if (display.status !== 0 || !display.stderr.split(/\r?\n/u).includes('TeamIdentifier=D259ULY2B4') || !display.stderr.includes('Authority=Developer ID Application:')) throw new Error('Apple signature does not match the expected Developer ID team.');
    }
    run('xcrun', ['stapler', 'validate', app]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
    const dmg = join(directory, expected[0]);
    if (finalizeMac) {
      const notary = JSON.parse(run('xcrun', ['notarytool', 'submit', dmg, '--key', process.env.APPLE_API_KEY, '--key-id', process.env.APPLE_API_KEY_ID, '--issuer', process.env.APPLE_API_ISSUER, '--wait', '--timeout', '30m', '--output-format', 'json']));
      if (notary.status !== 'Accepted') throw new Error('Apple did not accept the companion DMG for notarization.');
      run('xcrun', ['stapler', 'staple', dmg]);
    }
    run('xcrun', ['stapler', 'validate', dmg]);
    run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
    signature = { status: 'verified', publisher: 'Apple Developer ID team D259ULY2B4', notarized: true };
  }
  if (platform === 'win32' && release) {
    run('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(root, 'scripts/desktop/verify-windows.ps1'), '-Directory', directory]);
    signature = { status: 'verified', publisher: 'Ugurlabs UG (haftungsbeschränkt)', notarized: false };
  }
  if (platform === 'linux') signature = { status: 'sha256-integrity-only', publisher: null, notarized: false };
  // Stapling changes DMG bytes. Refresh every affected update-file hash after finalization.
  const channel = platform === 'darwin' ? 'latest-mac.yml' : platform === 'win32' ? 'latest.yml' : 'latest-linux.yml';
  const metadataPath = join(directory, channel);
  const metadata = yaml.load(await readFile(metadataPath, 'utf8'));
  if (!metadata || metadata.version !== version || !Array.isArray(metadata.files) || !metadata.files.length) throw new Error('Missing or mismatched companion update metadata.');
  for (const item of metadata.files) {
    if (typeof item.url !== 'string' || basename(item.url) !== item.url || !expected.includes(item.url)) throw new Error('Unexpected file reference in update metadata.');
    const content = await readFile(join(directory, item.url));
    const hash = createHash('sha512').update(content).digest('base64');
    if (finalizeMac && item.url.endsWith('.dmg')) { item.sha512 = hash; item.size = content.length; }
    if (item.sha512 !== hash || item.size !== content.length) throw new Error('Companion update metadata does not match its artifact.');
    if (metadata.path === item.url) metadata.sha512 = hash;
  }
  if (platform === 'darwin' && !metadata.files.some(item => item.url.endsWith('.zip'))) throw new Error('Mac updates require a complete app ZIP.');
  await writeFile(metadataPath, yaml.dump(metadata));
  const files = [];
  for (const name of [...expected, channel, ...(await readdir(directory)).filter(name => name.endsWith('.blockmap'))]) {
    const content = await readFile(join(directory, name));
    files.push({ name, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  await writeFile(join(directory, `verification-${platform}.json`), JSON.stringify({ version, platform, release, signature, files, wholeApplication: true }, null, 2) + '\n');
  await writeFile(join(directory, `SHA256SUMS-${platform}.txt`), files.map(file => `${file.sha256}  ${file.name}\n`).join(''));
  console.log(`Verified companion artifacts for ${platform}; signature status: ${signature.status}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await verifyArtifacts({ root: resolve(import.meta.dirname, '../..'), release: process.env.GREYBEARD_DESKTOP_RELEASE === 'true' });
