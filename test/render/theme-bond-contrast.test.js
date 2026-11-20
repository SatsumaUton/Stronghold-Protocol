// test/render/theme-bond-contrast.test.js —— 主题模式下盟约图标必须「黑图标 + 白盘」。
//
// 现场（2026-11-20，玩家：用了可露希尔主题包后盟约图标看不清）：
//   原版数据包 shared/assets/local/themes/*/prefabs.json 的 bondicon/bond_icon_view_item 子节点是
//     bg_total   #A1A1A1CC（ac_n_initial）/ #535353CC（ac_s_closur）  半透明底板
//     bg_actual  #FFFFFF                                             **白色圆盘**
//     icon       #000000                                             **黑色图标**
//   状态由 img_active / img_inactive 的**环**表达，不靠图标反色。
//   而我们曾把 `.bond__core` 的主题环替换掉背景（box-shadow: none）丢掉白盘，并把激活图标
//   `filter: brightness(0) invert(1)` 强制成纯白 —— 可露希尔的 bg_active 实测平均亮度 168/255、
//   亮像素 65%（原版 119/255、0%），白图标压上去就糊。
//
// 这条测试同时盯住**数据包**（官方的颜色约定）和**我们的 CSS**（必须遵守它）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');
const THEMES = join(SP, 'shared/assets/local/themes');
const CSS = join(ROOT, 'public/css/screens/game-reghud.css');

/** 读某套主题的 bond_icon_view_item 子节点（name → image） */
function bondItem(id) {
  const p = join(THEMES, id, 'prefabs.json');
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const item = (j.prefabs || j)['bondicon/bond_icon_view_item'];
  if (!item) return null;
  const out = {};
  const walk = (n) => {
    if (!n) return;
    if (n.image) out[n.name] = n.image;
    for (const c of n.children || []) walk(c);
  };
  walk(item);
  return out;
}

test('数据包：官方 prefab 是「白盘 + 黑图标」（原版与可露希尔一致）', () => {
  for (const id of ['ac_n_initial', 'ac_s_closur']) {
    const it = bondItem(id);
    if (!it) { continue; }
    assert.equal(String(it.bg_actual?.color).toUpperCase(), '#FFFFFF', `★ ${id}: bg_actual 应为白盘`);
    assert.equal(String(it.icon?.color).toUpperCase(), '#000000', `★ ${id}: icon 应为黑图标`);
    assert.ok(it.img_active?.sprite === 'bg_active', `${id}: 激活态由 bg_active 环表达`);
    assert.ok(it.img_inactive?.sprite === 'bg_inactive', `${id}: 未激活态由 bg_inactive 环表达`);
  }
});

test('CSS：只在可露希尔（ac_s_closur）下铺白盘，其它主题不受影响', () => {
  const css = readFileSync(CSS, 'utf8');
  assert.match(css, /html\[data-sp-theme="ac_s_closur"\] \.gm__bonds--pf \.bond__core,/, '★ 选择器限定到可露希尔');
  assert.match(css, /background-color: #fff;/, '★ 可露希尔下铺白盘（解包 bg_actual #FFFFFF）');
  // 全局规则保持原样（其它主题仍是环 + invert 白图标）
  assert.match(css, /\.gm__bonds--pf \.bond__core \{ background: var\(--pf-bond-off\) center \/ 129% 129% no-repeat; box-shadow: none; \}/, '全局 core 未改');
});

test('CSS：可露希尔下图标改黑，且按 36/58=62% 缩到官方尺寸', () => {
  const css = readFileSync(CSS, 'utf8');
  assert.match(css, /html\[data-sp-theme="ac_s_closur"\] \.gm__bonds--pf \.bond__icon,[\s\S]{0,200}filter: brightness\(0\);/, '★ 可露希尔：黑图标');
  assert.match(css, /html\[data-sp-theme="ac_s_closur"\][\s\S]{0,400}width: 62%;/, '★ 可露希尔：62%（解包 icon 36/58）');
  // 其它主题仍是原来的反白（不许被这次改动波及）
  assert.match(css, /\.gm__bonds--pf \.bond\.is-active \.bond__icon \{ filter: brightness\(0\) invert\(1\); \}/, '★ 全局仍是原样');
});

test('CSS：可露希尔下文字字形也是深色（白盘上不能是白字）', () => {
  const css = readFileSync(CSS, 'utf8');
  assert.match(css, /html\[data-sp-theme="ac_s_closur"\] \.gm__bonds--pf \.bond__glyph,[\s\S]{0,160}color: #111;/, '可露希尔：深色字形');
});
