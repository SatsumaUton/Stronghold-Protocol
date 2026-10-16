// Labels for the studio console. Pure helpers so a test can check them without the page.
import { t } from '../../../../shared/i18n.js';
import { isDiyModule } from '../../../../shared/diy.js';

/** "(row,col)". An array's default join is "11,5", which reads as 115. */
export function devicePos(pos) {
  if (Array.isArray(pos) && pos.length >= 2) return `(${pos[0]},${pos[1]})`;
  return '()';
}

/**
 * Module options for a form. A locked 自选 prototype keeps its fixed module even when isDiyModule would drop it
 * (ISW / SO / RA). A fixed id missing from the form is still listed so the control is not blank.
 * @param {any[]|null|undefined} modules
 * @param {boolean} diy
 * @param {string|null|undefined} lockedId
 */
export function moduleOptions(modules, diy, lockedId) {
  const list = Array.isArray(modules) ? modules : [];
  const fixed = typeof lockedId === 'string' && lockedId && lockedId !== 'none' ? lockedId : '';
  const out = list.filter((m) => m && (!diy || isDiyModule(m) || (fixed && m.uniEquipId === fixed)));
  if (diy && fixed && !out.some((m) => m.uniEquipId === fixed)) out.push({ uniEquipId: fixed, name: fixed });
  return out;
}

/** Stock left after placements of this owner and token. Never negative. */
export function tokenRemaining(slot, units) {
  const count = Number(slot?.count);
  const owner = slot?.ownerUid;
  const id = slot?.tokenId;
  const placed = (Array.isArray(units) ? units : []).filter((u) => u && u.kind === 'token' && u.ownerUid === owner && u.tokenId === id).length;
  const left = (Number.isFinite(count) ? count : 0) - placed;
  return left > 0 ? left : 0;
}

/**
 * One route. Walks that share a path still differ by the #index; that index is the only distinguisher.
 * @param {{ motion?: string, start?: number[], end?: number[], checkpoints?: number[][] }} route
 * @param {number} index
 */
export function routeLabel(route, index) {
  const r = route || {};
  const pair = (p) => (Array.isArray(p) && p.length >= 2 ? `${p[0]},${p[1]}` : '');
  const cps = Array.isArray(r.checkpoints) ? r.checkpoints : [];
  const via = cps.length ? `${t('经由')} ${cps.map((p) => `(${pair(p)})`).join(' ')}` : t('直达');
  return `#${(index | 0) + 1} ${r.motion || ''} (${pair(r.start)}) → (${pair(r.end)}) · ${via}`;
}
