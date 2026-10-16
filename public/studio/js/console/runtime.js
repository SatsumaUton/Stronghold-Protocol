// No wall clock in the sim: the page converts elapsed presentation time to whole fixed ticks.
import { SPEEDS } from '../../../../shared/studio/scenario.js';

export function makeRunner(battle, { cap = 240, onFrame = () => {} } = {}) {
  let playing = false, speed = 1, remainder = 0, ticks = 0;
  const capture = () => onFrame(battle.snapshot(), battle.drainEvents());
  battle.start(); capture();
  const step = n => {
    for (let i = 0; i < n && !battle.finished; i++) {
      battle.step(); ticks++;
      if (ticks >= Math.ceil(cap * 30) && !battle.finished) battle.forceEnd('timeout');
      capture();
    }
    if (battle.finished) playing = false;
  };
  return {
    battle,
    get playing() { return playing; }, get speed() { return speed; },
    play() { if (!battle.finished) playing = true; },
    pause() { playing = false; remainder = 0; },
    speedTo(value) { if (!SPEEDS.includes(value)) throw new RangeError('speed'); speed = value; },
    step(n = 1) { if (n !== 1 && n !== 30) throw new RangeError('ticks'); playing = false; remainder = 0; step(n); },
    advance(seconds) {
      if (!playing || !Number.isFinite(seconds) || seconds <= 0) return;
      remainder += Math.min(seconds, 0.2) * speed * 30;
      const n = Math.floor(remainder + 1e-9); remainder -= n; step(n);
    },
  };
}

/** Bounded diagnostics: total counts survive eviction of old entries. */
export function makeLog(limit = 300) {
  const entries = [], counts = new Map();
  return { entries, counts, add(entry) {
    counts.set(entry.key, (counts.get(entry.key) || 0) + 1);
    entries.push(entry); if (entries.length > limit) entries.splice(0, entries.length - limit);
  }, clear() { entries.length = 0; counts.clear(); } };
}

/** The heal hook runs before application; the public method's result is actual healing after caps/regen rules. */
export function observeCombat(battle, log) {
  const record = (key, source, target, amount) => log.add({ time: battle.time, key,
    source: source?.name || source?.defId || '', target: target?.name || target?.defId || '', amount });
  const hit = battle.on('damaged', ctx => record('damaged', ctx.source, ctx.target, ctx.amount), { priority: -1000 });
  const before = battle.heal;
  battle.heal = function (source, target, ...args) {
    const actual = before.call(this, source, target, ...args);
    if (actual > 0) record('heal', source, target, actual);
    return actual;
  };
  return () => { battle.off(hit); battle.heal = before; };
}

/** Observe only this view. _add is the actual loaded official instance, not an unfulfilled spawn request. */
export function observeEffects(view, log, time) {
  const undo = [];
  const wrap = (obj, key, record) => {
    if (typeof obj?.[key] !== 'function') return;
    const before = obj[key];
    obj[key] = function (...args) { const result = before.apply(this, args); record(args, result); return result; };
    undo.push(() => { obj[key] = before; });
  };
  wrap(view.debug.ofx, '_add', ([fx]) => log.add({ time: time(), key: `official:${fx.def.key}` }));
  // Procedural primitives actually accepted into renderer pools; numbers are shown in the combat log instead.
  wrap(view.debug.fx, 'particle', ([texture], result) => { if (result) log.add({ time: time(), key: `procedural:particle:${texture}` }); });
  for (const name of ['ring', 'attack', 'simFx', 'deploy', 'death', 'skill']) {
    wrap(view.debug.fx, name, args => log.add({ time: time(), key: `procedural:${name}${name === 'simFx' ? `:${args[0]}` : ''}` }));
  }
  return () => undo.reverse().forEach(fn => fn());
}

export function inspectUnit(unit) {
  if (!unit) return null;
  const stats = unit.s;
  return { id: unit.id, uid: unit.uid, defId: unit.defId, name: unit.name, alive: unit.alive, deployed: unit.deployed,
    hp: unit.hp, maxHp: stats.maxHp, atk: stats.atk, def: stats.def, res: stats.res, aspd: stats.aspd,
    interval: stats.interval, block: stats.blockCnt, sp: unit.skill?.spTotal ?? unit.skill?.sp ?? 0,
    spMax: unit.skill?.spCost ?? 0, skillActive: !!unit.skill?.active, flags: stats.flags,
    buffs: (unit.buffs || []).map(b => ({ key: b.key, stacks: b.stacks, timeLeft: Number.isFinite(b.timeLeft) ? b.timeLeft : null, mods: b.mods })),
    totals: { ...unit.stats } };
}
