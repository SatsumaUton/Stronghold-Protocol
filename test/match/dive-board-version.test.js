// test/match/dive-board-version.test.js —— 深潜排行榜按版本分（维护者 2026-11-20）。
//
// 背景：规程·序列Ⅰ 也能开深渊回响之后，深度在不同版本之间不可比，榜必须分开。
//   · 默认版本（第二期下半）沿用历史键 `dive:board:<难度>`（老成绩不丢）；
//   · 其它版本 `dive:board:<难度>:<版本>`。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VERSION } from '../../shared/versions.js';
import {
  ECHO_BOARD_ENTRY_KEY, echoBoardEntry, echoBoardKeyFor, echoBoardVersion, readEchoBoard, recordEchoBoard,
} from '../../server/match/match/echoBoard.js';

const REG = 'act3autochess@V3_1';

test('榜键：默认版本用老键，其它版本带版本后缀', () => {
  assert.equal(echoBoardKeyFor('HARD'), 'dive:board:HARD');
  assert.equal(echoBoardKeyFor('HARD', DEFAULT_VERSION), 'dive:board:HARD');
  assert.equal(echoBoardKeyFor('HARD', REG), `dive:board:HARD:${REG}`);
  assert.equal(echoBoardKeyFor('nonsense'), 'dive:board:HARD', '未知难度退回 HARD');
  assert.equal(echoBoardKeyFor('ABYSS', ''), 'dive:board:ABYSS', '空版本按默认版本');
});

test('echoBoardVersion：过滤非法字符，坏值退回默认版本', () => {
  assert.equal(echoBoardVersion(REG), REG);
  assert.equal(echoBoardVersion('act3/@V3 1'), 'act3@V31', '斜杠与空格被剥掉');
  assert.equal(echoBoardVersion(''), DEFAULT_VERSION);
  assert.equal(echoBoardVersion(null), DEFAULT_VERSION);
  assert.equal(echoBoardVersion(42), DEFAULT_VERSION);
});

test('条目带版本，记录写进该版本的榜（明细里也有版本）', async () => {
  const cmds = [];
  const store = { prefix: 'p:', client: { command: (...args) => { cmds.push(args); return Promise.resolve([]); } } };
  const entry = echoBoardEntry({ depth: 3, difficulty: 'HARD', version: REG, players: ['A'], at: 1000 });
  assert.equal(entry.version, REG);
  assert.ok(await recordEchoBoard(store, entry));
  const zadd = cmds.find((c) => c[0] === 'ZADD');
  assert.ok(zadd[1].endsWith(`dive:board:HARD:${REG}`), zadd[1]);
  assert.ok(!zadd[1].includes(':HARD '), '不能写到默认版本的键上');
  const hset = cmds.find((c) => c[0] === 'HSET');
  assert.ok(hset[1].endsWith(ECHO_BOARD_ENTRY_KEY), hset[1]);
  assert.equal(JSON.parse(hset[3]).version, REG, '明细里也写版本');
});

test('readEchoBoard：按版本读不同的键', async () => {
  const seen = [];
  const store = { prefix: '', client: { command: (...args) => { if (args[0] === 'ZREVRANGE') seen.push(args[1]); return Promise.resolve([]); } } };
  await readEchoBoard(store, { difficulty: 'ABYSS', version: REG, limit: 5 });
  await readEchoBoard(store, { difficulty: 'ABYSS', limit: 5 });
  assert.ok(seen[0].includes(`dive:board:ABYSS:${REG}`), seen[0]);
  assert.ok(seen[1].includes('dive:board:ABYSS') && !seen[1].includes(`:${REG}`), '默认版本用老键：' + seen[1]);
});
