// 重写守卫测试：手机商店区整体贴右边（维护者 2026-11-20），不再有 JS 量位置平移。
// 断言：① 窄屏媒体查询里 cluster 不撑满、卡片行与工具带都右对齐；
//       ② shopBar.js 里不再有 fitTools / --reg-tools-shift，但保留 fitUpgrade（升级卡缩放）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const js = readFileSync(join(ROOT, 'public/js/ui/shopBar.js'), 'utf8');
const css = readFileSync(join(ROOT, 'public/css/screens/game-reghud.css'), 'utf8');

test('CSS：窄屏不撑满 cluster，卡片行与工具带都右对齐（贴屏幕右边，同 PC）', () => {
  const i = css.indexOf('@media (max-width: 900px)');
  assert.ok(i > 0, '有窄屏媒体查询');
  const end = css.indexOf('@media (max-height', i);
  const block = css.slice(i, end > i ? end : i + 1200);
  assert.doesNotMatch(block, /\.shopbar__cluster \{ width: 100%/, '★ 不再把 cluster 拉成 100%');
  assert.match(block, /\.shopbar__tools \{ justify-content: flex-end; \}/, '★ 工具带右对齐');
  assert.match(block, /justify-content: flex-end; \}/, '★ 卡片行右对齐');
  assert.match(block, /width: max-content; max-width: 100%/, '★ 行宽按内容、不超视口');
  assert.doesNotMatch(block, /justify-content: center/, '★ 不再居中');
});

test('JS：不再量商店池位置平移（fitTools / --reg-tools-shift 已删除）', () => {
  assert.doesNotMatch(js, /function fitTools/, 'fitTools 应已删除');
  assert.doesNotMatch(js, /--reg-tools-shift/, '位移变量应已删除');
  assert.doesNotMatch(css, /--reg-tools-shift/, 'CSS 里也不该再引用');
});

test('JS：升级卡的 --up-k 仍然跟随卡片高度（保留）', () => {
  assert.match(js, /function fitUpgrade\(el, k\)/, '★ 要保留 fitUpgrade');
  assert.match(js, /--up-k/, '★ 写 --up-k');
  assert.match(js, /fitUpgrade\(el, k\)/, '★ 在 fit() 里调用');
});
