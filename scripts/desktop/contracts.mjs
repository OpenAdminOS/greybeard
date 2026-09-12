export function artifactNames(platform, version) {
  if (platform === 'darwin') return [`Greybeard-${version}-mac-arm64.dmg`, `Greybeard-${version}-mac-arm64.zip`];
  if (platform === 'win32') return [`Greybeard-${version}-windows-x64-setup.exe`];
  if (platform === 'linux') return [`Greybeard-${version}-linux-x64.AppImage`];
  throw new Error('Unsupported companion platform.');
}
