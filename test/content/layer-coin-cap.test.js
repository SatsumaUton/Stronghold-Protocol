// test/content/layer-coin-cap.test.js — 「按层给钱」的封顶（server/sim/content/bonds/addon/meta.js）。
//
// 背景：「远见」每 10 层给资金、「奇迹」每 100 层给资金。原版靠盟约层数上限 999 天然封住，
// 而「深渊回响」把层数上限放开到 1e9（让玩家跟得上敌人），于是这两条会变成无上限的印钞机。
// 现在层数可以继续叠（战斗增益照旧），但**资金通道只结算到 999 层**。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerCoinDue } from '../../server/sim/content/bonds/addon/meta.js';

/** 深潜用的上限（与 server/match/effectsMeta.js 里给的 999 一致）。 */
const DIVE_CAP = 999;

test('不传上限 = 原版行为（普通房间走这条，公式一字不差）', () => {
  for (const layers of [0, 9, 10, 25, 100, 500, 999, 5000, 1e9]) {
    for (const step of [10, 25, 100]) {
      assert.equal(layerCoinDue(layers, step), Math.floor(layers / step), `layers=${layers} step=${step}`);
    }
  }
  assert.equal(layerCoinDue(5000, 10), 500, '不设上限时 5000 层就是 500 档（无印钞问题，因为原版层数本身被钳在 999）');
});

test('深潜上限 999：999 层以内与原版一致', () => {
  for (const layers of [0, 10, 25, 100, 500, 998, 999]) {
    for (const step of [10, 25, 100]) {
      assert.equal(layerCoinDue(layers, step, DIVE_CAP), Math.floor(layers / step), `layers=${layers} step=${step}`);
    }
  }
});

test('深潜上限 999：超过之后不再发钱（层数还能叠，战斗增益照旧）', () => {
  const atCap = layerCoinDue(999, 10, DIVE_CAP);
  assert.equal(atCap, 99, '远见：999/10 = 99 档');
  assert.equal(layerCoinDue(1000, 10, DIVE_CAP), atCap);
  assert.equal(layerCoinDue(5000, 10, DIVE_CAP), atCap);
  assert.equal(layerCoinDue(1e9, 10, DIVE_CAP), atCap, '放开到 1e9 也不会继续发钱');
  assert.equal(layerCoinDue(1e9, 100, DIVE_CAP), 9, '奇迹：999/100 = 9 档');
});

test('异常输入安全：step 为 0 / 负数 / 非数字都返回 0，层数为空按 0 算', () => {
  assert.equal(layerCoinDue(100, 0), 0);
  assert.equal(layerCoinDue(100, -10), 0);
  assert.equal(layerCoinDue(100, NaN), 0);
  assert.equal(layerCoinDue(null, 10), 0);
  assert.equal(layerCoinDue(undefined, 10), 0);
  assert.equal(layerCoinDue(100, 10, 0), 0, '上限为 0 时一档都不给');
});

// 上限由**本局是否解除层数上限**决定（effectsMeta.js 的 bondLayerCoinCap = m.layerCapOff ? 999 : Infinity）：
// 深潜和实验房的 disableLayerCap 都能把层数叠过 999，两条按层给钱的盟约就都不能再跟着涨。
// 普通房必须保持 Infinity（原版行为，一字不差）。
test('按层给钱的上限跟着 layerCapOff 走：普通房 Infinity，深潜 / disableLayerCap 实验房 999', async () => {
  const { MetaRegistry } = await import('../../server/match/effectsMeta.js');
  const { registerBuiltins } = await import('../../server/match/builtinMeta.js');
  const { makeMatch, DATA } = await import('../match/harness.js');
  const cases = [
    ['普通房', {}, Infinity],
    ['深渊回响', { variant: 'deepecho' }, 999],
    ['实验房 disableLayerCap', { experimental: { revivalEnabled: false, disableSharedPool: false, disableLayerCap: true } }, 999],
  ];
  for (const [name, opts, want] of cases) {
    const reg = registerBuiltins(new MetaRegistry(), DATA);
    const seen = [];
    reg.global('cap-probe', { onPrepStart: (ctx) => seen.push(ctx.bondLayerCoinCap) });
    const h = makeMatch({ mode: 'coop', humans: 1, seed: 91, fake: true, registry: reg, ...opts }).start();
    try {
      h.toPrep(1);
      seen.length = 0;
      h.m.dispatch(h.ps('p_0'), 'onPrepStart', { round: 1 });
      assert.deepEqual(seen, [want], `${name}: bondLayerCoinCap`);
      assert.equal(h.m.layerCapOff, want === 999, `${name}: layerCapOff 与上限一致`);
    } finally { h.m.dispose(); }
  }
});

test('层数过 999 之后不再发钱：远见 99 档 / 奇迹 9 档（深潜）', () => {
  for (const layers of [999, 1000, 1500, 5000, 1e9]) {
    assert.equal(layerCoinDue(layers, 10, 999), 99, `远见 ${layers} 层`);
    assert.equal(layerCoinDue(layers, 100, 999), 9, `奇迹 ${layers} 层`);
  }
});