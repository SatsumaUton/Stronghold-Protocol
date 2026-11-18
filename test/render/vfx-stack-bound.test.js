// test/render/vfx-stack-bound.test.js —— 循环 prefab 被重复 one-shot 播放时必须有界，不能叠满战场。
//
// 现场（2026-11-18，玩家截图）：银灰 S3 的地面范围特效把半个战场糊成一片蓝白。
//   svash2_skill_03_range_01：isLoop = true（41 粒子系统 + 12 网格），从 projectile 的 onReached
//   以 one-shot 播，而 onReached 用 important: true。攻击间隔约 1~2 秒，于是同时贴在场上 5~10 份。
//
// 三层原因，缺一不可：
//   ① _start 的寿命上限被 important 跳过（`!loop && !important`）→ 循环 prefab 永不 done
//   ② 上限值用 LOOP_TTL(8s) → 叠得更多
//   ③ 即使 TTL 触发了 stop，_lifecycle 的淡出是 max(STOP_FADE, def.delayToFinish + 0.3)，
//      循环 prefab 的 delayToFinish 很大 → 被截断的实例还要再活好几秒
//
// 这条测试用真实 prefab 跑 OfficialFx，断言「5 秒后全部回收」「再播 5 次总数回到 5」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');
const KEY = 'svash2_skill_03_range_01';
const prefabPath = join(SP, 'shared/assets/local/fx/prefabs', `${KEY}.json`);
const hasAssets = existsSync(prefabPath);

test('静读：_start 不再让 important 免掉寿命上限，且循环 one-shot 用 ONE_SHOT_TTL', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/system.js'), 'utf8');
  const i = src.indexOf('_start(def) {');
  const body = src.slice(i, i + 3200);
  assert.doesNotMatch(body, /!this\.opts\.loop && !this\.opts\.important/, '★ important 不能再免掉上限');
  assert.match(body, /def\.isLoop \? \(this\.opts\.important \? ONE_SHOT_TTL : LOOP_TTL\)/, '★ 循环 one-shot 收紧');
});

test('静读：被 TTL 截断的效果用短淡出，不等 prefab 的 delayToFinish', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/effect.js'), 'utf8');
  assert.match(src, /this\.capped = true; this\.stop\(\)/, '★ TTL 触发时打 capped 标记');
  assert.match(src, /this\.capped \? STOP_FADE \+ 0\.3 : Math\.max\(STOP_FADE, def\.delayToFinish \+ 0\.3\)/, '★ capped 用短淡出');
});

test('运行时：重复 one-shot 播放后，效果按 TTL 回收，不会累积', { skip: hasAssets ? false : '本机没有 fx 资源' }, async () => {
  const { OfficialFx } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/system.js')).href);
  const { compileEffect } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/effect.js')).href);
  const def = compileEffect(JSON.parse(readFileSync(prefabPath, 'utf8')));
  assert.equal(def.isLoop, true, '这个 prefab 是循环的，才有叠加风险');

  class StubContainer { constructor() { this.destroyed = false; } addChild() {} }
  const ofx = new OfficialFx({
    P: { Container: StubContainer }, renderer: null, tier: 'full',
    lib: {
      available: true,
      has: (k) => String(k).toLowerCase() === KEY,
      def: (k) => (String(k).toLowerCase() === KEY ? def : null),
      index: async () => ({ version: 3, units: {}, prefabs: { [KEY]: {} }, generic: {} }),
      preload: async (k) => k.length, defs: new Map(), warm: () => {}, texture: () => null, mesh: () => null,
    },
    cam: () => ({ tilt: 30, dist: 13, scale: 100, cx: 960, cy: 540, position: () => ({ x: 0, y: 0, z: 0 }) }),
    heightAt: () => 0, fieldRect: () => ({ r0: 0, r1: 18, c0: 0, c1: 20 }),
  });

  const place = { pos: [-6, 2, 0], groundZ: 0, yaw: 0, mirror: false, flipY: false };
  for (let i = 0; i < 5; i++) ofx.spawn(KEY, place, { important: true });
  assert.equal(ofx.effects.length, 5, '先叠 5 份');

  for (let i = 0; i < 150; i++) ofx.update(1 / 30);   // 5 秒
  assert.equal(ofx.effects.length, 0, '★ 5 秒后必须全部回收（TTL 4s + 短淡出）');

  for (let i = 0; i < 5; i++) ofx.spawn(KEY, place, { important: true });
  assert.equal(ofx.effects.length, 5, '★ 再播 5 次总数仍是 5，不是 10 —— 没有累积');
});
