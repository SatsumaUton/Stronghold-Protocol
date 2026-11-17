// tools/token-skin-catalogue.mjs —— 「召唤物皮肤」的期望口径（维护者 2026-11-18）。
//
// 统计「我们缺哪些召唤物皮肤」时，会把一批**官方本来就不画战斗模型**的条目也算进来，于是每次巡检
// 都在追一个永远追不到的东西。最典型的例子是乌尔比安的阻挡物：
//
//   char_4145_ulpia@epoque#48.tokenSkinMap → [{ tokenId: token_10039_ulpia_block,
//                                               tokenSkinId: token_10039_ulpia_block_epoque#48 }]
//        —— 官方**确实**把「注目深渊」接到了这个召唤物上；
//   charSkins["token_10039_ulpia_block_epoque#48"].portraitId → **null**（没给立绘）；
//   activity_table 里该 token 的 tokenDisplayType → **HIDDEN**；
//   character_table.tokens 里没有这条记录；
//   客户端 prefab（`dyn/battle/prefabs/[uc]tokens/<id>.prefab`）里放的是 EmptyAnimator 而不是 Spine
//   （tools/local-extract/extract.py 的 TOKEN_SPINES 注释已经写明：token_10039 / 10058 / 10055 / 10065 / 10071）。
//   → 所以四个镜像站 + 17.8 GB 作者整包里对 `token_10039*` 是 **0 命中**，这不是「我们漏了」。
//
// 判定规则（只影响**统计 / 巡检口径**，不改任何美术与玩法）：
//   一条召唤物皮肤算「官方未给可见表现」，当且仅当
//     ① 它是 token 皮肤（skinId 以 `token_` 开头）；
//     ② 它自己的 `portraitId` 是 `null`（官方没给立绘）；
//     ③ 它所属 token 的 `tokenDisplayType` 是 `HIDDEN`（官方不画它，用特效/空对象）。
//   有立绘、或 token 不是 HIDDEN 的，一律仍按「缺」处理（那些是真该补的）。
//
// 用法：
//   const cat = tokenSkinCatalogue(skinTableJson, activityTableJson);
//   cat.hiddenModels.has('token_10039_ulpia_block_epoque_48')  // true → 官方本就不画，不算缺
import { readFileSync, existsSync } from 'node:fs';

/** `char_4177_brigid_epoque#53` → `char_4177_brigid_epoque_53`（清单里的模型名） */
export const toModel = (skinId) => String(skinId).replace('@', '_').replace('#', '_');

/**
 * 官方**不画 Spine** 的召唤物（前缀匹配）。出处：tools/local-extract/extract.py 的 TOKEN_SPINES 注释
 * （第 325–327 行）—— 这些 token 的战斗预制件里放的是 EmptyAnimator（或只有特效），
 * 提取器本来就不从客户端抽它们的模型：
 *   乌尔比安's 从不混淆的方向 / 圣聆初雪's frozen protection point / 酒神's 迷狂牢笼 /
 *   贝洛内's 牵绊 / 予愿安洁莉娜's “一会儿见！”
 * = token_10039 / 10058 / 10055 / 10065 / 10071。
 */
export const NO_SPINE_TOKEN_PREFIXES = Object.freeze([
  'token_10039_', 'token_10058_', 'token_10055_', 'token_10065_', 'token_10071_',
]);
export const isNoSpineToken = (tokenId) => NO_SPINE_TOKEN_PREFIXES.some((p) => String(tokenId).startsWith(p));

/**
 * 分成「官方有可见表现」与「官方本来就不画」的召唤物皮肤。
 * @param {any} skinTable `skin_table.json`
 * @returns {{ visible: Map<string, string[]>, hiddenSkins: Set<string>, hiddenModels: Set<string> }}
 */
export function tokenSkinCatalogue(skinTable) {
  const skins = (skinTable && skinTable.charSkins) || {};
  const visible = new Map();
  const hiddenSkins = new Set();

  for (const [skinId, rec] of Object.entries(skins)) {
    if (!skinId.startsWith('token_')) continue;
    const tokenId = rec && typeof rec.charId === 'string' ? rec.charId : null;
    if (!tokenId) continue;
    const hasPortrait = rec.portraitId != null && rec.portraitId !== '';
    if (!hasPortrait && isNoSpineToken(tokenId)) { hiddenSkins.add(skinId); continue; }
    if (!visible.has(tokenId)) visible.set(tokenId, []);
    visible.get(tokenId).push(skinId);
  }
  return { visible, hiddenSkins, hiddenModels: new Set([...hiddenSkins].map(toModel)) };
}

/** 读官方的 skin_table / activity_table（缺文件时返回 null，调用方按「不排除任何条目」处理）。 */
export function readOfficialTables(root = 'D:/Stronghold-Protocol/repo-sync') {
  const base = `${root}/.cache/gamedata/excel/`;
  const load = (f) => { const p = base + f; if (!existsSync(p)) return null; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  return { skinTable: load('skin_table.json'), activityTable: load('activity_table.json') };
}
