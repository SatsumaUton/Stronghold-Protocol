// tools/import-token-skins.mjs —— 召唤物随干员皮肤换皮（官方 tokenSkinMap 的数据部分）。
//
// 维护者 2026-11-18：「部分拥有召唤物的干员也应该根据干员皮肤，更换召唤物的皮肤」。
//
// 核查结论（不是这次同步丢的）：
//   * v0.4.0 与当前版本的 `data/assets.json` 里 `tokens` 都是 60 条、**0 条带 `skins`**；
//     磁盘上也没有任何召唤物皮肤模型 —— 这份数据从来没导入过。
//   * 代码机制是齐的：服务端 `t.skin = owner.skin`（召唤物继承主人的皮肤），客户端 `spineEntry()`
//     读 `tokens[id].skins[<owner 皮肤 id>]`、`tokenAvatarUrl()` 同一条规则 —— 就是官方 tokenSkinMap。
//
// 做法：从作者镜像 fexli/ArknightsResource 的 `spine/<tokenId>/<模型>/Front|Back/` 下载模型，
// 落到本地素材包 `shared/assets/local/spine/token/<模型>/`，并写：
//   1. `data/local-assets.json` 新 group `spine/token/<模型>`
//   2. `data/assets.json`（及仓库/补丁副本）的 `tokens[tokenId].skins[<干员皮肤 id>] = { spineLocal }`
//
// 镜像里的目录名与官方 skinId 不完全一致（`token_10057_svash2_eagle_sale_20` vs `…eagle1_sale#20`），
// 所以不按名字拼路径：先列目录，再用「<group>_<n> 后缀」和干员皮肤对齐。
//
//   node tools/import-token-skins.mjs            # dry-run
//   node tools/import-token-skins.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ART = path.join(SP, 'shared', 'assets');
const LIVE = path.join(SP, 'shared', 'data', 'assets.json');
const REPO = path.join(ROOT, 'data', 'assets.json');
const PATCH = path.join(ROOT, 'patcher', 'features', 'game-core-data', 'files', 'data', 'assets.json');
const LOCAL = path.join(SP, 'shared', 'data', 'local-assets.json');
const RAW = 'https://raw.githubusercontent.com/fexli/ArknightsResource/main/';
const API = 'https://api.github.com/repos/fexli/ArknightsResource/contents/';
const TOKEN = (() => { try { return fs.readFileSync(path.join(SP, '.secrets/github-token.txt'), 'utf8').trim(); } catch { return ''; } })();

const APPLY = process.argv.includes('--apply');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const assets = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
const LOCALDOC = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
const tokenIds = Object.keys(assets.tokens || {}).sort((a, b) => b.length - a.length);

const { parseSkel } = await import(pathToFileURL(path.join(ROOT, 'tools/assets/skel.mjs')).href);
const { resolveRoles } = await import(pathToFileURL(path.join(ROOT, 'tools/assets/anim-roles.mjs')).href);

async function api(p) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(API + p + '?ref=main', { headers: { 'User-Agent': 'dsh', Accept: 'application/vnd.github+json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === 3) return null; await sleep(500 * (i + 1)); }
  }
  return null;
}
async function head(url) {
  for (let i = 0; i < 4; i++) {
    try { const st = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'dsh' } }).then((r) => r.status); if (st) return st; }
    catch { /* retry */ }
    await sleep(400 * (i + 1));
  }
  return 0;
}
async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'dsh' } });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404) throw new Error('404');
    } catch (e) { if (String(e.message) === '404') throw e; }
    await sleep(400 * (i + 1));
  }
  throw new Error('download failed');
}

// 我们已收录的干员皮肤：owner|cid → 该干员的皮肤 model 列表
const skinsByOwner = new Map();
for (const [cid, ch] of Object.entries(assets.chars || {})) {
  skinsByOwner.set(cid, Object.keys(ch.skins || {}));
}

const plan = [];
const seenModels = new Set();
const seenOwners = new Set();
for (const [tokenId, tk] of Object.entries(assets.tokens || {})) {
  const owner = tk.owner;
  if (!owner || !skinsByOwner.has(owner)) continue;
  const mine = skinsByOwner.get(owner).filter((k) => k !== 'e2');
  if (!mine.length) continue;
  const entries = await api(`spine/${tokenId}`);
  if (!Array.isArray(entries)) continue;
  for (const e of entries) {
    if (e.type !== 'dir') continue;
    const model = e.name;                                   // 镜像里的模型目录名
    if (seenModels.has(model)) continue;                    // 同一个模型可能在多个 token 目录下（如三个幻影鹰）
    // 与干员皮肤对齐：模型的尾部必须是某个干员皮肤的尾部（_<group>_<n>）
    const ownerSkin = mine.find((k) => model.endsWith(k.slice(owner.length)));
    if (!ownerSkin) continue;
    seenModels.add(model);
    const dir = path.join(ART, 'local', 'spine', 'token', model);
    if (fs.existsSync(path.join(dir, `${model}.skel`))) { plan.push({ tokenId, model, ownerSkin, skip: 'already' }); continue; }
    const st = await head(`${RAW}spine/${tokenId}/${model}/Front/${model}.skel`);
    plan.push({ tokenId, model, ownerSkin, ok: st === 200, st });
    await sleep(60);
  }
  seenOwners.add(tokenId);
}

const ok = plan.filter((p) => p.ok);
const bad = plan.filter((p) => !p.ok && p.skip !== 'already');
console.log(`扫了 ${seenOwners.size} 个有皮肤对应关系的召唤物；可下载 ${ok.length} 套，已存在 ${plan.filter((p) => p.skip === 'already').length}，镜像缺 ${bad.length}`);
for (const p of ok.slice(0, 12)) console.log(`  ${p.model.padEnd(42)} ← ${p.ownerSkin}`);
if (bad.length) console.log(`  镜像缺: ${bad.slice(0, 8).map((b) => b.model + '(' + b.st + ')').join(', ')}`);
if (!APPLY) { console.log('\n(--dry-run)'); process.exit(0); }

let done = 0;
for (const p of ok) {
  const dir = path.join(ART, 'local', 'spine', 'token', p.model);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${RAW}spine/${p.tokenId}/${p.model}`;
  const side = async (s) => {
    const out = {};
    for (const ext of ['skel', 'atlas', 'png']) {
      const buf = await get(`${base}/${s}/${p.model}.${ext}`);
      const name = s === 'Back' ? `${p.model}.back.${ext}` : `${p.model}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buf);
      out[ext] = buf;
    }
    return out;
  };
  try {
    const front = await side('Front');
    const backSt = await head(`${base}/Back/${p.model}.skel`);
    const back = backSt === 200 ? await side('Back') : null;

    let anims = null;
    try { anims = resolveRoles(parseSkel(new Uint8Array(front.skel)).animations || []) || null; } catch { /* 留空 */ }

    const g = `spine/token/${p.model}`;
    const files = {
      [`${p.model}.atlas`]: { path: `/assets/local/${g}/${p.model}.atlas`, kind: 'TextAsset' },
      [`${p.model}.png`]: { path: `/assets/local/${g}/${p.model}.png`, kind: 'Texture2D' },
      [`${p.model}.skel`]: { path: `/assets/local/${g}/${p.model}.skel`, kind: 'TextAsset' },
    };
    if (back) {
      files[`${p.model}.back.atlas`] = { path: `/assets/local/${g}/${p.model}.back.atlas`, kind: 'TextAsset' };
      files[`${p.model}.back.png`] = { path: `/assets/local/${g}/${p.model}.back.png`, kind: 'Texture2D' };
      files[`${p.model}.back.skel`] = { path: `/assets/local/${g}/${p.model}.back.skel`, kind: 'TextAsset' };
    }
    LOCALDOC.groups[g] = files;

    const entry = { spineLocal: { group: g, skel: `${p.model}.skel`, atlas: `${p.model}.atlas`, textures: [`${p.model}.png`], ...(anims ? { anims } : {}) } };
    if (back) entry.spineLocal.back = { skel: `${p.model}.back.skel`, atlas: `${p.model}.back.atlas`, textures: [`${p.model}.back.png`] };

    for (const file of [LIVE, REPO, PATCH]) {
      const doc = file === LIVE ? assets : JSON.parse(fs.readFileSync(file, 'utf8'));
      const tk = doc.tokens[p.tokenId];
      if (!tk) continue;
      tk.skins = tk.skins || {};
      tk.skins[p.ownerSkin] = JSON.parse(JSON.stringify(entry));
      if (file !== LIVE) fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    }
    done++;
    if (done % 5 === 0) console.log(`  ${done}/${ok.length}`);
  } catch (e) {
    console.log(`  ❌ ${p.model}: ${e.message}`);
  }
}

LOCALDOC.count = Object.values(LOCALDOC.groups).reduce((n, g2) => n + Object.keys(g2).length, 0);
fs.writeFileSync(LIVE, JSON.stringify(assets, null, 2));
fs.writeFileSync(LOCAL, JSON.stringify(LOCALDOC, null, 2));
console.log(`\n导入 ${done} 套召唤物皮肤；local-assets 组数 ${Object.keys(LOCALDOC.groups).length}，文件 ${LOCALDOC.count}`);
