const { access, chmod, readFile } = require('node:fs/promises');
const { join } = require('node:path');
module.exports = async function(context) {
  const mac = context.electronPlatformName === 'darwin';
  const binary = mac ? join(context.appOutDir, 'Greybeard.app/Contents/MacOS/greybeard')
    : join(context.appOutDir, 'resources/bin', context.electronPlatformName === 'win32' ? 'greybeard.exe' : 'greybeard');
  await access(binary);
  if (context.electronPlatformName !== 'win32') await chmod(binary, 0o755);
  // Exact identity keeps installed CLI references and macOS app replacement compatible.
  if (mac) {
    const plist = await readFile(join(context.appOutDir, 'Greybeard.app/Contents/Info.plist'), 'utf8');
    if (!plist.includes('<string>com.ugurlabs.greybeard</string>') || !plist.includes('<string>Greybeard</string>')) {
      throw new Error('Companion bundle identity or executable name does not match the installed application.');
    }
  }
};
