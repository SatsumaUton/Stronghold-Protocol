// ui/echoBuffs.js — 「深渊回响」词条/祝福的图标化显示（纯描述 + 薄渲染）。
//
// 为什么不直接画在战场单位头顶：客户端没有「单位头顶图标」的渲染通道，要新写 HUD 投影代码，
// 而那类代码没法在没有浏览器的环境里验证 —— 盲写很容易交付不可见或错位的东西。
// 所以这里做成两层：
//   1. `echoBuffChips()` 是**纯函数**，返回可断言的描述数组（单测直接测它，见 test/ui/echo-buffs.test.js）
//   2. `EchoBuffChips` 只做一层 map，用仓库已有的「首字圆片」兜底样式（与 BondDisc / sw-disc__txt 同款），
//      不引入新美术资源，也就不存在图标缺失的风险。
//
// 一个词条对全体敌人生效、一个祝福对全体己方生效，所以「图标」表达的是「本局挂着这几条」，
// 位置在状态条里，而不是逐单位。

/** 词条 / 祝福 → 视觉描述。glyph 用首字，tone 复用仓库已有的色板类名。 */
export const ECHO_BUFF_VISUALS = Object.freeze({
  // 侵蚀词条（敌人侧）—— 每个 id 一个可辨识的单字记号 + 按效果类别上色
  shield: { glyph: '盾', tone: 'def' },
  harden: { glyph: '硬', tone: 'def' },
  swift: { glyph: '疾', tone: 'spd' },
  rage: { glyph: '怒', tone: 'atk' },
  tough: { glyph: '韧', tone: 'def' },
  colossus: { glyph: '巨', tone: 'def' },
  carapace: { glyph: '甲', tone: 'def' },
  ward: { glyph: '护', tone: 'def' },
  frenzy: { glyph: '狂', tone: 'atk' },
  fury: { glyph: '愤', tone: 'atk' },
  dash: { glyph: '冲', tone: 'spd' },
  crawl: { glyph: '缓', tone: 'spd' },
  quick: { glyph: '快', tone: 'spd' },
  slow: { glyph: '滞', tone: 'spd' },
  savage: { glyph: '凶', tone: 'atk' },
  sturdy: { glyph: '坚', tone: 'def' },
  regen: { glyph: '再', tone: 'hp' },
  bulwark: { glyph: '堡', tone: 'def' },
  giant: { glyph: '巨', tone: 'def' },
  aegis: { glyph: '防', tone: 'def' },
  // 祝福（己方侧）
  fund: { glyph: '资', tone: 'coin' },
  haste: { glyph: '速', tone: 'spd' },
  loot: { glyph: '丰', tone: 'coin' },
});

/** 稀有度 → 圆片配色（诅咒用；固定规则走 special）。 */
const CURSE_TONE = Object.freeze({ common: 'common', rare: 'rare', epic: 'epic', special: 'gold' });

/**
 * 把 m.public.echo 里的词条 / 祝福 / 诅咒列成可渲染的图标描述。
 *
 * 诅咒这一侧是 2026-11-05 加的（维护者：不想点放大镜才知道身上挂了什么）——
 * 含固定规则（奇迹 / 远见 / 深渊通胀，`rarity: 'special'`）与随机诅咒，
 * 圆片按稀有度配色，悬浮给名字 + 效果。
 *
 * @param {{ words?: Array<{id: string, name?: string}>, blessings?: Array<{id: string, name?: string, desc?: string}>,
 *   curses?: Array<{id: string, name?: string, desc?: string, rarity?: string, rarityLabel?: string}> }} echo
 * @returns {Array<{ key: string, side: 'enemy'|'ally'|'curse', id: string, label: string, glyph: string, tone: string, title: string }>}
 */
/**
 * 圆片图标（维护者 2026-11-05：光靠首字太丑）。
 *
 * 全部复用仓库已有的 `ICONS` 图标集（components.js），不新增美术资源，也就不会出现缺图。
 * 词条按 id 精确映射；祝福按效果分组（group / kind）映射；诅咒统一用警示三角，固定规则用皇冠。
 */
const WORD_ICON = Object.freeze({
  shield: 'shield', harden: 'shield', tough: 'shield', colossus: 'shield', carapace: 'shield',
  ward: 'shield', sturdy: 'shield', bulwark: 'shield', giant: 'shield', aegis: 'shield',
  swift: 'chevrons', dash: 'chevrons', quick: 'chevrons', crawl: 'hourglass', slow: 'hourglass',
  rage: 'sword', frenzy: 'sword', fury: 'sword', savage: 'sword',
  regen: 'plus',
});
const GROUP_ICON = Object.freeze({
  atk: 'sword', dmg: 'sword', pen: 'sword',
  hp: 'shield', def: 'shield', res: 'shield', taken: 'shield', block: 'shield',
  spd: 'chevrons', sp: 'refresh',
  regen: 'plus', heal: 'plus',
  range: 'expand',
  coin: 'chart', fund: 'chart', refresh: 'refresh',
  cleanse: 'rotate', counter: 'rotate',
  debuff: 'snow',
});

/** 诅咒按效果类型给图标（维护者 2026-11-05：全用一个三角看不出是什么）。 */
const CURSE_ICON = Object.freeze({
  coinMul: 'chart', bountyCoin: 'chart', shopPriceMul: 'chart',
  lpMul: 'warn', lpExtra: 'warn',
  enemyAtkMul: 'sword', enemyHpMul: 'shield', unitMods: 'sword', budgetMul: 'users',
  timeMul: 'hourglass', freeRefresh: 'refresh', wordCap: 'edit', blessingMax: 'book',
  intel: 'eye', fog: 'eye', blackout: 'eye',
  deployBan: 'close', bondBan: 'key', destroyEquip: 'close', dot: 'snow',
});

/** 一个词条 / 祝福 / 诅咒该用哪个图标。 */
export function echoBuffIcon(b, side) {
  if (!b) return side === 'curse' ? 'warn' : 'plus';
  if (side === 'curse') {
    if (b.id === 'miracle') return 'refresh';
    if (b.id === 'foresight' || b.id === 'abyss_inflation') return 'chart';
    const kind = b.effect && b.effect.kind;
    return CURSE_ICON[kind] || (b.rarity === 'special' ? 'crown' : 'warn');
  }
  if (side === 'enemy') return WORD_ICON[b.id] || 'shield';
  if (b.id === 'shield_bond') return 'shield';
  if (b.id === 'haste') return 'chevrons';
  if (b.id === 'loot') return 'chart';
  return GROUP_ICON[b.group] || GROUP_ICON[b.kind] || 'plus';
}

export function echoBuffChips(echo) {
  const words = Array.isArray(echo?.words) ? echo.words : [];
  const tempBuffs = Array.isArray(echo?.tempBuffs) ? echo.tempBuffs : [];
  const blessings = Array.isArray(echo?.blessings) ? echo.blessings : [];
  const curses = Array.isArray(echo?.curses) ? echo.curses : [];
  const roundCurseId = echo?.roundCurse && typeof echo.roundCurse.id === 'string' ? echo.roundCurse.id : null;
  const out = [];
  for (const w of words) {
    if (!w || typeof w.id !== 'string') continue;
    const label = typeof w.name === 'string' && w.name ? w.name : w.id;
    const v = ECHO_BUFF_VISUALS[w.id] || { glyph: label.slice(0, 1) || '敌', tone: 'def' };
    // 本层词条（深潜补给）带 temporary/rounds：buff 栏打「本」角标（维护者 2026-11-05）
    const temp = w.temporary === true;
    const left = Number.isFinite(Number(w.roundsLeft)) ? Number(w.roundsLeft) : (temp ? 1 : null);
    const tag = temp ? '（本层）' : left != null ? `（剩余 ${left} 层）` : '';
    out.push({ key: `enemy:${w.id}`, side: 'enemy', id: w.id, raw: w, label, glyph: v.glyph, icon: echoBuffIcon(w, 'enemy'), tone: v.tone, temp, left, title: w.desc ? `${label}${tag} · ${w.desc}` : `${label}${tag}` });
  }
  // 本层临时 buff（深潜补给的词条）：**己方侧**，带「本」角标
  for (const w of tempBuffs) {
    if (!w || typeof w.id !== 'string') continue;
    const label = typeof w.name === 'string' && w.name ? w.name : w.id;
    const v = ECHO_BUFF_VISUALS[w.id] || { glyph: label.slice(0, 1) || '祝', tone: 'coin' };
    out.push({ key: `ally:${w.id}`, side: 'ally', id: w.id, raw: w, label, glyph: v.glyph, icon: echoBuffIcon(w, 'ally'), tone: v.tone, temp: true, left: 1, title: w.desc ? `${label}（本层） · ${w.desc}` : `${label}（本层）` });
  }
  // 「盟约投影」：当前生效的那条核心盟约投影（维护者 2026-11-05）—— 己方侧、金色、单独标记
  const proj = echo?.projection && echo.projection.current;
  if (proj && typeof proj.id === 'string') {
    const label = typeof proj.name === 'string' && proj.name ? proj.name : proj.id;
    out.push({ key: `ally:projection:${proj.id}`, side: 'ally', id: proj.id, raw: proj, label, glyph: '投', icon: echoBuffIcon(proj, 'ally'), tone: 'gold', projection: true, title: `盟约投影：${label}${proj.desc ? ` · ${proj.desc}` : ''}` });
  }
  for (const b of blessings) {
    if (!b || typeof b.id !== 'string') continue;
    const label = typeof b.name === 'string' && b.name ? b.name : b.id;
    const v = ECHO_BUFF_VISUALS[b.id] || { glyph: label.slice(0, 1) || '祝', tone: 'coin' };
    // 已消耗的祝福（护盾抵消过排异、一次性祝福）**留在列表里**，只是标成灰片 + 「已消耗」
    // （维护者 2026-11-05：护盾被诅咒抵消后不能凭空消失）
    const spent = b.consumed === true;
    const titleBase = spent ? `${label}（已消耗）` : label;
    out.push({ key: `ally:${b.id}`, side: 'ally', id: b.id, raw: b, label, glyph: v.glyph, icon: echoBuffIcon(b, 'ally'), tone: v.tone, consumed: spent, title: b.desc ? `${titleBase} · ${b.desc}` : titleBase });
  }
  for (const c of curses) {
    if (!c || typeof c.id !== 'string') continue;
    const label = typeof c.name === 'string' && c.name ? c.name : c.id;
    // 诅咒没有预设美术：用名字首字当记号（中文名首字基本都能认出来），配色按稀有度
    const glyph = label.slice(0, 1) || '诅';
    const tone = CURSE_TONE[c.rarity] || 'def';
    const tag = typeof c.rarityLabel === 'string' && c.rarityLabel ? `（${c.rarityLabel}）` : '';
    // 按层数到期的诅咒（排异 / 封锁）与本回合才有的诅咒：buff 栏打角标（维护者 2026-11-05）
    const temp = c.temporary === true;
    const left = Number.isFinite(Number(c.roundsLeft)) ? Number(c.roundsLeft) : (temp ? 1 : null);
    const when = temp ? '（本回合）' : left != null ? `（剩余 ${left} 层）` : '';
    // 本回合新刷出的那条诅咒：单独打上 roundCurse 标记，buff 栏把它排在最前面并高亮
    // （维护者 2026-11-05：要明显告诉玩家「这一层多了哪条诅咒」，好及时查看效果）
    const isRoundCurse = roundCurseId != null && c.id === roundCurseId;
    out.push({ key: `curse:${c.id}`, side: 'curse', id: c.id, raw: c, label, glyph, effectKind: (c.effect && c.effect.kind) || null, icon: echoBuffIcon(c, 'curse'), tone, temp, left, roundCurse: isRoundCurse, title: c.desc ? `${label}${tag}${when} · ${c.desc}` : `${label}${tag}${when}` });
  }
  return out;
}
