// matchmaker/roomDir.cjs — 「房间目录」要列出哪些房间（rooms.json / 后台 /api/admin2/rooms）。
//
// 为什么单独一个纯函数文件：matchmaker/server.js 是进程内起 HTTP 服务的 CommonJS，
// 没法把里面的逻辑 import 出来单测（同 openRooms.cjs 的理由）。
//
// 两类房间码：
//   codes     —— 普通房（单人 / 同盟）。节点上报的这一串同时被「按房间码找节点」的接口用
//                （/api/resolve-room、/api/room-redirect、/api/find-room），所以**不能**往里面塞深潜房。
//   echoCodes —— 「深渊回响」（深潜）房，节点单独上报（维护者 2026-11-06）。
//                它们只进目录，供节点控制台与管理后台显示；不进公开同盟列表、不参与匹配、也不参与跳转。
//
// 所以目录 = 两串合并（去重），而跳转只看 codes —— 这个文件只负责「合并」，不改变隔离。

/**
 * 房间目录里要列出的房间码：普通房 + 深潜房，去重并保持「先普通后深潜」的顺序。
 * @param {{ codes?: string[], echoCodes?: string[] } | null | undefined} entry 一个节点的上报
 * @returns {string[]}
 */
function dirCodes(entry) {
  const out = [];
  const seen = new Set();
  const push = (list) => {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      if (typeof c !== 'string' || !c || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
  };
  push(entry && entry.codes);
  push(entry && entry.echoCodes);
  return out;
}

module.exports = { dirCodes };
