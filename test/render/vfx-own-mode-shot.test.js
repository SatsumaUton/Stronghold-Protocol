// test/render/vfx-own-mode-shot.test.js —— 技能把单位切进它自己的模式时，它自己的投射物必须飞。
//
// 现场（2026-11-18，玩家：凛御银灰 S3 的地面范围特效看不到）：
//   他是近战；S3 的 plan 攻击能力是 RangedAttack（客户端 BirdAura 节点）；
//   实战里这一击的 'atk' kind 是 'none'（模式能力 AnimatedActionToOwnerAbility 是动画动作，不是射击）。
//   → skillfx.attackFx 里 ranged = !!kind && kind !== 'none' = false
//     → fitsAttack('RangedAttack', {ranged:false}) = false
//     → 第 790 行把 deploy_01 过滤掉、第 792 行 projectile=null、最后 return null
//   → wiring.attack 里 isShot=false，display 又要求 !sk?.projectile → flies=false
//   → 挂在 projectile_chr_svash2_s3.onReached 上的 svash2_skill_03_range_01 永不播
//
// 复现基线（kind='none'）：只有 combat_start_01/_01_2/_02 重复，deploy_01 与 range_01 都没有 ——
// 与玩家的实战 spawn 日志一致。
//
// 修法（窄）：plan.modeName 存在且等于单位当前模式（**模式对象要取 .name**）时，
// 接受这种远近/kind 不一致：施放行不过滤、投射物返回、并且 flies 成立。
// 斩业星熊 S2 那类没有 modeName 的技能行为不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('静读：attackFx 在 ownMode 下接受 kind/远近不一致，并返回投射物', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/skillfx.js'), 'utf8');
  const i = src.indexOf('attackFx(src, tgt, kind, skillOn) {');
  assert.ok(i > 0, '找到 attackFx');
  const body = src.slice(i, src.indexOf('/**', i + 10));
  assert.match(body, /_mode\?\.name === st\.plan\.modeName/, '★ w.mode() 返回模式对象，必须比 .name');
  assert.match(body, /ownMode && \/Attack\/\.test\(fx\.ability\)/, '★ ownMode 下接受能力类名不一致');
  assert.match(body, /fits && \(ranged \|\| ownMode\)/, '★ ownMode 下即使 kind 为 none 也返回投射物');
});

test('静读：wiring.attack 的 flies 在 ownMode 下成立', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/wiring.js'), 'utf8');
  const i = src.indexOf('attack(src, tgt, kind, time, wound = false) {');
  assert.ok(i > 0, '找到 attack');
  const body = src.slice(i, src.indexOf('if (!isShot && tgt) {', i));
  assert.match(body, /ownModeShot/, '★ 要有 ownMode 的投射物判定');
  assert.match(body, /this\.mode\(u, src\)\?\.name === sk\.U\.plan\.modeName/, '★ 同样比 .name');
  assert.match(body, /isShot \|\| display \|\| ownModeShot/, '★ flies 要把 ownModeShot 算进去');
});

test('静读：ownMode 时技能攻击是附加，不替换模式自带的挥砍', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/skillfx.js'), 'utf8');
  const i = src.indexOf('attackFx(src, tgt, kind, skillOn) {');
  const body = src.slice(i, src.indexOf('/**', i + 10));
  assert.match(body, /const replace = !ownMode && \(fits \|\| forced\);/, '★ ownMode 下 replace 必须为假（否则模式挥砍被整段丢掉）');
  assert.match(body, /!replace && !ownMode/, '★ ownMode 下也不过滤 cast 行（deploy_01 会被一起滤掉）');
});
