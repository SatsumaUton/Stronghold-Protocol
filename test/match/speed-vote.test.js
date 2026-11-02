// 战斗 2 倍速 (server/match/match/speedVote.js) — 移植自另一 fork 的 2026-11-01 规则。
// 覆盖：门槛 ceil(¾ × 在线人类)、AI/观战席不投票、掉线不计不阻、开战那一刻生效、战斗中投票落到下一场。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rerollNeed } from '../../server/match/match/setupVote.js';
import { makeMatch } from './harness.js';

const fake = (o = {}) => makeMatch({ mode: 'coop', seed: 65, fake: true, script: () => ({ duration: 4 }), ...o }).start();
/** A vote past the 300 ms burst guard. */
const vote = (h, id, agree) => { h.sched.advance(301); return h.m.handle(id, { t: 'g.speedVote', agree }); };
const counted = (m) => { const v = m.speedVoteView(); return [v.voters, v.need, v.agreed.length, v.next]; };

test('门槛 = ceil(¾ × 在线人类)，单人自己就够', (t) => {
  for (const [n, need] of [[1, 1], [2, 2], [3, 3], [4, 3]]) {
    const h = fake({ humans: n });
    t.after(() => h.m.dispose());
    assert.equal(h.m.speedVoteView().need, need, `${n} humans`);
    assert.equal(h.m.speedVoteView().next, false);
  }
  assert.deepEqual([8, 20].map(rerollNeed), [6, 15]);
});

test('AI 席位与观战席都不投票', (t) => {
  const h = fake({ humans: 3, bots: 1, spectators: ['viewer'] });
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.equal(m.speedVoteView().voters, 3, 'bots and the spectator are not voters');
  assert.ok(vote(h, 'viewer', true).error, 'a spectator is refused');
  assert.equal(m.speedVoteView().agreed.length, 0);
});

test('掉线的票既不计也不阻塞，回来后又算数；离场的彻底消失', (t) => {
  const h = fake({ humans: 4 });
  t.after(() => h.m.dispose());
  const m = h.m;
  for (const id of ['p_0', 'p_1', 'p_2']) vote(h, id, true);
  assert.deepEqual(counted(m), [4, 3, 3, true]);
  m.onDisconnect('p_0');
  assert.deepEqual(counted(m), [3, 3, 2, false], 'an offline yes neither counts nor blocks');
  m.onDisconnect('p_3');
  assert.deepEqual(counted(m), [2, 2, 2, true]);
  m.onReconnect('p_0');
  m.onReconnect('p_3');
  assert.deepEqual(counted(m), [4, 3, 3, true]);
  m.onLeave('p_1');
  assert.deepEqual(counted(m), [3, 3, 2, false]);
});

test('准备阶段投票 ⇒ 本场就以 2 倍速开打（2 → 4）', (t) => {
  const h = fake({ humans: 1 });
  t.after(() => h.m.dispose());
  h.toPrep(1);
  const m = h.m;
  assert.equal(m.gameSpeed, 2);
  assert.equal(vote(h, 'p_0', true).ok, true);
  assert.equal(m.speedVoteView().next, true);
  h.drive(() => m.phase === 'COMBAT');
  assert.equal(m.gameSpeed, 4, 'this battle runs at 4');
  assert.equal(m.speedVoteView().on, true);
});

test('战斗中投票：本场不变速，下一场才生效', (t) => {
  const h = fake({ humans: 1 });
  t.after(() => h.m.dispose());
  h.toPrep(1);
  const m = h.m;
  h.drive(() => m.phase === 'COMBAT' && m.round === 1);
  assert.equal(m.gameSpeed, 2);
  assert.equal(vote(h, 'p_0', true).ok, true);
  assert.equal(m.gameSpeed, 2, 'a running battle never changes speed');
  h.toPrep(2);
  h.drive(() => m.phase === 'COMBAT' && m.round === 2);
  assert.equal(m.gameSpeed, 4, 'the next battle applies it');
});

test('撤票后下一场回到常速', (t) => {
  const h = fake({ humans: 1 });
  t.after(() => h.m.dispose());
  h.toPrep(1);
  const m = h.m;
  assert.equal(vote(h, 'p_0', true).ok, true);
  h.drive(() => m.phase === 'COMBAT' && m.round === 1);
  assert.equal(m.gameSpeed, 4);
  // 战斗中撤回：本场仍是 4，下一场回 2
  assert.equal(vote(h, 'p_0', false).ok, true);
  assert.equal(m.gameSpeed, 4, 'the running battle keeps 4');
  h.toPrep(2);
  h.drive(() => m.phase === 'COMBAT' && m.round === 2);
  assert.equal(m.gameSpeed, 2, 'back to the base speed');
});

// ---- 发起提示（玩家反馈：别人发起 2 倍速投票，其他人完全不知道）----------------------------------------

/** 广播里的提示条（m.ticker）。 */
const tickers = (h) => h.bc.filter((x) => x && x.t === 'm.ticker');

test('第一票投进来时广播一条提示，告诉其他人有人在发起', (t) => {
  const h = fake({ humans: 4 });
  t.after(() => h.m.dispose());
  const before = tickers(h).length;
  assert.equal(vote(h, 'p_0', true).ok, true);
  const lines = tickers(h).slice(before);
  assert.equal(lines.length, 1, '一条就够，不要刷屏');
  const line = lines[0];
  assert.equal(line.type, 'CUSTOM');
  // wireMessage 已经把 {name} 这类占位符解析成成品文本了（见 messaging.js tickerText）
  assert.match(line.text, /2 倍速投票/, '说清楚是什么投票');
  assert.match(line.text, /P0/, '点名是谁发起的');
  assert.match(line.text, /1\/3/, '现在几票通过（4 人局门槛 3）');
});

test('跟着赞成的人不会再刷一条', (t) => {
  const h = fake({ humans: 4 });
  t.after(() => h.m.dispose());
  vote(h, 'p_0', true);
  const after1 = tickers(h).length;
  vote(h, 'p_1', true);
  vote(h, 'p_2', true);
  assert.equal(tickers(h).length, after1, '只有第一票才提示');
  assert.equal(h.m.speedVoteView().next, true);
});

test('全员撤回后再有人发起，会重新提示一次', (t) => {
  const h = fake({ humans: 4 });
  t.after(() => h.m.dispose());
  vote(h, 'p_0', true);
  vote(h, 'p_0', false);
  const after = tickers(h).length;
  vote(h, 'p_1', true);
  assert.equal(tickers(h).length, after + 1, '这一轮投票是重新开始的');
});

test('单人对局不提示（need=1，赞成即通过，没必要告诉自己）', (t) => {
  const h = fake({ humans: 1 });
  t.after(() => h.m.dispose());
  const before = tickers(h).length;
  vote(h, 'p_0', true);
  assert.equal(tickers(h).length, before);
  assert.equal(h.m.speedVoteView().next, true);
});
