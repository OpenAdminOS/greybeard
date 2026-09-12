// Render installer UI artwork. The approved logo is used directly by the packager.
import { chromium } from 'playwright';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = resolve(import.meta.dirname, '../../assets/installer');
const browser = await chromium.launch();
try {
  for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: scale });
    try {
      const page = await context.newPage();
      await page.goto(pathToFileURL(join(directory, 'mac-background.svg')).href);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(directory, `mac-background${scale === 2 ? '@2x' : ''}.png`) });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
