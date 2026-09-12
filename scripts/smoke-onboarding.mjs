import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const home = await mkdtemp(join(tmpdir(), 'greybeard-first-run-'));
const data = join(home, 'data');
const report = process.env.GREYBEARD_UI_REPORT_DIR;
const env = { ...process.env, GREYBEARD_HOME: home, GREYBEARD_APP_DATA: data, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'), GREYBEARD_CLAUDE_BINARY: join(home, 'claude'), GREYBEARD_CODEX_BINARY: join(home, 'codex') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  // Existing skill conflict is intentional: setup must retain it and report it.
  const conflict = join(home, '.agents/skills/change-plan');
  await mkdir(conflict, { recursive: true });
  await writeFile(join(conflict, 'SKILL.md'), 'This skill belongs to the user.');
  app = await electron.launch({ args: [resolve('desktop')], env });
  const window = await app.firstWindow();
  const errors = []; window.on('pageerror', e => errors.push(e.message));
  await expect(window.locator('#onboarding')).toBeVisible();
  await expect(window.locator('#workspace')).toBeHidden();
  await expect(window.locator('#setup-tools .tool-card')).toHaveCount(6);
  await expect(window.locator('#setup-tools')).toContainText('Claude Code');
  await expect(window.locator('#setup-tools')).toContainText('Codex CLI');
  const detected = window.locator('#setup-tools input:not(:disabled)');
  for (const input of await detected.all()) await input.setChecked(['Claude Code', 'Codex CLI'].includes(await input.inputValue()));
  await expect(window.locator('#enable-learning')).toHaveText('Enable learning in 2 tools');
  if (report) { await mkdir(report, { recursive: true }); await window.screenshot({ animations: 'disabled', path: join(report, 'companion-first-run.png') }); }
  await window.locator('#enable-learning').click();
  await expect(window.locator('#finish-title')).toHaveText('Let’s finish connecting your tools.');
  await expect(window.locator('#finish-setup')).toBeHidden();
  await expect(window.locator('#setup-results')).toContainText('Codex CLI · Needs attention');
  await expect(window.locator('#setup-results')).toContainText('Claude Code · Configuration checked');
  expect(await readFile(join(conflict, 'SKILL.md'), 'utf8')).toContain('belongs to the user');
  expect(JSON.parse(await readFile(join(data, 'config.json'), 'utf8')).companionSetupCompleted).not.toBe(true);
  await rm(conflict, { recursive: true });
  await window.locator('#retry-setup').click();
  await window.locator('#enable-learning').click();
  await expect(window.locator('#finish-title')).toHaveText('Your tools are set up.');
  await expect(window.locator('#first-conversation')).toBeVisible();
  // Test the native clipboard bridge without changing the user's actual clipboard.
  await app.evaluate(({ clipboard }) => { clipboard.writeText = text => { globalThis.copiedStarterPrompt = text; }; });
  await window.locator('#copy-setup-prompt').click();
  expect(await app.evaluate(() => globalThis.copiedStarterPrompt)).toContain('review and confirm the exact wording');
  await window.locator('#finish-setup').click();
  await expect(window.locator('#workspace')).toBeVisible();
  await expect(window.locator('#memory-count')).toHaveText('0');
  await expect(window.locator('#connection-summary')).toContainText('configured');
  await window.getByRole('button', { name: 'AI tools', exact: true }).click();
  await expect(window.locator('#clients')).toContainText('Configured');
  if (report) await window.screenshot({ animations: 'disabled', path: join(report, 'companion-ai-tools.png') });
  await app.close(); app = undefined;
  app = await electron.launch({ args: [resolve('desktop')], env });
  const reopened = await app.firstWindow();
  await expect(reopened.locator('#workspace')).toBeVisible();
  await expect(reopened.locator('#onboarding')).toBeHidden();
  expect(errors).toEqual([]);
  console.log('Actual first-run flow passed: discovery, selection, partial failure, preserved user skill, retry, verified configuration, prompt copy, workspace and returning launch.');
} finally { if (app) await app.close(); await rm(home, { recursive: true, force: true }); }
