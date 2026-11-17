// test/ui/skin-fx-preload.test.js —— 皮肤特效必须进预加载集合（否则技能施放特效会被 LATE_START 丢掉）。
//
// 维护者 2026-11-18：穿了皮肤后干员的技能特效不出现。根因是 keysFor() 只收集基础特效名，
// 皮肤版（`…_summer#1`）没预热 → spawn 走 pending → 超过 0.6 s 的一击性特效被丢弃。
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSkinFx, skinEffectFor } from '../../public/js/render/vfx/skinfx.js';

const MAP_DOC = {
  skins: {
    char_147_shining: {
      char_147_shining_summer_1: {
        shining_attack_01_hit: 'shining_attack_01_hit_summer#1',
        shining_skill_02_start: 'shining_skill_02_start_summer#1',
        shining_skill_02_buff: 'shining_skill_02_buff_summer#1',
      },
    },
  },
};

/** 复刻 wiring.keysFor 的皮肤展开逻辑（它不导出，这里按同样的规则断言）。 */
function expandWithSkin(map, views, baseKeys) {
  const keys = new Set(baseKeys);
  if (map) {
    const base = [...keys];
    for (const v of views) {
      if (!v || !v.info || typeof v.info.skin !== 'string' || !v.info.skin) continue;
      for (const k of base) {
        const alt = skinEffectFor(map, v.info.skin, k);
        if (alt) keys.add(alt);
      }
    }
  }
  return keys;
}

test('★ 穿皮肤的干员：基础特效名与皮肤特效名都在预加载集合里', () => {
  const map = normalizeSkinFx(MAP_DOC);
  const views = [{ info: { skin: 'char_147_shining_summer_1' } }];
  const base = ['shining_attack_01_hit', 'shining_skill_02_start', 'shining_skill_02_buff'];
  const keys = expandWithSkin(map, views, base);

  assert.ok(keys.has('shining_skill_02_start'), '基础名仍在');
  assert.ok(keys.has('shining_skill_02_start_summer#1'), '★ 技能施放特效的皮肤版必须预热');
  assert.ok(keys.has('shining_skill_02_buff_summer#1'));
  assert.ok(keys.has('shining_attack_01_hit_summer#1'));
  assert.equal(keys.size, 6, '3 基础 + 3 皮肤版');
});

test('没穿皮肤的干员：集合不变（行为与改动前一致）', () => {
  const map = normalizeSkinFx(MAP_DOC);
  const views = [{ info: { skin: null } }, { info: {} }, {}];
  const base = ['shining_skill_02_start'];
  const keys = expandWithSkin(map, views, base);
  assert.equal(keys.size, 1);
  assert.deepEqual([...keys], ['shining_skill_02_start']);
});

test('没有 skin-fx 表（install 未提取特效）时集合不变', () => {
  const keys = expandWithSkin(null, [{ info: { skin: 'char_147_shining_summer_1' } }], ['x']);
  assert.deepEqual([...keys], ['x']);
});

test('多个不同皮肤的干员同一局：两套皮肤特效都要预热', () => {
  const doc = {
    skins: {
      char_147_shining: {
        char_147_shining_summer_1: { a_common: 'a_common_summer#1' },
        char_147_shining_sale_14: { a_common: 'a_common_sale#14' },
      },
    },
  };
  const map = normalizeSkinFx(doc);
  const views = [{ info: { skin: 'char_147_shining_summer_1' } }, { info: { skin: 'char_147_shining_sale_14' } }];
  const keys = expandWithSkin(map, views, ['a_common']);
  assert.equal(keys.size, 3);
  assert.ok(keys.has('a_common_summer#1'));
  assert.ok(keys.has('a_common_sale#14'));
});

test('遍历中新增不会无限增长（先取基础集合快照）', () => {
  // 构造一条链式映射：a → b，b → c；只允许展开一层
  const doc = { skins: { ch: { m: { a: 'b', b: 'c' } } } };
  const map = normalizeSkinFx(doc);
  const keys = expandWithSkin(map, [{ info: { skin: 'm' } }], ['a']);
  assert.deepEqual([...keys].sort(), ['a', 'b'], '只展开一层：a 的皮肤版 b；b 的皮肤版 c 不再展开');
});
