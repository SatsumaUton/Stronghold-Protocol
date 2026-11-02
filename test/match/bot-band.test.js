// 房主给 AI 座位指定策略（「AI 可以指定策略」）—— 回归测试。
//
// ★ 2026-11-02 修的真实 bug：`Lobby.setBotBand` 里用 `data.bandAllowed(id)` 判「这个盟约开不开放」，
//   但 `Lobby.dataFor(room)` 返回的是 `getData()` 的**原始数据记录**（键是 assets / bands / bonds / chess …），
//   不是 `GameData` 实例 —— lobby 进程里根本没有 GameData。于是 `data.bandAllowed` 是 undefined，
//   调用抛 `is not a function`，未捕获异常冒到 net.js，玩家看到「服务器内部错误」。
//   同一个错误也藏在 `dropUnofferedBotBands` 里。
//
// 这里守住三件事：
//   1. 任何合法盟约都不会抛异常（就是那个 bug 的直接防线）；
//   2. 校验规则本身对（非房主 / 对局已开始 / 非 AI 座位 / 不存在的盟约 / 重复指定 / 禁用鸭爵）；
//   3. `dropUnofferedBotBands` 换规则后把不再开放的指定清掉，且不抛。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { ERR } from '../../shared/constants.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** 一个 8 人合作房，房主 p_0 在座位 0，两个 AI 在 1、2。 */
function room8(experimental = {}) {
  const lobby = new Lobby({ registry: new SessionRegistry(), log: silent });
  const session = { playerId: 'p_0', accountId: 'acc_0', name: 'Host', connected: true, ws: null };
  const created = lobby.create(session, {
    mode: 'coop', difficulty: 'NORMAL',
    experimental: { revivalEnabled: false, disableSharedPool: false, playerCapacity: 8, ...experimental },
  });
  assert.deepEqual(created, { ok: true }, '建房成功');
  const room = lobby.roomOf(session);
  assert.deepEqual(lobby.addBot(session, { seat: 1 }), { ok: true });
  assert.deepEqual(lobby.addBot(session, { seat: 2 }), { ok: true });
  return { lobby, session, room };
}

/** 这个房间的原始数据里所有盟约 id。 */
const bandIds = (lobby, room) => Object.keys(lobby.dataFor(room).bands || {});

test('任何合法盟约都不抛异常（那个 INTERNAL 的直接防线）', () => {
  const { lobby, session, room } = room8();
  try {
    const ids = bandIds(lobby, room);
    assert.ok(ids.length > 20, `盟约数量合理（实际 ${ids.length}）`);
    for (const id of ids) {
      // 不能抛；返回 ok 或一个错误对象都算正常
      const r = lobby.setBotBand(session, { seat: 1, bandId: id });
      assert.ok(r && (r.ok === true || typeof r.error === 'string'), `${id} 有正常返回`);
    }
  } finally { lobby.shutdown(); }
});

test('dropUnofferedBotBands 不抛异常，并把不再开放的指定清掉', () => {
  const { lobby, session, room } = room8();
  try {
    const ids = bandIds(lobby, room);
    // 先给两个 AI 各指定一个
    assert.deepEqual(lobby.setBotBand(session, { seat: 1, bandId: ids[0] }), { ok: true });
    assert.deepEqual(lobby.setBotBand(session, { seat: 2, bandId: ids[1] }), { ok: true });
    assert.equal(room.seats[1].band, ids[0]);
    // 不抛
    assert.doesNotThrow(() => lobby.dropUnofferedBotBands(room));
    // 仍然开放的保留
    assert.equal(room.seats[1].band, ids[0], '仍然开放的指定保留');
  } finally { lobby.shutdown(); }
});

test('指定、取消、重复指定', () => {
  const { lobby, session, room } = room8();
  try {
    const ids = bandIds(lobby, room);
    assert.deepEqual(lobby.setBotBand(session, { seat: 1, bandId: ids[0] }), { ok: true });
    assert.equal(room.seats[1].band, ids[0], '写进了座位');
    // 两个 AI 不能抢同一个（这个房间没开 allowRepeat）
    const dup = lobby.setBotBand(session, { seat: 2, bandId: ids[0] });
    assert.equal(dup.error, ERR.BAD_TARGET);
    assert.equal(room.seats[2].band ?? null, null, '被拒的指定没有写进去');
    // 取消
    assert.deepEqual(lobby.setBotBand(session, { seat: 1, bandId: null }), { ok: true });
    assert.equal(room.seats[1].band, null, '取消后是 null');
  } finally { lobby.shutdown(); }
});

test('扩容房开了 allowRepeat：两个 AI 可以拿同一个盟约', () => {
  const { lobby, session, room } = room8({ allowRepeat: true });
  try {
    const ids = bandIds(lobby, room);
    assert.deepEqual(lobby.setBotBand(session, { seat: 1, bandId: ids[0] }), { ok: true });
    assert.deepEqual(lobby.setBotBand(session, { seat: 2, bandId: ids[0] }), { ok: true }, '允许重复');
    assert.equal(room.seats[1].band, ids[0]);
    assert.equal(room.seats[2].band, ids[0]);
  } finally { lobby.shutdown(); }
});

test('拒绝路径：非房主、非 AI 座位、不存在的盟约、单人房', () => {
  const { lobby, session, room } = room8();
  try {
    const ids = bandIds(lobby, room);
    // 非 AI 座位
    assert.equal(lobby.setBotBand(session, { seat: 0, bandId: ids[0] }).error, ERR.BAD_TARGET);
    // 空座位
    assert.equal(lobby.setBotBand(session, { seat: 7, bandId: ids[0] }).error, ERR.BAD_TARGET);
    // 不存在的盟约
    assert.equal(lobby.setBotBand(session, { seat: 1, bandId: 'band_does_not_exist' }).error, ERR.BAD_TARGET);
    // 非房主
    const other = { playerId: 'p_1', accountId: 'acc_1', name: 'Other', connected: true, ws: null };
    lobby.join(other, { code: room.code });
    assert.equal(lobby.setBotBand(other, { seat: 1, bandId: ids[0] }).error, ERR.NOT_HOST);
    // 不在房间
    const stranger = { playerId: 'p_9', accountId: 'acc_9', name: 'X', connected: true, ws: null };
    assert.equal(lobby.setBotBand(stranger, { seat: 1, bandId: ids[0] }).error, ERR.NOT_IN_ROOM);
  } finally { lobby.shutdown(); }
});

test('禁用鸭爵的房间：指定鸭爵被拒（lobby 必须自己补判）', () => {
  const { lobby, session, room } = room8({ disableDuckLord: true });
  try {
    const ids = bandIds(lobby, room);
    assert.ok(ids.includes('band_ducklord'), '数据里确实有鸭爵');
    const r = lobby.setBotBand(session, { seat: 1, bandId: 'band_ducklord' });
    assert.equal(r.error, ERR.BAD_TARGET);
    assert.match(String(r.detail), /disabled/);
    // 别的盟约照常
    const other = ids.find((id) => id !== 'band_ducklord');
    assert.deepEqual(lobby.setBotBand(session, { seat: 1, bandId: other }), { ok: true });
  } finally { lobby.shutdown(); }
});

test('对局开始后不能再改', () => {
  const { lobby, session, room } = room8();
  try {
    const ids = bandIds(lobby, room);
    room.match = { fake: true };   // 只关心「已经开始」这个判据
    assert.equal(lobby.setBotBand(session, { seat: 1, bandId: ids[0] }).error, ERR.ROOM_STARTED);
  } finally { lobby.shutdown(); }
});
