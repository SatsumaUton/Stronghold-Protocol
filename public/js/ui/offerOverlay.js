// Native offer UI: two-tap confirmation and the choice overlay's responsive cards.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Countdown, Button } from './components.js';
import { GIcon } from './gameComponents.js';
import { spTap } from './choiceOverlay.js';
import { t } from '../../../shared/i18n.js';

export const offerSeat = (offer, myId) => offer?.seats?.find(s => s.playerId === myId) || null;
export const offerPickable = (offer, myId, readOnly, busy) => !readOnly && busy == null && offerSeat(offer, myId)?.picked === false;
const ICONS = { funds: 'sell', layers: 'bolt', item: 'shield', chess: 'rook', refresh: 'refresh' };

export function OfferOverlay({ pub, myId, readOnly = false, onAction }) {
  const [selected, setSelected] = useState(null);
  const [armed, setArmed] = useState(null);
  const [busy, setBusy] = useState(null);
  const root = useRef(null);
  const offers = pub?.offers || [];
  const offer = offers.find(o => o.seq === selected) || offers.find(o => offerSeat(o, myId)?.picked === false) || offers[0];
  useEffect(() => { setArmed(null); setBusy(null); }, [offer?.seq]);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.focus();
    return () => previous?.focus?.();
  }, []);
  if (!offer) return null;
  const can = offerPickable(offer, myId, readOnly, busy);
  const act = async (idx, refresh = false) => {
    if (!can) return;
    const token = `${offer.seq}:${idx}`;
    setArmed(null); setBusy(token);
    try { await onAction(offer, idx, refresh, offerSeat(offer, myId)?.slots[idx]?.id); }
    finally { setBusy(b => b === token ? null : b); }
  };
  const tap = idx => {
    const next = spTap(armed, idx, can);
    setArmed(next.armed);
    if (next.pick != null) void act(next.pick);
  };
  const onKeyDown = e => {
    if (e.key === 'Escape') { setArmed(null); e.stopPropagation(); }
    if (e.key !== 'Tab') return;
    const buttons = [...root.current.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { first.focus(); e.preventDefault(); }
  };
  return html`<div ref=${root} tabindex="-1" class="spov offerov" role="dialog" aria-modal="true" aria-label=${t('插件选择')} onKeyDown=${onKeyDown}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <nav class="offerov__tabs" aria-label=${t('插件选择')}>
        ${offers.map(o => html`<${Button} key=${o.seq} size="sm" onClick=${() => { setSelected(o.seq); setArmed(null); }} aria-pressed=${o.seq === offer.seq}>${o.pluginId} / ${o.id}<//>`)}
      </nav>
      <${OfferView} offer=${offer} myId=${myId} readOnly=${readOnly} busy=${busy} armed=${armed} onTap=${tap} onRefresh=${idx => act(idx, true)} />
    </div>
  </div>`;
}

/** Pure view for the native match popup and node rendering tests; all plugin text stays text. */
export function OfferView({ offer, myId, readOnly = false, busy = null, armed = null, onTap = () => {}, onRefresh = () => {} }) {
  const mine = offerSeat(offer, myId);
  const seat = mine || offer.seats[0];
  const can = offerPickable(offer, myId, readOnly, busy);
  return html`<header class="spov__head">
    <div><h2>${t('插件选择')} · ${offer.id}</h2><p>${t('点击卡牌选中，再次点击确认')}</p>
      <p role="status">${readOnly || !mine ? t('观战中') : mine.picked ? t('等待队友') : t('选择一项')}
        · ${t('还有 {n} 人未选择', { n: offer.waiting })}</p></div>
    <${Countdown} deadline=${offer.deadline} total=${offer.windowSec} size="md" />
  </header>
  <div class="spov__grid spov__grid--3">
    ${(seat?.slots || []).map(card => html`<div class="offerov__slot" key=${card.idx}>
      <button type="button" class=${`spcard ${can ? 'is-pickable' : ''} ${can && armed === card.idx ? 'is-armed' : ''}`}
        disabled=${!can} aria-pressed=${can && armed === card.idx} aria-busy=${busy != null} onClick=${() => onTap(card.idx)}
        aria-label=${armed === card.idx ? t('{name}，已选中，再次点击确认', { name: card.name }) : card.name}>
        <span class="spcard__head"><span class="spcard__icon" aria-hidden="true"><${GIcon} name=${ICONS[card.icon]} /></span>
          <b class="spcard__name">${card.name}</b></span>
        <span class="spcard__desc">${card.desc}</span>
        ${can && armed === card.idx ? html`<span class="spcard__confirm"><${Icon} name="check" />${t('确认选择')}</span>` : null}
      </button>
      <${Button} size="sm" icon="refresh" disabled=${!can || card.remaining <= 0} onClick=${() => onRefresh(card.idx)}>
        ${t('刷新（剩余 {n} 次）', { n: card.remaining })}<//>
    </div>`)}
  </div>`;
}
