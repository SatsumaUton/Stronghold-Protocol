// test/render/vfx-mode-cast.test.js —— 技能 mode 的 cast 行进独立桶（进入 mode 时播一次，不是每击重播）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { skillPlan } from '../../public/js/render/vfx/skills.js';

const row = (k, o = {}) => ({ effects: [k], directionType: 0, oneshot: 1, startEvent: 2, endEvent: 3, ...o });
const melee = (cast, hit, extra = {}) => ({ class: 'MeleeAttack', cast, hit, ...extra });
const prefabs = (keys) => Object.fromEntries(keys.map((k) => [k, { nodes: 1, looping: false, spawn: 1 }]));

const KEYS = ['t_cast_01', 't_cast_02', 't_nested', 't_par_m', 't_par_r', 't_sel_m', 't_sel_r', 't_group_top'];
const idx = {
  format: 'fx-index', version: 3,
  prefabs: prefabs(KEYS),
  projectiles: {},
  skills: {},
  units: {
    // 顶层 cast（凛御银灰 S3 的形态）
    char_a: {
      kind: 'char',
      modes: [
        { name: 'Default', attack: melee([], []) },
        { name: 'S3', attack: { class: 'AnimatedActionToOwnerAbility', node: 'Modes/S3/Body/Attack', attach: [], cast: [row('t_cast_01'), row('t_cast_02')] } },
      ],
      skills: { sk_a_1: { uses: [], mode: 1, rootClass: 'CastSkill' } },
    },
    // 两层嵌套（遥 S3 的形态）：Selectable → Parallel → RangedHeal.cast
    char_b: {
      kind: 'char',
      modes: [
        { name: 'Default', attack: melee([], []) },
        {
          name: 'S3',
          attack: {
            class: 'AbilitySelectableGroup', node: 'Modes/S3/Body/Attack', cast: [],
            abilities: [{
              class: 'AbilityParallelGroup', node: 'Modes/S3/Body/Attack/And', cast: [],
              abilities: [
                { class: 'RangedHeal', node: 'Modes/S3/Body/Attack/And/Heal', cast: [row('t_nested')] },
                { class: 'AnimatedActionToOwnerAbility', node: 'Modes/S3/Body/Attack/And/Shield' },
              ],
            }],
          },
        },
      ],
      skills: { sk_b_1: { uses: [], mode: 1, rootClass: 'CastSkill' } },
    },
    // 组里的 Attack 类替代项（sel_r / sel_m）：不能在开技能时全播
    char_c: {
      kind: 'char',
      modes: [
        { name: 'Default', attack: melee([], []) },
        { name: 'S2', attack: { class: 'AbilitySelectableGroup', cast: [], abilities: [{ class: 'RangedAttack', projectileKey: 'p', cast: [row('t_sel_r')] }, melee([row('t_sel_m')], [])] } },
      ],
      skills: { sk_c_1: { uses: [], mode: 1, rootClass: 'CastSkill' } },
    },
    // 敌人：mode cast 不进 modeCast（走 enemySkillsOf）
    enemy_d: {
      kind: 'enemy',
      modes: [
        { name: 'Default', attack: melee([], []) },
        { name: 'S3', attack: { class: 'X', attach: [], cast: [row('t_group_top')] } },
      ],
      skills: { skl_d: { uses: [], mode: 1 } },
    },
  },
};

test('★ 顶层 mode.attack.cast 进 modeCast（凛御银灰 S3 形态）', () => {
  const p = skillPlan(idx, 'char_a', 'sk_a_1', {});
  const keys = (p.modeCast || []).map((e) => e.key);
  assert.deepEqual(keys.sort(), ['t_cast_01', 't_cast_02']);
  assert.equal((p.each.cast || []).length, 0, '不进 each.cast（那会每击重播）');
  assert.equal((p.start || []).length, 0, '不进 start（那会被当成循环持有）');
});

test('★ 两层嵌套的 mode cast 也收（遥 S3 形态）', () => {
  const p = skillPlan(idx, 'char_b', 'sk_b_1', {});
  const keys = (p.modeCast || []).map((e) => e.key);
  assert.deepEqual(keys, ['t_nested'], '★ attack.abilities[].abilities[].cast 里的行要递归收到');
});

test('组里的 Attack 类替代项不进 modeCast（按攻击方式挑，不能全播）', () => {
  const p = skillPlan(idx, 'char_c', 'sk_c_1', {});
  assert.equal((p.modeCast || []).length, 0, 'sel_r / sel_m 由 pickAttacks 按这一击的类型挑');
});

test('敌人不经过 modeCast（敌人走 enemySkillsOf 的 skillPlan(mode)）', () => {
  const p = skillPlan(idx, 'enemy_d', 'skl_d', {});
  assert.equal((p.modeCast || []).length, 0);
});

test('保持官方字段：startEvent / anim / group 都要带上', () => {
  const p = skillPlan(idx, 'char_a', 'sk_a_1', {});
  assert.equal(p.modeCast[0].startEvent, 2);
  assert.equal(p.modeCast[0].role, 'cast');
  assert.equal(p.modeCast[0].at, 'owner');
});
