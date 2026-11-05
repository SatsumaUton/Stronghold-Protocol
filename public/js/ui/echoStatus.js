// ui/echoStatus.js — 「深渊回响」无尽模式的对局内状态条。
//
// 显示三样东西（都来自 m.public.echo，服务端已是唯一真源）：
//   * 深潜深度（第几个深潜回合）—— 这个模式的「分数」
//   * 当前生效的侵蚀词条（每 3 层叠一条，上限随深度 3→8）
//   * 已获得的祝福（每 5 层一次三选一，同类不叠加）
//
// 折叠状态只在本浏览器记，不发给服务器；不阻塞任何操作（pointer-events 由 .echo-status 自己控制）。
import { useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { echoBuffChips } from './echoBuffs.js';
import { actions } from './gameActions.js';
import { useStore } from '../store.js';
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

/**
 * 紧凑图标行（维护者 2026-11-05）：不用点放大镜，HUD 上直接能看到「词条 / 祝福 / 诅咒」。
 * 只画首字圆片（不写名字），悬浮 title 给全名 + 效果；三组用不同前缀色区分。
 */
function CompactChips({ chips }) {
  const group = (side, cls) => {
    const list = chips.filter((c) => c.side === side);
    if (!list.length) return null;
    return html`<span class=${`echo-status__group ${cls}`}>${list.map((c) => html`<span key=${c.key}
        class=${`etag ecochip ecochip--${c.tone}`} title=${c.title} aria-label=${c.title}><${Icon} name=${c.icon} class="ecochip__icon" /></span>`)}</span>`;
  };
  const enemy = group('enemy', 'is-enemy');
  const ally = group('ally', 'is-ally');
  const curse = group('curse', 'is-curse');
  if (!enemy && !ally && !curse) return html`<span class="etag">${t('无')}</span>`;
  return html`<span class="echo-status__icons">${enemy}${ally}${curse}</span>`;
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
  const chips = echoBuffChips(echo);
  return html`<section class="brief-reroll echo-status" aria-label=${t('深渊回响状态')}>
    <div class="brief-reroll__text">
      <strong>${t('深渊回响 · 深度 {n}', { n: depth })}</strong>
      ${open ? html`
        <span>${t('当前词条：')}<${BuffChips} chips=${chips} side="enemy" /></span>
        <span>${t('已获祝福：')}<${BuffChips} chips=${chips} side="ally" /></span>
        <span>${t('当前诅咒：')}<${BuffChips} chips=${chips} side="curse" /></span>
      ` : html`<${CompactChips} chips=${chips} />`}
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
  const myId = useStore((s) => s.me.playerId);
  const echo = pub?.echo;
  const depth = Number(echo?.depth) || 0;
  if (!(depth > 0)) return null;
  const chips = echoBuffChips(echo);
  // 词条只在「深渊回响」页和敌方情报里出现（维护者 2026-11-04：不要两个页面都放一遍）
  const ally = chips.filter((c) => c.side === 'ally');
  // 诅咒（含固定规则：奇迹 / 远见 / 深渊通胀）—— 维护者 2026-11-05 要求放大镜里也能一眼看到
  const curse = chips.filter((c) => c.side === 'curse');
  return html`<div class="echo-infoblock" data-testid="echo-infoblock">
    <h4 class="ihead">${t('深渊回响')} <small class="num">${t('深度 {n}', { n: depth })}</small></h4>
    ${echo && echo.altar ? (() => {
      // 深渊祭坛（16 层起）：成型后的资金出口（维护者 2026-11-05）
      const a = echo.altar;
      const used = (a.used && a.used[myId]) || { blessing: 0, buff: 0, permanent: 0 };
      const row = (kind, label, hint) => {
        const left = (a.limits[kind] || 0) - (used[kind] || 0);
        const disabled = left <= 0 || (kind === 'permanent' && !a.canPermanent);
        return html`<div class="erow echo-altar__row">
          <span class="erow__text"><b class="erow__name">${label}</b>
            <span class="erow__tags"><span class="etag">${hint}</span></span></span>
          <button type="button" class="btn btn--primary btn--sm" disabled=${disabled}
            onClick=${() => actions.echoAltar(kind)}>
            ${t('{n} 资金', { n: a.costs[kind] })}${left > 0 ? t(' · 剩 {n}', { n: left }) : t(' · 已用完')}
          </button>
        </div>`;
      };
      return html`<h4 class="ihead">${t('深渊祭坛')} <small class="num">${t('第 {d} 层起开放', { d: 16 })}</small></h4>
        ${row('blessing', t('献祭 · 祝福'), t('抽一个一次性祝福（不占名额）'))}
        ${row('buff', t('献祭 · 强化'), t('本层全队 +6% 攻击 / +4% 攻速 / +5% 生命（可叠 2 层）'))}
        ${row('permanent', t('献祭 · 永久'), t('永久 +1 部署位（每 5 层一次）'))}
        ${a.stacks ? html`<p class="echo-infoblock__row t-dim">${t('本层强化已叠 {n} 层', { n: a.stacks })}</p>` : null}`;
    })() : null}
    <p class="echo-infoblock__row">${t('已获祝福：')}${ally.length ? html`<span class="echochips">${ally.map((c) => html`<span key=${c.key}
      class=${`etag ecochip ecochip--${c.tone}`} title=${c.title}><b class="ecochip__glyph">${c.glyph}</b>${c.label}</span>`)}</span>`
      : html`<span class="etag">${t('无')}</span>`}</p>
    <p class="echo-infoblock__row">${t('当前诅咒：')}${curse.length ? html`<span class="echochips">${curse.map((c) => html`<span key=${c.key}
      class=${`etag ecochip ecochip--${c.tone}`} title=${c.title}><b class="ecochip__glyph">${c.glyph}</b>${c.label}</span>`)}</span>`
      : html`<span class="etag">${t('无')}</span>`}</p>
  </div>`;
}

/**
 * HUD 常驻的 buff 图标栏（维护者 2026-11-05）。
 *
 * 为什么单独一个组件：`EchoStatus` 那条浮在屏幕上的状态条 2026-11-04 已按维护者要求摘掉
 * （会挡 HUD 和按钮），把图标加进它等于没加 —— 玩家根本看不到。
 * 这里改成右下角一小条只读圆片：容器 pointer-events: none，不挡任何操作，悬停才有 title。
 */
export function EchoBuffBar({ pub }) {
  const echo = pub?.echo;
  const depth = Number(echo?.depth) || 0;
  if (!(depth > 0)) return null;
  const chips = echoBuffChips(echo);
  if (!chips.length) return null;
  return html`<div class="echo-buffbar" data-testid="echo-buffbar" aria-label=${t('深渊回响：当前词条 / 祝福 / 诅咒')}>
    ${chips.map((c) => html`<span key=${c.key} class=${`etag ecochip ecochip--${c.tone} is-${c.side}`}
      title=${c.title} aria-label=${c.title}><${Icon} name=${c.icon} class="ecochip__icon" /></span>`)}
  </div>`;
}
