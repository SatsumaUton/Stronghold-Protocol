// Room-owned experimental rules are snapshotted at launch, never player votes.
import { MAX_SEATS } from './constants.js';
import { isPlayerCapacity, roomCapacity } from './playerCapacity.js';
import { canonicalPoolPlan, isPoolPlan } from './poolPlan.js';

// 维护者 2026-11-05：救援（10 血换 1 血）**默认开启**，并且不再要求进入联防。
export const EXPERIMENTAL_DEFAULTS = Object.freeze({ revivalEnabled: false, disableSharedPool: false });
/**
 * Optional booleans: absent when off, so an ordinary room, a saved room and a queue key keep their old shape.
 * `allowRepeat` / `stackDuckLord` are this server's own expanded-room flags (并发草稿 / 鸭爵叠加);
 * `disableLayerCap` / `disableHitLimit` are the battle-rule flags ported from the other fork (2026-11-01).
 * @type {ReadonlySet<string | symbol>}
 */
// 
// revivalAnyDonor：救援不要求联防（维护者 2026-11-05，默认 true）—— 必须在这里登记，
// 否则 isExperimental 会把它判成非法键，导致**断点恢复对局失败**（invalid experimental options）。
const OPTIONAL_FLAGS = new Set(['disableDuckLord', 'disableLayerCap', 'disableHitLimit', 'allowRepeat', 'stackDuckLord', 'revivalAnyDonor', 'uniteHumansFirst']);
/**
 * The enemy multipliers a room can pick (反馈 #47); the first, a standard room's, is never stored: an ordinary room,
 * a saved room and a queue key keep their old shape. Applies to every enemy, the leaders' shared HP included.
 */
export const ENEMY_MULTIPLIERS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10]);
export const isEnemyMultiplier = (value) => ENEMY_MULTIPLIERS.includes(value);
/** @type {ReadonlySet<string | symbol>} */
const OPTIONAL_MULTIPLIERS = new Set(['enemyHpMul', 'enemyAtkMul', 'bossHpMul', 'bossAtkMul']);
const enemyMultiplier = (value) => (isEnemyMultiplier(value) ? value : 1);

/** The most keys a valid set can carry: 2 defaults + playerCapacity + 5 optional flags + 2 multipliers + poolPlan. */
const MAX_KEYS = 2 + 1 + OPTIONAL_FLAGS.size + OPTIONAL_MULTIPLIERS.size + 1;

export function isExperimental(value) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length < 2 || keys.length > MAX_KEYS) return false;
  for (const key of Object.keys(EXPERIMENTAL_DEFAULTS)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || typeof descriptor.value !== 'boolean') return false;
  }
  return keys.every((key) => {
    if (Object.hasOwn(EXPERIMENTAL_DEFAULTS, key)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true) return false;
    if (key === 'playerCapacity') return isPlayerCapacity(descriptor.value);
    // 手动指定卡池编组：每个座位一个卡池号，长度必须等于房间容量
    if (key === 'poolPlan') return isPoolPlan(descriptor.value, roomCapacity('coop', value));
    if (OPTIONAL_MULTIPLIERS.has(key)) return isEnemyMultiplier(descriptor.value);
    if (key === 'enemyHpPlan') return isEnemyHpPlan(descriptor.value);
    if (key === 'enemyAtkPlan') return isEnemyAtkPlan(descriptor.value);
    return OPTIONAL_FLAGS.has(key) && typeof descriptor.value === 'boolean';
  });
}

/** @param {{ revivalEnabled: boolean, disableSharedPool: boolean, playerCapacity?: number, disableDuckLord?: boolean,
 *   allowRepeat?: boolean, stackDuckLord?: boolean, disableLayerCap?: boolean, disableHitLimit?: boolean,
 *   enemyHpMul?: number, enemyAtkMul?: number, poolPlan?: readonly number[] }} [value]
 *   `poolPlan`: 手动指定卡池编组，每个座位一个卡池号（shared/poolPlan.js）。它已经把每个座位
 *   分到哪个池说清楚了，所以**取代** `disableSharedPool`（后者只是「每人不共享」的粗粒度开关）。 */
export function experimentalOptions(value = EXPERIMENTAL_DEFAULTS) {
  if (!isExperimental(value)) throw new TypeError('invalid experimental options');
  const capacity = roomCapacity('coop', value);
  // 维护者 2026-11-05：救援默认开启，且不要求进入联防（revivalAnyDonor 只是行为开关，不写进 DTO）。
  // 一旦写进输出，旧进程的校验器会把自己的产物判成非法（2026-11-05：所有房间 new Match 抛错、开不了局）。
  return Object.freeze({ revivalEnabled: value.revivalEnabled === true,
    disableSharedPool: value.disableSharedPool && !value.poolPlan,
    ...(capacity === MAX_SEATS ? {} : { playerCapacity: capacity }),
    // Optional and false by default: ordinary rooms and legacy DTOs keep their two-flag shape.
    ...(capacity > MAX_SEATS && value.disableDuckLord === true ? { disableDuckLord: true } : {}),
    // Always present on expanded rooms so the client can distinguish a supported (false)
    // toggle from an older node that has no repeat-strategy feature at all.
    ...(capacity > MAX_SEATS ? { allowRepeat: value.allowRepeat === true } : {}),
    // 鸭爵叠加（本服新增）：没有「允许重复选择策略」就无从谈起——去重开着时一支队伍只可能有一个鸭爵。
    ...(capacity > MAX_SEATS && value.allowRepeat === true ? { stackDuckLord: value.stackDuckLord === true } : {}),
    // Any mode, any capacity: these change battle rules, not seats.
    ...(value.disableLayerCap === true ? { disableLayerCap: true } : {}),
    ...(value.disableHitLimit === true ? { disableHitLimit: true } : {}),
    // 【AI 联防置后】(维护者 2026-11-06)：联防优先真人，AI 队友 / 托管中的博士排后
    ...(value.uniteHumansFirst === true ? { uniteHumansFirst: true } : {}),
    ...hpOption(value),
    ...atkOption(value),
    ...bossOptions(value),
    ...(enemyMultiplier(value.enemyAtkMul) !== 1 ? { enemyAtkMul: value.enemyAtkMul } : {}),
    // 手动指定卡池编组：规范化后冻结（卡池按首次出现的顺序从 0 编号）
    ...(value.poolPlan ? { poolPlan: Object.freeze(canonicalPoolPlan(value.poolPlan)) } : {}) });
}

const duckLordDisabled = (value) => roomCapacity('coop', value) > MAX_SEATS && value.disableDuckLord === true;
const repeatAllowed = (value) => roomCapacity('coop', value) > MAX_SEATS && value.allowRepeat === true;
const duckLordStacked = (value) => repeatAllowed(value) && value.stackDuckLord === true;
/** 卡池编组的 key：同一套布局（不论编号）得到同一个字符串；没有编组时为空串。 */
const planKey = (value) => (value.poolPlan ? canonicalPoolPlan(value.poolPlan).join() : '');
export const experimentalKey = (value) => {
  const key = `${value.revivalEnabled ? 1 : 0}${value.disableSharedPool ? 1 : 0}`;
  const capacity = roomCapacity('coop', value);
  const legacy = capacity === MAX_SEATS ? key : `${key}:${capacity}`;
  const hp = enemyMultiplier(value.enemyHpMul), atk = enemyMultiplier(value.enemyAtkMul);
  return `${legacy}${duckLordDisabled(value) ? ':duck' : ''}${repeatAllowed(value) ? ':repeat' : ''}${duckLordStacked(value) ? ':stack' : ''}`
    + `${value.disableLayerCap === true ? ':layers' : ''}${value.disableHitLimit === true ? ':hits' : ''}${value.uniteHumansFirst === true ? ':unitehuman' : ''}`
    + `${hpKey(value) ? ':' + hpKey(value) : ''}${bossKey(value)}${atkKey(value) ? ':' + atkKey(value) : ''}`
    + `${value.poolPlan ? `:plan${planKey(value)}` : ''}`;
};
export const sameExperimental = (a, b) => !!a && !!b
  && a.revivalEnabled === b.revivalEnabled && a.disableSharedPool === b.disableSharedPool
  && roomCapacity('coop', a) === roomCapacity('coop', b)
  && duckLordDisabled(a) === duckLordDisabled(b)
  && repeatAllowed(a) === repeatAllowed(b)
  && duckLordStacked(a) === duckLordStacked(b)
  && (a.disableLayerCap === true) === (b.disableLayerCap === true)
  && (a.disableHitLimit === true) === (b.disableHitLimit === true)
  && (a.uniteHumansFirst === true) === (b.uniteHumansFirst === true)
  && hpKey(a) === hpKey(b) && atkKey(a) === atkKey(b) && bossKey(a) === bossKey(b)
  && enemyMultiplier(a.enemyAtkMul) === enemyMultiplier(b.enemyAtkMul)
  && planKey(a) === planKey(b);

/**
 * Whether a room's options change a rule of the game, whatever the seat count: any key but
 * playerCapacity that is set (an option that is off is false or absent, see experimentalOptions).
 * 多人匹配's rules scope reads it (server/matchmaking.js): a lone ticket asking 'standard' only
 * makes a game whose rules are all unchanged, so this is what tells the two apart.
 */
export const experimentalRuleChanged = (value) => !!value
  && Object.entries(value).some(([key, set]) => key !== 'playerCapacity' && !!set);


// ── 按回合设置敌人生命倍率（参考版 feedback #118 移植，2026-11-06）────────────────────────────
// `enemyHpPlan` = [[fromRound, multiplier], …]：「从第 N 回合起 ×M」，第一段必须从 1 开始，最多 6 段，
// 倍率取自 ENEMY_MULTIPLIERS。整段都是同一个倍率时会退化成单个 enemyHpMul（canonicalEnemyHpPlan 返回 null）。
export const ENEMY_HP_PLAN_MAX = 6;
export const ENEMY_HP_PLAN_ROUND_MAX = 20;
export function isEnemyHpPlan(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > ENEMY_HP_PLAN_MAX) return false;
  let last = 0;
  for (let i = 0; i < value.length; i++) {
    const seg = value[i];
    if (!Array.isArray(seg) || seg.length !== 2) return false;
    const [from, mul] = seg;
    if (!Number.isInteger(from) || from < 1 || from > ENEMY_HP_PLAN_ROUND_MAX || (i === 0 ? from !== 1 : from <= last)) return false;
    if (!isEnemyMultiplier(mul)) return false;
    last = from;
  }
  return true;
}
export function canonicalEnemyHpPlan(value) {
  if (!isEnemyHpPlan(value) || value.every(([, mul]) => mul === value[0][1])) return null;
  return Object.freeze(value.map(([from, mul]) => Object.freeze([from, mul])));
}
const flatHpMul = (value) => (isEnemyHpPlan(value?.enemyHpPlan) && !canonicalEnemyHpPlan(value.enemyHpPlan) ? value.enemyHpPlan[0][1] : enemyMultiplier(value?.enemyHpMul));
const planAt = (plan, round) => {
  let mul = plan[0][1];
  for (const [from, m] of plan) if (round >= from) mul = m;
  return mul;
};
/** 某一回合该用多少敌人生命倍率（1 = 不变）：有计划取那一段，否则取单值。 */
export function enemyHpMulAt(options, round) {
  const plan = canonicalEnemyHpPlan(options?.enemyHpPlan);
  return plan ? planAt(plan, Number.isFinite(round) ? round : 1) : flatHpMul(options);
}
/** 生命规则的一个字符串表示：'' 无、hp<M> 单值、hpplan<from>x<M> 计划。 */
const hpKey = (value) => {
  const plan = canonicalEnemyHpPlan(value?.enemyHpPlan);
  if (plan) return 'hpplan' + plan.map(([from, mul]) => from + 'x' + mul).join();
  const hp = flatHpMul(value);
  return hp !== 1 ? 'hp' + hp : '';
};
/** 存库用的生命规则：有计划存计划，否则倍率≠1 存单值，否则不带键。 */
function hpOption(value) {
  const plan = canonicalEnemyHpPlan(value.enemyHpPlan);
  if (plan) return { enemyHpPlan: plan };
  const hp = flatHpMul(value);
  return hp !== 1 ? { enemyHpMul: hp } : {};
}

// ── 按回合设置敌人**攻击**倍率 + BOSS 独立倍率（维护者 2026-11-07）────────────────────────
export function isEnemyAtkPlan(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > ENEMY_HP_PLAN_MAX) return false;
  let last = 0;
  for (let i = 0; i < value.length; i++) {
    const seg = value[i];
    if (!Array.isArray(seg) || seg.length !== 2) return false;
    const [from, mul] = seg;
    if (!Number.isInteger(from) || from < 1 || from > ENEMY_HP_PLAN_ROUND_MAX || (i === 0 ? from !== 1 : from <= last)) return false;
    if (!isEnemyMultiplier(mul)) return false;
    last = from;
  }
  return true;
}
export function canonicalEnemyAtkPlan(value) {
  if (!isEnemyAtkPlan(value) || value.every(([, mul]) => mul === value[0][1])) return null;
  return Object.freeze(value.map(([from, mul]) => Object.freeze([from, mul])));
}
const flatAtkMul = (value) => (isEnemyAtkPlan(value?.enemyAtkPlan) && !canonicalEnemyAtkPlan(value.enemyAtkPlan) ? value.enemyAtkPlan[0][1] : enemyMultiplier(value?.enemyAtkMul));
/** 某一回合该用多少敌人攻击倍率（1 = 不变）。 */
export function enemyAtkMulAt(options, round) {
  const plan = canonicalEnemyAtkPlan(options?.enemyAtkPlan);
  return plan ? planAt(plan, Number.isFinite(round) ? round : 1) : flatAtkMul(options);
}
const atkKey = (value) => {
  const plan = canonicalEnemyAtkPlan(value?.enemyAtkPlan);
  if (plan) return 'atkplan' + plan.map(([from, mul]) => from + 'x' + mul).join();
  const atk = flatAtkMul(value);
  return atk !== 1 ? 'atk' + atk : '';
};
function atkOption(value) {
  const plan = canonicalEnemyAtkPlan(value.enemyAtkPlan);
  if (plan) return { enemyAtkPlan: plan };
  const atk = flatAtkMul(value);
  return atk !== 1 ? { enemyAtkMul: atk } : {};
}
/** BOSS（敌方领袖）单独的生命 / 攻击倍率；不设则跟全体倍率走。 */
const bossHpMul = (value) => enemyMultiplier(value?.bossHpMul);
const bossAtkMul = (value) => enemyMultiplier(value?.bossAtkMul);
export const bossMultipliers = (options) => ({ hp: bossHpMul(options), atk: bossAtkMul(options) });
const bossKey = (value) => {
  const h = bossHpMul(value), a = bossAtkMul(value);
  return (h !== 1 ? ':bosshp' + h : '') + (a !== 1 ? ':bossatk' + a : '');
};
function bossOptions(value) {
  const out = {};
  const h = bossHpMul(value), a = bossAtkMul(value);
  if (h !== 1) out.bossHpMul = h;
  if (a !== 1) out.bossAtkMul = a;
  return out;
}
