// test/assets-skin-battle-anims.test.js —— 皮肤骨架必须有完整战斗动作（回归闸门）。
//
// 维护者 2026-11-18： 「罗比菈塔有皮肤没有动作」 → 「所有皮肤都是有战斗模型的，不存在有基建模型
// 没有战斗模型等问题，如果有只会是你弄错了」。
//
// 根因：客户端同一套皮肤在包里有多份骨架 ——
//   `<model>#N.skel`（若干变体，最全的那份有 Attack/Die/Skill2_*）
//   `build_<model>#N.skel`（委托室：Default/Interact/Relax/Sit/Sleep/Special）
// SkeletonDataAsset 的 skeletonJSON 指向哪套，官方就用哪套。我们磁盘上先前只存了 `build_` 那份，
// 于是 40 套皮肤在战斗里站着不动。
//
// 判据用客户端自己那套 resolveRoles（不是「名字里有没有 attack」——官方皮肤常用 Default 当攻击）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');
const ART = join(SP, 'shared/assets');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));

const { parseSkel } = await import(pathToFileURL(join(ROOT, 'tools/assets/skel.mjs')).href);
const { resolveRoles } = await import(pathToFileURL(join(ROOT, 'tools/assets/anim-roles.mjs')).href);

const SKIP = existsSync(join(ART, 'spine')) ? false : '本机没有素材';
const disk = (u) => join(ART, String(u).replace(/^https:\/\/[^/]+/, '').replace(/^\/assets\//, ''));

const skins = [];
for (const [cid, ch] of Object.entries(MANIFEST.chars || {})) {
  for (const [model, s] of Object.entries(ch.skins || {})) {
    if (model === 'e2') continue;
    const sp = s.spine && s.spine.front;
    if (sp && sp.skel) skins.push({ cid, model, skel: sp.skel });
  }
}

test('每个皮肤骨架都能解析出 attack 角色（不是委托室那一套）', { skip: SKIP }, () => {
  const bad = [];
  for (const s of skins) {
    const p = disk(s.skel);
    if (!existsSync(p)) { bad.push(`${s.model}: skel 不在磁盘`); continue; }
    let roles = null, anims = [];
    try {
      anims = parseSkel(new Uint8Array(readFileSync(p))).animations || [];
      roles = resolveRoles(anims);
    } catch (e) {
      bad.push(`${s.model}: 解析失败 ${String(e.message).slice(0, 40)}`);
      continue;
    }
    if (!roles?.attack?.loop) bad.push(`${s.model}: 没有 attack 角色（有 ${anims.join(',')}）`);
  }
  assert.deepEqual(bad.slice(0, 1), [], `皮肤缺少战斗动作：\n${bad.slice(0, 10).join('\n')}`);
});

test('每个皮肤骨架都有死亡动画（委托室版本没有 Die）', { skip: SKIP }, () => {
  const bad = [];
  for (const s of skins) {
    const p = disk(s.skel);
    if (!existsSync(p)) continue;
    let anims;
    try { anims = parseSkel(new Uint8Array(readFileSync(p))).animations || []; } catch { continue; }
    if (!anims.some((n) => /^die/i.test(n))) bad.push(`${s.model}: 无 Die（有 ${anims.join(',')}）`);
  }
  assert.deepEqual(bad.slice(0, 1), [], `皮肤缺少死亡动画：\n${bad.slice(0, 10).join('\n')}`);
});

test('清单的 anims 与骨架实际动画一致', { skip: SKIP }, () => {
  const bad = [];
  for (const s of skins) {
    const p = disk(s.skel);
    if (!existsSync(p)) continue;
    const rec = MANIFEST.chars[s.cid].skins[s.model].spine.front;
    const loop = rec.anims?.attack?.loop;
    if (!loop) { bad.push(`${s.model}: anims.attack.loop 为空`); continue; }
    let anims;
    try { anims = parseSkel(new Uint8Array(readFileSync(p))).animations || []; } catch { continue; }
    if (!anims.includes(loop)) bad.push(`${s.model}: anims.attack.loop=${loop} 但骨架里没有`);
    if (rec.anims.die && !anims.includes(rec.anims.die)) bad.push(`${s.model}: anims.die=${rec.anims.die} 但骨架里没有`);
  }
  assert.deepEqual(bad.slice(0, 1), [], `anims 与骨架不符：\n${bad.slice(0, 8).join('\n')}`);
});

test('★ 罗比菈塔两套皮肤都能战斗（本次报告的直接回归）', () => {
  const ch = MANIFEST.chars['char_484_robrta'];
  assert.ok(ch, 'char_484_robrta 要在清单里');
  for (const model of ['char_484_robrta_ambienceSynesthesia_3', 'char_484_robrta_summer_10']) {
    const sk = ch.skins[model];
    assert.ok(sk, `${model} 要有记录`);
    assert.ok(sk.spine.front.anims.attack.loop, `${model} 要有攻击动画角色`);
    assert.ok(sk.spine.front.anims.die, `${model} 要有死亡动画`);
  }
});
