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
import { isFlyKey } from '../../server/match/waves.js';
import { ECHO_BLESSINGS, echoBlessingById, echoBlessingOffer } from '../../server/match/match/echoBlessing.js';
import { echoCurseById, ECHO_CURSES, ECHO_ROUND_CURSES } from '../../server/match/match/echoCurse.js';

/** 一间 deepecho 房（fake 战斗，不跑真实模拟）。 */
const dive = (o = {}) => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true, variant: 'deepecho', ...o });

test('variant 真的传进 Match 了，且深潜从第 1 回合开始', (t) => {
  const h = dive();
  t.after(() => h.m.dispose());
  assert.equal(h.m.echoVariant, 'deepecho');
  assert.equal(h.m.mode, 'coop', '底层仍是 coop，不新增 mode 值');
  assert.equal(h.m.echoDiveStart, 1, '建房即深潜（不再等打完最后一个 boss）');
  // 层数上限：维护者 2026-11-05 —— 盟约层数**仍然无上限**（其它盟约要能突破 999），
  // 但「按层给钱」（远见 / 奇迹）在 effectsMeta 的 bondLayerCoinCap 处锁死在 999 层。
  assert.equal(h.m.layerCapOff, true, '深潜解除层数上限');
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

// 维护者 2026-11-05：16 层起的经济消耗（商店/刷新价每层 +4%、封顶 ×1.5）原来「不改界面」，
// 现在要作为**固定规则**明示，并在进入 16 层时向玩家播报（挂机回来也能在播报里看到）。
test('16 层起的「深渊通胀」是固定规则：有条目、有播报、倍率与真实价格同源', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m._echoShopInflate(15), 1, '15 层还不涨');
  assert.equal(m._echoShopInflate(16).toFixed(2), '1.04', '16 层 ×1.04');
  assert.equal(m._echoShopInflate(20).toFixed(2), '1.20', '20 层 ×1.20');
  assert.equal(m._echoShopInflate(30).toFixed(2), '1.50', '封顶 ×1.5');
  assert.equal(m._echoShopInflate(80).toFixed(2), '1.50', '再深也不超过 ×1.5');
  // 固定规则条目
  m.round = 16;
  const rule = m._echoCurses().find((c) => c.id === 'abyss_inflation');
  assert.ok(rule, '固定规则里必须有「深渊通胀」');
  assert.equal(rule.rarityLabel, '固定');
  assert.match(rule.desc, /×1\.04/, '描述要显示当前倍率');
  // 真实价格走同一个倍率（不能界面写一套、收费另一套）
  assert.equal(m._echoShopPriceMul(), 1.04);
  // 进入 16 层要有播报
  const tickers = [];
  const orig = m.tickerText.bind(m);
  m.tickerText = (text, prio) => { tickers.push(String(text)); return orig(text, prio); };
  m._echoRefreshCurses(16);
  m._echoFlushAnnounce();
  const line = tickers.find((s) => s.includes('深渊通胀')) || '';
  assert.ok(line, '16 层要播报「深渊通胀」');
  assert.match(line, /新增固定规则/, '要说明这是新增的规则，而不是只报倍率');
  assert.match(line, /商店购买价与刷新价/, '要说明影响哪些价格');
  assert.match(line, /封顶 ×1\.5/);
  assert.match(rule.desc, /刷新价/, '固定规则条目也要写清楚影响刷新价');
});

// 维护者 2026-11-05：选祝福时切不出去看自己有什么诅咒 —— 面板里要有「查看诅咒」按钮；
// 能消诅咒的祝福（净化 / 涤罪 / 反制）在**真的有东西可清**时要标「推荐」。
test('祝福三选一：诅咒清单可查，消诅咒的祝福按当前局势标「推荐」', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const cleanse = echoBlessingById('cleanse');      // 净化：清 1 条（任意稀有度）
  const purify = echoBlessingById('cleanse_all');   // 涤罪：只清普通
  const quench = echoBlessingById('quench');        // 畅饮：驱散枯竭/干涸

  m.echoCurseIds = [];
  m.echoRoundCurse = null;
  assert.equal(m._echoClearableCurses(cleanse), null, '身上没诅咒时不推荐净化');

  m.echoCurseIds = ['frenzy', 'silence'];           // 稀有 + 传说
  assert.equal(m._echoClearableCurses(cleanse).count, 1, '净化只能清 1 条');
  assert.equal(m._echoClearableCurses(purify), null, '涤罪只清普通，没有普通诅咒就不推荐');

  m.echoCurseIds = ['tribute', 'frenzy'];           // 普通 + 稀有
  assert.equal(m._echoClearableCurses(purify).count, 1, '涤罪清掉那条普通诅咒');

  m.echoCurseIds = ['drought'];
  assert.equal(m._echoClearableCurses(quench).names[0], '枯竭', '反制按 id 匹配');

  // 三选一的公开视图要带上 recommend / recommendText，客户端才能画角标
  m.echoCurseIds = ['silence'];
  m.echoBlessingOffer = ['cleanse'];
  const opt = m._echoOfferView().options[0];
  assert.equal(opt.recommend, true, '有传说诅咒时净化应标推荐');
  assert.match(opt.recommendText, /静默/);
  m.echoCurseIds = [];
  assert.equal(m._echoOfferView().options[0].recommend, false, '没诅咒就不标');
  m.echoBlessingOffer = null;
});

// 玩家 2026-11-05 实测：「25 层打完 boss 又回到 16 层」。
// 成因：`_finishFinal` 的原版隐藏核心分支没有排除深潜 —— 深潜层数无上限，25/35/45 的返场 boss
// 打赢后 `hiddenEligible()` 也可能为真，于是 `startRound(gd.hiddenRound = 15)`，下一层就是 16。
// 深潜的隐藏核心只在**深度 15** 判定，返场 boss 打赢必须老老实实 +1 层。
test('第 25 回合 boss 打赢后进 26 层，不会掉回 15/16 层（隐藏核心门槛达标也不行）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 24;
  m.startRound(25);
  for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) h.sched.advance(200);
  for (const ps of m.alivePlayers()) if (!ps.ready) ps.ready = true;
  m.endPrep();
  assert.equal(m.phase, 'FINAL_ASSAULT', '25 层是返场 boss 关');
  // 把层数/生命顶到隐藏核心门槛之上：深潜里这很容易达到，正是触发 bug 的条件
  m.hiddenLayerSum = 2000;
  m.teamLp = 10;
  const seq = [];                                     // 记录 boss 结算之后 startRound 的回合序列
  const orig = m.startRound.bind(m);
  m.startRound = (r, after) => { seq.push(r); return orig(r, after); };
  m.bossPool.hp = 0;                                  // boss 被打死 → victory
  m._finishFinal(false, () => ({ perPlayer: {}, synthetic: false }));
  for (let i = 0; i < 200 && !seq.length; i++) h.sched.advance(200);
  assert.ok(seq.length, 'boss 结算后必须开下一回合');
  assert.equal(seq[0], 26, `打完 25 层 boss 的下一回合必须是 26（实际 ${seq[0]}）`);
  assert.ok(!seq.includes(15) && !seq.includes(16), '绝不能回到 15/16 层');
});

// 16 层以后的每一个返场节点（25 / 35 / 45）都要：① 有 boss 波次 ② 准备阶段正常进 FINAL_ASSAULT。
// 玩家 2026-11-05 反馈「16 回合以后的 boss 关准备阶段不对」，这里把三层一起钉住。
test('返场节点 25 / 35 / 45：boss 波次存在，准备阶段正常进入 boss 战', (t) => {
  for (const depth of [25, 35, 45]) {
    const h = dive();
    const m = h.m;
    t.after(() => m.dispose());
    m.round = depth - 1;
    m.startRound(depth);
    assert.equal(m.round, depth, `深度 ${depth} 回合号要对`);
    assert.ok(Array.isArray(m.bossWaves) && m.bossWaves.length > 0, `深度 ${depth} 必须有 boss 波次`);
    assert.ok(m.bossWaves.every((g) => g.wave && Array.isArray(g.wave.spawns) && g.wave.spawns.length > 0), `深度 ${depth} 的 boss 波次不能为空`);
    for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) h.sched.advance(200);
    assert.equal(m.phase, 'PREP', `深度 ${depth} 要正常进准备阶段`);
    for (const ps of m.alivePlayers()) if (!ps.ready) ps.ready = true;
    m.endPrep();
    assert.equal(m.phase, 'FINAL_ASSAULT', `深度 ${depth} 准备结束后进 boss 战`);
  }
});

test('深度 18 悬赏节点：目标从本回合生成的波次里抽出来', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 17;
  m.startRound(18);
  const players = m.alivePlayers();
  assert.ok(players.length > 0);
  const keys = new Set((m.wave?.spawns || []).map((s) => s.enemyKey));
  let got = 0;
  for (const ps of players) {
    for (const b of ps.bounties) {
      got += 1;
      assert.ok(keys.has(b.card.enemyKey), `悬赏目标 ${b.card.enemyKey} 必须在本回合波次里`);
      assert.ok(b.card.coin >= 1 && b.card.coin <= 3, '赏金在 1..3');
      assert.equal(b.card.payout, 'kill');
    }
  }
  assert.ok(got > 0, '深度 18 必须发出悬赏');
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
  // 只漏一小部分（ceil 取整后可能略多于 5%，所以断言「在 90%~100% 之间」而不是精确 0.95）
  assert.ok(out.ratio > 0.9 && out.ratio < 1, `比例应是全队合计（实际 ${out.ratio}）`);
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
test('祝福「回复生命」：多档位、数值都小、可以超过初始生命上限', (t) => {
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
      // 一次性祝福不占名额，只记进 echoOneShotIds（维护者 2026-11-05）
      assert.ok(m.echoOneShotIds.includes(b.id), `${b.id} 已记录为一次性祝福`);
      assert.ok(!m.echoBlessings.includes(b.id), `${b.id} 不应占用名额`);
    } finally {
      m.dispose();
    }
  }
  // 维护者 2026-11-05：回血允许**超过初始生命上限**（不再封顶）
  const h = dive();
  const m = h.m;
  try {
    const ps = m.alivePlayers();
    for (const p of ps) p.lp = m.gd.startLp(p.bandId) - 1;
    m._echoGrantBlessing(echoBlessingById('heal_l'));
    for (const p of ps) {
      assert.equal(p.lp, m.gd.startLp(p.bandId) - 1 + 8, '超过初始生命上限的部分要保留');
      assert.ok(p.lp > m.gd.startLp(p.bandId), '应能超过上限');
    }
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
test('部署禁令：封锁地块 / 排异盟约（新上场与场上行动都拦）', (t) => {
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
  const isAdd = (b) => m.gd.bond(b) && m.gd.bond(b).isCore !== true;
  const pair = Object.entries(chessRaw).find(([, rec]) => (rec?.bonds || []).some(isAdd));
  assert.ok(pair, '数据里至少要有一个带附加盟约的干员');
  const [chessId, rec] = pair;
  m.echoBannedBonds = [rec.bonds.find(isAdd)];
  const piece = { kind: 'chess', id: chessId, items: [] };
  assert.match(String(m._echoDeployBlocked(piece, free, true) || ''), /排异/, '排异盟约的干员不能上场');
  // 2026-11-05 修订：已经上场的也不能再移动/转向（会被收回修正区；手牌满时靠这条兜底）
  assert.match(String(m._echoDeployBlocked(piece, free, false) || ''), /无法行动/, '场上也不能再动');
  // 核心盟约（炎 / 拉特兰 …）永远不受排异影响（维护者 2026-11-05）
  m.echoBannedBonds = [rec.bonds.find((b) => m.gd.bond(b)?.isCore === true)];
  assert.ok(m.echoBannedBonds[0], '这个干员应该还有一个核心盟约');
  assert.equal(m._echoDeployBlocked(piece, free, true), null, '核心盟约不拦');

  // 场上只有核心盟约干员时，排异根本抽不出目标（不会误伤阵营）
  const ps0 = m.alivePlayers()[0];
  const coreOnlyId = Object.keys(chessRaw).find((id) => {
    const bs = chessRaw[id]?.bonds || [];
    return bs.length && bs.every((b) => m.gd.bond(b)?.isCore === true);
  });
  assert.ok(coreOnlyId, '数据里要有「只有核心盟约」的干员');
  const keep = m.echoBannedBonds.slice();
  const bak = new Map(ps0.board);
  ps0.board.clear();
  ps0.board.set('9,5', { kind: 'chess', id: coreOnlyId, items: [], uid: 9100 });
  // 团队模式（2026-11-05）：即使场上只有核心盟约，也能**提前**禁一条附加盟约，
  // 之后玩家拿到的该盟约干员就上不了场。
  m.echoBannedBonds = [];
  const preBan = m._echoApplyBondBan(() => 0);
  assert.ok(preBan && m.gd.bond(preBan).isCore !== true, '提前禁的是附加盟约');
  ps0.board.clear();
  for (const [k, v] of bak) ps0.board.set(k, v);
  m.echoBannedBonds = keep;

  // 公开视图要带上禁令，客户端才能高亮
  const pub = m._echoPublic();
  assert.deepEqual(pub.bans.tiles, m.echoBannedTiles);
  assert.deepEqual(pub.bans.bonds, m.echoBannedBonds);
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

// 维护者 2026-11-05：每个诅咒都有对应的「克制祝福」，抽到即驱散。
test('克制祝福：抽到就驱散对应诅咒 / 解除部署禁令', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const draw = (id) => { m.echoBlessings = []; m._echoGrantBlessing(echoBlessingById(id)); };

  m.echoCurseIds = ['bleed', 'hemorrhage', 'tribute', 'fog'];
  draw('staunch');                                    // 止血
  assert.deepEqual(m.echoCurseIds, ['tribute', 'fog'], '止血只驱散漏怪类诅咒');
  draw('thrift');                                     // 开源
  assert.deepEqual(m.echoCurseIds, ['fog'], '开源驱散资金类诅咒');
  draw('recon');                                      // 侦察
  assert.deepEqual(m.echoCurseIds, [], '侦察驱散迷雾');
  assert.equal(m._echoCurseFx().intel, false, '情报诅咒已移除（不再关闭情报）');

  m.echoBannedTiles = ['3,3', '4,4'];
  m.echoBannedBonds = ['yanShip'];
  draw('unlock');                                     // 开路
  assert.deepEqual(m.echoBannedTiles, [], '封锁解除');
  assert.deepEqual(m.echoBannedBonds, [], '排异解除');

  // 回合诅咒也能被驱散
  m.echoRoundCurse = 'r_bleed';
  draw('staunch');
  assert.equal(m.echoRoundCurse, null, '本回合的渗血也被驱散');
});

// 维护者 2026-11-05：商店加价诅咒（客户端显示的就是加价后的价）+ 全图持续伤害诅咒。
test('通胀：商店干员/装备加价，且这个价就是客户端拿到的价', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  const slot = { kind: 'chess', id: null, basePrice: 4 };
  assert.equal(ps.priceOf(slot), 4, '没诅咒时是原价');
  m.echoCurseIds = ['inflation'];                 // +25%
  assert.equal(ps.priceOf(slot), 5, '4 → 5');
  m.echoCurseIds = ['profiteer'];                 // +50%
  assert.equal(ps.priceOf(slot), 6, '4 → 6');
  // 视图里的 price 就是 priceOf
  const view = ps.privateView ? ps.privateView() : null;
  if (view && Array.isArray(view.shop?.slots)) {
    for (const s of view.shop.slots) if (s && s.basePrice != null) assert.equal(s.price, ps.priceOf(s));
  }
});

test('腐蚀：全图持续伤害每秒扣己方最大生命的比例', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoCurseIds = ['rot'];                       // 每秒 0.5%
  const handlers = {};
  const dealt = [];
  const ally = { alive: true, maxHp: 1000 };
  const battle = {
    on: (name, cb) => { handlers[name] = cb; },
    allyUnits: [ally],
    dealHPLose: (c) => dealt.push(c.amount),
    addBuff: () => {},
  };
  m._echoHookBattle(battle);
  assert.equal(typeof handlers.tick, 'function', '挂上了 tick 钩子');
  handlers.tick({ dt: 0.5 });
  assert.deepEqual(dealt, [], '不足 1 秒不结算');
  handlers.tick({ dt: 0.5 });
  assert.deepEqual(dealt, [5], '1 秒 → 1000 × 0.5% = 5');
  handlers.tick({ dt: 2 });
  assert.deepEqual(dealt, [5, 5], '一次 tick 只结算 1 秒（不会一口气扣两次）');

  // 没有诅咒时不挂钩子
  const h2 = dive();
  t.after(() => h2.m.dispose());
  const hs = {};
  h2.m._echoHookBattle({ on: (n, cb) => { hs[n] = cb; }, allyUnits: [], dealHPLose: () => {}, addBuff: () => {} });
  assert.equal(hs.tick, undefined);
});

// 维护者 2026-11-05：排异不是「不让你动」——已经上场的同盟约干员要**当场收回修正区**。
test('排异：已上场的同盟约干员被收回手牌，且之后不能再移动/转向', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  const chessRaw = m.gd.raw?.chess || {};
  const isAdd = (b) => m.gd.bond(b) && m.gd.bond(b).isCore !== true;
  const pair = Object.entries(chessRaw).find(([, rec]) => (rec?.bonds || []).some(isAdd));
  assert.ok(pair, '数据里要有带附加盟约的干员');
  const [chessId, rec] = pair;
  const bond = rec.bonds.find(isAdd);

  const piece = { kind: 'chess', id: chessId, items: [], uid: 9001, dir: 'RIGHT' };
  ps.board.set('8,5', piece);
  const handBefore = ps.hand.length;

  m.echoCurseIds = ['block_bond'];
  const picked = m._echoApplyBondBan(() => 0);          // rng 0 = 取第一个盟约（就是刚摆上去这个）
  assert.equal(picked, bond);
  assert.deepEqual(m.echoBannedBonds, [bond]);
  assert.equal(ps.board.has('8,5'), false, '场上的该干员被收回');
  assert.ok(ps.hand.some((p) => p && p.uid === 9001), '进了手牌（修正区）');
  assert.ok(ps.hand.length >= handBefore, '手牌数量没有丢卡');

  // 手牌满也不丢卡：暂存区是「可扩展队列」，会进 temp（维护者 2026-11-05 要求先收回再说）
  ps.hand.fill({ kind: 'chess', id: chessId, items: [], uid: 1 });
  ps.board.set('7,5', { kind: 'chess', id: chessId, items: [], uid: 9002 });
  assert.equal(m._echoWithdrawPiece(ps, '7,5'), 1, '手牌满也能收回（进暂存）');
  assert.equal(ps.board.has('7,5'), false);
  assert.ok([...ps.hand, ...(Array.isArray(ps.temp) ? ps.temp : [])].some((p) => p && p.uid === 9002), '卡还在玩家手里');
  assert.match(String(m._echoDeployBlocked({ kind: 'chess', id: chessId, items: [] }, '7,5', false) || ''), /无法行动/, '回收后也不能再动');
});

// 维护者 2026-11-05：排异可以叠加（不同附加盟约各禁一条），但已禁的不能重复禁，
// 必须先被「开路」解除才能再次禁。
test('排异叠加：不同附加盟约叠成多条，已禁的不重复，解除后可再禁', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  const chessRaw = m.gd.raw?.chess || {};
  const isAdd = (b) => m.gd.bond(b) && m.gd.bond(b).isCore !== true;
  // 找两个带不同附加盟约的干员摆上场
  const picks = [];
  for (const [id, rec] of Object.entries(chessRaw)) {
    const add = (rec?.bonds || []).find(isAdd);
    if (add && !picks.some((p) => p.bond === add)) picks.push({ id, bond: add });
    if (picks.length >= 2) break;
  }
  assert.equal(picks.length, 2, '数据里要有两种不同附加盟约');
  ps.board.clear();
  ps.board.set('8,3', { kind: 'chess', id: picks[0].id, items: [], uid: 7001 });
  ps.board.set('8,4', { kind: 'chess', id: picks[1].id, items: [], uid: 7002 });

  m.echoBannedBonds = [];
  const a = m._echoApplyBondBan(() => 0);
  assert.ok(a, '第一次排异');
  const b = m._echoApplyBondBan(() => 0.999);
  assert.ok(b, '第二次排异');
  assert.notEqual(a, b, '两次禁的是不同盟约（相同的会被跳过）');
  assert.deepEqual(m.echoBannedBonds, [a, b], '叠加成两条');

  // 再抽一次：跳过已禁的，禁下一条（团队模式可提前禁，候选是全部附加盟约）
  const c = m._echoApplyBondBan(() => 0);
  assert.ok(c && !m.echoBannedBonds.slice(0, 2).includes(c), '已禁的不会再出现');
  assert.equal(m.echoBannedBonds.length, 3, '继续叠加');

  // 「开路」解除后可以再禁（两人已被收回手牌，先放回场上）
  m._echoGrantBlessing(echoBlessingById('unlock'));
  assert.deepEqual(m.echoBannedBonds, [], '开路解除全部排异');
  m.echoBlessings = [];
  ps.board.set('8,3', { kind: 'chess', id: picks[0].id, items: [], uid: 7003 });
  assert.ok(m._echoApplyBondBan(() => 0), '解除之后可以重新禁');
});

// 维护者 2026-11-05：稀有度要能在游戏里看到（祝福卡 / 已获祝福 / 诅咒列表）。
test('稀有度下发：祝福、诅咒、固定诅咒、三选一卡片都带 rarityLabel', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = [];
  // 用**占名额**的稀有祝福做样本：一次性祝福（如 heal_m）拿到即结算、不再出现在列表里
  const rareOwned = ECHO_BLESSINGS.find((x) => x.rarity === 'rare' && x.kind === 'mods');
  m._echoGrantBlessing(rareOwned);
  m.echoCurseIds = ['bleed'];                          // 稀有
  m.echoBlessingOffer = ['heal_s'];                    // 普通（三选一）

  const pub = m._echoPublic();
  const b = pub.blessings.find((x) => x.id === rareOwned.id);
  assert.equal(b.rarity, 'rare');
  assert.equal(b.rarityLabel, '稀有');

  const c = pub.curses.find((x) => x.id === 'bleed');
  assert.equal(c.rarity, 'rare');
  assert.equal(c.rarityLabel, '稀有');

  const fixed = pub.curses.find((x) => x.id === 'miracle');
  assert.equal(fixed.rarity, 'special', '固定诅咒有独立稀有度');
  assert.equal(fixed.rarityLabel, '固定');

  const offer = m._echoOfferView();
  assert.ok(offer && offer.options.length);
  assert.equal(offer.options[0].rarity, 'common');
  assert.equal(offer.options[0].rarityLabel, '普通');
});

// 维护者 2026-11-05：每条诅咒都必须有对应的「消除/克制」祝福（守卫用例，新增诅咒忘了配反制会在这里炸）。
test('反制覆盖：每条诅咒都有对应祝福（部署禁令用 counterBans）', () => {
  const byCurse = new Set();
  let bans = 0;
  for (const b of ECHO_BLESSINGS) {
    if (b.kind !== 'counter') continue;
    for (const id of b.counterCurses || []) byCurse.add(id);
    if (b.counterBans) bans += 1;
  }
  assert.ok(bans >= 1, '部署禁令要有 counterBans 祝福');
  const ROUND_ONLY_OK = new Set(['r_rust']);        // 回合版「锈蚀」自己会过期，且销毁不可逆
  for (const c of [...ECHO_CURSES, ...ECHO_ROUND_CURSES]) {
    if (c.effect.kind === 'deployBan' || c.effect.kind === 'bondBan') continue;  // 由 counterBans 覆盖
    if (ROUND_ONLY_OK.has(c.id)) continue;
    assert.ok(byCurse.has(c.id), `${c.id}（${c.name}）没有对应的克制祝福`);
  }
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


// 维护者 2026-11-05：「开路」可以重复出现 —— 排异会分批降临，每次都需要一次解除。
test('开路可重复：拿过还能再抽到、不占祝福名额', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['atk_s', 'hp_s', 'def_s'];        // 三个名额已经占满
  m.echoBannedBonds = ['yanShip'];
  m._echoGrantBlessing(echoBlessingById('unlock'));
  assert.deepEqual(m.echoBannedBonds, [], '满名额也能拿到开路并生效');
  assert.ok(m.echoCounterIds.includes('unlock'), '反制记在 echoCounterIds');

  m.echoBannedBonds = ['swiftShip'];                   // 第二批排异
  m._echoGrantBlessing(echoBlessingById('unlock'));
  assert.deepEqual(m.echoBannedBonds, [], '再拿一次仍然生效');
  assert.equal(m.echoCounterIds.filter((id) => id === 'unlock').length, 2, '每次抽到都记一次（各消耗一次抽取）');

  let s = 3;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  let seen = false;
  for (let i = 0; i < 80 && !seen; i++) {
    if (echoBlessingOffer(rng, ['unlock']).some((b) => b.id === 'unlock')) seen = true;
  }
  assert.ok(seen, '开路能重复出现在三选一里');
  for (let i = 0; i < 20; i++) {
    assert.ok(!echoBlessingOffer(rng, ['atk_s']).some((b) => b.id === 'atk_s'), '普通祝福不重复');
  }
});
// 维护者 2026-11-05：诅咒可以多次出现并叠层，反制祝福每次只消一层（可以重复拿）。
test('诅咒叠层：同一诅咒多次出现，效果叠加且显示合并', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 10;

  m.echoCurseIds = ['erosion'];
  const cap1 = m._echoWordCap();
  m.echoCurseIds = ['erosion', 'erosion'];
  assert.equal(m._echoWordCap(), Math.min(8, cap1 + 1), '两层侵蚀 → 词条上限再 +1');

  m.echoCurseIds = ['bleed'];
  const one = m._echoLpLoss(4, 99);
  m.echoCurseIds = ['bleed', 'bleed'];
  const two = m._echoLpLoss(4, 99);
  assert.ok(two > one, `两层失血应更疼（${one} → ${two}）`);
  assert.equal(two, Math.ceil(4 * 2.25), '×1.5 叠两层 = ×2.25');

  const shown = m._echoCurses().find((c) => c.id === 'bleed');
  assert.ok(shown && shown.name.includes('×2'), '列表里合并成「失血 ×2」');
});

test('反制祝福每次只消一层，可以重复拿', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoCurseIds = ['bleed', 'bleed'];
  m._echoGrantBlessing(echoBlessingById('staunch'));
  assert.deepEqual(m.echoCurseIds, ['bleed'], '第一次只消一层');
  m.echoBlessings = [];                                 // 模拟再抽到一次
  m._echoGrantBlessing(echoBlessingById('staunch'));
  assert.deepEqual(m.echoCurseIds, [], '第二次清掉剩下那层');
});

test('干员减益叠层：同一条诅咒 N 层就挂 N 个 buff', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoCurseIds = ['weak_melee', 'weak_melee'];
  const handlers = {};
  const buffs = [];
  const battle = { on: (n, cb) => { handlers[n] = cb; }, addBuff: (u, b) => buffs.push(b.key), dealHPLose: () => {} };
  m._echoHookBattle(battle);
  handlers.deploy({ unit: { side: 'ally', def: { position: 'MELEE' }, buffs: [] } });
  assert.equal(buffs.length, 2, '两层 → 两个 buff');
  assert.notEqual(buffs[0], buffs[1], 'key 不能相同（否则会被当成同一条）');
});
// 维护者 2026-11-05：排异是**持续约束** —— 每回合 prep 开始时扫一遍棋盘，
// 玩家中途用同构体装备或重新摆上场的同盟约干员都会被收回。
test('排异持续生效：每回合扫描，新上场的也收回', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  const chessRaw = m.gd.raw?.chess || {};
  const isAdd = (b) => m.gd.bond(b) && m.gd.bond(b).isCore !== true;
  const pair = Object.entries(chessRaw).find(([, rec]) => (rec?.bonds || []).some(isAdd));
  assert.ok(pair, '数据里要有带附加盟约的干员');
  const [chessId, rec] = pair;
  const bond = rec.bonds.find(isAdd);

  m.echoCurseIds = [];
  m.echoRoundCurse = null;
  m.echoBannedBonds = [bond];
  ps.board.set('8,6', { kind: 'chess', id: chessId, items: [], uid: 5566 });
  m.round = 11;
  m._echoRefreshCurses(12);
  assert.equal(ps.board.has('8,6'), false, '新上场的同盟约干员被收回');
  assert.ok([...ps.hand, ...(Array.isArray(ps.temp) ? ps.temp : [])].some((p) => p && p.uid === 5566), '卡回到手里');

  // 没有排异时不误伤
  m.echoBannedBonds = [];
  ps.board.set('8,7', { kind: 'chess', id: chessId, items: [], uid: 5577 });
  m._echoRefreshCurses(13);
  assert.equal(ps.board.has('8,7'), true, '没有排异就不动它');
});
// 维护者 2026-11-05「确认一下」：固定回合 + 随机抽取不能重复记账、不能重复播报。
test('诅咒入账统一：随机抽到封锁/排异真的生效；同回合两条只播一行', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  const chessRaw = m.gd.raw?.chess || {};
  const isAdd = (b) => m.gd.bond(b) && m.gd.bond(b).isCore !== true;
  const pair = Object.entries(chessRaw).find(([, rec]) => (rec?.bonds || []).some(isAdd));
  const [chessId, rec] = pair;
  const bond = rec.bonds.find(isAdd);

  // 1) 随机抽到「封锁」：真的封地块（之前只记 id）
  m.echoBannedTiles = [];
  m.echoCurseIds = [];
  assert.ok(m._echoAddCurse('block_tiles', () => 0.5), '封锁入账');
  assert.equal(m.echoBannedTiles.length, 3, '真的封了 3 个地块');
  // 再来一条：叠加而不是覆盖
  m._echoAddCurse('block_tiles', () => 0.5);
  assert.equal(m.echoBannedTiles.length, 6, '封锁可叠加');
  assert.equal(m.echoCurseIds.filter((x) => x === 'block_tiles').length, 2, '两条都记账');

  // 2) 随机抽到「排异」：真的禁盟约并把干员收回
  ps.board.set('8,8', { kind: 'chess', id: chessId, items: [], uid: 8801 });
  m.echoBannedBonds = [];
  assert.ok(m._echoAddCurse('block_bond', () => 0), '排异入账');
  assert.deepEqual(m.echoBannedBonds, [bond]);
  assert.equal(ps.board.has('8,8'), false, '干员被收回');
  // 没有可禁的盟约时：不记假账
  const beforeIds = m.echoCurseIds.length;
  // 把所有附加盟约都禁掉之后，再抽排异才不成立（不记假账）
  m.echoBannedBonds = Object.keys(m.gd.raw.bonds).filter((b) => m.gd.raw.bonds[b]?.isCore !== true);
  const again = m._echoAddCurse('block_bond', () => 0);
  assert.equal(again, null, '全部附加盟约都禁过 → 不成立');
  assert.equal(m.echoCurseIds.length, beforeIds, '也不会记假账');

  // 3) 同一回合的两条结算播报合成一行（不再互相覆盖）
  const said = [];
  m.tickerText = (txt) => said.push(String(txt));
  m.round = 20;
  m.echoCurseIds = [];
  m.echoRoundCurse = null;
  m.lastResults = new Map(m.alivePlayers().map((q) => [q.playerId, { leaked: [], perfect: true, coins: 0 }]));
  m._echoSettleBountyFailure(m.alivePlayers());
  m._echoSettleChallenge();
  assert.ok(said.length <= 1, `同一回合只该有一行 ticker（实际 ${said.length}）`);
});
// 维护者 2026-11-05：诅咒可叠层，但**同一条最多 3 层**（再抽到就不入账）。
test('叠层上限：同一条诅咒最多 10 层，到顶后不再入账', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoCurseIds = [];
  for (let i = 0; i < 10; i++) assert.ok(m._echoAddCurse('erosion'), `第 ${i + 1} 层应成功`);
  assert.equal(m.echoCurseIds.filter((x) => x === 'erosion').length, 10);
  assert.equal(m._echoAddCurse('erosion'), null, '第 11 层被上限挡住');
  assert.equal(m.echoCurseIds.filter((x) => x === 'erosion').length, 10, '没有多记');
  // 效果按层数叠加（10 层就是 +10）
  m.round = 20;
  const capAt10 = m._echoWordCap();
  m.echoCurseIds = ['erosion'];
  assert.equal(capAt10, m._echoWordCap() + 9, '十层比一层多 +9');
});
// 维护者 2026-11-05：强效反制一次清多层，普通反制仍只清一层。
test('反制层数：普通清 1 层，彻愈清 3 层，富源清 2 层', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const draw = (id) => { m.echoBlessings = []; m._echoGrantBlessing(echoBlessingById(id)); };

  m.echoCurseIds = ['bleed', 'bleed', 'bleed'];
  draw('staunch');                                     // 普通：1 层
  assert.equal(m.echoCurseIds.filter((x) => x === 'bleed').length, 2, '普通只清 1 层');
  draw('staunch_x');                                   // 强效：3 层
  assert.equal(m.echoCurseIds.filter((x) => x === 'bleed').length, 0, '彻愈清光 3 层');

  m.echoCurseIds = ['tribute', 'tribute', 'tribute'];
  draw('thrift_x');                                    // 富源：2 层
  assert.equal(m.echoCurseIds.filter((x) => x === 'tribute').length, 1, '富源清 2 层');

  // 强效反制也是「不占名额的一次性祝福」
  assert.ok(m.echoCounterIds.includes('staunch_x'));
  assert.equal(m.echoBlessings.includes('staunch_x'), false, '不进 3 个名额');
});
// 维护者 2026-11-05「不让诅咒一直增加吗？不设上限」：
// 词条上限不再封顶 8 —— 深度增长和侵蚀叠层都会照加（词池 20 条，最多也就 20 条）。
test('词条上限不封顶：深度与叠层都照加，且没有「溢出」这种中间态', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 60;
  m.echoCurseIds = [];
  assert.equal(m._echoWordCap(60), 8, '基础：3 + ⌊59/10⌋ = 8');
  m.echoCurseIds = ['erosion', 'erosion', 'erosion'];
  assert.equal(m._echoWordCap(60), 11, '不封顶：8 + 3 层侵蚀 = 11');
  m.echoCurseIds = Array(10).fill('erosion');
  assert.equal(m._echoWordCap(60), 18, '叠满 10 层 = 18');
  // 没有「溢出」标记了（那是封顶方案的产物）
  m.echoCurseIds = ['erosion'];
  assert.equal(m._echoCurses().find((c) => c.id === 'erosion').overflow, undefined, '不再有溢出标记');
  // 敌人数值也不因为侵蚀而变（词条上限本身就是效果）
  m.echoCurseIds = [];
  const baseHp = m.gd.enemyScale(60).hpMul;
  m.echoCurseIds = ['erosion', 'erosion', 'erosion'];
  assert.equal(m.gd.enemyScale(60).hpMul, baseHp, '侵蚀不再偷偷加敌方生命');
});
// 维护者 2026-11-05：诅咒词条**不设上限** —— 深层词条数可以超过词池（20 条），重复的词条各自叠效果。
test('词条不设上限：深层超过词池时会重复，且重复的词条各自叠 buff', async () => {
  const { echoWordsForRound, applyEchoWords, ECHO_WORDS } = await import('../../server/match/match/echoWords.js');
  let s = 7;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const words = echoWordsForRound(300, 1, rng, { maxWords: 32, everyN: 3 });
  assert.equal(words.length, 32, `不设上限：要 32 条就得给 32 条（实际 ${words.length}）`);
  assert.ok(words.length > ECHO_WORDS.length, '超过了词池大小');

  // 重复应用：同样的词条出现两次 → 两个 buff（叠加）
  const buffs = [];
  const enemy = { buffs: [], base: { maxHp: 1000 }, s: { maxHp: 1000 } };
  const battle = { addBuff: (_e, b) => { buffs.push(b); enemy.buffs.push(b); } };
  const twice = [ECHO_WORDS[0], ECHO_WORDS[0]];
  applyEchoWords(battle, enemy, twice);
  assert.equal(buffs.length, 2, '重复的词条要各自挂一个 buff');
  assert.notEqual(buffs[0].key, buffs[1].key, 'key 不能相同（否则会被去重）');
});
// 维护者 2026-11-05：特殊回合进准备阶段就要播报，别等打起来才知道。
test('特殊回合入场播报：挑战关 / 第 15 层 / boss 返场', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const said = [];
  m.tickerText = (txt) => said.push(String(txt));
  const go = (depth) => { said.length = 0; m.round = depth - 1; m.startRound(depth); return said.join(' '); };

  assert.match(go(5), /挑战关：全队清怪/, '深度 5 是挑战关');
  assert.match(go(10), /挑战关：全队清怪/, '深度 10 是挑战关');
  assert.match(go(15), /第 15 层：精英加压/, '深度 15 精英加压');
  assert.match(go(25), /boss 返场/, '深度 25 是 boss 返场节点');
  assert.match(go(35), /boss 返场/, '深度 35 也是节点');
  const plain = go(16);                                 // 普通深层回合不播这些
  assert.doesNotMatch(plain, /挑战关|精英加压|boss 返场/);
});
// 维护者 2026-11-05：玩家反馈「被禁用的干员还能刷进商店」。池子本身是干净的（60~600 次刷新实测 0 次违规），
// 但自选补位 / 出售回填 / 装备特殊刷新这些旁路不经过池子，所以这里加最后一道闸并有用例守住。
test('禁用干员有最后一道闸：绕过池子塞进来也会被换掉', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  const bannedId = (m.bannedChess || [])[0];
  assert.ok(bannedId, '本局应该至少有一个禁用干员');
  const legalId = Object.keys(m.gd.raw.chess).find((id) => !(m.bannedChess || []).includes(id) && m.gd.chess(id));
  assert.ok(legalId, '要有一个合法干员做对照');

  const warns = [];
  m.log = { info() {}, warn: (x) => warns.push(String(x)) };

  const orig = ps.pool.roll.bind(ps.pool);
  // 模拟旁路：池子直接吐出禁用干员
  ps.pool.roll = () => bannedId;
  assert.equal(ps._rollChessSlot(), null, '禁用干员不能进商店');
  assert.ok(warns.some((w) => w.includes('banned chess')), '要留下一条 warn 方便排查');

  ps.pool.roll = () => legalId;
  const ok = ps._rollChessSlot();
  assert.equal(ok?.id, legalId, '合法干员照常');
  ps.pool.roll = orig;
});
// 维护者 2026-11-05：①被禁用的干员不可能出现在商店（旁路也一样）；②免费刷新深潜里最多 2 次。
test('禁用干员：所有旁路都过同一道闸（_shopChessBanned）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const bannedId = (m.bannedChess || [])[0];
  assert.ok(bannedId, '本局要至少有一个禁用干员');
  assert.equal(m._shopChessBanned(bannedId), true, 'bannedChess 里的要拦住');

  const off = new Set([...(m.disabledBonds || []), ...(m.staticInactiveBonds || [])]);
  const allOff = Object.keys(m.gd.raw.chess).find((id) => {
    const bs = (m.gd.chess(id)?.bonds) || [];
    return bs.length > 0 && bs.every((b) => off.has(b));
  });
  if (allOff) assert.equal(m._shopChessBanned(allOff), true, '所有盟约被禁的也要拦');

  const legal = Object.keys(m.gd.raw.chess).find((id) => !(m.bannedChess || []).includes(id));
  assert.equal(m._shopChessBanned(legal), false, '合法干员不能被误拦');
});

test('免费刷新：深潜上限 5 次（奇迹·诅咒），回合开始夹住，别的诅咒可以再压低', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m._echoFreeRefreshCap(), 5, '有奇迹·诅咒时上限 = 5（不再累积）');
  const ps = m.alivePlayers()[0];
  ps.shop.freeRefreshes = 9;
  m.round = 4;
  m.startRound(5);
  assert.equal(ps.shop.freeRefreshes, 5, '回合开始被夹到 5');
  m.echoCurseIds = ['drought'];                        // 枯竭：−1
  assert.equal(m._echoFreeRefreshCap(), 4);
  ps.shop.freeRefreshes = 9;
  m._echoClampFreeRefreshes();
  assert.equal(ps.shop.freeRefreshes, 4, '诅咒生效后上限变 4');
});

// 维护者 2026-11-05 更正口径：不是「库存上限 5」，而是**每回合累计只能拿到 5 次**。
// 以前刷完 5 次再买/卖干员、吃祝福、触发按层效果，每个口子又各给 5 次 —— 一回合能白嫖几十次。
test('奇迹·诅咒：每回合累计最多拿到 5 次免费刷新，换回合才重置', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  ps.shop.freeRefreshes = 0;
  ps.shop.echoGrantRound = m.round;
  ps.shop.echoRefreshGranted = 0;

  assert.equal(m._echoGrantFreeRefresh(ps, 3), 3, '第一次给满 3');
  ps.shop.freeRefreshes = 0;                       // 玩家把这 3 次刷掉了
  assert.equal(m._echoGrantFreeRefresh(ps, 3), 2, '本回合只剩 2 次额度');
  ps.shop.freeRefreshes = 0;
  assert.equal(m._echoGrantFreeRefresh(ps, 5), 0, '额度用完：买卖干员 / 祝福都给不出来');

  m.round += 1;                                    // 换回合 → 额度重置
  assert.equal(m._echoGrantFreeRefresh(ps, 5), 5, '新回合重新给满 5 次');
});

// 维护者 2026-11-05 实测：深渊回响房用「重刷本局」之后，商店还能刷到**当前被禁用盟约**的干员。
// 成因：setupVote 里 poolGroups / playerPools 只在 5–20 人大厅分支里建，
// 赋值整段又被 if (capacityExperiment) 包着 —— 独立卡池（disableSharedPool）房间重刷后，
// this.playerPools 仍指向开局那一池，而 poolFor() 优先读它。
test('重刷本局：独立卡池跟着新的禁用盟约重建（被禁干员不能再被抽到）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m.disableSharedPool, true, '深渊回响强制独立卡池');
  assert.equal(m.capacityExperiment, false, '4 人房不是 5–20 人大厅，走的正是出问题的分支');
  const pid = m.alivePlayers()[0].playerId;
  const before = m.poolFor(pid);
  assert.equal(m.completeSetupReroll().ok, true, '重刷成功');
  const after = m.poolFor(pid);
  assert.notEqual(after, before, '重刷后每人必须换到新池（旧实现仍返回开局那一池）');
  for (const id of after.entries.keys()) {
    assert.ok(!(m.bannedChess || []).includes(id), `${id} 的盟约已被禁用，却留在重刷后的卡池里`);
  }
});

// 同一个 bug **不是深潜专属**：普通房间勾了「独立卡池」（disableSharedPool）或排了「手动卡池编组」（poolPlan），
// 走的是同一段代码 —— 只要不是 5–20 人大厅，重刷后 playerPools 就是开局那一池。
test('重刷本局：普通房间开「独立卡池」也要重建（同一处 bug，与深渊回响无关）', (t) => {
  const h = makeMatch({
    mode: 'coop', humans: 4, bots: 0, seed: 16, fake: true,
    experimental: { revivalEnabled: false, disableSharedPool: true },
  });
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m.echoVariant, null, '普通房间，不是深潜');
  assert.equal(m.disableSharedPool, true, '实验性「独立卡池」已开');
  assert.equal(m.capacityExperiment, false, '4 人房仍走的是出问题的那条分支');
  const pid = m.alivePlayers()[0].playerId;
  const before = m.poolFor(pid);
  assert.equal(m.completeSetupReroll().ok, true, '重刷成功');
  const after = m.poolFor(pid);
  assert.notEqual(after, before, '重刷后必须换成新池');
  for (const id of after.entries.keys()) {
    assert.ok(!(m.bannedChess || []).includes(id), `${id} 已被禁用，却还在重刷后的池子里`);
  }
});
// 维护者 2026-11-05 澄清：**诅咒『排异』是暂时的**（能被「开路」解除），
// 所以那些干员**可以买**，只是不能上场。商店闸门只能看「本局永久禁用」，绝不能把诅咒也当禁用。
test('排异诅咒不禁购物车：被排异的干员仍能在商店出现/购买，只是不能部署', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];

  const isAdd = (b) => m.gd.bond(b) && m.gd.bond(b).isCore !== true;
  const pair = Object.entries(m.gd.raw.chess).find(([, rec]) => (rec?.bonds || []).some(isAdd));
  const [chessId, rec] = pair;
  const bond = rec.bonds.find(isAdd);
  const id = chessId.replace(/_b$/, '_a');

  m.echoBannedBonds = [bond];
  // 永久禁用判定不该把它算进去（否则玩家买不到、又没东西可打）
  assert.equal(m._shopChessBanned(id), false, '诅咒不参与「本局禁用」判定');
  assert.ok(ps.pool.left(id) > 0, '池子里仍然有它');
  // 但不能上场
  assert.match(String(m._echoDeployBlocked({ kind: 'chess', id, items: [] }, '8,5', true) || ''), /排异/);
  // 「开路」解除之后就能上场了
  m._echoGrantBlessing(echoBlessingById('unlock'));
  assert.equal(m._echoDeployBlocked({ kind: 'chess', id, items: [] }, '8,5', true), null);
});
// 维护者 2026-11-05：打完 15 层的隐藏核心，应该多给一次祝福三选一 ——
// 之前只把 `echoBlessingDraws` 抬到 1，被 `_echoBlessingMax()`（3）封顶吃掉，玩家什么都看不到。
test('隐藏核心通关：第 16 层开得出「额外那一次」三选一（3 个名额已满时）', async (t) => {
  const { echoBlessingById } = await import('../../server/match/match/echoBlessing.js');
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  // 先拿满 3 个（用真实存在的祝福 id）
  m.echoBlessings = ECHO_BLESSINGS.filter((b) => !b.counter).slice(0, 3).map((b) => b.id);
  assert.equal(m.echoBlessings.length, 3);

  m.round = 14;
  m.startRound(15);                                  // 15 层：已满 3 个，不该再发
  assert.equal(m.echoBlessingOffer, null, '15 层已满就不再发');

  m.echoBlessingBonus = 1;                           // 打完隐藏核心 → 临时 +1 名额
  m.round = 15;
  m.startRound(16);
  assert.ok(Array.isArray(m.echoBlessingOffer) && m.echoBlessingOffer.length === 3, '16 层要开出三选一');
  assert.equal(m.echoBlessingBonus, 0, '名额用掉后清零');
  assert.equal(m._echoPublic().blessingMax, 3, '发完之后名额回到 3');
});
// node-2 2026-11-05 实测卡死：`[match YMYM] guard: Cannot read properties of null (reading 'spawns')`
// at withBounties ← _normalOpts。boss 回合 this.wave 为 null，任何普通场的 battle 选项构建都会崩。
test('boss 回合 wave 为 null 时 _normalOpts 不再崩（防 COMBAT 卡死）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.wave = null;
  const opts = m._normalOpts(m.alivePlayers()[0]);
  assert.ok(opts && Array.isArray(opts.spawns), '要返回合法 opts');
  assert.equal(opts.spawns.length, 0, '没有波次时就是空场，不是崩溃');
});
// 玩家 2026-11-05 实测：打完隐藏 boss 连出两个祝福界面，第二个点不了（「当前阶段无法进行该操作」）。
// 成因：15 层开的三选一还没结算，隐藏通关直接 startRound(16)，旧代码把同一个 offer 原样带回新回合；
// 玩家点第二次时服务端已经结算过 → 没有 offer → WRONG_PHASE。
test('隐藏核心通关：上一回合遗留的三选一会被结算，新回合的 offer 可以正常投票', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(15);
  for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) h.sched.advance(200);
  assert.ok(Array.isArray(m.echoBlessingOffer) && m.echoBlessingOffer.length, '15 层先开一次三选一');
  // 隐藏核心通关的补偿（bossRounds.js 里那段），然后进 16 层
  m.echoBlessingDraws = Math.max(Number(m.echoBlessingDraws) || 0, 1);
  m.echoBlessingBonus = (Number(m.echoBlessingBonus) || 0) + 1;
  m.startRound(16);
  for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) h.sched.advance(200);
  assert.ok(m.echoBlessings.length >= 1, '15 层遗留的那次 offer 必须被强制结算掉');
  assert.ok(Array.isArray(m.echoBlessingOffer) && m.echoBlessingOffer.length, '16 层要挂出新的三选一');
  const [ps, ps2] = m.alivePlayers();
  assert.equal(m.setEchoBlessingVote(ps, 0).ok, true, '新面板的第一票要收');
  assert.equal(m.setEchoBlessingVote(ps2, 0).ok, true, '第二票也要收（不会报「当前阶段无法进行该操作」）');
});

// 维护者 2026-11-05 玩家反馈：
//   1) 护盾抵消排异后，祝福**留在列表里**但标成「已消耗」（维护者 2026-11-05 第二次改：
//      之前是连图标一起摘掉，玩家会以为祝福丢了 / 列表出 bug）
//   2) 诅咒被祝福清掉后，对应的**实际禁令**（封锁地块 / 排异盟约）还在 → 图标没了但依然不能部署
test('护盾抵消排异后留在祝福列表里并标成已消耗；净化/反制掉「封锁·排异」时禁令一起解除', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());

  // —— 护盾：指定一条附加盟约，然后让排异正好抽到它
  m.echoBlessings = ['shield_bond'];
  const addBond = Object.keys(m.gd.raw.bonds || {}).find((id) => m.gd.bond(id) && m.gd.bond(id).isCore !== true);
  assert.ok(addBond, '数据里要有附加盟约');
  m.echoShieldBond = addBond;
  const rng = () => 0;                                   // 每次都抽池子里的第一条
  // 让池子只剩这条：先把其它盟约都排异掉
  m.echoBannedBonds = Object.keys(m.gd.raw.bonds || {}).filter((id) => id !== addBond && m.gd.bond(id) && m.gd.bond(id).isCore !== true);
  const got = m._echoApplyBondBan(rng);
  assert.equal(got, null, '护盾抵消了这次排异');
  assert.equal(m.echoShieldBond, null);
  // 抵消之后：列表里还在，但是「已消耗」、不占名额、描述写明被抵消
  assert.ok(m.echoBlessings.includes('shield_bond'), '护盾用掉后祝福必须留在列表里（维护者 2026-11-05）');
  const pub = m.publicView();
  const shield = (pub.echo.blessings || []).find((b) => b.id === 'shield_bond');
  assert.ok(shield, '护盾要出现在 m.public.echo.blessings 里');
  assert.equal(shield.consumed, true, '抵消之后标成已消耗');
  assert.equal(shield.occupiesSlot, false, '已消耗的护盾依然不占名额');
  assert.match(shield.desc, /已被诅咒抵消/, '描述要说明它被诅咒抵消了');

  // —— 净化掉 block_bond：盟约禁令也要清空
  m.echoBannedBonds = ['someBond'];
  m.echoBannedBondsUntil = { someBond: 99 };
  m.echoCurseIds = ['block_bond'];
  assert.equal(m._echoSyncBanCurse(['block_bond']), true, '应当动过禁令');
  assert.deepEqual(m.echoBannedBonds, [], '排异名单要清空');
  assert.deepEqual(m.echoBannedBondsUntil, {});

  // —— 封锁同理
  m.echoBannedTiles = ['3,4'];
  m.echoBannedTilesUntil = 99;
  m._echoSyncBanCurse(['block_tiles']);
  assert.deepEqual(m.echoBannedTiles, [], '封锁地块要清空');
  assert.equal(m.echoBannedTilesUntil, 0);
});

// 维护者 2026-11-05：刷新祝福三选一 —— 开局 3 次、活着的玩家投票、投票不占选择时间、
// 刷新后从 30 秒重新计时、任何来源都不能突破 3 次。
test('刷新祝福三选一：3 次额度、投票通过才重抽、刷新后重新 30 秒、封顶 3', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 20;
  m.startRound(20);
  for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) h.sched.advance(200);
  assert.ok(Array.isArray(m.echoBlessingOffer) && m.echoBlessingOffer.length, '先有候选');
  assert.equal(m._echoBlessingRefreshLeft(), 3, '开局 3 次刷新额度');
  const [a, b] = m.alivePlayers();

  // 否决：两个人都投不同意 → 不刷新、倒计时接回来
  assert.equal(m.requestEchoBlessingRefresh(a).ok, true);
  assert.equal(m._echoBlessingEndsAt, 0, '投票期间选择倒计时暂停（不占用 30 秒）');
  m.setEchoBlessingRefreshVote(a, false);
  m.setEchoBlessingRefreshVote(b, false);
  assert.equal(m.echoBlessingRefreshVote, null, '投票结束');
  assert.equal(m._echoBlessingRefreshLeft(), 3, '没刷新就不扣额度');
  assert.ok(m._echoBlessingEndsAt > m.sched.now(), '倒计时恢复');

  // 通过：同意 → 扣 1 次、候选重抽、从 30 秒重新计时
  const before = m.echoBlessingOffer.slice();
  const now0 = m.sched.now();
  assert.equal(m.requestEchoBlessingRefresh(a).ok, true);
  m.setEchoBlessingRefreshVote(a, true);
  m.setEchoBlessingRefreshVote(b, true);
  assert.equal(m._echoBlessingRefreshLeft(), 2, '刷新成功扣 1 次');
  assert.ok(m._echoBlessingEndsAt >= now0 + 29000, '刷新后重新给满 30 秒');
  assert.ok(Array.isArray(m.echoBlessingOffer) && m.echoBlessingOffer.length, '刷新后仍有候选');
  assert.notDeepEqual(m.echoBlessingOffer, before, '候选应当换了一批');

  // 上限：任何来源都不能突破 3
  assert.equal(m._echoGrantBlessingRefresh(99), 3, '「再议」这类来源封顶 3 次');
});

// 维护者 2026-11-05：1–16 回合里出现「飞行怪直线穿场」。
// 数据里地面路线常常只有 start→end（cp=0，靠寻路），飞行路线才带 8–10 个航点；
// 一旦飞行怪被塞进 cp=0 的路线，它就沿起点→终点直线飞过去。这里每层兜一次。
test('飞行怪不会被塞进没有航点的路线（直线穿场）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const flyKey = Object.keys(m.gd.raw.enemies).find((k) => isFlyKey(m.gd, k));
  assert.ok(flyKey, '数据里要有飞行怪');
  const wave = {
    spawns: [{ enemyKey: flyKey, routeIndex: 0, count: 1 }],
    routes: [
      { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] },
      { motion: 'FLY', start: [9, 10], end: [9, 2], checkpoints: [[9, 8], [9, 6], [9, 4]] },
    ],
  };
  m._echoFixFlyRoutes(wave);
  assert.equal(wave.spawns[0].routeIndex, 1, '飞行条目要改到带航点的路线');
});

// 玩家 2026-11-05 反馈：奇迹还能把免费刷新推到第 6 次。
// 成因：上回合没花完的免费刷新会带进新回合，而「每回合累计 5 次」只数**本回合新发放**的，
// 于是「带 3 次 + 再拿 5 次」= 一回合能用 8 次。现在回合开始把已有库存记成已获得。
test('奇迹·诅咒：上回合剩下的免费刷新占用本回合额度（不会出现第 6 次）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  m.round = 19;
  ps.shop.freeRefreshes = 3;
  m.startRound(20);
  assert.equal(ps.shop.echoRefreshGranted, 3, '带进新回合的库存算本回合已获得');
  assert.equal(m._echoGrantFreeRefresh(ps, 5), 2, '本回合只剩 2 次额度');
  assert.equal(m._echoGrantFreeRefresh(ps, 1), 0, '第 6 次拿不到');
  ps.shop.freeRefreshes = 0;
  assert.equal(m._echoGrantFreeRefresh(ps, 1), 0, '花光之后也不能再拿');
});

// 玩家 2026-11-05：15 层的 boss 在准备阶段看不到。
// 成因：敌方情报里「领袖块」在深潜被整块关掉了（`!inDive`），连 boss 关一起没了。
// 现在服务端下发 echo.bossRound / echo.bossId，客户端只在 boss 关显示。
test('boss 关对准备阶段可见：15 层隐藏核心 / 25 层返场', (t) => {
  const h1 = dive();
  t.after(() => h1.m.dispose());
  h1.m.round = 14;
  h1.m.startRound(15);
  const plain = h1.m._echoPublic();
  assert.equal(plain.bossRound, false, '没达成隐藏核心时 15 层不是 boss 关');

  const h2 = dive();
  t.after(() => h2.m.dispose());
  h2.m.hiddenLayerSum = 2000;
  h2.m.teamLp = 10;
  h2.m.round = 14;
  h2.m.startRound(15);
  const hidden = h2.m._echoPublic();
  assert.equal(hidden.bossRound, true, '达成隐藏核心 → 15 层是 boss 关');
  assert.equal(hidden.bossId, h2.m.hiddenBossId, '下发的应该是隐藏 boss');

  const h3 = dive();
  t.after(() => h3.m.dispose());
  h3.m.round = 24;
  h3.m.startRound(25);
  const node = h3.m._echoPublic();
  assert.equal(node.bossRound, true, '25 层是返场 boss 关');
  assert.equal(node.bossId, h3.m.bossId);
});

// 维护者 2026-11-05：16 层的规则播报没在房间里看到。
// 原来它走 `_echoPushAnnounce` 队列，会和「本回合诅咒 / 侵蚀词条」拼成一行（还可能被 200 字截断）。
// 现在改成独立 ticker，且只播一次。
test('16 层「深渊通胀」用独立广播，不与本回合诅咒合并，且只播一次', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const lines = [];
  const orig = m.tickerText.bind(m);
  m.tickerText = (txt, p) => { lines.push(String(txt)); return orig(txt, p); };
  m.round = 15;
  m.startRound(16);
  const hit = lines.filter((s) => s.includes('深渊通胀'));
  assert.equal(hit.length, 1, '16 层要有一条独立播报');
  assert.ok(!hit[0].includes('｜'), '不能和本回合诅咒 / 词条合并成一行');
  assert.match(hit[0], /新增固定规则/);
  lines.length = 0;
  m.round = 16;
  m.startRound(17);
  assert.equal(lines.filter((s) => s.includes('深渊通胀')).length, 0, '只在 16 层播一次');
});

// 玩家 2026-11-05：深潜补给看不到队友投了哪个，且文案像个人奖励。
test('深潜补给：全队同一份候选、票数可见、文案标明全队共享', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 20;
  m.echoSupplyLastDepth = 0;
  let opened = 0;
  for (let i = 0; i < 30 && !opened; i++) opened = m._echoOpenSupply();
  assert.equal(opened, 1, '要能开出一次补给');
  const v = m._echoSupplyView();
  assert.ok(v.options.length >= 2, '要有候选');
  assert.ok(v.options.every((o) => /全队/.test(o.desc || '')), '每个候选都要写明「全队」共享');
  const [a, b] = m.alivePlayers();
  m.setEchoSupplyPick(a, 1);
  m.setEchoSupplyPick(b, 1);
  const after = m._echoSupplyView();
  assert.deepEqual(after.votes, { [a.playerId]: 1, [b.playerId]: 1 }, '票数要按玩家下发（客户端才能显示谁投了什么）');
});

// 玩家 2026-11-05：深潜补给和祝福三选一会同时弹出、互相遮挡。
// 现在服务端串行化：祝福面板没结束时补给挂起；补给还开着时，开祝福前先把补给结算掉。
test('深潜补给与祝福三选一不会同时弹（先结算一个再出另一个）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 20;
  m.echoSupplyLastDepth = 0;
  m.echoBlessingOffer = ['atk_s', 'hp_s', 'def_s'];
  m._echoBlessingVotes = new Map();
  assert.equal(m._echoOpenSupply(), 0, '祝福进行中不开补给');
  assert.equal(m.echoSupplyPending, true, '补给要挂起而不是丢弃');
  assert.equal(m._echoSupplyView(), null, '此时界面上只有祝福面板');
  m._echoSettleBlessing(0);
  assert.ok(m._echoSupplyView(), '祝福结算后补给才出现');
  assert.equal(m.echoSupplyPending, false);
  m.round = 21;
  m._echoMaybeOfferBlessing(21);
  assert.equal(m._echoSupplyView(), null, '开祝福前要先把还开着的补给结算掉');
});

// 维护者 2026-11-05（第二次改）：返场 boss 的血量要**随深度递增**，而且数值要更高。
// 关键：boss 的血量来自共享血池（finalAssault.bossPoolHp），领袖单位只是按池子比例显示；
// 之前只调波次缩放，血池一直是固定的 675000（单人），所以 25 层以后「一进场 boss 就没了」。
test('返场 boss 的血量随深度递增（R14 < R25 < R35 < R45），波次与血池同源', async (t) => {
  const { bossPoolHp } = await import('../../server/match/finalAssault.js');
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const at = (r) => {
    m.round = r - 1;
    m.startRound(r);
    const w = m.bossWaves && m.bossWaves[0] && m.bossWaves[0].wave;
    const s = w && w.spawns && w.spawns[0];
    return {
      wave: s && s.mods ? s.mods.hpMul : null,
      poolMul: m._echoBossPoolMul(r),
      pool: bossPoolHp(m.gd, m.bossId, 1, { hpMul: m._echoBossPoolMul(r) }),
    };
  };
  const r14 = at(14), r25 = at(25), r35 = at(35), r45 = at(45);
  assert.equal(r14.poolMul, 1, 'R14 是官方档，一点不动');
  assert.equal(r14.pool, bossPoolHp(m.gd, m.bossId, 1, {}), 'R14 血池 = 官方值');
  for (const [name, a, b] of [['R25 > R14', r14, r25], ['R35 > R25', r25, r35], ['R45 > R35', r35, r45]]) {
    assert.ok(b.wave > a.wave, `${name}（波次缩放 ${a.wave} → ${b.wave}）`);
    assert.ok(b.pool > a.pool, `${name}（血池 ${a.pool} → ${b.pool}）`);
  }
  // 量级：25 层至少 5 倍、35 层至少 20 倍、45 层至少 60 倍（维护者要「数值加高」）
  assert.ok(r25.poolMul >= 5, `25 层血池倍率 ${r25.poolMul.toFixed(2)} 太低`);
  assert.ok(r35.poolMul >= 20, `35 层血池倍率 ${r35.poolMul.toFixed(2)} 太低`);
  assert.ok(r45.poolMul >= 60, `45 层血池倍率 ${r45.poolMul.toFixed(2)} 太低`);
  // 波次缩放 = 血池倍率 × 官方最后一档（同一个曲线，客户端看到的和打的是同一个数）
  const base = m.gd.baseEnemyScale(15).hpMul;
  for (const [r, v] of [[25, r25], [35, r35], [45, r45]]) {
    assert.ok(Math.abs(v.wave - base * v.poolMul) < 1e-6, `${r} 层波次缩放与血池倍率不同源`);
  }
});
// 维护者 2026-11-05：有时效的 buff 必须在 buff 栏看得到「还有多久」——
// 本层词条（深潜补给）以前完全不出现在 words 里，HUD 上根本看不到；排异/封锁只剩几层也没角标。
test('本层词条进 buff 栏（temporary + rounds），按层数到期的诅咒带 roundsLeft', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 19;
  m.startRound(20);
  m.echoSupply = {
    round: 20,
    options: [{ kind: 'word', id: 'word_atk', name: '词条 · 强攻', desc: '本层全队攻击 +8%', mods: { atkPct: 0.08 } }],
    votes: new Map(),
    pick: null,
  };
  m._echoSettleSupply(0);
  const word = m.publicView().echo.words.find((w) => w.temporary === true);
  assert.ok(word, '本层词条要出现在 m.public.echo.words 里');
  assert.equal(word.name, '词条 · 强攻');
  assert.equal(word.rounds, 1, '角标要显示「本层」');
  // 下一层自动消失
  m.round = 20;
  m.startRound(21);
  assert.ok(!m.publicView().echo.words.some((w) => w.temporary === true), '下一层不再显示本层词条');
  // 按层数到期的诅咒：排异还剩 2 层
  m.echoCurseIds = ['block_bond'];
  m.echoBannedBonds = ['someBond'];
  m.echoBannedBondsUntil = { someBond: m._echoDepth() + 2 };
  const curse = m.publicView().echo.curses.find((c) => c.id === 'block_bond');
  assert.equal(curse.roundsLeft, 2, 'buff 栏角标要显示剩余层数');
});

// 维护者 2026-11-05（67 层实测）：队友死亡后无法救援，界面提示「本局模拟已经结束，无法救援」。
// 根因：boss 战的**团队血池** teamLp 在 boss 回合结束后从没复位过 —— 原版只打一次 boss 所以没事，
// 深潜的返场 boss（25 / 35 / 45…）会反复出现，于是从 R14 之后每一层都被当成「boss 战还没结束」。
test('深潜 boss 回合结束后团队血池复位：队友死亡不再被判成「本局模拟已结束」', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  // R14 → R15 的隐藏核心要**沿用**上一场的血池（startFinalAssault(true) 不重新开池）
  m.round = 13; m.startRound(14);
  m.startFinalAssault(false);
  const carried = m.teamLp;
  assert.ok(carried != null, 'R14 最终攻势要开团队血池');
  m.round = 14; m.startRound(15);
  assert.equal(m.teamLp, carried, 'R14 → R15 隐藏核心沿用同一份血池');
  // 返场 boss 打完 → 下一层必须复位
  m.round = 24; m.startRound(25);
  m.startFinalAssault(false);
  assert.ok(m.teamLp != null, 'R25 返场 boss 也要开血池');
  m.round = 25; m.startRound(26);
  assert.equal(m.teamLp, null, 'boss 回合结束后 teamLp 必须复位');
  const ps = m.alivePlayers()[0];
  ps.pendingDeath = true;
  ps.alive = false;
  assert.notEqual(m._revivalDeathReason(ps), 'match-ended', '不该再报「本局模拟已经结束」');
});

// 维护者 2026-11-05：16 层以后的「深渊祭坛 → 献祭 · 祝福」抽到的是一次性祝福。
// 它拿到就结算（不占名额），但**必须一直留在「已获祝福」列表里** —— 包括断线续玩 / 节点重启读档之后。
// 以前 echoOneShotIds 没进存档，读档后祭坛抽到的祝福会整批消失（玩家以为被诅咒吃掉了）。
test('祭坛抽到的一次性祝福进存档：读档后仍在祝福列表里', async (t) => {
  const { snapshotMatch } = await import('../../server/match/snapshot.js');
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  const ps = m.alivePlayers()[0];
  ps.funds = 9999;
  assert.equal(m.buyEchoAltar(ps, 'blessing')?.ok, true, '16 层可以献祭抽祝福');
  const before = (m.publicView().echo.blessings || []).map((b) => b.id);
  assert.ok(before.length >= 1, '祭坛抽到的祝福要先出现在列表里');
  const doc = snapshotMatch(m);
  assert.ok(doc, '准备阶段能存检查点');
  assert.deepEqual(doc.match.echoOneShotIds, m.echoOneShotIds, '一次性祝福的回执要进存档');
  // 同一批「整局累计」的深渊状态也不能丢（祭坛强化 / 刷新额度 / 禁令到期层）
  for (const k of ['echoAltarBuffStacks', 'echoBlessingRefreshes', 'echoBannedTilesUntil', 'echoBannedBondsUntil', 'echoSupplyWords']) {
    assert.ok(Object.hasOwn(doc.match, k), `${k} 要进存档`);
  }
});
// 维护者 2026-11-05：16 层以后所有「频次怪」（被打 N 下才死）的血量都不能按深度缩放。
// 器物类的 baseHp 恰好等于需要的次数，所以正确值就是 baseHp 本身。
test('16 层以后所有频次怪血量等于基础值（不被深度缩放）', async (t) => {
  const { echoHitCountEnemy } = await import('../../server/match/match/echoWaves.js');
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const set = echoHitCountEnemy(m.gd);
  assert.ok(set.size >= 10, `频次怪识别数量异常：${set.size}`);
  for (const key of set) {
    const base = m.gd.enemy(key).stats.maxHp;
    const wave = { spawns: [{ enemyKey: key, count: 1, mods: { hpMul: 38.2 } }] };
    m._echoTuneHitCount(wave);
    const mul = wave.spawns[0].mods.hpMul;
    assert.ok(mul <= 1, `${key} 的 hpMul 仍被放大：${mul}`);
    assert.equal(Math.round(base * mul), base, `${key} 最终血量应为 ${base}（实际 ${Math.round(base * mul)}）`);
  }
  // 长句里提到「需要 N 次伤害击倒」的普通敌人不能被误判
  assert.equal(set.has('enemy_1288_duskls'), false, '深池逐火战士不是频次怪');
  assert.equal(set.has('enemy_9010_acpupp'), false, '假想敌·再生不是频次怪');
});

// 玩家 2026-11-05：资金 1、刷新按钮显示 1，点下去却「资金不足」。
// 原因是界面发的是基础价（gd.refreshPrice），服务端按「深渊通胀」收 round(基础 × 倍率)。
// 现在视图下发实际价格（整数），客户端预检和服务端扣费是同一个数。
test('刷新价按深渊通胀下发实际价格（整数），资金不够时预检也能挡住', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const ps = m.alivePlayers()[0];
  m.round = 30;
  ps.shop.freeRefreshes = 0;
  const price = ps.privateView().shop.refreshPrice;
  assert.equal(price, Math.max(0, Math.round(m.gd.refreshPrice * m._echoShopPriceMul())), '界面价格 = 实际价格');
  assert.ok(Number.isInteger(price), '刷新价必须是整数');
  assert.ok(price >= 1, '30 层至少要 1 资金');
  // 免费刷新用完后，界面显示的就是要扣的钱（客户端 preflight 也读这个字段）
  ps.shop.freeRefreshes = 0;
  assert.equal(ps.privateView().shop.refreshPrice, price);
});

// 维护者 2026-11-05：三张都不想要时可以投票放弃本次祝福。
test('祝福三选一可以投票放弃（下标 = 候选数）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 20;
  m.startRound(20);
  for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) h.sched.advance(200);
  m.echoBlessingOffer = ['atk_s', 'hp_s', 'def_s'];
  m._echoBlessingVotes = new Map();
  const [a, b] = m.alivePlayers();
  assert.equal(m.setEchoBlessingVote(a, 3).ok, true, '放弃票要能投进去');
  assert.equal(m.setEchoBlessingVote(b, 3).ok, true);
  assert.equal(m.echoBlessings.length, 0, '放弃就不发祝福');
  assert.equal(m.echoBlessingSkipped, 1, '记一次放弃（避免下一层又弹同一批）');
  assert.equal(m.echoBlessingOffer, null, '面板要关掉');
});

// 维护者 2026-11-05：「护盾」是一次性效果，显示在祝福列表里但不占名额；还要显示保护的是哪条盟约。
test('护盾祝福：不占祝福名额，且显示已指定的盟约', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 30;
  m.echoBlessings = ['hp_s', 'atk_s', 'shield_bond'];
  m.echoShieldBond = 'yanShip';
  const e = m._echoPublic();
  const shield = e.blessings.find((b) => b.id === 'shield_bond');
  assert.ok(shield, '护盾要出现在列表里');
  assert.equal(shield.occupiesSlot, false, '护盾不占名额');
  assert.equal(e.blessings.filter((b) => b.occupiesSlot).length, 2, '只数两个真正占位的祝福');
  assert.match(shield.desc, /已指定/, '要显示保护的是哪条盟约');
});

// 维护者 2026-11-05：一次性祝福（资金/回血/净化）和反制祝福拿到就结算，
// 但玩家要能在「已获得祝福」和 buff 栏里看到，只是不占名额。
test('一次性 / 反制祝福也显示在祝福列表里，但不占名额', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 30;
  m.echoBlessings = ['hp_s'];
  m.echoOneShotIds = ['fund', 'heal_s'];
  m.echoCounterIds = ['quench'];
  const e = m._echoPublic();
  const ids = e.blessings.map((b) => b.id);
  for (const id of ['fund', 'heal_s', 'quench']) assert.ok(ids.includes(id), `${id} 要出现在列表里`);
  assert.equal(e.blessings.filter((b) => b.occupiesSlot).length, 1, '只有真正占位的那一个计入 n/3');
  const fund = e.blessings.find((b) => b.id === 'fund');
  assert.equal(fund.oneShot, true);
  assert.equal(fund.consumed, true);
});

// 玩家 2026-11-05：深潜补给 / 祝福的选择会吃掉准备阶段的倒计时。
// 原版里这类选择不吃准备时间，所以面板打开时暂停倒计时、关掉后把剩余时间接回来。
test('深潜补给的选择不占用准备阶段倒计时', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 20;
  m.startRound(21);
  for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) h.sched.advance(200);
  assert.equal(m.phase, 'PREP');
  const before = m.deadline - m.sched.now();
  assert.ok(before > 0, '准备阶段应该有倒计时');
  m.echoSupplyLastDepth = 0;
  m.echoBlessingOffer = null;                 // 避免祝福面板占着「还有面板开着」的判断
  m.echoBlessingDiscardOffer = null;
  assert.equal(m._echoOpenSupply(true), 1, '要能开出补给');
  assert.equal(m.deadline, 0, '面板开着时倒计时暂停');
  h.sched.advance(10000);
  const [a, b] = m.alivePlayers();
  m.setEchoSupplyPick(a, 0);
  m.setEchoSupplyPick(b, 0);
  // 测试房把定时器「挂起」了（setDeadline 的 test 分支），所以这里断言「暂停时长被记下来、结算后清空」；
  // 真实房间里它会用这段时长把 deadline 接回去。
  assert.equal(m._echoPrepPausedMs, null, '结算后暂停状态要清掉（恢复倒计时）');
});
