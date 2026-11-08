// 墓碑的端到端验证：真的建一间房、真的回收它，然后从墓碑里把它救回来。
//
// 这是 2026-11-09 那次事故的复现 + 兜底：15 间「保存中的单人深潜」被误回收，Redis 里真删除、
// 没有 AOF / 从库 / 快照可回滚。墓碑让下一次还能救回来。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CheckpointStore } from '../../server/persist/store.js';
import { LobbyPersister } from '../../server/persist/persister.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { restoreLobby } from '../../server/persist/lobbyState.js';
import { DATA } from '../match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const HOUR = 3600_000;

/** 只实现 store.js 用到的那几个命令的假 Redis（带 TTL、哈希、KEYS）。 */
function fakeStore() {
  const values = new Map();   // key → { bytes, ttl }
  const hashes = new Map();   // key → Map(field → text)
  const client = {
    ready: true, stats: {},
    async command(name, ...args) {
      switch (name) {
        case 'SET': values.set(args[0], { bytes: args[1], ttl: Number(args[3]) }); return 'OK';
        case 'GET': return values.get(args[0])?.bytes ?? null;
        case 'DEL': return values.delete(args[0]) ? 1 : 0;
        case 'HSET': {
          const m = hashes.get(args[0]) || new Map();
          for (let i = 1; i + 1 < args.length; i += 2) m.set(args[i], args[i + 1]);
          hashes.set(args[0], m);
          return 1;
        }
        case 'HGETALL': { const m = hashes.get(args[0]); return m ? [...m].flat() : []; }
        case 'HDEL': { const m = hashes.get(args[0]); if (m) for (const f of args.slice(1)) m.delete(f); return 1; }
        case 'PEXPIRE': { const v = values.get(args[0]); if (v) v.ttl = Number(args[1]); return 1; }
        case 'KEYS': {
          const re = new RegExp('^' + String(args[0]).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
          return [...values.keys()].filter((k) => re.test(k));
        }
        default: return null;
      }
    },
    async close() {},
  };
  return { client, values, hashes };
}

/** 一间开工的单人深潜房 + 一个已断线的座位。 */
function setup() {
  let t = 1_800_000_000_000;
  const now = () => t;
  const registry = new SessionRegistry({ now });
  const { client, values, hashes } = fakeStore();
  const store = new CheckpointStore({ url: 'redis://x', client, log: quiet });
  const lobby = new Lobby({
    registry, getData: () => DATA, log: quiet, now,
    MatchClass: class { constructor(o) { this.opts = o; this.seed = 12345; this.round = 3; this.phase = 'PREP'; } start() {} dispose() {} onLeave() {} onDisconnect() {} onReconnect() {} },
  });
  const persister = new LobbyPersister({ store, registry, lobby, log: quiet, saveMs: 10_000, now, restoreWaitMs: 0 });
  const p = registry.create('P');
  Object.assign(p, { guest: false, accountId: 'acc_P', adminId: true, connected: true });
  assert.deepEqual(lobby.create(p, { mode: 'coop', difficulty: 'NORMAL', variant: 'deepecho' }), { ok: true });
  const room = lobby.roomOf(p);
  lobby.addBot(p);
  lobby.startMatch(room, 'k1');
  return { lobby, registry, persister, store, room, values, hashes, client, advance: (ms) => { t += ms; }, get t() { return t; } };
}

test('回收一间开工的深潜房 → 墓碑里有房间文档 + 检查点 → 能写回去再恢复出来', async () => {
  const h = setup();
  const code = h.room.code;
  const playerId = h.room.seats.find((s) => s && !s.isBot).playerId;

  // 先让它落一次盘（正常流程），这样 checkpoints / rooms 都在
  await h.persister.flush('tick');

  // stub Match 抓不出真快照（snapshotMatch 只认真的 Match），这里直接塞一条「上一次安全点抓到的检查点」，
  // 模拟线上「对局跑到中途、检查点已经写过好几次」的状态 —— 墓碑要做的是把它一起带走。
  const cpId = `L.${code}.1.2n9s`;
  const cpJson = JSON.stringify({ v: 1, kind: 'local', room: code, matchNo: 1, seed: 12345, reason: 'prep-end', match: { stub: true } });
  h.persister.matches.set(h.room.match, { id: cpId, seed: 12345, matchNo: 1, room: code, json: cpJson, pending: null });
  assert.equal(await h.store.saveCheckpoint(cpId, cpJson), true);

  // 回收（模拟「被当僵尸房」）：钩子在这一刻写墓碑
  h.lobby.disposeRoom(h.room, 'expired');
  // 钩子是同步调用、内部 void 了 promise —— 让微任务跑完
  await new Promise((r) => setTimeout(r, 20));

  const tomb = await h.store.loadTombstone(code);
  assert.equal(tomb.ok, true);
  assert.ok(tomb.value, '墓碑要写出来');
  assert.equal(tomb.value.reason, 'expired', '带上回收原因');
  assert.ok(tomb.value.room, '墓碑里要有房间文档（不只是时间与原因）');
  assert.equal(tomb.value.room.code, code);
  assert.equal(tomb.value.room.variant, 'deepecho', '深潜标记要在');
  assert.equal(tomb.value.checkpoint != null, true, '开工的房要带检查点');

  // 墓碑 TTL 是 24 小时（不是普通键的 25 小时）
  const ttl = h.values.get(`sp:tomb:${code}`)?.ttl;
  assert.equal(ttl, 24 * HOUR);

  // 现在照 tools/restore-room.mjs 的做法写回去
  assert.equal(await h.store.hashUpdate('lobby:rooms', [[code, JSON.stringify(tomb.value.room)]]), true);
  if (tomb.value.checkpoint) assert.equal(await h.store.saveCheckpoint(tomb.value.checkpoint.id, tomb.value.checkpoint.json), true);

  // 一个全新的 Lobby（模拟重启后）：从写回去的文档恢复
  const registry2 = new SessionRegistry({ now: () => h.t });
  const lobby2 = new Lobby({
    registry: registry2, getData: () => DATA, log: quiet, now: () => h.t,
    MatchClass: class { constructor(o) { this.opts = o; } start() {} dispose() {} onLeave() {} onDisconnect() {} onReconnect() {} },
  });
  const rooms = await h.store.hashRead('lobby:rooms');
  const sessions = await h.store.hashRead('lobby:sessions');
  assert.equal(rooms.ok, true);
  const doc = {
    v: 1, kind: 'local',
    sessions: [...sessions.value.values()],
    rooms: [...rooms.value.values()],
  };
  const out = restoreLobby({ doc, registry: registry2, lobby: lobby2, now: h.t, log: quiet });
  assert.equal(out.ok, true);
  assert.equal(out.rooms, 1, '房间救回来了');
  const back = lobby2.rooms.get(code);
  assert.ok(back, '房号对得上');
  assert.equal(back.variant, 'deepecho', '深潜标记也回来了');
  assert.ok(back.seatOf(playerId) || back.seats.some((s) => s && !s.isBot), '座位还在');
});

test('没有开工的房间：墓碑也写（只有文档没有检查点），照样能救回房间', async () => {
  let t = 1_800_000_000_000;
  const now = () => t;
  const registry = new SessionRegistry({ now });
  const { client } = fakeStore();
  const store = new CheckpointStore({ url: 'redis://x', client, log: quiet });
  const lobby = new Lobby({ registry, getData: () => DATA, log: quiet, now, MatchClass: class { constructor(o) { this.opts = o; } start() {} dispose() {} } });
  const persister = new LobbyPersister({ store, registry, lobby, log: quiet, now, restoreWaitMs: 0 });
  const p = registry.create('P');
  Object.assign(p, { guest: false, accountId: 'acc_P', adminId: true, connected: true });
  lobby.create(p, { mode: 'coop', difficulty: 'NORMAL', variant: 'deepecho' });
  const room = lobby.roomOf(p);
  assert.equal(room.match, null, '还没开局');

  lobby.disposeRoom(room, 'empty');
  await new Promise((r) => setTimeout(r, 20));
  const tomb = await store.loadTombstone(room.code);
  assert.ok(tomb.value, '没开局的房也留墓碑');
  assert.equal(tomb.value.checkpoint, null, '没有检查点');
  assert.ok(tomb.value.room, '但房间文档要在');
});
