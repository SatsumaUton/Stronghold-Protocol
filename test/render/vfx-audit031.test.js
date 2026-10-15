// test/render/vfx-audit031.test.js — 0.3.1's fixes of the 0.3.0 effects audit's low findings (history 0.3.1, DESIGN
// §33.16 / §33.6) on a synthetic index and a fake effects layer: a token's skill record from its owners' variants (R18:
// 诅咒娃娃's aura), the 狼群's buff-bound cast rows (R19), an ability action's target effect on the unit a kit fx names
// (R20: 归溟幽灵鲨 S1), a skill's own start effect replacing the deploy effect (R21: 缄默德克萨斯, 斯卡蒂 S2).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { skillRecordOf, tokenSkillRecord, planFor, resolveSkill } from '../../public/js/render/vfx/skills.js';

const KEYS = ['doll_aura', 'sea_aura_1', 'sea_aura_3', 'g_hit', 'g_heal', 'g_enemy', 'g_birth'];
const LOOPING = new Set(['doll_aura', 'sea_aura_1', 'sea_aura_3']);
const aura = (k) => ({ role: 'loop', keys: [k], from: 'AuraAbility._effects', node: 'Aura' });

function makeIndex() {
  const prefabs = Object.fromEntries(KEYS.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k), spawn: 5 }]));
  const tok = (skills) => ({ kind: 'token', rootClass: 'Trap', modes: [{ name: 'Default', attack: { class: 'MeleeAttack' } }], skills, startEffect: null, deadEffect: null });
  return {
    units: {
      // 诅咒娃娃: an AppearSkill whose aura loops (sktok_vodfox_token)
      token_1_doll: tok({ sktok_doll: { rootClass: 'AppearSkill', rootAbility: 'ActiveAbilityWrapper', projectiles: [], mode: null, uses: [aura('doll_aura')] } }),
      // 斯卡蒂的海嗣: one skill per owner skill (sktok_skadi2_1 / _3)
      token_2_sea: tok({
        sktok_sea_1: { rootClass: 'CastSkill', rootAbility: 'ActiveAbilityWrapper', projectiles: [], mode: null, uses: [aura('sea_aura_1')] },
        sktok_sea_3: { rootClass: 'CastSkill', rootAbility: 'ActiveAbilityWrapper', projectiles: [], mode: null, uses: [aura('sea_aura_3')] },
      }),
    },
    skills: {}, projectiles: {}, skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_enemy', heal: 'g_heal' }, die: {}, birth: { char: 'g_birth' }, status: {} },
    prefabs,
  };
}

// data/tokens.json shapes: the top `skill` has only { skillId, bb }; the owners' variants hold the full records
const tokSkill = (skillId, index, o = {}) => ({ skillId, prefabId: skillId, index, skillType: 'PASSIVE', durationType: 'NONE', duration: -1, spType: 'ON_DEPLOY', bb: {}, ...o });
const RECS = {
  token_1_doll: {
    tokenId: 'token_1_doll', skill: { skillId: 'sktok_doll', bb: { atk: -0.25 } },
    variants: { chess_a: { skill: tokSkill('sktok_doll', 1, { duration: 15 }), bySkill: { 0: { skill: tokSkill('sktok_doll', 1, { duration: 15 }) } } } },
  },
  token_2_sea: {
    tokenId: 'token_2_sea', skill: { skillId: 'sktok_sea_3', bb: {} },
    variants: { chess_b: { skill: tokSkill('sktok_sea_3', 2), bySkill: { 0: { skill: tokSkill('sktok_sea_1', 0) } } } },
  },
};

async function setup() {
  const index = makeIndex();
  const spawned = [];
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [],
    lib: { has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 5 } : null), index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
    spawn(key, place, opts) {
      const h = { key, place, opts, stopped: false, get alive() { return !this.stopped; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      spawned.push(key); handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, x, o = {}) => {
    const enemy = /^enemy_/.test(key);
    const kind = /^token_/.test(key) ? 'token' : enemy ? 'enemy' : 'op';
    const v = { id, x, y: 10, z: 0, visFacing: enemy ? -1 : 1, isEnemy: enemy, alive: true, flags: 0, sp: 0, spMax: 0, energy: null, dir: enemy ? undefined : (o.dir || 'RIGHT'),
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind, skillIndex: o.skillIndex ?? 0 } };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  return { w, spawned, handles, view, frame, index, views };
}

const count = (spawned, k) => spawned.filter((x) => x === k).length;
const live = (handles, k) => handles.filter((h) => h.key === k && h.alive).length;

describe('a token\'s skill record from its owners\' variants (R18)', () => {
  test('the variant record with the unit\'s skillIndex; without one the top record completed with its type', () => {
    assert.equal(skillRecordOf(RECS.token_1_doll, 1).skillType, 'PASSIVE');
    assert.equal(skillRecordOf(RECS.token_1_doll, 1).duration, 15);
    assert.equal(skillRecordOf(RECS.token_2_sea, 0).skillId, 'sktok_sea_1', 'the owner\'s S1 picks the token\'s first skill');
    assert.equal(skillRecordOf(RECS.token_2_sea, 2).skillId, 'sktok_sea_3');
    const top = skillRecordOf(RECS.token_1_doll, undefined);
    assert.equal(top.skillType, 'PASSIVE');
    assert.deepEqual(top.bb, { atk: -0.25 }, 'the top record\'s own blackboard kept');
    // a record of the usual shape (a typed top skill) is read as before
    const chessRec = { skill: { skillId: 'a', index: 0, skillType: 'MANUAL' }, variants: {} };
    assert.equal(skillRecordOf(chessRec, 0), chessRec.skill);
    assert.equal(tokenSkillRecord({ skill: { skillId: 'zzz' }, variants: { x: { skill: tokSkill('other', 0) } } }, undefined), null);
  });

  test('the plan of the doll is a passive (no skill event comes for it) and the 海嗣 plays its owner\'s skill', async () => {
    const index = makeIndex();
    const doll = planFor(index, { info: { kind: 'token', side: 'ally', defId: 'token_1_doll', spine: 'token_1_doll', skillIndex: 1 }, rec: RECS.token_1_doll });
    assert.equal(doll.plan.kind, 'passive');
    assert.equal(resolveSkill(index, { info: { kind: 'token', side: 'ally', defId: 'token_2_sea', spine: 'token_2_sea', skillIndex: 0 }, rec: RECS.token_2_sea }).skillId, 'sktok_sea_1');
  });

  test('the doll\'s aura loops from its deploy, with no skill event, and stops when it leaves', async () => {
    const { w, spawned, handles, view, frame } = await setup();
    const d = view(1, 'token_1_doll', 5, { skillIndex: 1 });
    frame();
    w.deploy(d);
    frame();
    assert.equal(count(spawned, 'doll_aura'), 1);
    assert.equal(live(handles, 'doll_aura'), 1);
    for (let i = 0; i < 30; i++) frame();
    assert.equal(count(spawned, 'doll_aura'), 1, 'one loop for the deployment');
    d.alive = false;
    w.death(d);
    frame();
    assert.equal(live(handles, 'doll_aura'), 0);
  });

  test('a view built mid-battle (no deploy event) starts the aura from the snapshot', async () => {
    const { spawned, view, frame } = await setup();
    view(1, 'token_1_doll', 5, { skillIndex: 1 });
    frame();
    assert.equal(count(spawned, 'doll_aura'), 1);
  });
});
