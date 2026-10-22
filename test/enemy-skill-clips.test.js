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
