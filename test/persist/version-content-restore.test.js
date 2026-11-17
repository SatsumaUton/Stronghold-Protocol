// 断点续玩 × 官方版本内容集（2026-11-17 线上实测）：
// node-10 的 SWHT（规程·单人深潜）与 node-11 的 KXRA（规程 coop 深潜）重启后都没能恢复对局，
// 日志是 `[lobby] SWHT match failed to start HostError: the content set b16d401faa02b33c
// is not kept by this server` —— b16d401 正是**默认版本（第二期下半）**的 vanilla cs。
//
// 根因：lobbyState.roomFrom / fallbackRoom 把 room.content 一律写成 lobby.vanilla。
// 版本房拿默认版本的内容集去问自己的版本宿主，宿主回「不认识这个 set」，整局被判恢复失败。
//
// 这个文件钉住：恢复出来的房间，content 必须是**它自己版本**的那份。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { restoreLobby, roomDoc, LOBBY_DOC_VERSION, SESSION_FIELDS } from '../../server/persist/lobbyState.js';
import { DATA } from '../match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const DEFAULT_CS = 'a0'.repeat(32);
const VERSION_CS = 'e1'.repeat(32);
const VERSION = 'act3autochess@V3_1';
const CODE = 'PRST';

/** A lobby whose `versions` service keeps the version's set the way server/versions.js does. */
function versionLobby() {
  const registry = new SessionRegistry();
  const versions = {
    content: (id) => (id === VERSION ? Object.freeze({ cs: VERSION_CS, vanilla: true, version: id, plugins: Object.freeze([]) }) : null),
    data: () => DATA,
    available: () => true,
  };
  const lobby = new Lobby({ registry, MatchClass: class { start() {} dispose() {} }, getData: () => DATA, log: quiet, content: { cs: DEFAULT_CS }, versions });
  return { lobby, registry };
}

/** A session record the restore accepts (readUserToken-style fields are not needed by lobbyState). */
const sessionDoc = (playerId, roomCode) => ({
  playerId, token: 'f'.repeat(64), name: 'H', roomCode, notice: null, accountId: 'acc_1', accountTag: null,
  connected: true, disconnectedAt: null, resumeWindowMs: null, matchHeld: false,
});

test('恢复出来的版本房带自己版本的内容集，不是默认版本的 vanilla', () => {
  // 文档：一间规程房，正在打第 1 局
  const seat = { seat: 0, playerId: 'p_host', name: 'H', isBot: false, ready: false, left: false, connected: true, skins: {} };
  const doc = {
    v: LOBBY_DOC_VERSION, kind: 'local', savedAt: Date.now(),
    sessions: [sessionDoc('p_host', CODE)],
    rooms: [{
      code: CODE, mode: 'coop', difficulty: 'ABYSS', aiPicksLast: false, hostId: 'p_host', capacity: 4, version: VERSION,
      variant: 'deepecho', experimental: null, source: 'private', ownerKey: null, ownerKeys: null,
      matchKey: null, matchKeys: null, matchCount: 1, createdAt: Date.now(), ttlMs: null, noExpire: false, adminCreated: false,
      matchLive: true, liveRound: 1, livePhase: 'PREP', maxSpectators: 2,
      seats: [seat, null, null, null],
      spectators: [],
      match: { kind: 'local', id: 'L.PRST.1.1', seed: 7, matchNo: 1, round: 1, phase: 'PREP' },
    }],
  };

  const { lobby, registry } = versionLobby();
  const out = restoreLobby({ doc, registry, lobby, log: quiet });
  assert.equal(out.ok, true, `restoreLobby 应当成功（${out.reason ?? ''}）`);
  assert.equal(out.rooms, 1, '房间回来了');
  const room = lobby.rooms.get(CODE);
  assert.ok(room, '房间在 lobby.rooms 里');
  assert.equal(room.version, VERSION, '版本跟着房间一起恢复');
  assert.equal(room.content?.cs, VERSION_CS,
    '内容集必须是这个版本自己的 —— 写成默认版本的 vanilla 会让版本宿主拒绝整局');
  assert.equal(out.matches.length, 1, '这一局排进了恢复队列');
});

test('默认版本的房仍然用 vanilla 的内容集', () => {
  const seat = { seat: 0, playerId: 'p_host', name: 'H', isBot: false, ready: false, left: false, connected: true, skins: {} };
  const doc = {
    v: LOBBY_DOC_VERSION, kind: 'local', savedAt: Date.now(),
    sessions: [sessionDoc('p_host', 'DEFT')],
    rooms: [{
      code: 'DEFT', mode: 'solo', difficulty: 'NORMAL', aiPicksLast: false, hostId: 'p_host', capacity: 1, version: null,
      experimental: null, source: 'private', ownerKey: null, ownerKeys: null,
      matchKey: null, matchKeys: null, matchCount: 1, createdAt: Date.now(), ttlMs: null, noExpire: false, adminCreated: false,
      matchLive: true, liveRound: 1, livePhase: 'PREP', maxSpectators: 0,
      seats: [seat], spectators: [],
      match: { kind: 'local', id: 'L.DEFT.1.1', seed: 7, matchNo: 1, round: 1, phase: 'PREP' },
    }],
  };
  const { lobby, registry } = versionLobby();
  const out = restoreLobby({ doc, registry, lobby, log: quiet });
  assert.equal(out.ok, true);
  const room = lobby.rooms.get('DEFT');
  assert.ok(room);
  assert.equal(room.content?.cs, DEFAULT_CS, '默认版本仍然是 vanilla');
});

// roomDoc / SESSION_FIELDS 只是为了确保本文件与 lobbyState 的导出契约还用得上（改动时会被这里发现）
test('lobbyState 仍导出本文件依赖的东西', () => {
  assert.equal(typeof roomDoc, 'function');
  assert.ok(Array.isArray(SESSION_FIELDS));
});
