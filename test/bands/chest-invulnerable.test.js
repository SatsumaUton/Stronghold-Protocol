// test/bands/chest-invulnerable.test.js —— 「模拟宝藏」不该被诅咒的持续伤害流血流死（维护者 2026-11-21）。
//
// 背景：寻宝人策略（规程 band）会在战斗里放一个「模拟宝藏」装置（enemy_9038_achest，100 HP），
//       它挂了 invulnerable / untargetable，但深渊诅咒「腐蚀 / 溃烂」用 dealHPLose（流失），
//       而 loseHp 以前不看 flags → 宝藏每秒掉血，最终流血流死 → 结算拿不到金币。
//
// 修法（引擎侧，最小）：loseHp 对 `kind === 'device'` 且 `flags.invulnerable` 的目标返回 0。
// 干员 / 召唤物的流失语义不变（PRTS「生命流失…跳过所有结算与伤判效果」，test/sim/damage-api.test.js 钉住）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

test('装置（模拟宝藏）不会因流失掉血', (t) => {
  const h = makeBattle({ units: [], defs: {} });
  const b = h.b;
  t.after(() => b.dispose?.());

  const device = b.spawnDevice('enemy_9038_achest', 9, 8, { hp: 100, atk: 0, blockCnt: 0, name: '模拟宝藏' });
  assert.ok(device, '装置要能生成');
  b.addBuff(device, { key: 'command:chest', flags: { untargetable: true, invulnerable: true, noMove: true }, persist: true });

  const before = device.hp;
  const lost = b.dealHPLose({ target: device, amount: 50 });
  assert.equal(lost, 0, '不灭装置不接受流失');
  assert.equal(device.hp, before, '血量不变');
  assert.equal(device.alive, true);
});

test('干员仍然接受流失（官方的「流失跳过一切伤害防护」不变）', (t) => {
  const h = makeBattle({
    defs: { chess: { t_op: chessRec({ id: 't_op', stats: { atk: 100, maxHp: 10000 }, skill: null }) } },
    units: [{ uid: 1, chessId: 't_op', row: 10, col: 5 }],
    content: 'none', autoFinish: false,
  });
  const b = h.b;
  t.after(() => b.dispose?.());
  h.step();
  const op = h.unit(1);
  assert.ok(op, '干员在场');
  b.addBuff(op, { key: 'test:inv', flags: { invulnerable: true } });
  const before = op.hp;
  const lost = b.dealHPLose({ target: op, amount: 30 });
  assert.ok(lost > 0, '干员（哪怕 invulnerable）仍会被流失扣血');
  assert.ok(op.hp < before, '血量下降');
});
