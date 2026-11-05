// 「盟约投影」（维护者 2026-11-05）：16 层起每 10 层一次的全队三选一特殊祝福。
// 规则：全程只能同时存在一个、不占 3 个祝福名额、不进原版三选一池；按满档生效（阿戈尔 5 人档）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { ECHO_PROJECTIONS, echoProjectionById, isEchoProjectionLayer, pickProjectionOffer } from '../../server/match/match/echoProjection.js';

const dive = (seed = 9) => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed, fake: true, variant: 'deepecho' });

test('盟约投影：8 条核心盟约，层数节奏 16/26/36…', () => {
  assert.equal(ECHO_PROJECTIONS.length, 8);
  for (const id of ['siracusaShip', 'yanShip', 'victoriaShip', 'sargonShip', 'lateranoShip', 'kjeragShip', 'kazimierzShip', 'egirShip']) {
    assert.ok(echoProjectionById(id), `${id} 要在投影表里`);
  }
  assert.equal(echoProjectionById('egirShip').tier, 5, '阿戈尔满档是 5 人');
  for (const d of [16, 26, 36, 46]) assert.equal(isEchoProjectionLayer(d), true, `${d} 层要开投影`);
  for (const d of [15, 17, 25, 27, 35]) assert.equal(isEchoProjectionLayer(d), false, `${d} 层不开`);
});

test('候选永远是 3 条且不重复；已有投影时当前那条一定在候选里', () => {
  const offer = pickProjectionOffer(() => 0.42, null);
  assert.equal(offer.length, 3);
  assert.equal(new Set(offer).size, 3, '候选不能重复');
  const keep = pickProjectionOffer(() => 0.7, 'yanShip');
  assert.ok(keep.includes('yanShip'), '已有投影时保留它作为「不换」选项');
  assert.equal(new Set(keep).size, 3);
});

test('全队投票 → 结算 → 战斗输入按满档注入（projectedBond + bonds 激活）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  // 别让别的面板挡住投影
  m.echoSupply = null;
  m.echoBlessingOffer = null;
  assert.equal(m._echoOpenProjection(true), 1, '16 层要开投影面板');
  const options = m.echoProjectionOffer.options;
  assert.equal(options.length, 3);
  const [a, b] = m.alivePlayers();
  m.setEchoProjectionPick(a, 2);
  assert.ok(m.echoProjectionOffer, '还有人没投就不结算');
  m.setEchoProjectionPick(b, 2);
  assert.equal(m.echoProjection, options[2], '票多者得');
  assert.equal(m.echoProjectionOffer, null, '结算后收面板');
  const pub = m.publicView().echo.projection;
  assert.equal(pub.current.id, options[2], '下发给客户端当前投影');
  assert.equal(pub.current.desc.length > 0, true, '要带效果说明');
  // 战斗输入：所有己方干员都算该盟约成员
  const input = a.battleInput({ side: 'L', colOffset: 0 });
  assert.equal(input.projectedBond, options[2], '输入要带 projectedBond');
  assert.equal(input.bonds[options[2]].active, true, '该盟约要按满档激活');
  assert.equal(input.bonds[options[2]].count, echoProjectionById(options[2]).tier, '满档人数');
});

test('再次触发可以替换：选新的顶掉旧的', (t) => {
  const h = dive(11);
  const m = h.m;
  t.after(() => m.dispose());
  m.echoProjection = 'yanShip';
  m.round = 25;
  m.startRound(26);
  m.echoSupply = null;
  m.echoBlessingOffer = null;
  assert.equal(m._echoOpenProjection(true), 1, '26 层再开一次');
  assert.ok(m.echoProjectionOffer.options.includes('yanShip'), '当前投影在候选里（可以不换）');
  const pick = m.echoProjectionOffer.options.findIndex((id) => id !== 'yanShip');
  const [a, b] = m.alivePlayers();
  m.setEchoProjectionPick(a, pick);
  m.setEchoProjectionPick(b, pick);
  assert.equal(m.echoProjection, m.echoProjectionOffer ? m.echoProjection : m.echoProjection);
  assert.notEqual(m.echoProjection, 'yanShip', '选新的要替换旧的');
  assert.equal(m._echoBlessings().length, 0, '投影不占祝福名额、不进祝福列表');
});
