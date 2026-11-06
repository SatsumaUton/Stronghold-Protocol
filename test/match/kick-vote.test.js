// 投票移出（server/match/match/kickVote.js，维护者 2026-11-06）：在线真人投票把**掉线的队友**移出。
//
// 本服口径（与参考版不同，参考版依赖 offlineAutoplay / m.removed / onRemove 这套机制，本服没有）：
//   * 目标资格：真人、非观战、没主动退出、还活着、**当前不在线**（`!ps.connected`）；
//   * 只有 SP_DRAFT / PREP 能发起；同时只允许一个投票；同一目标本回合失败过就不能再提；
//   * 提案人自动算一票同意；通过 = 同意 ≥ ⌊投票人/2⌋+1；投票人掉线/离开会被剔除并重算；
//   * 通过后按「中途退出」处理：`left = true` + `eliminate(round)`，并给目标发一条 m.notice kickPassed；
//   * 被否 / 超时 / 撤回 / 准备结束 / 目标重连 / 目标没了 / 没有投票人 → 取消或失败，广播 m.notice。
//   * 全部状态是 transient：检查点恢复后投票消失（snapshot.js MATCH_FIELDS）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, ERR } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { KICK_VOTE_MS, kickNeed } from '../../server/match/match/kickVote.js';
import { canSnapshot, snapshotMatch, restoreMatch, MATCH_FIELDS } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';
import { makeMatch } from './harness.js';

/** n 个真人，最后一个一开始就掉线；跑到 PREP R3。 */
function offline(n = 4, o = {}) {
  const h = makeMatch({ mode: 'coop', humans: n, seed: 65, fake: true, script: () => ({ duration: 4 }), ...o }).start();
  const target = h.ps(`p_${n - 1}`);
  h.m.onDisconnect(target.playerId);
  h.runToPhase(PHASE.PREP, 3);
  assert.equal(target.connected, false, '目标处于掉线状态');
  assert.equal(target.offlineAutoplay, true, '连续 2 个备战结束掉线 → 由 AI 接管（投票的前提）');
  assert.equal(target.autoplay, true);
  return { h, m: h.m, target };
}
const notices = (h, kind) => h.bc.filter((x) => x.t === 'm.notice' && x.kind === kind);
const propose = (m, id, targetId) => m.handle(id, { t: 'g.kickVote', targetId });
const ballot = (m, id, agree, voteId = m.kickVote && m.kickVote.id) => m.handle(id, { t: 'g.kickBallot', voteId, agree });

test('协议与阈值：g.kickVote { targetId } / g.kickBallot { voteId, agree }；严格多数；状态是 transient', () => {
  assert.equal(validateC2S({ t: 'g.kickVote', targetId: 'ABCD-p1' }), null);
  assert.equal(validateC2S({ t: 'g.kickBallot', voteId: 1, agree: false }), null);
  for (const msg of [{ t: 'g.kickVote' }, { t: 'g.kickVote', targetId: '' }, { t: 'g.kickBallot', voteId: 0, agree: true },
    { t: 'g.kickBallot', voteId: 1 }, { t: 'g.kickBallot', voteId: 1, agree: 1 }]) {
    assert.notEqual(validateC2S(msg), null, JSON.stringify(msg));
  }
  assert.deepEqual([1, 2, 3, 4, 5, 7, 19].map(kickNeed), [1, 2, 2, 3, 3, 4, 10]);
  assert.equal(KICK_VOTE_MS, 30_000);
  for (const k of ['kickVote', '_kickVoteSeq', '_kickFailed', '_kickVoteAt']) {
    assert.ok(MATCH_FIELDS.transient.includes(k), `${k} 必须是 transient（读档丢弃）`);
  }
});

test('只有「掉线的真人座位」能被点名：机器人 / 在线的人 / 自己 / 不认识的人 / 观战者都不行', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 3, bots: 1, seed: 65, fake: true, spectators: ['viewer'], script: () => ({ duration: 4 }) }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  m.onDisconnect('p_2');
  h.runToPhase(PHASE.PREP, 3);
  assert.equal(propose(m, 'p_0', 'ai_0').error, ERR.BAD_TARGET, '机器人座位');
  assert.equal(propose(m, 'p_0', 'p_1').error, ERR.BAD_TARGET, '在线的人');
  assert.equal(propose(m, 'p_0', 'p_0').error, ERR.BAD_TARGET, '自己');
  assert.equal(propose(m, 'p_0', 'stranger').error, ERR.BAD_TARGET, '不认识的 id');
  assert.equal(m.handle('viewer', { t: 'g.kickVote', targetId: 'p_2' }).error, ERR.SPECTATOR, '观战者');
  assert.equal(propose(m, 'p_2', 'p_0').error, ERR.NOT_IN_ROOM, '掉线的人自己不能提案');
  assert.deepEqual(propose(m, 'p_0', 'p_2'), { ok: true });
  assert.equal(propose(m, 'p_1', 'p_2').error, ERR.WRONG_PHASE, '同时只能有一个投票');
});

test('单人局没有投票；通过后按「中途退出」移出，并给目标发 kickPassed', (t) => {
  const solo = makeMatch({ mode: 'solo', humans: 1, seed: 65, fake: true, script: () => ({ duration: 4 }) }).start();
  t.after(() => solo.m.dispose());
  assert.equal(propose(solo.m, 'p_0', 'p_0').error, ERR.WRONG_PHASE, '独立模拟没有投票');

  const { h, m, target } = offline(4);
  t.after(() => m.dispose());
  assert.deepEqual(propose(m, 'p_0', 'p_3'), { ok: true });
  const view = m.kickVoteView();
  assert.deepEqual(view.voters, ['p_0', 'p_1', 'p_2'], '投票人 = 在线真人，目标除外');
  assert.deepEqual(view.agreed, ['p_0'], '提案人自动同意');
  assert.equal(view.need, 2, '3 人 → 需要 2 票');
  assert.equal(m.publicView().kickVote.id, view.id, 'm.public 里带 kickVote');
  assert.equal(ballot(m, 'p_3', true).error, ERR.NOT_IN_ROOM, '目标自己不能投');
  assert.deepEqual(ballot(m, 'p_1', true), { ok: true });
  assert.equal(m.kickVote, null, '票够了立刻结算');
  assert.ok(target.left && !target.alive, '和主动退出一样被淘汰');
  assert.equal(m.publicView().kickVote, null, '视图里投票消失');
  // 被移出的人收到 m.removed（客户端据此退出房间并说明原因），其他人收到 m.notice kickPassed
  const removed = h.lastTo('p_3', 'm.removed');
  assert.deepEqual(removed, { t: 'm.removed', reason: 'kicked', rounds: 2 }, '给被移出的人一条 m.removed');
  const passed = h.lastTo('p_0', 'm.notice');
  assert.equal(passed && passed.kind, 'kickPassed', '其他人收到 kickPassed');
  assert.equal(passed.agreed, 2);
  h.invariants();
});

test('被否 / 超时 / 撤回 / 准备结束 / 目标重连：都不移出，且各有回执', (t) => {
  const { h, m, target } = offline(4);
  t.after(() => m.dispose());
  // 两个人反对：3 − 2 < 2，立刻失败
  assert.deepEqual(propose(m, 'p_0', 'p_3'), { ok: true });
  assert.deepEqual(ballot(m, 'p_1', false), { ok: true });
  assert.ok(m.kickVote, '只有一票反对时还没死');
  assert.deepEqual(ballot(m, 'p_2', false), { ok: true });
  assert.equal(m.kickVote, null);
  assert.equal(notices(h, 'kickFailed').at(-1).reason, 'rejected');
  assert.ok(!target.left, '没被移出');
  // 同一目标本回合失败过 → 不能再提
  h.sched.advance(400);
  assert.deepEqual(propose(m, 'p_1', 'p_3'), { error: ERR.ALREADY, detail: 'kick-failed-this-round' });
  // 下一回合可以再提；提案人自己投反对 = 撤回
  h.runToPhase(PHASE.PREP, 4);
  assert.deepEqual(propose(m, 'p_1', 'p_3'), { ok: true });
  assert.deepEqual(ballot(m, 'p_1', false), { ok: true });
  assert.equal(notices(h, 'kickCancelled').at(-1).reason, 'withdrawn');
  assert.ok(!target.left);
  // 300ms 防连点
  assert.equal(propose(m, 'p_1', 'p_3').error, ERR.RATE);
  // 没人投票 → 30 秒后超时
  h.sched.advance(400);
  assert.deepEqual(propose(m, 'p_2', 'p_3'), { ok: true });
  h.sched.advance(m.scaled(KICK_VOTE_MS) + 1);
  assert.equal(m.kickVote, null);
  assert.equal(notices(h, 'kickFailed').at(-1).reason, 'timeout');
  assert.ok(!target.left);
  // 目标重连 → 取消
  h.runToPhase(PHASE.PREP, 6);
  assert.deepEqual(propose(m, 'p_0', 'p_3'), { ok: true });
  m.onReconnect('p_3');
  assert.equal(m.kickVote, null);
  assert.equal(notices(h, 'kickCancelled').at(-1).reason, 'reconnected');
  assert.ok(!target.left && target.connected);
});

test('投票人掉线会被剔除并重算；票全掉光就取消；检查点恢复后投票消失', (t) => {
  const { h, m, target } = offline(4);
  t.after(() => m.dispose());
  // 等 AI 把被接管的座位备战跑完（检查点要等 AI 座位）
  h.run(() => canSnapshot(m) || m.phase !== PHASE.PREP);
  assert.ok(canSnapshot(m), '能存检查点');
  assert.deepEqual(propose(m, 'p_0', 'p_3'), { ok: true });
  assert.deepEqual(ballot(m, 'p_2', false), { ok: true });
  m.onDisconnect('p_2');
  assert.deepEqual(m.kickVote.voters, ['p_0', 'p_1'], '掉线的投票人被剔除');
  assert.equal(m.kickVote.rejected.size, 0, '他那一票反对也一并撤掉');
  assert.equal(m.kickVote.need, 2, '重算');
  // 检查点里没有投票（transient）
  const doc = JSON.parse(JSON.stringify(snapshotMatch(m)));
  const r = makeMatch({ mode: 'coop', seats: doc.seats, seed: doc.seed, fake: true });
  t.after(() => r.m.dispose());
  assert.equal(restoreMatch(r.m, doc, { createRngFromState }), true);
  assert.equal(r.m.kickVote, null, '读档后投票不存在');
  assert.equal(r.m.publicView().kickVote, null);
  // 剩下的投票人再掉一个：只剩提案人 p_0，need 重算为 1 → 提案人自己的同意就够，投票立刻通过
  m.onDisconnect('p_1');
  assert.equal(m.kickVote, null);
  assert.ok(target.left, '只剩提案人时 need=1，通过');
});

test('人少的时候：唯一的投票人一个人就能通过', (t) => {
  const a = offline(2);
  t.after(() => a.m.dispose());
  assert.deepEqual(propose(a.m, 'p_0', 'p_1'), { ok: true });
  assert.ok(a.target.left, '1 个投票人 → need 1，提案人自己就够');

  const b = offline(3);
  t.after(() => b.m.dispose());
  assert.deepEqual(propose(b.m, 'p_0', 'p_2'), { ok: true });
  assert.equal(b.m.kickVote.need, 2);
  b.m.onDisconnect('p_1');                       // 投票人只剩 p_0 → need 1 → 立刻通过
  assert.equal(b.m.kickVote, null);
  assert.ok(b.target.left);
});
