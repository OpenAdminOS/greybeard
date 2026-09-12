// Release operator tool: private keys are supplied by a protected signing job.
import { readFile, writeFile } from 'node:fs/promises';
import { createPrivateKey, sign, createHash } from 'node:crypto';
const [binary, url, sequence, expires, keyFile, output, platform = process.platform, arch = process.arch] = process.argv.slice(2);
if (!output || !Number.isSafeInteger(Number(sequence)) || Number(sequence) < 1 || !Number.isFinite(Date.parse(expires)) || new URL(url).protocol !== 'https:') {
  throw new Error('Usage: node scripts/sign-release-manifest.mjs BINARY HTTPS_URL SEQUENCE EXPIRES PRIVATE_KEY OUTPUT [PLATFORM ARCH]');
}
const key = createPrivateKey(await readFile(keyFile));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Use an Ed25519 release signing key.');
const bytes = await readFile(binary);
const raw = Buffer.from(JSON.stringify({ schema: 1, version: '0.1', sequence: Number(sequence), expires, platform, arch, url, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }));
await writeFile(output, raw);
await writeFile(`${output}.sig`, sign(null, raw, key));
console.log('Signed manifest and detached signature written. Protect and publish through the approved release process.');
