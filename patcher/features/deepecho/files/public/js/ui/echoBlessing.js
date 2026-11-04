// ui/echoBlessing.js — 「深渊回响」的祝福三选一（DESIGN-ABYSS.md §6）。
//
// 为什么必须有人做这个界面：每 5 个深潜回合服务端会开一次三选一（m.public.echo.offer），
// 并且**要等所有在线真人投完票才结算**。没有这个面板，全队会卡在那里、也没有任何提示。
//
// 形态沿用「重刷本局」那条 strip 的样式（brief-reroll），所以不用新增 CSS。
// 服务端：g.echoBlessing { pick } → MatchEcho.setEchoBlessingVote（票多者得，平票取靠前）。
import { useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { actions } from './gameActions.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function EchoBlessing({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const echo = pub?.echo;
  const offer = echo?.offer;
  if (!offer || !Array.isArray(offer.options) || !offer.options.length) return null;
  const votes = offer.votes || {};
  const myPick = votes[myId];
  const players = pub?.players || [];
  // 只有在线真人投票（服务端同一口径：离线的人既不计数也不阻塞）
  const voters = players.filter((p) => !p.isBot && p.status !== 'left' && p.connected);
  const voted = voters.filter((p) => votes[p.playerId] != null).length;
  const nameOf = (pid) => players.find((p) => p.playerId === pid)?.name || pid;
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } finally { pending.current = false; setBusy(false); }
  };
  return html`<section class="brief-reroll echo-bless" aria-label=${t('深渊祝福')} aria-live="polite">
    <div class="brief-reroll__text">
      <strong>${t('深渊祝福 · 三选一（{voted}/{total} 已选）', { voted, total: voters.length })}</strong>
      <span>${t('全队在线的博士都选完后自动结算；票数最多的一项生效，平票时取靠前的一项。')}</span>
      <div class="brief-reroll__players">
        ${voters.map((p) => {
          const pick = votes[p.playerId];
          const label = pick == null ? t('待选择') : (offer.options[pick]?.name || t('已选择'));
          return html`<span key=${p.playerId} class=${pick == null ? '' : 'is-agreed'}>${p.name} · ${label}</span>`;
        })}
      </div>
    </div>
    <div class="brief-reroll__actions">
      ${offer.options.map((opt, i) => html`<button key=${opt.id} type="button"
          class=${`btn btn--${myPick === i ? 'primary' : 'secondary'} btn--md`}
          title=${opt.desc || ''}
          disabled=${busy || !online || myPick != null}
          onClick=${() => send(() => actions.echoBlessing(i))}>
          <b>${opt.name}</b><span>${opt.desc || ''}</span>
        </button>`)}
      ${myPick != null ? html`<span class="brief-reroll__text">${t('已选择「{name}」，等待队友…', { name: offer.options[myPick]?.name || t('已选择') })}</span>` : null}
    </div>
  </section>`;
}
