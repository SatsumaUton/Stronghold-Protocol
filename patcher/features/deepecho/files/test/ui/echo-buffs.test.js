// test/ui/echo-buffs.test.js — 「深渊回响」词条/祝福图标描述（public/js/ui/echoBuffs.js）。
//
// 这个文件守的是「图标显示」的可断言部分：哪几条词条/祝福会变成哪个圆片、字是什么、属于哪一侧。
// 真正的像素渲染不在 Node 里测（那是 e2e 的事），但「显示什么」这件事必须锁住 ——
// 否则界面很可能把 echo:shield 这种原始 key 直接甩给玩家看。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { echoBuffChips, ECHO_BUFF_VISUALS } from '../../public/js/ui/echoBuffs.js';

test('词条 → 敌人侧圆片，带中文名与首字记号', () => {
  const chips = echoBuffChips({ words: [{ id: 'shield', name: '护盾' }, { id: 'rage', name: '狂怒' }] });
  assert.equal(chips.length, 2);
  assert.deepEqual(chips.map((c) => c.side), ['enemy', 'enemy']);
  assert.deepEqual(chips.map((c) => c.label), ['护盾', '狂怒']);
  assert.equal(chips[0].glyph, '盾');
  assert.equal(chips[1].tone, 'atk');
  assert.ok(chips.every((c) => c.key.startsWith('enemy:')));
});

test('祝福 → 己方侧圆片，title 带描述', () => {
  const chips = echoBuffChips({ blessings: [{ id: 'fund', name: '物资补给', desc: '立刻获得 40 资金' }] });
  assert.equal(chips.length, 1);
  assert.equal(chips[0].side, 'ally');
  assert.equal(chips[0].label, '物资补给');
  assert.ok(chips[0].title.includes('40 资金'), '悬浮说明要带上描述');
});

test('两侧同时存在时，先词条后祝福，key 不冲突', () => {
  const chips = echoBuffChips({
    words: [{ id: 'swift', name: '迅捷' }],
    blessings: [{ id: 'haste', name: '疾风' }],
  });
  assert.deepEqual(chips.map((c) => c.key), ['enemy:swift', 'ally:haste']);
});

test('未知 id 不会崩，也不会把 id 当名字甩给玩家（没有名字才退回 id）', () => {
  const chips = echoBuffChips({ words: [{ id: 'future_word' }] });
  assert.equal(chips.length, 1);
  assert.equal(chips[0].glyph, '?');
  assert.equal(chips[0].label, 'future_word');
});

test('空 / 缺字段安全返回空数组', () => {
  assert.deepEqual(echoBuffChips(null), []);
  assert.deepEqual(echoBuffChips({}), []);
  assert.deepEqual(echoBuffChips({ words: null, blessings: null }), []);
  assert.deepEqual(echoBuffChips({ words: [null, 3, {}] }), []);
});

test('每个词条 id 都有视觉描述（新增词条忘了配图标会在这里炸）', () => {
  for (const id of ['shield', 'harden', 'swift', 'rage']) {
    assert.ok(ECHO_BUFF_VISUALS[id], `词条 ${id} 缺图标描述`);
    assert.ok(ECHO_BUFF_VISUALS[id].glyph.length > 0);
  }
  for (const id of ['fund', 'haste', 'loot']) {
    assert.ok(ECHO_BUFF_VISUALS[id], `祝福 ${id} 缺图标描述`);
  }
});
