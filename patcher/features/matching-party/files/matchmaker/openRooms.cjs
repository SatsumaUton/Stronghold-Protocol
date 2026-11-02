// matchmaker/openRooms.cjs — 「跨节点公开同盟」的纯筛选逻辑（CommonJS，供 server.js 与测试共用）。
//
// 为什么要单独一个文件：matchmaker/server.js 是 CommonJS（`require` + 进程内起 HTTP 服务），
// 没法在里面 `export` 给单测用 —— 以前为了「测一下筛选规则」只能把它整段复制到测试里，
// 复制出来的一改就跟线上不一样了。这里只放**没有 I/O** 的判断，读写 Redis 仍在 server.js。
//
// 数据来源：每个节点的 Lobby 把房间写进 Redis 的 `sp:n<node>:lobby:rooms` 哈希
// （field = 房间码，value = server/persist/lobbyState.js 的 roomDoc）。
// `listed` / `matchmaking` 两个字段就是这里判定的依据 —— 2026-11-02 之前 lobbyState
// 根本没存 `listed`，所以匹配服务即使读到房间也不知道哪间是公开的，跨节点列表永远是空的。

/** 默认座位数（与 shared/constants.js 的 MAX_SEATS 一致）。 */
const SEATS = 4;

/**
 * 一间房要不要出现在跨节点「公开同盟」列表里。
 *
 * 条件与节点内 `Lobby.roomList()` 一致：挂了公开同盟、还没开局、还有空位。
 * 额外返回 `node` —— 客户端没有它就不知道该用 `?n=` 连到哪台节点。
 *
 * @param {string} code 房间码（Redis 哈希的 field）
 * @param {number} node 节点号 1..30
 * @param {any} doc 房间文档（lobbyState.roomDoc 的产物）
 * @returns {null | { code: string, node: number, host: string, humans: number, filled: number,
 *   capacity: number, difficulty: string|null, version: string, matchmaking: boolean, experimental: boolean }}
 */
function pickOpenRoom(code, node, doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.listed !== true) return null;                        // 没挂公开同盟
  if (doc.matchLive || doc.matchKey || doc.match) return null;  // 已经开局（或开局中）
  const seats = Array.isArray(doc.seats) ? doc.seats : [];
  const taken = seats.filter(Boolean).length;
  const capacity = Number(doc.capacity ?? (doc.experimental && doc.experimental.playerCapacity) ?? SEATS);
  const cap = Number.isInteger(capacity) && capacity > 0 ? capacity : SEATS;
  if (taken >= cap) return null;                               // 满员
  const hostSeat = seats.find((s) => s && doc.hostId && s.playerId === doc.hostId) || seats.find(Boolean);
  return {
    code: String(code || doc.code || ''),
    node: Number(node) || 0,
    host: String((hostSeat && hostSeat.name) || ''),
    humans: seats.filter((s) => s && !s.isBot).length,
    filled: taken,
    capacity: cap,
    difficulty: doc.difficulty || null,
    version: typeof doc.version === 'string' && doc.version ? doc.version : 'act2autochess',
    matchmaking: doc.matchmaking === true,
    experimental: !!(doc.experimental && typeof doc.experimental === 'object' && Object.keys(doc.experimental).length),
  };
}

/**
 * 把「所有节点 HGETALL 回来的一堆 (field, value) 平铺数组」筛成公开同盟列表。
 *
 * 排序和节点内 `room.list` 一致：空位少的在前，同样多按房间码。
 * @param {Array<{ node: number, flat: string[] }>} perNode
 */
function collectOpenRooms(perNode) {
  const out = [];
  for (const { node, flat } of perNode) {
    if (!Array.isArray(flat)) continue;
    for (let k = 0; k + 1 < flat.length; k += 2) {
      let doc = null;
      try { doc = JSON.parse(flat[k + 1]); } catch { continue; }
      const row = pickOpenRoom(flat[k], node, doc);
      if (row) out.push(row);
    }
  }
  out.sort((a, b) => (a.capacity - a.filled) - (b.capacity - b.filled) || a.code.localeCompare(b.code));
  return out;
}

module.exports = { SEATS, pickOpenRoom, collectOpenRooms };
