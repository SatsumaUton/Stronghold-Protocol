// 本局信息 dialog under the top bar (opened by the left 🔍, official btn_check_player / autochess_hud_player_info_dialog,
// research 09 §2.1) with two tabs:
//   本局信息 — own strategy, stage, disabled bonds with banned-member counts and the banned operator list (default) —
//              the same bonds, states and banned operators (by tier) as the briefing and the strategy draft's 本局信息
//              dialog: ui/matchInfo.js matchInfoModel, drawn here as compact chips and avatars;
//   敌方情报 — the secondary enemy list: m.private.nextEnemies (icons, names, counts, tags, 特训 faction tags) + this
//              match's factions and the enemy leader on boss rounds. The primary enemy preview is the pen on the board
//              (the right 🔍▶▶ pans the camera there; tapping an enemy in the pen opens its detail card) — research 09 §6.2.

import { html, Icon, Tabs, MicroLabel } from './components.js';
import { Img, UnitThumb, BondGlyph, BandIcon, RichText, GIcon } from './gameComponents.js';
import { groupEnemies, factionTypes, briefingBondTip } from './gameLogic.js';
import { matchInfoModel, DiyBannedLine } from './matchInfo.js';
import { factionIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { actions } from './gameActions.js';
import { echoBuffChips } from './echoBuffs.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const TAG = { boss: N_('领袖'), bounty: N_('悬赏'), escort: N_('护卫') };

function FactionChips({ types }) {
  const f = data.get('factions')?.types || {};
  const m = data.get('assets');
  return html`<div class="fchips">${types.map((t) => html`<span key=${t} class="fchip" title=${f[t]?.desc || ''}>
    <${Img} src=${factionIconUrl(m, f[t]?.icon)} class="fchip__icon" /><span>${f[t]?.name || t}</span></span>`)}</div>`;
}

/**
 * 「深渊回响」深潜的备战情报：原版这里是逐只敌人的列表（图标 + 名字 + 数量）。
 * 深潜的敌人是随机组合出来的，服务端在备战阶段**只发聚合情报**（views.js nextEnemiesFor 整段掐掉），
 * 所以把同一块位置换成我们自己的两项 —— **只有威胁值与是否精英**（维护者 2026-11-03 明确）：
 * 不告诉玩家敌人总数、也不告诉空中数量。明细全部留到开战。
 * 第三行「下次节点」是纯日程信息（R20 / R25 / R30… 的强化领袖返场还有几回合），不泄露任何敌人构成。
 * 它的用处是**干员与爆发节奏**（留谁不卖、什么时候交一次性道具），不是攒钱 —— 原版规则不允许留资金。
 */
/**
 * 「深渊回响」深潜的**附加**情报块：原版四项（回合数+总数 / 阵营 chips / 逐只列表 / boss 领袖块）
 * 全部照旧保留在下面，这一块只是额外补上原版没有的三项：威胁值 / 是否精英 / 下次节点，
 * 以及本回合挂在敌人身上的侵蚀词条。
 */
function EchoIntel({ echo }) {
  const i = echo.intel;
  // 本回合敌人身上挂着的侵蚀词条（复用 echoBuffs 的圆片描述，已被 test/ui/echo-buffs.test.js 覆盖）
  // 词条圆片已挪到「深渊回响」页（维护者 2026-11-04：敌方情报里不要再重复一遍）
  const wordChips = [];
  return html`<div class="edrawer__intel">
    <div class="edrawer__sum">
      <span>${tParts('深潜第 {d} 回合 · 威胁值 {threat}', {
        d: html`<b class="num">${echo.depth ?? '-'}</b>`,
        threat: html`<b class="num t-orange">${i.threat}</b>`,
        count: i.threat,
      })}</span>
    </div>
    <div class="elist">
      <div class="erow">
        <span class="erow__text"><b class="erow__name">${t('威胁值')}</b>
          <span class="erow__tags"><span class="etag">${t('强度指标，随深度增长')}</span></span></span>
        <b class="erow__count num">${i.threat}</b>
      </div>
      <div class="erow">
        <span class="erow__text"><b class="erow__name">${t('精英')}</b>
          <span class="erow__tags"><span class=${cx('etag', i.elite && 'etag--elite')}>${i.elite ? t('有') : t('无')}</span></span></span>
      </div>
      <div class="erow">
        <span class="erow__text"><b class="erow__name">${t('下次节点')}</b>
          <span class="erow__tags"><span class="etag">${t('R{r} · 强化领袖返场', { r: i.nextNodeRound })}</span></span></span>
        <b class="erow__count num">${i.nextNodeIn > 0 ? t('{n} 回合', { n: i.nextNodeIn }) : t('本回合')}</b>
      </div>
    </div>
    ${wordChips.length ? html`<div class="echochips" aria-label=${t('本回合侵蚀词条')}>
      ${wordChips.map((c) => html`<span key=${c.key} class=${`etag ecochip ecochip--${c.tone}`} title=${c.title}>
        <b class="ecochip__glyph">${c.glyph}</b>${c.label}</span>`)}
    </div>` : null}
    <p class="edrawer__empty"><${GIcon} name="target" />${t('深潜中敌人由威胁预算随机组合，阵容逐回合变化')}</p>
  </div>`;
}

function EnemiesTab({ pub, priv, onEnemy }) {
  // 「深渊回响」：**深潜回合**只给情报（威胁值 / 精英 / 下次节点），不列具体怪 ——
  // 敌人是按威胁预算随机组合的，提前列出来等于把随机的意义抹掉了。
  // R1~15 是原版开局，照旧显示完整列表（维护者 2026-11-03）。
  const echo = pub?.echo;
  const inDive = !!(echo && echo.diveStart && Number(pub?.round) >= Number(echo.diveStart));
  const rows = groupEnemies(priv?.nextEnemies, (k) => data.lookup('enemies', k));
  const types = factionTypes(pub?.factions);
  const f = data.get('factions')?.types || {};
  const total = rows.reduce((s, r) => s + r.count, 0);
  // 深潜的普通回合不显示固定领袖块（敌人是随机组合的）；但 **boss 关**要显示：
  // 14 层 / 15 层隐藏核心 / 25·35·45 返场（维护者 2026-11-05：15 层的 boss 在准备阶段看不到了）。
  const bossId = inDive ? (echo && echo.bossRound ? echo.bossId : null) : pub?.bossId;
  const boss = bossId ? data.lookup('bosses', bossId) : null;
  return html`<div class="edrawer__body">
    ${echo && echo.intel ? html`<${EchoIntel} echo=${echo} />` : null}
    ${echo && !echo.intel && echo.schedule ? html`<div class="edrawer__intel">
      <div class="edrawer__sum"><span>${t('深潜第 {d} 回合 · 威胁值 {threat}', { d: html`<b class="num">${echo.depth ?? '-'}</b>`, threat: html`<b class="num t-orange">—</b>`, count: 0 })}</span></div>
      <div class="erow"><span class="erow__text"><b class="erow__name">${t('精英')}</b>
        <span class="erow__tags"><span class="etag">—</span></span></span></div>
      <div class="erow"><span class="erow__text"><b class="erow__name">${t('下次节点')}</b>
        <span class="erow__tags"><span class="etag">${t('R{r} · 强化领袖返场', { r: echo.schedule.nextNodeRound })}</span></span></span>
        <b class="erow__count num">${echo.schedule.nextNodeIn > 0 ? t('{n} 回合', { n: echo.schedule.nextNodeIn }) : t('本回合')}</b></div>
      <p class="edrawer__empty">${t('本回合是领袖返场 / 情报被诅咒遮蔽，具体阵容开战时揭晓')}</p>
    </div>` : null}
    ${inDive ? null : html`<div class="edrawer__sum">
      <span>${tParts('第 {r} 回合 · 即将迎击 {n} 名敌人', { r: html`<b class="num">${pub?.round ?? '-'}</b>`, n: html`<b class="num t-orange">${total}</b>`, count: total })}</span>
      ${types.length ? html`<${FactionChips} types=${types} />` : null}
    </div>`}
    ${inDive ? null : (rows.length ? html`<div class="elist">
      ${rows.map((r) => html`<button key=${`${r.enemyKey}|${r.tag}`} type="button" class=${cx('erow', r.tag && `erow--${r.tag}`, `erow--${r.rank.toLowerCase()}`)}
          onClick=${() => onEnemy(r.enemyKey, r.count)}>
        <${UnitThumb} kind="enemy" id=${r.enemyKey} size="md" />
        <span class="erow__text">
          <b class="erow__name">${r.name}</b>
          <span class="erow__tags">
            ${r.tag ? html`<span class=${`etag etag--${r.tag}`}>${t(TAG[r.tag] || r.tag)}</span>` : null}
            ${r.rank === 'ELITE' ? html`<span class="etag etag--elite">${t('精英')}</span>` : null}
            ${r.fly ? html`<span class="etag etag--fly">${t('空中')}</span>` : null}
            ${r.acTypes.map((ty) => html`<span key=${ty} class="etag etag--faction">${(f[ty]?.name || ty).replace(t('特训敌人·'), '')}</span>`)}
          </span>
        </span>
        <b class="erow__count num">×${r.count}</b>
      </button>`)}
    </div>` : html`<p class="edrawer__empty"><${GIcon} name="target" />${t('暂无敌方情报')}</p>`)}
    ${boss ? html`<div class="eboss">
      <${UnitThumb} kind="enemy" id=${boss.enemyKey} size="md" />
      <div><${MicroLabel} tone="gold">${t('ENEMY LEADER // 敌方领袖')}</${MicroLabel}><b>${boss.name}</b>
        <span class="t-lo">${t('第 {r} 回合 · 最终攻势', { r: inDive ? (pub?.round ?? 0) : (data.get('config')?.modes?.[pub.modeId]?.bossRound ?? pub.lastRound ?? 14) })}</span></div>
    </div>` : null}
  </div>`;
}

function InfoTab({ pub, priv, onChess, bandId = null, bandOwner = null }) {
  const model = matchInfoModel(pub, {
    bonds: data.list('bonds'), chess: (id) => data.lookup('chess', id), mode: data.get('config')?.modes?.[pub?.modeId],
    // the own 自选 pieces this match leaves out of the shop (m.private.diyBanned) — not while scouting a teammate
    priv: bandOwner ? null : priv, diyData: { chess: data.get('chess'), backups: data.get('backups') },
  });
  const { bonds, banned, perBond, stateOf } = model;
  const disabled = new Set(bonds.filter((b) => stateOf(b.bondId)).map((b) => b.bondId));
  // while scouting a teammate's prep board the drawer shows THEIR 策略 in place of one's own (user playtest #2 item 2)
  const band = (bandId || priv?.bandId) ? data.lookup('bands', bandId || priv.bandId) : null;
  const stage = pub?.stageId ? data.lookup('stages', pub.stageId) : null;
  const withBans = bonds.filter((b) => disabled.has(b.bondId) || (perBond.get(b.bondId) || 0) > 0)
    .sort((a, b) => (disabled.has(b.bondId) - disabled.has(a.bondId)) || ((perBond.get(b.bondId) || 0) - (perBond.get(a.bondId) || 0)));
  return html`<div class="edrawer__body">
    ${band ? html`<div class="iband">
      <${BandIcon} bandId=${band.bandId} size="md" />
      <div><${MicroLabel} tone="mint">STRATEGY // ${bandOwner ? t('{bandOwner} 的策略', { bandOwner }) : t('我的策略')}</${MicroLabel}><b>${band.name} <small class="t-lo">${band.effectName}</small></b>
        <${RichText} text=${band.descRaw || band.desc} class="iband__desc" /></div>
    </div>` : null}
    ${stage ? html`<p class="istage"><${Icon} name="rook" />${t('战场：')}<b>${stage.name || stage.id}</b></p>` : null}
    <h4 class="ihead">${t('本局禁用干员情况')} <small class="num">${banned.length}</small></h4>
    <div class="ibonds">
      ${withBans.length ? withBans.map((b) => html`<span key=${b.bondId} class=${cx('ibond', disabled.has(b.bondId) && 'is-off')} title=${briefingBondTip(b.name, stateOf(b.bondId), perBond.get(b.bondId) || 0)}>
        <${BondGlyph} bondId=${b.bondId} /><span>${b.name}</span>
        ${perBond.get(b.bondId) ? html`<span class="ibond__ban num" title=${t('该盟约中被禁用的干员数')}><${Icon} name="user" />${perBond.get(b.bondId)}</span>` : null}
      </span>`) : html`<span class="t-dim">${t('本局没有禁用盟约')}</span>`}
    </div>
    ${banned.length ? html`<div class="ibanned">${banned.map((id) => html`<button key=${id} type="button" class="ibanned__one" onClick=${() => onChess(id)}>
      <${UnitThumb} kind="chess" ownerId=${null} id=${id} size="sm" dim=${true} /></button>`)}</div>` : null}
    <${DiyBannedLine} model=${model} class="idiybanned" />
  </div>`;
}

/**
 * @param {{ tab:'enemies'|'info', onTab:(t:string)=>void, pub:any, priv:any, onClose:Function, onEnemy:(key:string, count:number)=>void, onChess:(id:string)=>void,
 *   bandId?: string|null, bandOwner?: string|null }} props
 *   bandId / bandOwner: while scouting a teammate's prep board, the watched player's 策略 (m.public players[].bandId)
 *   replaces one's own in the 本局信息 tab (game.js scoutBandId; user playtest #2 item 2)
 */
export function EnemyDrawer({ tab, onTab, pub, priv, onClose, onEnemy, onChess, bandId = null, bandOwner = null }) {
  // 「深渊回响」多一个「祝福」页（维护者 2026-11-04：祝福要能单独点开看效果）
  const hasEcho = !!pub?.echo;
  const items = [
    { id: 'info', label: t('本局信息') },
    { id: 'enemies', label: t('敌方情报') },
    ...(hasEcho ? [{ id: 'bless', label: t('深渊回响') }] : []),
  ];
  return html`<div class="edrawer brackets" role="dialog" aria-label=${tab === 'info' ? t('本局信息') : tab === 'bless' ? t('祝福') : t('敌方情报')}>
    <div class="edrawer__top">
      <${Tabs} size="sm" value=${tab} onChange=${onTab} items=${items} />
      <button type="button" class="edrawer__close tapx" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </div>
    ${tab === 'info' ? html`<${InfoTab} pub=${pub} priv=${priv} onChess=${onChess} bandId=${bandId} bandOwner=${bandOwner} />`
      : tab === 'bless' ? html`<${BlessTab} pub=${pub} />`
        : html`<${EnemiesTab} pub=${pub} priv=${priv} onEnemy=${onEnemy} />`}
  </div>`;
}

/**
 * 「祝福」页：已获得的祝福 + 本回合侵蚀词条，**每条都带完整说明**（维护者 2026-11-04：
 * 原来的圆片只有缩写，玩家看不到效果）。
 */
function BlessTab({ pub }) {
  const echo = pub?.echo;
  const words = Array.isArray(echo?.words) ? echo.words : [];
  const bless = Array.isArray(echo?.blessings) ? echo.blessings : [];
  // 反制祝福（一次性、不占名额）单独计数，别让它把 "/" 撑爆；
  // 一次性祝福（回血 / 资金…）也不占名额（维护者 2026-11-05）：列表照常显示，但不算进 n/3
  const normalBless = bless.filter((b) => !b.counter && !b.consumed);
  const depth = Number(echo?.depth) || 0;
  const counters = Array.isArray(echo?.counters) ? echo.counters : [];
  return html`<div class="edrawer__body">
    ${counters.length ? html`<div class="echo-counters">
      ${counters.map((c) => html`<span key=${c.id} class="echo-counter" title=${c.desc || ''}>
        <b>${c.name}</b>
        ${c.canLiftBans && echo?.canLiftBans
          ? html`<button type="button" class="echo-counter__use" onClick=${() => actions.echoCounterUse()}>${t('提前结束排异/封锁')}</button>`
          : null}
      </span>`)}
    </div>` : null}
    <h4 class="ihead">${t('已获祝福')} <small class="num">${normalBless.length}/${Number(echo?.blessingMax) || 3}</small>
      <small class="t-dim">${t('深度 {n}', { n: depth })}</small></h4>
    ${bless.length ? html`<ul class="echo-list">${bless.map((b) => html`<li key=${b.id}>
      <b>${b.name}</b>${b.rarityLabel ? html`<em class=${`echo-rar is-${b.rarity || 'common'}`}>${b.rarityLabel}</em>` : null}${b.oneShot ? html`<em class="echo-rar is-oneshot" title=${t('一次性：拿到时立刻结算，不挂在干员身上')}>${t('一次性')}</em>` : null}<span>${b.desc || ''}</span></li>`)}</ul>`
      : html`<p class="t-dim">${t('还没有获得祝福（深度 1、5、10、15… 各有一次三选一）')}</p>`}
    <h4 class="ihead">${t('本回合侵蚀词条')} <small class="num">${words.length}</small></h4>
    ${words.length ? html`<ul class="echo-list echo-list--enemy">${words.map((w) => html`<li key=${w.id}>
      <b>${w.name}</b><span>${w.desc || ''}</span></li>`)}</ul>`
      : html`<p class="t-dim">${t('本回合没有词条')}</p>`}
    ${Array.isArray(echo?.rules) && echo.rules.length ? html`
      <h4 class="ihead">${t("\u56fa\u5b9a\u89c4\u5219")} <small class="num">${echo.rules.length}</small></h4>
      <ul class="echo-list echo-list--rule" data-testid="echo-fixed-rules">${echo.rules.map((c) => html`<li key=${c.id}>
        <b>${c.name}</b><span>${c.desc || ''}</span></li>`)}</ul>` : null}
    ${Array.isArray(echo?.curses) && echo.curses.length ? html`
      <h4 class="ihead">${t('诅咒')} <small class="num">${echo.curses.length}</small></h4>
      <ul class="echo-list echo-list--curse">${echo.curses.map((c) => html`<li key=${c.id}>
        <b>${c.name}</b>${c.rarityLabel ? html`<em class=${`echo-rar is-${c.rarity || 'common'}`}>${c.rarityLabel}</em>` : null}<span>${c.desc || ''}</span></li>`)}</ul>` : null}
  </div>`;
}
