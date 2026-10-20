// Maintainer 2026-10-19 / §35.9. [ASSUMED] Bounded, optional preferences, never a new gameplay rule.
// Keep this module independent of bot.js so the #673 legacy adapter remains usable without external IO.
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x, allowed) => object(x) && Object.keys(x).every(k => allowed.includes(k));
const integer = (x, max) => Number.isInteger(x) && x >= 0 && x <= max;
const ids = x => Array.isArray(x) && x.length <= 32 && x.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128);

export function validPlan(p) {
  if (!keys(p, ['bonds', 'buy', 'keep', 'sell', 'economy', 'items', 'placements', 'choice'])) return false;
  for (const k of ['buy', 'keep', 'sell']) if (p[k] !== undefined && !ids(p[k])) return false;
  if (p.bonds !== undefined && (!Array.isArray(p.bonds) || p.bonds.length > 8 || !p.bonds.every(b =>
    keys(b, ['id', 'priority']) && ids([b.id]) && integer(b.priority, 5) && b.priority > 0))) return false;
  if (p.economy !== undefined && (!keys(p.economy, ['saveForInterest', 'reserve', 'level', 'maxRefreshes', 'refreshAbove'])
    || Object.entries(p.economy).some(([k, v]) => k === 'saveForInterest' ? typeof v !== 'boolean'
      : !integer(v, k === 'level' ? 6 : k === 'maxRefreshes' ? 16 : 100)))) return false;
  if (p.items !== undefined && (!keys(p.items, ['keep', 'equip'])
    || (p.items.keep !== undefined && !ids(p.items.keep))
    || (p.items.equip !== undefined && (!Array.isArray(p.items.equip) || p.items.equip.length > 16
      || !p.items.equip.every(e => keys(e, ['id', 'target']) && ids([e.id, e.target])))))) return false;
  if (p.placements !== undefined && (!Array.isArray(p.placements) || p.placements.length > 16 || !p.placements.every(e =>
    keys(e, ['id', 'row', 'col', 'dir']) && ids([e.id]) && integer(e.row, 12) && integer(e.col, 10)
    && (e.dir === undefined || ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(e.dir))))) return false;
  return p.choice === undefined || (typeof p.choice === 'string' && /^a[1-9][0-9]{0,5}$/.test(p.choice));
}

export function validUsage(u) {
  return u === undefined || (keys(u, ['inputTokens', 'outputTokens', 'cachedTokens'])
    && Object.values(u).every(v => integer(v, 1e9)));
}

export const advisorPlan = (m, ps) => m.externalAI?.planFor(ps) ?? null;
const matches = (m, id, want) => id === want || m.gd.baseIdOf(id) === m.gd.baseIdOf(want);
export const planContains = (m, list, id) => !!list?.some(want => matches(m, id, want));

// [ASSUMED] Additive scores: priority 1..5 gives 6..30 points; units ±24, keep +18.
export function planUnitWeight(m, ps, id, buying = false) {
  const p = advisorPlan(m, ps);
  if (!p) return 0;
  const rec = (ps.gd || m.gd).chess(id);
  return (planContains(m, buying ? p.buy : p.keep, id) ? (buying ? 24 : 18) : 0)
    - (planContains(m, p.sell, id) ? 24 : 0)
    + (p.bonds || []).reduce((n, b) => n + (rec?.bonds?.includes(b.id) && !m.gd.modeInactiveBonds.has(b.id) ? b.priority * 6 : 0), 0);
}

export function planPlacementWeight(m, ps, id, row, col, dir) {
  const pref = advisorPlan(m, ps)?.placements?.find(p => matches(m, id, p.id));
  // [ASSUMED] A small exposure preference; legal terrain and real rehearsal still decide the layout.
  return pref && pref.row === row && pref.col === col && (!pref.dir || pref.dir === dir) ? 0.05 : 0;
}
