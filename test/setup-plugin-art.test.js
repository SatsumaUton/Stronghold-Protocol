import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fxFixture } from './helpers/fxFixtures.js';
import { installedArtReferences } from '../server/plugins/artReferences.js';
import { installedFxReferences } from '../server/plugins/fxReferences.js';
import { checkPluginArt, pluginFxExtractionAllowed } from '../tools/setup.mjs';

const ID = 'char_9001_test';
function fixture(t) {
  const f = fxFixture(t);
  f.put('data/chess.json', { a: { charId: 'char_1_pool' } });
  f.put('data/backups.json', { units: { char_2_backup: {} } });
  f.put('plugins/demo/plugin.json', { operators: ['ops.json'], data: ['records.json'], assets: 'assets.json', entry: { sim: 'evil.js' } });
  f.put('plugins/demo/ops.json', [{ charId: 'char_1_pool' }, { origin: { charId: 'char_2_backup' } },
    { charId: 'char_x_demo_one', fx: { unit: ID }, art: { assets: { portrait: 'char_9002_test' } } },
    { charId: 'char_x_demo_two', origin: { charId: 'char_9003_test' } }]);
  f.put('plugins/demo/records.json', [{ target: 'backups', value: { units: { char_9004_test: {} } } }]);
  f.put('plugins/demo/assets.json', { chars: { char_x_demo_one: { ref: 'char_9005_test' } } });
  fs.writeFileSync(path.join(f.root, 'plugins/demo/evil.js'), 'throw new Error("never execute this");');
  return f;
}

test('operator discovery reuses W5 references, excludes the shipped roster, and never loads scripts/links', t => {
  const f = fixture(t), ids = [ID, 'char_9002_test', 'char_9003_test', 'char_9004_test', 'char_9005_test', 'char_9006_test'];
  f.put('plugins/phases/plugin.json', { assets: { chars: { char_x_phases_one: { portrait: { ref: 'char_9006_test_2' } } } }, fx: { unit: 'char_9007_test_2' } });
  f.put('plugins/linked/plugin.json', { operators: ['link.json'] });
  f.put('outside.json', [{ charId: 'char_9999_forbidden' }]);
  fs.symlinkSync(path.join(f.root, 'outside.json'), path.join(f.root, 'plugins/linked/link.json'));
  f.put('plugins/traversal/plugin.json', { operators: ['../../outside.json'] });
  assert.deepEqual(installedArtReferences(f.root), ids);
  assert.ok(!installedFxReferences(f.root).includes('char_9006_test'), 'effect discovery keeps exact ids');
  const cli = spawnSync(process.execPath, ['tools/local-extract/plugin-art.mjs', f.root], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), ids);
});

test('new references, missing files, directions and E2 art offer extraction; complete art closes the gap', t => {
  const f = fixture(t);
  const art = { avatar: '/assets/local/a.png', portrait: '/assets/local/p.png',
    spine: { front: { skel: '/assets/local/f.skel', atlas: '/assets/local/f.atlas', textures: ['/assets/local/f.png'] },
      back: { skel: '/assets/local/b.skel', atlas: '/assets/local/b.atlas', textures: ['/assets/local/b.png'] } } };
  f.put('data/local-assets.json', { chars: { [ID]: art } });
  assert.ok(checkPluginArt(f.root).includes(ID), 'a manifest alone is insufficient');
  for (const url of [art.avatar, art.portrait, ...Object.values(art.spine).flatMap(m => [m.skel, m.atlas, ...m.textures])]) f.put('public' + url, Buffer.from('fixture'));
  assert.ok(!checkPluginArt(f.root).includes(ID));
  fs.unlinkSync(path.join(f.root, 'public/assets/local/b.png'));
  assert.ok(checkPluginArt(f.root).includes(ID));
  f.put('public/assets/local/b.png', Buffer.from('fixture'));
  f.put('.cache/gamedata/excel/character_table.json', { [ID]: { phases: [{}, {}, {}] } });
  assert.ok(checkPluginArt(f.root).includes(ID), 'E2 art needed when the local table declares E2');
  art.avatarE2 = art.avatar; art.portraitE2 = art.portrait;
  f.put('data/local-assets.json', { chars: { [ID]: art } });
  assert.ok(!checkPluginArt(f.root).includes(ID));
  f.put('plugins/new/plugin.json', { origin: { charId: 'char_9998_new' } });
  assert.ok(checkPluginArt(f.root).includes('char_9998_new'));
});

test('operator gap uses the existing opt-in gate; check/no-local and no reply never authorize extraction', () => {
  for (const reply of [false, null, undefined]) assert.equal(pluginFxExtractionAllowed({}, [ID], reply), false);
  assert.equal(pluginFxExtractionAllowed({}, [ID], true), true);
  assert.equal(pluginFxExtractionAllowed({ yes: true }, [ID]), true);
  assert.equal(pluginFxExtractionAllowed({ local: 'force' }, [ID]), true);
  for (const opts of [{ check: true, local: 'force' }, { local: 'no', yes: true }]) assert.equal(pluginFxExtractionAllowed(opts, [ID], true), false);
});
