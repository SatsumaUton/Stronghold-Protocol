// test/ui/htm-no-literal-comment.test.js —— 防止把 JSX 风格的注释写进 htm 模板。
//
// 事故（2026-11-20）：我在 shopBar.js 的 html`…` 模板里写了
//     {/* ★ …说明… */ null}
// 少了 `$` —— htm 里只有 `${…}` 才是插值，没有 `$` 的 `{/* … */}` 是**字面文本**，
// 于是整段中文注释被当成正文画在商店 card 上，玩家看到的就是「乱码」。
// 本仓的既有写法一律是 `${/* … */ null}`（带 `$`，求值为 null，不渲染）。
//
// 这条测试扫 public/js 下所有 .js：任何 `{/*` 前面不是 `$` 的，都算违规。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const JS = join(ROOT, 'public/js');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('public/js 里没有「缺少 $ 的 {/* … */}」字面注释（htm 会把它们渲染成正文）', () => {
  const bad = [];
  for (const file of walk(JS)) {
    const text = readFileSync(file, 'utf8');
    let i = text.indexOf('{/*');
    while (i >= 0) {
      const before = text[i - 1];
      if (before !== '$') {
        const line = text.slice(0, i).split('\n').length;
        bad.push(`${relative(ROOT, file)}:${line}`);
      }
      i = text.indexOf('{/*', i + 1);
    }
  }
  assert.deepEqual(bad, [], `★ 这些位置的字面注释会被渲染成正文：${bad.join(', ')}`);
});

test('shopBar.js 的盟约行用 precomputed 的 bondStyle（不内联对象字面量）', () => {
  const src = readFileSync(join(JS, 'ui/shopBar.js'), 'utf8');
  assert.match(src, /const bondStyle = face \? \{/, '★ 先算 bondStyle（合并 prefab 几何与官方文字色）');
  assert.match(src, /\$\{regBondLine\(bonds, offBonds, bondStyle, true\)\}/, '★ 模板里只插变量');
  assert.doesNotMatch(src, /\$\{face\?\.bonds\s*\n/, '不再内联三元 + 对象字面量');
});
