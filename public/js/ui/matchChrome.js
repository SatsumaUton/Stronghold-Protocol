// Chrome shared by every in-match screen: the step header of the pre-game screens (exit + ping +
// difficulty | "1/2 确认本局信息" | countdown) and the exit flow (confirm with 暂离 / 放弃, AI 托管 overlay).
//
// 暂离 (co-op): turns on AI 托管 (g.autoplay on) so the seat keeps playing; the overlay's 返回模拟 turns it
// off. 放弃模拟: g.leave then room.leave (the platform treats it as a quit), back to the lobby.

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, PingPill, DifficultyTag, Countdown, MicroLabel } from './components.js';
import { actions } from './gameActions.js';
import { toastError } from './toasts.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, createStore, isSpectating } from '../store.js';
import { GIcon } from './gameComponents.js';
import { GuideButton } from './guide.js';
import { recordQuit } from './stats.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';
import { TestMark } from './testConsole.js';

/**
 * Exit dialog lines. 放弃模拟 (g.leave → room.leave) ends the run on the server as 'abandoned' and returns to the
 * lobby straight away — no settlement screen follows, so the solo text must not promise one.
 */
export const EXIT_TEXT = Object.freeze({
  soloRest: N_('独立模拟的休整期没有时间限制，你可以随时继续。'),
  soloQuit: N_('放弃模拟将立即结束本局并返回大厅，本局进度不会保留，也不会进行结算。'),
});

/**
 * Is the match on screen a 「深渊回响」 deep dive? (the room's variant, or the running match's public frame)
 * @param {any} s store state
 */
export const isEchoRun = (s) => s?.room?.variant === 'deepecho' || !!s?.match?.public?.echo?.deepecho;
/** The same, as a hook. */
export const useEchoRun = () => useStore(isEchoRun);

/**
 * The exit flow's wording. 深渊回响 is a deep dive, not a 模拟: the same 暂离 / 放弃 flow keeps its buttons, but they say
 * 深潜 instead (maintainer 2026-11-06: "深渊回响中的退出按钮改一下，不再是模拟了").
 * @param {boolean} echo whether this match is a 深渊回响 deep dive
 */
export const exitWords = (echo) => (echo
  ? {
    title: N_('离开深潜'), micro: 'LEAVE DEEP DIVE', quit: N_('放弃深潜'), back: N_('返回深潜'),
    soloRest: N_('深潜的休整期没有时间限制，你可以随时继续。'),
    // 2026-11-07 晚：放弃深潜不再「直接离开不结算」，而是走「主动放弃」——单/双人立刻结算，
    // 多人全员投票；发起入口就是左上角这个对话框（原来另做的抽屉入口已删）。
    soloQuit: N_('放弃深潜会立刻结算本次深潜并显示结算界面（深度、祝福、盟约都会保留在结算里）。'),
    quitLine: N_('{quit}：需要全队投票 —— 所有存活玩家都同意后才会结算；有人不同意或 30 秒未投完则继续深潜。'),
    quitElsewhere: N_('现在不在休整期：{quit} 会直接退出本次深潜，不会结算（想结算请等休整期）。'),
    voteLine: N_('「放弃深潜」的投票正在进行：已同意 {n}/{m}，所有存活玩家都同意后立刻结算。'),
  }
  : {
    title: N_('离开模拟'), micro: 'LEAVE SIMULATION', quit: N_('放弃模拟'), back: N_('返回模拟'),
    soloRest: EXIT_TEXT.soloRest,
    soloQuit: EXIT_TEXT.soloQuit,
    quitLine: N_('{quit}：离开后无法返回本局，你的干员将回到共享卡池。'),
  });

/** Local "暂离 / AI 托管" flag (the server keeps no per-client autoplay view). */
export const awayStore = createStore({ away: false });

/**
 * Whether a store change ends the match the 暂离 flag belongs to: its state was cleared (result → 返回同盟, 放弃模拟, a
 * new match starting, the room closing, a new server session) or its settlement arrived. The next match must never
 * open under the previous one's "AI 托管中" overlay (the server starts every match with autoplay off).
 * @param {any} s store state
 * @param {any} prev previous store state
 */
export const awayEnds = (s, prev) => (!!prev?.match?.public && !s?.match?.public) || (!!s?.match?.result && !prev?.match?.result);
store.subscribe((s, prev) => { if (awayStore.get().away && awayEnds(s, prev)) awayStore.set({ away: false }); });

/**
 * Leave the match for good (g.leave → room.leave), then drop local room/match state. The server sends a leaver no
 * settlement, so the page records the match itself before it is cleared (本机统计, ui/stats.js recordQuit: a 中途退出
 * entry of the history; it counts only when a round had been cleared) — once the leave went through.
 * @returns {Promise<void>}
 */
export async function quitMatch() {
  const before = store.get();
  const adminWatch = (() => {
    try {
      return /(?:^|[?&])adminWatch=1(?:&|$)/.test(location.search) || !!sessionStorage.getItem('sp_admin_watch_code');
    } catch { return false; }
  })();
  let left = false;
  try {
    try { await net.request('g.leave', {}); } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM' && err?.code !== 'WRONG_PHASE' && err?.code !== 'OFFLINE') throw err;
    }
    try { await net.request('room.leave', {}); } catch (err) { if (err?.code !== 'NOT_IN_ROOM' && err?.code !== 'OFFLINE') throw err; }
    left = true;
    // 记录「刚刚主动离开对局」：账号观察者据此在一段时间内不把玩家自动送回对局，
    // 否则服务端房间尚未清理时，一退出就会被 /api/account/room 重新导航回去，页面反复刷新。
    try { sessionStorage.setItem('sp.matchExitAt', String(Date.now())); } catch { /* ignore */ }
    // sessionStorage 是每个标签页各自一份：换设备/新标签页打开时看不到上面这条，
    // 于是「退出对局后在新标签页里又被送回对局」。这里再写一份到 localStorage，
    // 账号观察者的自动恢复据此同样在 2 分钟内退让。
    try { localStorage.setItem('sp.matchExitAtShared', String(Date.now())); } catch { /* ignore */ }
    // 主动退出对局 = 不是要回这个房间。必须清掉 sp.lastRoom：
    // matchmaker/public/client.js 的 installAutoRejoin 每 1.5 秒检查一次，
    // 只要 store 里没有 room 就会用它自动 room.join 回旧房间 ——
    // 表现为「退出对局回到大厅后又自己刷新/跳回去一次」。
    // （以前这句只写在下面的 adminWatch 分支里，普通玩家从来不会被清。）
    try { localStorage.removeItem('sp.lastRoom'); } catch { /* ignore */ }
    try { sessionStorage.removeItem('sp.accountResume'); } catch { /* ignore */ }
    try { sessionStorage.removeItem('sp.accountResumeSilent'); } catch { /* ignore */ }
    if (adminWatch) {
      // A hidden watcher is not a room member: after leaving, do not let auto-rejoin/deep-link
      // try to room.join the started match on the way back to the lobby.
      // （sp.lastRoom 已在上面为所有玩家清除，这里不用再清一次。）
      try {
        localStorage.removeItem('sp_watch_token');
        localStorage.removeItem('sp_admin_watch_code');
        localStorage.removeItem('sp_admin_watch_node');
        localStorage.removeItem('sp_admin_watch_name');
        // Shared marker for tabs opened after the watch closes: suppress stale join/account
        // recovery toasts and pending joins for a short cooldown.
        localStorage.setItem('sp_admin_watch_closed_at', String(Date.now()));
      } catch { /* ignore */ }
      try {
        sessionStorage.removeItem('sp_admin_watch_code');
        sessionStorage.removeItem('sp_admin_watch_token');
        sessionStorage.removeItem('sp.accountResume');
        sessionStorage.removeItem('sp.accountResumeSilent');
        sessionStorage.removeItem('sp.accountResumeHopAt');
      } catch { /* ignore */ }
      try {
        for (const name of ['sp_admin_watch_code', 'sp_admin_watch_node', 'sp_admin_watch_name', 'sp_watch_token']) {
          document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax';
        }
      } catch { /* ignore */ }
      try {
        const u = new URL(location.href);
        u.searchParams.delete('room');
        u.searchParams.delete('adminWatch');
        u.searchParams.delete('watchToken');
        u.searchParams.delete('accountResume');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      } catch { /* ignore */ }
      store.patch('ui', { pendingJoin: null, pendingSpectate: false });
      // The game runs inside /mm/watch.html: closing the hidden-watch action closes that tab
      // instead of leaving its admin-watch title/favicon behind or returning to the admin console.
      try {
        if (window.top && window.top !== window) { window.top.close(); return; }
        window.close();
        return;
      } catch { /* ignore */ }
    }
    try { window.dispatchEvent(new Event('sp-room-left')); } catch { /* ignore */ }
  } catch (err) {
    toastError(err);
  } finally {
    // (a settlement that arrived while the leave was in flight is the match's record already)
    if (left && !store.get().match.result) {
      try { recordQuit(before); } catch (err) { console.warn('[stats] quit record failed', err); }
    }
    store.set({ room: null, match: emptyMatch() });
    // Leaving a room must not leave a "正在同步同盟状态…" or build-refresh banner behind.
    store.patch('ui', { restoring: false, buildStale: false });
  }
}

/**
 * Exit confirmation modal.
 * @param {{ open: boolean, onClose: Function, solo: boolean, onAway?: Function }} props
 */
export function ExitModal({ open, onClose, solo, onAway }) {
  const [busy, setBusy] = useState(null);
  const echo = useEchoRun();
  const w = exitWords(echo);
  // a spectator seat (community report #26) only leaves its seat: nothing of the match is given up
  // hidden admin watchers are not in room.spectators by design, but must use the same leave copy
  const adminWatch = (() => {
    try {
      return /(?:^|[?&])adminWatch=1(?:&|$)/.test(location.search) || !!sessionStorage.getItem('sp_admin_watch_code');
    } catch { return false; }
  })();
  const spectator = useStore((s) => isSpectating(s.room, s.me.playerId)) || adminWatch;
  // 「放弃深潜」的发起入口就是这里（维护者 2026-11-07 晚：不要再另做一个）。
  // 休整期 + 存活 → 走「主动放弃」：单人立刻结算、多人全员投票；其他阶段 / 已淘汰 → 还是原来的直接离开。
  const pub = useStore((s) => (s.match && s.match.public) || null);
  const myId = useStore((s) => (s.me && s.me.playerId) || null);
  const echoVote = echo && pub && pub.echo && pub.echo.giveUp ? pub.echo.giveUp : null;
  const meRow = pub && Array.isArray(pub.players) ? pub.players.find((p) => p && p.playerId === myId) : null;
  const echoGiveUp = !!(echo && pub && !spectator && pub.phase === 'PREP' && (!meRow || meRow.alive !== false) && !echoVote);
  const quit = async () => {
    setBusy('quit');
    if (echoGiveUp) {
      const ok = await actions.echoGiveUp();
      setBusy(null);
      if (ok) onClose();
      return;
    }
    await quitMatch();
    setBusy(null);
    onClose();
  };
  if (spectator) {
    return html`<${Modal} open=${open} onClose=${onClose} tone="red" title=${t('离开观战')} micro="LEAVE SPECTATING" width="6.8rem"
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('取消')}<//>
        <${Button} variant="danger" icon="exit" loading=${busy === 'quit'} onClick=${quit}>${t('离开观战')}<//>`}>
      <div class="exitm"><p>${t('离开观战席并返回大厅，本局模拟不受影响；观战席空着时可以凭同盟密钥再次观战。')}</p></div>
    <//>`;
  }
  const away = async () => {
    setBusy('away');
    const ok = await actions.autoplay(true);
    setBusy(null);
    onClose();
    if (ok) { awayStore.set({ away: true }); onAway?.(); }
  };
  const quitLine = echo && !echoGiveUp
    ? tParts(w.quitElsewhere, { quit: html`<b class="t-red">${t(w.quit)}</b>` })
    : solo ? t(w.soloQuit) : tParts(w.quitLine, { quit: html`<b class="t-red">${t(w.quit)}</b>` });
  // 单人房（房间里只有一个真人：单人模式 / 1 真人 + 3 AI / 单人深潜）关掉页面就等于存档 ——
  // 服务端把重连窗口拉到 24 小时（lobby.soloLikeRun / soloResumeWindowMs）。维护者 2026-11-08：
  // 「在保存的位置告诉玩家怎么继续打开自己的 24 小时的房间」，否则玩家以为「离开 = 丢局」。
  const loneHuman = (() => {
    const ps = pub && Array.isArray(pub.players) ? pub.players.filter(Boolean) : null;
    if (!ps) return !!solo;
    return ps.filter((p) => !p.isBot).length <= 1;
  })();
  return html`<${Modal} open=${open} onClose=${onClose} tone="red" title=${t(w.title)} micro=${w.micro} width="6.8rem"
    actions=${html`
      <${Button} variant="secondary" onClick=${onClose}>${t('取消')}<//>
      ${!solo ? html`<${Button} variant="ice" icon="robot" loading=${busy === 'away'} onClick=${away}>${t('暂离（AI 托管）')}<//>` : null}
      <${Button} variant="danger" icon="exit" loading=${busy === 'quit'} disabled=${!!echoVote} onClick=${quit}>${t(w.quit)}<//>`}>
    <div class="exitm">
      ${solo
        ? html`<p>${t(w.soloRest)}</p><p class="t-lo">${quitLine}</p>`
        : html`<p>${tParts('{away}：由 AI 托管你的席位（自动部署、准备与选择），随时可以返回。', { away: html`<b class="t-ice">${t('暂离')}</b>` })}</p>
               <p>${quitLine}</p>`}
      ${(solo || loneHuman) ? html`<div class="exitm__save" role="note">
        <b class="exitm__save-t">${t('想留着这局？直接关掉页面就行')}</b>
        <span class="exitm__save-d">${t('24 小时内用同一浏览器打开本站会自动回到这一局；换设备就在大厅右上角点「恢复对局」。')}</span>
      </div>` : null}
      ${echoVote ? html`<p class="t-dim">${t(w.voteLine, { n: (echoVote.agreed || []).length, m: (echoVote.voters || []).length })}</p>` : null}
    </div>
  <//>`;
}

/** Full-screen "AI 托管中" overlay with 返回模拟. */
export function AwayOverlay({ onBack = () => {} }) {
  const [busy, setBusy] = useState(false);
  const w = exitWords(useEchoRun());
  return html`<div class="awayov" role="dialog" aria-label=${t('AI 托管中')}>
    <div class="awayov__box brackets">
      <${GIcon} name="robot" class="awayov__icon" />
      <${MicroLabel} tone="mint">${t('AUTOPILOT // AI 托管')}</${MicroLabel}>
      <h2>${t('AI 托管中')}</h2>
      <p class="t-lo">${t('AI 正在代为操作你的席位')}</p>
      <${Button} variant="primary" size="lg" icon="play" loading=${busy} onClick=${async () => { setBusy(true); const ok = await actions.autoplay(false); setBusy(false); if (ok) { awayStore.set({ away: false }); onBack(); } }}>${t(w.back)}<//>
    </div>
  </div>`;
}

/**
 * Pre-game step header.
 * @param {{ step: number, of: number, title: string, micro: string, pub: any, total?: number|null, onExit: Function, extra?: any, status?: any }} props
 */
export function StepHeader({ step, of, title, micro, pub, total, onExit, extra = null, status = null }) {
  const conn = useStore((s) => s.connection, shallowEqual);
  return html`<header class="stephead">
    <div class="stephead__left">
      <${Button} variant="danger" size="lg" square=${true} icon="exit" onClick=${onExit} aria-label=${t('离开')} title=${t('离开')} />
      <div class="stephead__meta">
        <${PingPill} ms=${conn.ping} online=${conn.status === 'online'} />
        ${pub?.difficulty ? html`<${DifficultyTag} difficulty=${pub.difficulty} />` : null}
        ${pub?.test ? html`<${TestMark} />` : null}
      </div>
    </div>
    <div class="stephead__center">
      <${MicroLabel} tone="mint">${micro}</${MicroLabel}>
      <h1 class="stephead__title"><b class="num">${step}</b><span class="num stephead__of">/${of}</span>${title}</h1>
    </div>
    <div class="stephead__right">
      ${extra}
      ${status ? html`<div class="stephead__status">${status}</div><i class="stephead__sep" aria-hidden="true"></i>` : null}
      <${GuideButton} class="stephead__guide" variant="secondary" />
      <${Countdown} deadline=${pub?.deadline} total=${total ?? undefined} size="md" />
    </div>
  </header>`;
}

