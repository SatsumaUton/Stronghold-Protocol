// Real App integration (not the GameScreen-only mock mount). Only the Wake Lock API is stubbed;
// phase snapshots come from the existing mock server, and fullscreen uses Chrome's native API.
// SP_E2E=1 CHROME_PATH=… node --test test/ui/wake-lock.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const LABEL = '全屏时保持屏幕常亮';
const HINT = '开启后，全屏期间始终尝试保持屏幕常亮；战斗期间无需开启本设置，也会自动尝试保持亮屏。需要HTTPS和浏览器支持；iOS 低电量模式下可能不生效。';
const ROW = '.modal .set-row';
const clone = (value) => structuredClone(value);

describe('App screen wake lock', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv, browser, base, fixtures;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !!globalThis.__MOCK__);
      fixtures = await page.evaluate(() => {
        const out = {};
        for (const phase of ['INFO_CHECK', 'BAND_DRAFT', 'SP_DRAFT', 'PREP', 'ROUND_START', 'COMBAT', 'UNITE', 'FINAL_ASSAULT', 'HIDDEN_CORE', 'SETTLE', 'RESULT']) {
          globalThis.__MOCK__.setPhase(phase);
          const { me, session, room, match } = globalThis.__MOCK__.store.get();
          out[phase] = JSON.parse(JSON.stringify({ me, session, room, match }));
        }
        return out;
      });
    } finally { await page.close(); }
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open(t, preference = {}) {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.evaluateOnNewDocument((pref) => {
      if (localStorage.getItem('sp.pref.settings') === null) localStorage.setItem('sp.pref.settings', JSON.stringify(pref));
      const calls = globalThis.__WAKE_LOCK__ = { requests: [], releases: 0 };
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { async request(type) {
        calls.requests.push(type);
        return { async release() { calls.releases++; } };
      } } });
    }, preference);
    await page.goto(`${base}/?render=fallback`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.title-screen'));
    await page.evaluate(async () => {
      // Stop the real socket before applying deterministic snapshots; no server push may replace them.
      globalThis.__SP__.net.close();
      const { GAME_FILES } = await import('/js/ui/gameComponents.js');
      await globalThis.__SP__.data.loadAll(GAME_FILES);
    });
    t.after(() => assert.deepEqual(errors, [], 'real App has no JavaScript exceptions'));
    return page;
  }
  const counts = (page) => page.evaluate(() => [globalThis.__WAKE_LOCK__.requests.length, globalThis.__WAKE_LOCK__.releases]);
  async function expectCounts(page, expected, why) {
    // Flush the actual Preact effect even for transitions that must not call the API.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));
    assert.deepEqual(await counts(page), expected, why);
  }
  async function state(page, snapshot, selector) {
    await page.evaluate((s) => globalThis.__SP__.store.set(s), snapshot);
    await page.waitForSelector(selector);
  }
  function outside(route) {
    const s = clone(fixtures.PREP);
    s.session.entered = route !== 'title';
    s.match = { public: null, private: null, field: null, result: null, battle: null };
    s.room = route === 'room' ? { ...s.room, inMatch: false } : null;
    return s;
  }
  async function settings(page) {
    await page.click('.title-settings, .gm__gear');
    await page.waitForSelector('.modal');
  }
  async function toggle(page, on) {
    const handle = await page.evaluateHandle((sel) => [...document.querySelectorAll(sel)]
      .find((row) => row.textContent.includes('SCREEN WAKE LOCK'))?.querySelector('[role="switch"]'), ROW);
    const button = handle.asElement();
    assert.ok(button, 'the real settings modal exposes the switch');
    if (await button.evaluate((el) => el.getAttribute('aria-checked')) !== String(on)) await button.click();
    await page.waitForFunction((value) => [...document.querySelectorAll('.modal .set-row')]
      .find((row) => row.textContent.includes('SCREEN WAKE LOCK'))?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === String(value), {}, on);
    await handle.dispose();
  }
  async function preference(page, on) {
    await settings(page);
    await toggle(page, on);
    assert.deepEqual(await page.evaluate(async () => {
      const { settingsStore } = await import('/js/ui/settings.js');
      return [settingsStore.get().fullscreenWakeLock, JSON.parse(localStorage.getItem('sp.pref.settings')).fullscreenWakeLock];
    }), [on, on], 'the real switch updates the subscribed store and persisted preference');
    await page.click('.modal__actions .btn--primary');
    await page.waitForSelector('.modal', { hidden: true });
  }
  async function fullscreen(page, on) {
    await page.click('button.fsbtn[aria-pressed]');
    await page.waitForFunction((value) => !!document.fullscreenElement === value, {}, on);
    await page.waitForSelector(`.fsbtn[aria-pressed="${on}"]`);
  }

  test('all eight states share one lock across combat/fullscreen handoffs and every App route', async (t) => {
    const page = await open(t);
    // Gray-code order changes one cause at a time. Neither settings nor route changes remount App's lock.
    await expectCounts(page, [0, 0], 'setting off, windowed, noncombat');
    await fullscreen(page, true);
    await expectCounts(page, [0, 0], 'setting off, fullscreen, noncombat');
    await preference(page, true);
    await expectCounts(page, [1, 0], 'setting on, fullscreen, noncombat');
    await preference(page, false);
    await expectCounts(page, [1, 1], 'disabling during fullscreen outside combat releases immediately');
    await preference(page, true);
    await expectCounts(page, [2, 1], 're-enabling during fullscreen outside combat acquires immediately');
    await state(page, fixtures.COMBAT, '.gm');
    await expectCounts(page, [2, 1], 'setting on, fullscreen, combat');
    await preference(page, false);
    await expectCounts(page, [2, 1], 'setting off, fullscreen, combat');
    await fullscreen(page, false);
    await expectCounts(page, [2, 1], 'setting off, windowed, combat');
    await preference(page, true);
    await expectCounts(page, [2, 1], 'setting on, windowed, combat');
    await state(page, fixtures.PREP, '.gm');
    await expectCounts(page, [2, 2], 'setting on, windowed, noncombat');

    await fullscreen(page, true);
    await expectCounts(page, [3, 2], 'fullscreen reacquires once');
    await state(page, fixtures.COMBAT, '.gm');
    for (const [snapshot, selector] of [
      [outside('title'), '.title-screen'], [outside('lobby'), '.lobby-screen'], [outside('room'), '.room-screen'],
      [fixtures.INFO_CHECK, '.brief'], [fixtures.BAND_DRAFT, '.draft'], [fixtures.PREP, '.gm'],
      [fixtures.COMBAT, '.gm'], [fixtures.SETTLE, '.gm'], [fixtures.RESULT, '.settle'],
    ]) {
      await state(page, snapshot, selector);
      await expectCounts(page, [3, 2], `${selector} keeps the same fullscreen lock`);
    }
    await state(page, outside('title'), '.title-screen');
    await fullscreen(page, false);
    await expectCounts(page, [3, 3], 'leaving fullscreen outside combat releases once');
    assert.deepEqual(await page.evaluate(() => globalThis.__WAKE_LOCK__.requests), ['screen', 'screen', 'screen']);
  });

  test('automatic combat requires an entered, active match; all four combat phases include spectators', async (t) => {
    const page = await open(t);
    for (const [phase, selector] of [['INFO_CHECK', '.brief'], ['BAND_DRAFT', '.draft'], ['SP_DRAFT', '.gm'],
      ['PREP', '.gm'], ['ROUND_START', '.gm'], ['SETTLE', '.gm'], ['RESULT', '.settle']]) {
      await state(page, fixtures[phase], selector);
      await expectCounts(page, [0, 0], `${phase} is not combat`);
    }
    for (const [name, edit, selector] of [
      ['title with stale combat', (s) => { s.session.entered = false; }, '.title-screen'],
      ['orphan combat without room', (s) => { s.room = null; }, '.gm'],
      ['room outside match', (s) => { s.room.inMatch = false; }, '.gm'],
      ['result with stale combat phase', (s) => { s.match.result = clone(fixtures.RESULT.match.result); }, '.settle'],
    ]) {
      const s = clone(fixtures.COMBAT); edit(s);
      await state(page, s, selector);
      await expectCounts(page, [0, 0], name);
    }
    for (const [i, phase] of ['COMBAT', 'UNITE', 'FINAL_ASSAULT', 'HIDDEN_CORE'].entries()) {
      const s = clone(fixtures[phase]);
      s.me.playerId = 'spectator'; s.me.name = 'Spectator';
      s.room.spectators = [{ playerId: 'spectator', name: 'Spectator', connected: true }];
      s.match.private = null;
      await state(page, s, '.gm');
      await expectCounts(page, [i + 1, i], `${phase}: spectators acquire with the preference off`);
      await state(page, fixtures.PREP, '.gm');
      await expectCounts(page, [i + 1, i + 1], `${phase}: prep releases`);
    }
  });

  test('default and legacy preferences stay off; the real settings UI persists the new key in five languages', async (t) => {
    const page = await open(t, { screenWakeLock: true });
    await settings(page);
    const switchValue = () => page.evaluate(() => [...document.querySelectorAll('.modal .set-row')]
      .find((row) => row.textContent.includes('SCREEN WAKE LOCK'))?.querySelector('[role="switch"]')?.getAttribute('aria-checked'));
    assert.equal(await switchValue(), 'false', 'the initially rendered switch is off before any interaction');
    assert.equal(await page.evaluate(async () => (await import('/js/ui/settings.js')).settingsStore.get().fullscreenWakeLock), false);
    const out = path.join(ROOT, 'test/e2e/out');
    mkdirSync(out, { recursive: true });
    for (const lang of ['zh', 'en', 'ja', 'ko', 'zh-TW']) {
      await page.select('.modal [data-testid="lang-toggle"] select', lang);
      const pack = lang === 'zh' ? null : JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
      const label = pack?.[LABEL] || LABEL, hint = pack?.[HINT] || HINT;
      await page.waitForFunction((text) => [...document.querySelectorAll('.modal .set-row__label')].some((el) => el.firstChild?.textContent === text), {}, label);
      assert.ok(await page.evaluate((text) => [...document.querySelectorAll('.modal .set-hint')].some((el) => el.textContent === text), hint), `${lang} shows the translated explanation`);
      assert.equal(await switchValue(), 'false', `${lang} keeps the switch off`);
      const row = await page.evaluateHandle(() => [...document.querySelectorAll('.modal .set-row')].find((el) => el.textContent.includes('SCREEN WAKE LOCK')));
      await row.asElement().scrollIntoView();
      await page.evaluate(() => Promise.all(document.querySelector('.modal').getAnimations({ subtree: true })
        .filter((animation) => Number.isFinite(animation.effect.getTiming().iterations))
        .map((animation) => animation.finished.catch(() => {}))));
      await page.screenshot({ path: path.join(out, `wake-lock-settings-${lang}.png`) });
      await row.dispose();
    }
    await toggle(page, true);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!globalThis.__SP__);
    assert.deepEqual(await page.evaluate(async () => {
      globalThis.__SP__.net.close();
      const { settingsStore } = await import('/js/ui/settings.js');
      return [settingsStore.get().fullscreenWakeLock, JSON.parse(localStorage.getItem('sp.pref.settings')).fullscreenWakeLock];
    }), [true, true], 'new preference survives a real reload');
    await expectCounts(page, [0, 0], 'enabled but windowed outside combat does not acquire');
    for (const legacy of [false, true]) {
      await page.evaluateOnNewDocument((value) => localStorage.setItem('sp.pref.settings', JSON.stringify({ screenWakeLock: value })), legacy);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !!globalThis.__SP__);
      assert.equal(await page.evaluate(async () => {
        globalThis.__SP__.net.close();
        return (await import('/js/ui/settings.js')).settingsStore.get().fullscreenWakeLock;
      }), false, `legacy screenWakeLock=${legacy} is not migrated`);
    }
  });

  test('real tab visibility releases and restores combat; inactive foreground does not acquire', async (t) => {
    const page = await open(t);
    await state(page, fixtures.COMBAT, '.gm');
    await expectCounts(page, [1, 0], 'combat acquires');
    const cover = await page.browserContext().newPage();
    await cover.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'hidden' && globalThis.__WAKE_LOCK__.releases === 1, { polling: 50 });
    assert.deepEqual(await counts(page), [1, 1], 'backgrounding releases without requesting while hidden');
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible' && globalThis.__WAKE_LOCK__.requests.length === 2);
    await expectCounts(page, [2, 1], 'foreground restores active combat');
    await state(page, fixtures.PREP, '.gm');
    await expectCounts(page, [2, 2], 'prep releases');
    await cover.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'hidden', { polling: 50 });
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible');
    await expectCounts(page, [2, 2], 'foreground outside combat with preference off stays inactive');
  });

  test('webkit-only fullscreen events reach the same global controller', async (t) => {
    const page = await open(t, { fullscreenWakeLock: true });
    // Explicit legacy-API simulation: Chrome's native standard path is covered above.
    await page.evaluate(() => {
      globalThis.__WEBKIT_FS__ = false;
      Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => globalThis.__WEBKIT_FS__ ? document.documentElement : null });
      globalThis.__WEBKIT_FS__ = true;
      document.dispatchEvent(new Event('webkitfullscreenchange'));
    });
    await expectCounts(page, [1, 0], 'prefixed enter acquires');
    await page.evaluate(() => { globalThis.__WEBKIT_FS__ = false; document.dispatchEvent(new Event('webkitfullscreenchange')); });
    await expectCounts(page, [1, 1], 'prefixed exit releases');
  });
});
