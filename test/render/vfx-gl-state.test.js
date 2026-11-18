// test/render/vfx-gl-state.test.js —— raw GL 绘制前必须自己摆正 Pixi 留下的状态。
//
// 玩家 2026-11-18：官方技能特效（银灰 S3 / 遥 / 塔露拉）全看不见，只有我们的程序化泡泡能看见。
// 泡泡走 Pixi/Spine；官方特效走 render/vfx/gl.js 的 raw GL。
//
// Pixi 在画过带遮罩的元素之后会留下 SCISSOR_TEST 开启并把 scissor 矩形设成那个元素，
// 我们的三角形就被裁进那个小矩形里 —— 画了、但看不见。
// 这套特效层永远不被遮罩，所以 draw 开头必须显式关掉 scissor / stencil，并把 viewport 摆成整张画布。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('静读：draw 开头关掉 SCISSOR_TEST / STENCIL_TEST 并设置 viewport', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/gl.js'), 'utf8');
  const i = src.indexOf('draw(items, frame) {');
  assert.ok(i > 0, '找到 draw');
  const head = src.slice(i, i + 1200);
  assert.match(head, /gl\.disable\(gl\.SCISSOR_TEST\)/, '★ 必须关掉 scissor，否则会被 Pixi 上一个遮罩裁掉');
  assert.match(head, /gl\.disable\(gl\.STENCIL_TEST\)/, 'stencil 也要关');
  assert.match(head, /gl\.viewport\(0, 0, gl\.drawingBufferWidth, gl\.drawingBufferHeight\)/, '★ viewport 要摆成整张画布');
});

test('静读：resetPixi 把 scissor/stencil 交还给 Pixi 时一并关掉', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/system.js'), 'utf8');
  const i = src.indexOf('export function resetPixi(renderer) {');
  assert.ok(i > 0, '找到 resetPixi');
  const body = src.slice(i, i + 700);
  assert.match(body, /SCISSOR_TEST/, '交还时关掉 scissor');
  assert.match(body, /STENCIL_TEST/, '交还时关掉 stencil');
  assert.match(body, /renderer\.state\.reset\(\)/, '仍要调用 Pixi 自己的状态复位');
});
