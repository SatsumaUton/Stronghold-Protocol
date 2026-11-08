// public/js/screens/game/overlays.js — the match-ended plate and the solo pause plate.

import { Button, MicroLabel, html } from '../../ui/components.js';
import { emptyMatch, store } from '../../store.js';
import { localAsset } from '../../data.js';
import { t } from '../../../../shared/i18n.js';
import { exitWords, useEchoRun } from '../../ui/matchChrome.js';
import { cx } from './marks.js';

/**
 * 这一局是怎么没的（room.endReason，server/lobby.js 的 toState 下发）。
 *
 * 为什么需要区分：对局被打断时没有结算帧，玩家看到的就是这块浮层。以前这里写死成
 * 「服务器重启导致对局中断」—— 于是**管理员主动终止**的对局也被说成服务器重启，
 * 玩家会以为出了故障。现在按真实原因说话。
 *
 * 只认几个已知值，其余一律走兜底：宁可含糊，也不编一个具体原因。
 */
function endReasonText(reason) {
  switch (reason) {
    case 'admin-aborted': return t('管理员终止了这一局，同盟已返回等待室');
    case 'restart-aborted': return t('服务器重启导致对局中断，同盟已返回等待室');
    case 'plugin-crash': case 'plugin-hang': case 'plugin-start':
      return t('插件运行异常，这一局已中断，同盟已返回等待室');
    default: return t('这一局已中断，同盟已返回等待室');
  }
}

/** The room went back to its lobby without a result (match aborted): offer the way back. */
export function MatchEnded({ reason = null } = {}) {
  return html`<div class="awayov" role="dialog" aria-label=${t('模拟已结束')}>
    <div class="awayov__box brackets">
      <${MicroLabel} tone="mint">SIMULATION CLOSED</${MicroLabel}>
      <h2>${t('本局模拟已结束')}</h2>
      <p class="t-lo">${endReasonText(reason)}</p>
      <${Button} variant="primary" size="lg" icon="chevronLeft" onClick=${() => store.set({ match: emptyMatch() })}>${t('返回同盟')}<//>
    </div>
  </div>`;
}

/** Solo pause (m.public.paused): the field dims under the 暂停中 plate; 继续作战 resumes (g.pause off). */
export function PausedOverlay({ canResume, busy, onResume, onExit }) {  const plate = localAsset('ui/battle', 'matte_pause');
  const w = exitWords(useEchoRun());
  return html`<div class="pauseov" role="dialog" aria-label=${t('暂停中')} data-testid="paused">
    <div class="pauseov__box">
      <div class="pauseov__plate" style=${plate ? `--pause-plate:url("${plate}")` : ''}>
        <span class="pauseov__micro">PAUSED</span>
        <h2>${t('暂停中')}</h2>
      </div>
      <p class="pauseov__note">${t('作战已暂停，计时与敌人行动均已停止')}</p>
      <div class="pauseov__btns">
        ${onExit ? html`<${Button} variant="secondary" size="lg" icon="exit" onClick=${onExit}>${t(w.quit)}<//>` : null}
        ${canResume ? html`<${Button} variant="primary" size="lg" icon="play" loading=${busy} onClick=${onResume} data-autofocus>${t('继续作战')}<//>` : null}
      </div>
    </div>
  </div>`;
}

/**
 * 「暂停游戏」的全员投票：暂停中盖在整局上的浮层（维护者 2026-11-08）。
 *
 * 样子照抄「服务器重启导致对局中断」那块（awayov / awayov__box），因为玩家已经认得那个「对局停住了」的界面；
 * 区别是这里不是结束，而是**等所有人确认**：每个在线队友点一次「继续游戏」，全员点完才恢复。
 * 文案（维护者让我定）：
 *   * 标题「对局已暂停」，眉标 PAUSED · 全员确认后继续；
 *   * 说明：谁发起的、什么停了（倒计时与战斗）、怎么继续（每个在线队友各点一次「继续游戏」）；
 *   * 按钮：还没点 =「继续游戏」，点过 =「已确认 · 等待队友（n/N）」；
 *   * 底下补一句兜底（暂停超过 10 分钟自动继续），免得有人以为能一直扣着。
 * @param {{ active: any, players?: any[], myId?: string|null, busy?: boolean, onResume: () => void }} props
 */
export function PauseVoteOverlay({ active, players = [], myId = null, busy = false, onResume }) {
  if (!active) return null;
  const resumed = Array.isArray(active.resumed) ? active.resumed : [];
  const mine = !!myId && resumed.includes(myId);
  const need = Math.max(1, Number(active.need) || 1);
  const count = `${resumed.length}/${need}`;
  const roster = (Array.isArray(players) ? players : []).filter((p) => p && !p.isBot && p.alive !== false);
  return html`<div class="awayov" role="dialog" aria-label=${t('对局已暂停')} data-testid="pause-vote-overlay">
    <div class="awayov__box brackets pausevote__box">
      <${MicroLabel} tone="mint">PAUSED · ${t('全员确认后继续')}</${MicroLabel}>
      <h2>${t('对局已暂停')}</h2>
      <p class="t-lo">${active.byName
        ? t('{name} 发起了暂停。倒计时与战斗都已停下，所有在线队友各点一次「继续游戏」之后，对局会从暂停处接着进行。', { name: active.byName })
        : t('倒计时与战斗都已停下，所有在线队友各点一次「继续游戏」之后，对局会从暂停处接着进行。')}</p>
      ${roster.length ? html`<ul class="pausevote__list">
        ${roster.map((p) => html`<li key=${p.playerId} class=${cx('pausevote__who', resumed.includes(p.playerId) && 'is-ok')}>
          <i class="pausevote__mark" aria-hidden="true">${resumed.includes(p.playerId) ? '✓' : '…'}</i>
          <span>${p.name || t('队友')}</span>
          <em>${resumed.includes(p.playerId) ? t('已确认') : t('等待中')}</em>
        </li>`)}
      </ul>` : null}
      <p class="pausevote__countline">${t('已确认 {n}/{m} 人', { n: resumed.length, m: need })}</p>
      <${Button} variant="primary" size="lg" icon="play" loading=${busy} disabled=${mine} onClick=${onResume} data-autofocus>
        ${mine ? t('已确认 · 等待队友（{n}/{m}）', { n: resumed.length, m: need }) : t('继续游戏')}<//>
      <p class="t-dim pausevote__note">${t('暂停超过 10 分钟会自动继续。')}</p>
    </div>
  </div>`;
}
