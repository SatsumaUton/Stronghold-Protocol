// tools/skins-floor.mjs — 刷新 data/assets.skins-floor.json（皮肤规模的「地板」）。
//
//   node tools/skins-floor.mjs           # 只打印当前规模
//   node tools/skins-floor.mjs --update  # 把地板抬到当前规模（只能调高，绝不调低）
//
// test/assets-skins.test.js 用它拦住「皮肤被静默清空」。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
const floorPath = join(ROOT, 'data', 'assets.skins-floor.json');

const withSkins = Object.entries(assets.chars || {}).filter(([, v]) => v && v.skins && Object.keys(v.skins).length);
const owners = withSkins.length;
const entries = withSkins.reduce((n, [, v]) => n + Object.keys(v.skins).length, 0);

const prev = existsSync(floorPath) ? JSON.parse(readFileSync(floorPath, 'utf8')) : { owners: 0, entries: 0 };
console.log(`当前：${owners} 位干员 / ${entries} 套皮肤；地板：${prev.owners} / ${prev.entries}`);

if (process.argv.includes('--update')) {
  const next = { owners: Math.max(prev.owners || 0, owners), entries: Math.max(prev.entries || 0, entries) };
  if (next.owners === prev.owners && next.entries === prev.entries) { console.log('地板未变'); process.exit(0); }
  writeFileSync(floorPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`地板抬高到 ${next.owners} / ${next.entries}`);
}
