// 登录前置（维护者 2026-11-16；设计稿 docs-plan/login-design/，预案 docs-plan/开场动画与登录前置-预案.md）
//
// 流程：**[登录 / 注册] → [点击进入] → [开场动画] → [原标题页：代号 + 开始] → [大厅]**
//
// 本模块只管第一屏。它**不复制** `matchmaker/public/account-title.js` 的登录逻辑：那 876 行里有
// 改代号、改密码、重置云端数据、云端偏好拉取、管理员入口……全都在登录之后才用到，只是被同一个 IIFE
// 包着。这里只搬走「登录 / 注册」那一段（account-title.js 的 renderFields），其余继续留在原处。
//
// 会话怎么判定（三条路径都要对）：
//   * `/mm/api/auth/me` 200 → 已登录：直接放行（刷新不再问）。
//   * 401 → 未登录：挡在这里，直到登录成功、注册成功，或玩家明确选「游客访问」。
//   * 网络错误 → 当作未登录，但界面上给出可重试的提示（不能因为一次抖动把人锁死）。
//
// 游客访问写进 sessionStorage：同一标签页刷新不再问，**新标签页仍会问** —— 与 account-title.js
// 里 `state.guest` 只是内存态的口径一致，只是多活过了一次刷新。
export const AUTH_ME_URL = '/api/auth/me';
export const AUTH_LOGIN_URL = '/api/auth/login';
export const AUTH_REGISTER_URL = '/api/auth/register';
export const AUTH_SEND_CODE_URL = '/api/auth/send-code';
export const AUTH_CAPTCHA_URL = '/api/auth/captcha';
// 「忘记密码」（维护者 2026-11-22）：邮箱验证码重置。后端matchmaker/account.cjs 的
// POST /api/auth/reset/send（发 6 位验证码，10 分钟有效，带限流与「不论存在都回成功」的防探测）
// 与 POST /api/auth/reset（email + code + password → 改密并踢掉全部会话）都已存在，缺的只是 UI。
export const AUTH_RESET_SEND_URL = '/api/auth/reset/send';
export const AUTH_RESET_URL = '/api/auth/reset';

/** 游客选择（同一标签页内有效）。 */
export const GUEST_KEY = 'sp.authGate.guest';

/** @returns {boolean} 这一页是不是「管理员观战」页 —— 那种页面不该被登录挡住。 */
export function isWatchOnlyPage() {
  try {
    const qs = new URLSearchParams(location.search);
    return qs.get('adminWatch') === '1' || qs.get('watchGuest') === '1' || !!qs.get('watchToken')
      || !!sessionStorage.getItem('sp_admin_watch_code') || !!localStorage.getItem('sp_admin_watch_code');
  } catch { return false; }
}

/** @returns {boolean} */
export function guestChosen() {
  try { return sessionStorage.getItem(GUEST_KEY) === '1'; } catch { return false; }
}

/** @param {boolean} on */
export function setGuestChosen(on) {
  try { on ? sessionStorage.setItem(GUEST_KEY, '1') : sessionStorage.removeItem(GUEST_KEY); } catch { /* 隐私模式 */ }
}

/**
 * Same-origin `/mm` API call, the same envelope account-title.js uses (`{ status, body }`, never throws
 * for an HTTP error status — only a transport failure throws).
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function api(path, opts = {}) {
  const o = { credentials: 'same-origin', cache: 'no-store', ...opts };
  if (o.body && !o.headers) o.headers = { 'content-type': 'application/json' };
  const r = await fetch('/mm' + path, o);
  let body = null;
  try { body = await r.json(); } catch { /* 非 JSON（网关错误页） */ }
  return { status: r.status, body };
}

/**
 * 这台浏览器现在是什么状态。
 * @param {{ fetchMe?: () => Promise<{ status: number, body: any }> }} [opts]
 * @returns {Promise<'in' | 'out' | 'error'>} 'in' 已登录 / 'out' 需要登录 / 'error' 无法判定（当未登录处理，可重试）
 */
export async function checkAuth({ fetchMe = () => api(AUTH_ME_URL) } = {}) {
  if (isWatchOnlyPage()) return 'in'; // 观战页放行，登录由后台负责
  try {
    const r = await fetchMe();
    if (r.status === 200 && r.body && r.body.user) {
      // account-title.js 在它自己的 render() 里写这些全局量；这里先写，让游戏侧的握手一上来就带身份。
      // 它稍后还会再写一遍（同一个值），不会打架。
      window.__SP_ACCOUNT_USER = r.body.user.name || null;
      window.__SP_ACCOUNT_TAG = r.body.user.tag ? String(r.body.user.tag) : null;
      window.__SP_ACCOUNT_ROLE = r.body.user.role ? String(r.body.user.role) : null;
      window.__SP_ACCOUNT_EMAIL = r.body.user.email ? String(r.body.user.email) : null;
      if (typeof r.body.userToken === 'string' && r.body.userToken) window.__SP_ACCOUNT_TOKEN = r.body.userToken;
      return 'in';
    }
    if (r.status === 401) return 'out';
    return 'error';
  } catch { return 'error'; }
}

/**
 * 登录 / 注册成功后要做的收尾：写全局令牌、把账号身份交给游戏（重握手补 session.admin）、
 * 记下会话 id 供「已登录」态使用。与 account-title.js 的 doAuth 成功分支逐项一致 ——
 * 两处都写同一个值，谁先到都一样。
 * @param {{ user?: any, userToken?: string, token?: string, adminToken?: string } | null} body
 */
export function adoptAuth(body) {
  if (!body || !body.user) return;
  window.__SP_ACCOUNT_USER = body.user.name || null;
  window.__SP_ACCOUNT_TAG = body.user.tag ? String(body.user.tag) : null;
  window.__SP_ACCOUNT_ROLE = body.user.role ? String(body.user.role) : null;
  window.__SP_ACCOUNT_EMAIL = body.user.email ? String(body.user.email) : null;
  // 服务端已不下发 adminToken（要用后台验证码换，见 account-title.js 2026-10-31 的注释）：
  // 这里必须**保留手上已有的那枚**，不能写成 `|| null`。
  if (typeof body.adminToken === 'string' && body.adminToken) window.__SP_ADMIN_TOKEN = body.adminToken;
  window.__SP_ACCOUNT_TOKEN = typeof body.userToken === 'string' && body.userToken ? body.userToken : null;
  try { if (body.token) localStorage.setItem('mm.sid', body.token); } catch { /* 隐私模式 */ }
  try {
    window.dispatchEvent(new Event('sp-account-token'));
  } catch { /* ignore */ }
}
