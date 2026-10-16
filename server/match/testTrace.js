// Test-only input journal. [ASSUMED] JSON lines go to the existing server logger, never to a
// client-selected path. Record actual timer execution order as well as platform inputs: wall
// clock jitter must not change a replay. No record buffer grows with the duration of a match.
export const TEST_INPUT_METHODS = Object.freeze([
  'start', 'handle', 'setLoadout', 'onDisconnect', 'onReconnect', 'onLeave', 'setHost',
  'addSpectator', 'removeSpectator', 'requestSetupReroll', 'cancelSetupReroll', 'dispose',
]);
const clone = (v) => JSON.parse(JSON.stringify(v));

export function installTestTrace(m, opts) {
  const scheduler = m.sched;
  let seq = 0;
  let depth = 0;
  let eventNow = null;
  let record = 0;
  const emit = (entry) => {
    const json = JSON.stringify(entry);
    const write = (line) => m.log.info?.(`[test-input ${m.roomCode}] ${line}`);
    // Match-host logs have a 4000-byte IPC limit. Chunk large inputs (loadouts/results)
    // before forwarding; 512 UTF-16 units fit even after JSON escaping and UTF-8 encoding.
    if (json.length <= 512) { write(json); return; }
    const id = ++record, parts = Math.ceil(json.length / 512);
    for (let part = 0; part < parts; part++) write(JSON.stringify({ kind: 'chunk', id, part, parts, text: json.slice(part * 512, (part + 1) * 512) }));
  };
  const options = {};
  for (const key of ['roomCode', 'mode', 'difficulty', 'modeId', 'seats', 'spectators', 'seed', 'matchNo', 'hostId', 'aiPicksLast', 'cs', 'vs', 'requireCs']) {
    if (opts[key] !== undefined) options[key] = clone(opts[key]);
  }
  Object.assign(options, {
    test: true, seed: m.seed, timerScale: m.timerScale, combatSpeed: m.gameSpeed,
    clientCombat: m.clientCombat, verify: m.verifyMode, battleContent: m.battleContent,
    botRehearsal: m.botRehearsal, botRehearsalDelegate: m.botRehearsalDelegate,
    botRehearsalDelegateMs: m.botRehearsalDelegateMs,
  });
  emit({ version: 1, kind: 'init', at: m.startedAt, options, virtual: scheduler.virtual, instant: scheduler.instant });
  const register = (method, fn, ms) => {
    const id = ++seq;
    return scheduler[method](() => {
      const previous = eventNow; eventNow = scheduler.now();
      emit({ kind: 'timer', at: eventNow, id });
      depth++;
      try { fn(); } finally { depth--; eventNow = previous; }
    }, ms);
  };
  m.sched = {
    virtual: scheduler.virtual, instant: scheduler.instant,
    now: () => eventNow ?? scheduler.now(),
    setTimeout: (fn, ms) => register('setTimeout', fn, ms),
    setInterval: (fn, ms) => register('setInterval', fn, ms),
    clearTimeout: (h) => scheduler.clearTimeout(h),
    clearInterval: (h) => scheduler.clearInterval(h),
    dispose: () => scheduler.dispose(),
  };
  for (const method of TEST_INPUT_METHODS) {
    const original = m[method];
    if (typeof original !== 'function') continue;
    m[method] = function (...args) {
      const external = depth === 0;
      const previous = eventNow;
      if (external) { eventNow = scheduler.now(); emit({ kind: 'call', at: eventNow, method, args: clone(args) }); }
      depth++;
      try { return original.apply(this, args); } finally { depth--; eventNow = previous; }
    };
  }
}
