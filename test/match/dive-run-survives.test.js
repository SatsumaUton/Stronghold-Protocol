// test/match/echo-run-survives.test.js —— 深潜「卡死 / 恢复失败」也要留下成绩，且开局 modeId 按版本取
// （玩家 2026-11-25：深潜最高难度打到 63 层卡死，出来排行榜没有记录；「给个 62 层记录也行」）。
//
// 两个根因：
//   ① `_recordEchoBoard` 只认 summary.variant==='deepecho'（自然结算）或本进程 Match；
//      宿主对局**异常结束**时两样都没有 → 一条记录都不写。
//   ② 恢复房间时 `room.modeId` 没进存档，退回 `modeIdFor()` 拼出的 `mode_single_<难度>` ——
//      规程的单人是 `mode_single_15/16…`，没有这个 id，宿主拒绝建局（`mode_single_abyss is unavailable`）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { getVersionData } from '../../server/data.js';

const LOBBY = /** @type {any} */ (Lobby);
const QUIET = { warn() {}, error() {}, info() {} };

const makeStore = () => {
  const cmds = [];
  return { cmds, store: { prefix: '', client: { command: (...a) => { cmds.push(a); return Promise.resolve([]); } } } };
};

// 用原型实例做桩：`recordAbortedEchoRun` 内部会 `this._recordEchoBoard(...)`，普通对象取不到原型方法。
const lobbyWith = (store, versions = null) => Object.assign(Object.create(LOBBY.prototype), {
  persistStore: store,
  versions,
  log: { info() {}, warn() {}, error() {} },
  now: () => 1_700_000_000_000,
  _archiveEchoBoard: () => {},
});

/** 卡死现场：宿主房（MatchProxy 形状）+ 房间记得的最后回合。 */
const hungRoom = (over = {}) => ({
  code: 'HUHG', matchCount: 1, difficulty: 'ABYSS', version: 'act3autochess@V3_1',
  variant: 'deepecho',
  liveRound: 63,
  seats: [
    { name: '玩家甲', isBot: false },
    { name: 'AI·华法琳', isBot: true },
  ],
  match: { hosted: true, roomCode: 'HUHG', opts: {}, round: 63, phase: 'BATTLE' },
  ...over,
});

test('宿主对局卡死（version-hang）：按最后回合记一条成绩，深度不丢', async () => {
  const { store, cmds } = makeStore();
  const lobby = lobbyWith(store);
  // 卡死时 summary 只有 reason，没有 variant
  LOBBY.prototype._recordEchoBoard.call(lobby, hungRoom(), { reason: 'version-hang', detail: 'no heartbeat for 19 s' });
  await new Promise((r) => setTimeout(r, 0));

  const zadd = cmds.find((c) => c[0] === 'ZADD');
  assert.ok(zadd, '必须写一条 ZADD（修前这里是空的）');
  assert.equal(zadd[2], '63', `分数=深度 63，实际 ${zadd[2]}`);
  assert.ok(zadd[1].includes('act3autochess@V3_1'), `键要带版本：${zadd[1]}`);

  const detail = JSON.parse(cmds.find((c) => c[0] === 'HSET')[3]);
  assert.deepEqual(detail.players, ['玩家甲'], '只留真人');
  assert.equal(detail.victory, false, '卡死不算通关');
  assert.deepEqual(detail.squads, [], '拿不到盟约明细就留空');
});

test('恢复失败（abortRestoredMatch）：清 liveRound 之前也把深度记下来', async () => {
  const { store, cmds } = makeStore();
  const lobby = lobbyWith(store);
  const room = hungRoom({ liveRound: 62 });
  LOBBY.prototype.recordAbortedEchoRun.call(lobby, room, 'restart-abort');
  await new Promise((r) => setTimeout(r, 0));
  const zadd = cmds.find((c) => c[0] === 'ZADD');
  assert.ok(zadd, '恢复失败也要留记录');
  assert.equal(zadd[2], '62', '用房间最后的回合当深度');
});

test('非深潜房 / 没有进度时一行都不写', async () => {
  for (const [label, room] of [
    ['普通房', hungRoom({ variant: null })],
    ['还没开始', hungRoom({ liveRound: 0 })],
    ['调参房', hungRoom({ echoCfg: { bounty: false } })],
    ['作弊房', hungRoom({ experimental: { cheatConsole: true } })],
  ]) {
    const { store, cmds } = makeStore();
    const lobby = lobbyWith(store);
    LOBBY.prototype._recordEchoBoard.call(lobby, room, { reason: 'version-hang' });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(cmds.filter((c) => c[0] === 'ZADD').length, 0, `${label} 不该写榜`);
  }
});

test('开局 modeId：规程单人按难度取版本里真实存在的模式（不是 mode_single_abyss）', () => {
  const reg = getVersionData('act3autochess@V3_1', { log: QUIET });
  const modes = Object.entries(reg.config.modes).map(([id, rec]) => ({ id, difficulty: rec && rec.difficulty }));
  const versions = {
    modesOf: (v, mode) => (mode === 'solo' ? modes.filter((m) => m.id.startsWith('mode_single')) : []),
    laddered: () => true,
  };
  const lobby = { versions, versionModes: (v, m) => versions.modesOf(v, m) };
  const id = LOBBY.prototype.officialModeId.call(lobby, { mode: 'solo', difficulty: 'ABYSS', version: 'act3autochess@V3_1' });
  assert.ok(id && /^mode_single_/.test(id), `应得到规程的单人模式，实际 ${id}`);
  assert.notEqual(id, 'mode_single_abyss', '规程没有 mode_single_abyss');
  // 必须是该版本 ABYSS 难度下的模式
  const rec = reg.config.modes[id];
  assert.equal(rec && rec.difficulty, 'ABYSS', `${id} 的难度应为 ABYSS`);
});

test('开局 modeId：默认版本仍用 mode_single_abyss（没有 versions 服务时也一样）', () => {
  const lobby = { versions: null, versionModes: () => [] };
  const id = LOBBY.prototype.officialModeId.call(lobby, { mode: 'solo', difficulty: 'ABYSS', version: 'act2autochess' });
  assert.equal(id, 'mode_single_abyss');
  // 房间已经记着 modeId 时优先用它
  const id2 = LOBBY.prototype.officialModeId.call(lobby, { mode: 'solo', difficulty: 'ABYSS', version: 'act2autochess', modeId: 'mode_single_hard' });
  assert.equal(id2, 'mode_single_hard');
});
