const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStartupController } = require('./startup.cjs');
test('login startup is an explicit native preference and launches in the background', () => {
  let settings = { openAtLogin: false };
  const app = { isPackaged: true, getLoginItemSettings: () => settings, setLoginItemSettings: value => { settings = value; } };
  const control = createStartupController(app, 'darwin');
  assert.equal(control.status().enabled, false);
  assert.equal(control.set(true).enabled, true);
  assert.deepEqual(settings.args, ['--background']);
  assert.equal(control.set(false).enabled, false);
  assert.throws(() => control.set('true'));
  assert.throws(() => createStartupController(app, 'linux').set(true));
  assert.equal(createStartupController({ isPackaged: false }, 'win32').status().supported, false);
});
