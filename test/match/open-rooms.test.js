// 跨节点「公开同盟」筛选规则的回归测试（matchmaker/openRooms.cjs）。
//
// 背景（2026-11-02，维护者要求「公开同盟的房要能跨节点看到、跨节点加入」）：
//   本服是 30 个独立节点进程，每个 Lobby 的 room.list 只看得见自己的房间。
//   跨节点列表由匹配服务从 Redis（sp:n<节点>:lobby:rooms）汇总，
//   客户端拿 node 用 nginx 的 ?n=<节点> 连过去。
// 这条链路上唯一容易错、又最容易悄悄错的地方是**筛选规则**：
//   列出不该列的房 = 玩家点进去满员/已开局（被服务端拒，白跑一趟）；
//   漏掉该列的房 = 玩家以为没人开房。
// 所以规则单独一个纯函数文件，这里逐条钉住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
// openRooms.cjs 是 CommonJS（matchmaker 那边没有 type:module），Node 会把 module.exports
// 作为 default 暴露给 ESM，所以这里默认导入再解构。
import openRooms from '../../../matchmaker/openRooms.cjs';

const { pickOpenRoom, collectOpenRooms } = openRooms;

/** 一间「挂了公开同盟、还没开局、有空位」的合作房。 */
const openDoc = (extra = {}) => ({
  code: 'ABCD', mode: 'coop', difficulty: 'HARD', hostId: 'p1', capacity: 4,
  version: 'act2autochess', listed: true,
  seats: [{ playerId: 'p1', name: '房主' }, null, null, null],
  ...extra,
});

test('挂上公开同盟、没开局、有空位 → 出现在列表里，并且带着节点号', () => {
  const row = pickOpenRoom('ABCD', 7, openDoc());
  assert.ok(row, '应该列出来');
  assert.equal(row.code, 'ABCD');
  assert.equal(row.node, 7, '必须带节点号，否则客户端不知道该连哪台');
  assert.equal(row.host, '房主');
  assert.equal(row.humans, 1);
  assert.equal(row.filled, 1);
  assert.equal(row.capacity, 4);
  assert.equal(row.difficulty, 'HARD');
});

test('没挂公开同盟 → 不列（这是「公开」两个字的全部含义）', () => {
  assert.equal(pickOpenRoom('ABCD', 1, openDoc({ listed: undefined })), null);
  assert.equal(pickOpenRoom('ABCD', 1, openDoc({ listed: false })), null);
});

test('已经开局 → 不列（三种开局标记都算）', () => {
  assert.equal(pickOpenRoom('ABCD', 1, openDoc({ matchLive: true })), null);
  assert.equal(pickOpenRoom('ABCD', 1, openDoc({ matchKey: 'L.ABCD.1.1' })), null);
  assert.equal(pickOpenRoom('ABCD', 1, openDoc({ match: { round: 3 } })), null);
});

test('满员 → 不列（含 AI 占座，座位数组里非 null 就算占）', () => {
  const full = { seats: [{ playerId: 'p1', name: '房主' }, { isBot: true }, { isBot: true }, { isBot: true }] };
  assert.equal(pickOpenRoom('ABCD', 1, openDoc(full)), null, '4/4 满');
  const three = { seats: [{ playerId: 'p1', name: '房主' }, { isBot: true }, { isBot: true }, null] };
  assert.ok(pickOpenRoom('ABCD', 1, openDoc(three)), '3/4 还有空位');
});

test('容量优先读 doc.capacity；缺了退回 experimental.playerCapacity；都没有就按 4 座', () => {
  assert.equal(pickOpenRoom('A', 1, openDoc({ capacity: 12 })).capacity, 12);
  assert.equal(pickOpenRoom('A', 1, openDoc({ capacity: undefined, experimental: { playerCapacity: 8 } })).capacity, 8);
  assert.equal(pickOpenRoom('A', 1, openDoc({ capacity: undefined })).capacity, 4);
  // 12 人房里坐了 5 个人：不满，要列出来
  const five = { capacity: 12, seats: [{ playerId: 'p1', name: 'x' }, {}, {}, {}, {}, null] };
  assert.ok(pickOpenRoom('A', 1, openDoc(five)), '5/12 应该列出来');
});

test('房东名字取 hostId 对应的座位；找不到就取第一个有人的座位', () => {
  assert.equal(pickOpenRoom('A', 1, openDoc()).host, '房主');
  const noHost = { seats: [{ playerId: 'p9', name: '别人' }, null] };
  assert.equal(pickOpenRoom('A', 1, openDoc(noHost)).host, '别人');
  const empty = { seats: [null, null] };
  assert.equal(pickOpenRoom('A', 1, openDoc(empty)).host, '', '空房没名字，但不能崩');
});

test('杂物：文档不是对象 / seats 缺失 / 坏 JSON 都不该让汇总崩掉', () => {
  assert.equal(pickOpenRoom('A', 1, null), null);
  assert.equal(pickOpenRoom('A', 1, 'nope'), null);
  const noSeats = openDoc();
  delete noSeats.seats;
  const row = pickOpenRoom('A', 1, noSeats);
  assert.ok(row, '没有 seats 字段也按「0 人」处理');
  assert.equal(row.filled, 0);
  // collectOpenRooms 遇到坏 JSON 只是跳过这一条
  const rows = collectOpenRooms([{ node: 1, flat: ['BAD', '{not json', 'ABCD', JSON.stringify(openDoc())] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'ABCD');
});

test('汇总多个节点：节点号各自带上，空位少的排前面（与节点内 room.list 一致）', () => {
  const a = openDoc({ code: 'AAAA', capacity: 4, seats: [{ playerId: 'p1', name: 'a' }, null, null, null] });      // 3 空
  const b = openDoc({ code: 'BBBB', capacity: 4, seats: [{ playerId: 'p1', name: 'b' }, null, null, null] });      // 3 空
  const c = openDoc({ code: 'CCCC', capacity: 4, seats: [{ playerId: 'p1', name: 'c' }, {}, {}, null] });          // 1 空
  const rows = collectOpenRooms([
    { node: 3, flat: ['AAAA', JSON.stringify(a)] },
    { node: 9, flat: ['BBBB', JSON.stringify(b)] },
    { node: 12, flat: ['CCCC', JSON.stringify(c)] },
  ]);
  assert.deepEqual(rows.map((r) => r.code), ['CCCC', 'AAAA', 'BBBB'], '空位最少的在前，同分按码');
  assert.deepEqual(rows.map((r) => r.node), [12, 3, 9], '每条的节点号都跟着自己走');
});

test('多个节点的同一间房只出现一次（房间码是唯一的，节点号不会串）', () => {
  const rows = collectOpenRooms([
    { node: 1, flat: ['ABCD', JSON.stringify(openDoc())] },
    { node: 2, flat: ['ABCD', JSON.stringify(openDoc())] },
  ]);
  assert.equal(rows.length, 2, '两台节点各有一间同名房是两台不同的房，各自列出');
  assert.deepEqual(rows.map((r) => r.node).sort(), [1, 2]);
});

test('匹配中的房间标记 matchmaking 透传（大厅可以用它区分「在等人」和「在凑人」）', () => {
  assert.equal(pickOpenRoom('A', 1, openDoc({ matchmaking: true })).matchmaking, true);
  assert.equal(pickOpenRoom('A', 1, openDoc()).matchmaking, false);
  // 匹配中也要能列出来：玩家点「加入」正好帮它凑满
  assert.ok(pickOpenRoom('A', 1, openDoc({ matchmaking: true })), '匹配中的房要列出来');
});
