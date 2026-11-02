// 隐身观战（adminWatch，管理员功能）的 room.state 标记 —— 回归测试。
//
// 隐身观战者（lobby.spectate { hidden: true }）不进 seats、也不进 spectators，
// 所以前端过去分不清它和「普通玩家」：直接按玩家界面渲染，看起来跟自己玩时一样，
// 但服务端把它的 g.* 全部拦掉 —— 管理员看到的就是「只能看不能动」。
//
// 修法：Room.toState 多接一个「看的人」，是隐身观战者时带上 hiddenWatch: true。
// 这个标记**只能发给本人**：
//   · sendState（单播）按会话编码，天然只到本人；
//   · broadcastState（广播）平时仍是一份字节发所有人，只有房间里真有隐身观战者时
//     才改成逐会话编码 —— 否则普通房间的 room.state 会无谓地变成 N 份。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
/** ws.OPEN：sendRaw 认的就是这个值（server/net.js 里没把它导出）。 */
const WS_OPEN = 1;

/** 一个能收帧的假 socket：sendRaw 只要求 readyState / bufferedAmount / send。 */
function fakeWs() {
  return {
    readyState: WS_OPEN,
    bufferedAmount: 0,
    frames: [],
    send(data) { this.frames.push(data); },
    terminate() {},
    close() {},
  };
}

/** 建一个合作房，返回 { lobby, registry, room, sessions }。 */
function setup({ capacity = 4, hidden = 0 } = {}) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: silent });
  const host = registry.create('Host');
  // 游客不能建房（lobby.create 的游客门禁），给个账号身份
  host.accountId = 'acc_host';
  host.connected = true;
  host.ws = fakeWs();
  assert.deepEqual(lobby.create(host, {
    mode: 'coop', difficulty: 'NORMAL',
    experimental: { revivalEnabled: false, disableSharedPool: false, playerCapacity: capacity },
  }), { ok: true });
  const room = lobby.roomOf(host);
  host.roomCode = room.code;
  const seats = [host];
  const hiddenSessions = [];
  for (let i = 0; i < hidden; i += 1) {
    const s = registry.create('Watcher' + i);
    s.connected = true;
    s.ws = fakeWs();
    s.roomCode = room.code;
    // 直接登记进 hiddenSpectators：这里只测 state 的分发，adminToken 的校验另有覆盖
    room.hiddenSpectators.push({ playerId: s.playerId, name: s.name, connected: true });
    hiddenSessions.push(s);
  }
  return { lobby, registry, room, seats, hiddenSessions };
}

/** 一帧 room.state 的 JSON 负载（假 socket 收到的是编码后的字符串）。 */
const stateOf = (ws) => JSON.parse(ws.frames[ws.frames.length - 1]);

// ---------------------------------------------------------------- toState 的语义

test('toState：隐身观战者拿到的 state 带 hiddenWatch，座位和默认调用都不带', () => {
  const { room, seats, hiddenSessions } = setup({ hidden: 1 });
  const hiddenId = hiddenSessions[0].playerId;

  assert.equal(room.toState().hiddenWatch, undefined, '不指定看的人 → 没有这个键（默认房间逐字节不变）');
  assert.equal(room.toState(Date.now(), seats[0].playerId).hiddenWatch, undefined, '座位玩家拿不到');
  assert.equal(room.toState(Date.now(), hiddenId).hiddenWatch, true, '隐身观战者拿得到');
  // 除了这个键，两种视角的内容完全一样：标记不是「另一套 state」
  const a = room.toState(Date.now(), seats[0].playerId);
  const b = room.toState(Date.now(), hiddenId);
  assert.deepEqual({ ...b, hiddenWatch: undefined }, { ...a, hiddenWatch: undefined });
});

test('toState：普通观战席（spectators）不靠这个标记，仍然只在 spectators 列表里', () => {
  const { room, registry } = setup();
  const watcher = registry.create('Watcher');
  watcher.connected = true;
  room.spectators.push({ playerId: watcher.playerId, name: watcher.name, connected: true });
  const st = room.toState(Date.now(), watcher.playerId);
  assert.equal(st.hiddenWatch, undefined, '普通观战不误判成隐身观战');
  assert.ok(st.spectators.some((s) => s.playerId === watcher.playerId), '它在 spectators 里');
});

// ---------------------------------------------------------------- 单播

test('sendState：hiddenWatch 只发给那个隐身观战者，座位玩家收到的 state 没有它', () => {
  const { lobby, room, seats, hiddenSessions } = setup({ hidden: 1 });
  lobby.sendState(room, seats[0]);
  lobby.sendState(room, hiddenSessions[0]);
  assert.equal(stateOf(seats[0].ws).hiddenWatch, undefined);
  assert.equal(stateOf(hiddenSessions[0].ws).hiddenWatch, true);
});

// ---------------------------------------------------------------- 广播

test('broadcastState：房间里有隐身观战者时逐会话编码，标记不外泄', () => {
  const { lobby, room, seats, hiddenSessions } = setup({ hidden: 1 });
  lobby.broadcastState(room);
  assert.equal(stateOf(seats[0].ws).hiddenWatch, undefined, '座位玩家不该看到这个标记');
  assert.equal(stateOf(hiddenSessions[0].ws).hiddenWatch, true, '隐身观战者要看到');
  assert.notEqual(seats[0].ws.frames.at(-1), hiddenSessions[0].ws.frames.at(-1), '两份帧内容不同');
});

test('broadcastState：没有隐身观战者时仍旧一份字节发所有人（快路径没被改坏）', () => {
  const { lobby, room, seats, registry } = setup();
  const mate = registry.create('Mate');
  mate.connected = true;
  mate.ws = fakeWs();
  mate.roomCode = room.code;
  // 让第二个会话真正坐进房间：直接借 addBot 之后的座位表不方便，用 spectators 更简单
  room.spectators.push({ playerId: mate.playerId, name: mate.name, connected: true });

  lobby.broadcastState(room);
  const a = seats[0].ws.frames.at(-1);
  const b = mate.ws.frames.at(-1);
  assert.equal(a, b, '两个人收到的是同一份编码结果');
  assert.equal(JSON.parse(a).hiddenWatch, undefined);
});
