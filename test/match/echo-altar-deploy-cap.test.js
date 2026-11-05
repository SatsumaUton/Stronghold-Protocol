// 深渊祭坛「献祭 · 永久」：本局最多 +1 部署位（维护者 2026-11-05）。
//
// 之前没有上限：只在「层数 %5 == 0 且祭坛开放」时可买，80 层平均能买 3.7 次，
// 部署位会一直涨（基础 8）。现在整局限 1 次，买过之后祭坛不再提供这一项。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, settleEchoPanels } from './harness.js';
import { snapshotMatch } from '../../server/match/snapshot.js';

const dive = () => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 5, fake: true, variant: 'deepecho' });

/** 站到第 depth 层（祭坛每层独立计次），资金给足。 */
function atLayer(m, depth) {
  m.round = depth;
  m.echoAltar = { round: depth, used: new Map() };
  const ps = m.alivePlayers()[0];
  ps.funds = 999999;
  return ps;
}

test('第一次买「永久」：部署位 +1', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  const ps = atLayer(m, 20);
  const base = ps.deployCap;
  assert.equal(m.buyEchoAltar(ps, 'permanent')?.ok, true, '第 20 层能买');
  assert.equal(ps.deployCap, base + 1, '部署位 +1');
  assert.equal(ps.echoAltarDeployBought, 1, '记一次');
});

test('第二次买「永久」被拒（换一层也不行）：本局上限 1 次', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  const ps = atLayer(m, 20);
  assert.equal(m.buyEchoAltar(ps, 'permanent')?.ok, true);
  const cap = ps.deployCap;
  // 换到 25 层（祭坛重新开放、本层次数清零）再买
  atLayer(m, 25);
  const again = m.buyEchoAltar(ps, 'permanent');
  assert.equal(again && again.error, 'WRONG_PHASE', '要拒绝');
  assert.equal(again && again.detail, 'deploy slot cap reached');
  assert.equal(ps.deployCap, cap, '部署位不再涨');
});

test('别的来源加的部署位不受这条上限影响', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  const ps = atLayer(m, 20);
  ps.deployCapBonus = 3;          // 盟约 / 机变之类先加过 3 个
  const base = ps.deployCap;
  assert.equal(m.buyEchoAltar(ps, 'permanent')?.ok, true, '祭坛仍然能加这 1 个');
  assert.equal(ps.deployCap, base + 1);
  assert.equal(ps.deployCapBonus, 4, '在原有基础上 +1');
});

test('界面状态：买过之后 canPermanent 变 false，public 里带 deployBought / permanentMax', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  const ps = atLayer(m, 20);
  // 这一层祭坛是开的（否则 public 里没有 altar 块）
  m.echoAltarOpenRound = m.round;
  m.echoAltarOpen = true;
  assert.equal(m._echoAltarView(ps).canPermanent, true, '没买过时可以买');
  m.buyEchoAltar(ps, 'permanent');
  assert.equal(m._echoAltarView(ps).canPermanent, false, '买过之后界面要锁死');
  const pub = m._echoPublic().altar;
  assert.ok(pub, '祭坛对准备阶段可见');
  assert.equal(pub.permanentMax, 1);
  assert.equal(pub.deployBought[ps.playerId], 1);
});

test('买过几次要进存档（读档后不能又买一次）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  const ps = atLayer(m, 20);
  m.buyEchoAltar(ps, 'permanent');
  // 面板开着时 canSnapshot 拒绝存档（准备倒计时被按住），先结算掉
  settleEchoPanels(m);
  const doc = snapshotMatch(m);
  assert.ok(doc, '准备阶段能存检查点');
  const saved = doc.players?.[ps.playerId] || doc.match?.players?.[ps.playerId] || null;
  const bag = saved || doc;
  assert.ok(JSON.stringify(bag).includes('echoAltarDeployBought'), '存档里要有这个字段');
});
