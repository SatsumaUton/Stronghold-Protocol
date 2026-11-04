// test/match/echoBoard.test.js — 深潜排行榜（server/match/match/echoBoard.js）。
//
// 守四件事：
//   1. 只有进过深潜的成绩才上榜（depth > 0）
//   2. **每个难度一张榜**（深度跨难度不可比），键名带难度后缀
//   3. 同深度先到者在前（有序集合同分按 member 字典序，所以 member 前缀是零填充时间戳）
//   4. Redis 挂掉 / 没配 Redis 时静默跳过，绝不让结算失败
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  echoBoardMember, echoBoardEntry, parseEchoBoard, recordEchoBoard, readEchoBoard, echoBoardKeyFor,
  ECHO_BOARD_ENTRY_KEY, ECHO_BOARD_DIFFICULTIES, ECHO_BOARD_LIMIT,
} from '../../server/match/match/echoBoard.js';

/** 假 store：记下所有命令；`replies` 按命令名给读结果。 */
function fakeStore(replies = {}) {
  const cmds = [];
  return {
    prefix: 'sp:',
    cmds,
    client: {
      command: async (...args) => {
        cmds.push(args);
        const r = replies[args[0]];
        return typeof r === 'function' ? r(...args) : r;
      },
    },
  };
}

test('难度键：每个难度一张榜，未知难度退回 HARD', () => {
  assert.deepEqual(ECHO_BOARD_DIFFICULTIES, ['NORMAL', 'HARD', 'ABYSS']);
  assert.equal(echoBoardKeyFor('NORMAL'), 'dive:board:NORMAL');
  assert.equal(echoBoardKeyFor('ABYSS'), 'dive:board:ABYSS');
  assert.equal(echoBoardKeyFor('FUNNY'), 'dive:board:HARD', '标准模拟不进深潜，退回默认档');
  assert.equal(echoBoardKeyFor(undefined), 'dive:board:HARD');
});

test('member：零填充时间戳打头，同深度先到者排前面，且不会互相覆盖', () => {
  const early = echoBoardMember({ at: 1000, roomCode: 'ABCD', matchNo: 1, seed: 7 });
  const late = echoBoardMember({ at: 2000, roomCode: 'WXYZ', matchNo: 1, seed: 7 });
  assert.ok(early < late, '时间早的 member 字典序更小');
  assert.equal(early.split(':')[0], String(1000).padStart(14, '0'));
  assert.notEqual(early, late);
  const dirty = echoBoardMember({ at: 1, roomCode: 'A:B\nC', matchNo: 2, seed: 'x y' });
  assert.ok(!dirty.includes('\n'));
  assert.equal(dirty.split(':').length, 4);
});

test('条目：没进深潜不上榜；难度会被规范化', () => {
  assert.equal(echoBoardEntry({ depth: 0 }), null);
  const e = echoBoardEntry({ depth: 7, round: 21, victory: true, players: ['甲', '乙'], at: 5000, difficulty: 'ABYSS', roomCode: 'ABCD', matchNo: 3, seed: 9 });
  assert.equal(e.depth, 7);
  assert.equal(e.difficulty, 'ABYSS');
  assert.deepEqual(e.players, ['甲', '乙']);
  assert.equal(echoBoardEntry({ depth: 3, difficulty: 'FUNNY' }).difficulty, 'HARD');
});

test('条目：玩家名过多 / 过长被截断', () => {
  const e = echoBoardEntry({ depth: 3, players: Array.from({ length: 20 }, (_, i) => 'p'.repeat(40) + i) });
  assert.equal(e.players.length, 8);
  assert.ok(e.players.every((p) => p.length <= 24));
});

test('解析：把明细（队伍/胜败/回合）合并进每一行；坏数据跳过', () => {
  const flat = ['0000000000002:WXYZ:1:7', '9', '0000000000001:ABCD:1:7', '4'];
  const details = { '0000000000002:WXYZ:1:7': { players: ['甲'], victory: true, round: 33, difficulty: 'ABYSS' } };
  const rows = parseEchoBoard(flat, { details, difficulty: 'ABYSS' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2]);
  assert.deepEqual(rows[0].players, ['甲']);
  assert.equal(rows[0].victory, true);
  assert.equal(rows[0].round, 33);
  assert.equal(rows[1].players.length, 0, '没有明细的行给空数组，不崩');
  assert.equal(rows[1].difficulty, 'ABYSS', '明细缺失时用传入的难度兜底');
  assert.deepEqual(parseEchoBoard([]), []);
  assert.deepEqual(parseEchoBoard(['', '5']), []);
  assert.deepEqual(parseEchoBoard(['m', '0']), []);
});

test('记录：写进该难度的榜 + 写明细，并都设过期', async () => {
  const store = fakeStore();
  const e = echoBoardEntry({ depth: 12, round: 26, victory: true, players: ['甲'], at: 1, difficulty: 'NORMAL', roomCode: 'ABCD', matchNo: 1, seed: 1 });
  assert.equal(await recordEchoBoard(store, e), true);
  const names = store.cmds.map((c) => c[0]);
  assert.deepEqual(names, ['ZADD', 'ZREMRANGEBYRANK', 'EXPIRE', 'HSET', 'EXPIRE']);
  assert.equal(store.cmds[0][1], 'sp:dive:board:NORMAL', '按难度分榜');
  assert.equal(store.cmds[0][3], e.member);
  assert.equal(store.cmds[1][3], String(-(ECHO_BOARD_LIMIT + 1)), '只留前 LIMIT 条');
  assert.equal(store.cmds[3][1], `sp:${ECHO_BOARD_ENTRY_KEY}`, '明细写进 hash');
  assert.equal(store.cmds[3][2], e.member);
});

test('读取：只读指定难度的榜，并把明细一起取回', async () => {
  const member = '0000000000001:ABCD:1:7';
  const store = fakeStore({
    ZREVRANGE: [member, '6'],
    HMGET: [JSON.stringify({ players: ['甲'], victory: false, round: 21, difficulty: 'HARD' })],
  });
  const rows = await readEchoBoard(store, { difficulty: 'HARD', limit: 5 });
  assert.equal(store.cmds[0][1], 'sp:dive:board:HARD');
  assert.equal(store.cmds[0][3], '4', '取 limit 条');
  assert.equal(store.cmds[0][4], 'WITHSCORES');
  assert.equal(store.cmds[1][0], 'HMGET');
  assert.equal(rows[0].depth, 6);
  assert.deepEqual(rows[0].players, ['甲']);
});

test('没有 store / 没有 client / 命令抛错 → 静默返回，不抛', async () => {
  assert.equal(await recordEchoBoard(null, { member: 'x', depth: 1 }), false);
  assert.equal(await recordEchoBoard({}, { member: 'x', depth: 1 }), false);
  assert.deepEqual(await readEchoBoard(null), []);
  const boom = { client: { command: async () => { throw new Error('redis down'); } } };
  assert.equal(await recordEchoBoard(boom, { member: 'x', depth: 1 }), false);
  assert.deepEqual(await readEchoBoard(boom), []);
});
