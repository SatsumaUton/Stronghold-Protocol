// Copies client vendor libraries from node_modules into public/vendor (run by `npm run vendor` / postinstall).
//
// three.js (the official 3D board scene, DESIGN §15) ships as two ES modules: three.module.js imports
// './three.core.js', so both are copied side by side and the renderer imports '/vendor/three.module.js' directly
// (no import map, no CDN — LAN play works offline). Optional packages that are not installed are skipped with a
// warning instead of failing the install.
// Preact's hooks build imports the bare specifier "preact"; it is rewritten to the sibling './preact.module.js' (the
// same URL the import map resolves "preact" to, so one Preact instance) — module graphs then load without import-map
// support (Safari < 16.4).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'vendor');

/** Bare specifiers inside vendored ES modules → their sibling vendored file. */
export const VENDOR_REWRITES = Object.freeze({ 'hooks.module.js': { preact: './preact.module.js' } });

/**
 * Rewrite `from"x"` / `from 'x'` / `import("x")` of the mapped bare specifiers in a vendored module source.
 * @param {string} src
 * @param {Record<string, string>} map
 */
export function rewriteBare(src, map) {
  let res = src;
  for (const [bare, rel] of Object.entries(map)) {
    const esc = bare.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    res = res.replace(new RegExp(`(\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s*)(["'])${esc}\\2`, 'g'), (_, pre, q) => `${pre}${q}${rel}${q}`);
  }
  return res;
}

/** [source under the repo root, file name in public/vendor, optional] */
export const VENDOR_FILES = Object.freeze([
  ['node_modules/ses/dist/ses.umd.js', 'ses.umd.js'],
  ['node_modules/acorn/dist/acorn.mjs', 'acorn.mjs'],
  ['node_modules/pixi.js/dist/pixi.min.js', 'pixi.min.js'],
  ['node_modules/pixi-spine/dist/pixi-spine.js', 'pixi-spine.js'],
  ['node_modules/preact/dist/preact.module.js', 'preact.module.js'],
  ['node_modules/preact/hooks/dist/hooks.module.js', 'hooks.module.js'],
  ['node_modules/htm/dist/htm.module.js', 'htm.module.js'],
  ['node_modules/three/build/three.core.js', 'three.core.js', true],
  ['node_modules/three/build/three.module.js', 'three.module.js', true],
]);

export function vendor({ log = console.log, warn = console.warn } = {}) {
  mkdirSync(out, { recursive: true });
  const done = [];
  for (const [src, dst, optional] of VENDOR_FILES) {
    const from = join(root, src);
    if (optional && !existsSync(from)) { warn(`vendor: ${dst} skipped (${src} not installed; the 3D board falls back to 2D)`); continue; }
    if (VENDOR_REWRITES[dst]) writeFileSync(join(out, dst), rewriteBare(readFileSync(from, 'utf8'), VENDOR_REWRITES[dst]));

// SP_PREACT_GUARD（维护者 2026-11-16）：Preact 提交阶段的 `insertBefore(n.__e, …)` 在
// 某个 vnode 没有 DOM 节点时（组件返回 null/undefined）会抛「parameter 1 is not of type Node」，
// 整屏被错误边界接住 —— 本服踩过多次。这里在复制后加一道判空跳过，重生成 vendor 时自动保留。
if (dst === 'preact.module.js') {
  const file = join(out, dst);
  const txt = readFileSync(file, 'utf8');
  const guarded = txt.replace('l=u.insertBefore(n.__e,l||null)', 'n.__e==null?0:(l=u.insertBefore(n.__e,l||null))');
  if (guarded !== txt) writeFileSync(file, guarded);
}
    else copyFileSync(from, join(out, dst));
    done.push(dst);
    log('vendor:', dst);
  }
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) vendor();
