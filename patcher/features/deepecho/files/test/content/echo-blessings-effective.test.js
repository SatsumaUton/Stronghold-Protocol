// 「深渊回响」祝福**字段口径 + 真实生效**校验（维护者 2026-11-05）。
//
// 白名单唯一来源：test/helpers/unitModKeys.js（与词条测试共用），避免两份名单各写各的。
// 两层校验：
//   1. 启用的 mods 祝福，字段必须在**干员路径**的读取列表里；
//   2. 真实战斗里挂上去，面板数值必须变化（21 个已验证；11 个已知不在面板体现的已停用）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { ECHO_BLESSINGS } from '../../server/match/match/echoBlessing.js';
import { unknownModKeys, OPERATOR_MOD_KEYS } from '../helpers/unitModKeys.js';

function statSnapshot(u) {
  return {
    atk: u.s.atk, maxHp: u.s.maxHp, def: u.s.def, res: u.s.res,
    bat: u.s.bat, blockCnt: u.s.blockCnt, maxTargets: u.s.maxTargets,
    // 以下字段之前没取，导致 11 个祝福被误判为空转
    dmgDealtMul: u.s.dmgDealtMul, dmgTakenMul: u.s.dmgTakenMul,
    defIgnoreFlat: u.s.defIgnoreFlat, resIgnoreFlat: u.s.resIgnoreFlat,
    rangeExtend: u.s.rangeExtend, hpRegen: u.s.hpRegen, spRecovery: u.s.spRecovery,
  };
}

test('启用的 mods 祝福：字段必须在干员路径的读取列表里', () => {
  const enabled = ECHO_BLESSINGS.filter((b) => b.kind === 'mods' && b.disabled !== true && !b.enemyDebuff);
  assert.ok(enabled.length >= 12, `启用的 mods 祝福应有 12+，实际 ${enabled.length}`);
  const bad = [];
  for (const b of enabled) {
    const keys = Object.keys(b.mods || {});
    if (!keys.length) { bad.push(`${b.id}(无字段)`); continue; }
    for (const k of keys) if (!OPERATOR_MOD_KEYS.has(k)) bad.push(`${b.id}.${k}`);
  }
  assert.deepEqual(bad, [], `这些字段在干员路径上不会被读取：${bad.join(', ')}`);
});

test('禁用的祝福：字段名至少在两条路径之一存在（防止彻底写错）', () => {
  const bad = [];
  for (const b of ECHO_BLESSINGS.filter((x) => x.kind === 'mods' && x.disabled === true)) {
    const unknown = unknownModKeys(Object.keys(b.mods || {}), 'both');
    if (unknown.length) bad.push(`${b.id}(${unknown.join('/')})`);
  }
  assert.deepEqual(bad, [], `两条路径都不认的字段：${bad.join(', ')}`);
});

test('真实战斗：启用的 mods 祝福挂到干员上，面板数值必须变化', () => {
  const enabled = ECHO_BLESSINGS.filter((b) => b.kind === 'mods' && b.disabled !== true && b.mods && !b.enemyDebuff);
  const inert = [];
  for (const b of enabled) {
    const h = makeBattle({
      defs: { chess: { t_op: chessRec({ id: 't_op' }) }, enemies: { e_d: enemyRec({ key: 'e_d' }) } },
      units: [{ chessId: 't_op', row: 10, col: 4 }],
      enemies: [{ key: 'e_d', pos: [10, 9] }],
      timeLimit: 30, autoFinish: false,
    });
    h.step(1);
    const u = h.unit('t_op');
    if (!u) { h.b.dispose?.(); continue; }
    const before = statSnapshot(u);
    h.b.addBuff(u, { key: `test:${b.id}`, name: b.name, mods: { ...b.mods } });
    const after = statSnapshot(u);
    if (!Object.keys(before).some((k) => before[k] !== after[k])) inert.push(b.id);
    h.b.dispose?.();
  }
  assert.deepEqual(inert, [], `启用的祝福里出现面板无变化的：${inert.join(', ')}`);
});

test('非 mods 祝福必须带生效字段', () => {
  const bad = [];
  for (const b of ECHO_BLESSINGS) {
    if (b.kind === 'mods') continue;
    const has = Number(b.funds) > 0 || Number(b.freeRefresh) > 0 || Number(b.coinMul) > 1 || Number(b.refreshEvery) > 0
      || Number(b.healLp) > 0 || b.kind === 'cleanse'
      // 「护盾」：投票指定盟约，排异抽到它时抵消（2026-11-05）
      || b.kind === 'shield'
      || (b.kind === 'counter' && ((Array.isArray(b.counterCurses) && b.counterCurses.length) || b.counterBans === true));
    if (!has) bad.push(b.id);
  }
  assert.deepEqual(bad, [], `这些祝福没有任何生效字段：${bad.join(', ')}`);
});
