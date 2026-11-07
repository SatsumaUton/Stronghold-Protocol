// 跨设备恢复对局（account.resume）：玩家反馈「换设备点恢复对局，提示『当前节点没有可恢复的账号对局』」。
//
// 2026-11-08：以前 `resumeAccount` 只在**本节点的会话表**里找「同账号的另一个会话」。旧设备关掉超过重连窗口、
// 会话被 evict、或者节点重启后只剩房间存档时，会话不在了 —— 座位（房间里的 accountId 认人）却还在，
// 于是明明对局还活着却救不回来，客户端只能弹「当前节点没有可恢复的账号对局」（这条提示在
// public/js/ui/accountObserver.js，任何模式都会遇到；深潜单人局因为能挂 24 小时、玩家更常跨设备回来，
// 所以报告里多半是深潜）。
//
// 现在：先按会话找（能接管在线的那台设备）；找不到就按**座位**接管 —— registry.adopt 用座位上的
// playerId 重建一个会话，客户端拿新 token 重连就回到原来的座位。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { DATA } from './match/harness.js';

// 仓库里的 data/create-room.json 是「关闭」（公开仓库不该默认开放建房），单测要忽略这个维护开关
process.env.SP_GATE_IGNORE = '1';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** 一台「节点」：一个 Lobby + 一个注册表，会话带一个假 socket 用来收帧。 */
function node() {
  const registry = new SessionRegistry();
  const lobby = new Lobby({
    registry, getData: () => DATA, log: quiet,
    MatchClass: class {
      constructor(o) { this.opts = o; this.ended = false; }
      start() {}
      dispose() {}
      onLeave() {}
      onDisconnect() {}
      onReconnect() {}
    },
  });
  const frames = new Map();
  const session = (name, accountId) => {
    const s = registry.create(name);
    Object.assign(s, { connected: true, disconnectedAt: null, guest: false, accountId: accountId || null });
    const box = [];
    frames.set(s.playerId, box);
    s.ws = { readyState: 1, bufferedAmount: 0, send(data) { box.push(JSON.parse(data)); }, terminate() {} };
    return s;
  };
  const framesOf = (s) => frames.get(s.playerId) || [];
  return { registry, lobby, session, framesOf };
}

/** A 开一局（默认深潜单人房：1 真人 + 3 AI，正是玩家反馈的场景），返回房间与 A 的会话。 */
function startedRoom(n, { bots = 3 } = {}) {
  const a = n.session('A', 'acc_1');
  assert.equal(n.lobby.create(a, { mode: 'coop', difficulty: 'ABYSS', variant: 'deepecho' }).ok, true);
  const room = n.lobby.roomOf(a);
  for (let i = 0; i < bots; i++) n.lobby.addBot(a);
  assert.equal(n.lobby.startMatch(room, 'key1').ok, true);
  return { a, room };
}

test('旧设备还连着：B 点恢复对局 → 直接接管那个会话（原路不变）', () => {
  const n = node();
  const { a, room } = startedRoom(n);
  const b = n.session('B', 'acc_1');
  assert.equal(n.lobby.resumeAccount(b)?.ok, true, '要能接管');
  const msg = n.framesOf(b).filter((m) => m.t === 'account.resume').pop();
  assert.ok(msg, 'B 收到 account.resume');
  assert.deepEqual([msg.playerId, msg.roomCode], [a.playerId, room.code]);
  assert.equal(n.registry.byToken(msg.token)?.playerId, a.playerId, 'token 指向原座位');
});

test('旧设备的会话已经没了、座位还在：按座位重建会话接管（以前这里直接失败）', () => {
  const n = node();
  const { a, room } = startedRoom(n);
  const seatPlayerId = a.playerId;
  // 模拟：旧设备关掉超过重连窗口 / 会话被 evict —— 注册表里没有它了，座位还挂在房间里
  n.registry.byPlayerId.delete(seatPlayerId);
  n.registry.byTokenMap.delete(a.token);
  assert.equal(n.registry.byId(seatPlayerId), null, '前提：会话确实没了');
  assert.ok(room.seatOf(seatPlayerId), '前提：座位还在');

  const b = n.session('B', 'acc_1');
  assert.equal(n.lobby.resumeAccount(b)?.ok, true, '要能按座位接管，而不是报「没有可恢复的对局」');
  const msg = n.framesOf(b).filter((m) => m.t === 'account.resume').pop();
  assert.deepEqual([msg.playerId, msg.roomCode], [seatPlayerId, room.code], '还是原来那个座位');
  const rebuilt = n.registry.byToken(msg.token);
  assert.equal(rebuilt?.playerId, seatPlayerId, '重建的会话用座位上的 playerId');
  assert.equal(rebuilt?.roomCode, room.code, '会话挂回房间');
  assert.equal(rebuilt?.accountId, 'acc_1', '账号身份也带回来（再换设备还能认）');
});

test('这台节点上既没有会话也没有座位：如实失败（房间在别的节点 / 对局已结束）', () => {
  const n = node();
  startedRoom(n);
  const other = n.session('C', 'acc_other'); // 另一个账号，没有座位
  const res = n.lobby.resumeAccount(other);
  assert.equal(res?.error, 'BAD_TARGET', '找不到就如实报错，客户端据此提示「去该房间所在节点继续」');
});

test('游客 / 没有账号身份的会话不能恢复', () => {
  const n = node();
  startedRoom(n);
  const guest = n.session('G', null);
  guest.guest = true;
  assert.equal(n.lobby.resumeAccount(guest)?.error, 'BAD_TARGET');
  const anon = n.session('N', null);
  assert.equal(n.lobby.resumeAccount(anon)?.error, 'BAD_TARGET');
});
