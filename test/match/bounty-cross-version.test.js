// test/match/bounty-cross-version.test.js —— 跨版本悬赏卡（维护者 2026-11-22「放吧」）。
//
// 需求原话：「赏金目标可以混合在一起。但是如果涉及装备或者盟约增加有不存在第二期下半版本的就分版本区分」
//   · 悬赏卡不含装备/盟约引用（审计已证），所以整体混合
//   · 目标怪要能真正解析到 —— crossVersionEnemies 注入的是 `<slug>:<key>` 前缀 key，
//     而 cards.bounty 的 enemyKey 是裸 key，必须换掉才能进池子
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { getVersionData } from '../../server/data.js';
import { crossVersionBountyCards } from '../../server/match/match/echoCrossBounty.js';

const QUIET = { warn() {}, error() {}, info() {} };
const DEF = getVersionData('act2autochess', { log: QUIET });
const REG = getVersionData('act3autochess@V3_1', { log: QUIET });
const REGISTRY = createRegistry({ log: QUIET });

/** 一个深潜房（指定版本数据）。 */
const dive = (data) => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 7, fake: true, variant: 'deepecho', registry: REGISTRY, data }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  return h;
};

test('第二期下半的深潜房：并入规程独有的悬赏卡，且目标 key 能解析', (t) => {
  const h = dive(DEF);
  const m = h.m;
  t.after(() => m.dispose());

  const added = Number(m.echoCrossBountyCards) || 0;
  assert.ok(added > 0, `应该并入了跨版本悬赏卡，实际 ${added}`);

  const cards = m.gd.choices.cards.bounty;
  const ids = new Set(cards.map((c) => c.effectId));
  // 规程那 6 张里，目标怪在跨版本池里存在的应当并进来
  const SIX = ['enemyeffect_12_9', 'enemyeffect_13_9', 'enemyeffect_16_13', 'enemyeffect_17_7', 'enemyeffect_18_7', 'enemyeffect_20_7'];
  const merged = SIX.filter((id) => ids.has(id));
  assert.ok(merged.length >= 5, `应并入多数规程独有卡，实际 ${merged.length}: ${merged.join(',')}`);

  // 每一张并入的卡，目标都能在本局 gd 里查到（否则 addBounty 会静默失败）
  for (const c of cards) {
    if (!SIX.includes(c.effectId)) continue;
    assert.ok(m.gd.enemy(c.enemyKey), `${c.effectId} 的目标 ${c.enemyKey} 要能查到`);
    assert.notEqual(c.enemyKey, 'enemy_10147_nsbomb', '目标应该是带前缀的 key，不是裸 key');
  }

  // 卡面效果也要能解析（否则只剩 choices.json 里写死的文字）
  for (const c of cards) {
    if (!SIX.includes(c.effectId)) continue;
    assert.ok(m.gd.effect(c.effectId), `${c.effectId} 的 effect 要能查到`);
  }
});

test('规程房的深潜：本版已有卡不被重复并入（数量不翻倍）', (t) => {
  const h = dive(REG);
  const m = h.m;
  t.after(() => m.dispose());
  // 规程自己有 135 张；并集只应该加「规程没有、别版有」的
  const ids = new Set(m.gd.choices.cards.bounty.map((c) => c.effectId));
  assert.equal(ids.size, m.gd.choices.cards.bounty.length, '不该有重复 effectId');
  assert.ok(m.gd.choices.cards.bounty.length >= 135, `至少保留规程自己的 135 张，实际 ${m.gd.choices.cards.bounty.length}`);
});

test('普通房（非深潜）完全不碰：cards.bounty 与 effects 键集原样', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 7, fake: true, registry: REGISTRY, data: DEF }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m.echoCrossBountyCards, undefined, '非深潜房不该有这个字段');
  assert.equal(m.gd.choices.cards.bounty.length, DEF.choices.cards.bounty.length, '卡数不变');
  assert.equal(m.gd.raw.effects, DEF.effects, 'effects 不换表');
});

test('crossVersionBountyCards 纯函数：只挑本版没有的、且目标可解析的卡', () => {
  const r = crossVersionBountyCards(DEF.choices, () => ({ stats: { maxHp: 1 } }), () => null);
  // 目标查询恒真 → 只要 effect 补得上就收；没有 effect 记录的不收
  assert.ok(r.cards.length > 0);
  for (const c of r.cards) assert.equal(typeof c.enemyKey, 'string');
  // 本版已有的 effectId 不该出现在结果里
  const have = new Set(DEF.choices.cards.bounty.map((c) => c.effectId));
  for (const c of r.cards) assert.ok(!have.has(c.effectId), `${c.effectId} 是本版已有的，不该并入`);
});
