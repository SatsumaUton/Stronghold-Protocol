// 重启后「保存中的房间」不该消失（维护者 2026-11-09：「重启以后原本显示保存的房间没有了」）。
//
// 现场（node-1 日志，14 台节点同一个剧本）：
//   00:52:31  [persist] saved lobby read: 1 room(s), 1 session(s)
//   00:52:31  [persist] restored 0 session(s) (1 expired), 1 room(s), 1 match(es)   ← 会话被判过期
//   01:07:31  [lobby]   AXVU 对局无任何在线 session 且已过 15 分钟，回收僵尸房间   ← 正好 +15:00
//
// 两条规则合起来毁掉它：
//   1. restoreLobby 把**所有**会话的恢复窗口一律砍到 30 分钟（早于单人房 24 小时机制的老规则）；
//   2. room.lastHumanLeftAt 没进存档，重启后恒为 0 → sweepOldRooms 的 since 退到 restoredAt
//      → 保存房只剩 15 分钟。
//
// 现在：单人房 / 单人深潜的会话按它自己的 24 小时恢复；lastHumanLeftAt 跟着房间存；
// 保存中的单人房不走 15 分钟 TTL，等到 soloHoldOf 的 until。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { restoreLobby, soloLikeRoomDoc, roomDoc, RESTORED_WINDOW_CAP_MS, SOLO_HOLD_CEILING_MS } from '../../server/persist/lobbyState.js';
import { SessionRegistry } from '../../server/net.js';
import { Lobby } from '../../server/lobby.js';
import { DATA } from '../match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const HOUR = 3600_000;
const MIN = 60_000;

/** 一份最小可恢复的存档：一间房 + 它的会话。 */
function archive(o = {}) {
  const {
    mode = 'coop', variant = 'deepecho', matchLive = true, humans = 1,
    disconnectedAt = 1_800_000_000_000, resumeWindowMs = 24 * HOUR, roomCode = 'ABCD',
  } = o;
  const seats = [];
  for (let i = 0; i < (mode === 'solo' ? 1 : 4); i++) {
    const human = i < humans;
    seats.push({
      seat: i, playerId: human ? `p_${i}` : `ai_${i}`, name: human ? `P${i}` : `AI${i}`, isBot: !human,
      connected: false, ready: false, left: false, accountId: human ? `acc_${i}` : undefined,
    });
  }
  return {
    v: 1,
    sessions: seats.filter((s) => !s.isBot).map((s, i) => ({
      // token 必须各不相同：restoreLobby 会把重复 token 的会话当成 dropped
      playerId: s.playerId, token: String(i + 1).repeat(32).slice(0, 32), name: s.name, roomCode,
      accountId: s.accountId, connected: false, disconnectedAt, resumeWindowMs,
    })),
    rooms: [{
      code: roomCode, mode, difficulty: 'NORMAL', aiPicksLast: false, hostId: 'p_0', capacity: 4,
      version: 'act2autochess', experimental: null, seats,
      matchLive, liveRound: 3, livePhase: 'PREP', matchKey: null, matchCount: 1,
      createdAt: disconnectedAt - HOUR, ttlMs: 15 * MIN, noExpire: false, adminCreated: false,
      ...(variant ? { variant } : {}),
      ...(o.lastHumanLeftAt ? { lastHumanLeftAt: o.lastHumanLeftAt } : {}),
      // 没开局就没有 match 记录（`matchLive` 跟着它）
      ...(matchLive ? { match: { kind: 'local', id: 'L.ABCD.1.x', round: 3, seed: 1 } } : {}),
    }],
  };
}

function freshLobby(now) {
  const registry = new SessionRegistry({ now });
  const lobby = new Lobby({
    registry, getData: () => DATA, log: quiet, now,
    MatchClass: class { constructor(o) { this.opts = o; } start() {} dispose() {} onLeave() {} onDisconnect() {} onReconnect() {} },
  });
  return { registry, lobby };
}

test('soloLikeRoomDoc：单人 / 单人深潜 / 1 真人 + AI 都算，两真人或多则不算', () => {
  assert.equal(soloLikeRoomDoc(archive({ mode: 'solo' }).rooms[0]), true, '单人房');
  assert.equal(soloLikeRoomDoc(archive({ variant: 'deepecho', humans: 1 }).rooms[0]), true, '单人深潜（1 真人 + 3 AI）');
  assert.equal(soloLikeRoomDoc(archive({ variant: null, humans: 1 }).rooms[0]), true, '1 真人 + 3 AI 的同盟房');
  assert.equal(soloLikeRoomDoc(archive({ variant: null, humans: 2 }).rooms[0]), false, '两个真人不是单人房');
  assert.equal(soloLikeRoomDoc(archive({ matchLive: false }).rooms[0]), false, '没开局的房间没拿过 24 小时窗口');
  assert.equal(soloLikeRoomDoc(null), false);
});

test('restoreLobby：单人深潜的会话按 24 小时恢复，不再被砍到 30 分钟', () => {
  const now = 1_800_000_000_000 + 2 * HOUR;             // 关掉页面两小时后重启
  const { registry, lobby } = freshLobby(now);
  const out = restoreLobby({ doc: archive({ disconnectedAt: 1_800_000_000_000 }), registry, lobby, now, log: quiet });
  assert.equal(out.sessions, 1, '会话要恢复（以前这里是 0，日志 `restored 0 session(s) (1 expired)`）');
  assert.equal(out.expired, 0, '不能判过期');
  const s = registry.byId('p_0');
  assert.ok(s, '会话在');
  assert.equal(s.resumeWindowMs, 24 * HOUR, '窗口仍是 24 小时');
  assert.equal(out.rooms, 1, '房间也恢复了');
});

test('restoreLobby：普通房的会话仍然只给 30 分钟（老规则保留）', () => {
  const now = 1_800_000_000_000 + 2 * HOUR;
  const { registry, lobby } = freshLobby(now);
  const out = restoreLobby({
    doc: archive({ variant: null, humans: 2, disconnectedAt: 1_800_000_000_000 }), registry, lobby, now, log: quiet,
  });
  assert.equal(out.expired, 2, '普通房两个会话都过期');
  assert.equal(out.sessions, 0);

  // 30 分钟以内还是能恢复
  const now2 = 1_800_000_000_000 + 10 * MIN;
  const h2 = freshLobby(now2);
  const out2 = restoreLobby({
    doc: archive({ variant: null, humans: 2, disconnectedAt: 1_800_000_000_000 }), registry: h2.registry, lobby: h2.lobby, now: now2, log: quiet,
  });
  assert.equal(out2.sessions, 2, '10 分钟内照常恢复');
  assert.equal(h2.registry.byId('p_0').resumeWindowMs, RESTORED_WINDOW_CAP_MS, '封顶 30 分钟');
});

test('restoreLobby：上限仍是 24 小时（存档里的怪值不会变成无限期）', () => {
  const now = 1_800_000_000_000 + 2 * HOUR;
  const { registry, lobby } = freshLobby(now);
  restoreLobby({ doc: archive({ resumeWindowMs: 1000 * HOUR }), registry, lobby, now, log: quiet });
  assert.equal(registry.byId('p_0').resumeWindowMs, SOLO_HOLD_CEILING_MS, '封顶 24 小时');
});

test('roomDoc 存 lastHumanLeftAt，重启后房间拿得回来', () => {
  const src = roomDoc(archive().rooms[0] && {
    code: 'ABCD', mode: 'coop', variant: 'deepecho', difficulty: 'NORMAL', hostId: 'p_0', capacity: 4,
    version: 'act2autochess', experimental: null, seats: [], spectators: [], content: null,
    match: {}, lastHumanLeftAt: 1_700_000_000_000, createdAt: 1, ttlMs: 15 * MIN, noExpire: false, adminCreated: false,
    activeHumans: () => [], spectatorLimit: () => 0, liveRound: 1, livePhase: 'PREP', matchCount: 1,
  }, () => null, () => null);
  assert.equal(src.lastHumanLeftAt, 1_700_000_000_000, 'roomDoc 要带上这个时间戳');

  // 没有这个时间戳时不写键（普通房间的存档逐字节不变）
  const noAt = roomDoc({
    code: 'ABCD', mode: 'coop', variant: 'deepecho', difficulty: 'NORMAL', hostId: 'p_0', capacity: 4,
    version: 'act2autochess', experimental: null, seats: [], spectators: [], content: null,
    match: {}, lastHumanLeftAt: 0, createdAt: 1, ttlMs: 15 * MIN, noExpire: false, adminCreated: false,
    activeHumans: () => [], spectatorLimit: () => 0, liveRound: 1, livePhase: 'PREP', matchCount: 1,
  }, () => null, () => null);
  assert.equal(Object.hasOwn(noAt, 'lastHumanLeftAt'), false, '0 不写键');
});

test('restoreLobby：恢复出来的房间带着 lastHumanLeftAt（sweepOldRooms 的 since 才对）', () => {
  const now = 1_800_000_000_000 + 2 * HOUR;
  const leftAt = 1_800_000_000_000 + 2 * HOUR - 3 * HOUR;   // 三小时前走的
  const { registry, lobby } = freshLobby(now);
  const out = restoreLobby({ doc: archive({ lastHumanLeftAt: leftAt }), registry, lobby, now, log: quiet });
  assert.equal(out.rooms, 1);
  const room = lobby.rooms.get('ABCD');
  assert.ok(room);
  assert.equal(room.lastHumanLeftAt, leftAt, '房间记得最后一个真人是什么时候走的');
});

test('sweepOldRooms：保存中的单人房不按 15 分钟 TTL 回收，等它的 24 小时', () => {
  let t = 1_800_000_000_000;
  const now = () => t;
  const { registry, lobby } = freshLobby(now);
  const leftAt = t;                                  // 玩家此刻关掉页面
  const out = restoreLobby({ doc: archive({ disconnectedAt: leftAt, lastHumanLeftAt: leftAt }), registry, lobby, now: t, log: quiet });
  assert.equal(out.rooms, 1);
  const room = lobby.rooms.get('ABCD');
  // 对局由 persister 在建房之后接着恢复（restoreLocal → startMatch）；这里只要 room.match 在，
  // sweepOldRooms 就会走「对局房」那条分支
  room.match = { stub: true };
  assert.ok(room.match, '对局恢复了');

  // 把会话拿掉，模拟「重启后会话丢了」—— 房间只剩 lastHumanLeftAt
  for (const s of [...registry.all()]) registry.remove(s);
  assert.equal(registry.byId('p_0'), null, '会话确实没了');

  // 15 分钟 + 1 分钟：老规则会在这里回收
  t = leftAt + 16 * MIN;
  lobby.sweepOldRooms();
  assert.notEqual(room.disposed, true, '不能因为「过了 15 分钟」就回收保存中的单人房');

  // 23 小时后仍然在
  t = leftAt + 23 * HOUR;
  lobby.sweepOldRooms();
  assert.notEqual(room.disposed, true, '24 小时之内都要留着');

  // 过了 24 小时才回收
  t = leftAt + 25 * HOUR;
  lobby.sweepOldRooms();
  assert.equal(room.disposed, true, '过了 24 小时才回收');
});

test('sweepOldRooms：普通房（不是保存中的单人房）仍然 15 分钟回收', () => {
  let t = 1_800_000_000_000;
  const now = () => t;
  const { registry, lobby } = freshLobby(now);
  const leftAt = t;
  restoreLobby({ doc: archive({ variant: null, humans: 2, disconnectedAt: leftAt, lastHumanLeftAt: leftAt }), registry, lobby, now: t, log: quiet });
  const room = lobby.rooms.get('ABCD');
  room.match = { stub: true };
  for (const s of [...registry.all()]) registry.remove(s);
  t = leftAt + 16 * MIN;
  lobby.sweepOldRooms();
  assert.equal(room.disposed, true, '普通房维持原样（15 分钟僵尸房回收）');
});
