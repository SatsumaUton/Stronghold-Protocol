// ui/echoProjection.js — 「盟约投影」（维护者 2026-11-05）。
//
// 16 层起每 10 层一次的全队三选一：拿到之后**即使没有那条核心盟约**，场上所有己方干员也按满档享受它的效果。
// 全程只能同时存在一个，不占 3 个祝福名额，也不进原版三选一池；再触发时选新的会替换旧的。
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { actions } from './gameActions.js';
import { useStore, serverNow } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function EchoProjectionPanel({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  const meAlive = useStore((s) => {
    const me = (s.match?.public?.players || []).find((p) => p.playerId === s.me.playerId);
    return me ? me.alive !== false : true;
  });
  const online = useStore((s) => s.connection.status === 'online');
  const [now, setNow] = useState(() => serverNow());
  const box = pub?.echo?.projection?.offer || null;
  const current = pub?.echo?.projection?.current || null;
  const options = box && Array.isArray(box.options) ? box.options : [];
  const votes = (box && box.votes) || {};
  const myPick = votes[myId];
  const left = box && Number.isFinite(box.endsAt) && box.endsAt > 0 ? Math.max(0, Math.ceil((box.endsAt - now) / 1000)) : null;

  useEffect(() => {
    if (left == null) return undefined;
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, [left == null]);

  if (!meAlive || !box || box.pick != null || !options.length) return null;

  const voters = (pub?.players || []).filter((p) => !p.isBot && p.status !== 'left' && p.connected && p.alive !== false);
  const voted = voters.filter((p) => votes[p.playerId] != null).length;
  const vote = (i) => { if (myPick == null && online) actions.echoProjection(i); };

  const card = (o, i) => {
    const who = voters.filter((p) => votes[p.playerId] === i).map((p) => p.name);
    const isCurrent = current && current.id === o.id;
    return html`<button type="button" key=${o.id}
      class=${`echo-bless__card${myPick === i ? ' is-picked' : ''}${isCurrent ? ' is-armed' : ''}`}
      onClick=${() => vote(i)}>
      <b class="echo-bless__name">${o.name}</b>
      ${o.desc ? html`<span class="echo-bless__desc">${o.desc}</span>` : null}
      <em class="echo-bless__rar is-epic">${isCurrent ? t('当前投影') : t('核心盟约 · 满档')}</em>
      <span class="echo-bless__votes">${who.length ? who.join('、') : t('无人投票')}</span>
    </button>`;
  };

  return html`<div class="echo-bless-overlay" role="dialog" aria-label=${t('盟约投影')} aria-live="polite">
    <div class="echo-bless echo-supply">
      <header class="echo-bless__head">
        <b>${t('盟约投影 · 全队投票')}</b>
        <span>${t('选一条核心盟约投影：全体干员按满档享受它的效果，只能同时存在一个，不占祝福名额')}</span>
        ${left != null ? html`<span class="echo-bless__timer" aria-live="off"><b>${left}</b><i>秒</i></span>` : null}
        <span class="echo-bless__count">${voted}/${voters.length}</span>
      </header>
      <div class="echo-bless__cards">
        ${options.map(card)}
        <button type="button" key="skip" class=${`echo-bless__card echo-bless__skip${myPick === options.length ? ' is-picked' : ''}`}
          onClick=${() => vote(options.length)}>
          <b class="echo-bless__name">${t('放弃本次')}</b>
          <span class="echo-bless__desc">${t('保留当前投影，不替换')}</span>
          <span class="echo-bless__votes">${(() => { const who = voters.filter((p) => votes[p.playerId] === options.length).map((p) => p.name); return who.length ? who.join('、') : t('无人投票'); })()}</span>
        </button>
      </div>
      <footer class="echo-bless__foot">
        <span class="echo-bless__hint">${myPick != null
          ? t('你已投「{name}」，等待队友…', { name: options[myPick]?.name || '' })
          : current ? t('当前投影：{name}', { name: current.name }) : t('先选一项，再点「确认」')}</span>
        <${Button} class="echo-bless__confirm" disabled=${true}>${t('确认')}</${Button}>
      </footer>
    </div>
  </div>`;
}
