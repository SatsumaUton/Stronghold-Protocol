// 玩家反馈（2026-11-08）：「重启后给了很多维多利亚锤子」。
//
// 根因**不是**断点续玩重复发放（counter 跟着存档走，重启前后一致），而是：
//   「深渊回响」把**层数上限**放开到 1e9（`Match.layerCapOff`，让玩家跟得上敌人），
//   而维多利亚「每 25 层一件维式重锤」这条通道**没有**像「按层给钱」（远见 每 10 层 / 奇迹 每 100 层）
//   那样接上 `ctx.bondLayerCoinCap`。原版靠 999 层上限天然封住（最多 39 件），
//   深潜里 2000 层 = 80 件、5000 层 = 200 件，而且 `grantItem` 带 overdraw（不消耗库存）——
//   一旦盟约激活（含「重启时 restoreMatch 的 recompute → onActiveBonds」），就一次性补发一大批。
//
// 修法：`payHammers` 的层数与 `layerCoinDue` 同一口径，按 `ctx.bondLayerCoinCap` 封顶。
// 普通房间拿到 Infinity = 改动前逐字节一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payHammers } from '../../server/sim/content/bonds/core.js';

/** 一个只够 payHammers 用的 ctx（模仿 effectsMeta 给的那一份）。 */
function ctxFor({ layers, cap, active = true, bondLayerCoinCap }) {
  const counters = {};
  const granted = [];
  const counter = (k) => counters[k] || 0;
  const ctx = {
    bondActive: () => active,
    layers: () => layers,
    counter,
    setCounter: (k, v) => { counters[k] = v; },
    rollItem: () => 'chess_item_1_01_e_a',
    grantItem: (id) => { granted.push(id); return true; },
    // 真实数据里的维多利亚奖励通道（每 25 层 1 件）
    data: { bonds: { victoriaShip: { buffs: [{ key: 'bond_layer_added_reward_equip', bb: { layer: 25, count: 1 }, bbStr: { pool: 'pool_equip_vict' } }] } } },
  };
  if (cap !== undefined) ctx.bondLayerCoinCap = cap;
  void bondLayerCoinCap;
  return { ctx, granted, counters };
}

test('普通房间（bondLayerCoinCap 缺省 / Infinity）：公式与改动前逐字节一致', () => {
  for (const layers of [0, 24, 25, 26, 500, 999]) {
    const { ctx, granted } = ctxFor({ layers });
    const n = payHammers(ctx);
    assert.equal(n, Math.floor(layers / 25), `${layers} 层`);
    assert.equal(granted.length, n);
  }
});

test('深潜（bondLayerCoinCap = 999）：层数过 999 之后不再发锤子', () => {
  const atCap = payHammers(ctxFor({ layers: 999, cap: 999 }).ctx);
  assert.equal(atCap, 39, '999/25 = 39 件');
  for (const layers of [1000, 2000, 5000, 1e9]) {
    const { ctx, granted } = ctxFor({ layers, cap: 999 });
    assert.equal(payHammers(ctx), atCap, `${layers} 层：停在 39 件`);
    assert.equal(granted.length, atCap);
  }
});

test('999 层以内深潜与普通房完全一致（封顶不提前生效）', () => {
  for (const layers of [0, 25, 100, 500, 998, 999]) {
    const plain = payHammers(ctxFor({ layers }).ctx);
    const dive = payHammers(ctxFor({ layers, cap: 999 }).ctx);
    assert.equal(dive, plain, `${layers} 层`);
  }
});

test('封顶后仍然「每档只发一次」：重复调用不会继续发', () => {
  const { ctx, counters, granted } = ctxFor({ layers: 5000, cap: 999 });
  assert.equal(payHammers(ctx), 39);
  const after = granted.length;
  assert.equal(payHammers(ctx), 0, '第二次一档都不发');
  assert.equal(granted.length, after);
  assert.equal(counters['bond:victoria:hammers'], 39);
});

test('未激活时一档都不发（封顶不影响这条规则）', () => {
  const { ctx, granted } = ctxFor({ layers: 5000, cap: 999, active: false });
  assert.equal(payHammers(ctx), 0);
  assert.equal(granted.length, 0);
});

// 真局：`ctx.bondLayerCoinCap` 由 server/match/effectsMeta.js 按 `Match.layerCapOff` 给出。
// 这里走**真的** match + 真的 dispatcher，把「深潜里层数 5000 也只发 39 件」钉在线上那条链路上，
// 以后谁把 effectsMeta 的那个字段删掉，这条会红。
test('真局（深潜）：层数 5000 时维多利亚最多发 39 件维式重锤', async () => {
  const { makeMatch, give, DATA, legalTileFor } = await import('../match/harness.js');
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 11, fake: true, variant: 'deepecho' }).start();
  try {
    h.toPrep(1);
    const m = h.m, ps = h.ps('p_0');
    assert.equal(m.layerCapOff, true, '前提：深潜解除层数上限');
    const used = new Set();
    for (const id of Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && (c.bonds || []).includes('victoriaShip')).slice(0, 3).map((c) => c.chessId)) {
      const at = legalTileFor(m, ps, id, used);
      used.add(at.join(','));
      give(m, ps, id, 'board', at);
    }
    ps.layers = { victoriaShip: 5000 };
    ps.counters = {};
    ps.recompute();
    assert.equal(ps.bonds.victoriaShip.active, true, '前提：维多利亚已激活');
    m.dispatch(ps, 'onPrepEnd', { round: m.round });
    assert.equal(ps.counters['bond:victoria:hammers'], 39, '按 999 层封顶 = 39 档');
    m.dispatch(ps, 'onPrepEnd', { round: m.round });
    m.dispatch(ps, 'onPrepStart', { round: m.round });
    assert.equal(ps.counters['bond:victoria:hammers'], 39, '后续 hook 不会再补');
  } finally { h.m.dispose(); }
});
