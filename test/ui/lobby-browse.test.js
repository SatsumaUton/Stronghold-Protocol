// 公开同盟（同盟列表）弹窗的层级 —— 回归测试。
//
// 玩家报的问题：在「同盟模拟」里点「公开同盟」，界面跳回了大厅，而不是叠在同盟模拟上面弹出来。
//
// 原因：点按钮的回调里先 setAllyOpen(false) 再 setBrowseOpen(true)。
// 同盟模拟那层 Modal 先被卸掉 —— 屏幕上那一刻就是大厅 —— 然后列表才画出来。
// 参考版不是这么做的：它的条件是 `listOpen && allyOpen`，也就是列表**只在同盟模拟开着时**
// 叠上去，关掉列表 = 回到同盟模拟（Modal 的 modalStack 保证只有最上层响应 Esc / Tab / 焦点，
// 所以两层叠着不会打架）。
//
// 这里钉住三件事：
//   1. 点「公开同盟」不关同盟模拟；
//   2. 列表的渲染条件是 browseOpen && allyOpen（同盟模拟关了就一起收掉）；
//   3. 关同盟模拟时顺手清掉 browseOpen —— 否则这个标记会滞留，下次打开同盟模拟
//      列表会自己弹出来。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const lobby = read('public/js/screens/lobby.js');
/** 去掉注释，避免断言被解释性的文字骗过。 */
const code = lobby.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('点「公开同盟」只打开列表，不关掉同盟模拟', () => {
  assert.match(code, /onBrowse=\$\{\(\) => setBrowseOpen\(true\)\}/, 'onBrowse 应该只 setBrowseOpen(true)');
  assert.doesNotMatch(code, /onBrowse=\$\{\(\) => \{ setAllyOpen\(false\); setBrowseOpen\(true\); \}\}/, '旧写法（先关浮层）不能再回来');
  // 也不许用别的花招在同一个回调里关掉它
  const cb = code.match(/onBrowse=\$\{([^}]*)\}/);
  assert.ok(cb, 'onBrowse 的回调要能找到');
  assert.doesNotMatch(cb[1], /setAllyOpen/, 'onBrowse 里不该出现 setAllyOpen');
});

test('列表的渲染条件是「列表要开」且「同盟模拟还开着」', () => {
  assert.match(code, /\$\{browseOpen && allyOpen \? html`<\$\{RoomListDialog\}/);
  // 关掉列表只是收列表，同盟模拟留在原地
  assert.match(code, /onClose=\$\{\(\) => setBrowseOpen\(false\)\}/);
});

test('关同盟模拟时把列表标记一起清掉（否则下次会自己弹出来）', () => {
  assert.match(code, /onClose=\$\{\(\) => \{ setAllyOpen\(false\); setBrowseOpen\(false\); \}\}/);
});

test('从列表加入房间时两层一起收掉，再进房间', () => {
  // 跨节点列表要带节点号：进房走 enterRoom(code, node)（2026-11-02 之后一直是这个实现，用例没跟上）
  assert.match(code, /onJoin=\$\{\(c, node\) => \{ setBrowseOpen\(false\); setAllyOpen\(false\); enterRoom\(c, node\); \}\}/);
});
