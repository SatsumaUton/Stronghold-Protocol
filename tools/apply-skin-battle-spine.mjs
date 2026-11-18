// apply-skin-battle-spine.mjs —— 把 39 套皮肤的战斗版 Spine 覆盖到磁盘，并更新清单里的动画元数据。
//
// 维护者确认：皮肤都有战斗模型，是我取错了文件。客户端同一套皮肤有两套骨架：
//   · `<model>#N.skel`           战斗（Attack/Die/Skill2_*）
//   · `build_<model>#N.skel`     委托室（Interact/Relax/Sit/Sleep）
// SkeletonDataAsset 的 skeletonJSON 指向哪套，官方就用哪套 —— 现网皮肤指向的是**战斗版**。
//
// 做法：文件名保持不变（仍是磁盘上的 `build_<model>.skel/.atlas/.png`，清单路径不用动），
// 只把**内容**换成战斗版；atlas 的页名行改回磁盘上真实存在的 png 文件名，否则贴图找不到。
// 清单里由 skel 推导的字段（anims / animations / durations / events / hits / bounds）重新计算。
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SP = 'D:/Stronghold-Protocol';
const REPO = `${SP}/repo-sync`;
const ART = `${SP}/shared/assets`;
const SRC = `${SP}/.cache/skinpack/battle-spine2/spine/op`;
const { parseSkel } = await import(pathToFileURL(`${REPO}/tools/assets/skel.mjs`).href);
const { resolveRoles } = await import(pathToFileURL(`${REPO}/tools/assets/anim-roles.mjs`).href);

const DRY = !process.argv.includes('--apply');

const manifests = [
  `${REPO}/data/assets.json`,
  `${REPO}/patcher/features/game-core-data/files/data/assets.json`,
];

/** 一张 atlas 文本：把页名行换成磁盘上真实存在的 png 文件名。 */
function repage(atlasText, pngName) {
  const lines = atlasText.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t && !t.includes(':') && /\.png$/i.test(t)) { lines[i] = pngName; break; }
  }
  return lines.join('\n');
}

const changes = [];
for (const cid of readdirSync(SRC)) {
  const cd = join(SRC, cid);
  for (const model of readdirSync(cd)) {
    const srcFront = join(cd, model, 'front');
    if (!existsSync(srcFront)) continue;
    const srcFiles = readdirSync(srcFront);
    const srcSkel = srcFiles.find((f) => f.endsWith('.skel'));
    if (!srcSkel) continue;

    // 磁盘上的目标目录与现有文件名
    const dstFront = join(ART, 'spine', 'op', cid, model, 'front');
    if (!existsSync(dstFront)) { changes.push({ model, skip: '磁盘目录不存在' }); continue; }
    const dstFiles = readdirSync(dstFront);
    const dstSkel = dstFiles.find((f) => f.endsWith('.skel'));
    const dstAtlas = dstFiles.find((f) => f.endsWith('.atlas'));
    const dstPng = dstFiles.find((f) => f.endsWith('.png'));
    if (!dstSkel || !dstAtlas || !dstPng) { changes.push({ model, skip: '磁盘缺 skel/atlas/png' }); continue; }

    const srcParsed = parseSkel(new Uint8Array(readFileSync(join(srcFront, srcSkel))));
    const hasAttack = (srcParsed.animations || []).some((n) => /attack/i.test(n));
    if (!hasAttack) { changes.push({ model, skip: '战斗版也没有 Attack' }); continue; }

    changes.push({ model, cid, dstFront, dstSkel, dstAtlas, dstPng, srcFront, srcFiles, anims: srcParsed.animations });
  }
}

console.log(`${DRY ? '（dry-run）' : ''} 待更新 ${changes.filter((c) => !c.skip).length} 套，跳过 ${changes.filter((c) => c.skip).length}`);
for (const c of changes.filter((x) => x.skip)) console.log(`  跳过 ${c.model}: ${c.skip}`);

if (!DRY) {
  for (const c of changes.filter((x) => !x.skip)) {
    const srcSkel = c.srcFiles.find((f) => f.endsWith('.skel'));
    const srcAtlas = c.srcFiles.find((f) => f.endsWith('.atlas'));
    const srcPng = c.srcFiles.find((f) => f.endsWith('.png'));
    copyFileSync(join(c.srcFront, srcSkel), join(c.dstFront, c.dstSkel));
    writeFileSync(join(c.dstFront, c.dstAtlas), repage(readFileSync(join(c.srcFront, srcAtlas), 'utf8'), c.dstPng), 'utf8');
    copyFileSync(join(c.srcFront, srcPng), join(c.dstFront, c.dstPng));
  }
  console.log('磁盘已更新');
}

// 清单：重算由 skel 推导的字段
const byModel = new Map(changes.filter((c) => !c.skip).map((c) => [c.model, c]));
let touched = 0;
for (const mf of manifests) {
  if (!existsSync(mf)) continue;
  const A = JSON.parse(readFileSync(mf, 'utf8'));
  for (const ch of Object.values(A.chars || {})) {
    for (const [model, sk] of Object.entries(ch.skins || {})) {
      const c = byModel.get(model);
      if (!c || !sk.spine) continue;
      for (const side of ['front', 'back']) {
        const sp = sk.spine[side];
        if (!sp) continue;
        const p = join(c.dstFront, c.dstSkel);
        const parsed = parseSkel(new Uint8Array(readFileSync(p)));
        sp.anims = resolveRoles(parsed.animations || []) || null;
        sp.animations = parsed.durations || null;
        sp.events = parsed.events || [];
        sp.hits = parsed.hits || {};
        sp.bounds = parsed.bounds || null;
        touched++;
      }
    }
  }
  if (!DRY) writeFileSync(mf, JSON.stringify(A, null, 2) + '\n', 'utf8');
  console.log(`${mf.replace(SP + '/', '')} → 重算 ${touched} 条`);
}
