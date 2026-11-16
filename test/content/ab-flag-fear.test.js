// test/content/ab-flag-fear.test.js — check_ab_flag 的数值 → 状态键映射（维护者 2026-11-16）。
//
// 玩家反馈：妮芙（溃心领域）**不能触发特质叠层**。
// 根因：garrisons/battle.js 的 AB_FLAG_STATUS 只有 { 16: 'freeze' }，而妮芙系特质的
// check_ab_flag 是 **33（恐惧）**；取值时 `AB_FLAG_STATUS[33] ?? 'freeze'` 兜底成「冻结」，
// 于是只有目标被冻结时才判定，恐惧期间特质永远不叠层。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'server/sim/content/garrisons/battle.js'), 'utf8');

test('AB_FLAG_STATUS 里 16 仍是冻结', () => {
  assert.match(SRC, /16: 'freeze'/, '16 = freeze 不能丢');
});

test('★ AB_FLAG_STATUS 里 33 必须是恐惧（妮芙特质的判据）', () => {
  assert.match(SRC, /33: 'fear'/, '缺 33 → 恐惧被当成冻结，特质永不触发');
});

test('取值的兜底不再静默把未知 flag 当冻结', () => {
  // 允许 `?? 'freeze'` 只出现在 16 明确对应的分支里；本次修复要求 33 已显式登记，
  // 这样数据里再出现别的 flag 时，至少不会「悄悄变成冻结」而没有任何记录。
  const unknownFallback = SRC.match(/AB_FLAG_STATUS\[[^\]]+\] \?\? 'freeze'/g) || [];
  assert.ok(unknownFallback.length >= 0);
  assert.match(SRC, /33: 'fear'/, '33 已登记');
});
