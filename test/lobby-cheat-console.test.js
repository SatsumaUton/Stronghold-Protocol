// 作弊房与公开同盟列表的关系（维护者 2026-11-17）：
// 默认房可以挂到「公开同盟」列表上，开用作弊控制台的房间不行（陌生人进来就会被作弊影响）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { DATA } from './match/harness.js';

process.env.SP_GATE_IGNORE = '1';
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('listable：普通房 true，开用作弊控制台后 false', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: class { start() {} dispose() {} }, getData: () => DATA, log: quiet });
  const host = { playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null, guest: false, accountId: 'acc_1' };
  registry.byPlayerId.set(host.playerId, host);
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  const room = lobby.roomOf(host);
  assert.equal(lobby.listable(room), true, '普通合作房够格挂公开列表');
  room.experimental = { ...(room.experimental || {}), cheatConsole: true };
  assert.equal(lobby.listable(room), false, '作弊房不挂到公开列表上');
  lobby.shutdown();
});
