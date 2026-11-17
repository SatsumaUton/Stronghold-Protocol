// test/helpers/accountToken.js — 给「需要已登录账号」的测试签发一枚登录身份令牌（accountToken）。
//
// 为什么需要：本服规则「游客不能建房」（server/lobby.js create）。走真实 WebSocket 的测试（plugin-host /
// version-host 之类）用 hello() 建会话，不带 accountToken 就是游客，建房会被拒。
//
// 令牌格式与 server/adminAuth.js readSigned() 一致：base64url(payload) + '.' + HMAC-SHA256(payload)。
// 密钥读 ../../.secrets/watch-secret —— 公开仓库里没有这个文件，所以拿不到密钥时返回 null，
// 调用方应当跳过相关用例（而不是让它们变红）。
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 密钥路径：线上位置是 <部署根>/.secrets/watch-secret，而 server/adminAuth.js 在 node-N/server/ 下，
// 它的 '../../.secrets' 正好等于部署根。测试从仓库工作区跑：仓库工作区的 .secrets 通常不存在，
// 密钥在上一层（repo-sync 与 node-1 并列）。两处都试。
const CANDIDATES = [
  fileURLToPath(new URL('../../.secrets/watch-secret', import.meta.url)),   // <repo>/.secrets（线上同构）
  fileURLToPath(new URL('../../../.secrets/watch-secret', import.meta.url)), // 部署根（repo-sync 的上一层）
];

/** The signing secret, or null when this checkout has none (a public clone / CI). */
export function userTokenSecret() {
  for (const f of CANDIDATES) {
    try {
      const s = readFileSync(f, 'utf8').trim();
      if (s) return s;
    } catch { /* 试下一个 */ }
  }
  return null;
}

/**
 * A login-identity token for `uid` (`typ: 'user'`, the shape readUserToken accepts).
 * @param {number} uid @param {{ role?: 'player'|'owner'|'admin', tag?: string|null, ttlMs?: number }} [opts]
 * @returns {string | null} null when the secret is unavailable
 */
export function accountToken(uid, { role = 'player', tag = null, ttlMs = 60 * 60 * 1000 } = {}) {
  const sec = userTokenSecret();
  if (!sec) return null;
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    v: 1, typ: 'user', uid, role, tag: tag || null, iat: now, exp: now + ttlMs,
  }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', sec).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
