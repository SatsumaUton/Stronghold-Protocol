// Real-server browser E2E — text fit of the official versions' interface (DESIGN §35.23, M1; the §35.18 matrix): on the
// four phones 640×360 / 667×375 / 740×360 / 844×390, in all five languages at all four 文字大小, and on desktops
// 1920×1080 / 1280×720:
//   * the lobby's version chip inside the top bar and the screen, the version picker inside the screen with every name
//     whole and every period line inside its row;
//   * a version room seen by a doctor whose lobby is 第二期下半: the pill (the name may end in an ellipsis) inside the
//     footer, the vote strip inside the screen with its texts wrapping (never cut sideways) and its buttons inside it, the
//     banner inside the screen, the seat tags (版本数据就绪 …) inside their cards, the tag beside the mode in the top bar;
//   * the settlement's team page and its detail of a version match: the version tag inside the screen.
// The vote is drawn from a room.state with `versionVote` laid over the page's store (its look only; the vote itself:
// test/ui/versions.e2e.test.js); the settlement from an imported record's payload (test/ui/fixtures/stats-versions.json).
// The game texts of another version stay Chinese in other languages until M3 (data.js versionFiles) — the interface's own
// texts are what this measures.
//
//   SP_E2E=1 node --test test/ui/versions-fit.e2e.test.js
//
// Screenshots: test/e2e/out/versions-fit-*.png.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, problemsOf, sleep } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const LANGS = ['zh', 'zh-TW', 'en', 'ja', 'ko'];
const SIZES = ['sm', 'md', 'lg', 'xl'];
const PHONES = [[640, 360], [667, 375], [740, 360], [844, 390]];
const DESKTOPS = [[1920, 1080], [1280, 720]];

/** Switch the interface language and 文字大小 in place (ui/lang.js switchLang, settingsStore). */
const setLook = (c, lang, size) => c.page.evaluate(async (lang, size) => {
  const { switchLang } = await import('/js/ui/lang.js');
  const { settingsStore } = await import('/js/ui/settingsStore.js');
  await switchLang(lang);
  settingsStore.set({ textSize: size });
  await document.fonts.ready;
}, lang, size);
// (no touch emulation: a change of it reloads the page — ui/device.js —, and the sizes follow the screen's height alone)
const viewport = (c, w, h) => c.page.setViewport({ width: w, height: h, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });

/** Elements of `sel` that leave the screen sideways or up/down, or whose own text is cut sideways. */
const misfits = (c, checks) => c.page.evaluate((checks) => {
  const out = [];
  const box = (el) => el.getBoundingClientRect();
  for (const { sel, within = null, wrap = false, optional = false, x = false } of checks) {
    const els = [...document.querySelectorAll(sel)].filter((el) => { const r = box(el); return r.width > 0 && r.height > 0; });
    if (!els.length && !optional) { out.push(`${sel}: missing`); continue; }
    for (const el of els) {
      const r = box(el);
      if (r.left < -1 || r.right > innerWidth + 1 || (!x && (r.top < -1 || r.bottom > innerHeight + 1))) out.push(`${sel}: off the screen ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
      if (within) {
        const p = el.closest(within);
        if (p) { const q = box(p); if (r.left < q.left - 1 || r.right > q.right + 1) out.push(`${sel}: outside ${within}`); }
      }
      if (wrap && el.scrollWidth > el.clientWidth + 1) out.push(`${sel}: cut sideways (${el.scrollWidth} > ${el.clientWidth})`);
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('the page scrolls sideways');
  return out;
}, checks);

describe('official versions: text fit (real server, SP_VERSIONS=all)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  let srv;
  let P;
  before(async () => { srv = await startRealServer({ env: { SP_VERSIONS: 'all' } }); P = (await import('puppeteer-core')).default; });
  after(async () => { await srv?.stop(); });

  test('the lobby chip and the picker: four phones and two desktops, five languages, four 文字大小', { timeout: 10 * 60 * 1000 }, async () => {
    const c = new Client(P, srv.base, 'lobby', { prefix: 'versions-fit', w: 667, h: 375 });
    try {
      await c.open();
      await c.enter('可露希尔');
      await c.page.evaluate(async () => { (await import('/js/versions.js')).setLobbyVersion('act1autochess@V1_1'); });
      await c.page.waitForFunction(() => globalThis.__SP_CONTENT__?.state().status === 'ready', { timeout: 30000 });
      for (const lang of LANGS) {
        for (const size of SIZES) {
          await setLook(c, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(c, w, h);
            await sleep(120);
            const chip = await misfits(c, [{ sel: '[data-testid="version-switch"]', within: '.topbar' }]);
            assert.deepEqual(chip, [], `chip ${lang} ${size} ${w}×${h}`);
          }
          await viewport(c, 667, 375);
          await c.click('[data-testid="version-switch"]');
          await c.page.waitForSelector('[data-testid="version-picker"]', { visible: true });
          await sleep(500); // the dialog's 转场
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(c, w, h);
            await sleep(150);
            const bad = await misfits(c, [
              { sel: '.modal__box.verpick' },
              // (the list scrolls inside the dialog: its rows are checked sideways)
              { sel: '.verpick__name', within: '.verpick__row', wrap: true, x: true },
              { sel: '.verpick__period', within: '.verpick__row', wrap: true, x: true },
              { sel: '.verpick__badge', within: '.verpick__row', x: true },
            ]);
            assert.deepEqual(bad, [], `picker ${lang} ${size} ${w}×${h}`);
          }
          if (size === 'xl' && (lang === 'en' || lang === 'ja')) { await viewport(c, 667, 375); await c.shot(`picker-${lang}-xl`); }
          await c.page.keyboard.press('Escape');
          await c.page.waitForSelector('[data-testid="version-picker"]', { hidden: true });
        }
      }
      assert.deepEqual(problemsOf([c]), []);
    } finally { await c.close(); }
  });

  test('a version room (pill, strip, banner, seat tags, the tag) and a version settlement: phones and desktops, five languages, four 文字大小', { timeout: 15 * 60 * 1000 }, async () => {
    const host = new Client(P, srv.base, 'host', { prefix: 'versions-fit', w: 667, h: 375 });
    const guest = new Client(P, srv.base, 'guest', { prefix: 'versions-fit', w: 667, h: 375 });
    try {
      await host.open();
      await host.enter('凯尔希');
      await host.page.evaluate(async () => { (await import('/js/versions.js')).setLobbyVersion('act1autochess@V1_1'); });
      await host.page.waitForFunction(() => globalThis.__SP_CONTENT__?.state().status === 'ready', { timeout: 30000 });
      const room = await host.createCoop();
      await guest.open(`?room=${room.code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
      await guest.page.waitForFunction(() => globalThis.__SP_CONTENT__?.state().status === 'ready', { timeout: 30000 });
      await guest.page.waitForSelector('[data-testid="version-banner"]');
      // the vote's look: a room.state with an open vote laid over the guest's store (no server push comes while idle)
      await guest.page.evaluate(() => {
        const { store } = globalThis.__SP__;
        const r = store.get().room;
        const voters = r.seats.filter((s) => s && !s.isBot).map((s) => s.playerId);
        store.set({ room: { ...r, versionVote: { id: 1, proposerId: r.hostId, version: 'act2autochess@V2_1', voters, agreed: [r.hostId], remainingMs: 59000 } } });
      });
      await guest.page.waitForSelector('[data-testid="version-vote"] [data-testid="version-agree"]', { visible: true });
      const roomBad = [];
      for (const lang of LANGS) {
        for (const size of SIZES) {
          await setLook(guest, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(guest, w, h);
            await sleep(150);
            const bad = await misfits(guest, [
              { sel: '.rs-pill' },
              { sel: '[data-testid="room-version"]', within: '.rs-pill' },
              { sel: '[data-testid="version-vote"]' },
              { sel: '.vervote__text strong', wrap: true },
              { sel: '.vervote__hint', wrap: true },
              { sel: '.vervote__actions .btn', within: '[data-testid="version-vote"]' },
              // (a short screen gives the banner's line to the seats: then it is not shown at all)
              { sel: '[data-testid="version-banner"]', wrap: true, optional: h <= 520 },
              { sel: '.seat__content', within: '.rseat' },
              { sel: '.rs-clock [data-testid="version-tag"]' },
            ]);
            if (bad.length) roomBad.push(`room ${lang} ${size} ${w}×${h}: ${bad.join('; ')}`);
          }
          if (size === 'xl' && (lang === 'en' || lang === 'ko')) { await viewport(guest, 667, 375); await guest.shot(`room-${lang}-xl`); }
        }
      }
      assert.deepEqual(roomBad, []);

      // a settlement of a version match (an imported record's payload on the host's screen, inside its version room)
      const fixture = JSON.parse(readFileSync(path.join(ROOT, 'test/ui/fixtures/stats-versions.json'), 'utf8'));
      await host.page.evaluate(async (rec) => {
        const { recordToResult } = await import('/js/ui/stats.js');
        const { store } = globalThis.__SP__;
        store.set({ match: { public: { phase: 'RESULT', round: 14, players: [] }, private: null, field: null, battle: null, result: recordToResult(rec) } });
      }, fixture.records[0]);
      await host.page.waitForSelector('[data-testid="settle"] [data-testid="version-tag"]', { visible: true, timeout: 20000 });
      for (const lang of LANGS) {
        for (const size of SIZES) {
          await setLook(host, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(host, w, h);
            await sleep(150);
            assert.deepEqual(await misfits(host, [{ sel: '[data-testid="settle"] [data-testid="version-tag"]' }]), [], `settlement ${lang} ${size} ${w}×${h}`);
          }
        }
      }
      await viewport(host, 667, 375);
      await host.shot('settle');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      await host.close();
      await guest.close();
    }
  });
});
