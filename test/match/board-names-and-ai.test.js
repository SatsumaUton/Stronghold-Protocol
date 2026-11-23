// test/match/board-names-and-ai.test.js —— 深潜排行榜：盟约用中文名、AI 不上榜
// （玩家 2026-11-23：规程版本的排行榜盟约显示错误；且规程榜带了 AI，而第二期下半只收真人）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { getVersionData } from '../../server/data.js';

const LOBBY = /** @type {any} */ (Lobby);
const QUIET = { warn() {}, error() {}, info() {} };
const REG = getVersionData('act3autochess@V3_1', { log: QUIET });

const makeStore = () => {
  const cmds = [];
  return { cmds, store: { prefix: '', client: { command: (...a) => { cmds.push(a); return Promise.resolve([]); } } } };
};

const lobbyWith = (store, versions) => ({
  persistStore: store,
  versions: versions || { data: (id) => (id === 'act3autochess@V3_1' ? REG : null) },
  now: () => 1_700_000_000_000,
  _archiveEchoBoard: () => {},
});

/** 一个「宿主房」：room.match 是 MatchProxy（只有 hosted / roomCode / opts）。 */
const hostedRoom = (version) => ({
  code: 'EMMC', matchCount: 1, difficulty: 'HARD', version,
  match: { hosted: true, roomCode: 'EMMC', opts: {}, round: 12, phase: 'PREP' },
});

const summaryWith = (players) => ({
  variant: 'deepecho', echoDepth: 12, echoDiveStart: 1, victory: false,
  seed: 1234, durationMs: 3_600_000, roundsPassed: 12, players,
});

test('宿主房（规程）：盟约显示中文名，不是 bondId', async () => {
  const { store, cmds } = makeStore();
  const lobby = lobbyWith(store);
  const room = hostedRoom('act3autochess@V3_1');
  const summary = summaryWith([
    { name: '甲', isBot: false, bonds: [{ bondId: 'ursusShip', count: 6, layers: 40, active: true }] },
  ]);
  LOBBY.prototype._recordEchoBoard.call(lobby, room, summary);
  await new Promise((r) => setTimeout(r, 0));

  const hset = cmds.find((c) => c[0] === 'HSET');
  assert.ok(hset, '要写明细');
  const detail = JSON.parse(hset[3]);
  const core = detail.squads[0].cores[0];
  assert.notEqual(core, 'ursusShip', `不该是 bondId，实际 ${core}`);
  assert.equal(core, '乌萨斯', `应当是中文名，实际 ${core}`);
});

test('宿主房（规程）：AI 队友不上榜（players 与 squads 都不含）', async () => {
  const { store, cmds } = makeStore();
  const lobby = lobbyWith(store);
  const room = hostedRoom('act3autochess@V3_1');
  const summary = summaryWith([
    { name: '叶', isBot: false, bonds: [{ bondId: 'indomShip', count: 6, layers: 30, active: true }] },
    { name: 'AI·华法琳', isBot: true, bonds: [{ bondId: 'siracusaShip', count: 6, layers: 20, active: true }] },
    { name: 'AI·阿米娅', isBot: true, bonds: [{ bondId: 'kazimierzShip', count: 6, layers: 10, active: true }] },
  ]);
  LOBBY.prototype._recordEchoBoard.call(lobby, room, summary);
  await new Promise((r) => setTimeout(r, 0));

  const hset = cmds.find((c) => c[0] === 'HSET');
  const detail = JSON.parse(hset[3]);
  assert.deepEqual(detail.players, ['叶'], `players 只该留真人，实际 ${JSON.stringify(detail.players)}`);
  assert.equal(detail.squads.length, 1, 'squads 只该留真人');
  assert.equal(detail.squads[0].name, '叶');
});

test('第二期下半（本进程 Match）行为不变：只留真人、盟约中文名', async () => {
  const { store, cmds } = makeStore();
  const def = getVersionData('act2autochess', { log: QUIET });
  const lobby = lobbyWith(store, { data: () => def });
  const fakeGd = { bond: (id) => def.bonds[id] || null };
  const players = [
    { name: '真', isBot: false, bonds: {}, layers: {}, bondPeak: { top: 'siracusaShip', maxLayers: 88, bonds: 3 } },
    { name: 'AI·假', isBot: true, bonds: {}, layers: {}, bondPeak: { top: 'yanShip', maxLayers: 10, bonds: 1 } },
  ];
  const room = { code: 'EMMA', matchCount: 1, difficulty: 'HARD', version: 'act2autochess', match: { echoVariant: 'deepecho', echoDiveStart: 1, round: 12, seed: 9, startedAt: 1_700_000_000_000, gd: fakeGd, order: players } };
  LOBBY.prototype._recordEchoBoard.call(lobby, room, summaryWith([]));
  await new Promise((r) => setTimeout(r, 0));

  const hset = cmds.find((c) => c[0] === 'HSET');
  const detail = JSON.parse(hset[3]);
  assert.deepEqual(detail.players, ['真'], 'AI 不上榜');
  assert.equal(detail.squads.length, 1);
  assert.equal(detail.squads[0].cores[0], '叙拉古', '盟约中文名');
});
