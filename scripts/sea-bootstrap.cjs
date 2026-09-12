// Native addons must materialize on disk. Never trust a previously extracted copy.
const gbFs = require('node:fs');
const gbPath = require('node:path');
const gbCrypto = require('node:crypto');
const gbSea = require('node:sea');
const gbIndex = JSON.parse(gbSea.getAsset('asset-index.json', 'utf8'));
const gbHome = process.env.GREYBEARD_HOME || require('node:os').homedir();
// Match CLI flag precedence before any runtime assets or update locks are opened.
let gbExplicitData;
for (let gbArg = 2; gbArg < process.argv.length; gbArg += 1) {
  if (process.argv[gbArg].startsWith('--app-data=')) gbExplicitData = process.argv[gbArg].slice('--app-data='.length);
  else if (process.argv[gbArg] === '--app-data') {
    if (!process.argv[gbArg + 1] || process.argv[gbArg + 1].startsWith('--')) throw new Error('--app-data requires a directory');
    gbExplicitData = process.argv[++gbArg];
  }
}
const gbData = gbPath.resolve(gbExplicitData || process.env.GREYBEARD_APP_DATA || (process.platform === 'win32'
  ? gbPath.join(process.env.APPDATA || gbPath.join(gbHome, 'AppData', 'Roaming'), 'greybeard')
  : process.platform === 'darwin' ? gbPath.join(gbHome, 'Library', 'Application Support', 'greybeard')
  : gbPath.join(process.env.XDG_DATA_HOME || gbPath.join(gbHome, '.local', 'share'), 'greybeard')));
const gbAssetRoot = gbPath.join(gbData, 'runtime', gbIndex.id);
gbFs.mkdirSync(gbData, { recursive: true, mode: 0o700 });
function gbEnsureDirectory(gbDirectory) {
  try { gbFs.mkdirSync(gbDirectory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = gbFs.lstatSync(gbDirectory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe Greybeard runtime directory');
  if (process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || info.uid !== process.getuid())) throw new Error('Greybeard runtime directory must be private to its owner');
}
gbEnsureDirectory(gbData);
gbEnsureDirectory(gbPath.join(gbData, 'runtime'));
gbEnsureDirectory(gbAssetRoot);
for (const [gbName, gbHash] of Object.entries(gbIndex.hashes)) {
  const gbTarget = gbPath.join(gbAssetRoot, gbName);
  let gbParent = gbAssetRoot;
  for (const part of gbName.split('/').slice(0, -1)) { gbParent = gbPath.join(gbParent, part); gbEnsureDirectory(gbParent); }
  let gbValid = false;
  try { gbValid = gbFs.lstatSync(gbTarget).isFile() && gbCrypto.createHash('sha256').update(gbFs.readFileSync(gbTarget)).digest('hex') === gbHash; } catch {}
  if (!gbValid) {
    const gbTemp = `${gbTarget}.${process.pid}.tmp`;
    gbFs.writeFileSync(gbTemp, Buffer.from(gbSea.getAsset(gbName)), { mode: 0o600, flag: 'wx' });
    gbFs.renameSync(gbTemp, gbTarget);
  }
}
process.env.GREYBEARD_PACKAGED = '1';
process.env.GREYBEARD_ASSET_ROOT = gbAssetRoot;
process.env.GREYBEARD_APP_DATA = gbData;
const gbNative = { exports: {} };
process.dlopen(gbNative, gbPath.join(gbAssetRoot, 'native/better_sqlite3.node'));
globalThis.__greybeardSqliteAddon = gbNative.exports;

const gbModuleUrl = require("node:url").pathToFileURL(process.execPath).href;
// Register this running executable before starting a client session. Activation
// uses the same short lock, preventing new MCP sessions during replacement.
const gbSessions = gbPath.join(gbData, 'sessions');
gbEnsureDirectory(gbSessions);
const gbSession = gbPath.join(gbSessions, `${process.pid}.json`);
const gbStartupLock = gbPath.join(gbData, 'runtime-lock');
function gbReleaseSession() { try { gbFs.unlinkSync(gbSession); } catch {} }
if (process.env.GREYBEARD_UPDATE_PROBE !== '1') {
  try { gbFs.mkdirSync(gbStartupLock, { mode: 0o700 }); }
  catch {
    const gbLockInfo = gbFs.lstatSync(gbStartupLock);
    if (!gbLockInfo.isDirectory() || gbLockInfo.isSymbolicLink()) throw new Error('Unsafe runtime lock');
    let gbDead = false;
    try {
      const gbOwner = Number(gbFs.readFileSync(gbPath.join(gbStartupLock, 'owner'), 'utf8'));
      if (Number.isSafeInteger(gbOwner) && gbOwner > 0) { try {process.kill(gbOwner, 0);} catch(error){gbDead = error.code === 'ESRCH';} }
    } catch(error) { gbDead = error.code === 'ENOENT' && Date.now() - gbLockInfo.mtimeMs > 30000; }
    if (!gbDead) throw new Error('Greybeard activation is in progress. Retry after activation completes.');
    try {gbFs.unlinkSync(gbPath.join(gbStartupLock, 'owner'));} catch {}
    gbFs.rmdirSync(gbStartupLock);
    gbFs.mkdirSync(gbStartupLock, { mode: 0o700 });
  }
  gbFs.writeFileSync(gbPath.join(gbStartupLock, 'owner'), String(process.pid), {mode: 0o600, flag: 'wx'});
  try { gbReleaseSession(); gbFs.writeFileSync(gbSession, JSON.stringify({ pid: process.pid, executable: process.execPath }), { mode: 0o600, flag: 'wx' }); }
  finally { gbFs.unlinkSync(gbPath.join(gbStartupLock, 'owner')); gbFs.rmdirSync(gbStartupLock); }
  process.once('exit', gbReleaseSession);
}
