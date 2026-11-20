// test/ui/room-cheat-spectator.test.js —— 观战者不该看到「作弊控制台」按钮（维护者 2026-11-20）。
//
// 背景：ExperimentalControl 对所有人都渲染那排开关（非房主 disabled），观战者也看得到「作弊控制台」。
// 但服务端对观战者是明确拒绝的（room.watcherOf / ERR.SPECTATOR），客户端 testConsole 也只在
// 有座位（seatMine）时给入口 —— 所以这个开关对观战者只是噪音。
//
// 这条测试盯住：① amSpectator 由 isSpectating(room, myId) 推导；② 那块开关被条件包裹。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'public/js/screens/room.js'), 'utf8');

test('静读：房间屏用 isSpectating 推导 amSpectator', () => {
  assert.match(SRC, /import \{[^}]*isSpectating[^}]*\} from '\.\.\/store\.js'/, '要导入 isSpectating');
  assert.match(SRC, /const amSpectator = isSpectating\(room, myId\);/, '★ 要有 amSpectator');
});

test('静读：作弊控制台那块被 amSpectator 条件包裹（观战时不渲染）', () => {
  assert.match(
    SRC,
    /\$\{amSpectator \? null : html`<\$\{Tooltip\} text=\$\{t\('打开后本房间所有玩家/,
    '★ 作弊控制台 Tooltip 必须在 amSpectator ? null : … 里',
  );
  // 包裹必须闭合：起点之后不远处出现 `}`
  const i = SRC.indexOf('${amSpectator ? null : html`');
  assert.ok(i > 0, '找得到包裹起点');
  const tail = SRC.slice(i, i + 4000);
  assert.ok(tail.includes('`}'), '★ 包裹必须闭合（`} 收尾）');
});

test('静读：没有重复声明 myId（组件里原本就有一份）', () => {
  const i = SRC.indexOf('function ExperimentalControl({');
  assert.ok(i > 0, '找到组件');
  const body = SRC.slice(i, SRC.indexOf('function ', i + 10));
  const decls = (body.match(/const myId = useStore\(/g) || []).length;
  assert.equal(decls, 1, `★ ExperimentalControl 里 const myId 只能声明一次（实际 ${decls}）`);
});
