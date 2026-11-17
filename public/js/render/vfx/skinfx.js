// render/vfx/skinfx.js —— 皮肤专属特效的「基础名 → 皮肤名」替换表（data/skin-fx.json）。
//
// 官方机制（从皮肤预制件里读出来的）：皮肤把特效名加后缀，例如
//   shining_attack_01_hit  →  shining_attack_01_hit_summer#1
// 所以按玩家穿的皮肤查表，命中就把特效名换掉，否则用基础特效（行为与没有皮肤时一致）。
//
// 查表口径（与 index/library 一致）：键一律小写比较 —— 客户端 library.js has/url/def 与 skills.js lc()
// 都做 toLowerCase()，所以 `#20` 这类大小写差异不影响命中。
//
// 数据：/data/skin-fx.json（由 tools/local-extract 的皮肤特效抽取产出；没有该文件的安装返回空表）。
export const SKIN_FX_URL = '/data/skin-fx.json';

let mapPromise = null;

/**
 * 读替换表并整理成 `{ [skinId]: { [baseEffect]: skinEffect } }`（键小写）。
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Map<string, Map<string, string>>|null>} null = 没有该表
 */
export function loadSkinFxMap(fetchFn = globalThis.fetch) {
  if (!mapPromise) {
    mapPromise = (async () => {
      if (typeof fetchFn !== 'function') return null;
      try {
        const res = await fetchFn(SKIN_FX_URL);
        if (!res || !res.ok) return null;
        const doc = await res.json();
        return normalizeSkinFx(doc);
      } catch { return null; }
    })();
  }
  return mapPromise;
}

/**
 * 把 skin-fx.json 的 `skins: { charId: { model: { base: skin } } }` 摊平成按 skinId 索引的表。
 * @param {any} doc
 * @returns {Map<string, Map<string, string>>}
 */
export function normalizeSkinFx(doc) {
  const out = new Map();
  const skins = (doc && doc.skins) || {};
  for (const [, byModel] of Object.entries(skins)) {
    if (!byModel || typeof byModel !== 'object') continue;
    for (const [model, pairs] of Object.entries(byModel)) {
      if (!pairs || typeof pairs !== 'object') continue;
      const m = new Map();
      for (const [base, skin] of Object.entries(pairs)) {
        if (typeof base === 'string' && typeof skin === 'string') m.set(base.toLowerCase(), skin.toLowerCase());
      }
      if (m.size) out.set(model.toLowerCase(), m);
    }
  }
  return out;
}

/**
 * 某套皮肤把 effectKey 换成哪个特效名。
 * @param {Map<string, Map<string, string>>|null} map loadSkinFxMap 的结果
 * @param {string|null|undefined} skinId 单位穿的皮肤（Unit.skin）
 * @param {string|null|undefined} effectKey 基础特效名
 * @returns {string|null} 皮肤特效名（小写），或 null = 用基础特效
 */
export function skinEffectFor(map, skinId, effectKey) {
  if (!map || typeof skinId !== 'string' || !skinId || typeof effectKey !== 'string' || !effectKey) return null;
  const byBase = map.get(skinId.toLowerCase());
  if (!byBase) return null;
  return byBase.get(effectKey.toLowerCase()) || null;
}
