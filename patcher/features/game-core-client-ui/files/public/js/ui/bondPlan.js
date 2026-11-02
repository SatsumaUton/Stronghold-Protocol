// 预约盟约（移植自参考版）：开局时玩家声明「这一局我打算走哪个核心盟约」，所有博士和观战者都看得见。
//
// 服务端从「确认本局信息」到第 1 回合的第一场战斗之前都接受（g.bondPlan，见
// server/match/match/intents.js 的 planBond / bondPlanOpen）。**信息性功能**：不影响对局任何规则。
//
// ★ 按版本切换：可预约的盟约来自 `gd.list('bonds')`（当前房间版本的数据），
//   只挑 isCore === true 的核心盟约。第一期 6 个、第二期 8 个，各版本不同 ——
//   所以这里**不能**缓存成模块级常量，必须每次从 gd 现算（gd 本身按版本变）。
import { html, Button, Icon, Modal } from './components.js';
import { BondGlyph } from './gameComponents.js';
import { PHASE } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

const cx = (...a) => a.filter(Boolean).join(' ');

/**
 * 当前版本里可以预约的盟约：所有核心盟约（bonds.json 的 isCore），保持数据顺序。
 * @param {any[]} bonds gd.list('bonds')
 * @returns {any[]}
 */
export function plannableBonds(bonds) {
  return (Array.isArray(bonds) ? bonds : []).filter((b) => b && b.isCore === true);
}

const OPENING = new Set([PHASE.INFO_CHECK, PHASE.BAND_DRAFT, PHASE.BATTLE_CHECK]);
const ROUND_ONE = new Set([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]);

/**
 * 现在还能不能改预约：与服务端的窗口一致（bondPlanOpen）——
 * 开局那几个相位，以及第 1 回合到它的战斗之前。
 * @param {any} pub m.public
 */
export function bondPlanOpen(pub) {
  if (!pub || typeof pub.phase !== 'string') return false;
  return OPENING.has(pub.phase) || (ROUND_ONE.has(pub.phase) && !(pub.round > 1));
}

/**
 * 别人预约了什么：bondId → 预约了它的玩家名字（不含自己）。
 * @param {any[]} players m.public players
 * @param {string|null} myId
 */
export function bondPlanHolders(players, myId) {
  const out = new Map();
  for (const p of Array.isArray(players) ? players : []) {
    if (!p || p.playerId === myId || typeof p.bondPlan !== 'string') continue;
    if (!out.has(p.bondPlan)) out.set(p.bondPlan, []);
    out.get(p.bondPlan).push(p.name || t('博士'));
  }
  return out;
}

/** 一个玩家的预约标记：盟约图标，`compact` 时不带名字。 */
export function BondPlanTag({ bondId, gd, compact = false, class: cls }) {
  if (typeof bondId !== 'string') return null;
  const name = (gd ? gd.bond?.(bondId) : null)?.name || bondId;
  return html`<span class=${cx('bplan', compact && 'bplan--compact', cls)} title=${t('预选盟约：{name}', { name })}>
    <${BondGlyph} bondId=${bondId} class="bplan__glyph" />${compact ? null : html`<span class="bplan__name">${name}</span>`}
  </span>`;
}

/**
 * 预约选择框：把可预约的盟约摆成卡片。
 * 本局禁用的盟约**仍然可选**（只是标「本局禁用」）—— 预约是沟通，不是规则；
 * 已经预约了它的队友名字显示在卡片下方；当前选中的打勾；「不预选」清空。
 * @param {{ open: boolean, onClose: Function, bonds: any[], value: string|null, holders: Map<string, string[]>,
 *   off: Set<string>, busy: boolean, onPick: (bondId: string|null) => void }} props
 */
export function BondPlanPicker({ open, onClose, bonds, value, holders, off, busy, onPick }) {
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('预选盟约')} micro="BOND PLAN" class="bplan-dlg"
    actions=${html`
      <${Button} variant="ghost" icon="close" disabled=${busy || !value} onClick=${() => onPick(null)}>${t('不预选')}<//>
      <${Button} variant="secondary" data-autofocus onClick=${onClose}>${t('关闭')}<//>`}>
    <p class="bplan-dlg__tip t-dim">${t('选择你打算发展的盟约，所有博士都能看到。只作沟通，不影响对局。')}</p>
    <div class="bplan-dlg__grid" role="listbox" aria-label=${t('预选盟约')}>${bonds.map((b) => {
      const who = holders.get(b.bondId) || [];
      const isOff = off && off.has(b.bondId);
      return html`<button key=${b.bondId} type="button" role="option" aria-selected=${value === b.bondId ? 'true' : 'false'}
          class=${cx('bplan-card', value === b.bondId && 'is-sel', isOff && 'is-off')} disabled=${busy}
          onClick=${() => onPick(b.bondId)}>
        <${BondGlyph} bondId=${b.bondId} class="bplan-card__glyph" />
        <span class="bplan-card__name">${b.name}</span>
        ${isOff ? html`<span class="bplan-card__off">${t('本局禁用')}</span>` : null}
        ${who.length ? html`<span class="bplan-card__who" title=${who.join('、')}><${Icon} name="user" />${who.join('、')}</span>` : null}
        ${value === b.bondId ? html`<span class="bplan-card__mine"><${Icon} name="check" /></span>` : null}
      </button>`;
    })}</div>
  <//>`;
}
