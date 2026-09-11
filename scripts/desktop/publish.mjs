import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { artifactNames } from './contracts.mjs';
const root = resolve(import.meta.dirname, '../..');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const publish = process.env.PUBLISH_REQUESTED === 'true';
if (!publish) process.exit(0);
if (process.env.RELEASE_REQUESTED !== 'true') throw new Error('Publication requires verified release signing.');
const tag = process.env.RELEASE_TAG;
if (tag !== `v${version}` || !/^v\d+\.\d+\.\d+$/u.test(tag)) throw new Error('Publication tag must match the numeric application version.');
const repository = process.env.GITHUB_REPOSITORY || 'OpenAdminOS/greybeard';
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('GitHub release operation failed. Check repository access and the workflow log.');
  return result.stdout;
}
// Check all published and draft releases; HTTP failures must never look like absence.
const releases = JSON.parse(gh(['api', `repos/${repository}/releases`, '--paginate', '--slurp'])).flat();
if (releases.some(release => release.tag_name === tag)) throw new Error('This release already exists. Publish a new version; existing 0.1 assets must not be replaced.');
const refs = JSON.parse(gh(['api', `repos/${repository}/git/matching-refs/tags/${tag}`]));
if (refs.some(ref => ref.ref === `refs/tags/${tag}`)) throw new Error('This tag already exists. Choose a new application version.');
if (process.argv[2] === 'preflight') process.exit(0);
if (process.argv[2] !== 'publish') throw new Error('Use preflight or publish.');
const directory = join(root, 'dist/companion');
const uploads = [];
for (const platform of ['darwin', 'win32', 'linux']) {
  const reportName = `verification-${platform}.json`;
  const report = JSON.parse(await readFile(join(directory, reportName), 'utf8'));
  if (report.version !== version || report.release !== true || report.platform !== platform) throw new Error('Release verification does not match the requested version.');
  if (platform !== 'linux' && report.signature.status !== 'verified') throw new Error('Publisher signature verification is required.');
  if (platform === 'darwin' && report.signature.notarized !== true) throw new Error('Apple notarization is required.');
  for (const name of artifactNames(platform, version)) if (!report.files.some(file => file.name === name)) throw new Error('Missing required application format.');
  for (const file of report.files) {
    if (file.name.includes('/') || file.name.includes('\\')) throw new Error('Invalid artifact path.');
    const bytes = await readFile(join(directory, file.name));
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Release artifact changed after verification.');
    uploads.push(join(directory, file.name));
  }
  uploads.push(join(directory, reportName), join(directory, `SHA256SUMS-${platform}.txt`));
}
const notes = join(directory, 'release-notes.md');
await writeFile(notes, `Greybeard ${version}: the local desktop companion for configuration, status and reviewed memory.\n\nDownload the signed and notarized Mac Silicon DMG or the signed Windows setup executable. Linux uses an AppImage with SHA-256 integrity hashes. The Mac ZIP is used for complete-application updates.\n\nUpdate metadata is hosted with these assets. Private repository access may require downloading manually through GitHub; no repository credential is embedded in the app.\n`);
// A draft prevents users seeing a partial release if an upload fails. No overwrite flag.
gh(['release', 'create', tag, '--repo', repository, '--target', process.env.GITHUB_SHA || 'HEAD', '--draft', '--title', `Greybeard ${version}`, '--notes-file', notes, ...uploads]);
gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
console.log(`Published verified companion release ${tag}.`);
