// tools/audit-portrait-mirror.mjs —— 用镜像站的官方立绘核对**每套皮肤**的立绘是不是官方那张。
//
// 两个镜像站的官方胸像（180×360）：
//   https://github.com/yuanyan3060/ArknightsGameResource   portrait/<官方皮肤id>.png
//   https://github.com/fexli/ArknightsResource             charpor/<模型名>.png
// 官方皮肤 id 与清单里的模型名只差两处：`@` → `_`、结尾的 `#N` → `_N`。
//
// 同一张图导出的 PNG 字节数相同，所以**按字节数比对**就能发现「立绘是插画 / 是老图 / 是别人」。
// 本服的文件常常来自其中一个镜像，两个都比一次就能说清「只是重新编码」还是「真的不一样」。
//
//   node tools/audit-portrait-mirror.mjs            # 报告差异
//   node tools/audit-portrait-mirror.mjs --strict   # 有差异就 exit 1
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ASSETS = path.join(SP, 'shared', 'assets');
const MANIFEST = path.join(SP, 'shared', 'data', 'assets.json');
const STRICT = process.argv.includes('--strict');
const CONCURRENCY = 6;

const MIRRORS = [
  { repo: 'yuanyan3060/ArknightsGameResource', dir: 'portrait', official: true },
  { repo: 'fexli/ArknightsResource', dir: 'charpor', official: false },
];

/** HEAD 一个 raw 文件，返回 Content-Length（失败返回 null）。 */
function headSize(url, n = 0) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({ host: u.host, path: u.pathname + u.search, method: 'HEAD', headers: { 'User-Agent': 'dsh' }, timeout: 30000 }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && n < 5) {
        r.resume();
        resolve(headSize(new URL(r.headers.location, url).toString(), n + 1));
        return;
      }
      r.resume();
      resolve(r.statusCode === 200 ? Number(r.headers['content-length']) || null : null);
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

const officialOf = (model) => String(model).replace(/_(\d+)$/, '#$1');
const relOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/assets\//, '');
const mirrorUrl = (m, skinId) => {
  const name = m.official ? officialOf(skinId) : skinId;
  const rel = `${m.dir}/${name}.png`.split('/').map(encodeURIComponent).join('/');
  return `https://gh-proxy.com/https://raw.githubusercontent.com/${m.repo}/main/${rel}`;
};

// 已知「字节不同、但图是对的」的皮肤（都逐张看过）：
//   素材包里 `assets/skins/<皮肤>/portrait.png` 的官方胸像 —— 同一张图，只是重新编码过。
//   清单里这几套的 char/skin/<皮肤>.png 就是素材包那份，所以字节数对不上镜像站。
const SAME_ART_OTHER_BYTES = new Set([
  'char_1012_skadi2_boc_4',
  'char_222_bpipe_epoque_28',
  'char_222_bpipe_epoque_40',
  'char_322_lmlee_whirlwind_10',
  'char_322_lmlee_witch_3',
  'char_1045_svash2_sale_20',   // 早期从客户端整包提取的那批，图一样、编码不同
]);

const doc = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const skins = [];
for (const [charId, ch] of Object.entries(doc.chars || {})) {
  for (const [skinId, skin] of Object.entries(ch.skins || {})) {
    if (!skin || typeof skin !== 'object' || skin.type === 'e2') continue;
    const rel = relOf(skin.portrait || skin.portraitE2);
    if (!rel) continue;
    let size = null;
    try { size = fs.statSync(path.join(ASSETS, rel)).size; } catch { /* 缺文件由 check-art 报 */ }
    skins.push({ charId, skinId, rel, size });
  }
}

/** 并发跑一个小池子。 */
async function pool(items, worker) {
  let next = 0;
  const out = new Array(items.length);
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return out;
}

const results = await pool(skins, async (s) => {
  const sizes = [];
  for (const m of MIRRORS) sizes.push({ repo: m.repo, size: await headSize(mirrorUrl(m, s.skinId)) });
  const hit = sizes.find((x) => x.size && x.size === s.size);
  if (hit) return { ...s, kind: 'same', via: hit.repo };
  if (sizes.some((x) => x.size)) return { ...s, kind: SAME_ART_OTHER_BYTES.has(s.skinId) ? 'known' : 'diff', sizes };
  return { ...s, kind: 'absent' };
});

// 本体立绘（char/portrait/<charId>_1|_2.png）不在这里比：文件名就是官方 id，但本服这批是从
// 素材包（客户端提取）来的，和镜像站只是编码不同、字节永远对不上。它由 tools/audit-assets-pack.mjs
// 跟素材包逐字节核对。

const same = results.filter((r) => r.kind === 'same');
const known = results.filter((r) => r.kind === 'known');
const diff = results.filter((r) => r.kind === 'diff');
const absent = results.filter((r) => r.kind === 'absent');

console.log(`皮肤 ${results.length} 套：与官方字节一致 ${same.length} · 已知同一张图（重新编码）${known.length}`
  + ` · 不一致 ${diff.length} · 镜像站没有 ${absent.length}`);
for (const r of diff) {
  const mirrors = r.sizes.map((x) => `${x.repo.split('/')[0]}=${x.size ?? '-'}`).join(' ');
  console.log(`  - 不一致 ${r.charId}/${r.skinId} 本服 ${r.size} · ${mirrors} → ${r.rel}`);
}
for (const r of absent) console.log(`  - 镜像站没有 ${r.charId}/${r.skinId} → ${r.rel}`);
if (STRICT && (diff.length || absent.length)) process.exit(1);
