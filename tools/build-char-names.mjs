// tools/build-char-names.mjs — 干员代号表（本服独有）：`data/char-names.json` = { charId: 中文名 }。
//
// 为什么需要：语音下载面板（public/js/ui/voiceLibrary.js）按 assets.json 的语音包 id 列干员，
// 名字原本只从「本版 chess.json + backups」里查 —— 而那两张表只含**本赛季上场**的干员，
// 于是另外 50 多个有语音、但没进本赛季卡池的干员只显示 `char_215_mantic` 这种文件代号
// （维护者 2026-11-16 反馈）。
//
// 名字来源：`.cache/gamedata/excel/character_table.json`（官方数据表，`name` 字段）。
// 只导出 `data/assets.json` 的 chars 键（有素材的那些）∪ 语音树里出现过的 id，文件很小。
//
//   node tools/build-char-names.mjs [--check]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('data/char-names.json', ROOT);
const TABLE = new URL('.cache/gamedata/excel/character_table.json', ROOT);
const ASSETS = new URL('data/assets.json', ROOT);
const VOICE_TREES = ['voice', 'voiceJp', 'voiceEn', 'voiceKr', 'voiceNative'];

const readJson = (u) => JSON.parse(readFileSync(fileURLToPath(u), 'utf8'));

export function buildCharNames() {
  const table = readJson(TABLE);
  const assets = readJson(ASSETS);
  const ids = new Set(Object.keys(assets.chars || {}));
  const audio = assets.audio || {};
  for (const t of VOICE_TREES) for (const k of Object.keys(audio[t] || {})) ids.add(k);
  const out = {};
  for (const id of [...ids].sort()) {
    const rec = table[id];
    const name = rec && typeof rec.name === 'string' ? rec.name.trim() : '';
    if (name) out[id] = name;
  }
  return out;
}

const built = buildCharNames();
const json = JSON.stringify(built, null, 0);
const check = process.argv.includes('--check');
if (check) {
  const cur = existsSync(fileURLToPath(OUT)) ? readFileSync(fileURLToPath(OUT), 'utf8') : '';
  if (cur.trim() !== json) {
    console.error('data/char-names.json 与数据源不一致：跑 node tools/build-char-names.mjs 重新生成');
    process.exit(1);
  }
  console.log('data/char-names.json 是最新的');
} else {
  writeFileSync(fileURLToPath(OUT), json + '\n');
  const missing = Object.keys(built).length;
  console.log(`写入 data/char-names.json：${missing} 条代号（${(json.length / 1024).toFixed(1)}KB）`);
}
