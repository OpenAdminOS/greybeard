const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, Notification, Tray, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const { join, resolve } = require('node:path');
const { writeFile, mkdir, readFile, copyFile, chmod, rename } = require('node:fs/promises');
const { autoUpdater } = require('electron-updater');
const { createUpdateController } = require('./updates.cjs');

app.setName('Greybeard');
// Match the NSIS Start Menu shortcut identity used by native Windows notifications.
if (process.platform === 'win32') app.setAppUserModelId('com.ugurlabs.greybeard');
const startup = require('./startup.cjs').createStartupController(app);
let window, child, serverUrl, stopping = false, updater, mentorNotifications, tray;
const root = resolve(__dirname, '..');
let core = app.isPackaged
  ? process.platform === 'darwin' ? join(process.resourcesPath, '../MacOS/greybeard') : join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'greybeard.exe' : 'greybeard')
  : join(root, 'dist/executable', `greybeard-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`);
const userHome = process.env.GREYBEARD_HOME || app.getPath('home');
const appData = process.env.GREYBEARD_APP_DATA || (process.platform === 'win32' ? join(process.env.APPDATA || app.getPath('appData'), 'greybeard') : process.platform === 'darwin' ? join(userHome, 'Library/Application Support/greybeard') : join(process.env.XDG_DATA_HOME || join(userHome, '.local/share'), 'greybeard'));

function trusted(event) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && new URL(event.senderFrame.url).origin === new URL(serverUrl).origin;
}
async function request(path, body = {}) {
  const url = new URL(serverUrl);
  const result = await fetch(url.origin + path, { method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json', 'x-greybeard-session': url.hash.slice(1) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || 'Greybeard service is unavailable.');
  return data;
}
async function prepareCore() {
  // AppImage mounts disappear after exit. MCP clients need a persistent core path.
  if (app.isPackaged && process.platform === 'linux') {
    const { createHash } = require('node:crypto');
    const hash = createHash('sha256').update(await readFile(core)).digest('hex');
    const directory = join(appData, 'runtime');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, 'greybeard');
    let valid = false;
    try { valid = createHash('sha256').update(await readFile(destination)).digest('hex') === hash; } catch {}
    if (!valid) { const temporary = join(directory, 'greybeard.tmp'); await copyFile(core, temporary); await chmod(temporary, 0o700); await rename(temporary, destination); }
    core = destination;
    if (process.env.APPIMAGE) await writeFile(join(appData, 'companion-location.json'), JSON.stringify({ executable: process.env.APPIMAGE }), { mode: 0o600 });
  }
}
function service() {
  return new Promise((resolveReady, reject) => {
    child = spawn(core, ['companion-server', '--app-data', appData], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GREYBEARD_APP_DATA: appData, GREYBEARD_COMPANION: '1', GREYBEARD_UPDATE_MANIFEST_URL: '' } });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('The local memory service did not start.')); }, 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', buffer => {
      output += buffer.toString();
      const match = output.match(/GREYBEARD_COMPANION_READY (http:\/\/127\.0\.0\.1:\d+\/#\w+)/);
      if (match && !serverUrl) { serverUrl = match[1]; clearTimeout(timer); resolveReady(); }
      if (output.length > 65536) output = output.slice(-4096);
    });
    child.stderr.on('data', () => {}); // Never forward private service diagnostics into the renderer.
    child.once('exit', () => {
      clearTimeout(timer);
      if (!serverUrl) reject(new Error('The local memory service exited during startup.'));
      else if (!stopping) { dialog.showErrorBox('Greybeard needs to restart', 'The local service stopped. Your saved memories remain on disk. Close and reopen Greybeard.'); app.quit(); }
    });
  });
}
async function openWindow() {
  if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); return; }
  window = new BrowserWindow({ width: 1180, height: 820, minWidth: 760, minHeight: 600, title: 'Greybeard', backgroundColor: '#f6f4ed', show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false } });
  const origin = new URL(serverUrl).origin;
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => { if (stopping) event.preventDefault(); });
  window.on('closed', () => { window = undefined; });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(serverUrl);
}
function handle(name, fn) { ipcMain.handle(name, (event, ...args) => { if (!trusted(event)) throw new Error('Untrusted application window.'); return fn(...args); }); }
handle('desktop:choose-file', async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Choose a certificate or private key', properties: ['openFile'], filters: [{ name: 'PEM certificate or key', extensions: ['pem', 'crt', 'key'] }] });
  return result.canceled ? null : result.filePaths[0];
});
handle('desktop:export', async (memoryTenant, memoryBinding) => {
  if (memoryBinding !== undefined && (typeof memoryBinding !== 'string' || memoryBinding.length > 1024)) throw new Error('Refresh the selected memory store.');
  if (typeof memoryTenant !== 'string' || memoryTenant.length > 100) throw new Error('Select a memory environment.');
  const result = await dialog.showSaveDialog(window, { title: 'Export memory', defaultPath: 'greybeard-memory.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, JSON.stringify(await request('/export', { memoryTenant, memoryBinding }), null, 2), { mode: 0o600 });
  return true;
});
handle('desktop:storage', async () => { await mkdir(appData, { recursive: true, mode: 0o700 }); return shell.openPath(appData); });
handle('desktop:copy-text', async text => {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('Choose a short prompt to copy.');
  clipboard.writeText(text);
  return true;
});
handle('desktop:recovery', async () => shell.openPath(join(appData, 'application-recovery/previous')));
handle('desktop:updates', async (action) => {
  if (!['status', 'check', 'download', 'install'].includes(action)) throw new Error('Unknown update action.');
  return updater[action]();
});
handle('desktop:startup', enabled => enabled === undefined ? startup.status() : startup.set(enabled));
handle('desktop:quit', () => app.quit());

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (serverUrl) void openWindow(); });
  app.whenReady().then(async () => {
    await prepareCore();
    await service();
    updater = createUpdateController(autoUpdater, { packaged: app.isPackaged, readMode: async () => (await request('/state')).updateMode, beforeInstall: async () => { await require('./sessions.cjs').requireIdleClients(appData, child.pid); const { createAppBackup } = require('./backup.cjs'); await createAppBackup({ appData, installation: process.platform === 'darwin' ? resolve(process.resourcesPath, '../..') : resolve(process.resourcesPath, '..'), platform: process.platform, appImage: process.env.APPIMAGE }); stopping = true; await request('/close'); }, platform: process.platform });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'Greybeard', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Show Greybeard', click: () => void openWindow() }, { role: 'hide' }, { role: 'quit' }] }] : []),
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { label: 'Show Greybeard', click: () => void openWindow() }, ...(process.platform !== 'darwin' ? [{ role: 'quit' }] : [])] }
    ]));
    const atLogin = app.isPackaged && process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin;
    if (!process.argv.includes('--background') && !atLogin) await openWindow();
    const { createMentorNotifications } = require('./mentoring.cjs');
    mentorNotifications = createMentorNotifications({ request, supported: () => Notification.isSupported(), notify: body => { const note = new Notification({ title: 'Greybeard', body }); note.on('click', () => void openWindow()); note.show(); } });
    mentorNotifications.start();
    // Windows needs a visible way to reopen a companion that keeps listening
    // after its window closes. macOS already exposes the app in the Dock.
    if (process.platform !== 'darwin') {
      const icon = nativeImage.createFromPath(app.isPackaged ? join(process.resourcesPath,'greybeard-tray.png') : join(root,'assets/logo/greybeard-light.png'));
      if (!icon.isEmpty()) { tray = new Tray(icon.resize({width:20,height:20})); tray.setToolTip('Greybeard'); tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Greybeard',click:()=>void openWindow()},{label:'Quit Greybeard',click:()=>app.quit()}])); tray.on('click',()=>void openWindow()); }
    }
    void updater.schedule();
    app.on('activate', () => void openWindow());
  }).catch(error => { dialog.showErrorBox('Cannot open Greybeard', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit(); });
  app.on('before-quit', () => { stopping = true; updater?.stop(); mentorNotifications?.stop(); tray?.destroy(); child?.kill(); });
}
