// tools/build-echo-stages.mjs — 「深渊回响」跨版本战场池（本服独有，非上游生成物）。
//
// 产物：`data/echo-stages.json`
//   { v, pools: { <modeId>: [stageId...] }, stages: { stageId: 场地记录 } }
//
// 规则（维护者 2026-11-16）：**按难度分池**，不要全部共用。
//   * 每个难度的池子 = 各版本 `config.json` 里 **该难度** `modes[modeId].stages` 的并集
//     （各版本自己关掉的 `active:false` / `weight<=0` 不算；「联防阵地」`act*_escaped_*` 不算）。
//     于是 险境 / 绝境 / 深渊 各有自己的图，玩家换难度就看到不同的地图。
//   * `stages` 只放**本版 `data/stages.json` 里没有的**记录（目前是「规程·序列Ⅰ」的 10 张）。
//     客户端只靠 `data/stages.json` 查表，缺记录 = 进对局一片黑，所以这些记录要随包发下去。
//
// 用法：node tools/build-echo-stages.mjs [--check]
//   `--check` 只校验 `data/echo-stages.json` 是否与数据源一致（CI / 提交前用），不写文件。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('data/echo-stages.json', ROOT);

/** 参与合并的版本目录（与 server/match/match/echoCrossVersion.js 的 VERSION_SLUGS 一致）。 */
const VERSION_SLUGS = ['act1autochess', 'act1autochess-v1_1', 'act2autochess-v2_1', 'act3autochess-v3_1'];
/** 深潜的难度（模式 id）。标准（FUNNY）不给深潜，但也生成一份，便于单测与将来开放。 */
const MODES = ['mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss', 'mode_multi_funny'];

const readJson = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8'));
/** 正式战场（排除 `act1autochess_escaped_*` 这种联防阵地）。 */
const STAGE_RE = /^act\dautochess_m\d{2}$/;

/** 每个版本、每个难度的原始清单（只留可用的正式战场）。 */
function versionPools() {
  const out = [];
  for (const slug of VERSION_SLUGS) {
    let cfg = null;
    let table = null;
    try { cfg = readJson(`data/versions/${slug}/config.json`); } catch { continue; }
    try { table = readJson(`data/versions/${slug}/stages.json`); } catch { continue; }
    const modes = cfg.modes && typeof cfg.modes === 'object' ? cfg.modes : {};
    const byMode = {};
    for (const m of MODES) {
      const list = modes[m] && Array.isArray(modes[m].stages) ? modes[m].stages : [];
      byMode[m] = list.filter((id) => {
        if (typeof id !== 'string' || !STAGE_RE.test(id)) return false;
        const rec = table[id];
        return !!rec && rec.active !== false && Number(rec.weight) > 0;
      });
    }
    out.push({ slug, byMode, table });
  }
  return out;
}

export function buildEchoStages() {
  const base = readJson('data/stages.json');
  const versions = versionPools();
  const pools = {};
  const allIds = new Set();
  for (const m of MODES) {
    const ids = new Set();
    for (const v of versions) for (const id of v.byMode[m] || []) ids.add(id);
    pools[m] = [...ids].sort();
    for (const id of pools[m]) allIds.add(id);
  }
  /** @type {Record<string, any>} 客户端没有的那几张记录 */
  const stages = {};
  for (const id of [...allIds].sort()) {
    if (base[id]) continue;
    const rec = readVersionRecord(versions, id);
    if (rec) stages[id] = rec;
  }
  return { v: 2, pools, stages };
}

/** 从各版本里找一条记录（按 VERSION_SLUGS 顺序，第一个有的为准）。 */
function readVersionRecord(versions, id) {
  for (const v of versions) {
    const rec = v.table && v.table[id];
    if (rec) return rec;
  }
  return null;
}

const built = buildEchoStages();
const json = JSON.stringify(built);
const check = process.argv.includes('--check');
if (check) {
  const cur = existsSync(fileURLToPath(OUT)) ? readFileSync(fileURLToPath(OUT), 'utf8') : '';
  if (JSON.stringify(JSON.parse(cur || 'null')) !== JSON.stringify(JSON.parse(json))) {
    console.error('data/echo-stages.json 与数据源不一致：跑 node tools/build-echo-stages.mjs 重新生成');
    process.exit(1);
  }
  console.log('data/echo-stages.json 是最新的');
} else {
  writeFileSync(fileURLToPath(OUT), json + '\n');
  const sizes = MODES.map((m) => `${m.replace('mode_multi_', '')}=${built.pools[m].length}`).join(' ');
  console.log(`写入 data/echo-stages.json：${sizes}；随包记录 ${Object.keys(built.stages).length} 条（${(json.length / 1024).toFixed(1)}KB）`);
}
