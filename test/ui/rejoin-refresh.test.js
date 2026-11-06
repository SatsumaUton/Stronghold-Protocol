// 「刷新页面」不该把玩家踢出准备室 —— 回归测试。
//
// 玩家报的问题：在房间里（准备室）点横幅上的「刷新页面」，刷新回来人就回到大厅了，
// 房间还得重新输密钥进。
//
// 原因：刷新 = 全新会话，服务端不认识这个连接；而 2026-10-27 起「自动恢复对局」被刻意停用了
// （mm/client.js installAutoRejoin 不再自动发 room.join —— 恢复必须玩家自己点）。
// 所以刷新后停在 hall 是**设计如此**，只有**这个按钮**需要例外：玩家点它的目的就是「同一个房间、
// 换一份新代码」，不是想退出房间。
//
// 做法（一次性标记，不扩大自动回房的范围）：
//   1. ui/connBanner.js 的刷新按钮先 sessionStorage.setItem('sp.rejoinRoom', 房间号) 再 location.reload()；
//   2. screens/lobby.js 的 LobbyScreen 看到这个标记、且当前不在房间里，就 room.join 一次并**清掉标记**。
//
// 这里钉住这四件事：写侧存在、读侧存在且会清标记、读侧只在「在线且不在房间」时动手、
// 普通刷新（没有标记）不会自动回房。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const banner = read('public/js/ui/connBanner.js');
const lobby = read('public/js/screens/lobby.js');

test('刷新按钮先记住房间号再 reload（写侧）', () => {
  // 房间号来自 store 的 room.code
  assert.match(banner, /const roomCode = useStore\(\(s\) => s\.room\?\.code \|\| null\);/);
  // 写标记 + 立刻 reload，同一个函数里
  assert.match(banner, /sessionStorage\.setItem\('sp\.rejoinRoom', String\(roomCode\)\);/);
  assert.match(banner, /if \(roomCode\) sessionStorage\.setItem\('sp\.rejoinRoom', String\(roomCode\)\);/);
  assert.match(banner, /location\.reload\(\);/);
  // 所有「刷新页面」按钮都走这个函数（服务器已更新的横幅 + 版本不匹配的重连横幅）
  const uses = banner.match(/onClick=\$\{reloadKeepingRoom\}|run: reloadKeepingRoom/g) || [];
  assert.equal(uses.length, 2, '两处刷新按钮都要带上房间号');
  assert.doesNotMatch(banner, /onClick=\$\{\(\) => location\.reload\(\)\}/, '不能留下裸 location.reload 的刷新按钮');
  // 没有房间号时就是普通刷新，不写标记
  assert.match(banner, /try \{\s*if \(roomCode\)/, '写标记要包在 try 里（隐私模式会抛）');
});

test('大厅看到标记就回一次房间，然后清掉标记（读侧）', () => {
  assert.match(lobby, /sessionStorage\.getItem\('sp\.rejoinRoom'\)/);
  assert.match(lobby, /sessionStorage\.removeItem\('sp\.rejoinRoom'\)/);
  assert.match(lobby, /joinKnown\('room\.join', code\)/);
  // 只在「连接在线」且「当前不在任何房间」时才回 —— 在房间里刷新不该再发一次 join
  assert.match(lobby, /if \(conn\.status !== 'online' \|\| inRoom\) return undefined;/);
  assert.match(lobby, /const inRoom = useStore\(\(s\) => !!s\.room && !!s\.room\.code\);/);
  // 标记在发请求**之前**就清掉：房间已经没了的时候，不能每次回大厅都重试一遍
  const clearAt = lobby.indexOf("sessionStorage.removeItem('sp.rejoinRoom')");
  const joinAt = lobby.indexOf("joinKnown('room.join', code)");
  assert.ok(clearAt > 0 && joinAt > 0 && clearAt < joinAt, '先清标记再 join');
});

test('没有标记就不自动回房（2026-10-27「恢复必须玩家自己点」仍然成立）', () => {
  // 读侧的唯一触发条件是那个 sessionStorage 标记；没有标记时函数直接返回
  const effect = lobby.slice(lobby.indexOf("sessionStorage.getItem('sp.rejoinRoom')") - 400,
    lobby.indexOf("joinKnown('room.join', code)"));
  assert.match(effect, /if \(!code\) return undefined;/);
  // 客户端仍然不装自动回房
  const client = read('mm/client.js');
  assert.match(client, /installAutoRejoin/, 'mm/client.js 里那个自动回房的入口还在（但被停用）');
});
