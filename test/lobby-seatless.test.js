// test/lobby-seatless.test.js — 「在房间里，但没有座位」的幽灵会话（2026-11-06）。
//
// 玩家反馈：有时候一个人能进房间 2 个座位，另一个人却「准备」不了。
// 根因是三条互相独立的缺陷叠在一起：
//   ① room.join 只要「已在本房间」就直接 return OK，不看有没有座位；
//   ② room.ready 拿不到座位时直接 seat.content / seat.ready → TypeError，客户端只显示「准备失败」；
//   ③ dedupeSeats 清掉重复座位时没有清掉那个会话的 roomCode → 会话继续「在房间里」。
//
// 这里不依赖 WS：Lobby 的 join / ready / dedupeSeats 都是纯逻辑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { ERR } from '../shared/constants.js';

function make() {
  class Rec { constructor() {} start() {} dispose() {} }
  const registry = new SessionRegistry();
  const lobby = new Lobby({
    registry,
    MatchClass: Rec,
    getData: () => ({}),
    log: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const sess = (playerId, accountId, name) => ({
    playerId, accountId: accountId == null ? null : String(accountId), name, connected: true,
    roomCode: null, ws: null, lastActiveAt: Date.now(), adminId: true,
  });
  return { lobby, registry, sess };
}

/** 把某个玩家的座位抹掉，模拟「被 dedupeSeats 收敛 / 被同账号接管」后的状态。 */
function unseat(room, playerId) {
  const seat = room.seatOf(playerId);
  assert.ok(seat, '前置条件：本来是有座位的');
  room.seats[seat.seat] = null;
  return seat.seat;
}

test('座位没了但会话还在房间里：ready 自动补座，不再抛 TypeError', () => {
  const { lobby, sess } = make();
  const host = sess('p_a', 101, '甲');
  const b = sess('p_b', 202, '乙');
  lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' });
  const room = lobby.roomOf(host);
  assert.equal(lobby.join(b, { code: room.code }).ok, true);

  unseat(room, b.playerId);
  assert.equal(room.seatOf(b.playerId), null, '此刻乙没有座位');

  const res = lobby.ready(b, { ready: true });
  assert.equal(res.ok, true, `应当自动补座并准备，实际 ${JSON.stringify(res)}`);
  const seat = room.seatOf(b.playerId);
  assert.ok(seat, '座位补回来了');
  assert.equal(seat.ready, true, '准备好了');
});

test('座位没了再点进房间：join 重新落座（而不是直接返回 OK 什么都不做）', () => {
  const { lobby, sess } = make();
  const host = sess('p_a', 101, '甲');
  const b = sess('p_b', 202, '乙');
  lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' });
  const room = lobby.roomOf(host);
  lobby.join(b, { code: room.code });

  unseat(room, b.playerId);
  const again = lobby.join(b, { code: room.code });
  assert.equal(again.ok, true, `应当重新落座，实际 ${JSON.stringify(again)}`);
  assert.ok(room.seatOf(b.playerId), '座位回来了');
  assert.equal(room.seatOf(b.playerId).playerId, b.playerId);
});

test('房间已满 + 会话没座位：给一句能看懂的错误，而不是崩在 ready 里', () => {
  const { lobby, sess } = make();
  const p1 = sess('p1', 11, '甲');
  lobby.create(p1, { mode: 'coop', difficulty: 'NORMAL' });
  const room = lobby.roomOf(p1);
  const others = [sess('p2', 12, '乙'), sess('p3', 13, '丙'), sess('p4', 14, '丁')];
  for (const o of others) assert.equal(lobby.join(o, { code: room.code }).ok, true);
  assert.equal(room.freeSeat(), -1, '四个座位都满了');

  unseat(room, others[0].playerId);
  const res = lobby.ready(others[0], { ready: true });
  assert.equal(res.ok, false, '补不了座就不能假装成功');
  assert.equal(res.error, ERR.NOT_IN_ROOM, '要回 NOT_IN_ROOM，客户端才知道该重新进房');
});

test('dedupeSeats 清掉重复座位时，顺手把那个会话的 roomCode 清掉（不留幽灵）', () => {
  const { lobby, sess } = make();
  const host = sess('p_a', 101, '甲');
  lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' });
  const room = lobby.roomOf(host);

  // 同一个账号的两个会话：旧的在 2 号位，新的在 3 号位（模拟刷新后旧座位没被认出来）
  const oldTab = sess('p_old', 777, '甲');
  const newTab = sess('p_new', 777, '甲');
  room.seats[1] = lobby.humanSeat(1, oldTab, room);
  oldTab.roomCode = room.code;
  room.seats[2] = lobby.humanSeat(2, newTab, room);
  newTab.roomCode = room.code;

  const removed = lobby.dedupeSeats(room, newTab);
  assert.ok(removed >= 1, '应当收敛掉旧座位');
  assert.equal(room.seatOf(oldTab.playerId), null, '旧座位没了');
  assert.equal(oldTab.roomCode, null, '★ 旧会话不能再算「在房间里」');
  assert.ok(room.seatOf(newTab.playerId), '保留的是当前会话的座位');
});