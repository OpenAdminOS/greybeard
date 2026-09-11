const release = process.env.GREYBEARD_DESKTOP_RELEASE === 'true';
module.exports = {
  appId: 'com.ugurlabs.greybeard',
  productName: 'Greybeard',
  copyright: 'Copyright Ugurlabs',
  directories: { app: 'desktop', output: 'dist/companion', buildResources: 'assets/logo' },
  files: ['*.cjs', '!*.test.cjs', 'package.json'],
  asar: true,
  npmRebuild: false, // SQLite runs inside the Node SEA, never inside Electron.
  forceCodeSigning: release && process.platform !== 'linux',
  afterPack: './scripts/desktop/after-pack.cjs',
  publish: { provider: 'github', owner: 'OpenAdminOS', repo: 'greybeard', releaseType: 'release' },
  mac: {
    executableName: 'GreybeardCompanion',
    target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
    category: 'public.app-category.developer-tools',
    icon: 'assets/logo/greybeard-avatar.png',
    minimumSystemVersion: '14.0',
    identity: release ? undefined : '-',
    hardenedRuntime: release,
    entitlements: 'scripts/desktop/entitlements.mac.plist',
    entitlementsInherit: 'scripts/desktop/entitlements.mac.plist',
    binaries: ['Contents/MacOS/greybeard'],
    notarize: release,
    extraFiles: [{ from: 'dist/executable/greybeard-darwin-arm64', to: 'MacOS/greybeard' }],
    artifactName: 'Greybeard-${version}-mac-arm64.${ext}'
  },
  dmg: { sign: release, title: 'Greybeard ${version}' },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    signExts: ['.dll'],
    icon: 'assets/logo/greybeard-avatar.png',
    extraResources: [{ from: 'dist/executable/greybeard-win32-x64.exe', to: 'bin/greybeard.exe' }],
    artifactName: 'Greybeard-${version}-windows-x64-setup.${ext}',
    ...(release ? { azureSignOptions: {
      publisherName: 'Ugurlabs UG (haftungsbeschränkt)',
      endpoint: 'https://weu.codesigning.azure.net/',
      codeSigningAccountName: 'signacc123', certificateProfileName: 'openadminos-public',
      fileDigest: 'SHA256', timestampRfc3161: 'http://timestamp.acs.microsoft.com', timestampDigest: 'SHA256'
    } } : {})
  },
  nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false, createDesktopShortcut: true, createStartMenuShortcut: true },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    category: 'Utility', icon: 'assets/logo/greybeard-avatar.png',
    extraResources: [{ from: 'dist/executable/greybeard-linux-x64', to: 'bin/greybeard' }],
    artifactName: 'Greybeard-${version}-linux-x64.${ext}'
  }
};
