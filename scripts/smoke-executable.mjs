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
  function run(args, input) {
    const result = spawnSync(binary, args, { cwd: temporary, env, encoding: 'utf8', timeout: 30_000, input });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.error || result.stderr || result.stdout}`);
    return result.stdout;
  }
  assert.match(run(['--help']), /Greybeard/);
  run(['setup', '--yes']);
  run(['memory', 'list']);
  const eventArgs=['mentor','event','--host','codex','--event','prompt','--app-data',data];
  const advice=JSON.parse(run(eventArgs,JSON.stringify({session_id:'standalone-smoke',prompt:'We always require a recovery owner before production rollouts.'})));
  assert.match(advice.hookSpecificOutput.additionalContext,/already saved candidate/);
  assert.deepEqual(JSON.parse(run(eventArgs,'{invalid')),{});
  run(['memory','pause']);
  assert.deepEqual(JSON.parse(run(eventArgs,JSON.stringify({session_id:'paused-smoke',prompt:'Delete all production devices.'}))),{});
  run(['memory','resume']);
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
    let output = '', errors = '', initialized = false, failure;
    const timer = setTimeout(() => {
      failure = new Error(`MCP timeout: ${errors}`);
      child.kill('SIGKILL');
    }, 15_000);
    child.on('error', error => { failure = error; });
    child.stdin.on('error', error => { failure = error; });
    child.stderr.on('data', chunk => errors += chunk);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (!initialized && output.includes('"serverInfo"')) {
        initialized = true;
        child.stdin.end();
        child.kill();
      }
    });
    // Windows holds the .exe and native addon open until process termination.
    // Do not let the caller delete the temporary installation before close.
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (!initialized) reject(new Error(`MCP exited ${code}: ${errors}`));
      else resolveResult(output);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'executable-smoke', version: '0.1' } } }) + '\n');
  });
  assert.match(result, /serverInfo/);
  console.log('Executable smoke passed: isolated copy, empty PATH, help, mentor-only setup, SQLite, automatic proposal, malformed-event recovery, pause, memory MCP initialize.');
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
