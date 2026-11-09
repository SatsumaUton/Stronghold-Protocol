// 重启节点**不会**再把存档里的房间删掉（维护者 2026-11-10：「我现在重启所有节点不会再把保存的房间删除了吧」）。
//
// 关闭路径上有两个坑，这里逐条钉住：
//
// ① 顺序：`server/index.js` 的 `close()` 以前是 `lobby.shutdown()` → `persistence.close()`。
//    `close()` 只停定时器**不 flush**，所以正常情况没事；但只要有一轮 `flush('tick')` 正在飞
//    （10 秒定时器刚好触发、store 又慢），它会在房间被 dispose 之后才跑到 `writeLobby()` ——
//    那一刻 `lobby.rooms` 是空的，`goneRooms` 就是「全部房间」，Redis 里的存档被整批删掉。
//    实测（store 延迟 80ms）：`lobby:rooms 1 → 0`。重启 30 个节点 = 30 次抽奖。
//
// ② 修法：
//    * `persister.stopping` 一旦置位：定时 tick 不再起飞；`writeLobby()` 不删任何房间 / 会话
//      （宁可留一条陈旧记录让 `sweepOldRooms` 按 TTL 清，也不能在关闭窗口里删活的）；
//    * `index.js` 改成「先 `persistence.shutdown()`（房间还活着，最后一轮完整落盘）→ 再 `lobby.shutdown()`
//      → 最后 `close()`」，与 persister 头注释里写的设计一致；
//    * `shutdown()` 会先等在飞的那轮结束，再落自己这轮。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CheckpointStore } from '../../server/persist/store.js';
import { LobbyPersister } from '../../server/persist/persister.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { restoreLobby, LOBBY_DOC_VERSION } from '../../server/persist/lobbyState.js';
import { DATA } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** 只实现 store.js 用到的那几个命令的假 Redis；`delayMs` 模拟慢网络（让 flush 在飞）。 */
function fakeStore(delayMs = 0) {
  const hashes = new Map();
  const values = new Map();
  const client = {
    ready: true, stats: {},
    async command(name, ...args) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      switch (name) {
        case 'SET': values.set(args[0], args[1]); return 'OK';
        case 'GET': return values.get(args[0]) ?? null;
        case 'DEL': return values.delete(args[0]) ? 1 : 0;
        case 'HSET': {
          const m = hashes.get(args[0]) || new Map();
          for (let i = 1; i + 1 < args.length; i += 2) m.set(args[i], args[i + 1]);
          hashes.set(args[0], m);
          return 1;
        }
        case 'HGETALL': { const m = hashes.get(args[0]); return m ? [...m].flat() : []; }
        case 'HDEL': { const m = hashes.get(args[0]); if (m) for (const f of args.slice(1)) m.delete(f); return 1; }
        case 'PEXPIRE': return 1;
        case 'KEYS': return [...values.keys()];
        default: return null;
      }
    },
    async close() {},
  };
  return { client, hashes, values };
}

/** 一间开工的单人深潜房（按真实路径建：create → addBot → startMatch）。 */
async function setup(delayMs = 0) {
  const registry = new SessionRegistry();
  const { client, hashes } = fakeStore(delayMs);
  const store = new CheckpointStore({ url: 'redis://x', client, log: quiet });
  const lobby = new Lobby({
    registry, getData: () => DATA, log: quiet,
    MatchClass: class { constructor(o) { this.opts = o; this.seed = 4242; this.round = 3; this.phase = 'PREP'; } start() {} dispose() {} onLeave() {} onDisconnect() {} onReconnect() {} },
  });
  const persister = new LobbyPersister({ store, registry, lobby, log: quiet, saveMs: 10_000, restoreWaitMs: 0 });
  const p = registry.create('P');
  Object.assign(p, { guest: false, accountId: 'acc_P', adminId: true, connected: true });
  assert.deepEqual(lobby.create(p, { mode: 'coop', difficulty: 'NORMAL', variant: 'deepecho' }), { ok: true });
  const room = lobby.roomOf(p);
  lobby.addBot(p);
  lobby.startMatch(room, 'k1');
  await persister.flush('tick');
  return { lobby, persister, hashes, room, code: room.code, registry };
}

const storedRooms = (hashes) => (hashes.get('sp:lobby:rooms') || new Map());
const storedSessions = (hashes) => (hashes.get('sp:lobby:sessions') || new Map());

test('基线：落盘之后房间与会话都在 Redis 里', async () => {
  const h = await setup();
  assert.equal(storedRooms(h.hashes).size, 1);
  assert.equal(storedSessions(h.hashes).size, 1);
  assert.ok(storedRooms(h.hashes).has(h.code));
});

test('① 在飞的 tick 不会把房间删掉（曾经 lobby:rooms 1 → 0）', async () => {
  const h = await setup(80);                       // store 慢：让 flush 在飞
  assert.equal(storedRooms(h.hashes).size, 1);
  const inflight = h.persister.flush('tick').catch(() => {});
  h.lobby.shutdown('shutdown');                    // 同步：房间全部 dispose，lobby.rooms 清空
  await h.persister.close();
  await inflight;                                  // 那轮 tick 现在才跑到 writeLobby
  assert.equal(storedRooms(h.hashes).size, 1, '房间必须还在（关闭窗口里不删任何记录）');
  assert.ok(storedRooms(h.hashes).has(h.code));
});

test('② 关闭顺序：先 shutdown 落盘、再关房 —— 房间留下来', async () => {
  const h = await setup();
  await h.persister.shutdown();                    // 房间还活着：最后一轮完整落盘
  h.lobby.shutdown('shutdown');
  await h.persister.close();
  assert.equal(storedRooms(h.hashes).size, 1, 'shutdown 之后关房，不再有 flush，房间还在');
  const doc = JSON.parse(storedRooms(h.hashes).get(h.code));
  assert.equal(doc.code, h.code);
  assert.equal(doc.variant, 'deepecho', '房间级信息也在（不是空壳）');
  assert.equal(doc.matchLive, true, '对局记录也要在');
  assert.ok(Array.isArray(doc.seats) && doc.seats.length > 0, '座位要在');
});

test('③ 关闭开始后 writeLobby 不删记录，重启后还能恢复出这间房', async () => {
  const h = await setup(0);
  await h.persister.shutdown();
  h.lobby.shutdown('shutdown');
  // 假装「再过一轮 flush」（现实里 close 之后不会再有，但这是最坏情况）：一条都不该被删
  await h.persister.flush('shutdown').catch(() => {});
  assert.equal(storedRooms(h.hashes).size, 1);
  // 换一个 Lobby 当「重启后的进程」，从同一份存档恢复
  const registry2 = new SessionRegistry();
  const lobby2 = new Lobby({ registry: registry2, getData: () => DATA, log: quiet, MatchClass: class { constructor() {} start() {} dispose() {} } });
  const out = restoreLobby({
    doc: {
      v: LOBBY_DOC_VERSION, kind: 'local', savedAt: Date.now(),
      rooms: [...storedRooms(h.hashes).values()].map((v) => JSON.parse(v)),
      sessions: [...storedSessions(h.hashes).values()].map((v) => JSON.parse(v)),
    },
    registry: registry2, lobby: lobby2, now: Date.now(), log: quiet,
  });
  assert.equal(out.ok, true);
  const back = lobby2.rooms.get(h.code);
  assert.ok(back, '重启后房间要回来');
  assert.equal(back.variant, 'deepecho');
});

test('④ shutdown() 会先等在飞的那轮结束，而不是并发跑', async () => {
  const h = await setup(50);
  const inflight = h.persister.flush('tick').catch(() => {});
  const done = h.persister.shutdown();
  await inflight;
  assert.equal(await done, true, 'shutdown 自己这轮要成功');
  assert.equal(storedRooms(h.hashes).size, 1);
});

test('⑤ 关闭之后定时器不再触发 flush（不会在进程收尾时删东西）', async () => {
  const h = await setup(0);
  const before = h.persister.counts.docWrites;
  await h.persister.shutdown();
  assert.equal(h.persister.timer, null, '定时器已停');
  const writes = h.persister.counts.docWrites;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(h.persister.counts.docWrites, writes, '关闭后没有再写');
  assert.equal(storedRooms(h.hashes).size, 1);
  assert.ok(before > 0);
});

test('⑧ close() 会等在飞的墓碑落完，才放开 store（否则最后一份副本被掐断）', async () => {
  const h = await setup(0);
  // 换一个慢 store：墓碑写下去要 80ms
  const slow = fakeStore(80);
  const store2 = new CheckpointStore({ url: 'redis://x', client: slow.client, log: quiet });
  h.persister.store = store2;
  assert.equal(h.persister.pendingTombstones.size, 0);
  h.lobby.shutdown('shutdown');                    // 同步一口气回收房间 → fire-and-forget 的墓碑
  assert.equal(h.persister.pendingTombstones.size, 1, '墓碑应该正在飞');
  await h.persister.close();                       // 必须等它落完
  assert.equal(h.persister.pendingTombstones.size, 0, 'close 返回时已经没有在飞的墓碑');
  // 墓碑是 SET（不是哈希），落在 values 里
  const tombs = [...slow.values.keys()].filter((k) => k.includes('tomb'));
  assert.equal(tombs.length, 1, '墓碑已经写进去了（没被 close 掐断）');
});

test('⑥ 代码层面：index.js 的关闭顺序是「先 persist.shutdown、再 lobby.shutdown」', () => {  const src = read('server/index.js');
  const iPersist = src.indexOf("await persistence?.shutdown()");
  const iLobby = src.indexOf("lobby.shutdown('shutdown')");
  assert.ok(iPersist > 0, 'index.js 要显式调用 persistence.shutdown()');
  assert.ok(iLobby > 0);
  assert.ok(iPersist < iLobby, '必须先落盘再关房（反过来 goneRooms 就是全部房间）');
});

test('⑦ 代码层面：persister 里三处守卫都在', () => {
  const src = read('server/persist/persister.js');
  assert.match(src, /this\.stopping = false;/, '构造器要初始化 stopping');
  assert.match(src, /if \(reason === 'tick' && this\.stopping\) return false;/, 'flush 要挡住关闭后的 tick');
  assert.match(src, /this\.stopping \? \[\] :/, 'writeLobby 在关闭窗口里不删记录');
  assert.match(src, /async shutdown\(\) \{\s*if \(this\.closed\) return false;\s*this\.stopping = true;/, 'shutdown 一开始就置位');
  assert.match(src, /this\.stopping = true;\s*clearInterval/, 'close 也要置位');
});
