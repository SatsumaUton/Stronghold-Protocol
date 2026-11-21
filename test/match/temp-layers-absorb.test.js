// test/match/temp-layers-absorb.test.js —— 规程临时层数在结算时自动并入永久层（维护者 2026-11-21，B 方案）。
//
// 背景：乌萨斯的「击倒敌人 +2/+4 临时层数」以前只存在于那一场战斗内，
// onBattleResult 派发完就 delete；没有「转化临时层」驻防的玩家，战斗里攒的临时层全部消失。
// 现在：转化驻防**先**消费（照旧从池里扣），剩下的在派发结束后并入 ps.layers。
//
// 驱动方式与 test/garrisons/regulation.test.js 一致（规程数据 + solo/NORMAL + 真实 settle）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { getVersionData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';

const QUIET = { warn() {}, error() {}, info() {} };
const RAW = getVersionData('act3autochess@V3_1', { log: QUIET });
const REG = createRegistry({ log: QUIET });
setGameData(RAW);
test.after(() => setGameData(null));

/** 一次结算，只带回一组临时层数。 */
const result = (temp) => ({
  leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0,
  tempLayerGains: temp, unitsEnd: [],
});

test('临时层数在结算后并入永久层（规程乌萨斯）', (t) => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 70, registry: REG, fake: true, data: RAW }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  const m = h.m;
  t.after(() => m.dispose());

  const ps = h.ps('p_0');
  ps.funds = 50;
  ps.layers = {};
  ps.recompute();
  ps.addLayers('ursusShip', 5, { requireActive: false });
  const before = Number(ps.layers.ursusShip) || 0;

  m.lastResults.set(ps.playerId, result({ ursusShip: 6 }));
  m.settle(null, null);
  const after = Number(ps.layers.ursusShip) || 0;

  assert.equal(ps.tempLayers, undefined, '结算后清掉临时层袋子');
  assert.ok(after >= before + 6, `临时 6 层要并进去（${before} → ${after}）`);
});
