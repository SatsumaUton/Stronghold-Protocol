// ui/echoSupply.js — 「深渊回响」16 层以后的个人三选一补给（维护者 2026-11-05）。
// 服务端在每层准备阶段给每名玩家发 3 个候选（装备 / 一次性祝福 / 临时词条），个人选择、不投票。
import { useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button } from './components.js';
import { actions } from './gameActions.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function EchoSupplyPanel({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  const supply = pub?.echo?.supply;
  const box = supply && myId ? supply.byPlayer?.[myId] : null;
  const [armed, setArmed] = useState(null);
  if (!box || box.pick != null || !Array.isArray(box.options) || !box.options.length) return null;
  const card = (o, i) => html`<button type="button" key=${i + o.name}
      class=${`echo-bless__card${armed === i ? ' is-armed' : ''}`}
      onClick=${() => setArmed(i)}>
    <b class="echo-bless__name">${o.name}</b>
    ${o.desc ? html`<span class="echo-bless__desc">${o.desc}</span>` : null}
    ${o.kind === 'item' ? html`<em class="echo-bless__rar is-rare">${t('装备')}</em>` : null}
    ${o.kind === 'blessing' ? html`<em class="echo-bless__rar is-rare">${t('一次性祝福')}</em>` : null}
    ${o.kind === 'word' ? html`<em class="echo-bless__rar is-epic">${t('本层词条')}</em>` : null}
  </button>`;
  return html`<div class="echo-bless echo-supply" role="dialog" aria-label=${t('深潜补给')}>
    <header class="echo-bless__head">
      <h3>${t('深潜补给')} <small>${t('选一项带走（个人选择，不需要投票）')}</small></h3>
    </header>
    <div class="echo-bless__cards">${box.options.map(card)}</div>
    <footer class="echo-bless__foot">
      <span class="echo-bless__hint">${armed == null ? t('先选一张，再点「确认」') : t('已选中「{name}」', { name: box.options[armed].name })}</span>
      <${Button} class="echo-bless__confirm" disabled=${armed == null} onClick=${() => { if (armed != null) { actions.echoSupply(armed); setArmed(null); } }}>
        ${t('确认')}
      </${Button}>
    </footer>
  </div>`;
}