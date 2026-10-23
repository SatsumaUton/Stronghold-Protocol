// Separate processes exercise the same isolation boundary as official version hosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSIONS, versionSlug } from '../shared/versions.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const families = ['roster', 'bonds', 'fields', 'matches', 'standins', 'diy'];
for (const version of VERSIONS.filter((v) => v.dir)) {
  test(`${version.id}: complete corpus has identity, supported modes and no recorded engine errors`, () => {
    const expected = [];
    for (const family of families) {
      const doc = JSON.parse(readFileSync(new URL(`golden/${versionSlug(version)}/${family}.json`, import.meta.url), 'utf8'));
      assert.equal(doc.version, version.id);
      for (const [id, digest] of Object.entries(doc.scenarios)) {
        expected.push(`${family}\t${id}`);
        assert.ok(!digest.modeId?.endsWith('_abyss'), id);
        const errors = digest.errors || {};
        const count = errors.count ?? Object.values(errors).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        assert.equal(count, 0, `${family}/${id}: ${JSON.stringify(errors)}`);
      }
    }
    const list = spawnSync(process.execPath, ['tools/golden.mjs', '--version', version.id, '--list'], { cwd: root, encoding: 'utf8', timeout: 120000 });
    assert.equal(list.status, 0, list.error?.message || list.stderr);
    assert.deepEqual(list.stdout.trim().split('\n').map((line) => line.split('\t').slice(0, 2).join('\t')), expected);
  });

  test(`${version.id}: a representative golden reproduces in a worker with that version's data`, () => {
    const result = spawnSync(process.execPath, ['tools/golden.mjs', '--version', version.id, '--family', 'bonds', '--only', 'bond-raidShip-high', '--jobs', '2'], { cwd: root, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /1 scenarios match/);
  });
}
