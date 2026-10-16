// Compiled effects are data. Validate before hashing/serving; no pack code, shader source or URL is accepted.
import fs from 'node:fs';
import path from 'node:path';
import { readPluginManifest } from '../../shared/plugins/manifest.js';
import { issueList } from '../../shared/plugins/errors.js';
import { fxObject as obj, fxId, fxPath, pluginFxProblems, ownsFxUnit, PLUGIN_FX_LIMITS as CAP } from '../../public/js/render/vfx/pluginFormat.js';

const allowed = (v, names) => obj(v) && Object.keys(v).every(k => names.includes(k));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const table = (v, cap) => obj(v) && Object.keys(v).length <= cap && Object.keys(v).every(fxId);
const scalar = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const flag = v => [undefined, false, true, 0, 1].includes(v);
const optional = (v, lo, hi) => v === undefined || scalar(v, lo, hi);
const oneOf = (v, values) => v === undefined || values.includes(v);

/** Inline effects contain JSON paths, unlike legacy art leaves; preserve the old reader for all other fields. */
export function readFxManifest(raw, ctx) {
  if (!obj(raw?.assets) || raw.assets.fx === undefined) return readPluginManifest(raw, ctx);
  const { fx, ...assets } = raw.assets;
  const read = readPluginManifest({ ...raw, assets }, ctx), list = issueList();
  list.take(read);
  for (const message of pluginFxProblems(fx, [ctx.id, ...Object.keys(raw.requires || {})])) list.problem('PLUGIN_PART_SHAPE', `fx: ${message}`, { at: ['assets', 'fx'], detail: message });
  const draft = read.manifest || read.draft;
  if (draft?.parts.assets) {
    draft.parts.assets.inline = { ...draft.parts.assets.inline, fx };
    if (!list.problems.length) draft.parts.assets.files.push(...[fx.index, ...Object.values(fx.flipbooks || {}).map(b => b.image)].filter(Boolean));
  }
  return { manifest: list.problems.length ? null : read.manifest, draft, problems: list.problems, warnings: list.warnings, issues: list.issues };
}

/** Reject unbounded recursion, numeric payloads, prototype keys and hidden strings before schema-specific checks. */
function bounded(value) {
  let left = 100000;
  const walk = (v, depth) => {
    check(--left >= 0 && depth <= 24, 'effect JSON complexity limit');
    if (typeof v === 'number') check(Number.isFinite(v) && Math.abs(v) <= 10000, 'effect number outside ±10000');
    if (typeof v === 'string') check(v.length <= 256, 'effect string too long');
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(k), 'unsafe effect key');
      walk(x, depth + 1);
    }
  };
  walk(value, 0);
}

export function validateFxPrefab(d, textures) {
  bounded(d);
  check(allowed(d, ['format', 'version', 'key', 'root', 'nodes', 'materials', 'textures', 'meshes', 'refs', 'clips', 'stats', 'bundle']) && d.format === 'fx-prefab' && d.version === 1 && fxId(d.key), 'fx-prefab version 1 required');
  check(Array.isArray(d.nodes) && d.nodes.length > 0 && d.nodes.length <= CAP.nodes && (d.root ?? 0) === 0, 'prefab node/root limit');
  // [ASSUMED] First author format: particles and built-in quads, no chained effects, custom meshes or animation clips.
  for (const k of ['refs', 'meshes', 'clips']) check(d[k] === undefined || Array.isArray(d[k]) && d[k].length === 0, `${k} are unsupported in plugin prefabs`);
  check(Array.isArray(d.textures) && d.textures.every(t => Object.hasOwn(textures, t)), 'undeclared prefab texture');
  check(Array.isArray(d.materials) && d.materials.length <= 16, 'material limit');
  for (const m of d.materials) {
    check(allowed(m, ['name', 'shader', 'passes', 'queue', 'keywords', 'floats', 'colors', 'textures']) && ['Torappu/Particles/Additive', 'Torappu/Particles/Alpha Blended'].includes(m.shader), 'only built-in additive/alpha particle materials');
    check(obj(m.textures) && Object.values(m.textures).every(t => allowed(t, ['tex', 'st']) && Object.hasOwn(textures, t.tex) && (t.st === undefined || Array.isArray(t.st) && t.st.length === 4 && t.st.every(Number.isFinite))), 'invalid material texture');
    check(m.passes === undefined || Array.isArray(m.passes) && m.passes.length <= 2, 'material pass limit');
    for (const p of m.passes || []) check(allowed(p, ['blend', 'blendOp', 'zTest', 'zWrite', 'cull', 'colorMask']) &&
      (p.blend === undefined || Array.isArray(p.blend) && p.blend.length === 4 && p.blend.every(v => ['Zero', 'One', 'DstColor', 'SrcColor', 'OneMinusDstColor', 'SrcAlpha', 'OneMinusSrcColor', 'DstAlpha', 'OneMinusDstAlpha', 'SrcAlphaSaturate', 'OneMinusSrcAlpha'].includes(v))) &&
      oneOf(p.blendOp, ['Add', 'Subtract', 'ReverseSubtract', 'Min', 'Max']) && oneOf(p.zTest, ['Disabled', 'Never', 'Less', 'Equal', 'LessEqual', 'Greater', 'NotEqual', 'GreaterEqual', 'Always']) && flag(p.zWrite) && oneOf(p.cull, ['Off', 'Front', 'Back']) && optional(p.colorMask, 0, 15), 'invalid material pass');
    check(m.keywords === undefined || Array.isArray(m.keywords) && m.keywords.length <= 32 && m.keywords.every(k => typeof k === 'string'), 'invalid material keywords');
    check(m.floats === undefined || obj(m.floats) && Object.keys(m.floats).length <= 64 && Object.values(m.floats).every(Number.isFinite), 'invalid material floats');
    check(m.colors === undefined || obj(m.colors) && Object.keys(m.colors).length <= 16 && Object.values(m.colors).every(v => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)), 'invalid material colors');
  }
  let systems = 0, particles = 0, emitters = 0;
  for (const [i, n] of d.nodes.entries()) {
    check(allowed(n, ['id', 'name', 'parent', 'children', 'active', 'pos', 'rot', 'scale', 'particleSystem', 'particleSystemRenderer', 'meshFilter', 'meshRenderer', 'behaviours']), 'unsupported prefab node field');
    check(n.id === i && (i === 0 ? n.parent == null : Number.isInteger(n.parent) && n.parent >= 0 && n.parent < i), 'nodes must be a parent-first tree');
    check(n.children === undefined || Array.isArray(n.children) && n.children.every(c => Number.isInteger(c) && c > i && c < d.nodes.length && d.nodes[c].parent === i), 'invalid child reference');
    check(flag(n.active), 'invalid node active flag');
    for (const [k, size] of [['pos', 3], ['rot', 4], ['scale', 3]]) check(n[k] === undefined || Array.isArray(n[k]) && n[k].length === size && n[k].every(Number.isFinite), `invalid ${k}`);
    check(n.behaviours === undefined || Array.isArray(n.behaviours) && n.behaviours.length <= 1 && n.behaviours.every(b => allowed(b, ['class', 'enabled', 'fields']) && b.class === 'ParticleEffect' && allowed(b.fields, ['_isLoop', '_maxLifetime', '_spawnLocation', '_delayToPlay', '_delayToFinish', '_rotateType'])), 'unsupported behaviour');
    for (const b of n.behaviours || []) { const f = b.fields;
      check(flag(b.enabled) && flag(f._isLoop) && optional(f._maxLifetime, -1, 30) && optional(f._delayToPlay, 0, 30) && optional(f._delayToFinish, 0, 30) && optional(f._spawnLocation, 0, 20) && optional(f._rotateType, 0, 20), 'invalid ParticleEffect fields');
    }
    if (n.meshFilter !== undefined) check(n.meshFilter?.builtin === 'Quad' && Object.keys(n.meshFilter).length === 1, 'only builtin Quad meshes');
    for (const r of [n.meshRenderer, n.particleSystemRenderer].filter(Boolean)) {
      check(allowed(r, ['m_Enabled', 'renderMode', 'renderAlignment', 'materials', 'm_SortingOrder', 'm_SortingLayer']) && Array.isArray(r.materials) && r.materials.length <= 4 && r.materials.every(m => Number.isInteger(m) && m >= 0 && m < d.materials.length), 'invalid renderer/material reference');
      check(r.renderMode === undefined || ['billboard', 'horizontal', 'vertical'].includes(r.renderMode), 'unsupported particle render mode');
      check(flag(r.m_Enabled) && (r.renderAlignment === undefined || ['view', 'world', 'local', 'facing', 'velocity'].includes(r.renderAlignment)) && optional(r.m_SortingOrder, -100, 100) && optional(r.m_SortingLayer, 0, 100), 'invalid renderer fields');
    }
    if (n.particleSystem) {
      const p = n.particleSystem, init = p.InitialModule, em = p.EmissionModule;
      check(allowed(p, ['lengthInSec', 'looping', 'prewarm', 'startDelay', 'playOnAwake', 'simulationSpeed', 'moveWithTransform', 'scalingMode', 'InitialModule', 'EmissionModule']), 'unsupported particle module');
      check([undefined, false, 0].includes(p.prewarm) && Number.isFinite(p.lengthInSec) && p.lengthInSec > 0 && p.lengthInSec <= 30, 'particle duration 0–30; no prewarm');
      check(flag(p.looping) && flag(p.playOnAwake) && optional(p.startDelay, 0, 30) && optional(p.simulationSpeed, 0, 8) && optional(p.moveWithTransform, 0, 2) && optional(p.scalingMode, 0, 2), 'invalid particle main fields');
      check(allowed(init, ['startLifetime', 'startSpeed', 'startSize', 'startColor', 'maxNumParticles']) && Number.isInteger(init.maxNumParticles) && init.maxNumParticles >= 1 && init.maxNumParticles <= 256, 'particle capacity 1–256');
      for (const k of ['startLifetime', 'startSpeed', 'startSize']) check(typeof init[k] === 'number' && init[k] >= 0 && init[k] <= (k === 'startLifetime' ? 30 : 8), `bounded scalar ${k} required`);
      check(Array.isArray(init.startColor) && init.startColor.length === 4 && init.startColor.every(v => Number.isFinite(v) && v >= 0 && v <= 1), 'RGBA color required');
      check(allowed(em, ['rateOverTime', 'm_Bursts']) && Number.isFinite(em.rateOverTime) && em.rateOverTime >= 0 && em.rateOverTime <= 256 && Array.isArray(em.m_Bursts) && em.m_Bursts.length <= 16, 'invalid emission');
      for (const b of em.m_Bursts) check(allowed(b, ['time', 'countCurve', 'cycleCount', 'repeatInterval', 'probability']) && Number.isFinite(b.countCurve) && b.countCurve >= 0 && b.countCurve <= 256 && (b.cycleCount === undefined || Number.isInteger(b.cycleCount) && b.cycleCount >= 1 && b.cycleCount <= 16) && optional(b.time, 0, 30) && optional(b.repeatInterval, 0.01, 30) && optional(b.probability, 0, 1), 'invalid burst');
      systems++; particles += init.maxNumParticles; emitters += em.m_Bursts.length + (em.rateOverTime > 0 ? 1 : 0);
    }
  }
  check(systems <= CAP.systems && particles <= CAP.particles && emitters <= CAP.emitters, 'particle systems/particles/emitters exceed cap');
  return d;
}

export function readFxAssets(dir, config, owners, listed) {
  const errors = pluginFxProblems(config, owners);
  if (errors.length) throw new Error(errors.join('; '));
  const used = new Set(), sizes = new Map(listed.filter(f => !f.link).map(f => [f.rel, f.bytes]));
  let bytes = 0, jsonBytes = 0;
  const read = rel => {
    check(fxPath(rel) && sizes.has(rel), `missing or unsafe effect file ${rel}`);
    let abs = dir;
    for (const component of rel.split('/')) { abs = path.join(abs, component); check(!fs.lstatSync(abs).isSymbolicLink(), 'effect symlink refused'); }
    if (!used.has(rel)) { used.add(rel); bytes += sizes.get(rel); }
    check(used.size <= CAP.files && bytes <= CAP.bytes && (!rel.endsWith('.json') || sizes.get(rel) <= CAP.jsonBytes), 'effect file/byte limit');
    return fs.readFileSync(abs);
  };
  const json = rel => { const b = read(rel); jsonBytes += b.length; check(jsonBytes <= 4 * 1024 * 1024, 'compiled effect JSON exceeds 4 MB'); const d = JSON.parse(b); bounded(d); return d; };
  const images = {};
  const image = rel => {
    if (images[rel]) return images[rel];
    const b = read(rel);
    check(rel.endsWith('.png') && b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString('ascii', 12, 16) === 'IHDR', 'effect texture must be PNG');
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    check(w > 0 && h > 0 && w <= CAP.textureSize && h <= CAP.textureSize && b[24] === 8 && [2, 6].includes(b[25]), 'effect texture: 8-bit RGB/RGBA PNG, at most 2048 square');
    return images[rel] = { w, h };
  };
  for (const b of Object.values(config.flipbooks || {})) {
    const im = image(b.image);
    check(im.w % b.cols === 0 && im.h % Math.ceil(b.frames / b.cols) === 0, 'flipbook cells must divide the image');
  }
  const prefabs = {}, textures = {};
  let index = null;
  if (config.index) {
    index = json(config.index);
    check(allowed(index, ['format', 'version', 'units', 'skills', 'prefabs', 'textures', 'projectiles']) && index.format === 'fx-index' && index.version === 3, 'fx-index version 3 required');
    for (const [k, cap] of [['units', CAP.units], ['skills', CAP.effects], ['prefabs', CAP.effects], ['textures', CAP.effects]]) check(table(index[k], cap), `invalid index ${k}`);
    check(index.projectiles === undefined || obj(index.projectiles) && !Object.keys(index.projectiles).length, 'use fx.bind.projectile for plugin projectiles');
    for (const id of Object.keys(index.units)) check(ownsFxUnit(id, owners), 'compiled units must belong to the plugin or a declared dependency');
    for (const [id, t] of Object.entries(index.textures)) { check(allowed(t, ['file']) && fxPath(t.file), 'invalid texture entry'); textures[id] = { path: t.file, ...image(t.file) }; }
    for (const [id, p] of Object.entries(index.prefabs)) {
      check(allowed(p, ['file', 'looping', 'spawn', 'follow']) && fxPath(p.file) && p.file.endsWith('.json'), 'invalid prefab entry');
      check(!Object.hasOwn(config.flipbooks || {}, id), 'prefab and flipbook ids must differ');
      const d = validateFxPrefab(json(p.file), textures);
      check(d.key === id, 'prefab key differs from index'); prefabs[id] = d;
    }
    // Only the bounded subset the renderer can reliably place is admitted. Unknown fields fail closed.
    const use = u => allowed(u, ['keys', 'role', 'from', 'ability', 'oneshot']) && Array.isArray(u.keys) && u.keys.length <= 16 && u.keys.every(k => Object.hasOwn(prefabs, k)) && ['start', 'loop', 'end', 'hit', 'cast'].includes(u.role);
    for (const s of Object.values(index.skills)) check(allowed(s, ['uses', 'mode', 'rootClass']) && Array.isArray(s.uses) && s.uses.length <= 128 && s.uses.every(use), 'invalid skill uses');
    for (const u of Object.values(index.units)) {
      check(allowed(u, ['kind', 'skills', 'modes', 'startEffect', 'deadEffect']) && u.kind === 'char' && obj(u.skills) && Object.keys(u.skills).length <= 10 && Array.isArray(u.modes) && u.modes.length <= 10, 'invalid unit');
      for (const [id, s] of Object.entries(u.skills)) check(Object.hasOwn(index.skills, id) && JSON.stringify(s) === JSON.stringify(index.skills[id]), 'unit skills must match index skills');
      for (const m of u.modes) {
        check(allowed(m, ['name', 'attack']) && typeof m.name === 'string' && allowed(m.attack, ['cast', 'hit']), 'invalid attack mode');
        for (const k of ['cast', 'hit']) check(Array.isArray(m.attack[k]) && m.attack[k].length <= 32 && m.attack[k].every(row => allowed(row, ['effects', 'oneshot', 'startEvent', 'endEvent']) && Array.isArray(row.effects) && row.effects.length <= 16 && row.effects.every(id => Object.hasOwn(prefabs, id))), 'invalid attack effect uses');
      }
      for (const k of ['startEffect', 'deadEffect']) check(u[k] === undefined || Object.hasOwn(prefabs, u[k]), 'invalid unit effect');
    }
  }
  for (const skills of Object.values(config.bind || {})) for (const phases of Object.values(skills)) for (const id of Object.values(phases)) check(Object.hasOwn(prefabs, id) || Object.hasOwn(config.flipbooks || {}, id), `missing bound effect ${id}`);
  return { files: [...used], value: { config, index, prefabs, textures, images } };
}
