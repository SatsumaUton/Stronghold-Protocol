// test/sim/enemy-wall-escape.test.js —— 站在不可走瓦片上的敌人必须能脱困（深渊回响）。
//
// 现场（2026-11-20，玩家：深渊回响里出现无法移动的小怪）：
//   潮汐把瓦片变成深海后，敌人脚下的格子变得不可走 —— 这是**非法状态**。
//   以前的恢复逻辑：把「最近的可行瓦片」压进航点让它**走过去**，但移动是朝航点直线推进、
//   中途不检查逐格可走（穿墙）；后来加了半径 6 圈的搜索，深海比 6 格大时找不到 →
//   `R.blocked = true` → 该敌人**永久不动**。
//   现在：直接**吸附**到最近的可走瓦片中心，再按正常流场走。
//
// 这条测试把敌人放在「离可走区域 16 格」的墙格里（旧代码必然返回 null → 永久卡住）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

/** 只有最左 3 列可走，其余全是墙 —— 从 (9,18) 到最近的可走格 (9,2) 相距 16 格。 */
const rows = {};
for (let r = 0; r < 19; r++) rows[r] = 'rrr' + '#'.repeat(18);

test('站在远离可走区域的墙格上：敌人会被吸附脱困并继续走（不再永久不动）', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, atk: 0, speed: 1, mass: 0 }) } },
    flat: { rows },
    routes: [{ motion: 'WALK', start: [9, 18], end: [9, 2], checkpoints: [] }],
    timeLimit: 120,
    autoFinish: false,
  });
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [9, 18] });
  const before = { x: e.x, y: e.y };
  for (let i = 0; i < 300; i++) h.step();
  const moved = Math.abs(e.x - before.x) > 1e-3 || Math.abs(e.y - before.y) > 1e-3;
  assert.ok(moved, `★ 卡在墙格的敌人必须脱困（停在 ${before.x},${before.y}，现在 ${e.x.toFixed(2)},${e.y.toFixed(2)}）`);
  assert.ok(h.b.grid.walkable(Math.round(e.y), Math.round(e.x), true), '★ 恢复后应站在可走瓦片上');
});

test('可走区域内的敌人不受影响（正常沿流场走）', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, atk: 0, speed: 1, mass: 0 }) } },
    flat: { rows },
    routes: [{ motion: 'WALK', start: [9, 2], end: [9, 2], checkpoints: [] }],
    timeLimit: 120,
    autoFinish: false,
  });
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [9, 2] });
  for (let i = 0; i < 30; i++) h.step();
  assert.ok(h.b.grid.walkable(Math.round(e.y), Math.round(e.x), true), '仍在可走瓦片上');
  assert.equal(e.route?.blocked, false, '没有卡在 blocked');
});
