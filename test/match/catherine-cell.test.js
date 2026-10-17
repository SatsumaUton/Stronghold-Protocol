// #677: maintainer decision 2026-10-17 (official play memory): one Cathy cell per player/match.
// Official activity_table aceffect_band_26: three choices, one pick, pool_equip_kathe; aceffect_band_41: Quintus R3 cell.
// [ASSUMED] Only a successful pick counts; Quintus's cell is independent. Seed 236 offers a cell on both first upgrades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { replayTestMatch } from '../../server/match/testReplay.js';
import { botPrepBeginSteps } from '../../server/match/bot.js';

const CELL = 'chess_item_5_08_e_a';
const OK = { ok: true };
const idsOf = (offer) => offer.slots.map((s) => s.id);
const cellIndex = (offer) => offer.slots.findIndex((s) => s.id === CELL);
const cellsOwned = (ps) => [...ps.hand, ...ps.temp].filter((p) => p?.id === CELL).length;

function fixture(t, seed = 236) {
  const h = makeMatch({ mode: 'solo', seed, fake: true }).start().toPrep(1, { band: 'band_cathy' });
  t.after(() => h.m.dispose());
  const ps = h.ps('p_0');
  ps.funds = 999;
  const upgrade = () => {
    assert.deepEqual(ps.levelUp(), OK);
    const offer = ps.offers.at(-1);
    assert.ok(offer);
    assert.equal(offer.slots.length, 3);
    assert.equal(new Set(idsOf(offer)).size, 3);
    return offer;
  };
  const pickCell = () => {
    const idx = cellIndex(ps.offers[0]);
    assert.ok(idx >= 0, 'the seeded offer includes a cell');
    assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.reward', idx }), OK);
  };
  return { ...h, ps, upgrade, pickCell };
}

test('Cathy: after taking a cell, later upgrades exclude it even after destruction, reconnect and a new round', (t) => {
  const h = fixture(t);
  h.upgrade(); h.pickCell();
  assert.equal(cellsOwned(h.ps), 1);
  assert.ok(!idsOf(h.upgrade()).includes(CELL), 'the second seeded offer used to repeat the cell');
  const cell = h.ps.hand.find((p) => p?.id === CELL);
  assert.deepEqual(h.ps.destroy(cell.uid), OK);
  h.m.onDisconnect('p_0'); h.m.onReconnect('p_0');
  h.m.round = 2; h.ps.startRound(2);
  for (let level = 4; level <= 6; level++) assert.ok(!idsOf(h.upgrade()).includes(CELL));
  h.m.onReconnect('p_0');
  assert.ok(!idsOf(h.lastTo('p_0', 'm.private').shop.rewardOffer).includes(CELL));
});

test('Cathy: showing a cell without taking it leaves it eligible on the next upgrade [ASSUMED]', (t) => {
  const h = fixture(t);
  const offer = h.upgrade();
  assert.ok(idsOf(offer).includes(CELL));
  const idx = offer.slots.findIndex((s) => s.id !== CELL);
  assert.deepEqual(h.m.handle('p_0', { t: 'g.reward', idx }), OK);
  assert.ok(idsOf(h.upgrade()).includes(CELL), 'declining the first cell does not use the allowance');
  h.pickCell();
  assert.equal(cellsOwned(h.ps), 1);
});

test('Cathy: a refused full-hand pick does not use the allowance', (t) => {
  const h = fixture(t);
  h.upgrade();
  const hand = h.ps.hand.slice();
  h.ps.hand = h.ps.hand.map(() => h.ps.newPiece('item', CELL));
  const idx = cellIndex(h.ps.offers[0]);
  assert.equal(h.m.handle('p_0', { t: 'g.reward', idx }).error, 'HAND_FULL');
  h.ps.hand = hand;
  assert.ok(idsOf(h.upgrade()).includes(CELL), 'the failed pick leaves the next cell eligible');
  h.pickCell();
  assert.ok(h.ps.offers.every((o) => !idsOf(o).includes(CELL)));
});

test('Cathy: taking a cell removes it from queued Cathy offers and preserves other sources [ASSUMED]', (t) => {
  const h = fixture(t);
  h.upgrade();
  const pending = h.upgrade();
  assert.ok(idsOf(pending).includes(CELL));
  const otherIds = idsOf(pending).filter((id) => id !== CELL);
  h.ps.pushItemOffer([CELL], { source: 'other' });
  h.pickCell();
  assert.deepEqual(idsOf(h.ps.offers[0]), otherIds, 'the other queued choices are retained without rerolling');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.reward', idx: 0 }), OK);
  assert.deepEqual(idsOf(h.ps.offers[0]), [CELL], 'the limit belongs only to Cathy');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.reward', idx: 0 }), OK);
  assert.equal(cellsOwned(h.ps), 2);
});

for (const quintusFirst of [true, false]) test(`Quintus's R3 grant stays independent ${quintusFirst ? 'before' : 'after'} Cathy's cell [ASSUMED]`, (t) => {
  const h = fixture(t);
  const quintus = () => {
    h.ps.bandId = 'band_quintus'; h.m.round = 3;
    h.m.dispatch(h.ps, 'onRoundStart', { round: 3 });
    h.ps.bandId = 'band_cathy';
  };
  if (quintusFirst) { quintus(); assert.equal(cellsOwned(h.ps), 1); }
  h.upgrade(); h.pickCell();
  if (!quintusFirst) quintus();
  assert.equal(cellsOwned(h.ps), 2, 'one cell from each source');
  assert.ok(!idsOf(h.upgrade()).includes(CELL), "only Cathy's successful pick uses her allowance");
});

test('the bot reward routine uses the same Cathy allowance', (t) => {
  const h = fixture(t, 36); // Cell (tier V), tier IV, tier II: the bot prefers the cell.
  h.ps.isBot = true;
  h.upgrade();
  const steps = botPrepBeginSteps(h.m, h.ps);
  steps.next(); steps.return(); // First step resolves offers through the real bot routine.
  assert.equal(cellsOwned(h.ps), 1);
  for (let level = 3; level <= 6; level++) assert.ok(!idsOf(h.upgrade()).includes(CELL));
});

test('the Cathy allowance belongs to the player, even when the cell is the only available item', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 236, fake: true }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const a = h.ps('p_0'), b = h.ps('p_1');
  a.bandId = 'band_cathy'; a.funds = 999;
  h.m.itemPool.canGain = (id) => id === CELL;
  assert.deepEqual(a.levelUp(), OK);
  assert.deepEqual(a.pickReward(0), OK);
  a.bandId = 'band_bldsk'; b.bandId = 'band_cathy'; b.funds = 999;
  assert.deepEqual(b.levelUp(), OK);
  assert.deepEqual(idsOf(b.offers[0]), [CELL], 'the other player still has an allowance');
  assert.deepEqual(b.pickReward(0), OK);
  assert.deepEqual(b.levelUp(), OK);
  assert.equal(b.offers.length, 0, 'a cell-only pool cannot bypass the limit or create an empty offer');
});

test('test-console upgrades, strategy switches and reconnect replay the same source-specific allowance', (t) => {
  const entries = [];
  const scheduler = new VirtualScheduler();
  const m = new Match({ mode: 'solo', difficulty: 'NORMAL', test: true, hostId: 'p', seed: 236,
    seats: [{ playerId: 'p', seat: 0, name: 'P', connected: true }], data: DATA, scheduler,
    send() {}, broadcast() {}, onEnd() {}, clientCombat: false, botRehearsal: 0,
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } },
  });
  t.after(() => m.dispose());
  const cmd = (cmd, args = {}) => assert.deepEqual(m.handle('p', { t: 'g.test', cmd, args }), OK);
  m.start();
  assert.deepEqual(m.handle('p', { t: 'g.infoReady' }), OK);
  assert.ok(scheduler.runUntil(() => m.phase === 'BAND_DRAFT'));
  assert.deepEqual(m.handle('p', { t: 'g.band', bandId: 'band_cathy' }), OK);
  assert.ok(scheduler.runUntil(() => m.phase === 'PREP'));
  cmd('funds', { amount: 999 }); cmd('level');
  const ps = m.players.get('p');
  const idx = cellIndex(ps.offers[0]);
  assert.ok(idx >= 0);
  assert.deepEqual(m.handle('p', { t: 'g.reward', idx }), OK);
  cmd('strategy', { id: 'band_quintus' }); cmd('strategy', { id: 'band_cathy' });
  m.onDisconnect('p'); m.onReconnect('p');
  cmd('level');
  assert.ok(!idsOf(ps.offers[0]).includes(CELL));
  const copy = replayTestMatch(DATA, entries);
  t.after(() => copy.dispose());
  assert.deepEqual(copy.players.get('p').counters, ps.counters);
  assert.deepEqual(copy.players.get('p').privateView(), ps.privateView());
  assert.deepEqual(copy.testLog, m.testLog);
});
