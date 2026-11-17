// 管理员工具的「深渊回响」页签只在本局是深渊回响时出现（维护者 2026-11-17）。
//
// 背景：那个页签以前在任何模式都摆出来，但里面的 4 条指令（echoBlessing / echoCurse / echoWord /
// echoProjection）只有深潜局才生效 —— 服务端每条都以 `echoVariant !== 'deepecho'` 拒绝
// （WRONG_PHASE + detail 'echo'）。别的模式点了只会失败，界面不该把它摆出来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('管理员工具：深渊回响页签按 m.public.echo.deepecho 过滤', () => {
  const src = read('public/js/ui/adminTools.js');
  // 读的是对局的公开数据，不是房间（房间也有 variant，但对局侧的 echo 才是权威）
  assert.match(src, /st\.match\.public\?\.echo\?\.deepecho === true/, '要读 m.public.echo.deepecho');
  // 页签渲染时过滤掉 echo
  const nav = src.split('\n').find((l) => l.includes('TABS') && l.includes('.map('));
  assert.ok(nav, '找不到页签渲染那一行');
  assert.match(nav, /x\.id !== 'echo' \|\| isEcho/, '★ 只有 isEcho 时才渲染「深渊回响」页签');
});

test('服务端本来就把深渊指令拦在深潜局（界面过滤只是让它更早暴露）', () => {
  const cmds = read('server/match/match/testCommands.js');
  for (const fn of ['_testEchoBlessing', '_testEchoCurse', '_testEchoWord', '_testEchoProjection']) {
    assert.match(cmds, new RegExp(`${fn}[^}]*echoVariant !== 'deepecho'`), `★ ${fn} 必须自带 echoVariant 检查`);
  }
});
