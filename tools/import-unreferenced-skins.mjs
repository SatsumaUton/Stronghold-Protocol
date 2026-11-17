// tools/import-unreferenced-skins.mjs —— 把**磁盘上已有、清单却没收录**的皮肤模型补进 data/assets.json。
//
// 背景（维护者 2026-11-18「部分干员只有基础和精二立绘没有皮肤」）：
//   素材是齐的，问题在清单。实测：磁盘上 345 个皮肤模型目录，清单只引用了 262 个 —— **83 个没进清单**。
//   其中 81 个是因为目录里的文件名带 `build_` 前缀
//   （`build_char_1027_greyy2_snow_5.skel`），而生成清单的那一步是按 `<model>.skel` 拼路径的，
//   找不到就当没有，于是这些皮肤在界面上根本不存在（干员只剩本体 + 精二立绘）。
//
// 这个工具不看文件名约定，直接扫目录、用**实际文件名**写清单；名字/系列名取官方 skin_table 的中文
// （displaySkin.skinName / skinGroupName），立绘只有本地确实存在才写。骨骼元数据
// （anims / animations / events / hits / bounds）由 tools/fix-skin-spine-meta.mjs 之后补 —— 那个工具会
// 解析 .skel，客户端 assets.js validSpine() 要求有 anims，否则战斗中会退回本体模型。
//
//   node tools/import-unreferenced-skins.mjs               # dry-run，只报告
//   node tools/import-unreferenced-skins.mjs --apply       # 写回线上清单 + 仓库副本 + 补丁快照
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = process.env.SP_ROOT || path.resolve(ROOT, '..');
const ART = path.join(SP, 'shared', 'assets');          // 美术根（与线上一致）
const LIVE = path.join(SP, 'shared', 'data', 'assets.json');   // 线上清单（皮肤里是绝对 URL）
const REPO = path.join(ROOT, 'data', 'assets.json');           // 仓库副本（相对 /assets/...）
const PATCH = path.join(ROOT, 'patcher', 'features', 'game-core-data', 'files', 'data', 'assets.json');
const ORIGIN = 'https://assets.luobomiao.love';

const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? new Set(String(process.argv[i + 1] || '').split(',').filter(Boolean)) : null;
})();

const toModel = (sid) => String(sid).replace('@', '_').replace('#', '_');
const official = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'gamedata', 'excel', 'skin_table.json'), 'utf8'));
const DEFAULT_RE = /^char_\w+#\d+$/;

/** model → { name, group }（官方只给中文名与系列名） */
const info = new Map();
for (const [sid, sk] of Object.entries(official.charSkins || {})) {
  if (DEFAULT_RE.test(sid)) continue;
  const ds = sk.displaySkin || {};
  info.set(toModel(sid), { name: ds.skinName || null, group: ds.skinGroupName || null });
}

const docs = [];
for (const [label, file, abs] of [['live', LIVE, true], ['repo', REPO, false], ['patch', PATCH, false]]) {
  if (!fs.existsSync(file)) continue;
  docs.push({ label, file, abs, doc: JSON.parse(fs.readFileSync(file, 'utf8')) });
}
if (!docs.length) { console.error('找不到任何 assets.json'); process.exit(1); }

const live = docs[0].doc;
const url = (abs, rel) => (abs ? ORIGIN : '') + rel;

// 已引用（按模型目录名）
const referenced = new Set();
for (const ch of Object.values(live.chars || {})) {
  for (const [key, s] of Object.entries(ch.skins || {})) {
    if (s && s.spine && s.spine.front && s.spine.front.skel) {
      const m = /\/spine\/op\/[^/]+\/([^/]+)\/front\//.exec(s.spine.front.skel);
      if (m) referenced.add(`${m[1]}`);
    }
    referenced.add(key);
  }
}

const BASE = path.join(ART, 'spine', 'op');
const added = [];
for (const cid of fs.readdirSync(BASE)) {
  const cd = path.join(BASE, cid);
  if (!fs.statSync(cd).isDirectory()) continue;
  const ch = live.chars[cid];
  if (!ch) continue;                                  // 不是本局池子里的干员：不动
  for (const model of fs.readdirSync(cd)) {
    if (model === 'front' || model === 'back') continue;
    const front = path.join(cd, model, 'front');
    if (!fs.existsSync(front)) continue;
    const files = fs.readdirSync(front);
    const skel = files.find((f) => /\.skel$/i.test(f));
    if (!skel) continue;
    const base = skel.replace(/\.skel$/i, '');
    const atlas = files.find((f) => f === `${base}.atlas`) || files.find((f) => /\.atlas$/i.test(f));
    const pngs = files.filter((f) => /\.png$/i.test(f));
    if (!atlas || !pngs.length) continue;
    if (referenced.has(base) || referenced.has(model)) continue;
    if (ONLY && !ONLY.has(cid) && !ONLY.has(base)) continue;
    // 官方皮肤表里查不到记录的目录（当前只有 char_107_liskam/char_107_liskarm 这种本体副本）不收录：
    // 没有中文名，界面上只会多出一张写着模型 id 的「皮肤」。
    if (!info.get(model)?.name) continue;

    const relFront = `/assets/spine/op/${cid}/${model}/front`;
    const backDir = path.join(cd, model, 'back');
    let back = null;
    if (fs.existsSync(backDir)) {
      const bf = fs.readdirSync(backDir);
      const bskel = bf.find((f) => /\.skel$/i.test(f));
      if (bskel) {
        const bbase = bskel.replace(/\.skel$/i, '');
        const batlas = bf.find((f) => f === `${bbase}.atlas`) || bf.find((f) => /\.atlas$/i.test(f));
        const bpngs = bf.filter((f) => /\.png$/i.test(f));
        if (batlas) {
          back = {
            rel: `/assets/spine/op/${cid}/${model}/back`,
            skel: `${bbase}.skel`, atlas: batlas, textures: bpngs,
          };
        }
      }
    }

    const meta = info.get(model) || {};
    // ART 本身已经是 …/assets 目录：文件检查用 char/skin/…，URL 才用 /assets/char/skin/…
    const portraitRel = `/assets/char/skin/${model}.png`;
    const hasPortrait = fs.existsSync(path.join(ART, 'char', 'skin', `${model}.png`));
    const avatarRel = `/assets/char/skin_avatar/${model}.png`;
    const hasAvatar = fs.existsSync(path.join(ART, 'char', 'skin_avatar', `${model}.png`));

    const build = (abs) => {
      const o = { name: meta.name || model, type: 'outfit' };
      if (meta.group) o.group = meta.group;
      if (hasPortrait) { o.portrait = url(abs, portraitRel); o.portraitE2 = url(abs, portraitRel); }
      if (hasAvatar) o.avatar = url(abs, avatarRel);
      o.spine = {};
      for (const [side, d] of [['front', { rel: relFront, skel, atlas, textures: pngs }], ['back', back]]) {
        if (!d) continue;
        o.spine[side] = { skel: url(abs, `${d.rel}/${d.skel}`), atlas: url(abs, `${d.rel}/${d.atlas}`), textures: d.textures.map((t) => url(abs, `${d.rel}/${t}`)), pma: false };
      }
      return o;
    };

    added.push({ cid, model, base, meta, hasPortrait, hasAvatar, back: !!back, build });
  }
}

console.log(`磁盘上有、清单未引用、可补的皮肤模型: ${added.length} 套`);
const noName = added.filter((a) => !a.meta.name);
const noPortrait = added.filter((a) => !a.hasPortrait);
console.log(`  其中官方没有中文名（用模型名）: ${noName.length}${noName.length ? ' → ' + noName.slice(0, 5).map((a) => a.model).join(', ') : ''}`);
console.log(`  其中本地没有皮肤立绘（界面会回落本体立绘）: ${noPortrait.length}${noPortrait.length ? ' → ' + noPortrait.slice(0, 5).map((a) => a.model).join(', ') : ''}`);
for (const a of added.slice(0, 15)) console.log(`  ${a.cid.padEnd(20)} ${a.model.padEnd(34)} ${a.meta.name || '(无中文名)'}${a.back ? ' [含背身]' : ''}`);
if (added.length > 15) console.log(`  …另有 ${added.length - 1 - 14} 套`);

if (!APPLY) { console.log('\n(--dry-run，未写入；加 --apply 写入)'); process.exit(0); }

for (const { label, file, abs, doc } of docs) {
  let n = 0;
  for (const a of added) {
    const ch = doc.chars[a.cid];
    if (!ch) continue;
    ch.skins = ch.skins || {};
    if (ch.skins[a.model]) continue;
    ch.skins[a.model] = a.build(abs);
    n++;
  }
  const bak = file + '.bak-unrefskins';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify(doc, null, label === 'live' || label === 'repo' ? 2 : 0));
  console.log(`写入 ${label}: ${file}（新增 ${n} 套）`);
}
console.log('\n下一步：node tools/fix-skin-spine-meta.mjs --apply   # 补 anims/animations/events/hits/bounds');
