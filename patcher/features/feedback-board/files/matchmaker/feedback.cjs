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
const LIMITS = Object.freeze({ title: [2, 80], body: [5, 4000], author: [0, 24], client: [0, 160], reply: [0, 2000], authorReply: [1, 2000] });
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
    // ★ 2026-11-16（维护者）：管理员回复后要通知**作者本人** —— 邮件 + 大厅提示。
    //   作者读没读过这条回复记在 reply_seen_at（NULL = 还没看过）。
    //   MySQL 8 没有 ADD COLUMN IF NOT EXISTS，先查 information_schema。
    const [col] = await db().query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_items' AND COLUMN_NAME = 'reply_seen_at'`);
    if (!col.length) {
      await db().query('ALTER TABLE feedback_items ADD COLUMN reply_seen_at DATETIME NULL AFTER reply_at');
      // 已经存在的旧回复不算「新回复」：把它们的 reply_seen_at 补成 reply_at，
      // 否则功能上线的瞬间，所有历史回复都会在玩家大厅里弹一次（维护者 2026-11-16）。
      await db().query(
        'UPDATE feedback_items SET reply_seen_at = reply_at WHERE reply_seen_at IS NULL AND reply_at IS NOT NULL');
    }
    // ★ 2026-11-17（维护者）：管理员回复之后，**玩家也能回复管理员**（追评）。
    //   author_reply 存玩家最近一次追评；authorReply_seen_at 是管理员那边的已读位
    //   （对称于 reply_seen_at：那边玩家读管理员的回复，这边管理员读玩家的追评）。
    //   MySQL 8 没有 ADD COLUMN IF NOT EXISTS，先查 information_schema。
    const wantCols = ['author_reply', 'author_replied_at', 'authorReply_seen_at'];
    const [cols] = await db().query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_items'
          AND COLUMN_NAME IN (${wantCols.map(() => '?').join(',')})`, wantCols);
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('author_reply')) {
      await db().query('ALTER TABLE feedback_items ADD COLUMN author_reply TEXT NULL AFTER reply_seen_at');
    }
    if (!have.has('author_replied_at')) {
      await db().query('ALTER TABLE feedback_items ADD COLUMN author_replied_at DATETIME NULL AFTER author_reply');
    }
    if (!have.has('authorReply_seen_at')) {
      await db().query('ALTER TABLE feedback_items ADD COLUMN authorReply_seen_at DATETIME NULL AFTER author_replied_at');
    }
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
    // 玩家对管理员回复的追评（2026-11-17）：空字符串 = 还没追评
    authorReply: row.author_reply == null ? '' : row.author_reply,
    authorReplyAt: ms(row.author_replied_at),
    // 服主列表用：这条有没有管理员还没看过的追评
    authorReplyUnread: !!(row.author_reply && (!row.authorReply_seen_at
      || new Date(row.authorReply_seen_at) < new Date(row.author_replied_at))),
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
    parts.push("(title LIKE ? ESCAPE '\\\\' OR body LIKE ? ESCAPE '\\\\' OR reply LIKE ? ESCAPE '\\\\' OR author LIKE ? ESCAPE '\\\\' OR author_reply LIKE ? ESCAPE '\\\\')");
    params.push(like, like, like, like, like);
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
  // 只数「还没处理」的：维护者要求「已经处理完的就不要再弹提示框了」。
  // unassigned 是默认状态；unplanned / planned / updated 都表示服主或管理员已经看过并分过类，
  // 再算新消息就只会一直弹同一条。
  const [[cnt]] = await db().query(
    `SELECT COUNT(*) AS n FROM feedback_items
      WHERE hidden = 0 AND status = 'unassigned'
        AND id > ? AND (account_id IS NULL OR account_id <> ?)`,
    [seen, user.id]);
  const count = Number(cnt?.n) || 0;
  if (!count) return { count: 0, seen, latest: [] };
  // 最近 5 条给提示条用（标题/分类/作者/时间），不返回正文
  const [rows] = await db().query(
    `SELECT id, category, title, author, created_at FROM feedback_items
      WHERE hidden = 0 AND status = 'unassigned'
        AND id > ? AND (account_id IS NULL OR account_id <> ?)
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

/**
 * 回复 → 给**作者本人**发一封邮件（fire-and-forget，发不出去不影响回复保存）。
 *
 * 维护者 2026-11-16：「给反馈板增加，在管理员回复后会用邮件的方式通知对方，
 * 并且在打开网页后在大厅界面有提示。」——邮件是大厅那条提示之外的第二个通道。
 * 作者没有账号或账号没邮箱时静默跳过（游客发的反馈就只能看大厅提示）。
 */
async function notifyAuthor(item, admin) {
  try {
    if (!item || item.account_id == null) return;
    const { mail, MAIL } = require('./account.cjs');
    const [rows] = await db().query(
      'SELECT email, nickname FROM accounts WHERE id = ? AND disabled = 0 AND deleted_at IS NULL',
      [item.account_id]);
    const row = rows[0];
    const to = row && row.email ? String(row.email).trim() : '';
    if (!to) return;
    const link = 'https://stronghold.luobomiao.love/mm/feedback.html#' + item.id;
    const text = [
      `你提交的反馈 #${item.id}「${item.title}」有了回复：`,
      '',
      item.reply,
      '',
      admin && admin.nickname ? `—— ${admin.nickname}（管理员）` : '—— 管理员',
      '',
      '查看完整内容：' + link,
      '（下次打开游戏大厅时也会提示你。）',
    ].join('\n');
    await mail().sendMail({
      from: `"萝卜喵公益服" <${MAIL.user}>`,
      to,
      subject: `【萝卜喵公益服】你的反馈 #${item.id} 有回复了`.slice(0, 180),
      text,
    });
  } catch (e) {
    console.error('[feedback] 回复邮件发送失败: ' + (e && e.message));
  }
}

/**
 * 读：当前登录账号**还没看过的回复**（大厅提示用）。
 * 判定：有 reply、且 reply_seen_at 为空或早于 reply_at。
 */
async function myUnreadReplies(accountId) {
  if (accountId == null) return { count: 0, items: [] };
  const [rows] = await db().query(
    `SELECT id, title, reply, reply_at FROM feedback_items
      WHERE account_id = ? AND hidden = 0 AND reply IS NOT NULL AND reply <> ''
        AND (reply_seen_at IS NULL OR reply_seen_at < reply_at)
      ORDER BY reply_at DESC LIMIT 20`,
    [accountId]);
  return {
    count: rows.length,
    items: rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      reply: r.reply.length > 400 ? r.reply.slice(0, 400) + '…' : r.reply,
      replyAt: ms(r.reply_at),
    })),
  };
}

/** 写：把当前账号那些回复标成已读（玩家点了「知道了」或打开过反馈板）。 */
async function markMyRepliesSeen(accountId) {
  if (accountId == null) return { seen: 0 };
  const [res] = await db().query(
    `UPDATE feedback_items SET reply_seen_at = NOW()
      WHERE account_id = ? AND reply IS NOT NULL AND reply <> ''
        AND (reply_seen_at IS NULL OR reply_seen_at < reply_at)`,
    [accountId]);
  return { seen: Number(res.affectedRows) || 0 };
}

/**
 * 玩家追评：**只有该条反馈的作者本人**能写（维护者 2026-11-17「管理员回复之后，玩家也可以回复管理员」）。
 *
 * 规则：
 *   * 必须已登录，且 account_id 与这条反馈的作者一致 —— 否则别人可以冒名在别人的帖子里发言；
 *   * 必须已经有管理员回复（还没人回复的帖子请继续在原帖里补充，不在这里追评）；
 *   * 长度 1–2000 码点，走 cleanBody（保留换行）；`text: ''` 清除自己的追评；
 *   * 不消耗发帖限流（追评不是新帖），但有 30 秒最小间隔，防连点。
 * 写完把 authorReply_seen_at 清空 —— 管理员还没看过这条新追评。
 * @param {number} id @param {any} req @param {any} user
 */
async function authorReply(id, req, user) {
  if (!user || user.id == null) return { error: 'LOGIN_REQUIRED' };
  const body = await readJson(req);
  const text = typeof body.text === 'string' ? cleanBody(body.text) : null;
  if (text == null) return { error: 'INVALID', field: 'text' };
  if (text !== '' && checkLen('authorReply', text)) return { error: 'INVALID', field: 'text' };
  const [[row]] = await db().query('SELECT * FROM feedback_items WHERE id = ?', [id]);
  if (!row || (row.hidden && !isAdmin(user))) return { error: 'NOT_FOUND' };
  if (row.account_id == null || String(row.account_id) !== String(user.id)) return { error: 'FORBIDDEN' };
  if (!row.reply) return { error: 'NO_REPLY' };
  const now = new Date();
  if (text !== '' && row.author_replied_at && now - new Date(row.author_replied_at) < 30_000) {
    const wait = Math.ceil((30_000 - (now - new Date(row.author_replied_at))) / 1000);
    return { error: 'RATE_LIMITED', retryAfter: Math.max(1, wait) };
  }
  await db().query(
    'UPDATE feedback_items SET author_reply = ?, author_replied_at = ?, authorReply_seen_at = NULL WHERE id = ?',
    [text === '' ? null : text, text === '' ? null : now, id]);
  const [rows] = await db().query('SELECT * FROM feedback_items WHERE id = ?', [id]);
  const fresh = rows[0];
  try { if (fresh && fresh.author_reply && text !== '') notifyAdminsOfAuthorReply(fresh, user); } catch { /* 邮件失败不影响保存 */ }
  return { item: toItem(fresh, { admin: isAdmin(user), viewerId: user.id }) };
}

/**
 * 玩家追评 → 给服主/管理员发邮件（fire-and-forget）。收件人与 notifyAdmins 同一批。
 */
async function notifyAdminsOfAuthorReply(row, author, log = console) {
  try {
    const { mail, MAIL } = require('./account.cjs');
    const fixed = String(process.env.SP_FEEDBACK_NOTIFY || '').split(',').map((v) => v.trim()).filter(Boolean);
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
      `反馈：#${row.id}「${row.title}」`,
      `作者：${author && author.name ? author.name : row.author || '（未署名）'}`,
      '',
      '玩家的追评：',
      row.author_reply,
      '',
      '到「反馈板」查看：/mm/feedback.html#' + row.id,
    ].join('\n');
    await mail().sendMail({
      from: `"萝卜喵公益服" <${MAIL.user}>`,
      to: to.join(','),
      subject: `【萝卜喵公益服】玩家在反馈 #${row.id} 里追评了`.slice(0, 180),
      text: body,
    });
  } catch (e) {
    log?.warn?.('[feedback] 追评邮件通知失败: ' + (e && e.message));
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
  // 管理员打开/保存这条时，把「玩家的追评」也算作已读（对称于玩家的 reply_seen_at）
  if (sets.length) {
    await db().query(
      'UPDATE feedback_items SET authorReply_seen_at = NOW() WHERE id = ? AND author_reply IS NOT NULL AND authorReply_seen_at IS NULL',
      [id]);
  }
  if (!sets.length) return { error: 'INVALID', field: 'body' };
  // 记下改之前的回复，判断这次是不是真的写了新内容（避免反复保存重复发信）
  const [[before]] = await db().query('SELECT reply, reply_at FROM feedback_items WHERE id = ?', [id]);
  const replyBefore = before ? before.reply : null;
  const [res] = await db().query(`UPDATE feedback_items SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  if (!res.affectedRows) return { error: 'NOT_FOUND' };
  const [rows] = await db().query('SELECT * FROM feedback_items WHERE id = ?', [id]);
  const row = rows[0];
  // ★ 2026-11-16（维护者）：管理员**写了新回复**就通知作者本人（邮件 + 大厅提示）。
  //   清空回复（reply = null）不发；内容没变也不发。
  try {
    if (body.reply !== undefined && row && row.reply && row.reply !== replyBefore) {
      await notifyAuthor(row, user);
    }
  } catch (e) {
    console.error('[feedback] 回复通知作者失败: ' + (e && e.message));
  }
  return { item: toItem(row, { admin: true, viewerId: user.id }) };
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

    // ★ 2026-11-16（维护者）：**作者本人**的「我的反馈有回复」提示（大厅横幅）。
    //   与上面 /unread、/seen 是两套：那套给管理员看新反馈，这套给玩家看自己的回复。
    if (rest === '/my-replies' && method === 'GET') {
      const user = await currentUser(req).catch(() => null);
      if (!user) return sendJson(res, 200, { count: 0, items: [] }), true;
      const out = await myUnreadReplies(user.id);
      return sendJson(res, 200, out), true;
    }

    if (rest === '/my-replies-seen' && method === 'POST') {
      if (!sameOrigin(req)) return fail(res, 403, 'ORIGIN'), true;
      const user = await currentUser(req).catch(() => null);
      if (!user) return fail(res, 401, 'LOGIN_REQUIRED'), true;
      const out = await markMyRepliesSeen(user.id);
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

    // ★ 2026-11-17（维护者）：作者对管理员回复的追评（POST /items/:id/reply）
    const mr = /^\/items\/(\d+)\/reply$/.exec(rest);
    if (mr) {
      if (method !== 'POST') {
        res.writeHead(405, { ...SEC_HEADERS, allow: 'POST' });
        return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' })), true;
      }
      if (!sameOrigin(req)) return fail(res, 403, 'ORIGIN'), true;
      const id = Number(mr[1]);
      if (!Number.isSafeInteger(id) || id <= 0) return fail(res, 400, 'BAD_REQUEST'), true;
      const user = await currentUser(req).catch(() => null);
      if (!user) return fail(res, 401, 'LOGIN_REQUIRED'), true;
      const out = await authorReply(id, req, user);
      if (out.error === 'RATE_LIMITED') {
        return sendJson(res, 429, { error: 'RATE_LIMITED', retryAfter: out.retryAfter }, { 'retry-after': String(out.retryAfter) }), true;
      }
      if (out.error === 'NOT_FOUND') return fail(res, 404, 'NOT_FOUND'), true;
      if (out.error === 'FORBIDDEN') return fail(res, 403, 'FORBIDDEN'), true;
      if (out.error === 'NO_REPLY') return fail(res, 409, 'NO_REPLY'), true;
      if (out.error === 'LOGIN_REQUIRED') return fail(res, 401, 'LOGIN_REQUIRED'), true;
      if (out.error) return fail(res, 400, out.error, out.field ? { field: out.field } : undefined), true;
      return sendJson(res, 200, { item: out.item }), true;
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
  // ★ 2026-11-16：回复通知作者（邮件 + 大厅提示）。导出供 test/feedback.test.cjs 直接测。
  notifyAuthor, myUnreadReplies, markMyRepliesSeen,
  // ★ 2026-11-17：作者追评（管理员回复之后，玩家也可以回复）
  authorReply, notifyAdminsOfAuthorReply,
};
