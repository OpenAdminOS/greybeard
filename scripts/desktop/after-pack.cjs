const { access, chmod, readFile, rename, copyFile } = require('node:fs/promises');
const { join } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function prepareMacBundle({ appOutDir, projectDir, replaceExecutable = plist => run('/usr/bin/plutil', ['-replace', 'CFBundleExecutable', '-string', 'GreybeardCompanion', plist]) }) {
  const contents = join(appOutDir, 'Greybeard.app/Contents');
  // executableName would also rename the .app. Rename only the shell here,
  // BEFORE adding the service: Greybeard/greybeard collide on default APFS.
  // electron-builder runs this hook after branding and before code signing.
  await rename(join(contents, 'MacOS/Greybeard'), join(contents, 'MacOS/GreybeardCompanion'));
  await replaceExecutable(join(contents, 'Info.plist'));
  const binary = join(contents, 'MacOS/greybeard');
  await copyFile(join(projectDir, 'dist/executable/greybeard-darwin-arm64'), binary);
  await chmod(binary, 0o755);
  const plist = await readFile(join(contents, 'Info.plist'), 'utf8');
  if (!plist.includes('<string>com.ugurlabs.greybeard</string>') || !/<key>CFBundleExecutable<\/key>\s*<string>GreybeardCompanion<\/string>/u.test(plist)) {
    throw new Error('Companion bundle identity or executable name does not match the installed application.');
  }
}

module.exports = async function(context) {
  if (context.electronPlatformName === 'darwin') {
    await prepareMacBundle({ appOutDir: context.appOutDir, projectDir: context.packager.projectDir });
    return;
  }
  const binary = join(context.appOutDir, 'resources/bin', context.electronPlatformName === 'win32' ? 'greybeard.exe' : 'greybeard');
  await access(binary);
  if (context.electronPlatformName !== 'win32') await chmod(binary, 0o755);
};
module.exports.prepareMacBundle = prepareMacBundle;
