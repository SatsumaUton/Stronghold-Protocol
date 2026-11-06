// shared/titles.js — 玩家称号（维护者 2026-11-07）。
//
// 后台给账号设一个称号，房间里显示在玩家名字后面（`room.js` 的座位卡 / 观战列表）。
// 只存**id**（`accounts.title`），显示文案走这里 —— 这样：
//   * 改文案不用动数据库；
//   * 客户端用 `t(title.name)` 出多语言（四个语言包都要有这几条 msgid）；
//   * 加一个称号 = 这里加一条 + 后台下拉自动出现，不用改别处。
//
// 颜色只是给前端的 CSS 钩子（`.seat__title.is-<tone>`），不参与任何规则判定。

/**
 * @typedef {{ id: string, name: string, desc: string, tone: 'echo'|'gold'|'mint'|'blue' }} Title
 */

/** @type {readonly Title[]} */
export const TITLES = Object.freeze([
  {
    id: 'firstecho',
    name: '初响见证者',
    desc: '在「深渊回响」第一次开放时就踏进深渊的博士',
    tone: 'echo',
  },
  {
    id: 'abyss_pioneer',
    name: '深渊开拓者',
    desc: '早期参与深潜测试、帮我们摸清深层机制的博士',
    tone: 'echo',
  },
  {
    id: 'abyss_walker',
    name: '深渊行者',
    desc: '深潜深度长期排在全服前列的博士',
    tone: 'echo',
  },
  {
    id: 'bond_scholar',
    name: '盟约学者',
    desc: '对盟约搭配与数值有研究、给出过可靠结论的博士',
    tone: 'mint',
  },
  {
    id: 'veteran',
    name: '资深博士',
    desc: '从公测第一天就在的老玩家',
    tone: 'gold',
  },
  {
    id: 'tactician',
    name: '战术顾问',
    desc: '经常给出高质量战术建议、并被采纳的博士',
    tone: 'mint',
  },
  {
    id: 'community_star',
    name: '社区之星',
    desc: '在玩家群 / 论坛活跃、热心帮助新人的博士',
    tone: 'gold',
  },
  {
    id: 'guardian',
    name: '服务器守护者',
    desc: '帮忙排查线上问题、参与维护服务器的博士',
    tone: 'blue',
  },
]);

/** 所有合法称号 id（后台校验 / 前端白名单共用）。 */
export const TITLE_IDS = Object.freeze(TITLES.map((t) => t.id));

/** 按 id 取称号；未知 id 返回 null（老数据 / 手改数据库都不会让界面炸）。 */
export function titleById(id) {
  if (typeof id !== 'string' || !id) return null;
  return TITLES.find((t) => t.id === id) || null;
}

/** 称号的中文名（没有就 null）。 */
export function titleName(id) {
  const t = titleById(id);
  return t ? t.name : null;
}

/** 这个 id 是不是合法称号。 */
export function isTitleId(id) {
  return typeof id === 'string' && TITLE_IDS.includes(id);
}
