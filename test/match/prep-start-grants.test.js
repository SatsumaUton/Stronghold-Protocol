// GitHub #851: 老鲤 【得闲饮茶】 「第3回合进入休整期时，获得2、4阶随机干员各1名」 — the 「进入休整期时」 grants run at the prep start
// (onPrepStart), after the round's 机变 phase (research 01 §4.1 steps 4 and 6), not at the round start before the
// draft opens. server/sim/content/bands/meta.js header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

const REG = createRegistry({ log: { warn() {}, error() {}, info() {} } });

function lmleeMatch(mode, seed = 5) {
  const h = makeMatch({ mode, difficulty: 'NORMAL', humans: 1, bots: mode === 'coop' ? 1 : 0, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.bandId = 'band_lmlee'; // the draft offers a seat a few bands only; the handler is looked up by bandId at dispatch
  const grants = [];
  const orig = ps.acquireChess.bind(ps);
  ps.acquireChess = (id, o = {}) => { const p = orig(id, o); if (p && /band/.test(String(o.source || ''))) grants.push([h.m.phase, h.m.round, DATA.chess[id].tier]); return p; };
  return { h, m: h.m, ps, grants };
}

test('#851 同盟 NORMAL: 老鲤\'s R3 operators come at the R3 prep start, after the 机变 draft — none at ROUND_START / SP_DRAFT', () => {
  const { h, m, grants } = lmleeMatch('coop');
  assert.ok(m.gd.spRounds().includes(3), 'R3 is a 机变 round in 同盟 NORMAL');
  assert.ok(h.drive(() => m.phase === 'ROUND_START' && m.round === 3));
  assert.deepEqual(grants, [], 'nothing at the R3 round start');
  assert.ok(h.drive(() => m.phase === 'SP_DRAFT' && m.round === 3, { ready: true }));
  assert.deepEqual(grants, [], 'nothing while the R3 draft is open');
  h.toPrep(3);
  assert.deepEqual(grants.map(([ph, r]) => `${ph} R${r}`), ['PREP R3', 'PREP R3']);
  assert.deepEqual(grants.map(([, , t]) => t).sort(), [2, 4]);
  h.toPrep(4);
  assert.equal(grants.length, 2, 'once');
  m.dispose();
});

test('#851 single NORMAL (R3 not a 机变 round): 老鲤 still grants at the R3 prep start', () => {
  const { h, m, grants } = lmleeMatch('solo');
  assert.ok(!m.gd.spRounds().includes(3));
  h.toPrep(3);
  assert.deepEqual(grants.map(([ph, r, t]) => `${ph} R${r} T${t}`).sort(), ['PREP R3 T2', 'PREP R3 T4']);
  m.dispose();
});
