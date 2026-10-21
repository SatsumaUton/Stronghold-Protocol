// test/content/boss-quintus-attack-slot.test.js — 盐风主教昆图斯's 【大潮】 / 【崩坍】 take the place of a normal attack
// (DESIGN §35.19; the maintainer's recordings of 2026-10-22, 「BOSS反复释放同一技能」).
//
// Official: both skills are attack-class — the prefab ability of `tidewater*` / `rockfall*` is a MeleeAttack, the same
// class as the boss's own Attack, and PRTS 盐风主教昆图斯 says of both 「触发索敌和普通攻击相同」. In the third form 【大潮】's
// cooldown (3.5, initial 1 — enemy_database / act1autochess_h07_04 overrides) equals the attack interval (3.5), and the
// boss alternates: arknights.wiki.gg (Sal Viento Bishop Quintus) — it never uses Great Tide twice in a row, always an
// attack or another ability between. Until this fix the tide ran on its own 3.5 s timer next to the normal attack:
// a tide every 3.5 s **and** an attack every 3.5 s, tides back to back, and a tide with no operator to attack.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
const KEY = 'enemy_1521_dslily';
const TPL = 'act1autochess_h07_04';
const WALL = (id, def) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });

/** A pair boss field of 昆图斯 with the level's overrides, `units` walls on the board; the leader at [3, 10]. */
function quintus(units) {
  const chess = { t_wall: WALL('t_wall', 300), t_wall2: WALL('t_wall2', 200), t_wall3: WALL('t_wall3', 0) };
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 600, kind: 'boss',
    sharedBoss: { hp: 1e6, maxHp: 1e6, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } },
    defs: { chess }, kits: { t_wall: NOATK, t_wall2: NOATK, t_wall3: NOATK }, enemies: [], units,
    setup(b) { b.opts.templateId = TPL; b.enemyOverrides = JSON.parse(JSON.stringify(W[TPL].overrides)); },
  });
  h.step();
  const e = h.spawn(KEY, { pos: [3, 10], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  return { h, e };
}

/** Into the third form (lost ≥ 2 × 33 %: the first form, then the second, on the 0.25 s ability tick). */
function thirdForm(h) {
  h.b.sharedBoss.hp = h.b.sharedBoss.maxHp * 0.3;
  h.run(1);
}

/** Every leader action over `secs` game s, in order: { t, what } — a skill cast (its prefabKey) or 'ATTACK'. */
function actions(h, e, secs) {
  const out = [];
  const keyOf = (slot) => (E[KEY].skills[slot] || {}).prefabKey;
  let seen = h.events.length, attacks = e.stats.attacks;
  const end = h.b.time + secs;
  while (h.b.time < end - 1e-9) {
    h.step();
    for (; seen < h.events.length; seen++) {
      const ev = h.events[seen];
      if (ev[0] === 'cast' && ev[1] === e.id) out.push({ t: h.b.time, what: keyOf(ev[2]) });
    }
    if (e.stats.attacks > attacks) { for (let k = attacks; k < e.stats.attacks; k++) out.push({ t: h.b.time, what: 'ATTACK' }); attacks = e.stats.attacks; }
  }
  return out;
}

test('昆图斯 third form: 【大潮】 takes an attack slot — never twice in a row, one action per attack interval', () => {
  const { h, e } = quintus([{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 11, col: 9 }, { chessId: 't_wall3', row: 12, col: 4 }]);
  thirdForm(h);
  const iv = e.s.interval;
  assert.equal(iv, E[KEY].stats.bat, 'attack interval = baseAttackTime');
  const tide = W[TPL].overrides[KEY].skills.find((s) => s.prefabKey === 'TidewaterG2');
  assert.equal(tide.cooldown, iv, 'the level data: the third-form tide cooldown equals the attack interval');
  const log = actions(h, e, 70);
  const tides = log.filter((a) => a.what === 'TidewaterG2');
  const attacks = log.filter((a) => a.what === 'ATTACK');
  assert.ok(tides.length >= 8 && attacks.length >= 8, `tides ${tides.length}, attacks ${attacks.length}`);
  // never two tides in a row: an attack or another skill between every two
  for (let i = 1; i < log.length; i++) assert.ok(!(log[i].what === 'TidewaterG2' && log[i - 1].what === 'TidewaterG2'), `two tides in a row at ${log[i].t.toFixed(3)}`);
  // so a tide every other attack slot at most: ≥ 2 attack intervals apart (until the fix: every 3.5 s)
  for (let i = 1; i < tides.length; i++) assert.ok(tides[i].t - tides[i - 1].t >= 2 * iv - 1e-6, `tide gap ${(tides[i].t - tides[i - 1].t).toFixed(3)} at ${tides[i].t.toFixed(3)}`);
  // one action per slot: the tide, 崩坍 and the normal attack share the attack's turn (断裂生殖 / 物种爆发 keep their own timers)
  const slot = log.filter((a) => a.what === 'ATTACK' || /^(Tidewater|Rockfall)/.test(a.what));
  for (let i = 1; i < slot.length; i++) assert.ok(slot[i].t - slot[i - 1].t >= iv - 1e-6, `${slot[i - 1].what} then ${slot[i].what} ${(slot[i].t - slot[i - 1].t).toFixed(3)} s apart`);
  // the tide still hits the whole field (the operator outside the attack's two targets too)
  assert.ok(h.unit('t_wall3').stats.taken > 0, 'global tide');
});

test('昆图斯: no attack target, no 【大潮】 (PRTS 「触发索敌和普通攻击相同」)', () => {
  const { h, e } = quintus([]);
  thirdForm(h);
  const log = actions(h, e, 20);
  assert.equal(log.filter((a) => a.what === 'ATTACK').length, 0);
  assert.deepEqual(log.filter((a) => /^(Tidewater|Rockfall)/.test(a.what)), [], 'no attack-class skill without a target');
});

test('昆图斯 first form: 崩坍 and 大潮 come at the first attack slot after their initial cooldown', () => {
  const { h, e } = quintus([{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 11, col: 9 }]);
  const log = actions(h, e, 60);
  const iv = e.s.interval;
  const at = (p) => (log.find((a) => a.what === p) || {}).t;
  const sk = (p) => W[TPL].overrides[KEY].skills.find((s) => s.prefabKey === p);
  for (const p of ['Rockfall', 'Tidewater']) {
    const t = at(p);
    assert.ok(t != null, `${p} cast`);
    assert.ok(t >= sk(p).initCooldown - 1e-6 && t <= sk(p).initCooldown + iv + 1e-6, `${p} at ${t} (initial cooldown ${sk(p).initCooldown})`);
  }
  // 断裂生殖 is not attack-class (AnimatedActionToOwnerAbility; PRTS 「仅仍有未执行的小队动作指令时可触发」): its own timer
  const tent = at('SummonTentac');
  assert.ok(tent != null && Math.abs(tent - sk('SummonTentac').initCooldown) <= 0.3, `SummonTentac at ${tent}`);
});
