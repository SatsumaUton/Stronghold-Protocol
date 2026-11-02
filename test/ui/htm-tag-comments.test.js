// htm 模板标签**内部**的 `//` 注释会让它后面的属性整条消失，而且不报任何错。
//
// 2026-11-02 玩家反馈「同盟模拟里根本没有『公开同盟』按钮」，根因就是这个：
//   大厅里 <${AllianceSelect} … capacity=${…}
//     // 公开同盟：列表叠在同盟模拟上面…
//     onBrowse=${() => setBrowseOpen(true)} />
// htm 把 `//` 开头的那一行当成属性名，于是 onBrowse 根本没传进去，
// AllianceSelect 里 `onBrowse ? html`…` : null` 永远走 null 分支 —— 按钮从来没渲染过。
// 浏览器探针（headless Edge）确认：标签里带注释时 .ally-side 只有两张卡片。
//
// 这个坑没有任何报错，只能靠静态扫描守住。判据：一行是 `//…` 注释、
// 上一行是属性续行、下一行是 `name=${…}` 形式的属性 —— 三者同时成立基本就是写在标签里了。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const ATTR = /^\s+[A-Za-z_$][\w$]*=\$\{/;
const COMMENT = /^\s*\/\//;

describe('htm 模板里不许把 // 注释写在标签里', () => {
  test('public/js 下没有「注释行后面紧跟属性」的写法', () => {
    const hits = [];
    for (const file of jsFiles(path.join(ROOT, 'public/js'))) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      for (let i = 1; i < lines.length - 1; i++) {
        if (!COMMENT.test(lines[i]) || !ATTR.test(lines[i + 1])) continue;
        hits.push(`${path.relative(ROOT, file)}:${i + 1} → ${lines[i + 1].trim()}`);
      }
    }
    assert.deepEqual(hits, [], '这些注释写在标签内部，会把后面的属性吃掉；挪到标签外面或改成 ${/* … */ null}');
  });

  test('大厅确实把 onBrowse 传给了 AllianceSelect（按钮能渲染出来）', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
    const at = src.indexOf('<${AllianceSelect}');
    assert.ok(at > 0, '找得到 AllianceSelect 的调用');
    const tag = src.slice(at, src.indexOf('/>', at));
    assert.match(tag, /onBrowse=\$\{/, 'onBrowse 必须在这条标签里');
    assert.equal(/^\s*\/\//m.test(tag), false, '标签里不能有 // 注释（属性会被吃掉）');
  });
});
