// ui/echoSigils.js — 「深渊回响」每个词条 / 祝福 / 诅咒的徽记，**按效果设计**（维护者 2026-11-05）。
//
// 视觉语言（三条规则，玩家看两次就能读懂）：
//   1. **轮廓 = 被影响的东西**：攻击→剑、防御/生命→盾、攻速/移速→快进、回复→加号、
//      资金→图表、免费刷新→刷新、时限→沙漏、情报→眼睛、禁放/禁盟约→叉/钥匙、
//      词条上限→编辑、祝福上限→书、出怪量→人群、持续伤害→雪花、范围→展开；
//   2. **箭头 = 方向**：祝福/词条（对己方或敌方有利）▲，诅咒 ▼；
//   3. **箭头数量 = 强度**：1 个 = 小（≤6% / ≤60 点）、2 个 = 中、3 个 = 大（≥18% 或传说）。
// 这样「锐刃（攻击+6%）」是 剑+▲，「强攻（攻击+12%）」是 剑+▲▲，「钝刃（近战攻击−12%）」是 剑+▼▼，
// 一眼能分出是哪个方向的哪种效果，也不再出现两条 buff 长得一模一样。
//
// 纯函数，可在 Node 里断言（test/ui/echo-buffs.test.js）。

/** 诅咒 / 词条 / 祝福 → 轮廓图标名（复用仓库 ICONS 的 path）。 */
const DOMAIN = Object.freeze({
  // 攻击 / 伤害 / 破甲
  atk: 'sword', dmg: 'sword', pen: 'sword', enemyAtkMul: 'sword', unitMods: 'sword', rage: 'sword',
  frenzy: 'sword', fury: 'sword', savage: 'sword',
  // 防御 / 生命 / 法抗 / 阻挡
  hp: 'shield', def: 'shield', res: 'shield', taken: 'shield', block: 'shield',
  enemyHpMul: 'shield', carapace: 'shield', harden: 'shield', tough: 'shield', colossus: 'shield',
  ward: 'shield', sturdy: 'shield', bulwark: 'shield', giant: 'shield', aegis: 'shield', shield: 'shield',
  // 速度 / 时间
  spd: 'chevrons', swift: 'chevrons', dash: 'chevrons', quick: 'chevrons',
  timeMul: 'hourglass', crawl: 'hourglass', slow: 'hourglass',
  // 回复 / 再生
  regen: 'plus', heal: 'plus',
  // 经济
  coin: 'chart', fund: 'chart', coinMul: 'chart', bountyCoin: 'chart', shopPriceMul: 'chart',
  // 免费刷新 / 技力
  refresh: 'refresh', sp: 'refresh', freeRefresh: 'refresh',
  // 情报
  intel: 'eye', fog: 'eye', blackout: 'eye',
  // 禁制
  deployBan: 'close', bondBan: 'key', destroyEquip: 'close',
  // 上限 / 词条
  wordCap: 'edit', blessingMax: 'book',
  // 出怪量
  budgetMul: 'users', swarm: 'users',
  // 持续伤害
  dot: 'snow',
  // 范围
  range: 'expand',
  // 反制 / 净化
  cleanse: 'rotate', counter: 'rotate',
  // 对敌异常
  debuff: 'snow',
});

/** 从描述里估一个强度档（1..3）：有百分数按百分数，有绝对值按量级。 */
export function echoSigilLevel(b) {
  const text = String((b && (b.desc || b.descText)) || '');
  const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const v = Number(pct[1]);
    if (v >= 18) return 3;
    if (v >= 10) return 2;
    return 1;
  }
  const flat = text.match(/(\d+)/);
  if (flat) {
    const v = Number(flat[1]);
    if (v >= 150) return 3;
    if (v >= 60) return 2;
    return 1;
  }
  return b && b.rarity === 'epic' ? 3 : 1;
}

/**
 * 一条 buff 的徽记描述。
 *
 * @param {object} b 词条 / 祝福 / 诅咒（id + group/kind/effect.kind + desc）
 * @param {'enemy'|'ally'|'curse'} side
 * @returns {{ base: string, dir: 'up'|'down', level: number }}
 */
export function echoSigil(b, side) {
  const id = (b && b.id) || '';
  const key = (b && b.group) || (b && b.kind) || (b && b.effect && b.effect.kind) || '';
  // 少数需要按 id 特判的（语义比 group 更具体）
  const BY_ID = {
    miracle: 'refresh', foresight: 'chart', abyss_inflation: 'chart',
    shield_bond: 'shield', haste: 'chevrons', loot: 'chart', cleanse: 'rotate',
  };
  const base = BY_ID[id] || DOMAIN[id] || DOMAIN[key] || (side === 'curse' ? 'warn' : 'plus');
  const dir = side === 'curse' ? 'down' : 'up';
  return { base, dir, level: echoSigilLevel(b) };
}
