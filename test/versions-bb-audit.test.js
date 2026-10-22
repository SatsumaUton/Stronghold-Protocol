// tools/bb-audit.mjs (versions M0, docs/SIM.md §7.2): blackboard fields the code reads that another official version's
// data lacks, the buff keys the code names that it lacks, its skill trigger rules the engine does not implement, and the
// keys it carries that the default data lacks and no code names.
// Real version directories: every data/versions/*/ with a
// chess.json and the directories of SP_VERSION_DATA_DIRS (path.delimiter-separated, e.g. a dry build); none → skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, getData } from '../server/data.js';
import {
  audit, codeReads, codeBuffKeys, gaps, isNeutral, parseDefault, repoSources, unknownTriggerRules, versionOnlyKeys, NAME_DIRS,
} from '../tools/bb-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const VERSION_DIRS = (() => {
  const out = [];
  const vdir = path.join(ROOT, 'data', 'versions');
  if (existsSync(vdir)) {
    for (const e of readdirSync(vdir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && existsSync(path.join(vdir, e.name, 'chess.json'))) out.push(path.join(vdir, e.name));
    }
  }
  for (const d of String(process.env.SP_VERSION_DATA_DIRS || '').split(path.delimiter).filter(Boolean)) out.push(path.resolve(d));
  return out;
})();

const NAMES = codeBuffKeys(repoSources(ROOT, NAME_DIRS, []));
const raid = (bb) => ({ bonds: { raidShip: { buffs: [{ key: 'env_gbuff_new', bb, bbStr: { key: 'act1autochess_bond_eff_raid' } }] } } });

test('defaults: neutral = 0, null, undefined, false, \'\' or Infinity', () => {
  for (const t of ['0', 'null', 'undefined', 'false', "''", 'Infinity']) assert.ok(isNeutral(parseDefault(t)), t);
  for (const t of ['10', '1', '-1', 'true', '-Infinity', 'bb.x']) assert.ok(!isNeutral(parseDefault(t)), t);
  assert.equal(parseDefault('0.5'), 0.5);
});

test('a field the base has and the version lacks, read with a non-neutral default, is one finding', () => {
  const base = raid({ base_atk: 0.1, no_attack_duration: 10 });
  const version = raid({ base_atk: 0.2 });
  const reads = codeReads([{ file: 'x.js', text: 'const idle = num(bb.no_attack_duration, 10);\nconst a = num(bb.base_atk);' }]);
  assert.deepEqual(gaps(base, version), [{ table: 'bonds', key: 'raidShip', buff: 'act1autochess_bond_eff_raid', field: 'no_attack_duration' }]);
  const { findings } = audit(base, version, { reads });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].field, 'no_attack_duration');
  assert.equal(findings[0].nonNeutral, true);
  assert.deepEqual(findings[0].reads, [{ default: 10, file: 'x.js', line: 1 }]);
  // a neutral default, `??` reads and plain mentions are listed too, unflagged / flagged by their default
  const r2 = codeReads([{ file: 'y.js', text: "const a = bb.no_attack_duration ?? 0;\nconst b = p['no_attack_duration'];" }]);
  assert.deepEqual(r2.get('no_attack_duration'), [{ default: 0, file: 'y.js', line: 1 }, { default: undefined, file: 'y.js', line: 2 }]);
  assert.equal(audit(base, version, { reads: r2 }).findings[0].nonNeutral, false);
  // a record or buff the version lacks entirely is no field gap
  assert.deepEqual(gaps(base, { bonds: {} }), []);
});

test('the base against itself has no finding; a code-named buff key the version lacks is listed', () => {
  const data = getData({ log: QUIET });
  const reads = codeReads();
  const keys = codeBuffKeys();
  assert.deepEqual(audit(data, data, { reads, keys, names: NAMES }), { findings: [], missingBuffKeys: [], unknownTriggerRules: [], versionOnlyKeys: [] });
  assert.ok(reads.get('no_attack_duration')?.some((r) => r.default === 10 && r.file === 'server/sim/content/bonds/addon/battle.js'));
  assert.ok(keys.has('act2autochess_equip_acarm055_global_buff'), 'items/battle.js names it');
  const items = Object.fromEntries(Object.entries(data.items).filter(([, r]) => r.effectId !== 'eff_acarm055' && r.effectId !== 'eff_acgarm055'));
  const effects = Object.fromEntries(Object.entries(data.effects).filter(([id]) => id !== 'eff_acarm055' && id !== 'eff_acgarm055'));
  const { missingBuffKeys } = audit(data, { ...data, items, effects }, { reads, keys });
  assert.ok(missingBuffKeys.some((k) => k.key === 'act2autochess_equip_acarm055_global_buff'));
});

test('unknown trigger rules: a rule outside TRIGGER_RULES is listed once per rule, table and skill, with its owners', () => {
  const skill = (rule) => ({ skillId: 'sk_t', trigger: { rule, rawRule: rule } });
  const data = {
    chess: { c1_a: { skills: [skill('DEFAULT'), skill('AUTO_STOP')] }, c2_a: { skill: skill('AUTO_STOP') } },
    backups: { units: { char_t: { forms: { '2/1/4/0': { skills: [skill('AUTO_STOP')] } } } } },
    tokens: { t1: { skill: skill('SP_FULL') } },
  };
  assert.deepEqual(unknownTriggerRules(data), [
    { rule: 'AUTO_STOP', table: 'backups', skillId: 'sk_t', owners: ['char_t'] },
    { rule: 'AUTO_STOP', table: 'chess', skillId: 'sk_t', owners: ['c1_a', 'c2_a'] },
  ]);
  assert.deepEqual(unknownTriggerRules(getData({ log: QUIET })), [], 'the default data uses only implemented rules');
});

test('version-only keys: a buff key / bbStr.key or garrison key the base lacks and no code names is listed with its records', () => {
  const base = { bonds: { b1: { buffs: [{ key: 'env_gbuff_new', bbStr: { key: 'k_base' } }] } }, garrisons: {} };
  const version = {
    bonds: { b1: { buffs: [{ key: 'env_gbuff_new', bbStr: { key: 'k_base' } }, { key: 'k_new' }] } },
    bands: { band_x: { buffs: [{ key: 'env_gbuff_new', bbStr: { key: 'k_band' } }] } },
    effects: { e1: { buffs: [{ key: 'k_new' }] } },
    garrisons: {
      g_1: { effectType: 'SERVER_NEW', effectKey: 'SERVER_NEW', battleRuneKey: null, bbStr: {} },
      g_2: { effectType: 'SERVER_HANDLED', effectKey: 'SERVER_HANDLED', battleRuneKey: 'rune_new', bbStr: { key: 'k_band' } },
    },
  };
  const named = codeBuffKeys([{ file: 'h.js', text: "H.SERVER_HANDLED = {\n};\nconst B = { env_gbuff_new: 1 };" }]);
  assert.ok(named.has('SERVER_HANDLED'), 'H.<UPPER_KEY> names the key');
  assert.deepEqual(versionOnlyKeys(base, version, named), [
    { key: 'k_band', records: [{ table: 'bands', id: 'band_x' }, { table: 'garrisons', id: 'g_2' }] },
    { key: 'k_new', records: [{ table: 'bonds', id: 'b1' }, { table: 'effects', id: 'e1' }] },
    { key: 'rune_new', records: [{ table: 'garrisons', id: 'g_2' }] },
    { key: 'SERVER_NEW', records: [{ table: 'garrisons', id: 'g_1' }] },
  ]);
  assert.deepEqual(audit(base, version, { reads: new Map() }).versionOnlyKeys, [], 'only with names');
});

// 上半's 斩业星熊 S3 (skchr_hsgma2_3, 自选) triggers on AUTO_STOP, which the engine does not implement: M2 builds it or
// keeps 斩业星熊 out of 上半's 自选 (DESIGN §35.22.5). A version adding another unknown rule fails here.
const UNKNOWN_RULES_SHANG = Object.freeze([{ rule: 'AUTO_STOP', table: 'backups', skillId: 'skchr_hsgma2_3', owners: ['char_1044_hsgma2'] }]);
const UNKNOWN_RULES = Object.freeze({ 'data/versions/act1autochess': UNKNOWN_RULES_SHANG, 'data/versions/act1autochess-v1_1': UNKNOWN_RULES_SHANG });

// 上半's keys that 下半 lacks and no code names: each is an inert mechanic there until M2 (DESIGN §35.22.5) — 煌 / 蜜莓 /
// 伊芙利特 / 极光's traits, 华法琳 / 寒芒克洛丝's grant (上半 spells its field give_garrion_id, garrisons/battle.js reads
// give_garrison_id), the 标准模拟 band clause, 灵巧 / 远见's layer awards and six 上半 equipment keys. A new one fails here.
const rec = (spec) => spec.split(' | ').flatMap((part) => { const [table, ids] = part.split(': '); return ids.split(' ').map((id) => ({ table, id })); });
const VERSION_ONLY_SHANG = Object.freeze(Object.entries({
  act1autochess_band31_buff: 'bands: band_amiya band_bldsk band_duyaoy band_sarkazb | effects: aceffect_band_21 aceffect_band_22 aceffect_band_28 aceffect_band_44',
  act1autochess_equip_acarm055_global_buff: 'effects: eff_acarm055 eff_acgarm055 | items: chess_item_3_05_e_a chess_item_3_05_e_b',
  act1autochess_equip_acarm078_global_buff: 'effects: eff_acarm078 eff_acgarm078 | items: chess_item_6_03_e_a chess_item_6_03_e_b',
  act1autochess_equip_acarm102_global_buff: 'effects: eff_acarm102 eff_acgarm102 | items: chess_item_6_05_e_a chess_item_6_05_e_b',
  act1autochess_gar_event_recoverhp_enemy_abflag_inrange: 'garrisons: garrison_27_a garrison_27_b',
  bond_layer_char_goods_price_discount: 'bonds: visiShip | effects: bondeffect_visi',
  bond_layer_refresh_shop_award_equip: 'bonds: skillfulShip | effects: bondeffect_skillful',
  give_garrion_to_front: 'garrisons: garrison_72_a garrison_72_b garrison_73_a garrison_73_b',
  sell_char_count_gain_equip_owner_original: 'effects: eff_acarm074 eff_acgarm074 | items: chess_item_6_10_e_a chess_item_6_10_e_b',
  SERVER_ADD_BOND_ACTIVATED_RANDOM: 'garrisons: garrison_58_a garrison_58_b',
  SERVER_ADD_BOND_FRONT_ALL_LAYER: 'garrisons: garrison_83_a garrison_83_b',
  SERVER_GAIN_CHAR: 'garrisons: garrison_52_a garrison_52_b',
  use_equip_add_goods_rule_with_refresh_shop: 'effects: eff_acarm075 eff_acgarm075 | items: chess_item_5_03_e_a chess_item_5_03_e_b',
  use_equip_give_char_to_player_most_bond: 'effects: eff_acarm109 eff_acgarm109 | items: chess_item_5_04_e_a chess_item_5_04_e_b',
}).map(([key, spec]) => ({ key, records: rec(spec) })));
// 第二期上半 V2_1's 远见 (visiShip) carries two discount keys no code reads, bond_layer_char_goods_price_bond_discount
// (V2_1 only) and bond_layer_char_goods_price_discount (also 上半's 100-layer key), not V2_2's
// bond_multi_layer_char_goods_price_bond_discount: its 80 / 150-layer discounts are inert there until M2 (DESIGN §35.22.5).
const VERSION_ONLY_V21 = Object.freeze(Object.entries({
  bond_layer_char_goods_price_bond_discount: 'bonds: visiShip | effects: bondeffect_visi',
  bond_layer_char_goods_price_discount: 'bonds: visiShip | effects: bondeffect_visi',
}).map(([key, spec]) => ({ key, records: rec(spec) })));
const VERSION_ONLY = Object.freeze({
  'data/versions/act1autochess': VERSION_ONLY_SHANG, 'data/versions/act1autochess-v1_1': VERSION_ONLY_SHANG, 'data/versions/act2autochess-v2_1': VERSION_ONLY_V21,
});
// 第二期上半 V2_1's code-named keys it lacks: 远见's V2_2 discount (above), the trait type SERVER_ADD_MULTIPLE_BOND (V2_2's new
// traits) and 奥术法阵's 失能 (silence_attachment, added on 2026-03-27: V2_1's 奥术法阵 does not silence, as the data says)
const MISSING_KEYS = Object.freeze({
  'data/versions/act2autochess-v2_1': ['bond_multi_layer_char_goods_price_bond_discount', 'SERVER_ADD_MULTIPLE_BOND', 'silence_attachment'],
});

for (const dir of VERSION_DIRS) {
  test(`${path.relative(ROOT, dir) || dir}: the field gaps — 上半: 突袭's no_attack_duration (default 10) and 炎's 9-member fields; 下半 V2_1: none`, () => {
    const data = loadData(dir, { log: QUIET });
    const { findings, missingBuffKeys } = audit(getData({ log: QUIET }), data, { reads: codeReads(), keys: codeBuffKeys() });
    const rel = path.relative(ROOT, dir).split(path.sep).join('/');
    if (MISSING_KEYS[rel]) assert.deepEqual(missingBuffKeys.map((k) => k.key), MISSING_KEYS[rel], `${rel}: code-named keys it lacks`);
    if (data.config?.season !== 'act1autochess') {
      assert.deepEqual(findings, [], `${rel}: same-season data, no field gap`);
      return;
    }
    const has = (key, field) => findings.find((f) => f.table === 'bonds' && f.key === key && f.field === field);
    const idle = has('raidShip', 'no_attack_duration');
    assert.ok(idle?.nonNeutral, 'raidShip.no_attack_duration');
    assert.ok(idle.reads.some((r) => r.default === 10 && r.file === 'server/sim/content/bonds/addon/battle.js'));
    assert.ok(has('yanShip', 'ex_bond_char_cnt'), 'yanShip.ex_bond_char_cnt');
  });

  test(`${path.relative(ROOT, dir) || dir}: its trigger rules the engine does not implement are exactly the known ones`, () => {
    const rel = path.relative(ROOT, dir).split(path.sep).join('/');
    const want = UNKNOWN_RULES[rel];
    const got = unknownTriggerRules(loadData(dir, { log: QUIET }));
    if (want) assert.deepEqual(got, want);
    else assert.deepEqual(got, [], `${rel}: unknown trigger rules ${got.map((u) => u.rule).join(', ')} (list them for M2)`);
  });

  test(`${path.relative(ROOT, dir) || dir}: its keys the default data lacks and no code names are exactly the known ones`, () => {
    const rel = path.relative(ROOT, dir).split(path.sep).join('/');
    const want = VERSION_ONLY[rel];
    const got = versionOnlyKeys(getData({ log: QUIET }), loadData(dir, { log: QUIET }), NAMES);
    if (want) assert.deepEqual(got, want);
    else assert.deepEqual(got, [], `${rel}: version-only keys ${got.map((v) => v.key).join(', ')} (list them for M2)`);
  });
}
