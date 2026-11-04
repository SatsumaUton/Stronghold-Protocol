// 深渊回响：诅咒词条表（2026-11-05）。
//
// 和「侵蚀词条」（echoWords.js）的区别：
//   * 侵蚀词条是**每回合随机**挂到敌人身上的 buff（对一场战斗生效）；
//   * 诅咒是**整局生效**的负面规则，挂在 match 上（跨回合），玩家在「深渊回响」页面的诅咒列表里看到。
//
// 为什么要有这张表：挑战关（深度 5 / 10）没达成清怪线要「加一个诅咒」，
// 后续还会有别的来源（隐藏 boss 失败、连续团灭、深度墙……）。如果每次都在 echoPhase 里手写一条文案，
// 效果和文案会各改各的 —— 所以诅咒一律从这里取，效果由 `echoCurseEffects` 统一解析。
//
// `live` 的含义：效果是否**真的接进了对局**。没接的条目照样可以显示（给设计留位），
// 但 `echoCurseEffects` 不会把它算进数值里，免得出现「界面上有、实际空转」的假规则。

/** 诅咒对局的字段前缀（以后要挂 buff 时用得上，和词条的 `echo:` 区分开）。 */
export const ECHO_CURSE_PREFIX = 'echo:curse:';

/**
 * 已实现的效果类型 → 由谁消费：
 *   wordCap      侵蚀词条上限 +value            （echoPhase._echoWordCap）
 *   coinMul      本局资金 ×value                 （echoPhase._echoCoinMul → settle 入账）
 * 新增一种就要同时在 `echoCurseEffects` 里累加、并在对应位置消费，再加一条用例。
 */
export const ECHO_CURSE_LIVE_KINDS = Object.freeze([
  'wordCap', 'coinMul', 'freeRefresh', 'timeMul', 'budgetMul',
  'enemyAtkMul', 'enemyHpMul', 'bountyCoin', 'blessingMax', 'intel',
]);

/**
 * 诅咒词条表。
 *
 * 每条：`id` / `name`（玩家看到的名字）/ `desc`（一句话说明，客户端直接显示）/
 * `rarity`（`common` 普通 / `rare` 稀有 / `epic` 传说，投放权重见 `pickEchoCurse`）/
 * `effect: { kind, value }` / `live`（效果是否已接入 —— 现在全部为 true；保留这个字段是为了
 * 以后新增词条时可以先登记文案、等消费点写好再点亮）。
 * `value` 的语义由 `kind` 决定（见上）。
 */
export const ECHO_CURSES = Object.freeze([
  // ---- 已接入 ----
  Object.freeze({
    id: 'erosion', name: '侵蚀', desc: '侵蚀词条上限 +1', live: true, rarity: 'common',
    effect: Object.freeze({ kind: 'wordCap', value: 1 }),
  }),
  Object.freeze({
    id: 'tribute', name: '贡赋', desc: '资金收入 −15%', live: true, rarity: 'common',
    effect: Object.freeze({ kind: 'coinMul', value: 0.85 }),
  }),
  // ---- 全部已接入（2026-11-05：每条都有消费点，见上面的 ECHO_CURSE_LIVE_KINDS） ----
  Object.freeze({
    id: 'tithe', name: '什一税', desc: '资金收入 −25%', live: true, rarity: 'epic',
    effect: Object.freeze({ kind: 'coinMul', value: 0.75 }),
  }),
  Object.freeze({
    id: 'drought', name: '枯竭', desc: '免费刷新上限 −1', live: true, rarity: 'common',
    effect: Object.freeze({ kind: 'freeRefresh', value: -1 }),
  }),
  Object.freeze({
    id: 'leaden', name: '滞重', desc: '战斗时限 −10%', live: true, rarity: 'common',
    effect: Object.freeze({ kind: 'timeMul', value: 0.9 }),
  }),
  Object.freeze({
    id: 'swarm', name: '蜂拥', desc: '出怪预算 +10%（同样时间更多敌人）', live: true, rarity: 'rare',
    effect: Object.freeze({ kind: 'budgetMul', value: 1.1 }),
  }),
  Object.freeze({
    id: 'frenzy', name: '狂怒', desc: '敌方攻击 +10%', live: true, rarity: 'rare',
    effect: Object.freeze({ kind: 'enemyAtkMul', value: 1.1 }),
  }),
  Object.freeze({
    id: 'carapace', name: '甲壳', desc: '敌方生命 +10%', live: true, rarity: 'rare',
    effect: Object.freeze({ kind: 'enemyHpMul', value: 1.1 }),
  }),
  Object.freeze({
    id: 'greed', name: '贪婪', desc: '深潜悬赏少 1 币（最低 1）', live: true, rarity: 'rare',
    effect: Object.freeze({ kind: 'bountyCoin', value: -1 }),
  }),
  Object.freeze({
    id: 'silence', name: '静默', desc: '祝福名额 −1（最低 1）', live: true, rarity: 'epic',
    effect: Object.freeze({ kind: 'blessingMax', value: -1 }),
  }),
  Object.freeze({
    id: 'fog', name: '迷雾', desc: '本局敌方情报不再显示威胁值', live: true, rarity: 'epic',
    effect: Object.freeze({ kind: 'intel', value: 0 }),
  }),
]);

const BY_ID = new Map(ECHO_CURSES.map((c) => [c.id, c]));

/** 按 id 取诅咒；未知 id 返回 null（客户端只显示认识的，不要抛）。 */
export const echoCurseById = (id) => BY_ID.get(String(id)) || null;

/** 稀有度的中文名（界面 / 日志用；未知按普通处理）。 */
export const ECHO_CURSE_RARITY_LABEL = Object.freeze({ common: '普通', rare: '稀有', epic: '传说' });

/**
 * 按深度抽一条诅咒（维护者 2026-11-05：高级词条要有稀有度，越深才越可能碰到）。
 *
 * 权重：深度 1–9 只有普通；10–15 普通 0.8 / 稀有 0.2；16 起普通 0.6 / 稀有 0.3 / 传说 0.1。
 * 该档没有词条时退回普通档；表为空才返回 null。
 *
 * @param {number} depth 深潜深度
 * @param {() => number} rng [0,1) 随机源（调用方传自己的种子流，保证可复现）
 */
export function pickEchoCurse(depth, rng = () => 0.5) {
  const d = Math.max(1, Math.floor(Number(depth) || 1));
  const w = d >= 16 ? { common: 0.6, rare: 0.3, epic: 0.1 }
    : d >= 10 ? { common: 0.8, rare: 0.2, epic: 0 }
      : { common: 1, rare: 0, epic: 0 };
  const roll = Math.min(0.999999, Math.max(0, Number(rng()) || 0));
  let acc = 0;
  let tier = 'common';
  for (const k of ['common', 'rare', 'epic']) {
    acc += w[k];
    if (roll < acc) { tier = k; break; }
  }
  let pool = ECHO_CURSES.filter((c) => c.rarity === tier);
  if (!pool.length) pool = ECHO_CURSES.filter((c) => c.rarity === 'common');
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length))] || pool[0];
}

/**
 * 按规则移除诅咒（「净化 / 涤罪」祝福用）。
 *
 * `spec`：
 *   - 数字 n     → 移除最早的 n 层（任意稀有度）
 *   - `'all'`    → 全部移除
 *   - `'common'` → **只移除普通诅咒**，稀有 / 传说保留（「涤罪」用的就是这一档）
 *
 * @param {string[]} ids
 * @param {number|string} spec
 * @returns {{ kept: string[], removed: string[] }}
 */
export function removeEchoCurses(ids, spec) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  const kept = [];
  const removed = [];
  const only = typeof spec === 'string' && spec !== 'all' ? spec : null;
  let budget = typeof spec === 'number' ? Math.max(0, Math.trunc(spec)) : Infinity;
  for (const id of list) {
    const rarity = echoCurseById(id)?.rarity || 'common';
    const eligible = budget > 0 && (!only || rarity === only);
    if (eligible) { removed.push(id); budget -= 1; } else kept.push(id);
  }
  return { kept, removed };
}

/**
 * 把一串诅咒 id 折算成实际效果。
 *
 * 只累加 `live: true` 的条目；未接入的 id 收在 `pending` 里（方便测试和以后接线时对账）。
 * 同类效果相乘 / 相加各自独立，不会互相覆盖。
 *
 * @param {Iterable<string>} ids 已获得的诅咒 id（可重复 = 叠层）
 * @returns {{ wordCap: number, coinMul: number, freeRefresh: number, timeMul: number,
 *   budgetMul: number, enemyAtkMul: number, enemyHpMul: number, bountyCoin: number,
 *   blessingMax: number, intel: boolean, pending: string[] }}
 */
export function echoCurseEffects(ids = []) {
  const out = {
    wordCap: 0, coinMul: 1, freeRefresh: 0, timeMul: 1, budgetMul: 1,
    enemyAtkMul: 1, enemyHpMul: 1, bountyCoin: 0, blessingMax: 0, intel: false, pending: [],
  };
  for (const raw of ids || []) {
    const c = echoCurseById(raw);
    if (!c) { out.pending.push(String(raw)); continue; }
    if (c.live !== true) { out.pending.push(c.id); continue; }
    const { kind, value } = c.effect || {};
    if (kind === 'wordCap') out.wordCap += Number(value) || 0;
    else if (kind === 'coinMul') out.coinMul *= Number(value) > 0 ? Number(value) : 1;
    else if (kind === 'freeRefresh') out.freeRefresh += Number(value) || 0;
    else if (kind === 'timeMul') out.timeMul *= Number(value) > 0 ? Number(value) : 1;
    else if (kind === 'budgetMul') out.budgetMul *= Number(value) > 0 ? Number(value) : 1;
    else if (kind === 'enemyAtkMul') out.enemyAtkMul *= Number(value) > 0 ? Number(value) : 1;
    else if (kind === 'enemyHpMul') out.enemyHpMul *= Number(value) > 0 ? Number(value) : 1;
    else if (kind === 'bountyCoin') out.bountyCoin += Number(value) || 0;
    else if (kind === 'blessingMax') out.blessingMax += Number(value) || 0;
    else if (kind === 'intel') out.intel = true;
  }
  return out;
}

/**
 * 显示用：把 id 列表按「同类合并」变成 `{ id, name, desc, stacks }`，顺序按首次出现。
 * 界面上一律走这个函数，别自己拼名字。
 */
export function echoCurseList(ids = []) {
  const seen = new Map();
  for (const raw of ids || []) {
    const c = echoCurseById(raw);
    const key = c ? c.id : String(raw);
    if (!seen.has(key)) {
      seen.set(key, {
        id: key,
        name: c ? c.name : key,
        desc: c ? c.desc : '未知诅咒',
        stacks: 0,
      });
    }
    seen.get(key).stacks += 1;
  }
  return [...seen.values()].map((c) => ({
    id: c.id,
    name: c.stacks > 1 ? `${c.name} ×${c.stacks}` : c.name,
    desc: c.desc,
    stacks: c.stacks,
  }));
}
