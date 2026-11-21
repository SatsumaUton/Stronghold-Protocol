// test/match/dive-board-hosted.test.js —— 规程房（跑在版本宿主里）的深潜成绩也要写进榜
// （玩家 2026-11-21：「昨天在规程版本中玩了深渊回响没有记录」）。
//
// 根因：`_recordEchoBoard` 只认 `room.match` 上的 `echoVariant` / `echoDiveStart` / `gd` / `order`。
// 规程房跑在版本宿主里，`room.match` 是 MatchProxy（只有 hosted / opts / roomCode / ended …），
// 所以函数第一行就 return —— 深度榜里只有默认版本的成绩（Redis 只有 dive:board:HARD 等三张键）。
//
// 修法：优先读结算回传的 summary（buildResult 的 m.result 已带 variant / echoDepth / echoDiveStart /
// version / seed / durationMs / players[].bonds）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';

const LOBBY_CLS = /** @type {any} */ (Lobby);

/** 一个只记录命令的假 Redis store。 */
const makeStore = () => {
  const cmds = [];
  return {
    cmds,
    store: { prefix: '', client: { command: (...args) => { cmds.push(args); return Promise.resolve([]); } } },
  };
};

/** 一个 MatchProxy 形状的 room.match：没有 echoVariant / echoDiveStart / gd / order。 */
const proxyLike = () => ({
  hosted: true, matchId: 'm1', opts: {}, roomCode: 'EMMC',
  started: true, ended: true, disposed: false, forgotten: false,
});

/** Lobby 实例只用来读 this.persistStore / this.now() / this._archiveEchoBoard。 */
const fakeLobby = (store) => ({
  persistStore: store,
  now: () => 1_700_000_000_000,
  _archiveEchoBoard: () => {},
});

test('版本宿主的深潜（room.match 是 MatchProxy）也会写榜，且键带版本', async () => {
  const { store, cmds } = makeStore();
  const lobby = fakeLobby(store);
  const room = {
    code: 'EMMC', matchCount: 1, difficulty: 'HARD', version: 'act3autochess@V3_1',
    match: proxyLike(),
  };
  const summary = {
    variant: 'deepecho', echoDepth: 12, echoDiveStart: 1, victory: false,
    seed: 1234, durationMs: 3_600_000, roundsPassed: 12,
    players: [
      { name: '甲', bonds: [{ bondId: 'siracusaShip', count: 6, layers: 120, active: true }, { bondId: 'raidShip', count: 3, layers: 0, active: false }] },
    ],
  };

  LOBBY_CLS.prototype._recordEchoBoard.call(lobby, room, summary);
  // recordEchoBoard 是 fire-and-forget（内部多个 await），等一拍让命令落下
  await new Promise((r) => setTimeout(r, 0));

  const zadd = cmds.find((c) => c[0] === 'ZADD');
  assert.ok(zadd, '要有一条 ZADD（旧代码在这里直接 return，cmds 是空的）');
  assert.ok(zadd[1].includes('dive:board:HARD:act3autochess@V3_1'), `版本键：${zadd[1]}`);
  assert.equal(zadd[2], '12', '分数 = 深度');

  const hset = cmds.find((c) => c[0] === 'HSET');
  assert.ok(hset, '明细也要写');
  const detail = JSON.parse(hset[3]);
  assert.equal(detail.version, 'act3autochess@V3_1', '明细记版本');
  assert.equal(detail.echoDepth === undefined, true, '明细不存 echoDepth（用 round 字段）');
  assert.deepEqual(detail.players, ['甲'], '玩家名从 summary.players 取');
  // 核心盟约取「已激活 + 层数最高」那条；没有 gd 时名字退回 bondId
  assert.equal(detail.squads[0].cores[0], 'siracusaShip', '核心盟约（无 gd 时用 id）');
  assert.equal(detail.squads[0].maxLayers, 120, '最高层数');
  assert.equal(detail.squads[0].bonds, 2, '在用盟约数 = count>0 的条数（两条都 count>0）');
});

test('默认版本房（本进程 Match）行为不变：仍按原口径写', () => {
  const { store, cmds } = makeStore();
  const lobby = fakeLobby(store);
  const room = { code: 'EMMA', matchCount: 1, difficulty: 'HARD', version: 'act2autochess', match: { echoVariant: 'deepecho', echoDiveStart: 1, round: 12, seed: 9, startedAt: 1_700_000_000_000, gd: null, order: [] } };
  const summary = { variant: 'deepecho', echoDepth: 12, victory: false, players: [] };
  LOBBY_CLS.prototype._recordEchoBoard.call(lobby, room, summary);
  const zadd = cmds.find((c) => c[0] === 'ZADD');
  assert.ok(zadd, '默认版本也写');
  assert.ok(!zadd[1].includes('act2autochess'), '默认版本沿用旧键（无版本后缀）');
});

test('非深潜房、调参房、作弊房一律不写', () => {
  for (const [label, room, summary] of [
    ['普通房', { code: 'A', matchCount: 1, difficulty: 'HARD', version: 'act2autochess', match: {} }, { victory: true }],
    ['调参房', { code: 'B', matchCount: 1, difficulty: 'HARD', version: 'act3autochess@V3_1', echoCfg: {}, match: proxyLike() }, { variant: 'deepecho', echoDepth: 5 }],
    ['作弊房', { code: 'C', matchCount: 1, difficulty: 'HARD', version: 'act3autochess@V3_1', experimental: { cheatConsole: true }, match: proxyLike() }, { variant: 'deepecho', echoDepth: 5 }],
  ]) {
    const { store, cmds } = makeStore();
    const lobby = fakeLobby(store);
    LOBBY_CLS.prototype._recordEchoBoard.call(lobby, room, summary);
    assert.equal(cmds.filter((c) => c[0] === 'ZADD').length, 0, `${label} 不该写榜`);
  }
});
