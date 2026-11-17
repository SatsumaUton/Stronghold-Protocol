// 宿主房间（规程 / 一期 / 二期 / 插件房）里 ps.admin 同步不到 worker —— 维护者 2026-11-18
// 「已经认证但是显示没有权限使用」。
//
// 链路：
//   server/lobby.js onHello 的同步是
//       if (room.match && room.match.players?.get) { …ps.admin = wantTool… }
//   而宿主房间的 room.match 是 **MatchProxy**，它没有 `players` → 整段被跳过
//   → worker 里的 PlayerState.admin 永远停在建局那一刻
//   → applyTestCommand 的第一道门 `!(ps && ps.admin === true)` → TEST_FORBIDDEN
//   → 前端 welcome.adminTools 已是 true（连接本身是管理员），面板显示「验码已生效」却点不动。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../../server/match/Match.js';
import { MatchProxy } from '../../server/match/host/proxy.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { DATA } from './harness.js';

process.env.SP_GATE_IGNORE = '1';
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const seats = () => [
  { seat: 0, playerId: 'p_host', name: 'H', isBot: false, connected: true },
  { seat: 1, playerId: 'p_guest', name: 'G', isBot: false, connected: true },
  { seat: 2, playerId: 'ai_0', name: 'AI', isBot: true, connected: true },
  { seat: 3, playerId: 'ai_1', name: 'AI', isBot: true, connected: true },
];

const make = (extra = {}) => {
  const m = new Match({
    roomCode: 'RT', mode: 'coop', difficulty: 'NORMAL', modeId: 'mode_multi_normal',
    seats: seats(), spectators: [], seed: 5, matchNo: 1, data: DATA, log: quiet, botRehearsal: 0,
    hostId: 'p_host', send: () => true, broadcast: () => {}, onEnd: () => {},
    ...extra,
  });
  m.start();
  return m;
};

test('Match.setAdmin 把标记写进座位；未知 playerId 静默成功', (t) => {
  const m = make();
  t.after(() => m.dispose?.());
  const ps = m.players.get('p_guest');
  assert.equal(ps.admin, false, '建局时不是管理员');
  assert.deepEqual(m.setAdmin('p_guest', true, true), { ok: true });
  assert.equal(ps.admin, true, '★ 兑码后要能把「能改数据」推到座位');
  assert.equal(ps.adminId, true, '身份门也要同步（免惩罚判定读它）');
  // 降级同样生效
  assert.deepEqual(m.setAdmin('p_guest', false, false), { ok: true });
  assert.equal(ps.admin, false);
  assert.equal(ps.adminId, false);
  // 不在这一局 / 已离开：静默，不抛
  assert.deepEqual(m.setAdmin('nobody', true, true), { ok: true });
});

test('兑码后房主真的能下命令（普通房，靠 ps.admin 放行）', (t) => {
  const m = make();
  t.after(() => m.dispose?.());
  m.toPrep?.();
  const ps = m.players.get('p_host');
  // 建局时 seat.admin 没带 → ps.admin false → TEST_FORBIDDEN
  assert.equal(ps.admin, false);
  const before = m.applyTestCommand(ps, { cmd: 'funds', args: { amount: 50 } });
  assert.equal(before.error, 'TEST_FORBIDDEN', '这就是玩家看到的那句「没有使用权限」');
  // 同步之后就能用
  m.setAdmin('p_host', true, true);
  const after = m.applyTestCommand(ps, { cmd: 'funds', args: { amount: 50 } });
  assert.equal(after.ok, true, '★ 同步成功之后同一条指令必须通过');
});

test('MatchProxy.setAdmin 会 post 一条 call 给宿主', () => {
  const posts = [];
  const proxy = new MatchProxy({ host: { post: (m) => posts.push(m) }, matchId: 'x', opts: { roomCode: 'ABCD', mode: 'coop' } });
  proxy.setAdmin('p_1', true, false);
  const last = posts.at(-1);
  assert.equal(last.type, 'call');
  assert.equal(last.method, 'setAdmin');
  assert.deepEqual(last.args, ['p_1', true, false], 'admin / adminId 都按布尔值传，别把 undefined 带过去');
  assert.equal(last.id, undefined, '通知不需要回执');
});

test('lobby.onHello 在宿主房间（match 没有 players）走 setAdmin', (t) => {
  const calls = [];
  // 一个「像 MatchProxy 一样没有 players」的对局对象
  class ProxyLike {
    constructor() { this.hostId = 'p_host'; }
    start() {}
    dispose() {}
    setAdmin(playerId, admin, adminId) { calls.push([playerId, admin, adminId]); }
  }
  const registry = new SessionRegistry();
  const lobby = new Lobby({
    registry,
    MatchClass: ProxyLike,
    getData: () => DATA,
    log: quiet,
    content: { cs: 'a0'.repeat(32) },
    options: { testMode: 'off' },
  });
  t.after(() => lobby.shutdown());

  const s = registry.create('admin-user');
  s.connected = true;
  s.accountId = `acc_${s.playerId}`;
  s.guest = false;
  s.adminId = true;
  s.gameTool = true;
  s.adminTool = true;
  s.admin = true;

  lobby.create(s, { mode: 'coop', difficulty: 'NORMAL' });
  const room = lobby.roomOf(s);
  room.match = new ProxyLike();          // 模拟「宿主房间」：match 是代理，没有 players
  assert.equal(room.match.players, undefined, '前提：宿主代理由没有 players');

  calls.length = 0;
  lobby.onHello(s, { resumed: true, repeat: true });
  assert.ok(calls.length > 0, '★ 宿主房间必须经 setAdmin 把标记推进去（否则 worker 里永远是旧的）');
  assert.equal(calls.at(-1)[0], s.playerId);
  assert.equal(calls.at(-1)[1], true, 'admin = 三道门全过');
  assert.equal(calls.at(-1)[2], true, 'adminId = 身份门');
});

test('层数上限：普通房间开「禁用层数上限」才到 1e9，没开仍然 999', (t) => {
  const bondId = Object.keys(DATA.bonds)[0];

  const capped = make();
  t.after(() => capped.dispose?.());
  capped.setAdmin('p_host', true, true);
  const r1 = capped.applyTestCommand(capped.players.get('p_host'), { cmd: 'bond', args: { id: bondId, layers: 1000 } });
  assert.equal(r1.error, 'BAD_TARGET', '★ 没开实验功能 → 1000 层被拒');
  assert.match(r1.detail || '', /max":999/, '拒绝要带真实上限 999');

  const uncapped = make({ experimental: { revivalEnabled: false, disableSharedPool: false, disableLayerCap: true } });
  t.after(() => uncapped.dispose?.());
  uncapped.setAdmin('p_host', true, true);
  assert.equal(uncapped.layerCapOff, true, '开了实验功能 → layerCapOff');
  const r2 = uncapped.applyTestCommand(uncapped.players.get('p_host'), { cmd: 'bond', args: { id: bondId, layers: 1e9 } });
  assert.equal(r2.ok, true, '★ 开了实验功能 → 管理员能一路改到 1e9');
});
