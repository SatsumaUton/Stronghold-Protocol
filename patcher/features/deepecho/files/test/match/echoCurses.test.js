// 诅咒词条表（echoCurse.js）的单元测试：表本身的结构、效果解析、显示合并。
//
// 为什么单测要盯这张表：诅咒的效果分散在 echoPhase 的几个钩子（词条上限 / 资金倍率）里，
// 表里多写一条 / 写错 kind，代码不会报错，只会「界面上有、实际空转」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHO_CURSES, ECHO_CURSE_LIVE_KINDS, echoCurseById, echoCurseEffects, echoCurseList,
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

test('echoCurseEffects：只累加 live 的，未接入的进 pending，不污染数值', () => {
  const e = echoCurseEffects(['erosion', 'erosion', 'tribute', 'fog', 'tithe', 'nope']);
  assert.equal(e.wordCap, 2, '侵蚀两层 = +2 词条上限');
  assert.ok(Math.abs(e.coinMul - 0.85) < 1e-9, '贡赋 −15%');
  assert.deepEqual(e.pending.sort(), ['fog', 'nope', 'tithe'], '未接入 / 未知 id 只记账，不生效');
  assert.equal(e.intel, false, 'fog 没接入就不该真的关掉情报');
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

test('预留词条不会因为「能取到」就被当成已生效', () => {
  const reserved = ECHO_CURSES.filter((c) => c.live !== true);
  assert.ok(reserved.length >= 5, '至少留 5 条给后续玩法');
  for (const c of reserved) {
    const e = echoCurseEffects([c.id]);
    assert.deepEqual(e.pending, [c.id], `${c.id} 必须待在 pending`);
    assert.equal(e.wordCap + (e.coinMul - 1) + (e.timeMul - 1), 0, `${c.id} 不该动数值`);
  }
});
