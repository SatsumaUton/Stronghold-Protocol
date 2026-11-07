// tools/check-art.mjs —— 资源清单里**每位干员 / 每套皮肤**的立绘、头像、战场模型是否存在且属于本人。
//
//   node tools/check-art.mjs            # 用线上清单 shared/data/assets.json
//   node tools/check-art.mjs --strict   # 有问题就 exit 1
//
// 检查四件事：
//   1. 干员本体：portrait / portraitE2 / avatar / avatarE2 / spine 指向的文件都在磁盘上；
//   2. 皮肤：portrait / portraitE2 / avatar / illust / spine 指向的文件都在；
//   3. 皮肤归属：皮肤的立绘/头像路径里必须出现**本人 charId**（或该皮肤自己的 skinId），
//      防止「切了皮肤却用了别人的图」；
//   4. 皮肤 spine：要么是本人的模型目录，要么是皮肤自己的模型目录。
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
const exists = (u) => { const rel = relOf(u); return rel ? fs.existsSync(path.join(ASSETS, rel)) : false; };

const problems = [];
const stats = { chars: 0, skins: 0, missing: 0, foreign: 0 };

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
console.log(`干员 ${stats.chars} 位 · 皮肤 ${stats.skins} 套 · 缺文件 ${stats.missing} · 疑似别人的图 ${stats.foreign}`);
if (problems.length) {
  console.log(`\n问题 ${problems.length} 条：`);
  for (const p of problems.slice(0, 60)) console.log('  - ' + p);
  if (problems.length > 60) console.log(`  … 还有 ${problems.length - 60} 条`);
  if (STRICT) process.exit(1);
} else {
  console.log('全部立绘 / 头像 / 模型都在，且都属于本人。');
}
