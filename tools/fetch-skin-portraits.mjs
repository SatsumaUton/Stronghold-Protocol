// tools/fetch-skin-portraits.mjs —— 补齐「清单里有皮肤、但本地缺立绘」的那几套：从作者源下载。
//
// 维护者 2026-11-18：「补齐」（指 9 套只有模型、没有立绘的皮肤）。
//
// 素材规格：本服皮肤立绘是 `assets/char/skin/<model>.png`，**180×360**（与作者源
// `ArknightsAssets2 / assets/dyn/arts/charportraits` 同尺寸）。
//
// 作者源（按优先级，全部是「作者提供的地址」，不从我们自己的资源站拿）：
//   1. ArknightsAssets/ArknightsAssets2 @cn  `assets/dyn/arts/charportraits/<skinId>.png`
//      文件名用官方 skinId（`char_4177_brigid_epoque#53.png`，`#` 要转义成 %23）；
//      模型名 `<skinId 的 @ → _、# → _>`（`char_4177_brigid_epoque_53`）。
//   2. fexli/ArknightsResource `charpor/<model>.png`（旧快照，尺寸同样 180×360）。
//   3. `--shop` 才用 `assets/dyn/arts/shopskinportraits`：那是**商店预览图**（292×552，
//      取景与 180×360 不同），默认不碰 —— 宁可回落到本体立绘，也不放一张构图不同的图。
//
//   node tools/fetch-skin-portraits.mjs                # 报告还缺哪些（默认 --check 行为）
//   node tools/fetch-skin-portraits.mjs --apply        # 下载并写进三份清单
//   node tools/fetch-skin-portraits.mjs --apply --shop # 允许退回商店预览图（不推荐）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ART = path.join(SP, 'shared', 'assets', 'char', 'skin');
const FILES = [
  { f: path.join(SP, 'shared', 'data', 'assets.json'), abs: true },
  { f: path.join(ROOT, 'data', 'assets.json'), abs: false },
  { f: path.join(ROOT, 'patcher', 'features', 'game-core-data', 'files', 'data', 'assets.json'), abs: false },
];
const APPLY = process.argv.includes('--apply');
const SHOP = process.argv.includes('--shop');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AA = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/arts/';
const FX = 'https://raw.githubusercontent.com/fexli/ArknightsResource/main/charpor/';

/** `char_4177_brigid_epoque_53` → `char_4177_brigid_epoque#53`（官方 skinId 的文件名形式） */
const officialName = (model) => model.replace(/_(\d+)$/, '#$1');
const enc = (s) => s.split('/').map(encodeURIComponent).join('/');

async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'dsh' } });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(400 * (i + 1));
  }
  return null;
}

const live = JSON.parse(fs.readFileSync(FILES[0].f, 'utf8'));
const missing = [];
for (const [cid, ch] of Object.entries(live.chars || {})) {
  for (const [model, s] of Object.entries(ch.skins || {})) {
    if (model === 'e2' || (s.type && s.type !== 'outfit')) continue;
    if (s.portrait) continue;
    missing.push({ cid, model, name: s.name || model });
  }
}

console.log(`清单里缺立绘的皮肤: ${missing.length} 套`);
if (!missing.length) process.exit(0);

const plan = [];
for (const m of missing) {
  const dst = path.join(ART, `${m.model}.png`);
  if (fs.existsSync(dst) && fs.statSync(dst).size > 1024) { plan.push({ ...m, from: 'local' }); continue; }
  let buf = await get(AA + 'charportraits/' + encodeURIComponent(`${officialName(m.model)}.png`));
  let from = 'ArknightsAssets2/charportraits';
  if (!buf) { buf = await get(FX + encodeURIComponent(`${m.model}.png`)); from = 'fexli/charpor'; }
  if (!buf && SHOP) { buf = await get(AA + 'shopskinportraits/' + encodeURIComponent(`${officialName(m.model)}.png`)); from = 'shopskinportraits(预览图)'; }
  plan.push({ ...m, buf, from: buf ? from : null });
  await sleep(120);
}

const ready = plan.filter((p) => p.from);
const lost = plan.filter((p) => !p.from);
for (const p of ready) console.log(`  ✓ ${p.cid} ${p.model}（${p.name}）← ${p.from}`);
if (lost.length) {
  console.log(`\n作者源也没有的 ${lost.length} 套（模型可用，界面回落到本体立绘）:`);
  for (const p of lost) console.log(`  ✗ ${p.cid} ${p.model}（${p.name}）`);
  console.log('  说明：可达的两个镜像都停在上一个版本（charportraits 最大到 epoque#49），');
  console.log('  这些皮肤比镜像新。等镜像更新后重跑本工具即可。');
}

if (!APPLY || !ready.length) { console.log(APPLY ? '' : '\n(--check：加 --apply 下载并写清单)'); process.exit(0); }

fs.mkdirSync(ART, { recursive: true });
for (const p of ready) if (p.buf) fs.writeFileSync(path.join(ART, `${p.model}.png`), p.buf);

let patched = 0;
for (const { f, abs } of FILES) {
  if (!fs.existsSync(f)) continue;
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  const u = (rel) => (abs ? 'https://assets.luobomiao.love' : '') + rel;
  let n = 0;
  for (const ch of Object.values(doc.chars || {})) {
    for (const p of ready) {
      const s = ch.skins && ch.skins[p.model];
      if (!s) continue;
      const url = u(`/assets/char/skin/${p.model}.png`);
      if (s.portrait !== url) { s.portrait = url; s.portraitE2 = url; n++; }
    }
  }
  if (n) { fs.writeFileSync(f, JSON.stringify(doc, null, 2)); console.log(`写入 ${f.replace(SP, '')}（${n} 处）`); patched += n; }
}
console.log(`\n下载 ${ready.filter((p) => p.buf).length} 张，清单补 ${patched} 处`);
