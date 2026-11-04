// test/content/layer-coin-cap.test.js — 「按层给钱」的封顶（server/sim/content/bonds/addon/meta.js）。
//
// 背景：「远见」每 10 层给资金、「奇迹」每 100 层给资金。原版靠盟约层数上限 999 天然封住，
// 而「深渊回响」把层数上限放开到 1e9（让玩家跟得上敌人），于是这两条会变成无上限的印钞机。
//
// 2026-11-05 第三次定调（维护者）：深潜的**按层给钱不再截断在 999 层** —— 上限解除后
// 「奇迹」在 999 层之后继续发钱。真正防「无限刷新」的那条链已经换成
// `MatchEcho._echoGrantFreeRefresh()`（每回合累计 5 次），所以这里不再需要第二道锁。
// `layerCoinDue()` 的 cap 参数本身保留（其它模式/实验房仍可用），只是深潜不再传 999。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerCoinDue } from '../../server/sim/content/bonds/addon/meta.js';

test('不传上限 = 原版行为（普通房间与现在的深潜都走这条，公式一字不差）', () => {
  for (const layers of [0, 9, 10, 25, 100, 500, 999, 5000, 1e9]) {
    for (const step of [10, 25, 100]) {
      assert.equal(layerCoinDue(layers, step), Math.floor(layers / step), `layers=${layers} step=${step}`);
    }
  }
});

test('深潜口径：层数继续叠，钱也继续发（999 层不再是终点）', () => {
  assert.equal(layerCoinDue(999, 10), 99, '远见：999/10 = 99 档');
  assert.equal(layerCoinDue(1000, 10), 100, '1000 层要多结 1 档');
  assert.equal(layerCoinDue(5000, 10), 500, '5000 层 = 500 档');
  assert.equal(layerCoinDue(1e9, 100), 1e7, '奇迹：1e9/100 也照结');
});

test('cap 参数本身仍然有效（别的模式要收口时还能用）', () => {
  assert.equal(layerCoinDue(999, 10, 999), 99);
  assert.equal(layerCoinDue(5000, 10, 999), 99, '传 999 就结算到 999 层');
  assert.equal(layerCoinDue(1e9, 100, 999), 9);
  assert.equal(layerCoinDue(100, 10, 0), 0, '上限为 0 时一档都不给');
});

test('异常输入安全：step 为 0 / 负数 / 非数字都返回 0，层数为空按 0 算', () => {
  assert.equal(layerCoinDue(100, 0), 0);
  assert.equal(layerCoinDue(100, -10), 0);
  assert.equal(layerCoinDue(100, NaN), 0);
  assert.equal(layerCoinDue(null, 10), 0);
  assert.equal(layerCoinDue(undefined, 10), 0);
});
