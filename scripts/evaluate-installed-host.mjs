// Install the real host integration into a temporary home, never the user's home.
import { createRuntime } from '../cli/dist/runtime.js';
import { writeCodexMcpConfig, writeCodexSkillFallback, wireCodexSkills, writeClaudeMcpConfig, writeClaudeSkillFallback, wireClaudeSkills } from '../cli/dist/clients.js';
import { SERVER_CATALOG } from '../cli/dist/serverCatalog.js';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
const [home, app, client = 'codex'] = process.argv.slice(2);
if (!home?.startsWith('/tmp/greybeard-evaluation-') || !app?.startsWith('/tmp/greybeard-evaluation-')) throw Error('Use isolated evaluation paths.');
const runtime = createRuntime();
runtime.homeDir = home;
runtime.env = {...runtime.env, CODEX_HOME:join(home,'.codex'), ...(client === 'claude' ? {CLAUDE_CONFIG_DIR:join(home,'.claude')} : {}), GREYBEARD_APP_DATA:app,GREYBEARD_PROFILE_ID:'profile-a',GREYBEARD_TENANT_ID:'synthetic-lab'};
const options = {serverToggles:Object.fromEntries(SERVER_CATALOG.map(s=>[s.name,s.name==='greybeard-memory']))};
if (client === 'claude') {
  await writeClaudeMcpConfig(runtime, options);
  await writeClaudeSkillFallback(runtime);
  await wireClaudeSkills(runtime);
  process.exit(0);
}
await writeCodexMcpConfig(runtime, options);
await writeCodexSkillFallback(runtime);
await wireCodexSkills(runtime);
// Only synthetic read tools exposed during model evaluation. The installed
// instructions and discovery paths are unchanged; no recall instruction in prompt.
await appendFile(join(home,'.codex','config.toml'), '\n[mcp_servers.greybeard-memory.tools.recall]\napproval_mode="approve"\n[mcp_servers.greybeard-memory.tools.discover_scopes]\napproval_mode="approve"\n');
