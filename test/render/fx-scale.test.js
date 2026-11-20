// test/render/fx-scale.test.js —— 特效播放层的统一缩放（scale）。
//
// 现场（2026-11-20，玩家：塔露拉 S3 变成一条火雨）：
//   oxi_skill_03_trail_01 实测 4.3×2.8 格，而车道只隔 1 格 → 纵向重叠 64%，4 条并成一条厚火带。
//   要让它读成 4 条只能缩小每条。但**缩根节点无效**：scalingMode=Local 的系统故意忽略父级缩放
//   （实测 scale 0.5 时 426×284 → 435×282，几乎没变）。所以缩放在 _frame() 里乘到粒子尺寸上。
//
// 实测（同一探针）：scale 1 → 426×284；scale 0.5 → 314×142（纵向 2.8 → 1.4 格，重叠 64% → 29%）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');

test('静读：Effect 有 scale 字段、place 接受 scale、_frame 把它乘到粒子尺寸上', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/effect.js'), 'utf8');
  assert.match(src, /this\.scale = 1;/, '★ Effect 要有 scale 字段（默认 1）');
  assert.match(src, /if \(typeof o\.scale === 'number' && o\.scale > 0\) this\.scale = o\.scale;/, '★ place 要接受 scale');
  assert.match(src, /f\.scale\[0\] \*= this\.scale/, '★ 尺度要乘到粒子尺寸（_frame 的 f.scale）');
  // 根节点缩放那条已经删掉（对 Local 模式无效，且会和 _frame 二次缩小）
  assert.doesNotMatch(src, /_s3\[0\] \*= this\.scale/, '不再缩根节点');
});

test('静读：FxHandle 把 opts.scale 折进 placeArgs', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/system.js'), 'utf8');
  assert.match(src, /opts\.scale/, '★ spawn 要读 opts.scale');
  assert.match(src, /this\.placeArgs = \{ \.\.\.this\.placeArgs, scale: opts\.scale \}/, '★ 折进 placeArgs 传给 Effect.place');
});

test('静读：塔露拉的车道拖尾用 0.5 倍', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/skillfx.js'), 'utf8');
  assert.match(src, /const LANE_SCALE = 0\.5;/, '★ 车道拖尾缩放常量');
  assert.match(src, /playOn\(k, this\._ground\(px0, py0, null\), \{ important: true, scale: LANE_SCALE \}\)/, '★ 每条车道按 LANE_SCALE 播');
});

test('运行时：scale 0.5 让拖尾的纵向尺寸约减半', { skip: existsSync(join(SP, 'shared/data/local-fx.json')) ? false : '本机没有 fx 资源' }, async () => {
  const { compileEffect, Effect } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/effect.js')).href);
  const { FrameData, cameraBasis } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/geom.js')).href);
  const { unityViewProj } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/system.js')).href);
  const { Camera } = await import(pathToFileURL(join(ROOT, 'public/js/render/projection.js')).href);
  const LIST = JSON.parse(readFileSync(join(SP, 'shared/data/local-fx.json'), 'utf8'));
  const ent = LIST.groups['fx/prefabs']['oxi_skill_03_trail_01'];
  if (!ent) return; // 资源不在本机就跳过
  const def = compileEffect(JSON.parse(readFileSync(join(SP, 'shared/assets', ent.path.replace('/assets', '')), 'utf8')));

  const W = 1920, H = 1080;
  const focal = H / (2 * Math.tan((45 * Math.PI / 180) / 2));
  const cam = new Camera({ tx: 4, ty: 11, tz: 0, tilt: 30, dist: 13, scale: focal / 13, cx: W / 2, cy: H / 2 });
  const vp = unityViewProj(cam, W, H, 0.5, cam.dist + 60);
  const camU = [cam.position().x - 10, cam.position().y - 9, -cam.position().z];
  const basis = cameraBasis(cam.tilt, camU, H, 2 * Math.atan(H / 2 / Math.max(1e-6, cam.scale * cam.dist)));
  const project = (p) => {
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (w <= 0) return null;
    return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H];
  };
  const extent = (scale) => {
    const fx = new Effect(def, { seed: 1, lite: false, lib: null });
    fx.place({ pos: [-3, 2, 0], groundZ: 0, yaw: 0, mirror: false, flipY: false, scale });
    let best = null;
    for (let tick = 1; tick <= 60; tick++) {
      fx.update(1 / 60);
      const fd = new FrameData(); fd.reset();
      let n = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      fx.gather(basis, (it) => {
        const r = fx.build(it, basis, fd, 7);
        if (!r || !r.count || r.kind !== 'quad') return;
        const q = fd.quad;
        for (let i = 0; i < r.count; i++) {
          const o = (r.first + i) * 27;
          const c = [q[o], q[o + 1], q[o + 2]], ax = [q[o + 3], q[o + 4], q[o + 5]], ay = [q[o + 6], q[o + 7], q[o + 8]];
          const pts = [
            [c[0] - ax[0] - ay[0], c[1] - ax[1] - ay[1], c[2] - ax[2] - ay[2]],
            [c[0] + ax[0] + ay[0], c[1] + ax[1] + ay[1], c[2] + ax[2] + ay[2]],
          ].map(project);
          if (pts.some((p) => !p)) continue;
          n++;
          for (const p of pts) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
        }
      });
      if (!n) continue;
      const rec = { w: maxX - minX, h: maxY - minY };
      if (!best || rec.w * rec.h > best.w * best.h) best = rec;
    }
    return best;
  };
  const full = extent(1);
  const half = extent(0.5);
  assert.ok(full && half, '两个尺度都要有几何');
  assert.ok(half.h < full.h * 0.7, `★ 0.5 倍应让纵向明显变小：${full.h.toFixed(0)} → ${half.h.toFixed(0)}`);
  assert.ok(half.w < full.w, `横向也应变小：${full.w.toFixed(0)} → ${half.w.toFixed(0)}`);
});
