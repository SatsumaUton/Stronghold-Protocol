// test/plugins/offers.test.js — the declarative `offers` part of PLUGIN API v2 (shared/plugins/offers.js, PLUGINS.md
// §10b): one file is one interaction window, and the host asks the same question of every round. The point of the
// part is that `when.rounds` is an expression over the round number, not an official schedule: a window declared for a
// round the official content never uses (R3, R9) reads exactly like one declared for R1, `{ every: N }` covers odd and
// even rounds alike, and nothing in the reader knows how many rounds a mode has. The part is data only, so the tests
// also hold that no path here can name code and that a plugin without the part carries no window at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OFFER_EFFECTS, OFFER_NAMES, OFFER_QUORUM, OFFER_TIMEOUT, OFFER_WHEN, OFFER_FILE_VERSION, OFFER_ROUND_MAX,
  offerAt, offersAt, readOfferFile, readRounds, roundsMatch, roundsText,
} from '../../shared/plugins/offers.js';
import { PLUGIN_OFFERS_MAX_WINDOW_SEC, PLUGIN_OFFER_SLOTS } from '../../shared/plugins/limits.js';
import { readPluginFolder } from '../../server/plugins/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-offers-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};
/** One valid window (the shape of PLUGINS.md §10b). */
const window = (extra = {}) => ({
  offer: OFFER_FILE_VERSION,
  id: 'early-pick',
  when: { at: ['prep'], rounds: [3, 9] },
  windowSec: 30, quorum: 'all', onTimeout: 'auto', defer: [], slots: 3, refresh: { perSlot: 1 },
  options: { source: 'lib/cards.json' },
  ...extra,
});
const read = (raw, rel = 'offers/early-pick.json') => readOfferFile(raw, { pluginId: 'demo', rel, at: ['offers'] });
const codes = (r) => r.problems.map((p) => p.code);

test('a well-formed window is read: the moment, the rounds and every limit', () => {
  const r = read(window());
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.offer.id, 'early-pick');
  assert.deepEqual(r.offer.when.at, ['prep']);
  assert.equal(r.offer.windowSec, 30);
  assert.equal(r.offer.quorum, 'all');
  assert.equal(r.offer.onTimeout, 'auto');
  assert.deepEqual(r.offer.defer, []);
  assert.equal(r.offer.slots, 3);
  assert.deepEqual(r.offer.refresh, { perSlot: 1 });
  assert.deepEqual(r.offer.options, { source: 'lib/cards.json' });
  assert.equal(r.offer.pluginId, 'demo');
});

test('the conservative defaults: windowSec 0 opens no window, quorum none waits for nobody, onTimeout auto, no defer', () => {
  const r = read({ offer: 1, id: 'bare', when: { at: ['battleCheck'] }, options: { source: 'lib/a.json' } });
  assert.deepEqual(r.problems, []);
  assert.equal(r.offer.windowSec, 0, 'a declared part alone changes nothing');
  assert.equal(r.offer.quorum, 'none');
  assert.equal(r.offer.onTimeout, 'auto');
  assert.deepEqual(r.offer.defer, []);
  assert.equal(r.offer.slots, 1);
  assert.equal(r.offer.refresh, null);
  assert.equal(r.offer.shared, null);
  assert.equal('apply' in r.offer, false);
});

test('the round expression: a list, "any", { every: N } and { from, to }; absent is every round', () => {
  assert.deepEqual(readRounds([3, 9, 3]), { kind: 'list', rounds: [3, 9] }, 'duplicates drop, the order is the round order');
  assert.deepEqual(readRounds('any'), { kind: 'list', rounds: [] });
  assert.deepEqual(readRounds({ every: 2 }), { kind: 'every', every: 2 });
  assert.deepEqual(readRounds({ from: 4, to: 12 }), { kind: 'range', from: 4, to: 12 });
  for (const bad of [[], [0], [1, 1.5], [OFFER_ROUND_MAX + 1], 'every', '', { every: 0 }, { every: 33 }, { from: 5, to: 4 }, { from: 0, to: 3 }, { every: 2, from: 1, to: 3 }]) {
    assert.equal(readRounds(bad), null, JSON.stringify(bad));
  }
  // "any" is the empty list: matches every round, including one a mode never reaches
  assert.equal(roundsMatch(readRounds('any'), 7), true);
  assert.equal(roundsMatch(readRounds([3, 9]), 3), true);
  assert.equal(roundsMatch(readRounds([3, 9]), 4), false);
  assert.equal(roundsMatch(readRounds({ every: 2 }), 2), true);
  assert.equal(roundsMatch(readRounds({ every: 2 }), 3), false);
  assert.equal(roundsMatch(readRounds({ from: 4, to: 12 }), 4), true);
  assert.equal(roundsMatch(readRounds({ from: 4, to: 12 }), 13), false);
  assert.equal(roundsMatch(readRounds([3, 9]), 0), false, 'rounds start at 1');
  assert.equal(roundsText(readRounds({ every: 2 })), 'every 2');
  assert.equal(roundsText(readRounds('any')), 'any');
});

test('a window opens before any round it names — the official schedule is not an input', () => {
  const w = read(window()).offer;
  // R3 and R9 are declared; every other round is not — and nothing here knows which rounds are official
  for (const round of [3, 9]) assert.equal(offerAt(w, { at: 'prep', round }), true, `R${round}`);
  for (const round of [1, 2, 6, 11]) assert.equal(offerAt(w, { at: 'prep', round }), false, `R${round} is not declared`);
  const three = read(window({ when: { at: ['prep'], rounds: [1, 3, 9] } })).offer;
  for (const round of [1, 3, 9]) assert.equal(offerAt(three, { at: 'prep', round }), true, `R${round}`);
  assert.equal(offerAt(three, { at: 'prep', round: 2 }), false);
  assert.equal(offerAt(three, { at: 'battleCheck', round: 3 }), false, 'the moment must be declared too');
  const every = read(window({ when: { at: ['battleCheck', 'prep'], rounds: { every: 2 } } })).offer;
  for (const round of [2, 4, 6, 8]) assert.equal(offerAt(every, { at: 'battleCheck', round }), true, `R${round} (even)`);
  for (const round of [1, 3, 5, 7]) assert.equal(offerAt(every, { at: 'prep', round }), false, `R${round} (odd)`);
});

test('offersAt answers per round for the two shapes a set uses: a plugin with its windows, and one tagged window', () => {
  const plugins = [
    { id: 'a', offers: [read(window({ id: 'a-early', when: { at: ['prep'], rounds: [3] } })).offer] },
    { id: 'b', offers: [read(window({ id: 'b-every', when: { at: ['prep'], rounds: { every: 2 } } })).offer] },
  ];
  assert.deepEqual(offersAt(plugins, { at: 'prep', round: 3 }).map((x) => x.offer.id), ['a-early'], 'the even-round window skips R3');
  assert.deepEqual(offersAt(plugins, { at: 'prep', round: 4 }).map((x) => x.offer.id), ['b-every']);
  assert.deepEqual(offersAt(plugins, { at: 'prep', round: 5 }), []);
  // a round several plugins declare opens all of them, in the plugins' order
  const both = [{ id: 'a', offers: [read(window({ id: 'a', when: { at: ['prep'], rounds: [3] } })).offer] },
    { id: 'b', offers: [read(window({ id: 'b', when: { at: ['prep'], rounds: { from: 1, to: 5 } } })).offer] }];
  assert.deepEqual(offersAt(both, { at: 'prep', round: 3 }).map((x) => `${x.pluginId}:${x.offer.id}`), ['a:a', 'b:b']);
  // the shape a content set builds: every window tagged with its plugin (`pluginId`), the window's own id in `offer.id`
  const tagged = [{ pluginId: 'demo', ...read(window({ id: 'early-pick', when: { at: ['prep'], rounds: [3, 9] } })).offer }];
  assert.deepEqual(offersAt(tagged, { at: 'prep', round: 3 }).map((x) => `${x.pluginId}:${x.offer.id}`), ['demo:early-pick']);
  assert.deepEqual(offersAt(tagged, { at: 'prep', round: 4 }), []);
  assert.deepEqual(offersAt([], { at: 'prep', round: 3 }), [], 'no part at all: no window is ever built');
  assert.deepEqual(offersAt([{ id: 'a' }], { at: 'prep', round: 3 }), [], 'a plugin without the part carries no window');
});

test('the limits: slots and refresh share the host\'s own caps, windowSec is bounded, the round count is finite', () => {
  assert.deepEqual(read(window({ slots: PLUGIN_OFFER_SLOTS })).problems, []);
  assert.deepEqual(codes(read(window({ slots: PLUGIN_OFFER_SLOTS + 1 }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ slots: 0 }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(read(window({ refresh: { perSlot: 2 } })).problems, []);
  assert.deepEqual(codes(read(window({ refresh: { perSlot: 3 } }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ refresh: { perSlot: -1 } }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ refresh: { times: 1 } }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(read(window({ windowSec: PLUGIN_OFFERS_MAX_WINDOW_SEC })).problems, []);
  assert.deepEqual(codes(read(window({ windowSec: PLUGIN_OFFERS_MAX_WINDOW_SEC + 1 }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ windowSec: -1 }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ when: { at: ['prep'], rounds: [OFFER_ROUND_MAX + 1] } }))), ['PLUGIN_OFFER_ROUNDS']);
  assert.deepEqual(codes(read(window({ when: { at: ['prep'], rounds: { every: 0 } } }))), ['PLUGIN_OFFER_ROUNDS']);
  assert.deepEqual(codes(read(window({ when: { at: ['combat'] } }))), ['PLUGIN_OFFER_SHAPE'], 'only the host\'s own moments');
  assert.deepEqual(codes(read(window({ quorum: 'some' }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ onTimeout: 'random' }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ defer: ['combat'] }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ offer: 2 }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ id: 'Early Pick' }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ options: undefined }))), ['PLUGIN_OFFER_SHAPE']);
  for (const at of OFFER_WHEN) assert.deepEqual(read(window({ when: { at: [at] } })).problems, [], at);
  for (const q of OFFER_QUORUM) assert.deepEqual(read(window({ quorum: q })).problems, [], q);
  for (const t of OFFER_TIMEOUT) assert.deepEqual(read(window({ onTimeout: t })).problems, [], t);
});

test('a shared (room-wide) set of options and the value a pick applies', () => {
  const shared = read(window({ shared: { enemy: { slots: 3, refresh: { perSlot: 0 } }, player: { slots: 1 } } }));
  assert.deepEqual(shared.problems, []);
  assert.deepEqual(Object.keys(shared.offer.shared), OFFER_NAMES);
  assert.deepEqual(shared.offer.shared.enemy, { slots: 3, refresh: { perSlot: 0 } });
  assert.equal(shared.offer.shared.player.refresh, null);
  assert.deepEqual(codes(read(window({ shared: { enemy: { slots: 7 } } }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ shared: { enemy: { slots: 3, refresh: { perSlot: 9 } } } }))), ['PLUGIN_OFFER_SHAPE']);
  assert.deepEqual(codes(read(window({ shared: {} }))), ['PLUGIN_OFFER_SHAPE']);
  // an unknown shared name is a warning: the window still opens
  const odd = read(window({ shared: { monsters: { slots: 2 } } }));
  assert.deepEqual(odd.problems, []);
  assert.equal(odd.warnings.length, 1);
  for (const apply of OFFER_EFFECTS.map((k) => ({ [k]: k === 'layers' ? { bond: 'b', count: 1 } : k === 'item' || k === 'chess' ? 'x' : k === 'effect' ? { id: 'x' } : 1 }))) {
    assert.deepEqual(read(window({ apply })).problems, [], JSON.stringify(apply));
  }
  assert.deepEqual(codes(read(window({ apply: { funds: 1, layers: { bond: 'b', count: 1 } } }))), ['PLUGIN_OFFER_SHAPE'], 'one primitive per pick');
  assert.deepEqual(codes(read(window({ apply: { run() {} } }))), ['PLUGIN_OFFER_SHAPE'], 'never code');
});

test('the options source is a .json inside the plugin folder (never a path out of it, never code)', () => {
  assert.deepEqual(read(window({ options: { source: 'lib/cards.json' } })).problems, []);
  for (const source of ['../cards.json', 'lib/../../x.json', '/etc/passwd', 'lib\\cards.json', 'C:/x.json', 'lib/cards.js', '']) {
    assert.deepEqual(codes(read(window({ options: { source } }))), ['PLUGIN_OFFER_SHAPE'], source);
  }
  // a field this build does not read is a warning, not a problem: a level-2 manifest stays loadable
  const tiers = read(window({ options: { source: 'lib/c.json', tiers: { 1: 'prep' } } }));
  assert.deepEqual(tiers.problems, []);
  assert.equal(tiers.warnings.length, 1);
  const unknown = read(window({ broadcast: true }));
  assert.deepEqual(unknown.problems, []);
  assert.equal(unknown.warnings.length, 1);
});

test('the part is read off a plugin folder like every other part, and a bad window keeps the plugin out', () => {
  // the folder name is the plugin id, so the plugin gets a folder of its own inside the temporary one
  const dir = path.join(tmpdir('folder'), 'demo');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = (extra = {}) => ({
    manifest: 2, id: 'demo', name: { zh: '窗口', en: 'Windows' }, version: '1.0.0', app: '*', api: 2,
    class: 'content', scope: ['room'], permissions: ['offers'], offers: ['offers/early-pick.json'], ...extra,
  });
  put(dir, 'plugin.json', manifest());
  put(dir, 'offers/early-pick.json', window());
  put(dir, 'lib/cards.json', { cards: [] });
  const good = readPluginFolder(dir, { app: '0.3.0' });
  assert.deepEqual(good.problems, [], JSON.stringify(good.problems));
  assert.equal(good.plugin.offers.length, 1);
  assert.equal(good.plugin.offers[0].id, 'early-pick');
  // the part's bytes are declared paths: they are checked and hashed like a data part's
  assert.ok(good.plugin.offers[0].rel.endsWith('offers/early-pick.json'));
  // a bad window is a problem of the folder, so the plugin is skipped with a reason
  put(dir, 'offers/early-pick.json', window({ when: { at: ['prep'], rounds: 'sometimes' } }));
  const bad = readPluginFolder(dir, { app: '0.3.0' });
  assert.equal(bad.plugin, null);
  assert.deepEqual(bad.issues.filter((i) => i.code === 'PLUGIN_OFFER_ROUNDS').length, 1);
  // two files the manifest names with the same window id
  put(dir, 'plugin.json', manifest({ offers: ['offers/early-pick.json', 'offers/second.json'] }));
  put(dir, 'offers/early-pick.json', window());
  put(dir, 'offers/second.json', window({ id: 'early-pick' }));
  const dup = readPluginFolder(dir, { app: '0.3.0', where: 'x', vanilla: { manifest: null, sha256: null } });
  assert.equal(dup.plugin, null);
  assert.ok(dup.issues.some((i) => i.code === 'PLUGIN_OFFER_SHAPE' && /named once/.test(i.text)), JSON.stringify(dup.issues.map((i) => i.text)));
});

test('the part belongs to the data classes and needs the offers permission (manifest.js PARTS / PERMISSIONS)', async () => {
  const { PERMISSIONS, MANIFEST_FIELDS, readPluginManifest } = await import('../../shared/plugins/manifest.js');
  assert.deepEqual(PERMISSIONS.offers, ['content', 'script', 'trusted']);
  assert.ok(MANIFEST_FIELDS.includes('offers'));
  const ctx = (id) => ({ id, app: '0.3.0' });
  const base = { manifest: 2, version: '1.0.0', app: '*', api: 2, scope: ['room'], offers: ['o.json'] };
  const missing = readPluginManifest({ ...base, class: 'content', permissions: [] }, ctx('demo'));
  assert.ok(missing.problems.some((p) => /PLUGIN_PERMISSION|offers/.test(p)));
  const cosmetic = readPluginManifest({ ...base, class: 'cosmetic', permissions: ['offers'] }, ctx('demo'));
  assert.ok(cosmetic.problems.length > 0, 'a cosmetic plugin carries no offer');
  const ok = readPluginManifest({ ...base, class: 'content', permissions: ['offers'] }, ctx('demo'));
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.manifest.parts.offers.files, ['o.json']);
});

test('the schema names the part and the level, and the frozen API table carries the new names', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/plugin.schema.json'), 'utf8'));
  assert.equal(schema.properties.api.maximum, 2);
  const api = fs.readFileSync(path.join(ROOT, 'docs/PLUGIN-API.md'), 'utf8');
  for (const row of ['manifest.field.offers', 'permission.offers', 'error.PLUGIN_OFFER_SHAPE', 'error.PLUGIN_OFFER_ROUNDS']) {
    assert.match(api, new RegExp(`\\| \`${row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` \\|`), row);
  }
  // and the document that explains it exists where the catalogue points
  const doc = fs.readFileSync(path.join(ROOT, 'docs/PLUGINS.md'), 'utf8');
  assert.match(doc, /^## 10b\. Offers/m);
});
