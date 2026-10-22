// ui/versionVote.js — the room's version vote strip (DESIGN §35.23, M1; protocol §4–§6), modelled on the 重刷本局 strip
// (ui/setupReroll.js): the host proposes a version (ui/versionPicker.js, room.proposeVersion), every human seated at that
// moment votes (room.state.versionVote: its voters and who agreed — the host counts as agreed), a single decline cancels
// it, the host may cancel it (room.cancelVersionVote), it runs out after 60 s and any seat change voids it (the server
// says why: an m.toast). Spectators and AI teammates do not vote. The countdown is anchored when each room.state
// arrives (`remainingMs` is a duration at send time — clocks differ). The room shows the strip between the 观战席 and
// the footer; the settlement screen shows it too (a doctor still reading the result can vote, screens/game.js).
// Texts go through t() (docs/I18N.md).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon } from './components.js';
import { net } from '../net.js';
import { useStore } from '../store.js';
import { toastError } from './toasts.js';
import { versionLabel } from '../versions.js';
import { t } from '../../../shared/i18n.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The room's open version vote (room.state.versionVote) as the strip reads it, or null: its id, the version, the voters
 * (ids, in seat order) and who agreed, and the remaining time at send time.
 * @param {any} room
 */
export function versionVoteOf(room) {
  const v = room?.versionVote;
  if (!isObj(v) || !Number.isInteger(v.id) || typeof v.version !== 'string' || !Array.isArray(v.voters) || !Array.isArray(v.agreed)) return null;
  return {
    id: v.id, version: v.version, proposerId: v.proposerId ?? null,
    voters: v.voters.filter((x) => typeof x === 'string'), agreed: v.agreed.filter((x) => typeof x === 'string'),
    remainingMs: Number.isFinite(v.remainingMs) && v.remainingMs > 0 ? v.remainingMs : 0,
  };
}

/**
 * What the strip offers this player (pure: the tests read it): `voter` / `agreed` (its own vote), `host` (may cancel),
 * the counts of the title, and each voter's name and state.
 * @param {any} room @param {any} myId
 */
export function versionVoteFacts(room, myId) {
  const vote = versionVoteOf(room);
  if (!vote) return null;
  const seats = Array.isArray(room?.seats) ? room.seats : [];
  return {
    vote,
    voter: vote.voters.includes(myId),
    agreed: vote.agreed.includes(myId),
    host: room?.hostId != null && room.hostId === myId,
    total: vote.voters.length,
    yes: vote.agreed.filter((id) => vote.voters.includes(id)).length,
    chips: vote.voters.map((id) => ({ id, name: seats.find((s) => s && s.playerId === id)?.name || t('博士'), agreed: vote.agreed.includes(id) })),
  };
}

/** Seconds left of a vote anchored at `deadline` (ms on this page's clock). */
export const secondsLeft = (deadline, now) => Math.max(0, Math.ceil((deadline - now) / 1000));

/**
 * The strip's markup (hook-free: the tests draw it): the title with the count, the countdown, the voters' chips, 同意切换 /
 * 拒绝切换 for a voter who has not agreed, 取消投票 for the host.
 * @param {{ facts: ReturnType<typeof versionVoteFacts>, seconds: number, busy?: boolean, online?: boolean, class?: string,
 *   onAgree: () => void, onDecline: () => void, onCancel: () => void }} props
 */
export function VersionVoteView({ facts, seconds, busy = false, online = true, class: cls = '', onAgree, onDecline, onCancel }) {
  if (!facts) return null;
  const { vote: v } = facts;
  return html`<section class=${`vervote ${cls}`} aria-label=${t('切换版本投票')} aria-live="polite" data-testid="version-vote">
    <div class="vervote__text">
      <strong>${t('切换到「{version}」投票：{agreed}/{total}', { version: versionLabel(v.version), agreed: facts.yes, total: facts.total })}</strong>
      <span class="vervote__time"><${Icon} name="hourglass" /><b class="num">${seconds}</b>s</span>
      <span class="vervote__hint t-lo">${t('全员同意后切换；切换后需要重新准备，结算记录会清除。')}</span>
      <div class="vervote__players">${facts.chips.map((c) => html`<span key=${c.id} class=${c.agreed ? 'is-agreed' : ''}>${c.name} · ${c.agreed ? t('已同意') : t('待同意')}</span>`)}</div>
    </div>
    <div class="vervote__actions">
      ${facts.voter && !facts.agreed ? html`<${Button} variant="primary" size="sm" loading=${busy} disabled=${!online} data-testid="version-agree" onClick=${onAgree}>${t('同意切换')}<//>
        <${Button} variant="danger" size="sm" disabled=${busy || !online} data-testid="version-decline" onClick=${onDecline}>${t('拒绝切换')}<//>` : null}
      ${facts.host ? html`<${Button} size="sm" disabled=${busy || !online} data-testid="version-cancel" onClick=${onCancel}>${t('取消投票')}<//>` : null}
    </div>
  </section>`;
}

/** The strip (see the header): nothing while no vote is open. One request at a time (like 重刷本局's). */
export function VersionVote({ room, class: cls = '' }) {
  const myId = useStore((s) => s.me.playerId);
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const facts = versionVoteFacts(room, myId);
  // the countdown, anchored when this room.state arrived
  const vote = room?.versionVote ?? null;
  const deadline = useMemo(() => (facts ? Date.now() + facts.vote.remainingMs : 0), [vote]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!facts) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [vote ? facts?.vote.id : null]);
  if (!facts) return null;
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } catch (err) { toastError(err); } finally { pending.current = false; setBusy(false); }
  };
  const id = facts.vote.id;
  return html`<${VersionVoteView} facts=${facts} seconds=${secondsLeft(deadline, now)} busy=${busy} online=${online} class=${cls}
    onAgree=${() => send(() => net.request('room.versionVote', { voteId: id, agree: true }))}
    onDecline=${() => send(() => net.request('room.versionVote', { voteId: id, agree: false }))}
    onCancel=${() => send(() => net.request('room.cancelVersionVote', { voteId: id }))} />`;
}
