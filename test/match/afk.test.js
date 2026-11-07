// 挂机移出 / 消极游戏（server/match/match/platform.js 的 _checkIdle，移植自参考版）。
//
// 测的是「判定口径」，不是整局流程：
//   · 连续 afkRemoveRounds 回合没有实质操作 → 移出
//   · 有实质操作（AFK_ACTIONS 任一条）→ 归零，不移出
//   · 掉线中 → 归零（**这是这次移植修的主要问题**：掉线的人发不出指令，
//     旧的两条规则会把他当挂机踢掉，而他只是网断了）
//   · AI 托管中 → 归零
//   · 单人局（一真人 + AI，或真正单人）→ 根本不判定（判据是建局快照 soloUntimed/loneHuman）
//   · afkRemoveRounds = 0 → 完全关闭
//   · 到上限前一回合先警告一次，不直接踢
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { AFK_REMOVE_ROUNDS, AFK_ACTIONS } from '../../server/match/match/common.js';

const LIMIT = 2;

/** 只跑到 INFO_CHECK 之后、把两个真人塞进 PREP 的最小状态，直接调 _checkIdle 数回合。 */
function idleScenario(o = {}) {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, ...o });
  const m = h.m;
  // 把回合数推到 5（旧规则在第 4 回合后就不再判定了，这里要证明新规则不受那个限制）
  m.round = o.round ?? 5;
  return { h, m, p0: m.players.get('p_0'), p1: m.players.get('p_1') };
}

test('AFK_ACTIONS 是「实质操作」白名单：买/卖/移动/选盟约都算，点准备/发表情不算', () => {
  assert.ok(AFK_ACTIONS instanceof Set);
  assert.equal(AFK_ACTIONS.size, 22, '普通房 13 条 + 深渊回响 9 条');
  for (const t of ['g.buy', 'g.sell', 'g.move', 'g.refresh', 'g.levelUp', 'g.freeze', 'g.equip',
    'g.destroy', 'g.choice', 'g.reward', 'g.revive', 'g.band', 'g.bandSkip']) {
    assert.ok(AFK_ACTIONS.has(t), `${t} 应该算有操作`);
  }
  for (const t of ['g.ready', 'g.infoReady', 'g.emote', 'g.watch', 'g.autoplay']) {
    assert.ok(!AFK_ACTIONS.has(t), `${t} 不该算有操作`);
  }
});

test('深渊回响的操作也算「实质操作」：祭坛/祝福/补给/投影/护盾/反制/放弃深潜', () => {
  for (const t of ['g.echoAltar', 'g.echoBlessing', 'g.echoBlessingDiscard', 'g.echoBlessingRefresh',
    'g.echoSupply', 'g.echoProjection', 'g.echoShield', 'g.echoCounterUse', 'g.echoGiveUp']) {
    assert.ok(AFK_ACTIONS.has(t), `${t} 应该算有操作`);
  }
});

test('★ 深渊回响的挂机回合数至少 3：2 回合不动不踢，第 3 回合才移出', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, variant: 'deepecho', afkRemoveRounds: LIMIT });
  const m = h.m;
  m.round = 5;
  assert.equal(m._afkLimit(), 3, '深潜至少 3 回合（普通房是 2）');
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  m._checkIdle();
  m._checkIdle();
  assert.deepEqual(kicked, [], '2 回合不动：普通房会踢，深潜不踢');
  m._checkIdle();
  assert.deepEqual(kicked.sort(), ['p_0', 'p_1'], '第 3 回合才移出');
  m.dispose();
});

test('深潜的挂机警告也按 3 回合口径（第 2 回合提示，第 3 回合才移出）', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, variant: 'deepecho', afkRemoveRounds: LIMIT });
  const m = h.m;
  m.round = 5;
  const p0 = m.players.get('p_0');
  m._checkIdle();
  assert.equal(p0.afkWarned(), false, '第 1 回合还不提示');
  m._checkIdle();
  assert.equal(p0.afkWarned(), true, '第 2 回合提示「下回合再不动就移出」');
  m.dispose();
});

test('★ 深潜里在祭坛买东西就算操作（以前会被判挂机）', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, variant: 'deepecho', afkRemoveRounds: LIMIT });
  const m = h.m;
  m.round = 5;
  const p0 = m.players.get('p_0');
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  m._checkIdle();
  assert.equal(p0.afkRounds, 1);
  m._handle(p0, { t: 'g.echoAltar', kind: 'life' });
  assert.equal(p0.afkActed, true, 'g.echoAltar 是 AFK_ACTIONS 之一');
  m._checkIdle();
  assert.equal(p0.afkRounds, 0, '在祭坛操作过 → 归零');
  assert.ok(!kicked.includes('p_0'));
  m.dispose();
});

test('默认 afkRemoveRounds 是 2，且 0 表示关闭', () => {
  assert.equal(AFK_REMOVE_ROUNDS, 2, 'Match 不传 opts 时用这个默认值');
  // harness 故意默认关（见 harness.js 的注释），所以这里只能验证「传 0 → 关」和「传 3 → 3」
  const off = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, afkRemoveRounds: 0 });
  assert.equal(off.m.afkRemoveRounds, 0);
  const three = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, afkRemoveRounds: 3 });
  assert.equal(three.m.afkRemoveRounds, 3);
  // 非法值（负数 / 小数 / 字符串）被 Match 的校验挡下，回落到默认 AFK_REMOVE_ROUNDS。
  // 注意 null/undefined 走 harness 的 `?? 0`，所以是「关」，不在这里测。
  for (const bad of [-1, 1.5, '2']) {
    const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, afkRemoveRounds: bad });
    assert.equal(h.m.afkRemoveRounds, AFK_REMOVE_ROUNDS, `非法值 ${String(bad)} 回落到默认`);
  }
  // 上限 100（超过就夹到 100，不是回落）
  const big = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, afkRemoveRounds: 500 });
  assert.equal(big.m.afkRemoveRounds, 100, '超过 100 夹到 100');
});

test('连续 2 回合没有实质操作 → 移出（走 onIdleKick）', () => {
  const { h, m, p0, p1 } = idleScenario({ afkRemoveRounds: LIMIT });
  const kicked = [];
  m.onIdleKick = (playerId, reason) => kicked.push([playerId, reason]);
  assert.equal(p0.afkRounds, 0);
  m._checkIdle();
  assert.equal(p0.afkRounds, 1, '第 1 回合：只是计数');
  assert.deepEqual(kicked, [], '还没到上限，不该踢');
  m._checkIdle();
  assert.deepEqual(kicked, [['p_0', 'afk'], ['p_1', 'afk']], '第 2 回合：两个真人都到上限，都被移出');
  assert.ok(p0._idleKicked && p1._idleKicked);
  // 幂等：再数一遍不重复踢
  kicked.length = 0;
  m._checkIdle();
  assert.deepEqual(kicked, [], '已经标记过的不再踢第二次');
  assert.ok(h);
});

test('有实质操作就归零（afkActed 由 _trackActivity 置位）', () => {
  const { m, p0 } = idleScenario({ afkRemoveRounds: LIMIT });
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  m._checkIdle();
  assert.equal(p0.afkRounds, 1);
  // 这一回合买了东西
  m._handle(p0, { t: 'g.refresh' });
  assert.equal(p0.afkActed, true, 'g.refresh 是 AFK_ACTIONS 之一');
  m._checkIdle();
  assert.equal(p0.afkRounds, 0, '有操作 → 归零，不是继续累加');
  assert.ok(!kicked.includes('p_0'), 'p_0 动过了，不该被踢');
  // p_1 一次没动，两回合后按规则该被移出 —— 这正是规则要的效果
  assert.ok(kicked.includes('p_1'), '什么都没做的 p_1 该被移出');
});

test('★ 掉线中不算挂机：网断的玩家不会被当成消极游戏踢掉', () => {
  const { m, p0, p1 } = idleScenario({ afkRemoveRounds: LIMIT });
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  // p_0 掉线，p_1 正常但也不动
  p0.connected = false;
  m._checkIdle();
  m._checkIdle();
  m._checkIdle();
  assert.equal(p0.afkRounds, 0, '掉线的人每回合都归零');
  assert.ok(!kicked.includes('p_0'), '掉线的人不能被移出');
  assert.ok(kicked.includes('p_1'), '在线的那个不动就该被移出');
  assert.equal(p1._idleKicked, true);
});

test('AI 托管中不算挂机', () => {
  const { m, p0 } = idleScenario({ afkRemoveRounds: LIMIT });
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  p0.autoplay = true;
  m._checkIdle();
  m._checkIdle();
  assert.equal(p0.afkRounds, 0, '托管是主动交出去的，不算消极');
  assert.ok(!kicked.includes('p_0'));
});

test('合作房里一真人 + 三个 AI（建局快照 loneHuman）根本不判定', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 3, seed: 7, afkRemoveRounds: LIMIT });
  const m = h.m;
  const p0 = m.players.get('p_0');
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  m.round = 5;
  assert.equal(m.loneHuman, true, '建局时只有一个真人');
  for (let i = 0; i < 5; i++) m._checkIdle();
  assert.equal(p0.afkRounds, 0, '一真人 + 三个 AI 仍然是单人局，计数都不维护');
  assert.deepEqual(kicked, []);
});

test('单人模式（mode: solo）不判定：一个人打单机，挂机不伤害别人', () => {
  const h = makeMatch({ mode: 'solo', humans: 1, seed: 7, afkRemoveRounds: LIMIT });
  const m = h.m;
  const p0 = m.players.get('p_0');
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  m.round = 5;
  for (let i = 0; i < 5; i++) m._checkIdle();
  assert.equal(p0.afkRounds, 0);
  assert.deepEqual(kicked, []);
});

test('2 人开局、中途走掉一个 → 仍然继续判定（判据是建局快照 loneHuman，参考版口径）', () => {
  const { m, p0, p1 } = idleScenario({ afkRemoveRounds: LIMIT });
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  p1.left = true;
  assert.equal(m.loneHuman, false, '快照还是「开局 2 个真人」——中途退出不改变它');
  m._checkIdle();
  assert.equal(p0.afkRounds, 1, '剩下的真人照样计数');
  m._checkIdle();
  assert.ok(kicked.includes('p_0'), '连续 2 个备战没操作 → 移出（参考版也这么做）');
});

test('到上限前一回合先警告一次，不直接踢', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, afkRemoveRounds: 3 });
  const m = h.m;
  m.round = 5;
  const p0 = m.players.get('p_0');
  const toasts = [];
  m.toast = (ps, kind, text) => toasts.push([ps.playerId, kind, text]);
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  m._checkIdle();               // afkRounds 1
  m._checkIdle();               // afkRounds 2 == limit-1 → 警告
  assert.equal(p0.afkRounds, 2);
  assert.equal(toasts.filter((t) => t[0] === 'p_0').length, 1, '警告一次');
  assert.match(toasts[0][2], /没有任何操作/);
  assert.deepEqual(kicked, [], '只警告，还没踢');
  m._checkIdle();               // afkRounds 3 == limit → 移出
  assert.ok(kicked.includes('p_0'));
});

test('afkRemoveRounds = 0 完全关闭（连计数都不做）', () => {
  const { m, p0 } = idleScenario({ afkRemoveRounds: 0 });
  const kicked = [];
  m.onIdleKick = (playerId) => kicked.push(playerId);
  for (let i = 0; i < 5; i++) m._checkIdle();
  assert.equal(p0.afkRounds, 0);
  assert.deepEqual(kicked, []);
});
