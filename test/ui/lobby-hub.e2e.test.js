// Browser E2E of the hub lobby (PR #643 split 6) against the real server, headless Chrome (puppeteer-core + system
// Chrome). Opt-in: SP_E2E=1 node --test test/ui/lobby-hub.e2e.test.js
//
// Desktop 1920×1080: the hub (title, 独立模拟 / 同盟模拟, the S.W.E.E.P. / 干员调配 plates, no top-bar 统计数据 chip) →
// 独立模拟 opens 选择模拟协议 (a Modal with the focus inside; a difficulty is remembered and redraws the picture) → Esc
// returns the focus to the entry → 同盟模拟 opens 选择同盟方式 with the key field focused (the project's TextField: a typed
// key is normalised and written back, a 5th character or a dash is dropped, a pasted invite link longer than 64
// characters still gives its key) → 创建同盟 creates the room at once at the remembered difficulty (the event's 联合模拟,
// the maintainer's decision of 2026-10-21) → in the room the host's difficulty pill opens 选择模拟协议 with 确认 (Esc
// changes nothing; a refused change keeps it open; 绝境 → 确认 changes the room), ⚙ 同盟设置 lists the 模拟难度 and the
// 「AI 队友最后选择」 switch. Phones 844×390 and 667×375 (touch): the hub (with the 成就统计 plate in place of the card),
// 选择模拟协议, 选择同盟方式 and the room's 选择模拟协议 stay inside the screen, their buttons in view without scrolling.
// The other doctors' read-only view: test/ui/room-settings.e2e.test.js.
// Every page must finish with zero console errors / page errors / failed requests. Screenshots: test/e2e/out/lobby-hub-*.png

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('hub lobby (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open({ w = 1920, h = 1080, touch = false } = {}) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.name', '大厅测试');
      sessionStorage.setItem('sp.entered', '1');
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen .hub-entries'), { timeout: 30000 });
    return { ctx, page, problems };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = async (page, sel, touch = false) => {
    await page.waitForSelector(sel, { visible: true, timeout: 10000 });
    if (touch) await page.tap(sel); else await page.click(sel);
  };
  const escape = async (page) => { await page.keyboard.press('Escape'); await sleep(150); };
  const diffCard = (page, name) => page.$$eval('.modal__box.proto .diff-card', (els, n) => {
    const i = els.findIndex((el) => el.textContent.includes(n));
    if (i >= 0) els[i].setAttribute('data-test-pick', '1');
    return i;
  }, name);
  /** Waits out the 转场 (tr-* / ps-*: panels slide in from off their place), not the looping scene motion. */
  const settle = (page) => page.waitForFunction(() => !document.getAnimations()
    .some((a) => /^(tr|ps)-/.test(String(a.animationName)) && a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity));
  /**
   * Elements of the screen (and an open dialog) that leave the viewport, and whether the dialog body scrolls. The backdrop
   * layers (.hub-bg, decorative, clipped by its overflow) and 选择模拟协议's scene (.ps, decorative: it reaches under the
   * cards like the event's) may run past the edges on purpose.
   */
  const fit = async (page) => { await settle(page); return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.lobby-screen *:not(.hub-bg *, .ps, .ps *), .modal__box *:not(.ps, .ps *)')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${el.className?.baseVal ?? el.className ?? el.tagName}`);
    }
    const bodies = [...document.querySelectorAll('.modal__body')];
    return { out: out.slice(0, 6), scrolls: bodies.some((b) => b.scrollHeight > b.clientHeight + 1) };
  }); };

  test('desktop: hub → 选择模拟协议 (remembered, Esc) → 选择同盟方式 (the key field) → 创建同盟: the room at once → the host changes the difficulty in the room', async () => {
    const { ctx, page, problems } = await open();
    try {
      const hub = await page.evaluate(() => ({
        title: document.querySelector('.hub-center__title')?.textContent,
        entries: [...document.querySelectorAll('.hub-entries .mode-card')].map((el) => el.dataset.mode),
        plates: ['.lobby-sweep', '.lobby-loadout'].map((s) => !!document.querySelector(`.hub-right ${s}`)),
        dialogs: document.querySelectorAll('.modal').length,
      }));
      assert.equal(hub.title, '卫戍协议：盟约');
      assert.equal(await page.$('.lobby-screen .topbar .stats-entry'), null, 'no top-bar 统计数据 chip: the 成就统计 card is the entry');
      assert.deepEqual(hub.entries, ['solo', 'coop']);
      assert.deepEqual(hub.plates, [true, true]);
      assert.equal(hub.dialogs, 0);
      assert.deepEqual((await fit(page)).out, [], 'the hub fits 1920×1080');
      await page.screenshot({ path: path.join(OUT, 'lobby-hub-desktop.png') });

      // 独立模拟 → 选择模拟协议
      await press(page, '.mode-card[data-mode="solo"]');
      await page.waitForSelector('.modal__box.proto', { visible: true });
      await sleep(200);
      let st = await page.evaluate(() => ({
        focusInside: !!document.activeElement?.closest('.modal__box.proto'),
        mode: document.querySelector('.proto__body')?.dataset.mode,
        selected: document.querySelector('.proto__body')?.dataset.difficulty,
        cards: document.querySelectorAll('.modal__box.proto .diff-card').length,
        start: document.querySelector('.proto .proto-start__label')?.textContent.trim(),
      }));
      assert.deepEqual(st, { focusInside: true, mode: 'solo', selected: 'FUNNY', cards: 4, start: '开始独立模拟' });
      assert.ok(await diffCard(page, '险境模拟') >= 0);
      await page.click('.diff-card[data-test-pick]');
      await page.waitForFunction(() => document.querySelector('.proto__body')?.dataset.difficulty === 'NORMAL');
      st = await page.evaluate(() => ({
        stored: localStorage.getItem('sp.pref.lobby.difficulty'),
        pic: document.querySelector('.proto__pic .ps image')?.getAttribute('href') || (document.querySelector('.proto__pic .ps') ? 'drawn' : null),
      }));
      assert.equal(st.stored, '"NORMAL"', 'the difficulty is remembered');
      assert.ok(st.pic === 'drawn' || /modeChoice\/normal_rhodes_island/.test(st.pic), st.pic);
      await page.screenshot({ path: path.join(OUT, 'lobby-hub-protocol.png') });
      await escape(page);
      await page.waitForSelector('.modal', { hidden: true });
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.mode), 'solo', 'the focus is back on the entry');

      // 同盟模拟 → 选择同盟方式: the key field focused (like the title's name field: not where a coarse pointer is reported —
      // some Windows hosts report one even to headless Chrome; there the focus is in the dialog and the field is clicked),
      // a pasted key normalised
      await press(page, '.mode-card[data-mode="coop"]');
      await page.waitForSelector('.modal__box.ally', { visible: true });
      const coarse = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches || matchMedia('(pointer: coarse)').matches);
      if (coarse) {
        await sleep(200);
        assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.modal__box.ally')), 'the focus is in 选择同盟方式');
        await page.click('.join-row input');
      } else {
        await page.waitForFunction(() => document.activeElement?.closest('.join-row') && document.activeElement.tagName === 'INPUT');
      }
      await page.keyboard.type('abcd');
      st = await page.evaluate(() => ({
        value: document.querySelector('.join-row input').value,
        join: ['.ally-card__bar--join', '.join-spectate'].map((q) => document.querySelector(q)).map((b) => [b.textContent.trim(), b.disabled]),
      }));
      assert.equal(st.value, 'ABCD');
      assert.deepEqual(st.join, [['加入同盟', false], ['观战', false]]);
      // the normalised key is written back: a 5th character or a dash never shows
      await page.keyboard.type('e-');
      assert.equal(await page.$eval('.join-row input', (el) => el.value), 'ABCD');
      // a pasted invite link longer than 64 characters still gives its key (the old maxlength cut it to "HTTP")
      const link = 'https://crops-flexible-wedding-trademarks.trycloudflare.com/?room=QWER';
      assert.ok(link.length > 64);
      await page.$eval('.join-row input', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, link);
      await page.waitForFunction(() => document.querySelector('.join-row input').value === 'QWER');
      st = await page.evaluate(() => ({
        create: document.querySelector('[data-testid="alliance-create"]')?.textContent.replace(/\s+/g, ' ').trim(),
        maxLength: document.querySelector('.join-row input').maxLength,
        label: document.querySelector('.join-row input').getAttribute('aria-label'),
      }));
      assert.ok(st.create.includes('难度：险境模拟（可在同盟内更改）'), st.create);
      assert.equal(st.maxLength, -1, 'no maxlength');
      assert.equal(st.label, '同盟密钥');
      await settle(page);
      await page.screenshot({ path: path.join(OUT, 'lobby-hub-alliance.png') });

      // 创建同盟 → the room at once, at the remembered difficulty (险境); no 选择模拟协议 on the way
      await press(page, '[data-testid="alliance-create"]');
      await page.waitForSelector('.room-screen', { timeout: 15000 });
      let room = await page.evaluate(() => { const r = globalThis.__SP__.store.get().room; return { mode: r?.mode, difficulty: r?.difficulty }; });
      assert.deepEqual(room, { mode: 'coop', difficulty: 'NORMAL' });
      assert.equal(await page.evaluate(() => document.querySelectorAll('.modal').length), 0, 'no dialog left over the room');

      // the host's pill → 选择模拟协议 with 确认 (the room's difficulty selected); Esc changes nothing
      await press(page, '.rs-pill__diff');
      await page.waitForSelector('.modal__box.proto', { visible: true });
      st = await page.evaluate(() => ({
        mode: document.querySelector('.proto__body')?.dataset.mode,
        selected: document.querySelector('.proto__body')?.dataset.difficulty,
        start: document.querySelector('.proto .proto-start__label')?.textContent.trim(),
        live: [...document.querySelectorAll('.modal__box.proto .diff-card')].every((b) => !b.disabled),
        test: !!document.querySelector('[data-testid="create-test"]'),
      }));
      assert.deepEqual(st, { mode: 'coop', selected: 'NORMAL', start: '确认', live: true, test: false });
      assert.ok(await diffCard(page, '终极模拟') >= 0);
      await page.click('.diff-card[data-test-pick]');
      await escape(page);
      await page.waitForSelector('.modal__box.proto', { hidden: true });
      assert.equal(await page.evaluate(() => globalThis.__SP__.store.get().room.difficulty), 'NORMAL', 'Esc sent nothing');

      // a refused change keeps the dialog open (with the error toast)
      await press(page, '.rs-pill__diff');
      await page.waitForSelector('.modal__box.proto', { visible: true });
      await page.evaluate(async () => {
        const { net } = await import('/js/net.js');
        const real = net.request.bind(net);
        net.request = (type, body) => {
          if (type !== 'room.setDifficulty') return real(type, body);
          net.request = real;
          return Promise.reject(Object.assign(new Error('refused'), { code: 'RATE' }));
        };
      });
      assert.ok(await diffCard(page, '绝境模拟') >= 0);
      await page.click('.diff-card[data-test-pick]');
      await page.click('.proto .proto-start');
      await page.waitForSelector('.toast', { visible: true, timeout: 5000 });
      await sleep(300);
      assert.ok(await page.$('.modal__box.proto'), 'still open after the refusal');
      assert.equal(await page.evaluate(() => globalThis.__SP__.store.get().room.difficulty), 'NORMAL');
      // 确认 again (the request goes through now): the room is at 绝境 and the dialog closes
      await page.click('.proto .proto-start');
      await page.waitForFunction(() => globalThis.__SP__.store.get().room?.difficulty === 'HARD', { timeout: 10000 });
      await page.waitForSelector('.modal__box.proto', { hidden: true });
      assert.match(await page.$eval('.rs-pill__diff', (el) => el.textContent), /绝境模拟/);

      // ⚙ 同盟设置: the 模拟难度 (更改 opens 选择模拟协议) and the 「AI 队友最后选择」 switch, both the host's
      await press(page, '.rs-pill__gear');
      await page.waitForSelector('.rs-opts', { visible: true });
      st = await page.evaluate(() => ({
        diff: document.querySelector('[data-testid="room-opt-difficulty"]')?.textContent.replace(/\s+/g, ' ').trim(),
        ailast: [...document.querySelectorAll('.rs-opts [role="switch"]')].map((b) => [b.textContent.trim(), b.disabled]),
      }));
      assert.ok(st.diff.includes('绝境模拟') && st.diff.includes('更改') && !st.diff.includes('由创建者选择'), st.diff);
      assert.deepEqual(st.ailast, [['AI 队友最后选择', false]]);
      await page.screenshot({ path: path.join(OUT, 'lobby-hub-room-settings.png') });
      await press(page, '.rs-opts__diff');
      await page.waitForSelector('.modal__box.proto', { visible: true });
      assert.equal(await page.$('.rs-opts'), null, 'the menu closes under the dialog');
      await escape(page);
      await page.waitForSelector('.modal__box.proto', { hidden: true });
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  });

  test('desktop: the 成就统计 card → its window (Esc closes) → 查看完整统计 → 统计数据', async () => {
    const { ctx, page, problems } = await open();
    try {
      await press(page, '.hub-ach');
      await page.waitForSelector('.modal__box.achv [data-testid="achievement-dialog"]', { visible: true });
      await settle(page);
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.modal__box.achv')), true, 'the focus is in the window');
      await page.screenshot({ path: path.join(OUT, 'lobby-hub-achievements.png') });
      await escape(page);
      await page.waitForSelector('.modal', { hidden: true });
      await press(page, '.hub-ach');
      await press(page, '.modal__box.achv .achv__more');
      await page.waitForSelector('.st .st-tab', { visible: true, timeout: 15000 });
      assert.equal(await page.$('.modal__box.achv'), null, 'the window gives way to 统计数据');
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  });

  for (const [w, h] of [[844, 390], [667, 375]]) {
    test(`phone ${w}×${h} (touch): the hub and both dialogs fit, their buttons in view without scrolling`, async () => {
      const { ctx, page, problems } = await open({ w, h, touch: true });
      try {
        await sleep(300);
        assert.deepEqual((await fit(page)).out, [], 'the hub fits');
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.hub-side')).display), 'none', '作战提示 gives way');
        await page.screenshot({ path: path.join(OUT, `lobby-hub-phone-${w}.png`) });
        // the left column's 成就统计 card gives way too: the plate keeps the statistics entry
        await press(page, '.hub-plate--ach', true);
        await page.waitForSelector('.modal__box.achv [data-testid="achievement-dialog"]', { visible: true });
        await settle(page);
        // the window fits the screen (its records scroll inside it), its close and 查看完整统计 in view
        assert.deepEqual(await page.evaluate(() => ['.modal__box.achv', '.achv__close', '.achv__more'].map((q) => {
          const r = document.querySelector(q).getBoundingClientRect();
          return r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
        })), [true, true, true], 'the 成就统计 window fits');
        await page.screenshot({ path: path.join(OUT, `lobby-hub-phone-${w}-achievements.png`) });
        await press(page, '.modal__box.achv .achv__close', true);
        await page.waitForSelector('.modal', { hidden: true });

        await press(page, '.mode-card[data-mode="solo"]', true);
        await page.waitForSelector('.modal__box.proto', { visible: true });
        await sleep(500);
        assert.deepEqual(await fit(page), { out: [], scrolls: false }, '选择模拟协议 fits');
        assert.ok(await diffCard(page, '终极模拟') >= 0);
        await page.tap('.diff-card[data-test-pick]');
        await page.waitForFunction(() => document.querySelector('.proto__body')?.dataset.difficulty === 'ABYSS');
        await page.screenshot({ path: path.join(OUT, `lobby-hub-phone-${w}-protocol.png`) });
        await press(page, '.proto__back', true);
        await page.waitForSelector('.modal', { hidden: true });

        await press(page, '.mode-card[data-mode="coop"]', true);
        await page.waitForSelector('.modal__box.ally', { visible: true });
        await sleep(500);
        assert.deepEqual(await fit(page), { out: [], scrolls: false }, '选择同盟方式 fits');
        assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'INPUT'), false, 'no keyboard pops up on a touch screen');
        await page.screenshot({ path: path.join(OUT, `lobby-hub-phone-${w}-alliance.png`) });
        // 创建同盟: the room at once; the host's 选择模拟协议 over it fits too
        await press(page, '[data-testid="alliance-create"]', true);
        await page.waitForSelector('.room-screen', { timeout: 15000 });
        await press(page, '.rs-pill__diff', true);
        await page.waitForSelector('.modal__box.proto', { visible: true });
        await sleep(500);
        assert.deepEqual(await fit(page), { out: [], scrolls: false }, 'the room’s 选择模拟协议 fits');
        assert.ok(await page.$eval('.proto .proto-start', (b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.width > 0; }), '确认 in view');
        await page.screenshot({ path: path.join(OUT, `lobby-hub-phone-${w}-room-protocol.png`) });
        assert.deepEqual(problems, []);
      } finally { await ctx.close(); }
    });
  }
});
