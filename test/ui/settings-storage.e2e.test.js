// Browser check of 设置 → 素材存储 (the maintainer's request of 2026-10-17; opt-in, ~10 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/settings-storage.e2e.test.js
//
// The title screen's settings modal has a 素材存储 section (ui/settings.js StorageSection). http://127.0.0.1 is a secure
// context, so its line says whether the browser keeps this site's storage and its button asks again. Chrome's answer
// follows its persistent-storage permission, set here per browser context: granted → 已持久保存 with the button off;
// denied → 未持久保存, and asking shows the refusal with the button still on. No console / page errors.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const KEPT = '已持久保存：存储空间不足时，浏览器不会自动清掉导入的素材。';
const NOT_KEPT = '未持久保存：存储空间不足时，浏览器可能清掉导入的素材。';
const REFUSED = /^浏览器没有同意。/;

describe('设置 → 素材存储', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** The title screen's settings, in a fresh context whose persistent-storage permission is `granted` or denied. */
  const openSettings = async (t, granted) => {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    await context.overridePermissions(base, granted ? ['persistent-storage'] : []);
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.setViewport({ width: 1600, height: 900 });
    await page.goto(`${base}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.title-settings', { timeout: 15000 });
    await page.click('.title-settings');
    await page.waitForSelector('[data-testid="storage-note"]', { timeout: 5000 });
    return { page, problems };
  };
  const view = (page) => page.evaluate(() => {
    const btn = document.querySelector('[data-testid="storage-persist"]');
    return { note: document.querySelector('[data-testid="storage-note"]')?.textContent.trim() ?? null,
      label: btn?.textContent.trim() ?? null, disabled: btn ? btn.disabled : null };
  });

  test('granted: the line says the assets are kept and the button is off', async (t) => {
    const { page, problems } = await openSettings(t, true);
    let now = await view(page);
    if (now.note === NOT_KEPT) {
      // a browser that reports the bucket rather than the permission turns persistent on the first ask
      await page.click('[data-testid="storage-persist"]');
      await page.waitForFunction((text) => document.querySelector('[data-testid="storage-note"]')?.textContent.trim() === text, { timeout: 5000 }, KEPT);
      now = await view(page);
    }
    assert.deepEqual(now, { note: KEPT, label: '已持久保存', disabled: true });
    assert.deepEqual(problems, []);
  });

  test('denied: not kept until asked; asking shows the refusal and the button stays on', async (t) => {
    const { page, problems } = await openSettings(t, false);
    assert.deepEqual(await view(page), { note: NOT_KEPT, label: '申请持久保存', disabled: false });
    await page.click('[data-testid="storage-persist"]');
    await page.waitForFunction(() => /^浏览器没有同意。/.test(document.querySelector('[data-testid="storage-note"]')?.textContent.trim() || ''), { timeout: 5000 });
    const after = await view(page);
    assert.match(after.note, REFUSED);
    assert.deepEqual({ label: after.label, disabled: after.disabled }, { label: '申请持久保存', disabled: false });
    assert.deepEqual(problems, []);
  });
});
