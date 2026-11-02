// 多人匹配：room.quickMatch 的**排队**语义 +「人满即开」。
//
// 本服是 30 个独立节点进程，每个 Lobby 只认识自己那批房间，所以 quickMatch 不做跨节点配对：
//   1. 先找本节点上「正在匹配 + 还缺人 + 在公开列表上」的合作房，人最多的优先（更快凑满）；
//   2. **找不到就排队等**（维护者 2026-11-02：不要替玩家开一间房让他在房间里等）——
//      返回 { queued: true, ticket, state }，前端停在「搜寻中」界面轮询 room.quickState；
//   3. 已经在一个房间里就拒绝（页面只在大厅显示这个按钮）。
// 成形由 sweepQuickQueue 负责：池（难度 + 人数 + 规则）里等够 capacity 个人，或者最老的一个
// 等满 MATCHMAKING_TIMEOUT_MS。成形后第一个人当房主建房、其余人加入，然后**立刻开局**
// （forceStartMatchmaking），所以玩家不用再在房间里点开始。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, MULTI_SEAT_DEFAULT } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { ERR } from '../../shared/constants.js';
import { experimentalRuleChanged } from '../../shared/experimental.js';

// 仓库里的 data/create-room.json 存的是「关闭建房」（公开仓库不默认开放），
// 这些用例只关心 quickMatch / 排队的逻辑，与运维开关无关，所以先忽略开关文件。
process.env.SP_GATE_IGNORE = '1';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

let seq = 0;
function player(name) {
  seq += 1;
  return { playerId: `p_${seq}`, accountId: `acc_${seq}`, name, connected: true, ws: null };
}

function makeLobby() {
  return new Lobby({ registry: new SessionRegistry(), log: silent });
}

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

// -------------------------------------------------- 没人可加入：排队，不开房

test('没人匹配时：进队列等着，不给玩家开房', () => {
  const lobby = makeLobby();
  const solo = player('Solo');
  const res = lobby.quickMatch(solo, {});
  assert.equal(res.ok, true, 'quickMatch 成功');
  assert.equal(res.reply.queued, true, '是排队，不是建房');
  assert.equal(typeof res.reply.ticket, 'string', '给了票据号');
  assert.equal(res.reply.state.state, 'queued');
  assert.equal(lobby.roomOf(solo), null, '★ 没有给玩家开房间');
  assert.equal(lobby.rooms.size, 0, '★ 一间房都没建');
});

test('排队状态里有位置、等待人数、还差几人', () => {
  const lobby = makeLobby();
  const a = player('A');
  lobby.quickMatch(a, { difficulty: 'HARD' });
  const res = lobby.quickMatch(player('B'), { difficulty: 'HARD' });
  assert.equal(res.reply.state.waiting, 2, '两个人都在这个池里');
  assert.equal(res.reply.state.position, 2, 'B 排第二');
  assert.equal(res.reply.state.need, 2, '4 人房还差 2 人');
  assert.equal(res.reply.state.difficulty, 'HARD');
});

test('指定难度时按难度排队', () => {
  const lobby = makeLobby();
  const res = lobby.quickMatch(player('Solo'), { difficulty: 'HARD' });
  assert.equal(res.reply.state.difficulty, 'HARD');
  assert.equal(lobby.rooms.size, 0);
});

test('已经有房间：拒绝（页面只在大厅显示这个按钮）', () => {
  const lobby = makeLobby();
  const { host } = coopRoom(lobby, 4);
  const res = lobby.quickMatch(host, {});
  assert.equal(res.error, ERR.SESSION_IN_USE, '已经在房间里');
});

test('游客：交给既有规则拒绝', () => {
  const lobby = makeLobby();
  const guest = { playerId: '', accountId: '', name: 'Guest', connected: true, ws: null };
  const res = lobby.quickMatch(guest, {});
  assert.equal(res.error, ERR.BAD_MSG, '游客不能排队');
});

// -------------------------------------------------- 有可加入的房间：直接进

test('有房间正在等人：直接塞进去，不排队', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  assert.deepEqual(lobby.setListed(host, { listed: true }), { ok: true });
  assert.deepEqual(lobby.matchmaking(host, { on: true }), { ok: true }, '房主开始匹配');

  const before = lobby.rooms.size;
  const other = player('Other');
  const res = lobby.quickMatch(other, {});
  assert.equal(res.reply.joined, true, '是加入，不是排队');
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
  const bGuest = player('BGuest');
  assert.deepEqual(lobby.join(bGuest, { code: b.room.code }), { ok: true });

  const third = player('Third');
  const res = lobby.quickMatch(third, {});
  assert.equal(res.reply.joined, true);
  assert.equal(res.reply.code, b.room.code, '优先进入人多的那间');
});

test('没有在匹配的房间时不会去挤一个普通房', () => {
  const lobby = makeLobby();
  const { room } = coopRoom(lobby, 4);
  const other = player('Other');
  const res = lobby.quickMatch(other, {});
  assert.equal(res.reply.joined, undefined, '没有进那间普通房');
  assert.equal(res.reply.queued, true, '而是排队');
  assert.equal(lobby.roomOf(other), null);
  assert.equal(room.activeHumans().length, 1, '普通房里还是只有房主');
});

// -------------------------------------------------- 队列成形

test('凑够人数就成形：建房 + 立刻开局，不用房主点开始', () => {
  const lobby = makeLobby();
  const players = [player('A'), player('B'), player('C'), player('D')];
  for (const p of players) lobby.quickMatch(p, { difficulty: 'NORMAL' });
  assert.equal(lobby.rooms.size, 0, '还没凑够之前一间房都没有');
  lobby.sweepQuickQueue();
  assert.equal(lobby.rooms.size, 1, '凑够 4 人后建了一间房');
  for (const p of players) {
    const room = lobby.roomOf(p);
    assert.ok(room, '每个人都在同一间房里');
    assert.equal(room.code, lobby.rooms.keys().next().value);
  }
  const room = lobby.roomOf(players[0]);
  assert.ok(room.match, '★ 直接开局了，不需要房主再点开始');
});

test('票据在成形后能查到房间码（前端靠它跳进对局）', () => {
  const lobby = makeLobby();
  const players = [player('A'), player('B'), player('C'), player('D')];
  const tickets = players.map((p) => lobby.quickMatch(p, { difficulty: 'NORMAL' }).reply.ticket);
  lobby.sweepQuickQueue();
  const room = lobby.roomOf(players[0]);
  const st = lobby.quickState(players[0], { ticket: tickets[0] });
  assert.equal(st.ok, true);
  assert.equal(st.reply.state, 'matched');
  assert.equal(st.reply.code, room.code, '拿到房间码');
});

test('等满超时也成形（只有 1 个人时也不会无限等）', () => {
  const lobby = makeLobby();
  const solo = player('Solo');
  lobby.quickMatch(solo, { difficulty: 'NORMAL' });
  // 把排队时间推到超时之前：还不该成形
  lobby.sweepQuickQueue();
  assert.equal(lobby.rooms.size, 0, '刚排队，不成形');
  // 手动把 createdAt 推到很久以前
  const entry = [...lobby.quickQueue.values()][0];
  entry.createdAt = Date.now() - 3 * 60 * 1000;
  lobby.sweepQuickQueue();
  assert.equal(lobby.rooms.size, 1, '超时后成形');
});

test('取消匹配：票据从队列里拿掉', () => {
  const lobby = makeLobby();
  const solo = player('Solo');
  const res = lobby.quickMatch(solo, {});
  const ticket = res.reply.ticket;
  assert.equal(lobby.quickLeave(solo, { ticket }).reply.state, 'left');
  assert.equal(lobby.quickQueue.size, 0, '队列里没有他了');
  lobby.sweepQuickQueue();
  assert.equal(lobby.rooms.size, 0, '取消后不会给他建房');
});

test('别人的票据查不到（不能拿别人的 ticket 偷状态）', () => {
  const lobby = makeLobby();
  const a = player('A');
  const b = player('B');
  const ticket = lobby.quickMatch(a, {}).reply.ticket;
  assert.ok(lobby.quickState(b, { ticket }).error, '查不到别人的票据');
  assert.ok(lobby.quickLeave(b, { ticket }).error, '撤不掉别人的票据');
});

// -------------------------------------------------- 人数 / 规则范围

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

test('人数要 four 时不进 8 人房', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  assert.equal(room.capacity, 8);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  const res = lobby.quickMatch(player('Other'), { seats: 'four' });
  assert.equal(res.reply.joined, undefined, '8 人房不算 4 人同盟');
  assert.equal(res.reply.queued, true);
  assert.notEqual(res.reply.code, room.code);
});

test('人数要 multi 时进 8 人房', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  const res = lobby.quickMatch(player('Other'), { seats: 'multi' });
  assert.equal(res.reply.joined, true);
  assert.equal(res.reply.code, room.code);
});

test('多人同盟排队时的容量是 MULTI_SEAT_DEFAULT', () => {
  const lobby = makeLobby();
  const res = lobby.quickMatch(player('Solo'), { seats: 'multi' });
  assert.equal(res.reply.state.capacity, MULTI_SEAT_DEFAULT, '多人池按 MULTI_SEAT_DEFAULT 人算');
});

test('seats: both 两种房都能进，但优先人多的那间', () => {
  const lobby = makeLobby();
  const four = coopRoom(lobby, 4);
  lobby.setListed(four.host, { listed: true });
  lobby.matchmaking(four.host, { on: true });
  const multi = coopRoom(lobby, 8);
  lobby.setListed(multi.host, { listed: true });
  lobby.matchmaking(multi.host, { on: true });
  lobby.join(player('MGuest'), { code: multi.room.code });

  const res = lobby.quickMatch(player('Third'), { seats: 'both' });
  assert.equal(res.reply.joined, true);
  assert.equal(res.reply.code, multi.room.code, '人多的 8 人房优先');
});

// -------------------------------------------------- 人满即开（房间侧，与排队无关）

test('人满即开：四个真人坐满 4 人房，扫描时直接开局', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  for (const name of ['B', 'C', 'D']) lobby.join(player(name), { code: room.code });
  assert.equal(room.activeHumans().length, 4, '四个真人');
  lobby.sweepOldRooms();
  assert.ok(room.match, '满员即开局');
});

test('人满但只有一个真人（AI 占座）不算匹配到：不开局', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  for (let i = 0; i < 3; i += 1) lobby.addBot(host, {});
  assert.equal(room.freeSeat(), -1, '座位被 AI 占满');
  lobby.sweepOldRooms();
  assert.equal(room.match, null, '只有一个真人，不算匹配到人');
});

test('匹配中的房间不会被解散计时扫走', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 4);
  lobby.setListed(host, { listed: true });
  lobby.matchmaking(host, { on: true });
  room.createdAt = 0;
  lobby.sweepOldRooms();
  assert.equal(room.disposed, false, '匹配中的房间保留');
});
