// ui/echoStatus.js — 「深渊回响」无尽模式的对局内状态条。
//
// 显示三样东西（都来自 m.public.echo，服务端已是唯一真源）：
//   * 深潜深度（第几个深潜回合）—— 这个模式的「分数」
//   * 当前生效的侵蚀词条（每 3 层叠一条，上限随深度 3→8）
//   * 已获得的祝福（每 5 层一次三选一，同类不叠加）
//
// 折叠状态只在本浏览器记，不发给服务器；不阻塞任何操作（pointer-events 由 .echo-status 自己控制）。
import { useState } from '../../vendor/hooks.module.js';
import { html, Icon, ICONS } from './components.js';
import { echoSigil } from './echoSigils.js';
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
      class=${`etag ecochip ecochip--${c.tone}${c.consumed ? ' is-consumed' : ''}${c.left != null || c.temp ? ' is-timed' : ''}`} title=${c.title} aria-label=${c.title}>
      <b class="ecochip__glyph">${c.glyph}</b>${c.label}<${TempBadge} chip=${c} /></span>`)}</span>`;
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
        class=${`etag ecochip ecochip--${c.tone}${c.consumed ? ' is-consumed' : ''}${c.left != null || c.temp ? ' is-timed' : ''}`} title=${c.title} aria-label=${c.title}><${BuffSigil} chip=${c} /><${TempBadge} chip=${c} /></span>`)}</span>`;
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
      ${echo.altar ? html`<span class="etag echo-altar-chip" data-testid="echo-altar-open">${t('祭坛开放 · 放大镜里献祭')}</span>` : null}
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
 * 「深渊祭坛」（16 层起，随机开放）：成型后的资金出口（维护者 2026-11-05）。
 *
 * ⚠ 这块以前叫 EchoInfoBlock，**从来没有被挂到界面上**（死代码）—— 玩家因此一直没见过祭坛
 * （维护者 2026-11-05 反馈「我好像没有见过这个深渊祭坛」）。现在拆成独立组件，
 * 挂在「本局信息 → 深渊回响」页的顶部。
 */
export function EchoAltar({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  // 祭坛提示里要显示「你现在有多少资金」（维护者 2026-11-05）
  const myFunds = useStore((s) => Number(s.match?.private?.funds) || 0);
  const echo = pub?.echo;
  const a = echo && echo.altar;
  if (!a) return null;
  const used = (a.used && a.used[myId]) || { blessing: 0, buff: 0, permanent: 0 };
  // 「献祭 · 永久」本局最多买 N 次（维护者 2026-11-05：+1 部署位就够）—— 买过之后按钮直接锁死
  const permMax = Math.max(0, Number(a.permanentMax) || 0);
  const permBought = Math.max(0, Number((a.deployBought && a.deployBought[myId]) || 0));
  const permCapped = permMax > 0 && permBought >= permMax;
  const row = (kind, label, hint) => {
    const left = (a.limits[kind] || 0) - (used[kind] || 0);
    const capped = kind === 'permanent' && permCapped;
    const disabled = left <= 0 || (kind === 'permanent' && !a.canPermanent) || capped;
    return html`<div class="erow echo-altar__row" data-testid=${`echo-altar-${kind}`}>
      <span class="erow__text"><b class="erow__name">${label}</b>
        <span class="erow__tags"><span class="etag">${hint}</span></span></span>
      <button type="button" class="btn btn--primary btn--sm" disabled=${disabled}
        onClick=${() => actions.echoAltar(kind)}>
        ${capped ? t('本局已买过（上限 {n} 次）', { n: permMax })
          : `${t('{n} 资金', { n: a.costs[kind] })}${left > 0 ? t(' · 剩 {n}', { n: left }) : t(' · 已用完')}`}
      </button>
    </div>`;
  };
  return html`<div class="echo-infoblock echo-altar" data-testid="echo-altar">
    <h4 class="ihead">${t('深渊祭坛')} <small class="num">${t('第 {d} 层起开放', { d: 16 })}</small></h4>
    <p class="echo-infoblock__row echo-altar__hint">
      ${t('每次献祭都会从你的资金里扣除对应价格，不返还；不需要就直接关掉面板，不用选。')}
      <b class="num">${t('我的资金：{n}', { n: myFunds })}</b>
    </p>
    ${row('blessing', t('献祭 · 祝福'), t('抽一个一次性祝福（不占名额）'))}
    ${row('buff', t('献祭 · 强化'), t('本层全队 +6% 攻击 / +4% 攻速 / +5% 生命（可叠 2 层）'))}
    ${row('permanent', t('献祭 · 永久'), permMax > 0 ? t('永久 +1 部署位（本局最多 {n} 次）', { n: permMax }) : t('永久 +1 部署位'))}
    ${a.stacks ? html`<p class="echo-infoblock__row t-dim">${t('本层强化已叠 {n} 层', { n: a.stacks })}</p>` : null}
  </div>`;
}

/**
 * 一个 buff 的徽记：类别轮廓（仓库 ICONS 的 path）+ 由 id 哈希决定的 3 个点。
 * 同类别的两条 buff 轮廓一样、点阵不一样 —— 仓库只有 39 个图标而 buff 有 110+ 条，
 * 直接映射必然重复（截图里三个盾、三个皇冠），这是「每条都有独立图标」的可行做法。
 */
function BuffSigil({ chip }) {
  const sig = echoSigil(chip.raw || { id: chip.id }, chip.side);
  const ic = ICONS[sig.base];
  if (!ic) return null;
  const up = sig.dir === 'up';
  const arrows = [];
  for (let i = 0; i < sig.level; i++) {
    arrows.push(html`<polygon key=${i} class=${up ? 'sigil-arrow is-up' : 'sigil-arrow is-down'}
      points=${up ? '0,-3.2 3,2 -3,2' : '0,3.2 3,-2 -3,-2'} transform=${'translate(' + (12 + i * 5) + ', 20.5)'} />`);
  }
  return html`<svg class="ecochip__icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
    <path d=${ic.d} fill-rule=${ic.eo ? 'evenodd' : undefined} />
    ${arrows}
  </svg>`;
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
  // 本回合新刷出的诅咒：排最前面 + 单独一条红色提示条（维护者 2026-11-05：
  // 要「明显标注」，玩家才知道这一层多了哪条诅咒、好及时去看它的效果）
  const rc = echo?.roundCurse && typeof echo.roundCurse.name === 'string' ? echo.roundCurse : null;
  const ordered = rc ? [...chips.filter((c) => c.roundCurse), ...chips.filter((c) => !c.roundCurse)] : chips;
  return html`<div class="echo-buffbar" data-testid="echo-buffbar" aria-label=${t('深渊回响：当前词条 / 祝福 / 诅咒')}>
    ${rc ? html`<div class="echo-buffbar__alert" data-testid="echo-round-curse"
      title=${rc.desc ? `${t('本回合诅咒')}：${rc.name} · ${rc.desc}` : `${t('本回合诅咒')}：${rc.name}`}>
      <b>${t('本回合诅咒')}</b><span>${rc.name}</span>
    </div>` : null}
    ${ordered.map((c) => html`<span key=${c.key} class=${`etag ecochip ecochip--${c.tone} is-${c.side}${c.consumed ? ' is-consumed' : ''}${c.left != null || c.temp ? ' is-timed' : ''}${c.roundCurse ? ' is-roundcurse' : ''}${c.projection ? ' is-projection' : ''}`}
      title=${c.title} aria-label=${c.title}><${BuffSigil} chip=${c} /><${TempBadge} chip=${c} /></span>`)}
  </div>`;
}

/**
 * buff 圆片右下角的时效角标（维护者 2026-11-05）：
 *   「本」= 只在本回合/本层生效（深潜补给的本层词条、本回合随机诅咒）
 *   「N」 = 还会持续 N 层（排异 / 封锁这类按层数到期的诅咒）
 * 没有时效的 buff 不画角标，保持原来的干净外观。
 */
function TempBadge({ chip }) {
  if (chip.left == null && !chip.temp) return null;
  const text = chip.left != null ? String(chip.left) : '本';
  return html`<i class="ecochip__left" aria-hidden="true">${text}</i>`;
}
