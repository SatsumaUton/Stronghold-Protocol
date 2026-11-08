// server/match/match/platform.js — Match methods: the platform interface of the server/match/Match.js header
// (server/lobby.js ⇄ Match) — start, handle (validation, error isolation, flush; the intents themselves: intents.js
// _handle), setLoadout (INFO_CHECK; rule-enabled PREP), onDisconnect / onReconnect and the full resync of one human, onLeave and 中途退出
// = elimination (_quit), dispose.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { C2S } from '../../../shared/protocol.js';
import { PHASE, ERR } from '../../../shared/constants.js';
import { syntheticResult } from '../fields.js';
import { FLOW_TICKER_PRIORITY, OK, fail, OFFLINE_TAKEOVER_ROUNDS, AFK_REMOVE_ROUNDS_DEEPECHO } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { ruleOption } from '../../../shared/plugins/rules.js';

const GAME_TYPES = new Set(Object.keys(C2S).filter((t) => Object.hasOwn(C2S, t) && (t.startsWith('g.') || t.startsWith('b.'))));

export class MatchPlatform {
  start() {
    if (this.disposed || this.ended || this.phase !== PHASE.LOBBY) return;
    this.guard(() => {
      if (!this.gd.visibleChess.length || this.pool.entries.size === 0) {
        this.log.error?.(`[match ${this.roomCode}] game data unusable (no chess pool) — ending the match`);
        this.phase = PHASE.INFO_CHECK;
        this.markPublic();
        this.flush(true);
        this.finish({ victory: false, reason: 'error' });
        return;
      }
      this.enterInfoCheck();
    });
  }

  /**
   * @param {string} playerId
   * @param {{ t: string }} msg validated intent
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  handle(playerId, msg) {
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    if (!ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    return this._handleSeatIntent(ps, msg);
  }

  /** Shared human / external-AI semantic validation and dispatch. C2S schema: net.js / the adapter. */
  _handleSeatIntent(ps, msg) {
    // a spectator seat only watches (the platform routes nothing else of it)
    if (ps.spectator && (!msg || msg.t !== 'g.watch')) {
      // g.test shares the host's rate bucket (applyTestCommand audits SPECTATOR after the stamp).
      if (this.test && msg?.t === 'g.test') {
        let res;
        try { res = this.applyTestCommand(ps, msg); }
        catch (e) { this.reportError('handle g.test', e); res = fail(ERR.INTERNAL); }
        try { this.flush(); } catch (e) { this.reportError('flush', e); }
        return res && res.error ? res : OK;
      }
      return fail(ERR.SPECTATOR);
    }
    if (this.disposed || this.ended) {
      // A report that crossed the match end (the last b.progress of a field, a delegated rehearsal's answer) is stale:
      // ignored, never an error (DESIGN §14 — an error frame without a rid would surface as a toast in the browser).
      if (msg && msg.t === 'b.rehearsalResult') return OK;
      return this.clientCombat && msg && (msg.t === 'b.progress' || msg.t === 'b.result') ? OK : fail(ERR.WRONG_PHASE);
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string' || !GAME_TYPES.has(msg.t)) return fail(ERR.BAD_MSG);
    let res;
    try {
      res = this._handle(ps, msg);
    } catch (e) {
      this.reportError(`handle ${msg.t}`, e);
      res = fail(ERR.INTERNAL);
    }
    try { this.flush(); } catch (e) { this.reportError('flush', e); }
    if (res && typeof res === 'object' && res.error) return res;
    return OK;
  }

  /** Host-only asynchronous input, journalled by testTrace; never a C2S message. */
  externalReply(id, reply, failed) {
    this.guard(() => this.externalAI?.receive(id, reply, failed));
  }

  /**
   * room.loadout during the match (DESIGN §16): only while INFO_CHECK runs (the briefing's 干员调配 entry); the lobby
   * already checked it against the data (PlayerState.setLoadout re-checks it). `ops` (0.2.2): the per-operator 潜能 /
   * 练度 that come with it (undefined = unchanged). A room whose prepLoadout rule is prep also accepts one merge
   * during PREP while that seat has not pressed 准备 (DESIGN §34.15). INFO_CHECK stays a full replace.
   * @param {string} playerId
   * @param {Record<string, { skill: number, module: string|null }> | null} loadout
   * @param {Record<string, { potential: number, cultivate: number }> | null} [ops]
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  setLoadout(playerId, loadout, ops = undefined) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    const prep = this.phase === PHASE.PREP && ruleOption(this.rules, 'prepLoadout') === 'prep';
    if (this.disposed || this.ended || (this.phase !== PHASE.INFO_CHECK && !prep)) return fail(ERR.WRONG_PHASE, 'loadout locked for this match');
    if (prep && ps.ready) return fail(ERR.WRONG_PHASE, 'loadout locked for this match');
    let res = OK;
    this.guard(() => {
      const before = prep ? ps.allChess().map((owner) => ({ owner, loadout: ps.loadoutFor(ps.gd.chess(owner.id)) })) : [];
      if (!ps.setLoadout(loadout, ops, prep ? { merge: true } : undefined)) { res = fail(ERR.BAD_TARGET, 'loadout does not match the game data'); return; }
      if (prep) {
        for (const { owner, loadout: previous } of before) {
          const next = ps.loadoutFor(ps.gd.chess(owner.id));
          if (['skillIndex', 'moduleId', 'potential', 'cultivate'].some((key) => previous[key] !== next[key])) ps._reconcileTokensFor(owner);
        }
        ps.recompute();
      } else this.markPrivate(ps);
    });
    return res;
  }

  /**
   * room.skins during the match (docs/SKINS.md): accepted in ANY phase, unlike the loadout just above. The loadout is
   * locked at INFO_CHECK because it changes what a unit does; a skin changes only what it looks like, and it is public —
   * a teammate picking a different model mid-match is harmless, so `markPublic` carries it to everyone on the next
   * broadcast. The lobby already filtered the shape (freezeSkins); PlayerState.setSkins re-checks it and refuses a
   * bad map without clearing the choice already stored.
   * @param {string} playerId
   * @param {Record<string, string> | null} skins
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  setSkins(playerId, skins) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    let res = OK;
    this.guard(() => {
      // an empty selection is a valid one: it clears every skin. A bad map leaves the stored choice alone.
      if (!ps.setSkins(skins)) { res = fail(ERR.BAD_MSG, 'bad skin selection'); return; }
      // [ASSUMED] Live cosmetic changes refresh every existing prep view, using the same dirty path as a move.
      // The public choice also reaches current battle renderers; no running sim or BattleSpec is changed.
      this.markPrivate(ps);
      this.markPublic();
    });
    return res;
  }

  onDisconnect(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || this.disposed) return;
    this.guard(() => {
      ps.connected = false;
      // A disconnected human's silence is never consent to a new setup.
      this.cancelSetupVote();
      // 「暂停游戏」：掉线的人不算「没确认」，全员走光就直接恢复（pauseVote.js）
      try { this._pauseMemberGone?.(); } catch { /* ignore */ }
      // a paused solo battle resumes (the server takes the field over; nobody is left to resume it) —— 但**投票暂停**
      // 例外：一个人的连接断了不代表别人同意继续，这里 _resume 会把 `paused` 直接清掉（玩家仍停在浮层上，
      // 却已经恢复计时）。投票暂停的结束只走 `_echoPauseEnd`。
      if (!this.echoPaused) this._resume();
      if (this.clientCombat) this._authorityLost(ps, 'disconnect');
      // a rehearsal this host was running falls back to the server (DESIGN §14; a no-op without tasks)
      this._rehearsalHostChanged();
      // 投票移出：掉线的投票人会被剔除并重算（目标掉线不算，它本来就不在投票人里）
      try { this._kickVoteMemberGone?.(playerId); } catch { /* ignore */ }
      this.markPublic();
    });
  }

  onReconnect(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || this.disposed) return;
    this.guard(() => {
      const was = ps.connected;
      ps.connected = true;
      ps.offlineRounds = 0;
      // 掉线由 AI 接管：回到局里就重新自己打（玩家自己开的 AI 托管保持不动）
      const released = ps.offlineAutoplay && ps.autoplay && !this.ended;
      ps.offlineAutoplay = false;
      if (released) ps.autoplay = false;
      // 针对这个座位的投票随接管一起结束（kickVote.js）
      try { this._kickVoteMemberGone?.(playerId, true); } catch { /* ignore */ }
      // 「暂停游戏」中回来：他要重新确认一次才能继续（pauseVote.js 只数在线的人）
      if (this.echoPaused) this.markPublic();
      this._resync(ps);
      if (released) {
        try { this.toast(ps, 'info', msg('你已重新连接，AI 托管已解除')); } catch { /* ignore */ }
        try {
          this.tickerText(msg('{name}博士已重新连接，收回了 AI 托管的席位', { name: ps.name }), FLOW_TICKER_PRIORITY);
        } catch { /* ignore */ }
      }
      if (!was || released) this.markPublic();
    });
  }

  /**
   * The full state of one human (a reconnect, a resync, a spectator seat): m.public, its m.private (players only), the
   * field it is on / watches — a spectator, like an eliminated player, the field of the player it follows (item 56),
   * else the first; in a prep phase that player's board — or the result once ended.
   */
  _resync(ps) {
    const playerId = ps.playerId;
    this.sendTo(playerId, this.publicView());
    if (!this.ended) {
      if (!ps.spectator) {
        ps._lastPriv = null;
        this._sendPrivate(ps, true);
      }
      if (this.clientCombat) this._resendBattle(ps);
      else if (!this.fields.length && this._follows(ps)) this._followScout(ps, { keep: true });
      else {
        let fid = this.watchers.get(playerId);
        if (!fid && ps.spectator && this.fields.length) { fid = (this._watchTargetField(ps, this.fields) || this.fields[0]).fieldId; this.watchers.set(playerId, fid); }
        if (fid) this._sendField(playerId, fid);
      }
    } else if (this.lastResultMsg) {
      this.sendTo(playerId, { ...this.lastResultMsg, playerId });
    }
  }

  /**
   * 挂机移出 / 消极游戏（移植自参考版 platform.js 的 _checkIdle，维护者 2026-11-02 要求）。
   *
   * 判据与参考版一致：**每回合备战结束时**数一遍，看这个真人在这一回合有没有**实质操作**
   * （common.js 的 AFK_ACTIONS：普通房 13 条 —— 买/卖/移动/刷新/升级/冻结/装备/销毁/选择/领奖/复活/选盟约/跳过盟约；
   * 另有「深渊回响」的 9 条 —— 祭坛/祝福/弃选/刷新祝福/补给/投影/护盾/反制/放弃深潜）。
   * 深潜的回合数下限是 `AFK_REMOVE_ROUNDS_DEEPECHO`（3），普通房用配置值（默认 2）。
   *
   * ★ 三条关键口径（这是参考版比原来那两条规则好的地方）：
   *   1. **掉线不算挂机**（`!ps.connected` 归零）。原来那版没有这个判断 ——
   *      掉线的人发不了指令，会被当成「连续 2 回合什么都没做」踢掉，
   *      而他其实只是网断了，回来发现座位没了。这是这次移植要修的主要问题。
   *   2. **AI 托管中不算挂机**（`ps.botControlled` 归零）：托管是主动交出去的，不是消极。
   *   3. **移出前一回合先警告**一次（toast + 私有视图），不是突然踢人。
   *
   * 谁不判定（判据与参考版一致，维护者 2026-11-07 定：改回**建局快照**，不再实时数真人）：
   *   * **单人模式**（`mode: 'solo'`）：一个人自己打单机，挂机不伤害别人（维护者 2026-10-31 的要求保留）。
   *   * **合作房里开局就只有一个真人**（一真人 + 若干 AI，`loneHuman`）：同上，参考版也不判定。
   * 判据是 `Match.loneHuman`（Match.js 构造函数里算的那一次，存档也存它），**不是**实时数真人：
   * 「2 人开局、中途走掉一个」之后**仍然继续判定** —— 剩下那个人挂机，参考版照样在第 N 个备战结束
   * 把他移出。实时数的写法会让这局变成「单人局」而停止判定，等于给中途退出的房间开后门。
   * `afkRemoveRounds = 0` 可整体关闭。
   */
  /**
   * 实际生效的挂机回合数：普通房用配置值（`afkRemoveRounds`，0 = 关闭）；
   * 「深渊回响」至少 `AFK_REMOVE_ROUNDS_DEEPECHO` 回合 —— 深潜准备期更长、深层可做的事更少，
   * 普通房的 2 回合对深潜太严格（维护者 2026-11-07 晚）。判定与警告（player/views.js afkWarned）共用这一个口径。
   */
  _afkLimit() {
    const base = this.afkRemoveRounds;
    if (!(base > 0)) return base;
    return this.echoVariant === 'deepecho' ? Math.max(base, AFK_REMOVE_ROUNDS_DEEPECHO) : base;
  }

  _checkIdle() {
    const limit = this._afkLimit();
    if (!(limit > 0) || this.ended || this.disposed) return;
    // 单人模式 / 合作房里开局就只有一个真人：连计数都不必维护（合作房看建局快照 soloUntimed === loneHuman，
    // 中途有人退出不改变这个判定；solo 模式恒不判定）
    if (this.isSolo || this.soloUntimed) return;
    const humans = this.order.filter((p) => !p.isBot && !p.left && p.alive);
    // 第一遍：结算本回合计数（有操作 / 托管 / 掉线 → 归零，否则 +1）
    for (const ps of humans) {
      // 维护者 2026-11-05：管理员不受任何惩罚机制 —— 挂机计数永远归零，既不警告也不移出
      if (this._isPunishImmune(ps)) { ps.afkRounds = 0; ps.afkActed = false; continue; }
      ps.afkRounds = (ps.afkActed || ps.botControlled || !ps.connected) ? 0 : (ps.afkRounds | 0) + 1;
      ps.afkActed = false;
    }
    // 第二遍：警告或移出（移出可能结束整局，所以每步都重新检查状态）
    for (const ps of humans) {
      if (this.ended || this.disposed) return;
      if (ps.left) continue;
      if (ps.afkRounds >= limit) this._removeIdle(ps);
      else if (limit > 1 && ps.afkRounds === limit - 1) {
        try { this.toast(ps, 'warn', '你本回合没有任何操作，下回合备战仍无操作将被移出对局'); } catch { /* ignore */ }
        this.markPrivate(ps);
      }
    }
  }

  /**
   * 掉线由 AI 接管（OFFLINE_TAKEOVER_ROUNDS，参考版口径；维护者 2026-11-06 要求移植）：
   * 每次**备战结束**数一遍（排在挂机判定之后）。连续 N 个备战结束时该座位都掉线 → 从下一阶段起由 AI 打
   *（`autoplay = true` + `offlineAutoplay = true`），全队看到一条 ticker；重连即收回（onReconnect）。
   * **只有 `offlineAutoplay` 的座位才允许被「投票移出」** —— 掉线一两回合的人不该被踢。
   */
  _checkOffline() {
    if (this.ended || this.disposed) return;
    for (const ps of this.order) {
      if (ps.isBot || ps.left || !ps.alive) continue;
      ps.offlineRounds = ps.connected ? 0 : (ps.offlineRounds | 0) + 1;
      if (ps.connected || ps.autoplay || ps.offlineRounds < OFFLINE_TAKEOVER_ROUNDS) continue;
      ps.autoplay = true;
      ps.offlineAutoplay = true;
      // 和玩家自己点「暂离（AI 托管）」（intents.js setAutoplay → kickBot）保持同一口径：
      // 立刻让机器人接手**当前阶段**（开着的领奖 / 选择窗口也会被它处理掉），
      // 否则接管要等下一次 enterPrep 才生效，中间开着的窗口没人应。
      try { this.kickBot(ps); } catch (e) { this.reportError('offline takeover kickBot', e); }
      try {
        this.log.info?.(`[match ${this.roomCode}] seat ${ps.seat} offline for ${ps.offlineRounds} rounds: AI takes over (R${this.round})`);
      } catch { /* ignore */ }
      try {
        this.tickerText(msg('{name}博士掉线超过 {rounds} 回合，由 AI 托管其席位，重新连接后可收回',
          { name: ps.name, rounds: OFFLINE_TAKEOVER_ROUNDS }), FLOW_TICKER_PRIORITY);
      } catch { /* ignore */ }
      this.markPublic();
    }
  }

  /**
   * 把一个真人移出对局：挂机（`_checkIdle`，reason 'afk'）或被投票移出（`kickVote.js`，reason 'kicked'）。
   *
   * 移植参考版（维护者 2026-11-06）：
   *   1. 先给本人 `m.removed { reason, rounds }` —— 客户端据此退出房间、回大厅并提示原因；
   *   2. 再给其余所有人（含观战）一条 `m.notice`（挂机 = afkRemoved；投票 = 调用方给的 kickPassed）；
   *   3. `opts.onRemove(playerId, { reason, rounds })` 让平台摘座位（大厅的 removeMember）；
   *   4. `onLeave` 收尾。
   * 本服既有的 `onIdleKick` 保留为兜底：没有 onRemove 时仍然能踢掉（老测试与老调用方不受影响）。
   */
  _removeIdle(ps, reason = 'afk', notice = null) {
    if (!ps || ps.isBot || ps.left) return;
    // 维护者 2026-11-05：管理员不受任何惩罚机制（双保险：_checkIdle 已经跳过，这里再挡一次）
    if (reason === 'afk' && this._isPunishImmune(ps)) return;
    if (ps._idleKicked) return;
    ps._idleKicked = true;
    const rounds = reason === 'afk' ? this.afkRemoveRounds : Math.min(100, Math.max(1, ps.offlineRounds | 0));
    try {
      this.log.info?.(`[match ${this.roomCode}] seat ${ps.seat} removed (${reason}, ${rounds} rounds, R${this.round})`);
    } catch { /* ignore */ }
    // 1) 本人
    try { this.sendTo(ps.playerId, { t: 'm.removed', reason, rounds }); } catch { /* ignore */ }
    // 2) 其他人（挂机 / 投票两种口径）
    const note = notice || { t: 'm.notice', kind: 'afkRemoved', playerId: ps.playerId, name: ps.name, rounds };
    try {
      for (const p of this.order) if (p !== ps && !p.isBot && !p.left) this.sendTo(p.playerId, note);
      for (const id of this.spectators.keys()) this.sendTo(id, note);
    } catch { /* ignore */ }
    // 3) 平台摘座位；没有 onRemove 就退回既有的 onIdleKick
    if (typeof this.opts?.onRemove === 'function') {
      try { this.opts.onRemove(ps.playerId, { reason, rounds }); } catch (e) { this.reportError('onRemove', e); }
    } else {
      try { this.onIdleKick?.(ps.playerId, reason); } catch (e) { this.reportError('onIdleKick', e); }
    }
    // 4) 真正退出：只有在**有平台钩子**时才自己摘座位（onRemove / onIdleKick）。
    //    投票移出（'kicked'）是投票结果，必须落地，所以不受这条限制。
    const hooked = reason === 'kicked' || typeof this.opts?.onRemove === 'function' || typeof this.onIdleKick === 'function';
    if (hooked && !ps.left) { try { this.onLeave(ps.playerId); } catch (e) { this.reportError('onLeave', e); } }
  }

  onLeave(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || this.disposed) return;
    this.guard(() => {
      ps.left = true;
      // 「暂停游戏」：永久离开的人不再挡着继续（pauseVote.js）
      try { this._pauseMemberGone?.(); } catch { /* ignore */ }
      // 投票移出：这个座位走了，针对它的投票结束（proposer 退出同理）
      try { this._kickVoteMemberGone?.(playerId); } catch { /* ignore */ }
      this.cancelSetupVote();
      // A seat that is gone for good takes its reroll cooldown with it (it cannot ask again in this match anyway).
      this._rerollStartAt.delete(playerId);
      ps.connected = false;
      ps.autoplay = false;
      this.watchers.delete(playerId);
      if (this.ended) return;
      // 投票暂停中：上面 `_pauseMemberGone` 已经在「全员走光」时收尾；还有人留在浮层上就别偷偷恢复
      if (!this.echoPaused) this._resume();
      if (this.clientCombat) this._authorityLost(ps, 'left');
      // a rehearsal the departed seat was running falls back to the server (DESIGN §14; a no-op without tasks)
      this._rehearsalHostChanged();
      this.markPublic();
      if (!this.order.some((p) => !p.isBot && !p.left)) {
        this.finish({ victory: false, reason: 'abandoned' });
        return;
      }
      this._quit(ps);
    });
  }

  /**
   * 中途退出 counts as elimination (research 00-INDEX §3, 01 §9, 06 §7 / §10.3): every copy the player holds goes back
   * to the shared pool at once, and the seat has no place in later rounds, the Final Assault pairing or the boss pool
   * (bloodPoint per player alive at the fight's start, DESIGN §25.13.4). Rounds passed = the rounds the player had
   * survived when leaving.
   */
  _quit(ps) {
    this.maybeEndInfo();
    if (!ps.alive) return;
    const phase = this.phase;
    const d = this.draft;
    if (phase === PHASE.BAND_DRAFT && d && !d.picks[ps.playerId]) {
      // the departed seat passes its turn with the default band (never one a teammate holds — defaultBand)
      const turn = this.draftTurn() === ps.playerId;
      d.picks[ps.playerId] = this.defaultBand(ps.playerId);
      ps.bandId = d.picks[ps.playerId];
      if (turn) this.startDraftTurn();
    }
    const passedRound = phase === PHASE.SETTLE ? this.round + 1 : Math.max(1, this.round);
    // its own normal battle has nobody left to fight for
    for (const f of this.fields) {
      if (f.live && f.kind === 'normal' && f.players.length === 1 && f.players[0] === ps.playerId) {
        if (this.clientCombat && f.cc) {
          if (!f.result) f.result = syntheticResult(f.players);
          this._fieldDone(f);
          continue;
        }
        try { f.battle.forceEnd('left'); } catch (e) { this.reportError('quit forceEnd', e); }
      }
    }
    ps.lp = 0;
    ps.eliminate(passedRound);
    this.offersChanged();
    this.tickerText(msg('{name}博士中途退出了模拟', { name: ps.name }), FLOW_TICKER_PRIORITY);
    if (this.bossWaves && (phase === PHASE.ROUND_START || phase === PHASE.SP_DRAFT || phase === PHASE.PREP)) {
      // before the boss fight: pair the players left again (the prep preview shows the new partner / template); a
      // player moved to the other half re-checks its board there at once (recompute → deployMap, marks it private)
      this._planBossWaves();
      for (const p of this.alivePlayers()) p.recompute();
    }
    // whoever scouted the departed player's board follows the next player still in (item 56)
    for (const v of this._viewers()) if (this.watchers.get(v.playerId) === `n:${ps.playerId}`) this._followScout(v);
    this.markPublic();
    if (this.teamLp != null) this._syncTeamLp();
    if (!this.alivePlayers().length) {
      // only eliminated spectators are left
      this.finish({ victory: false, reason: 'eliminated' });
      return;
    }
    if (phase === PHASE.SP_DRAFT && this.sp && this.spTurn() === ps.playerId) this.startSpTurn();
    else if (phase === PHASE.PREP) this.maybeEndPrep();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.externalAI?.close();
    if (this.runner) { try { this.runner.stop(); } catch { /* ignore */ } }
    this._stopClientCombat();
    this._cancelRehearsal();
    // a plugin interaction window's own deadline timer (MatchOffers); the tracked timers below cover the rest
    if (typeof this.offersDispose === 'function') { try { this.offersDispose(); } catch { /* ignore */ } }
    for (const h of this._timers) { try { this.sched.clearTimeout(h); } catch { /* ignore */ } }
    this._timers.clear();
    if (this._pubTimer) { try { this.sched.clearTimeout(this._pubTimer); } catch { /* ignore */ } this._pubTimer = null; }
    if (this.ownsScheduler) this.sched.dispose();
  }
}
