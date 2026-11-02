// 检查客户端模块的相对 import 是否都能落到真实文件上。
//
// 为什么需要这个（2026-11-02 的真实事故）：
//   移植卡池编辑器时，`public/js/ui/poolEditor.js` 里把
//     import { useLayoutEffect, useState } from '../../vendor/hooks.module.js';
//   写成了 `'../vendor/hooks.module.js'`（少一层）。node-1 上 `public/js/vendor/` 不存在，
//   于是浏览器取 `/js/vendor/hooks.module.js` 得 404，整个模块图从入口就断掉，
//   玩家看到的是「游戏脚本加载失败，请检查网络连接后重试」，刷新一直转圈 —— 整站进不去。
//
//   当时的自检没抓住它：`node --check` 只验语法，不看 import 目标存不存在；
//   而 `node --input-type=module` 直接 import 那个文件时才报 ERR_MODULE_NOT_FOUND，
//   我把它当成「浏览器模块在 Node 里跑不了」的正常现象忽略了。
//
// 所以这个脚本静态解析 public/js 下每个文件的相对 import / export ... from / 动态 import()，
// 按**浏览器**的解析规则（带扩展名、目录不自动补 index）落到磁盘，缺一个就报出来。
//
// 用法：node tools/_check-client-imports.mjs
// 退出码：0 全部能解析；1 有断链（可用于 CI / 发布前门禁）
'use strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.SP_NODE || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PUBLIC = path.join(ROOT, 'public');

/**
 * 绝对路径说明符（以 `/` 开头）不是相对 `public/` —— 服务器把几个前缀分别映射到别处
 * （见 server/http/static.js 的 createStaticHandler：`{ prefix: '/sim/', dir: simDir }`，
 *  而 simDir 默认是 `path.join(ROOT, 'server', 'sim')`）：
 *   /js /css /vendor /i18n /assets /dev /fonts …  ->  <node>/public/...
 *   /sim     ->  <node>/server/sim
 *   /shared  ->  <node>/shared
 *   /data    ->  <node>/data
 * 实测：GET /sim/constants.js、/shared/poolPlan.js、/vendor/hooks.module.js 都是 200。
 * 不按这张表走会把这些正常引用误报成断链。
 */
const ABS_PREFIX = [
  ['/sim/', path.join(ROOT, 'server', 'sim')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/data/', path.join(ROOT, 'data')],
];

/** 绝对说明符 -> 磁盘路径。 */
function absoluteToDisk(spec) {
  for (const [prefix, dir] of ABS_PREFIX) {
    if (spec.startsWith(prefix)) return path.join(dir, spec.slice(prefix.length));
  }
  return path.join(PUBLIC, spec.replace(/^\//, ''));
}

/** 递归列出 .js / .mjs 文件。 */
function listJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    // 第三方 UMD 包（ses.umd.js = ses@2.3.0，519 KB 压缩成一行）里的 `import './lockdown.js'`
    // 是包内字符串/死代码，不是浏览器会解析的静态导入 —— 不跳过会误报。只跳 *.umd.js，
    // 我们自己的 public/vendor/hooks.module.js 仍然检查（今天的 404 就出在引它的地方）。
    if (/\.umd\.js$/.test(e.name)) continue;
    if (e.isDirectory()) listJs(full, out);
    else if (/\.m?js$/.test(e.name)) out.push(full);
  }
  return out;
}

/** 一个文件里所有相对说明符（静态 import、re-export、动态 import()）。 */
function specifiers(text) {
  const out = [];
  const patterns = [
    /(?:^|[\r\n])\s*import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\r\n])\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|[\r\n])\s*export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

const files = listJs(PUBLIC);
const bad = [];
let checked = 0;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const spec of specifiers(text)) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // 裸说明符走 importmap，不在这里判
    checked++;
    const base = spec.startsWith('/')
      ? absoluteToDisk(spec)
      : path.resolve(path.dirname(file), spec);
    // 浏览器的解析：必须是一个存在的文件（不会自动补 .js，也不会补 /index.js）
    const candidates = [base, `${base}.js`, `${base}.mjs`];
    if (!candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile())) {
      bad.push({ file: path.relative(ROOT, file), spec, want: path.relative(ROOT, base) });
    }
  }
}

console.log(`  检查 ${files.length} 个客户端文件，${checked} 条相对 import`);
if (!bad.length) {
  console.log('  ✓ 全部能解析到真实文件');
  process.exit(0);
}
console.log(`  ★ ${bad.length} 条断链（浏览器会 404，整站可能进不去）：`);
for (const b of bad) console.log(`    ${b.file}\n      import '${b.spec}'  ->  缺 ${b.want}`);
process.exit(1);
