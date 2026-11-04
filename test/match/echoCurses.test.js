// 诅咒词条表（echoCurse.js）的单元测试：表本身的结构、效果解析、显示合并。
//
// 为什么单测要盯这张表：诅咒的效果分散在 echoPhase 的几个钩子（词条上限 / 资金倍率）里，
// 表里多写一条 / 写错 kind，代码不会报错，只会「界面上有、实际空转」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHO_CURSES, ECHO_ROUND_CURSES, ECHO_FIXED_CURSE_ROUNDS, ECHO_CURSE_LIVE_KINDS,
  echoCurseById, echoCurseEffects, echoCurseList, echoCurseUnitMods, curseUnitMatches,
  pickEchoCurse, pickRoundCurse, removeEchoCurses, mergeCurseEffects, ECHO_CURSE_RARITY_LABEL,
} from '../../server/match/match/echoCurse.js';

test('词条表：id 唯一、文案齐、效果形状统一', () => {
  const ids = new Set();
  for (const c of ECHO_CURSES) {
    assert.equal(typeof c.id, 'string');
    assert.ok(c.id.length > 0);
    assert.ok(!ids.has(c.id), `重复 id：${c.id}`);
    ids.add(c.id);
    assert.equal(typeof c.name, 'string');
    assert.ok(c.name.length > 0, `${c.id} 缺中文名`);
    assert.equal(typeof c.desc, 'string');
    assert.ok(c.desc.length > 0, `${c.id} 缺说明`);
    assert.ok(c.effect && typeof c.effect.kind === 'string', `${c.id} 缺 effect.kind`);
    assert.equal(typeof c.effect.value, 'number', `${c.id} 的 effect.value 必须是数字`);
    assert.equal(typeof c.live, 'boolean', `${c.id} 必须显式声明 live`);
  }
});

test('已接入的词条，效果类型必须都在实现清单里（防止「有文案没效果」）', () => {
  for (const c of ECHO_CURSES) {
    if (c.live !== true) continue;
    assert.ok(ECHO_CURSE_LIVE_KINDS.includes(c.effect.kind), `${c.id} 的 kind ${c.effect.kind} 还没有消费方`);
  }
});

test('echoCurseEffects：未接入 / 未知的 id 只进 pending，不污染数值', () => {
  const e = echoCurseEffects(['erosion', 'erosion', 'tribute', 'nope']);
  assert.equal(e.wordCap, 2, '侵蚀两层 = +2 词条上限');
  assert.ok(Math.abs(e.coinMul - 0.85) < 1e-9, '贡赋 −15%');
  assert.deepEqual(e.pending, ['nope'], '未知 id 只记账，不生效');
});

test('echoCurseEffects：每条诅咒的效果都算得出来（没有空转的条目）', () => {
  const neutral = echoCurseEffects([]);
  for (const c of ECHO_CURSES) {
    // 干员减益（unitMods）和销毁装备（destroyEquip）不进数值包，由各自的钩子消费
    if (c.effect.kind === 'unitMods') {
      assert.ok(c.unitMods && Object.keys(c.unitMods).length, `${c.id} 缺 unitMods`);
      assert.ok(echoCurseUnitMods([c.id]).length === 1, `${c.id} 没被 echoCurseUnitMods 认出来`);
      continue;
    }
    if (c.effect.kind === 'destroyEquip') continue;
    const e = echoCurseEffects([c.id]);
    assert.deepEqual(e.pending, [], `${c.id} 必须是已接入的（不该进 pending）`);
    const changed = e.wordCap !== neutral.wordCap
      || e.coinMul !== neutral.coinMul
      || e.freeRefresh !== neutral.freeRefresh
      || e.timeMul !== neutral.timeMul
      || e.budgetMul !== neutral.budgetMul
      || e.enemyAtkMul !== neutral.enemyAtkMul
      || e.enemyHpMul !== neutral.enemyHpMul
      || e.bountyCoin !== neutral.bountyCoin
      || e.blessingMax !== neutral.blessingMax
      || e.intel !== neutral.intel
      || e.blackout !== neutral.blackout;
    assert.ok(changed, `${c.id} 的效果没有任何字段变化`);
  }
});

// ---- 回合诅咒 / 固定回合 / 干员减益（维护者 2026-11-05）--------------------------------------
test('回合诅咒：前 3 层不刷，之后能刷出多种，且都是 scope=round', () => {
  assert.equal(pickRoundCurse(2, () => 0), null, '2 层不该刷');
  let s = 1;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const seen = new Set();
  for (let d = 4; d < 60; d++) {
    const c = pickRoundCurse(d, rng);
    if (c) seen.add(c.id);
  }
  assert.ok(seen.size >= 4, `回合诅咒种类太少：${[...seen].join(',')}`);
  for (const id of seen) assert.equal(echoCurseById(id).scope, 'round', `${id} 不是回合诅咒`);
});

test('固定回合诅咒：每个深度都对应一条真实词条', () => {
  const rounds = Object.keys(ECHO_FIXED_CURSE_ROUNDS);
  assert.ok(rounds.length >= 3, '至少排 3 个固定回合');
  for (const d of rounds) {
    assert.ok(Number(d) > 0 && Number.isInteger(Number(d)));
    assert.ok(echoCurseById(ECHO_FIXED_CURSE_ROUNDS[d]), `深度 ${d} 的诅咒不存在`);
  }
});

test('干员减益：只命中匹配站位的单位，没位置信息不打', () => {
  assert.equal(curseUnitMatches({ position: 'MELEE' }, { def: { position: 'MELEE' } }), true);
  assert.equal(curseUnitMatches({ position: 'MELEE' }, { position: 'REMOTE' }), false);
  assert.equal(curseUnitMatches({ position: 'MELEE' }, {}), false);
  const mods = echoCurseUnitMods(['weak_melee', 'erosion', 'r_weak_ranged']);
  assert.equal(mods.length, 2, '只挑 unitMods 类');
  assert.deepEqual(mods.map((m) => m.filter.position), ['MELEE', 'REMOTE']);
  assert.ok(mods[0].mods.atkMul < 1, '近战是减益');
  assert.ok(mods[1].mods.batPct > 0, '攻速是变慢');
});

test('mergeCurseEffects：乘法相乘、加法相加、intel 取或', () => {
  const a = echoCurseEffects(['tribute']);              // coinMul 0.85
  const b = echoCurseEffects(['fog', 'erosion']);        // intel + wordCap 1
  const m = mergeCurseEffects(a, b);
  assert.ok(Math.abs(m.coinMul - 0.85) < 1e-9);
  assert.equal(m.intel, true);
  assert.equal(m.wordCap, 1);
  assert.equal(m.timeMul, 1);
});

test('echoCurseEffects：空输入是全中性', () => {
  const e = echoCurseEffects([]);
  assert.equal(e.wordCap, 0);
  assert.equal(e.coinMul, 1);
  assert.equal(e.timeMul, 1);
  assert.equal(e.budgetMul, 1);
  assert.deepEqual(e.pending, []);
  assert.deepEqual(echoCurseEffects(undefined).pending, [], 'undefined 也安全');
});

test('echoCurseList：同类合并显示「×N」，顺序按首次出现', () => {
  const list = echoCurseList(['erosion', 'tribute', 'erosion']);
  assert.deepEqual(list.map((c) => c.id), ['erosion', 'tribute']);
  assert.equal(list[0].name, '侵蚀 ×2');
  assert.equal(list[0].stacks, 2);
  assert.equal(list[1].name, '贡赋', '只有一层时不加 ×N');
  assert.equal(list[1].stacks, 1);
});

test('echoCurseList：不认识的 id 也不崩，退回 id 本身', () => {
  const list = echoCurseList(['ghost']);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'ghost');
  assert.equal(list[0].desc, '未知诅咒');
  assert.equal(echoCurseById('ghost'), null);
});

test('没有预留空转的条目：全部 live，且 kind 都有消费方', () => {
  for (const c of ECHO_CURSES) {
    assert.equal(c.live, true, `${c.id} 仍是预留（未生效）`);
    assert.ok(ECHO_CURSE_LIVE_KINDS.includes(c.effect.kind), `${c.id} 的 kind ${c.effect.kind} 没有消费点`);
    assert.deepEqual(echoCurseEffects([c.id]).pending, [], `${c.id} 不该进 pending`);
  }
});

// ---- 稀有度与投放（维护者 2026-11-05）----------------------------------------------------------
test('每条诅咒都有合法稀有度，且三档都有人', () => {
  const ok = new Set(['common', 'rare', 'epic']);
  const seen = new Set();
  for (const c of ECHO_CURSES) {
    assert.ok(ok.has(c.rarity), `${c.id} 的稀有度 ${c.rarity} 非法`);
    seen.add(c.rarity);
  }
  assert.deepEqual([...seen].sort(), ['common', 'epic', 'rare']);
});

test('pickEchoCurse：5 层只出普通，10 层会出稀有，16 层起会出传说', () => {
  const at = (depth, roll) => pickEchoCurse(depth, () => roll).rarity;
  for (const roll of [0, 0.3, 0.7, 0.95]) assert.equal(at(5, roll), 'common', '5 层不该出稀有');
  assert.equal(at(10, 0.85), 'rare', '10 层 0.85 落在稀有带');
  assert.equal(at(16, 0.95), 'epic', '16 层 0.95 落在传说带');
  assert.equal(at(16, 0.1), 'common');
});

test('removeEchoCurses：数字删最早 n 层，common 只删普通，all 全删', () => {
  const ids = ['erosion', 'swarm', 'tribute', 'fog'];
  assert.deepEqual(removeEchoCurses(ids, 2).kept, ['tribute', 'fog']);
  assert.deepEqual(removeEchoCurses(ids, 'common').kept, ['swarm', 'fog'], '稀有/传说保留');
  assert.deepEqual(removeEchoCurses(ids, 'all').kept, []);
  assert.deepEqual(removeEchoCurses(ids, 0).kept, ids, '0 不删');
  assert.deepEqual(removeEchoCurses(undefined, 'all').kept, []);
});