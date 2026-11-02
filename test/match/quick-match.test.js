// 多人匹配：room.quickMatch（大厅按钮）+「人满即开」。
//
// 本服是 30 个独立节点进程，每个 Lobby 只认识自己那批房间，所以 quickMatch **不做跨节点配对**：
//   1. 先找本节点上「正在匹配 + 还缺人 + 在公开列表上」的合作房，人最多的优先（更快凑满）；
//   2. 找不到就自己开一间、挂到公开同盟、立刻进入匹配状态；
//   3. 已经在一个房间里就拒绝（页面只在大厅显示这个按钮）。
// 开局由既有机制负责：匹配超时（MATCHMAKING_TIMEOUT_MS）或「人满即开」——这一条是本功能新加的：
// 匹配的目的就是凑齐人，满员了还要房主再点一次「开始」是多余的；但只有 1 个真人时不算（AI 占座不算匹配到人）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, MULTI_SEAT_DEFAULT } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { ERR } from '../../shared/constants.js';
import { experimentalRuleChanged } from '../../shared/experimental.js';

// 仓库里的 data/create-room.json 存的是「关闭建房」（公开仓库不默认开放），
// 这些用例只关心 quickMatch / 人满即开的逻辑，与运维开关无关，所以先忽略开关文件。
process.env.SP_GATE_IGNORE = '1';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

let seq = 0;
function player(name) {
  seq += 1;
  return { playerId: `p_${seq}`, accountId: `acc_${seq}`, name, connected: true, ws: null };
}

const makeLobby = () => new Lobby({ registry: new SessionRegistry(), log: silent });

/** 一间合作房（capacity 默认 4，本服合作房的下限）。 */
function coopRoom(lobby, capacity = 4, extra = {}) {
  const host = player('Host');
  const created = lobby.create(host, {
    mode: 'coop', difficulty: 'NORMAL',
    experimental: { revivalEnabled: false, disableSharedPool: false, playerCapacity: capacity, ...extra },
  });
  assert.deepEqual(created, { ok: true }, '建房成功');
  return { host, room: lobby.roomOf(host) };
}

// ------------------------------------------------------------------ 没有可加入的房间

test('没人匹配时：自己开一间、挂上公开同盟、直接进入匹配', () => {
  const lobby = makeLobby();
  const solo = player('Solo');
  const res = lobby.quickMatch(solo, {});
  assert.equal(res.ok, true, 'quickMatch 成功');
  assert.deepEqual(
    { joined: res.reply.joined, matchmaking: res.reply.matchmaking },
    { joined: false, matchmaking: true },
    '这是新建的房间，并且已经在匹配',
  );
  const room = lobby.roomOf(solo);
  assert.equal(room.code, res.reply.code, '答复里的 code 就是我进的房间');
  assert.equal(room.hostId, solo.playerId, '我是房主');
  assert.equal(room.listed, true, '自动挂到公开同盟（否则别人点「公开同盟」看不见）');
  assert.equal(room.matchmaking, true, '进入匹配状态');
  assert.equal(room.toState().matchmaking, true, 'state 里也带着 matchmaking');
});

test('指定难度时按难度开房', () => {
  const lobby = makeLobby();
  const solo = player('Solo');
  lobby.quickMatch(solo, { difficulty: 'HARD' });
  assert.equal(lobby.roomOf(solo).difficulty, 'HARD');
});

// ------------------------------------------------------------------ 有可加入的房间

test('有房间正在等人：直接塞进去，不另开一间', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  assert.deepEqual(lobby.setListed(host, { listed: true }), { ok: true });
  assert.deepEqual(lobby.matchmaking(host, { on: true }), { ok: true }, '房主开始匹配');

  const before = lobby.rooms.size;
  const other = player('Other');
  const res = lobby.quickMatch(other, {});
  assert.equal(res.reply.joined, true, '是加入，不是新建');
  assert.equal(res.reply.code, room.code, '进的就是那间房');
  assert.equal(lobby.rooms.size, before, '没有多开房间');
  assert.equal(lobby.roomOf(other), room, '座位落在了那间房里');
  assert.equal(room.activeHumans().length, 2, '房间现在两个人');
});

test('匹配中的房间人最多者优先（更快凑满开局）', () => {
  const lobby = makeLobby();
  const a = coopRoom(lobby, 4);
  lobby.setListed(a.host, { listed: true });
  lobby.matchmaking(a.host, { on: true });

  const b = coopRoom(lobby, 4);
  lobby.setListed(b.host, { listed: true });
  lobby.matchmaking(b.host, { on: true });
  // b 房再多一个人：两间都在等人，应该优先选 b（人多的那间）
  const bGuest = player('BGuest');
  assert.deepEqual(lobby.join(bGuest, { code: b.room.code }), { ok: true });

  const third = player('Third');
  const res = lobby.quickMatch(third, {});
  assert.equal(res.reply.joined, true);
  assert.equal(res.reply.code, b.room.code, '优先进入人多的那间');
});

test('没有在匹配的房间时不会去挤一个普通房', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  lobby.setListed(host, { listed: true });          // 公开，但没开匹配
  const solo = player('Solo');
  const res = lobby.quickMatch(solo, {});
  assert.equal(res.reply.joined, false, '普通房不该被「多人匹配」硬塞人');
  assert.notEqual(lobby.roomOf(solo), room);
});

test('已经在房间里：拒绝（页面只在大厅显示这个按钮）', () => {
  const lobby = makeLobby();
  const { host } = coopRoom(lobby, 4);
  const res = lobby.quickMatch(host, {});
  assert.equal(res.error, ERR.SESSION_IN_USE);
});

test('游客：交给 create 的既有规则拒绝', () => {
  const lobby = makeLobby();
  const guest = { ...player('Guest'), guest: true, accountId: null };
  const res = lobby.quickMatch(guest, {});
  assert.equal(res.error, ERR.BAD_MSG);
  assert.match(res.detail, /游客/);
  assert.equal(lobby.rooms.size, 0, '没有留下半间房');
});

// ------------------------------------------------------------------ 人满即开

/** 替换 startMatch，只记录「要不要开局」，不真的跑一局。 */
function spyStart(lobby) {
  const calls = [];
  lobby.startMatch = (room, key) => { calls.push({ room, key }); };
  return calls;
}

test('人满即开：四个真人坐满 4 人房，扫描时直接开局，不用房主再点开始', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  assert.deepEqual(lobby.setListed(host, { listed: true }), { ok: true });
  assert.deepEqual(lobby.matchmaking(host, { on: true }), { ok: true });

  for (const n of ['G1', 'G2', 'G3']) {
    assert.deepEqual(lobby.join(player(n), { code: room.code }), { ok: true });
  }
  assert.equal(room.activeHumans().length, 4);
  assert.equal(room.freeSeat(), -1, '确实满了');

  const calls = spyStart(lobby);
  lobby.sweepOldRooms();
  assert.equal(calls.length, 1, '扫描时开了一局');
  assert.equal(calls[0].room, room);
  assert.equal(room.matchmaking, false, '开局后匹配状态清掉');
});

test('人满但只有一个真人（AI 占座）不算匹配到：不开局，等超时', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  // 房主加满 AI，座位占满但只有 1 个真人
  for (let i = 0; i < 3; i++) assert.deepEqual(lobby.addBot(host), { ok: true });
  assert.equal(room.freeSeat(), -1, '座位满了，但只有 1 个真人');

  const calls = spyStart(lobby);
  lobby.sweepOldRooms();
  assert.equal(calls.length, 0, '不该因为 AI 占座就开局');
  assert.equal(room.matchmaking, true, '继续等');
});

test('匹配中的房间不会被解散计时扫走', () => {
  const lobby = makeLobby();
  const solo = player('Solo');
  lobby.quickMatch(solo, {});
  const room = lobby.roomOf(solo);
  // 把人推到很久以前，正常情况下早该过期
  room.createdAt = 0;
  lobby.sweepOldRooms();
  assert.equal(room.disposed, false, '匹配中的房间保留');
});

// ------------------------------------------------- 人数范围 / 规则（MatchScope 的两个维度）

test('规则默认只找标准房：4 人房带 playerCapacity 不算「改过规则」', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  assert.equal(experimentalRuleChanged(room.experimental), false, '4 人房只带 playerCapacity，规则没动');
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  const res = lobby.quickMatch(player('Other'), { rules: 'standard' });
  assert.equal(res.reply.joined, true, '标准规则能找到这间房');
  assert.equal(res.reply.code, room.code);
});

test('规则要 experimental 时跳过标准房，自己开一间改过规则的', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  const other = player('Other');
  const res = lobby.quickMatch(other, { rules: 'experimental' });
  assert.equal(res.reply.joined, false, '没有改过规则的房，所以自己开');
  assert.notEqual(res.reply.code, room.code, '不是那一间标准房');
});

test('改过规则的房会被 experimental 找到：revivalEnabled 就是改规则', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4, { revivalEnabled: true });
  assert.equal(experimentalRuleChanged(room.experimental), true);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  const res = lobby.quickMatch(player('Other'), { rules: 'experimental' });
  assert.equal(res.reply.joined, true);
  assert.equal(res.reply.code, room.code);
});

test('人数要 four 时不进 8 人房', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  assert.equal(room.capacity, 8);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  const other = player('Other');
  const res = lobby.quickMatch(other, { seats: 'four' });
  assert.equal(res.reply.joined, false, '8 人房不算 4 人同盟');
  assert.notEqual(res.reply.code, room.code);
});

test('人数要 multi 时进 8 人房，自己开时也开 8 人', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  const res = lobby.quickMatch(player('Other'), { seats: 'multi' });
  assert.equal(res.reply.joined, true);
  assert.equal(res.reply.code, room.code);

  // 没有可加入的 8 人房时，自己开的那间也应该是 8 人
  const lobby2 = makeLobby();
  const solo = player('Solo2');
  lobby2.quickMatch(solo, { seats: 'multi' });
  assert.equal(lobby2.roomOf(solo).capacity, MULTI_SEAT_DEFAULT, '自己开的是多人同盟');
});

test('seats: both 两种房都能进，但优先人多的那间', () => {
  const lobby = makeLobby();
  const four = coopRoom(lobby, 4);
  lobby.setListed(four.host, { listed: true });
  lobby.matchmaking(four.host, { on: true });
  const multi = coopRoom(lobby, 8);
  lobby.setListed(multi.host, { listed: true });
  lobby.matchmaking(multi.host, { on: true });
  // 给 8 人房多塞一个人，让它人更多
  lobby.join(player('MGuest'), { code: multi.room.code });

  const res = lobby.quickMatch(player('Third'), { seats: 'both' });
  assert.equal(res.reply.joined, true);
  assert.equal(res.reply.code, multi.room.code, '人多的 8 人房优先');
});