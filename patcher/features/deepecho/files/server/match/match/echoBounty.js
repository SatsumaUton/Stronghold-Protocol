// server/match/match/echoBounty.js — 「深渊回响」深潜的悬赏（DESIGN-ABYSS.md §10.4，维护者 2026-11-03 定）。
//
// 核心规则一句话：**悬赏目标从「已经随机出来的怪」里选，而不是从数据表里选。**
//
// 为什么必须改：原版按 `choices.schedule[modeId].rounds[r]` 在 R3 / R9 / R11 触发，R15 之后没有条目；
// 而且卡面写死怪种，深潜的波次是随机组合的，写死的怪可能整局都不出现 → 悬赏永远完不成。
//
// 触发（维护者给的对照表）：
//   原版 R1–14  → R3 / R9 / R11 固定（一行不动）
//   深潜        → 每 5 层一次，错开 boss 节点（深度 3 / 8 / 13 / 23…）
// 可达性：目标是从本回合**已生成**的波次里抽的，所以一定在场上出现过。
//
// 赏金表（用户要求「参考原本」）：原版 129 张卡的实测关系是 `coin ≈ 血量 / 15000`
//   （tier1 0–1 币 / 550–15000 血，tier2 1–2 币，tier3 3–6 币 / 40000–90000 血），
//   本模块沿用同一个量纲，并加一个温和的深度系数，避免「越深越亏」（同样的钱打 16 倍血的怪）。
//   单测里对着原版那几个真实样本校准过。
//
// 本文件只有纯函数 + 数据，没有 I/O、没有副作用 —— 单测直接调用。

import { isEchoNodeDepth } from './echo.js';

/** 深潜里几个回合发一次悬赏。 */
export const ECHO_BOUNTY_EVERY = 5;
/**
 * 赏金档位表（维护者 2026-11-03 定：固定档位，按血量切 1 / 2 / 3 / 6 币）。
 *
 * 为什么不再用公式：公式对玩家不可读 —— 同一只怪在不同深度给不同的钱，玩家没法预期。
 * 固定档位一眼就能看出「这只值几币」。按**基础血量 × 数量**归档（不含回合缩放），
 * 所以同一只怪永远同一档；深潜的收益靠悬赏份数与祝福，不靠单价膨胀。
 */
export const ECHO_BOUNTY_TIERS = Object.freeze([
  Object.freeze({ upTo: 5000, coin: 1 }),
  Object.freeze({ upTo: 20000, coin: 2 }),
  Object.freeze({ upTo: 50000, coin: 3 }),
  Object.freeze({ upTo: Infinity, coin: 6 }),
]);
/** 单张悬赏的赏金上下限（= 档位表的两端）。 */
export const ECHO_BOUNTY_MIN = 1;
export const ECHO_BOUNTY_MAX = 6;

/**
 * 这一回合该不该发悬赏：挂在**非 boss 的固定节点**上 —— 深度 3 / 8 / 13 / 23 / 33…（每 5 层一次，避开 boss 层）。
 *
 * 为什么避 boss：boss 返场在深度 5 / 10 / 15 / 25…，而 boss 回合的波次在 `this.bossWaves` 而不是 `this.wave`，
 * 悬赏「从本回合已生成的波次里现抽目标」在那里会抽空（历史上就静默发不出来）。
 * 错开 2 层后节奏变成：3 悬赏 → 5 boss → 8 悬赏 → 10 boss → 13 悬赏 → 15 boss…
 *
 * 深潜从第 1 回合开始，所以显示回合恒等于深度，这里直接拿回合号判。
 * @param {number} round 显示回合（`diveStart` 只为兼容旧签名保留，判定已不看它）
 */
export function echoBountyDue(round, diveStart = null) {
  const r = Math.floor(Number(round) || 0);
  const first = diveStart == null ? 1 : Math.max(1, Math.floor(Number(diveStart) || 1));
  // 深度 = 回合 − 起点 + 1；悬赏挂在「节点前 2 层」
  return isEchoNodeDepth(r - first + 1 + 2);
}

/**
 * 一只目标值多少赏金（固定档位表，见 `ECHO_BOUNTY_TIERS`）。
 *
 * @param {number} maxHp 该敌人的**基础**最大生命（不含回合缩放）
 * @param {number} [count] 数量（默认 1）
 * @returns {number} 赏金：1 / 2 / 3 / 6
 */
export function echoBountyPayout(maxHp, count = 1) {
  const hp = Math.max(1, Number(maxHp) || 0) * Math.max(1, Math.trunc(Number(count) || 1));
  for (const t of ECHO_BOUNTY_TIERS) if (hp <= t.upTo) return t.coin;
  return ECHO_BOUNTY_MAX;
}

/**
 * 从**本回合已经生成出来的波次**里抽悬赏目标（核心规则：不查数据表）。
 *
 * 只挑真实敌人：排除 boss / part / 已有的悬赏怪；同一 enemyKey 只出一张卡（避免两张卡抢同一批怪）。
 *
 * @param {Array<{ enemyKey: string, count?: number, tag?: string }>} spawns 本回合的 wave.spawns
 * @param {{ gd: object, depth?: number, rng: () => number, maxCards?: number }} opts
 * @returns {Array<{ enemyKey: string, count: number, coin: number, payout: 'kill', tier: number, name: string, desc: string }>}
 */
export function echoBountyCards(spawns, opts = {}) {
  const gd = opts.gd;
  const rng = typeof opts.rng === 'function' ? opts.rng : () => 0.5;
  const maxCards = Math.max(1, Math.min(3, Math.floor(Number(opts.maxCards) || 1)));
  const depth = Math.max(0, Number(opts.depth) || 0);
  if (!gd || typeof gd.enemy !== 'function' || !Array.isArray(spawns)) return [];
  const seen = new Map();
  for (const s of spawns) {
    if (!s || typeof s.enemyKey !== 'string') continue;
    if (s.tag === 'part' || s.tag === 'boss' || s.tag === 'bounty') continue;
    const e = gd.enemy(s.enemyKey);
    if (!e) continue;
    if (!seen.has(s.enemyKey)) seen.set(s.enemyKey, { key: s.enemyKey, count: 0 });
    seen.get(s.enemyKey).count += Math.max(1, Math.trunc(Number(s.count) || 1));
  }
  const pool = [...seen.values()];
  if (!pool.length) return [];
  const cards = [];
  while (pool.length && cards.length < maxCards) {
    const at = Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length));
    const t = pool.splice(at, 1)[0];
    const hp = Number(gd.enemy(t.key)?.stats?.maxHp) || 0;
    const count = Math.max(1, Math.min(20, t.count));
    cards.push({
      enemyKey: t.key,
      count,
      coin: echoBountyPayout(hp, count),
      payout: 'kill',
      echo: true,          // 深渊自己的悬赏（用来和原版悬赏区分）
      tier: 1,
      // 卡面文案：深潜的悬赏是现生成的，数据表里没有条目，所以走字面量（与 spDraft 的兜底名同一处理）
      name: '深渊悬赏', // i18n-ignore
      desc: '击倒本回合出现的悬赏目标', // i18n-ignore
    });
  }
  return cards;
}
