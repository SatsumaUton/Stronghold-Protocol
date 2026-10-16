// test/render/vfx-orient.test.js — official effects that stand, start at the weapon or come back (the maintainer's report
// of 2026-10-16, DESIGN §34.6): the prefab root's authored transform is no part of the effect (the client sets the root
// where it plays it: 安洁莉娜 S2's orbs flew 0.94 tile above their path); an effect spawned at FOOT_POINT / HIT_POINT /
// HEAD_POINT takes the unit's Graphic tilt (荒芜拉普兰德 S3's seal and 能天使 S3's light bars stand facing the camera), the
// ground and NONE spawns the identity, FLIP_TWO_SIDE still flips the tilted ones, a FollowMountPoint keeps or follows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { spawnRotation, graphicRotation } from '../../public/js/render/vfx/mounts.js';
import { quatRotate } from '../../public/js/render/vfx/math.js';

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

// ---- the spawn location's rotation (DESIGN §33.11, the client's Effect._InitLocationFromEntity) ------------------------

const GRAPHIC = [-0.258819, 0, 0, 0.965926];
/** The battle camera's view direction in the Unity frame (30° from straight down, towards +row). */
const CAM_FWD = [0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The world direction of a node's local +z axis (a local billboard's / a quad's normal). */
const worldZ = (fx, i) => { const w = fx.world[i], l = Math.hypot(w[8], w[9], w[10]) || 1; return [w[8] / l, w[9] / l, w[10] / l]; };

/** A prefab: a root with its ParticleEffect (`f`), a `rotation_y` helper and a local billboard in its XY plane. */
function standing(f = {}, beh = []) {
  return desc([rootNode([pe({ _rotationY: { node: 1 }, ...f }), ...beh]), { ...psNode(1, 0, { name: 'rotation_y' }), particleSystemRenderer: { m_Enabled: false, materials: [0] } },
    psNode(2, 1, { pos: [0.3, 0.6, 0], r: { renderAlignment: 'local' } })]);
}

/** A wiring over a fake layer whose library holds compiled `defs`; it records every spawn's placement. */
async function wired(defs) {
  const index = { version: 3, units: { char_t: { kind: 'char', modes: [], skills: {}, skin: 'char_t', refs: [] } },
    skins: { char_t: { graphic: { rot: GRAPHIC }, points: { HitPoint: { all: { pos: [0, 0.232, -0.25], rot: [0, 0, 0, 1] } }, HeadPoint: { all: { pos: [0, 0.75, -0.55], rot: [0, 0, 0, 1] } },
      Muzzle: { front: { pos: [0.4, 0.2, -0.1], rot: [0, 0, 0, 1] } } } } },
    projectiles: {}, skills: {}, generic: {}, prefabs: {} };
  const spawned = [];
  const ofx = {
    active: true, time: 0, timers: [], ctx: { cam: () => ({ tilt: 30 }) },
    lib: { has: (k) => k in defs, def: (k) => defs[k] || null, index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
    spawn(key, place, opts) { const h = { key, place, opts, alive: true, stop() {} }; spawned.push(h); return h; },
  };
  const w = new FxWiring(ofx, { speed: () => 10, record: () => null });
  await w.ready();
  const view = (o = {}) => ({ id: 1, x: 5, y: 10, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, dir: 'RIGHT', info: { id: 1, spine: 'char_t', defId: 'char_t', side: 'ally', kind: 'op' }, ...o });
  return { w, spawned, view };
}

/** The effect a recorded spawn draws: the prefab under the placement the wiring gave it, one frame on. */
function drawn(def, h) {
  const fx = new Effect(def, { seed: 1 }).place(h.place);
  fx.update(1 / 30);
  return fx;
}

describe('the rotation an effect takes from its spawn location', () => {
  test('FOOT / HIT / HEAD: the Graphic tilt; MUZZLE / a Special point: the point; the ground, NONE and MUZZLE_POINT_WITHOUT_ROTATION: none', () => {
    for (const s of [1, 2, 4]) assert.equal(spawnRotation(s), 'graphic', `spawn ${s}`);
    assert.equal(spawnRotation(3), 'muzzle');
    assert.equal(spawnRotation(8), 's0');
    assert.equal(spawnRotation(13), 's4');
    for (const s of [0, 5, 6, 7, 12, 17, 26, 35]) assert.equal(spawnRotation(s), null, `spawn ${s}`);
    nearV(graphicRotation(null), GRAPHIC, 1e-9, 'the client\'s −30° about X without a skin');
    nearV(graphicRotation({ graphic: { rot: [0.258819, 0, 0, -0.965926] } }), [0.258819, 0, 0, -0.965926], 1e-9, 'the skin\'s own');
  });

  test('an effect authored standing (荒芜拉普兰德 S3\'s seal: a local plane at FOOT_POINT) faces the camera; HIT and HEAD alike', async () => {
    for (const spawn of [1, 2, 4]) {
      const def = compileEffect(standing({ _spawnLocation: spawn, _rotateType: 1 }));
      const { w, spawned, view } = await wired({ seal: def });
      w.playOn('seal', view(), { follow: true, loop: true });
      const h = spawned[0];
      nearV(h.place.rootRot, GRAPHIC, 1e-6, `spawn ${spawn}: the Graphic tilt`);
      assert.equal(h.place.mountRot, null, 'no facing turn of its own');
      const n = worldZ(drawn(def, h), 2);
      assert.ok(dot(n, CAM_FWD) > 0.9999, `spawn ${spawn}: the plane faces the camera (normal ${n.map((x) => x.toFixed(3))})`);
    }
  });

  test('a ground spawn, NONE and MUZZLE_POINT_WITHOUT_ROTATION take the identity: a local plane lies on the board', async () => {
    for (const spawn of [0, 5, 6, 7]) {
      const def = compileEffect(standing({ _spawnLocation: spawn }));
      const { w, spawned, view } = await wired({ fx: def });
      w.playOn('fx', view(), {});
      nearV(spawned[0].place.rootRot, [0, 0, 0, 1], 1e-9, `spawn ${spawn}`);
      nearV(worldZ(drawn(def, spawned[0]), 2), [0, 0, 1], 1e-6, `spawn ${spawn}: flat`);
    }
  });

  test('FLIP_TWO_SIDE still flips a tilted effect for a unit facing left (the tilt has no facing turn); a MUZZLE_POINT one faces with the unit', async () => {
    const foot = compileEffect(standing({ _spawnLocation: 1, _rotateType: 1 }));
    const muzzle = compileEffect(standing({ _spawnLocation: 3, _rotateType: 1 }));
    const { w, spawned, view } = await wired({ foot, muzzle });
    const left = view({ visFacing: -1, dir: 'LEFT' });
    w.playOn('foot', left, {});
    w.playOn('muzzle', left, {});
    const [hf, hm] = spawned;
    assert.equal(hf.place.flipY, true, 'the tilted effect turns its rotation_y helper');
    nearV(hf.place.rootRot, GRAPHIC, 1e-6, '… under the tilt');
    const fx = drawn(foot, hf);
    near(fx.world[2][12] - fx.world[0][12], -0.3, 1e-6, 'its content mirrored to the left in the camera plane');
    assert.ok(dot(worldZ(fx, 2), CAM_FWD) < -0.9999, '… the plane still facing the camera (seen from behind)');
    assert.ok(hm.place.mountRot && !hm.place.flipY, 'MUZZLE_POINT takes the point\'s rotation, the facing turn included: no flip of its own');
  });

  test('a FollowMountPoint with `_keepOriginRotation` keeps its spawn location\'s tilt (the status loops); without it a FOOT point turns with the unit', async () => {
    const fmp = (mount, keep) => ({ class: 'FollowMountPoint', enabled: true, fields: { _mountPointType: mount, _keepOriginRotation: keep ? 1 : 0 } });
    const stun = compileEffect(standing({ _spawnLocation: 4 }, [fmp(3, true)]));
    const feet = compileEffect(standing({ _spawnLocation: 1 }, [fmp(0, false)]));
    const { w, spawned, view } = await wired({ stun, feet });
    const v = view({ visFacing: -1, dir: 'LEFT' });
    w.playOn('stun', v, { follow: true, loop: true });
    w.playOn('feet', v, { follow: true, loop: true });
    const [hs, hf] = spawned;
    nearV(hs.place.rootRot, GRAPHIC, 1e-6, 'kept: the HEAD_POINT spawn\'s tilt');
    assert.equal(hs.place.mountRot, null);
    // FOOT followed with its rotation: the face's skeleton root — the tilt and the facing turn (180° about the skeleton's up)
    const r = hf.place.mountRot;
    assert.ok(r, 'a FOOT FollowMountPoint without _keepOriginRotation takes the point\'s rotation');
    nearV(quatRotate(r, [1, 0, 0]), [-1, 0, 0], 1e-6, 'turned to face left');
    nearV(quatRotate(r, [0, 0, 1]), [0, -CAM_FWD[1], -CAM_FWD[2]], 1e-6, '… about the tilted up axis');
  });

  test('a chained effect (OnPlayEmitter) takes its own spawn location\'s rotation, not its parent\'s', async () => {
    const child = compileEffect(standing({ _spawnLocation: 5 }));
    const parent = compileEffect(standing({ _spawnLocation: 1 }, [{ class: 'OnPlayEmitter', enabled: true, fields: { _effects: ['child'] } }]));
    const { w, spawned, view } = await wired({ parent, child });
    w.playOn('parent', view(), { follow: true, loop: true });
    const h = spawned[0];
    nearV(h.place.rootRot, GRAPHIC, 1e-6, 'the parent tilted');
    // system.js FxHandle._start hands the chained effect the parent's placement and track
    const fx = { def: child, anchor: h.place.pos.slice(), yaw: 0, mirror: false, flipY: false, mountRot: null, rootRot: h.place.rootRot.slice(), time: 0 };
    h.opts.track(fx);
    nearV(fx.rootRot, [0, 0, 0, 1], 1e-9, 'the chained GROUND_CENTER effect lies on the board');
    assert.equal(fx.mountRot, null);
  });
});
