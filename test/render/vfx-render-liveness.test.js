// test/render/vfx-render-liveness.test.js —— 渲染层不能因为一次抛错就永久空转。
//
// 玩家 2026-11-18 的现场：银灰 S3 / 遥 / 塔露拉的特效全看不到，只有我们的程序化「泡泡」能看见 ——
// 因为泡泡走的是 Spine/Pixi 那套，而官方特效走 FxGL 的 raw GL 绘制。
//
// 根因线索：renderPass 的 try 里 `_prepare(renderer)` 的第一行就是 `this.prepared = this.frameNo;`，
// 一旦 _prepare 抛错，prepared 已经是「本帧」了，于是本帧后面每次 renderPass 都跳过 _prepare，
// items 永远空 —— 而 catch 只 console.error 一次就永久静默，玩家侧完全感觉不到。
//
// 这个测试盯住：catch 必须复位 prepared（让下一帧重试）、必须记录 err/errCount。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('静读：renderPass 的 catch 复位 prepared 并记录错误', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/system.js'), 'utf8');
  const i = src.indexOf('renderPass(pass, renderer, selectedItems = null) {');
  assert.ok(i > 0, '找到 renderPass');
  const body = src.slice(i, src.indexOf('stats() {', i));
  // renderPass 里有两个 catch：glr 初始化失败那个（不该复位 prepared），以及绘制那个（必须复位）。
  // 取**最后**一个。
  const ci = body.lastIndexOf('} catch (err) {');
  assert.ok(ci > 0, 'renderPass 有绘制 catch');
  const catchBlock = body.slice(ci, ci + 900);
  assert.match(catchBlock, /this\.prepared = -1/, '★ catch 必须复位 prepared —— 否则本帧后续所有 pass 都不再 _prepare，特效层永久空转');
  assert.match(catchBlock, /this\._renderErr =/, '记录错误原文');
  assert.match(catchBlock, /this\._renderErrCount/, '记录错误次数');
});

test('静读：fxPasses 暴露 err / errCount / skip 计数', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/system.js'), 'utf8');
  const i = src.indexOf('fxPasses() {');
  const body = src.slice(i, src.indexOf('fxDetail()', i));
  assert.match(body, /err: this\._renderErr/, '★ 渲染错误要能被诊断读到');
  assert.match(body, /skip:/, 'GL 的静默跳过计数');
  assert.match(body, /progFail:/, 'program 编译失败计数');
});

test('静读：gl.js 统计所有静默跳过绘制的出口', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/gl.js'), 'utf8');
  assert.match(src, /skipNoProg/, 'program 失败的跳过计数');
  assert.match(src, /skipNoTex/, '贴图未就绪的跳过计数');
  assert.match(src, /skipNoMesh/, '网格缺失的跳过计数');
});
