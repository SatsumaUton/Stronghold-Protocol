// 单人房的「24 小时保存」判据（维护者 2026-11-08）：
//
//   **房间里只有一个真人**就算单人房 —— 1 真人 + 3 个 AI 队友、1 真人不带 AI、大厅单人房、
//   「深渊回响」单人房（`mode:'coop'` + `variant:'deepecho'`）都是；两个真人就不是。
//
// 用途是掉线后的重连窗口（lobby.soloResumeWindowMs = 官方 constants.singleReconnectTime = 24 h）。
// 历史：2026-11-07 只认 `mode === 'solo'` 和深潜房，于是「1 真人 + 3 AI」的同盟房掉线后走 15 分钟
// 普通窗口，一到点座位被释放、对局以 abandoned 结束 —— 24 小时保存对它们不生效。
//
// 这里同时钉住窗口链路：掉线 → 会话拿 24 h 窗口 → 两小时后 sweepOldRooms 不回收房间/座位 →
// 窗口到期 onExpire 才释放座位并通知对局 onLeave（据以 abandoned 结算）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { DATA } from './match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * A lobby with a controllable clock and a stub match.
 * @param {{ mode?: string, variant?: string|null, bots?: number, onLeave?: (pid: string) => void }} [o]
 */
function harness({ mode = 'coop', variant = null, bots = 0, onLeave = () => {} } = {}) {
  let t = 1_800_000_000_000;
  const now = () => t;
  const registry = new SessionRegistry({ now });
  const lobby = new Lobby({
    registry, getData: () => DATA, log: quiet, now,
    MatchClass: class {
      constructor(o) { this.opts = o; this.ended = false; }
      start() {}
      dispose() {}
      onLeave(pid) { onLeave(pid); }
      onDisconnect() {}
      onReconnect() {}
    },
  });
  const host = registry.create('H');
  Object.assign(host, { guest: false, accountId: 'acc_host', adminId: true, connected: true });
  const made = lobby.create(host, { mode, difficulty: 'NORMAL', ...(variant ? { variant } : {}) });
  assert.equal(made.ok, true, `建房失败：${JSON.stringify(made)}`);
  const room = lobby.roomOf(host);
  for (let i = 0; i < bots; i++) lobby.addBot(host);
  assert.equal(lobby.startMatch(room, 'key1').ok, true, '开局要成功');
  return { lobby, registry, host, room, advance: (ms) => { t += ms; } };
}

/** 第二个真人（直接塞进座位，不经过网络） */
function addSecondHuman(room) {
  room.seats[1] = { ...room.seats[0], seat: 1, playerId: 'p_two', name: 'T', isBot: false, left: false, connected: true };
}

test('判据：只有一个真人就是单人房 —— 1 真人 + 3 AI、不带 AI、单人房、单人深潜都算', () => {
  const cases = [
    ['1 真人不带 AI', { bots: 0 }],
    ['1 真人 + 3 AI', { bots: 3 }],
    ['大厅单人房', { mode: 'solo' }],
    ['深渊回响 1 真人 + 3 AI', { variant: 'deepecho', bots: 3 }],
  ];
  for (const [label, opts] of cases) {
    const h = harness(opts);
    assert.equal(h.room.activeHumans().length, 1, `${label}：只有一个真人座位`);
    assert.equal(h.lobby.soloLikeRun(h.room), true, `${label} 要算单人房`);
  }
});

test('判据看**当前**还有几个真人：另一个真人永久离开后就按单人房算', () => {
  const h = harness({ bots: 0 });
  addSecondHuman(h.room);
  assert.equal(h.lobby.soloLikeRun(h.room), false, '2 真人');
  h.room.seats[1].left = true; // 另一个真人永久离开
  assert.equal(h.lobby.soloLikeRun(h.room), true, '只剩一个真人 → 单人房（他一个人不该丢局）');
});

test('掉线：1 真人 + 3 AI 的同盟房拿 24 小时窗口；两个真人都离线时只拿普通窗口', () => {
  const solo = harness({ bots: 3 });
  solo.host.connected = false;
  solo.lobby.onDisconnect(solo.host);
  assert.equal(solo.host.resumeWindowMs, solo.lobby.soloResumeWindowMs(solo.room), '窗口 = 单人那一档');
  assert.ok(solo.host.resumeWindowMs >= 24 * 3600_000 - 60_000, '至少 24 小时');
  assert.ok(solo.room.seatOf(solo.host.playerId), '座位还在');

  // 两个真人都离线：谁也不是「一个人在打」，走 registry 的普通窗口（15 分钟）
  const duo = harness({ bots: 0 });
  addSecondHuman(duo.room);
  duo.room.seats[1].connected = false;
  duo.host.connected = false;
  duo.lobby.onDisconnect(duo.host);
  assert.equal(duo.host.resumeWindowMs, null, '普通窗口（registry 默认 15 分钟）');
});

test('两小时后 sweepOldRooms 不回收单人房：会话还在走 24 小时窗口', () => {
  const h = harness({ bots: 3 });
  h.host.connected = false;
  h.lobby.onDisconnect(h.host);
  h.advance(2 * 3600_000);
  h.lobby.sweepOldRooms();
  assert.notEqual(h.room.disposed, true, '房间还在');
  assert.ok(h.room.match, '对局还在（回来能接着打）');
  assert.ok(h.room.seatOf(h.host.playerId), '座位还在');
});

test('24 小时到期才释放：onExpire → 座位离开 + 对局 onLeave（据以 abandoned 结算）', () => {
  const left = [];
  const h = harness({ bots: 3, onLeave: (pid) => left.push(pid) });
  h.host.connected = false;
  h.lobby.onDisconnect(h.host);
  h.advance(25 * 3600_000);
  h.lobby.onExpire(h.host);
  assert.deepEqual(left, [h.host.playerId], '对局收到 onLeave');
});
