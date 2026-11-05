// server/match/match/echoProjection.js — 「盟约投影」：深渊回响的特殊祝福（维护者 2026-11-05）。
//
// 玩家反馈：想要一些特殊祝福，拿到之后**即使没有那条核心盟约**也能享受它的效果，而且让场上所有干员都有。
//
// 规则（维护者已确认）：
//   * 全程**只能同时存在一个**投影，不占 3 个祝福名额，也**不进**原版三选一祝福池；
//   * 获取方式是独立事件：16 层起每 10 层（16 / 26 / 36 …）一次，**全队投票三选一**；
//   * 已经有投影时再触发，选新的会**替换**旧的；
//   * 按**满档**生效（6 名不同干员那一档，阿戈尔是 5 名）—— 场上所有己方干员都算该盟约成员，
//     并且该盟约在这个玩家身上按满档激活（见 PlayerState.battleInput 的 projectedBond / bonds 注入）。
//
// 这里的 `desc` 直接取 data/bonds.json 里该盟约的原文（满档那一段），保证和官方设定一致。

/** 8 条核心盟约的投影（id 就是 bonds.json 的盟约 id）。 */
export const ECHO_PROJECTIONS = Object.freeze([
  Object.freeze({
    id: 'siracusaShip', name: '叙拉古', tier: 6,
    desc: '全体干员部署后攻速提升并进入隐匿；隐匿中与脱离隐匿 10 秒内攻击有概率造成真伤并恐惧',
  }),
  Object.freeze({
    id: 'yanShip', name: '炎', tier: 6,
    desc: '开战召唤炎佑（攻/血为炎干员总和的 30%，同时攻击 3 个目标，附带灼燃与元素脆弱）',
  }),
  Object.freeze({
    id: 'victoriaShip', name: '维多利亚', tier: 6,
    desc: '携带装备的干员造成的伤害提升；满档额外提升攻击力，带进阶装备时再提升',
  }),
  Object.freeze({
    id: 'sargonShip', name: '萨尔贡', tier: 6,
    desc: '干员开启技能时，全体干员攻速提升（有上限），满档还提供等持续时间的攻击力',
  }),
  Object.freeze({
    id: 'lateranoShip', name: '拉特兰', tier: 6,
    desc: '每消耗 1 发弹药，全体干员攻击力提升（有上限）',
  }),
  Object.freeze({
    id: 'kjeragShip', name: '谢拉格', tier: 6,
    desc: '造成的伤害提升（对寒冷 / 冻结敌人额外提升）；满档每 25 秒刮一阵寒风使敌人寒冷',
  }),
  Object.freeze({
    id: 'kazimierzShip', name: '卡西米尔', tier: 6,
    desc: '每次部署全体干员攻击力 +20% 至战斗结束；满档阻挡时造成真伤与晕眩、未阻挡时攻击附带真伤',
  }),
  Object.freeze({
    id: 'egirShip', name: '阿戈尔', tier: 5,
    desc: '生命值提升；开战吞噬身前一格干员获得其攻击与阻挡数；满档前 3 名干员首次被击倒时立刻复活',
  }),
]);

const BY_ID = new Map(ECHO_PROJECTIONS.map((p) => [p.id, p]));

/** 按盟约 id 取投影条目；未知返回 null。 */
export const echoProjectionById = (id) => BY_ID.get(String(id)) || null;

/**
 * 抽 3 个不同的投影候选（全队三选一）。
 *
 * 已有投影时**不排除**它自己：抽到它等于「保持现状」，玩家有拒绝替换的选择。
 * @param {() => number} rng 种子流
 * @param {string|null} [current] 当前投影 id
 * @returns {string[]} 3 个 id（数据不足时可能更少）
 */
export function pickProjectionOffer(rng = () => 0.5, current = null) {
  const pool = ECHO_PROJECTIONS.map((p) => p.id);
  const out = [];
  const avail = pool.slice();
  // 先保证当前那条在候选里（方便「不换」），再随机补满 3 条
  if (current && avail.includes(current)) {
    out.push(current);
    avail.splice(avail.indexOf(current), 1);
  }
  while (out.length < 3 && avail.length) {
    const i = Math.min(avail.length - 1, Math.floor((Number(rng()) || 0) * avail.length));
    out.push(avail.splice(i, 1)[0]);
  }
  return out;
}

/** 这个深度该不该开「盟约投影」事件：16 层起每 10 层（16 / 26 / 36 …）。 */
export const isEchoProjectionLayer = (depth) => {
  const d = Math.floor(Number(depth) || 0);
  return d >= 16 && (d - 16) % 10 === 0;
};
