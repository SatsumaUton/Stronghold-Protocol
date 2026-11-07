// Bond strip (active-bond discs under the top bar) and the bond detail popup: the key facts first (user playtest #2
// item 9: name, members in play / next threshold, layers, reached tier and its threshold row, the current effect with
// layer-resolved numbers), then the full description and the member list with owned / on-board state — operators that
// are members through 变形同构体 included (tagged 同构, gameLogic bondMembers; such a row opens the wearer's card with its
// items: the pair and the granted chip), so the list's count agrees with 在场 (a bond the mode never activates says
// 本局禁用 — gameLogic modeOffBonds). A core bond whose count holds 调和's +1 (the view entry's `harmony`, sent by the
// server — server/match/bondsMeta.js; never re-derived here) says so: 在场 n（含调和 +1）, and a 调和 row heads the member
// list naming the 调和 operators on that board (gameLogic harmonyMembers: 缪尔赛思 …; a tap opens the first one's card) —
// the +1 used to read as a miscount (GitHub issue #1, DESIGN §21.26). Opened from the detail panel's bond chips it docks
// beside that panel (`beside`: the panel's side).
// Research 06 §11.1: round mint discs, stack count over the disc, name below, sorted by stacks; grey =
// present but inactive; in 联防 / boss rounds the strip is dimmed ("层数叠加已禁用"). A bond the mode never activates
// that the player has members of (the server's `off` entry — server/match/bondsMeta.js offBondCounts: 标准's 投资人 奇迹
// 突袭 独行 …) comes last as a grey disc with ✕ and 本局禁用 under it instead of its count (community reports
// 「投资人等在休整区就能生效的盟约不生效」 / 「…不会触发斯卡蒂与异德的突袭」: the bond just vanished, 0.1.3). The popup's 成员
// header counts the hand members too for a bond that counts the hand (投资人 远见 奇迹: gameLogic memberHeadCount), as 在场
// already did.
// Watching a teammate (DESIGN §20.15, ui/watchBonds.js) the strip and the popup show THAT player's bonds and layers:
// the strip carries an amber "👁 name" tag (`owner`, the observing pill's spelling, research 09 §3.1) and amber rings,
// the popup a "👁 name 的盟约" line; its member list reads the teammate's operators on the field — in prep their bench
// too, counted like their own popup counts it (ui/watchBonds.js ownerBoard: hand / temp by the scout's `area`, GitHub
// #385); a battle sends no bench.
// 0.2.0 补位: a member the player fields as its stand-in (the own m.private.standIns; a teammate's unit that says so —
// UnitInfo `standInFor`) is drawn as the stand-in — avatar, name, a small 「替补」 mark on the thumbnail — and its row
// opens the stand-in's card (gameLogic memberStandIn; the owner's recall of the official mode, 2026-10-06).
// 0.2.1 自选编队 (the owner's report of 2026-10-07): each 自选 pick of the player (m.private.diy) is a row of every bond its
// operator carries — the operator's name and portrait with the 「自选」 tag, dimmed until owned (not bought, or not in the
// shop yet), ✕ when all its bonds are off this match (m.private.diyBanned) — and opens the operator's card; a watched
// teammate's 自选 pieces on the field are rows too (their picks are not sent), opening THEIR operator's card (the unit's
// pick goes with onMember: never the empty 甄选干员 slot's card). A 自选 piece that is a member through 变形同构体 shows its
// operator too, with the 「同构」 tag (#846: it showed the empty slot's 「甄」).

import { cloneElement } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, BondDisc, Icon, MicroLabel, Tooltip } from './components.js';
import { RichText, UnitThumb, BondGlyph, GIcon } from './gameComponents.js';
import { sortBonds, bondMembers, nextThreshold, bondTier, harmonyMembers, HARMONY_BOND, memberHeadCount, briefingBondTip, diyGetter, diyRecordFor, memberStandIn, standInForText } from './gameLogic.js';
import { formatBondEffect } from './richText.js';
import { bondIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { useStore } from '../store.js';
import { t, tc, tParts, tName } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** The "👁 name" tag of a teammate's strip (DESIGN §20.15). */
function OwnerTag({ owner }) {
  return html`<span class="bstrip__owner" title=${t('正在查看 {owner} 的盟约', { owner })} data-owner=${owner}>
    <${GIcon} name="eye" class="bstrip__eye" /><${MicroLabel}>${owner}</${MicroLabel}>
  </span>`;
}

function BondScroller({ count, children }) {
  const viewport = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((old) => old.left === left && old.right === right ? old : { left, right });
    };
    // A render can resize the observed slots too. Update after observer delivery, so those changes are measured in the
    // next frame rather than producing "ResizeObserver loop completed with undelivered notifications" during prep.
    let frame = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; update(); });
    });
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      el.removeEventListener('scroll', update);
    };
  }, [viewport, count]);
  const scroll = direction => viewport.current?.scrollBy({ left: direction * Math.max(80, viewport.current.clientWidth * .75), behavior: 'smooth' });
  return html`<div class="bstrip-scroll">
    <button type="button" class="bstrip-scroll__arrow" disabled=${!edges.left} aria-label=${t('向左滚动盟约')} onClick=${() => scroll(-1)}>‹</button>
    ${cloneElement(children, { ref: viewport })}
    <button type="button" class="bstrip-scroll__arrow" disabled=${!edges.right} aria-label=${t('向右滚动盟约')} onClick=${() => scroll(1)}>›</button>
  </div>`;
}

/**
 * @param {{ bonds: any[], layersDisabled?: boolean, onOpen:(bondId:string)=>void, openId?: string|null,
 *   owner?: string|null }} props — owner: the watched teammate's name (null = your own bonds)
 */
export function BondStrip({ bonds, layersDisabled = false, onOpen, openId = null, owner = null }) {
  const sorted = sortBonds(bonds, (id) => data.lookup('bonds', id));
  if (!sorted.length) {
    return html`<div class=${cx('bstrip', 'bstrip--empty', owner && 'is-other')} data-owner=${owner || null}>
      ${owner ? html`<${OwnerTag} owner=${owner} />` : html`<${MicroLabel}>BONDS</${MicroLabel}>`}<span>${owner ? t('{owner} 尚未激活盟约', { owner }) : t('部署干员以激活盟约')}</span></div>`;
  }
  const m = data.get('assets');
  const shown = sorted;
  const strip = html`<div tabindex="0" class=${cx('bstrip', layersDisabled && 'is-frozen', owner && 'is-other')} role="list"
      aria-label=${owner ? t('{owner} 的盟约', { owner }) : t('我的盟约')} data-owner=${owner || null}>
    ${owner ? html`<${OwnerTag} owner=${owner} />` : null}
    ${shown.map((b) => {
      const rec = data.lookup('bonds', b.bondId);
      const th = Array.isArray(b.thresholds) && b.thresholds.length ? b.thresholds : rec?.thresholds || [];
      if (b.off) {
        // a bond the mode never activates, with members: the briefing's grey ✕ disc, no stack count, 本局禁用 under it
        const name = rec?.name || b.bondId;
        return html`<div key=${b.bondId} role="listitem" data-bond=${b.bondId} data-off="1"
            class=${cx('bslot', 'is-off', openId === b.bondId && 'is-open')}>
          <${BondDisc} name=${name} icon=${bondIconUrl(m, b.bondId)} tier=${0} maxTier=${Math.max(1, th.length)} active=${false}
            disabled=${true} size="sm" showName=${true} layersDisabled=${layersDisabled} onClick=${() => onOpen(b.bondId)}
            title=${t('{tip} · {n} 名成员', { tip: briefingBondTip(name, 'off'), n: b.count ?? 0 })} />
          <span class="bslot__count bslot__off">${t('本局禁用')}</span>
        </div>`;
      }
      const next = nextThreshold(b.count ?? 0, th);
      return html`<div key=${b.bondId} role="listitem" data-bond=${b.bondId} data-harmony=${b.harmony > 0 ? b.harmony : null}
          class=${cx('bslot', b.active && 'is-active', openId === b.bondId && 'is-open')}>
        <${BondDisc} name=${rec?.name || b.bondId} icon=${bondIconUrl(m, b.bondId)} layers=${rec?.noStack ? undefined : b.layers ?? 0}
          tier=${b.tier ?? 0} maxTier=${Math.max(1, th.length)} active=${!!b.active} size="sm" showName=${true}
          layersDisabled=${layersDisabled} onClick=${() => onOpen(b.bondId)}
          title=${`${rec?.name || b.bondId} ${b.count ?? 0}/${next ?? th[th.length - 1] ?? '-'}${b.harmony > 0 ? t('（含调和 +{harmony}）', { harmony: b.harmony }) : ''}`} />
        <span class=${cx('bslot__count', 'num', next == null && 'is-max')}>${b.count ?? 0}<small>/${next ?? th[th.length - 1] ?? '-'}</small></span>
      </div>`;
    })}
  </div>`;
  const content = html`<${BondScroller} count=${sorted.length}>${strip}<//>`;
  return layersDisabled ? html`<${Tooltip} text=${t('层数叠加已禁用')} placement="bottom">${content}<//>` : content;
}

/**
 * Bond detail popup.
 * @param {{ bondId: string, entry?: any, priv?: any, banned?: string[], onClose: Function,
 *   onMember?: (chessId:string, items?:string[]|null, standInFor?:string|null, diy?:any)=>void,
 *   place?: 'left'|'beside'|'besideR'|'right'|null, over?: boolean, beside?: 'left'|'right'|null, owner?: string|null, off?: boolean }} props —
 *   `place`: where it opens (gameLogic bondPopupPlace; `beside: 'left'` = the older spelling of 'beside'); `over`: above the
 *   detail card; `owner`: the watched teammate's name (`entry` / `priv` are then theirs: ui/watchBonds.js); `onMember`
 *   gets a 变形同构体 row's item ids too (its card shows the pair and the granted chip), null for a plain member, and a
 *   stand-in row's `standInFor` (0.2.0 补位: a teammate's card then shows the stand-in too), and a teammate's 自选 row's
 *   pick (`diy`, its unit's: the card composes their operator; the own rows' card reads m.private.diy); `off`: the
 *   mode never activates this bond (gameLogic modeOffBonds — 标准's 10 inactive bonds): 本局禁用 instead of 未激活, with a
 *   note, no 在场 count and no 当前效果 block (its numbers would promise an effect the mode never gives; the bond text stays).
 *   `entry.harmony` (the server's bond views: the +1 调和 added to `count`): 在场 n（含调和 +1） and the 调和 row
 */
export function BondPopup({ bondId, entry, priv, banned = [], onClose, onMember, place = null, over = false, beside = null, owner = null, ownerId, off = false, echoBanned = false, morphMode = 'official' }) {
  // 「盟约投影」：本局**你自己**拿到的那条（每人各自选，2026-11-07）。
  // 必须在 `if (!b) return null` 之前取，保持 hook 顺序稳定。
  const echo = useStore((s) => s.match?.public?.echo || null);
  const meId = useStore((s) => s.me.playerId);
  const b = data.lookup('bonds', bondId);
  if (!b) return null;
  // 「深渊回响」的排异：这条盟约当前不许上人（可被「开路」或到期解除，2026-11-05）
  const echoBannedNow = echoBanned === true;
  const count = entry?.count ?? 0;
  const layers = entry?.layers ?? 0;
  const th = Array.isArray(entry?.thresholds) && entry.thresholds.length ? entry.thresholds : b.thresholds || [];
  const tier = off ? 0 : entry?.tier ?? bondTier(count, th, b.maxCount);
  const active = !off && (entry ? !!entry.active : tier > 0);
  // (自选 pieces are their operators: the own ones by m.private.diy, a watched teammate's by the pick its unit carries)
  const dd = { chess: data.get('chess'), backups: data.get('backups') };
  const getChess = diyGetter((id) => data.lookup('chess', id), priv, dd);
  const pieceRecord = (p) => (p && p.diy && typeof p.diy === 'object' ? diyRecordFor(data.lookup('chess', p.id), p.diy, dd) : null) || getChess(p.id);
  const members = bondMembers(b, priv, banned, getChess, (id) => data.lookup('items', id), pieceRecord, morphMode);
  // 补位: the stand-in a row shows (a 自选 row — a member, or one through 变形同构体 with its record `rec` — is its operator already)
  const rawChess = (id) => data.lookup('chess', id);
  const siOf = (mb) => (mb.diy || mb.rec ? null : memberStandIn(priv, rawChess(mb.id), data.get('backups'), rawChess));
  const countsHand = entry?.countsHand ?? b.countsHand;
  const next = nextThreshold(count, th);
  const hasNow = !off && !!(b.effectDescRaw || b.effectDesc);
  // 「盟约投影」（2026-11-06，2026-11-07 改每人各自选）：点开的那条盟约如果正是**你正在看的那位**投影的，
  // 要说明「他的干员全按成员算」—— 观战 / 前往查看时看到的内容必须和对局中玩家自己看到的一致，
  // 所以投影按 `ownerId`（这条盟约属于谁）取，而不是永远取自己的。本局禁用的盟约不挂。
  const projEntry = (() => {
    if (off) return null;
    const projOwner = ownerId != null ? String(ownerId) : meId;
    // ① 服务端在**这条盟约的视图条目**上直接标了 `projected: true`（bondsView 给投影那条打的标记）——
    //    这是最可靠的一份：弹窗本来就拿着 `entry`。
    if (entry && entry.projected === true) return { id: bondId, desc: '' };
    // ② 那位玩家自己的投影：服务端按 playerId 下发（echo.projections[playerId]）
    const mine = projOwner != null && echo && echo.projections && typeof echo.projections === 'object' ? echo.projections[projOwner] : null;
    return mine && typeof mine.id === 'string' ? mine : null;
  })();
  const isProjected = !!(projEntry && projEntry.id === bondId);
  // 【盟约投影】成员行（2026-11-07）：投影的那条盟约，**场上所有己方干员**都算成员（服务端口径），
  // 所以这里把还没进 members 的场上棋子补进来，标 projected（渲染成「（盟约投影）」标签，和「同构」并列）。
  if (isProjected) {
    const have = new Set(members.map((x) => x && x.id));
    for (const p of (Array.isArray(priv?.board) ? priv.board : [])) {
      if (!p || p.kind !== 'chess') continue;
      const id = rawChess(p.id)?.baseId || String(p.id).replace(/_b$/, '_a');
      if (!id || have.has(id)) continue;
      const rec = getChess(id) || rawChess(id);
      have.add(id);
      members.push({ id, tier: rec?.tier ?? 0, name: rec?.name ?? id, onBoard: true, owned: true, inHand: false, banned: false, projected: true });
    }
  }
  const at = place || (beside === 'left' ? 'beside' : 'left');
  // 调和's +1 in this count (the server's word), and the 调和 operators on that board who give it
  const harmony = !off && Number.isInteger(entry?.harmony) && entry.harmony > 0 ? entry.harmony : 0;
  const harmonyBy = harmony ? harmonyMembers(priv, getChess).map((x) => {
    const si = memberStandIn(priv, rawChess(x.id), data.get('backups'), rawChess);
    return si ? { ...x, name: si.name } : x;
  }) : [];
  const harmonyName = data.lookup('bonds', HARMONY_BOND)?.name || tName('调和');
  const harmonyText = harmonyBy.length ? t('{names} 在场：核心盟约激活人数 +{harmony}', { names: harmonyBy.map((x) => x.name), harmony })
    : t('{harmonyName}已激活：核心盟约激活人数 +{harmony}', { harmonyName, harmony });
  return html`<div class=${cx('bpop', 'brackets', `bpop--${at}`, over && 'is-over', owner && 'is-other')} data-place=${at} data-owner=${owner || null}
      role="dialog" aria-label=${owner ? t('{owner} 的盟约：{name}', { owner, name: b.name }) : t('盟约：{name}', { name: b.name })}>
    <button type="button" class="bpop__close" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    <header class="bpop__head">
      <div class=${cx('bpop__disc', active && 'is-active')}><${BondGlyph} bondId=${bondId} /></div>
      <div class="bpop__titles">
        <${MicroLabel} tone="mint">${b.isCore ? t('CORE BOND // 核心盟约') : t('ADD-ON BOND // 附加盟约')}</${MicroLabel}>
        ${owner ? html`<span class="bpop__owner"><${GIcon} name="eye" />${tParts('{owner} 的盟约', { owner: html`<b>${owner}</b>` })}</span>` : null}
        <h3 class="bpop__name">${b.name}${echoBannedNow ? html`<em class="bpop__echo-banned" title=${t('深渊排异：该盟约的干员暂时无法部署（可被「开路」或到期解除）')}>${t('已排异')}</em>` : null}</h3>
        <div class="bpop__facts">
          ${off ? null : html`<span>${t('在场')} <b class="num">${count}</b>${next != null ? html`<small class="num">/${next}</small>` : null}${countsHand ? html`<small>${t('（含整备区）')}</small>` : null}${harmony ? html`<small class="bpop__hnote" data-harmony=${harmony}>${t('（含{harmonyName} +{harmony}）', { harmonyName, harmony })}</small>` : null}</span>`}
          ${b.noStack ? html`<span>${t('层数不显示')}</span>` : html`<span>${t('层数')} <b class="num t-mint">${layers}</b></span>`}
          <span class=${active ? 't-mint' : 't-lo'}>${active ? (th.length > 1 ? t('已激活 · {tier} 阶', { tier }) : t('已激活')) : off ? t('本局禁用') : t('未激活')}</span>
          ${isProjected ? html`<span class="bpop__proj-tag">${t('投影')}</span>` : null}
        </div>
      </div>
    </header>
    ${off ? html`<p class="bpop__off" role="note">${t('本模式下该盟约不会激活（其干员仍可能因所属的其他盟约出现）')}</p>` : null}
    <div class="bpop__tiers">
      ${th.map((n, i) => html`<span key=${i} class=${cx('bpop__tier', i < tier && 'is-on')}><b class="num">${n}</b><small>${b.maxCount != null ? t('名及以下') : tc('bond-threshold', '名')}</small></span>`)}
    </div>
    ${hasNow ? html`<section class="bpop__sec bpop__sec--now">
      <h4>${t('当前效果')} ${b.noStack ? null : html`<small class="num">${t('（{layers} 层）', { layers })}</small>`}</h4>
      <${RichText} as="p" text=${formatBondEffect(b, layers)} class="bpop__desc" />
    </section>` : null}
    ${isProjected ? html`<section class="bpop__sec bpop__proj" data-projection=${bondId}>
      <h4>${t('盟约投影')}</h4>
      <p class="bpop__desc">${t('你自己的全体干员都视为【{bond}】盟约成员（同名干员只算一个，按原版人数门槛激活）。', { bond: b.name })}${projEntry.desc ? html`<br />${projEntry.desc}` : null}</p>
    </section>` : null}
    <section class="bpop__sec">
      <h4>${t('盟约效果')}</h4>
      <${RichText} as="p" text=${b.descRaw || b.desc} class="bpop__desc" />
    </section>
    <section class="bpop__sec">
      <h4>${t('成员')} <small>${memberHeadCount(members, countsHand)}/${members.length}</small></h4>
      ${isProjected ? html`<p class="bpop__desc" data-projection-members>${t('投影生效：你自己场上全部干员都视为本盟约成员（上方的「在场」已按干员数计入，同名只算一个）')}</p>` : null}
      ${harmony ? (harmonyBy.length
        ? html`<button type="button" class="bpop__harmony" data-harmony=${harmony} title=${harmonyText} onClick=${() => onMember?.(harmonyBy[0].id, null)}>
          <${BondGlyph} bondId=${HARMONY_BOND} /><b>${harmonyName} +${harmony}</b><span>${harmonyText}</span></button>`
        : html`<div class="bpop__harmony" role="note" data-harmony=${harmony} title=${harmonyText}>
          <${BondGlyph} bondId=${HARMONY_BOND} /><b>${harmonyName} +${harmony}</b><span>${harmonyText}</span></div>`) : null}
      <div class="bpop__members">
        ${members.map((mb) => {
          const si = siOf(mb);
          const name = si ? si.name : mb.name;
          const items = mb.granted && Array.isArray(mb.items) ? mb.items : null;
          return html`<button key=${mb.id} type="button" class=${cx('bpop__member', mb.onBoard && 'is-on', mb.owned && !mb.onBoard && 'is-owned', mb.banned && 'is-banned', mb.granted && 'is-granted', si && 'is-standin')}
              onClick=${() => (si ? onMember?.(mb.id, items, si.standInFor) : mb.pick ? onMember?.(mb.id, items, null, mb.pick) : onMember?.(mb.id, items))}
              data-granted=${mb.granted ? '1' : null} data-standin=${si ? si.charId : null} data-diy=${mb.diy ? mb.rec?.charId || '1' : null}
              title=${`${name}${si ? t('（{note}）', { note: standInForText(mb.name) }) : ''}${mb.projected ? t('（盟约投影：视为本盟约成员）') : mb.granted ? t('（变形同构体：视为本盟约成员）') : ''}${mb.banned ? t('（本局禁用）') : mb.onBoard ? t('（在场）') : mb.owned ? t('（整备区）') : ''}`}>
            <${UnitThumb} kind="chess" id=${mb.id} ownerId=${ownerId ?? priv?.playerId} size="sm" dim=${!mb.owned || mb.banned} rec=${si || mb.rec || null} title=${name} />
            <span class="bpop__mname">${name}</span>
            ${mb.banned ? html`<span class="bpop__ban"><${Icon} name="close" /></span>` : null}
            ${mb.projected ? html`<span class="bpop__iso" data-projection="1" aria-hidden="true">${t('投影')}</span>` : null}
            ${mb.granted ? html`<span class="bpop__iso" aria-hidden="true">${t('同构')}</span>` : null}
            ${mb.diy ? html`<span class="bpop__iso bpop__diy" data-diy="1" aria-hidden="true">${t('自选')}</span>` : null}
          </button>`;
        })}
      </div>
    </section>
  </div>`;
}
