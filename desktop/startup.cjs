function createStartupController(app, platform = process.platform) {
  const supported = app.isPackaged && ['darwin', 'win32'].includes(platform);
  const status = () => ({ supported, enabled: supported ? app.getLoginItemSettings().openAtLogin : false });
  return {
    status,
    set(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Choose whether Greybeard opens at login.');
      if (!supported) throw new Error('Open at login is available in the installed macOS and Windows app.');
      app.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] });
      return status();
    }
  };
}
module.exports = { createStartupController };
