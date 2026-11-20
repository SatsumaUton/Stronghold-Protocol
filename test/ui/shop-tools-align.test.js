// test/ui/shop-tools-align.test.js —— 窄屏把「冻结 + 刷新」对齐到商店池（维护者 2026-11-20 要求）。
//
// 为什么需要 JS：.shopbar__tools 与 .shopbar__row 是兄弟节点，CSS 无法让一个兄弟对齐到另一个兄弟内部
// 子元素（.shopbar__cards）的盒子。做法：useRegFit 里量一次中心差 → --reg-tools-shift → CSS transform。
// 注意 cluster 带 scale(--reg-k)，元素坐标里的位移要除以 k 才是屏幕位移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const js = readFileSync(join(ROOT, 'public/js/ui/shopBar.js'), 'utf8');
const css = readFileSync(join(ROOT, 'public/css/screens/game-reghud.css'), 'utf8');

test('shopBar.js 有 fitTools，按商店池中心算位移', () => {
  assert.match(js, /function fitTools\(el, k\)/, '★ 要有 fitTools');
  assert.match(js, /\.shopbar__cards'\) \|\| el\.querySelector\('\.shopbar__row'\)/, '★ 以卡牌组为准（没有则退回行）');
  assert.match(js, /--reg-tools-shift/, '★ 写 --reg-tools-shift');
  assert.match(js, /\(c\.left \+ c\.width\) - \(t\.left \+ t\.width\)/, '★ 右边缘对齐（商店池右上角）');
  assert.match(js, /\/(\s*\(\s*k\s*\|\|\s*1\s*\))/, '★ 位移要除以 --reg-k（cluster 被 scale）');
  assert.match(js, /fitTools\(el, k\)/, '★ 在 fit() 里调用');
});

test('CSS：窄屏媒体查询里应用 --reg-tools-shift', () => {
  const i = css.indexOf('@media (max-width: 900px)');
  assert.ok(i > 0, '有窄屏媒体查询');
  const block = css.slice(i, i + 1200);
  assert.match(block, /\.shopbar--reg \.shopbar__tools \{/, '★ 在窄屏里改工具带');
  assert.match(block, /transform: translateX\(var\(--reg-tools-shift, 0px\)\)/, '★ 用位移变量（0 兜底）');
});
