// Gate, protocol shape, lobby marking and stats exclusion for match test mode (DESIGN §34.8).
// No listeners: Lobby and MatchProxy are in-process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestModeEnv, testModeGate } from '../server/testMode.js';
import { parseTestArgs } from '../shared/testMode.js';
import { validateC2S } from '../shared/protocol.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { wireOptions, MatchProxy } from '../server/match/host/proxy.js';
import {
  aggregateStats, buildQuitRecord, buildRecord, compactRecord, countsTowardStats, createLiveMatch,
  normalizeRecord, appendRecord, highestBondRecord, recordId, recordToResult, strategyBadgeIds,
} from '../public/js/ui/stats.js';

test('parseTestModeEnv: local words, force, everything else off', () => {
  for (const w of ['1', 'true', 'TRUE', 'yes', 'on', 'local']) assert.equal(parseTestModeEnv(w), 'local');
  assert.equal(parseTestModeEnv('force'), 'force');
  assert.equal(parseTestModeEnv('FORCE'), 'force');
  for (const w of [undefined, '', '0', 'off', 'false', 'no', 'nope', 'trusted-force']) assert.equal(parseTestModeEnv(w), 'off');
});

test('testModeGate: local accepts 1, public needs force, unknown host fails closed', () => {
  assert.deepEqual(testModeGate('off', '127.0.0.1'), { enabled: false, warn: null });
  assert.deepEqual(testModeGate('local', '127.0.0.1'), { enabled: true, warn: null });
  assert.deepEqual(testModeGate('local', '192.168.1.5').enabled, true);
  const pub = testModeGate('local', '0.0.0.0');
  assert.equal(pub.enabled, false);
  assert.match(pub.warn, /SP_TEST_MODE=force/);
  assert.equal(testModeGate('local', '8.8.8.8').enabled, false);
  assert.equal(testModeGate('local', '::').enabled, false);
  const forced = testModeGate('force', '8.8.8.8');
  assert.equal(forced.enabled, true);
  assert.match(forced.warn, /public or wildcard/);
  assert.equal(testModeGate('force', '::').enabled, true);
  assert.deepEqual(testModeGate('force', '127.0.0.1'), { enabled: true, warn: null });
  assert.deepEqual(testModeGate('force', ''), { enabled: false, warn: null });
  assert.deepEqual(testModeGate('local', ''), { enabled: false, warn: null });
  assert.deepEqual(testModeGate('nope', '127.0.0.1'), { enabled: false, warn: null });
});

test('parseTestArgs refuses the wrong type, unknown keys and out-of-range values', () => {
  assert.equal(parseTestArgs('nope', {}).error, 'BAD_MSG');
  assert.equal(parseTestArgs('funds', { amount: 1.5 }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', { amount: '10' }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', { amount: -1 }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', { amount: 100000 }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', {}).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', { amount: 1, extra: true }).error, 'BAD_MSG');
  assert.equal(parseTestArgs('funds', null).error, 'BAD_MSG');
  assert.deepEqual(parseTestArgs('level', undefined), { args: {} });
  assert.equal(parseTestArgs('shop', { slots: [{ kind: 'chess', id: 'a', extra: 1 }] }).error, 'BAD_MSG');
  assert.equal(parseTestArgs('shop', { slots: [{ kind: 'nope', id: 'a' }] }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('shop', { slots: [] }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('phase', { name: 'lobby' }).error, 'BAD_TARGET');
  assert.deepEqual(parseTestArgs('funds', { amount: 0 }), { args: { amount: 0 } });
});

test('validateC2S accepts only a literal test:true and a known g.test command', () => {
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', test: true }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', test: false }), 'bad field test');
  assert.equal(validateC2S({ t: 'g.test', cmd: 'funds' }), null);
  assert.equal(validateC2S({ t: 'g.test', cmd: 'funds', args: { amount: 1 } }), null);
  assert.match(validateC2S({ t: 'g.test', cmd: 'nope' }), /bad field cmd/);
  assert.match(validateC2S({ t: 'g.nope' }), /unknown type/);
});

function openLobby(t, extra = {}) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({
    registry,
    content: { cs: 'ab'.repeat(32) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    ...extra,
    options: { testMode: extra.testMode ?? 'off', testHost: extra.testHost },
  });
  t.after(() => lobby.shutdown());
  const player = (name) => {
    const s = registry.create(name);
    s.connected = true;
    s.messages = [];
    s.ws = { readyState: 1, bufferedAmount: 0, send: (txt) => s.messages.push(JSON.parse(txt)) };
    return s;
  };
  return { lobby, player };
}

test('a server with the gate off rejects a test room and omits the welcome flag', (t) => {
  const { lobby, player } = openLobby(t);
  assert.equal(lobby.testEnabled, false);
  assert.equal(lobby.welcomeInfo().testMode, undefined);
  const host = player('host');
  const res = lobby.create(host, { mode: 'solo', difficulty: 'NORMAL', test: true });
  assert.equal(res.error, 'TEST_DISABLED');
  assert.equal(lobby.rooms.size, 0);
  assert.equal(lobby.create(host, { mode: 'solo', difficulty: 'NORMAL', test: false }).ok, true);
  const room = lobby.roomOf(host);
  assert.equal(room.test, false);
  assert.equal(room.toState().test, undefined);
  assert.equal(typeof lobby.setTest, 'undefined');
});

test('an enabled local gate marks the room, the welcome and a co-op guest', (t) => {
  const { lobby, player } = openLobby(t, { testMode: '1', testHost: '127.0.0.1' });
  assert.equal(lobby.testEnabled, true);
  assert.equal(lobby.welcomeInfo().testMode, true);
  assert.equal(lobby.testWarn, null);
  const host = player('host');
  const guest = player('guest');
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', test: true }).ok, true);
  const room = lobby.roomOf(host);
  assert.equal(room.test, true);
  assert.equal(room.toState().test, true);
  assert.equal(lobby.join(guest, { code: host.roomCode, testAck: true }).ok, true);
  const seen = guest.messages.filter((m) => m.t === 'room.state');
  assert.ok(seen.length > 0);
  assert.equal(seen.at(-1).test, true);
  const plain = player('other');
  assert.equal(lobby.create(plain, { mode: 'solo', difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby.roomOf(plain).test, false);
  assert.equal(lobby.roomOf(plain).toState().test, undefined);
});

test('startMatch forwards test only for a room created with the flag', (t) => {
  const seen = [];
  class Rec {
    constructor(opts) { seen.push(opts); this.opts = opts; }
    start() {}
    dispose() {}
  }
  const { lobby, player } = openLobby(t, { testMode: '1', testHost: '127.0.0.1', MatchClass: Rec });
  const host = player('host');
  lobby.create(host, { mode: 'solo', difficulty: 'NORMAL' });
  assert.equal(lobby.startMatch(lobby.roomOf(host)).ok, true);
  assert.equal(seen[0].test, undefined);
  assert.equal(typeof seen[0].hostId, 'string');
  const host2 = player('host2');
  lobby.create(host2, { mode: 'solo', difficulty: 'NORMAL', test: true });
  assert.equal(lobby.startMatch(lobby.roomOf(host2)).ok, true);
  assert.equal(seen[1].test, true);
  assert.equal(seen[1].hostId, host2.playerId);
});

test('wireOptions and setHost stay silent unless the match was created as a test', () => {
  assert.deepEqual(wireOptions({ roomCode: 'ABCD', mode: 'solo', hostId: 'p', test: false }), { roomCode: 'ABCD', mode: 'solo' });
  assert.deepEqual(
    wireOptions({ roomCode: 'ABCD', mode: 'solo', hostId: 'p', test: true }),
    { roomCode: 'ABCD', mode: 'solo', test: true, hostId: 'p' },
  );
  const posts = [];
  const normal = new MatchProxy({ host: { post: (m) => posts.push(m) }, matchId: 'n', opts: { roomCode: 'ABCD', test: false, hostId: 'p' } });
  normal.setHost('q');
  assert.deepEqual(posts, []);
  assert.equal(normal.opts.hostId, 'p');
  const testMatch = new MatchProxy({ host: { post: (m) => posts.push(m) }, matchId: 't', opts: { roomCode: 'ABCD', test: true, hostId: 'p' } });
  testMatch.setHost('q');
  assert.equal(testMatch.opts.hostId, 'q');
  assert.equal(posts.at(-1).method, 'setHost');
  assert.deepEqual(posts.at(-1).args, ['q']);
});

function baseResult(over = {}) {
  return {
    t: 'm.result',
    victory: true, roundsPassed: 15, hiddenReached: true, hiddenCleared: true, reason: 'hidden_cleared',
    teamLp: 24, modeId: 'mode_single_hard', difficulty: 'HARD', stageId: 'stage_hard', bossId: 'enemy_boss', hiddenBossId: 'enemy_hidden',
    seed: 123456789, durationMs: 952123,
    players: [
      {
        playerId: 'p1', seat: 0, name: '罗宾', isBot: false, left: false, alive: true, victory: true,
        roundsPassed: 16, eliminatedRound: null, lp: 24, bandId: 'band_amiya',
        title: { id: 'comment_1', name: '卫戍之星', picId: 'comment_icon_1', text: '对敌方领袖造成伤害最高（仅胜利时）' },
        trophies: 30, reward: 88,
        lineup: [{ id: 'char_290_vigna', golden: false, tier: 2, row: 10, col: 5, items: ['item_eq_1'] }],
        bonds: [{ bondId: 'steadShip', count: 3, tier: 1, layers: 12, active: true }],
        stats: { dmgDealt: 100, kills: 41, leaks: 2, gold: 80, refreshes: 1, merges: 1, itemsEquipped: 1, bossDamage: 10, activatedLayers: 3, lpLost: 1, perfectRounds: 1 },
      },
      {
        playerId: 'p2', seat: 1, name: '队友B', isBot: false, left: false, alive: false, victory: false,
        roundsPassed: 9, eliminatedRound: 10, lp: 0, bandId: 'band_fang', title: null, trophies: 0, reward: 40,
        lineup: [], bonds: [], stats: { kills: 3 },
      },
    ],
    ...over,
  };
}

test('test results never persist and legacy test records stay excluded from every tally', () => {
  const content = { cs: 'ab'.repeat(32), vanilla: false, plugins: [{ id: 'x', version: '1' }] };
  const real = buildRecord(baseResult(), { myId: 'p1', now: 1 });
  const modded = buildRecord(baseResult({ seed: 8 }), { myId: 'p1', now: 8, content });
  assert.equal(buildRecord(baseResult({ test: true }), { myId: 'p1' }), null);
  const testRec = normalizeRecord({ ...modded, id: 'test', test: true, testActions: 4 });
  assert.equal(appendRecord({ records: [] }, testRec).added, false);
  assert.equal(real.test, undefined);
  assert.equal(testRec.test, true);
  assert.equal(testRec.testActions, 4);
  assert.equal(countsTowardStats(real), true);
  assert.equal(countsTowardStats(testRec), false);
  assert.notEqual(recordId(baseResult(), 'p1'), recordId(baseResult({ test: true }), 'p1'));
  assert.equal(normalizeRecord({ ...testRec, test: 'yes' }).test, undefined);
  const agg = aggregateStats([real, modded, testRec]);
  assert.equal(agg.total, 3);
  assert.equal(agg.test, 1);
  assert.equal(agg.modded, 1);
  assert.equal(agg.count, 1);
  const withModded = aggregateStats([real, modded, testRec], { modded: true });
  assert.equal(withModded.count, 2);
  assert.equal(withModded.test, 1);
  assert.equal(aggregateStats([real]).test, 0);
  const bands = { a: { bandId: 'band_amiya', victorCount: 1, sortId: 1 } };
  assert.deepEqual(strategyBadgeIds([testRec], bands), []);
  assert.deepEqual(strategyBadgeIds([real], bands), ['band_amiya']);
  const taller = normalizeRecord({ ...testRec, id: 'taller' });
  assert.equal(highestBondRecord([taller, real]).record.id, real.id);
  assert.equal(highestBondRecord([taller]), null);
  const replay = recordToResult(testRec);
  assert.equal(replay.test, true);
  assert.equal(replay.testActions, 4);
  assert.equal(compactRecord(testRec).test, true);
  assert.equal(compactRecord(real).test, undefined);
  const live = createLiveMatch();
  live.active = true;
  live.startedAt = 10;
  const state = {
    me: { playerId: 'p1' },
    room: { code: 'ABCD', mode: 'solo' },
    match: {
      result: null,
      public: {
        phase: 'PREP', round: 2, modeId: 'mode_single_hard', difficulty: 'NORMAL', lastRound: 15,
        test: true, testActions: 2,
        players: [{ playerId: 'p1', seat: 0, name: 'A', alive: true, lp: 10, bandId: 'band_amiya' }],
      },
    },
  };
  const quit = buildQuitRecord(state, { live, now: 50 });
  assert.equal(quit, null);
  const plain = buildQuitRecord({ ...state, match: { ...state.match, public: { ...state.match.public, test: false, testActions: 2 } } }, { live, now: 50 });
  assert.equal(plain.test, undefined);
  assert.ok(plain);
});

import { makeMatch, DATA } from './match/harness.js';
import { buildResult } from '../server/match/results.js';
import { replayTestMatch } from '../server/match/testReplay.js';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { TEST_COMMANDS, TEST_RATE_COUNT } from '../shared/testMode.js';

function fixture(t, opts = {}) {
  const h = makeMatch({ mode: 'solo', test: true, ...opts });
  t.after(() => h.m.dispose());
  h.start(); h.toPrep();
  h.p = h.ps('p_0');
  h.cmd = (cmd, args = {}, who = 'p_0') => h.m.handle(who, { t: 'g.test', cmd, args });
  return h;
}
const ok = (r) => assert.deepEqual(r, { ok: true });
const error = (r, code) => assert.equal(r.error, code);

test('all commands reject a normal match; forged flags and unknown identities cannot enter the test path', (t) => {
  const h = fixture(t, { test: false });
  for (const cmd of TEST_COMMANDS) error(h.m.handle('p_0', { t: 'g.test', cmd, test: true, args: {} }), 'TEST_FORBIDDEN');
  error(h.cmd('funds', { amount: 99 }, 'other'), 'NOT_IN_ROOM');
  assert.equal(h.m.publicView().test, undefined);
  assert.equal(h.m.testLog, undefined);
  assert.equal(buildResult(h.m, { victory: false }).test, undefined);
});

test('funds, chess, item and token grants use the host seat and actual acquisition primitives', (t) => {
  const h = fixture(t);
  ok(h.cmd('funds', { amount: 99999 })); assert.equal(h.p.funds, 99999);
  ok(h.cmd('funds', { amount: 0 })); assert.equal(h.p.funds, 0);
  ok(h.cmd('chess', { id: 'chess_char_3_19_a' }));
  const owner = [...h.p.hand, ...h.p.temp].find(p => p?.id === 'chess_char_3_19_a');
  assert.ok(owner);
  const id = h.p.gd.placeableTokens(owner.id, h.p.loadoutFor(h.p.gd.chess(owner.id)))[0].tokenId;
  const count = () => [...h.p.hand, ...h.p.temp].filter(p => p?.kind === 'token' && p.ownerUid === owner.uid).reduce((n, p) => n + p.count, 0);
  const before = count();
  ok(h.cmd('token', { id, ownerUid: owner.uid })); assert.equal(count(), before + 1);
  error(h.cmd('token', { id, ownerUid: 99999 }), 'BAD_TARGET');
  ok(h.cmd('item', { id: 'chess_item_1_03_e_a' }));
  assert.ok([...h.p.hand, ...h.p.temp].some(p => p?.id === 'chess_item_1_03_e_a'));
  for (const cmd of ['chess', 'item']) error(h.cmd(cmd, { id: 'missing' }), 'BAD_TARGET');
  assert.equal(h.m.errorCount, 0);
});

test('LP, boss HP and team LP accept exact bounded values only in their valid states', (t) => {
  const h = fixture(t);
  ok(h.cmd('lp', { value: 77 })); assert.equal(h.p.lp, 77);
  error(h.cmd('lp', { value: -1 }), 'BAD_TARGET'); assert.equal(h.p.lp, 77);
  error(h.cmd('hp', { value: 1 }), 'WRONG_PHASE');
  error(h.cmd('teamLp', { value: 1 }), 'WRONG_PHASE');
  h.m.phase = 'FINAL_ASSAULT'; h.m.bossPool = { hp: 100, maxHp: 100 }; h.m.teamLp = 20;
  ok(h.cmd('hp', { value: 42 })); assert.equal(h.m.bossPool.hp, 42);
  error(h.cmd('hp', { value: 101 }), 'BAD_TARGET'); assert.equal(h.m.bossPool.hp, 42);
  ok(h.cmd('teamLp', { value: 9 })); assert.equal(h.m.teamLp, 9);
  error(h.cmd('funds', { amount: 10 }), 'WRONG_PHASE');
});

test('bond activation, layers and strategy changes use the real calculator and update draft ownership', (t) => {
  const h = fixture(t);
  const id = h.m.gd.bondIds.find(id => !h.m.gd.modeInactiveBonds.has(id) && h.m.gd.bond(id).thresholds?.length);
  const count = h.m.gd.bond(id).thresholds[0];
  ok(h.cmd('bond', { id, count, layers: 3 })); h.p.recompute();
  assert.equal(h.p.bonds[id].active, true); assert.equal(h.p.layers[id], 3);
  error(h.cmd('bond', { id, count: 0, layers: 2 }), 'BAD_TARGET');
  assert.equal(h.p.bondCountBonus[id], count);
  const strategy = h.m.gd.bandIds().find(id => id !== h.p.bandId && h.m.gd.bandAllowed(id));
  ok(h.cmd('strategy', { id: strategy, resetLp: true }));
  assert.equal(h.p.bandId, strategy); assert.equal(h.p.lp, h.m.gd.startLp(strategy));
  assert.equal(h.m.draft.picks[h.p.playerId], strategy);
  error(h.cmd('strategy', { id: 'not_a_strategy' }), 'BAD_TARGET');
});

test('next shop is consumed once by a paid refresh; queued layout blocks upgrades; level uses its real price', (t) => {
  const h = fixture(t);
  ok(h.cmd('funds', { amount: 1000 }));
  const slots = h.p.shop.slots.map(s => ({ kind: s.kind, id: s.id }));
  error(h.cmd('shop', { slots: slots.slice(1) }), 'BAD_TARGET');
  ok(h.cmd('shop', { slots }));
  error(h.cmd('level'), 'WRONG_PHASE');
  ok(h.m.handle('p_0', { t: 'g.refresh' }));
  assert.deepEqual(h.p.shop.slots.map(s => ({ kind: s.kind, id: s.id })), slots);
  assert.equal(h.p._testShopNext, null);
  const funds = h.p.funds, price = h.p.shop.upgradePrice, level = h.p.shop.level;
  ok(h.cmd('level')); assert.equal(h.p.shop.level, level + 1); assert.equal(h.p.funds, funds - price);
});

test('round and phase commands cancel stale callbacks; timers hold, advance once and resume', (t) => {
  const h = fixture(t);
  error(h.cmd('round', { round: 99 }), 'BAD_TARGET');
  ok(h.cmd('timers', { on: false }));
  ok(h.cmd('round', { round: 2 })); assert.equal(h.m.round, 2); assert.equal(h.m.phase, 'ROUND_START');
  h.sched.advance(10000); assert.equal(h.m.phase, 'ROUND_START');
  ok(h.cmd('phase', { name: 'prep' })); assert.equal(h.m.phase, 'PREP');
  error(h.cmd('phase', { name: 'advance' }), 'WRONG_PHASE');
  ok(h.cmd('round', { round: 2 }));
  ok(h.cmd('phase', { name: 'advance' })); assert.notEqual(h.m.phase, 'ROUND_START');
  ok(h.cmd('timers', { on: true }));
  ok(h.cmd('round', { round: 3 }));
  h.sched.runUntil(() => h.m.phase !== 'ROUND_START');
  ok(h.cmd('timers', { on: false }));
  error(h.cmd('phase', { name: 'advance' }), 'WRONG_PHASE');
});

test('bounty and choice use the existing offers and reject forged selections', (t) => {
  const h = fixture(t);
  const enemyKey = Object.keys(DATA.enemies).find(id => !h.m.gd.inactiveEnemies.has(id));
  ok(h.cmd('bounty', { enemyKey })); assert.ok(h.p.bounties.length);
  error(h.cmd('bounty', { enemyKey: 'missing' }), 'BAD_TARGET');
  error(h.cmd('choice', { idx: 0 }), 'WRONG_PHASE');
  const round = h.m.gd.spRounds()[0];
  ok(h.cmd('timers', { on: false })); ok(h.cmd('round', { round }));
  ok(h.cmd('phase', { name: 'sp' })); assert.equal(h.m.phase, 'SP_DRAFT');
  ok(h.cmd('choice', { idx: 0 }));
  assert.equal(h.m.errorCount, 0);
});

test('host migration, spectators, rate bounds and audit results cannot mutate another seat', (t) => {
  const h = fixture(t, { mode: 'coop', humans: 2, spectators: ['watch'] });
  const other = h.ps('p_1'), before = other.funds;
  error(h.cmd('funds', { amount: 90 }, 'p_1'), 'NOT_HOST');
  error(h.cmd('funds', { amount: 90 }, 'watch'), 'SPECTATOR');
  assert.equal(h.m.testLog.at(-1).cmd, 'funds');
  assert.equal(h.m.testLog.at(-1).code, 'SPECTATOR');
  assert.equal(h.m.testLog.at(-2).cmd, 'funds');
  for (let i = 0; i < TEST_RATE_COUNT; i++) error(h.cmd('funds', { amount: -1 }), 'BAD_TARGET');
  error(h.cmd('funds', { amount: 90 }), 'RATE');
  assert.equal(other.funds, before);
  h.sched.advance(10000);
  h.m.setHost('p_1');
  error(h.cmd('funds', { amount: 90 }), 'NOT_HOST');
  ok(h.cmd('funds', { amount: 90 }, 'p_1')); assert.equal(other.funds, 90);
  const last = h.m.testLog.at(-1);
  assert.deepEqual(last.args, { amount: 90 }); assert.equal(last.playerId, 'p_1'); assert.equal(last.ok, true);
  assert.equal(h.m.publicView().test, true); assert.equal(h.m.publicView().testActions, 1);
  const result = buildResult(h.m, { victory: true, hiddenCleared: true });
  assert.equal(result.testActions, 1);
  for (const row of result.players) { assert.equal(row.title, null); assert.equal(row.trophies, 0); assert.equal(row.reward, 0); }
});

test('test journal re-simulates real inputs, timer order, RNG, public/private views and result', () => {
  const scheduler = new VirtualScheduler();
  const entries = [];
  const m = new Match({ mode: 'solo', difficulty: 'NORMAL', test: true, hostId: 'p', seed: 832,
    seats: [{ playerId: 'p', seat: 0, name: 'P', connected: true }], data: DATA, scheduler,
    send() {}, broadcast() {}, onEnd() {}, clientCombat: false, botRehearsal: 0, log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } },
  });
  m.start();
  ok(m.handle('p', { t: 'g.test', cmd: 'timers', args: { on: false } }));
  ok(m.handle('p', { t: 'g.infoReady' }));
  scheduler.runUntil(() => m.phase === 'BAND_DRAFT');
  ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'battleCheck' } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'advance' } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'prep' } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'funds', args: { amount: 700 } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'chess', args: { id: 'chess_char_1_01_a' } }));
  ok(m.handle('p', { t: 'g.refresh' }));
  ok(m.handle('p', { t: 'g.test', cmd: 'lp', args: { value: 0 } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'combat' } }));
  assert.ok(scheduler.runUntil(() => m.phase === 'SETTLE' || m.ended));
  if (!m.ended) ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'advance' } }));
  assert.equal(m.ended, true);
  assert.equal(m.lastResultMsg.testActions, m.testActions);
  const copy = replayTestMatch(DATA, entries);
  assert.deepEqual(copy.publicView(), m.publicView());
  assert.deepEqual(copy.players.get('p').privateView(), m.players.get('p').privateView());
  assert.deepEqual(buildResult(copy, { victory: false }), buildResult(m, { victory: false }));
  assert.deepEqual(copy.lastResultMsg, m.lastResultMsg);
  assert.deepEqual(copy.testLog, m.testLog); assert.equal(copy.errorCount, 0);
  copy.dispose(); m.dispose();
});

test('test join and watch require acknowledgement before any seat or private state is sent', (t) => {
  const { lobby, player } = openLobby(t, { testMode: '1', testHost: '127.0.0.1' });
  const host = player('host'), guest = player('guest'), watcher = player('watcher');
  ok(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', test: true }));
  const code = host.roomCode;
  for (const [s, method] of [[guest, 'join'], [watcher, 'spectate']]) {
    error(lobby[method](s, { code }), 'TEST_CONFIRM');
    assert.equal(lobby.roomOf(s), null); assert.equal(s.messages.length, 0);
    ok(lobby[method](s, { code, testAck: true }));
    assert.equal(s.messages.at(-1).test, true);
  }
  for (const type of ['room.join', 'room.spectate']) {
    assert.equal(validateC2S({ t: type, code }), null);
    assert.equal(validateC2S({ t: type, code, testAck: true }), null);
    assert.ok(validateC2S({ t: type, code, testAck: false }));
  }
});

test('lobby rechecks process and immutable room gates on start and every command', (t) => {
  const { lobby, player } = openLobby(t, { testMode: '1', testHost: '127.0.0.1' });
  const host = player('host'); ok(lobby.create(host, { mode: 'solo', difficulty: 'NORMAL' }));
  const room = lobby.roomOf(host);
  let calls = 0; room.match = { handle() { calls++; }, dispose() {} };
  error(lobby.routeGameNow(host, { t: 'g.test', cmd: 'funds', args: { amount: 9 }, test: true }), 'TEST_FORBIDDEN');
  assert.equal(calls, 0);
  const tester = player('tester'); ok(lobby.create(tester, { mode: 'solo', difficulty: 'NORMAL', test: true }));
  const testRoom = lobby.roomOf(tester);
  lobby.setTestHost('0.0.0.0');
  error(lobby.startMatch(testRoom), 'TEST_DISABLED');
  error(lobby.routeGameNow(host, { t: 'g.test' }), 'TEST_DISABLED');
  assert.equal(calls, 0); assert.equal(testRoom.match, null);
});

test('public/wildcard/numeric listener variants require force and an actual IP', () => {
  for (const host of ['0.0.0.0', '0.1.2.3', '::', '0:0:0:0:0:0:0:0', '::ffff:0.0.0.0', '8.8.8.8', '2001:4860:4860::8888']) {
    assert.equal(testModeGate('local', host).enabled, false);
    assert.ok(testModeGate('local', host).warn);
    assert.equal(testModeGate('force', host).enabled, true);
    assert.ok(testModeGate('force', host).warn);
  }
  for (const host of ['', 'localhost', 'not-an-address']) assert.equal(testModeGate('force', host).enabled, false);
});

test('strict catalogue rejects every malformed command before mutation, including prototype/path-shaped IDs', () => {
  const valid = {
    funds: { amount: 3 }, chess: { id: 'x' }, item: { id: 'x' }, token: { id: 'x', ownerUid: 1 },
    lp: { value: 1 }, hp: { value: 1 }, teamLp: { value: 1 }, round: { round: 1 }, phase: { name: 'prep' },
    shop: { slots: [{ kind: 'chess', id: 'x' }] }, timers: { on: false }, bond: { id: 'x', layers: 0, count: 3 },
    strategy: { id: 'x' }, level: {}, bounty: { enemyKey: 'x' }, choice: { idx: 0 },
  };
  for (const cmd of TEST_COMMANDS) {
    assert.ok(parseTestArgs(cmd, valid[cmd]).args, cmd);
    for (const args of [null, [], { ...valid[cmd], playerId: 'other' }, Object.create(valid[cmd])]) assert.equal(parseTestArgs(cmd, args).error, 'BAD_MSG', cmd);
  }
  for (const id of ['constructor', '__proto__', '../file', 'file:///tmp/a', 'x'.repeat(65)]) assert.equal(parseTestArgs('chess', { id }).error, 'BAD_TARGET');
  for (const amount of [NaN, Infinity, -1, 1.5, '3', 100000]) assert.equal(parseTestArgs('funds', { amount }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('bond', { id: 'x', layers: 0, count: 100 }).error, 'BAD_TARGET');
});

test('co-op band timer is held and cannot fire a stale draft callback after a phase jump', (t) => {
  const h = makeMatch({ test: true, mode: 'coop', humans: 2 }); t.after(() => h.m.dispose());
  h.start();
  for (const p of h.m.order) ok(h.m.handle(p.playerId, { t: 'g.infoReady' }));
  h.sched.runUntil(() => h.m.phase === 'BAND_DRAFT');
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'timers', args: { on: false } }));
  h.sched.advance(60000); assert.equal(h.m.phase, 'BAND_DRAFT'); assert.equal(Object.keys(h.m.draft.picks).length, 0);
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'phase', args: { name: 'battleCheck' } }));
  assert.equal(h.m.phase, 'BATTLE_CHECK');
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'phase', args: { name: 'advance' } }));
  assert.equal(h.m.phase, 'ROUND_START');
});

import { decodeTestTrace } from '../server/match/testReplay.js';
import { validHostMessage } from '../server/match/host/ipc.js';
import { mergeStats, migrateStats, saveStats, observeMatch, recordResult, liveMatch } from '../public/js/ui/stats.js';

test('large Unicode input journals survive the match-host log limit and reject missing fragments', () => {
  const entries = [];
  const m = new Match({ mode: 'solo', difficulty: 'NORMAL', test: true, data: DATA, scheduler: new VirtualScheduler(),
    seats: [{ playerId: 'p', seat: 0, name: '测试😀'.repeat(400), connected: true }],
    send() {}, broadcast() {}, onEnd() {},
    log: { info(text) { assert.ok(validHostMessage({ type: 'log', level: 'info', text })); entries.push(JSON.parse(text.slice(text.indexOf(']') + 2))); } },
  });
  m.start();
  assert.equal(entries[0].kind, 'chunk');
  assert.equal(decodeTestTrace(entries)[0].kind, 'init');
  assert.throws(() => decodeTestTrace(entries.slice(1)), /chunk/);
  assert.throws(() => decodeTestTrace(entries.slice(0, 1)), /incomplete/);
  const replay = replayTestMatch(DATA, entries);
  assert.deepEqual(replay.publicView(), m.publicView());
  replay.dispose(); m.dispose();
});

test('test results cannot enter local records via result, quit, import, merge or direct save', (t) => {
  const real = buildRecord(baseResult(), { myId: 'p1' });
  const marked = { ...real, id: 'test', test: true };
  assert.deepEqual(mergeStats({ records: [marked] }, { records: [] }).records, []);
  assert.deepEqual(migrateStats({ v: real.v, records: [marked] }).stats.records, []);
  const old = globalThis.localStorage;
  const writes = [];
  globalThis.localStorage = { setItem(k, v) { writes.push(JSON.parse(v)); } };
  t.after(() => { if (old === undefined) delete globalThis.localStorage; else globalThis.localStorage = old; liveMatch.active = false; liveMatch.test = false; });
  assert.equal(saveStats({ records: [marked] }), true); assert.deepEqual(writes[0].records, []);
  const state = { me: { playerId: 'p1' }, room: { test: true }, match: { public: { phase: 'PREP', round: 1, players: [] } } };
  observeMatch(liveMatch, state);
  state.room.test = false; observeMatch(liveMatch, state);
  assert.equal(liveMatch.test, true);
  assert.equal(recordResult(baseResult(), { myId: 'p1' }), null);
  assert.equal(buildQuitRecord(state), null);
  assert.equal(writes.length, 1);
});

test('DIY grants resolve the host configured view and no other player owner UID is accepted', (t) => {
  const id = 'chess_char_5_diy1_a';
  const h = fixture(t, { mode: 'coop', seats: [
    { seat: 0, playerId: 'p_0', name: 'P0', connected: true, diy: { [id]: { charId: 'char_601_cguard' } } },
    { seat: 1, playerId: 'p_1', name: 'P1', connected: true },
  ] });
  ok(h.cmd('chess', { id })); assert.ok([...h.p.hand, ...h.p.temp].some(p => p?.id === id));
  const other = h.ps('p_1').acquireChess('chess_char_3_19_a');
  const tokenId = h.ps('p_1').gd.placeableTokens(other.id, h.ps('p_1').loadoutFor(h.ps('p_1').gd.chess(other.id)))[0].tokenId;
  error(h.cmd('token', { id: tokenId, ownerUid: other.uid }), 'BAD_TARGET');
  assert.equal(h.ps('p_1').hand.filter(Boolean).length > 0, true);
});

test('audit memory/public tails are bounded, while every attempt is sent to the server journal', (t) => {
  const h = fixture(t);
  const audits = [];
  h.m.log.info = (line) => { if (line.startsWith('[test-audit ')) audits.push(JSON.parse(line.slice(line.indexOf(']') + 2))); };
  for (let i = 0; i < 224; i++) {
    if (i && i % 8 === 0) h.sched.advance(10000);
    ok(h.cmd('funds', { amount: i }));
  }
  assert.equal(audits.length, 224); assert.equal(h.m.testLog.length, 200);
  assert.equal(h.m.publicView().testLog.length, 12); assert.equal(h.m.testActions, 224);
  assert.equal(audits.at(-1).args.amount, 223); assert.equal(audits.at(-1).seq, 224);
});

test('any known equipment can be granted after stock is exhausted using existing overdraw accounting', (t) => {
  const h = fixture(t);
  const id = 'chess_item_1_03_e_a';
  for (let i = 0; i < 100 && h.m.itemPool.canGain(id); i++) h.p.acquireItem(id);
  assert.equal(h.m.itemPool.canGain(id), false);
  const debt = h.m.itemPool.debtOf(id);
  ok(h.cmd('item', { id }));
  assert.ok([...h.p.hand, ...h.p.temp].some(p => p?.kind === 'item'));
  assert.equal(h.m.itemPool.canGain(id), false);
  assert.equal(h.m.itemPool.debtOf(id), debt + 1);
});
