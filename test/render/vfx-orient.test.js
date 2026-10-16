// test/render/vfx-orient.test.js — official effects that stand, start at the weapon or come back (the maintainer's report
// of 2026-10-16, DESIGN §34.6): the prefab root's authored transform is no part of the effect (the client sets the root
// where it plays it: 安洁莉娜 S2's orbs flew 0.94 tile above their path).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREFABS = path.join(ROOT, 'public/assets/local/fx/prefabs');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const nearV = (a, b, eps, msg) => a.forEach((x, i) => near(x, b[i], eps, `${msg}[${i}]`));

const MAT = {
  name: 'm', shader: 'Torappu/Particles/Additive', passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
  queue: 'Transparent', keywords: [], floats: {}, colors: { _TintColor: [1, 1, 1, 1] }, textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } },
};

/** A node with a burst system (billboard by default; `r` overrides renderer fields, `ps` the system's). */
const psNode = (id, parent, o = {}) => ({
  id, name: o.name || `ps${id}`, parent, children: [], active: true, pos: o.pos || [0, 0, 0], rot: o.rot || [0, 0, 0, 1], scale: o.scale || [1, 1, 1],
  particleSystem: { lengthInSec: 1, looping: !!o.loop, prewarm: false, startDelay: 0, playOnAwake: true, simulationSpeed: 1, moveWithTransform: o.space ?? 0, scalingMode: o.scaling ?? 1,
    InitialModule: { startLifetime: o.life ?? 1, startSpeed: 0, startSize: o.size ?? 1, startColor: [1, 1, 1, 1], maxNumParticles: 100 },
    EmissionModule: { rateOverTime: 0, m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] }, ...(o.ps || {}) },
  particleSystemRenderer: { m_Enabled: true, renderMode: 'billboard', renderAlignment: 'view', materials: [0, null], m_SortingOrder: o.order ?? 0, ...(o.r || {}) },
  behaviours: o.behaviours || [],
});

function desc(nodes, extra = {}) {
  for (const n of nodes) if (n.parent != null) nodes[n.parent].children.push(n.id);
  return { format: 'fx-prefab', version: 1, key: 'test', root: 0, nodes, materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {}, ...extra };
}
const rootNode = (behaviours = [], o = {}) => ({ id: 0, name: 'root', parent: null, children: [], active: true, pos: o.pos || [0, 0, 0], rot: o.rot || [0, 0, 0, 1], scale: [1, 1, 1], behaviours });
const pe = (fields = {}) => ({ class: 'ParticleEffect', enabled: true, fields: { _delayToPlay: 0, _delayToFinish: 0, _maxLifetime: -1, _isLoop: 0, _rotateType: 0, _spawnLocation: 2, _inactiveOnFinish: [], ...fields } });
const proj = (fields = {}) => ({ class: 'ProjectileEffect', enabled: true, fields: { _mainDir: 1, _delayToFinish: 0, _inactiveOnFinish: [], _inactiveOnHit: [], ...fields } });
const worldPos = (fx, i) => [fx.world[i][12], fx.world[i][13], fx.world[i][14]];
/** The world direction of a node's local +x axis. */
const worldX = (fx, i) => { const w = fx.world[i], l = Math.hypot(w[0], w[1], w[2]) || 1; return [w[0] / l, w[1] / l, w[2] / l]; };

describe('the root of a prefab is placed by the game', () => {
  test("the root's authored position is not added to the anchor (a projectile's body, an effect on a unit)", () => {
    // 安洁莉娜 S2's aglina_skill_02_trail: its root left at (0.181, 0.738, −0.601) in the prefab
    for (const beh of [[proj()], [pe({ _spawnLocation: 1 })]]) {
      const d = desc([rootNode(beh, { pos: [0.181, 0.738, -0.601] }), psNode(1, 0, { pos: [0.1, 0, 0] })]);
      const def = compileEffect(d);
      nearV(def.rootPos, [0.181, 0.738, -0.601], 1e-6, 'the authored position is kept for reference');
      const fx = new Effect(def, { seed: 1 }).place({ pos: [2, 3, -1] });
      fx.update(1 / 30);
      nearV(worldPos(fx, 0), [2, 3, -1], 1e-6, `${beh[0].class}: the root at the anchor`);
      nearV(worldPos(fx, 1), [2.1, 3, -1], 1e-6, `${beh[0].class}: its child at its own offset from the anchor`);
    }
  });

  test("a projectile body's authored root rotation gives way to its flight; `rootRot` replaces a prefab's own; a map-position effect keeps it", () => {
    const quarter = [0, 0, Math.SQRT1_2, Math.SQRT1_2];   // 90° about z left in the prefab
    const child = () => psNode(1, 0, { pos: [1, 0, 0] });
    const p = new Effect(compileEffect(desc([rootNode([proj()], { rot: quarter }), child()])), { seed: 1 }).place({ pos: [0, 0, 0], yaw: 0 });
    p.update(1 / 30);
    nearV(worldPos(p, 1), [1, 0, 0], 1e-6, 'a projectile body flies along +x (its direction), not turned by the leftover 90°');
    const kept = new Effect(compileEffect(desc([rootNode([pe({ _spawnLocation: 0 })], { rot: quarter }), child()])), { seed: 1 }).place({ pos: [0, 0, 0] });
    kept.update(1 / 30);
    nearV(worldPos(kept, 1), [0, 1, 0], 1e-6, 'placed at a map position (Effect._InitLocation sets only the position): the authored rotation stays');
    const tilt = [-0.258819, 0, 0, 0.965926];
    const set = new Effect(compileEffect(desc([rootNode([pe({ _spawnLocation: 1 })], { rot: quarter }), child()])), { seed: 1 }).place({ pos: [0, 0, 0], rootRot: tilt });
    set.update(1 / 30);
    nearV(worldPos(set, 1), [1, 0, 0], 1e-6, 'the rotation the game sets replaces the authored one');
    set.place({ rootRot: null });
    set.update(1 / 30);
    nearV(worldPos(set, 1), [0, 1, 0], 1e-6, 'and is cleared with null');
  });
});

const TRAIL = path.join(PREFABS, 'aglina_skill_02_trail.json');
test("the local client: 安洁莉娜 S2's flying orb is drawn at its projectile, not 0.94 tile above it", { skip: !existsSync(TRAIL) && 'local extraction absent' }, () => {
  const d = JSON.parse(readFileSync(TRAIL, 'utf8'));
  nearV(d.nodes[0].pos, [0.181, 0.738, -0.601], 1e-3, 'the prefab keeps the editor position of its root');
  const fx = new Effect(compileEffect(d), { seed: 1 }).place({ pos: [-5.654, 2.147, -1.082], yaw: Math.PI, rootRot: [0, 0, 0, 1] });
  fx.update(1 / 30);
  const trail = d.nodes.findIndex((n) => n.trailRenderer);
  nearV(worldPos(fx, trail), [-5.654, 2.147, -1.082], 1e-4, 'the trail rides the projectile');
  nearV(worldX(fx, trail), [-1, 0, 0], 1e-4, 'turned along the flight');
});
