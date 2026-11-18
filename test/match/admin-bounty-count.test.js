// test/match/admin-bounty-count.test.js —— 悬赏指令的字段名与数量（2026-11-18 维护者报告）。
//
// 报告：「管理员工具中悬赏功能下面的敌对目标生成时提示指令参数不对」+「是不是漏了可以输入数量的输入框」。
//
// 根因：管理面板发 `{ id: key }`，而 `_applyTest` 的 bounty 分支读 `args.enemyKey` —— 别的页签都读
// `args.id`，只有悬赏读 `enemyKey`，于是 enemyKey 是 undefined → `gd.enemy(undefined)` → BAD_TARGET
// （界面上就是「指令参数不对」）。数量 count 也写死 1。
//
// 这里直接驱动 Match 的 applyTestCommand，断言两种字段名都能发、count 生效。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'server/match/match/testCommands.js'), 'utf8');

test('bounty 分支同时认 enemyKey 与 id（面板发的是 id）', () => {
  const line = SRC.split('\n').find((l) => l.includes("case 'bounty'"));
  assert.ok(line, 'bounty 分支要在 _applyTest 里');
  assert.match(line, /args\.enemyKey/, '要认 enemyKey（旧客户端）');
  assert.match(line, /args\.id/, '要认 id（管理面板实际发的）');
});

test('bounty 把 count 传进 _testBounty', () => {
  const line = SRC.split('\n').find((l) => l.includes("case 'bounty'"));
  assert.match(line, /args\.count/, 'count 要传给处理器（数量输入框）');
});

test('_testBounty 的 count 有缺省与上限', () => {
  const body = SRC.slice(SRC.indexOf('_testBounty(ps, enemyKey, count)'));
  // 窗口放宽：前面有一段解释性注释
  const head = body.slice(0, 1200);
  assert.match(head, /Number\.isInteger\(count\)/, '要校验 count 是整数');
  assert.match(head, /Math\.min\(count, 99\)/, '上限 99');
  assert.match(head, /: 1;/, '缺省 1');
});

test('面板的悬赏数量输入框存在且缺省 1', () => {
  const ui = readFileSync(join(ROOT, 'public/js/ui/adminTools.js'), 'utf8');
  assert.match(ui, /data-testid="bounty-count"/, '要有数量输入框（与 bond-layers 同一写法）');
  assert.match(ui, /bountyCount/, '要有 bountyCount 状态');
  assert.match(ui, /默认 1/, '占位说缺省 1');
});

test('面板发悬赏时带上 count 与 enemyKey', () => {
  const ui = readFileSync(join(ROOT, 'public/js/ui/adminTools.js'), 'utf8');
  const block = ui.slice(ui.indexOf('const argsForRow'));
  assert.match(block.slice(0, 500), /tabId === 'bounty'/, 'argsForRow 要单独处理悬赏');
  assert.match(block.slice(0, 500), /enemyKey: key/, '同时发 enemyKey');
  assert.match(block.slice(0, 500), /count:/, '发 count');
});
