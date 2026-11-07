// 刷新页面后「重新 join 回原房」的两种处境（维护者 2026-11-07：深潜房里点「服务器已更新」的刷新按钮，
// 回来人被踢到大厅）。
//
// 背景：横幅上的刷新按钮会先记下房间号再 reload（ui/connBanner.js），回来后大厅自动 room.join 一次。
// 对局进行中（深潜 / 普通房在备战、结算界面）那个 join 会遇到两个分支：
//   * 新会话的账号身份还没送到 —— 服务端**不能**直接回 ROOM_STARTED（客户端会以为进不去、退回大厅），
//     要回 IDENTITY_PENDING，让客户端等 sp-account-token 到了重新握手再试一次；
//   * 身份到了 —— 走「同账号接管自己的座位」，对局进行中也允许，连对局一起恢复；
//   * 真游客没有身份可等 —— 照旧 ROOM_STARTED（进不去对局房是对的）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { ERR } from '../../shared/constants.js';

process.env.SP_GATE_IGNORE = '1';
const silent = { info() {}, warn() {}, error() {}, debug() {} };

let seq = 0;
function player(name, accountId = null) {
  seq += 1;
  return {
    playerId: `p_${seq}`,
    accountId: accountId === null ? `acc_${seq}` : accountId,
    name,
    connected: true,
    ws: null,
  };
}

function makeLobby() {
  return new Lobby({ registry: new SessionRegistry(), log: silent });
}

/** 一间合作房（对局用空对象假装在跑：join 只判断 `room.match` 真假）。 */
function startedRoom(lobby) {
  const host = player('Host');
  const created = lobby.create(host, {
    mode: 'coop', difficulty: 'NORMAL',
    experimental: { revivalEnabled: false, disableSharedPool: false, playerCapacity: 4 },
  });
  assert.deepEqual(created, { ok: true }, '建房成功');
  const room = lobby.roomOf(host);
  room.match = {};                       // 对局进行中
  return { host, room };
}

test('对局进行中 + 账号身份还没送到：回 IDENTITY_PENDING（不是 ROOM_STARTED）', () => {
  const lobby = makeLobby();
  const { room } = startedRoom(lobby);
  // 刷新后的新会话：不是游客，但 accountToken 还没到服务端
  const fresh = { guest: false, playerId: 'p_fresh', accountId: '', name: 'Host', connected: true, ws: null };
  const res = lobby.join(fresh, { code: room.code });
  assert.equal(res.error, ERR.IDENTITY_PENDING, '身份在途不能报「房间已开局」—— 客户端会因此退回大厅');
});

test('对局进行中 + 身份到了：同账号接管自己的座位，连对局一起恢复', () => {
  const lobby = makeLobby();
  const { host, room } = startedRoom(lobby);
  const fresh = { guest: false, playerId: 'p_again', accountId: host.accountId, name: 'Host', connected: true, ws: null };
  const res = lobby.join(fresh, { code: room.code });
  assert.deepEqual(res, { ok: true }, '接管成功');
  const seat = room.seatOf('p_again');
  assert.ok(seat, '座位已经交给新会话');
  assert.equal(seat.playerId, 'p_again');
  assert.equal(seat.connected, true);
  assert.equal(room.seatOf(host.playerId), null, '旧会话的座位 id 已经被换掉（同一个人，不是两个座位）');
});

test('对局进行中 + 真游客：照旧 ROOM_STARTED（没有身份可等）', () => {
  const lobby = makeLobby();
  const { room } = startedRoom(lobby);
  const guest = { guest: true, playerId: 'p_guest', accountId: '', name: 'Guest', connected: true, ws: null };
  const res = lobby.join(guest, { code: room.code });
  assert.equal(res.error, ERR.ROOM_STARTED);
});

test('没开局时不受影响：身份在途照样能 join（原有逻辑不变）', () => {
  const lobby = makeLobby();
  const host = player('Host');
  assert.deepEqual(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  const room = lobby.roomOf(host);
  assert.equal(room.match, null, '前提：没开局');
  const fresh = { guest: false, playerId: 'p_x', accountId: '', name: 'X', connected: true, ws: null };
  const res = lobby.join(fresh, { code: room.code });
  assert.deepEqual(res, { ok: true }, '准备阶段照常落座');
});
