// 「深渊回响」深潜分支的**集成**测试：用真实 Match + 真实数据，直接进深潜回合。
//
// 为什么必须有这个：golden 的 67k 场景一次都不会进深潜（它只跑普通房间），
// 所以「第 3 回合到底有没有敌人」「第 5 回合的 boss 返场到底能不能生成波次」这类问题，
// 单测和 golden 都答不了 —— 只有真的建一个 deepecho 的对局才能答。
//
// 2026-11-03 第二次改（维护者）：深潜从**第 1 回合**开始，所以测试不再手工摆 echoDiveStart = 16。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

/** 一间 deepecho 房（fake 战斗，不跑真实模拟）。 */
const dive = (o = {}) => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true, variant: 'deepecho', ...o });

test('variant 真的传进 Match 了，且深潜从第 1 回合开始', (t) => {
  const h = dive();
  t.after(() => h.m.dispose());
  assert.equal(h.m.echoVariant, 'deepecho');
  assert.equal(h.m.mode, 'coop', '底层仍是 coop，不新增 mode 值');
  assert.equal(h.m.echoDiveStart, 1, '建房即深潜（不再等打完最后一个 boss）');
  // 层数上限：深潜重新解除到 1e9（2026-11-03 第二次改）。
  // 「远见 / 奇迹」的无限刷新与无限资金改在 effectsMeta 源头堵死（bondLayerCoinCap=60、免费刷新≤2）。
  assert.equal(h.m.layerCapOff, true, '深潜解除层数上限（1e9）');
});

test('普通房间没有 echoVariant（不受影响：层数上限仍是原版 999）', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 16, fake: true });
  t.after(() => h.m.dispose());
  assert.equal(h.m.echoVariant, null);
  assert.equal(h.m.echoDiveStart, null);
  assert.equal(h.m.disableLayerCap, false);
  assert.equal(h.m.layerCapOff, false, '原版房间一行不碰');
});

test('第 3 回合就是深潜普通回合：波次非空，且不进 boss 分支', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 2;
  m.startRound(3);
  assert.equal(m.round, 3);
  assert.equal(m.bossWaves, null, '深潜普通回合不该有 boss 波次');
  assert.ok(m.wave, '必须有普通波次');
  assert.ok(Array.isArray(m.wave.spawns) && m.wave.spawns.length > 0, '第 3 回合必须有敌人（数据回合映射生效）');
  for (const s of m.wave.spawns) {
    assert.equal(typeof s.enemyKey, 'string');
    assert.ok(m.gd.enemy(s.enemyKey), `spawn ${s.enemyKey} 必须是真实敌人`);
  }
  assert.ok(Array.isArray(m.echoWordsActive) && m.echoWordsActive.length >= 1, '深潜回合就有侵蚀词条');
});

test('第 25 回合 boss 返场：真的生成了 boss 波次（数据表只到 15 也能借模板）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 24;
  m.startRound(25);
  assert.equal(m.round, 25);
  assert.ok(Array.isArray(m.bossWaves) && m.bossWaves.length > 0, '深度 25 必须有 boss 波次');
  assert.equal(m.wave, null, 'boss 回合没有普通波次');
  for (const g of m.bossWaves) {
    assert.ok(g.wave, '每组都要有波次对象');
    assert.equal(typeof g.wave.templateId, 'string', '必须解析到模板 id（从第 1 回合深潜时借官方最后一关）');
    assert.ok(Array.isArray(g.wave.spawns) && g.wave.spawns.length > 0, 'boss 波次不能是空的');
  }
  // 备战情报在 boss 返场回合要交还给原版预览（intel 为 null）
  assert.equal(m._echoIntel(), null, 'boss 返场是明牌，不给聚合情报');
});

test('深度 23 悬赏节点：目标从本回合生成的波次里抽出来', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 22;
  m.startRound(23);
  const players = m.alivePlayers();
  assert.ok(players.length > 0);
  const keys = new Set((m.wave?.spawns || []).map((s) => s.enemyKey));
  let got = 0;
  for (const ps of players) {
    for (const b of ps.bounties) {
      got += 1;
      assert.ok(keys.has(b.card.enemyKey), `悬赏目标 ${b.card.enemyKey} 必须在本回合波次里`);
      assert.ok(b.card.coin >= 1 && b.card.coin <= 8, '赏金在 1..8');
      assert.equal(b.card.payout, 'kill');
    }
  }
  assert.ok(got > 0, '深度 23 必须发出悬赏');
});

test('深度 4 不发悬赏（不是节点）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 3;
  m.startRound(4);
  for (const ps of m.alivePlayers()) assert.equal(ps.bounties.length, 0, '深度 4 不该有悬赏');
});

test('备战阶段：原版明细照常发，额外的聚合情报另发一块', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 2;
  m.startRound(3);
  const ps = m.alivePlayers()[0];
  // 维护者 2026-11-03 定：原版「敌方情报」四项全部保留（总数 / 阵营 / 逐只列表 / boss 块），
  // 所以深潜回合的 nextEnemies **不是空**。
  const list = m.nextEnemiesFor(ps);
  assert.ok(Array.isArray(list) && list.length > 0, '深潜回合也要发逐只敌人明细');
  assert.ok(list.every((e) => typeof e.enemyKey === 'string'), '每条都带 enemyKey（原版面板要用）');
  const intel = m._echoIntel();
  assert.ok(intel, '必须有聚合情报');
  assert.ok(intel.threat > 0, '威胁值 > 0');
  assert.equal(Object.hasOwn(intel, 'count'), false);
  assert.equal(Object.hasOwn(intel, 'air'), false);
  // 深度 3 的下一个 boss 节点是 5
  assert.equal(intel.nextNodeRound, 5);
});

test('无尽：第 30 回合不会自己结束（只有团灭才结束）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 29;
  m.startRound(30);
  assert.equal(m.ended, false, '深度 30 不是终点');
  assert.equal(m._echoAtEnd(), false);
});

// 维护者 2026-11-04 §6：16 层以后「按层设计」而不是硬套原版模板 —— 旧实现在深度 16（轮回到数据回合 1）
// 会从 15 层的 112 只掉到 14 只；新实现必须单调递增，且整波铺进最后一关的时限。
test('16 层以后：真实波次的只数随深度递增，时限按只数比例放大（原版 230 秒 / 112 只）', () => {
  const counts = [];
  for (const depth of [16, 20, 24]) {
    const h = dive();
    const m = h.m;
    try {
      m.round = depth - 1;
      // 「按钱出怪」用期望资金（20 + 6×深度），三档的随机系数都是 1，只数才可比。
      for (const ps of m.alivePlayers()) ps.funds = 20 + 6 * depth;
      m.startRound(depth);
      assert.ok(m.wave && Array.isArray(m.wave.spawns), `深度 ${depth} 必须有普通波次`);
      for (const s of m.wave.spawns) assert.ok(m.gd.enemy(s.enemyKey), `深度 ${depth} 的 ${s.enemyKey} 必须是真实敌人`);
      counts.push(m.wave.spawns.reduce((a, s) => a + s.count, 0));
      assert.ok(m.wave.timeLimit >= 200, `深度 ${depth} 的时限应随只数放大（实际 ${m.wave.timeLimit}）`);
    } finally {
      m.dispose();
    }
  }
  assert.ok(counts[0] >= 100, `深度 16 只有 ${counts[0]} 只（旧版在这里掉到 14 只）`);
  assert.ok(counts[0] < counts[1], `16 层 ${counts[0]} → 20 层 ${counts[1]} 必须变多`);
  assert.ok(counts[1] < counts[2], `20 层 ${counts[1]} → 24 层 ${counts[2]} 必须变多`);
  assert.ok(counts[2] <= 160, `深度 24 的 ${counts[2]} 只超过硬顶`);
});

