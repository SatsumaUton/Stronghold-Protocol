// server/match/Match.js — the match & meta engine: state machine, timers, round loop, co-op orchestration,
// broadcasting views (DESIGN §6, §8). Rules are documented in the module headers of ./PlayerState.js, ./pool.js,
// ./board.js, ./bondsMeta.js, ./effectsMeta.js, ./choices.js, ./waves.js, ./unite.js, ./finalAssault.js,
// ./results.js, ./bot.js and in docs/META.md.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// MATCH INTERFACE (platform contract: server/lobby.js ⇄ server/match/Match.js)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// new Match(opts)
//   opts.roomCode    string                     4-letter room code (logging only)
//   opts.mode        'solo' | 'coop'
//   opts.difficulty  'FUNNY'|'NORMAL'|'HARD'|'ABYSS'
//   opts.modeId      string                     modeIdFor(mode, difficulty), e.g. 'mode_multi_hard'
//   opts.aiPicksLast boolean (optional)         the co-op room option 「AI 队友最后选择」 (room.setAiPicksLast, GitHub #338):
//                                              the strategy and 机变 drafts put every human seat before every AI seat
//                                              (MatchPhases.humansFirst); only `true` turns it on; ignored in solo
//   opts.seats       Array<{ seat: 0..3, playerId: string, name: string, isBot: boolean, connected: boolean,
//                            loadout?: { [baseChessId]: { skill: index, module: uniEquipId|'none'|null } } | null,
//                            ops?: { [charId]: { potential: 1–6, cultivate: 0–3 } } | null,
//                            notOwned?: string[] | null,
//                            diy?: { [slotBaseId]: { charId, skillIndex, uniEquipId } } | null }>
//                    sorted by seat, 1–4 entries, ≥ 1 human; solo ⇒ exactly 1 human and no bots.
//                    Bot playerIds start with 'ai_'. Seat indexes may have gaps (e.g. seats 0 and 2).
//                    `loadout` (DESIGN §16, optional): the human's operator loadout, already checked by the lobby
//                    (shared/protocol.js checkLoadout); PlayerState re-checks it against opts.data and ignores it for bots.
//                    `ops` (0.2.2, optional): the human's per-operator 潜能 / 练度 (checkLoadoutOps; missing = 潜能 6, 精英2
//                    Lv.60 — the owner's decision of 2026-10-08), re-checked and changed like the loadout (INFO_CHECK);
//                    bots fight with the defaults.
//                    `notOwned` (0.2.0 补位, optional): the base chess ids the human marked as not owned (干员持有) — fixed
//                    for the match; those chess fight as their stand-ins (PlayerState setNotOwned; bots own everything).
//                    `diy` (0.2.0 自选编队, optional): the human's 自选 picks (shared/protocol.js checkDiyPicks) — fixed for
//                    the match; the slotted operators join the human's own shop (PlayerState setDiy / initDiyStock).
//   opts.kitted      string[] (optional)        the operators a 自选 slot may field in this room (the content set's
//                                              list, lobby.kittedFor). Absent on a vanilla match, so setDiy keeps
//                                              KITTED_CHARS and a normal match stays byte-identical. A modded room
//                                              always passes it (local match, match host, test journal / replay).
//   opts.spectators  string[] (optional)        the room's spectator seats (remake feature, community report #26;
//                                              server/lobby.js): never players — see addSpectator below
//   opts.hostId      string (optional)          the room's current host (server/lobby.js room.hostId): the executor a
//                                              bot layout rehearsal is delegated to (DESIGN §14, botRehearsalDelegate);
//                                              setHost follows a migration while the match runs
//   opts.seed        uint32                     master seed for all match randomness
//   opts.matchNo     integer ≥ 1 (optional)     the room's match number (lobby: room.matchCount + 1); with the seed it
//                                              makes this match's battleIds unique within the room (DESIGN §14)
//   opts.cs          string (optional)          the content hash of the room's content set (DESIGN §32,
//                                              server/plugins/identity.js; 64 hex digits): copied into every BattleSpec
//                                              as `cs` — the sim never reads it; absent (or malformed) ⇒ specs carry none
//   opts.vs          string (optional)          the room's visual set of cosmetic plugins (DESIGN §32.6; 64 hex digits):
//                                              copied into every BattleSpec as `vs` (replays name the art) — never read
//   opts.requireCs   boolean (optional)         a room with gameplay plugins (DESIGN §32.6; the lobby sets it, the match
//                                              then runs in a match host, server/match/host/): a b.result whose
//                                              `cs` is missing or not opts.cs is refused like an implausible one — the
//                                              server simulates that battle itself
//   opts.version     string (optional)          a non-default official version's registry id (DESIGN §35.23,
//                                              shared/versions.js; the lobby passes it for such a room only, the match
//                                              then runs in that version's match host on its data): this.version, the
//                                              test journal's init.options.version, the external AI's context.gameVersion,
//                                              m.public / m.result `version` (the page reads a replayed result with it).
//                                              Absent, unknown or 'act2autochess' ⇒ this.version null (the default)
//   opts.data        frozen game data (server/data.js getData()); may lack keys while data is generated
//   opts.log         { info, warn, error, debug }
//   opts.now         () => ms epoch             injectable clock (Date.now in production)
//   opts.send(playerId, msg) → boolean          unicast; never throws; silently drops for bots, disconnected
//                                              or departed players (they get a full resync on reconnect).
//                                              `b.snap` frames may be dropped under backpressure.
//   opts.broadcast(msg) → void                  to every connected, non-departed human of the room.
//   opts.onEnd(summary) → void                  call EXACTLY ONCE when the match is over, after m.result was
//                                              sent. The platform then (synchronously) returns the room to
//                                              LOBBY and (asynchronously, next macrotask) calls dispose().
//                                              `summary` is free-form JSON (kept as room.lastSummary).
//
// start()                   Called once, right after construction. Must broadcast the first m.public and send
//                           each human its m.private. May call onEnd synchronously (the platform copes).
// handle(playerId, msg)     A validated 'g.*' intent or client-side combat report 'b.progress' / 'b.result'
//                           (msg passed validateC2S; never 'g.leave', which the
//   → { ok: true }          platform turns into onLeave). Return { error: ERR code (shared/constants.js),
//   | { error, detail? }    detail?: string } to reject. Must not throw (if it does, the platform logs and
//                           replies ERR.INTERNAL). Replies ('ok'/'error' with rid) are sent by the platform.
// onDisconnect(playerId)    A human's socket dropped. The seat is kept; apply the auto-play policy.
// onReconnect(playerId)     The human is back (new socket with its token) or re-sent hello on a live socket
//                           (a resync request). May be called without a preceding onDisconnect. Resend full
//                           state: m.public, m.private and, if a battle is on (client-side combat), the
//                           b.start of the field the player is on / watching (server-run mode: m.field + b.snap).
// setLoadout(playerId, loadout, ops?) → { ok } | { error, detail? }   (DESIGN §16; optional for the platform) a new
//                           checked operator loadout (and its 潜能 / 练度 `ops`, 0.2.2) from room.loadout. Accepted only
//                           during INFO_CHECK (the briefing's 干员调配 entry); afterwards the match's loadout is locked
//                           (WRONG_PHASE). A room whose prepLoadout rule is prep also accepts one merge during PREP
//                           while that seat has not pressed 准备 (DESIGN §34.15).
// onLeave(playerId)         The human quit permanently (g.leave, room.leave, or the 10-minute reconnect
//                           window expired). They will never return under this playerId in this match;
//                           treat as quit (AI takes over / eliminated per DESIGN). No onDisconnect follows.
// dispose()                 Stop every timer/interval and release resources. Idempotent. After dispose the
//                           platform ignores send/broadcast/onEnd from this instance.
// addSpectator(id)          (optional for the platform) A spectator seat joined during the match, came back or asked
//                           for a resync: register it (idempotent) and resend what an ELIMINATED player watching sees —
//                           m.public and, while a battle runs, the b.start (watch) of the field it watches (default: the
//                           field of the player it follows — the one it last watched, else the first player still in;
//                           server-run mode: m.field + b.snap), in a prep phase that player's board (m.field prep), or
//                           m.result once ended. A spectator gets
//                           every broadcast through the platform, never an m.private / m.toast / m.unitStats, is never
//                           a field's player or authority, and is shown fields like an eliminated player in every phase.
//                           handle(id, msg) answers only its 'g.watch' (anything else → SPECTATOR; the platform routes
//                           nothing else of it).
// removeSpectator(id)       The spectator left (room.leave / g.leave, removed by the host, reconnect window expired).
// setHost(playerId)         The room's host changed (server/lobby.js migrateHost; optional for the platform): the
//                           current executor of a delegated bot rehearsal (opts.hostId / opts.botRehearsalDelegate) —
//                           a running task of the previous host falls back to the server, later ones ask the new host.
//
// Bot seats never produce intents or hooks: the match drives bots itself (server/match/bot.js).
// Messages the match emits are the S2C 'm.*' / 'b.*' frames of DESIGN §8.2 (room.* frames are platform-owned).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Client-side combat (DESIGN §14; the default): every battle is described by a JSON BattleSpec (server/sim/spec.js).
// A normal field's owner (a connected human) simulates it in the browser and reports b.progress / b.result; a 联防 or
// boss pair field is simulated by its lowest-seat connected human (the other humans run display-only replicas).
// Bots, departed / disconnected players and fields without a connected human are simulated by the server: normal and
// 联防 fields headlessly at once (the result is released at the battle's natural end for the teammates' progress UI),
// boss fields in real time without snapshots (they share the pool). A silent authority (deadline = time limit + 15 s)
// or a disconnected one loses the field to the server, which re-simulates the spec; an implausible b.result is
// replaced by the server's own simulation (fields.js validateClientResult). The shared boss pool, the team LP and the
// overtime drain live here (b.pool ≤ 4 Hz, b.end; m.public follows a boss fight at ~1 Hz); the first end condition the
// server registers decides the Final Assault (pool 0 → victory, team LP 0 → defeat; nothing reported after a defeat is
// credited — _finalEnding, user playtest #6 item 5). No b.snap / b.ev is sent in
// this mode; g.watch hands out specs. battleIds are `<seed36>[-<matchNo36>].<round>.<seq>[.<fieldId>]` (≤ 64 chars):
// unique across the matches of a room, so a report that crossed into the next match is ignored like any stale one; a
// duplicate b.result (a browser re-sending one it believes lost) is answered ok and changes nothing.
// Bot layout rehearsals (opts.botRehearsalDelegate, off by default): a bot prep's candidate layouts go to the current
// host's browser as one b.rehearsal frame — its module Worker simulates them off the page's main thread with the same
// sim, seeds and scoring and answers b.rehearsalResult with the index of its pick (server/sim/rehearsal.js). A timeout,
// a host that changed / disconnected / left or a task this client cannot run makes the server simulate the very same
// candidates itself; the task is dropped either way, so a late answer is ignored (server/match/match/rehearsal.js).
// Solo pause (g.pause { on }, setPause): freezes the field clocks, result deadlines, server release timers, the boss
// clock and the server pacers; m.public.paused; resume shifts every clock / deadline by the pause.
// Live LP (user playtest #3 item 2): during COMBAT / 联防 m.public players[].pendingLp = min(lpCapPerRound, the counted
// leaks of the player's own battle so far) (_pendingLpView; omitted when 0) — the teammates' rows of the team panel
// show lp − pendingLp; the settlement lands with the SETTLE view, where it is gone. 联防 (user playtest #6 item 7): a
// leaker's players[].uniteLeft = its enemies still standing on the 联防 field (not spawned yet, alive, or through again;
// uncapped, live: the authority's b.progress `left`, the server-run timeline or battle; exact once the field has its
// result — _uniteLeft) and pendingLp = min(lpCapPerRound, uniteLeft): the counter falls as the helpers kill them (and
// rises when one of them splits or summons — the children are billed to the same leaker).
// User playtest #4: a match with a single human (独立模拟, or a 同盟 room started alone / with AI teammates) times no
// phase outside its battles (soloUntimed); the co-op strategy draft has ONE countdown — BAND_TURN_SECONDS per turn,
// published as m.public.deadline — AI seats pick at once and a turn that runs out takes the highlighted strategy
// (g.bandFocus → timeoutBand); g.unitStats answers m.unitStats: the stats the board's units start their next battle with.
//   opts.clientCombat  default true (env SP_COMBAT=server → false: the legacy server-run + snapshot streaming mode)
//   opts.verify        'off' | 'sample' | 'all' (env SP_VERIFY, default 'off'): re-simulate accepted client results
//                      ('sample': ~1 in 8, in later slices, mismatches logged; 'all': before accepting — the
//                      server's result wins on a mismatch)
//
// Engine-only extra options (tests / tools; the lobby never passes them):
//   opts.scheduler     RealScheduler (default, uses opts.now) | VirtualScheduler (./scheduler.js)
//   opts.registry      MetaRegistry (default: built-ins + content, ./effectsMeta.js getDefaultRegistry())
//   opts.BattleClass   Battle implementation (default server/sim/Battle.js; tests inject test/match/fakeBattle.js)
//   opts.battleContent 'full' | 'generic' | 'none' (sim content mode, default 'full')
//   opts.timerScale    multiplier on every real-time phase timer (default 1)
//   opts.combatSpeed   game seconds per real second while battles run in real time (default 2, the forced 2×)
//   opts.botRehearsal  candidate layouts a bot simulates per prep before placing (default 3, 0 = heuristic only;
//                      a whole battle per candidate: ~20–300 ms of CPU each, see server/match/bot.js createRehearsal)
//   opts.botStrategy  a registered ID or trusted server-side strategy object; defaults to SP_BOT_STRATEGY / 'legacy'
//   opts.botSliceMs    wall-clock ms of rehearsal per scheduler callback (default 8 with a real scheduler, unbounded
//                      with a virtual one); the rest runs in later callbacks (scheduleBotPrep)
//   opts.botRehearsalDelegate  offer each bot prep's layout rehearsal to the current host's browser instead (DESIGN §14;
//                      default off, env SP_BOT_REHEARSAL=host; MatchRehearsal — the server simulates a rehearsal the
//                      host did not answer with the same candidates, seeds and scoring)
//   opts.botRehearsalDelegateMs  wall-clock ms the host has to answer a delegated rehearsal (default 3000) — never an
//                      extension of the phase: the prep deadline stays the phase's own (MatchPrep.endPrep)
//   opts.headlessSliceMs  wall-clock ms per callback of a server-run normal / 联防 field (client-side combat: bots,
//                      takeovers, result verification; default 8 with a real scheduler, at once with a virtual one)
// Seats may be all bots (tools/matchrun.mjs); the lobby always has ≥ 1 human.
//
// Diagnostics: m.errors / m.errorCount (engine), m.dispatcher.errors / .errorsByKey (meta handlers), m.simErrors
// (count reported by battle results) and m.simErrorLog (Map key → { label, who, message, stack, battles, count }
// of the unique errors each finished battle recorded in battle.errors). tools/matchrun.mjs --errors prints them.
//
// Disconnect / leave policy (research 06 §10.3 + DESIGN §6.6):
//   * disconnected human: the seat keeps playing its last lineup; draft turns and prep auto-resolve at their
//     deadlines (band → 华法琳, 机变 → a random remaining card, prep → auto-ready with temp auto-resolved). Nothing is
//     bought for them unless they toggled "AI 托管" (g.autoplay { on: true }), which lets the bot play the seat.
//   * departed human (onLeave): 中途退出 counts as elimination (research 00-INDEX §3, 01 §9, 06 §7 / §10.3) — every
//     copy the seat holds returns to the shared pool at once, the seat leaves the round loop, the Final Assault
//     pairing and the boss pool; its own running normal battle is force-ended. The seat shows status 'left'. When no
//     human is left at all the match ends ('abandoned'); when nobody alive is left it ends as 'eliminated'.
//
// Code layout: this file keeps the constructor (options, seats, the per-match setup, the state fields); the methods
// live in server/match/match/, one module per concern, and are installed on Match.prototype below in a fixed order,
// with the descriptors of class methods (non-enumerable; `this` is the match, subclasses and `super` calls work as
// before):
//   platform.js      the interface above: start, handle, setLoadout, disconnect / reconnect / resync, leave, dispose
//   infra.js         error isolation, timers and the phase deadline, player lists, bonds in the pool, deploy field,
//                    meta dispatch
//   messaging.js     send / broadcast / toasts / tickers, dirty marks, flush (m.private per player, m.public throttled)
//   views.js         m.public (statuses, field progress, pendingLp / uniteLeft), the nextEnemies preview, the prep
//                    scout's m.field
//   watch.js         spectator seats, g.watch, who is shown which field, resend on reconnect, prep-scout pushes
//   intents.js       the g.* / b.* router, emotes, AI 托管, g.unitStats
//   pause.js         the solo pause
//   phases.js        INFO_CHECK, BAND_DRAFT (the strategy draft), BATTLE_CHECK, ROUND_START
//   spDraft.js       SP_DRAFT (机变) and the rolls the meta effects ask for (bounties, item ids, pools)
//   prep.js          PREP: its start, the AI seats' sliced preps, Ready, the deadline, its end
//   combat.js        battle construction, COMBAT (both modes), the per-field results, then 联防 or SETTLE
//   clientCombat.js  client-side combat bookkeeping: field records, the field clock, authority, b.start, result
//                    deadlines and releases, server runs, field completion
//   rehearsal.js     the bot layout rehearsal delegated to the current host's browser: the b.rehearsal task, its answer,
//                    its timeout and the server takeover (DESIGN §14)
//   reports.js       b.progress / b.result (validation, held boss results), SP_VERIFY
//   unitePhase.js    联防 (UNITE) in both modes and the leakers' live counts
//   bossRounds.js    FINAL_ASSAULT / HIDDEN_CORE: boss fields, the shared pool, plausibility budgets, the boss clock,
//                    b.pool, the merged team LP, overtime, bounties after a boss field
//   settle.js        SETTLE and RESULT
//   common.js        what the modules share (FLOW_TICKER_PRIORITY, DELAYS, BAND_TURN_SECONDS — re-exported here, OK,
//                    fail, BOSS_CLOCK_MS)

import { PHASE, ERR, modeIdFor } from '../../shared/constants.js';
import { msg } from '../../shared/i18n.js';
import { REVIVAL_COST, REVIVAL_MIN_DONOR_LP, REVIVAL_WINDOW_SECONDS, REVIVAL_UNAVAILABLE_REASONS,
  AFK_REMOVE_ROUNDS } from './match/common.js';
import { isContentHash } from '../../shared/plugins/identity.js';
import { DEFAULT_VERSION, versionById } from '../../shared/versions.js';
import { Battle } from '../sim/Battle.js';
import { DataSource } from '../sim/simdata.js';
import { createRng, deriveSeed } from '../sim/rng.js';
import { GameData } from './gamedata.js';
import { RealScheduler } from './scheduler.js';
import { SharedPool, drawDisabledBonds, createPoolGroups, createItemPools } from './pool.js';
import { experimentalOptions } from '../../shared/experimental.js';
import { roomCapacity } from '../../shared/playerCapacity.js';
import { PlayerState } from './PlayerState.js';
import { EffectDispatcher, getDefaultRegistry } from './effectsMeta.js';
import { setupMatchWaves } from './waves.js';
import { getBotStrategy } from './botStrategies.js';
import { GAME_SPEED, MAX_GAME_SPEED, HEADLESS_SLICE_MS } from './fields.js';
import { MatchPlatform } from './match/platform.js';
import { MatchInfra } from './match/infra.js';
import { MatchMessaging } from './match/messaging.js';
import { MatchViews } from './match/views.js';
import { MatchWatch } from './match/watch.js';
import { MatchIntents } from './match/intents.js';
import { MatchPause } from './match/pause.js';
import { MatchPhases } from './match/phases.js';
// 「深渊回响」(DESIGN-ABYSS.md): the dive's round flow and the numbers past the official table
import { MatchEcho } from './match/echoPhase.js';
import { ECHO_LAST_ROUND, echoScale, isEchoRound } from './match/echo.js';
import { echoCurveOf } from './match/echoConfig.js';
import { crossVersionEnemies } from './match/echoCrossVersion.js';
import { MatchSetupVote } from './match/setupVote.js';
import { MatchSpeedVote } from './match/speedVote.js';
import { MatchSpDraft } from './match/spDraft.js';
import { MatchPrep } from './match/prep.js';
import { MatchCombat } from './match/combat.js';
import { MatchClientCombat } from './match/clientCombat.js';
import { MatchRehearsal, REHEARSAL_ANSWER_MS } from './match/rehearsal.js';
import { MatchReports } from './match/reports.js';
import { MatchUnite } from './match/unitePhase.js';
import { MatchBoss } from './match/bossRounds.js';
import { MatchSettle } from './match/settle.js';
import { installTestTrace } from './testTrace.js';
import { MatchTestCommands } from './match/testCommands.js';
import { MatchOffers } from './match/offers.js';
import { createExternalAI } from './llmGate.js';

export { FLOW_TICKER_PRIORITY, DELAYS, BAND_TURN_SECONDS } from './match/common.js';

const BOT_REHEARSAL_DEFAULT = 3;
/** Wall-clock ms of bot layout rehearsal per scheduler callback (real time; virtual time runs it in one go). */
const BOT_SLICE_MS = 8;
const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);
/** Default combat mode: client-side unless SP_COMBAT=server. */
const envClientCombat = () => String(env('SP_COMBAT') || '').toLowerCase() !== 'server';
/** SP_VERIFY → 'off' | 'sample' | 'all'. */
export function parseVerify(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'all' || s === 'sample' ? s : 'off';
}
/** Default of the bot rehearsal delegation: off — SP_BOT_REHEARSAL=host offers it to the room's host (DESIGN §14). */
const envBotRehearsal = () => String(env('SP_BOT_REHEARSAL') || '').trim().toLowerCase() === 'host';
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

const dsCache = new WeakMap();
function dataSourceFor(data) {
  if (!data || typeof data !== 'object' || !data.chess) return undefined;
  let ds = dsCache.get(data);
  if (!ds) { ds = new DataSource(data, null); dsCache.set(data, ds); }
  return ds;
}

export class Match {
  /** @param {object} opts see MATCH INTERFACE above */
  constructor(opts) {
    if (!opts || !Array.isArray(opts.seats) || opts.seats.length === 0) throw new TypeError('Match: seats required');
    if (typeof opts.send !== 'function' || typeof opts.broadcast !== 'function' || typeof opts.onEnd !== 'function') {
      throw new TypeError('Match: send/broadcast/onEnd callbacks required');
    }
    this.opts = opts;
    this.roomCode = opts.roomCode ?? '----';
    this.mode = opts.mode === 'solo' ? 'solo' : 'coop';
    this.difficulty = opts.difficulty;
    this.modeId = opts.modeId || modeIdFor(this.mode, opts.difficulty);
    this.seed = (Number(opts.seed) >>> 0) || 1;
    this.log = opts.log || noopLog;
    this.sendFn = opts.send;
    this.broadcastFn = opts.broadcast;
    this.onEndFn = opts.onEnd;
    this.data = opts.data && typeof opts.data === 'object' ? opts.data : {};
    if (this.data.config?.version && !Object.hasOwn(this.data.config.modes || {}, this.modeId)) {
      throw new RangeError(`Match: mode ${this.modeId} is unavailable in ${this.data.config.version.id}`);
    }
    /** the room's content hash (opts.cs, DESIGN §32): every BattleSpec carries it */
    this.cs = isContentHash(opts.cs) ? opts.cs : null;
    /** the room's visual set (opts.vs, DESIGN §32.6): every BattleSpec names it */
    this.vs = isContentHash(opts.vs) ? opts.vs : null;
    /** a room with gameplay plugins (opts.requireCs): a client result must name this match's cs (reports.js) */
    this.requireCs = opts.requireCs === true && !!this.cs;
    /** a non-default official version's id (opts.version, DESIGN §35.23), else null (the default, act2autochess) */
    this.version = typeof opts.version === 'string' && opts.version !== DEFAULT_VERSION && versionById(opts.version) ? opts.version : null;
    // [ASSUMED] Only an array is a content list. Omitting the key (every vanilla match) leaves setDiy on KITTED_CHARS.
    // A copy so a caller's freeze or later mutation cannot change the check, and so the key stays off public views.
    if (Array.isArray(opts.kitted)) this.diyKitted = Object.freeze(opts.kitted.filter((id) => typeof id === 'string'));
    // The room's rule switches (DESIGN §34.15). Omitted on a vanilla match, so its own keys stay the same.
    if (opts.rules && typeof opts.rules === 'object' && !Array.isArray(opts.rules)) this.rules = Object.freeze({ ...opts.rules });
    /**
     * The interaction windows this match's content set declares (PLUGIN API v2, docs/PLUGINS.md §10b): the normalized
     * `offers` of the plugins the host installed, handed in as `opts.offers` before construction so test journals
     * and both host transports capture the same declaration snapshot. `[]` for every match whose set declares none, and then
     * no window code ever runs (MatchOffers.openOfferWindow returns before it touches the phase).
     * @type {object[]}
     */
    this.offers = Array.isArray(opts.offers) ? opts.offers : [];
    /** @type {any[]} the windows open right now (MatchOffers) */
    this.offerWin = [];
    /** @type {Map<object, any>} window → its deadline timer (tracked so dispose cancels it) */
    this._offerTimers = new Map();
    /** what runs once the last open window closes (a held-back round start / prep) */
    this._offerResume = null;
    /** window sequence (diagnostics and messages) */
    this.offerSeq = 0;
    this.gd = new GameData(this.data, this.modeId);
    /**
     * 「深渊回响」(DESIGN-ABYSS.md, 2026-11-03): `mode: 'coop'` + `variant: 'deepecho'`.
     *
     * 下面这段只有 `opts.variant === 'deepecho'` 时才成立。为 null 时：键集不变、随机流不变、
     * gamedata 的 `echoScaleOf` 保持 null（缩放就是官方表），所以独立模拟与同盟模拟一个字节都没变。
     */
    this.echoVariant = opts.variant === 'deepecho' && this.mode === 'coop' ? 'deepecho' : null;
    // 「深渊回响」：把其余三个版本里**本版没有的敌人**并进来（前缀 key，不覆盖本版），
    // 这样深潜的怪种池能跨版本，而不是只有这张图那几种（维护者 2026-11-04）。
    if (this.echoVariant === 'deepecho') {
      try {
        const extra = crossVersionEnemies(this.gd.raw && this.gd.raw.enemies);
        const n = extra ? Object.keys(extra).length : 0;
        if (n > 0) {
          // 不改共享的 data 对象：给这个 GameData 实例换一份 enemies 表
          this.gd.raw = { ...this.gd.raw, enemies: { ...this.gd.raw.enemies, ...extra } };
        }
      } catch { /* 数据缺失只是少一些怪种，绝不能让建局失败 */ }
    }
    /** 房间级深潜调参（深潜大厅的开关）；null = 默认配置。调过参的房间不进排行榜。 */
    this.echoCfg = this.echoVariant ? (opts.echo && typeof opts.echo === 'object' ? opts.echo : null) : null;
    /**
     * 深潜第一回合（显示回合）。「深渊回响」**从第 1 回合就是深潜**（维护者 2026-11-03 第二次定，
     * 取代「打完最后一个 boss 才转深潜」的旧入口）；普通房间恒为 null。
     */
    this.echoDiveStart = this.echoVariant === 'deepecho' ? 1 : null;
    /** 本回合生效的词条 id（echoWords.js）；非深潜回合为 null */
    this.echoWordsActive = null;
    /** 隐藏核心通关额外给的祝福抽取次数（DESIGN-ABYSS.md「隐藏通关的补偿」） */
    this.echoBlessingDraws = 0;
    /**
     * 隐藏核心通关的**额外祝福名额**（维护者 2026-11-05）。
     *
     * 只抬 `echoBlessingDraws` 不够：`echoBlessingDue` 会按 `_echoBlessingMax()`（3）封顶，
     * 而打完隐藏核心通常在 15 层 —— 那时 3 个名额早已拿满，多出来的抽取被静默吃掉，
     * 玩家打完隐藏 boss 什么都看不到。这里给一个**临时 +1 名额**，发出去之后清零。
     */
    this.echoBlessingBonus = 0;
    /** 排异诅咒的到期层数：bond → depth（到这一层自动解除，2026-11-05）。 */
    this.echoBannedBondsUntil = {};
    /** 「护盾」祝福指定的盟约：排异抽到它时抵消该诅咒（一次性，2026-11-05）。 */
    this.echoShieldBond = null;
    this.echoShieldOffer = null;
    this._echoShieldVotes = new Map();
    this.echoShieldEndsAt = null;
    this._echoShieldTimer = null;
    /** _echoMaybeOfferBlessing 这次是不是「名额已满、要弃选一个」的替换模式（2026-11-05）。 */
    this.echoBlessingReplace = false;
    /** 替换模式下已选定、等待弃选的新祝福 id。 */
    this.echoBlessingPendingPick = null;
    /** 替换模式的弃选候选（现有祝福 id 列表）与投票。 */
    this.echoBlessingDiscardOffer = null;
    this._echoDiscardVotes = new Map();
    this.echoBlessingDiscardEndsAt = null;
    this._echoDiscardTimer = null;
    /**
     * 挑战关（深度 5 / 10）没达成清怪线时累积的**诅咒 id 列表**（维护者 2026-11-05）。
     * 词条与效果都在 `match/echoCurse.js`：现在只会推 'erosion'（+1 侵蚀词条上限），
     * 以后别的来源（隐藏 boss 失败 / 连续团灭）直接往这里推 id 即可，显示与效果自动跟上。
     */
    this.echoCurseIds = [];
    /** 已抽到的反制祝福 id（可以重复；每次抽到都算消耗一次抽取，不占 3 个名额）—— 维护者 2026-11-05 */
    this.echoCounterIds = [];
    /**
     * 本回合随机刷新的诅咒 id（2026-11-05；`null` = 本回合没有）。
     * 只作用于本回合，不进 `echoCurseIds`，所以「净化 / 涤罪」清不掉它。
     */
    this.echoRoundCurse = null;
    /**
     * 部署禁令（2026-11-05，诅咒「封锁 / 排异」）：被封锁的地块 key（`r,c`）与被排异的盟约 id。
     * 由 `_echoApplyDeployBan` / `_echoApplyBondBan` 写入，`_echoDeployBlocked` 在落子时读。
     */
    this.echoBannedTiles = [];
    this.echoBannedBonds = [];
    /**
     * 已击杀的悬赏卡 id（2026-11-05）：悬赏怪身上带 `mods.bountyId`，`kill` 钩子记一笔，
     * 结算时用它对账「这张卡是不是真打掉了」，避免把成功的一局判成「悬赏未达成」。
     */
    this.echoBountyPaid = [];
    /** 待播报的深潜消息（诅咒 / 侵蚀词条 / 净化）；同一回合的多条合一行，见 _echoFlushAnnounce。 */
    this._echoAnnounce = [];
    /** 已拥有的祝福 id（echoBlessing.js；同类不叠加，上限 3） */
    this.echoBlessings = [];
    /** 当前三选一的候选（id 数组；null = 没有进行中的抽取） */
    this.echoBlessingOffer = null;
    /** 三选一的投票 playerId → 选项下标（纯缓存，存档不存） */
    this._echoBlessingVotes = new Map();
    if (this.echoVariant) {
      // 官方 enemyScale 表止于 ECHO_LAST_ROUND（15 档）。表内照旧用官方值，表外按同一节奏延伸。
      // 缓增段的增速可被房间配置覆盖（深潜大厅的「曲线档位」），不传配置就是默认档。
      const tier = this.gd.baseEnemyScale(ECHO_LAST_ROUND);
      const slow = echoCurveOf(this.echoCfg);
      this.gd.echoScaleOf = (r, official) => {
        if (!isEchoRound(r, ECHO_LAST_ROUND)) return official;
        const scaled = echoScale(r, tier, ECHO_LAST_ROUND, slow);
        // 诅咒「狂怒 / 甲壳」：敌方攻击 / 生命 ×系数。每次现算 —— 诅咒会被「净化」清掉，缓存会过期。
        const fx = this._echoCurseFx ? this._echoCurseFx() : null;
        if (!fx || (fx.enemyHpMul === 1 && fx.enemyAtkMul === 1)) return scaled;
        return { ...scaled, hpMul: scaled.hpMul * fx.enemyHpMul, atkMul: scaled.atkMul * fx.enemyAtkMul };
      };
    }
    if (!this.difficulty) this.difficulty = this.gd.difficulty;
    this.isSolo = this.mode === 'solo' || this.gd.isSolo;
    /**
     * Locked room-owned rules; absent for ordinary rooms.
     *
     * 「深渊回响」固定规则之一：**独立卡池**（每名博士用自己的卡池，不与他人共享）。
     * 深潜房里这个开关强制开启 —— 房主不用开、也关不掉，所以在服务端把房间配置覆盖掉，
     * 而不是只改客户端（否则读档 / 旧房间 / 直连 API 都能绕开）。
     * 手动编组（poolPlan）同理作废：「每人一池」与「房主排的几组」不可能同时成立
     * （experimentalOptions 里 `disableSharedPool && !poolPlan` 本来就会互相压制）。
     */
    const echoIndependentPool = this.echoVariant === 'deepecho';
    let expIn = opts.experimental ?? {
      revivalEnabled: opts.revivalEnabled === true,
      disableSharedPool: opts.disableSharedPool === true,
    };
    if (echoIndependentPool && expIn.poolPlan) {
      // 深潜不接受手动编组：`disableSharedPool && !poolPlan` 会让手动编组压过独立卡池。
      // 注意必须在副本上删 —— `experimentalOptions` 见到 `poolPlan: null` 会直接抛 TypeError。
      expIn = { ...expIn };
      delete expIn.poolPlan;
    }
    this.experimental = experimentalOptions(echoIndependentPool
      ? { ...expIn, disableSharedPool: true }
      : expIn);
    this.revivalEnabled = !this.isSolo && this.experimental.revivalEnabled;
    this.disableSharedPool = !this.isSolo && this.experimental.disableSharedPool;
    this.playerCapacity = roomCapacity(this.isSolo ? 'solo' : this.mode, this.experimental);
    this.capacityExperiment = !this.isSolo && this.playerCapacity > 4;
    this.twentyPlayerMode = this.capacityExperiment && this.playerCapacity === 20;
    this.disableDuckLord = this.capacityExperiment && this.experimental.disableDuckLord === true;
    this.allowRepeat = this.capacityExperiment && this.experimental.allowRepeat === true;
    /**
     * 手动指定卡池编组（移植自参考版，反馈 #49）：房主排的座位分组，每个座位一个卡池号
     * （shared/poolPlan.js 的规范形式），否则 null。单人局恒为 null —— 一个人没有分组可言。
     * 开局（以及重摇设置）时交给 createPoolGroups 的 `plan`，它直接说了算，覆盖自动分组规则。
     */
    this.poolPlan = this.isSolo ? null : this.experimental.poolPlan ?? null;
    // 实验性战斗规则（任意模式、任意容量都可用，与人数无关）：
    //   * disableLayerCap  —— 盟约层数上限 999 抬到 BOND_LAYER_SAFE_MAX（1e9），等于「不设上限」；
    //   * disableHitLimit  —— 不取消对敌方领袖的单次 ≥ BOSS_HIT_LIMIT(300000) 伤害；
    //   * enemyHpMul / enemyAtkMul —— 敌人生命 / 攻击倍率，对敌方领袖的共享生命值同样生效。
    // 注意：**不含**深潜。深潜只在真正进入深潜回合后才解除层数上限（见 layerCapOff），
    // 否则 R1–15 的开局就会和原版不同（维护者 2026-11-03 要求开局保持原版）。
    this.disableLayerCap = this.experimental.disableLayerCap === true;
    this.disableHitLimit = this.experimental.disableHitLimit === true;
    this.enemyHpMul = this.experimental.enemyHpMul ?? 1;
    this.enemyAtkMul = this.experimental.enemyAtkMul ?? 1;
    // 鸭爵叠加（本服新增）：两个前置条件缺一不可。
    //   - allowRepeat：去重时一支队伍最多一个鸭爵，叠不叠加都是 1 份，开关无从谈起。
    //   - 不能同时禁用鸭爵：鸭爵都被禁了，"鸭爵可叠加"是自相矛盾的组合。
    //     前端在勾了「禁用鸭爵策略」时会隐藏并清掉这个开关；这里再兜一层，防止手搓请求带上矛盾组合。
    this.stackDuckLord = this.allowRepeat && !this.disableDuckLord && this.experimental.stackDuckLord === true;
    this.gd.disableDuckLord = this.disableDuckLord;
    this.gd.stackDuckLord = this.stackDuckLord;
    if (opts.seats.length > this.playerCapacity) throw new RangeError('Match: seats exceed room capacity');
    /** SETTLE-only rescue state: { round, eligible: Set<playerId>, windowOpen, deadline }. */
    this._revival = null;
    /** 「AI 队友最后选择」 (opts.aiPicksLast, GitHub #338): humans draft before AI seats (MatchPhases.humansFirst) */
    this.aiPicksLast = !this.isSolo && opts.aiPicksLast === true;
    /**
     * 挂机移出（消极游戏，opts.afkRemoveRounds；默认 common.js 的 AFK_REMOVE_ROUNDS = 2，0 = 关闭）：
     * 连续这么多回合没有任何实质操作（AFK_ACTIONS）就移出该真人座位。
     *
     * 只在**开局时至少 2 个真人**的对局里生效 —— 一个人自己打单机，挂机不伤害别人，不该踢他
     * （维护者 2026-10-31 的要求，与 intents.js 的两条旧规则同一口径）。
     * 判定在每回合备战结束时（prep.js endPrep → platform.js _checkIdle）。
     */
    this.afkRemoveRounds = Number.isInteger(opts.afkRemoveRounds) && opts.afkRemoveRounds >= 0
      ? Math.min(opts.afkRemoveRounds, 100) : AFK_REMOVE_ROUNDS;
    this.ownsScheduler = !opts.scheduler;
    this.sched = opts.scheduler || new RealScheduler({ now: opts.now || Date.now, onError: (e) => this.reportError('timer', e) });
    this.registry = opts.registry || getDefaultRegistry();
    this.dispatcher = new EffectDispatcher(this, this.registry);
    this.BattleClass = typeof opts.BattleClass === 'function' ? opts.BattleClass : Battle;
    this.battleContent = opts.battleContent || 'full';
    this.timerScale = Number.isFinite(opts.timerScale) && opts.timerScale >= 0 ? opts.timerScale : 1;
    /** the battles' normal game speed; `gameSpeed` is the current battle's (speedVote.js sets it when a battle starts) */
    this.baseGameSpeed = Number.isFinite(opts.combatSpeed) && opts.combatSpeed > 0 ? Math.min(opts.combatSpeed, MAX_GAME_SPEED) : GAME_SPEED;
    this.gameSpeed = this.baseGameSpeed;
    // 战斗 2 倍速 (speedVote.js): the seats that agree, playerId → last change ms
    this._speedVotes = new Set();
    this._speedUp = false;
    this._speedVoteAt = new Map();
    /** layouts a bot rehearses per prep with the real simulation (bot.js; 0 = heuristic placement only) */
    this.botRehearsal = Number.isInteger(opts.botRehearsal) && opts.botRehearsal >= 0 ? Math.min(opts.botRehearsal, 8) : BOT_REHEARSAL_DEFAULT;
    this.bot = getBotStrategy(opts.botStrategy ?? env('SP_BOT_STRATEGY'));
    /** wall-clock budget of one rehearsal slice (scheduleBotPrep) */
    this.botSliceMs = Number.isFinite(opts.botSliceMs) && opts.botSliceMs > 0 ? opts.botSliceMs : this.sched.virtual ? Infinity : BOT_SLICE_MS;
    /**
     * Offer a bot's layout rehearsal to the current host's browser (DESIGN §14): `opts.botRehearsalDelegate`, default
     * off, env SP_BOT_REHEARSAL=host. The server simulates a rehearsal the host did not answer (see MatchRehearsal).
     */
    this.botRehearsalDelegate = opts.botRehearsalDelegate != null ? !!opts.botRehearsalDelegate : envBotRehearsal();
    /** wall-clock ms the host has to answer a delegated rehearsal (engine option: tests shorten it) */
    this.botRehearsalDelegateMs = Number.isFinite(opts.botRehearsalDelegateMs) && opts.botRehearsalDelegateMs > 0 ? opts.botRehearsalDelegateMs : REHEARSAL_ANSWER_MS;
    /** the room's current host (opts.hostId; server/lobby.js room.hostId — setHost follows a migration) */
    this.hostId = typeof opts.hostId === 'string' ? opts.hostId : null;
    /**
     * Match test mode (DESIGN §34.8 phase 2). opts.test is only forwarded for a room created with the flag.
     * The extra state exists only then, and public / result views omit the keys while this is false, so a
     * normal match stays byte-identical.
     */
    this.test = opts.test === true;
    // 本服：普通对局里有管理员座位时，也要有计量与审计状态（游戏内管理员工具）。
    // 判定用的是已校验的座位标记，不是客户端传来的任意字段。
    if (this.test || (Array.isArray(opts.seats) && opts.seats.some((s) => s && s.admin === true))) {
      /** phase deadlines are armed. false holds the callback (g.test timers) instead of scaling time to 0. */
      this.testTimers = true;
      /** successful g.test commands this match (m.result.testActions) */
      this.testActions = 0;
      /** @type {{ seq: number, playerId: string, cmd: string, args: object, at: number, ok: boolean, code?: string }[]} */
      this.testLog = [];
      /** @type {Map<string, number[]>} command → scheduler timestamps inside the rate window */
      this._testRate = new Map();
      this._testSeq = 0;
      /** the phase callback held while testTimers is false */
      this._testHeld = null;
      /** the last callback setDeadline armed, so timers can be turned off mid-phase */
      this._testArmed = null;
      /** false once the input journal stops logging (the replay decoder's line cap) */
      this.testReplayable = true;
      /** replay: stop a sliced callback after this many steps; null while recording */
      this._testSliceBudget = null;
      /** steps taken by the timer callback now running (the journal's `steps`) */
      this._testSliceCount = 0;
    }
    /** @type {Map<string, { id: string, job: any, executor: string, timer: any }>} delegated rehearsals in flight */
    this._rehearsalTasks = new Map();
    this._rehearsalSeq = 0;
    /** how this match's delegated rehearsals ended (the log lines above; the tests read it) */
    this.rehearsalStats = { delegated: 0, answered: 0, takeovers: 0 };
    /**
     * The server's own simulation pool (server/workers/roomPool.js), or null when the operator started none. It is a
     * placement decision only: `poolRehearsal` submits the same candidates the local run would simulate and falls back
     * to simulating them here whenever the pool is absent, busy or broken.
     */
    this.simPool = opts.simPool || null;
    /** how the bot rehearsals that were offered to `simPool` ended — separate from rehearsalStats (its keys are asserted) */
    this.rehearsalPoolStats = { pooled: 0, accepted: 0, fallbacks: 0 };
    this.ds = dataSourceFor(this.data);
    /** client-side combat (DESIGN §14) — see the header */
    this.clientCombat = opts.clientCombat != null ? !!opts.clientCombat : envClientCombat();
    this.verifyMode = parseVerify(opts.verify ?? env('SP_VERIFY'));
    /** wall-clock ms per slice of a server-run normal / 联防 field (virtual time: at once) */
    this.headlessSliceMs = Number.isFinite(opts.headlessSliceMs) && opts.headlessSliceMs > 0 ? opts.headlessSliceMs : this.sched.virtual ? Infinity : HEADLESS_SLICE_MS;
    this.verifyStats = { checked: 0, mismatches: 0, rejected: 0, takeovers: 0 };
    this._battleSeq = 0;
    /** solo pause (g.pause, DESIGN §14): the field clocks / deadlines are frozen while true (m.public.paused) */
    this.paused = false;
    this._pausedAt = 0;
    /** real ms spent paused this match (diagnostics) */
    this.pausedMs = 0;
    /** boss rounds (client-side combat): the throttled m.public refresh (_bossPublic) */
    this._bossPubTimer = null;
    this._bossPubAt = -Infinity;
    this._bossClockOn = false;
    /**
     * battleId prefix (DESIGN §14): the seed (+ the room's match number) — a b.progress / b.result that crossed into the
     * next match of the room (the same socket, the same field ids) never names a battle of this match.
     */
    this.battlePrefix = `${this.seed.toString(36)}${Number.isInteger(opts.matchNo) && opts.matchNo > 0 ? `-${opts.matchNo.toString(36)}` : ''}`;
    this._progressTimer = null;
    this._bossClock = null;
    this._lastPoolAt = -Infinity;
    this._poolTimer = null;
    this._lastPoolKey = '';
    this.pacer = null;

    const rng = (name) => createRng(deriveSeed(this.seed, name));
    this.rngSetup = rng('setup');
    this.rngShop = rng('shop');
    this.rngWaves = rng('waves');
    this.rngDraft = rng('draft');
    this.rngBots = rng('bots');
    this.rngMeta = rng('meta');

    /** @type {Map<string, PlayerState>} */
    this.players = new Map();
    const seen = new Set(), seatIndexes = new Set();
    for (const s of opts.seats) {
      if (!s || typeof s.playerId !== 'string' || seen.has(s.playerId)) continue;
      if (!Number.isInteger(s.seat) || s.seat < 0 || s.seat >= this.playerCapacity || seatIndexes.has(s.seat)) {
        throw new TypeError('Match: unique seat index within room capacity required');
      }
      seen.add(s.playerId);
      seatIndexes.add(s.seat);
      this.players.set(s.playerId, new PlayerState(this, s));
    }
    if (!this.players.size) throw new TypeError('Match: seats required');
    this.order = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    /**
     * Spectator seats (opts.spectators / addSpectator): playerId → a stand-in every watch path treats like an eliminated
     * human (alive false; no PlayerState, never a field's player or authority).
     * @type {Map<string, { playerId: string, isBot: false, left: false, alive: false, connected: true, spectator: true }>}
     */
    this.spectators = new Map();
    /**
     * 房主给 AI 座位指定的策略（opts.seats[].band，room.setBotBand）：AI playerId → bandId，按座位序。
     * 只在同盟房生效、一个策略只能给一个 AI 座位、且必须是当前模式开放的策略。
     * 空表 = 行为和没有这个功能时完全一致（AI 自己挑）。
     *
     * 注意：这个字段**必须永远存在**（哪怕空表）——
     * server/match/snapshot.js 的 matchSeats() 会读 m.botBands.has(...)，字段不存在时
     * snapshotMatch() 会抛异常并被吞成 null，导致**任何带 AI 座位的对局都存不了档**（断点续玩对它们失效）。
     * @type {Map<string, string>}
     */
    this.botBands = new Map();
    if (!this.isSolo) {
      const wanted = new Map();
      for (const s of Array.isArray(opts.seats) ? opts.seats : []) {
        if (s && typeof s.band === 'string' && !wanted.has(s.playerId)) wanted.set(s.playerId, s.band);
      }
      const held = new Set();
      for (const ps of this.order) {
        const band = wanted.get(ps.playerId);
        if (!ps.isBot || !band || held.has(band) || !this.gd.bandAllowed(band)) continue;
        held.add(band);
        this.botBands.set(ps.playerId, band);
      }
    }
    /** @type {Set<string>} invisible admin watchers: watched like spectators, never listed or counted */
    this.hiddenSpectators = new Set(Array.isArray(opts.hiddenSpectators) ? opts.hiddenSpectators : []);
    for (const id of Array.isArray(opts.spectators) ? opts.spectators : []) this._spectator(id);
    for (const id of this.hiddenSpectators) this._spectator(id);
    /**
     * Exactly one human seat at the start (独立模拟, or a 同盟 room started alone / with AI teammates only): nobody waits
     * on anybody, so no phase outside a battle is timed — soloUntimed (user playtest #4 item 3). The mode's own rules
     * (draft order and skip, 6 机变 cards, 联防 …) stay.
     */
    this.loneHuman = this.order.filter((p) => !p.isBot).length === 1;

    // per-match setup (DESIGN §6.5)
    const setup = setupMatchWaves(this.gd, this.rngSetup);
    this.stageId = setup.stageId;
    this.stage = this.stageId ? this.gd.stage(this.stageId) : null;
    this.factions = setup.factions;
    this.bossId = setup.bossId;
    this.hiddenBossId = setup.hiddenBossId;
    const bans = drawDisabledBonds(this.gd, this.rngSetup);
    this.disabledBonds = bans.drawn;
    this.staticInactiveBonds = bans.staticOff;
    this.bannedChess = bans.banned;
    this.poolGroups = createPoolGroups(this.gd, this.order, {
      banned: bans.banned,
      experimental: this.capacityExperiment,
      independent: this.disableSharedPool,
      fixedChunks: this.twentyPlayerMode,
      plan: this.poolPlan,
    });
    this.pool = this.disableSharedPool ? new SharedPool(this.gd, { banned: bans.banned }) : this.poolGroups[0].pool;
    this.playerPools = this.disableSharedPool || this.capacityExperiment || this.poolPlan
      ? new Map(this.poolGroups.flatMap((g) => g.playerIds.map((id) => [id, g.pool])))
      : null;
    this.playerItemPools = createItemPools(this.gd, this.poolGroups, (id) => this.players.get(id));
    this.itemPool = this.playerItemPools.get(this.poolGroups[0].playerIds[0]);
    // 自选编队 (0.2.0): each human's slotted DIY pieces get their own stock — none for one whose bonds are all off this
    // match (player/diy.js initDiyStock); no randomness is drawn here
    const off = new Set([...bans.drawn, ...bans.staticOff]);
    for (const ps of this.order) ps.initDiyStock(off);

    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.deadline = 0;
    /** Final Assault / Hidden Core: ms epoch when the overtime drain starts (m.public.overtimeAt) */
    this.overtimeAt = 0;
    this.uidSeq = 0;
    this.ended = false;
    this.disposed = false;
    this.startedAt = this.sched.now();
    /** @type {Set<any>} */
    this._timers = new Set();
    this._phaseTimer = null;
    this._infoAdvanceTimer = null;
    this.setupRevision = 0;
    this.setupVote = null;
    this._setupVoteSeq = 0;
    /** @type {Map<string, number>} last accepted 重刷本局 start per seat (30 s cooldown; DESIGN §28.21) */
    this._rerollStartAt = new Map();
    this._turnTimer = null;
    this._pubDirty = false;
    this._pubTimer = null;
    this._lastPubAt = -Infinity;
    this._lastPubJson = '';
    /** @type {Set<PlayerState>} */
    this._privDirty = new Set();
    this.errors = [];
    this.errorCount = 0;
    this.simErrors = 0;
    /** @type {Map<string, { label: string, who: string, message: string, stack: string|null, battles: number, count: number }>} */
    this.simErrorLog = new Map();
    this._prepEndQueued = false;

    this.draft = null;
    this.sp = null;
    this.wave = null;
    this.bossWaves = null;
    this.bossPairs = null; // drawn for the Final Assault, drawn anew for the Hidden Core (GitHub #845, DESIGN §35.27)
    this.bossPairsRound = null; // the round whose first plan drew bossPairs (a re-plan after a departure keeps them)
    this.fields = [];
    this.runner = null;
    /** playerId → fieldId */
    this.watchers = new Map();
    /**
     * Watch preference (community report of 2026-10-06, item 56; the idea of PR #189): viewer playerId → the player it
     * last chose to watch with a manual g.watch. Every phase reset starts an eliminated human or a spectator seat on that
     * player again (its prep board, its battle field) — else the first player still in — instead of its own empty board.
     */
    this.watchPref = new Map();
    this.lastResults = new Map();
    this.unitePlan = null;
    /** 联防 outcome for the SETTLE view: { through, helpers, leakers, losses } (settle()), null when no 联防 resolved */
    this.uniteResultView = null;
    /** server-run 联防: the leakers' counts last published (_uniteTick) */
    this._uniteLeftKey = null;
    /** 联防: { plan, bounds } — per leaker the most survivors settlement can bill (_uniteLeft's clamp) */
    this._uniteBounds = null;
    /** expanded-room 联防 relay: { rounds: [], eligible: Set } across the two fields */
    this._uniteRelay = null;
    this._normalAliveCount = 0;
    this.teamLp = null;
    this.bossPool = null;
    this.hiddenLayerSum = 0;
    this.hiddenReached = false;
    this.outcome = null;
    this._turnToken = 0;
    // [ASSUMED] A real scheduler keeps the 8 ms bot and headless slices, including a test match,
    // so one callback cannot run to HARD_CAP_SECONDS. Virtual time stays unbounded (the defaults
    // above). The input journal records the steps that callback took; replay stops there.
    this.externalAI = createExternalAI(this, opts);
    if (this.test && opts.journal !== false) installTestTrace(this, opts);
  }

  /** Helpers of this round's 联防 who cleared their own battle without a counted leak. */
  /**
   * 盟约层数上限是否解除 —— 实验房，或「深渊回响」深潜。
   *
   * 历史（维护者两次改动，别再来回翻）：
   *   1. 最初深潜也解除 → 叠到 1000+ 层，「奇迹（每 100 层）/ 远见（每 10 层）」变成无限刷新与无限资金；
   *   2. 于是回滚成原版 999；
   *   3. 2026-11-03 第二次改：深潜**重新解除**（1e9），但两个漏洞改为在**源头**堵死 ——
   *      `effectsMeta.js` 的 `bondLayerCoinCap = 60`（远见/奇迹 的按层给钱只结算到 60 层）、
   *      `effectsMeta.js` 的 `grantFreeRefresh`（深潜里免费刷新总数封顶 2）。
   * 所以「层数无上限」与「不会无限刷新 / 无限资金」现在同时成立；普通房间仍是原版 999。
   */
  get layerCapOff() {
    return this.disableLayerCap === true || this.echoVariant === 'deepecho';
  }

  _revivalHelpers(plan, uniteResult) {
    const eligible = new Set();
    if (!this.revivalEnabled || !plan || !uniteResult || uniteResult.synthetic
      || (uniteResult.reason && !['cleared', 'timeout'].includes(uniteResult.reason))) return eligible;
    for (const ps of plan.helpers || []) {
      const normal = this.lastResults.get(ps.playerId);
      if (this.players.get(ps.playerId) !== ps || !uniteResult.perPlayer?.[ps.playerId]
        || !normal || normal.synthetic || normal.perfect === false
        || (normal.leaked || []).some((l) => l && l.counted !== false)) continue;
      eligible.add(ps.playerId);
    }
    return eligible;
  }

  revivalWindowOpen() {
    const state = this._revival;
    return !!(this.revivalEnabled && !this.ended && !this.disposed && this.phase === PHASE.SETTLE
      && this.teamLp == null && state && state.windowOpen && state.round === this.round
      && this.sched.now() < state.deadline);
  }

  revivalDonorEligible(ps) {
    return !!(ps && !ps.isBot && !ps.left && ps.alive && Number.isFinite(ps.lp) && ps.lp >= REVIVAL_MIN_DONOR_LP
      && this._revival?.round === this.round && this._revival.eligible.has(ps.playerId));
  }

  revivalTargetEligible(ps) { return !!(ps && ps.pendingDeath && !ps.alive && !ps.left && !ps.revived); }

  _revivalDeathReason(ps) {
    if (ps.left) return 'left';
    if (ps.revived) return 'already-used';
    if (!this.revivalEnabled) return 'disabled';
    if (this.teamLp != null || this.ended || this.disposed) return 'match-ended';
    // 判断「本轮到底有没有人能付救援」，口径必须和客户端看到的一致。
    //
    // ⚠ 2026-10-29（维护者反馈「提示说都不足 11，但明明有人够」）：
    //   旧写法先把「有资格 + 存活」的队友筛成 helpers，再要求 every(lp < 11) 才报 donor-lp。
    //   问题在于 helpers 里**包含正要结算的这个死者自己**：他调用本函数时 alive 还是 true、
    //   lp 已经被扣到 ≤ 0。如果他是最后一个够 11 点的人，every() 就会因为「他自己不足 11」成立，
    //   于是提示「都不足 11」—— 而玩家在界面上看到的是**别人**的血量，自然会觉得提示不对。
    //
    //   现在：直接按「除死者之外、真正能付款的人」来判断，一个人都没有才说 donor-lp。
    const helperIds = this._revival?.round === this.round && this._revival.eligible
      ? this._revival.eligible
      : new Set();
    const helpers = this.order.filter((p) => p !== ps && this.players.get(p.playerId) === p
      && !p.isBot && !p.left && p.alive && helperIds.has(p.playerId));
    if (!helpers.length) return 'no-helper';
    const canPay = helpers.some((p) => Number.isFinite(p.lp) && p.lp >= REVIVAL_MIN_DONOR_LP);
    // 还有能付款的队友：这次死亡不是「没人付得起」造成的（窗口过期 / 阶段结束）。
    return canPay ? 'window-closed' : 'donor-lp';
  }

  _deferDeath(ps) {
    ps.revivalUnavailableReason = null;
    ps.lp = 0;
    ps.alive = false;
    ps.pendingDeath = true;
    ps.dirty();
    this.toast(ps, 'warn', msg('你的目标生命值耗尽，等待救援'));
  }

  _finalizeDeath(ps, { round = this.round, notify = true, reason = this._revivalDeathReason(ps) } = {}) {
    if (!ps.alive && !ps.pendingDeath) return false;
    if (ps.revivalUnavailableReason == null) {
      ps.revivalUnavailableReason = REVIVAL_UNAVAILABLE_REASONS.includes(reason) ? reason : 'window-closed';
    }
    ps.lp = 0;
    ps.eliminate(round);
    if (notify) {
      this.toast(ps, 'error', msg('你的目标生命值耗尽，已被淘汰'));
      this.tickerText(msg('{name}博士的目标生命值已耗尽', { name: ps.name }), 25);
    }
    return true;
  }

  _finalizePendingDeaths({ notify = true, reason = this.ended || this.disposed ? 'match-ended'
    : this._revival?.deadline > 0 && this.sched.now() >= this._revival.deadline ? 'window-expired' : 'window-closed' } = {}) {
    if (this._revival) this._revival.windowOpen = false;
    for (const ps of this.order) if (ps.pendingDeath) this._finalizeDeath(ps, { notify, reason });
  }

  revive(ps, message) {
    if (!this.revivalEnabled) return { error: ERR.WRONG_PHASE, detail: 'revival-disabled' };
    if (!this.revivalWindowOpen()) return { error: ERR.WRONG_PHASE, detail: 'revival-window-closed' };
    if (message.matchId !== this.battlePrefix) return { error: ERR.BAD_TARGET, detail: 'stale-match' };
    if (!Number.isInteger(message.round) || message.round !== this.round) return { error: ERR.WRONG_PHASE, detail: 'stale-round' };
    if (!ps || ps.isBot || ps.left) return { error: ERR.NOT_IN_ROOM };
    if (!ps.alive) return { error: ERR.ELIMINATED };
    if (!this.revivalDonorEligible(ps)) return { error: ERR.BAD_TARGET, detail: ps.lp < REVIVAL_MIN_DONOR_LP ? 'revival-lp-insufficient' : 'revival-not-helper' };
    const target = this.players.get(message.playerId);
    if (target && !target.alive && !target.pendingDeath && !target.left && !target.revived) return { error: ERR.BAD_TARGET, detail: 'revival-target-finalized' };
    if (target === ps || !this.revivalTargetEligible(target)) return { error: ERR.BAD_TARGET, detail: 'revival-target-ineligible' };
    target.revived = true;
    target.alive = true;
    target.pendingDeath = false;
    target.revivalUnavailableReason = null;
    target.lp = 1;
    ps.lp -= REVIVAL_COST;
    ps.stats.lpLost += REVIVAL_COST;
    target.dirty();
    ps.dirty();
    this.markPublic();
    return { ok: true };
  }

  /** The chess stock a seat draws from (its pool group; the shared pool in an ordinary match). */
  poolFor(player) {
    const id = typeof player === 'string' ? player : player?.playerId;
    if (this.capacityExperiment && !this.players.has(id)) throw new TypeError('player card pool required');
    if (!this.playerPools) return this.pool;
    const pool = this.playerPools.get(id);
    if (!pool) throw new TypeError('player card pool required');
    return pool;
  }

  /**
   * Experimental expanded rooms draft every seat at once instead of waiting for a turn.
   *
   * 并发草稿只跟「允许重复选择策略」(allowRepeat) 这个实验开关绑定：
   * 开了它才是「所有人同时选、可重复」——重复选本来就要求并发，顺序选里「队友已选」
   * 的拦截没有意义；同时这也是「跳过」按钮唯一的开关（并发草稿没有人排在后面等你让位，
   * 所以 skipBand 与前端 canSkip 都在并发时关掉跳过）。
   * 5–20 人房但没开 allowRepeat：仍是顺序草稿，保留跳过。
   */
  concurrentDraft() {
    return !!this.capacityExperiment && !this.isSolo && this.allowRepeat;
  }

  /** Experimental room card-pool bucket number (1-based); ordinary rooms are always group 1. */
  poolGroupOf(player) {
    const id = typeof player === 'string' ? player : player?.playerId;
    const group = this.poolGroups.find((g) => g.playerIds.includes(id));
    return group ? group.id : 1;
  }

  /** The equipment stock a seat draws from: its chess-pool group's. */
  itemPoolFor(player) {
    const id = typeof player === 'string' ? player : player?.playerId;
    const pool = this.playerItemPools.get(id);
    if (pool) return pool;
    if (this.poolGroups.length > 1) throw new TypeError('player item stock required');
    return this.itemPool;
  }
}

// the method modules, in this order (a name defined twice is an error, never a silent override)
for (const part of [MatchPlatform, MatchInfra, MatchMessaging, MatchViews, MatchWatch, MatchIntents, MatchPause, MatchPhases, MatchEcho, MatchSetupVote, MatchSpeedVote, MatchSpDraft, MatchPrep, MatchCombat, MatchClientCombat, MatchRehearsal, MatchReports, MatchUnite, MatchBoss, MatchSettle, MatchTestCommands, MatchOffers]) {
  for (const key of Reflect.ownKeys(part.prototype)) {
    if (key === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Match.prototype, key)) throw new Error(`Match.${String(key)} is defined twice`);
    Object.defineProperty(Match.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
  }
}
