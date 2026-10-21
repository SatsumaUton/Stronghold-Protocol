// Shared briefing and strategy-draft enemy information (GitHub #484, DESIGN §35.6): only the match's announced leader,
// battlefield and special enemy types. Read the current localized data; no gameplay actions or round previews.
// The event's 本局遭遇敌方 layout (PR #643, video 6:29–7:51): the leader's framed portrait over 敌方领袖, its text — name,
// final-assault round, abilities, the battlefield — and the 特训敌人 as round icons with their names.
// The 特训敌人 description — the maintainer's decision of 2026-10-21 (8): both variants are built behind a TEMPORARY
// internal switch (enemyDescMode) until the maintainer picks one from the comparison screenshots:
//   'inline' (the default) — under each icon, two lines at most (the full text in the title);
//   'tip'    — PR #828's: the name only, the description in a Tooltip on hover / keyboard focus / a long press (≥ 450 ms)
//              on touch, kept in the markup for screen readers (.sr-only).
// [ASSUMED] either way: no official screenshot of INFO_CHECK's 特训敌人 is in the repo.
// One copy for both screens: the briefing's .brief-sec--enemy (css/screens/briefing.css, scoped under .brief) and the
// draft's 本局信息 dialog (screens/bandDraft.js → ui/matchInfo.js MatchInfoDialog; css/screens/draft.css .minfo-dlg
// stacks the same markup into its narrower column).

import { html, Icon, MicroLabel, Tooltip } from './components.js';
import { Img, RichText } from './gameComponents.js';
import { factionTypes } from './gameLogic.js';
import { enemyIconUrl, factionIconUrl } from './assetUrls.js';
import { t, tParts } from '../../../shared/i18n.js';

/** The two 特训敌人 description variants (see the header). */
export const ENEMY_DESC_MODES = Object.freeze(['inline', 'tip']);

/**
 * Which 特训敌人 description variant shows — TEMPORARY, until the maintainer picks: `?enemyDesc=tip` in the page's
 * address or `globalThis.__SP_ENEMY_DESC__ = 'tip'` (tests, screenshots) selects the tooltip; anything else the default.
 * @returns {'inline'|'tip'}
 */
export function enemyDescMode() {
  let v = globalThis.__SP_ENEMY_DESC__;
  if (v == null) {
    try { v = new URLSearchParams(globalThis.location?.search || '').get('enemyDesc'); } catch { v = null; }
  }
  return v === 'tip' ? 'tip' : 'inline';
}

/**
 * One 特训敌人 type: the round icon, the name and the description in the chosen variant. A plain function (called, not
 * a component), so the markup sits in MatchEnemies' own tree.
 * @param {{ type: string, info: any, m: any, mode: 'inline'|'tip' }} o
 */
function factionCell({ type, info, m, mode }) {
  const name = info?.name || type;
  const desc = info?.desc || '';
  if (mode === 'tip') {
    return html`<${Tooltip} key=${type} text=${desc || null} block=${true} class="brief-faction__tt">
      <div class="brief-faction is-tip" data-faction=${type} tabindex="0">
        <span class="brief-faction__icon"><${Img} src=${factionIconUrl(m, info?.icon)} /></span>
        <span class="brief-faction__text"><b>${name}</b><span class="brief-faction__desc sr-only">${desc}</span></span>
      </div>
    <//>`;
  }
  return html`<div key=${type} class="brief-faction" data-faction=${type} title=${desc || undefined}>
    <span class="brief-faction__icon"><${Img} src=${factionIconUrl(m, info?.icon)} /></span>
    <span class="brief-faction__text"><b>${name}</b><span class="brief-faction__desc">${desc}</span></span>
  </div>`;
}

/**
 * The briefing's 本局遭遇敌方 section body, also shown in the strategy draft's 本局信息 dialog.
 * @param {{ pub: any, gd: ReturnType<typeof import('./gameComponents.js').makeLookups> }} props
 */
export function MatchEnemies({ pub, gd }) {
  if (!pub) return null;
  const mode = gd.config?.modes?.[pub.modeId];
  const boss = pub.bossId ? gd.boss(pub.bossId) : null;
  const bossEnemy = boss ? gd.enemy(boss.enemyKey) : null;
  const stage = pub.stageId ? gd.stage(pub.stageId) : null;
  // the mode's battlefield pool (config.json modes[].stages): 标准 is always 战场#01, 险境+ draw one at random
  const poolN = Array.isArray(mode?.stages) ? mode.stages.length : 0;
  const pool = poolN > 1 ? t('战场随机（共{poolN}张）', { poolN }) : poolN === 1 ? t('战场固定') : '';
  const types = factionTypes(pub.factions);
  const factions = gd.factions?.types || {};
  const m = gd.m;
  const descMode = enemyDescMode();

  return html`<div class="brief-enemies">
    <h3 class="brief-h"><span>${t('本局遭遇敌方')}</span><${MicroLabel}>ENEMY LEADER // SPECIAL ENEMIES</${MicroLabel}></h3>
    <div class="brief-enemy">
      <div class="brief-boss">
        <div class="brief-boss__art">
          ${bossEnemy ? html`<${Img} src=${enemyIconUrl(m, boss.enemyKey)} class="brief-boss__img" fallback=${html`<span class="brief-boss__q">?</span>`} />`
            : html`<span class="brief-boss__q">?</span>`}
        </div>
        <span class="brief-boss__tag">${t('敌方领袖')}</span>
      </div>
      <div class="brief-boss__text">
        <h2 class="brief-boss__name">${boss?.name || bossEnemy?.name || t('未知领袖')}</h2>
        <span class="brief-boss__when">${tParts('第 {r} 回合 · 最终攻势', { r: html`<b class="num">${mode?.bossRound ?? pub.lastRound ?? 14}</b>` })}</span>
        ${Array.isArray(boss?.abilities) && boss.abilities.length ? html`<ul class="brief-boss__abil">
          ${boss.abilities.slice(0, 3).map((a, i) => html`<li key=${i}><${RichText} text=${a} /></li>`)}
        </ul>` : null}
        <span class="brief-stage"><${Icon} name="rook" /><b class="brief-stage__name">${stage?.name || pub.stageId || '—'}</b>${pool ? html`<span class="brief-stage__pool">${pool}</span>` : null}</span>
      </div>
      <div class=${`brief-factions brief-factions--${descMode}`}>
        ${types.length ? types.map((type) => factionCell({ type, info: factions[type], m, mode: descMode }))
          : html`<p class="t-dim">${t('本局没有特训敌人')}</p>`}
      </div>
    </div>
  </div>`;
}
