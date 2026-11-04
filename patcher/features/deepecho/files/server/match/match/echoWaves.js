// server/match/match/echoWaves.js — 「深渊回响」深潜的随机出怪（DESIGN-ABYSS.md「随机出怪与悬赏」）。
//
// **这个模式的所有出怪逻辑都收在本文件里**，`waves.js` 只留一个调用点。普通模式（独立模拟 / 同盟模拟）
// 不走这里 —— 那边 opts 里没有 `echoGrowth`，`echoRandomWave` 第一行就返回 null。
//
// 维护者 2026-11-03 定的口径（三次收敛后的最终版）：
//   1. **不照抄原版的出怪动作**：条数 / 怪种 / 数量 / 时间 / 路线全部随机；
//   2. **但参考原版的「形状」**：原版 1–13 回合实测 —— 动作数 3→28、敌人数 6→70（≈每回合 ×1.2）、
//      飞行占比稳定 45–55%、首怪 2–3 秒、末怪落在时限的 50–80%。下面用 `echoProfileFor()` 把这些数字
//      当场从模板里量出来，再按深度缩放，作为生成的目标形状；
//   3. **强度按回合增长**：数值缩放走 `opts.echoScale`（`gd.enemyScale(round)` → echoScale），
//      同一只怪在 R20 与 R40 的实战强度完全不同；
//   4. **精英有强度下限**：基础血量低于 `ECHO_ELITE_MIN_HP` 的怪永远不会被提升成精英；
//   5. **路线必须来自地图**：随机只在这张图真实存在的出兵口里选，否则敌人会走到不存在的路上。
//
// `waves.js` 里的敌人/预览辅助函数通过 `helpers` 注入（不 import），避免双向依赖。

import { pickWaveByBudget, ECHO_BUDGET_BASE, echoDeepWaveShape, ECHO_DEEP_FROM, ECHO_MAX_UNITS } from './echo.js';
import { crossRoundTemplates } from './echoCrossVersion.js';
export { ECHO_MAX_UNITS };

/** 精英候选的**基础血量下限**：低于这个值的怪不能被提升成精英（维护者 2026-11-03 定）。 */
export const ECHO_ELITE_MIN_HP = 3000;
/**
 * 低层可抽到的单个敌人**基础血量上限**（维护者 2026-11-04：第 2 层出 2 万血的奇美拉 = 打不过）。
 * 实际上限 = `ECHO_LOW_TIER_HP_CAP × ECHO_LOW_TIER_STEP^(深度−1)`：
 * 1 层 3000、5 层约 1 万、10 层约 4.7 万、15 层约 20 万 —— 深层自然把整个池子放开。
 */
export const ECHO_LOW_TIER_HP_CAP = 3000;
export const ECHO_LOW_TIER_STEP = 1.35;
/** 出怪量按资金调整：期望资金 = BASE + PER_DEPTH × 深度（维护者 2026-11-04 的“按钱出怪”）。 */
export const ECHO_FUND_BASE = 20;
export const ECHO_FUND_PER_DEPTH = 6;
/** 单回合最多几条出怪指令（原版 R12 实测 28，这里留余量）。 */
export const ECHO_MAX_ACTIONS = 28;
/** 单回合至少几条出怪指令。 */
export const ECHO_MIN_ACTIONS = 3;
/** 每深 1 层，出怪动作数相对原版的增幅（0.05 = +5%/层）。 */
export const ECHO_ACTIONS_DEPTH_STEP = 0.05;
/** 每深 1 层，敌人总数相对原版的增幅（0.06 = +6%/层）。 */
export const ECHO_UNITS_DEPTH_STEP = 0.06;
/** 16 层以后，一波铺进时限的哪一段：末怪落在时限的 36%（原版 R13 的比例：82 / 230 秒）。 */
export const ECHO_DEEP_SPAN_RATIO = 0.36;
/**
 * 单条出怪指令最多放几只。
 *
 * 1–15 层沿用 4（原版模板的动作数量级，16 层以前的形状已经被 `echoWaveGrowth` 验证过）；
 * 16 层以后放宽到 6 —— 深层「按层设计」的只数（`echoDeepWaveShape`）要靠这一档才放得下：
 * 28 条 × 4 只 = 112 就是旧版的实际上限，再抬 `ECHO_MAX_UNITS` 也看不出效果。
 */
export const ECHO_SHALLOW_MAX_COUNT_PER_ACTION = 4;
export const ECHO_DEEP_MAX_COUNT_PER_ACTION = 6;

const ECHO_POOL_CACHE = new WeakMap();
const ECHO_ALLPOOL_CACHE = new WeakMap();
const ECHO_ROUNDPOOL_CACHE = new WeakMap();
const ECHO_TEMPLIB_CACHE = new WeakMap();
const ECHO_PROFILE_CACHE = new WeakMap();

/**
 * **波次模板库**（维护者 2026-11-04）：按原版 1..13 回合的搭配，为每回合做成一两套「阵容模板」，
 * 深潜每回合从库里**随机抽一套**来生成 —— 于是每回合的种类组合都不一样，但每一套都是
 * 原版验证过、打得过的搭配（不是从全表乱抓）。
 *
 * 每套模板 = 该回合模板里的怪种 + 它们在原版里的大致配比（count 归一化后的权重）。
 * 同一回合的两套只在「谁多谁少」上不同，怪种仍取自这一关，所以不会出现离谱的敌人。
 *
 * @returns {Array<{ round:number, keys:string[], weights:Object<string,number>, ground:string[], fly:string[] }>}
 */
export function echoTemplateLib(gd, helpers) {
  const isFlyKey = helpers && helpers.isFlyKey;
  const cached = ECHO_TEMPLIB_CACHE.get(gd);
  if (cached) return cached;
  const lib = new Map();          // dataRound → 该回合的变体（本版 + 跨版本）
  const cross = crossRoundTemplates(gd && gd.modeId, (k) => !!(gd && gd.enemy && gd.enemy(k)));
  const last = Math.max(1, Math.floor(Number(gd?.bossRound) || 14) - 1);
  for (let r = 1; r <= last; r++) {
    const rc = gd.roundCfg(r);
    const tpl = rc && typeof rc.template === 'string' ? gd.wave(rc.template) : null;
    const counts = {};
    for (const s of (tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [])) {
      const k = s && (s.key ?? s.enemyKey);
      if (typeof k !== 'string' || !gd.enemy(k)) continue;
      const e = gd.enemy(k);
      if (!(Number(e?.stats?.moveSpeed) > 0)) continue;   // 装置/陷阱不算敌人
      counts[k] = (counts[k] || 0) + Math.max(1, Math.trunc(Number(s.count) || 1));
    }
    const keys = Object.keys(counts);
    if (keys.length < 2) continue;
    const mk = (weights) => ({
      round: r,
      keys: Object.keys(weights),
      weights,
      ground: Object.keys(weights).filter((k) => !(typeof isFlyKey === 'function' ? isFlyKey(gd, k) : false)),
      fly: Object.keys(weights).filter((k) => (typeof isFlyKey === 'function' ? isFlyKey(gd, k) : false)),
    });
    // 尽可能把这一关的组合铺开（去重后最多 40 套）：怪种固定取自这一关，只在「谁多谁少」上抖动。
    // 用固定种子的 LCG，保证同一局可复现；重复的配比丢掉，所以实际套数随关卡复杂度变化。
    const variants = [];
    const seen = new Set();
    for (let v = 0; v < 40; v++) {
      let seed = (r * 7919 + v * 104729 + 12345) % 2147483647;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const w = {};
      for (const k of keys) w[k] = Math.max(1, Math.round(counts[k] * (0.5 + rnd())));
      const sig = keys.map((k) => `${k}:${w[k]}`).join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      variants.push(mk(w));
    }
    // 同回合**跨版本**横向随机（维护者 2026-11-04）：其余版本第 r 回合的阵容也作为候选，
    // 这样同一个深度能看到深海 / 深池 / 萨卡兹等不同势力的搭配，而不是永远这一张图的几种。
    for (const x of (cross.get(r) || [])) {
      if (variants.length >= 60) break;          // 单回合最多 60 套，避免库无限膨胀
      variants.push(mk(x.weights));
    }
    lib.set(r, variants);
  }
  // 全局种子模板：把全表里所有可用的怪预生成成 N 套组合，
  // 每回合从中抽一套（而不是回合内临时从全表抽单怪）。
  const SEED_TEMPLATES = 120;
  {
    const all = echoAllPool(gd, helpers).all;
    let s = 20261104;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const seeds = [];
    const seenSeed = new Set();
    for (let v = 0; v < SEED_TEMPLATES && all.length >= 2; v++) {
      const w = {};
      // 维护者 2026-11-05：每套抽 **3–6 种**（原来 2–5，实测每波只出现 2–4 种，随机感偏弱）。
      // 只影响 16 层以后的种子模板；1–13 层走原版该回合的变体，不经过这里。
      const picks = Math.max(2, Math.min(all.length, 3 + Math.floor(rnd() * 4)));
      for (let i = 0; i < picks; i++) {
        const x = all[Math.floor(rnd() * all.length)];
        if (!x) continue;
        w[x.key] = Math.max(1, 1 + Math.floor(rnd() * 3));
      }
      const keys = Object.keys(w);
      if (keys.length < 2) continue;
      const sig = keys.map((k) => k + ':' + w[k]).join('|');
      if (seenSeed.has(sig)) continue;
      seenSeed.add(sig);
      seeds.push({ round: 0, keys, weights: w, ground: keys, fly: [] });
    }
    if (seeds.length) lib.set(0, seeds);
  }
  ECHO_TEMPLIB_CACHE.set(gd, lib);
  return lib;
}

/**
 * **单回合池**（维护者 2026-11-04）：只用「原版这一回合出现的怪种」做变体。
 *
 * 理由：1–13 层直接从全表随机，会抽出原版那个回合根本不会出现的怪（第 2 层撞上 2 万血精英、
 * 或者移速 0 的装置），玩家打不过也看不懂。所以低层照原版的**阵容**换数量、换位置、换比例，
 * 也就是「在原版这一关的怪里重新排一遍」。
 */
export function echoRoundPool(gd, dataRound, helpers) {
  const isFlyKey = helpers && helpers.isFlyKey;
  const key = gd;
  let cache = ECHO_ROUNDPOOL_CACHE.get(key);
  if (!cache) { cache = new Map(); ECHO_ROUNDPOOL_CACHE.set(key, cache); }
  const r = Number.isInteger(dataRound) && dataRound > 0 ? dataRound : 1;
  if (cache.has(r)) return cache.get(r);
  const rc = gd.roundCfg(r);
  const tpl = rc && typeof rc.template === 'string' ? gd.wave(rc.template) : null;
  const all = [];
  for (const s of (tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [])) {
    const k = s && (s.key ?? s.enemyKey);
    if (typeof k !== 'string' || !gd.enemy(k) || all.some((x) => x.key === k)) continue;
    const e = gd.enemy(k);
    all.push({ key: k, threat: Math.max(1, Number(e?.stats?.maxHp) || 100), fly: typeof isFlyKey === 'function' ? !!isFlyKey(gd, k) : false, elite: e?.rank === 'ELITE' });
  }
  const out = { ground: all.filter((x) => !x.fly), fly: all.filter((x) => x.fly), all };
  cache.set(r, out);
  return out;
}

/**
 * **全敌人池**（维护者 2026-11-04）：深潜的随机出怪不再只用「该战场 1..13 回合出现过的怪」，
 * 而是把整张敌人表都放进池子 —— 否则每局只有那 6 种，玩两把就腻。
 * 强度由 `ECHO_LOW_TIER_HP_CAP × 1.35^(深度−1)` 这道闸控制，所以低层不会冒出 2 万血的怪。
 *
 * 只排除 BOSS（`rank === 'BOSS'`，领袖由固定节点单独发），NORMAL / ELITE 都收。
 */
export function echoAllPool(gd, helpers) {
  const isFlyKey = helpers && helpers.isFlyKey;
  const cached = ECHO_ALLPOOL_CACHE.get(gd);
  if (cached) return cached;
  const all = [];
  const raw = gd && gd.raw && gd.raw.enemies ? gd.raw.enemies : null;
  for (const [key, e] of Object.entries(raw || {})) {
    const hp = Number(e && e.stats && e.stats.maxHp) || 0;
    if (!(hp > 0)) continue;
    if (e.rank === 'BOSS') continue;
    // 召唤类敌对目标（token_… / gd.token 能查到的）**不能被直接抽作出怪**，
    // 它们只该在原版的召唤条件下出现（维护者 2026-11-05）
    if (String(key).startsWith('token_')) continue;
    if (typeof gd.token === 'function' && gd.token(key)) continue;
    // 移速 0 的是装置/陷阱（比如「未装配刀片」），不是会走的敌人 —— 它们不该被当普通怪抽出来
    if (!(Number(e && e.stats && e.stats.moveSpeed) > 0)) continue;
    all.push({ key, threat: Math.max(1, hp), fly: typeof isFlyKey === 'function' ? !!isFlyKey(gd, key) : false, elite: e.rank === 'ELITE' });
  }
  const out = { ground: all.filter((x) => !x.fly), fly: all.filter((x) => x.fly), all };
  ECHO_ALLPOOL_CACHE.set(gd, out);
  return out;
}

/**
 * 1..lastRound 回合模板里出现过的真实敌人，按移动方式分桶。
 * （占位符 N/E/S/NF/EF/SF 不是真实敌人，`gd.enemy()` 查不到，天然被过滤掉。）
 */
export function echoPoolFor(gd, lastRound, helpers) {
  const isFlyKey = helpers && helpers.isFlyKey;
  let cache = ECHO_POOL_CACHE.get(gd);
  if (!cache) { cache = new Map(); ECHO_POOL_CACHE.set(gd, cache); }
  if (cache.has(lastRound)) return cache.get(lastRound);
  const seen = new Map();
  for (let r = 1; r <= lastRound; r++) {
    const rc = gd.roundCfg(r);
    const tpl = rc && typeof rc.template === 'string' ? gd.wave(rc.template) : null;
    for (const s of (tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [])) {
      const k = s && (s.key ?? s.enemyKey);
      if (typeof k !== 'string' || seen.has(k) || !gd.enemy(k)) continue;
      const e = gd.enemy(k);
      seen.set(k, {
        key: k,
        threat: Math.max(1, Number(e?.stats?.maxHp) || 100),
        fly: typeof isFlyKey === 'function' ? !!isFlyKey(gd, k) : false,
        elite: e?.rank === 'ELITE',
      });
    }
  }
  const all = [...seen.values()];
  const out = { ground: all.filter((x) => !x.fly), fly: all.filter((x) => x.fly), all };
  cache.set(lastRound, out);
  return out;
}

/**
 * 原版某一回合的**波次形状**（不是内容）：动作数、敌人总数、飞行占比、首末怪时间。
 *
 * 这是「参考原版」的落点 —— 我们照它的形状生成自己的波次，而不是照抄它那几条动作。
 *
 * @param {object} gd
 * @param {number} dataRound 数据回合（深潜里是 1..bossRound-1 循环）
 * @param {{ isFlyKey: Function }} helpers
 * @returns {{ actions: number, units: number, flyRatio: number, firstT: number, lastT: number }|null}
 */
export function echoProfileFor(gd, dataRound, helpers) {
  const isFlyKey = helpers && helpers.isFlyKey;
  let byRound = ECHO_PROFILE_CACHE.get(gd);
  if (!byRound) { byRound = new Map(); ECHO_PROFILE_CACHE.set(gd, byRound); }
  if (byRound.has(dataRound)) return byRound.get(dataRound);
  const rc = gd.roundCfg(dataRound);
  const tpl = rc && typeof rc.template === 'string' ? gd.wave(rc.template) : null;
  if (!tpl || !Array.isArray(tpl.spawns) || !tpl.spawns.length) { byRound.set(dataRound, null); return null; }
  let actions = 0;
  let units = 0;
  let fly = 0;
  let firstT = Infinity;
  let lastT = 0;
  for (const s of tpl.spawns) {
    const k = s && (s.key ?? s.enemyKey);
    if (typeof k !== 'string' || !gd.enemy(k)) continue;
    const n = Math.max(1, Math.trunc(Number(s.count) || 1));
    const interval = Math.max(0, Number(s.interval) || 0);
    const t = Math.max(0, Number(s.time) || 0);
    actions += 1;
    units += n;
    if (typeof isFlyKey === 'function' && isFlyKey(gd, k)) fly += n;
    firstT = Math.min(firstT, t);
    lastT = Math.max(lastT, t + n * interval);
  }
  const out = actions
    ? { actions, units, flyRatio: units ? fly / units : 0, firstT: Number.isFinite(firstT) ? firstT : 2, lastT: Math.max(lastT, 10) }
    : null;
  byRound.set(dataRound, out);
  return out;
}

/** 这张图实际可用的出怪路线（地面 / 飞行两类，别的 motion 不是出兵口）。 */
function usableRoutes(tpl) {
  const routes = Array.isArray(tpl && tpl.routes) ? tpl.routes : [];
  const out = [];
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    if (!r) continue;
    const fly = r.motion === 'FLY';
    if (!fly && (r.motion === 'E_NUM' || r.motion === 'E')) continue;
    out.push({ i, route: r, fly });
  }
  return out;
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

/**
 * 深潜回合的整波生成：**形状参考原版、内容完全随机、强度按回合缩放**。
 *
 * 普通回合返回 null（`buildNormalWave` 据此走原版路径，逐字节不变）。
 */
export function echoRandomWave(gd, tpl, opts, rng, helpers) {
  const growth = opts && Number.isFinite(opts.echoGrowth) ? opts.echoGrowth : null;
  if (!(growth > 1)) return null;
  const { isFlyKey, classOf, previewInfo, isLeaderTemplate, roundMods } = helpers || {};
  // 池子：
  //   * `echoPoolRoundOnly`（1–13 层）= 只取**原版这一回合出现过的怪种**，做数量/比例的变体；
  //   * 其它深度 = 全敌人表（16 层之后的自由段）；
  //   * 都不传（单测/旧路径）= 老口径「该战场 1..13 回合」，行为不变。
  const dataRoundForPool = Number.isInteger(opts.dataRound) && opts.dataRound > 0 ? opts.dataRound : 1;
  let pool = opts.echoPoolRoundOnly === true
    ? echoRoundPool(gd, dataRoundForPool, helpers)
    : opts.echoPoolAll === true
      ? echoAllPool(gd, helpers)
      : echoPoolFor(gd, Number.isInteger(opts.echoPoolRound) ? opts.echoPoolRound : 13, helpers);
  // **模板库**（维护者 2026-11-04）：每回合从「原版该回合的 10 套变体」里随机抽一套，
  // 按它的配比生成 —— 每回合的种类组合都不一样，但每一套都是原版验证过的搭配。
  if (opts.echoTemplates === true) {
    const byRound = echoTemplateLib(gd, helpers);
    // 14–15 层没有自己的普通回合模板（原版那两回合是 boss），所以从**整个库**里抽
    //（维护者 2026-11-04：14–15 也用同一套办法）。
    // 原版相邻回合的怪种高度重叠（R4 是 R3 的超集），严格用「该回合」等于每回合都长一样。
    // 所以取**相邻 ±2 关**的模板里随机抽一套：仍在原版 1..13 的经验范围内，但每回合组合真的会变。
    let vs = byRound.get(dataRoundForPool);
    if (opts.echoTemplatesAny !== true) {
      const win = [];
      for (let d = dataRoundForPool - 2; d <= dataRoundForPool + 2; d++) {
        const arr = byRound.get(d);
        if (arr && arr.length) win.push(...arr);
      }
      if (win.length) vs = win;
    } else {
      vs = [...byRound.values()].flat();
    }
    // 合并全局种子模板，并按本层血量闸过滤掉「这一层不该出现」的组合
    const seeds = byRound.get(0) || [];
    const depthNow = Math.max(1, Math.floor(Number(opts.echoDepth) || 1));
    const capNow = ECHO_LOW_TIER_HP_CAP * ECHO_LOW_TIER_STEP ** (depthNow - 1);
    const fits = (v) => v.keys.every((k) => {
      const e = typeof gd.enemy === 'function' ? gd.enemy(k) : null;
      const hp = Number(e && e.stats && e.stats.maxHp) || 0;
      return hp > 0 && hp <= capNow;
    });
    // 优先用「预生成的全局种子模板」（已按本层血量筛过）；
    // 没有可用种子时才回到本层的原版变体。 // SEEDS_MERGED
    const seedFit = seeds.filter(fits);
    if (seedFit.length) vs = seedFit;
    else if (vs) vs = vs.filter(fits);
    if (vs && vs.length) {
      const t = vs[Math.min(vs.length - 1, Math.floor((Number(rng()) || 0) * vs.length))];
      // 模板里的 key 可能来自**别的版本**（本版池子里没有），所以按 key 现场解析：
      // 先在本版池子里找，找不到就用 gd.enemy(key)（跨版本敌人已按 <ver>:<key> 注入）。
      const entryOf = (k) => {
        const hit = pool.all.find((x) => x.key === k);
        if (hit) return hit;
        const e = typeof gd.enemy === 'function' ? gd.enemy(k) : null;
        if (!e) return null;
        const hp = Math.max(1, Number(e.stats && e.stats.maxHp) || 100);
        return { key: k, threat: hp, fly: typeof isFlyKey === 'function' ? !!isFlyKey(gd, k) : false, elite: e.rank === 'ELITE' };
      };
      const g = []; const f = [];
      for (const k of t.keys) {
        const e = entryOf(k);
        if (!e) continue;
        const n = Math.max(1, Math.round(t.weights[k]));
        for (let i = 0; i < n; i++) (e.fly ? f : g).push(e);
      }
      pool = { ground: g, fly: f, all: [...g, ...f] };
    }
  }
  const routes = usableRoutes(tpl);
  if (!routes.length || !pool.all.length) return null;

  const scale = opts.echoScale && typeof opts.echoScale === 'object'
    ? opts.echoScale
    : { hpMul: 1, atkMul: 1, speedMul: 1 };
  const limit = Math.max(6, Number(opts.echoTimeLimit) || 60);
  const budget = Math.max(1, Number(opts.echoBudget) || ECHO_BUDGET_BASE * growth);
  const depth = Math.max(1, Math.floor(Number(opts.echoDepth) || 1));
  // ---- 低层不许抽到「远超当前强度」的怪 ------------------------------------
  // 池子是按 1..13 回合的全部敌人建的，所以第 2 层也可能抽到第 13 回合的精英
  // （维护者 2026-11-04 实测：第 2 层撞上 2 万血的孽罪奇美拉，直接打不过）。
  // 这里按「基础血量上限」随深度指数放开：1 层 3000、5 层约 1 万、10 层约 4.7 万，深层自然全开。
  const hpCap = ECHO_LOW_TIER_HP_CAP * ECHO_LOW_TIER_STEP ** (depth - 1);
  // 另外剔掉「挂着精英标但血量低得可怜」的怪：它们不该作为普通怪出现在池子里
  // （否则会在低层被当成普通条目抽出来，玩家看到的是一只 900 血的“精英”）。
  const eligible = (x) => x.threat <= hpCap && !(x.elite && x.threat < ECHO_ELITE_MIN_HP);
  const gatedPool = {
    ground: pool.ground.filter(eligible),
    fly: pool.fly.filter(eligible),
    all: pool.all.filter(eligible),
  };
  // 过滤完太窄（不足 3 种）就退回原池，避免某一层无怪可出；
  // 但**弱精英永远不许回来**（900 血的“精英”当杂兵刷是错的）。
  const keepNoWeakElite = (x) => !(x.elite && x.threat < ECHO_ELITE_MIN_HP);
  const pool2 = gatedPool.all.length >= 3 ? gatedPool : {
    ground: pool.ground.filter(keepNoWeakElite),
    fly: pool.fly.filter(keepNoWeakElite),
    all: pool.all.filter(keepNoWeakElite),
  };
  const leader = typeof isLeaderTemplate === 'function' ? isLeaderTemplate(tpl) : false;
  const modsOf = (key) => (typeof roundMods === 'function'
    ? { ...roundMods(scale), slot: classOf(gd, key) }
    : { hpMul: scale.hpMul, atkMul: scale.atkMul, speedMul: scale.speedMul, slot: classOf(gd, key) });

  // ---- 目标形状：原版该回合的形状 × 深度增幅 --------------------------------
  const dataRound = Number.isInteger(opts.dataRound) && opts.dataRound > 0 ? opts.dataRound : 1;
  const profile = echoProfileFor(gd, dataRound, helpers) || { actions: 8, units: 24, flyRatio: 0.5, firstT: 2, lastT: 45 };
  // 出怪量：以原版同回合的形状为**底**。
  //   * 传了 `echoShapeScale`（深潜调用方）= 用它，一条曲线管到底（`echoWaveGrowth`：1–15 层小步加码）。
  //   * 没传（单测 / 旧调用方）= 退回「每层 +5% / +6%」的经验值，行为不变。
  const shapeScale = Number.isFinite(opts.echoShapeScale) && opts.echoShapeScale > 0 ? opts.echoShapeScale : null;
  // ---- 按「玩家这回合有多少钱」调整出怪量（维护者 2026-11-04）-----------------
  // 期望资金 = ECHO_FUND_BASE + ECHO_FUND_PER_DEPTH × 深度；实际资金偏多就多出怪、偏少就少出怪，
  // 夹在 0.6–1.6 倍之间（不至于一波把人压死，也不至于白送）。不传 echoFunds 时恒为 1。
  const funds = Number(opts.echoFunds);
  const fundBase = ECHO_FUND_BASE + ECHO_FUND_PER_DEPTH * depth;
  const fundFactor = Number.isFinite(funds) && funds >= 0 && fundBase > 0
    ? Math.max(0.6, Math.min(1.6, funds / fundBase))
    : 1;
  const growthA = (shapeScale ?? (1 + ECHO_ACTIONS_DEPTH_STEP * (depth - 1))) * fundFactor;
  const growthU = (shapeScale ?? (1 + ECHO_UNITS_DEPTH_STEP * (depth - 1))) * fundFactor;
  // ---- 16 层以后：数量由**深度**设计，不再跟数据回合的形状（维护者 2026-11-04 §6）----
  // 数据回合 1..13 循环，深度 16 会轮回到第 1 回合；若继续按它的只数出怪，深层会从 112 只掉到 14 只。
  // 所以 `echoDeepWaveShape` 给「这一层该有多少只 / 几条」，模板库只决定怪种组合。
  const deepShape = depth >= ECHO_DEEP_FROM ? echoDeepWaveShape(depth) : null;
  // 「蜂拥」诅咒（2026-11-05）：深层只数按深度设计，不受 echoGrowth 影响，
  // 所以单独给一个乘数 opt（echoUnitMul），由 phases.js 把诅咒的 budgetMul 传进来。
  const unitMul = Number.isFinite(opts.echoUnitMul) && opts.echoUnitMul > 0 ? opts.echoUnitMul : 1;
  const wantActions = deepShape
    ? clampInt(deepShape.actions * fundFactor, ECHO_MIN_ACTIONS, ECHO_MAX_ACTIONS)
    : clampInt(profile.actions * growthA, ECHO_MIN_ACTIONS, ECHO_MAX_ACTIONS);
  const wantUnits = deepShape
    ? clampInt(deepShape.units * fundFactor * unitMul, wantActions, ECHO_MAX_UNITS)
    : clampInt(profile.units * growthU * unitMul, wantActions, ECHO_MAX_UNITS);
  // 单条指令最多放几只：深层放宽到 6，否则条数封顶后只数会被 4 只/条卡死（28×4 = 112）。
  const maxPerAction = deepShape ? ECHO_DEEP_MAX_COUNT_PER_ACTION : ECHO_SHALLOW_MAX_COUNT_PER_ACTION;
  // 出怪的时间跨度：前 15 层照原版该回合的首末怪时间（形状的一部分）；16 层以后固定铺满**时限的 36%**
  // （= 原版第 13 回合的比例：最后一只落在 82 秒 / 230 秒），否则深层会把 110 只挤在 20 秒里。
  const spanFrom = deepShape ? 3 : Math.max(0, Math.min(profile.firstT, limit * 0.2));
  const spanTo = deepShape
    ? Math.max(spanFrom + 5, Math.min(limit * ECHO_DEEP_SPAN_RATIO, limit * 0.8))
    : Math.max(spanFrom + 5, Math.min(profile.lastT, limit * 0.8));

  // ---- 铺槽位：条数 / 每只数 / 时间都按形状随机 ------------------------------
  const slots = [];
  let unitsLeft = wantUnits;
  let flyLeft = Math.round(wantUnits * profile.flyRatio);
  for (let i = 0; i < wantActions; i++) {
    const slotsLeft = wantActions - i;
    const maxHere = Math.min(maxPerAction, Math.max(1, unitsLeft - (slotsLeft - 1)));
    // 按「剩余配额 / 剩余格数」定这一格的下限，避免总数被随机摊薄
    const share = unitsLeft / Math.max(1, slotsLeft);
    const minHere = Math.max(1, Math.min(maxHere, Math.floor(share)));
    const count = Math.max(1, Math.min(maxHere, minHere + Math.floor((Number(rng()) || 0) * (maxHere - minHere + 1))));
    const interval = 0.5 * (1 + Math.floor((Number(rng()) || 0) * 3));      // 0.5 / 1 / 1.5 秒
    const time = Math.round((spanFrom + (Number(rng()) || 0) * (spanTo - spanFrom)) * 10) / 10;
    // 飞行配额：还剩多少就按比例决定这一格走空中还是地面
    const wantFly = flyLeft > 0 && (flyLeft >= unitsLeft * 0.5 || (Number(rng()) || 0) < 0.5);
    const cands = wantFly ? pool2.fly : pool2.ground;
    const fallback = wantFly ? pool2.ground : pool2.fly;
    const use = cands.length ? cands : fallback;
    if (!use.length) continue;
    const pick = use[Math.min(use.length - 1, Math.floor((Number(rng()) || 0) * use.length))];
    const isFly = use === pool2.fly;
    slots.push({ enemyKey: pick.key, routeIndex: -1, fly: isFly, time, count, interval, window: count * interval, threat: pick.threat });
    unitsLeft -= count;
    if (isFly) flyLeft = Math.max(0, flyLeft - count);
    if (unitsLeft <= 0) break;
  }
  if (!slots.length) return null;

  // ---- 路线：按移动方式在真实出兵口里随机 ------------------------------------
  for (const s of slots) {
    const cands = routes.filter((r) => r.fly === s.fly);
    const use = cands.length ? cands : routes;
    s.routeIndex = use[Math.min(use.length - 1, Math.floor((Number(rng()) || 0) * use.length))].i;
  }

  // 注意：这里**不按威胁预算裁剪条数** —— 数量由「原版形状 × 深度」决定（上面），
  // 强度由 echoScale 写进每条 spawn 的 mods 决定。按预算裁会把波次一路砍到最小条数
  // （池里既有 100 血的杂兵也有 6000 血的精英，任何固定预算都会误伤）。

  // ---- 精英：数量随深度，且只从够强的怪里选 ---------------------------------
  const challenge = opts.echoChallenge === true;
  const eliteN = challenge
    ? Math.max(2, opts.echoElite === true ? 1 : Math.max(0, Math.floor(Number(opts.echoElite) || 0)))
    : (opts.echoElite === true ? 1 : Math.max(0, Math.floor(Number(opts.echoElite) || 0)));
  if (eliteN > 0) {
    // 挑战关允许从**全表**里挑精英（仍然受血量闸限制），普通深潜回合只在本关模板里挑
    const eliteSrc = challenge ? echoAllPool(gd, helpers).all : pool2.all;
    const elitePool = eliteSrc.filter((x) => x.elite && x.threat >= ECHO_ELITE_MIN_HP && x.threat <= hpCap);
    const order = slots.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor((Number(rng()) || 0) * (i + 1)));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let placed = 0;
    for (const slot of order) {
      if (placed >= eliteN) break;
      const cands = elitePool.filter((x) => x.fly === slot.fly);
      if (!cands.length) continue;            // 这一类没有够强的精英：跳过，不硬塞
      const pick = cands[Math.min(cands.length - 1, Math.floor((Number(rng()) || 0) * cands.length))];
      slot.enemyKey = pick.key;
      slot.threat = pick.threat;
      placed += 1;
    }
  }

  // ---- 出最终结构（按时间排序，动作与 spawn 一一对应） ----------------------
  slots.sort((a, b) => a.time - b.time);
  const spawns = [];
  const actions = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const route = routes.find((x) => x.i === s.routeIndex)?.route ?? null;
    spawns.push({
      time: s.time,
      enemyKey: s.enemyKey,
      routeIndex: s.routeIndex,
      count: s.count,
      interval: s.count > 1 ? s.interval : 0,
      mods: modsOf(s.enemyKey),
      actionIndex: i,
      preview: typeof previewInfo === 'function' ? previewInfo(gd, s.enemyKey, route, false, leader) : null,
    });
    actions.push({
      index: i, key: s.enemyKey, tplKey: s.enemyKey, slot: classOf(gd, s.enemyKey), time: s.time, count: s.count,
      tplCount: s.count, window: s.window, routeIndex: s.routeIndex, valid: true, server: true,
    });
  }
  return { spawns, actions };
}
