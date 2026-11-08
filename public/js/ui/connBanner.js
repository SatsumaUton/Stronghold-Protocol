// Connection banner (global chrome, mounted once by main.js): reconnecting / closed / rejected-hello states with
// the matching action, "正在同步同盟状态…" while a resumed session waits for its room/match state, and "服务器已更新"
// while a match still runs on a page the server has moved past (ui/buildGuard.js sets ui.buildStale). Outside a
// match the banner sits at the bottom centre; in a match (html.sp-in-match, set by the match screen) it moves under the
// top bar so it never covers the combat view switcher or the shop bar. While it shows, html.sp-conn moves the toasts
// below it (classes instead of CSS :has(), which Firefox ESR / Safari < 15.4 lack).

import { html, Button, Icon, useTicker } from './components.js';
import { net, CLIENT_ERR_TEXT } from '../net.js';
import { useStore, shallowEqual, selectRoute } from '../store.js';
import { useDocClass } from './device.js';
import { useState, useEffect } from '../../vendor/hooks.module.js';
import { checkNodeAcceptsNew } from './nodeCodeHint.js';
import { updateHintAllowed } from './buildGuard.js';
import { t } from '../../../shared/i18n.js';
import { diveSyncing } from './diveWords.js';

/** Whether the banner shows for this connection state (mirrors the early returns below). */
export function bannerVisible(conn, entered, restoring, buildStale = false) {
  if (!entered || !conn) return false;
  if (conn.status === 'online') return !!restoring || !!buildStale;
  if (!conn.everOnline && (conn.status === 'connecting' || conn.status === 'handshaking' || conn.status === 'idle')) return false;
  return true;
}

export function ConnectionBanner() {
  const conn = useStore((s) => s.connection, shallowEqual);
  const entered = useStore((s) => s.session.entered);
  const restoring = useStore((s) => s.ui.restoring);
  const buildStale = useStore((s) => !!s.ui.buildStale);
  // ★ 2026-10-31（维护者要求）：**对局中不弹「服务器已更新」**，只在大厅 / 房间准备阶段 / 结算界面弹。
  //   这两次订阅要分开写：selectRoute 只返回路由字符串，拿不到 phase，而结算界面（RESULT）
  //   的路由仍然是 'game' —— 只看路由会把结算也当成「对局中」一并挡掉。
  const route = useStore(selectRoute);
  const phase = useStore((s) => s.match?.public?.phase);
  const hintAllowed = updateHintAllowed(route, phase);
  // ★ 2026-11-05（维护者：「在准备室里点刷新页面就被踢出房间了」）：
  //   本组件所有「刷新页面」按钮都改成 reloadKeepingRoom() —— 刷新前把当前房间号写进
  //   sessionStorage，刷新回来由大厅 LobbyScreen 自动回一次房间（读侧在 screens/lobby.js）。
  //   只有这个按钮会留标记：普通刷新 / 新标签页 / 换浏览器都不会自动回房，
  //   2026-10-27「恢复对局必须玩家自己点」的规矩不变。
  const roomCode = useStore((s) => s.room?.code || null);
  const inDive = useStore((s) => s.room?.variant === 'deepecho' || s.match?.public?.echo?.deepecho === true);
  const reloadKeepingRoom = () => {
    try {
      if (roomCode) sessionStorage.setItem('sp.rejoinRoom', String(roomCode));
    } catch { /* 隐私模式 / 禁用存储：退化成普通刷新 */ }
    location.reload();
  };
  // Hidden admin watch is not the player's page: a new build must not offer/force a 刷新状态 there.
  const adminWatch = (() => {
    try {
      const qs = new URLSearchParams(location.search);
      return qs.get('adminWatch') === '1' || qs.get('watchGuest') === '1' || !!qs.get('watchToken')
        || !!sessionStorage.getItem('sp_admin_watch_code') || !!localStorage.getItem('sp_admin_watch_code');
    } catch { return false; }
  })();
  // ★ 2026-10-31：除了「本节点的 build 变了」（buildGuard），再加一条「**本节点跑的是旧代码**」。
  //   两者是不同的东西：
  //     · buildStale —— 这一页加载之后，同一节点的 /healthz.build 变了（节点重启换版）
  //     · oldNode    —— nginx 明确说这台节点不接新玩家了（X-SP-Accepts-New: 0），
  //                    也就是它还在跑旧代码，刷新能换到新节点上。
  //   维护者在 node-7（旧代码、build 一直没变）上等不到任何提示，就是缺了这一条：
  //   那台节点没重启过，buildGuard 永远不会说「有新版本」。
  //   探测频率与 buildGuard 一致（60s）。★ 2026-10-31 修正：原来这里注释说「只在不在对局里时才提示」，
  //   但代码其实没做这个限制 —— 于是对局中也照样弹（buildStale 那条同样弹）。现在统一由
  //   updateHintAllowed 把关：对局中一律不显示，只在大厅 / 房间准备阶段 / 结算界面显示。
  const [oldNode, setOldNode] = useState(false);
  useEffect(() => {
    if (adminWatch) return undefined;
    let alive = true;
    const f = globalThis.fetch;
    if (typeof f !== 'function') return undefined;
    const probe = () => {
      checkNodeAcceptsNew((u, o) => f(u, o)).then((ok) => {
        if (!alive) return;
        // counts as "old code" only when the header says so explicitly (null = 判断不了，不动)
        if (ok === false) setOldNode(true);
        else if (ok === true) setOldNode(false);
      }).catch(() => { /* ignore */ });
    };
    probe();
    const t = setInterval(probe, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [adminWatch]);
  // ★ 2026-10-31：`stale` 只看「该不该提示刷新」这件事本身；**画不画**由 hintAllowed 决定。
  //   注意 `html.sp-conn`（给 toast 让位的那个 class）跟着的是 bannerVisible —— 用 hintAllowed 参与判断，
  //   否则横幅被藏起来、toast 却被无谓地压在下面。
  const stale = !adminWatch && (buildStale || oldNode);
  const staleShown = stale && hintAllowed;
  useTicker(conn.status === 'reconnecting' ? 500 : 0);
  useDocClass('sp-conn', bannerVisible(conn, entered, restoring, staleShown));
  if (!entered) return null;
  if (conn.status === 'online' && !restoring && !staleShown) return null;
  if (conn.status === 'online' && restoring) {
    // 深潜房不是同盟（维护者 2026-11-08）：说的对象跟着当前房间的模式走
    return html`<div class="conn-banner" role="status"><${Icon} name="refresh" /><span>${diveSyncing(inDive)}</span></div>`;
  }
  if (conn.status === 'online' && staleShown) {
    // the server has a newer build than this page: the guard reloads by itself once the match is over, the button is
    // for a player who would rather do it now
    return html`<div class="conn-banner" role="alert">
      <${Icon} name="refresh" />
      <span>${t('服务器已更新，请刷新页面')}</span>
      <${Button} size="sm" variant="secondary" icon="refresh" onClick=${reloadKeepingRoom}>${t('刷新页面')}<//>
    </div>`;
  }
  if (!conn.everOnline && (conn.status === 'connecting' || conn.status === 'handshaking' || conn.status === 'idle')) return null;
  const secs = conn.retryAt ? Math.max(0, Math.ceil((conn.retryAt - Date.now()) / 1000)) : 0;
  const replaced = conn.status === 'closed' && conn.lastError?.code === 'REPLACED';
  const rejected = conn.status === 'connected' && !!conn.lastError; // hello refused (version, server full…)
  const versionMismatch = rejected && conn.lastError.text === CLIENT_ERR_TEXT.VERSION;
  // Short transitional states only show if they linger.
  // ★ 2026-11-01（维护者：「为什么我这里还是有网络中断的提示」）：
  //   节点被滚动重启时，玩家那条 WebSocket 会断 1–3 秒，前端自动重连就好。
  //   但 `reconnecting` **原本不在这里**，于是一断就立刻弹横幅 —— 看到的就是「闪一下」。
  //   维护者要的是「节点追新代码时用户无感」，所以把重连也纳入「短状态」：
  //   用 conn-banner--soft（CSS 里 delay .6s 才出现），2 秒内连回来就什么都不显示。
  //   ⚠ 真的连不上（超过 2 秒）时横幅照样出现，而且 `retryNow` 按钮仍在 —— 不掩盖真故障。
  const flapping = conn.status === 'reconnecting';
  const transient = conn.status === 'connecting' || conn.status === 'handshaking'
    || flapping || (conn.status === 'connected' && !rejected);
  const text = conn.status === 'reconnecting'
    ? t('与服务器的连接已中断，正在重连')
    : replaced ? t('该身份已在其他页面登录')
      : conn.status === 'closed' ? t('连接已关闭')
        : rejected ? t(conn.lastError.text) : t('正在连接服务器');
  const action = conn.status === 'reconnecting' ? { label: t('立即重连'), run: () => net.retryNow() }
    : conn.status === 'closed' ? { label: replaced ? t('在此页面继续') : t('重新连接'), run: () => net.connect() }
      : versionMismatch ? { label: t('刷新页面'), run: reloadKeepingRoom }
        : rejected ? { label: t('重试'), run: () => net.reconnectNow() } : null;
  // flap（断线重连）用 2 秒宽限；其他短状态沿用 .6 秒
  const bannerCls = `conn-banner${flapping ? ' conn-banner--flap' : transient ? ' conn-banner--soft' : ''}`;
  return html`<div class=${bannerCls} role="alert">
    <${Icon} name="wifiOff" />
    <span>${text}</span>
    ${conn.status === 'reconnecting' ? html`<span class="conn-banner__sub">${t('第 {attempt} 次 · {secs}s', { attempt: conn.attempt, secs })}</span>` : null}
    ${action ? html`<${Button} size="sm" variant="secondary" icon="refresh" onClick=${action.run}>${action.label}<//>` : null}
  </div>`;
}
