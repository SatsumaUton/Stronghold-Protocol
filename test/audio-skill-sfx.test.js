// test/audio-skill-sfx.test.js —— 干员技能音效的完整性（2026-11-18）。
//
// 维护者： 「把所有干员启用技能时的音效都更新进来」。
//
// 修的是 tools/assets/plan.mjs 的一个条件：以前只在 `skillSfx` **多于一条**时才写 `skills`
// （`if (Object.keys(skillSfx).length > 1)`），于是一个只有某个技能槽带 ON_SKILL_START 的干员
// 整条技能发动音都丢了 —— 凛御银灰 S3 (`p_skill_snwlprdg_s`，索引 2)、塔露拉 S3
// (`p_skill_xtlfgbw_s`，索引 2) 都属于这种：`u.skill`（索引 0）取不到，`> 1` 也不成立。
//
// 这些断言盯住三件事：
//   ① 某个技能槽有发动音 → `skills[槽]` 必须有（不再要求「多于一条」）；
//   ② `skills` 里的路径必须指向真实存在的文件（导出的音频不能是空链接）；
//   ③ 客户端 audio.js 的取值顺序是 `skills[index]` 优先、没有才退回 `u.skill`。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));
const UNITS = MANIFEST.audio?.sfx?.units || {};
const ART = join(SP, 'shared/assets');

/** 路径 `/assets/audio/sfx/...` → 磁盘路径；`/assets/local/...` 同样。 */
const diskPath = (p) => join(ART, String(p).replace(/^\/assets\//, ''));

test('skills[槽] 指向的音频文件必须存在（不能写空链接）', () => {
  const missing = [];
  for (const [id, u] of Object.entries(UNITS)) {
    for (const [slot, p] of Object.entries(u.skills || {})) {
      if (!existsSync(diskPath(p))) missing.push(`${id}.skills[${slot}] → ${p}`);
    }
  }
  assert.deepEqual(missing, [], `缺失的音频文件：\n${missing.slice(0, 10).join('\n')}`);
});

test('attacks / hits 指向的音频文件必须存在', () => {
  const missing = [];
  for (const [id, u] of Object.entries(UNITS)) {
    for (const kind of ['attacks', 'hits']) {
      for (const [slot, p] of Object.entries(u[kind] || {})) {
        if (!existsSync(diskPath(p))) missing.push(`${id}.${kind}[${slot}] → ${p}`);
      }
    }
  }
  assert.deepEqual(missing.slice(0, 1), [], `缺失：${missing.slice(0, 5).join('\n')}`);
});

test('★ 只有一个技能槽带发动音的干员也要写 skills（银灰 S3 / 塔露拉 S3）', () => {
  // 这两个都是「索引 2 才有 ON_SKILL_START、索引 0 没有」—— 旧条件 `length > 1` 会把它们整条丢掉
  for (const [id, slot] of [['char_1045_svash2', '2'], ['char_4247_oxi', '2']]) {
    const u = UNITS[id];
    assert.ok(u, `${id} 要在 units 里`);
    assert.ok(u.skills, `${id} 要有 skills（旧逻辑会漏）`);
    assert.ok(u.skills[slot], `${id}.skills["${slot}"] 要有值`);
    assert.match(u.skills[slot], /\/assets\/audio\/sfx\//, `${id}.skills["${slot}"] 要是本地音频路径`);
  }
});

test('skills 的键是技能槽序号（0 起的十进制字符串）', () => {
  for (const [id, u] of Object.entries(UNITS)) {
    for (const slot of Object.keys(u.skills || {})) {
      assert.match(slot, /^\d+$/, `${id}.skills 的键 ${slot} 必须是槽序号`);
    }
  }
});

test('客户端按 skills[skillIndex] 优先取值（不是只认 u.skill）', () => {
  const src = readFileSync(join(ROOT, 'public/js/audio.js'), 'utf8');
  assert.match(src, /u\?\.skills\s*\?\s*u\.skills\[skillIndex\]/, 'audio.js 要按 skills[skillIndex] 取值');
  assert.match(src, /typeof own === 'string' \? own :/, 'own（skills 槽）要优先于 mode / u.skill');
});
