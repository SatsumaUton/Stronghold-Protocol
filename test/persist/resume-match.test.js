// 断点续玩：进程重启后**真的把对局恢复回来**，而不是丢弃。
//
// 背景（2026-11-02 维护者实测）：
//   在 node-1 重启后，玩家看到的不是「继续玩」，而是「本局模拟已结束 / 服务器重启导致对局中断，
//   同盟已返回等待室」+ 一个「返回同盟」按钮 —— 对局被丢掉，检查点白存了。
//
//   根因有两层，缺一不可：
//     1) server/persist/persister.js 的 restore() 在本地模式下**无条件** abortRestoredMatch(room)，
//        注释理由是「A process restart must not silently resume a match」；
//        而本地恢复方法 restoreLocal() 早就写好了，却从来没有被调用过。
//     2) restoreLocal() 按 startMatch(room, key, keys, { restore }) 调用，但 lobby.startMatch
//        当时只收 2 个参数 —— 即使被调用也恢复不了（是死代码）。
//
//   修法：startMatch 支持 restore（座位/seed/局号取自存档，用 apply(match) 代替 start()），
//        persister 本地模式先尝试 restoreLocal，失败才回退 abortRestoredMatch。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { LobbyPersister } from '../../server/persist/persister.js';
import { snapshotLobby, LOBBY_DOC_VERSION } from '../../server/persist/lobbyState.js';
import { snapshotMatch } from '../../server/match/snapshot.js';
import { DATA } from '../match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** 一个记录 opts 的假 Match：不跑真模拟，只验证 lobby 怎么把存档灌进去。 */
function stubMatchClass(sink) {
  return class StubMatch {
    constructor(opts) { this.opts = opts; this.started = 0; this.applied = 0; sink.push(opts); }
    start() { this.started++; }
    dispose() {}
  };
}

test('startMatch 的 restore：座位/seed/局号取自存档，走 apply 而不是 start', () => {
  const seen = [];
  const Stub = stubMatchClass(seen);
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: Stub, getData: () => DATA, log: quiet });
  // guest: false + accountId：游客门禁会拒绝建房（server/lobby.js create）
  const host = { playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null, guest: false, accountId: 'acc_test' };
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby.addBot(host).ok, true);
  const room = lobby.roomOf(host);
  room.matchCount = 3;                       // 房间已经打过 3 局

  // 存档里的座位与房间当前座位**故意不同**：恢复必须用存档的
  const savedSeats = [
    { seat: 0, playerId: 'p_host', name: 'H', isBot: false, connected: true, loadout: null, ops: null, notOwned: null, diy: null, skins: null, band: null },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true, loadout: null, ops: null, notOwned: null, diy: null, skins: null, band: 'band_default' },
  ];
  let appliedWith = null;
  const result = lobby.startMatch(room, 'k1', null, { restore: {
    seed: 0xDEADBEEF, matchNo: 3, seats: savedSeats,
    apply: (match) => { appliedWith = match; match.applied++; return true; },
  } });

  assert.equal(result.ok, true, 'restore 必须成功');
  const opts = seen.at(-1);
  assert.equal(opts.seed, 0xDEADBEEF, 'seed 取自存档（换 seed 就不是同一局了）');
  assert.equal(opts.matchNo, 3, '局号取自存档（否则 battleId 重号）');
  assert.deepEqual(opts.seats, savedSeats, '座位取自存档，不重新从房间算');
  assert.equal(room.matchCount, 3, 'matchCount 沿用存档的局号，不再 ++');
  assert.ok(appliedWith, '走 apply(match) 灌存档');
  assert.equal(appliedWith.applied, 1);
  assert.equal(appliedWith.started, 0, '恢复时**不**调用 start()');
  assert.equal(room.match, appliedWith, '房间挂上恢复出来的对局');
});

test('startMatch 正常开局仍然走 start()，且局号 ++', () => {
  const seen = [];
  const Stub = stubMatchClass(seen);
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: Stub, getData: () => DATA, log: quiet });
  // guest: false + accountId：游客门禁会拒绝建房（server/lobby.js create）
  const host = { playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null, guest: false, accountId: 'acc_test' };
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  const room = lobby.roomOf(host);
  room.matchCount = 2;
  assert.equal(lobby.startMatch(room, null).ok, true);
  const m = seen.at(-1) && room.match;
  assert.equal(m.started, 1, '正常开局调用 start()');
  assert.equal(m.applied, 0);
  assert.equal(room.matchCount, 3, '正常开局局号 ++');
});

test('persister 本地模式：恢复成功就保留对局，不再无条件 abort', async () => {
  // 这一条用**真 Match + 真检查点**，走完整链路：
  //   lobby.startMatch → snapshotMatch 存检查点 → 新进程 restore() → restoreLocal → restoreMatch
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, getData: () => DATA, log: quiet });
  // guest: false + accountId：游客门禁会拒绝建房（server/lobby.js create）
  const host = { playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null, guest: false, accountId: 'acc_test' };
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby.addBot(host).ok, true);
  const room = lobby.roomOf(host);
  // 真的开一局，房间才挂得上对局（roomDoc 只在 room.match 存在时才存 match 引用）
  assert.equal(lobby.startMatch(room, null).ok, true);
  assert.ok(room.match, '房间挂上了一局');
  const code = room.code;
  const seed = room.match.seed >>> 0;
  // ★ 局号必须用 startMatch 之后的 room.matchCount：startMatch 自己会 ++，
  //   而检查点里存的是这一局真正的 matchNo（battlePrefix 由它派生，错了就因 seed 被拒）。
  const matchNo = room.matchCount;

  // 真正的检查点：存档里那一局的完整状态
  const cpDoc = snapshotMatch(room.match);
  assert.ok(cpDoc && Array.isArray(cpDoc.seats) && cpDoc.seats.length, '检查点里有座位');

  // 存一份「房间正在打第 1 局」的存档
  const cpId = `L.${code}.${matchNo}.${seed.toString(36)}`;
  const matchRef = () => ({ kind: 'local', id: cpId, seed, matchNo });
  const doc = snapshotLobby({ registry, lobby, matchRef, now: Date.now(), kind: 'local' });
  assert.equal(doc.v, LOBBY_DOC_VERSION);
  assert.ok(doc.rooms[0]?.match, '存档里带了这一局的引用（否则根本无从恢复）');
  assert.equal(doc.rooms[0].match.id, cpId, '引用指向这个检查点');

  const checkpoint = { v: 1, kind: 'local', room: code, matchNo, seed, reason: 'band-draft', match: cpDoc };
  const store = {
    async loadLobby() { return { ok: true, value: { v: doc.v, kind: 'local', savedAt: doc.savedAt, sessions: 0, rooms: 0 } }; },
    async hashRead(which) {
      const list = which === 'lobby:sessions' ? doc.sessions : doc.rooms;
      return { ok: true, value: new Map(list.map((r, i) => [String(i), r])) };
    },
    async loadCheckpoint(id) { return { ok: true, value: id === cpId ? checkpoint : null }; },
  };

  // 第二个进程：全新的 lobby + registry，从存档恢复
  const registry2 = new SessionRegistry();
  const lobby2 = new Lobby({ registry: registry2, getData: () => DATA, log: quiet });
  const persister = new LobbyPersister({ store, registry: registry2, lobby: lobby2, log: quiet });
  const res = await persister.restore();

  assert.equal(res.ok, true, 'restore 必须成功');
  assert.equal(res.matches, 1, '那一局被恢复了（这是断点续玩的关键）');
  assert.equal(persister.counts.droppedMatches, 0, '没有对局被丢弃');

  const back = [...lobby2.rooms.values()].find((r) => r.code === code);
  assert.ok(back, '同盟房间还在');
  assert.ok(back.match, '房间仍然挂着一局（不是被 abort 成等待室）');
  assert.equal(back.matchCtx?.live, true);
  // 恢复出来的必须是同一局：同 seed、同局号
  assert.equal(back.match.seed >>> 0, seed, 'seed 一致');
  assert.equal(back.matchCount, matchNo, '局号一致，没有被 ++ 成下一局');
});

test('persister 本地模式：检查点恢复不了时回退到 abort（房间保留、退回等待室）', async () => {
  const seen = [];
  const Stub = stubMatchClass(seen);
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: Stub, getData: () => DATA, log: quiet });
  // guest: false + accountId：游客门禁会拒绝建房（server/lobby.js create）
  const host = { playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null, guest: false, accountId: 'acc_test' };
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  const room = lobby.roomOf(host);
  room.matchCount = 1;
  assert.equal(lobby.startMatch(room, null).ok, true);
  assert.ok(room.match, '房间挂上了一局');
  const code = room.code;

  const matchRef = () => ({ kind: 'local', id: 'L.' + code + '.1.1', seed: 12345, matchNo: 1 });
  const doc = snapshotLobby({ registry, lobby, matchRef, now: Date.now(), kind: 'local' });
  assert.ok(doc.rooms[0]?.match, '存档里带了这一局的引用');
  const store = {
    async loadLobby() { return { ok: true, value: { v: doc.v, kind: 'local', savedAt: doc.savedAt, sessions: 0, rooms: 0 } }; },
    async hashRead(which) {
      const list = which === 'lobby:sessions' ? doc.sessions : doc.rooms;
      return { ok: true, value: new Map(list.map((r, i) => [String(i), r])) };
    },
    // 检查点不见了（例如过期/换了版本）
    async loadCheckpoint() { return { ok: true, value: null }; },
  };

  const registry2 = new SessionRegistry();
  const lobby2 = new Lobby({ registry: registry2, MatchClass: Stub, getData: () => DATA, log: quiet });
  const persister = new LobbyPersister({ store, registry: registry2, lobby: lobby2, log: quiet });
  const res = await persister.restore();

  assert.equal(res.ok, true);
  assert.equal(res.matches, 0, '没恢复成功');
  assert.equal(persister.counts.droppedMatches, 1, '记为丢弃（与以前的统计口径一致）');

  const back = [...lobby2.rooms.values()].find((r) => r.code === code);
  assert.ok(back, '同盟房间仍然保留');
  assert.equal(back.match, null, '对局被 abort，房间退回等待室（客户端显示 返回同盟）');
});
