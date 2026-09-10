import { mkdtemp, mkdir, copyFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const temporary = await mkdtemp(join(tmpdir(), 'greybeard-executable-'));
try {
  const binary = join(temporary, process.platform === 'win32' ? 'greybeard.exe' : 'greybeard');
  await copyFile(resolve('dist/executable', `greybeard-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`), binary);
  const home = join(temporary, 'home');
  const data = join(temporary, 'data');
  await mkdir(home);
  const env = { PATH: '', HOME: home, USERPROFILE: home, GREYBEARD_HOME: home, GREYBEARD_APP_DATA: data, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, LOCALAPPDATA: home } : {}) };
  function run(args) {
    const result = spawnSync(binary, args, { cwd: temporary, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.error || result.stderr || result.stdout}`);
    return result.stdout;
  }
  assert.match(run(['--help']), /Greybeard/);
  run(['setup', '--yes']);
  run(['memory', 'list']);
  run(['setup', '--yes', '--app-data', './chosen-data']);
  const chosen = await readdir(join(temporary, 'chosen-data'));
  assert(chosen.includes('config.json') && chosen.includes('memory.db') && chosen.includes('runtime') && chosen.includes('sessions'), 'Explicit --app-data binds memory, assets and session locks together');
  const files = await readdir(data, { recursive: true });
  assert(files.some(name => String(name).endsWith('.db')), 'SQLite database created');
  const config = JSON.parse(await readFile(join(data, 'config.json'), 'utf8'));
  assert.notEqual(config.credentialMode, "writes");
  assert.equal(config.mcpServers["greybeard-graph"], false);
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(binary, ['mcp', 'memory'], { cwd: temporary, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`MCP timeout: ${errors}`)); }, 15_000);
    child.on('error', reject);
    child.stderr.on('data', chunk => errors += chunk);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('"serverInfo"')) { clearTimeout(timer); child.stdin.end(); child.kill(); resolveResult(output); }
    });
    child.on('exit', code => { if (!output.includes('"serverInfo"')) { clearTimeout(timer); reject(new Error(`MCP exited ${code}: ${errors}`)); } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'executable-smoke', version: '0.1' } } }) + '\n');
  });
  assert.match(result, /serverInfo/);
  console.log('Executable smoke passed: isolated copy, empty PATH, help, mentor-only setup, SQLite, memory MCP initialize.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
