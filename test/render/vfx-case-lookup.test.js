// test/render/vfx-case-lookup.test.js —— 清单键混合大小写，引用是小写：查表必须不区分大小写。
//
// 2026-11-18 全干员审计（143 干员 / 359 技能 / 1013 个特效 key）：
//   清单 fx/tex 里是 Default-Particle-4350037b、hudun_GeoSphere001-74515470（混合大小写），
//   而描述符引用的是 default-particle-4350037b、hudun_geosphere001-74515470（小写）。
//   以前精确查表 → 查不到 → images 永久缓存 null → draw() 每帧跳过该粒子系统 →
//   特效静默消失（items 有、tris 恒 0、dropped 恒 0，几乎无法察觉）。
//
// 修法：精确命中优先，未命中走小写索引（library.js 的 _groupEntry / url）。
// 注意：**不要**把 primitive 名的网格归一到 builtin —— 它们在清单里是真实导出过的
// （Plane003-… / Cylinder001-… 共 990 个），归一化会把真网格换成 Quad，是回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { FxLibrary } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/library.js')).href);
const { meshRef } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/effect.js')).href);

test('_groupEntry：精确命中优先，大小写不同也能命中', () => {
  const lib = new FxLibrary({});
  lib.groups = {
    'fx/tex': {
      'Default-Particle-4350037b': { path: '/a.webp' },
      'flow_102-5bc39624': { path: '/b.webp' },
    },
    'fx/mesh': { 'hudun_GeoSphere001-74515470': { path: '/c.json' } },
  };
  assert.equal(lib._groupEntry('fx/tex', 'flow_102-5bc39624')?.path, '/b.webp', '精确命中');
  assert.equal(lib._groupEntry('fx/tex', 'default-particle-4350037b')?.path, '/a.webp', '★ 小写引用命中混合大小写的清单键');
  assert.equal(lib._groupEntry('fx/mesh', 'hudun_geosphere001-74515470')?.path, '/c.json', '★ 网格同理');
  assert.equal(lib._groupEntry('fx/tex', 'nope'), null, '真的没有才返回 null');
});

test('url() 走大小写不敏感查表', () => {
  const lib = new FxLibrary({});
  lib.groups = { 'fx/mesh': { 'hudun_GeoSphere001-74515470': { path: '/c.json' } } };
  assert.equal(lib.url('fx/mesh', 'hudun_geosphere001-74515470'), '/c.json');
});

test('primitive 名的网格原样保留（不归一成 builtin —— 它们是真实导出的网格）', () => {
  assert.equal(meshRef('Plane003-965b3636'), 'Plane003-965b3636');
  assert.equal(meshRef('Cylinder001-79145a3e'), 'Cylinder001-79145a3e');
  assert.equal(meshRef('builtin:Quad'), 'builtin:Quad', '本来就是 builtin 的原样返回');
});

test('贴图 key 不做归一（由 library 查表时统一处理大小写）', async () => {
  const { compileMaterial } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/materials.js')).href);
  const c = compileMaterial({ name: 'x', shader: 'Torappu/Particles/AlphaBlend', textures: { _MainTex: { tex: 'Default-Particle-4350037b' } } }, {});
  const t = c.textures.find((x) => x.name === '_MainTex');
  assert.equal(t.key, 'Default-Particle-4350037b', '原样保留，交给查表层做大小写匹配');
});
