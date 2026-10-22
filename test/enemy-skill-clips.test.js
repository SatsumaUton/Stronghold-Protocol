// test/enemy-skill-clips.test.js — the skill slots of three leaders play the clip of their official ability
// (tools/assets/spine.mjs PREFAB_SPINE_ROLES → data/assets.json `anims.skills`; DESIGN §35.19).
//
// The client plays `anims.skills[slot]` for a sim ['cast', id, slot] event, the slot being the skill's index in
// data/enemies.json `skills[]`. The resolver pairs numbered clips with slots by name (Skill_n = slot n−1); the official
// prefabs name the clip per ability instead (EnemySkill ability `_animKey`). Until 0.3.2 假想敌：胄's 死亡集群 played the
// 2.533 s Skill_2 for the 3.833 s Skill_3, 盐风主教昆图斯's 大潮 and 崩坍 swapped clips (the third-form tide on the 3 s
// Skill_01 of 崩坍), and 阿利斯泰尔's storeA / Suicide played the wrong ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { applyRoleFix, PREFAB_SPINE_ROLES } from '../tools/assets/spine.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const E = read('data/enemies.json');
const A = read('data/assets.json');
const FX_INDEX = new URL('../public/assets/local/fx/index.json', import.meta.url);
const LEADERS = ['enemy_9013_acstmk', 'enemy_1521_dslily', 'enemy_9032_aclionk'];

test('applyRoleFix checks every clip of a `skills` map: a missing one leaves the resolved slots', () => {
  const roles = { skills: { 0: { begin: null, loop: 'Skill_1', end: null, index: 0, idle: null } } };
  const fix = { skills: { 0: { begin: null, loop: 'Skill_1', end: null, index: 0, idle: null }, 1: { begin: null, loop: 'Skill_9', end: null, index: 1, idle: null } } };
  assert.deepEqual(applyRoleFix(roles, fix, { Skill_1: 1 }), { roles, missing: ['skills'] });
  assert.deepEqual(applyRoleFix(roles, fix, { Skill_1: 1, Skill_9: 2 }).roles.skills, fix.skills);
});

test('PREFAB_SPINE_ROLES skill slots: one clip per data slot, every clip in the model, carried into data/assets.json', () => {
  for (const id of LEADERS) {
    const fix = PREFAB_SPINE_ROLES[id].skills;
    const sp = A.enemies[id].spine;
    assert.ok(Object.keys(fix).length >= E[id].skills.length, `${id}: a clip for each of its ${E[id].skills.length} slots`);
    for (const [slot, c] of Object.entries(fix)) {
      assert.ok(Object.hasOwn(sp.animations, c.loop), `${id} slot ${slot}: ${c.loop} in the model`);
      assert.equal(sp.anims.skills[slot].loop, c.loop, `${id} slot ${slot}: data/assets.json (node tools/fetch-assets.mjs --offline)`);
    }
  }
  // 假想敌：胄's second record shares the model, and so its slots
  assert.deepEqual(A.enemies.enemy_9013_acstmk_2.spine.anims.skills, A.enemies.enemy_9013_acstmk.spine.anims.skills);
});

test('PREFAB_SPINE_ROLES skill slots = the official ability animKey of each slot (local fx index, when extracted)', { skip: !existsSync(FX_INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const units = JSON.parse(readFileSync(FX_INDEX, 'utf8')).units || {};
  for (const id of [...LEADERS, 'enemy_9013_acstmk_2']) {
    const u = units[id];
    assert.ok(u && u.skills, `${id} in the index`);
    const fix = PREFAB_SPINE_ROLES[id.replace(/_2$/, '')].skills;
    E[id].skills.forEach((s, slot) => {
      const ab = (u.skills[String(s.prefabKey).toLowerCase()] || u.skills[s.prefabKey] || {}).abilities || [];
      const key = (ab.find((a) => a && a.animKey) || {}).animKey;
      assert.equal(fix[slot].loop, key, `${id} slot ${slot} (${s.prefabKey})`);
    });
  }
});

// DESIGN §35.29: the rest of §35.19's list — 泥岩 (slots swapped), “自在” CrossAttack, 斩胄之剑 / 破胄之锤, 碎铳之簧 b / c,
// 杰斯顿·威廉姆斯, 锏 (each checked against its kit's casts). A slot whose ability names a clip plays it; the blinks of 锏
// and 自在's 破桎而出 name none and keep a clip set by name [ASSUMED].
const MORE = ['enemy_1511_mdrock', 'enemy_1517_xi', 'enemy_9014_acstma', 'enemy_9015_acstmb', 'enemy_9019_actrpb', 'enemy_9020_actrpc', 'enemy_1516_jakill', 'enemy_1525_blkswb'];

test('PREFAB_SPINE_ROLES, the §35.19 list: every slot clip in the model and in data/assets.json; `skill` = slot 0', () => {
  for (const id of MORE) {
    const fix = PREFAB_SPINE_ROLES[id];
    const sp = A.enemies[id].spine;
    for (const [slot, c] of Object.entries(fix.skills)) {
      for (const n of [c.begin, c.loop, c.end]) if (n) assert.ok(Object.hasOwn(sp.animations, n), `${id} slot ${slot}: ${n} in the model`);
      assert.deepEqual(sp.anims.skills[slot], c, `${id} slot ${slot}: data/assets.json (node tools/fetch-assets.mjs --offline)`);
      assert.ok(Number(slot) < E[id].skills.length, `${id} slot ${slot}: a data skill`);
    }
    assert.deepEqual(sp.anims.skill, fix.skills[0], `${id}: the primary skill role is slot 0's clip`);
  }
  assert.equal(A.enemies.enemy_1511_mdrock.spine.anims.skills[0].loop, 'Skill_2', '泥岩 RefreshShield (slot 0)');
  assert.equal(A.enemies.enemy_1511_mdrock.spine.anims.skills[1].loop, 'Skill_1', '泥岩 occupy (slot 1)');
});

test('the §35.19 list = the official ability animKey of each slot that names one (local fx index, when extracted)', { skip: !existsSync(FX_INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const units = JSON.parse(readFileSync(FX_INDEX, 'utf8')).units || {};
  for (const id of MORE) {
    const fix = PREFAB_SPINE_ROLES[id].skills;
    E[id].skills.forEach((s, slot) => {
      const ab = (units[id].skills[String(s.prefabKey).toLowerCase()] || {}).abilities || [];
      const key = (ab.find((a) => a && a.animKey) || {}).animKey;
      if (key) assert.equal(fix[slot].loop, key, `${id} slot ${slot} (${s.prefabKey})`);
      else if (fix[slot]) assert.ok(fix[slot].begin || fix[slot].loop, `${id} slot ${slot} (${s.prefabKey}): a clip set by name`);
    });
  }
});
