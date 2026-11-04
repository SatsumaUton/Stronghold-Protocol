// server/match/match/echoBoard.js — 「深渊回响」的深潜排行榜（维护者 2026-11-03 定）。
//
// 存哪：**共用的 Redis**（`ecosystem.config.cjs` 里 30 台都配了 `SP_REDIS_URL`）。
//   * 每个**难度**一张有序集合：`sp:dive:board:NORMAL` / `:HARD` / `:ABYSS`，分数 = 深度 ——
//     这样「切换难度查看」是一次 ZREVRANGE，不用在客户端过滤（深度跨难度本来就不可比）。
//   * 每条成绩的明细（队伍成员、胜败、结束时间）另存一个 hash：`sp:dive:entry`，field = member。
//     列表一次 HMGET 就能把明细带回来，点开某一行不需要再发请求。
// 没有 Redis 时整个功能静默关闭 —— 不写、不报错、不影响对局。
//
// 名次口径：深度降序；同深度**先到者在前**（有序集合同分按 member 字典序，所以 member 前缀是
// 14 位零填充时间戳，天然满足，且两条成绩 member 永远不同、不会互相覆盖）。

/**
 * 全服共用的键前缀（2026-11-05 维护者：排行榜必须全服同步）。
 *
 * ⚠ 不能用 store.prefix —— 那是**每台节点自己的**命名空间（SP_REDIS_PREFIX = sp:n:），
 * 用它的话 node-1 写 sp:n1:dive:board、node-7 写 sp:n7:dive:board，30 台各看各的榜。
 */
export const ECHO_BOARD_SHARED_PREFIX = 'sp:shared:';

/** 明细 hash 的键名（落在**共用前缀**之后）。 */
export const ECHO_BOARD_ENTRY_KEY = 'dive:entry';
/** 深潜能上榜的难度（标准模拟不进深潜）。 */
export const ECHO_BOARD_DIFFICULTIES = Object.freeze(['NORMAL', 'HARD', 'ABYSS']);
/** 每个难度保留多少条。 */
export const ECHO_BOARD_LIMIT = 100;
/** 榜与明细多久过期（秒）。 */
export const ECHO_BOARD_TTL_SEC = 90 * 24 * 3600;

/** 某个难度的榜键；未知难度退回 HARD（与客户端默认档一致）。 */
export const echoBoardKeyFor = (difficulty) => {
  const d = ECHO_BOARD_DIFFICULTIES.includes(difficulty) ? difficulty : 'HARD';
  return `dive:board:${d}`;
};

/**
 * 榜上一条的 member：`<零填充时间戳>:<房间>:<局号>:<种子>`。
 *
 * 时间放最前面并零填充，是为了让「同深度先到者在前」成立（有序集合同分按 member 字典序排）。
 */
export function echoBoardMember(e = {}) {
  const at = Math.max(0, Math.floor(Number(e.at) || 0));
  const room = String(e.roomCode || '----').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || '----';
  const no = Math.max(0, Math.floor(Number(e.matchNo) || 0));
  const seed = String(e.seed ?? 0).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) || '0';
  return `${String(at).padStart(14, '0')}:${room}:${no}:${seed}`;
}

/**
 * 一条成绩。返回 null 表示不值得上榜（没进深潜 / 深度无效）。
 *
 * @param {{ depth?: number, round?: number, victory?: boolean, players?: string[], at?: number, difficulty?: string,
 *   roomCode?: string, matchNo?: number, seed?: number|string }} e
 */
export function echoBoardEntry(e = {}) {
  const depth = Math.floor(Number(e.depth) || 0);
  if (!(depth > 0)) return null;                       // 没进过深潜就没有成绩
  const at = Math.max(0, Math.floor(Number(e.at) || 0));
  const players = (Array.isArray(e.players) ? e.players : [])
    .map((p) => String(p || '').slice(0, 24)).filter(Boolean).slice(0, 8);
  const difficulty = ECHO_BOARD_DIFFICULTIES.includes(e.difficulty) ? e.difficulty : 'HARD';
  // 维护者 2026-11-05：榜上要展示「玩家 / 核心盟约 / 最高盟约数 / 通关时间」。
  const squads = (Array.isArray(e.squads) ? e.squads : [])
    .map((s) => ({
      name: String((s && s.name) || '').slice(0, 24),
      cores: (Array.isArray(s && s.cores) ? s.cores : []).map((b) => String(b || '').slice(0, 16)).filter(Boolean).slice(0, 4),
      bonds: Math.max(0, Math.floor(Number(s && s.bonds) || 0)),
      // 最高盟约层数（维护者 2026-11-05）：只看层数，不看词条/稀有度
      maxLayers: Math.max(0, Math.floor(Number(s && s.maxLayers) || 0)),
    }))
    .filter((s) => s.name)
    .slice(0, 8);
  const maxBonds = Math.max(0, ...squads.map((s) => s.bonds));
  const maxLayers = Math.max(0, ...squads.map((s) => s.maxLayers));
  const clearMs = Math.max(0, Math.floor(Number(e.clearMs) || 0));
  return {
    member: echoBoardMember({ at, roomCode: e.roomCode, matchNo: e.matchNo, seed: e.seed }),
    depth,
    round: Math.max(1, Math.floor(Number(e.round) || 0)),
    victory: e.victory === true,
    players,
    squads,
    maxBonds,
    maxLayers,
    clearMs,
    difficulty,
    at,
  };
}

/**
 * 把 `ZREVRANGE … WITHSCORES` 的扁平回包解成条目数组（明细可选）。
 *
 * @param {Array<string|number>} flat [member, score, member, score, …]
 * @param {{ limit?: number, details?: Record<string, any>, difficulty?: string }} [opts]
 */
export function parseEchoBoard(flat, { limit = ECHO_BOARD_LIMIT, details = null, difficulty = null } = {}) {
  const rows = Array.isArray(flat) ? flat : [];
  const out = [];
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const member = String(rows[i] ?? '');
    const depth = Math.floor(Number(rows[i + 1]) || 0);
    if (!member || !(depth > 0)) continue;
    const parts = member.split(':');
    const d = details && details[member] && typeof details[member] === 'object' ? details[member] : null;
    out.push({
      rank: out.length + 1,
      member,
      depth,
      at: Number(parts[0]) || 0,
      roomCode: parts[1] || null,
      matchNo: Number(parts[2]) || 0,
      difficulty: (d && d.difficulty) || difficulty || null,
      victory: !!(d && d.victory === true),
      round: d ? Math.max(0, Math.floor(Number(d.round) || 0)) : 0,
      players: d && Array.isArray(d.players) ? d.players.slice(0, 8) : [],
      squads: d && Array.isArray(d.squads) ? d.squads.slice(0, 8) : [],
      maxBonds: d ? Math.max(0, Math.floor(Number(d.maxBonds) || 0)) : 0,
      maxLayers: d ? Math.max(0, Math.floor(Number(d.maxLayers) || 0)) : 0,
      clearMs: d ? Math.max(0, Math.floor(Number(d.clearMs) || 0)) : 0,
    });
  }
  return out.slice(0, Math.max(1, Math.floor(Number(limit) || ECHO_BOARD_LIMIT)));
}

/**
 * 键 = **全服共用前缀** + 名字。
 *
 * ⚠ 这里刻意**不用** `store.prefix`：那是每台节点自己的命名空间（`SP_REDIS_PREFIX = sp:n${n}:`），
 * 用它的话 node-1 写 `sp:n1:dive:board`、node-7 写 `sp:n7:dive:board`，30 台各看各的榜，
 * 玩家看到的排行榜就像「没同步」（2026-11-05 实测就是这样）。
 */
const storeKey = (store, name) => `${ECHO_BOARD_SHARED_PREFIX}${name}`;

/**
 * 把 Redis 回包转成字符串。
 *
 * ⚠ ValkeyClient 默认回 **Buffer**（不是 string）：以前这里用 `typeof v !== 'string'` 过滤，
 * 结果明细全部被当成坏值丢掉 —— 榜上有名次，但玩家名 / 回合永远是空（2026-11-05 实测）。
 */
const asText = (v) => (typeof v === 'string' ? v : Buffer.isBuffer(v) ? v.toString('utf8') : v == null ? '' : String(v));

/**
 * 记一条成绩：写进**该难度**的榜，同时写一份明细。
 * 全程 try/catch —— Redis 挂了、命令被拒、对局在收尾，都不该让结算失败。
 *
 * @param {{ client?: { command: Function }, prefix?: string }|null} store
 * @param {ReturnType<typeof echoBoardEntry>} entry
 * @returns {Promise<boolean>}
 */
export async function recordEchoBoard(store, entry) {
  if (!store || !store.client || typeof store.client.command !== 'function') return false;
  if (!entry || !entry.member) return false;
  const board = storeKey(store, echoBoardKeyFor(entry.difficulty));
  const detail = storeKey(store, ECHO_BOARD_ENTRY_KEY);
  try {
    await store.client.command('ZADD', board, String(entry.depth), entry.member);
    // 只留前 LIMIT 条（删掉最低的一段）
    await store.client.command('ZREMRANGEBYRANK', board, '0', String(-(ECHO_BOARD_LIMIT + 1)));
    await store.client.command('EXPIRE', board, String(ECHO_BOARD_TTL_SEC));
    await store.client.command('HSET', detail, entry.member, JSON.stringify({
      players: entry.players, victory: entry.victory, round: entry.round, difficulty: entry.difficulty,
      squads: entry.squads, maxBonds: entry.maxBonds, clearMs: entry.clearMs,
    }));
    await store.client.command('EXPIRE', detail, String(ECHO_BOARD_TTL_SEC));
    return true;
  } catch {
    return false;
  }
}

/**
 * 读某个难度的榜（深度降序），明细一起带回来。
 *
 * @param {{ client?: { command: Function }, prefix?: string }|null} store
 * @param {{ difficulty?: string, limit?: number }} [opts]
 * @returns {Promise<ReturnType<typeof parseEchoBoard>>}
 */
export async function readEchoBoard(store, { difficulty = 'HARD', limit = ECHO_BOARD_LIMIT } = {}) {
  if (!store || !store.client || typeof store.client.command !== 'function') return [];
  const n = Math.max(1, Math.floor(Number(limit) || ECHO_BOARD_LIMIT));
  const board = storeKey(store, echoBoardKeyFor(difficulty));
  try {
    const flat = await store.client.command('ZREVRANGE', board, '0', String(n - 1), 'WITHSCORES');
    const rows = Array.isArray(flat) ? flat : [];
    const members = [];
    for (let i = 0; i + 1 < rows.length; i += 2) members.push(asText(rows[i]));
    let details = null;
    if (members.length) {
      try {
        const raw = await store.client.command('HMGET', storeKey(store, ECHO_BOARD_ENTRY_KEY), ...members);
        if (Array.isArray(raw)) {
          details = {};
          for (let i = 0; i < members.length; i++) {
            const v = asText(raw[i]);
            if (!v) continue;
            try { details[members[i]] = JSON.parse(v); } catch { /* 坏值就当没有 */ }
          }
        }
      } catch { /* 明细读不到不影响名次 */ }
    }
    return parseEchoBoard(rows, { limit: n, details, difficulty });
  } catch {
    return [];
  }
}
