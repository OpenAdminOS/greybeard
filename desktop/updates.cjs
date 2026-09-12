// The updater replaces the complete signed application, never its embedded CLI.
exports.createUpdateController = function(updater, options) {
  let state = { status: 'idle', message: 'Check for a newer Greybeard application.' }, timer, busy = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  const set = (status, message, extra = {}) => { state = { status, message, ...extra }; };
  updater.on('update-available', info => set('available', 'A complete application update is available.', { version: info.version }));
  updater.on('update-not-available', () => set('current', 'You have the latest available application.'));
  updater.on('download-progress', info => set('downloading', 'Downloading the application update.', { percent: Math.round(info.percent) }));
  updater.on('update-downloaded', info => set('ready', 'Update downloaded. Close your AI clients before restarting to install.', { version: info.version }));
  updater.on('error', () => set('error', 'The update could not be verified or downloaded. Your installed application is unchanged. Check release access and try again.'));
  const status = async () => ({ ...state });
  const check = async () => {
    if (!options.packaged) { set('unavailable', 'Application updates are available in an installed build.'); return status(); }
    if (busy) return status();
    busy = true;
    try { set('checking', 'Checking for application updates.'); await updater.checkForUpdates(); }
    catch { set('error', 'Cannot access the update feed. This repository may require access; install a verified release manually if needed.'); }
    finally { busy = false; }
    return status();
  };
  const download = async () => {
    if (state.status !== 'available' || busy) return status();
    busy = true;
    try { set('downloading', 'Downloading and verifying the full application.'); await updater.downloadUpdate(); }
    catch { set('error', 'Download or signature verification failed. Your installed app is unchanged.'); }
    finally { busy = false; }
    return status();
  };
  const install = async () => {
    if (state.status !== 'ready') throw new Error('Download and verify an update first.');
    await options.beforeInstall();
    updater.quitAndInstall(false, true);
    return status();
  };
  const scheduledCheck = async () => {
    const mode = await options.readMode();
    if (mode === 'manual') return;
    await check();
    if (mode === 'automatic' && state.status === 'available') await download();
  };
  return { status, check, download, install, schedule: async () => { await scheduledCheck().catch(() => {}); timer = setInterval(() => void scheduledCheck().catch(() => {}), 86400000); timer.unref?.(); }, stop: () => clearInterval(timer) };
};
