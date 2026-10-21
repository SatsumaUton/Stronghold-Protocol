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
// 选择模拟协议, 选择同盟方式 (创建同盟 with its difficulty line under the name) and the room's 选择模拟协议 stay inside the
// screen, their buttons in view without scrolling; 选择同盟方式 too at 640×360 and 667×375 in English at 大 / 特大 and in
// Japanese at 特大, its key field's placeholder whole beside 观战 (every language and 文字大小, §35.18's leftover).
// 选择模拟协议 on phones 640×360 / 667×375 / 740×360 / 844×390 in all five languages at all four 文字大小 (§35.18's
// leftover: at 中 and above the cards ran under 开始独立模拟): the four cards whole above the button without scrolling,
// the button and its label whole, the names whole (the chosen card's in the brief), the description in the brief.
// The other doctors' read-only view: test/ui/room-settings.e2e.test.js.
// Every page must finish with zero console errors / page errors / failed requests. Screenshots: test/e2e/out/lobby-hub-*.png

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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

  async function open({ w = 1920, h = 1080, touch = false, lang = null, textSize = null } = {}) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.evaluateOnNewDocument((l, ts) => {
      localStorage.setItem('sp.name', '大厅测试');
      sessionStorage.setItem('sp.entered', '1');
      if (l) localStorage.setItem('sp.pref.lang', JSON.stringify(l));
      if (ts) localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: ts }));
    }, lang, textSize);
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
   * layers (.hub-bg, decorative, clipped by its overflow) and 选择模拟协议's picture with its scene (.proto__pic / .ps,
   * decorative: on a desktop it reaches past the stage and under the cards like the event's) may run past the edges on
   * purpose.
   */
  const fit = async (page) => { await settle(page); return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.lobby-screen *:not(.hub-bg *, .proto__pic, .proto__pic *, .ps, .ps *), .modal__box *:not(.proto__pic, .proto__pic *, .ps, .ps *)')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${el.className?.baseVal ?? el.className ?? el.tagName}`);
    }
    const bodies = [...document.querySelectorAll('.modal__body')];
    return { out: out.slice(0, 6), scrolls: bodies.some((b) => b.scrollHeight > b.clientHeight + 1) };
  }); };

  /**
   * 创建同盟's bar on a short screen: the icon and the name on the first row (the name whole), the difficulty line under
   * the name — shown whole inside the bar, ≥ 11 px — and whether 选择同盟方式's column has to scroll.
   */
  const createBar = (page) => page.$eval('[data-testid="alliance-create"]', (card) => {
    const box = (el) => el.getBoundingClientRect();
    const bar = card.querySelector('.ally-card__bar'), b = box(bar), icon = box(bar.querySelector('.ally-card__icon'));
    const name = bar.querySelector('.ally-card__name'), n = box(name), sm = bar.querySelector('small'), r = box(sm);
    const side = document.querySelector('.ally-side');
    return { text: sm.textContent, shown: getComputedStyle(sm).display !== 'none' && r.width > 0 && r.height > 0,
      whole: sm.scrollWidth <= sm.clientWidth + 1 && sm.scrollHeight <= sm.clientHeight + 1,
      inside: r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1,
      px: parseFloat(getComputedStyle(sm).fontSize),
      nameRow: Math.abs((n.top + n.bottom) / 2 - (icon.top + icon.bottom) / 2) < 4 && n.left >= icon.right && n.bottom <= r.top + 1,
      nameWhole: name.scrollWidth <= name.clientWidth + 1, underName: Math.abs(r.left - n.left) < 2,
      sideScrolls: side.scrollHeight > side.clientHeight + 1 };
  });
  const barOk = (d) => d.shown && d.whole && d.inside && d.px >= 11 && d.nameRow && d.nameWhole && d.underName && !d.sideScrolls;

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
        // 创建同盟 keeps its difficulty line on a short screen (§35.18's leftover): under the name, whole inside the bar
        const diff = await createBar(page);
        assert.ok(barOk(diff), `${w}×${h}: 创建同盟 ${JSON.stringify(diff)}`);
        assert.match(diff.text, /^难度：.+（可在同盟内更改）$/);
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

  // the long languages at a big 文字大小 (the 2026-10-22 review: in English at 大 the name wrapped under the icon, the bar
  // grew to three rows and 加入同盟 left a 360 px-tall screen; at 特大 the mode line broke too)
  for (const [lang, textSize] of [['en', 'lg'], ['en', 'xl'], ['ja', 'xl']]) {
    test(`phones 640×360 / 667×375, ${lang} at 文字大小 ${textSize}: 选择同盟方式 fits, 创建同盟 on two rows with its whole difficulty line`, async () => {
      for (const [w, h] of [[640, 360], [667, 375]]) {
        const { ctx, page, problems } = await open({ w, h, touch: true, lang, textSize });
        try {
          assert.deepEqual(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dataset.text]), [lang, textSize]);
          await press(page, '.mode-card[data-mode="coop"]', true);
          await page.waitForSelector('.modal__box.ally', { visible: true });
          assert.deepEqual(await fit(page), { out: [], scrolls: false }, `${w}×${h}: 选择同盟方式 fits`);
          const diff = await createBar(page);
          assert.ok(barOk(diff), `${w}×${h}: 创建同盟 ${JSON.stringify(diff)}`);
          // 加入同盟 whole on the screen, below the mode line, nothing over its middle
          const join = await page.$eval('.ally-card__bar--join', (el) => {
            const r = el.getBoundingClientRect(), mode = document.querySelector('.ally__mode').getBoundingClientRect();
            const card = document.querySelector('[data-testid="alliance-create"]').getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { onScreen: r.top >= 0 && r.bottom <= innerHeight, hit: el.contains(hit), cardBelowMode: card.top >= mode.bottom - 1 };
          });
          assert.deepEqual(join, { onScreen: true, hit: true, cardBelowMode: true }, `${w}×${h}: 加入同盟`);
          await page.screenshot({ path: path.join(OUT, `lobby-hub-phone-${w}-alliance-${lang}-${textSize}.png`) });
          // a column still taller than its space (more recent keys, the test-room box) scrolls from 创建同盟 down to 加入同盟
          // instead of spilling past both ends (stood in for by a taller hint line)
          await page.addStyleTag({ content: '.ally-recent { min-height: 260px; }' });
          assert.deepEqual(await page.$eval('.ally-side', (side) => {
            const s = side.getBoundingClientRect(), top = side.querySelector('[data-testid="alliance-create"]').getBoundingClientRect().top;
            side.scrollTop = side.scrollHeight;
            const join = side.querySelector('.ally-card__bar--join').getBoundingClientRect();
            return { scrolls: side.scrollHeight > side.clientHeight + 1, createAtTop: top >= s.top && top <= s.top + 8, joinReached: join.bottom <= s.bottom };
          }), { scrolls: true, createAtTop: true, joinReached: true }, `${w}×${h}: a tall column scrolls`);
          assert.deepEqual(problems, []);
        } finally { await ctx.close(); }
      }
    });
  }

  /** The key field's placeholder: its text width in the placeholder's own font against the input's inner width. */
  const keyField = (page) => page.$eval('.ally-key input', (input) => {
    const ph = getComputedStyle(input, '::placeholder');
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${ph.fontWeight} ${ph.fontSize} ${ph.fontFamily}`;
    c.letterSpacing = ph.letterSpacing;
    const cs = getComputedStyle(input);
    const inner = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const spec = document.querySelector('.ally-key__spec').getBoundingClientRect(), r = input.getBoundingClientRect();
    return { text: input.placeholder, textW: Math.ceil(c.measureText(input.placeholder).width), inner: Math.floor(inner), px: parseFloat(ph.fontSize),
      beside: r.right <= spec.left + 1 };
  });

  // 选择同盟方式's key field on a short screen (§35.18's leftover: at 特大 the placeholder ran under 观战 in English and
  // Japanese): the short placeholder (the field's name), whole, ≥ 11 px, in every language and 文字大小; the long one back
  // where the screen is taller than 520 px
  test('phones: 选择同盟方式\'s key field placeholder fits beside 观战 in every language at every 文字大小', { timeout: 300000 }, async () => {
    const names = { zh: '同盟密钥', 'zh-TW': '同盟金鑰', en: 'Alliance Key', ja: '同盟コード', ko: '동맹 코드' };
    for (const lang of ['zh', 'zh-TW', 'en', 'ja', 'ko']) {
      for (const textSize of ['sm', 'md', 'lg', 'xl']) {
        const { ctx, page, problems } = await open({ w: 640, h: 360, touch: true, lang: lang === 'zh' ? null : lang, textSize });
        try {
          await press(page, '.mode-card[data-mode="coop"]', true);
          await page.waitForSelector('.modal__box.ally', { visible: true });
          await page.evaluate(() => document.fonts.ready);
          for (const [w, h] of [[640, 360], [667, 375], [740, 360], [844, 390]]) {
            await page.setViewport({ width: w, height: h, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
            await sleep(200);
            const k = await keyField(page);
            const what = `${lang} ${textSize} ${w}×${h}: ${JSON.stringify(k)}`;
            assert.equal(k.text, names[lang], what);
            assert.ok(k.textW <= k.inner && k.px >= 11 && k.beside, `the placeholder whole beside 观战 — ${what}`);
          }
          if (lang === 'en' && textSize === 'xl') {
            await page.setViewport({ width: 1280, height: 800, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }); // (a touch change reloads)
            // (taller than 520 px the whole sentence is back where it fits; at 特大 in English it does not, so the field's
            // name stays — decided by the field's width: the desktop test below)
            await page.waitForFunction(() => document.querySelector('.ally-key input')?.placeholder === 'Alliance Key', { timeout: 3000 });
            assert.equal(await page.$eval('.ally-key input', (el) => getComputedStyle(el).textOverflow), 'ellipsis');
            await page.setViewport({ width: 640, height: 360, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
            await page.waitForFunction(() => document.querySelector('.ally-key input')?.placeholder === 'Alliance Key', { timeout: 3000 });
            await page.screenshot({ path: path.join(OUT, 'lobby-hub-phone-640-alliance-key-en-xl.png') });
          }
          assert.deepEqual(problems, []);
        } finally { await ctx.close(); }
      }
    }
  });

  // 选择同盟方式's key field on a desktop (§35.18's leftover: above 520 px the whole sentence ended in an ellipsis at 特大
  // in English and Japanese, and in Chinese / Korean in a 1024 px window): the placeholder shown fits the field, and it is
  // the whole sentence wherever the whole sentence fits (TextField placeholderShort, by the field's width)
  test('desktop: 选择同盟方式\'s key field shows the whole sentence where it fits, else the field\'s name — never cut', { timeout: 300000 }, async () => {
    const packs = Object.fromEntries(['zh-TW', 'en', 'ja', 'ko'].map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${l}.json`), 'utf8'))]));
    const tr = (lang, id) => (lang === 'zh' ? id : (packs[lang][id] ?? packs[lang].strings?.[id]));
    let short = 0, whole = 0;
    for (const lang of ['zh', 'zh-TW', 'en', 'ja', 'ko']) {
      const full = tr(lang, '输入同盟密钥 / 粘贴邀请链接'), name = tr(lang, '同盟密钥');
      for (const textSize of ['sm', 'xl']) {
        const { ctx, page, problems } = await open({ w: 1920, h: 1080, lang: lang === 'zh' ? null : lang, textSize });
        try {
          await press(page, '.mode-card[data-mode="coop"]');
          await page.waitForSelector('.modal__box.ally', { visible: true });
          for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 600]]) {
            await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
            await sleep(150); await page.evaluate(() => document.fonts.ready); await sleep(150);
            const k = await keyField(page);
            const fullW = await page.$eval('.ally-key input', (input, text) => {
              const ph = getComputedStyle(input, '::placeholder');
              const c = document.createElement('canvas').getContext('2d');
              c.font = `${ph.fontWeight} ${ph.fontSize} ${ph.fontFamily}`;
              c.letterSpacing = ph.letterSpacing;
              return Math.ceil(c.measureText(text).width);
            }, full);
            const what = `${lang} ${textSize} ${w}×${h}: ${JSON.stringify(k)} (whole sentence ${fullW} px)`;
            assert.ok(k.textW <= k.inner && k.beside, `the placeholder whole beside 观战 — ${what}`);
            if (fullW <= k.inner - 2) assert.equal(k.text, full, `the whole sentence where it fits — ${what}`);
            else if (fullW > k.inner + 2) assert.equal(k.text, name, `the field's name where it does not — ${what}`);
            if (k.text === full) whole++; else short++;
          }
          assert.deepEqual(problems, []);
        } finally { await ctx.close(); }
      }
    }
    assert.ok(whole > 0 && short > 0, `both seen (whole ${whole}, short ${short})`);
  });

  /**
   * 选择模拟协议 on a phone: the four cards whole inside their list, which does not scroll, above the button; the button
   * and its label whole on the screen (each line of the label inside the button); the names whole but the chosen card's,
   * which the brief names in full; the description shown in the brief.
   */
  const protoFit = (page) => page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const list = document.querySelector('.proto-list'), l = box(list);
    const cards = [...list.querySelectorAll('.diff-card')];
    const start = document.querySelector('.proto-start'), s = box(start);
    const label = start.querySelector('.proto-start__label');
    const range = document.createRange();
    range.selectNodeContents(label);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0);
    const whole = (el) => el.scrollWidth <= el.clientWidth + 1;
    const brief = document.querySelector('.proto-brief'), desc = brief.querySelector('p'), bname = brief.querySelector('.proto-brief__name');
    const stage = box(document.querySelector('.proto-stage'));
    return {
      cards: cards.length, listScrolls: list.scrollHeight > list.clientHeight + 1,
      cardsIn: cards.every((c) => { const r = box(c); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; }),
      aboveButton: l.bottom <= s.top + 1,
      button: s.top >= 0 && s.bottom <= innerHeight && s.left >= 0 && s.right <= innerWidth,
      label: whole(label) && lines.length > 0 && lines.every((r) => r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1),
      lines: lines.length,
      names: cards.every((c) => c.classList.contains('is-on') || whole(c.querySelector('.pcard__name'))),
      chosenInBrief: whole(bname) && cards.some((c) => c.classList.contains('is-on') && bname.textContent.trim() === c.querySelector('.pcard__name').textContent.trim()),
      desc: getComputedStyle(desc).display !== 'none' && desc.textContent.trim().length > 0 && (() => { const r = box(desc); return r.left >= stage.left - 1 && r.right <= stage.right + 1 && r.bottom <= stage.bottom + 1; })(),
      cardDescHidden: cards.every((c) => getComputedStyle(c.querySelector('.pcard__desc')).display === 'none'),
    };
  });
  const protoOk = (d) => d.cards === 4 && !d.listScrolls && d.cardsIn && d.aboveButton && d.button && d.label && d.lines <= 2 && d.names && d.chosenInBrief && d.desc && d.cardDescHidden;

  test('phones: 选择模拟协议\'s four cards and 开始独立模拟 fit in every language at every 文字大小 (640×360 – 844×390)', { timeout: 420000 }, async () => {
    for (const lang of ['zh', 'zh-TW', 'en', 'ja', 'ko']) {
      for (const textSize of ['sm', 'md', 'lg', 'xl']) {
        const { ctx, page, problems } = await open({ w: 640, h: 360, touch: true, lang: lang === 'zh' ? null : lang, textSize });
        try {
          await press(page, '.mode-card[data-mode="solo"]', true);
          await page.waitForSelector('.modal__box.proto', { visible: true });
          await page.evaluate(() => document.fonts.ready);
          for (const [w, h] of [[640, 360], [667, 375], [740, 360], [844, 390]]) {
            await page.setViewport({ width: w, height: h, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
            await sleep(200);
            assert.deepEqual(await fit(page), { out: [], scrolls: false }, `${lang} ${textSize} ${w}×${h}: 选择模拟协议 fits`);
            const d = await protoFit(page);
            assert.ok(protoOk(d), `${lang} ${textSize} ${w}×${h}: ${JSON.stringify(d)}`);
            if (lang === 'en' && textSize === 'xl' && w === 667) await page.screenshot({ path: path.join(OUT, 'lobby-hub-phone-667-protocol-en-xl.png') });
          }
          // 终极模拟, the last card, chosen on the smallest screen: still whole above the button, the brief names it
          await page.setViewport({ width: 640, height: 360, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
          assert.ok(await diffCard(page, (await page.$$eval('.diff-card .pcard__name', (els) => els[3].textContent))) === 3);
          await page.tap('.diff-card[data-test-pick]');
          await page.waitForFunction(() => document.querySelector('.proto__body')?.dataset.difficulty === 'ABYSS');
          await sleep(300);
          const d = await protoFit(page);
          assert.ok(protoOk(d), `${lang} ${textSize} 640×360, 终极模拟: ${JSON.stringify(d)}`);
          assert.deepEqual(problems, []);
        } finally { await ctx.close(); }
      }
    }
  });

  /**
   * 选择模拟协议 on a desktop (taller than 520 px): the four cards whole inside their list, which does not scroll, above the
   * button; the button on the screen with its label whole inside it (at most two lines); the names whole and inside their
   * cards but the chosen card's beside its stamp once the cards are compact (the brief names it in full); the level
   * (`data-fit`) the first that fits — the one before it spills —, the brief's description always, and the chosen
   * difficulty's effects in the brief only at 'names'.
   */
  const protoDesk = (page) => page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const body = document.querySelector('.proto__body'), level = body.dataset.fit;
    const list = document.querySelector('.proto-list'), l = box(list);
    const cards = [...list.querySelectorAll('.diff-card')];
    const start = document.querySelector('.proto-start'), s = box(start);
    const label = start.querySelector('.proto-start__label'), lb = box(label);
    const range = document.createRange();
    range.selectNodeContents(label);
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    const brief = document.querySelector('.proto-brief'), bname = brief.querySelector('.proto-brief__name'), more = brief.querySelector('.proto-brief__more');
    const chosen = cards.find((c) => c.classList.contains('is-on'));
    const spills = () => list.scrollHeight > list.clientHeight + 1;
    const levels = ['full', 'brief', 'names'];
    const i = levels.indexOf(level);
    let firstFit = !spills();
    if (i > 0) { body.dataset.fit = levels[i - 1]; firstFit = firstFit && spills(); body.dataset.fit = level; }
    return {
      level, firstFit, cards: cards.length, listScrolls: spills(),
      cardsIn: cards.every((c) => { const r = box(c); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; }),
      aboveButton: l.bottom <= s.top + 1,
      button: s.top >= 0 && s.bottom <= innerHeight && s.left >= 0 && s.right <= innerWidth,
      label: label.scrollWidth <= label.clientWidth + 1 && lb.left >= s.left - 1 && lb.right <= s.right + 1 && lb.top >= s.top - 1 && lb.bottom <= s.bottom + 1,
      lines,
      names: cards.every((c) => {
        const n = c.querySelector('.pcard__name');
        if (n.scrollWidth <= n.clientWidth + 1 && box(n).right <= box(c).right - 2) return true;
        return c === chosen && level !== 'full' && getComputedStyle(n).textOverflow === 'ellipsis';
      }),
      chosenInBrief: !!chosen && bname.textContent.trim() === chosen.querySelector('.pcard__name').textContent.trim() && bname.scrollWidth <= bname.clientWidth + 1,
      desc: brief.querySelector('p').textContent.trim().length > 0 && getComputedStyle(brief.querySelector('p')).display !== 'none',
      more: getComputedStyle(more).display !== 'none' ? more.querySelectorAll('.proto-brief__effects > span').length : 0,
      effects: chosen ? chosen.querySelectorAll('.pcard__effects > span').length : -1,
    };
  });
  const deskOk = (d) => ['full', 'brief', 'names'].includes(d.level) && d.firstFit && d.cards === 4 && !d.listScrolls && d.cardsIn && d.aboveButton
    && d.button && d.label && d.lines <= 2 && d.names && d.chosenInBrief && d.desc && d.more === (d.level === 'names' ? d.effects : 0) && d.effects > 0;

  test('desktop: 选择模拟协议\'s four cards and 开始独立模拟 fit at 小 and 特大 in Chinese and English (1280×720 – 1920×1080)', { timeout: 300000 }, async () => {
    for (const lang of ['zh', 'en']) {
      for (const textSize of ['sm', 'xl']) {
        const { ctx, page, problems } = await open({ w: 1920, h: 1080, lang: lang === 'zh' ? null : lang, textSize });
        try {
          await press(page, '.mode-card[data-mode="solo"]');
          await page.waitForSelector('.modal__box.proto', { visible: true });
          await page.evaluate(() => document.fonts.ready);
          // (a web font that arrives late — a new size or a new difficulty's text asks for more of them — re-fits the cards:
          // measured once the fonts are in)
          const fontsIn = async () => { await sleep(150); await page.evaluate(() => document.fonts.ready); await sleep(150); };
          for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720]]) {
            await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
            await fontsIn();
            assert.deepEqual(await fit(page), { out: [], scrolls: false }, `${lang} ${textSize} ${w}×${h}: 选择模拟协议 fits`);
            const d = await protoDesk(page);
            assert.ok(deskOk(d), `${lang} ${textSize} ${w}×${h}: ${JSON.stringify(d)}`);
            if (lang === 'en' && w === 1440) await page.screenshot({ path: path.join(OUT, `lobby-hub-desktop-1440-protocol-en-${textSize}.png`) });
          }
          // 终极模拟, the last card, chosen at 1280×720: the level fits again, the brief names it
          assert.ok(await diffCard(page, (await page.$$eval('.diff-card .pcard__name', (els) => els[3].textContent))) === 3);
          await page.click('.diff-card[data-test-pick]');
          await page.waitForFunction(() => document.querySelector('.proto__body')?.dataset.difficulty === 'ABYSS');
          await fontsIn();
          const d = await protoDesk(page);
          assert.ok(deskOk(d), `${lang} ${textSize} 1280×720, 终极模拟: ${JSON.stringify(d)}`);
          assert.deepEqual(problems, []);
        } finally { await ctx.close(); }
      }
    }
  });
});
