// ui/echoSupply.js — 「深渊回响」16 层以后的深潜补给（维护者 2026-11-05）。
// 团队投票、共享一份：全队同一组候选，票多者得，效果全队共享一次。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { actions } from './gameActions.js';
import { useStore, serverNow } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function EchoSupplyPanel({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  // 死亡的玩家不参与补给投票（维护者 2026-11-05）
  const meAlive = useStore((s) => {
    const me = (s.match?.public?.players || []).find((p) => p.playerId === s.me.playerId);
    return me ? me.alive !== false : true;
  });
  const supply = pub?.echo?.supply;
  const online = useStore((s) => s.connection.status === 'online');
  const [armed, setArmed] = useState(null);
  const [now, setNow] = useState(() => serverNow());
  const pending = useRef(false);

  const options = supply && Array.isArray(supply.options) ? supply.options : [];
  const votes = (supply && supply.votes) || {};
  const myPick = votes[myId];
  const left = supply && Number.isFinite(supply.endsAt) && supply.endsAt > 0 ? Math.max(0, Math.ceil((supply.endsAt - now) / 1000)) : null;

  useEffect(() => {
    if (left == null) return undefined;
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, [left == null]);

  if (!meAlive || !supply || supply.pick != null || !options.length) return null;

  const voters = (pub?.players || []).filter((p) => !p.isBot && p.status !== 'left' && p.connected && p.alive !== false);
  const voted = voters.filter((p) => votes[p.playerId] != null).length;

  const confirm = () => {
    if (pending.current || !online || myPick != null || armed == null) return;
    pending.current = true;
    actions.echoSupply(armed);
    setArmed(null);
    pending.current = false;
  };

  const card = (o, i) => html`<button type="button" key=${i + o.name}
      class=${`echo-bless__card${armed === i ? ' is-armed' : ''}${myPick === i ? ' is-picked' : ''}`}
      onClick=${() => { if (myPick == null) setArmed(i); }}>
    <b class="echo-bless__name">${o.name}</b>
    ${o.desc ? html`<span class="echo-bless__desc">${o.desc}</span>` : null}
    ${o.kind === 'blessing' ? html`<em class="echo-bless__rar is-rare">${t('一次性祝福')}</em>` : null}
    ${o.kind === 'word' ? html`<em class="echo-bless__rar is-epic">${t('本层词条')}</em>` : null}
  </button>`;

  return html`<div class="echo-bless echo-supply" role="dialog" aria-label=${t('深潜补给')}>
    <header class="echo-bless__head">
      <h3>${t('深潜补给')} <small>${t('全队投票选一项，共享一份（{n}/{m}）', { n: voted, m: voters.length })}</small></h3>
      ${left != null ? html`<span class="echo-bless__count">${left}s</span>` : null}
    </header>
    <div class="echo-bless__cards">${options.map(card)}</div>
    <footer class="echo-bless__foot">
      <span class="echo-bless__hint">${myPick != null
        ? t('你已投「{name}」，等待队友…', { name: options[myPick].name })
        : armed == null ? t('先选一项，再点「确认」') : t('已选中「{name}」', { name: options[armed].name })}</span>
      <${Button} class="echo-bless__confirm" disabled=${myPick != null || armed == null} onClick=${confirm}>
        ${t('确认')}
      </${Button}>
    </footer>
  </div>`;
}
