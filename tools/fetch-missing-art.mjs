// tools/fetch-missing-art.mjs —— 立绘 / 头像 / 模型「本地没有就去资源站找」。
//
//   node tools/fetch-missing-art.mjs            # 只体检（不下载、不改清单）
//   node tools/fetch-missing-art.mjs --apply    # 下载缺失文件，并把资源站上有的精二图补进清单
//
// 做两件事：
//   1. 清单里**引用到**但磁盘上没有的文件 → 去资源站（config.assetOrigin）按同一路径取回来，
//      写进 shared/assets（nginx 磁盘优先，取回来之后客户端就不必再回源）；
//   2. 干员缺 portraitE2 / avatarE2 时，去资源站探一下 `char/portrait/<id>_2.png`、
//      `char/avatar/<id>_2.png`；有就下载并补进清单（含一张「精英二」皮肤条目），
//      没有（比如 char_6xx 那批自制干员）就跳过。
//
// 资源站路径：`<origin>/assets/<rel>`；本地路径：`shared/assets/<rel>`。
// 带 `~<hash>` 版本段的地址会先剥掉版本段。
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const APPLY = process.argv.includes('--apply');
const LIVE = path.join(SP, 'shared', 'data', 'assets.json');
const REPO = path.join(ROOT, 'data', 'assets.json');
const PATCHER = path.join(ROOT, 'patcher', 'features', 'game-core-data', 'files', 'data', 'assets.json');
const ASSETS = path.join(SP, 'shared', 'assets');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const doc = readJson(LIVE);
const cfg = (() => { try { return readJson(path.join(SP, 'shared', 'data', 'config.json')); } catch { return {}; } })();
const ORIGIN = String(process.env.SP_ASSET_ORIGIN || cfg.assetOrigin || 'https://assets.luobomiao.love').replace(/\/$/, '');

const relOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/assets\//, '').replace(/\/~[0-9a-f]{8,}\//, '/');
const diskOf = (u) => path.join(ASSETS, relOf(u));
const has = (u) => { const r = relOf(u); return !!r && fs.existsSync(diskOf(u)); };

function head(url) {
  return new Promise((resolve) => {
    // 资源站的证书链不完整（本服 nginx 回源时也不校验），这里同样不校验
    const req = https.request(url, { method: 'HEAD', rejectUnauthorized: false }, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on('error', () => resolve(0));
    req.setTimeout(15000, () => { req.destroy(); resolve(0); });
    req.end();
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { rejectUnauthorized: false }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => { out.close(() => { fs.renameSync(tmp, dest); resolve(fs.statSync(dest).size); }); });
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

/** 清单里引用到的全部美术地址（干员 + 皮肤）。 */
function collectUrls() {
  const urls = new Set();
  const add = (u) => { if (typeof u === 'string' && u.includes('/assets/')) urls.add(u); };
  const addSpine = (sp) => {
    if (!sp) return;
    for (const side of ['front', 'back']) {
      const s = sp[side];
      if (!s) continue;
      add(s.skel); add(s.atlas);
      for (const t of Array.isArray(s.textures) ? s.textures : []) add(t);
    }
  };
  for (const ch of Object.values(doc.chars || {})) {
    for (const k of ['portrait', 'portraitE2', 'avatar', 'avatarE2', 'illust']) add(ch[k]);
    addSpine(ch.spine);
    for (const sk of Object.values(ch.skins || {})) {
      for (const k of ['portrait', 'portraitE2', 'avatar', 'avatarE2', 'illust']) add(sk && sk[k]);
      addSpine(sk && sk.spine);
    }
  }
  return [...urls];
}

const urls = collectUrls();
const missing = urls.filter((u) => !has(u));
console.log(`清单引用 ${urls.length} 个美术文件；本地缺 ${missing.length} 个`);

// 1) 缺失文件 → 资源站
const fetched = [];
const stillMissing = [];
for (const u of missing) {
  const rel = relOf(u);
  const remote = `${ORIGIN}/assets/${rel}`;
  const status = await head(remote);
  if (status === 200) {
    if (APPLY) {
      try { const size = await download(remote, diskOf(u)); fetched.push(`${rel}（${(size / 1024).toFixed(0)} KB）`); }
      catch (e) { stillMissing.push(`${rel}（下载失败：${e.message}）`); }
    } else fetched.push(rel);
  } else stillMissing.push(`${rel}（资源站 ${status}）`);
}
console.log(`可从资源站补：${fetched.length}${APPLY ? '（已下载）' : '（未下载）'}`);
for (const f of fetched.slice(0, 20)) console.log('  + ' + f);
console.log(`资源站也没有：${stillMissing.length}`);
for (const f of stillMissing.slice(0, 20)) console.log('  - ' + f);

// 2) 缺精二图 → 资源站找
const noE2 = Object.entries(doc.chars || {}).filter(([, ch]) => ch && ch.portrait && (!ch.portraitE2 || !ch.avatarE2));
const e2Found = [];
for (const [charId, ch] of noE2) {
  const pRel = `char/portrait/${charId}_2.png`;
  const aRel = `char/avatar/${charId}_2.png`;
  const [ps, as] = [await head(`${ORIGIN}/assets/${pRel}`), await head(`${ORIGIN}/assets/${aRel}`)];
  if (ps !== 200 || as !== 200) continue;
  e2Found.push({ charId, pRel, aRel });
}
console.log(`\n缺精二图的干员 ${noE2.length} 位；资源站上找得到的 ${e2Found.length} 位`);
for (const x of e2Found.slice(0, 20)) console.log('  · ' + x.charId);

if (APPLY && e2Found.length) {
  for (const x of e2Found) {
    for (const rel of [x.pRel, x.aRel]) {
      const dest = path.join(ASSETS, rel);
      if (!fs.existsSync(dest)) await download(`${ORIGIN}/assets/${rel}`, dest);
    }
  }
  // 三份清单都补（线上 / 仓库 / 补丁覆盖版），字段与其它干员一致
  for (const file of [LIVE, REPO, PATCHER]) {
    if (!fs.existsSync(file)) continue;
    const m = readJson(file);
    let n = 0;
    for (const x of e2Found) {
      const ch = m.chars && m.chars[x.charId];
      if (!ch) continue;
      const pUrl = `${ORIGIN}/assets/${x.pRel}`;
      const aUrl = `${ORIGIN}/assets/${x.aRel}`;
      if (!ch.portraitE2) { ch.portraitE2 = pUrl; n += 1; }
      if (!ch.avatarE2) { ch.avatarE2 = aUrl; n += 1; }
      ch.skins = ch.skins && typeof ch.skins === 'object' ? ch.skins : {};
      const skinId = `${x.charId}_2`;
      if (!ch.skins[skinId]) {
        ch.skins[skinId] = {
          name: '精英二', type: 'e2', group: '精英二',
          portrait: pUrl, avatar: aUrl,
          ...(ch.spine ? { spine: ch.spine } : {}),
        };
        n += 1;
      }
    }
    fs.writeFileSync(file, JSON.stringify(m));
    console.log(`  写入 ${path.relative(SP, file)}：${n} 处`);
  }
}

if (!APPLY) console.log('\n（未加 --apply：只体检，不下载也不改清单）');
