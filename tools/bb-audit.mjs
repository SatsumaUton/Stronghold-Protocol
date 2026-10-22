#!/usr/bin/env node
// tools/bb-audit.mjs — blackboard audit of another official version's data against the default (versions M0,
// docs/SIM.md §7.2).
//
// The hand-written content reads blackboard fields with a default for a missing one (`num(bb.no_attack_duration, 10)`).
// When another version's record lacks a field the default data has, that default — the 下半 meaning — silently applies
// (上半's 突袭 has no no_attack_duration, so its members would gain 下半's "10 s without attacking" trigger). This tool
// lists, per version directory:
//   * gaps: a field present in the base data and missing in the version, for the same behaviour key — bonds by bondId,
//     bands by bandId, items by the normal record's effectId (item ids are reused for other effects), garrisons by
//     (effectKey, bbStr.key) (garrison ids are season-local), effects by effectId; per buff (bbStr.key || key). Only the
//     gaps the code reads are reported, each with the code's reads; a read whose default is not neutral (0, null,
//     undefined, false, '' or Infinity) is flagged.
//   * code-named buff keys absent in the version: a buff key the code names (string literals, BY_BUFF / K.* / object
//     keys) that the base data has and the version lacks — its behaviour then never runs there.
// Code reads: server/sim/content/**/*.js (but the operator kits, which read skill blackboards) and server/match/**/*.js
// — `num|int|numOr(<expr>.<field>, <default>)`, `<expr>.<field> ?? <default>`, and plain mentions (`.field`,
// `'field'`, no default). Field names are matched by name, so a read of the same name in another table is listed too.
// Buff keys also come from server/ai/**/*.js and shared/*.js.
//
// Usage: node tools/bb-audit.mjs [--base data] --data <dir> [--data <dir>…] [--json] [--strict]
//   --base    the reference data directory (default: data/)
//   --data    a version's data directory (repeatable)
//   --json    machine-readable report on stdout: [{ dir, findings: [...], missingBuffKeys: [...] }]
//   --strict  exit code 1 when any finding or missing buff key is listed (M2: every one reviewed)
// Unknown options are errors (exit code 2).

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadData } from '../server/data.js';
import { maskComments } from './check-imports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/bb-audit.mjs [--base data] --data <dir> [--data <dir>…] [--json] [--strict]';
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });

/** Directories whose code reads blackboards (relative to the repo), and the parts skipped. */
export const READ_DIRS = Object.freeze(['server/sim/content', 'server/match']);
const SKIP = [/^server\/sim\/content\/kits\//];
/** Further directories scanned for buff keys only. */
export const KEY_DIRS = Object.freeze(['server/ai', 'shared']);

const IDENT = '[A-Za-z_][A-Za-z0-9_@]*';
const FIELD = `(?:\\.(${IDENT})|\\[['"]([^'"\\]]+)['"]\\])`;
const CALL_RE = new RegExp(`\\b(?:num|int|numOr)\\(\\s*[A-Za-z_$][\\w$.?\\[\\]'"]*?${FIELD}\\s*,\\s*([^,()]+?)\\s*\\)`, 'g');
const NULLISH_RE = new RegExp(`${FIELD}\\s*\\?\\?\\s*([^,;)\\]}?:]+)`, 'g');
const MENTION_RE = /\.([a-z][a-z0-9_@]*)\b|'([a-z][a-z0-9_@]*)'/g;
const KEY_RE = /['"`]([A-Za-z][A-Za-z0-9_]*(?:\[[a-z0-9_]+\])?)['"`]|\bK\.([A-Za-z0-9_]+)|^\s+([a-z][a-z0-9_]+)\s*[(:]/g;

/** Every `.js` file under `dir` (recursive, sorted), as paths relative to `root`. */
function jsFiles(root, dir) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && e.name.endsWith('.js')) out.push(r);
    }
  };
  walk(dir);
  return out;
}

/** The repo's sources: [{ file, text }] of `dirs` (comments masked, line numbers kept). */
export function repoSources(root = ROOT, dirs = READ_DIRS) {
  return dirs.flatMap((d) => jsFiles(root, d)).filter((f) => !SKIP.some((re) => re.test(f)))
    .map((file) => ({ file, text: maskComments(readFileSync(path.join(root, file), 'utf8')) }));
}

/** A default's source text → its value (a literal), or the text itself (an expression). */
export function parseDefault(text) {
  if (text === undefined) return undefined;
  const t = String(text).trim();
  if (t === 'null') return null;
  if (t === 'undefined') return undefined;
  if (t === 'false') return false;
  if (t === 'true') return true;
  if (t === "''" || t === '""') return '';
  if (t === 'Infinity') return Infinity;
  if (t === '-Infinity') return -Infinity;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/i.test(t)) return Number(t);
  return t;
}

/** Whether a missing field read with this default changes nothing (0, null, undefined, false, '' or Infinity). */
export const isNeutral = (d) => d === 0 || d === null || d === undefined || d === false || d === '' || d === Infinity;

/**
 * Blackboard field reads of `sources` ([{ file, text }], default: the repo): Map field → [{ default, file, line }]
 * (a plain mention has `default: undefined`; one entry per field and line, the read with a default first).
 */
export function codeReads(sources = repoSources()) {
  const out = new Map();
  const add = (field, def, file, line) => {
    if (!field) return;
    let list = out.get(field);
    if (!list) { list = []; out.set(field, list); }
    const same = list.find((r) => r.file === file && r.line === line);
    if (same) { if (same.default === undefined && def !== undefined) same.default = def; return; }
    list.push({ default: def, file, line });
  };
  for (const { file, text } of sources) {
    const lines = String(text).split('\n');
    lines.forEach((src, i) => {
      const line = i + 1;
      for (const m of src.matchAll(CALL_RE)) add(m[1] ?? m[2], parseDefault(m[3]), file, line);
      for (const m of src.matchAll(NULLISH_RE)) add(m[1] ?? m[2], parseDefault(m[3]), file, line);
      for (const m of src.matchAll(MENTION_RE)) add(m[1] ?? m[2], undefined, file, line);
    });
  }
  return out;
}

/** Buff keys the code names: Map key → [{ file, line }] (string literals, `K.<key>`, object keys at a line start). */
export function codeBuffKeys(sources = repoSources(ROOT, [...READ_DIRS, ...KEY_DIRS])) {
  const out = new Map();
  for (const { file, text } of sources) {
    String(text).split('\n').forEach((src, i) => {
      for (const m of src.matchAll(KEY_RE)) {
        const key = m[1] ?? m[2] ?? m[3];
        if (!key) continue;
        let list = out.get(key);
        if (!list) { list = []; out.set(key, list); }
        if (!list.some((r) => r.file === file && r.line === i + 1)) list.push({ file, line: i + 1 });
      }
    });
  }
  return out;
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const buffFields = (b) => Object.keys({ ...obj(b?.bb), ...obj(b?.bbStr) }).filter((k) => k !== 'key');
const buffId = (b) => (typeof b?.bbStr?.key === 'string' && b.bbStr.key) || b?.key || null;

/** `{ [buffId]: Set(field) }` of a record's buffs (fields of buffs sharing an id are merged). */
function buffsOfRecord(rec) {
  const out = {};
  for (const b of Array.isArray(rec?.buffs) ? rec.buffs : []) {
    const id = buffId(b);
    if (!id) continue;
    (out[id] ??= new Set());
    for (const f of buffFields(b)) out[id].add(f);
  }
  return out;
}

/** Whether an item record is an official normal one (not golden, not a plugin's, no effectRef). */
const officialNormalItem = (id, rec) => !!rec && rec.effectRef == null && !String(id).startsWith('item_x_') && (!rec.baseId || rec.baseId === id);

/**
 * Behaviour key → { buffId → Set(field) } per table of `data`: bonds by bondId, bands by bandId, items by the normal
 * record's effectId, garrisons by `effectKey|bbStr.key` (the record's own bb / bbStr; buff id = battleRuneKey ||
 * effectKey), effects by effectId.
 */
export function behaviourFields(data) {
  const d = obj(data);
  const out = { bonds: {}, bands: {}, items: {}, garrisons: {}, effects: {} };
  const merge = (table, key, buffs) => {
    const t = (out[table][key] ??= {});
    for (const [id, set] of Object.entries(buffs)) {
      t[id] ??= new Set();
      for (const f of set) t[id].add(f);
    }
  };
  for (const [id, rec] of Object.entries(obj(d.bonds))) merge('bonds', id, buffsOfRecord(rec));
  for (const [id, rec] of Object.entries(obj(d.bands))) merge('bands', id, buffsOfRecord(rec));
  for (const [id, rec] of Object.entries(obj(d.items))) {
    if (officialNormalItem(id, rec) && typeof rec.effectId === 'string') merge('items', rec.effectId, buffsOfRecord(rec));
  }
  for (const rec of Object.values(obj(d.garrisons))) {
    if (!rec || typeof rec.effectKey !== 'string') continue;
    const key = `${rec.effectKey}|${typeof rec.bbStr?.key === 'string' ? rec.bbStr.key : ''}`;
    merge('garrisons', key, { [rec.battleRuneKey || rec.effectKey]: new Set(buffFields(rec)) });
  }
  for (const [id, rec] of Object.entries(obj(d.effects))) merge('effects', id, buffsOfRecord(rec));
  return out;
}

/**
 * Fields the base data has and the version lacks, for the same behaviour key and buff:
 * [{ table, key, buff, field }] (sorted). A behaviour or buff the version lacks entirely is not a field gap.
 */
export function gaps(base, version) {
  const a = behaviourFields(base), b = behaviourFields(version);
  const out = [];
  for (const table of Object.keys(a)) {
    for (const [key, buffs] of Object.entries(a[table])) {
      const vb = b[table][key];
      if (!vb) continue;
      for (const [buff, fields] of Object.entries(buffs)) {
        const vf = vb[buff];
        if (!vf) continue;
        for (const field of fields) if (!vf.has(field)) out.push({ table, key, buff, field });
      }
    }
  }
  return out.sort((x, y) => `${x.table}|${x.key}|${x.buff}|${x.field}`.localeCompare(`${y.table}|${y.key}|${y.buff}|${y.field}`));
}

/** Every buff key of `data` (buff keys and bbStr.key of every record, garrison effectKey / battleRuneKey). */
export function dataBuffKeys(data) {
  const d = obj(data);
  const out = new Set();
  for (const table of ['bonds', 'bands', 'items', 'effects']) {
    for (const rec of Object.values(obj(d[table]))) {
      for (const b of Array.isArray(rec?.buffs) ? rec.buffs : []) {
        if (typeof b?.key === 'string') out.add(b.key);
        if (typeof b?.bbStr?.key === 'string') out.add(b.bbStr.key);
      }
    }
  }
  for (const g of Object.values(obj(d.garrisons))) {
    for (const k of [g?.effectKey, g?.battleRuneKey, g?.bbStr?.key]) if (typeof k === 'string' && k) out.add(k);
  }
  return out;
}

/**
 * The audit of one version against the base: `findings` = the gaps the code reads ([{ table, key, buff, field, reads,
 * nonNeutral }]), `missingBuffKeys` = the code-named buff keys of the base the version lacks ([{ key, refs }]).
 */
export function audit(base, version, { reads = codeReads(), keys = null } = {}) {
  const findings = [];
  for (const g of gaps(base, version)) {
    const r = reads.get(g.field);
    if (!r || !r.length) continue;
    findings.push({ ...g, reads: r, nonNeutral: r.some((x) => !isNeutral(x.default)) });
  }
  const missingBuffKeys = [];
  if (keys) {
    const inBase = dataBuffKeys(base), inVersion = dataBuffKeys(version);
    for (const [key, refs] of [...keys].sort(([x], [y]) => x.localeCompare(y))) {
      if (inBase.has(key) && !inVersion.has(key)) missingBuffKeys.push({ key, refs });
    }
  }
  return { findings, missingBuffKeys };
}

function parseArgs(argv) {
  const o = { base: path.join(ROOT, 'data'), data: [], json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base' && argv[i + 1]) o.base = path.resolve(argv[++i]);
    else if (a === '--data' && argv[i + 1]) o.data.push(path.resolve(argv[++i]));
    else if (a === '--json') o.json = true;
    else if (a === '--strict') o.strict = true;
    else return { error: `unknown option ${a}` };
  }
  if (!o.data.length) return { error: 'at least one --data <dir> is required' };
  return o;
}

const fmtDefault = (d) => (typeof d === 'string' ? d : String(d));
const fmtRead = (r) => `${r.file}:${r.line}${r.default === undefined ? '' : ` (default ${fmtDefault(r.default)})`}`;

function main(argv) {
  const o = parseArgs(argv);
  if (o.error) { console.error(`${o.error}\n${USAGE}`); return 2; }
  for (const d of [o.base, ...o.data]) {
    try { if (!statSync(d).isDirectory()) throw new Error(); } catch { console.error(`not a directory: ${d}`); return 2; }
  }
  const base = loadData(o.base, { log: QUIET });
  const reads = codeReads();
  const keys = codeBuffKeys();
  const reports = o.data.map((dir) => ({ dir: path.relative(ROOT, dir) || dir, ...audit(base, loadData(dir, { log: QUIET }), { reads, keys }) }));
  if (o.json) console.log(JSON.stringify(reports, (k, v) => (v === Infinity ? 'Infinity' : v), 2));
  else {
    for (const r of reports) {
      const flagged = r.findings.filter((f) => f.nonNeutral).length;
      console.log(`${r.dir}: ${r.findings.length} field gap(s) the code reads (${flagged} with a non-neutral default), ${r.missingBuffKeys.length} code-named buff key(s) absent`);
      for (const f of r.findings) {
        console.log(`  ${f.nonNeutral ? '!' : ' '} ${f.table} ${f.key} ${f.buff} .${f.field}: ${f.reads.slice(0, 4).map(fmtRead).join(', ')}${f.reads.length > 4 ? ` … +${f.reads.length - 4}` : ''}`);
      }
      for (const k of r.missingBuffKeys) {
        console.log(`  - buff key ${k.key} absent: ${k.refs.slice(0, 3).map((x) => `${x.file}:${x.line}`).join(', ')}${k.refs.length > 3 ? ` … +${k.refs.length - 3}` : ''}`);
      }
    }
  }
  const any = reports.some((r) => r.findings.length || r.missingBuffKeys.length);
  return o.strict && any ? 1 : 0;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invoked) process.exit(main(process.argv.slice(2)));
