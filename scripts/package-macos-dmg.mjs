import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

async function verifyFinderLaunch(app, directory) {
  const help = spawnSync('/usr/bin/open', ['-h'], { encoding: 'utf8' });
  for (const option of ['--env', '--stdout', '--stderr']) {
    if (!`${help.stdout}${help.stderr}`.includes(option)) throw new Error(`The runner open tool does not support ${option}.`);
  }
  const home = join(directory, 'finder-smoke'); await mkdir(home, { mode: 0o700 });
  const data = join(home, 'data');
  const stdout = join(home, 'stdout.log'); const stderr = join(home, 'stderr.log');
  await writeFile(stdout, '', { mode: 0o600 }); await writeFile(stderr, '', { mode: 0o600 });
  const child = spawn('/usr/bin/open', ['-n', '-W', '--env', `HOME=${home}`, '--env', `GREYBEARD_HOME=${home}`, '--env', `GREYBEARD_APP_DATA=${data}`, '--stdout', stdout, '--stderr', stderr, app], {
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home }, stdio: 'ignore'
  });
  let completed = false; let exitCode;
  child.once('error', () => { completed = true; exitCode = -1; });
  child.once('close', code => { completed = true; exitCode = code; });
  try {
    let url;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const output = await readFile(stdout, 'utf8');
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/);
      if (match) { url = new URL(match[0]); break; }
      if (completed) throw new Error('LaunchServices app exited before starting graphical setup.');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!url) throw new Error('LaunchServices app did not start graphical setup within 30 seconds.');
    // Session URL remains in a private temporary file, never in CI output.
    const response = await fetch(url.origin, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !(await response.text()).includes('Greybeard 0.1')) throw new Error('Finder launch did not serve the expected setup page.');
    const closed = await fetch(`${url.origin}/close`, { method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json', 'x-greybeard-session': url.hash.slice(1) }, body: '{}', signal: AbortSignal.timeout(10_000) });
    if (!closed.ok || (await closed.json()).closed !== true) throw new Error('Finder setup could not close cleanly.');
    const closeDeadline = Date.now() + 15_000;
    while (!completed && Date.now() < closeDeadline) await new Promise(resolve => setTimeout(resolve, 200));
    if (!completed || exitCode !== 0) throw new Error('LaunchServices did not report clean app termination.');
    console.log('Finder LaunchServices opened the installed app with no arguments, served graphical setup and closed cleanly.');
  } finally {
    if (!completed) child.kill();
    // Stop only this isolated check's core if startup/HTTP verification failed.
    for (const name of await readdir(join(data, 'sessions')).catch(() => [])) {
      const session = await readFile(join(data, 'sessions', name), 'utf8').then(JSON.parse).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!session) continue;
      if (session.executable === join(app, 'Contents/MacOS/greybeard') && Number.isSafeInteger(session.pid) && session.pid > 0) {
        try { process.kill(session.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  }
}

export async function packageMacDmg({ run, verify, notarize, directory, keychain, identity, binary }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('DMG packaging requires Apple Silicon.');
  const root = resolve(import.meta.dirname, '..');
  const output = join(root, 'dist/release'); await mkdir(output, { recursive: true });
  const staging = join(directory, 'dmg-root');
  const app = join(staging, 'Greybeard.app');
  const macos = join(app, 'Contents/MacOS');
  const resources = join(app, 'Contents/Resources');
  await mkdir(macos, { recursive: true }); await mkdir(resources, { recursive: true });
  const hash = value => createHash('sha256').update(value).digest('hex');
  const coreHash = hash(await readFile(binary));
  const core = join(macos, 'greybeard');
  await copyFile(binary, core); await chmod(core, 0o755);
  await verify(core);
  const source = await readFile(join(root, 'dist/executable/software-source.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return { sourceSha: process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD']).trim(), version: '0.1.0' };
  });
  if (source.version !== '0.1.0' || (source.executableSha256 && source.executableSha256 !== coreHash)) throw new Error('Unexpected DMG software version or hash.');
  const packagingSourceSha = process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD']).trim();
  await copyFile(join(root, 'scripts/macos/Info.plist'), join(app, 'Contents/Info.plist'));
  run('plutil', ['-lint', join(app, 'Contents/Info.plist')]);
  const iconset = join(directory, 'greybeard.iconset'); await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) run('sips', ['-z', String(size * scale), String(size * scale), join(root, 'assets/logo/greybeard-light.png'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'greybeard.icns')]);
  const launcher = join(macos, 'GreybeardLauncher');
  run('xcrun', ['clang', '-arch', 'arm64', '-mmacosx-version-min=14.0', '-fobjc-arc', '-framework', 'Cocoa', join(root, 'scripts/macos/Launcher.m'), '-o', launcher]);
  run('codesign', ['--force', '--sign', identity.publisher, '--keychain', keychain, '--options', 'runtime', '--timestamp', launcher]);
  run('codesign', ['--force', '--sign', identity.publisher, '--keychain', keychain, '--options', 'runtime', '--timestamp', app]);
  run('codesign', ['--verify', '--deep', '--strict', app]);
  await verify(app); await verify(launcher);
  if (hash(await readFile(core)) !== coreHash) throw new Error('Bundle signing changed the released core.');
  const smokeHome = join(directory, 'bundle-smoke'); await mkdir(smokeHome);
  const smokeEnv = { PATH: '', HOME: smokeHome, GREYBEARD_HOME: smokeHome, GREYBEARD_APP_DATA: join(smokeHome, 'data') };
  for (const args of [['--help'], ['setup', '--yes'], ['memory', 'list']]) {
    const result = spawnSync(launcher, args, { cwd: smokeHome, env: smokeEnv, encoding: 'utf8', timeout: 60_000 });
    if (result.error || result.status !== 0) throw new Error(`Installed app launcher failed ${args.join(' ')}: ${result.error?.message || result.stderr}`);
  }
  console.log('App launcher passed isolated help, setup and SQLite checks.');
  const appZip = join(directory, 'Greybeard.app.zip');
  run('ditto', ['-c', '-k', '--keepParent', app, appZip]);
  const appNotarizationId = await notarize(appZip);
  run('xcrun', ['stapler', 'staple', app]); run('xcrun', ['stapler', 'validate', app]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  await symlink('/Applications', join(staging, 'Applications'));
  await writeFile(join(staging, 'Install Greybeard.txt'), 'Drag Greybeard.app to Applications, then open Greybeard from Applications.\nYou can eject this disk image afterwards.\n\nUpdates: replace the complete Greybeard.app with the newer signed app.\n');
  const name = 'greybeard-darwin-arm64.dmg';
  const dmg = join(output, name);
  run('hdiutil', ['create', '-volname', 'Greybeard 0.1', '-srcfolder', staging, '-format', 'UDZO', '-ov', dmg]);
  run('codesign', ['--sign', identity.publisher, '--keychain', keychain, '--timestamp', '--identifier', 'com.ugurlabs.greybeard.diskimage', dmg]);
  const dmgNotarizationId = await notarize(dmg);
  run('xcrun', ['stapler', 'staple', dmg]); run('xcrun', ['stapler', 'validate', dmg]);
  run('codesign', ['--verify', '--strict', dmg]);
  run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
  const mount = join(directory, 'mounted-dmg'); await mkdir(mount);
  run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
  try {
    const mountedApp = join(mount, 'Greybeard.app');
    run('codesign', ['--verify', '--deep', '--strict', mountedApp]);
    run('xcrun', ['stapler', 'validate', mountedApp]);
    if (hash(await readFile(join(mountedApp, 'Contents/MacOS/greybeard'))) !== coreHash) throw new Error('Mounted DMG changed the core executable.');
    const blocked = spawnSync(join(mountedApp, 'Contents/MacOS/GreybeardLauncher'), ['--help'], { env: smokeEnv, encoding: 'utf8', timeout: 10_000 });
    if (blocked.status !== 78 || !blocked.stderr.includes('Install Greybeard first')) throw new Error('App did not reject launch from the read-only disk image.');
    const installed = join(directory, 'installed/Greybeard.app'); await mkdir(join(directory, 'installed'));
    run('ditto', [mountedApp, installed]);
    run('codesign', ['--verify', '--deep', '--strict', installed]);
    run('xcrun', ['stapler', 'validate', installed]);
    const installedHelp = spawnSync(join(installed, 'Contents/MacOS/GreybeardLauncher'), ['--help'], { env: smokeEnv, encoding: 'utf8', timeout: 60_000 });
    if (installedHelp.status !== 0 || !installedHelp.stdout.includes('Greybeard')) throw new Error('Installed DMG app did not launch.');
  } finally { run('hdiutil', ['detach', mount]); }
  const artifact = await readFile(dmg); const digest = hash(artifact);
  const installerHome = join(directory, 'installer-smoke'); await mkdir(installerHome);
  const clientDirectory = join(installerHome, 'Library/Application Support/Claude');
  await mkdir(clientDirectory, { recursive: true });
  await writeFile(join(clientDirectory, 'claude_desktop_config.json'), JSON.stringify({ theme: 'dark' }));
  const installer = spawnSync('/bin/sh', [join(root, 'install.sh')], {
    cwd: installerHome, input: '', encoding: 'utf8', timeout: 120_000,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: installerHome, GREYBEARD_HOME: installerHome, GREYBEARD_APP_DATA: join(installerHome, 'data'), GREYBEARD_APP_DIR: join(installerHome, 'Applications'), GREYBEARD_RELEASE_FILE: dmg, GREYBEARD_RELEASE_SHA256: digest }
  });
  if (installer.error || installer.status !== 0) throw new Error(`Shell DMG installation failed: ${installer.error?.message || installer.stderr}`);
  run('codesign', ['--verify', '--deep', '--strict', join(installerHome, 'Applications/Greybeard.app')]);
  const clientConfig = JSON.parse(await readFile(join(clientDirectory, 'claude_desktop_config.json'), 'utf8'));
  if (clientConfig.theme !== 'dark' || clientConfig.mcpServers?.['greybeard-memory']?.command !== join(installerHome, 'Applications/Greybeard.app/Contents/MacOS/greybeard')) throw new Error('Installer did not preserve client settings and register the installed bundle core.');
  await verifyFinderLaunch(join(installerHome, 'Applications/Greybeard.app'), directory);
  console.log('Shell installer verified the final DMG, installed the app and completed setup in an isolated home.');
  const metadataName = `${name}.metadata.json`;
  const metadata = JSON.stringify({ version: '0.1.0', publicVersion: '0.1', softwareSourceSha: source.sourceSha, packagingSourceSha, platform: 'darwin', architecture: 'arm64', artifact: name, bytes: artifact.length, sha256: digest, executableSha256: coreHash, bundleIdentifier: 'com.ugurlabs.greybeard', minimumMacOSVersion: '14.0', signing: { status: 'verified', ...identity, hardenedRuntime: true, notarized: true, stapled: true, appNotarizationId, dmgNotarizationId }, verification: { installedLauncher: true, finderLaunchServices: true, sqlite: true, mountedReadOnlyLaunchBlocked: true, copiedBundleSignature: true, shellInstaller: true, appTicket: true, dmgTicket: true } }, null, 2) + '\n';
  await writeFile(join(output, metadataName), metadata);
  await writeFile(`${dmg}.sha256`, `${digest}  ${name}\n`);
  await writeFile(join(output, 'SHA256SUMS-darwin-arm64-dmg.txt'), `${digest}  ${name}\n${hash(metadata)}  ${metadataName}\n`);
  console.log(`Prepared signed, notarized and stapled ${name}; unchanged core ${coreHash}.`);
}
