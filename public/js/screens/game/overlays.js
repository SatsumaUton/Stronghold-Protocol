// public/js/screens/game/overlays.js — the match-ended plate and the solo pause plate.

import { Button, MicroLabel, html } from '../../ui/components.js';
import { emptyMatch, store } from '../../store.js';
import { localAsset } from '../../data.js';
import { t } from '../../../../shared/i18n.js';

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
export function PausedOverlay({ canResume, busy, onResume, onExit }) {
  const plate = localAsset('ui/battle', 'matte_pause');
  return html`<div class="pauseov" role="dialog" aria-label=${t('暂停中')} data-testid="paused">
    <div class="pauseov__box">
      <div class="pauseov__plate" style=${plate ? `--pause-plate:url("${plate}")` : ''}>
        <span class="pauseov__micro">PAUSED</span>
        <h2>${t('暂停中')}</h2>
      </div>
      <p class="pauseov__note">${t('作战已暂停，计时与敌人行动均已停止')}</p>
      <div class="pauseov__btns">
        ${onExit ? html`<${Button} variant="secondary" size="lg" icon="exit" onClick=${onExit}>${t('放弃模拟')}<//>` : null}
        ${canResume ? html`<${Button} variant="primary" size="lg" icon="play" loading=${busy} onClick=${onResume} data-autofocus>${t('继续作战')}<//>` : null}
      </div>
    </div>
  </div>`;
}
