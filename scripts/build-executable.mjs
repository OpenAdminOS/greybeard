// Build on each target OS/architecture with the same Node used by npm ci.
import { build } from 'esbuild';
import { inject } from 'postject';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, copyFile, chmod } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist', 'executable');
await mkdir(out, { recursive: true });
const assets = {};
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) assets[relative(root, path).replaceAll('\\', '/')] = path;
  }
}
await collect(join(root, '.agents/skills'));
await collect(join(root, 'assets/logo'));
assets['native/better_sqlite3.node'] = join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node');
const hashes = {};
for (const [name, path] of Object.entries(assets)) hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
const assetId = createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
await writeFile(join(out, 'asset-index.json'), JSON.stringify({ id: assetId, hashes }));
assets['asset-index.json'] = join(out, 'asset-index.json');
const bootstrap = await readFile(join(root, 'scripts/sea-bootstrap.cjs'), 'utf8');
await build({
  stdin: { contents: 'import { runCli } from "./cli/src/index.ts"; import { activatePendingUpdate, scheduleUpdateChecks } from "./cli/src/update.ts"; import { createRuntime } from "./cli/src/runtime.ts"; async function main(){ let activated=false; try {activated=await activatePendingUpdate(createRuntime());} catch(error){console.error("Update activation deferred; current executable continues: " + error.message);} if(activated) {gbReleaseSession(); const result = require("node:child_process").spawnSync(process.execPath, process.argv.slice(2), {stdio:"inherit",env:process.env}); process.exitCode=result.status ?? 1;} else {scheduleUpdateChecks(createRuntime());process.exitCode=await runCli(process.argv.slice(2));} } main().catch(error => {console.error(error.message);process.exitCode=1;});', resolveDir: root },
  outfile: join(out, 'app.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  external: ['@azure/msal-node-extensions'],
  alias: { '@greybeard/graph': join(root, 'graph/src/public.ts'), '@greybeard/memory': join(root, 'memory/src/public.ts') },
  define: { 'import.meta.url': 'gbModuleUrl' },
  banner: { js: bootstrap },
  plugins: [{ name: 'embedded-sqlite', setup(b) {
    b.onLoad({ filter: /better-sqlite3[/\\]lib[/\\]database\.js$/ }, async args => ({
      contents: (await readFile(args.path, 'utf8')).replace("require('bindings')('better_sqlite3.node')", 'globalThis.__greybeardSqliteAddon'), loader: 'js'
    }));
  }}]
});
const config = { main: join(out, 'app.cjs'), output: join(out, 'app.blob'), disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets };
await writeFile(join(out, 'sea-config.json'), JSON.stringify(config));
execFileSync(process.execPath, ['--experimental-sea-config', join(out, 'sea-config.json')], { stdio: 'inherit' });
const binary = join(out, `greybeard-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`);
await copyFile(process.execPath, binary);
await chmod(binary, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', binary]);
await inject(binary, 'NODE_SEA_BLOB', await readFile(join(out, 'app.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {})
});
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', binary]);
const digest = createHash('sha256').update(await readFile(binary)).digest('hex');
await writeFile(`${binary}.sha256`, `${digest}  ${binary.split(/[\\/]/).pop()}\n`);
console.log(`Built ${binary}. Local artifact only; publisher signing and target validation are separate release requirements.`);
