// tools/build-echo-stages.mjs — 「深渊回响」跨版本战场池（本服独有，非上游生成物）。
//
// 产物：`data/echo-stages.json`
//   { v, pool: [stageId...], stages: { stageId: 场地记录 } }
//
// 规则（维护者 2026-11-16，第二次定）：
//   * 池子 = **所有版本**里出现过的正式战场（`act<N>autochess_m<NN>`）的并集，
//     不看难度 —— 深渊回响每一档都抽全部图。这就是「其他版本对应难度没有的图也要加进去」。
//   * 只要 `active !== false` 且 `weight > 0` 的（各版本自己关掉的图不算，「联防阵地」那两张也不算）。
//   * `stages` 只放**本版 `data/stages.json` 里没有的**记录（目前是「规程·序列Ⅰ」的 10 张）。
//     客户端只靠 `data/stages.json` 查表，缺记录 = 进对局一片黑，所以这些记录要随数据一起发给浏览器。
//     本版已有记录的老图（战场#05/06/07 在本版是 `active:false`）不用重复发。
//
// 用法：node tools/build-echo-stages.mjs [--check]
//   `--check` 只校验 `data/echo-stages.json` 是否与数据源一致（CI/提交前用），不写文件。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('data/echo-stages.json', ROOT);

/** 参与合并的版本目录（与 server/match/match/echoCrossVersion.js 的 VERSION_SLUGS 一致）。 */
const VERSION_SLUGS = ['act1autochess', 'act1autochess-v1_1', 'act2autochess-v2_1', 'act3autochess-v3_1'];

const readJson = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8'));

/** 正式战场（排除 `act1autochess_escaped_*` 这种联防阵地）。 */
const STAGE_RE = /^act\dautochess_m\d{2}$/;

export function buildEchoStages() {
  const base = readJson('data/stages.json');
  const ids = new Set();
  for (const slug of VERSION_SLUGS) {
    let table = null;
    try { table = readJson(`data/versions/${slug}/stages.json`); } catch { continue; }
    for (const [id, rec] of Object.entries(table || {})) {
      if (!STAGE_RE.test(id)) continue;
      if (!rec || rec.active === false || !(Number(rec.weight) > 0)) continue;
      ids.add(id);
    }
  }
  const pool = [...ids].sort();
  /** @type {Record<string, any>} 客户端没有的那几张 */
  const stages = {};
  for (const id of pool) if (!base[id]) stages[id] = readVersionRecord(id);
  return { v: 1, pool, stages };
}

/** 从各版本里找一条记录（按 VERSION_SLUGS 顺序，第一个有的为准）。 */
function readVersionRecord(id) {
  for (const slug of VERSION_SLUGS) {
    let table = null;
    try { table = readJson(`data/versions/${slug}/stages.json`); } catch { continue; }
    const rec = table && table[id];
    if (rec) return rec;
  }
  return null;
}

const json = JSON.stringify(buildEchoStages());
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
  const parsed = JSON.parse(json);
  console.log(`写入 data/echo-stages.json：池 ${parsed.pool.length} 张，随包记录 ${Object.keys(parsed.stages).length} 条（${(json.length / 1024).toFixed(1)}KB）`);
}
