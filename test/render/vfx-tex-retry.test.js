// test/render/vfx-tex-retry.test.js —— 贴图加载失败不能被永久缓存。
//
// 现场（2026-11-18）：遥的 20 个特效条目全部被 draw() 跳过 —— items 20、tris 0、changed 0。
// 原因：library.js 失败时 `this.images.set(id, null)`，而 texture() 的
// `if (r !== undefined) return r` 会命中这个 null 并永远返回 null。
// 一次网络抖动 = 这张贴图在整个会话里彻底不可用，引用它的特效静默消失。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('静读：loadTexture 的失败路径不写 images 缓存，并清掉 in-flight 记录', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/library.js'), 'utf8');
  const i = src.indexOf('loadTexture(key, half) {');
  assert.ok(i > 0, '找到 loadTexture');
  const body = src.slice(i, src.indexOf('/** Decode an image', i));
  const ei = body.lastIndexOf('}, (err) => {');
  assert.ok(ei > 0, '找到失败回调');
  const cb = body.slice(ei, ei + 900);
  assert.match(cb, /this\.imageLoads\.delete\(id\)/, '★ 失败后要让下一次 texture() 能重试');
  assert.doesNotMatch(cb, /this\.images\.set\(id, null\)/, '★ 不能再把失败永久缓存');
  assert.match(cb, /texFail/, '记录失败计数供诊断');
});

test('静读：fxPasses().skip 暴露 texFail / missingTex', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/system.js'), 'utf8');
  const i = src.indexOf('fxPasses() {');
  const body = src.slice(i, src.indexOf('fxDetail()', i));
  assert.match(body, /missingTex/, '缺贴图的 key 列表');
  assert.match(body, /texFail/, '贴图失败次数');
});
