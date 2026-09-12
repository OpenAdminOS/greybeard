import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { processMentorEvent } from '../cli/dist/automaticMentor.js';
import { MemoryService } from '../memory/dist/public.js';
const directory = await mkdtemp(join(tmpdir(), 'greybeard-companion-check-'));
const data = join(directory, 'data');
const launchEnv = { ...process.env }; delete launchEnv.ELECTRON_RUN_AS_NODE;
const report = process.env.GREYBEARD_UI_REPORT_DIR;
let app;
try {
  const service = new MemoryService({ appDataPath: data });
  for (let i = 0; i < 65; i++) {
    const node = await service.remember({ type: i % 2 ? 'preference' : 'decision', content: i === 0 ? 'Unique older memory: shared devices require helpdesk review.' : `Windows rollout lesson ${i}: document the assigned pilot group.`, source: 'companion-smoke' });
    if (i % 3) { const exact = (await service.export()).nodes.find(n => n.id === node.id); await service.confirm({ id: node.id, expectedRevision: exact.revision, confirmationChannel: 'local-ui' }); }
  }
  service.close();
  app = await electron.launch({ args: [resolve('desktop')], env: { ...launchEnv, GREYBEARD_HOME: directory, GREYBEARD_APP_DATA: data, ELECTRON_DISABLE_SECURITY_WARNINGS: '', NODE_ENV: 'test' } });
  const window = await app.firstWindow();
  const errors = []; window.on('pageerror', e => errors.push(e.message));
  // Hold the first scan response to reproduce a slow Windows startup. Navigation
  // must not be enabled until that response can no longer override the user's choice.
  await expect(window.locator('#setup-later')).toBeEnabled();
  const sessionToken=await window.evaluate('token');
  let releaseInitialScan, initialScanCaptured=false;
  const scanGate=new Promise(resolve=>{releaseInitialScan=resolve;});
  let firstScan=true;
  await window.route('**/state',async route=>{
    if(!firstScan){await route.continue();return;}
    firstScan=false;const response=await route.fetch();initialScanCaptured=true;
    await scanGate;await route.fulfill({response});
  });
  try {
    await window.goto(new URL('?slow-initial-scan=1#'+sessionToken,window.url()).href);
    await expect.poll(()=>initialScanCaptured,{timeout:10000,message:'The reloaded window must request its initial state'}).toBe(true);
    await expect(window.locator('#setup-later')).toBeDisabled();
  }
  finally {releaseInitialScan();}
  await expect(window.locator('#setup-later')).toBeEnabled();
  await window.unroute('**/state');

  await expect(window.locator('#onboarding')).toBeVisible();
  await window.locator('#setup-later').click();
  await expect(window.locator('#workspace')).toBeVisible();
  await expect(window.locator('#memory-count')).toHaveText('65');
  expect(await window.evaluate(() => typeof window.require)).toBe('undefined');
  expect(await window.evaluate(() => typeof window.greybeardDesktop.exportMemory)).toBe('function');
  await window.getByRole('button', { name: 'Your memory', exact: true }).click();
  await expect(window.locator('#memory-list article')).toHaveCount(50);
  await window.locator('#search').fill('Unique older');
  await expect(window.locator('#memory-list article')).toHaveCount(1);
  await expect(window.locator('#memory-list')).toContainText('shared devices require helpdesk review');
  await window.locator('#search').fill('');
  await expect(window.locator('#memory-list article')).toHaveCount(50);
  await window.locator('#more-memory').click();
  await expect(window.locator('#memory-list article')).toHaveCount(65);
  await window.locator('#add-memory').click();
  await window.locator('#edit-content').fill('<img src=x onerror=alert(1)> Shared kiosk rollout requires 48 hours of observation and helpdesk review.');
  await window.locator('#save-memory').click();
  await expect(window.locator('#status')).toContainText('Proposal saved');
  const first = window.locator('#memory-list article').first();
  await expect(first).toContainText('<img src=x onerror=alert(1)>');
  expect(await first.locator('img').count()).toBe(0);
  await first.getByRole('button', { name: 'Review & confirm' }).click();
  await expect(window.locator('#review-content')).toContainText('helpdesk review');
  await window.locator('#confirm-review').click();
  await expect(first).toContainText('Confirmed');
  await first.getByRole('button', { name: 'Correct', exact: true }).click();
  await window.locator('#edit-content').fill('Shared kiosk rollout requires 72 hours of observation and helpdesk review.');
  await window.locator('#save-memory').click();
  await expect(window.locator('#status')).toContainText('old text stays active');
  await window.locator('#memory-list article').first().getByRole('button', { name: 'Review & confirm' }).click();
  await window.locator('#confirm-review').click();
  await expect(window.locator('#memory-list article').nth(1)).toContainText('Superseded');
  await window.locator('#memory-list article').first().getByRole('button', { name: 'Forget', exact: true }).click();
  await window.locator('#confirm-review').click();
  await expect(window.locator('#status')).toContainText('forgotten');
  await window.locator('#add-outcome').click();
  await window.locator('#edit-content').fill('Ask the helpdesk to review shared kiosk remediation before expanding the rollout.');
  await window.locator('#edit-outcome').fill('The first pilot exposed a shared sign-in remediation problem.');
  await window.locator('#save-memory').click();
  await expect(window.locator('#memory-list article').first()).toContainText('Needs review');
  const exportPath = join(directory, 'exported-memory.json');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportPath);
  await window.locator('#export-memory').click();
  await expect(window.locator('#status')).toContainText('Memory exported');
  const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  expect(exported.nodes.some(node => node.outcome?.includes('shared sign-in'))).toBe(true);
  await window.locator('#pause').click();
  await expect(window.locator('#pause')).toHaveText('Resume learning and advice');
  await window.locator('#pause').click();
  await window.getByRole('button', { name: 'App preferences', exact: true }).click();
  await window.locator('#updates').selectOption('manual');
  await window.locator('#save-settings').click();
  await expect(window.locator('#status')).toContainText('saved');
  await window.locator('#check-update').click();
  await expect(window.locator('#update-status')).toContainText('installed build');
  await window.getByRole('button', { name: 'Advice & activity', exact: true }).click();
  await expect(window.locator('#metrics .panel')).toHaveCount(4);
  await processMentorEvent({appData:data,profile:'local',tenant:'local',host:'codex',kind:'prompt',input:{session_id:'native-smoke',prompt:'We always require helpdesk review before a production rollout.'}});
  await window.locator('#refresh-mentoring').evaluate(button => button.click());
  await expect(window.locator('#automatic-events')).toContainText('Proposed lesson');
  await expect(window.locator('#automatic-events')).toContainText('codex');

  await window.getByRole('button', { name: 'Infrastructure', exact: true }).click();
  await window.locator('#check-capabilities').click();
  await expect(window.locator('#capability-results')).toContainText('not-selected');
  await window.getByRole('button', { name: 'Your memory', exact: true }).click();
  if (report) { await mkdir(report, { recursive: true }); await window.screenshot({ animations: 'disabled', path: join(report, 'companion-memory.png') }); }
  // Window closure must reopen cleanly from the Dock on Mac. Other platforms quit;
  // relaunch uses the same store and verifies persistence of settings and lessons.
  await app.close(); app = undefined;
  app = await electron.launch({ args: [resolve('desktop')], env: { ...launchEnv, GREYBEARD_HOME: directory, GREYBEARD_APP_DATA: data } });
  const reopened = await app.firstWindow();
  await expect(reopened.locator('#memory-count')).not.toHaveText('…');
  await reopened.getByRole('button', { name: 'App preferences', exact: true }).click();
  await expect(reopened.locator('#updates')).toHaveValue('manual');
  expect(errors).toEqual([]);
  console.log('Actual Electron companion passed: isolated 65-memory database, search across pages, exact confirmation, correction, forgetting, outcome proposal, pause/resume, settings persistence, capability preview, local activity, renderer isolation and reopen.');
} finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
