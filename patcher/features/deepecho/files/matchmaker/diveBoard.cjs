// matchmaker/diveBoard.cjs — 「深渊回响」成绩归档（MySQL）。
//
// 排行榜本身仍在 Redis（server/match/match/echoBoard.js，毫秒级读取）；
// 这里只做**永久留档**：Redis 的榜有 90 天 TTL，且节点重启/键被清就没有历史。
//
// 数据流：节点结算 → POST /api/dive/report（本机 127.0.0.1:3090）→ 这里 INSERT。
// 幂等：同一个 member（时间戳:房间:局号:种子）重复上报只更新，不会产生重复行。
//
// 安全：写入只接受**本机**调用（节点与 matchmaker 同机），公网进来的请求一律 403。

const crypto = require('node:crypto');

const MAX_BODY = 64 * 1024;
const MAX_PLAYERS = 8;
const MAX_NAME = 24;

const DDL = `
CREATE TABLE IF NOT EXISTS dive_board (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  member_hash CHAR(64) NOT NULL,
  member VARCHAR(120) NOT NULL,
  depth INT NOT NULL,
  difficulty VARCHAR(16) NOT NULL,
  rounds INT NOT NULL DEFAULT 0,
  victory TINYINT(1) NOT NULL DEFAULT 0,
  players VARCHAR(512) NOT NULL DEFAULT '',
  room_code VARCHAR(16) NOT NULL DEFAULT '',
  seed VARCHAR(32) NOT NULL DEFAULT '',
  ended_at DATETIME NOT NULL,
  reported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_member (member_hash),
  KEY idx_diff_depth (difficulty, depth, ended_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** 归档用的连接池：复用 matchmaker/account.cjs 已有的 MySQL 池。 */
function pool() {
  return require('./account.cjs').db();
}

/** 建表（启动时调用；表已存在就是空操作）。 */
async function init() {
  try {
    await pool().query(DDL);
    return true;
  } catch (e) {
    console.warn('[mm] dive_board init failed:', e && e.message);
    return false;
  }
}

const clampInt = (v, lo, hi, dflt = 0) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, max);

/**
 * 记一条成绩（幂等：同一 member 再来只更新数值，不会多一行）。
 *
 * @param {{ member?: string, depth?: number, difficulty?: string, round?: number, victory?: boolean,
 *   players?: string[], roomCode?: string, seed?: string|number, at?: number }} e
 * @returns {Promise<boolean>} 写入成功与否（失败不抛，调用方是 fire-and-forget）
 */
async function record(e = {}) {
  const member = cleanText(e.member, 120);
  const depth = clampInt(e.depth, 1, 1e6, 0);
  if (!member || !(depth > 0)) return false;
  const difficulty = ['NORMAL', 'HARD', 'ABYSS'].includes(e.difficulty) ? e.difficulty : 'HARD';
  const players = (Array.isArray(e.players) ? e.players : [])
    .map((p) => cleanText(p, MAX_NAME)).filter(Boolean).slice(0, MAX_PLAYERS);
  const rounds = clampInt(e.round, 0, 1e6, 0);
  const at = clampInt(e.at, 0, 4e12, Date.now());
  const endedAt = new Date(at || Date.now());
  const hash = crypto.createHash('sha256').update(member).digest('hex');
  try {
    await pool().query(
      `INSERT INTO dive_board (member_hash, member, depth, difficulty, rounds, victory, players, room_code, seed, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE depth = VALUES(depth), difficulty = VALUES(difficulty), rounds = VALUES(rounds),
         victory = VALUES(victory), players = VALUES(players), room_code = VALUES(room_code), seed = VALUES(seed),
         ended_at = VALUES(ended_at), reported_at = CURRENT_TIMESTAMP`,
      [hash, member, depth, difficulty, rounds, e.victory === true ? 1 : 0, players.join(','),
        cleanText(e.roomCode, 16), cleanText(e.seed, 32), endedAt],
    );
    return true;
  } catch (err) {
    console.warn('[mm] dive_board record failed:', err && err.message);
    return false;
  }
}

/** 历史查询（按难度、深度降序）。管理后台/排障用。 */
async function recent({ difficulty = null, limit = 50 } = {}) {
  const n = clampInt(limit, 1, 500, 50);
  try {
    const where = difficulty ? 'WHERE difficulty = ?' : '';
    const args = difficulty ? [String(difficulty), n] : [n];
    const [rows] = await pool().query(
      `SELECT member, depth, difficulty, rounds, victory, players, room_code, ended_at
         FROM dive_board ${where} ORDER BY depth DESC, ended_at ASC LIMIT ?`, args,
    );
    return rows.map((r) => ({
      member: r.member, depth: Number(r.depth), difficulty: r.difficulty, round: Number(r.rounds),
      victory: Number(r.victory) === 1, players: String(r.players || '').split(',').filter(Boolean),
      roomCode: r.room_code, at: new Date(r.ended_at).getTime(),
    }));
  } catch (err) {
    console.warn('[mm] dive_board recent failed:', err && err.message);
    return [];
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

const isLoopback = (req) => {
  const a = String((req.socket && req.socket.remoteAddress) || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

/**
 * /api/dive/* 的路由。
 *
 *   POST /api/dive/report   — 节点上报一条成绩（只允许本机）
 *   GET  /api/dive/history  — 历史成绩（只读，默认 50 条）
 *
 * @returns {Promise<boolean>} 是否处理了这个路径
 */
async function handle(req, res, pathname) {
  if (pathname === '/api/dive/report') {
    if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method' }); return true; }
    if (!isLoopback(req)) { sendJson(res, 403, { ok: false, error: 'loopback only' }); return true; }
    const body = await readBody(req);
    if (!body || typeof body !== 'object') { sendJson(res, 400, { ok: false, error: 'bad json' }); return true; }
    const ok = await record(body);
    sendJson(res, ok ? 200 : 400, { ok });
    return true;
  }
  if (pathname === '/api/dive/history') {
    if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method' }); return true; }
    const u = new URL(req.url, 'http://localhost');
    const d = String(u.searchParams.get('difficulty') || '').toUpperCase();
    const limit = Number(u.searchParams.get('limit')) || 50;
    const rows = await recent({ difficulty: ['NORMAL', 'HARD', 'ABYSS'].includes(d) ? d : null, limit });
    sendJson(res, 200, { ok: true, rows });
    return true;
  }
  return false;
}

module.exports = { init, record, recent, handle, DDL };
