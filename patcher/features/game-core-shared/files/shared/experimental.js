// Room-owned experimental rules are snapshotted at launch, never player votes.
import { MAX_SEATS } from './constants.js';
import { isPlayerCapacity, roomCapacity } from './playerCapacity.js';

export const EXPERIMENTAL_DEFAULTS = Object.freeze({ revivalEnabled: false, disableSharedPool: false });
/**
 * Optional booleans: absent when off, so an ordinary room, a saved room and a queue key keep their old shape.
 * `allowRepeat` / `stackDuckLord` are this server's own expanded-room flags (并发草稿 / 鸭爵叠加);
 * `disableLayerCap` / `disableHitLimit` are the battle-rule flags ported from the other fork (2026-11-01).
 * @type {ReadonlySet<string | symbol>}
 */
const OPTIONAL_FLAGS = new Set(['disableDuckLord', 'disableLayerCap', 'disableHitLimit', 'allowRepeat', 'stackDuckLord']);
/**
 * The enemy multipliers a room can pick (反馈 #47); the first, a standard room's, is never stored: an ordinary room,
 * a saved room and a queue key keep their old shape. Applies to every enemy, the leaders' shared HP included.
 */
export const ENEMY_MULTIPLIERS = Object.freeze([1, 1.25, 1.5, 2, 3, 5]);
export const isEnemyMultiplier = (value) => ENEMY_MULTIPLIERS.includes(value);
/** @type {ReadonlySet<string | symbol>} */
const OPTIONAL_MULTIPLIERS = new Set(['enemyHpMul', 'enemyAtkMul']);
const enemyMultiplier = (value) => (isEnemyMultiplier(value) ? value : 1);

/** The most keys a valid set can carry: 2 defaults + playerCapacity + 5 optional flags + 2 multipliers. */
const MAX_KEYS = 2 + 1 + OPTIONAL_FLAGS.size + OPTIONAL_MULTIPLIERS.size;

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
    if (OPTIONAL_MULTIPLIERS.has(key)) return isEnemyMultiplier(descriptor.value);
    return OPTIONAL_FLAGS.has(key) && typeof descriptor.value === 'boolean';
  });
}

/** @param {{ revivalEnabled: boolean, disableSharedPool: boolean, playerCapacity?: number, disableDuckLord?: boolean,
 *   allowRepeat?: boolean, stackDuckLord?: boolean, disableLayerCap?: boolean, disableHitLimit?: boolean,
 *   enemyHpMul?: number, enemyAtkMul?: number }} [value] */
export function experimentalOptions(value = EXPERIMENTAL_DEFAULTS) {
  if (!isExperimental(value)) throw new TypeError('invalid experimental options');
  const capacity = roomCapacity('coop', value);
  return Object.freeze({ revivalEnabled: value.revivalEnabled, disableSharedPool: value.disableSharedPool,
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
    ...(enemyMultiplier(value.enemyHpMul) !== 1 ? { enemyHpMul: value.enemyHpMul } : {}),
    ...(enemyMultiplier(value.enemyAtkMul) !== 1 ? { enemyAtkMul: value.enemyAtkMul } : {}) });
}

const duckLordDisabled = (value) => roomCapacity('coop', value) > MAX_SEATS && value.disableDuckLord === true;
const repeatAllowed = (value) => roomCapacity('coop', value) > MAX_SEATS && value.allowRepeat === true;
const duckLordStacked = (value) => repeatAllowed(value) && value.stackDuckLord === true;
export const experimentalKey = (value) => {
  const key = `${value.revivalEnabled ? 1 : 0}${value.disableSharedPool ? 1 : 0}`;
  const capacity = roomCapacity('coop', value);
  const legacy = capacity === MAX_SEATS ? key : `${key}:${capacity}`;
  const hp = enemyMultiplier(value.enemyHpMul), atk = enemyMultiplier(value.enemyAtkMul);
  return `${legacy}${duckLordDisabled(value) ? ':duck' : ''}${repeatAllowed(value) ? ':repeat' : ''}${duckLordStacked(value) ? ':stack' : ''}`
    + `${value.disableLayerCap === true ? ':layers' : ''}${value.disableHitLimit === true ? ':hits' : ''}`
    + `${hp !== 1 ? `:hp${hp}` : ''}${atk !== 1 ? `:atk${atk}` : ''}`;
};
export const sameExperimental = (a, b) => !!a && !!b
  && a.revivalEnabled === b.revivalEnabled && a.disableSharedPool === b.disableSharedPool
  && roomCapacity('coop', a) === roomCapacity('coop', b)
  && duckLordDisabled(a) === duckLordDisabled(b)
  && repeatAllowed(a) === repeatAllowed(b)
  && duckLordStacked(a) === duckLordStacked(b)
  && (a.disableLayerCap === true) === (b.disableLayerCap === true)
  && (a.disableHitLimit === true) === (b.disableHitLimit === true)
  && enemyMultiplier(a.enemyHpMul) === enemyMultiplier(b.enemyHpMul)
  && enemyMultiplier(a.enemyAtkMul) === enemyMultiplier(b.enemyAtkMul);
