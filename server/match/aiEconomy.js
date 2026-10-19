// §35.13, maintainer 2026-10-19. [ASSUMED] Procurement/bank policy, not a gameplay rule.
// Prices, carry bands and freeze mechanics remain PlayerEconomy/GameData's official-data rules.
import { advisorPlan, planContains } from './aiPlan.js';

// An explicitly empty plan remains the legacy delegation escape hatch (§35.9).
export function economyPlan(m, ps) {
  const plan = advisorPlan(m, ps);
  return plan && Object.keys(plan).length ? plan : null;
}

export function advisorWanted(m, ps, id) {
  const plan = economyPlan(m, ps);
  if (!plan || planContains(m, plan.sell, id)) return false;
  if (planContains(m, plan.buy, id) || planContains(m, plan.keep, id)) return true;
  // [ASSUMED] A normal copy for a prioritized bond remains useful until its elite is owned.
  const gd = ps.gd || m.gd, base = gd.baseIdOf(id);
  return !ps.allChess().some(p => gd.baseIdOf(p.id) === base && gd.isGolden(p.id))
    && !!plan.bonds?.some(b => !gd.modeInactiveBonds.has(b.id) && gd.chess(id)?.bonds?.includes(b.id));
}

export function advisorBanks(m, ps) {
  // A bank promoted into the lineup, equipped, wanted by a newer plan or part of a merge is no longer disposable.
  const gd = ps.gd || m.gd;
  return ps.hand.filter(p => p?.kind === 'chess' && ps._advisorBankUids?.has(p.uid)
    && !gd.isGolden(p.id) && !p.items?.length && !advisorWanted(m, ps, p.id)
    && !ps.completesChessMerge(p.id));
}

export function fundAdvisorPurchase(m, ps, slot) {
  if (!slot || slot.sold || slot.kind !== 'chess' || !advisorWanted(m, ps, slot.id)) return;
  const banks = advisorBanks(m, ps);
  // [ASSUMED] Keep stored value if even all base refunds cannot fund this purchase; sale hooks can only be
  // evaluated by making the real sale, so do not speculate about their additional proceeds.
  if (ps.funds + banks.reduce((n, p) => n + ps.gd.sellPrice(p.id), 0) < ps.priceOf(slot)) return;
  for (const p of banks) {
    if (ps.funds >= ps.priceOf(slot) && ps.hand.some(p => !p)) break;
    if (ps.sell(p.uid)?.ok) ps._advisorBankUids.delete(p.uid);
  }
}
