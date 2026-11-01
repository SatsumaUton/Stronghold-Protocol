// matchmaker/feedback.cjs — 玩家反馈板（/mm/feedback.html）的后端。
//
// 与对方 fork 的 `deploy/stardust/feedback/` 是同一套产品逻辑，但**鉴权不另起一套**：那边跑在
// 口令门后面、用 nginx 注入的 `X-Ark-Session` 做身份、用 `X-Owner-Key` 头做服主；本服已经有完整的
// 账号体系（`account.cjs`：`sp_sid` HttpOnly Cookie + player/admin/owner 三级角色），所以这里直接复用：
//
//   * 读：公开，谁都能看（和公开的游戏站一致，也方便没登录的玩家先看看别人报过什么）；
//   * 写：必须是已登录账号，`author` 由账号的展示名决定，**不接受客户端自称**；
//   * 管：`role` 为 admin / owner 才能回复、改状态、隐藏、删除；普通玩家连 hidden 字段都看不到。
//
// 数据落在既有的 MySQL 里（不引入新数据库，也不引 npm 依赖），限流状态只在内存，重启即清空。
const { currentUser, db } = require('./account.cjs');

/** 固定分类（客户端与后台共用同一份）。 */
const CATEGORIES = Object.freeze(['bug', 'gameplay', 'ui', 'other']);
/** 固定状态：未分配 → 无计划 / 已计划 → 已更新。 */
const STATUSES = Object.freeze(['unassigned', 'unplanned', 'planned', 'updated']);

/** 文本上限，单位是**码点**（清洗 + NFC 之后计算，和对方一致：一两个汉字也算两个字）。 */
const LIMITS = Object.freeze({ title: [2, 80], body: [5, 4000], author: [0, 24], client: [0, 160], reply: [0, 2000] });
/** 请求体上限：16 KiB，超过直接 413。 */
const MAX_BODY = 16 * 1024;
/** 列表默认 / 最大条数。 */
const PAGE_DEFAULT = 20, PAGE_MAX = 50;
/** 搜索词最多 64 个码点、取前 5 个、全部命中（AND）。 */
const Q_MAX = 64, Q_WORDS = 5;
/** 24 小时内「同样标题 + 同样正文」视为重复提交（含已隐藏的条目），不消耗限额。 */
const DUP_WINDOW_MS = 24 * 3600_000;

// ── 文本清洗 ────────────────────────────────────────────────────────────────

/** 去掉 C0 / C1 控制字符（`keep` 里列出的除外）。 */
function stripControls(s, keep) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const isCtl = (c < 0x20 && !keep.includes(ch)) || (c >= 0x7f && c <= 0x9f);
    if (!isCtl) out += ch;
  }
  return out;
}

/** 单行字段：NFC → 去控制字符（空白保留）→ 所有空白压成一个空格 → 去首尾空白。 */
function cleanLine(v) {
  if (typeof v !== 'string') return '';
  // ★ 2026-11-02 修：原来 keep 只传 ' '，于是 tab / 换行（都是 <0x20 的控制字符）
  //   被**直接删掉**而不是变成空格 —— `a\tb` 会粘成 `ab`。
  //   单行字段的正确语义是「换行/制表符当空格」，所以把空白类都保留，
  //   交给下面那句 \s+ 统一压成一个空格。（测试 test/feedback.test.cjs 一直是这么期望的）
  return stripControls(String(v).normalize('NFC'), ' \t\n\r\f\v')
    .replace(/[\s\u00a0\u3000]+/g, ' ')
    .trim();
}

/** 多行字段：NFC → CRLF / 单独 CR 变 LF → 去控制字符（保留 LF 与 TAB）→ 去首尾空白。 */
function cleanBody(v) {
  if (typeof v !== 'string') return '';
  return stripControls(String(v).normalize('NFC').replace(/\r\n?/g, '\n'), '\n\t')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** 码点数。 */
const cps = (s) => [...s].length;

/** 按 LIMITS 校验长度，返回错误码或 null。 */
function checkLen(field, value) {
  const [min, max] = LIMITS[field];
  const n = cps(value);
  return n < min || n > max ? 'INVALID' : null;
}

// ── 响应 ────────────────────────────────────────────────────────────────────

const SEC_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cache-control': 'no-store',
});

function sendJson(res, status, payload, extra) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SEC_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...(extra || {}),
  });
  res.end(body);
}

const fail = (res, status, error, extra) => sendJson(res, status, extra ? { error, ...extra } : { error });

/** 读 JSON 请求体，超过 MAX_BODY 或不是 JSON 对象时抛带 `code` 的错误。 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return reject(Object.assign(new Error('UNSUPPORTED_MEDIA_TYPE'), { code: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (buf) => {
      size += buf.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('TOO_LARGE'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('BAD_JSON');
        resolve(v);
      } catch {
        reject(Object.assign(new Error('BAD_JSON'), { code: 400 }));
      }
    });
    req.on('error', () => reject(Object.assign(new Error('BAD_REQUEST'), { code: 400 })));
  });
}

// ── 限流（内存滑动窗口；只统计成功写入的条目）────────────────────────────────

/** @type {Map<string, number[]>} key → 时间戳数组 */
const hits = new Map();

/** 清掉窗口外的记录；返回窗口内的条数。 */
function countIn(key, windowMs, now) {
  const arr = hits.get(key);
  if (!arr || !arr.length) return 0;
  const from = now - windowMs;
  let i = 0;
  while (i < arr.length && arr[i] < from) i++;
  if (i) arr.splice(0, i);
  if (!arr.length) hits.delete(key);
  return arr.length;
}

function pushHit(key, now) {
  const arr = hits.get(key);
  if (arr) arr.push(now);
  else hits.set(key, [now]);
}

/**
 * 客户端地址：IPv4 按单个地址、IPv6 按 /64（一段家宽/机房通常就是一整个 /64，
 * 按完整地址算等于没限流）。`X-Real-IP` 由 nginx 设置，客户端自带的同名头不会透传。
 */
function clientIp(req) {
  const raw = String(req.headers['x-real-ip'] || '').trim() || String(req.socket?.remoteAddress || '');
  const ip = raw.replace(/^::ffff:/i, '');
  if (!ip.includes(':')) return ip || 'unknown';
  // IPv6：取前 4 段（/64）
  const parts = ip.split(':');
  return parts.slice(0, 4).join(':') + '::/64';
}

/** 三道限额：单账号 10 分钟 3 条 / 24 小时 15 条；单地址 24 小时 30 条；全站 1 小时 120 条。 */
function rateLimited(req, accountId, now) {
  const ip = clientIp(req);
  const checks = [
    [`a10:${accountId}`, 10 * 60_000, 3],
    [`a24:${accountId}`, 24 * 3600_000, 15],
    [`i24:${ip}`, 24 * 3600_000, 30],
    ['all1h', 3600_000, 120],
  ];
  for (const [key, win, max] of checks) {
    if (countIn(key, win, now) >= max) {
      const arr = hits.get(key) || [];
      const oldest = arr.length ? arr[0] : now;
      return Math.max(1, Math.ceil((oldest + win - now) / 1000));
    }
  }
  return 0;
}

function recordHit(req, accountId, now) {
  pushHit(`a10:${accountId}`, now);
  pushHit(`a24:${accountId}`, now);
  pushHit(`i24:${clientIp(req)}`, now);
  pushHit('all1h', now);
}

// ── 建表 ────────────────────────────────────────────────────────────────────

let schemaReady = null;

/** 建表（幂等）；失败不缓存，下次请求重试。 */
function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db().query(`CREATE TABLE IF NOT EXISTS feedback_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account_id BIGINT UNSIGNED NULL,
      category VARCHAR(16) NOT NULL,
      title VARCHAR(320) NOT NULL,
      body TEXT NOT NULL,
      author VARCHAR(96) NOT NULL DEFAULT '',
      client VARCHAR(640) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'unassigned',
      reply TEXT NULL,
      reply_at DATETIME NULL,
      hidden TINYINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_created (created_at),
      KEY idx_status (status),
      KEY idx_category (category),
      KEY idx_account (account_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // ★ 2026-11-02 新增：服主/管理员的「已读到哪里」。
    //   维护者要求「反馈板有新的消息，要在服主和管理员上线后提示他」，
    //   所以按账号记一个 last_seen_id —— 比记时间戳稳（同一秒内多条也不会漏）。
    //   普通玩家不写这张表，也不查（接口对他们直接 403）。
    await db().query(`CREATE TABLE IF NOT EXISTS feedback_seen (
      account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      last_seen_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
      seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// ── 序列化 ──────────────────────────────────────────────────────────────────

const ms = (v) => (v ? new Date(v).getTime() : null);

/** 一条记录 → 客户端 JSON；`admin` 为真时多带 hidden。 */
function toItem(row, { admin = false, viewerId = null } = {}) {
  const item = {
    id: Number(row.id),
    category: row.category,
    title: row.title,
    body: row.body,
    author: row.author || '',
    client: row.client || '',
    status: row.status,
    reply: row.reply == null ? '' : row.reply,
    replyAt: ms(row.reply_at),
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    mine: viewerId != null && row.account_id != null && String(row.account_id) === String(viewerId),
  };
  if (admin) item.hidden = !!row.hidden;
  return item;
}

const isAdmin = (user) => !!user && (user.role === 'admin' || user.role === 'owner');

// ── 查询 ────────────────────────────────────────────────────────────────────

/** 搜索：按空白拆词、取前 5 个、全部命中（AND）；每个词在标题/正文/回复/署名里子串匹配。 */
function searchClause(q) {
  const words = q.split(/\s+/).filter(Boolean).slice(0, Q_WORDS);
  if (!words.length) return { sql: '', params: [] };
  const parts = [], params = [];
  for (const w of words) {
    const like = `%${w.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    parts.push("(title LIKE ? ESCAPE '\\\\' OR body LIKE ? ESCAPE '\\\\' OR reply LIKE ? ESCAPE '\\\\' OR author LIKE ? ESCAPE '\\\\')");
    params.push(like, like, like, like);
  }
  return { sql: parts.join(' AND '), params };
}

/** 解析查询参数；非法返回 { error }。 */
function parseQuery(url) {
  const q = url.searchParams;
  const status = (q.get('status') || '').trim();
  const category = (q.get('category') || '').trim();
  if (status && status !== 'all' && !STATUSES.includes(status)) return { error: 'status' };
  if (category && category !== 'all' && !CATEGORIES.includes(category)) return { error: 'category' };
  const rawQ = q.get('q') || '';
  if (cps(rawQ) > Q_MAX) return { error: 'q' };
  let before = null;
  if (q.get('before') != null && q.get('before') !== '') {
    const n = Number(q.get('before'));
    if (!Number.isSafeInteger(n) || n <= 0) return { error: 'before' };
    before = n;
  }
  let limit = PAGE_DEFAULT;
  if (q.get('limit') != null && q.get('limit') !== '') {
    const n = Number(q.get('limit'));
    if (!Number.isSafeInteger(n) || n <= 0) return { error: 'limit' };
    limit = Math.min(n, PAGE_MAX);
  }
  return { status, category, q: cleanLine(rawQ), before, limit };
}

/** 列表 + 计数。counts 只受分类和搜索影响，不受状态影响（和对方一致）。 */
async function listItems(url, viewer) {
  const parsed = parseQuery(url);
  if (parsed.error) return { error: parsed.error };
  const { status, category, q, before, limit } = parsed;
  const admin = isAdmin(viewer);
  const where = [], params = [];
  if (!admin) where.push('hidden = 0');
  if (category && category !== 'all') { where.push('category = ?'); params.push(category); }
  const search = searchClause(q);
  if (search.sql) { where.push(search.sql); params.push(...search.params); }
  // counts：分类 + 搜索，不含状态
  const countWhere = where.slice();
  const countParams = params.slice();
  if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
  if (before != null) { where.push('id < ?'); params.push(before); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countSql = countWhere.length ? `WHERE ${countWhere.join(' AND ')}` : '';
  const [rows] = await db().query(
    `SELECT * FROM feedback_items ${whereSql} ORDER BY id DESC LIMIT ?`, [...params, limit + 1]);
  const next = rows.length > limit ? rows[limit - 1].id : null;
  const items = rows.slice(0, limit).map((r) => toItem(r, { admin, viewerId: viewer?.id ?? null }));
  const [countRows] = await db().query(
    `SELECT status, COUNT(*) AS n FROM feedback_items ${countSql} GROUP BY status`, countParams);
  const counts = { all: 0, unassigned: 0, unplanned: 0, planned: 0, updated: 0 };
  for (const r of countRows) {
    const n = Number(r.n) || 0;
    counts[r.status] = n;
    counts.all += n;
  }
  return { items, next, counts };
}

// ── 写入 ────────────────────────────────────────────────────────────────────

/** 新建一条；返回 { item } 或 { error, field } / { duplicate, id }。 */
async function createItem(req, user) {
  const body = await readJson(req);
  const category = cleanLine(body.category);
  const title = cleanLine(body.title);
  const text = cleanBody(body.body);
  const client = cleanLine(body.client);
  if (!CATEGORIES.includes(category)) return { error: 'INVALID', field: 'category' };
  if (checkLen('title', title)) return { error: 'INVALID', field: 'title' };
  if (checkLen('body', text)) return { error: 'INVALID', field: 'body' };
  if (checkLen('client', client)) return { error: 'INVALID', field: 'client' };
  // 署名永远取账号展示名，不接受客户端自称（匿名只可能是「没登录」的旧数据）
  const author = cleanLine(user?.name || user?.displayName || '');
  if (checkLen('author', author)) return { error: 'INVALID', field: 'author' };
  const now = Date.now();
  const retryAfter = rateLimited(req, user.id, now);
  if (retryAfter) return { error: 'RATE_LIMITED', retryAfter };
  // 24 小时内同标题 + 同正文（含已隐藏）视为重复
  const [dup] = await db().query(
    'SELECT id FROM feedback_items WHERE title = ? AND body = ? AND created_at > ? LIMIT 1',
    [title, text, new Date(now - DUP_WINDOW_MS)]);
  if (dup.length) return { error: 'DUPLICATE', id: Number(dup[0].id) };
  const [res] = await db().query(
    'INSERT INTO feedback_items (account_id, category, title, body, author, client) VALUES (?, ?, ?, ?, ?, ?)',
    [user.id, category, title, text, author, client]);
  recordHit(req, user.id, now);
  const [rows] = await db().query('SELECT * FROM feedback_items WHERE id = ?', [res.insertId]);
  const item = toItem(rows[0], { admin: isAdmin(user), viewerId: user.id });
  // ★ 2026-11-02：新反馈 → 邮件通知服主/管理员（不 await，发帖不等邮件）
  notifyAdmins(item);
  return { item };
}

/** 该管理员上次看到的最大 id（没记录过就是 0）。 */
async function lastSeenId(accountId) {
  const [rows] = await db().query('SELECT last_seen_id FROM feedback_seen WHERE account_id = ?', [accountId]);
  return Number(rows[0]?.last_seen_id) || 0;
}

/**
 * 未读反馈（只给服主/管理员）。「未读」= id 大于该账号上次的 last_seen_id，
 * 且没被隐藏、也不是自己发的。
 * @param {any} user 已经过 isAdmin 校验
 */
async function unreadFor(user) {
  const seen = await lastSeenId(user.id);
  const [[cnt]] = await db().query(
    `SELECT COUNT(*) AS n FROM feedback_items
      WHERE hidden = 0 AND id > ? AND (account_id IS NULL OR account_id <> ?)`,
    [seen, user.id]);
  const count = Number(cnt?.n) || 0;
  if (!count) return { count: 0, seen, latest: [] };
  // 最近 5 条给提示条用（标题/分类/作者/时间），不返回正文
  const [rows] = await db().query(
    `SELECT id, category, title, author, created_at FROM feedback_items
      WHERE hidden = 0 AND id > ? AND (account_id IS NULL OR account_id <> ?)
      ORDER BY id DESC LIMIT 5`,
    [seen, user.id]);
  return {
    count,
    seen,
    latest: rows.map((r) => ({
      id: Number(r.id),
      category: r.category,
      title: r.title,
      author: r.author,
      createdAt: ms(r.created_at),
    })),
  };
}

/** 把「已读」推进到当前最大 id（含刚被隐藏的，避免永远清不掉）。 */
async function markSeen(user) {
  const [[mx]] = await db().query('SELECT COALESCE(MAX(id), 0) AS m FROM feedback_items');
  const top = Number(mx?.m) || 0;
  await db().query(
    `INSERT INTO feedback_seen (account_id, last_seen_id) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE last_seen_id = GREATEST(last_seen_id, VALUES(last_seen_id))`,
    [user.id, top]);
  return { seen: top };
}

/**
 * 新反馈 → 给服主/管理员发一封邮件（fire-and-forget，发不出去绝不影响发帖）。
 * 收件人：环境变量 SP_FEEDBACK_NOTIFY（逗号分隔）优先，
 * 否则取 accounts 表里 role 为 owner/admin 且没停用、有邮箱的账号。
 */
async function notifyAdmins(item, log = console) {
  try {
    const { mail, MAIL } = require('./account.cjs');
    const fixed = String(process.env.SP_FEEDBACK_NOTIFY || '').split(',').map((s) => s.trim()).filter(Boolean);
    let to = fixed;
    if (!to.length) {
      const [rows] = await db().query(
        `SELECT email FROM accounts
          WHERE role IN ('owner','admin') AND disabled = 0 AND deleted_at IS NULL
            AND email IS NOT NULL AND email <> ''`);
      to = rows.map((r) => r.email);
    }
    if (!to.length) return;
    const body = [
      `分类：${item.category}`,
      `标题：${item.title}`,
      `作者：${item.author || '（未署名）'}`,
      `编号：#${item.id}`,
      '',
      '到「反馈板」查看并回复：/mm/feedback.html',
    ].join('\n');
    await mail().sendMail({
      from: `"萝卜喵公益服" <${MAIL.user}>`,
      to: to.join(','),
      subject: `【萝卜喵公益服】新的玩家反馈 #${item.id}：${item.title}`.slice(0, 180),
      text: body,
    });
  } catch (e) {
    // 邮件失败不影响发帖；只记一行日志
    log?.warn?.('[feedback] 新反馈邮件通知失败: ' + (e && e.message));
  }
}

/** 服主操作：改状态 / 回复 / 隐藏。`reply: ''` 清除回复。 */
async function adminUpdate(id, req, user) {
  const body = await readJson(req);
  const sets = [], params = [];
  if (body.status !== undefined) {
    const status = cleanLine(body.status);
    if (!STATUSES.includes(status)) return { error: 'INVALID', field: 'status' };
    sets.push('status = ?'); params.push(status);
  }
  if (body.reply !== undefined) {
    const reply = cleanBody(body.reply);
    if (checkLen('reply', reply)) return { error: 'INVALID', field: 'reply' };
    sets.push('reply = ?', 'reply_at = ?');
    params.push(reply === '' ? null : reply, reply === '' ? null : new Date());
  }
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== 'boolean') return { error: 'INVALID', field: 'hidden' };
    sets.push('hidden = ?'); params.push(body.hidden ? 1 : 0);
  }
  if (!sets.length) return { error: 'INVALID', field: 'body' };
  const [res] = await db().query(`UPDATE feedback_items SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  if (!res.affectedRows) return { error: 'NOT_FOUND' };
  const [rows] = await db().query('SELECT * FROM feedback_items WHERE id = ?', [id]);
  return { item: toItem(rows[0], { admin: true, viewerId: user.id }) };
}

// ── 路由 ────────────────────────────────────────────────────────────────────

/** 只接受同源写请求（Cookie 鉴权必须防 CSRF）。 */
function sameOrigin(req) {
  const site = String(req.headers['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = String(req.headers.origin || '');
  if (!origin) return true; // 非浏览器客户端（curl / 脚本）没有 Origin，靠 Cookie 本身鉴权
  try {
    const o = new URL(origin);
    const host = String(req.headers.host || '');
    return o.host === host;
  } catch { return false; }
}

/**
 * `/api/feedback/*` 的入口。已处理的请求返回 true，未匹配返回 false 交给上层。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 */
async function handle(req, res, pathname) {
  if (!pathname.startsWith('/api/feedback')) return false;
  const method = req.method || 'GET';
  try {
    await ensureSchema();
    const url = new URL(req.url, 'http://localhost');
    const rest = pathname.slice('/api/feedback'.length) || '/';

    if (rest === '/health' && method === 'GET') {
      const [[row]] = await db().query('SELECT COUNT(*) AS n FROM feedback_items WHERE hidden = 0');
      return sendJson(res, 200, { ok: true, items: Number(row?.n) || 0 }), true;
    }

    if (rest === '/items' && method === 'GET') {
      const viewer = await currentUser(req).catch(() => null);
      const out = await listItems(url, viewer);
      if (out.error) return fail(res, 400, 'INVALID', { field: out.error }), true;
      return sendJson(res, 200, out), true;
    }

    // ★ 2026-11-02：服主/管理员的「新反馈」提醒。
    //   普通玩家调这两个接口一律 403 —— 维护者要求「普通玩家可以不在反馈」。
    if (rest === '/unread' && method === 'GET') {
      const user = await currentUser(req).catch(() => null);
      if (!isAdmin(user)) return fail(res, 403, 'OWNER'), true;
      const out = await unreadFor(user);
      return sendJson(res, 200, out), true;
    }

    if (rest === '/seen' && method === 'POST') {
      if (!sameOrigin(req)) return fail(res, 403, 'ORIGIN'), true;
      const user = await currentUser(req).catch(() => null);
      if (!isAdmin(user)) return fail(res, 403, 'OWNER'), true;
      const out = await markSeen(user);
      return sendJson(res, 200, out), true;
    }

    if (rest === '/items' && method === 'POST') {
      if (!sameOrigin(req)) return fail(res, 403, 'ORIGIN'), true;
      const user = await currentUser(req).catch(() => null);
      if (!user) return fail(res, 401, 'LOGIN_REQUIRED'), true;
      const out = await createItem(req, user);
      if (out.error === 'RATE_LIMITED') return sendJson(res, 429, { error: 'RATE_LIMITED', retryAfter: out.retryAfter }, { 'retry-after': String(out.retryAfter) }), true;
      if (out.error === 'DUPLICATE') return sendJson(res, 409, { error: 'DUPLICATE', id: out.id }), true;
      if (out.error) return fail(res, 400, out.error, out.field ? { field: out.field } : undefined), true;
      return sendJson(res, 201, { item: out.item }), true;
    }

    const m = /^\/items\/(\d+)(\/admin)?$/.exec(rest);
    if (m) {
      const id = Number(m[1]);
      if (!Number.isSafeInteger(id) || id <= 0) return fail(res, 400, 'BAD_REQUEST'), true;
      const user = await currentUser(req).catch(() => null);

      if (!m[2] && method === 'GET') {
        const [rows] = await db().query('SELECT * FROM feedback_items WHERE id = ?', [id]);
        const row = rows[0];
        if (!row || (row.hidden && !isAdmin(user))) return fail(res, 404, 'NOT_FOUND'), true;
        return sendJson(res, 200, { item: toItem(row, { admin: isAdmin(user), viewerId: user?.id ?? null }) }), true;
      }
      if (!m[2] && method === 'DELETE') {
        if (!sameOrigin(req)) return fail(res, 403, 'ORIGIN'), true;
        if (!isAdmin(user)) return fail(res, 403, 'OWNER'), true;
        await db().query('DELETE FROM feedback_items WHERE id = ?', [id]);
        res.writeHead(204, SEC_HEADERS); return res.end(), true;
      }
      if (m[2] && method === 'POST') {
        if (!sameOrigin(req)) return fail(res, 403, 'ORIGIN'), true;
        if (!isAdmin(user)) return fail(res, 403, 'OWNER'), true;
        const out = await adminUpdate(id, req, user);
        if (out.error === 'NOT_FOUND') return fail(res, 404, 'NOT_FOUND'), true;
        if (out.error) return fail(res, 400, out.error, out.field ? { field: out.field } : undefined), true;
        return sendJson(res, 200, { item: out.item }), true;
      }
      res.writeHead(405, { ...SEC_HEADERS, allow: m[2] ? 'POST' : 'GET, DELETE' });
      return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' })), true;
    }

    return fail(res, 404, 'NOT_FOUND'), true;
  } catch (e) {
    const code = e && e.code;
    if (code === 413) return fail(res, 413, 'TOO_LARGE'), true;
    if (code === 415) return fail(res, 415, 'UNSUPPORTED_MEDIA_TYPE'), true;
    if (code === 400) return fail(res, 400, e.message === 'BAD_JSON' ? 'BAD_JSON' : 'BAD_REQUEST'), true;
    console.error('[feedback] internal error', e && e.message);
    return fail(res, 500, 'INTERNAL'), true;
  }
}

// `createItem` / `adminUpdate` / `listItems` / `parseQuery` 额外导出，只为测试能直接喂一个假的 `user`
// （生产路径一律经 `handle`，身份永远来自 `currentUser(req)`）。
module.exports = {
  handle, ensureSchema, createItem, adminUpdate, listItems, parseQuery,
  CATEGORIES, STATUSES, LIMITS, cleanLine, cleanBody, cps,
  // ★ 2026-11-02：新反馈提醒（服主/管理员）。导出是为了让 test/feedback.test.cjs 能直接测。
  unreadFor, markSeen, lastSeenId,
};
