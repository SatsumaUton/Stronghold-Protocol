// tools/check-art.mjs —— 资源清单里**每位干员 / 每套皮肤**的立绘、头像、战场模型是否存在且属于本人。
//
//   node tools/check-art.mjs            # 用线上清单 shared/data/assets.json
//   node tools/check-art.mjs --strict   # 有问题就 exit 1
//
// 检查六件事：
//   1. 干员本体：portrait / portraitE2 / avatar / avatarE2 / spine 指向的文件都在磁盘上；
//   2. 皮肤：portrait / portraitE2 / avatar / illust / spine 指向的文件都在；
//   3. 皮肤归属：皮肤的立绘/头像路径里必须出现**本人 charId**（或该皮肤自己的 skinId），
//      防止「切了皮肤却用了别人的图」；
//   4. 皮肤 spine：要么是本人的模型目录，要么是皮肤自己的模型目录；
//   5. **立绘比例**：portrait / portraitE2 必须是 1:2 的竖图（180×360 这类胸像）。
//      2026-11-07 修过 7 套皮肤把方形插画（2200×2200 等）当立绘，卡面只剩中间一条被裁过的插画；
//   6. **换皮肤不会退回本体立绘**：非 e2 皮肤的立绘不能和本人本体立绘是同一张图。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ASSETS = path.join(SP, 'shared', 'assets');
const MANIFEST = process.argv.includes('--live') ? path.join(SP, 'shared', 'data', 'assets.json') : path.join(ROOT, 'data', 'assets.json');
const STRICT = process.argv.includes('--strict');

const doc = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const relOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/assets\//, '');
const localOf = (u) => { const rel = relOf(u); return rel ? path.join(ASSETS, rel) : null; };
const exists = (u) => { const rel = relOf(u); return rel ? fs.existsSync(path.join(ASSETS, rel)) : false; };

const problems = [];
const stats = { chars: 0, skins: 0, missing: 0, foreign: 0, shape: 0, same: 0 };

/** PNG / WebP 的宽高，读不出来时返回 null。 */
function imageSize(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  if (buf.length < 30) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

const md5Cache = new Map();
/** 文件的 md5（缓存；读不到时 null）。 */
function md5Of(file) {
  if (md5Cache.has(file)) return md5Cache.get(file);
  let v = null;
  try { v = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex'); } catch { /* 缺文件 */ }
  md5Cache.set(file, v);
  return v;
}

/** 立绘应当是 1:2 的竖图（±3% 容忍缩放取整）。 */
const isPortraitShape = (s) => !!s && Math.abs(s.w / s.h - 0.5) <= 0.015;

/** 一张立绘的比例对不对；对不上就记一条问题。 */
function checkPortraitShape(url, label) {
  const rel = relOf(url);
  if (!rel) return;
  const file = path.join(ASSETS, rel);
  if (!fs.existsSync(file)) return;   // 缺文件已经单独报过
  const size = imageSize(file);
  if (!size) return;
  if (isPortraitShape(size)) return;
  stats.shape += 1;
  problems.push(`立绘比例不是 1:2 ${label} → ${rel}（${size.w}×${size.h}）`);
}

/** 一个 URL 是否「属于」这个干员：路径里出现 charId，或出现皮肤自己的 id。 */
function belongs(url, charId, skinId = null) {
  const rel = relOf(url);
  if (!rel) return true;
  if (rel.includes(charId)) return true;
  if (skinId && rel.includes(skinId)) return true;
  return false;
}

for (const [charId, ch] of Object.entries(doc.chars || {})) {
  stats.chars += 1;
  // 1) 本体
  for (const key of ['portrait', 'portraitE2', 'avatar', 'avatarE2', 'illust']) {
    const u = ch[key];
    if (!u) continue;
    if (!exists(u)) { stats.missing += 1; problems.push(`缺文件 ${charId}.${key} → ${relOf(u)}`); }
    if (!belongs(u, charId)) { stats.foreign += 1; problems.push(`别人的图 ${charId}.${key} → ${relOf(u)}`); }
  }
  checkPortraitShape(ch.portrait, `${charId}.portrait`);
  checkPortraitShape(ch.portraitE2, `${charId}.portraitE2`);
  // 本体立绘的指纹：皮肤立绘和它一样 = 换了皮肤还是本体那张图（立绘「不对」）
  const baseArt = new Set([md5Of(localOf(ch.portrait)), md5Of(localOf(ch.portraitE2))].filter(Boolean));
  const spine = ch.spine && (ch.spine.front || ch.spine.back);
  if (spine) {
    for (const side of ['front', 'back']) {
      const s = ch.spine[side];
      if (!s) continue;
      for (const u of [s.skel, s.atlas, ...(Array.isArray(s.textures) ? s.textures : [])]) {
        if (!u) continue;
        if (!exists(u)) { stats.missing += 1; problems.push(`缺文件 ${charId}.spine.${side} → ${relOf(u)}`); }
        if (!belongs(u, charId)) { stats.foreign += 1; problems.push(`别人的模型 ${charId}.spine.${side} → ${relOf(u)}`); }
      }
    }
  }
  // 2) 皮肤
  for (const [skinId, skin] of Object.entries(ch.skins || {})) {
    if (!skin || typeof skin !== 'object') continue;
    stats.skins += 1;
    for (const key of ['portrait', 'portraitE2', 'avatar', 'avatarE2', 'illust']) {
      const u = skin[key];
      if (!u) continue;
      if (!exists(u)) { stats.missing += 1; problems.push(`缺文件 ${charId}/${skinId}.${key} → ${relOf(u)}`); }
      if (!belongs(u, charId, skinId)) { stats.foreign += 1; problems.push(`别人的图 ${charId}/${skinId}.${key} → ${relOf(u)}`); }
    }
    checkPortraitShape(skin.portrait, `${charId}/${skinId}.portrait`);
    checkPortraitShape(skin.portraitE2, `${charId}/${skinId}.portraitE2`);
    // 非 e2 皮肤不能和本体立绘是同一张图（换了皮肤还显示本体，就是「立绘不对」）
    if (skin.type !== 'e2') {
      for (const key of ['portrait', 'portraitE2']) {
        const md5 = md5Of(localOf(skin[key]));
        if (!md5 || !baseArt.has(md5)) continue;
        stats.same += 1;
        problems.push(`皮肤立绘就是本体立绘 ${charId}/${skinId}.${key} → ${relOf(skin[key])}`);
      }
    }
    const ss = skin.spine && (skin.spine.front || skin.spine.back);
    if (ss) {
      for (const side of ['front', 'back']) {
        const s = skin.spine[side];
        if (!s) continue;
        for (const u of [s.skel, s.atlas, ...(Array.isArray(s.textures) ? s.textures : [])]) {
          if (!u) continue;
          if (!exists(u)) { stats.missing += 1; problems.push(`缺文件 ${charId}/${skinId}.spine.${side} → ${relOf(u)}`); }
          if (!belongs(u, charId, skinId)) { stats.foreign += 1; problems.push(`别人的模型 ${charId}/${skinId}.spine.${side} → ${relOf(u)}`); }
        }
      }
    }
    // 每套皮肤至少要有一张能显示的图（立绘 / 头像 / 插画），否则卡面会空
    if (!skin.portrait && !skin.portraitE2 && !skin.illust && !skin.avatar && !skin.avatarE2 && !ss) {
      problems.push(`皮肤没有任何图或模型 ${charId}/${skinId}`);
    }
  }
}

console.log(`清单：${MANIFEST}`);
console.log(`干员 ${stats.chars} 位 · 皮肤 ${stats.skins} 套 · 缺文件 ${stats.missing} · 疑似别人的图 ${stats.foreign}`
  + ` · 立绘比例不对 ${stats.shape} · 皮肤退回本体立绘 ${stats.same}`);
if (problems.length) {
  console.log(`\n问题 ${problems.length} 条：`);
  for (const p of problems.slice(0, 60)) console.log('  - ' + p);
  if (problems.length > 60) console.log(`  … 还有 ${problems.length - 60} 条`);
  if (STRICT) process.exit(1);
} else {
  console.log('全部立绘 / 头像 / 模型都在，且都属于本人。');
}
