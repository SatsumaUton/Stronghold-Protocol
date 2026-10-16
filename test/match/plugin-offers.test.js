// test/match/plugin-offers.test.js — the engine side of the plugin interaction windows (PLUGIN API v2, docs/PLUGINS.md
// §10b; server/match/match/offers.js): a window the content set declares opens before the round it names, waits on the
// match's own clock, settles on its quorum or its deadline, and applies exactly one declared effect primitive.
//
// The point of the whole part is that `when.rounds` is an expression over the round number: this suite declares the
// same window before R3 and before R9 — rounds the official schedule does not treat specially — and an `{ every: 2 }`
// window that covers even rounds only. No path here may special-case a round, so the assertions are written per round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { readOfferFile } from '../../shared/plugins/offers.js';

/** One normalized window, read through the real reader so the test's shape is the shipped shape. */
const window_ = (extra = {}, when = { at: ['prep'], rounds: [3, 9] }) => {
  const raw = {
    offer: 1, id: 'early-pick', when, windowSec: 30, quorum: 'all', onTimeout: 'auto', defer: [], slots: 3,
    refresh: { perSlot: 1 }, options: { source: 'lib/cards.json' }, apply: { funds: 3 }, ...extra,
  };
  const r = readOfferFile(raw, { pluginId: 'demo', rel: 'offers/early-pick.json' });
  assert.deepEqual(r.problems, []);
  return { pluginId: 'demo', ...r.offer };
};

/** A co-op match with two humans and one AI seat, carrying the windows `offers`. */
function matchWith(offers, extra = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 7, ...extra });
  h.m.offers = offers;
  return h;
}

const openWindow = (h, round) => () => Array.isArray(h.m.offerWin) && h.m.offerWin.length > 0 && h.m.round === round;
const humans = (h) => h.m.alivePlayers().filter((ps) => !ps.isBot);

/** Pick the first option for every human of the open window (the ids are the plugins' own). */
function pickAll(h, id, idx = 0) {
  const picked = [];
  for (const ps of humans(h)) {
    if (h.m.offerWin.length && !h.m.offerWin[0].picks.has(ps.playerId)) picked.push(ps);
    const before = ps.funds;
    h.m.requestOffer(ps, id, idx);
    assert.equal(ps.funds, before + 3, `the declared primitive applied to ${ps.playerId}`);
  }
  return picked;
}

test('a window declared before R3 and before R9 opens on exactly those rounds — no round is special', () => {
  const h = matchWith([window_()]);
  h.start();
  assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === 1), 'R1 reached');
  assert.equal(h.m.offerWin.length, 0, 'no window before R1');
  for (const round of [3, 9]) {
    assert.ok(h.run(openWindow(h, round)), `the window opens before R${round}`);
    assert.equal(h.m.offerWin[0].id, 'early-pick');
    assert.equal(h.m.offerWin[0].round, round);
    pickAll(h, 'early-pick', 1);
    assert.equal(h.m.offerWin.length, 0, 'the quorum is met: the window closed');
    assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === round), `R${round} prep runs after the window`);
  }
  h.m.dispose();
});

test('{ every: 2 } covers the even rounds and skips the odd ones', () => {
  const h = matchWith([window_({ id: 'every-two' }, { at: ['prep'], rounds: { every: 2 } })]);
  h.start();
  const openedOn = [];
  for (let round = 1; round <= 6; round++) {
    const opened = h.run(() => openWindow(h, round)() || (h.m.phase === PHASE.PREP && h.m.round === round));
    assert.ok(opened, `R${round} reached`);
    if (h.m.offerWin.length) {
      openedOn.push(round);
      pickAll(h, 'every-two', 0);
    }
  }
  assert.deepEqual(openedOn, [2, 4, 6]);
  h.m.dispose();
});

test('a deadline settles the window for the players who did not pick (the declared fallback)', () => {
  const h = matchWith([window_({ id: 'timed', windowSec: 5, quorum: 'all' })]);
  h.start();
  assert.ok(h.run(openWindow(h, 3)), 'the window opened');
  const seats = humans(h);
  const before = seats.map((ps) => ps.funds);
  // nobody picks: the window's own deadline decides for every seat, and the prep of the round then runs
  assert.ok(h.run(() => h.m.offerWin.length === 0 && h.m.phase === PHASE.PREP), 'the deadline closed the window and the prep ran');
  seats.forEach((ps, i) => assert.equal(ps.funds, before[i] + 3, 'the fallback applied to the seat that did not pick'));
  h.m.dispose();
});

test('windowSec 0 opens no window and holds nothing back (the safe default)', () => {
  const h = matchWith([window_({ id: 'loose', quorum: 'all', windowSec: 0 })]);
  h.start();
  assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === 3), 'R3 prep ran');
  assert.equal(h.m.offerWin.length, 0, 'nothing waits');
  assert.ok(h.m.offerSeq > 0, 'the declaration was still read and settled at once');
  h.m.dispose();
});

test('a refresh is bounded by the window\'s own declaration, and a second pick is refused', () => {
  const h = matchWith([window_({ id: 'refreshable', refresh: { perSlot: 1 } })]);
  h.start();
  assert.ok(h.run(openWindow(h, 3)), 'the window opened');
  const ps = humans(h)[0];
  assert.deepEqual(h.m.requestOfferRefresh(ps, 'refreshable', 0), { ok: true });
  assert.notDeepEqual(h.m.requestOfferRefresh(ps, 'refreshable', 0), { ok: true }, 'the declaration allows one redraw');
  assert.deepEqual(h.m.requestOffer(ps, 'refreshable', 2), { ok: true });
  assert.notDeepEqual(h.m.requestOffer(ps, 'refreshable', 0), { ok: true }, 'one pick per player');
  h.m.dispose();
});

test('the prep of the round holds until the window closes', () => {
  const h = matchWith([window_({ id: 'hold', quorum: 'all', windowSec: 30 })]);
  h.start();
  // watch every prep start: none of them may happen while a window is open
  const entered = [];
  const orig = h.m.enterPrep.bind(h.m);
  h.m.enterPrep = (...args) => { entered.push(h.m.offerWin.filter((w) => !w.closed).length); return orig(...args); };
  assert.ok(h.run(openWindow(h, 3)), 'the window opened');
  // the window is still waiting: only its own deadline can move the match on
  assert.ok(h.m.offerWin.length > 0, 'nothing but the picks closed it');
  assert.equal(entered.length, 2, 'R1 and R2 preps ran; R3 is held');
  pickAll(h, 'hold', 0);
  assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === 3), 'the prep runs once the window closed');
  assert.equal(entered.length, 3);
  assert.equal(entered[2], 0, 'the held prep saw no open window');
  h.m.dispose();
});

test('a match whose content set declares no window never builds one, and no new phase ever appears', () => {
  const h = matchWith([]);
  const known = new Set(Object.values(PHASE));
  const unusual = new Set();
  h.start();
  for (let i = 0; i < 60 && !h.m.ended; i++) {
    if (!known.has(h.m.phase)) unusual.add(h.m.phase);
    assert.equal(h.m.offerWin.length, 0, 'no window is ever open');
    h.run(() => h.m.ended != null || h.m.phase === PHASE.PREP, { maxSteps: 4000 });
    if (!known.has(h.m.phase)) unusual.add(h.m.phase);
  }
  assert.deepEqual([...unusual], [], 'every phase this match entered is a PHASE member of 0.3.0');
  assert.equal(h.m.offerSeq, 0, 'no window was ever built');
  h.m.dispose();
});

test('requestOffer / requestOfferRefresh are refused when no window of that id is open', () => {
  const h = matchWith([]);
  h.start();
  const ps = h.ps('p_0');
  for (const r of [h.m.requestOffer(ps, 'nope', 0), h.m.requestOfferRefresh(ps, 'nope', 0)]) {
    assert.equal(typeof r, 'object');
    assert.ok(r.error, 'a refusal is an { error } answer');
  }
  h.m.dispose();
});
