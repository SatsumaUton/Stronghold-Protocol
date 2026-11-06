// 换设备恢复对局：跳转地址要带「房间所在节点」。
//
// 维护者 2026-11-06：玩家 271002724@qq.com（账号 344「暴戾皇女」）在**深渊回响**房 PBJH（node-26）
// 换设备后点「前往该房间继续对局」，落回首页并弹「当前节点没有可恢复的账号对局」。
//
// 原因：深潜房码只进节点上报的 `echoCodes`，而按房号反查节点的 /api/resolve-room、
// /api/room-redirect、/api/find-room 只看 `codes`（matchmaker/roomDir.cjs 的约定）。
// 实测：/api/resolve-room?code=PBJH → 403；/api/room-redirect?code=PBJH → 302 Location: /。
// 而 /mm/api/account/room 本来就回了 room.node，前端却把它丢了，只会拼 /r/CODE。
//
// 现在：节点已知 → `/?room=CODE&n=N`（nginx 的显式目标通道，map $arg_n $sp_room_node 会钉死节点）；
// 节点未知 → 退回 /r/CODE。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeRoomUrl } from '../../public/js/ui/resumeMatch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('深潜房：知道节点时用 ?room=&n= 钉住那台节点（不再是 /r/CODE）', () => {
  // 玩家实测的那一局：深渊回响 PBJH 在 node-26
  assert.equal(resumeRoomUrl({ code: 'PBJH', node: 26 }), '/?room=PBJH&n=26');
});

test('普通房同样受益：带节点就不再依赖「节点十秒一上报」的房号目录', () => {
  assert.equal(resumeRoomUrl({ code: 'RMMM', node: 4 }), '/?room=RMMM&n=4');
});

test('节点未知 / 越界 / 非数字 → 退回 /r/CODE', () => {
  for (const node of [null, undefined, NaN, 0, 31, -1, '26x', '']) {
    assert.equal(resumeRoomUrl({ code: 'PBJH', node }), '/r/PBJH', `node=${String(node)} 要走兜底`);
  }
  assert.equal(resumeRoomUrl({ code: 'PBJH' }), '/r/PBJH');
});

test('节点边界 1 与 30 都算合法', () => {
  assert.equal(resumeRoomUrl({ code: 'AAAA', node: 1 }), '/?room=AAAA&n=1');
  assert.equal(resumeRoomUrl({ code: 'AAAA', node: 30 }), '/?room=AAAA&n=30');
});

test('房间码做 URL 编码，而且没有房间码时返回 null', () => {
  assert.equal(resumeRoomUrl({ code: 'a b', node: 2 }), '/?room=a%20b&n=2');
  assert.equal(resumeRoomUrl(null), null);
  assert.equal(resumeRoomUrl({}), null);
  assert.equal(resumeRoomUrl({ code: '' }), null);
});

test('组件不再直接拼 /r/CODE?accountResume=1，而是走 resumeRoomUrl', () => {
  const src = read('public/js/ui/resumeMatch.js');
  assert.doesNotMatch(src, /location\.assign\(`\/r\//, '大厅里的跳转不能再写死 /r/CODE');
  assert.match(src, /const goToRoom = \(\) => \{[\s\S]{0,220}resumeRoomUrl\(elsewhere\)/, 'goToRoom 要用 resumeRoomUrl');
  // 真正起作用的是这个一次性标记，不是 URL 参数
  assert.match(src, /sessionStorage\.setItem\('sp\.accountResume', '1'\)/);
});
