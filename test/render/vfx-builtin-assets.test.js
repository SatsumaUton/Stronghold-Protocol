// test/render/vfx-builtin-assets.test.js —— Unity 内置资源必须归一到兜底/内置生成，不能变成「清单里没有的 key」。
//
// 2026-11-18 全干员审计（143 干员 / 359 技能 / 1013 个特效 key）：
//   清单里根本没有的贴图 key: 1433（default-particle-4350037b 被 common_ignite_attack / buff_weak / swllow S1 … 用）
//   清单里没有的网格: 450        （Plane003-965b3636 / Cylinder001-79145a3e …）
// 这些都是 Unity 自带资源，被提取成了带实例后缀的普通名字。draw() 拿不到就每帧跳过 →
// 整个粒子系统/网格条目静默消失（items 有、tris 无、dropped 恒 0）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { compileMaterial } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/materials.js')).href);
const { meshRef } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/effect.js')).href);

test('Unity 内置贴图（default-*）归一成 key:null，用白色兜底，不用黑色', () => {
  const c = compileMaterial({ name: 'Default-Particle', shader: "Legacy Shaders/Particles/Alpha Blended Premultiply", textures: { _MainTex: { tex: 'default-particle-4350037b' } } }, {});
  const t = c.textures.find((x) => x.name === '_MainTex');
  assert.ok(t, '拿到 _MainTex');
  assert.equal(t.key, null, '★ 内置贴图不能当普通资源名');
  assert.equal(t.def, 'white', 'Default-Particle 是白色圆点 → 白色兜底');
});

test('真实贴图 key 保持不变', () => {
  const c = compileMaterial({ name: 'x', shader: 'Torappu/Particles/AlphaBlend', textures: { _MainTex: { tex: 'flow_102-5bc39624' } } }, {});
  const t = c.textures.find((x) => x.name === '_MainTex');
  assert.equal(t.key, 'flow_102-5bc39624');
});

test('Unity 内置网格归一到 builtin:<Type>', () => {
  assert.equal(meshRef('Plane003-965b3636'), 'builtin:Quad', 'Plane 系列用 1×1 Quad 兜底（内置 Plane 是 10×10 单位，太大）');
  assert.equal(meshRef('plane.025-ffd6f02c'), 'builtin:Quad');
  assert.equal(meshRef('Sphere001-abc12345'), 'builtin:Sphere');
  assert.equal(meshRef('Cube001-abc12345'), 'builtin:Cube');
  assert.equal(meshRef('builtin:Quad'), 'builtin:Quad', '已经是 builtin 的原样返回');
  assert.equal(meshRef('cone001-1e0d8a14'), 'builtin:Quad', '带数字后缀的 cone 也算内置');
});

test('非内置的自定义网格名原样保留（不能被误判）', () => {
  assert.equal(meshRef('hudun_geosphere001-74515470'), 'hudun_geosphere001-74515470');
  assert.equal(meshRef('cathy_slash02-961bc95d'), 'cathy_slash02-961bc95d');
  assert.equal(meshRef('cone'), 'cone', '裸名 cone 是合成名，不是 Unity 内置');
});
