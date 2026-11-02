// 公开同盟（同盟列表）：room.setListed / room.list —— 回归测试。
//
// 玩家在大厅点「公开同盟」能看见别人挂出来的合作房，点进去直接加入。
// 守住的规则（对参考版 server/lobby.js 的 listable / roomOpen / setListed / roomList）：
//   1. 只有房主能挂 / 摘，且只能在对局开始前；
//   2. 只有「合作、自己建的、非测试、无玩法插件」的房能挂（ROOM_LIST_MIN_CAPACITY = MAX_SEATS = 4，
//      也就是本服所有合作房都能挂 —— 参考版取 8 是因为它只有 4/8/12/16/20 五个档位）；
//   3. 挂上以后 room.state 里出现 listed，摘下来就消失（默认房间的 state 一个字节都不变）；
//   4. room.list 只回真正在等人的房：满员 / 已开局 / 房主掉线 / 摘掉的都不出现；
//   5. room.list 的答复形状是 { ok: true, reply: { rooms } }，且不含 playerId / 地址 / 座位明细；
//   6. 列表按空位升序（同样多则先建的在前），并且 ROOM_LIST_CACHE_MS 内共用一次扫描。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { ERR, MAX_SEATS, ROOM_LIST_MIN_CAPACITY } from '../../shared/constants.js';

// 仓库里的 data/create-room.json 存的是「关闭建房」（公开仓库不默认开放），
// 这个文件只用 create() 搭房间，跟运维开关无关。
process.env.SP_GATE_IGNORE = '1';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

let seq = 0;
/** 一个玩家会话。 */
function player(name) {
  seq += 1;
  return { playerId: `p_${seq}`, accountId: `acc_${seq}`, name, connected: true, ws: null };
}

/** 建一个合作房，容量 capacity（>= 8 才可能挂上列表）。 */
function makeLobby() {
  return new Lobby({ registry: new SessionRegistry(), log: silent });
}

function coopRoom(lobby, capacity = 8, extra = {}) {
  const host = player('Host');
  const created = lobby.create(host, {
    mode: 'coop', difficulty: 'NORMAL',
    experimental: { revivalEnabled: false, disableSharedPool: false, playerCapacity: capacity, ...extra },
  });
  assert.deepEqual(created, { ok: true }, '建房成功');
  return { host, room: lobby.roomOf(host) };
}

// ---------------------------------------------------------------- 能不能挂

test('8 人合作房可以挂上同盟列表，room.state 出现 listed', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  assert.equal(room.listed, false, '默认不挂');
  assert.equal(room.toState().listed, undefined, '没挂时 state 里没有这个键');

  assert.deepEqual(lobby.setListed(host, { listed: true }), { ok: true });
  assert.equal(room.listed, true);
  assert.equal(room.toState().listed, true, '挂上后 state.listed = true');

  assert.deepEqual(lobby.setListed(host, { listed: false }), { ok: true });
  assert.equal(room.listed, false);
  assert.equal(room.toState().listed, undefined, '摘下来后又没有这个键了');
});

test('listable 谓词逐条判定：容量 / 模式 / 来源 / 测试房 / 玩法插件', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  assert.equal(lobby.listable(room), true, '正常的 8 人合作房');

  // 容量低于门槛（本服门槛 = 4，正常房不可能低于它，这里直接伪造一个）
  const savedCapacity = room.capacity;
  room.capacity = ROOM_LIST_MIN_CAPACITY - 1;
  assert.equal(lobby.listable(room), false, '容量不够');
  room.capacity = savedCapacity;

  // 匹配器配出来的房不能再挂出去（否则玩家点进去会撞上已经配好的局）
  room.source = 'matchmaking';
  assert.equal(lobby.listable(room), false, '匹配房');
  room.source = 'private';

  // 测试房
  room.test = true;
  assert.equal(lobby.listable(room), false, '测试房');
  room.test = false;

  // 独立房
  const soloHost = player('Solo');
  lobby.create(soloHost, { mode: 'solo', difficulty: 'NORMAL' });
  assert.equal(lobby.listable(lobby.roomOf(soloHost)), false, '独立房');

  assert.equal(lobby.listable(room), true, '改回来以后又可以');
});

test('门槛是 4 人（MAX_SEATS）：本服所有合作房都能挂，包括默认 4 人房', () => {
  assert.equal(ROOM_LIST_MIN_CAPACITY, MAX_SEATS, '门槛就是最小合作房容量');
  assert.equal(ROOM_LIST_MIN_CAPACITY, 4);

  // 默认 4 人房可以挂
  const lobby = makeLobby();
  const host = player('Four');
  assert.deepEqual(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  const room = lobby.roomOf(host);
  assert.equal(room.capacity, 4, '默认容量是 MAX_SEATS = 4');
  assert.deepEqual(lobby.setListed(host, { listed: true }), { ok: true });
  assert.equal(lobby.roomList().reply.rooms.length, 1, '4 人房也在列表里');

  // 5 人房当然也可以
  const lobby2 = makeLobby();
  const five = coopRoom(lobby2, 5);
  assert.deepEqual(lobby2.setListed(five.host, { listed: true }), { ok: true });
  assert.equal(lobby2.roomList().reply.rooms[0].capacity, 5);
});

test('20 人房能挂上，列表里 capacity 正确', () => {
  const lobby = makeLobby();
  const { host } = coopRoom(lobby, 20);
  assert.deepEqual(lobby.setListed(host, { listed: true }), { ok: true });
  const row = lobby.roomList().reply.rooms[0];
  assert.equal(row.capacity, 20);
  assert.equal(row.filled, 1, '房主占了一个座位');
  // free / at 只用于排序，发出去前被剥掉 —— 客户端自己算 capacity - filled
  assert.equal(row.free, undefined, 'free 不下发');
  assert.equal(row.at, undefined, 'at 不下发');
  assert.equal(row.capacity - row.filled, 19);
});

test('独立（solo）房挂不上 —— 它没有「等队友」这回事', () => {
  const lobby = makeLobby();
  const host = player('Solo');
  assert.deepEqual(lobby.create(host, { mode: 'solo', difficulty: 'NORMAL' }), { ok: true });
  const res = lobby.setListed(host, { listed: true });
  assert.equal(res.error, ERR.BAD_TARGET);
});

test('非房主不能挂，不在房间里的也不能', () => {
  const lobby = makeLobby();
  const { host } = coopRoom(lobby, 8);
  const guest = player('Guest');
  assert.deepEqual(lobby.join(guest, { code: lobby.roomOf(host).code }), { ok: true });

  assert.equal(lobby.setListed(guest, { listed: true }).error, ERR.NOT_HOST);

  const stranger = player('Stranger');
  assert.equal(lobby.setListed(stranger, { listed: true }).error, ERR.NOT_IN_ROOM);
});

// ---------------------------------------------------------------- 列表里有什么

test('room.list 只回挂出来的、还在等人的房', () => {
  const lobby = makeLobby();
  const a = coopRoom(lobby, 8);
  const b = coopRoom(lobby, 8);
  lobby.setListed(a.host, { listed: true });
  // b 没挂

  let res = lobby.roomList();
  assert.equal(res.ok, true);
  assert.equal(res.reply.rooms.length, 1, '只回挂了的那一个');
  assert.equal(res.reply.rooms[0].code, a.room.code);

  // 摘掉以后就没了
  lobby.setListed(a.host, { listed: false });
  res = lobby.roomList();
  assert.equal(res.reply.rooms.length, 0);
});

test('满员的房自动从列表消失（不用额外清理）', () => {
  // 用可控时钟：room.list 有 ROOM_LIST_CACHE_MS 的扫描缓存，满员本身不会主动让缓存失效
  // （参考版故意如此 —— 过期的行只会让点进去的人被 room.join 拒一次，代价小于每次状态变化都重扫）。
  let clock = 1_000_000;
  const lobby = new Lobby({ registry: new SessionRegistry(), log: silent, now: () => clock });
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  assert.equal(lobby.roomList().reply.rooms.length, 1);

  // 把剩下的 7 个座位填满
  for (let i = 1; i < room.capacity; i += 1) {
    assert.deepEqual(lobby.addBot(host, { seat: i }), { ok: true });
  }
  assert.equal(room.freeSeat(), -1, '没有空位了');
  assert.equal(lobby.roomOpen(room), false, 'roomOpen 立刻认为它不在等人');

  clock += 3_001; // 越过 ROOM_LIST_CACHE_MS
  assert.equal(lobby.roomList().reply.rooms.length, 0, '缓存过期后列表里没有了');
});

test('扫描缓存最多让列表过期 ROOM_LIST_CACHE_MS —— 满员后 3 秒内仍可能看到旧行', () => {
  let clock = 1_000_000;
  const lobby = new Lobby({ registry: new SessionRegistry(), log: silent, now: () => clock });
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  lobby.roomList(); // 建立缓存

  for (let i = 1; i < room.capacity; i += 1) lobby.addBot(host, { seat: i });
  assert.equal(lobby.roomOpen(room), false);
  // 缓存还在 → 列表仍然回它（这就是文档里说的「过期行」）
  assert.equal(lobby.roomList().reply.rooms.length, 1, '3 秒内仍看到旧行');
  // 点进去会被 room.join 挡住，不会真的进一个满员房
  const guest = player('Guest');
  assert.equal(lobby.join(guest, { code: room.code }).error, ERR.ROOM_FULL);
});

test('房主掉线的房从列表消失，回来又出现', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  assert.equal(lobby.roomOpen(room), true);

  room.seatOf(host.playerId).connected = false;
  assert.equal(lobby.roomOpen(room), false, '房主掉线 = 不在等人');
  assert.equal(lobby.roomList().reply.rooms.length, 0);

  room.seatOf(host.playerId).connected = true;
  assert.equal(lobby.roomOpen(room), true, '回来又出现');
});

test('room.list 的行里没有 playerId / 地址 / 座位明细', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  const row = lobby.roomList().reply.rooms[0];

  assert.deepEqual(Object.keys(row).sort(),
    ['capacity', 'code', 'difficulty', 'experimental', 'filled', 'host', 'humans'].sort());
  const blob = JSON.stringify(row);
  assert.ok(!blob.includes(host.playerId), '不能泄漏 playerId');
  assert.ok(!blob.includes('acc_'), '不能泄漏 accountId');
  assert.equal(row.host, 'Host', 'host 是显示名');
  assert.equal(row.filled, 1, '已占座位 = 1（房主）');
  assert.equal(row.capacity, 8);
});

test('列表按空位升序，同样多则先建的在前', () => {
  const lobby = makeLobby();
  const a = coopRoom(lobby, 8);            // 空 7
  const b = coopRoom(lobby, 8);            // 空 7，比 a 晚建
  const c = coopRoom(lobby, 12);           // 空 11，最空
  for (const r of [a, b, c]) lobby.setListed(r.host, { listed: true });
  // 让 a 先占两个座位 → 空 5，最满
  lobby.addBot(a.host, { seat: 1 });
  lobby.addBot(a.host, { seat: 2 });

  const codes = lobby.roomList().reply.rooms.map((r) => r.code);
  assert.deepEqual(codes, [a.room.code, b.room.code, c.room.code], '空位少的在前，平局看创建时间');
});

test('ROOM_LIST_CACHE_MS 内共用一次扫描，挂/摘会立刻让缓存失效', () => {
  const lobby = makeLobby();
  const { host } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });

  const first = lobby.roomList();
  assert.ok(lobby.roomListCache, '第一次扫描后有了缓存');
  const cached = lobby.roomList();
  assert.equal(cached.reply.rooms, first.reply.rooms, '3 秒内直接复用同一个数组');

  lobby.setListed(host, { listed: false });
  assert.equal(lobby.roomListCache, null, 'setListed 把缓存置空了');
  assert.equal(lobby.roomList().reply.rooms.length, 0);
});

test('开局后的房挂不上，挂上的也进不了列表', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  // 直接伪造「对局已开始」
  room.match = { fake: true };
  assert.equal(lobby.roomOpen(room), false, '开局后不在列表上');
  assert.equal(lobby.roomList().reply.rooms.length, 0);
  // 开局后也不能再改 listed
  assert.equal(lobby.setListed(host, { listed: false }).error, ERR.ROOM_STARTED);
});

test('有排队任务的房不在列表上', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  assert.equal(lobby.roomQueued(room), false);
  room.queue.pending = 1;
  assert.equal(lobby.roomQueued(room), true);
  assert.equal(lobby.roomOpen(room), false, '有排队任务时不在等人');
  room.queue.pending = 0;
  assert.equal(lobby.roomOpen(room), true);
});

test('房间变得不合条件时，setExperimental 会自动摘下列表', () => {
  const lobby = makeLobby();
  const { host, room } = coopRoom(lobby, 8);
  lobby.setListed(host, { listed: true });
  assert.equal(room.listed, true);
  // 8 人缩到 4 人：仍然够门槛（ROOM_LIST_MIN_CAPACITY = 4），照旧公开
  assert.deepEqual(lobby.setExperimental(host, { experimental: { ...room.experimental, playerCapacity: 4 } }), { ok: true });
  assert.equal(room.listed, true, '4 人还有资格公开');
  // 变成测试房就不合条件了（listable 里 source/test 都要过）—— 顺手把死行摘掉
  room.test = true;
  assert.deepEqual(lobby.setExperimental(host, { experimental: { ...room.experimental, playerCapacity: 8 } }), { ok: true });
  assert.equal(room.listed, false, '不合条件就别留在列表里');
  assert.equal(lobby.roomList().reply.rooms.length, 0, '列表里也没有了');
});
