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
  'unitMods', 'destroyEquip', 'blackout', 'deployBan', 'bondBan', 'lpMul', 'lpExtra',
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
  // ---- 资金类（2026-11-05，维护者要求「资金变少」多几档） ----
  Object.freeze({
    id: 'levy', name: '征收', desc: '资金收入 −10%', live: true, rarity: 'common',
    effect: Object.freeze({ kind: 'coinMul', value: 0.9 }),
  }),
  Object.freeze({
    id: 'heavytax', name: '重税', desc: '资金收入 −30%', live: true, rarity: 'epic',
    effect: Object.freeze({ kind: 'coinMul', value: 0.7 }),
  }),
  // ---- 遮蔽（2026-11-05）：比「迷雾」更狠，敌方情报整块不给 ----
  Object.freeze({
    id: 'blackout', name: '遮蔽', desc: '本局完全不显示敌方情报（威胁值 / 精英 / 日程全部隐藏）', live: true, rarity: 'epic',
    effect: Object.freeze({ kind: 'blackout', value: 0 }),
  }),
  // ---- 干员减益（2026-11-05，维护者要求）：只打符合条件的那部分干员 ----
  Object.freeze({
    id: 'weak_melee', name: '削锋', desc: '近战位干员攻击 −10%', live: true, rarity: 'rare', scope: 'run',
    effect: Object.freeze({ kind: 'unitMods', value: 0 }),
    filter: Object.freeze({ position: 'MELEE' }), unitMods: Object.freeze({ atkMul: 0.9 }),
  }),
  Object.freeze({
    id: 'weak_ranged', name: '断弦', desc: '远程位干员攻速 −8%', live: true, rarity: 'rare', scope: 'run',
    effect: Object.freeze({ kind: 'unitMods', value: 0 }),
    filter: Object.freeze({ position: 'REMOTE' }), unitMods: Object.freeze({ batPct: 0.08 }),
  }),
  // ---- 生命惩罚（2026-11-05，维护者要求「多扣生命值」）：只放大已有的漏怪，不会凭空扣血 ----
  Object.freeze({
    id: 'bleed', name: '失血', desc: '漏怪伤害 ×1.5', live: true, rarity: 'rare',
    effect: Object.freeze({ kind: 'lpMul', value: 1.5 }),
  }),
  Object.freeze({
    id: 'hemorrhage', name: '溃血', desc: '漏怪伤害 ×2', live: true, rarity: 'epic',
    effect: Object.freeze({ kind: 'lpMul', value: 2 }),
  }),
  Object.freeze({
    id: 'ache', name: '剧痛', desc: '有漏怪时每回合额外 −2 生命', live: true, rarity: 'rare',
    effect: Object.freeze({ kind: 'lpExtra', value: 2 }),
  }),
  // ---- 部署禁令（2026-11-05，维护者要求）：改的是「能不能落子」，由 placement.js 拦 ----
  Object.freeze({
    id: 'block_tiles', name: '封锁', desc: '随机 3 个地块无法部署干员', live: true, rarity: 'epic',
    effect: Object.freeze({ kind: 'deployBan', value: 3 }),
  }),
  Object.freeze({
    id: 'block_bond', name: '排异', desc: '随机一个盟约的干员无法部署（同构体改变后仍受限）', live: true, rarity: 'epic',
    effect: Object.freeze({ kind: 'bondBan', value: 1 }),
  }),
]);

/**
 * **回合诅咒**（维护者 2026-11-05）：每回合按深度随机刷新一条，**只影响本回合**。
 *
 * 和永久诅咒的区别：不进 `echoCurseIds`（所以「净化 / 涤罪」清不掉它，它自己下回合就没了），
 * 也不占永久诅咒的显示位置 —— 结算时会标注「本回合」。
 *
 * 另外两条特殊 kind：
 *   - `unitMods`：只作用于**符合条件的干员**（现在按站位 MELEE / REMOTE 区分），
 *     在部署时挂 buff（和祝福同一条钩子），不影响敌人。
 *   - `destroyEquip`：本回合开始时销毁每人随机 1 件已装备的装备（一次性）。
 */
export const ECHO_ROUND_CURSES = Object.freeze([
  Object.freeze({ id: 'r_frenzy', name: '躁动', desc: '本回合敌方攻击 +8%', rarity: 'common', scope: 'round', effect: Object.freeze({ kind: 'enemyAtkMul', value: 1.08 }) }),
  Object.freeze({ id: 'r_carapace', name: '硬壳', desc: '本回合敌方生命 +8%', rarity: 'common', scope: 'round', effect: Object.freeze({ kind: 'enemyHpMul', value: 1.08 }) }),
  Object.freeze({ id: 'r_swarm', name: '涌潮', desc: '本回合出怪 +8%', rarity: 'common', scope: 'round', effect: Object.freeze({ kind: 'budgetMul', value: 1.08 }) }),
  Object.freeze({ id: 'r_leaden', name: '迟滞', desc: '本回合战斗时限 −8%', rarity: 'rare', scope: 'round', effect: Object.freeze({ kind: 'timeMul', value: 0.92 }) }),
  Object.freeze({ id: 'r_drought', name: '干涸', desc: '本回合免费刷新上限 −1', rarity: 'rare', scope: 'round', effect: Object.freeze({ kind: 'freeRefresh', value: -1 }) }),
  Object.freeze({ id: 'r_weak_melee', name: '钝刃', desc: '本回合近战位干员攻击 −12%', rarity: 'rare', scope: 'round', effect: Object.freeze({ kind: 'unitMods', value: 0 }), filter: Object.freeze({ position: 'MELEE' }), unitMods: Object.freeze({ atkMul: 0.88 }) }),
  Object.freeze({ id: 'r_weak_ranged', name: '断弦', desc: '本回合远程位干员攻速 −10%', rarity: 'rare', scope: 'round', effect: Object.freeze({ kind: 'unitMods', value: 0 }), filter: Object.freeze({ position: 'REMOTE' }), unitMods: Object.freeze({ batPct: 0.10 }) }),
  Object.freeze({ id: 'r_bleed', name: '渗血', desc: '本回合漏怪伤害 ×1.25', rarity: 'rare', scope: 'round', effect: Object.freeze({ kind: 'lpMul', value: 1.25 }) }),
  Object.freeze({ id: 'r_levy', name: '抽成', desc: '本回合资金收入 −8%', rarity: 'common', scope: 'round', effect: Object.freeze({ kind: 'coinMul', value: 0.92 }) }),
  Object.freeze({ id: 'r_rust', name: '锈蚀', desc: '本回合开始时，每人随机销毁 1 件已装备的装备', rarity: 'epic', scope: 'round', effect: Object.freeze({ kind: 'destroyEquip', value: 1 }) }),
]);

/**
 * **固定回合诅咒**（维护者 2026-11-05）：到了这些深度就永久加一条，与随机无关。
 * 键是深度，值是诅咒 id。每局每个深度只加一次（跨存档用 `echoCurseIds` 去重）。
 */
export const ECHO_FIXED_CURSE_ROUNDS = Object.freeze({
  6: 'tribute',
  8: 'block_tiles',     // 第一次部署禁令：封 3 个地块
  10: 'swarm',
  12: 'block_bond',     // 第二次：排异一个盟约（同构体也算）
  14: 'frenzy',
  18: 'silence',
  22: 'fog',
});

const BY_ID = new Map([...ECHO_CURSES, ...ECHO_ROUND_CURSES].map((c) => [c.id, c]));

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
    enemyAtkMul: 1, enemyHpMul: 1, bountyCoin: 0, blessingMax: 0, intel: false, blackout: false, lpMul: 1, lpExtra: 0, pending: [],
  };
  for (const raw of ids || []) {
    const c = echoCurseById(raw);
    if (!c) { out.pending.push(String(raw)); continue; }
    // 回合诅咒没有 live 字段（它们天生生效）；只有显式 live:false 的才算「预留」
    if (c.live === false) { out.pending.push(c.id); continue; }
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
    else if (kind === 'blackout') out.blackout = true;
    else if (kind === 'lpMul') out.lpMul *= Number(value) > 0 ? Number(value) : 1;
    else if (kind === 'lpExtra') out.lpExtra += Number(value) || 0;
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

/**
 * 本回合刷哪条回合诅咒（维护者 2026-11-05）。
 *
 * 前 3 层不刷；之后按深度给概率（0.15 + 深度×0.02，最高 0.7），抽到就从 `ECHO_ROUND_CURSES` 里随机一条。
 * 用调用方传入的种子流，保证同一局可复现。
 *
 * @param {number} depth
 * @param {() => number} rng
 * @returns {typeof ECHO_ROUND_CURSES[number] | null} null = 本回合没有回合诅咒
 */
export function pickRoundCurse(depth, rng = () => 0.5) {
  const d = Math.max(1, Math.floor(Number(depth) || 1));
  if (d < 4 || !ECHO_ROUND_CURSES.length) return null;
  const chance = Math.min(0.7, 0.15 + d * 0.02);
  if ((Number(rng()) || 0) >= chance) return null;
  const i = Math.min(ECHO_ROUND_CURSES.length - 1, Math.floor((Number(rng()) || 0) * ECHO_ROUND_CURSES.length));
  return ECHO_ROUND_CURSES[i] || null;
}

/** 取一组 id 里的「干员减益」效果（unitMods），给部署钩子用。 */
export function echoCurseUnitMods(ids = []) {
  const out = [];
  for (const raw of ids || []) {
    const c = echoCurseById(raw);
    if (!c || c.effect?.kind !== 'unitMods' || !c.unitMods) continue;
    out.push({ id: c.id, name: c.name, filter: c.filter || {}, mods: c.unitMods });
  }
  return out;
}

/**
 * 一条干员减益是否命中这个单位。
 *
 * 现在只按站位判断（`unit.def.position` 或 `unit.position`：MELEE / REMOTE）；
 * 没有位置信息的单位**不打**（宁可漏打，也不要把增益打到召唤物/装置上）。
 */
export function curseUnitMatches(filter, unit) {
  if (!unit || !filter || typeof filter !== 'object') return false;
  if (filter.position) {
    const pos = unit.def?.position || unit.position || null;
    if (pos !== filter.position) return false;
  }
  return true;
}

/** 把两份效果合并（回合诅咒 + 永久诅咒）：乘法乘、加法加、intel 取或。 */
export function mergeCurseEffects(a, b) {
  const x = a || {};
  const y = b || {};
  return {
    wordCap: (x.wordCap || 0) + (y.wordCap || 0),
    coinMul: (x.coinMul ?? 1) * (y.coinMul ?? 1),
    freeRefresh: (x.freeRefresh || 0) + (y.freeRefresh || 0),
    timeMul: (x.timeMul ?? 1) * (y.timeMul ?? 1),
    budgetMul: (x.budgetMul ?? 1) * (y.budgetMul ?? 1),
    enemyAtkMul: (x.enemyAtkMul ?? 1) * (y.enemyAtkMul ?? 1),
    enemyHpMul: (x.enemyHpMul ?? 1) * (y.enemyHpMul ?? 1),
    bountyCoin: (x.bountyCoin || 0) + (y.bountyCoin || 0),
    blessingMax: (x.blessingMax || 0) + (y.blessingMax || 0),
    intel: !!(x.intel || y.intel),
    blackout: !!(x.blackout || y.blackout),
    lpMul: (x.lpMul ?? 1) * (y.lpMul ?? 1),
    lpExtra: (x.lpExtra || 0) + (y.lpExtra || 0),
    pending: [...(x.pending || []), ...(y.pending || [])],
  };
}
