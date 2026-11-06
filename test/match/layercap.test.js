// Bond layer cap (user report after playtest #6, DESIGN §20.10 / §20.12): a bond holds at most BOND_LAYER_CAP — 999, the
// client's AutoChessBattleConst.MAX_GARRISON_STACK (research 11 §1; the community also never names a count above 999:
// 巴哈姆特 12534 "每把都能999层", 12316 "999謝"). v2.5 had no cap, so per-layer bonuses kept growing past anything the
// official game reaches. Prep-side gains (PlayerState.addLayers: items, choices, bands, garrisons) and the IN_BATTLE gains
// merged at settlement both stop there (shared/constants.js layerGainRoom, the one implementation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';

test('prep-side layer gains stop at 999; a gain at the cap adds nothing and fires no onLayers', () => {
  assert.equal(BOND_LAYER_CAP, 999);
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  const seen = [];
  reg.global('watch', { onLayers: (ctx, ev) => { seen.push([ev.bondId, ev.from, ev.to]); } });
  const h = makeMatch({ mode: 'solo', seed: 81, registry: reg, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.layers.yanShip = 990;
  assert.equal(ps.addLayers('yanShip', 20, { reason: 'test' }), 9, 'only the room left under the cap');
  assert.equal(ps.layers.yanShip, 999);
  assert.equal(ps.addLayers('yanShip', 5, { reason: 'test' }), 0, 'at the cap: nothing');
  assert.equal(ps.layers.yanShip, 999);
  assert.deepEqual(seen, [['yanShip', 990, 999]], 'one onLayers, with the clamped value');
  assert.equal(ps.addLayers('sargonShip', 40, { reason: 'test' }), 40, 'other bonds unaffected');
  checkInvariants(h.m);
  h.m.dispose();
});

test('IN_BATTLE gains merged at settlement stop at 999 too; below the cap they apply in full', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 82, fake: true,
    script: (b) => (b.round === 1 ? { layerGains: { p_0: { yanShip: 50 }, p_1: { yanShip: 50 } } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const [a, b] = [h.ps('p_0'), h.ps('p_1')];
  a.layers.yanShip = 980;
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(a.layers.yanShip, 999, '980 + 50 stops at 999');
  assert.equal(b.layers.yanShip, 50);
  checkInvariants(m);
  m.dispose();
});

// 维护者 2026-11-07：深渊回响里「战斗叠层」在盟约到达 999 层以后必须继续生效
// （layerCapOff 会把上限抬到 BOND_LAYER_SAFE_MAX，战斗 spec 的 flags 也带着它）。
test('深渊回响（layerCapOff）：盟约 999 层以后战斗叠层继续生效；普通房仍然停在 999', () => {
  const dive = makeMatch({
    mode: 'coop', humans: 2, seed: 83, fake: true, variant: 'deepecho',
    script: (b) => (b.round === 1 ? { layerGains: { p_0: { yanShip: 50 } } } : {}),
  }).start();
  const m = dive.m;
  try {
    dive.toPrep(1);
    const a = dive.ps('p_0');
    a.layers.yanShip = 999;
    assert.equal(m.layerCapOff, true, '深潜解除层数上限');
    assert.equal(m._ruleFlags().layerCapOff, true, '战斗 spec 也带这个 flag（客户端复算同一份）');
    dive.drive(() => m.phase === PHASE.SETTLE);
    assert.equal(a.layers.yanShip, 1049, '999 + 50：深潜里继续叠，不再停在 999');
    checkInvariants(m);
  } finally { m.dispose(); }
});
// sim 里的「战斗中叠层」本体（Battle.addLayers）：同一份 999 层、同一个 +10，
// 普通房被钳住、深渊回响（spec flag layerCapOff）继续加。
test('Battle.addLayers：999 层时普通房加 0，深渊回响 +10（spec flag layerCapOff）', async () => {
  const { createBattleFromSpec } = await import('../../server/sim/spec.js');
  const run = (variant) => {
    const h = makeMatch({ mode: 'coop', humans: 1, seed: 7, instant: false, ...(variant ? { variant } : {}) });
    const m = h.m;
    try {
      m.start();
      if (variant) { m.round = 19; m.startRound(20); }
      const ps = h.ps('p_0');
      const opts = m._normalOpts(ps);
      const spec = { ...opts, players: opts.players.map((p) => ({ ...p, bonds: { ...(p.bonds || {}), yanShip: { layers: 999, active: true, count: 1 } } })) };
      const b = createBattleFromSpec(spec, m.ds, { quiet: true, recordEvents: false });
      const added = b.addLayers('p_0', 'yanShip', 10, 'test');
      return { added, layers: b.getPlayer('p_0').bonds.yanShip.layers, capOff: b.flags.layerCapOff === true };
    } finally { m.dispose(); }
  };
  const plain = run(null);
  assert.deepEqual(plain, { added: 0, layers: 999, capOff: false }, '普通房：999 就是上限');
  const dive = run('deepecho');
  assert.deepEqual(dive, { added: 10, layers: 1009, capOff: true }, '深渊回响：继续叠');
});