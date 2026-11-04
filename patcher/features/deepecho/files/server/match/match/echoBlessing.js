// server/match/match/echoBlessing.js — 「深渊回响」的祝福（DESIGN-ABYSS.md §6，2026-11-03）。
//
// 三个祝福，全部落在既有字段上，**server/sim 一行都不改**（和 echoWords.js 同一条成本约束）：
//   A 开局资金 +40    → 钱包：`ps.pendingFunds`（与悬赏资金同一条通道，settle.js:66）
//   B 全体攻速 +10%   → 玩家单位的 mods：`batPct: -0.1`（units.js 的 interval = bat×(1+ΣbatPct)×100/aspd）
//   C 全局资金 +20%   → 同 A 的通道，但作用在**结算时的入账**（settle.js 把 coins 乘上去）
//
// 节奏（§5②）：深潜里每 5 个深潜回合三选一；打过隐藏核心的队伍开局多一次（`echoBlessingDraws`）。
// 硬约定（§8 风险 2）：同类不叠加，且最多 3 个 —— 所以 `echoBlessingDue` 封顶 `ECHO_BLESSINGS.length`。
//
// 本文件只有纯函数 + 数据，没有 I/O、没有副作用 —— 单测直接调用。

/** buff key 前缀，便于在 buff 列表里一眼认出来源。 */
export const ECHO_BLESSING_PREFIX = 'echo:bl:';
/** 深潜里几个回合发一次祝福。 */
export const ECHO_BLESSING_EVERY = 5;
/**
 * 三选一的投票时限（维护者 2026-11-03 定：30 秒）。
 *
 * 为什么必须有：结算是「在线真人全投完」才触发的，一个人挂着不投就会把**全队卡死**。
 * 到点后按「票数最高、平票取靠前」强制结算 —— 已经投过的人的选择仍然生效。
 */
export const ECHO_BLESSING_VOTE_MS = 30000;

/**
 * 三个祝福。`kind` 决定生效通道：
 *   `fund`   —— 拿到的那一刻直接进钱包（一次性）
 *   `mods`   —— 给每个上场的己方单位挂 buff（持续整局）
 *   `coin`   —— 结算入账时乘上去（`coinMul`）
 *   `heal`   —— 拿到的那一刻**全队回复生命**（一次性，封顶到各自的初始生命 `gd.startLp`）
 *   `cleanse`—— 拿到的那一刻**移除诅咒**（一次性；固定的奇迹 / 远见诅咒不在可移除列表里）
 */
export const ECHO_BLESSING_MAX = 3;   // 同时持有的最多个数（扩池后不能用池子长度当上限）
export const ECHO_BLESSINGS = Object.freeze([
  Object.freeze({
    id: 'fund',
    name: '物资补给',
    desc: '立刻获得 25 资金',
    kind: 'fund',
    funds: 25,
  }),
  Object.freeze({
    id: 'haste',
    name: '疾风',
    desc: '全体干员攻速 +10%',
    kind: 'mods',
    // units.js: interval = bat × (1 + ΣbatPct) × 100 / aspd，所以 −0.1 就是「攻速 +10%」
    mods: Object.freeze({ batPct: -0.1 }),
  }),
  Object.freeze({
    id: 'loot',
    name: '丰收',
    desc: '每 3 层，全队 +1 次免费刷新',
    kind: 'coin',
    refreshEvery: 3,
  }),

  // —— 扩展池（2026-11-05）：全部走模拟器已有的 mods 字段，不新造机制 ——
  { id: 'atk_s', name: '锐刃', desc: '全体干员攻击 +6%', kind: 'mods', group: 'atk', mods: { atkMul: 1.06 } },
  { id: 'atk_m', name: '强攻', desc: '全体干员攻击 +12%', kind: 'mods', group: 'atk', mods: { atkMul: 1.12 } },
  { id: 'hp_s', name: '韧性', desc: '全体干员生命 +6%', kind: 'mods', group: 'hp', mods: { hpMul: 1.06 } },
  { id: 'hp_m', name: '铁壁', desc: '全体干员生命 +12%', kind: 'mods', group: 'hp', mods: { hpMul: 1.12 } },
  { id: 'def_s', name: '护甲', desc: '全体干员防御 +60', kind: 'mods', group: 'def', mods: { defFlat: 60 } },
  { id: 'def_m', name: '重甲', desc: '全体干员防御 +120', kind: 'mods', group: 'def', mods: { defFlat: 120 } },
  { id: 'res_s', name: '护符', desc: '全体干员法术抗性 +10', kind: 'mods', group: 'res', mods: { resFlat: 10 } },
  { id: 'res_m', name: '降临', desc: '全体干员法术抗性 +20', kind: 'mods', group: 'res', mods: { resFlat: 20 } },
  { id: 'spd_s', name: '轻装', desc: '全体干员攻速 +6%', kind: 'mods', group: 'spd', mods: { batPct: -0.06 } },
  { id: 'spd_m', name: '狂风', desc: '全体干员攻速 +15%', kind: 'mods', group: 'spd', mods: { batPct: -0.15 } },
  { id: 'dmg_s', name: '振幅', desc: '全体干员造成伤害 +6%', kind: 'mods', group: 'dmg', mods: { dmgDealtMul: 1.06 } },
  { id: 'dmg_m', name: '凿穿', desc: '全体干员造成伤害 +12%', kind: 'mods', group: 'dmg', mods: { dmgDealtMul: 1.12 } },
  { id: 'taken_s', name: '避锋', desc: '全体干员受到伤害 -6%', kind: 'mods', group: 'taken', mods: { dmgTakenMul: 0.94 } },
  { id: 'taken_m', name: '坚守', desc: '全体干员受到伤害 -12%', kind: 'mods', group: 'taken', mods: { dmgTakenMul: 0.88 } },
  { id: 'regen_s', name: '恢复', desc: '全体干员每秒回复 40 生命', kind: 'mods', group: 'regen', mods: { hpRegen: 40 } },
  { id: 'regen_m', name: '治愈', desc: '全体干员每秒回复 80 生命', kind: 'mods', group: 'regen', mods: { hpRegen: 80 } },
  { id: 'sp_s', name: '节奏', desc: '全体干员技力回复 +0.15/秒', kind: 'mods', group: 'sp', mods: { spRecoveryFlat: 0.15 } },
  { id: 'sp_m', name: '澎湃', desc: '全体干员技力回复 +0.3/秒', kind: 'mods', group: 'sp', mods: { spRecoveryFlat: 0.3 } },
  { id: 'block', name: '阵列', desc: '全体干员阻挡数 +1', kind: 'mods', group: 'block', mods: { blockCnt: 1 } },
  { id: 'defpen', name: '破甲', desc: '全体干员无视 80 点防御', kind: 'mods', group: 'pen', mods: { defIgnoreFlat: 80 } },
  { id: 'respen', name: '穿透', desc: '全体干员无视 10 点法抗', kind: 'mods', group: 'pen', mods: { resIgnoreFlat: 10 } },
  { id: 'rng', name: '远程', desc: '全体干员攻击范围延伸 1 格', kind: 'mods', group: 'range', mods: { rangeExtend: 1 } },
  { id: 'tgt', name: '多目标', desc: '全体干员最大目标数 +1', kind: 'mods', group: 'range', mods: { maxTargets: 1 } },
  { id: 'gold_s', name: '余利', desc: '结算资金 +8%', kind: 'coin', group: 'coin', coinMul: 1.08 },
  { id: 'gold_m', name: '商运', desc: '结算资金 +15%', kind: 'coin', group: 'coin', coinMul: 1.15 },
  { id: 'fund_s', name: '应急包', desc: '立刻获得 12 资金', kind: 'fund', group: 'fund', funds: 12 },
  { id: 'refresh_s', name: '机变', desc: '立刻获得 1 次免费刷新', kind: 'fund', group: 'refresh', funds: 0, freeRefresh: 1 },
  { id: 'bigfund', name: '深渊源泉', desc: '立刻获得 45 资金', kind: 'fund', group: 'fund', funds: 45 },
  { id: 'bigrefresh', name: '时之沙漏', desc: '立刻获得 2 次免费刷新', kind: 'fund', group: 'refresh', funds: 0, freeRefresh: 2 },

  // —— 全队回复生命（2026-11-05）：一次性、数值刻意做小 ——
  // 生命（LP）一格是「一次漏怪抵扣 1 点、每回合最多扣 lpCapPerRound(10)」的量级，
  // 所以这里只给 2–8 点：够救一次失误，不够把深渊的漏怪抹平。
  // 四档分开写而不是「随机数值」，是为了让三选一里能同时出现两种不同档位。
  { id: 'heal_xs', name: '绷带', desc: '立刻让全队回复 2 点生命（不超过上限）', kind: 'heal', group: 'heal', healLp: 2 },
  { id: 'heal_s', name: '急救', desc: '立刻让全队回复 3 点生命（不超过上限）', kind: 'heal', group: 'heal', healLp: 3 },
  { id: 'heal_m', name: '支援', desc: '立刻让全队回复 6 点生命（不超过上限）', kind: 'heal', group: 'heal', healLp: 6 },
  { id: 'heal_l', name: '战地医疗', desc: '立刻让全队回复 8 点生命（不超过上限）', kind: 'heal', group: 'heal', healLp: 8 },

  // —— 消除诅咒（2026-11-05）——
  // 只能清掉**对局中累积**的诅咒（`echoCurseIds`：挑战关失败降下的「侵蚀」等）。
  // 奇迹·诅咒 / 远见·诅咒是深渊的固定限制（`_echoCurses()` 里的两条），**永远消不掉** ——
  // 否则「免费刷新上限」「按层给钱到 999 层」会随着祝福一起被洗掉，等于没有诅咒。
  { id: 'cleanse', name: '净化', desc: '立刻移除 1 层诅咒（固定的奇迹 / 远见不受影响）', kind: 'cleanse', group: 'cleanse', curseRemove: 1 },
  { id: 'cleanse_all', name: '涤罪', desc: '立刻移除所有累积的诅咒（固定的奇迹 / 远见不受影响）', kind: 'cleanse', group: 'cleanse', curseRemove: 'all' },

  // —— 对敌方上异常（2026-11-05）：敌人**生成时**按概率挂上持续 debuff ——
  { id: 'frostbite', name: '寒冻', group: 'debuff', kind: 'mods',
    desc: '40% 的敌人移动速度 -40%',
    enemyDebuff: { chance: 0.4, mods: { moveMul: 1.4 }, tag: 'frost' } },
  { id: 'vulnerable', name: '易伤', group: 'debuff', kind: 'mods',
    desc: '35% 的敌人受到伤害 +15%',
    enemyDebuff: { chance: 0.35, mods: { dmgTakenMul: 0.85 }, tag: 'vuln' } },
]);

/** 按 id 取祝福。 */
export const echoBlessingById = (id) => ECHO_BLESSINGS.find((b) => b.id === id) || null;

/**
 * 到第 `round` 回合为止**应该已经拿到几个**祝福。
 *
 * 规则：深潜第 5、10、15… 个回合各一次（`depth % 5 === 0`），外加开局奖励次数 `bonus`（打过隐藏核心 = 1）。
 * 封顶 3（三个祝福拿完就不再发，避免无限叠）。
 *
 * @param {number} round 显示回合
 * @param {number} diveStart 深潜第一回合
 * @param {number} [bonus] 开局奖励次数（隐藏核心通关 = 1）
 * @returns {number} 应有的祝福总数（0..3）
 */
export function echoBlessingDue(round, diveStart, bonus = 0, max = ECHO_BLESSING_MAX) {
  const first = Math.max(1, Math.floor(Number(diveStart) || 1));
  const r = Math.floor(Number(round) || 0);
  const depth = r - first + 1;
  if (!Number.isFinite(depth) || depth < 1) return 0;
  const b = Math.max(0, Math.floor(Number(bonus) || 0));
  // 维护者 2026-11-04：**第 1 层就给一次**（进深潜就有选择），之后仍然是每 5 层一次。
  // 所以 1–4 层 = 1，10 层 = 2，15 层 = 3（封顶 3）。
  const every = Math.max(1, Math.floor(depth / ECHO_BLESSING_EVERY));
  // max 可被诅咒（「静默」）压低；不传就是常规上限 3。
  const cap = Math.max(0, Math.floor(Number(max) || ECHO_BLESSING_MAX));
  return Math.min(cap, b + every);
}

/**
 * 本次三选一的候选：从**还没拿过**的祝福里抽最多 3 个（不足 3 个时给剩下的全部）。
 *
 * 用独立种子流（调用方传 `deriveSeed(seed, 'echo:bless:<round>')`），不消耗商店 / 波次 / 战斗的随机数。
 *
 * @param {() => number} rng [0,1) 随机源
 * @param {string[]} [owned] 已拥有的祝福 id
 * @returns {Array<typeof ECHO_BLESSINGS[number]>} 候选（可能为空 = 三个都拿过了）
 */
export function echoBlessingOffer(rng, owned = []) {
  const have = new Set(Array.isArray(owned) ? owned : []);
  const pool = ECHO_BLESSINGS.filter((b) => !have.has(b.id) && b.disabled !== true);
  const out = [];
  while (pool.length && out.length < 3) {
    const at = Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length));
    out.push(pool.splice(at, 1)[0]);
  }
  return out;
}

/**
 * 已拥有祝福合并出来的玩家单位 mods（加法语义：两个 batPct 会相加，但同类不叠加所以最多一份）。
 * @param {string[]} ids
 * @returns {object} 空对象 = 没有加成
 */
export function echoBlessingMods(ids) {
  const out = {};
  for (const id of Array.isArray(ids) ? ids : []) {
    const b = echoBlessingById(id);
    if (!b || b.kind !== 'mods' || !b.mods) continue;
    for (const [k, v] of Object.entries(b.mods)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/**
 * 已拥有祝福的资金倍率（`coin` 类相乘；没有就是 1）。
 * @param {string[]} ids
 */
export function echoBlessingCoinMul(ids) {
  let mul = 1;
  for (const id of Array.isArray(ids) ? ids : []) {
    const b = echoBlessingById(id);
    if (!b || b.kind !== 'coin' || !(b.coinMul > 0)) continue;
    mul *= b.coinMul;
  }
  return mul;
}

/**
 * 拿到这个祝福时一次性发放的资金（`fund` 类；其它返回 0）。
 * @param {typeof ECHO_BLESSINGS[number]} b
 */
export const echoBlessingFunds = (b) => (b && b.kind === 'fund' && b.funds > 0 ? Math.trunc(b.funds) : 0);

/**
 * 拿到这个祝福时一次性回复的生命（`heal` 类；其它返回 0）。
 * 数值由调用方封顶到玩家自己的初始生命（`gd.startLp`），这里只负责给出「该回多少」。
 * @param {typeof ECHO_BLESSINGS[number]} b
 */
export const echoBlessingHeal = (b) => (b && b.kind === 'heal' && b.healLp > 0 ? Math.trunc(b.healLp) : 0);

/**
 * 拿到这个祝福时一次性移除几层诅咒（`cleanse` 类；其它返回 0，'all' 返回 Infinity）。
 *
 * ⚠ 只作用于 `echoCurseIds`（对局中累积的诅咒）。奇迹·诅咒 / 远见·诅咒是 `_echoCurses()` 里写死的
 * 固定限制，不在这个列表里，所以这个函数天然清不掉它们 —— 这是设计，不要为了让「净化」更强去改。
 * @param {typeof ECHO_BLESSINGS[number]} b
 */
export function echoBlessingCurseRemove(b) {
  if (!b || b.kind !== 'cleanse') return 0;
  if (b.curseRemove === 'all') return Infinity;
  return Math.max(0, Math.trunc(Number(b.curseRemove) || 0));
}

/**
 * 给一个己方单位挂上祝福的 mods buff（幂等：同一个 key 只挂一次）。
 *
 * @param {{ addBuff: Function }} battle
 * @param {any} unit 己方单位
 * @param {object} mods `echoBlessingMods` 的结果
 * @returns {boolean} 是否真的挂上去了
 */
export function applyEchoBlessingMods(battle, unit, mods) {
  if (!battle || typeof battle.addBuff !== 'function' || !unit || !mods) return false;
  const keys = Object.keys(mods);
  if (!keys.length) return false;
  const key = `${ECHO_BLESSING_PREFIX}mods`;
  if ((unit.buffs || []).some((x) => x && x.key === key)) return false;
  battle.addBuff(unit, { key, name: '疾风', desc: '攻速 +10%', mods: { ...mods }, persist: true, visible: true });
  return true;
}
