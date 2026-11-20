// test/ui/htm-template-comment.test.js —— 防止把 JS 注释写进 htm 模板。
//
// 事故（2026-11-21）：我在 room.js 的难度胶囊里写了
//     <button type="button" class=${…} disabled=${…}
//     /* ★ 2026-11-21：难度色必须由胶囊自己带 … */
//     style=${…}>
// htm 是运行时模板：标签内部的 `/* … */` 不是注释，它被当成属性/文本，把 `style` 整条吃掉，
// 难度色就失效了（玩家看到「难度按钮变成统一紫色」）。
//
// 合法写法只有两种：
//   · `${/* … */ null}` —— 插值里求值为 null，不渲染；
//   · 注释写在整个 html`…` 表达式**之外**。
//
// 判定：在 html`…` 的**模板文本层**（不在任何 ${…} 内）出现 `/*` 即违规；
//       属性值里的通配符（accept="audio/*,…"）除外。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const JS = join(ROOT, 'public/js');
const OPEN = 'html`';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('html`…` 模板里没有裸的 /* … */ 注释（htm 会当成属性/文本）', () => {
  const bad = [];
  for (const file of walk(JS)) {
    const text = readFileSync(file, 'utf8');
    let from = 0;
    for (;;) {
      const start = text.indexOf(OPEN, from);
      if (start < 0) break;
      let i = start + OPEN.length;
      let depth = 0;                     // ${…} 嵌套深度
      while (i < text.length) {
        const ch = text[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '$' && text[i + 1] === '{') { depth += 1; i += 2; continue; }
        if (ch === '}' && depth > 0) { depth -= 1; i += 1; continue; }
        if (ch === '`' && depth === 0) break;
        if (ch === '/' && text[i + 1] === '*' && depth === 0) {
          // 只认「整行以 /* 开头」的独立注释行（行内的 catch { /* ignore */ } 是合法 JS）
          const lineStart = text.lastIndexOf('\n', i) + 1;
          const standalone = text.slice(lineStart, i).trim() === '';
          const prev = text[i - 1] || '';
          const next = text[i + 2] || '';
          const inAttribute = prev === '"' || prev === '=';
          const wildcard = /[,.;)]/.test(next);
          if (standalone && !inAttribute && !wildcard) {
            const line = text.slice(0, i).split('\n').length;
            bad.push(`${relative(ROOT, file)}:${line}`);
          }
        }
        i += 1;
      }
      from = i + 1;
    }
  }
  assert.deepEqual(bad, [], 'htm 模板里的 /* … */ 会被当文本（改成 ${/* … */ null} 或移到模板外）：' + bad.join(', '));
});
