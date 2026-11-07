// tools/audit-assets-pack.mjs —— 逐字节核对**线上的立绘/头像**和**我们自己的素材包**是否一致。
//
// 为什么要有这道检查：本服的 `shared/assets` 是部署机器上的唯一副本（30 个节点共用、nginx 直接读磁盘），
// 而它应当与 `dist\素材包-*.zip`（客户端提取的官方素材）一致。历史上出现过：
//   - 7 套皮肤的 `char/skin/<皮肤>.png` 被写成**方形插画**（2026-11-07 修，见 tools/fix-skin-portraits.mjs）；
//   - 暴行「又一年秋季」的立绘是拿插画裁成 1:2 的（同一批修）。
// 两者都是「文件在、比例也许对，但内容不是官方那张」，只有逐字节比对才看得出来。
//
// 本体立绘（char/portrait）在镜像站上只是编码不同、字节永远对不上，所以用素材包比才准。
//
//   node tools/audit-assets-pack.mjs            # 报告差异
//   node tools/audit-assets-pack.mjs --strict   # 有差异就 exit 1
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ASSETS = path.join(SP, 'shared', 'assets');
const DIST = path.join(SP, 'dist');
const STRICT = process.argv.includes('--strict');

// 素材包里这几类必须和线上一致（都是「一张图一个人」的立绘/头像）
const GROUPS = ['assets/char/portrait', 'assets/char/skin', 'assets/char/avatar', 'assets/char/skin_avatar'];

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

/** 最新的素材包。 */
function newestPack() {
  try {
    const zips = fs.readdirSync(DIST).filter((n) => /^素材包.*\.zip$/.test(n)).map((n) => path.join(DIST, n));
    zips.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return zips[0] || null;
  } catch { return null; }
}

const zip = newestPack();
if (!zip) {
  console.log(`没有找到素材包（${DIST}\\素材包*.zip），跳过`);
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pack-'));
try {
  execFileSync('tar', ['-xf', zip, '-C', tmp, ...GROUPS], { stdio: ['ignore', 'ignore', 'ignore'] });
} catch (e) {
  console.log(`素材包解压失败：${e.message}`);
  process.exit(STRICT ? 1 : 0);
}

let same = 0;
const diff = [];
const missing = [];
const extra = [];
for (const group of GROUPS) {
  const packDir = path.join(tmp, group);
  const liveDir = path.join(ASSETS, group.replace(/^assets\//, ''));
  if (!fs.existsSync(packDir)) continue;
  const packFiles = fs.readdirSync(packDir).filter((f) => f.endsWith('.png'));
  const liveFiles = fs.existsSync(liveDir) ? fs.readdirSync(liveDir).filter((f) => f.endsWith('.png')) : [];
  const packSet = new Set(packFiles);
  for (const f of packFiles) {
    const liveFile = path.join(liveDir, f);
    if (!fs.existsSync(liveFile)) { missing.push(`${group}/${f}`); continue; }
    if (md5(liveFile) === md5(path.join(packDir, f))) same += 1;
    else diff.push(`${group}/${f}`);
  }
  // 线上比包多的（后来补进来的新皮肤/新干员）：不算问题，列出来便于对账
  for (const f of liveFiles) if (!packSet.has(f)) extra.push(`${group}/${f}`);
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`素材包：${path.basename(zip)}`);
console.log(`一致 ${same} · 不一致 ${diff.length} · 线上缺 ${missing.length} · 线上比包多 ${extra.length}`);
for (const f of diff.slice(0, 40)) console.log(`  - 不一致 ${f}`);
for (const f of missing.slice(0, 40)) console.log(`  - 线上缺 ${f}`);
if (extra.length) console.log(`  （线上比包多 ${extra.length} 个，通常是素材包之后补进来的新皮肤：${extra.slice(0, 6).join(', ')}${extra.length > 6 ? ' …' : ''}）`);
if (STRICT && (diff.length || missing.length)) process.exit(1);
