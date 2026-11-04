// 「深渊回响」深潜分支的**集成**测试：用真实 Match + 真实数据，直接进深潜回合。
//
// 为什么必须有这个：golden 的 67k 场景一次都不会进深潜（它只跑普通房间），
// 所以「第 3 回合到底有没有敌人」「第 5 回合的 boss 返场到底能不能生成波次」这类问题，
// 单测和 golden 都答不了 —— 只有真的建一个 deepecho 的对局才能答。
//
// 2026-11-03 第二次改（维护者）：深潜从**第 1 回合**开始，所以测试不再手工摆 echoDiveStart = 16。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMatch } from './harness.js';
import { ECHO_BLESSINGS, echoBlessingById } from '../../server/match/match/echoBlessing.js';
import { echoCurseById } from '../../server/match/match/echoCurse.js';

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

// 维护者 2026-11-05：深潜的固定规则之一「独立卡池」—— 每名博士用自己的卡池。
// 房间层面的实验性开关在深潜房里是隐藏的，所以必须由服务端强制，且不能被旧房间 / 手动编组绕开。
test('固定规则：深潜强制独立卡池（每人一池），房间没开也一样', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m.echoVariant, 'deepecho');
  assert.equal(m.experimental.disableSharedPool, true, '房间配置被深潜规则覆盖');
  assert.equal(m.disableSharedPool, true);
  assert.equal(m.poolGroups.length, m.order.length, '卡池组数 = 人数');
  assert.equal(m.playerPools.size, m.order.length, '每人一个自己的卡池');
  assert.equal(new Set(m.playerPools.values()).size, m.order.length, '池不是同一个对象');
  const rules = m._echoFixedRules();
  assert.ok(rules.some((r) => r.id === 'pool' && r.name === '独立卡池'), '固定规则里有独立卡池');
  assert.ok(!rules.some((r) => r.id === 'pool' && !r.desc), '固定规则必须带说明（客户端直接显示 desc）');
});

test('普通房间的独立卡池仍然只听房间设置', (t) => {
  const off = makeMatch({ mode: 'coop', humans: 2, seed: 16, fake: true });
  t.after(() => off.m.dispose());
  assert.equal(off.m.disableSharedPool, false, '没开就是共享卡池');
  assert.equal(off.m.poolGroups.length, 1);
  const on = makeMatch({ mode: 'coop', humans: 2, seed: 16, fake: true, experimental: { revivalEnabled: false, disableSharedPool: true } });
  t.after(() => on.m.dispose());
  assert.equal(on.m.disableSharedPool, true, '手动开仍然有效');
  assert.equal(on.m.playerPools.size, 2);
  assert.deepEqual(on.m._echoFixedRules(), [], '普通房间没有深潜固定规则');
});

// 维护者 2026-11-05：挑战关（深度 5 / 10）的奖励**按全队合计**判定 —— 一个人漏得多、
// 其余人干净，只要全队清怪线到了就发；全员合计没到就吃诅咒。不是逐人结算。
test('挑战关奖励按全队合计：个人退步不影响，队伍达标就给一次祝福三选一', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 4;
  m.startRound(5);                                   // 深度 5 = 挑战关
  const ps = m.alivePlayers();
  const total = m.wave.spawns.reduce((a, s) => a + Math.max(0, s.count), 0);
  const denom = total * ps.length;
  const leaks = Math.ceil(denom * 0.05);             // 全队合计漏 5% → 清怪 95%
  m.lastResults = new Map(ps.map((p, i) => [p.playerId, i === 0
    ? { leaked: Array.from({ length: leaks }, () => ({ counted: true })), perfect: false, killed: 0 }
    : { leaked: [], perfect: true, killed: 0 }]));
  const funds = ps.map((p) => p.pendingFunds);
  const draws = Number(m.echoBlessingDraws) || 0;
  const out = m._echoSettleChallenge();
  assert.ok(out.granted, `全队清怪应达标（实际 ${out.ratio}）`);
  assert.ok(Math.abs(out.ratio - 0.95) < 0.02, `比例应是全队合计（实际 ${out.ratio}）`);
  assert.equal(Number(m.echoBlessingDraws) || 0, draws + 1, '只加一次（团队级，不是每人一次）');
  assert.deepEqual(m.echoCurseIds, [], '达标不吃诅咒');
  assert.deepEqual(ps.map((p) => p.pendingFunds), funds, '挑战关不再发资金');
});

test('挑战关没达标：不给祝福，改加一层诅咒（侵蚀词条上限 +1）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 4;
  m.startRound(5);
  const ps = m.alivePlayers();
  const total = m.wave.spawns.reduce((a, s) => a + Math.max(0, s.count), 0);
  const denom = total * ps.length;
  const leaks = Math.ceil(denom * 0.2);              // 全队合计漏 20% → 清怪 80%，没到 90%
  m.lastResults = new Map(ps.map((p, i) => [p.playerId, i === 0
    ? { leaked: Array.from({ length: leaks }, () => ({ counted: true })), perfect: false, killed: 0 }
    : { leaked: [], perfect: true, killed: 0 }]));
  const draws = Number(m.echoBlessingDraws) || 0;
  const capBefore = m._echoWordCap();
  const out = m._echoSettleChallenge();
  assert.equal(out.granted, false);
  assert.equal(Number(m.echoBlessingDraws) || 0, draws, '没达标不发祝福');
  assert.equal(m.echoCurseIds.length, 1, '改为加一层诅咒');
  const dropped = echoCurseById(m.echoCurseIds[0]);
  assert.ok(dropped, '抽到的是已知诅咒');
  assert.equal(dropped.rarity, 'common', '深度 5 只会投放普通诅咒');
  assert.ok(m._echoCurses().some((c) => c.id === 'erosion'), '深渊回响的诅咒列表里看得到');
  assert.equal(m._echoWordCap(), Math.min(8, capBefore + 1), '诅咒真的加难度（词条上限 +1）');
});

// 维护者 2026-11-05：祝福要有「全队一次性回复生命」这类，**多种档位随机到**，且数值刻意做小，
// 封顶到各自的初始生命，避免把深渊的漏怪抹平。
test('祝福「回复生命」：多档位、数值都小、封顶到初始生命', (t) => {
  const heals = ECHO_BLESSINGS.filter((b) => b.kind === 'heal');
  assert.ok(heals.length >= 3, '至少三种回复档位（随机到才有多样性）');
  for (const b of heals) {
    assert.ok(Number.isInteger(b.healLp) && b.healLp > 0, `${b.id} 必须有正整数 healLp`);
    assert.ok(b.healLp <= 10, `${b.id} 的 ${b.healLp} 点太大（维护者要求数值不能很大）`);
  }
  // 每档各建一间房：祝福上限 3 个，同一局里连发会撞上限
  for (const b of heals) {
    const h = dive();
    const m = h.m;
    try {
      const ps = m.alivePlayers();
      for (const p of ps) p.lp = Math.max(1, m.gd.startLp(p.bandId) - 20);
      const before = ps.map((p) => p.lp);
      m._echoGrantBlessing(b);
      assert.deepEqual(ps.map((p) => p.lp), before.map((n) => n + b.healLp), `${b.id}：每人 +${b.healLp}`);
      assert.ok(m.echoBlessings.includes(b.id), `${b.id} 已记入祝福`);
    } finally {
      m.dispose();
    }
  }
  // 回满后不再溢出
  const h = dive();
  const m = h.m;
  try {
    const ps = m.alivePlayers();
    for (const p of ps) p.lp = m.gd.startLp(p.bandId) - 1;
    m._echoGrantBlessing(echoBlessingById('heal_l'));
    for (const p of ps) assert.equal(p.lp, m.gd.startLp(p.bandId), '不能超过初始生命');
  } finally {
    m.dispose();
  }
});

// 维护者 2026-11-05：诅咒可以被祝福消掉，但**固定的奇迹 / 远见诅咒永远消不掉**。
test('祝福「净化 / 涤罪」：清得掉累积诅咒，清不掉固定的奇迹 / 远见', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 5;                                     // 有深度，诅咒才会进词条上限
  m.echoCurseIds.push('erosion', 'erosion');
  assert.ok(m._echoWordCap() > 3, '先确认诅咒真的加了难度');
  m._echoGrantBlessing(echoBlessingById('cleanse'));
  assert.deepEqual(m.echoCurseIds, ['erosion'], '净化：只移除 1 层');
  const shown = m._echoCurses();
  assert.ok(shown.some((c) => c.id === 'miracle'), '奇迹·诅咒不受影响');
  assert.ok(shown.some((c) => c.id === 'foresight'), '远见·诅咒不受影响');

  m.echoCurseIds.push('erosion', 'erosion', 'swarm');   // 稀有（swarm）不该被涤罪清掉
  m._echoGrantBlessing(echoBlessingById('cleanse_all'));
  assert.deepEqual(m.echoCurseIds, ['swarm'], '涤罪：只清普通诅咒，稀有保留');
  const after = m._echoCurses();
  assert.ok(after.some((c) => c.id === 'miracle'), '奇迹·诅咒仍然在');
  assert.ok(after.some((c) => c.id === 'foresight'), '远见·诅咒仍然在');
});

// 维护者 2026-11-05：诅咒词条不能只是「列表里有」—— 每一条都要能看到它在对局里的实际影响。
// 这里同一条对局先跑一层做基线，再把诅咒塞进去重跑同一层，逐项对账。
test('诅咒真的生效：时限 / 情报 / 刷新上限 / 祝福上限 / 敌方数值 / 出怪量', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());

  const runDepth = (depth) => { m.round = depth - 1; m.startRound(depth); };
  runDepth(20);                                        // 20 层是普通回合（固定节点是 15 / 25）
  const base = {
    time: m.wave.timeLimit,
    units: m.wave.spawns.reduce((a, s) => a + (Number(s.count) || 0), 0),
    intel: m._echoIntel(),
    refreshCap: m._echoFreeRefreshCap(),
    blessCap: m._echoBlessingMax(),
    scale: m.gd.enemyScale(20),
  };
  assert.ok(base.intel && base.intel.threat > 0, '基线：有情报');

  // 一次性把「滞重 / 迷雾 / 枯竭 / 静默 / 甲壳 / 狂怒 / 蜂拥」全挂上
  m.echoCurseIds.push('leaden', 'fog', 'drought', 'silence', 'carapace', 'frenzy', 'swarm');
  runDepth(20);

  assert.ok(m.wave.timeLimit < base.time, `滞重：时限应变短（${base.time} → ${m.wave.timeLimit}）`);
  assert.equal(m._echoIntel(), null, '迷雾：情报整块关闭');
  assert.equal(m._echoFreeRefreshCap(), base.refreshCap - 1, '枯竭：免费刷新上限 -1');
  assert.equal(m._echoBlessingMax(), base.blessCap - 1, '静默：祝福上限 -1');
  const after = m.gd.enemyScale(20);
  assert.ok(after.hpMul > base.scale.hpMul, '甲壳：敌方生命更高');
  assert.ok(after.atkMul > base.scale.atkMul, '狂怒：敌方攻击更高');
  const units = m.wave.spawns.reduce((a, s) => a + (Number(s.count) || 0), 0);
  assert.ok(units > base.units, `蜂拥：同样预算出怪更多（${base.units} → ${units}）`);
});

// 维护者 2026-11-05：固定回合加诅咒 + 每回合随机刷新的回合诅咒 + 会销毁装备的诅咒。
test('固定回合加诅咒、回合诅咒逐回合刷、锈蚀销毁装备', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());

  m.round = 5;
  m.startRound(6);                                     // 深度 6 = 固定诅咒回合
  assert.ok(m.echoCurseIds.includes('tribute'), '深度 6 固定加「贡赋」');
  const once = m.echoCurseIds.filter((x) => x === 'tribute').length;
  m.round = 5;
  m.startRound(6);                                     // 再进同一层
  assert.equal(m.echoCurseIds.filter((x) => x === 'tribute').length, once, '同一固定回合不重复加');

  // 回合诅咒：本回合的那条要么为空、要么是 scope=round
  m.round = 9;
  m.startRound(10);
  if (m.echoRoundCurse) {
    assert.equal(echoCurseById(m.echoRoundCurse).scope, 'round', '回合诅咒的 scope 必须是 round');
    assert.ok(m._echoCurses().some((c) => c.name.includes('（本回合）')), '显示里标注本回合');
  }
  // 显示：手动塞一条回合诅咒
  m.echoRoundCurse = 'r_frenzy';
  assert.ok(m._echoCurses().some((c) => c.id === 'r_frenzy' && c.name.includes('（本回合）')));

  // 锈蚀：销毁一件已装备的装备
  const ps = m.alivePlayers()[0];
  const piece = { uid: 9001, items: [{ id: 'it_a', uid: 1 }, { id: 'it_b', uid: 2 }] };
  ps.board.set(9001, piece);
  assert.equal(m._echoDestroyEquipped(ps, () => 0), 1, '销毁返回 1');
  assert.equal(piece.items.length, 1, '少了一件装备');
});

// 维护者 2026-11-05：部署禁令——「封锁」封地块、「排异」禁盟约（同构体授予的盟约也算）。
test('部署禁令：封锁地块 / 排异盟约，且只拦新上场不拦移动', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());

  m.round = 7;
  m.startRound(8);                                     // 深度 8 = 封锁
  assert.ok(m.echoCurseIds.includes('block_tiles'), '深度 8 固定加「封锁」');
  assert.equal(m.echoBannedTiles.length, 3, '封 3 个地块');
  const banned = m.echoBannedTiles[0];
  assert.match(String(m._echoDeployBlocked({ kind: 'chess' }, banned, true) || ''), /封锁/);
  const free = '3,3';
  assert.equal(m.echoBannedTiles.includes(free), false);
  assert.equal(m._echoDeployBlocked({ kind: 'chess' }, free, true), null, '没被封的地块可以放');

  // 排异：挑一个真实干员，它带某个盟约
  const chessRaw = m.gd.raw?.chess || {};
  const pair = Object.entries(chessRaw).find(([, rec]) => Array.isArray(rec?.bonds) && rec.bonds.length && m.gd.bond(rec.bonds[0]));
  assert.ok(pair, '数据里至少要有一个带盟约的干员');
  const [chessId, rec] = pair;
  m.echoBannedBond = rec.bonds[0];
  const piece = { kind: 'chess', id: chessId, items: [] };
  assert.match(String(m._echoDeployBlocked(piece, free, true) || ''), /排异/, '排异盟约的干员不能上场');
  assert.equal(m._echoDeployBlocked(piece, free, false), null, '已经在场上的干员移动不受限');

  // 公开视图要带上禁令，客户端才能高亮
  const pub = m._echoPublic();
  assert.deepEqual(pub.bans.tiles, m.echoBannedTiles);
  assert.equal(pub.bans.bond, m.echoBannedBond);
});

// 维护者 2026-11-05：悬赏「打掉但没结算」的边界 —— 打掉的卡不能算失败。
// 判定依据：kill 钩子记下的 echoBountyPaid（victim.mods.bountyId）；拿不到回执时，
// 本轮有悬赏收入也按达成处理（服务端只有汇总 coin，宁可漏判也不误伤）。
test('悬赏未达成：打掉的不算失败，没打掉才降诅咒', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  const card = (id) => ({ id, card: { payout: 'kill', coin: 10, enemyKey: 'enemy_x' }, roundsLeft: 1 });

  ps.bounties = [card('a')];
  m.echoBountyPaid = ['a'];
  m.lastResults = new Map([[ps.playerId, { coins: 0, perfect: false }]]);
  assert.equal(m._echoSettleBountyFailure([ps]), null, '击杀回执在 → 不算失败');

  ps.bounties = [card('b')];
  m.echoBountyPaid = [];
  assert.ok(m._echoSettleBountyFailure([ps]), '没打掉 → 降诅咒');

  ps.bounties = [card('c')];
  m.lastResults = new Map([[ps.playerId, { coins: 10, perfect: false }]]);
  assert.equal(m._echoSettleBountyFailure([ps]), null, '有悬赏收入 → 按达成处理（保守，不误伤）');

  ps.bounties = [card('d')];
  ps.bounties[0].roundsLeft = 2;                       // 还没到期
  m.echoBountyPaid = [];
  m.lastResults = new Map([[ps.playerId, { coins: 0, perfect: false }]]);
  assert.equal(m._echoSettleBountyFailure([ps]), null, '还有一轮的卡不算失败');
});

// 维护者 2026-11-05：多扣生命的诅咒 —— 只放大已有漏怪，没有漏怪不扣，且仍吃每回合上限。
test('生命惩罚诅咒：漏怪伤害按倍率/额外值放大，仍受上限', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const cap = m.gd.lpCapPerRound;

  assert.equal(m._echoLpLoss(3, cap), 3, '没诅咒时等值');
  m.echoCurseIds = ['bleed'];                       // ×1.5
  assert.equal(m._echoLpLoss(3, cap), 5, '3 漏 ×1.5 = 4.5 向上取整 5');
  assert.equal(m._echoLpLoss(0, cap), 0, '没漏怪一点不扣');

  m.echoCurseIds = ['hemorrhage'];                  // ×2
  assert.equal(m._echoLpLoss(4, cap), 8);

  m.echoCurseIds = ['ache'];                        // +2
  assert.equal(m._echoLpLoss(1, cap), 3, '1 漏 + 2');
  assert.equal(m._echoLpLoss(0, cap), 0, '没漏怪也不额外扣');

  m.echoCurseIds = ['hemorrhage'];
  assert.equal(m._echoLpLoss(cap + 5, cap), cap, '仍然受每回合上限约束');

  // 回合诅咒也吃到（倍率现算）
  m.echoCurseIds = [];
  m.echoRoundCurse = 'r_bleed';                     // ×1.25
  assert.equal(m._echoLpLoss(4, cap), 5, '4 ×1.25 = 5');
  m.echoRoundCurse = null;
});

// 维护者 2026-11-05：诅咒 / 侵蚀词条的播报（ticker 会互相覆盖，所以同一回合必须合成一条）。
test('播报：诅咒降下与侵蚀词条变化都会发 ticker，且合成一行', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const said = [];
  m.tickerText = (text) => { said.push(String(text)); };

  m.round = 5;
  m.startRound(6);                                     // 深度 6：固定诅咒 + 侵蚀词条
  assert.ok(said.length >= 1, '至少要播一条');
  const line = said.at(-1);
  assert.match(line, /深渊诅咒/, `播报里要有诅咒：${line}`);
  assert.match(line, /侵蚀词条/, `播报里要有侵蚀词条：${line}`);
  assert.ok(line.includes('贡赋'), '深度 6 的固定诅咒是贡赋');

  // 同一回合重复进不会重复播（fixed 只在第一次触发）
  said.length = 0;
  m.round = 5;
  m.startRound(6);
  assert.equal(said.some((x) => x.includes('贡赋')), false, '同一条固定诅咒不重复播');

  // 净化也会播
  said.length = 0;
  m.echoCurseIds = ['erosion', 'erosion'];
  m._echoGrantBlessing(echoBlessingById('cleanse'));
  assert.ok(said.some((x) => x.includes('净化')), '净化要播报');
});

// bossRounds 在 boss 通关后曾调 `startRound(this._echoBeginDive(round))`；「建房即深潜」之后
// `_echoBeginDive` 恒返回 `echoDiveStart = 1`，于是整局被打回第 1 回合（商店/回合/深度/出怪全部重来）。
// 现在 boss 通关只做 `startRound(round + 1)`，这条用例把接缝和源码一起钉住。
test('boss 通关继续往下打：深度跟着回合走，不会回到 1', () => {
  const h = dive();
  const m = h.m;
  try {
    m.round = 14;
    m.startRound(m.round + 1);                 // = bossRounds 现在的下一回合
    assert.equal(m.round, 15);
    assert.equal(m.echoDiveStart, 1, '深潜仍是从第 1 回合起算');
    assert.equal(m._echoDepth(), 15, '深度 = 显示回合，不是 1');
    assert.ok(m.wave || m.bossWaves, '第 15 层必须有波次');
  } finally {
    m.dispose();
  }
  const src = readFileSync(new URL('../../server/match/match/bossRounds.js', import.meta.url), 'utf8');
  assert.ok(!/startRound\(\s*this\._echoBeginDive/.test(src), 'bossRounds 不能再拿 _echoBeginDive 当下一回合');
  assert.ok(!/_echoBeginDive\s*\(/.test(src.replace(/\/\/[^\n]*/g, '')), '_echoBeginDive 已删除，不应再被调用');
});

