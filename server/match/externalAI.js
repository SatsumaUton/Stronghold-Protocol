// Maintainer 2026-10-17 / 2026-10-19: external AI is a #673 strategy, with human validation and legacy fallback.
import { ERR } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { defineBotStrategy } from './botStrategyContract.js';
import { externalConfig, EXTERNAL_DEFAULTS } from './externalConfig.js';
import { httpDecision, StdioAI } from '../ai/transport.js';

export const AI_VERSION = 'sp-ai/1';
// [ASSUMED] Only seat gameplay actions. Administration, test commands, battle reports, emotes and leaving are excluded.
export const AI_ACTIONS = Object.freeze({
  band: ['g.band', 'g.bandSkip', 'g.bandFocus'],
  card: ['g.choice'],
  offer: ['g.offer', 'g.offerRefresh'],
  prep: ['g.buy', 'g.sell', 'g.move', 'g.refresh', 'g.freeze', 'g.levelUp', 'g.equip', 'g.unequip', 'g.art', 'g.destroy', 'g.reward', 'g.choice', 'g.ready', 'g.offer', 'g.offerRefresh'],
});
const clone = value => JSON.parse(JSON.stringify(value));

export function aiObservation(m, ps, { id, kind, deadline, remaining }, results) {
  // Exactly the existing wire views: no PlayerState spread, data tables, RNG, seeds or other private views.
  return clone({ v: AI_VERSION, id, public: m.publicView(), private: ps.privateView(),
    context: { kind, phase: m.phase, round: m.round, deadline, remaining, legalActions: AI_ACTIONS[kind] }, results });
}

export function validAIReply(reply, id, remaining) {
  return !!reply && typeof reply === 'object' && !Array.isArray(reply)
    && Object.keys(reply).every(k => ['v', 'id', 'intents', 'done'].includes(k))
    && reply.v === AI_VERSION && reply.id === id && typeof reply.done === 'boolean'
    && Array.isArray(reply.intents) && reply.intents.length <= remaining
    && (reply.done || reply.intents.length > 0);
}

export const EXTERNAL_BOT = defineBotStrategy({ id: 'external', decide: (m, ps, decision) => m.externalAI.start(ps, decision) });

export class ExternalAI {
  constructor(m, input, replay = false) {
    this.m = m;
    this.replay = replay;
    this.config = externalConfig(input, process.env, replay);
    this.transport = !replay && this.config.transport === 'stdio' ? new StdioAI(this.config) : null;
    this.states = new Map();
    this.jobs = new Map();
    this.seq = 0;
  }

  journalConfig() {
    return { ...Object.fromEntries(Object.keys(EXTERNAL_DEFAULTS).map(k => [k, this.config[k]])),
      ...(this.config.seats ? { seats: this.config.seats.slice() } : {}) };
  }

  start(ps, decision) {
    const m = this.m;
    if (this.config.seats && !this.config.seats.includes(ps.seat)) return false;
    let state = this.states.get(ps.playerId);
    if (!state) { state = { failures: 0, disabled: false, results: [] }; this.states.set(ps.playerId, state); }
    if (state.disabled) return false;
    // Superseded prep schedules, manual takeover, test jumps, elimination and expired windows cannot apply late replies.
    this.prune();
    const key = `${ps.playerId}:${decision.key || decision.kind}`;
    if ([...this.jobs.values()].some(j => j.key === key)) return true;
    const now = m.sched.now();
    const phaseDeadline = decision.deadline ?? m.deadline;
    // [ASSUMED] Reserve half the remaining phase for legacy; untimed phases still have the adapter's own cap.
    const budget = Math.max(0, Math.min(this.config.timeoutMs, phaseDeadline > 0 ? (phaseDeadline - now) / 2 : Infinity));
    if (budget <= 0) return false;
    const job = { ...decision, key, ps, state, used: 0, deadline: now + budget, id: null, controller: null, timer: null };
    job.timer = m.later(budget, () => this.fail(job));
    this.request(job);
    return true;
  }

  active(job) { return !this.m.disposed && !this.m.ended && job.ps.alive && job.ps.botControlled && job.valid(); }

  prune() {
    for (const job of [...this.jobs.values()]) if (!this.active(job)) this.drop(job);
  }

  request(job) {
    const id = `ai-${++this.seq}`;
    job.id = id;
    this.jobs.set(id, job);
    if (this.replay) { job.state.results = []; return; }
    job.controller = new AbortController();
    const observation = aiObservation(this.m, job.ps, { ...job, remaining: this.config.maxIntents - job.used }, job.state.results);
    job.state.results = [];
    const promise = this.transport ? this.transport.request(observation, job.controller.signal)
      : httpDecision(this.config, observation, job.controller.signal);
    promise.then(reply => {
      if (this.jobs.get(id) === job) this.m.externalReply(id, reply, false);
    }, () => {
      // Never journal or log transport diagnostics: URLs, bearer tokens and remote output may contain secrets.
      if (this.jobs.get(id) === job) this.m.externalReply(id, null, true);
    });
  }

  receive(id, reply, failed) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (!this.active(job)) { this.drop(job); return; }
    if (failed || this.m.sched.now() >= job.deadline || !validAIReply(reply, id, this.config.maxIntents - job.used)) { this.fail(job); return; }
    const { state, ps } = job;
    let completed = false;
    for (const intent of reply.intents) {
      job.used++;
      const schema = validateC2S(intent);
      const result = schema !== null || !AI_ACTIONS[job.kind].includes(intent?.t) ? { error: ERR.BAD_MSG }
        : completed || !this.active(job) ? { error: ERR.WRONG_PHASE }
          : this.m._handleSeatIntent(ps, intent);
      state.results.push({ intent, ...result });
      if (state.results.length > this.config.maxIntents) state.results.shift();
      completed ||= job.complete();
    }
    if (completed) { state.failures = 0; this.drop(job); }
    else if (reply.done || job.used >= this.config.maxIntents) this.fail(job);
    else {
      this.jobs.delete(id);
      this.request(job);
    }
  }

  fail(job) {
    if (this.jobs.get(job.id) !== job) return;
    const active = this.active(job);
    this.drop(job);
    if (!active) return;
    if (++job.state.failures >= this.config.failureLimit && !job.state.disabled) {
      job.state.disabled = true;
      this.m.log.warn?.(`[match ${this.m.roomCode}] external AI seat ${job.ps.seat} switched to legacy for this match`);
      for (const other of [...this.jobs.values()]) if (other.state === job.state) {
        const active = this.active(other);
        this.drop(other);
        if (active) other.fallback();
      }
    }
    job.fallback();
  }

  drop(job) {
    this.jobs.delete(job.id);
    this.m.cancel(job.timer);
    job.controller?.abort();
  }

  close() { for (const job of [...this.jobs.values()]) this.drop(job); this.transport?.close(); }
}
