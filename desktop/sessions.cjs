const { readdir, readFile } = require('node:fs/promises');
const { join } = require('node:path');
exports.requireIdleClients = async function(appData, servicePid) {
  const directory = join(appData, 'sessions');
  const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    let session;
    try { session = JSON.parse(await readFile(join(directory, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw new Error('Cannot check active Greybeard clients. Restart the app before updating.'); }
    if (!Number.isSafeInteger(session.pid) || session.pid < 1) throw new Error('Cannot verify a Greybeard session. Close AI clients and restart Greybeard.');
    if (session.pid === servicePid) continue;
    try { process.kill(session.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') continue; }
    throw new Error('An AI client or Greybeard CLI is still using the runtime. Close it before restarting to install the update.');
  }
};
