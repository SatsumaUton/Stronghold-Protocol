// App-owned declarative trait runtime. Loaded only for sets carrying operatorTraits.
// Kept outside /sim and /shared so legacy content identities retain their exact bytes.
// Its source hash is pinned in each participating record by the content builder.
const installed = new WeakMap();
export async function installOperatorTraits(raw, base = new URL('../../../server/sim/', import.meta.url).href) {
  const [{ Battle }, vocab, support] = await Promise.all([import(base + 'Battle.js'), import(base + 'content/dsl/vocab.js'), import(base + 'content/support/index.js')]);
  let state = installed.get(Battle);
  if (!state) {
    state = { original: Battle.prototype._setupUnit, table: [] };
    installed.set(Battle, state);
  }
  state.table = Object.values(raw?.garrisons ?? {}).filter(g => g.operatorTrait);
  if (!state.table.length) { Battle.prototype._setupUnit = state.original; return; }
  // Only the optional loader adapter wraps setup; no vanilla engine file or registry is rewritten.
  Battle.prototype._setupUnit = function(unit, ...args) {
    const kit = state.original.call(this, unit, ...args);
    if (this.contentMode !== 'full' || unit.kind !== 'op' || unit.mem.operatorTraitsInstalled) return kit;
    unit.mem.operatorTraitsInstalled = true;
    const rec = unit.def.raw;
    for (const g of state.table) {
      const tr = g.operatorTrait;
      if (tr.charId !== unit.def.charId || tr.elite !== !!rec.isGolden) continue;
      installTrait(this, unit, tr, vocab, support.unitBonds(unit));
    }
    return kit;
  };
}

function onField(u) { return !!(u && u.alive && !u.hidden && !u.removed && (u.side === 'enemy' || u.deployed)); }

/** Per holder, action node and bond; survives redeployment, discarded with the Battle. [ASSUMED] */
function installTrait(battle, unit, trait, v, ownBonds) {
  const spec = trait.spec;
  const env = { bb: unit.def.skill?.bb ?? {}, chess: unit.def.raw, def: unit.def,
    pluginId: trait.pluginId, budget: spec.budget ?? v.DEFAULT_BUDGET, spec };
  const lower = value => {
    if (Array.isArray(value)) return value.flatMap(x => {
      if (x?.layers?.bond === 'selfActive') return ownBonds.map(bond => lower({ ...x, layers: { ...x.layers, bond, activeOnly: true } }));
      return [lower(x)];
    });
    if (!value || typeof value !== 'object') return value;
    const out = Object.fromEntries(Object.entries(value).map(([k, x]) => [k, lower(x)]));
    if (out.layers && (out.layers.maxPerBattle !== undefined || out.layers.activeOnly)) {
      const body = out.layers, amount = body.amount, cap = body.maxPerBattle ?? Infinity, activeOnly = body.activeOnly;
      let used = 0;
      delete body.maxPerBattle; delete body.activeOnly;
      Object.defineProperty(body, 'amount', { enumerable: true, get() {
        if (activeOnly && !battle.getPlayer(unit.ownerId)?.bonds[body.bond]?.active) return 0;
        const n = Math.max(0, Math.min(amount, cap - used));
        // DSL charges the action before reading its amount. Reserve before addLayers dispatch can re-enter.
        used += n;
        return n;
      } });
    }
    return out;
  };
  for (const original of spec.talents ?? []) {
    const entry = lower(original);
    const { element, targetOnField, selfOnField, ...conditions } = entry.if ?? {};
    const accepts = ctx => (element === undefined || ctx?.element === element)
      && (targetOnField === undefined || onField(ctx?.target) === targetOnField)
      && (selfOnField === undefined || onField(unit) === selfOnField);
    entry.if = conditions;
    if (entry.when === 'elementBurst') {
      let last = -Infinity, seq = unit.deploySeq;
      battle.on('elementBurst', ctx => {
        if (seq !== unit.deploySeq) { seq = unit.deploySeq; last = -Infinity; }
        if (!accepts(ctx)) return;
        const rt = v.makeRuntime(battle, unit, env, ctx);
        const cd = v.resolveValue(entry.cooldown, env, rt);
        if (battle.time - last < cd || !v.evalCond(conditions, rt)) return;
        if (v.runActions(entry.do, rt)) last = battle.time;
      }, { owner: unit });
    } else {
      v.installTrigger(entry, battle, unit, env);
    }
  }
}
