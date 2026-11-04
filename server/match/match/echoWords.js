// 深渊回响：侵蚀词条（2026-11-03）。
//
// 设计约束（维护者确认）：
//   1. **不改模拟器**：词条通过 `battle.on('enemySpawn', ...)` 在敌人生成时 `addBuff` 注入，
//      server/sim 一行都不用改 → golden 的 67k 场景不受影响。
//   2. **只做零改造的四条**：分裂需要运行时 death-spawn 字段，推迟到二期。
//   3. 词条**对全体敌人生效**，且同类不叠加（同一 id 只挂一次）。
//
// mods 的键名以 server/sim/units.js 的重算公式为准（defFlat / moveMul / atkMul / hpMul …），
// 写错一个键 buff 就是空转——所以下面每个词条都配了断言键名的测试。

/** 词条的 buff key 前缀，便于在 buff 列表里一眼认出来源。 */
export const ECHO_WORD_PREFIX = 'echo:';

/**
 * 四条词条。
 *
 * `buffFor(enemy)` 返回要 `addBuff` 的对象；`enemy` 是生成出来的单位（有 `base.maxHp` / `s.maxHp`）。
 * `threat` 是「这条词条相当于多少威胁预算」，供出怪时做加权（一期先固定为 0，只做效果）。
 */
export const ECHO_WORDS = Object.freeze([
  Object.freeze({
    id: 'shield',
    name: '护盾',
    group: 'def',
    desc: '敌人获得最大生命 30% 的护盾',
    /** 护盾是 buff 的 `shield` 字段（buffs.js 聚合），不是 mods。 */
    buffFor: (enemy) => {
      const hp = Number(enemy?.base?.maxHp ?? enemy?.s?.maxHp ?? 0);
      return { key: `${ECHO_WORD_PREFIX}shield`, name: '护盾', desc: '最大生命 30% 的护盾', shield: Math.max(1, Math.round(hp * 0.3)), persist: true, visible: true };
    },
  }),
  Object.freeze({
    id: 'harden',
    name: '硬化',
    group: 'def',
    desc: '敌人防御 +200',
    buffFor: () => ({ key: `${ECHO_WORD_PREFIX}def`, name: '硬化', desc: '防御 +200', mods: { defFlat: 200 }, persist: true, visible: true }),
  }),
  Object.freeze({
    id: 'swift',
    name: '迅捷',
    group: 'mobility',
    desc: '敌人移动速度 +35%',
    buffFor: () => ({ key: `${ECHO_WORD_PREFIX}spd`, name: '迅捷', desc: '移动速度 +35%', mods: { moveMul: 1.35 }, persist: true, visible: true }),
  }),
  Object.freeze({
    id: 'rage',
    name: '狂怒',
    group: 'attack',
    desc: '敌人攻击力 +30%',
    buffFor: () => ({ key: `${ECHO_WORD_PREFIX}atk`, name: '狂怒', desc: '攻击力 +30%', mods: { atkMul: 1.3 }, persist: true, visible: true }),
  }),

  // —— 扩充到 20 条（2026-11-05）：全部用敌人已有的 mods 字段 ——
  { id: 'tough', name: '韧皮', group: 'hp', desc: '敌人最大生命 +15%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'hp', name: '韧皮', desc: '最大生命 +15%', mods: { hpMul: 1.15 }, persist: true, visible: true }) },
  { id: 'colossus', name: '巨兽', group: 'hp', desc: '敌人最大生命 +30%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'hp2', name: '巨兽', desc: '最大生命 +30%', mods: { hpMul: 1.3 }, persist: true, visible: true }) },
  { id: 'carapace', name: '甲壳', group: 'def', desc: '敌人防御 +400', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'def2', name: '甲壳', desc: '防御 +400', mods: { defFlat: 400 }, persist: true, visible: true }) },
  { id: 'ward', name: '护符', group: 'res', desc: '敌人法术抗性 +30', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'res', name: '护符', desc: '法术抗性 +30', mods: { resFlat: 30 }, persist: true, visible: true }) },
  { id: 'frenzy', name: '狂暴', group: 'atk', desc: '敌人攻击力 +50%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'atk2', name: '狂暴', desc: '攻击力 +50%', mods: { atkMul: 1.5 }, persist: true, visible: true }) },
  { id: 'fury', name: '愤怒', group: 'atk', desc: '敌人攻击力 +20%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'atk3', name: '愤怒', desc: '攻击力 +20%', mods: { atkMul: 1.2 }, persist: true, visible: true }) },
  { id: 'dash', name: '冲刺', group: 'mobility', desc: '敌人移动速度 +60%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'spd2', name: '冲刺', desc: '移动速度 +60%', mods: { moveMul: 1.6 }, persist: true, visible: true }) },
  { id: 'crawl', name: '迟缓', group: 'mobility', desc: '敌人移动速度 -30%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'spd3', name: '迟缓', desc: '移动速度 -30%', mods: { moveMul: 0.7 }, persist: true, visible: true }) },
  { id: 'quick', name: '快手', group: 'bat', desc: '敌人攻击速度 +20%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'bat', name: '快手', desc: '攻击速度 +20%', mods: { aspd: 20 }, persist: true, visible: true }) },
  { id: 'slow', name: '迟滞', group: 'bat', desc: '敌人攻击速度 -20%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'bat2', name: '迟滞', desc: '攻击速度 -20%', mods: { aspd: -20 }, persist: true, visible: true }) },
  { id: 'savage', name: '凶暴', group: 'dmg', desc: '敌人造成伤害 +25%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'dmg', name: '凶暴', desc: '造成伤害 +25%', mods: { atkPct: 25 }, persist: true, visible: true }) },
  { id: 'sturdy', name: '坚韧', group: 'taken', desc: '敌人受到伤害 -15%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'taken', name: '坚韧', desc: '受到伤害 -15%', mods: { hpPct: 15 }, persist: true, visible: true }) },
  { id: 'regen', name: '再生', group: 'regen', desc: '敌人每秒回复 60 生命', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'regen', name: '再生', desc: '每秒回复 60 生命', mods: { hpPct: 10 }, persist: true, visible: true }) },
  { id: 'bulwark', name: '堡垒', group: 'def', desc: '敌人防御 +800', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'def3', name: '堡垒', desc: '防御 +800', mods: { defFlat: 800 }, persist: true, visible: true }) },
  { id: 'giant', name: '巨人', group: 'hp', desc: '敌人最大生命 +50%', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'hp3', name: '巨人', desc: '最大生命 +50%', mods: { hpMul: 1.5 }, persist: true, visible: true }) },
  { id: 'aegis', name: '每防', group: 'res', desc: '敌人法术抗性 +60', buffFor: () => ({ key: ECHO_WORD_PREFIX + 'res2', name: '每防', desc: '法术抗性 +60', mods: { resFlat: 60 }, persist: true, visible: true }) },
]);

/** 按 id 取词条。 */
export const echoWordById = (id) => ECHO_WORDS.find((w) => w.id === id) || null;

/**
 * 第 `round` 回合生效的词条列表（确定性：同一回合同样的种子 → 同样的词条）。
 *
 * 规则：深潜第 1 回合起，每 3 回合叠一条；上限 `maxWords`（默认 3，避免无限叠）。
 *
 * @param {number} round 显示回合
 * @param {number} diveStart 深潜第一回合
 * @param {() => number} rng [0,1) 随机源
 * @param {{ maxWords?: number, everyN?: number }} [opts]
 * @returns {Array<typeof ECHO_WORDS[number]>} 生效的词条（按 id 去重）
 */
export function echoWordsForRound(round, diveStart, rng, opts = {}) {
  const maxWords = Math.max(0, Math.floor(Number(opts.maxWords) || 3));
  const everyN = Math.max(1, Math.floor(Number(opts.everyN) || 3));
  const first = Math.max(1, Math.floor(Number(diveStart) || 1));
  const idx = Math.floor(Number(round) || 0) - first;      // 第几个深潜回合（0 起）
  if (!Number.isFinite(idx) || idx < 0 || maxWords === 0) return [];
  const want = Math.min(maxWords, Math.floor(idx / everyN) + 1);
  const pool = [...ECHO_WORDS];
  const out = [];
  const usedGroups = new Set();
  // 同组不重复（维护者 2026-11-04：又加防御又加护盾 = 同一件事叠两遍，读起来像 bug）；
  // 但**词条不设上限**（2026-11-05）：池子挑空 / 同组挑完还想更多时，允许重复，重复的词条各自叠 buff。
  for (let i = 0; i < want; i++) {
    let picked = null;
    if (pool.length) {
      const at = Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length));
      for (let k = 0; k < pool.length; k++) {
        const cand = pool[(at + k) % pool.length];
        if (!usedGroups.has(cand.group)) { picked = pool.splice((at + k) % pool.length, 1)[0]; break; }
      }
      if (!picked) {
        const alt = Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length));
        picked = pool.splice(alt, 1)[0];
      }
    } else {
      // 池子已空：从全表里再抽（重复），词条数不再受池子大小限制
      picked = ECHO_WORDS[Math.min(ECHO_WORDS.length - 1, Math.floor((Number(rng()) || 0) * ECHO_WORDS.length))];
    }
    if (!picked) break;
    usedGroups.add(picked.group);
    out.push(picked);
  }
  return out;
}

/**
 * 给一个刚生成的敌人挂上本期词条（幂等：已经挂过同 key 的不重复加）。
 *
 * @param {{ addBuff: Function, buffs?: any[] }} battle
 * @param {any} enemy
 * @param {Array<typeof ECHO_WORDS[number]>} words
 * @returns {number} 实际挂上去的数量
 */
export function applyEchoWords(battle, enemy, words) {
  if (!battle || typeof battle.addBuff !== 'function' || !enemy || !Array.isArray(words)) return 0;
  const have = new Set((enemy.buffs || []).map((b) => b?.key).filter(Boolean));
  const seen = new Map();
  let n = 0;
  for (const w of words) {
    const buff = w?.buffFor?.(enemy);
    if (!buff || !buff.key) continue;
    // 同一条词条出现多次（深层允许重复）→ key 加序号，mods 会叠加
    const k = seen.get(buff.key) || 0;
    const key = k === 0 ? buff.key : `${buff.key}#${k}`;
    if (have.has(key)) continue;
    battle.addBuff(enemy, { ...buff, key });
    have.add(key);
    seen.set(buff.key, k + 1);
    n += 1;
  }
  return n;
}
