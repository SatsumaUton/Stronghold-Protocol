// test/render/camera-hud-band.test.js —— 拟合相机必须把真实 HUD 留白算进去。
//
// 现场（2026-11-19，玩家「部分地图部分地区无法部署 / 无法点击 / 无法移动」的候选成因之一）：
//   presetCamera 只在**官方分支**里处理 HUD（clearHud + keep 波段）；窄屏 / 自定义 rect / opts.fit
//   走的拟合分支**完全不看 opts.hud**，而调用方给的 padding 是按比例的近似
//   （render/app.js defaultPadding：prep 顶 10% / 底 24%）。
//   真实 HUD 比这更高时（矮横屏 + 商店展开），棋盘顶部/底部会有几行落在顶栏、商店栏底下 ——
//   那片 canvas 收不到 pointerdown，表现就是「那里点不到」。
//
// 实测（同一探针，修前 → 修后）：
//   横屏 640×360 + 顶 56/商店 120：y[64,245] vs 带[56,240] 底越界 5px  → 修后 y[74,222] ✓
//   横屏 640×360 + 顶 96/商店 180：底越界 65px                       → 修后 y[104,172] ✓
//   横屏 800×360 + 顶 96/商店 180：底越界 70px                       → 修后 y[104,172] ✓
//
// 这条测试盯住：拟合分支里棋盘的四角落在 HUD 带内，且 hud 为 0 时取景不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const P = await import(pathToFileURL(join(ROOT, 'public/js/render/projection.js')).href);

// 与 render/app.js 的 defaultPadding 同口径（prep）
const pad = (w, h) => ({ top: h * 0.1, bottom: h * 0.24, left: Math.min(170, w * 0.09), right: w * 0.05 });
// 与 camera presets 的 prep rect 同口径（手牌 + 暂存 + 场地）
const RECT = { r0: 0, r1: 12, c0: 0, c1: 20 };

const boardY = (cam) => {
  const ys = [];
  for (const [r, c] of [[RECT.r0, RECT.c0], [RECT.r0, RECT.c1], [RECT.r1, RECT.c0], [RECT.r1, RECT.c1]]) {
    ys.push(cam.project(c, r, 0, { x: 0, y: 0 }).y);
  }
  return { minY: Math.min(...ys), maxY: Math.max(...ys) };
};

test('拟合相机：棋盘在真实 HUD 带内（含矮横屏 + 高商店栏）', () => {
  const cases = [
    [640, 360, { top: 56, bottom: 120 }],
    [640, 360, { top: 96, bottom: 180 }],
    [800, 360, { top: 56, bottom: 120 }],
    [800, 360, { top: 96, bottom: 180 }],
    [412, 915, { top: 96, bottom: 180 }],
  ];
  for (const [w, h, hud] of cases) {
    const cam = P.presetCamera('prep', { width: w, height: h, padding: pad(w, h) }, { rect: RECT, hud });
    const { minY, maxY } = boardY(cam);
    const b0 = hud.top;
    const b1 = h - hud.bottom;
    assert.ok(minY >= b0 - 1, `★ ${w}×${h} hud=${JSON.stringify(hud)}：棋盘顶 ${minY.toFixed(0)} 越过 HUD 顶 ${b0}`);
    assert.ok(maxY <= b1 + 1, `★ ${w}×${h} hud=${JSON.stringify(hud)}：棋盘底 ${maxY.toFixed(0)} 越过 HUD 底 ${b1}`);
  }
});

test('拟合相机：hud 为 0 时取景不变', () => {
  const w = 800, h = 360;
  const a = P.presetCamera('prep', { width: w, height: h, padding: pad(w, h) }, { rect: RECT });
  const b = P.presetCamera('prep', { width: w, height: h, padding: pad(w, h) }, { rect: RECT, hud: { top: 0, bottom: 0 } });
  const ya = boardY(a), yb = boardY(b);
  assert.ok(Math.abs(ya.minY - yb.minY) < 1e-6, 'hud 为 0 时顶边不应变');
  assert.ok(Math.abs(ya.maxY - yb.maxY) < 1e-6, 'hud 为 0 时底边不应变');
});

test('静读：拟合分支用 withHudPadding 合并 HUD 留白', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/projection.js'), 'utf8');
  assert.match(src, /const fitViewport = withHudPadding\(viewport, opts\.hud\);/, '★ 拟合分支要合并 HUD');
  assert.match(src, /return fitCamera\(rect, fitViewport, \{/, '★ 传给 fitCamera 的是合并后的 viewport');
  assert.match(src, /function withHudPadding\(viewport, hud\)/, '要有 withHudPadding');
});
