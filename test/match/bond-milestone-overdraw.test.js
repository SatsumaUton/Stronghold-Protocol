// 玩家反馈（2026-11-07）：凯瑟琳的盟约（维多利亚）16 层以后不再触发。
//
// 根因：维多利亚的「每叠加 25 层获得 1 件维式重锤」走 `ctx.grantItem` → `acquireItem`，
// 而后者默认要求**装备库存还有货**（`itemPool.canGain`）。深潜层数涨得快，16 层前后
// 那几份库存（tier1 每件 4 份）就被领完了 —— 之后每次里程碑都返回 null，界面上就是「不触发」。
//
// 修法：给 `acquireItem` 加 `overdraw`（超出库存仍授予，超出部分记 debt，和 `displayed` 同一条路径），
// 里程碑类效果（官方是无条件给的）用它。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMatch } from './harness.js';

const HAMMER = 'chess_item_1_01_e_a';   // 维式重锤

test('装备库存抽干后，overdraw 的授予仍然生效（维多利亚里程碑靠这条）', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 5, fake: true, variant: 'deepecho' });
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  const pool = ps.itemPool;
  // 模拟「库存已经抽干」：直接让 canGain 为假（等价于前面几个里程碑把货领完了）
  const orig = pool.canGain.bind(pool);
  pool.canGain = () => false;
  try {
    assert.equal(ps.acquireItem(HAMMER), null, '普通授予会被库存拒绝');
    const got = ps.acquireItem(HAMMER, { overdraw: true });
    assert.ok(got, 'overdraw 必须能拿到（里程碑是无条件给的）');
    assert.equal(got.kind, 'item');
    assert.equal(got.id, HAMMER);
  } finally {
    pool.canGain = orig;
  }
});

test('维多利亚的里程碑授予确实带 overdraw（源码级，防止被改回去）', () => {
  const src = readFileSync(new URL('../../server/sim/content/bonds/core.js', import.meta.url), 'utf8');
  assert.match(src, /grantItem\(id, \{ source: 'bond:victoriaShip', overdraw: true \}\)/,
    'payHammers 必须用 overdraw，否则深潜里层数一多就再也拿不到锤子');
});

test('战斗中叠层在 999 层之后仍然照常累加（深潜 layerCapOff）', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 5, fake: true, variant: 'deepecho' });
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  assert.equal(m.layerCapOff, true, '前提：深潜解除层数上限');
  ps.layers.victoriaShip = 999;
  ps.recompute();
  const before = ps.layers.victoriaShip;
  ps.addLayers('victoriaShip', 40);
  assert.equal(ps.layers.victoriaShip, before + 40, '999 之后还能加');
  assert.ok(ps.layers.victoriaShip > 999, '确实越过 999');
});
