// tools/bb-audit.mjs (versions M0, docs/SIM.md §7.2): blackboard fields the code reads that another official version's
// data lacks, the buff keys the code names that it lacks, and its skill trigger rules the engine does not implement.
// Real version directories: every data/versions/*/ with a
// chess.json and the directories of SP_VERSION_DATA_DIRS (path.delimiter-separated, e.g. a dry build); none → skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, getData } from '../server/data.js';
import { audit, codeReads, codeBuffKeys, gaps, isNeutral, parseDefault, unknownTriggerRules } from '../tools/bb-audit.mjs';

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
  assert.deepEqual(audit(data, data, { reads, keys }), { findings: [], missingBuffKeys: [], unknownTriggerRules: [] });
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

// 上半's 斩业星熊 S3 (skchr_hsgma2_3, 自选) triggers on AUTO_STOP, which the engine does not implement: M2 builds it or
// keeps 斩业星熊 out of 上半's 自选 (DESIGN §36.5). A version adding another unknown rule fails here.
const UNKNOWN_RULES_SHANG = Object.freeze([{ rule: 'AUTO_STOP', table: 'backups', skillId: 'skchr_hsgma2_3', owners: ['char_1044_hsgma2'] }]);
const UNKNOWN_RULES = Object.freeze({ 'data/versions/act1autochess': UNKNOWN_RULES_SHANG, 'data/versions/act1autochess-v1_1': UNKNOWN_RULES_SHANG });

for (const dir of VERSION_DIRS) {
  test(`${path.relative(ROOT, dir) || dir}: 突袭's no_attack_duration (default 10) and 炎's 9-member fields are reported`, () => {
    const { findings } = audit(getData({ log: QUIET }), loadData(dir, { log: QUIET }), { reads: codeReads() });
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
}
