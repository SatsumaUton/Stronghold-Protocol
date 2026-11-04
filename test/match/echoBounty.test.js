// 「深渊回响」深潜的悬赏（server/match/match/echoBounty.js）单元测试。
//
// 两条要守住的：
//   1. 目标必须从**已经生成出来的波次**里抽（不查数据表），且排除 boss / part / 已有悬赏怪
//   2. 赏金跟着怪的价值走 —— 对着原版 129 张悬赏卡反推的 `coin ≈ 血量 / 15000` 校准
//      （原版实测：tier1 550–15000 血给 0–1 币、tier3 40000–90000 血给 3–6 币）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  echoBountyDue, echoBountyPayout, echoBountyCards,
  ECHO_BOUNTY_EVERY, ECHO_BOUNTY_MIN, ECHO_BOUNTY_MAX, ECHO_BOUNTY_TIERS,
} from '../../server/match/match/echoBounty.js';

const ENEMIES = {
  slime: { stats: { maxHp: 550 } },
  mid: { stats: { maxHp: 6000 } },
  tank: { stats: { maxHp: 40000 } },
  huge: { stats: { maxHp: 90000 } },
};
const gd = { enemy: (k) => ENEMIES[k] || null };
const seq = (...xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

test('触发节奏：挂在非 boss 的固定节点上（深度 3 / 8 / 13 / 23…）', () => {
  assert.equal(ECHO_BOUNTY_EVERY, 5);
  // boss 返场在锚点 5/10/15（之后 25/35），悬赏错开 2 层 ——
  // 否则 boss 回合 this.wave 为空，悬赏静默发不出来
  assert.equal(echoBountyDue(2), false);
  assert.equal(echoBountyDue(3), true, '深度 3 悬赏');
  assert.equal(echoBountyDue(5), false, '深度 5 是 boss 返场，不发悬赏');
  assert.equal(echoBountyDue(8), true, '深度 8 悬赏');
  assert.equal(echoBountyDue(10), false, '深度 10 是 boss');
  assert.equal(echoBountyDue(13), true);
  assert.equal(echoBountyDue(15), false, '深度 15 是锚点 boss');
  assert.equal(echoBountyDue(18), false, '15 之后节点放稀到 10 层，下一个悬赏在 23');
  assert.equal(echoBountyDue(23), true, '深度 23 = 25 前两层');
  assert.equal(echoBountyDue(33), true, '深度 33 = 35 前两层');
  // diveStart 参与换算：深度 = 回合 − 起点 + 1
  assert.equal(echoBountyDue(3, 1), true);
  assert.equal(echoBountyDue(18, 16), true, '起点 16 时 R18 = 深度 3');
  assert.equal(echoBountyDue(18, 1), false, '起点 1 时 R18 = 深度 18，不是悬赏层');
});

test('赏金固定档位表：按基础血量 × 数量切 1 / 2 / 3 / 6 币', () => {
  assert.equal(ECHO_BOUNTY_TIERS.length, 4);
  assert.deepEqual(ECHO_BOUNTY_TIERS.map((t) => t.coin), [1, 2, 3, 6]);
  // 边界：档位含上界
  assert.equal(echoBountyPayout(5000), 1);
  assert.equal(echoBountyPayout(5001), 2);
  assert.equal(echoBountyPayout(20000), 2);
  assert.equal(echoBountyPayout(20001), 3);
  assert.equal(echoBountyPayout(50000), 3);
  assert.equal(echoBountyPayout(50001), 6);
  assert.equal(echoBountyPayout(90000), 6);
  // 数量计入威胁值：两只 3000 血 = 6000 → 第 2 档
  assert.equal(echoBountyPayout(3000, 1), 1);
  assert.equal(echoBountyPayout(3000, 2), 2);
});

test('数值低的怪不会被高估（用户的核心要求）', () => {
  // 注意：原版自己也是粗粒度的 —— 6000 血与 15000 血都给 1 币（enemy_1006_shield / enemy_9006_actoxi），
  // 所以这里只要求「不递减」和「小怪绝不能拿到重甲的赏金」，不要求每一档都严格变大。
  assert.ok(echoBountyPayout(550) <= echoBountyPayout(6000), '赏金不能随血量下降');
  assert.ok(echoBountyPayout(550) < echoBountyPayout(40000), '小怪必须比重甲少');
  assert.ok(echoBountyPayout(6000) < echoBountyPayout(90000), '中甲必须比巨兽少');
  assert.equal(echoBountyPayout(550), ECHO_BOUNTY_MIN, '再小的怪也给最低档，不会是 0');
  // 单调性：血量越大，赏金不会变小
  const hps = [1, 550, 3000, 6000, 15000, 20000, 40000, 90000, 200000];
  for (let i = 1; i < hps.length; i++) {
    assert.ok(echoBountyPayout(hps[i]) >= echoBountyPayout(hps[i - 1]), `${hps[i - 1]}→${hps[i]} 出现倒挂`);
  }
});

test('赏金有上下限，且随数量增长', () => {
  assert.equal(echoBountyPayout(1e9), ECHO_BOUNTY_MAX, '封顶');
  assert.equal(echoBountyPayout(0), ECHO_BOUNTY_MIN);
  assert.ok(echoBountyPayout(6000, 4) > echoBountyPayout(6000, 1), '多只更值钱');
});

test('档位与深度无关：同一只怪永远同一档（玩家可预期）', () => {
  assert.equal(echoBountyPayout(40000), 3);
  assert.equal(echoBountyPayout(40000, 1), 3);
  // 多传一个 depth 参数也不会改变档位（旧签名兼容，参数被忽略）
  assert.equal(echoBountyPayout(40000, 1, 20), 3);
});

test('目标只从已生成的波次里抽，且排除 boss / part / 悬赏怪', () => {
  const spawns = [
    { enemyKey: 'mid', count: 2 },
    { enemyKey: 'tank', count: 1 },
    { enemyKey: 'slime', count: 3, tag: 'part' },
    { enemyKey: 'huge', count: 1, tag: 'boss' },
    { enemyKey: 'mid', count: 1, tag: 'bounty' },
    { enemyKey: 'unknown_key', count: 1 },
  ];
  const cards = echoBountyCards(spawns, { gd, depth: 0, rng: seq(0.1), maxCards: 1 });
  assert.equal(cards.length, 1);
  const keys = new Set(['mid', 'tank']);
  assert.ok(keys.has(cards[0].enemyKey), `抽到的必须是候选里的，实际 ${cards[0].enemyKey}`);
  assert.equal(cards[0].payout, 'kill');
  assert.ok(cards[0].coin >= ECHO_BOUNTY_MIN);
});

test('同一 enemyKey 只出一张卡，数量按波次累加', () => {
  const spawns = [{ enemyKey: 'mid', count: 2 }, { enemyKey: 'mid', count: 3 }];
  const cards = echoBountyCards(spawns, { gd, depth: 0, rng: seq(0.9), maxCards: 3 });
  assert.equal(cards.length, 1, '不能为同一个怪出两张卡');
  assert.equal(cards[0].count, 5, '数量应该累加');
});

test('空输入 / 无 gd / 无敌人时安全返回空', () => {
  assert.deepEqual(echoBountyCards([], { gd, rng: seq(0.5) }), []);
  assert.deepEqual(echoBountyCards(null, { gd, rng: seq(0.5) }), []);
  assert.deepEqual(echoBountyCards([{ enemyKey: 'mid' }], { gd: null, rng: seq(0.5) }), []);
  assert.deepEqual(echoBountyCards([{ enemyKey: 'nope' }], { gd, rng: seq(0.5) }), []);
});

test('确定性：同样的随机序列抽到同样的目标', () => {
  const spawns = [{ enemyKey: 'mid', count: 1 }, { enemyKey: 'tank', count: 1 }];
  const a = echoBountyCards(spawns, { gd, depth: 5, rng: seq(0.7), maxCards: 1 });
  const b = echoBountyCards(spawns, { gd, depth: 5, rng: seq(0.7), maxCards: 1 });
  assert.deepEqual(a.map((c) => c.enemyKey), b.map((c) => c.enemyKey));
  assert.deepEqual(a.map((c) => c.coin), b.map((c) => c.coin));
});
