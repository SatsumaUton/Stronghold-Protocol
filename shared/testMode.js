// shared/testMode.js — match test-mode command catalogue (DESIGN §34.8 phase 2).
// Plain ESM, no Node APIs. The protocol and the browser import it. The server applies a parsed
// command with the match's own primitives; this module only accepts or refuses the shape.
//
// [ASSUMED] No official source settles a test console. Bounds are absolute and strict (a value
// outside them is an error, never a clamp): funds 0..99999, LP 0..999, team LP 0..9999, bond
// layers 0..BOND_LAYER_CAP, shop lists of 1..12 slots, round 1..99 (the match rechecks the mode's
// last / hidden round). A shape the catalogue does not name is BAD_MSG. A present field of the
// wrong type or out of range is BAD_TARGET. A shape refusal is audited as { rejected: true } so
// the log does not keep the raw payload.

import { BOND_LAYER_CAP } from './constants.js';

export const TEST_FUNDS_MAX = 99999;
export const TEST_LP_MAX = 999;
export const TEST_TEAM_LP_MAX = 9999;
export const TEST_LAYERS_MAX = BOND_LAYER_CAP;
export const TEST_SHOP_SLOTS_MAX = 12;
export const TEST_ROUND_MAX = 99;
export const TEST_RATE_COUNT = 8;
export const TEST_RATE_WINDOW_MS = 10_000;
export const TEST_LOG_CAP = 200;
export const TEST_PUBLIC_LOG = 12;

export const TEST_COMMANDS = Object.freeze([
  'funds', 'chess', 'item', 'token', 'lp', 'hp', 'teamLp', 'round', 'phase',
  'shop', 'timers', 'bond', 'strategy', 'level', 'bounty', 'choice',
]);

/** Phase jumps the match can make by calling a phase method it already has. */
export const TEST_PHASES = Object.freeze(['advance', 'battleCheck', 'prep', 'sp', 'combat']);

const CMD = new Set(TEST_COMMANDS);
const PHASES = new Set(TEST_PHASES);

export const isTestCommand = (v) => typeof v === 'string' && CMD.has(v);

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64 && !['__proto__', 'prototype', 'constructor'].includes(v) && /^[A-Za-z0-9_\-.:]+$/.test(v);

/** `args` omitted is {}. A non-plain object or an unknown key is BAD_MSG.
 * @returns {{ error: 'BAD_MSG', args?: undefined } | { args: any, error?: undefined }}
 */
function exact(args, keys) {
  const a = args === undefined ? {} : args;
  if (!isPlain(a)) return { error: 'BAD_MSG' };
  const got = Object.keys(a);
  if (got.length > 8) return { error: 'BAD_MSG' };
  for (const k of got) if (!keys.includes(k)) return { error: 'BAD_MSG' };
  return { args: a };
}

/**
 * Strict parse of one `g.test` body. `{ error }` or `{ args }` — `args` is a fresh plain object
 * containing only the fields the command accepts.
 * @param {string} cmd
 * @param {object} [args]
 * @returns {{ error: 'BAD_MSG' | 'BAD_TARGET' } | { args: object }}
 */
export function parseTestArgs(cmd, args) {
  if (!isTestCommand(cmd)) return { error: 'BAD_MSG' };
  switch (cmd) {
    case 'funds': {
      const r = exact(args, ['amount']);
      if (r.error) return r;
      if (!isInt(r.args.amount, 0, TEST_FUNDS_MAX)) return { error: 'BAD_TARGET' };
      return { args: { amount: r.args.amount } };
    }
    case 'chess':
    case 'item':
    case 'bounty': {
      const key = cmd === 'bounty' ? 'enemyKey' : 'id';
      const r = exact(args, [key]);
      if (r.error) return r;
      if (!isId(r.args[key])) return { error: 'BAD_TARGET' };
      return { args: { [key]: r.args[key] } };
    }
    case 'token': {
      const r = exact(args, ['id', 'ownerUid']);
      if (r.error) return r;
      if (!isId(r.args.id) || !isInt(r.args.ownerUid, 1, 2 ** 31)) return { error: 'BAD_TARGET' };
      return { args: { id: r.args.id, ownerUid: r.args.ownerUid } };
    }
    case 'lp':
    case 'hp':
    case 'teamLp': {
      const hi = cmd === 'lp' ? TEST_LP_MAX : cmd === 'teamLp' ? TEST_TEAM_LP_MAX : 1e9;
      const r = exact(args, ['value']);
      if (r.error) return r;
      if (!isInt(r.args.value, 0, hi)) return { error: 'BAD_TARGET' };
      return { args: { value: r.args.value } };
    }
    case 'round': {
      const r = exact(args, ['round']);
      if (r.error) return r;
      if (!isInt(r.args.round, 1, TEST_ROUND_MAX)) return { error: 'BAD_TARGET' };
      return { args: { round: r.args.round } };
    }
    case 'phase': {
      const r = exact(args, ['name']);
      if (r.error) return r;
      if (!PHASES.has(r.args.name)) return { error: 'BAD_TARGET' };
      return { args: { name: r.args.name } };
    }
    case 'shop': {
      const r = exact(args, ['slots']);
      if (r.error) return r;
      const slots = r.args.slots;
      if (!Array.isArray(slots) || slots.length < 1 || slots.length > TEST_SHOP_SLOTS_MAX) return { error: 'BAD_TARGET' };
      const out = [];
      for (const s of slots) {
        if (!isPlain(s) || Object.keys(s).length !== 2 || !Object.hasOwn(s, 'kind') || !Object.hasOwn(s, 'id')) return { error: 'BAD_MSG' };
        if (s.kind !== 'chess' && s.kind !== 'item') return { error: 'BAD_TARGET' };
        if (!isId(s.id)) return { error: 'BAD_TARGET' };
        out.push({ kind: s.kind, id: s.id });
      }
      return { args: { slots: out } };
    }
    case 'timers': {
      const r = exact(args, ['on']);
      if (r.error) return r;
      if (typeof r.args.on !== 'boolean') return { error: 'BAD_TARGET' };
      return { args: { on: r.args.on } };
    }
    case 'bond': {
      const r = exact(args, ['id', 'layers', 'count']);
      if (r.error) return r;
      if (!isId(r.args.id) || !isInt(r.args.layers, 0, TEST_LAYERS_MAX)) return { error: 'BAD_TARGET' };
      if (r.args.count !== undefined && !isInt(r.args.count, 0, 99)) return { error: 'BAD_TARGET' };
      return { args: { id: r.args.id, layers: r.args.layers, ...(r.args.count === undefined ? {} : { count: r.args.count }) } };
    }
    case 'strategy': {
      const r = exact(args, ['id', 'resetLp']);
      if (r.error) return r;
      if (!isId(r.args.id)) return { error: 'BAD_TARGET' };
      const out = { id: r.args.id };
      if (r.args.resetLp !== undefined) {
        if (typeof r.args.resetLp !== 'boolean') return { error: 'BAD_TARGET' };
        out.resetLp = r.args.resetLp;
      }
      return { args: out };
    }
    case 'level': {
      const r = exact(args, []);
      if (r.error) return r;
      return { args: {} };
    }
    case 'choice': {
      const r = exact(args, ['idx', 'choiceId']);
      if (r.error) return r;
      if (!isInt(r.args.idx, 0, 5)) return { error: 'BAD_TARGET' };
      const out = { idx: r.args.idx };
      if (r.args.choiceId !== undefined) {
        if (!isId(r.args.choiceId)) return { error: 'BAD_TARGET' };
        out.choiceId = r.args.choiceId;
      }
      return { args: out };
    }
    default:
      return { error: 'BAD_MSG' };
  }
}
