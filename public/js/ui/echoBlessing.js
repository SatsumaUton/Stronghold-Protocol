// ui/echoBlessing.js — 「深渊回响」的祝福三选一（DESIGN-ABYSS.md §6）。
//
// 为什么必须有人做这个界面：每 5 个深潜回合服务端会开一次三选一（m.public.echo.offer），
// 并且**要等所有在线真人投完票才结算**。没有这个面板，全队会卡在那里、也没有任何提示。
//
// 形态参照「悬赏目标 / 选择策略」那种**居中的卡片选择**（维护者 2026-11-04：
// 原来是一条顶部 strip，三项挤成三个小按钮，看不清也点不准）。
// 服务端：g.echoBlessing { pick } → MatchEcho.setEchoBlessingVote（票多者得，平票取靠前）。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { actions } from './gameActions.js';
import { useStore, serverNow } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function EchoBlessing({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(null);
  const [now, setNow] = useState(() => serverNow());
  const pending = useRef(false);
  const echo = pub?.echo;
  const offer = echo?.offer;
  if (!offer || !Array.isArray(offer.options) || !offer.options.length) return null;
  // 倒计时：服务端在 offer.endsAt 到点后强制结算（维护者 2026-11-04：看不到还剩多久）
  const left = Number.isFinite(offer.endsAt) && offer.endsAt > 0 ? Math.max(0, Math.ceil((offer.endsAt - now) / 1000)) : null;
  const votes = offer.votes || {};
  const myPick = votes[myId];
  const players = pub?.players || [];
  // 只有在线真人投票（服务端同一口径：离线的人既不计数也不阻塞）
  const voters = players.filter((p) => !p.isBot && p.status !== 'left' && p.connected);
  const voted = voters.filter((p) => votes[p.playerId] != null).length;
  useEffect(() => {
    if (left == null) return undefined;
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, [left == null]);
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } finally { pending.current = false; setBusy(false); }
  };
  const pick = (i) => { if (busy || !online || myPick != null) return; setArmed(i); send(() => actions.echoBlessing(i)); };
  return html`<div class="echo-bless-overlay" role="dialog" aria-label=${t('深渊祝福')} aria-live="polite">
    <div class="echo-bless">
      <header class="echo-bless__head">
        <b>${t('深渊祝福 · 三选一')}</b>
        <span>${t('全队在线博士都选完后自动结算：票数最多的一项生效，平票取靠前的一项。')}</span>
        ${left != null ? html`<span class="echo-bless__timer" aria-live="off"><b>${left}</b><i>秒</i></span>` : null}
        <span class="echo-bless__count">${voted}/${voters.length}</span>
      </header>
      <div class="echo-bless__cards">
        ${offer.options.map((opt, i) => {
          const mine = myPick === i;
          const picked = armed === i && myPick == null;
          const who = voters.filter((p) => votes[p.playerId] === i).map((p) => p.name);
          return html`<button key=${opt.id} type="button"
            class=${`echo-bless__card${mine ? ' is-mine' : ''}${picked ? ' is-armed' : ''}`}
            disabled=${busy || !online || myPick != null}
            onClick=${() => pick(i)}>
            <span class="echo-bless__glyph" aria-hidden="true">${(opt.name || '?').slice(0, 1)}</span>
            <b class="echo-bless__name">${opt.name}</b>
            <span class="echo-bless__desc">${opt.desc || ''}</span>
            ${who.length ? html`<span class="echo-bless__votes">${who.join('、')}</span>` : null}
          </button>`;
        })}
      </div>
      <footer class="echo-bless__foot">
        ${myPick != null
          ? html`<span>${t('已选择「{name}」，等待队友…', { name: offer.options[myPick]?.name || t('已选择') })}</span>`
          : html`<span>${t('点一张卡投票；全队在线的人都选完才结算。')}</span>`}
      </footer>
    </div>
  </div>`;
}
