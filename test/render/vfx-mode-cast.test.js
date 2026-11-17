// test/render/vfx-mode-cast.test.js —— 技能 mode 的 attack.cast 行必须进 plan（以前只取 attach，漏掉了）。
//
// 维护者 2026-11-18：「凛御银灰 S3 有个地面的范围特效，本体和皮肤都有，但是我没有看到」。
// 根因：skillPlan 只从 mode 取 attachUses()，而 svash2 S3（mode 1）的
// `svash2_skill_03_combat_start_01 / _01_2 / _02` 在 mode.attack.cast 里，从未进 plan。
import test from 'node:test';
import assert from 'node:assert/strict';
import { skillPlan } from '../../public/js/render/vfx/skills.js';

/** 最小 index：一个干员，三个技能，S3 带 mode 且 mode.attack.cast 有 3 行。 */
const index = {
  units: {
    char_test: {
      kind: 'char',
      skills: {
        skchr_test_1: { uses: [], unclassified: [] },
        skchr_test_2: { uses: [], unclassified: [] },
        skchr_test_3: { uses: [], unclassified: [], mode: 1, rootClass: 'CastSkill' },
      },
      modes: [
        { name: 'Default', attack: { class: 'MeleeAttack', node: 'Modes/Default/Body/Attack' } },
        {
          name: 'S3',
          attack: {
            class: 'AnimatedActionToOwnerAbility',
            node: 'Modes/S3/Body/Attack',
            attach: [],
            cast: [
              { effects: ['t_combat_start_01'], startEvent: 2, endEvent: 3 },
              { effects: ['t_combat_start_02'], startEvent: 2, endEvent: 3 },
            ],
          },
        },
      ],
    },
  },
  prefabs: {
    t_combat_start_01: { nodes: 5, looping: false, spawn: 1 },
    t_combat_start_02: { nodes: 4, looping: false, spawn: 1 },
  },
  projectiles: {},
  skills: {},
};

test('★ 技能 mode 的 attack.cast 行进 plan（以前整个漏掉）', () => {
  const plan = skillPlan(index, 'char_test', 'skchr_test_3', {});
  const keys = (plan.each?.cast || []).map((e) => e.key);
  assert.ok(keys.includes('t_combat_start_01'), '★ mode.attack.cast 的第一行必须进 plan');
  assert.ok(keys.includes('t_combat_start_02'), '★ 第二行也要');
});

test('没有 mode 的技能不受影响', () => {
  const plan = skillPlan(index, 'char_test', 'skchr_test_1', {});
  assert.equal((plan.each?.cast || []).length, 0);
});

test('敌人不加这批（敌人走 enemySkillsOf 的 skillPlan(mode) 路径）', () => {
  const enemyIdx = {
    ...index,
    units: {
      enemy_test: {
        kind: 'enemy',
        skills: { skl_test: { uses: [], unclassified: [], mode: 1 } },
        modes: [
          { name: 'Default', attack: { class: 'MeleeAttack' } },
          { name: 'S3', attack: { class: 'X', cast: [{ effects: ['t_combat_start_01'] }], attach: [] } },
        ],
      },
    },
  };
  const plan = skillPlan(enemyIdx, 'enemy_test', 'skl_test', {});
  assert.equal((plan.each?.cast || []).length, 0, '敌人的 mode cast 不从这里进来，避免重复播放');
});
