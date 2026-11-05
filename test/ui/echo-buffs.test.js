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
  assert.equal(chips[0].glyph, 'f', '未知 id 退回名字首字，不再显示问号');
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

// 维护者 2026-11-05：不想点放大镜才知道身上挂了什么 —— HUD 上要有诅咒圆片。
test('诅咒 → 第三侧圆片：按稀有度配色，固定规则走 gold', () => {
  const chips = echoBuffChips({
    curses: [
      { id: 'frenzy', name: '狂怒', desc: '敌方攻击 +10%', rarity: 'rare', rarityLabel: '稀有' },
      { id: 'miracle', name: '奇迹·诅咒', desc: '免费刷新总数上限 5 次', rarity: 'special', rarityLabel: '固定' },
      { id: 'abyss_inflation', name: '深渊通胀', desc: '16 层起商店与刷新价每层 +4%', rarity: 'special', rarityLabel: '固定' },
    ],
  });
  assert.deepEqual(chips.map((c) => c.side), ['curse', 'curse', 'curse']);
  assert.ok(chips.every((c) => c.key.startsWith('curse:')));
  assert.deepEqual(chips.map((c) => c.tone), ['rare', 'gold', 'gold']);
  // 图标（维护者 2026-11-05：光靠首字太丑）—— 全部来自仓库 ICONS 图标集
  assert.deepEqual(chips.map((c) => c.icon), ['warn', 'refresh', 'chart'], '诅咒按效果类型区分：狂怒=警示、奇迹=刷新、深渊通胀=图表');
  assert.equal(chips[1].glyph, '奇', '用名字首字当记号');
  assert.match(chips[2].title, /固定/, 'title 要带稀有度标签');
  assert.match(chips[2].title, /每层 \+4%/, 'title 要带效果说明');
});

test('三侧同时存在时顺序稳定：词条 → 祝福 → 诅咒', () => {
  const chips = echoBuffChips({
    words: [{ id: 'swift', name: '迅捷' }],
    blessings: [{ id: 'haste', name: '疾风' }],
    curses: [{ id: 'frenzy', name: '狂怒', rarity: 'rare' }],
  });
  assert.deepEqual(chips.map((c) => c.key), ['enemy:swift', 'ally:haste', 'curse:frenzy']);
});

test('词条 / 祝福也有图标（不再是问号或纯文字）', () => {
  const chips = echoBuffChips({
    words: [{ id: 'harden', name: '硬化' }, { id: 'swift', name: '迅捷' }, { id: 'rage', name: '狂怒' }],
    blessings: [
      { id: 'atk_s', name: '锐刃', group: 'atk', kind: 'mods' },
      { id: 'hp_s', name: '韧性', group: 'hp', kind: 'mods' },
      { id: 'fund', name: '物资补给', kind: 'fund' },
    ],
  });
  assert.deepEqual(chips.map((c) => c.icon), ['shield', 'chevrons', 'sword', 'sword', 'shield', 'chart']);
  assert.ok(chips.every((c) => typeof c.icon === 'string' && c.icon.length > 0), '每个圆片都要有图标名');
});

// 维护者 2026-11-05：图标要**按效果设计**，不是随机图案。
// 轮廓 = 被影响的东西（攻击剑 / 防御盾 / 资金图表 / 禁制钥匙…），箭头 = 方向，箭头数 = 强度。
test('徽记按效果设计：轮廓 / 方向 / 强度', async () => {
  const { echoSigil } = await import('../../public/js/ui/echoSigils.js');
  const sharp = echoSigil({ id: 'atk_s', group: 'atk', kind: 'mods', desc: '全体干员攻击 +6%' }, 'ally');
  assert.deepEqual(sharp, { base: 'sword', dir: 'up', level: 1 });
  const strong = echoSigil({ id: 'atk_m', group: 'atk', kind: 'mods', desc: '全体干员攻击 +12%' }, 'ally');
  assert.deepEqual(strong, { base: 'sword', dir: 'up', level: 2 }, '同一效果、强度更高 → 多一个箭头');
  const dull = echoSigil({ id: 'r_weak_melee', effect: { kind: 'unitMods' }, desc: '近战位干员攻击 −12%' }, 'curse');
  assert.deepEqual(dull, { base: 'sword', dir: 'down', level: 2 }, '诅咒是向下箭头');
  assert.equal(echoSigil({ id: 'block_bond', effect: { kind: 'bondBan' }, desc: '禁止一个盟约' }, 'curse').base, 'key');
  assert.equal(echoSigil({ id: 'tribute', effect: { kind: 'coinMul' }, desc: '资金收入 −10%' }, 'curse').base, 'chart');
  assert.equal(echoSigil({ id: 'miracle', desc: '免费刷新总数上限 5 次' }, 'curse').base, 'refresh');
  assert.equal(echoSigil({ id: 'harden', desc: '防御 +200' }, 'enemy').base, 'shield');
});
// 维护者 2026-11-05：有时效的 buff 要在 buff 栏打角标 ——
//   temporary（深潜补给的本层词条 / 本回合随机诅咒）→ 「本」
//   roundsLeft（排异 / 封锁按层数到期）→ 剩余层数
// 没有时效的 buff 不打角标（left = null 且 temp = false）。
test('本层词条带 temporary：圆片打「本」角标，title 写明本层', () => {
  const chips = echoBuffChips({ words: [
    { id: 'supply:20:词条 · 强攻', name: '词条 · 强攻', desc: '深潜补给：本层全队生效', temporary: true, rounds: 1 },
    { id: 'shield', name: '护盾' },
  ] });
  const supply = chips.find((c) => c.label === '词条 · 强攻');
  assert.equal(supply.temp, true, '本层词条要标记 temporary');
  assert.equal(supply.left, 1, '角标显示 1（本层）');
  assert.ok(supply.title.includes('本层'), '悬浮说明要写明本层');
  const plain = chips.find((c) => c.label === '护盾');
  assert.equal(plain.temp, false, '普通词条不标记');
  assert.equal(plain.left, null, '普通词条没有角标');
});

test('按层数到期的诅咒带 roundsLeft：圆片打剩余层数', () => {
  const chips = echoBuffChips({ curses: [
    { id: 'block_bond', name: '排异', desc: '随机一个附加盟约的干员无法部署', rarity: 'rare', roundsLeft: 3 },
    { id: 'frenzy', name: '狂怒', desc: '敌方攻击 +10%' },
  ] });
  const ban = chips.find((c) => c.label === '排异');
  assert.equal(ban.left, 3);
  assert.ok(ban.title.includes('剩余 3 层'));
  const plain = chips.find((c) => c.label === '狂怒');
  assert.equal(plain.left, null, '没有到期层的诅咒不打角标');
});

test('本回合随机诅咒带 temporary：圆片打「本」角标', () => {
  const chips = echoBuffChips({ curses: [{ id: 'fog', name: '迷雾（本回合）', rarity: 'common', temporary: true, rounds: 1 }] });
  assert.equal(chips[0].temp, true);
  assert.equal(chips[0].left, 1);
  assert.ok(chips[0].title.includes('本回合'));
});
