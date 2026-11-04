// ui/echoStatus.js — 「深渊回响」无尽模式的对局内状态条。
//
// 显示三样东西（都来自 m.public.echo，服务端已是唯一真源）：
//   * 深潜深度（第几个深潜回合）—— 这个模式的「分数」
//   * 当前生效的侵蚀词条（每 3 层叠一条，上限随深度 3→8）
//   * 已获得的祝福（每 5 层一次三选一，同类不叠加）
//
// 折叠状态只在本浏览器记，不发给服务器；不阻塞任何操作（pointer-events 由 .echo-status 自己控制）。
import { useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { echoBuffChips } from './echoBuffs.js';
import { t } from '../../../shared/i18n.js';

/**
 * 词条 / 祝福的圆片行：用「首字圆片」表达图标（与 BondDisc / sw-disc__txt 同一套兜底思路），
 * 悬浮 title 给全名与描述。不改美术资源，所以不会出现图标缺失。
 */
function BuffChips({ chips, side }) {
  const list = chips.filter((c) => c.side === side);
  if (!list.length) return html`<span class="etag">${t('无')}</span>`;
  return html`<span class="echochips">${list.map((c) => html`<span key=${c.key}
      class=${`etag ecochip ecochip--${c.tone}`} title=${c.title} aria-label=${c.title}>
      <b class="ecochip__glyph">${c.glyph}</b>${c.label}</span>`)}</span>`;
}

export function EchoStatus({ pub }) {
  // 默认折叠：深度已经顶替了 HUD 上的回合数字，这条只是「词条 / 祝福」的补充说明，
  // 展开后才占地方（维护者 2026-11-04：悬浮条挡住了 HUD 和按钮）。
  const [open, setOpen] = useState(false);  const echo = pub?.echo;
  if (!echo) return null;
  const words = Array.isArray(echo.words) ? echo.words : [];
  const blessings = Array.isArray(echo.blessings) ? echo.blessings : [];
  const depth = echo.depth ?? 0;
  // 深潜之前（还没打完最后一个 boss）没有深度可报，状态条只在深潜里出现
  if (!(depth > 0)) return null;
  const summary = [
    t('深度 {n}', { n: depth }),
    words.length ? words.map((w) => w.name).join(' · ') : null,
    blessings.length ? blessings.map((b) => b.name).join(' · ') : null,
  ].filter(Boolean).join('  |  ');
  const chips = echoBuffChips(echo);
  return html`<section class="brief-reroll echo-status" aria-label=${t('深渊回响状态')}>
    <div class="brief-reroll__text">
      <strong>${t('深渊回响 · 深度 {n}', { n: depth })}</strong>
      ${open ? html`
        <span>${t('当前词条：')}<${BuffChips} chips=${chips} side="enemy" /></span>
        <span>${t('已获祝福：')}<${BuffChips} chips=${chips} side="ally" /></span>
      ` : html`<span>${summary}</span>`}
    </div>
    <div class="brief-reroll__actions">
      <button type="button" class="btn btn--ghost btn--sm" onClick=${() => setOpen(!open)}>
        ${open ? t('收起') : t('展开')}
      </button>
    </div>
  </section>`;
}

/**
 * 「本局信息」抽屉里的一块（维护者 2026-11-04：祝福与怪物词条要放进放大镜那个面板，
 * 不要浮在屏幕上挡 HUD）。纯展示，没有定位、不拦截点击。
 */
export function EchoInfoBlock({ pub }) {
  const echo = pub?.echo;
  const depth = Number(echo?.depth) || 0;
  if (!(depth > 0)) return null;
  const chips = echoBuffChips(echo);
  // 词条只在「深渊回响」页和敌方情报里出现（维护者 2026-11-04：不要两个页面都放一遍）
  const ally = chips.filter((c) => c.side === 'ally');
  return html`<div class="echo-infoblock" data-testid="echo-infoblock">
    <h4 class="ihead">${t('深渊回响')} <small class="num">${t('深度 {n}', { n: depth })}</small></h4>
    <p class="echo-infoblock__row">${t('已获祝福：')}${ally.length ? html`<span class="echochips">${ally.map((c) => html`<span key=${c.key}
      class=${`etag ecochip ecochip--${c.tone}`} title=${c.title}><b class="ecochip__glyph">${c.glyph}</b>${c.label}</span>`)}</span>`
      : html`<span class="etag">${t('无')}</span>`}</p>
  </div>`;
}
