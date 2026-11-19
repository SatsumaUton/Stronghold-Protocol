// tools/build-android-assets.mjs —— 生成「APK 内置资源之外的增量清单」。
//
// 输出 public/download/android-assets.json：
//   { "v": 1, "version": <apkVersionCode>, "base": "https://assets.luobomiao.love/assets/",
//     "files": { "<assets 下的相对路径>": <未压缩字节数>, ... } }
//
// 清单内容 = public/assets 里**APK 中没有**、或**大小与 APK 不一致**的文件。
// App 里的 AssetUpdater 拉这个清单，只下缺的那些，落到 filesDir/overlay/sp/assets/…；
// AssetBridge 每次请求先看该目录，命中就直接从磁盘喂给 WebView。
//
// 用法：node tools/build-android-assets.mjs [--apk <path>] [--assets <dir>] [--out <path>]
//
// ⚠ 基线语义：清单永远相对「当前 public/download 里那个已发布的 APK」生成。
//   所以刚打完包、pack 与 assets 完全一致时，清单是 0 条 —— 这是对的：装了新包的人不需要补任何东西。
//   之后素材再变（新增 prefab、换了贴图），重新跑一次就会列出这批变化 —— 那正是「装上一个包的人」缺的。
//   build.ps1 在打包末尾会自动跑一次，保证基线与包同步。
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// 仓库根：设了 SP_ROOT 就是 <SP_ROOT>/repo-sync，否则是本脚本的上一级。
const ROOT = process.env.SP_ROOT ? join(process.env.SP_ROOT, 'repo-sync') : join(import.meta.dirname, '..');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const APK = arg('--apk', join(ROOT, 'public/download/stronghold-android.apk'));
const ASSETS = arg('--assets', join(ROOT, 'public/assets'));
const OUT = arg('--out', join(ROOT, 'public/download/android-assets.json'));
const BASE = arg('--base', 'https://assets.luobomiao.love/assets/');

/** 读 ZIP 的中央目录：名字 → 未压缩大小（不解压，1.5 GB 也能秒读）。 */
function zipIndex(file) {
  const fd = readFileSync(file);
  // EOCD 在文件尾，签名 0x06054b50，注释最长 65535
  let eocd = -1;
  for (let i = fd.length - 22; i >= Math.max(0, fd.length - 22 - 65535); i--) {
    if (fd.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('找不到 EOCD，不是合法 ZIP');
  const count = fd.readUInt16LE(eocd + 10);
  const cdSize = fd.readUInt32LE(eocd + 12);
  const cdOff = fd.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff || count === 0xffff) throw new Error('需要 ZIP64 支持（本包不该这么大）');
  const out = new Map();
  let p = cdOff;
  const end = cdOff + cdSize;
  while (p < end && fd.readUInt32LE(p) === 0x02014b50) {
    const size = fd.readUInt32LE(p + 24);
    const nlen = fd.readUInt16LE(p + 28);
    const elen = fd.readUInt16LE(p + 30);
    const clen = fd.readUInt16LE(p + 32);
    const name = fd.toString('utf8', p + 46, p + 46 + nlen);
    out.set(name, size);
    p += 46 + nlen + elen + clen;
  }
  return out;
}

function walk(dir, base = '', out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(full, rel, out);
    else if (e.isFile()) out.push({ rel: rel.split(sep).join('/'), full, size: statSync(full).size });
  }
  return out;
}

if (!existsSync(APK)) { console.error(`找不到 APK：${APK}`); process.exit(1); }
if (!existsSync(ASSETS)) { console.error(`找不到 assets：${ASSETS}`); process.exit(1); }

console.log(`APK   ${(statSync(APK).size / 1073741824).toFixed(2)} GB  ${APK}`);
const zip = zipIndex(APK);
console.log(`  条目 ${zip.size} 个`);

const files = walk(ASSETS);
console.log(`assets 目录 ${files.length} 个文件`);

const need = {};
let bytes = 0;
let added = 0, changed = 0;
for (const f of files) {
  const inApk = zip.get(`sp/assets/${f.rel}`);
  if (inApk === f.size) continue;      // 包里已有且大小一致 → 不用下
  if (inApk === undefined) added++;
  else changed++;
  need[f.rel] = f.size;
  bytes += f.size;
}

const vPath = join(ROOT, 'android/version.json');
const ver = existsSync(vPath) ? JSON.parse(readFileSync(vPath, 'utf8')) : { code: 0, name: '0' };

const doc = {
  v: 1,
  version: ver.code,
  name: ver.name,
  base: BASE,
  // 多源兜底：资源站优先，主站兜底（AssetUpdater 逐个试，下完校验字节数）
  bases: [BASE, 'https://stronghold.luobomiao.love/assets/'],
  note: '只列 APK 内置资源中没有或大小不一致的文件；App 拉这个清单增量补齐，不重下整包。由 tools/build-android-assets.mjs 生成。',
  generatedAt: new Date().toISOString().slice(0, 10),
  counts: { assetsInApk: zip.size, assetsOnDisk: files.length, added, changed, total: Object.keys(need).length },
  // 按键排序，方便 diff
  files: Object.fromEntries(Object.keys(need).sort().map((k) => [k, need[k]])),
};
writeFileSync(OUT, JSON.stringify(doc, null, 0) + '\n');
console.log(`\n增量：新增 ${added} + 变化 ${changed} = ${doc.counts.total} 个，${(bytes / 1048576).toFixed(1)} MB（未压缩）`);
console.log(`已写出 ${OUT}`);
