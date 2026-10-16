// Host test console (DESIGN §34.8 phase 2). Shown only when m.public.test is true and the viewer is the
// room host. Commands go out as g.test; the server applies them. The studio battle sandbox is a different
// page and does not touch this match.
//
// [ASSUMED] The panel is a dock over the briefing, the strategy draft and the match. Spectators and guests
// see the 测试 mark and not the dock. There is no control that counts the match toward records.

import { useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useStore } from '../store.js';
import { data, useData } from '../data.js';
import { toastError } from './toasts.js';
import { act } from './gameActions.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** The amber 测试 mark on a room card, the HUD, the step header and the result. */
export function TestMark({ class: cls = '' }) {
  return html`<span class=${cx('testmark', cls)} data-testid="test-mark">${t('测试')}</span>`;
}

function send(cmd, args) {
  const fields = { cmd };
  if (args && Object.keys(args).length) fields.args = args;
  return act('g.test', fields, { sfx: false });
}

function num(raw) {
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** `chess:id,item:id` → slots, or null when the text is not that shape. */
function shopSlots(raw) {
  const parts = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const slots = [];
  for (const part of parts) {
    const i = part.indexOf(':');
    if (i <= 0) return null;
    const kind = part.slice(0, i);
    const id = part.slice(i + 1).trim();
    if ((kind !== 'chess' && kind !== 'item') || !id) return null;
    slots.push({ kind, id });
  }
  return slots;
}

/**
 * Collapsible host dock. Returns null unless this match is a test match and the viewer commands it.
 */
export function TestConsole() {
  const pub = useStore((s) => s.match.public);
  useData('chess', 'items', 'tokens', 'bonds', 'bands', 'enemies');
  const mine = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const hostId = useStore((s) => s.room && s.room.hostId);
  const [open, setOpen] = useState(false);
  const [cmd, setCmd] = useState('funds');
  const [amount, setAmount] = useState('0');
  const [id, setId] = useState('');
  const [ownerUid, setOwnerUid] = useState('');
  const [layers, setLayers] = useState('0');
  const [resetLp, setResetLp] = useState(false);
  const [round, setRound] = useState('1');
  const [count, setCount] = useState('0');
  const [shop, setShop] = useState('');
  const [choiceIdx, setChoiceIdx] = useState('0');
  const [choiceId, setChoiceId] = useState('');
  if (!pub || pub.test !== true || !myId || myId !== hostId) return null;
  const table = { chess: 'chess', item: 'items', token: 'tokens', bond: 'bonds', strategy: 'bands', bounty: 'enemies' }[cmd];
  const choices = Object.entries(table ? data.get(table) || {} : {});
  const owned = [...(mine?.hand || []), ...(mine?.temp || []), ...(mine?.board || []).map(x => x.piece || x)].filter(x => x?.kind === 'chess');
  const log = Array.isArray(pub.testLog) ? pub.testLog : [];
  const run = () => {
    if (cmd === 'funds' || cmd === 'lp' || cmd === 'hp' || cmd === 'teamLp') {
      const n = num(amount);
      if (n == null) return toastError({ code: 'BAD_TARGET' });
      const key = cmd === 'funds' ? 'amount' : 'value';
      return send(cmd, { [key]: n });
    }
    if (cmd === 'chess' || cmd === 'item' || cmd === 'bounty') {
      const key = cmd === 'bounty' ? 'enemyKey' : 'id';
      if (!id.trim()) return toastError({ code: 'BAD_TARGET' });
      return send(cmd, { [key]: id.trim() });
    }
    if (cmd === 'token') {
      const uid = num(ownerUid);
      if (!id.trim() || uid == null) return toastError({ code: 'BAD_TARGET' });
      return send('token', { id: id.trim(), ownerUid: uid });
    }
    if (cmd === 'bond') {
      const n = num(layers);
      if (!id.trim() || n == null) return toastError({ code: 'BAD_TARGET' });
      return send('bond', { id: id.trim(), layers: n, count: num(count) });
    }
    if (cmd === 'strategy') {
      if (!id.trim()) return toastError({ code: 'BAD_TARGET' });
      const args = { id: id.trim() };
      if (resetLp) args.resetLp = true;
      return send('strategy', args);
    }
    if (cmd === 'round') {
      const n = num(round);
      if (n == null) return toastError({ code: 'BAD_TARGET' });
      return send('round', { round: n });
    }
    if (cmd === 'shop') {
      const slots = shopSlots(shop);
      if (!slots) return toastError({ code: 'BAD_TARGET' });
      return send('shop', { slots });
    }
    if (cmd === 'choice') {
      const n = num(choiceIdx);
      if (n == null) return toastError({ code: 'BAD_TARGET' });
      const args = { idx: n };
      if (choiceId.trim()) args.choiceId = choiceId.trim();
      return send('choice', args);
    }
    if (cmd === 'level') return send('level', {});
    return null;
  };
  return html`<aside class=${cx('testconsole', open && 'is-open')} data-testid="test-console">
    <button type="button" class="testconsole__tab" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
      ${open ? t('收起') : t('展开测试指令')}
    </button>
    ${open ? html`<div class="testconsole__body">
      <header class="testconsole__head">
        <${TestMark} />
        <b>${t('测试指令')}</b>
        <span class="t-dim">${t('已执行 {n} 次', { n: pub.testActions | 0 })}</span>
      </header>
      <div class="testconsole__row">
        <button type="button" onClick=${() => send('timers', { on: false })}>${t('关闭计时')}</button>
        <button type="button" onClick=${() => send('timers', { on: true })}>${t('开启计时')}</button>
        <span class="t-dim">${pub.testTimers === false ? t('关闭计时') : t('开启计时')}</span>
      </div>
      <div class="testconsole__row">
        <button type="button" onClick=${() => send('phase', { name: 'advance' })}>${t('继续被暂停的阶段')}</button>
        <button type="button" onClick=${() => send('phase', { name: 'battleCheck' })}>${t('结束策略选择')}</button>
        <button type="button" onClick=${() => send('phase', { name: 'prep' })}>${t('进入休整')}</button>
        <button type="button" onClick=${() => send('phase', { name: 'sp' })}>${t('进入机变')}</button>
        <button type="button" onClick=${() => send('phase', { name: 'combat' })}>${t('开始作战')}</button>
      </div>
      <label class="testconsole__field">${t('测试指令')}
        <select value=${cmd} onChange=${(e) => setCmd(e.target.value)}>
          <option value="funds">${t('资金')}</option>
          <option value="chess">${t('干员')}</option>
          <option value="item">${t('装备')}</option>
          <option value="token">${t('召唤物')}</option>
          <option value="lp">${t('目标生命')}</option>
          <option value="hp">${t('领袖生命')}</option>
          <option value="teamLp">${t('队伍生命')}</option>
          <option value="round">${t('回合')}</option>
          <option value="shop">${t('下一轮商店')}</option>
          <option value="bond">${t('盟约')}</option>
          <option value="strategy">${t('策略')}</option>
          <option value="level">${t('升级调度中心')}</option>
          <option value="bounty">${t('悬赏目标')}</option>
          <option value="choice">${t('机变')}</option>
        </select>
      </label>
      ${cmd === 'funds' || cmd === 'lp' || cmd === 'hp' || cmd === 'teamLp' ? html`<label class="testconsole__field">${cmd === 'funds' ? t('资金') : cmd === 'lp' ? t('目标生命') : cmd === 'hp' ? t('领袖生命') : t('队伍生命')}
        <input value=${amount} onInput=${(e) => setAmount(e.target.value)} inputmode="numeric" />
      </label>` : null}
      ${cmd === 'chess' || cmd === 'item' || cmd === 'bond' || cmd === 'strategy' || cmd === 'bounty' || cmd === 'token' ? html`<label class="testconsole__field">${cmd === 'item' ? t('装备') : cmd === 'bond' ? t('盟约') : cmd === 'strategy' ? t('策略') : cmd === 'bounty' ? t('悬赏目标') : t('干员')}
        <input list="test-content-ids" value=${id} onInput=${(e) => setId(e.target.value)} />
      </label>` : null}
      ${cmd === 'token' ? html`<label class="testconsole__field">${t('所属棋子 uid')}
        <input list="test-owner-uids" value=${ownerUid} onInput=${(e) => setOwnerUid(e.target.value)} inputmode="numeric" />
      </label>` : null}
      ${cmd === 'bond' ? html`<label class="testconsole__field">${t('额外盟约人数')}<input value=${count} onInput=${(e) => setCount(e.target.value)} inputmode="numeric" /></label><label class="testconsole__field">${t('层数')}
        <input value=${layers} onInput=${(e) => setLayers(e.target.value)} inputmode="numeric" />
      </label>` : null}
      ${cmd === 'strategy' ? html`<label class="testconsole__check"><input type="checkbox" checked=${resetLp} onChange=${(e) => setResetLp(e.target.checked)} />${t('重置为目标生命初始值')}</label>` : null}
      ${cmd === 'round' ? html`<label class="testconsole__field">${t('回合')}
        <input value=${round} onInput=${(e) => setRound(e.target.value)} inputmode="numeric" />
      </label>` : null}
      ${cmd === 'shop' ? html`<label class="testconsole__field">${t('下一轮商店')}
        <input value=${shop} placeholder="chess:id,item:id" onInput=${(e) => setShop(e.target.value)} />
      </label>` : null}
      ${cmd === 'choice' ? html`<label class="testconsole__field">${t('机变')}
        <input value=${choiceIdx} onInput=${(e) => setChoiceIdx(e.target.value)} inputmode="numeric" />
        <input value=${choiceId} onInput=${(e) => setChoiceId(e.target.value)} />
      </label>` : null}
      <datalist id="test-content-ids">${choices.map(([key, rec]) => html`<option key=${key} value=${key}>${rec.name || key}</option>`)}</datalist>
      <datalist id="test-owner-uids">${owned.map(p => html`<option key=${p.uid} value=${p.uid}>${p.id}</option>`)}</datalist>
      <button type="button" class="testconsole__run" onClick=${run}>${t('执行')}</button>
      <ol class="testconsole__log">
        ${log.length ? log.map((e) => html`<li key=${e.seq} class=${e.ok ? 'is-ok' : 'is-bad'}>
          <span class="num">${e.seq}</span> ${e.playerId} · ${e.at} · ${e.cmd} ${JSON.stringify(e.args)} · ${e.ok ? t('成功') : e.code || ''}
        </li>`) : html`<li class="t-dim">${t('尚无测试指令')}</li>`}
      </ol>
    </div>` : null}
  </aside>`;
}
