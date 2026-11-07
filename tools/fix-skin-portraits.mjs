// tools/fix-skin-portraits.mjs —— 把**比例不是 1:2**的皮肤立绘换成官方立绘。
//
// 背景（2026-11-07）：批量导入把 7 套皮肤的 `char/skin/<模型名>.png` 写成了
// **方形插画**（2200×2200 / 2560×2560 / 1596×1596 …）。界面按 180×360 的竖条去显示它，
// 于是卡面中间只剩一条被裁过的插画（看起来像加了边），换皮肤后「立绘不对」。
//
// 官方立绘（charpor / portrait，180×360 的胸像）在镜像站上有：
//   https://github.com/yuanyan3060/ArknightsGameResource   portrait/<官方皮肤id>.png
//   https://github.com/fexli/ArknightsResource             charpor/<模型名>.png
// 官方皮肤 id 与清单里的模型名只差两处：`@` → `_`、结尾的 `#N` → `_N`。
//
//   node tools/fix-skin-portraits.mjs --check     # 只报告哪些立绘比例不对（不下载）
//   node tools/fix-skin-portraits.mjs             # 修复（原文件备份到 shared/assets/_bak-square/）
//   node tools/fix-skin-portraits.mjs --pack      # 只从本机 / 素材包里重装（不联网）
//   node tools/fix-skin-portraits.mjs --force --only char_230_savage_sale_17
//                                                 # 比例对、但内容是错的（例如拿插画裁成 1:2）也重装
//   node tools/fix-skin-portraits.mjs --only char_222_bpipe_epoque_28
//
// 取图顺序（先近后远）：
//   1. 本机 `shared/assets/skins/<皮肤>/portrait.png`（素材包解出来的旧布局，180×360 官方胸像）
//   2. 素材包 `dist/素材包-*.zip` 里的 `assets/skins/<皮肤>/portrait.png`
//   3. 镜像站（见下）
//
// 清单 `data/assets.json` 不用改：路径不变，只换文件内容；服务端会按内容哈希换 URL。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ASSETS = path.join(SP, 'shared', 'assets');
const MANIFEST = path.join(SP, 'shared', 'data', 'assets.json');
const BAK = path.join(ASSETS, '_bak-square');
const DIST = path.join(SP, 'dist');

const CHECK = process.argv.includes('--check');
const PACK_ONLY = process.argv.includes('--pack');
const FORCE = process.argv.includes('--force');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? new Set(String(process.argv[i + 1] || '').split(',').filter(Boolean)) : null;
})();
if (FORCE && !ONLY) {
  console.error('--force 必须配 --only（否则会把 500 多套皮肤的立绘全重写一遍）');
  process.exit(2);
}

const MIRRORS = [
  { repo: 'yuanyan3060/ArknightsGameResource', dir: 'portrait', style: 'official' },
  { repo: 'fexli/ArknightsResource', dir: 'charpor', style: 'model' },
];

// ---- 读图尺寸 ---------------------------------------------------------------------------------
/** PNG / WebP 的宽高，读不出来时返回 null。 */
function imageSize(buf) {
  if (!buf || buf.length < 30) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

/** 立绘应当是 180×360 这类 1:2 的竖图（±3% 容忍缩放取整）。 */
const isPortraitShape = (s) => !!s && Math.abs(s.w / s.h - 0.5) <= 0.015;

const relOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/assets\//, '');
const localOf = (u) => { const rel = relOf(u); return rel ? path.join(ASSETS, rel) : null; };

// ---- 下载 -------------------------------------------------------------------------------------
function get(url, n = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({ host: u.host, path: u.pathname + u.search, headers: { 'User-Agent': 'dsh', Accept: '*/*' }, timeout: 90000 }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && n < 5) {
        r.resume();
        return get(new URL(r.headers.location, url).toString(), n + 1).then(resolve, reject);
      }
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => resolve({ status: r.statusCode, buf: Buffer.concat(c) }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

/** 模型名 → 官方皮肤 id：`char_222_bpipe_epoque_28` → `char_222_bpipe_epoque#28`。 */
const officialOf = (model) => String(model).replace(/_(\d+)$/, '#$1');

/** 从镜像站取一张立绘；返回 { buf, size, from } 或 null。 */
async function fetchPortrait(model) {
  const official = officialOf(model);
  for (const m of MIRRORS) {
    const name = m.style === 'official' ? official : model;
    const rel = `${m.dir}/${name}.png`;
    const encoded = rel.split('/').map(encodeURIComponent).join('/');
    const raw = `https://gh-proxy.com/https://raw.githubusercontent.com/${m.repo}/main/${encoded}`;
    let r;
    try { r = await get(raw); } catch { r = { status: 0, buf: Buffer.alloc(0) }; }
    if (r.status !== 200 || r.buf.length < 8000) {
      // 回退：GitHub contents API（文件 < 1 MB 时带 base64 正文）
      try {
        const api = await get(`https://api.github.com/repos/${m.repo}/contents/${encoded}`);
        if (api.status === 200) {
          const j = JSON.parse(api.buf.toString('utf8'));
          if (j && j.content) r = { status: 200, buf: Buffer.from(j.content, 'base64') };
        }
      } catch { /* 保持原来的失败 */ }
    }
    if (r.status !== 200 || r.buf.length < 8000) continue;
    const size = imageSize(r.buf);
    if (!isPortraitShape(size)) continue;
    return { buf: r.buf, size, from: `${m.repo}/${rel}` };
  }
  return null;
}

// ---- 取图：先本机、再素材包、最后镜像站 ---------------------------------------------------------
/** 1) 本机旧布局 `skins/<皮肤>/portrait.png`（素材包解出来的官方胸像）。 */
function fromLocal(skinId) {
  const file = path.join(ASSETS, 'skins', skinId, 'portrait.png');
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const size = imageSize(buf);
  if (!isPortraitShape(size)) return null;
  return { buf, size, from: `本机 skins/${skinId}/portrait.png` };
}

/** 2) 素材包 `dist/素材包-*.zip` 里的 `assets/skins/<皮肤>/portrait.png`。
 *  用系统自带的 tar（bsdtar 能读 zip）取单个条目，避免为解压一个文件引入依赖。 */
function fromPack(skinId) {
  let zips;
  try {
    zips = fs.readdirSync(DIST).filter((n) => /^素材包.*\.zip$/.test(n)).map((n) => path.join(DIST, n));
  } catch { return null; }
  if (!zips.length) return null;
  zips.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const entry = `assets/skins/${skinId}/portrait.png`;
  for (const zip of zips) {
    try {
      const buf = execFileSync('tar', ['-xf', zip, '-O', entry], { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
      const size = imageSize(buf);
      if (isPortraitShape(size)) return { buf, size, from: `${path.basename(zip)}:${entry}` };
    } catch { /* 这个包里没有，试下一个 */ }
  }
  return null;
}

/** 按 本机 → 素材包 → 镜像站 的顺序取一张立绘。 */
async function findPortrait(skinId) {
  const local = fromLocal(skinId);
  if (local) return local;
  const packed = fromPack(skinId);
  if (packed) return packed;
  return PACK_ONLY ? null : fetchPortrait(skinId);
}

// ---- 找出要修的立绘 ---------------------------------------------------------------------------
const doc = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const targets = [];   // { charId, skinId, key, url, file, size, bad }
const seenSkin = new Set();
for (const [charId, ch] of Object.entries(doc.chars || {})) {
  for (const [skinId, skin] of Object.entries(ch.skins || {})) {
    if (!skin || typeof skin !== 'object') continue;
    if (ONLY && !ONLY.has(skinId) && !ONLY.has(charId)) continue;
    for (const key of ['portrait', 'portraitE2']) {
      const url = skin[key];
      const file = localOf(url);
      if (!file || !fs.existsSync(file)) continue;   // 缺文件由 check-art.mjs 报
      const size = imageSize(fs.readFileSync(file));
      const bad = !isPortraitShape(size);
      // --pack：已经 1:2 的也重装一遍（把当初误写的方形插画彻底换成素材包里的官方胸像）。
      // 不指定 --only 时只处理本机确有旧布局立绘的皮肤，免得为 500 多套皮肤逐个翻素材包。
      // --force：比例对、但内容不对的（拿插画裁成 1:2）也重装，必须配 --only，免得整表重写。
      const forced = FORCE ? true : PACK_ONLY && (ONLY ? true : fs.existsSync(path.join(ASSETS, 'skins', skinId, 'portrait.png')));
      if (!bad && !forced) continue;
      if (seenSkin.has(file)) continue;
      seenSkin.add(file);
      targets.push({ charId, skinId, key, url, file, size, bad });
    }
  }
}

console.log(`清单：${MANIFEST}`);
console.log(`比例不是 1:2 的皮肤立绘：${targets.filter((t) => t.bad).length} 处`
  + (PACK_ONLY ? ` · --pack 模式下待重装 ${targets.length} 处` : ''));
for (const t of targets) {
  console.log(`  - ${t.charId}/${t.skinId}.${t.key} ${t.size ? `${t.size.w}x${t.size.h}` : '?'} → ${relOf(t.url)}`);
}
if (CHECK || !targets.length) process.exit(0);

// ---- 替换 -------------------------------------------------------------------------------------
let fixed = 0;
let failed = 0;
for (const t of targets) {
  const got = await findPortrait(t.skinId);
  if (!got) { failed += 1; console.log(`  取不到 ${t.skinId} 的 1:2 立绘（本机/素材包/镜像站都没有）`); continue; }
  fs.mkdirSync(BAK, { recursive: true });
  const bakFile = path.join(BAK, path.basename(t.file));
  if (!fs.existsSync(bakFile)) fs.copyFileSync(t.file, bakFile);
  fs.writeFileSync(t.file, got.buf);
  fixed += 1;
  console.log(`  已替换 ${relOf(t.url)} ← ${got.size.w}x${got.size.h}（${got.from}）`);
}

console.log(`\n替换 ${fixed} 个文件，失败 ${failed} 处；原文件备份在 ${BAK}`);
if (failed) process.exit(1);
