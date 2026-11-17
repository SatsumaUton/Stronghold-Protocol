// tools/import-from-resource-zip.mjs —— 从本机的作者整包 `安装包/ArknightsResource-main.zip`
// （fexli/ArknightsResource 的完整下载）里补两类素材，供镜像还没更新的资源用：
//
//   ① 召唤物皮肤模型：`spine/<tokenId>/<模型>/{Front|Spine,Back}/<模型>.{skel,atlas,png}`
//      → `shared/assets/local/spine/token/<模型>/`，并写 `data/local-assets.json` 的新 group
//        与 `tokens[tokenId].skins[<干员皮肤 id>] = { spineLocal }`（三份清单）。
//   ② 皮肤立绘：`charpor/<模型>.png`（180×360，与本服同尺寸）
//      → `shared/assets/char/skin/<模型>.png`，并写 `portrait / portraitE2`。
//      ⚠ 整包里 `charpor` 与在线镜像同为旧快照：比它新的皮肤只有 1:1 的 `charpack`（1592×1592），
//        取景不同，**不做替换**（宁可回落到本体立绘）。这类会列在报告里。
//
//   node tools/import-from-resource-zip.mjs            # 只报告
//   node tools/import-from-resource-zip.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ZIP = process.env.SP_RESOURCE_ZIP || path.join(SP, '安装包', 'ArknightsResource-main.zip');
const ART = path.join(SP, 'shared', 'assets');
const LIVE = path.join(SP, 'shared', 'data', 'assets.json');
const LOCAL = path.join(SP, 'shared', 'data', 'local-assets.json');
const FILES = [LIVE, path.join(ROOT, 'data', 'assets.json'), path.join(ROOT, 'patcher/features/game-core-data/files/data/assets.json')];
const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(ZIP)) { console.error(`找不到整包：${ZIP}`); process.exit(1); }

const { parseSkel } = await import(pathToFileURL(path.join(ROOT, 'tools/assets/skel.mjs')).href);
const { resolveRoles } = await import(pathToFileURL(path.join(ROOT, 'tools/assets/anim-roles.mjs')).href);

const PS_LIST = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead('${ZIP}')
$z.Entries | ForEach-Object { $_.FullName }
$z.Dispose()
`;
const names = execFileSync('powershell.exe', ['-NoProfile', '-Command', PS_LIST], { encoding: 'utf8', maxBuffer: 512 << 20 })
  .split(/\r?\n/).filter(Boolean);
const nameSet = new Set(names);

/** 解一个条目到指定路径（覆盖）。 */
function extract(entry, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead('${ZIP}')
$e = $z.Entries | Where-Object { $_.FullName -eq '${entry.replace(/'/g, "''")}' }
[System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, '${out.replace(/\\/g, '\\\\').replace(/'/g, "''")}', $true)
$z.Dispose()
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
}

const assets = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
const local = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
const ours = new Set();
for (const [cid, ch] of Object.entries(assets.chars || {})) for (const k of Object.keys(ch.skins || {})) ours.add(`${cid}|${k}`);

// ---- ① 召唤物皮肤模型 ----
const tokenDirs = [...new Set(names.filter((n) => /^ArknightsResource-main\/spine\/token_/.test(n)).map((n) => n.split('/')[2]))];
const tokenPlan = [];
for (const tokenId of tokenDirs) {
  const tk = assets.tokens[tokenId];
  if (!tk || !tk.owner) continue;
  const mine = Object.keys(assets.chars[tk.owner]?.skins || {}).filter((k) => k !== 'e2');
  if (!mine.length) continue;
  for (const n of names) {
    const m = /^ArknightsResource-main\/spine\/token_[^/]+\/([^/]+)\/(?:Front|Spine)\/([^/]+)\.skel$/.exec(n);
    if (!m || !n.startsWith(`ArknightsResource-main/spine/${tokenId}/`)) continue;
    const model = m[1];
    if (m[2] !== model) continue;
    const ownerSkin = mine.find((k) => model.endsWith(k.slice(tk.owner.length)));
    if (!ownerSkin) continue;
    if (tokenPlan.some((p) => p.model === model)) continue;
    tokenPlan.push({ tokenId, model, ownerSkin, existing: fs.existsSync(path.join(ART, 'local/spine/token', model, `${model}.skel`)) });
  }
}
console.log(`召唤物皮肤模型：整包里可补 ${tokenPlan.filter((p) => !p.existing).length} 套（已存在 ${tokenPlan.filter((p) => p.existing).length}）`);
for (const p of tokenPlan.filter((x) => !x.existing)) console.log(`  ${p.model.padEnd(44)} ← ${p.ownerSkin}`);

// ---- ② 皮肤立绘 ----
const missingPortraits = [];
for (const [cid, ch] of Object.entries(assets.chars || {})) {
  for (const [model, s] of Object.entries(ch.skins || {})) {
    if (model === 'e2' || (s.type && s.type !== 'outfit') || s.portrait) continue;
    const entry = `ArknightsResource-main/charpor/${model}.png`;
    missingPortraits.push({ cid, model, name: s.name || model, inZip: nameSet.has(entry) });
  }
}
const canPortrait = missingPortraits.filter((p) => p.inZip);
const cannotPortrait = missingPortraits.filter((p) => !p.inZip);
console.log(`\n皮肤立绘：缺 ${missingPortraits.length} 套；整包 charpor 有 ${canPortrait.length} 套，没有 ${cannotPortrait.length} 套`);
for (const p of cannotPortrait) console.log(`  ✗ ${p.cid} ${p.model}（${p.name}）—— 整包只有 1:1 的 charpack，取景不同，不替换`);

if (!APPLY) { console.log('\n(只报告；加 --apply 写入)'); process.exit(0); }

// 写入召唤物
let doneToken = 0;
for (const p of tokenPlan.filter((x) => !x.existing)) {
  const base = `ArknightsResource-main/spine/${p.tokenId}/${p.model}`;
  const sideDir = nameSet.has(`${base}/Front/${p.model}.skel`) ? 'Front' : 'Spine';
  const outDir = path.join(ART, 'local/spine/token', p.model);
  const files = {};
  const grab = (side, tag) => {
    for (const ext of ['skel', 'atlas', 'png']) {
      const entry = `${base}/${side}/${p.model}.${ext}`;
      if (!nameSet.has(entry)) return null;
      const dst = path.join(outDir, `${p.model}${tag}.${ext}`);
      extract(entry, dst);
      files[`${p.model}${tag}.${ext}`] = { path: `/assets/local/spine/token/${p.model}/${p.model}${tag}.${ext}`, kind: ext === 'png' ? 'Texture2D' : 'TextAsset' };
    }
    return fs.readFileSync(path.join(outDir, `${p.model}${tag}.skel`));
  };
  const skelBuf = grab(sideDir, '');
  if (!skelBuf) { console.log(`  ✗ ${p.model}: 缺 skel`); continue; }
  const backOk = nameSet.has(`${base}/Back/${p.model}.skel`) ? grab('Back', '.back') : null;

  let anims = null;
  try { anims = resolveRoles(parseSkel(new Uint8Array(skelBuf)).animations || []) || null; } catch { /* 留空 */ }
  const g = `spine/token/${p.model}`;
  local.groups[g] = files;
  const entry = { spineLocal: { group: g, skel: `${p.model}.skel`, atlas: `${p.model}.atlas`, textures: [`${p.model}.png`], ...(anims ? { anims } : {}) } };
  if (backOk) entry.spineLocal.back = { skel: `${p.model}.back.skel`, atlas: `${p.model}.back.atlas`, textures: [`${p.model}.back.png`] };
  for (const f of FILES) {
    const doc = f === LIVE ? assets : JSON.parse(fs.readFileSync(f, 'utf8'));
    const tk = doc.tokens[p.tokenId];
    if (!tk) continue;
    tk.skins = tk.skins || {};
    tk.skins[p.ownerSkin] = JSON.parse(JSON.stringify(entry));
    if (f !== LIVE) fs.writeFileSync(f, JSON.stringify(doc, null, 2));
  }
  doneToken++;
}

// 写入立绘（整包 charpor 里确实有的）
let donePortrait = 0;
for (const p of canPortrait) {
  const dst = path.join(ART, 'char/skin', `${p.model}.png`);
  extract(`ArknightsResource-main/charpor/${p.model}.png`, dst);
  for (const f of FILES) {
    const doc = f === LIVE ? assets : JSON.parse(fs.readFileSync(f, 'utf8'));
    const abs = f === LIVE;
    const url = (abs ? 'https://assets.luobomiao.love' : '') + `/assets/char/skin/${p.model}.png`;
    for (const ch of Object.values(doc.chars || {})) {
      const s = ch.skins && ch.skins[p.model];
      if (!s) continue;
      s.portrait = url; s.portraitE2 = url;
    }
    if (f !== LIVE) fs.writeFileSync(f, JSON.stringify(doc, null, 2));
  }
  donePortrait++;
}

local.count = Object.values(local.groups).reduce((n, g) => n + Object.keys(g).length, 0);
fs.writeFileSync(LIVE, JSON.stringify(assets, null, 2));
fs.writeFileSync(LOCAL, JSON.stringify(local, null, 2));
console.log(`\n导入召唤物皮肤 ${doneToken} 套、皮肤立绘 ${donePortrait} 套；local-assets ${Object.keys(local.groups).length} 组 / ${local.count} 文件`);
console.log('下一步：重启空闲节点（data 与 local-assets 都是启动时读入的）。');
