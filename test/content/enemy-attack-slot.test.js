// test/content/enemy-attack-slot.test.js — the attack-class skills of the non-leader enemies and bounty leaders take the
// attack's turn (DESIGN §35.34, after §35.29's boss leaders and parts). Official: each skill's prefab ability is a
// MeleeAttack / RangedAttack / Multi*Attack (fx/index.json units.<key>.skills, from the client's battle/enm_pfb_*.ab);
// PRTS's skill rules 「大多数技能自动触发会占用攻击间隔」, 「同一技能的冷却时间于该技能结束时开始计时」. Until 0.3.2 they ran
// on their own timers on top of the attacks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { ENEMY_ATTACK_SKILL_CLIP, attackSkillOf } from '../../server/sim/content/enemies/helpers.js';
import { ATTACK_SKILL_CLIP } from '../../server/sim/content/bosses.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const A = JSON.parse(fs.readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
const FX = (() => { try { return JSON.parse(fs.readFileSync(new URL('../../public/assets/local/fx/index.json', import.meta.url), 'utf8')); } catch { return null; } })();
const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });
const ATTACK_CLASS = /^(Multi)?(Melee|Ranged)Attack/;

function field(units) {
  const chess = { t_wall: WALL('t_wall'), t_wall2: WALL('t_wall2'), t_wall3: WALL('t_wall3') };
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 900, kind: 'normal',
    sharedBoss: { hp: 1e9, maxHp: 1e9, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } },
    defs: { chess }, kits: { t_wall: NOATK, t_wall2: NOATK, t_wall3: NOATK }, enemies: [], units,
  });
  h.step();
  return h;
}
const put = (h, key, pos) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: 0 } });
const abilityOf = (e, prefabKey) => { const sk = e.mem.ab.sk[prefabKey]; return e.mem.ab.list.find((a) => a && a.sk === sk); };
/** 节日爵士乐手's channel carries no `sk` (no cast event): its one cooldown ability. */
const skillAbility = (e, key, prefabKey) => abilityOf(e, prefabKey) || (key === 'enemy_10034_cnvsax' ? e.mem.ab.list.find((a) => a && a.fire && a.cd != null) : null);

test('ENEMY_ATTACK_SKILL_CLIP: the clip of each attack-class skill\'s official ability (data/assets.json; fx index when extracted)', () => {
  for (const [key, skills] of Object.entries(ENEMY_ATTACK_SKILL_CLIP)) {
    assert.ok(!ATTACK_SKILL_CLIP[key], `${key}: not one of the boss records' leaders and parts (bosses.js)`);
    const anims = A.enemies[key]?.spine?.animations || {};
    for (const [p, len] of Object.entries(skills)) {
      assert.ok(E[key].skills.some((s) => s.prefabKey === p), `${key} ${p}: a data skill`);
      assert.ok(Number.isFinite(len) && len >= 0);
      if (!FX) continue;
      const sk = FX.units[key].skills[p.toLowerCase()];
      const abilities = sk.abilities || [];
      assert.ok(ATTACK_CLASS.test(sk.rootAbility) || (/Group$/.test(sk.rootAbility) && abilities.some((x) => ATTACK_CLASS.test(x.class))),
        `${key} ${p}: an attack-class ability (${sk.rootAbility})`);
      const animKey = abilities.map((x) => x.animKey).find(Boolean);
      if (!animKey) assert.equal(len, 0, `${key} ${p}: no clip in the prefab`);
      else assert.equal(anims[animKey], len, `${key} ${p}: ${animKey}`);
    }
  }
});

test('each listed skill is built as an attack-class ability with its clip; only 腐败骑士\'s charge waits for a swing', () => {
  for (const [key, skills] of Object.entries(ENEMY_ATTACK_SKILL_CLIP)) {
    const h = field([]);
    const e = put(h, key, [9, 8]);
    for (const [p, len] of Object.entries(skills)) {
      const a = skillAbility(e, key, p);
      assert.ok(a, `${key} ${p}: an ability`);
      assert.equal(a.atk, true, `${key} ${p}: atk`);
      assert.equal(a.clip, len, `${key} ${p}: clip`);
      assert.equal(a.own, !(key === 'enemy_1513_dekght' && p === 'ChargeAttack'), `${key} ${p}: own trigger`);
    }
  }
  assert.deepEqual(attackSkillOf('enemy_1504_cqbw', 'nothing'), {});
});

test('no other kit casts an attack-class official ability on its own timer (fx index when extracted)', { skip: !FX && 'no extracted fx index' }, () => {
  // not attack turns: 暴鸰's one bomb is its attack (no normal attack), “帝国的甲胄” MultiCombat arms its next attack,
  // “巨大的丑东西”'s bomb is its 重生's (cooldown 9999)
  const KEEP = new Set(['enemy_1040_bombd boomb', 'enemy_10027_vtsk MultiCombat', 'enemy_1512_mcmstr bomb[reborning]']);
  const left = [];
  for (const key of Object.keys(enemiesMod.KITS)) {
    if (!E[key] || !FX.units[key]) continue;
    const h = field([]);
    const e = put(h, key, [9, 8]);
    if (!e || !e.mem.ab) continue;
    for (const [p, sk] of Object.entries(e.mem.ab.sk || {})) {
      const a = e.mem.ab.list.find((x) => x && x.sk === sk);
      const f = FX.units[key].skills[p.toLowerCase()];
      if (!a || a.atk || a.cd == null || !f || KEEP.has(`${key} ${p}`)) continue;
      if (ATTACK_CLASS.test(f.rootAbility) || (/Group$/.test(f.rootAbility) && (f.abilities || []).some((x) => ATTACK_CLASS.test(x.class)))) left.push(`${key} ${p}`);
    }
  }
  assert.deepEqual(left, []);
});

/** Every action of `e` over `secs` game s: { t, what } — a cast of skill `p` or 'ATTACK'. */
function actions(h, e, a, secs) {
  const out = [];
  let n = a.casts ?? 0, attacks = e.stats.attacks;
  const end = h.b.time + secs;
  while (h.b.time < end - 1e-9 && e.alive) {
    h.step();
    if ((a.casts ?? 0) > n) { out.push({ t: h.b.time, what: 'skill' }); n = a.casts; }
    if (e.stats.attacks > attacks) { out.push({ t: h.b.time, what: 'ATTACK' }); attacks = e.stats.attacks; }
  }
  return out;
}
const oneActionPerTurn = (log, iv, label) => {
  for (let i = 1; i < log.length; i++) assert.ok(log[i].t - log[i - 1].t >= iv - 1e-6, `${label}: ${log[i - 1].what} then ${log[i].what} ${(log[i].t - log[i - 1].t).toFixed(3)} s apart`);
};

test('W 【C4】 and 凋零骑士 【爆炸箭】 take an attack\'s turn — one action per interval, ready again its cooldown + clip after', () => {
  for (const [key, p] of [['enemy_1504_cqbw', 'C4'], ['enemy_1513_dekght_2', 'TripleAttack']]) {
    const h = field([{ chessId: 't_wall', row: 9, col: 6 }]);
    const e = put(h, key, [9, 7]);
    const a = abilityOf(e, p);
    const s = E[key].skills.find((x) => x.prefabKey === p);
    const log = actions(h, e, a, s.initCooldown + 3 * (s.cooldown + a.clip) + 3 * e.s.interval);
    const casts = log.filter((x) => x.what === 'skill');
    assert.ok(casts.length >= 2 && log.some((x) => x.what === 'ATTACK'), `${key}: ${casts.length} casts`);
    assert.ok(casts[0].t >= s.initCooldown - 1e-6, `${key}: not before its initial cooldown`);
    oneActionPerTurn(log, e.s.interval, key);
    for (let i = 1; i < casts.length; i++) assert.ok(casts[i].t - casts[i - 1].t >= s.cooldown + a.clip - 1e-6, `${key}: cooldown from the clip's end`);
  }
});

test('鼠王: 【唱沙】 / 【沙狱】 with no target in its attack range still take the ready attack\'s turn (their own selectors)', () => {
  const h = field([{ chessId: 't_wall', row: 9, col: 2 }]);
  const e = put(h, 'enemy_1509_mousek', [12, 9]);   // 7.6 tiles away, range 2.5
  const ds = abilityOf(e, 'DriftSand'), ss = abilityOf(e, 'SandStorm');
  h.run(60);
  assert.equal(e.stats.attacks, 0, 'nothing in its attack range');
  assert.ok((ds.casts ?? 0) >= 1 && (ss.casts ?? 0) >= 1, `唱沙 ${ds.casts}, 沙狱 ${ss.casts}`);
  // a cast spends the attack's turn: the cooldown restarts as after a strike
  const n = ds.casts;
  while (ds.casts === n && h.b.time < 200) h.step();
  assert.ok(Math.abs(e.atkCd - e.s.interval) < 1e-9);
});
