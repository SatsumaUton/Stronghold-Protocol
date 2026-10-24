// S.W.E.E.P. with cold data, delayed version responses, tab/reopen loops and a different-version room.
// SP_E2E=1 node --test test/ui/sweep.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, problemsOf, sleep } from '../e2e/client.mjs';
import { VERSIONS, versionSlug } from '../../shared/versions.js';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const shots = process.env.SP_FIX53_SHOTS;
const req = (c, type, body = {}) => c.page.evaluate((type, body) =>
  globalThis.__SP__.net.request(type, body).then(() => null), type, body);
const expected = (version) => {
  const read = (name) => JSON.parse(readFileSync(path.join(ROOT, 'data', version.dir, `${name}.json`), 'utf8'));
  return { bonds: Object.values(read('bonds')).filter((b) => b.bondId).length,
    bands: Object.values(read('bands')).filter((b) => b.bandId).length,
    enemies: Object.values(read('bosses')).filter((b) => b.bossId && !b.hidden).length
      + Object.values(read('factions').types).filter((f) => f.type).length };
};
const shot = async (c, name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await c.page.screenshot({ path: path.join(shots, `${name}.png`) });
};
async function close(c) {
  await c.page.keyboard.press('Escape');
  await c.page.waitForSelector('.sw-tabs', { hidden: true });
}
async function report(c, version, capture = false) {
  const counts = expected(version);
  for (const [tab, label] of [['bands', '策略'], ['enemies', '敌方'], ['bonds', '盟约']]) {
    await c.click('.sw-tab', label);
    await c.page.waitForFunction((tab, count) => document.querySelector('.sw-body')?.dataset.tab === tab
      && document.querySelectorAll('.sw-tile').length === count && document.querySelector('.sw-left .sw-hero__name'),
    { timeout: 30000 }, tab, counts[tab]);
    const rows = await c.page.$$eval('.sw-sec', (els) => els.map((e) => ({
      expected: Number(e.querySelector('.sw-sec__name small').textContent), actual: e.querySelectorAll('.sw-tile').length,
    })));
    assert.ok(rows.every((r) => r.expected === r.actual && r.actual > 0), JSON.stringify(rows));
    // Check the last tile too: a total alone can miss a collapsed/clipped grid or a missing second section.
    const tiles = await c.page.$$('.sw-tile');
    for (const tile of [tiles[0], tiles.at(-1)]) {
      await tile.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await tile.click();
      await sleep(180); // the detail's 160 ms fade
      const visible = await tile.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 16 && r.height > 16 && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
      assert.ok(visible, `${version.id} ${tab}: tile is visible and hit-testable`);
      assert.ok(await c.page.$eval('.sw-hero__name', (e) => e.textContent.trim()), `${version.id} ${tab}: detail`);
    }
    if (capture) {
      await c.page.$eval('.sw-right', (e) => { e.scrollTop = 0; });
      await shot(c, `sweep-${versionSlug(version)}-${tab}`);
    }
  }
}

test('S.W.E.E.P.: pending version never presents the previous report; 64 opens with throttling and room round trips', {
  skip: !enabled, timeout: 6 * 60 * 1000,
}, async (t) => {
  const srv = await startRealServer({ env: { SP_VERSIONS: 'all' } });
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'sweep');
  const host = new Client(P, srv.base, 'sweep-host');
  let held = null, holdVersion = null;
  const network = [];
  const warnings = [];
  try {
    await c.open();
    c.page.on('console', (m) => { if (m.type() === 'warn' || m.type() === 'warning') warnings.push(m.text()); });
    const cdp = await c.page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 120, downloadThroughput: 1024 * 1024, uploadThroughput: 512 * 1024,
    });
    c.page.on('response', (r) => { if (/\/data\/|\/cs\//.test(r.url())) network.push({ url: r.url(), status: r.status() }); });
    await c.page.setRequestInterception(true);
    c.page.on('request', (r) => {
      // Hold one real response until the report opens: deterministic slow-link timing, with real server bytes.
      if (holdVersion && r.url().includes(`/data/${holdVersion.dir}bands.json`)) held = r;
      else void r.continue();
    });
    await c.enter('报告验收');
    await host.open(); await host.enter('同盟验收');
    for (const [index, version] of VERSIONS.entries()) {
      if (index) {
        holdVersion = version;
        await c.click('[data-testid="version-switch"]');
        await c.click(`.verpick__pick[data-version="${version.id}"]`);
      }
      await c.click('.lobby-sweep');
      if (index) {
        for (let n = 0; !held && n < 100; n++) await sleep(50);
        assert.ok(held, 'the version data request is still pending');
        await c.click('.sw-tab', '策略');
        await sleep(200);
        await shot(c, `pending-${versionSlug(version)}`);
        const pending = await c.page.evaluate(() => ({
          loading: !!document.querySelector('.sw-loading'), tiles: document.querySelectorAll('.sw-tile').length,
        }));
        assert.deepEqual(pending, { loading: true, tiles: 0 }, 'never show the previous version while this one is loading');
        holdVersion = null;
        if (index === VERSIONS.length - 1) {
          // A delivered but corrupt version file must expose retry, never a blank/previous report.
          await held.respond({ status: 200, contentType: 'application/json', body: '{}' }); held = null;
          await c.page.waitForSelector('.sw-loading[role="alert"]', { visible: true });
          assert.equal(await c.page.$$eval('.sw-tile', (els) => els.length), 0);
          await shot(c, 'sweep-version-failed');
          await c.click('.sw-loading button', '重试');
        } else { await held.continue(); held = null; }
      }
      await report(c, version, true); await close(c);
      // A room of a different version temporarily replaces this lobby's set, then restores it on leaving.
      const other = VERSIONS[(index + VERSIONS.length - 1) % VERSIONS.length];
      await req(host, 'room.create', { mode: 'coop', version: other.id });
      const code = (await host.st()).room.code;
      await req(c, 'room.join', { code });
      await c.page.waitForFunction((id) => {
        const s = globalThis.__SP_CONTENT__.state();
        return id === 'act2autochess' ? s.status === 'idle' : s.status === 'ready' && s.version === id;
      }, { timeout: 30000 }, other.id);
      await c.click('.rs-exit');
      await c.page.waitForSelector('.lobby-sweep', { visible: true });
      await req(host, 'room.leave');
      await host.page.evaluate(() => globalThis.__SP__.store.set({ room: null }));
      for (let i = 1; i < 16; i++) {
        await c.click('.lobby-sweep');
        await report(c, version); await close(c);
      }
      t.diagnostic(`${version.id}: 16 opens, 48 tab checks, cross-version room returned; no missing tiles`);
    }
    assert.deepEqual(problemsOf([c, host]), []);
  } catch (e) {
    await shot(c, 'sweep-failure').catch(() => {});
    throw e;
  } finally {
    holdVersion = null;
    if (held) await held.continue().catch(() => {});
    if (shots) writeFileSync(path.join(shots, 'sweep-network.json'), JSON.stringify({ network, warnings, problems: problemsOf([c, host]) }, null, 2) + '\n');
    await c.close(); await host.close(); await srv.stop();
  }
});
