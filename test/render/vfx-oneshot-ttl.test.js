// test/render/vfx-oneshot-ttl.test.js —— 循环 prefab 被 one-shot 播放时必须有寿命上限。
//
// 现场（2026-11-18，玩家截图）：银灰 S3 的地面范围特效把半个战场糊成一片蓝白。
//   svash2_skill_03_range_01 的 isLoop = true（41 粒子系统 + 12 网格），从 projectile 的 onReached 以
//   one-shot 播，而 onReached 用 important: true。
//   _start 里原本是 `if (!this.opts.loop && !this.opts.important)` —— important 免掉了寿命上限，
//   循环 prefab 永远不会 done，每攻击一次就永久多一份，几击之后整片战场被叠加。
//
// 修法：上限的依据改成只看 `!loop`；important 仍绕过 LATE_START，但不再免于寿命。
// 并且循环 prefab 被 one-shot 播时用 ONE_SHOT_TTL(4s)，不用 LOOP_TTL(8s)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('静读：_start 的寿命上限只看 !loop，不再被 important 跳过', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/system.js'), 'utf8');
  const i = src.indexOf('_start(def) {');
  assert.ok(i > 0, '找到 _start');
  const body = src.slice(i, src.indexOf('/** place(o)', i) > 0 ? src.indexOf('/** place(o)', i) : i + 3000);
  assert.doesNotMatch(body, /!this\.opts\.loop && !this\.opts\.important/, '★ 不能再用 important 免掉寿命上限');
  assert.match(body, /if \(!this\.opts\.loop\) \{/, '★ 改成只看 loop');
});

test('静读：循环 prefab 的 one-shot 用 ONE_SHOT_TTL 而不是 LOOP_TTL', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/system.js'), 'utf8');
  const i = src.indexOf('_start(def) {');
  const body = src.slice(i, i + 3000);
  assert.match(body, /def\.isLoop \? \(this\.opts\.important \? ONE_SHOT_TTL : LOOP_TTL\)/, '★ 循环 one-shot 收紧到 4 秒');
});
