import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fxFixture } from '../helpers/fxFixtures.js';
import { cosmetic } from '../helpers/pluginFixtures.js';
import { createPluginRegistry, readVanillaAssets } from '../../server/plugins/registry.js';

test('plugin checks see newly extracted official references; local changes invalidate cache without changing base identity', t => {
  const f = fxFixture(t), dataDir = path.join(f.root, 'data'), cache = new Map();
  f.put('data/assets.json', { chars: {} });
  const before = readVanillaAssets(dataDir, cache);
  f.put('data/local-assets.json', { chars: { char_9001_test: { avatar: '/assets/local/a.png' } } });
  const after = readVanillaAssets(dataDir, cache);
  assert.equal(after.manifest.chars.char_9001_test.avatar, '/assets/local/a.png');
  assert.equal(after.sha256, before.sha256);
  fs.unlinkSync(path.join(dataDir, 'local-assets.json'));
  assert.deepEqual(readVanillaAssets(dataDir, cache), before);
});

test('a cosmetic reference is revalidated after extraction and disappears when that local manifest is removed', t => {
  const f = fxFixture(t);
  f.put('data/assets.json', { chars: {} });
  f.put('plugins/borrow/plugin.json', cosmetic({ id: 'borrow', permissions: ['assets.add'], assets: { chars: { char_x_borrow_one: { ref: 'char_9001_test' } } } }));
  const dirs = Object.fromEntries(['public', 'data', 'packs', 'plugins'].map(n => [n === 'public' ? 'publicDir' : n === 'data' ? 'dataDir' : n + 'Dir', path.join(f.root, n)]));
  const registry = createPluginRegistry(dirs, { recheckMs: 0 });
  assert.equal(registry.plugins().some(p => p.id === 'borrow'), false);
  f.put('data/local-assets.json', { chars: { char_9001_test: { avatar: '/assets/local/a.png' } } });
  assert.ok(registry.plugins().some(p => p.id === 'borrow'));
  fs.unlinkSync(path.join(f.root, 'data/local-assets.json'));
  assert.equal(registry.plugins().some(p => p.id === 'borrow'), false);
});
