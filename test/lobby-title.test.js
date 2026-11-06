// test/lobby-title.test.js — 玩家称号（维护者 2026-11-07）。
//
// 称号是账号级的展示信息：后台可以自己加 / 删（存在 matchmaker 的 titles 表），
// 登录令牌带下来的是**显示信息** { id, name, tone, desc }，节点存进 session，
// 房间的座位卡 / 观战席把它显示在名字后面。
// 这里验证三件事：
//   1) shared/titles.js 的内置目录本身（id 唯一、未知 id 返回 null）——它是**播种用的默认值**；
//   2) 座位 / 观战席的公共视图只在有称号时才带 `title` 键（没有就逐字节不变）；
//   3) 后台自定义的称号（不在 shared 目录里）也能原样穿过 —— 节点不查目录、只转发。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TITLES, TITLE_IDS, titleById, titleName, isTitleId } from '../shared/titles.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { DATA } from './match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** 令牌里下发的就是这种形状（matchmaker 的 userTokenFor）。 */
const T = (id, name, tone = 'echo') => ({ id, name, tone, desc: '' });

/** 一个带称号的会话（net.js 从账号令牌里取到的就是这几个字段）。 */
const session = (id, title = null) => ({
  playerId: id, name: id.toUpperCase(), connected: true, roomCode: null, ws: null,
  guest: false, accountId: `acc_${id}`, adminId: false, tag: '1234', title,
});

function lobbyWith(...sessions) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: class { constructor() {} start() {} dispose() {} }, getData: () => DATA, log: quiet });
  for (const s of sessions) registry.byPlayerId.set(s.playerId, s);
  return { lobby, registry };
}

test('内置目录（播种用）：id 唯一、名字非空，未知 id 返回 null', () => {
  assert.ok(TITLES.length >= 6, `至少要有几个可选称号，实际 ${TITLES.length}`);
  assert.equal(new Set(TITLE_IDS).size, TITLES.length, 'id 不能重复');
  for (const t of TITLES) {
    assert.match(t.id, /^[a-z][a-z0-9_]*$/, `id 要是小写标识符：${t.id}`);
    assert.ok(t.name && t.name.length > 0, `${t.id} 要有名字`);
    assert.ok(t.desc && t.desc.length > 0, `${t.id} 要有说明（后台下拉的 tooltip）`);
    assert.ok(['echo', 'gold', 'mint', 'blue'].includes(t.tone), `${t.id} 的配色要是已知档`);
    assert.equal(titleById(t.id).name, t.name);
    assert.equal(titleName(t.id), t.name);
    assert.equal(isTitleId(t.id), true);
  }
  assert.ok(TITLE_IDS.includes('firstecho'), '初响见证者要在内置目录里');
  assert.equal(titleById('no_such_title'), null, '未知 id 不能抛错（自定义称号走令牌，不查这里）');
  assert.equal(titleById(null), null);
  assert.equal(titleName(''), null);
  assert.equal(isTitleId('nope'), false);
});

test('座位卡：有称号才下发 title，没有就完全不带这个键', () => {
  const host = session('p_host', T('firstecho', '初响见证者'));
  const guest = session('p_guest', null);
  const { lobby } = lobbyWith(host, guest);
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby.join(guest, { code: lobby.roomOf(host).code }).ok, true);
  const state = lobby.roomOf(host).toState(Date.now(), host.playerId);
  const seatHost = state.seats.find((s) => s && s.playerId === 'p_host');
  const seatGuest = state.seats.find((s) => s && s.playerId === 'p_guest');
  assert.equal(seatHost.title.id, 'firstecho', '房主的座位要带称号');
  assert.equal(seatHost.title.name, '初响见证者');
  assert.equal(Object.hasOwn(seatGuest, 'title'), false, '没设称号的座位不能带这个键');
});

test('后台自定义的称号（不在内置目录里）也原样穿过', () => {
  const host = session('p_host', T('t_custom123', '摸鱼冠军', 'gold'));
  const { lobby } = lobbyWith(host);
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  const state = lobby.roomOf(host).toState(Date.now(), host.playerId);
  const seat = state.seats.find((s) => s && s.playerId === 'p_host');
  assert.equal(seat.title.name, '摸鱼冠军');
  assert.equal(seat.title.tone, 'gold');
  assert.equal(titleById(seat.title.id), null, '自定义 id 本来就不在内置目录里');
});

test('观战席：观战者同样带称号', () => {
  const host = session('p_host', T('veteran', '资深博士', 'gold'));
  const watcher = session('p_watch', T('community_star', '社区之星', 'gold'));
  const { lobby } = lobbyWith(host, watcher);
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  const room = lobby.roomOf(host);
  assert.equal(lobby.spectate(watcher, { code: room.code }).ok, true);
  const state = room.toState(Date.now(), host.playerId);
  const row = state.spectators.find((s) => s.playerId === 'p_watch');
  assert.ok(row, '观战者要在列表里');
  assert.equal(row.title.name, '社区之星');
});

test('没设称号的房间：state 与以前逐字节一致（不新增键）', () => {
  const host = session('p_host', null);
  const { lobby } = lobbyWith(host);
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  const state = lobby.roomOf(host).toState(Date.now(), host.playerId);
  for (const s of state.seats) if (s) assert.equal(Object.hasOwn(s, 'title'), false);
  for (const s of state.spectators) assert.equal(Object.hasOwn(s, 'title'), false);
});
