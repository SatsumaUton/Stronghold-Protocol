// test/sim/enemy-blocked-route.test.js —— 「敌人被堵死后不能穿墙」的回归闸门。
//
// 玩家反馈（2026-11-18）：深渊回响里有的敌对目标会穿墙走到终点。
//
// 根因（ai.js planLeg）：`legField` 返回 null（路被干员/木箱堵死）后，代码**仍然无条件** push 目标点，
// 于是敌人沿「起点→终点」直线穿墙直走，随后 leak。实测：221 条 WALK 路线里，把走廊铺满障碍后
// 有 147 条会变成不可达（可走格只占 28%，地图很窄）。
//
// 但 `legField` 为 null 有**两种成因**，必须分开处理（第一版修得太狠，敌人卡在出生点不动）：
//   A. 正常场不可达、忽略障碍场**可达** → 路被干员/木箱堵住 → 原地等待（每帧重算）
//   B. 两个场**都不可达** → 出生口在墙格上 → 必须先直线走进战场（这是所有关卡一直依赖的行为）
//
// 这条测试盯住：A 类等待、B 类照走、第一版不推进 legIdx。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = readFileSync(`${ROOT}server/sim/ai.js`, 'utf8');

test('静读：无可用流场（被堵住）时标记 blocked，不补终点', () => {
  const fn = SRC.slice(SRC.indexOf('function planLeg'), SRC.indexOf('/** Estimated length of legs'));
  assert.match(fn, /R\.blocked = true/, 'A 类（被堵住）要标记 blocked');
  const softBranch = fn.slice(fn.indexOf('if (info.soft)'), fn.indexOf('if (info.f)'));
  assert.doesNotMatch(softBranch, /pts\.push\(\{ x: leg\.c, y: leg\.r \}\)/, 'A 类不能 push 终点（那就是直线穿墙）');
});

test('静读：B 类（出生口在墙格）仍然直线走进战场', () => {
  const fn = SRC.slice(SRC.indexOf('function planLeg'), SRC.indexOf('/** Estimated length of legs'));
  assert.match(fn, /info\.out/, '要区分「两个场都不可达」');
  assert.match(fn, /pts\.push\(\{ x: leg\.c, y: leg\.r \}\);/, 'B 类要补终点（否则敌人永远不动）');
});

test('静读：legFieldInfo 的三向判定（可达 / 只忽略障碍可达 / 都不可达）', () => {
  const fn = SRC.slice(SRC.indexOf('function legFieldInfo'), SRC.indexOf('function legField('));
  assert.match(fn, /return \{ f, soft: false \}/, '正常可达');
  assert.match(fn, /soft: true/, '只有忽略障碍可达 → soft（被堵住）');
  assert.match(fn, /out: true/, '都不可达 → out（出生口在墙格）');
});

test('静读：move 段遇到 blocked 直接返回，不推进 legIdx', () => {
  const move = SRC.slice(SRC.indexOf('// move'), SRC.indexOf('budget = dist / speed;'));
  assert.match(move, /if \(R\.blocked\)/, 'move 段要检查 R.blocked');
  assert.match(move, /planLeg\(b, e, leg\)/, 'blocked 时要重算（路一开就继续）');
  const tail = SRC.slice(SRC.indexOf('budget = dist / speed;'), SRC.indexOf('budget = dist / speed;') + 400);
  assert.match(tail, /!R\.blocked/, 'blocked 时不许推进 legIdx（否则等于瞬移）');
});
