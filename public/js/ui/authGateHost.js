// The login gate's host: decides whether this page needs it, mounts screens/authGate.js over the title
// screen, and resolves once the player is through (logged in, registered, or chose 游客访问).
//
// Why an overlay and not a route: the title screen is already mounted and keeps its own state (callsign,
// remembered name, version look). The gate covers it (`position:fixed; inset:0; z-index:40`, the draft's
// own rule) and unmounts, so nothing behind it is re-created on the way through — and the flow stays
// [登录 / 注册] → [点击进入] → [开场动画] → [原标题页] → [大厅], exactly as the plan document has it.
import { render } from '../../vendor/preact.module.v2.js';
import { html } from '../ui/components.js';
import { AuthGate } from '../screens/authGate.js';
import { checkAuth, guestChosen } from '../screens/authSession.js';

/** Test / E2E escape hatch, like `__SP_ENTRY_FILM__ = 'off'`. */
const SKIP_FLAG = '__SP_AUTH_GATE__';

/**
 * 把闸门挂出来并等玩家通过。`force` = 已经登录也照样显示（「登出」之后再用）——
 * account-title.js 的「登录 / 注册 ›」按钮就是调这个。
 * @param {{ force?: boolean, check?: () => Promise<'in'|'out'|'error'>, doc?: Document, win?: any }} [opts]
 * @returns {Promise<'in'|'login'|'register'|'guest'|'off'>}
 */
export async function ensureAuthGate({ force = false, check = checkAuth, doc = globalThis.document, win = globalThis } = {}) {
  if (win && win[SKIP_FLAG] === 'off' && !force) return 'off';
  // 本标签页已经选了「游客访问」：刷新不再问（新标签页仍会问，与 account-title.js 的 guest 口径一致）。
  if (!force && guestChosen()) return 'guest';
  // A player who chose 游客访问 in this tab skips the gate on a reload — account-title.js reads the same flag.
  const state = force ? 'out' : await check();
  if (state === 'in') return 'in';

  const host = doc.createElement('div');
  host.id = 'sp-auth-gate';
  doc.body.appendChild(host);
  const how = await new Promise((resolve) => {
    const onDone = (value) => resolve(value || 'guest');
    render(html`<${AuthGate} checkError=${state === 'error'} onDone=${onDone} />`, host);
  });
  render(null, host);
  host.remove();
  // ★ 2026-11-16：`account-title.js`（matchmaker 注入的那支脚本）里的 `state.guest` 是内存态。
  //   第一屏选「游客访问」时它不会自己去改，所以这里广播一次，让它把「代号 + 开始」那一版渲染出来
  //   （否则玩家会看到「点了游客却还停在登录界面」—— 维护者的反馈）。
  try {
    win.dispatchEvent(new CustomEvent('sp-auth-gate-done', { detail: { how } }));
  } catch { /* ignore */ }
  return how;
}

/**
 * 页面上随时能重开闸门（account-title.js 的「登录 / 注册 ›」）。
 * 它不等待结果：调用方是 matchmaker 注入的普通脚本，拿到 'login' 之后 account-title.js 自己会
 * 收 `sp-account-token` 事件刷新已登录态。
 * @param {any} [win]
 */
export function installAuthGateOpener(win = globalThis) {
  try {
    win.__SP_OPEN_AUTH_GATE = () => {
      void ensureAuthGate({ force: true, win }).catch((err) => console.warn('[app] login gate failed', err));
    };
  } catch { /* ignore */ }
}

export { guestChosen };
