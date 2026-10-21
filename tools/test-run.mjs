#!/usr/bin/env node
// tools/test-run.mjs — what `npm test` runs: the whole suite, or one shard of it when CI sets SHARD.
//
//   npm test                         every test file, in one runner (TEST_FILES, as package.json always passed them)
//   SHARD=2 npm test                 only shard 2's files (ci.yml runs 0..3 on each OS and Node version)
//   node tools/test-run.mjs --list   the files a run here would execute, and run nothing
//
// One shard is a subset of the full run, never a different set: the files come from tools/ci-shards.mjs, whose table
// test/ci-shards.test.js proves is a partition of exactly what `npm test` runs. The full run passes TEST_FILES on to
// node --test (which expands the globs itself, as before); a shard passes the concrete paths, because a shard is a list
// of files and not a glob. SHARD unset (or empty) means the full run: that is what `npm run ci` and a local `npm test` do.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, TEST_FILES } from './ci.mjs';
import { SHARD_COUNT, shardsOf, testFileList } from './ci-shards.mjs';

/**
 * The arguments `node` is started with: `--test` and the files of the run.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root]
 * @returns {string[]}
 */
export function runArgs(env = process.env, root = ROOT) {
  const shard = env.SHARD;
  if (shard === undefined || shard === '') return ['--test', ...TEST_FILES];
  if (!/^\d+$/.test(shard) || Number(shard) >= SHARD_COUNT) {
    throw new Error(`SHARD=${shard}: expected 0..${SHARD_COUNT - 1} (or unset for the whole suite)`);
  }
  return ['--test', ...shardsOf(root).files[Number(shard)]];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const shard = process.env.SHARD;
  const isShard = shard !== undefined && shard !== '';
  if (isShard && (!/^\d+$/.test(shard) || Number(shard) >= SHARD_COUNT)) {
    console.error(`SHARD=${shard}: expected 0..${SHARD_COUNT - 1} (or unset for the whole suite)`);
    process.exit(2);
  }
  if (process.argv.includes('--list')) {
    const files = isShard ? shardsOf(ROOT).files[Number(shard)] : testFileList(ROOT);
    process.stdout.write(files.map((f) => `${f}\n`).join(''));
    process.exit(0);
  }
  const r = spawnSync(process.execPath, runArgs(), { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
