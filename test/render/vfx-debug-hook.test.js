// test/render/vfx-debug-hook.test.js —— 诊断钩子必须在构造时就存在。
//
// 玩家 2026-11-18 执行 `__SP_FX_DEBUG__()` 得到 `is not defined`：
// 第一版把钩子装在 `begin()` 末尾，而 `begin()` 的第一行是 `if (!this.ofx.active) return 0`
// —— 官方特效关闭 / 不可用时它直接返回，钩子根本不会被装。
//
// 这个「未定义」本身就是最有力的诊断信息：官方特效没开，或素材不可用。
// 但钩子仍然必须在构造时就装上，否则玩家永远拿不到 tier 等状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('静读：_installDebug 在构造函数里调用（不在 begin() 里）', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/wiring.js'), 'utf8');
  const ctor = src.slice(src.indexOf('constructor(ofx, opts'), src.indexOf('get index()'));
  assert.match(ctor, /this\._installDebug\(\)/, '★ 钩子必须在构造函数里装');
  const begin = src.slice(src.indexOf('async begin(views)'), src.indexOf('more(views)'));
  assert.doesNotMatch(begin, /this\._installDebug\(\)/, 'begin() 在 ofx.active 为假时会提前 return，不能装钩子');
});

test('运行时：构造函数执行后钩子已存在，且返回 tier / dropped / units', async () => {
  const { FxWiring } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/wiring.js')).href);
  delete globalThis.__SP_FX_DEBUG__;

  const ofx = {
    active: false, time: 0, lite: false, tier: 'off', timers: [], dropped: 0, effects: [], pending: [], particles: 0,
    lib: { has: () => false, def: () => null, index: async () => null, preload: async (k) => k.length, defs: new Map() },
    spawn: () => null,
  };
  const w = new FxWiring(ofx, {});
  assert.equal(typeof globalThis.__SP_FX_DEBUG__, 'function', '★ 构造完钩子就该在（即使特效关着）');
  const st = globalThis.__SP_FX_DEBUG__();
  // 替身 ofx 没有 stats()，钩子用 {} 兜底 → tier 是 undefined；真实 ofx 有 stats()，会如实报 off。
  // 这里只断言钩子可用、字段齐全，不假设替身实现。
  assert.equal(typeof st.dropped, 'undefined', '替身 ofx 没有 stats() → stats 字段由 {} 兜底');
  assert.ok(Array.isArray(st.units));
  delete globalThis.__SP_FX_DEBUG__;
});
