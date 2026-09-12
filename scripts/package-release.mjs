import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
if (!/^0\.1\.\d+$/u.test(version)) throw new Error('This release workflow requires a numeric version in the 0.1 line.');
const release = process.argv.includes('--release');
const platform = `${process.platform}-${process.arch}`;
if (process.env.GREYBEARD_EXPECT_PLATFORM && platform !== process.env.GREYBEARD_EXPECT_PLATFORM) throw new Error(`Unexpected build target ${platform}.`);
const source = join(root, 'dist/executable', `greybeard-${platform}${process.platform === 'win32' ? '.exe' : ''}`);
const output = join(root, 'dist/release');
await mkdir(output, { recursive: true });
const hash = data => createHash('sha256').update(data).digest('hex');
const executableHash = hash(await readFile(source));
let signing = { status: 'unsigned', publisher: null, notarized: false };
if (process.platform === 'win32' && release) {
  const verification = JSON.parse(await readFile(join(root, 'dist/executable/windows-signature.json'), 'utf8'));
  if (verification.status !== 'verified' || verification.publisher !== 'Ugurlabs UG (haftungsbeschränkt)' || verification.sha256 !== executableHash || verification.fileDigest !== 'SHA256' || verification.timestampDigest !== 'SHA256' || verification.timestampType !== 'RFC3161') throw new Error('Publisher verification is missing or does not match the executable.');
  signing = { ...verification, notarized: false };
} else if (process.platform === 'darwin') {
  execFileSync('codesign', ['--verify', '--strict', source], { stdio: 'inherit' });
  if (release && process.env.GREYBEARD_MACOS_SIGNING === 'developer-id') {
    const verification = JSON.parse(await readFile(join(root, 'dist/executable/macos-signature.json'), 'utf8'));
    if (verification.status !== 'verified' || verification.notarized !== true || verification.hardenedRuntime !== true || verification.sha256 !== executableHash || verification.teamId !== process.env.APPLE_TEAM_ID || !verification.publisher?.startsWith('Developer ID Application: ')) throw new Error('Developer ID notarization evidence is missing or does not match this executable.');
    signing = verification;
  } else signing = { status: 'ad-hoc', publisher: null, notarized: false };
}
let name;
if (process.platform === 'win32') {
  name = `greybeard-${platform}.exe`;
  await copyFile(source, join(output, name));
} else {
  name = `greybeard-${platform}.tar.gz`;
  const staging = await mkdtemp(join(tmpdir(), 'greybeard-release-'));
  try {
    await copyFile(source, join(staging, 'greybeard'));
    await chmod(join(staging, 'greybeard'), 0o755);
    execFileSync('tar', ['-czf', join(output, name), '-C', staging, 'greybeard']);
    const members = execFileSync('tar', ['-tzf', join(output, name)], { encoding: 'utf8' }).trim().split(/\r?\n/);
    if (members.length !== 1 || members[0] !== 'greybeard') throw new Error('Archive has unexpected members.');
    const extracted = join(staging, 'extracted'); await mkdir(extracted);
    execFileSync('tar', ['-xzf', join(output, name), '-C', extracted]);
    const extractedPath = join(extracted, 'greybeard');
    if (((await stat(extractedPath)).mode & 0o111) === 0 || hash(await readFile(extractedPath)) !== executableHash) throw new Error('Archive did not preserve the executable.');
    const data = join(staging, 'isolated-data');
    const help = execFileSync(extractedPath, ['--help'], { cwd: staging, env: { PATH: '', HOME: staging, GREYBEARD_HOME: staging, GREYBEARD_APP_DATA: data }, encoding: 'utf8', timeout: 30_000 });
    if (!help.includes('Greybeard')) throw new Error('Extracted executable did not launch.');
  } finally { await rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
const artifact = await readFile(join(output, name));
const digest = hash(artifact);
const metadataName = `greybeard-${platform}.metadata.json`;
const metadata = JSON.stringify({ version, publicVersion: '0.1', sourceSha: process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), platform: process.platform, architecture: process.arch, artifact: name, bytes: artifact.length, sha256: digest, executableSha256: executableHash, signing, releaseRequested: release }, null, 2) + '\n';
await writeFile(join(output, metadataName), metadata);
await writeFile(join(output, `${name}.sha256`), `${digest}  ${name}\n`);
await writeFile(join(output, `SHA256SUMS-${platform}.txt`), `${digest}  ${name}\n${hash(metadata)}  ${metadataName}\n`);
console.log(`Prepared ${name}, checksums and source/signing metadata. Signing status: ${signing.status}.`);
