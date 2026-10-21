#!/usr/bin/env node
// tools/test-timings.mjs — per-file test times from a test-run report, the weights tools/ci-shards.mjs balances the
// shards with.
//
//   node --test --test-reporter=junit --test-reporter-destination=report.xml "test/**/*.test.js" …
//   node tools/test-timings.mjs report.xml            the times as JSON on stdout: { "test/ui/hud.test.js": 1234, … }
//   node tools/test-timings.mjs report.xml --out f    the same, written to f
//
// JUnit, not TAP: a JUnit `<testcase>` carries `file` (the test file it belongs to) and `time` (seconds), while TAP
// prints the test names only. A file's time is the sum of its cases: the runner runs one file's tests one after another,
// so the sum is the file's share of the run. Paths are relative to the repository root, whatever the runner's absolute
// prefix was. Rounded to whole milliseconds: the shard table is a balance, not a benchmark.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** One attribute of a tag, or undefined. @param {string} attrs @param {string} name */
const attr = (attrs, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

/**
 * The time each test file took, in milliseconds, from a JUnit report (`--test-reporter=junit`).
 * @param {string} xml
 * @param {string} [root] the repository root the paths are made relative to
 * @returns {Record<string, number>}
 */
export function perFileMs(xml, root = ROOT) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const m of xml.matchAll(/<testcase\b([^>]*)>/g)) {
    const file = attr(m[1], 'file');
    const time = Number(attr(m[1], 'time'));
    if (!file || !Number.isFinite(time)) continue;
    const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
    if (rel.startsWith('..')) continue; // another checkout's file: not one of ours
    out[rel] = (out[rel] || 0) + time * 1000;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

/**
 * The time each test file took, in milliseconds, from several JUnit reports: one value per file, the median of the
 * reports that mention it. A file is measured once per CI job that ran it (ubuntu and windows, node 22 and 24), so the
 * median is what one runner takes without trusting a single slow or fast job — and a file a report does not mention
 * (a shard that did not run, a report cut short) keeps the others' value instead of vanishing.
 * @param {string[]} xmls
 * @param {string} [root]
 * @returns {Record<string, number>}
 */
export function perFileMsOf(xmls, root = ROOT) {
  const per = xmls.map((x) => perFileMs(x, root));
  const files = [...new Set(per.flatMap((m) => Object.keys(m)))].sort();
  /** @type {Record<string, number>} */
  const out = {};
  for (const f of files) {
    const seen = per.map((m) => m[f]).filter((v) => v !== undefined).sort((a, b) => a - b);
    out[f] = seen[(seen.length - 1) >> 1];
  }
  return out;
}

// The command line: a report, and where the JSON goes (stdout by default).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const reports = [];
  let out = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i] ?? '';
    else reports.push(args[i]);
  }
  if (!reports.length) {
    console.error('usage: node tools/test-timings.mjs <report.xml…> [--out <file.json>]');
    process.exit(2);
  }
  const ms = perFileMsOf(reports.map((f) => fs.readFileSync(f, 'utf8')));
  const json = `${JSON.stringify(ms, null, 2)}\n`;
  if (out) fs.writeFileSync(out, json);
  else process.stdout.write(json);
  if (!Object.keys(ms).length) {
    console.error(`${reports.join(', ')}: no <testcase file="…"> found — was the report made with --test-reporter=junit?`);
    process.exit(1);
  }
}
