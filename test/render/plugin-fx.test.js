import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSkill, planFor } from '../../public/js/render/vfx/skills.js';
import { activeTalentKeys } from '../../public/js/render/vfx/talents.js';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FxLibrary } from '../../public/js/render/vfx/library.js';
import { flipbookFrame } from '../../public/js/render/vfx/pluginFormat.js';
import { PluginFxPlayer } from '../../public/js/render/vfx/pluginPlayer.js';
import { OfficialFx } from '../../public/js/render/vfx/system.js';
import { UF } from '../../shared/constants.js';
import { readFxAssets } from '../../server/plugins/fxAssets.js';
import { listPluginFiles } from '../../server/plugins/registry.js';
import { fxFixture, compiled, book } from '../helpers/fxFixtures.js';

test('explicit official unit and skill mapping precedes art and records; absent mapping falls back', () => {
  const s = { uses: [], mode: 0 }, idx = { units: { char_112_siege: { kind: 'char', skills: { skchr_siege_3: s }, modes: [] }, char_102_texas: { skills: { old: s } } }, skills: {} };
  const info = { id: 1, diy: { charId: 'char_102_texas', skillIndex: 0 }, spine: 'char_102_texas' };
  const rec = { charId: 'char_x_demo_unit', skill: { skillId: 'custom', index: 0 }, fx: { unit: 'char_112_siege', skills: { 0: 'skchr_siege_3', custom: 'absent' } } };
  const r = resolveSkill(idx, { info, rec });
  assert.equal(r.unitKey, 'char_112_siege'); assert.equal(r.skillId, 'skchr_siege_3'); assert.equal(r.via, 'plugin');
  assert.equal(resolveSkill(idx, { info: { id: 2 }, rec }).skillId, 'skchr_siege_3', 'normal deployed operators use their default record slot');
  const w = new FxWiring({ active: true, lib: { index: async () => idx } }, { record: () => rec, unitKey: () => ['char_102_texas'] });
  w.idx = idx; assert.equal(w.unitKeyOf({ info }), 'char_112_siege');
  rec.fx.unit = 'char_missing'; rec.skill.skillId = 'old';
  assert.equal(resolveSkill(idx, { info, rec }).skillId, 'old');
  rec.fx = undefined;
  assert.equal(resolveSkill(idx, { info, rec }).unitKey, 'char_102_texas');
});

test('borrowing a unit includes base talent visuals, without enabling its module talents', () => {
  const idx = { units: { char_112_siege: { talentKeys: { trait: ['trait'], base: { 0: ['base'] }, modules: { x: { 0: ['module'] } } } } } };
  assert.deepEqual([...activeTalentKeys(idx, 'char_112_siege', { rec: { fx: { unit: 'char_112_siege' } } })], ['trait', 'base']);
});

test('plugin library works without local official extraction and compiles namespaced plans', async t => {
  const f = fxFixture(t); compiled(f);
  const got = readFxAssets(f.root, { index: 'fx/index.json' }, ['fx-demo'], listPluginFiles(f.root));
  const value = { ...got.value, images: { 'fx/sheet.png': { w: 8, h: 8, url: '/p/fx-demo/12345678/fx/sheet.png' } } };
  const lib = new FxLibrary({ assets: { manifest: { fx: { 'fx-demo': value } } }, list: { groups: {} }, fetch: async () => ({ ok: false }) });
  assert.equal(await lib.init(), true);
  const idx = await lib.index();
  assert.ok(lib.has('plugin:fx-demo:spark'));
  assert.equal((await lib.load('plugin:fx-demo:spark')).n, 1);
  const r = planFor(idx, { info: { skillIndex: 0 }, rec: { charId: 'char_x_fx_demo_guard', skill: { index: 0, skillId: 'skx_fx_demo_one' } } });
  assert.equal(r.skillId, 'plugin:fx-demo:skx_fx_demo_one');
  assert.equal(r.plan.start[0].key, 'plugin:fx-demo:spark');
});

test('flipbook exact timing, incomplete last row, loop and pause arithmetic', () => {
  const b = book();
  assert.equal(flipbookFrame(b, 0).frame, 0); assert.equal(flipbookFrame(b, 0.1).frame, 1);
  assert.equal(flipbookFrame(b, 0.3).frame, 3); assert.equal(flipbookFrame(b, 0.4), null);
  assert.equal(flipbookFrame({ ...b, loop: true }, 0.4).frame, 0);
  const last = flipbookFrame({ ...b, frames: 5 }, 0.4); assert.equal(last.row, 2); assert.equal(last.col, 0); assert.equal(last.rows, 3);
  assert.deepEqual(flipbookFrame(b, 0.2), flipbookFrame(b, 0.2));
});

test('a missing official index produces just one note and preserves a silent fallback', async t => {
  const note = t.mock.method(console, 'info', () => {});
  const lib = new FxLibrary({ list: { groups: {} }, fetch: async () => ({ ok: false }) });
  lib.notePluginUnit('char_1_absent'); lib.notePluginUnit('char_2_absent');
  await lib.index();
  assert.equal(note.mock.callCount(), 1);
  assert.equal(lib.available, false);
});

test('removing an effect set discards a texture that finishes decoding later', async () => {
  const lib = new FxLibrary({ list: { groups: {} }, fetch: async () => ({ ok: false }) });
  await lib.init();
  lib.groups = { 'fx/tex': { 'plugin:fx-demo:sheet': { path: '/old.png' } } };
  let resolve, started;
  const waiting = new Promise(r => { started = r; });
  lib._image = () => { started(); return new Promise(r => { resolve = r; }); };
  const pending = lib.loadTexture('plugin:fx-demo:sheet', false); await waiting;
  await lib.reloadPlugins(); let closed = false;
  resolve({ image: { close() { closed = true; } }, flipped: true });
  assert.equal(await pending, null); assert.equal(closed, true); assert.equal(lib.images.has('plugin:fx-demo:sheet|0'), false);
});

test('sprite path follows both cameras, skill loops stop, setting off clears and DSL/phase work', () => {
  class Texture { constructor(base) { this.baseTexture = base; } destroy() {} }
  class Sprite { constructor(texture) { this.texture = texture; this.anchor = { set() {} }; this.position = { set(x, y) { this.x = x; this.y = y; } }; } destroy() { this.destroyed = true; } }
  const P = { BaseTexture: { from: () => ({ valid: true }) }, Texture, Sprite, Rectangle: class { constructor(...values) { this.values = values; } }, BLEND_MODES: { ADD: 1, NORMAL: 0 } };
  const rec = { charId: 'char_x_fx_demo_guard', skill: { index: 0, skillId: 'custom' } }, v = { info: { id: 1, skillIndex: 0 }, x: 1, y: 2, alive: true };
  const b = book(), effects = { 'fx-demo': { config: { flipbooks: { flash: b }, bind: { char_x_fx_demo_guard: { 0: { skillLoop: 'flash', hit: 'flash', projectile: 'flash' } } }, silentPhases: ['quiet'] }, images: { [b.image]: { w: 8, h: 8, url: '/p/a/b/fx/sheet.png' } } } };
  let enabled = true, camera = 1;
  const player = new PluginFxPlayer({ P, layer: { addChild() {} }, assets: { manifest: { fx: effects } }, cam: () => ({ project: (x,y) => ({ x: x * camera, y, s: 40 }) }), enabled: () => enabled, record: () => rec, speed: () => 10, ofx: { active: false } });
  player.skill(v, true); assert.equal(player.live.size, 1);
  player.update(0.5); const loop = [...player.live][0]; assert.ok(loop && !loop.dead); assert.equal(loop.sprite.position.x, 1);
  camera = 2; player.update(0); assert.equal(loop.sprite.position.x, 2);
  player.skill(v, false); assert.equal(player.live.size, 0);
  const target = { info: { id: 2 }, x: 11, y: 2, alive: true };
  assert.equal(player.attack(v, target, 'arrow'), true);
  player.update(0.6); assert.equal(player.live.size, 1, 'a flight outlives one animation cycle');
  assert.equal(player.hit(null, target), true, 'the ranged damage spark is covered');
  player.update(0.4); assert.equal(player.live.size, 1, 'arrival starts the hit');
  player.clear();
  v.flags = UF.SKILL; player.sync([v]); assert.equal(player.live.size, 1, 'snapshot resumes a loop without its start burst');
  v.flags = 0; player.sync([v]); assert.equal(player.live.size, 0);
  assert.equal(player.simFx('phase', 0, 0, { kind: 'quiet' }), true);
  assert.equal(player.simFx('phase', 0, 0, { kind: 'other' }), false);
  assert.equal(player.simFx('plugin', 1, 1, { skill: 'plugin:fx-demo:flash', dur: 0.2 }), true); assert.equal(player.live.size, 1);
  enabled = false; player.update(0); assert.equal(player.live.size, 0);
  player.skill(v, true); assert.equal(player.live.size, 0);
});

test('compiled author loops cannot bypass live or pending renderer budgets', () => {
  const ofx = new OfficialFx({ P: { Container: class {} }, lib: { available: true, has: () => true }, tier: 'lite' });
  ofx.pending = Array(128).fill({});
  assert.equal(ofx.spawn('plugin:fx-demo:spark', {}, { loop: true }), null);
  assert.equal(ofx.dropped, 1);
});
