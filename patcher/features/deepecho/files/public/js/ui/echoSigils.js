// ui/echoSigils.js — 「深渊回响」每个词条 / 祝福 / 诅咒的**独立徽记**（维护者 2026-11-05）。
//
// 为什么需要它：仓库自带 ICONS 只有 39 个图标，而祝福 + 诅咒 + 词条一共 110+ 条，
// 直接映射必然重复（截图里三个盾、三个皇冠、三个三角）。又不能为每条画一张新美术。
//
// 做法：**轮廓按类别**（防御=盾、攻击=剑、经济=图表、情报=眼睛、时间=沙漏、禁制=钥匙/叉…）
// + **内圈点阵按 id 哈希**（8 个位置 + 中心，共 512 种）。同一类别的两条 buff 轮廓相同，
// 但点阵不同 —— 一眼能区分，且完全确定性（同一个 id 每次画出来一模一样）。
//
// 纯函数，可在 Node 里断言（test/ui/echo-buffs.test.js）。

/** 稳定的字符串哈希（FNV-1a 32 位），同一个 id 永远得到同一个数。 */
export function echoSigilHash(id) {
  const s = String(id || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 轮廓图标名（复用仓库 ICONS 的 path）。 */
const CURSE_BASE = Object.freeze({
  coinMul: 'chart', bountyCoin: 'chart', shopPriceMul: 'chart',
  lpMul: 'warn', lpExtra: 'warn',
  enemyAtkMul: 'sword', enemyHpMul: 'shield', unitMods: 'sword', budgetMul: 'users',
  timeMul: 'hourglass', freeRefresh: 'refresh', wordCap: 'edit', blessingMax: 'book',
  intel: 'eye', fog: 'eye', blackout: 'eye',
  deployBan: 'close', bondBan: 'key', destroyEquip: 'close', dot: 'snow',
});
const WORD_BASE = Object.freeze({
  shield: 'shield', harden: 'shield', tough: 'shield', colossus: 'shield', carapace: 'shield',
  ward: 'shield', sturdy: 'shield', bulwark: 'shield', giant: 'shield', aegis: 'shield',
  swift: 'chevrons', dash: 'chevrons', quick: 'chevrons', crawl: 'hourglass', slow: 'hourglass',
  rage: 'sword', frenzy: 'sword', fury: 'sword', savage: 'sword', regen: 'plus',
});
const GROUP_BASE = Object.freeze({
  atk: 'sword', dmg: 'sword', pen: 'sword',
  hp: 'shield', def: 'shield', res: 'shield', taken: 'shield', block: 'shield',
  spd: 'chevrons', sp: 'refresh',
  regen: 'plus', heal: 'plus',
  range: 'expand',
  coin: 'chart', fund: 'chart', refresh: 'refresh',
  cleanse: 'rotate', counter: 'rotate',
  debuff: 'snow',
});

/** 内圈 9 个点位（中心 + 一圈 8 个），单位是 24×24 视图坐标。 */
const DOT_SLOTS = Object.freeze([
  [12, 12], [12, 5], [16.5, 7.5], [19, 12], [16.5, 16.5], [12, 19], [7.5, 16.5], [5, 12], [7.5, 7.5],
]);

/**
 * 一条 buff 的徽记描述。
 *
 * @param {object} b 词条 / 祝福 / 诅咒（至少要有 id，诅咒还要 effect.kind）
 * @param {'enemy'|'ally'|'curse'} side
 * @returns {{ base: string, dots: Array<[number, number]>, tone: string }}
 */
export function echoSigil(b, side, tone = 'def') {
  const id = (b && b.id) || '';
  let base = 'plus';
  if (side === 'curse') {
    if (id === 'miracle') base = 'refresh';
    else if (id === 'foresight' || id === 'abyss_inflation') base = 'chart';
    else base = CURSE_BASE[b && b.effect && b.effect.kind] || 'warn';
  } else if (side === 'enemy') {
    base = WORD_BASE[id] || 'shield';
  } else {
    if (id === 'shield_bond') base = 'shield';
    else if (id === 'haste') base = 'chevrons';
    else if (id === 'loot') base = 'chart';
    else base = GROUP_BASE[b && b.group] || GROUP_BASE[b && b.kind] || 'plus';
  }
  const h = echoSigilHash(id);
  // 每个 id 固定点亮 3 个点（512 种组合），同类别的两条 buff 靠这个区分
  const dots = [];
  let seed = h;
  while (dots.length < 3) {
    const at = seed % DOT_SLOTS.length;
    if (!dots.some((d) => d[0] === DOT_SLOTS[at][0] && d[1] === DOT_SLOTS[at][1])) dots.push(DOT_SLOTS[at]);
    seed = (seed * 1103515245 + 12345) >>> 0;
  }
  return { base, dots, tone };
}
