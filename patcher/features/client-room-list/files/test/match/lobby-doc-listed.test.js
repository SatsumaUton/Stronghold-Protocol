// 跨节点公开同盟的第一环：房间文档里必须带上 listed / matchmaking。
//
// 为什么单独一条：跨节点列表走的是「匹配服务读 Redis 里的房间文档」这条路，
// 而 room.list（节点内）走的是 Lobby 自己的内存。两条路的数据源不同 ——
// 2026-11-02 之前 lobbyState.roomDoc 根本不存 listed，于是匹配服务读到的房间
// 长得跟普通房一样，「公开同盟」永远只有本节点的房能出现，而且**没有任何报错**。
// 这条测试钉的就是这个隐形的断点。
//
// 同时钉住「默认房间的存档一个字节都不变」：为 false 时整条省掉，
// 否则上游升级后每个房间文档都多两个字段，回滚与对存档会变麻烦。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { roomDoc } from '../../server/persist/lobbyState.js';

// 仓库里的 data/create-room.json 存的是「关闭建房」（公开仓库不默认开放），
// 这些用例只用 create() 搭一个房间，跟运维开关无关。
process.env.SP_GATE_IGNORE = '1';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

let seq = 0;
function player(name) {
  seq += 1;
  return { playerId: `p_${seq}`, accountId: `acc_${seq}`, name, connected: true, ws: null };
}

function coopRoom(lobby) {
  const host = player('Host');
  const created = lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' });
  assert.deepEqual(created, { ok: true }, '建房成功');
  return { host, room: lobby.roomOf(host) };
}

/** 存档里的房间文档。测试不关心对局引用，传空实现即可。 */
const doc = (room) => roomDoc(room, () => null, () => null);

test('默认房间的文档里没有 listed / matchmaking（存档与以前逐字节一致）', () => {
  const lobby = new Lobby({ registry: new SessionRegistry(), log: silent });
  const { room } = coopRoom(lobby);
  const d = doc(room);
  assert.ok(d, '房间应该能存档');
  assert.equal(Object.hasOwn(d, 'listed'), false, '没挂公开同盟就不该出现 listed');
  assert.equal(Object.hasOwn(d, 'matchmaking'), false, '没进匹配就不该出现 matchmaking');
});

test('挂上公开同盟 → 文档里出现 listed: true（匹配服务靠它认出公开房）', () => {
  const lobby = new Lobby({ registry: new SessionRegistry(), log: silent });
  const { host, room } = coopRoom(lobby);
  assert.deepEqual(lobby.setListed(host, { listed: true }), { ok: true }, '挂上公开同盟');
  const d = doc(room);
  assert.equal(d.listed, true, 'listed 必须是 true，不是 1 或字符串');
});

test('摘掉公开同盟 → listed 字段消失（不是写成 false）', () => {
  const lobby = new Lobby({ registry: new SessionRegistry(), log: silent });
  const { host, room } = coopRoom(lobby);
  lobby.setListed(host, { listed: true });
  lobby.setListed(host, { listed: false });
  const d = doc(room);
  assert.equal(Object.hasOwn(d, 'listed'), false, '摘掉后整条省掉');
});

test('进入匹配 → 文档里出现 matchmaking: true；退出后消失', () => {
  const lobby = new Lobby({ registry: new SessionRegistry(), log: silent });
  const { host, room } = coopRoom(lobby);
  assert.deepEqual(lobby.matchmaking(host, { on: true }), { ok: true }, '进入匹配');
  assert.equal(doc(room).matchmaking, true);
  lobby.matchmaking(host, { on: false });
  assert.equal(Object.hasOwn(doc(room), 'matchmaking'), false, '退出后整条省掉');
});

test('两个字段互不影响：只挂公开不进匹配，只进匹配不挂公开', () => {
  const lobby = new Lobby({ registry: new SessionRegistry(), log: silent });
  const a = coopRoom(lobby);
  lobby.setListed(a.host, { listed: true });
  const da = doc(a.room);
  assert.equal(da.listed, true);
  assert.equal(Object.hasOwn(da, 'matchmaking'), false, '没进匹配就不该有 matchmaking');

  const b = coopRoom(lobby);
  lobby.matchmaking(b.host, { on: true });
  const db = doc(b.room);
  assert.equal(db.matchmaking, true);
  assert.equal(Object.hasOwn(db, 'listed'), false, '没挂公开就不该有 listed');
});
