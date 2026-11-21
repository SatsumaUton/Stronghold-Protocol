// test/content/most-bond-rank.test.js —— 「人数最多盟约的干员」(SERVER_MOST_BOND) 必须真的给出干员
// （玩家 2026-11-21 反馈：伊桑受盟约投影影响，卖出后什么都没给）。
//
// 根因：旧实现只试「人数最多」那一档；那条盟约在当前调度中心等级**买不到任何干员**时
// （rollChess → pool.roll 返回 null）循环直接结束 —— 效果静默失效。
// 盟约投影会让「投影那条」凭空成为人数最多（场上每名干员都算它的成员），所以更容易踩到。
//
// 修法（保持 golden 不变的关键）：**先照旧只试人数最多那一档**（同人数随机，rng 消耗不变），
// 全部失败时才用一条**不消耗随机数**的兜底（按人数降序、同人数按 bondOrder）再试其它盟约。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../server/sim/content/garrisons/meta.js', import.meta.url), 'utf8');

test('SERVER_MOST_BOND：先按原口径试人数最多，失败才兜底', () => {
  const start = SRC.indexOf('H.SERVER_MOST_BOND');
  assert.ok(start > 0, '找得到实现');
  const block = SRC.slice(start, SRC.indexOf('H.SERVER_ONCE_GOLD', start));

  // 原口径保留：同人数随机
  assert.match(block, /const order = best\.length > 1 \? ctx\.rng\.shuffle\(best\.slice\(\)\) : best;/, '同人数之间随机');
  // 正常路径：只试 order（人数最多那一档）
  assert.match(block, /for \(const bond of order\) if \(tryBond\(bond\)\) return;/, '先只试人数最多');
  // 兜底：按人数降序，且**不**再抽随机数
  assert.match(block, /const rest = bondOrder\(ctx\)/, '兜底遍历其它盟约');
  assert.match(block, /\.sort\(\(a, b\) => b\.count - a\.count\)/, '兜底按人数降序');
  assert.ok(!block.slice(block.indexOf('const rest')).includes('rng.shuffle'), '兜底不再消耗随机数（golden 不变）');
  // 兜底循环也真的尝试
  assert.match(block, /for \(const bond of rest\) if \(tryBond\(bond\)\) return;/, '兜底逐个尝试');
  // 卖出仍跳过计数型盟约
  assert.match(block, /sold && ctx\.gd\.bond\(id\)\?\.countMode === 'BOARD_ALL_CHESS'/, '卖出仍跳过 BOARD_ALL_CHESS');
});
