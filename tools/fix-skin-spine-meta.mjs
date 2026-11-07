// tools/fix-skin-spine-meta.mjs —— 给**皮肤模型**补上骨骼元数据（anims / animations / events / hits / bounds）。
//
// 背景（2026-11-07 玩家反馈「换了皮肤，战斗中干员的模型没变」）：批量导入的 300 套皮肤模型里，
// 297 套的 `chars[<干员>].skins[<皮肤>].spine.front|back` 只有 skel / atlas / textures 三个地址，
// **没有 `anims`**。客户端 `assets.js validSpine()` 要求 `isObj(sp.anims)`，否则判定这个模型不可用，
// 于是 `spineEntry()` 退回干员本体模型 —— 立绘/头像变了、战斗里的小人不变，就是这个原因。
//
// 这个工具按 `tools/assets/spine.mjs` 的同一套流程（规范化 atlas → 解析 skel → 解析动作角色）把
// 元数据补进清单，URL 一律沿用清单里原有的（绝对地址），只填元数据字段。
//
//   node tools/fix-skin-spine-meta.mjs --check                 # 只报告缺元数据的皮肤
//   node tools/fix-skin-spine-meta.mjs --only char_498_inside_kitchen_2 --dry-run
//   node tools/fix-skin-spine-meta.mjs --apply                  # 写回线上清单（先备份）
//   node tools/fix-skin-spine-meta.mjs --apply --sync           # 同时写回仓库与补丁快照
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processModels } from './assets/spine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ASSETS = path.join(SP, 'shared', 'assets');
const LIVE = path.join(SP, 'shared', 'data', 'assets.json');
const REPO = path.join(ROOT, 'data', 'assets.json');
const PATCH = path.join(ROOT, 'patcher', 'features', 'game-core-data', 'files', 'data', 'assets.json');

const CHECK = process.argv.includes('--check');
const APPLY = process.argv.includes('--apply');
const SYNC = process.argv.includes('--sync');
const DRY = process.argv.includes('--dry-run') || CHECK;
const IMPORT = process.argv.includes('--import-missing');
// --import-mirror：素材包里根本没有模型的皮肤，去镜像站（fexli/ArknightsResource）下载 Front/Back
const IMPORT_MIRROR = process.argv.includes('--import-mirror');
// --refresh：连已经有 anims 的也重新解析一遍（例如 atlas 还没规范化，或元数据是从旧快照搬来的）
const REFRESH = process.argv.includes('--refresh');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? new Set(String(process.argv[i + 1] || '').split(',').filter(Boolean)) : null;
})();

const relOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/assets\//, '');
const urlOf = (rel) => `/assets/${rel}`;

const doc = JSON.parse(fs.readFileSync(LIVE, 'utf8'));

// ---- 先把「补丁快照里有、线上却整个丢了」的皮肤模型搬回来 --------------------------------------
// 2026-11-07：`data/assets.json` 被重写过，4 套皮肤（风笛「皇家近卫」「风笛声声」、仇白「鉴浮生」
// 「手到牌来」）的 spine 整段消失（文件还在磁盘上）。补丁快照里那份是完整的，直接搬回来。
let imported = 0;
if (IMPORT) {
  let snap = null;
  try { snap = JSON.parse(fs.readFileSync(PATCH, 'utf8')); } catch { /* 没有快照 */ }
  if (!snap) console.log(`没有补丁快照可比：${PATCH}`);
  else {
    for (const [charId, ch] of Object.entries(doc.chars || {})) {
      const sch = snap.chars && snap.chars[charId];
      if (!sch) continue;
      for (const [skinId, skin] of Object.entries(ch.skins || {})) {
        if (!skin || typeof skin !== 'object' || skin.type === 'e2') continue;
        if (skin.spine && skin.spine.front) continue;
        const s = sch.skins && sch.skins[skinId];
        if (!s || !s.spine || !s.spine.front) continue;
        const rel = relOf(s.spine.front.skel);
        if (!rel || !fs.existsSync(path.join(ASSETS, rel))) continue;
        skin.spine = s.spine;
        imported += 1;
        console.log(`  搬回模型 ${charId}/${skinId} → ${rel}`);
      }
    }
  }
  console.log(`补回 ${imported} 套皮肤模型`);
}

// ---- 镜像站补齐：素材包和补丁快照都没有的皮肤，去 fexli/ArknightsResource 下载 -------------------
const MIRROR = 'https://gh-proxy.com/https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine';
const CDN = 'https://assets.luobomiao.love/assets';

/** GET 一个地址（跟随跳转），返回 Buffer；失败返回 null。 */
function download(url, n = 0) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.get({ host: u.host, path: u.pathname + u.search, headers: { 'User-Agent': 'dsh' }, timeout: 180000 }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && n < 5) {
        r.resume();
        return download(new URL(r.headers.location, url).toString(), n + 1).then(resolve);
      }
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => resolve(Buffer.concat(c)));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

let mirrored = 0;
if (IMPORT_MIRROR) {
  for (const [charId, ch] of Object.entries(doc.chars || {})) {
    for (const [skinId, skin] of Object.entries(ch.skins || {})) {
      if (!skin || typeof skin !== 'object' || skin.type === 'e2') continue;
      if (ONLY && !ONLY.has(skinId) && !ONLY.has(charId)) continue;
      if (skin.spine && skin.spine.front) continue;
      const spine = {};
      let ok = true;
      for (const side of ['front', 'back']) {
        const cap = side === 'front' ? 'Front' : 'Back';
        const rel = `spine/op/${charId}/${skinId}/${side}/${skinId}`;
        const files = {};
        for (const ext of ['skel', 'atlas', 'png']) {
          const buf = await download(`${MIRROR}/${charId}/${skinId}/${cap}/${skinId}.${ext}`);
          if (!buf || buf.length < 1000) { ok = false; break; }
          const dst = path.join(ASSETS, `${rel}.${ext}`);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.writeFileSync(dst, buf);
          files[ext] = `${CDN}/${rel}.${ext}`;
        }
        if (!ok) break;
        spine[side] = { skel: files.skel, atlas: files.atlas, textures: [files.png] };
      }
      if (!ok || !spine.front) continue;
      skin.spine = spine;
      mirrored += 1;
      console.log(`  从镜像站补模型 ${charId}/${skinId}`);
    }
  }
  console.log(`镜像站补回 ${mirrored} 套皮肤模型`);
}

/** 本体模型用了哪些技能槽（皮肤沿用同一套）：`anims.skills` 的键，或 `anims.skill.index`。 */
function skillIndicesOf(base) {
  const a = base && base.anims;
  if (!a) return [0];
  const skills = a.skills && typeof a.skills === 'object' ? Object.keys(a.skills).map(Number).filter(Number.isInteger) : [];
  if (skills.length) return [...new Set(skills)].sort((x, y) => x - y);
  return [Number.isInteger(a.skill && a.skill.index) ? a.skill.index : 0];
}

const plan = new Map();
const targets = [];
for (const [charId, ch] of Object.entries(doc.chars || {})) {
  if (!ch || !ch.spine || !ch.spine.front) continue;
  const base = ch.spine.front;
  const skillIndices = skillIndicesOf(base);
  for (const [skinId, skin] of Object.entries(ch.skins || {})) {
    if (!skin || typeof skin !== 'object' || !skin.spine || typeof skin.spine !== 'object') continue;
    if (ONLY && !ONLY.has(skinId) && !ONLY.has(charId)) continue;
    for (const side of ['front', 'back']) {
      const sp = skin.spine[side];
      if (!sp || typeof sp.skel !== 'string') continue;
      if (sp.anims && !REFRESH) continue;           // 已经有元数据
      const skelRel = relOf(sp.skel), atlasRel = relOf(sp.atlas);
      const pngs = (Array.isArray(sp.textures) ? sp.textures : []).map(relOf);
      if (!skelRel || !atlasRel) continue;
      if (!fs.existsSync(path.join(ASSETS, skelRel)) || !fs.existsSync(path.join(ASSETS, atlasRel))) continue;
      const dir = path.posix.dirname(skelRel) + '/';
      const key = `op:${skinId}:${side}`;
      targets.push({ charId, skinId, side, key });
      plan.set(key, {
        key,
        dir,
        skel: { rel: skelRel, urls: [sp.skel] },
        atlas: { rel: atlasRel, urls: [sp.atlas] },
        pngs: pngs.map((rel) => ({ rel, urls: [urlOf(rel)], kind: 'page' })),
        baseUrl: path.posix.dirname(sp.atlas) + '/',
        pma: !!base.pma,
        skillIndices,
      });
    }
  }
}

console.log(`清单：${LIVE}`);
console.log(`缺骨骼元数据的皮肤模型：${targets.length} 个（${new Set(targets.map((t) => t.skinId)).size} 套皮肤）`);
if (CHECK) {
  const bySkin = {};
  for (const t of targets) bySkin[t.skinId] = (bySkin[t.skinId] || 0) + 1;
  for (const [skinId, n] of Object.entries(bySkin).slice(0, 30)) console.log(`  - ${skinId} (${n} 侧)`);
  if (Object.keys(bySkin).length > 30) console.log(`  … 还有 ${Object.keys(bySkin).length - 30} 套`);
  process.exit(0);
}
if (!targets.length) process.exit(0);

const cachePath = path.join(os.tmpdir(), 'sp-skin-spine-cache.json');
const { entries, problems } = await processModels(plan, {
  root: ASSETS,
  dl: null,
  cachePath,
  download: false,
  writable: () => true,
  log: (m) => console.log(m),
});
for (const p of problems.slice(0, 20)) console.log(`  ! ${p}`);
if (problems.length > 20) console.log(`  … 另有 ${problems.length - 20} 条问题`);

// ---- 把元数据合并进清单（URL 沿用原来的） ------------------------------------------------------
let filled = 0;
let addedBytes = 0;
/** `${skinId}|${side}` → 元数据（仓库那份要按同样的键补上）。 */
const metaByKey = new Map();
for (const t of targets) {
  const e = entries.get(t.key);
  if (!e) continue;
  const skin = doc.chars[t.charId].skins[t.skinId];
  const sp = skin.spine[t.side];
  const before = JSON.stringify(sp).length;
  sp.pma = !!e.pma;
  sp.anims = e.anims;
  sp.animations = e.animations;
  sp.events = e.events;
  sp.hits = e.hits;
  sp.bounds = e.bounds;
  metaByKey.set(`${t.skinId}|${t.side}`, { pma: !!e.pma, anims: e.anims, animations: e.animations, events: e.events, hits: e.hits, bounds: e.bounds });
  addedBytes += JSON.stringify(sp).length - before;
  filled += 1;
}
console.log(`\n补好 ${filled}/${targets.length} 个模型，清单体积 +${(addedBytes / 1024 / 1024).toFixed(2)} MB`);
if (DRY) process.exit(0);

const text = JSON.stringify(doc);
fs.mkdirSync(path.dirname(LIVE), { recursive: true });
if (!fs.existsSync(LIVE + '.bak-before-spine-meta')) fs.copyFileSync(LIVE, LIVE + '.bak-before-spine-meta');
fs.writeFileSync(LIVE, text);
console.log(`已写回 ${LIVE}（${(text.length / 1024 / 1024).toFixed(2)} MB）`);

if (SYNC) {
  // 仓库那份用的是相对地址（`/assets/…`），所以不能整份覆盖：只把元数据按同样的键补进去，
  // 再把「线上有模型、仓库没有」的那几套皮肤搬过去（地址改写成相对形式）。
  if (!fs.existsSync(REPO)) {
    console.log(`  仓库清单不存在：${REPO}`);
  } else {
    const repoDoc = JSON.parse(fs.readFileSync(REPO, 'utf8'));
    const toRel = (v) => String(v).replace(/^https?:\/\/[^/]+\/assets\//, '/assets/');
    let metaCount = 0;
    let spineCount = 0;
    for (const [charId, ch] of Object.entries(repoDoc.chars || {})) {
      const liveCh = doc.chars[charId];
      for (const [skinId, skin] of Object.entries(ch.skins || {})) {
        if (!skin || typeof skin !== 'object') continue;
        // 1) 线上整个丢了模型的：搬回来
        const liveSkin = liveCh && liveCh.skins ? liveCh.skins[skinId] : null;
        if (liveSkin && liveSkin.spine && liveSkin.spine.front && !(skin.spine && skin.spine.front)) {
          const clone = JSON.parse(JSON.stringify(liveSkin.spine));
          for (const side of ['front', 'back']) {
            const sp = clone[side];
            if (!sp) continue;
            if (sp.skel) sp.skel = toRel(sp.skel);
            if (sp.atlas) sp.atlas = toRel(sp.atlas);
            if (Array.isArray(sp.textures)) sp.textures = sp.textures.map(toRel);
          }
          skin.spine = clone;
          spineCount += 1;
        }
        // 2) 元数据按同样的键补上（覆盖写：它是从磁盘重新解析出来的派生数据）
        for (const side of ['front', 'back']) {
          const sp = skin.spine && skin.spine[side];
          if (!sp) continue;
          const meta = metaByKey.get(`${skinId}|${side}`);
          if (!meta) continue;
          Object.assign(sp, meta);
          metaCount += 1;
        }
      }
    }
    fs.writeFileSync(REPO, JSON.stringify(repoDoc));
    console.log(`  已写回 ${REPO}（搬回模型 ${spineCount} 个，补元数据 ${metaCount} 个）`);
  }
  // 补丁快照跟着线上走（那份本来就是线上清单的快照）
  if (fs.existsSync(path.dirname(PATCH))) {
    fs.writeFileSync(PATCH, text);
    console.log(`  已写回 ${PATCH}`);
  } else {
    console.log(`  跳过补丁快照（没有这个目录）：${PATCH}`);
  }
}
