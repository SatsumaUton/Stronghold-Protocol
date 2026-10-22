// Versions M0 (docs/SIM.md §7.2): hand-written behaviour is found by the operator's charId and the item's effectId, not
// by the default data's chess / item ids — another official version (上半, act1autochess) gives 50 of its 100 chess ids
// and most item ids to other operators and effects. Every data directory checked here — data/, every data/versions/*/
// with a chess.json, and the directories of SP_VERSION_DATA_DIRS (path.delimiter-separated, e.g. a dry build) — must:
//   * resolve every chess to a kit written for its own charId, or list its charId in PENDING_KIT_CHARS (generic kit);
//   * dispatch every item to the handler of its own effectId, and bind the meta overrides to its own item keys.
// The default data must keep exactly the old lookups (test/fixtures/versions-keying-baseline.json, generated on db8e226d
// before the change). Also: a missing bond threshold is not reached (炎 without its 9-member tier), 远牙's granted trait,
// 夕's generic dragon and the AI's community / i18n overlays follow the data, not the default ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, getData, setData, resetData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { KITS, officialKitKey } from '../server/sim/content/index.js';
import { KIT_CHAR_IDS, KIT_FILES, TIER_KITS, TIER_KIT_KEYS_BY_CHAR, PENDING_KIT_CHARS } from '../server/sim/content/kits/index.js';
import { setGameData, itemEffectKey, itemIdsWithEffect, isMutationCell } from '../server/sim/content/support/index.js';
import { BATTLE_EFFECT_IDS, battleEffectOf, hasBattleEffect } from '../server/sim/content/items/battle.js';
import { itemMetaBindings } from '../server/sim/content/items/meta.js';
import { createRegistry, resetDefaultRegistry } from '../server/match/effectsMeta.js';
import { genericKit } from '../server/sim/content/generic.js';
import { TOKEN_IDS } from '../server/sim/content/tokens.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from './helpers/battleHarness.js';
import { buildPlaybook } from '../server/ai/playbook.js';
import { knowledgePack } from '../server/ai/knowledge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const BASELINE = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/versions-keying-baseline.json'), 'utf8'));
const DEFAULT_DIR = path.join(ROOT, 'data');

/** data/, every data/versions/<id>/ with a chess.json, and SP_VERSION_DATA_DIRS. */
const DIRS = (() => {
  const out = [DEFAULT_DIR];
  const vdir = path.join(ROOT, 'data', 'versions');
  if (existsSync(vdir)) {
    for (const e of readdirSync(vdir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && existsSync(path.join(vdir, e.name, 'chess.json'))) out.push(path.join(vdir, e.name));
    }
  }
  for (const d of String(process.env.SP_VERSION_DATA_DIRS || '').split(path.delimiter).filter(Boolean)) out.push(path.resolve(d));
  return out;
})();
const label = (dir) => path.relative(ROOT, dir) || dir;
const isDefault = (dir) => dir === DEFAULT_DIR;
const cache = new Map();
const dataOf = (dir) => {
  if (!cache.has(dir)) cache.set(dir, isDefault(dir) ? getData({ log: QUIET }) : loadData(dir, { log: QUIET }));
  return cache.get(dir);
};

/** The behaviour of each default item key (C in the plan): BY_ITEM key → effectId. */
const BATTLE_KEY_TO_EFFECT = Object.freeze({
  chess_item_3_02_e: 'eff_acarm063', chess_item_3_04_e: 'eff_acarm040', chess_item_3_05_e: 'eff_acarm051',
  chess_item_3_06_e: 'eff_acarm049', chess_item_3_11_e: 'eff_acarm064', chess_item_4_03_e: 'eff_acarm052',
  chess_item_4_04_e: 'eff_acarm055', chess_item_4_05_e: 'eff_acarm060', chess_item_4_06_e: 'eff_acarm065',
  chess_item_4_07_e: 'eff_acarm119', chess_item_4_08_e: 'eff_acarm057', chess_item_4_10_e: 'eff_acarm059',
  chess_item_4_11_e: 'eff_acarm061', chess_item_4_12_e: 'eff_acarm068', chess_item_5_01_e: 'eff_acarm058',
  chess_item_5_02_e: 'eff_acarm062', chess_item_5_03_e: 'eff_acarm067', chess_item_5_09_e: 'eff_acarm118',
  chess_item_6_01_e: 'eff_acarm117', chess_item_6_02_e: 'eff_acarm076', chess_item_6_03_e: 'eff_acarm077',
  chess_item_6_04_e: 'eff_acarm078', chess_item_6_05_e: 'eff_acarm079', chess_item_6_06_e: 'eff_acarm102',
  chess_item_6_07_e: 'eff_acarm103', chess_item_6_10_e: 'eff_acarm120', chess_item_6_11_e: 'eff_acarm122',
});
/** The default key of each items/meta.js override → its effectId. */
const META_KEY_TO_EFFECT = Object.freeze({
  chess_item_2_02_e: 'eff_acarm115', chess_item_4_01_e: 'eff_acarm075', chess_item_6_03_m: 'eff_acchal',
  chess_item_6_01_m: 'eff_acdisney', chess_item_6_02_m: 'eff_accopy', chess_item_6_03_e: 'eff_acarm077',
});

const tierOfKey = (key) => Number(/^chess_char_(\d+)_/.exec(key)?.[1]);
/** The by-id lookup before versions M0 (content/index.js registeredKit): baseId, exact id, suffix-less id. */
function oldKitKey(def) {
  if (!def) return null;
  if ((def.standInFor && def.charId && def.charId !== def.standInFor) || (def.diyFor && def.charId)) return Object.hasOwn(KITS, def.charId) ? def.charId : null;
  const bare = String(def.baseId ?? def.id ?? '').replace(/_[ab]$/, '');
  return [def.baseId, def.id, bare].find((k) => k != null && Object.hasOwn(KITS, k) && KITS[k]) ?? null;
}
/** Every chess def of a data directory (DataSource over that data alone). */
function defsOf(data) {
  const ds = new DataSource(data, null);
  return Object.keys(data.chess || {}).sort().map((id) => ({ id, rec: data.chess[id], def: ds.getChess(id) }));
}
/** The normal record of an item key (`<key>_a`, or the key itself for an Art). */
const normalOf = (items, key) => items[`${key}_a`] ?? items[key] ?? null;
const hooksOf = (h) => Object.keys(h).filter((n) => typeof h[n] === 'function').sort();
const clone = (v) => JSON.parse(JSON.stringify(v));

// =====================================================================================================================
// kits

test('KIT_CHAR_IDS: exactly the tier kit keys, in KIT_FILES order, matching data/chess.json and each kit file\'s header', () => {
  const tierKeys = TIER_KITS.flatMap((reg) => Object.keys(reg));
  assert.deepEqual(Object.keys(KIT_CHAR_IDS), tierKeys);
  const chess = dataOf(DEFAULT_DIR).chess;
  for (const [key, charId] of Object.entries(KIT_CHAR_IDS)) assert.equal(chess[key]?.charId, charId, key);
  const files = KIT_FILES.flat();
  assert.equal(files.length, tierKeys.length);
  for (const file of files) {
    const key = `${file.split('-')[0]}_a`;
    const head = readFileSync(path.join(ROOT, 'server/sim/content/kits/ops', file), 'utf8').split('\n')[0];
    assert.equal(/\((char_[0-9a-z]+_[0-9a-z]+)\)/.exec(head)?.[1], KIT_CHAR_IDS[key], `${file} header`);
  }
  for (const [charId, keys] of Object.entries(TIER_KIT_KEYS_BY_CHAR)) for (const k of keys) assert.equal(KIT_CHAR_IDS[k], charId);
});

test('PENDING_KIT_CHARS: operators without any kit (one that gets a kit leaves the list)', () => {
  assert.equal(new Set(PENDING_KIT_CHARS).size, PENDING_KIT_CHARS.length);
  for (const c of PENDING_KIT_CHARS) {
    assert.ok(!TIER_KIT_KEYS_BY_CHAR[c] && !Object.hasOwn(KITS, c), `${c} has a kit now: remove it from PENDING_KIT_CHARS`);
  }
});

for (const dir of DIRS) {
  test(`kits of ${label(dir)}: every chess resolves to its own charId's kit, or is pending (generic)`, () => {
    const pending = new Set();
    let checked = 0;
    for (const { id, rec, def } of defsOf(dataOf(dir))) {
      if (rec.isDiy || rec.charId == null) continue;
      checked++;
      const key = officialKitKey(def);
      if (key) {
        assert.equal(KIT_CHAR_IDS[key] ?? key, def.charId, `${id} (${def.charId}) → ${key}`);
        const same = (TIER_KIT_KEYS_BY_CHAR[def.charId] ?? []).some((k) => tierOfKey(k) === def.tier);
        if (same) assert.equal(tierOfKey(key), def.tier, `${id}: the tier kit of its tier`);
      } else {
        assert.ok(PENDING_KIT_CHARS.includes(def.charId), `${id} (${def.charId}) has no kit and is not in PENDING_KIT_CHARS`);
        pending.add(def.charId);
      }
    }
    assert.ok(checked > 0);
    if (isDefault(dir)) assert.equal(pending.size, 0, 'the default data has no pending operator');
  });
}

test('kits of data/: the new lookup equals the by-id lookup for all 266 records', () => {
  const all = defsOf(dataOf(DEFAULT_DIR));
  assert.equal(all.length, 266);
  for (const { id, def } of all) assert.equal(officialKitKey(def), oldKitKey(def), id);
});

test('kits: a chess id given to another operator takes that operator\'s kit (or none); plugin chess keep the by-id lookup', () => {
  const ds = new DataSource(dataOf(DEFAULT_DIR), null);
  const yak = ds.getChess('chess_char_1_02_a');
  // 上半's chess_char_1_02_a is 讯使 (pending), its chess_char_5_12_a 林 (an op-* kit)
  assert.equal(officialKitKey({ ...yak, charId: 'char_198_blackd' }), null);
  assert.equal(officialKitKey({ ...ds.getChess('chess_char_5_12_a'), charId: 'char_4080_lin' }), 'char_4080_lin');
  // 锡人 at tier 2 under another id → chess_char_2_19_a; at an unknown tier → the first one
  assert.equal(officialKitKey({ ...yak, charId: 'char_4151_tinman', tier: 2 }), 'chess_char_2_19_a');
  assert.equal(officialKitKey({ ...yak, charId: 'char_4151_tinman', tier: 6 }), 'chess_char_1_16_a');
  // fixtures (charId defaults to the chess id) and plugin chess (forgeImport's ref:null keeps the generic kit)
  assert.equal(officialKitKey({ ...yak, charId: 'chess_char_1_02_a' }), 'chess_char_1_02_a');
  assert.equal(officialKitKey({ ...yak, id: 'chess_x_test_yak_a', baseId: 'chess_x_test_yak_a' }), null);
  assert.equal(officialKitKey({ ...yak, id: 'chess_x_test_yak_a', baseId: 'chess_x_test_yak_a', charId: 'char_300_phenxi' }), null);
});

// =====================================================================================================================
// items

test('BY_EFFECT: every key is a normal effectId of data/items.json; the 27 default handlers are all there', () => {
  const items = dataOf(DEFAULT_DIR).items;
  const normal = new Set(Object.values(items).filter((r) => r && (!r.baseId || r.baseId === r.id)).map((r) => r.effectId));
  for (const e of BATTLE_EFFECT_IDS) assert.ok(normal.has(e), e);
  assert.deepEqual([...BATTLE_EFFECT_IDS].sort(), BASELINE.battle.byItem.map((k) => BATTLE_KEY_TO_EFFECT[k]).sort());
});

for (const dir of DIRS) {
  test(`items of ${label(dir)}: each item runs the handler of its own effectId; the meta overrides bind its own keys`, (t) => {
    const data = dataOf(dir);
    setGameData(data);
    if (!isDefault(dir)) { setData(clone(data)); setGameData(null); }
    t.after(() => { setGameData(null); if (!isDefault(dir)) { resetData(); resetDefaultRegistry(); } });
    const items = data.items || {};
    const dispatch = {};
    for (const id of Object.keys(items).sort()) {
      const h = battleEffectOf(id);
      if (h) {
        dispatch[id] = h;
        const rec = items[id], normal = rec.baseId && rec.baseId !== id ? items[rec.baseId] : rec;
        assert.equal(h, normal.effectId, `${id}: its own effect`);
      }
    }
    for (const { effectId, keys } of itemMetaBindings()) {
      for (const key of keys) assert.equal(normalOf(items, key)?.effectId, effectId, `meta ${effectId} → ${key}`);
    }
    const reg = createRegistry({ log: QUIET });
    for (const { keys } of itemMetaBindings()) for (const key of keys) assert.ok(reg.has(`item:${key}`), key);
    for (const k of reg.keys().filter((x) => x.startsWith('item:'))) assert.ok(normalOf(items, k.slice(5)), `${k} names an item of this data`);
    if (isDefault(dir)) {
      const want = Object.fromEntries(Object.entries(BASELINE.battle.dispatch).map(([id, k]) => [id, BATTLE_KEY_TO_EFFECT[k]]));
      assert.deepEqual(dispatch, want, 'item → handler, as the baseline mapped by effectId');
      assert.deepEqual(Object.keys(items).sort().filter((id) => hasBattleEffect(items[id])), BASELINE.battle.battleEffect);
      const bound = itemMetaBindings().map((b) => [b.effectId, b.keys]);
      const wantBound = [...new Map(BASELINE.meta.wraps.map((w) => [META_KEY_TO_EFFECT[w.key], [w.key]]))];
      assert.deepEqual(bound, wantBound, 'the meta overrides bind the baseline keys');
      const keys = reg.keys().sort();
      assert.deepEqual(keys, BASELINE.registry.keys);
      assert.equal(keys.length, BASELINE.registry.count);
      for (const k of keys.filter((x) => x.startsWith('item:'))) assert.deepEqual(hooksOf(reg.get(k)), BASELINE.registry.itemHooks[k], k);
    }
  });
}

test('itemEffectKey: golden → normal effect; plugin records follow effectRef, without one they have no official behaviour', (t) => {
  const base = getData({ log: QUIET });
  setGameData({ ...base, items: {
    ...base.items,
    item_x_t_a: { id: 'item_x_t_a', effectRef: 'chess_item_3_02_e_a', effectId: 'eff_acarm063' },
    item_x_t_b: { id: 'item_x_t_b', effectId: 'eff_acarm063' },
    item_x_t_c: { id: 'item_x_t_c', effectRef: 'chess_item_5_08_e_a', effectId: 'eff_acarm072' },
  } });
  t.after(() => setGameData(null));
  assert.equal(itemEffectKey('chess_item_3_02_e_b'), 'eff_acarm063');
  assert.equal(itemEffectKey('item_x_t_a'), 'eff_acarm063');
  assert.equal(itemEffectKey('item_x_t_b'), null);
  assert.equal(battleEffectOf('item_x_t_a'), 'eff_acarm063');
  assert.equal(battleEffectOf('item_x_t_b'), null);
  assert.deepEqual(itemIdsWithEffect('eff_acarm063'), ['chess_item_3_02_e_a', 'chess_item_3_02_e_b']);
  assert.deepEqual(itemIdsWithEffect('eff_acarm063', { normalOnly: true }), ['chess_item_3_02_e_a']);
  // 凯瑟琳's allowance counts only the official normal cell
  assert.deepEqual(itemIdsWithEffect('eff_acarm072', { normalOnly: true }), ['chess_item_5_08_e_a']);
  assert.equal(isMutationCell(base.items.chess_item_5_08_e_a), true);
  assert.equal(isMutationCell(base.items.chess_item_5_08_e_b), false);
  assert.equal(isMutationCell({ id: 'item_x_t_c', effectRef: 'chess_item_5_08_e_a', effectId: 'eff_acarm072' }), false);
});

// =====================================================================================================================
// bonds, traits, tokens

test('reached(): 9 炎 whose record lacks ex_bond_char_cnt (no 9-member tier) spawn ONE 炎佑', (t) => {
  const data = clone(getData({ log: QUIET }));
  for (const b of data.bonds.yanShip.buffs) if (b.bb) delete b.bb.ex_bond_char_cnt;
  setGameData(data);
  t.after(() => setGameData(null));
  const ids = Array.from({ length: 9 }, (_, i) => `y${i}_a`);
  const chess = Object.fromEntries(ids.map((id) => [id, chessRec({ id, bonds: ['yanShip'], profession: 'WARRIOR', skill: null,
    stats: { atk: 1000, maxHp: 10000, def: 0, blockCnt: 2 } })]));
  const h = makeBattle({
    defs: { chess, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0 }) } },
    units: ids.map((chessId, i) => ({ chessId, row: 10 + Math.floor(i / 7), col: 3 + (i % 7) })),
    bonds: { yanShip: { count: 9, active: true, tier: 3, layers: 0 } },
  });
  h.step(1);
  assert.equal(h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.yanyou && u.alive).length, 1);
  checkInvariants(h.b);
});

test('远牙: the trait its own traits grant gains on dollSwap under other chess and garrison ids', (t) => {
  const data = clone(getData({ log: QUIET }));
  // another version's ids: 远牙 at chess_char_4_99, its trait garrison_901_a granting garrison_902_a (a copy of 108)
  const far = { ...data.chess.chess_char_4_20_a, chessId: 'chess_char_4_99_a', baseId: 'chess_char_4_99_a', goldenId: null, garrisonIds: ['garrison_901_a'] };
  data.chess.chess_char_4_99_a = far;
  data.garrisons.garrison_901_a = { ...data.garrisons.garrison_148_a, garrisonId: 'garrison_901_a', bbStr: { give_garrison_id: 'garrison_902_a' } };
  data.garrisons.garrison_902_a = { ...data.garrisons.garrison_108_a, garrisonId: 'garrison_902_a' };
  setGameData(data);
  t.after(() => setGameData(null));
  const bond = { count: 3, active: true, tier: 1, layers: 0 };
  const h = makeBattle({
    data: new DataSource(data, null),
    units: [{ chessId: 'chess_char_4_99_a', row: 10, col: 3 }, { chessId: 'chess_char_2_11_a', row: 10, col: 8 }],
    bonds: { kazimierzShip: bond, preciShip: bond }, autoFinish: false, timeLimit: 300,
  });
  h.step();
  const u = h.unit('chess_char_2_11_a');
  const gains = () => h.result().perPlayer.p1.layerGains;
  assert.deepEqual(gains(), { kazimierzShip: 4, preciShip: 4 }, 'initial deployment');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.trait.doll, 'the lethal hit switches to a substitute');
  assert.deepEqual(gains(), { kazimierzShip: 8, preciShip: 8 }, 'the switch gains');
  checkInvariants(h.b);
});

test('夕: her generic-kit dragon follows her charId (any official chess id), not a plugin chess', () => {
  const raw = new DataSource(getData({ log: QUIET }), null).rawChess('chess_char_5_12_a');
  for (const [id, want] of [['chess_char_5_99_a', true], ['chess_x_test_dusk_a', false]]) {
    const h = makeBattle({
      defs: { chess: { [id]: { ...raw, chessId: id, baseId: id, goldenId: null } }, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0 }) } },
      kits: { [id]: genericKit }, units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'e_dummy', pos: [10, 5] }],
      autoFinish: false, timeLimit: 30,
    });
    assert.equal(h.runUntil(() => h.b.allyUnits.some((u) => u.defId === TOKEN_IDS.duskDragon), 10), want, id);
    checkInvariants(h.b);
  }
});

// =====================================================================================================================
// AI

test('AI: another version\'s data gets no community evidence and no default-id i18n overlay', () => {
  const data = getData({ log: QUIET });
  const other = { ...data, config: { ...data.config, version: { id: 'act1autochess', family: 'act1autochess', rules: {} } } };
  const def = buildPlaybook(data, { modeId: 'mode_single_normal' });
  assert.ok(def.community.pairs.length || def.community.builds.length, 'the default keeps its community evidence');
  const pb = buildPlaybook(other, { modeId: 'mode_single_normal' });
  assert.deepEqual(pb.community, { revision: null, pairs: [], builds: [], roles: [] });
  const en = knowledgePack(other, { modeId: 'mode_single_normal', language: 'en' });
  assert.ok(en.operators.every((p) => p.name === p.nameZh), 'Chinese names');
  assert.ok(knowledgePack(data, { modeId: 'mode_single_normal', language: 'en' }).operators.some((p) => p.name !== p.nameZh));
});
