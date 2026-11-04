// server/match/match/echoCrossVersion.js — 跨版本敌人池（维护者 2026-11-04）。
//
// 背景：四个版本各自有独立的敌人表（`data/enemies.json` 是基础版，
// `data/versions/<slug>/enemies.json` 是 act1 / act1-v1_1 / act2-v2_1）。
// 深潜如果只用一个版本，怪种就永远是那个战场那几种；把其余版本里**本版没有的敌人**并进来，
// 种类立刻翻几倍，而且每一条都是官方数据里真实存在、数值完备的敌人 —— 不是自己拼的。
//
// 三条设计决定（第三轮交接里提的三个问题）：
//   1. key 冲突：只有基础版没有的 key 才注入，且**前缀成 `<version>:<key>`**，
//      所以永远不会覆盖本版数据；本版已有的 key 一律保留本版数值。
//   2. 路径：相对本模块解析到仓库根的 `data/versions/`，读不到就静默跳过（返回空），
//      绝不让「数据缺失」变成启动失败。
//   3. 加载时机：进程内**懒加载 + 缓存**（约 1.3 MB 原始 JSON，解析后按版本缓存一份），
//      只有深潜房第一次建局时才会触发。
//
// 这个模块只做「读 + 过滤」，不碰 Match 状态，单测可以直接调。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `data/versions/` 的绝对路径（相对本文件：server/match/match/ → 仓库根）。 */
const VERSIONS_DIR = new URL('../../../data/versions/', import.meta.url);

/** 进程级缓存：versionSlug → { key: enemyRecord }（已过滤）。 */
let CACHE = null;

/** 参与合并的版本目录（顺序固定，便于复现）。 */
const VERSION_SLUGS = ['act1autochess', 'act1autochess-v1_1', 'act2autochess-v2_1'];

/**
 * 一个敌人能不能直接拿来当深潜的普通怪。
 *
 * 只收「自包含、会走、有血量」的：BOSS 由节点单独发；移速 0 的是装置/陷阱；
 * 缺 stats 的记录在战斗阶段会拿到 undefined 数值，直接排除。
 */
export function isUsableEnemy(e) {
  const hp = Number(e && e.stats && e.stats.maxHp) || 0;
  const spd = Number(e && e.stats && e.stats.moveSpeed) || 0;
  if (!(hp > 0) || !(spd > 0)) return false;
  if (e.rank === 'BOSS') return false;
  return true;
}

function readEnemies(slug) {
  try {
    const url = new URL(`${slug}/enemies.json`, VERSIONS_DIR);
    const raw = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;   // 文件缺失 / JSON 坏掉：当作这个版本没有数据
  }
}

/**
 * 其余版本里「本版没有」的敌人，key 已加版本前缀。
 *
 * @param {object} baseEnemies 本版 `gd.raw.enemies`（用来判断哪些 key 已经存在）
 * @returns {Record<string, any>} 可以直接 merge 进 `gd.raw.enemies` 的对象
 */
export function crossVersionEnemies(baseEnemies) {
  const base = baseEnemies && typeof baseEnemies === 'object' ? baseEnemies : {};
  if (!CACHE) {
    CACHE = new Map();
    for (const slug of VERSION_SLUGS) {
      const table = readEnemies(slug);
      if (!table) continue;
      const picked = {};
      for (const [key, rec] of Object.entries(table)) {
        if (base[key]) continue;          // 本版已有 → 保留本版数值
        if (!isUsableEnemy(rec)) continue;
        picked[`${slug}:${key}`] = rec;
      }
      if (Object.keys(picked).length) CACHE.set(slug, picked);
    }
  }
  const out = {};
  for (const picked of CACHE.values()) Object.assign(out, picked);
  return out;
}

/** 测试用：丢掉进程缓存。 */
export function _resetCrossVersionCache() {
  CACHE = null;
  CONFIG_CACHE = null;
}

/** 版本配置缓存：versionSlug → config.json */
let CONFIG_CACHE = null;

function readConfig(slug) {
  try {
    const url = new URL(`${slug}/config.json`, VERSIONS_DIR);
    return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  } catch {
    return null;
  }
}

function readWaves(slug) {
  try {
    const url = new URL(`${slug}/waves.json`, VERSIONS_DIR);
    return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * **同回合横向模板**：其余版本里「第 r 回合」的阵容，用来给深潜同一深度做横向随机。
 *
 * 每个版本 `config.json` 的 `modes[modeId].rounds[r].template` 指向它自己的波次模板，
 * 里面的敌人 key 若本版没有，就用 `<version>:<key>`（与 `crossVersionEnemies` 的注入规则一致）。
 *
 * @param {string} modeId 当前对局的模式 id（找不到就退到该版本任意一个带 rounds 的模式）
 * @param {(key: string) => boolean} hasBase 判断本版是否已有这个敌人 key
 * @returns {Map<number, Array<{version:string, keys:string[], weights:Object<string,number>}>>}
 */
export function crossRoundTemplates(modeId, hasBase) {
  if (!CONFIG_CACHE) {
    CONFIG_CACHE = new Map();
    for (const slug of VERSION_SLUGS) {
      const cfg = readConfig(slug);
      const waves = readWaves(slug);
      if (cfg && waves) CONFIG_CACHE.set(slug, { cfg, waves });
    }
  }
  const exists = typeof hasBase === 'function' ? hasBase : () => true;
  const out = new Map();
  for (const [slug, { cfg, waves }] of CONFIG_CACHE) {
    const modes = cfg.modes && typeof cfg.modes === 'object' ? cfg.modes : {};
    const mode = (modeId && modes[modeId]) || Object.values(modes).find((m) => m && m.rounds) || null;
    const rounds = mode && mode.rounds ? mode.rounds : null;
    if (!rounds) continue;
    for (const [rStr, rc] of Object.entries(rounds)) {
      const r = Number(rStr);
      if (!Number.isInteger(r) || r < 1) continue;
      const tpl = rc && typeof rc.template === 'string' ? waves[rc.template] : null;
      if (!tpl || !Array.isArray(tpl.spawns)) continue;
      const weights = {};
      for (const s of tpl.spawns) {
        const raw = s && (s.key ?? s.enemyKey);
        if (typeof raw !== 'string') continue;
        const key = exists(raw) ? raw : `${slug}:${raw}`;   // 本版没有 → 用注入后的前缀 key
        weights[key] = (weights[key] || 0) + Math.max(1, Math.trunc(Number(s.count) || 1));
      }
      const keys = Object.keys(weights);
      if (keys.length < 2) continue;
      if (!out.has(r)) out.set(r, []);
      out.get(r).push({ version: slug, keys, weights });
    }
  }
  return out;
}
