// Developer ID signing and notarization. No credential values are written to logs.
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
if (process.platform !== 'darwin') throw new Error('Apple signing requires macOS.');
const mode = process.argv[2];
const root = resolve(import.meta.dirname, '..');
const temporary = process.env.RUNNER_TEMP;
if (!temporary) throw new Error('RUNNER_TEMP is required for temporary signing material.');
const directory = join(temporary, `greybeard-signing-${process.env.GITHUB_RUN_ID || process.pid}-${process.env.GITHUB_RUN_ATTEMPT || 1}`);
const keychain = join(directory, 'signing.keychain-db');
const binary = join(root, 'dist/executable', `greybeard-darwin-${process.arch}`);
const native = join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node');
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GREYBEARD_APPLE_') && !name.startsWith('APPLE_API_') && !['CSC_LINK', 'CSC_KEY_PASSWORD'].includes(name)));
function required(name) { const value = process.env[name]; if (!value) throw new Error(`Required signing setting is missing: ${name}`); return value; }
function run(tool, args) {
  try { return execFileSync(tool, args, { env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 40 * 60_000 }); }
  catch { throw new Error(`${tool} failed during Apple ${mode}. No credential arguments were logged.`); }
}
async function verify(file) {
  run('codesign', ['--verify', '--strict', file]);
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('codesign', ['--display', '--verbose=4', file], { env: childEnv, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot inspect Apple code signature.');
  const team = required('APPLE_TEAM_ID');
  const identity = JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8')).publisher;
  if (!result.stderr.split(/\r?\n/).includes(`TeamIdentifier=${team}`) || !result.stderr.split(/\r?\n/).includes(`Authority=${identity}`)) throw new Error('Apple signing team or Developer ID identity does not match the configured publisher.');
  if (file === binary && !/flags=.*\bruntime\b/.test(result.stderr)) throw new Error('Apple executable is missing hardened runtime.');
  return { teamId: team, publisher: identity };
}
if (mode === 'prepare') {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const certificate = join(directory, 'certificate.p12');
  await writeFile(certificate, Buffer.from(required('CSC_LINK'), 'base64'), { mode: 0o600 });
  const password = randomBytes(32).toString('hex');
  run('security', ['create-keychain', '-p', password, keychain]);
  run('security', ['set-keychain-settings', '-lut', '3600', keychain]);
  run('security', ['unlock-keychain', '-p', password, keychain]);
  run('security', ['import', certificate, '-k', keychain, '-P', required('CSC_KEY_PASSWORD'), '-T', '/usr/bin/codesign']);
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain]);
  await rm(certificate);
  const team = required('APPLE_TEAM_ID');
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('Invalid expected Apple team ID.');
  const identities = [...run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]).matchAll(/"(Developer ID Application: [^"]+)"/g)].map(match => match[1]).filter(identity => identity.endsWith(`(${team})`));
  if (new Set(identities).size !== 1) throw new Error('Expected one Developer ID Application identity for the configured Apple team.');
  await writeFile(join(directory, 'identity.json'), JSON.stringify({ publisher: identities[0], teamId: team }), { mode: 0o600 });
  run('codesign', ['--force', '--sign', identities[0], '--keychain', keychain, '--timestamp', native]);
  await verify(native);
  console.log('Developer ID certificate prepared; SQLite addon signed before embedding.');
} else if (mode === 'sign') {
  const identity = JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8')).publisher;
  run('codesign', ['--force', '--sign', identity, '--keychain', keychain, '--options', 'runtime', '--timestamp', '--entitlements', join(root, 'scripts/macos-entitlements.plist'), binary]);
  await verify(binary);
  console.log('Executable signed with Developer ID and hardened runtime.');
} else if (mode === 'notarize') {
  const identity = await verify(binary);
  const keyFile = join(directory, 'notary-key.p8');
  await writeFile(keyFile, required('APPLE_API_KEY'), { mode: 0o600 });
  const submission = join(directory, 'submission'); await mkdir(submission, { recursive: true, mode: 0o700 });
  await copyFile(binary, join(submission, 'greybeard'));
  // Submit the same native code that the executable extracts, so its code hash
  // is also reviewed even though the download contains just one executable.
  await copyFile(native, join(submission, 'better_sqlite3.node'));
  const archive = join(directory, 'notarization.zip');
  run('ditto', ['-c', '-k', '--keepParent', submission, archive]);
  const result = JSON.parse(run('xcrun', ['notarytool', 'submit', archive, '--key', keyFile, '--key-id', required('APPLE_API_KEY_ID'), '--issuer', required('APPLE_API_ISSUER'), '--wait', '--timeout', '30m', '--output-format', 'json']));
  await rm(keyFile);
  if (result.status !== 'Accepted' || typeof result.id !== 'string') throw new Error(`Apple notarization did not accept this build (status ${String(result.status)}).`);
  await verify(binary);
  await writeFile(join(root, 'dist/executable/macos-signature.json'), JSON.stringify({ status: 'verified', ...identity, notarized: true, notarizationId: result.id, hardenedRuntime: true, sha256: createHash('sha256').update(await readFile(binary)).digest('hex') }, null, 2) + '\n');
  console.log(`Apple notarization accepted: ${result.id}. Raw executable tickets are retrieved online; no stapling is claimed.`);
} else if (mode === 'cleanup') {
  try { run('security', ['delete-keychain', keychain]); } catch { /* The prepare step may have failed before creating it. */ }
  await rm(directory, { recursive: true, force: true });
} else throw new Error('Use prepare, sign, notarize, or cleanup.');
