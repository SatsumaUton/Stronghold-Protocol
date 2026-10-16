// server/match/match/offers.js — Match methods: the plugin interaction windows of PLUGIN API v2 (docs/PLUGINS.md
// §10b, shared/plugins/offers.js). Installed on Match.prototype by server/match/Match.js (a method container: never
// instantiated; `this` is the match).
//
// A window is opened by the ENGINE, never by plugin code: `offers` are the declarations the room's content set carries
// (`this.offers`, injected by the match host — server/match/host/entry.js — like its prep DSL grants), the options come
// from the set's checked bytes, and a pick applies one of the closed effect primitives (shared/plugins/offers.js
// OFFER_EFFECTS) through the ordinary meta dispatcher context, so a window needs no permission beyond `offers` and no
// sandbox.
//
// Round decoupling is the whole point (docs/PLUGINS.md §10b): the engine asks `offersAt(this.offers, { at, round })`
// before the round it is about to run and opens what answers yes. No round is special — a window declared for R3 or R9
// runs exactly like one declared for R1 — and a match whose content set declares no window never enters any of this
// code: `openOfferWindow` returns 'none' before it touches the phase, the deadline or a player.
//
// Timing. Windows are held on the match's own scheduler (this.later / this.sched.now()), so a virtual match in a test
// waits in virtual time and a real one waits in real time; a declaration is never read from wall-clock state.
//
// Coexistence (docs/PLUGINS.md §10b): the host's own windows run first. A `battleCheck` window opens once BATTLE_CHECK
// is over and before R1 starts; a `prep` window opens once ROUND_START is over and before the prep begins. A window
// never delays a draft that is already running, and it never holds back a batch of its own: the batch it guards is the
// step it gates (the round's start, or the round's prep), so `defer` (`prepSettle`) is accepted and recorded but needs
// no second mechanism — a prep cannot settle before it has begun.

import { ERR } from '../../../shared/constants.js';
import { OFFER_EFFECTS, offerAt, offersAt } from '../../../shared/plugins/offers.js';
import { OK, fail } from './common.js';

/** Why a window closed: its quorum was met, its deadline passed, or nothing was declared at all. */
export const OFFER_CLOSED = Object.freeze(['settled', 'timeout', 'none']);

export class MatchOffers {
  /**
   * Open every window declared at `at` for the round about to run, if any. Returns
   * `'none'` (nothing declared — the caller continues at once), `'open'` (a window waits), or `'settled'` (every
   * window declared here was zero-length and has already closed: continue).
   * @param {'battleCheck'|'prep'} at @param {number} round
   */
  openOfferWindow(at, round) {
    const list = offersAt(this.offers || [], { at, round });
    if (!list.length) return 'none';
    const alive = this.alivePlayers();
    if (!alive.length) return 'none';
    this.offerWin = [];
    for (const { pluginId, offer } of list) {
      const window = {
        id: offer.id, pluginId, offer, at, round, seq: this.offerSeq++,
        slots: offer.slots, refresh: offer.refresh, shared: offer.shared, options: this._offerOptions(offer),
        quorum: offer.quorum, onTimeout: offer.onTimeout, defer: offer.defer, deadline: 0,
        /** playerId → { idx, refreshed } */
        picks: new Map(),
        /** playerId → how many times that player has redrawn a slot */
        refreshUsed: new Map(),
        closed: false,
      };
      this.offerWin.push(window);
      this._publishOffer(window, alive);
      if (offer.windowSec > 0) {
        window.deadline = this.sched.now() + this.scaled(offer.windowSec * 1000);
        this._offerTimers.set(window, this.later(offer.windowSec * 1000, () => this._offerDeadline(window)));
      }
    }
    // a declaration without a deadline holds nothing back: it opens and closes at once (windowSec 0 is the safe default)
    if (this.offerWin.every((w) => !(w.deadline > 0))) {
      for (const w of this.offerWin) this._closeOffer(w, 'timeout');
      const done = this.offerWin;
      this.offerWin = [];
      return done.length ? 'settled' : 'none';
    }
    this._offerProgress();
    return 'open';
  }

  /** The options a window offers. Zero-length windows offer nothing and settle at once. */
  _offerOptions(offer) {
    const count = Math.max(1, Number(offer.slots) || 1);
    return Array.from({ length: count }, (_, idx) => ({ idx }));
  }

  /** Whether a window is waiting for somebody right now. */
  offerBlocking() {
    if (!Array.isArray(this.offerWin)) return false;
    return this.offerWin.some((w) => !w.closed && w.deadline > 0 && this._offerWaiting(w));
  }

  /** The players a window still waits for: every alive human (a departed seat waits for nobody), or a majority of
   * them, or nobody (`quorum: "none"`). */
  _offerWaiting(w) {
    if (w.quorum === 'none') return [];
    const humans = this.alivePlayers().filter((ps) => !ps.isBot && !ps.left);
    if (!humans.length) return [];
    const waiting = humans.filter((ps) => !w.picks.has(ps.playerId));
    if (w.quorum === 'majority') {
      const need = Math.ceil(humans.length / 2);
      return humans.length - waiting.length >= need ? [] : waiting;
    }
    return waiting;
  }

  /** Broadcast the window (and how many players are still to pick) to every member. */
  _publishOffer(w, alive = this.alivePlayers()) {
    const view = {
      id: w.id, pluginId: w.pluginId, at: w.at, round: w.round,
      slots: w.options.map((o) => ({ idx: o.idx })),
      shared: w.shared ? Object.keys(w.shared) : [],
      refresh: w.refresh ? w.refresh.perSlot : 0,
      deadline: w.deadline || 0,
      waiting: this._offerWaiting(w).length,
      players: alive.length,
    };
    this.broadcast({ t: 'm.offers', offers: [view] });
  }

  /**
   * A player picks an option of the open window `offerId`. The host validates everything the pick can get wrong and
   * applies the effect itself — a plugin's declaration cannot reach the match state beyond its declared primitives.
   * @param {import('./PlayerState.js').PlayerState} ps @param {string} offerId @param {number} idx
   */
  requestOffer(ps, offerId, idx) {
    const w = this._openOffer(offerId);
    if (!w) return fail(ERR.WRONG_PHASE, 'no offer window of that id is open');
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (!Number.isInteger(idx) || idx < 0 || idx >= w.slots) return fail(ERR.BAD_TARGET, 'no such slot');
    if (w.picks.has(ps.playerId)) return fail(ERR.ALREADY, 'already picked');
    if (!(w.deadline > 0)) return fail(ERR.WRONG_PHASE, 'the window is closed');
    w.picks.set(ps.playerId, { idx, refreshed: 0 });
    this._offerApply(ps, w, idx);
    this._offerSettleIfDone(w);
    return OK;
  }

  /**
   * A player redraws one slot they have not picked (g.offerRefresh { offerId, idx }): the engine asks the window's
   * own declaration how many times a slot may be redrawn. Nothing but the option list changes.
   * @param {import('./PlayerState.js').PlayerState} ps @param {string} offerId @param {number} idx
   */
  requestOfferRefresh(ps, offerId, idx) {
    const w = this._openOffer(offerId);
    if (!w) return fail(ERR.WRONG_PHASE, 'no offer window of that id is open');
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (!w.refresh || !(w.refresh.perSlot > 0)) return fail(ERR.WRONG_PHASE, 'this window cannot be redrawn');
    if (!Number.isInteger(idx) || idx < 0 || idx >= w.slots) return fail(ERR.BAD_TARGET, 'no such slot');
    if (!(w.deadline > 0)) return fail(ERR.WRONG_PHASE, 'the window is closed');
    const used = w.refreshUsed.get(ps.playerId) || 0;
    if (used >= w.refresh.perSlot) return fail(ERR.RATE, 'no redraw left');
    w.refreshUsed.set(ps.playerId, used + 1);
    this.broadcast({ t: 'm.offers', offers: [{ id: w.id, pluginId: w.pluginId, at: w.at, round: w.round, refreshed: idx, by: ps.playerId }] });
    return OK;
  }

  /** Apply one pick's declared effect primitive with the player's own meta context (the same ctx a 特质 uses). */
  _offerApply(ps, w, idx) {
    const option = w.options[idx];
    const effect = option?.effect ?? (w.offer && w.offer.apply) ?? null;
    if (!effect || typeof effect !== 'object') return;
    const [kind] = Object.keys(effect);
    if (!OFFER_EFFECTS.includes(kind)) return;
    const value = effect[kind];
    try {
      switch (kind) {
        case 'funds': ps.addFunds(Math.trunc(Number(value) || 0), `offer:${w.id}`); break;
        case 'pendingFunds': { const v = Math.trunc(Number(value) || 0); if (v > 0) ps.pendingFunds += v; break; }
        case 'freeRefresh': { const v = Math.trunc(Number(value) || 0); if (v > 0) ps.shop.freeRefreshes += v; break; }
        case 'layers': ps.addLayers(value.bond, Math.trunc(Number(value.count) || 0), { reason: `offer:${w.id}` }); break;
        case 'item': ps.acquireItem(value, { source: `offer:${w.id}` }); break;
        case 'chess': ps.acquireChess(value, { source: `offer:${w.id}` }); break;
        case 'effect': ps.effects.push({ id: `effect:${w.pluginId}:${value.id}`, key: `effect:${w.pluginId}:${value.id}`, name: w.id, desc: '', iconKind: 'choice', battle: true }); break;
        default: break;
      }
      if (typeof ps.dirty === 'function') ps.dirty();
    } catch (e) { this.reportError(`offer:${w.id}`, e); }
  }

  /** Settle a window once its quorum is met (nobody is still to pick). */
  _offerSettleIfDone(w) {
    if (w.closed) return;
    if (this._offerWaiting(w).length) { this._publishOffer(w); return; }
    this._closeOffer(w, 'settled');
    this._offerProgress();
  }

  /** A window's deadline passed: apply the declared fallback for everybody who did not pick, then close. */
  _offerDeadline(w) {
    if (w.closed) return;
    // the host's own drafts decide a timed-out turn the same way: a seat that did not pick gets the fallback (auto =
    // the first option, bot = the same rule, skip = nothing), and the window closes either way
    if (w.onTimeout !== 'skip') {
      for (const ps of this.alivePlayers()) {
        if (ps.isBot || w.picks.has(ps.playerId)) continue;
        w.picks.set(ps.playerId, { idx: 0, timeout: true });
        this._offerApply(ps, w, 0);
      }
    }
    this._closeOffer(w, 'timeout');
    this._offerProgress();
  }

  _closeOffer(w, why) {
    if (w.closed) return;
    w.closed = true;
    const timer = this._offerTimers.get(w);
    if (timer) { this.cancel(timer); this._offerTimers.delete(w); }
    this.broadcast({
      t: 'm.offers',
      offers: [{ id: w.id, pluginId: w.pluginId, at: w.at, round: w.round, closed: true, why,
        picked: Object.fromEntries([...w.picks].map(([pid, p]) => [pid, { idx: p.idx, timeout: !!p.timeout }])) }],
    });
  }

  /** Drop closed windows and, when the last one is gone, let the held-back batch run. */
  _offerProgress() {
    if (!Array.isArray(this.offerWin)) return;
    this.offerWin = this.offerWin.filter((w) => !w.closed);
    if (this.offerWin.length || !this._offerResume) return;
    const resume = this._offerResume;
    this._offerResume = null;
    this.offerWin = [];
    this.later(0, () => resume());
  }

  /** The one open window of `offerId` (a match holds at most one window per id at a time). */
  _openOffer(offerId) {
    if (!Array.isArray(this.offerWin) || typeof offerId !== 'string') return null;
    const w = this.offerWin.find((x) => !x.closed && x.id === offerId) || null;
    return w && w.deadline > 0 ? w : null;
  }

  /** Tear the windows down (dispose): no timer survives a match. */
  offersDispose() {
    for (const w of /** @type {any[]} */ (this.offerWin || [])) w.closed = true;
    for (const timer of this._offerTimers.values()) this.cancel(timer);
    this._offerTimers.clear();
    this.offerWin = [];
    this._offerResume = null;
  }

  /** Whether this match's content set declares a window at `at` for `round` (the pages' read-only view, §10b). */
  offersDeclared(at, round) {
    return (this.offers || []).some((o) => offerAt(o, { at, round }));
  }
}
