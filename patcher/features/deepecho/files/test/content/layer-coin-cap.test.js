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
