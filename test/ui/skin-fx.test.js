// test/ui/skin-fx.test.js —— 皮肤专属特效（data/skin-fx.json）的查表与替换。
//
// 官方机制：皮肤把特效名加后缀（shining_attack_01_hit → shining_attack_01_hit_summer#1），
// 映射表由皮肤预制件里的成对字符串抽取而来（data/skin-fx.json）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSkinFx, skinEffectFor } from '../../public/js/render/vfx/skinfx.js';

const DOC = {
  format: 'skin-fx',
  version: 1,
  skins: {
    char_147_shining: {
      char_147_shining_summer_1: {
        shining_attack_01_hit: 'shining_attack_01_hit_summer#1',
        shining_skill_02_start: 'shining_skill_02_start_summer#1',
      },
      char_147_shining_sale_14: {
        shining_attack_01_hit: 'shining_attack_01_hit_sale#14',
      },
    },
  },
};

test('normalizeSkinFx：摊平成按皮肤 id 索引的表，键全小写', () => {
  const m = normalizeSkinFx(DOC);
  assert.equal(m.size, 2);
  const summer = m.get('char_147_shining_summer_1');
  assert.equal(summer.get('shining_attack_01_hit'), 'shining_attack_01_hit_summer#1');
});

test('skinEffectFor：穿了对的皮肤就返回皮肤特效名', () => {
  const m = normalizeSkinFx(DOC);
  assert.equal(
    skinEffectFor(m, 'char_147_shining_summer_1', 'shining_attack_01_hit'),
    'shining_attack_01_hit_summer#1',
  );
  assert.equal(
    skinEffectFor(m, 'char_147_shining_sale_14', 'shining_attack_01_hit'),
    'shining_attack_01_hit_sale#14',
  );
});

test('skinEffectFor：大小写不影响命中（客户端 library 一律 toLowerCase）', () => {
  const m = normalizeSkinFx(DOC);
  assert.equal(
    skinEffectFor(m, 'CHAR_147_SHINING_SUMMER_1', 'Shining_Attack_01_Hit'),
    'shining_attack_01_hit_summer#1',
  );
});

test('skinEffectFor：没穿皮肤 / 皮肤不认识 / 该特效应没映射 → null（回落基础特效）', () => {
  const m = normalizeSkinFx(DOC);
  assert.equal(skinEffectFor(m, null, 'shining_attack_01_hit'), null);
  assert.equal(skinEffectFor(m, '', 'shining_attack_01_hit'), null);
  assert.equal(skinEffectFor(m, 'char_147_shining_marthe_13', 'shining_attack_01_hit'), null);
  assert.equal(skinEffectFor(m, 'char_147_shining_summer_1', 'shining_attack_01_miss'), null);
  assert.equal(skinEffectFor(null, 'char_147_shining_summer_1', 'shining_attack_01_hit'), null);
});

test('normalizeSkinFx：空文档 / 脏数据不炸', () => {
  assert.equal(normalizeSkinFx(null).size, 0);
  assert.equal(normalizeSkinFx({}).size, 0);
  const dirty = { skins: { c: { m: { a: 1, b: null, ok: 'X' } } } };
  const m = normalizeSkinFx(dirty);
  assert.equal(m.get('m').size, 1, '只保留字符串对');
  assert.equal(m.get('m').get('ok'), 'x', '值也小写');
});
