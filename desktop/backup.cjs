const { cp, copyFile, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

// Keep the complete previous app outside the installation. Memory is never rolled
// back: a user can recover the previous runtime without losing newer decisions.
exports.createAppBackup = async function({ appData, installation, platform, appImage }) {
  const folder = join(appData, 'application-recovery');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const staging = join(folder, 'staging');
  const previous = join(folder, 'previous');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { mode: 0o700 });
  let name;
  if (platform === 'darwin') { name = 'Greybeard.app'; await run('/usr/bin/ditto', [installation, join(staging, name)]); }
  else if (platform === 'linux' && appImage) { name = 'Greybeard.AppImage'; await copyFile(appImage, join(staging, name)); }
  else { name = 'Greybeard'; await cp(installation, join(staging, name), { recursive: true, dereference: false, preserveTimestamps: true }); }
  await writeFile(join(staging, 'recovery.json'), JSON.stringify({ createdAt: new Date().toISOString(), application: name, note: 'Close Greybeard and AI clients before opening this previous application. Local memory is retained, not restored from an older snapshot.' }, null, 2), { mode: 0o600 });
  await rm(previous, { recursive: true, force: true });
  await rename(staging, previous);
  return previous;
};
