// ui/echoBlessing.js — 「深渊回响」的祝福三选一（DESIGN-ABYSS.md §6）。
//
// 为什么必须有人做这个界面：每 5 个深潜回合服务端会开一次三选一（m.public.echo.offer），
// 并且**要等所有在线真人投完票才结算**。没有这个面板，全队会卡在那里、也没有任何提示。
//
// 形态参照「悬赏目标 / 选择策略」那种**居中的卡片选择**（维护者 2026-11-04：
// 原来是一条顶部 strip，三项挤成三个小按钮，看不清也点不准）。
// 服务端：g.echoBlessing { pick } → MatchEcho.setEchoBlessingVote（票多者得，平票取靠前）。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { actions } from './gameActions.js';
import { useStore, serverNow } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function EchoBlessing({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  // 死亡的玩家不参与祝福/弃选/护盾投票（维护者 2026-11-05）
  const meAlive = useStore((s) => {
    const me = (s.match?.public?.players || []).find((p) => p.playerId === s.me.playerId);
    return me ? me.alive !== false : true;
  });
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(null);
  const [now, setNow] = useState(() => serverNow());
  // 「查看诅咒」（维护者 2026-11-05）：选祝福时玩家切不出去看自己身上挂了什么，
  // 所以在这个面板里直接给一个按钮，展开当前全队的诅咒清单。
  const [showCurses, setShowCurses] = useState(false);
  const pending = useRef(false);
  const echo = pub?.echo;
  const offer = echo?.offer;
  // 当前诅咒清单（服务端 pub.echo.curses，含固定规则那几条）
  const curses = Array.isArray(echo?.curses) ? echo.curses : [];
  // 刷新三选一（维护者 2026-11-05）：每局 3 次，活着的人投票决定是否重抽
  const refresh = echo?.blessingRefresh;
  const refreshLeft = Math.max(0, Number(refresh?.left) || 0);
  const refreshVote = refresh?.vote;
  // 名额已满时的「弃选」投票（维护者 2026-11-05）：新祝福已选定 → 全队投掉哪个旧的，30 秒时限。
  const discard = echo?.discard;
  // 倒计时：服务端在 offer.endsAt 到点后强制结算（维护者 2026-11-04：看不到还剩多久）
  const left = offer && Number.isFinite(offer.endsAt) && offer.endsAt > 0 ? Math.max(0, Math.ceil((offer.endsAt - now) / 1000)) : null;
  const votes = (offer && offer.votes) || {};
  const myPick = votes[myId];
  const players = pub?.players || [];
  // 只有在线真人投票（服务端同一口径：离线的人既不计数也不阻塞）
  const voters = players.filter((p) => !p.isBot && p.status !== 'left' && p.connected && p.alive !== false);
  const voted = voters.filter((p) => votes[p.playerId] != null).length;
  useEffect(() => {
    if (left == null) return undefined;
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, [left == null]);
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } finally { pending.current = false; setBusy(false); }
  };
  // 维护者 2026-11-05：点卡片只是**选中**，再按「确认」才投票（参考原版悬赏目标），确认前可以反悔改选。
  const pick = (i) => { if (busy || !online || myPick != null) return; setArmed(i); };
  const confirm = () => {
    if (busy || !online || myPick != null || armed == null) return;
    send(() => actions.echoBlessing(armed));
  };
  // 死亡的玩家不参与祝福 / 弃选 / 护盾投票（维护者 2026-11-05）：整块面板都不显示
  if (!meAlive) return null;
  // 已经过期的 offer 不再渲染（维护者 2026-11-05 玩家反馈）：服务端 30 秒一到就强制结算，
  // 客户端如果还拿着上一帧的 offer 画面板，玩家点下去只会收到「当前阶段无法进行该操作」。
  if (offer && Number.isFinite(offer.endsAt) && offer.endsAt > 0 && offer.endsAt + 2000 < now) return null;
  // 没有可抽的卡时：满名额的弃选投票 → 护盾指定盟约的投票 → 什么都不显示（hooks 已全部跑过，顺序稳定）
  if (!offer || !Array.isArray(offer.options) || !offer.options.length) {
    if (discard && Array.isArray(discard.options) && discard.options.length) {
      return html`<${EchoBlessingDiscard} pub=${pub} myId=${myId} online=${online} now=${now} setNow=${setNow} />`;
    }
    const shield = pub?.echo?.shield?.offer;
    if (shield && Array.isArray(shield.options) && shield.options.length) {
      return html`<${EchoShieldVote} pub=${pub} myId=${myId} online=${online} now=${now} setNow=${setNow} />`;
    }
    return null;
  }
  return html`<div class="echo-bless-overlay" role="dialog" aria-label=${t('深渊祝福')} aria-live="polite">
    <div class="echo-bless">
      <header class="echo-bless__head">
        <b>${t('深渊祝福 · 三选一')}</b>
        <span>${t('全队在线博士都选完后自动结算：票数最多的一项生效，平票取靠前的一项。')}</span>
        <button type="button" class=${`echo-bless__cursesbtn${showCurses ? ' is-on' : ''}`}
          aria-expanded=${showCurses ? 'true' : 'false'}
          onClick=${() => setShowCurses(!showCurses)}>
          ${t('查看诅咒')}${curses.length ? html`<b class="num">${curses.length}</b>` : null}
        </button>
        ${refreshVote ? html`<span class="echo-bless__refreshvote">
          ${t('刷新投票')} <b class="num">${(refreshVote.agreed || []).length}/${(refreshVote.voters || []).length}</b>
          <button type="button" class="echo-bless__rbtn" disabled=${busy || !online}
            onClick=${() => send(() => actions.echoBlessingRefreshVote(true))}>${t('同意')}</button>
          <button type="button" class="echo-bless__rbtn" disabled=${busy || !online}
            onClick=${() => send(() => actions.echoBlessingRefreshVote(false))}>${t('不同意')}</button>
        </span>` : html`<button type="button" class="echo-bless__refreshbtn" disabled=${busy || !online || refreshLeft <= 0}
          title=${t('活着的玩家投票决定是否重抽这三个候选；每局最多 3 次，投票不占用选择时间')}
          onClick=${() => send(() => actions.echoBlessingRefresh())}>${t('刷新')}<b class="num">${refreshLeft}</b></button>`}
        ${left != null ? html`<span class="echo-bless__timer" aria-live="off"><b>${left}</b><i>秒</i></span>` : null}
        <span class="echo-bless__count">${voted}/${voters.length}</span>
      </header>
      ${showCurses ? html`<ul class="echo-bless__curses" aria-label=${t('当前诅咒')}>
        ${curses.length
          ? curses.map((c) => html`<li key=${c.id} class=${`echo-bless__curse is-${c.rarity || 'common'}`}>
              <b>${c.name}</b>
              ${c.rarityLabel ? html`<span class="echo-bless__curseTag">${c.rarityLabel}</span>` : null}
              <span class="echo-bless__curseDesc">${c.desc || ''}</span>
            </li>`)
          : html`<li class="echo-bless__curse is-empty">${t('当前没有任何诅咒')}</li>`}
      </ul>` : null}
      <div class="echo-bless__cards">
        ${offer.options.map((opt, i) => {
          const mine = myPick === i;
          const picked = armed === i && myPick == null;
          const who = voters.filter((p) => votes[p.playerId] === i).map((p) => p.name);
          return html`<button key=${opt.id} type="button"
            class=${`echo-bless__card${mine ? ' is-mine' : ''}${picked ? ' is-armed' : ''}`}
            disabled=${busy || !online || myPick != null}
            onClick=${() => pick(i)}>
            <span class="echo-bless__glyph" aria-hidden="true">${(opt.name || '?').slice(0, 1)}</span>
            <b class="echo-bless__name">${opt.name}</b>
            ${opt.rarityLabel ? html`<span class=${`echo-bless__rarity is-${opt.rarity || 'common'}`} data-rarity=${opt.rarity || 'common'}>${opt.rarityLabel}</span>` : null}
            ${opt.oneShot ? html`<span class="echo-bless__oneshot" title=${t('一次性：选了立刻结算，不挂在干员身上')}>${t('一次性')}</span>` : null}
            ${opt.recommend ? html`<span class="echo-bless__recommend" title=${opt.recommendText || t('推荐')}>${t('推荐')}${opt.recommendText ? html`<i>${opt.recommendText}</i>` : null}</span>` : null}
            <span class="echo-bless__desc">${opt.desc || ''}</span>
            ${who.length ? html`<span class="echo-bless__votes">${who.join('、')}</span>` : null}
          </button>`;
        })}
      </div>
      <footer class="echo-bless__foot">
        ${myPick != null
          ? html`<span>${t('已确认「{name}」，等待队友…', { name: offer.options[myPick]?.name || t('已选择') })}</span>`
          : html`<span>${armed != null
            ? t('已选中「{name}」，按「确认」才提交（确认前可以改）。', { name: offer.options[armed]?.name || '' })
            : t('点一张卡选中，再按「确认」提交；全队在线的人都确认完才结算。')}</span>`}
        ${myPick == null ? html`<button type="button" class="echo-bless__confirm" disabled=${busy || !online || armed == null}
          onClick=${() => confirm()}>${t('确认')}</button>` : null}
      </footer>
    </div>
  </div>`;
}

/** 名额已满时的弃选面板：把现有祝福列出来投票弃掉一个（30 秒，投完换入新的）。 */
function EchoBlessingDiscard({ pub, myId, online, now, setNow }) {
  const d = pub?.echo?.discard;
  const [armed, setArmed] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lasts = Number.isFinite(d?.endsAt) && d.endsAt > 0 ? Math.max(0, Math.ceil((d.endsAt - now) / 1000)) : null;
  const votes = d?.votes || {};
  const myPick = votes[myId];
  const voters = (pub?.players || []).filter((p) => !p.isBot && p.status !== 'left' && p.connected);
  const voted = voters.filter((p) => votes[p.playerId] != null).length;
  useEffect(() => {
    if (lasts == null) return undefined;
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, [lasts == null]);
  // 选中 → 确认（与三选一同一口径，2026-11-05）
  const pick = (i) => { if (busy || !online || myPick != null) return; setArmed(i); };
  const confirm = async () => {
    if (busy || !online || myPick != null || armed == null || pending.current) return;
    pending.current = true; setBusy(true);
    try { await actions.echoBlessingDiscard(armed); } finally { pending.current = false; setBusy(false); }
  };
  return html`<div class="echo-bless-overlay" role="dialog" aria-label=${t('深渊祝福 · 舍弃一个')} aria-live="polite">
    <div class="echo-bless">
      <header class="echo-bless__head">
        <b>${t('祝福已满：投票舍弃一个')}</b>
        <span>${t('新的祝福已经选定，但名额已满 —— 全队投票舍弃哪一个，30 秒后按票数结算。')}</span>
        ${lasts != null ? html`<span class="echo-bless__timer" aria-live="off"><b>${lasts}</b><i>秒</i></span>` : null}
        <span class="echo-bless__count">${voted}/${voters.length}</span>
      </header>
      <div class="echo-bless__cards">
        ${d.options.map((opt, i) => {
          const mine = myPick === i;
          const who = voters.filter((p) => votes[p.playerId] === i).map((p) => p.name);
          return html`<button key=${opt.id} type="button"
            class=${`echo-bless__card${mine ? ' is-mine' : ''}${armed === i && myPick == null ? ' is-armed' : ''}`}
            disabled=${busy || !online || myPick != null}
            onClick=${() => pick(i)}>
            <span class="echo-bless__glyph" aria-hidden="true">${(opt.name || '?').slice(0, 1)}</span>
            <b class="echo-bless__name">${opt.name}</b>
            ${opt.rarityLabel ? html`<span class=${`echo-bless__rarity is-${opt.rarity || 'common'}`}>${opt.rarityLabel}</span>` : null}
            ${opt.oneShot ? html`<span class="echo-bless__oneshot">${t('一次性')}</span>` : null}
            <span class="echo-bless__desc">${opt.desc || ''}</span>
            ${who.length ? html`<span class="echo-bless__votes">${who.join('、')}</span>` : null}
          </button>`;
        })}
      </div>
      <footer class="echo-bless__foot">
        <span>${myPick != null ? t('已投票，等待队友…') : (armed != null ? t('已选中，按「确认」提交（确认前可以改）。') : t('点一张卡选中，再按「确认」提交要舍弃的祝福。'))}</span>
        ${myPick == null ? html`<button type="button" class="echo-bless__confirm" disabled=${busy || !online || armed == null} onClick=${() => confirm()}>${t('确认')}</button>` : null}
      </footer>
    </div>
  </div>`;
}
/** 「护盾」祝福的投票：全队指定一条附加盟约，排异随机到它时会被抵消（30 秒）。 */
function EchoShieldVote({ pub, myId, online, now, setNow }) {
  const s = pub?.echo?.shield?.offer;
  const [armed, setArmed] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const left = Number.isFinite(s?.endsAt) && s.endsAt > 0 ? Math.max(0, Math.ceil((s.endsAt - now) / 1000)) : null;
  const votes = s?.votes || {};
  const myPick = votes[myId];
  const voters = (pub?.players || []).filter((p) => !p.isBot && p.status !== 'left' && p.connected);
  const voted = voters.filter((p) => votes[p.playerId] != null).length;
  useEffect(() => {
    if (left == null) return undefined;
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, [left == null]);
  // 选中 → 确认（2026-11-05）
  const pick = (i) => { if (busy || !online || myPick != null) return; setArmed(i); };
  const confirm = async () => {
    if (busy || !online || myPick != null || armed == null || pending.current) return;
    pending.current = true; setBusy(true);
    try { await actions.echoShield(armed); } finally { pending.current = false; setBusy(false); }
  };
  return html`<div class="echo-bless-overlay" role="dialog" aria-label=${t('护盾：指定盟约')} aria-live="polite">
    <div class="echo-bless">
      <header class="echo-bless__head">
        <b>${t('护盾：投票指定要保护的盟约（仅限附加盟约）')}</b>
        <span>${t('排异随机到这条盟约时，护盾会抵消该诅咒（一次性）。30 秒后按票数结算。')}</span>
        ${left != null ? html`<span class="echo-bless__timer" aria-live="off"><b>${left}</b><i>秒</i></span>` : null}
        <span class="echo-bless__count">${voted}/${voters.length}</span>
      </header>
      <div class="echo-bless__cards">
        ${s.options.map((opt, i) => {
          const mine = myPick === i;
          const who = voters.filter((p) => votes[p.playerId] === i).map((p) => p.name);
          return html`<button key=${opt.id} type="button"
            class=${`echo-bless__card${mine ? ' is-mine' : ''}${armed === i && myPick == null ? ' is-armed' : ''}`}
            disabled=${busy || !online || myPick != null}
            onClick=${() => pick(i)}>
            <span class="echo-bless__glyph" aria-hidden="true">${(opt.name || '?').slice(0, 1)}</span>
            <b class="echo-bless__name">${opt.name}</b>
            ${who.length ? html`<span class="echo-bless__votes">${who.join('、')}</span>` : null}
          </button>`;
        })}
      </div>
      <footer class="echo-bless__foot">
        <span>${myPick != null ? t('已投票，等待队友…') : (armed != null ? t('已选中，按「确认」提交（确认前可以改）。') : t('点一条盟约选中，再按「确认」提交。'))}</span>
        ${myPick == null ? html`<button type="button" class="echo-bless__confirm" disabled=${busy || !online || armed == null} onClick=${() => confirm()}>${t('确认')}</button>` : null}
      </footer>
    </div>
  </div>`;
}