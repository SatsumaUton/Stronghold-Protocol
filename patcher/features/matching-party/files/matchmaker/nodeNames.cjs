// matchmaker/nodeNames.cjs — 30 个节点的**中文名**（与节点目录 node-1…node-30 一一对应）。
//
// 为什么单独一个模块（维护者 2026-11-08）：玩家根本不认识「第 26 台节点」这种编号 ——
// 界面上他们看到的是顶栏那颗节点状态胶囊里的名字（「维多利亚 · 正常」）。所以凡是要
// **告诉玩家他的对局在哪**的地方（matchmaker 的 /api/account/room、节点状态列表）都得用名字。
// server.js 与 account.cjs 是两个独立的 CommonJS 模块，名字表只能有一份，放这里。
//
// ⚠ 这份表的顺序就是节点号：第 N 个名字 = node-N。改顺序等于改所有玩家的节点标识，
//   房间目录 / 后台 / 节点状态胶囊都对不上。

/** 30 个节点的中文名（index 0 = node-1）。 */
const NODE_NAMES = [
  '阿戈尔', '玻利瓦尔', '东', '杜林', '哥伦比亚',
  '卡西米尔', '卡兹戴尔', '拉特兰', '莱塔尼亚', '雷姆必拓',
  '米诺斯', '萨尔贡', '萨米', '维多利亚', '乌萨斯',
  '谢拉格', '叙拉古', '炎', '伊比利亚', '汐斯塔',
  '龙门', '伦蒂尼姆', '切尔诺伯格', '沃伦姆德', '长泉镇',
  '多索雷斯', '阿卡胡拉', '因非冰原', '焚风热土', '瓦伊凡',
];

/**
 * 节点号 → 中文名。越界 / 非整数返回 null（调用方据此退回不写名字的说法）。
 * @param {number|string} n 节点号（1…30）
 * @returns {string|null}
 */
function nodeNameOf(n) {
  const i = Number(n);
  return Number.isInteger(i) && i >= 1 && i <= NODE_NAMES.length ? NODE_NAMES[i - 1] : null;
}

module.exports = { NODE_NAMES, nodeNameOf };
