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
  // 侵蚀词条（敌人侧）
  shield: { glyph: '盾', tone: 'def' },
  harden: { glyph: '硬', tone: 'def' },
  swift: { glyph: '疾', tone: 'spd' },
  rage: { glyph: '怒', tone: 'atk' },
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
export function echoBuffChips(echo) {
  const words = Array.isArray(echo?.words) ? echo.words : [];
  const blessings = Array.isArray(echo?.blessings) ? echo.blessings : [];
  const curses = Array.isArray(echo?.curses) ? echo.curses : [];
  const out = [];
  for (const w of words) {
    if (!w || typeof w.id !== 'string') continue;
    const v = ECHO_BUFF_VISUALS[w.id] || { glyph: '?', tone: 'def' };
    const label = typeof w.name === 'string' && w.name ? w.name : w.id;
    out.push({ key: `enemy:${w.id}`, side: 'enemy', id: w.id, label, glyph: v.glyph, tone: v.tone, title: w.desc ? `${label} · ${w.desc}` : label });
  }
  for (const b of blessings) {
    if (!b || typeof b.id !== 'string') continue;
    const v = ECHO_BUFF_VISUALS[b.id] || { glyph: '?', tone: 'coin' };
    const label = typeof b.name === 'string' && b.name ? b.name : b.id;
    out.push({ key: `ally:${b.id}`, side: 'ally', id: b.id, label, glyph: v.glyph, tone: v.tone, title: b.desc ? `${label} · ${b.desc}` : label });
  }
  for (const c of curses) {
    if (!c || typeof c.id !== 'string') continue;
    const label = typeof c.name === 'string' && c.name ? c.name : c.id;
    // 诅咒没有预设美术：用名字首字当记号（中文名首字基本都能认出来），配色按稀有度
    const glyph = label.slice(0, 1) || '诅';
    const tone = CURSE_TONE[c.rarity] || 'def';
    const tag = typeof c.rarityLabel === 'string' && c.rarityLabel ? `（${c.rarityLabel}）` : '';
    out.push({ key: `curse:${c.id}`, side: 'curse', id: c.id, label, glyph, tone, title: c.desc ? `${label}${tag} · ${c.desc}` : `${label}${tag}` });
  }
  return out;
}
