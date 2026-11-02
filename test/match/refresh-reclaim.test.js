// 房间内刷新回来：座位按「账号」认人（2026-11-02 兜底）。
//
// 背景：roomOf() 是按 playerId 找座位的，而刷新 / 换设备会让 playerId 变。
// 旧代码一找不到就把 session.roomCode 清成 null → onHello 发 room.closed → 玩家掉回大厅
// （维护者实测：房间里按 F5，画面直接变大厅）。
//
// 现在补了一条：同 accountId、座位还在、且原来那个会话已经没了（幽灵座位）→ 把座位改绑到新会话。
// 只在**没有进行中的对局**时生效 —— 对局中的恢复走检查点那条路，不在这里抢。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function newLobby() {
  return new Lobby({ registry: new SessionRegistry(), log: silent });
}

/** 一间合作房 + 房主（房主不进 registry：模拟「旧会话已经没了」）。 */
function roomWithHost(lobby) {
  const host = { playerId: 'p_host', accountId: 'acc_host', name: 'Host', connected: true, ws: null };
  assert.deepEqual(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true }, '建房成功');
  const room = lobby.roomOf(host);
  assert.ok(room, '房主在房间里');
  return { host, room };
}

test('刷新回来：同账号的新会话能拿回座位（playerId 变了也可以）', () => {
  const lobby = newLobby();
  const { host, room } = roomWithHost(lobby);

  // 模拟刷新：旧会话消失，新会话 playerId 变了，但 accountId 相同
  const fresh = { playerId: 'p_fresh', accountId: host.accountId, name: 'Host', connected: true, ws: null, roomCode: room.code };
  const got = lobby.roomOf(fresh);
  assert.equal(got, room, '按账号认回来，不是掉回大厅');
  assert.equal(room.seatOf('p_fresh')?.playerId, 'p_fresh', '座位已改绑到新会话');
  assert.equal(fresh.roomCode, room.code, 'roomCode 没有被清空');
  assert.equal(room.hostId, 'p_fresh', '原来房主的座位改绑后，hostId 跟着更新');
});

test('别的账号抢不走：accountId 不同就照旧清空', () => {
  const lobby = newLobby();
  const { room } = roomWithHost(lobby);
  const stranger = { playerId: 'p_stranger', accountId: 'acc_other', name: 'X', connected: true, ws: null, roomCode: room.code };
  assert.equal(lobby.roomOf(stranger), null, '不是你的座位就不给');
  assert.equal(stranger.roomCode, null, 'roomCode 被清空');
});
