// test/data-versions.test.js — the official versions' data (docs/DATA.md "Official versions (M0)"): the registry
// shared/versions.js, the build profiles tools/versions/<slug>.mjs, the committed data/versions/<slug>/ directories, the
// build CLI's --version, the field adapters, and server/data.js's per-version loader. The default version's bytes are
// guarded by test/versions-default-guard.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DEFAULT_VERSION, VERSIONS, versionById, versionSlug, versionOfData } from '../shared/versions.js';
import { loadProfile, pinGroupOf, pinnedShaOf } from '../tools/versions/profiles.mjs';
import { bondActiveType, selfBackupPreset, applyAdapters } from '../tools/versions/adapters.mjs';
import { validateReferences } from '../shared/plugins/validate.js';
import { DATA_DIR, VERSION_DATA_FILES, getData, getVersionData, loadData, resetVersionData, versionDataDir } from '../server/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'tools', 'build-data.mjs');
const CACHE = join(ROOT, '.cache', 'gamedata');
const EN = JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', 'en.json'), 'utf8'));
/** The 15 files tools/build-data.mjs builds, plus the copy of data/tuning.json. */
const BUILT = ['backups', 'bands', 'bonds', 'bosses', 'chess', 'choices', 'config', 'effects', 'enemies', 'factions', 'garrisons',
  'items', 'stages', 'tokens', 'waves'];
const OTHERS = VERSIONS.filter((v) => v.id !== DEFAULT_VERSION);
const REBUILD_ALL = `rebuild every version: ${VERSIONS.map((v) => `node tools/build-data.mjs --version ${v.id}`).join('; ')} `
  + '(a version also reads data/assets.json, data/tuning.json and docs/research/*.json, so a default-side change to those can make it stale)';
/**
 * The expected counts of each non-default build, written out (DESIGN §36.3), independent of the
 * profile's `expect` / `config` that the build and validateAll read: a typo in a profile fails here.
 */
const PINNED = Object.freeze({
  act1autochess: { bonds: 18, bands: 30, visibleNonDiy: 95, chess: 200, items: 89, effects: 281, hiddenCore: [300, 1000] },
  'act1autochess@V1_1': { bonds: 18, bands: 20, visibleNonDiy: 95, chess: 200, items: 89, effects: 279, hiddenCore: [300, 1000] },
});

const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
const runBuild = (args, timeout = 180_000) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', timeout });

// ---------------------------------------------------------------------------------------------------
// registry and profiles
// ---------------------------------------------------------------------------------------------------

test('registry: unique ids, one default with dir \'\', OS-safe unique dirs, msgid labels, a matching profile each', async () => {
  const ids = VERSIONS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Object.isFrozen(VERSIONS) && VERSIONS.every((v) => Object.isFrozen(v)));
  const defaults = VERSIONS.filter((v) => v.dir === '');
  assert.deepEqual(defaults.map((v) => v.id), [DEFAULT_VERSION]);
  const dirs = OTHERS.map((v) => v.dir.toLowerCase());
  assert.equal(new Set(dirs).size, dirs.length, 'dirs unique case-insensitively');
  for (const v of OTHERS) assert.match(v.dir, /^versions\/[a-z0-9][a-z0-9_-]*\/$/, v.id);
  assert.ok(!VERSIONS.some((v) => v.id === 'act1vautochess'), 'the 2024 卫戍协议 is not a version (maintainer, 2026-10-22)');
  for (const v of VERSIONS) {
    assert.ok(EN[v.label], `public/i18n/en.json lacks the label ${v.label}`);
    assert.equal(versionById(v.id), v);
    assert.ok(existsSync(join(ROOT, 'tools', 'versions', `${versionSlug(v)}.mjs`)), `profile of ${v.id}`);
    const { entry, profile } = await loadProfile(v.id);
    assert.equal(entry, v);
    assert.equal(profile.id, v.id);
    assert.equal(profile.season, v.season);
  }
  assert.equal(versionSlug(versionById(DEFAULT_VERSION)), DEFAULT_VERSION);
  assert.equal(versionSlug(versionById('act1autochess@V1_1')), 'act1autochess-v1_1');
  assert.equal(versionById('nope'), null);
  assert.equal(versionOfData({ config: { version: { id: 'act1autochess' } } }), 'act1autochess');
  assert.equal(versionOfData({ config: {} }), DEFAULT_VERSION);
  assert.equal(versionOfData(null), DEFAULT_VERSION);
  await assert.rejects(loadProfile('act1vautochess'), /unknown version/);
});

test('profiles: the default is today\'s build; pins pick a commit per file group', async () => {
  const { profile: def } = await loadProfile(DEFAULT_VERSION);
  assert.equal(def.pins, null);
  assert.deepEqual(def.adapters, []);
  assert.equal(def.tables, 'default');
  assert.deepEqual(def.config.hiddenCore, { single: 350, multi: 1200 });
  assert.equal(def.config.rules, undefined, 'no rules: the default build emits no config.version');
  assert.deepEqual(def.expect, { bonds: 23, bands: 40, visibleNonDiy: 112, triggerDeviations: 'default' });
  assert.equal(pinnedShaOf(def, 'excel/activity_table.json'), null);

  const { profile: v12 } = await loadProfile('act1autochess');
  assert.equal(pinnedShaOf(v12, 'excel/activity_table.json'), '21b1f240817dafe486653adda7a5085ff8a1ba17');
  assert.equal(pinnedShaOf(v12, 'levels/activities/act1autochess/level_act1autochess_01.json'), '21b1f240817dafe486653adda7a5085ff8a1ba17');
  assert.equal(pinnedShaOf(v12, 'levels/enemydata/enemy_database.json'), 'ee2cabffd45de01548cc6dceb23129ce93ac7926');
  assert.equal(pinnedShaOf(v12, 'excel/enemy_handbook_table.json'), 'ee2cabffd45de01548cc6dceb23129ce93ac7926');
  const { profile: v11 } = await loadProfile('act1autochess@V1_1');
  assert.deepEqual(Object.keys(v11.pins), ['default'], 'V1_1 has no enemy pin: V1_2\'s ee2cabff would leak V1_2 enemies');
  for (const rel of ['excel/activity_table.json', 'excel/skill_table.json', 'levels/enemydata/enemy_database.json']) {
    assert.equal(pinnedShaOf(v11, rel), '8303c922f749f0dcf08e03671519421ef6a7748b', rel);
  }
  assert.equal(pinGroupOf('excel/uniequip_table.json'), 'character');
  assert.equal(pinGroupOf('excel/range_table.json'), 'range');
  assert.equal(pinGroupOf('levels/activities/act2autochess/level_act2autochess_m01.json'), 'levels');
  assert.equal(pinGroupOf('excel/item_table.json'), null);
});

// ---------------------------------------------------------------------------------------------------
// the committed version directories
// ---------------------------------------------------------------------------------------------------

for (const v of OTHERS) {
  test(`data/${v.dir}: the 16 files, under 6 MB, config.version, the profile's counts, no effectRef, no TAKE_DAMAGE row, references resolve`, async () => {
    const { profile } = await loadProfile(v.id);
    const dir = join(ROOT, 'data', v.dir);
    const names = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    assert.deepEqual(names, [...BUILT, 'tuning'].sort(), 'exactly the 15 built files and tuning.json');
    for (const n of VERSION_DATA_FILES) assert.ok(names.includes(n), `${n}.json: server/data.js VERSION_DATA_FILES expects it`);
    const total = BUILT.reduce((n, f) => n + statSync(join(dir, `${f}.json`)).size, 0);
    assert.ok(total < 6 * 1024 * 1024, `${v.id}: ${total} bytes`);
    const f = Object.fromEntries(BUILT.map((n) => [n, readJson(dir, n)]));
    assert.equal(f.config.version?.id, v.id);
    assert.equal(f.config.version.family, v.family);
    assert.deepEqual(f.config.version.rules, profile.config.rules ?? {});
    assert.equal(Object.keys(f.config).at(-1), 'version', 'config.version is the last key');
    assert.equal(f.config.season, v.season);
    assert.equal(f.config.hiddenCore.single, profile.config.hiddenCore.single);
    assert.equal(f.config.hiddenCore.multi, profile.config.hiddenCore.multi);
    // 上半's constData has no singleReconnectTime (12e0a020 added it): null, never the 下半 value (server/lobby.js falls back)
    if (v.season === 'act1autochess') assert.equal(f.config.constants.singleReconnectTime, null, 'no 下半 constant as official data');
    assert.equal(Object.keys(f.bonds).length, profile.expect.bonds);
    assert.equal(Object.keys(f.bands).length, profile.expect.bands);
    assert.equal(Object.values(f.chess).filter((c) => !c.isGolden && c.visible).length, profile.expect.visibleNonDiy);
    const pin = PINNED[v.id];
    assert.ok(pin, `${v.id}: pin its counts in PINNED`);
    assert.deepEqual({
      bonds: Object.keys(f.bonds).length, bands: Object.keys(f.bands).length,
      visibleNonDiy: Object.values(f.chess).filter((c) => !c.isGolden && c.visible).length, chess: Object.keys(f.chess).length,
      items: Object.keys(f.items).length, effects: Object.keys(f.effects).length, hiddenCore: [f.config.hiddenCore.single, f.config.hiddenCore.multi],
    }, pin, `${v.id}: the pinned counts`);
    for (const [file, recs] of [['items', f.items], ['bands', f.bands]]) {
      for (const r of Object.values(recs)) assert.ok(!Object.hasOwn(r, 'effectRef'), `${file} ${r.id ?? r.bandId}: no effectRef (it would name a default-version id)`);
    }
    if (profile.expect.triggerDeviations === 'none') {
      const td = [];
      for (const c of Object.values(f.chess)) for (const s of c.skills || []) if (s.trigger?.rawRule === 'TAKE_DAMAGE') td.push(`${c.chessId} ${s.skillId}`);
      for (const [id, u] of Object.entries(f.backups.units)) for (const [k, form] of Object.entries(u.forms)) for (const s of form.skills) if (s.trigger?.rawRule === 'TAKE_DAMAGE') td.push(`${id}@${k} ${s.skillId}`);
      assert.deepEqual(td, [], 'no TAKE_DAMAGE row, so no trigger deviation applies');
    }
    assert.ok(readFileSync(join(dir, 'tuning.json')).equals(readFileSync(join(ROOT, 'data', 'tuning.json'))), 'tuning.json is a byte copy of data/tuning.json');
    assert.deepEqual(validateReferences(f), []);
  });

  test(`data/${v.dir}: an offline rebuild reproduces all 16 files byte for byte`, { skip: process.env.DATA_DIR && 'DATA_DIR set' }, async (t) => {
    const { profile } = await loadProfile(v.id);
    const shas = [...new Set(Object.values(profile.pins || {}))];
    const out = mkdtempSync(join(tmpdir(), 'sp-version-'));
    try {
      const r = runBuild(['--version', v.id, '--offline', '--quiet', '--out', out, '--report', join(out, 'r.json')]);
      if (r.status !== 0 && /missing cached file/.test(r.stderr)) {
        t.skip(`${v.id}: official data not cached (${shas.map((s) => `.cache/gamedata@${s}/`).join(', ')}; run node tools/build-data.mjs --version ${v.id} once online)`);
        return;
      }
      assert.equal(r.status, 0, `${v.id}: build failed: ${r.stderr}`);
      const dir = join(ROOT, 'data', v.dir);
      for (const n of [...BUILT, 'tuning']) {
        assert.ok(readFileSync(join(out, `${n}.json`)).equals(readFileSync(join(dir, `${n}.json`))), `data/${v.dir}${n}.json is stale — ${REBUILD_ALL}`);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
}

test('--version act2autochess --offline reproduces data/*.json (the default profile is today\'s build)', { skip: (!existsSync(join(CACHE, 'excel', 'activity_table.json')) && 'no .cache/gamedata') || (process.env.DATA_DIR && 'DATA_DIR set') }, (t) => {
  const out = mkdtempSync(join(tmpdir(), 'sp-version-'));
  try {
    const r = runBuild(['--version', DEFAULT_VERSION, '--offline', '--quiet', '--out', out, '--report', join(out, 'r.json')]);
    if (r.status !== 0 && /missing cached file/.test(r.stderr)) { t.skip('partial .cache/gamedata'); return; }
    assert.equal(r.status, 0, r.stderr);
    for (const n of BUILT) assert.ok(readFileSync(join(out, `${n}.json`)).equals(readFileSync(join(ROOT, 'data', `${n}.json`))), `data/${n}.json`);
    assert.ok(!existsSync(join(out, 'tuning.json')), 'the default build writes no tuning.json (data/tuning.json is hand-maintained)');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('build CLI: --version without a value or with an unknown id exits 2 with the usage and writes nothing', () => {
  for (const args of [['--version'], ['--version', '--offline'], ['--version', 'act1vautochess'], ['--version=bogus']]) {
    const out = mkdtempSync(join(tmpdir(), 'sp-version-'));
    try {
      const r = runBuild([...args, '--out', join(out, 'o'), '--report', join(out, 'r.json')], 30_000);
      assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status} ${r.stderr}`);
      assert.match(r.stderr, /usage:/);
      assert.match(r.stderr, /act1autochess@V1_1/, 'the valid ids are listed');
      assert.deepEqual(readdirSync(out), [], 'nothing written');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------------------------------
// server/data.js
// ---------------------------------------------------------------------------------------------------

test('server/data.js: versionDataDir and getVersionData; loadData(DATA_DIR) never reads data/versions', () => {
  resetVersionData();
  assert.equal(versionDataDir(), DATA_DIR);
  assert.equal(versionDataDir(DEFAULT_VERSION), DATA_DIR);
  assert.equal(versionDataDir('act1autochess'), join(DATA_DIR, 'versions', 'act1autochess'));
  assert.equal(versionDataDir('act1autochess@V1_1', '/x'), join('/x', 'versions', 'act1autochess-v1_1'));
  assert.equal(versionDataDir('nope'), null);
  assert.equal(getVersionData(DEFAULT_VERSION), getData());
  const quiet = { warn() {}, error() {}, info() {} };
  const a = getVersionData('act1autochess', { log: quiet });
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.chess));
  assert.equal(a.config.version.id, 'act1autochess');
  assert.equal(versionOfData(a), 'act1autochess');
  assert.equal(getVersionData('act1autochess'), a, 'cached');
  assert.equal(versionOfData(getVersionData('act1autochess@V1_1', { log: quiet })), 'act1autochess@V1_1');
  assert.ok(!Object.hasOwn(loadData(DATA_DIR, { log: quiet }), 'versions'));
  assert.equal(versionOfData(getData()), DEFAULT_VERSION);
  assert.throws(() => getVersionData('nope'), RangeError);
  resetVersionData();
  assert.notEqual(getVersionData('act1autochess', { log: quiet }), a, 'reloaded after resetVersionData');
  resetVersionData();
});

// ---------------------------------------------------------------------------------------------------
// adapters
// ---------------------------------------------------------------------------------------------------

test('adapter bondActiveType: the three 上半 shapes become 下半\'s activeCondition; 下半 rows are left alone; unknown shapes throw', () => {
  const act = { bondInfoDict: {
    investShip: { activeType: 'ALL', isActiveInDeck: true, activeCount: 3 },
    yanShip: { activeType: 'BATTLE', isActiveInDeck: false, activeCount: 3 },
    maniShip: { activeType: 'MANI', isActiveInDeck: false, activeCount: 1 },
    soloShip: { activeType: 'BATTLE', isActiveInDeck: false, activeCount: 1, activeCondition: 'BOARD', activeConditionTemplate: 'count_threshold_downward', activeParamList: ['1', '2'], maxInactiveBondCount: -1 },
  } };
  const before = JSON.stringify(act.bondInfoDict.soloShip);
  bondActiveType(act);
  const pick = (b) => [b.activeCondition, b.activeConditionTemplate, b.activeParamList, b.maxInactiveBondCount];
  assert.deepEqual(pick(act.bondInfoDict.investShip), ['BOARD_AND_DECK', 'count_threshold_upward', ['3'], -1]);
  assert.deepEqual(pick(act.bondInfoDict.yanShip), ['BOARD', 'count_threshold_upward', ['3'], -1]);
  assert.deepEqual(pick(act.bondInfoDict.maniShip), ['BOARD', 'count_threshold_upward', ['1'], -1]);
  assert.equal(JSON.stringify(act.bondInfoDict.soloShip), before, 'a 下半 row is a no-op');
  assert.throws(() => bondActiveType({ bondInfoDict: { x: { activeType: 'ALL', isActiveInDeck: false, activeCount: 2 } } }), /unknown shape/);
  assert.throws(() => bondActiveType({ bondInfoDict: { x: { activeType: 'BATTLE', isActiveInDeck: false } } }), /unknown shape/);
});

test('adapter selfBackupPreset: a NORMAL row backing itself up becomes a PRESET with its default skill and module; others untouched', () => {
  const act = { charShopChessDatas: {
    chess_char_1_15_a: { chessType: 'NORMAL', charId: 'char_616_pithst', backupCharId: 'char_616_pithst', defaultSkillIndex: 0, defaultUniEquipId: 'uniequip_002_pithst', backupCharSkillIndex: 0, backupCharUniEquipId: null },
    chess_char_1_01_a: { chessType: 'NORMAL', charId: 'char_x', backupCharId: 'char_600_cpione', defaultSkillIndex: 0, backupCharUniEquipId: null },
    chess_char_1_02_a: { chessType: 'PRESET', charId: 'char_y', backupCharId: 'char_y', defaultSkillIndex: 1, defaultUniEquipId: 'u', backupCharSkillIndex: 1, backupCharUniEquipId: 'u' },
    chess_char_1_03_a: { chessType: 'DIY', charId: null, backupCharId: null },
  } };
  const others = JSON.stringify([act.charShopChessDatas.chess_char_1_01_a, act.charShopChessDatas.chess_char_1_02_a, act.charShopChessDatas.chess_char_1_03_a]);
  applyAdapters(act, ['selfBackupPreset']);
  const r = act.charShopChessDatas.chess_char_1_15_a;
  assert.deepEqual([r.chessType, r.backupCharSkillIndex, r.backupCharUniEquipId], ['PRESET', 0, 'uniequip_002_pithst']);
  assert.equal(JSON.stringify([act.charShopChessDatas.chess_char_1_01_a, act.charShopChessDatas.chess_char_1_02_a, act.charShopChessDatas.chess_char_1_03_a]), others);
  assert.throws(() => selfBackupPreset({ charShopChessDatas: { x: {} } }), /no chessType/);
  assert.throws(() => applyAdapters(act, ['noAbyss']), /unknown adapter/);
});

// ---------------------------------------------------------------------------------------------------
// the pools by effectId / charId
// ---------------------------------------------------------------------------------------------------

test('pools: resolving by the normal item\'s effectId and the operator\'s charId gives today\'s data/choices.json ids', () => {
  const items = readJson(join(ROOT, 'data'), 'items');
  const chess = readJson(join(ROOT, 'data'), 'chess');
  const pools = readJson(join(ROOT, 'data'), 'choices').pools;
  const src = readFileSync(BUILD, 'utf8');
  const equip = Object.values(items).filter((i) => i.itemType === 'EQUIP' && !i.isGolden);
  const byEffect = (e) => { assert.ok(src.includes(`'${e}'`), `tools/build-data.mjs names ${e}`); return equip.find((i) => i.effectId === e)?.id ?? null; };
  const byChar = (c) => {
    assert.ok(src.includes(`'${c}'`), `tools/build-data.mjs names ${c}`);
    return Object.values(chess).find((x) => !x.isGolden && x.visible && x.charId === c)?.chessId
      ?? Object.values(chess).find((x) => !x.isGolden && x.charId === c)?.chessId ?? null;
  };
  assert.deepEqual(pools.pool_equip_kathe.also, ['eff_acarm072'].map(byEffect));
  assert.deepEqual(pools.pool_equip_vict.items, ['eff_acarm042', 'eff_acarm043', 'eff_acarm044', 'eff_acarm045'].map(byEffect));
  assert.deepEqual(pools.pool_equip_pepe.weighted, [['eff_acarm066', 45], ['eff_acarm050', 45], ['eff_acarm103', 10]].map(([e, w]) => [byEffect(e), w]));
  assert.deepEqual(pools.pool_equip_rockr.weighted, [['eff_acarm041', 10], ['eff_acarm045', 2], ['eff_acarm043', 2], ['eff_acarm044', 2], ['eff_acarm042', 2],
    ['eff_acarm052', 1], ['eff_acarm061', 4], ['eff_acarm053', 4]].map(([e, w]) => [byEffect(e), w]));
  assert.deepEqual(pools.pool_chess_glady.items, ['char_263_skadi', 'char_143_ghost', 'char_4137_udflow'].map(byChar));
  assert.deepEqual(pools.pool_char_pinus.weighted, [['char_496_wildmn', 10], ['char_431_ashlok', 10], ['char_430_fartth', 3]].map(([c, w]) => [byChar(c), w]));
  // the shop-excluded items are the same five, keyed by effectId
  assert.deepEqual(equip.filter((i) => i.shopExcluded).map((i) => i.effectId).sort(), ['eff_acarm042', 'eff_acarm043', 'eff_acarm044', 'eff_acarm045', 'eff_acarm072']);
});
