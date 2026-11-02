// server/match/match/intents.js — Match methods: the g.* / b.* intent router (_handle: the prep intents go to
// PlayerState, the drafts, watching, the pause and the battle reports to the match), emotes, AI 托管 (setAutoplay,
// kickBot) and g.unitStats (the stats the board's units start their next battle with: a preview battle, started, read
// and dropped).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { unitStatsEntry } from '../../../shared/protocol.js';
import { PHASE, ERR, EMOTES, EMOTE_COOLDOWN_MS, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { OK, fail, AFK_ACTIONS } from './common.js';
import { onHumanEmote } from '../botEmotes.js';

export class MatchIntents {
  /**
   * 当前还在局里的**真人**数量（不算 AI、不算已离开的）。
   *
   * 为什么实时算而不用 this.loneHuman：后者是建局时的快照，
   * 「2 人开局、中场退了一个」之后它就过期了 —— 那时其实已经是单人局，
   * 再按消极游戏踢剩下那一个人是不合理的。
   * @returns {number}
   */
  _humanCount() {
    try {
      const list = Array.isArray(this.order) ? this.order : (this.players ? [...this.players.values()] : []);
      let n = 0;
      for (const p of list) if (p && !p.isBot && !p.left) n++;
      return n;
    } catch { return 0; }
  }

  /** 消极游戏检测：连续 2 回合花钱（买/刷新/升级）但一次都没部署干员 → 踢出。 */
  _trackActivity(ps, msg) {
    if (!ps || ps.isBot) return;
    const t = msg && msg.t;
    // 挂机移出用的「有实质操作」标记（common.js AFK_ACTIONS）：与下面两条规则**并存**，
    // 由 prep.js endPrep → platform.js _checkIdle 每回合结算一次。
    // 放在最前面，且不受下面那些闸门（回合数、单人局）影响 ——
    // 它只是记「这个人动过」，不是判定。
    if (AFK_ACTIONS.has(t)) ps.afkActed = true;
    // ★ 2026-11-02：**掉线的人不算消极游戏**。
    //   掉线的玩家发不出任何指令，若不豁免，两条规则都会把「什么都没做」判成挂机，
    //   把人踢掉 —— 而他只是网断了，回来座位已经没了。参考版也是这么处理的
    //   （platform.js 的 _checkIdle 用 !ps.connected 归零）。这一层必须在规则之前。
    if (!ps.connected) return;
    // ★ 2026-10-31 维护者要求：**单人（只有一个真人）不判定消极游戏**。
    //   理由很直接：消极游戏伤害的是「同局的其他真人」—— 一个人自己打单机，
    //   挂机也好、不部署也好，没有别人受影响，踢掉他只会平白打断他。
    //   同局的 AI 不算人：一真人 + 三个 AI 仍然是单人局，不判定。
    //
    //   ⚠ 不能用 this.loneHuman：那是**建局时**算好的一次性快照，
    //   中途有人退出后它对不上（2 人开局、1 人退出 → 其实已经是单人局，
    //   但 loneHuman 仍是 false，会把剩下那个人按消极踢掉）。
    //   这里每次实时数一遍「还没离开的真人」。
    if (this._humanCount() < 2) return;
    // 已经被判定消极游戏、踢出去了：不再重复判定（否则每回合都弹一次提示）
    if (ps._idleKicked) return;
    const round = Number(this.round) || 0;
    // 只在第 4 回合前判定（含第 4 回合）。
    // 第 4 回合之后不再踢人：那时局面已经展开，中途踢人会让整局失衡，
    // 而且前期没被判定的人基本已经在正常玩了。
    if (round > 4) { if (ps._act) { ps._act.strikes = 0; ps._act.idleStrikes = 0; } return; }
    let st = ps._act;
    if (!st || st.round !== round) {
      // 规则一：连续 2 回合花钱但不部署 → 消极游戏
      if (st && st.spend > 0 && st.place === 0) {
        st.strikes = (st.strikes || 0) + 1;
        if (st.strikes >= 2) {
          ps._idleKicked = true;
          try { this.toast?.(ps, 'warn', '检测到连续 2 回合购买/刷新但未部署干员，你已被移出同盟（消极游戏）'); } catch { /* ignore */ }
          try { this.onIdleKick?.(ps.playerId, 'idle'); } catch { /* ignore */ }
        }
      } else if (st) {
        st.strikes = 0;
      }
      // 规则二：连续 2 回合既不购买也不部署（只点准备）→ 消极游戏
      // （注释以前写「连续 3 回合」但代码是 2 —— 以代码为准，这里把注释改成一致的 2：
      //   前期两回合什么都不做，基本可以确定是挂机，等三回合只会多拖一局。）
      if (st) {
        if (st.spend === 0 && st.place === 0) {
          st.idleStrikes = (st.idleStrikes || 0) + 1;
          if (st.idleStrikes >= 2) {
            ps._idleKicked = true;
            try { this.toast?.(ps, 'warn', '检测到连续 2 回合未购买、未部署干员，你已被移出同盟（消极游戏）'); } catch { /* ignore */ }
            try { this.onIdleKick?.(ps.playerId, 'idle'); } catch { /* ignore */ }
            st.idleStrikes = 0;
          }
        } else {
          st.idleStrikes = 0;
        }
      }
      st = ps._act = { round, spend: 0, place: 0, strikes: st ? (st.strikes || 0) : 0, idleStrikes: (st && st.idleStrikes) || 0 };
    }
    if (t === 'g.buy' || t === 'g.refresh' || t === 'g.levelUp') st.spend++;
    if (t === 'g.place' || t === 'g.move' || t === 'g.deploy' || t === 'g.swap') st.place++;
  }

  /**
   * 预约盟约 g.bondPlan { bondId? }（移植自参考版，**纯显示**）：
   * 玩家声明「这一局我打算走哪个核心盟约」，下发给 m.public 的 players[].bondPlan，
   * 队友和观战者整局都看得见。
   *
   * 从 INFO_CHECK 到第 1 回合的战斗开始前都可以改（`bondPlanOpen()`）；
   * `bondId` 必须是 `gd.plannableBondIds()` 之一（否则 BAD_TARGET），
   * 省略 / null = 取消预约；重复预约同一个不产生任何变化（不 markPublic）。
   *
   * ★ 没有任何规则、AI、计时或挂机判定读这个字段 —— 它不影响对局。
   * AI 座位和观战座位发不了（handle 在更早的地方就拒了），不需要额外判断。
   * @param {any} ps @param {string|null} bondId
   */
  planBond(ps, bondId) {
    if (!this.bondPlanOpen()) return fail(ERR.WRONG_PHASE);
    if (bondId !== null && !this.gd.bondPlannable(bondId)) return fail(ERR.BAD_TARGET);
    if (ps.bondPlan === bondId) return OK;
    ps.bondPlan = bondId;
    this.markPublic();
    return OK;
  }

  /**
   * 什么时候还能改预约盟约：INFO_CHECK、选策略、战前确认，以及第 1 回合开始后到它的战斗之前。
   * 第 1 回合的战斗一开打就不能改了 —— 那时阵容已经定型，再改只会误导队友。
   */
  bondPlanOpen() {
    switch (this.phase) {
      case PHASE.INFO_CHECK: case PHASE.BAND_DRAFT: case PHASE.BATTLE_CHECK: return true;
      case PHASE.ROUND_START: case PHASE.SP_DRAFT: case PHASE.PREP: return this.round <= 1;
      default: return false;
    }
  }

  _handle(ps, msg) {
    try { this._trackActivity(ps, msg); } catch { /* ignore */ }
    switch (msg.t) {
      case 'g.infoReady':
        if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
        if (this.setupVote) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
        if ((msg.setupRevision ?? 0) !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup changed; confirm the current revision');
        if (!ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
        return OK;
      case 'g.rerollVote': return this.voteSetupReroll(ps, msg.voteId, msg.agree);
      // 战斗 2 倍速: the seat's standing vote (speedVote.js)
      case 'g.speedVote': return this.setSpeedVote(ps, msg.agree === true);
      case 'g.band': return this.pickBand(ps, msg.bandId);
      case 'g.bandSkip': return this.skipBand(ps);
      // 预约盟约（纯显示，移植自参考版）：声明这一局打算走哪个核心盟约
      case 'g.bondPlan': return this.planBond(ps, msg.bondId ?? null);
      // the strategy highlighted in the draft screen (what a timed-out turn takes, timeoutBand)
      case 'g.bandFocus': return this.bandFocus(ps, msg.bandId ?? null);
      case 'g.buy': return ps.buy(msg.slot);
      case 'g.refresh': return ps.refresh();
      case 'g.freeze': return ps.freeze();
      case 'g.levelUp': return ps.levelUp();
      case 'g.sell': return ps.sell(msg.uid);
      // dir: the deploy wheel's facing (DESIGN §3; absent ⇒ PlayerState reads to.dir, then RIGHT)
      case 'g.move': return ps.move(msg.uid, msg.to, msg.dir);
      case 'g.equip': return ps.equip(msg.itemUid, msg.targetUid, msg.replaceUid ?? null);
      case 'g.art': return ps.useArt(msg.itemUid, msg.row, msg.col, msg.dir);
      case 'g.destroy': return ps.destroy(msg.uid);
      case 'g.unequip': return ps.unequip(msg.itemUid);
      case 'g.reward': return ps.pickReward(msg.idx);
      case 'g.choice': return msg.choiceId !== undefined
        ? this.pickPersonalChoice(ps, msg.idx, msg.choiceId)
        : this.pickCard(ps, msg.idx);
      // a plugin interaction window (PLUGIN API v2, docs/PLUGINS.md §10b): the window's own id, not a draft card —
      // the host applies the declared primitive, a plugin never reaches the match state itself
      case 'g.offer': return this.requestOffer(ps, msg.offerId, msg.idx, msg);
      case 'g.offerRefresh': return this.requestOfferRefresh(ps, msg.offerId, msg.idx, msg);
      case 'g.ready': return ps.setReady(!!msg.ready);
      case 'g.emote': return this.emote(ps, msg.id);
      // playerId: the player tapped (a shared field names two) — the watch preference (item 56)
      case 'g.revive': return this.revive(ps, msg);
      case 'g.watch': return this.watch(ps, msg.fieldId, msg.playerId ?? null);
      case 'g.autoplay': return this.setAutoplay(ps, !!msg.on);
      case 'g.pause': return this.setPause(ps, !!msg.on);
      // the stats the board's units start their next battle with (the detail card in prep, user playtest #4 item 7)
      case 'g.unitStats': return this.unitStats(ps, msg.seq ?? null);
      case 'g.leave': this.onLeave(ps.playerId); return OK;
      case 'g.test': return this.applyTestCommand(ps, msg);
      case 'b.progress': return this._onProgress(ps, msg);
      case 'b.result': return this._onResult(ps, msg);
      // the host's answer to a delegated bot layout rehearsal (DESIGN §14): a report, never an error — an unknown,
      // expired or foreign task is ignored (MatchRehearsal._onRehearsalResult)
      case 'b.rehearsalResult': this._onRehearsalResult(ps, msg); return OK;
      default: return fail(ERR.BAD_MSG);
    }
  }

  emote(ps, id) {
    if (!EMOTES.includes(id)) return fail(ERR.BAD_MSG, 'unknown emote');
    const now = this.sched.now();
    if (now - ps.lastEmoteAt < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
    ps.lastEmoteAt = now;
    this.broadcast({ t: 'm.emote', playerId: ps.playerId, id });
    // an AI teammate can react to a human's emote (enabled by default: server/match/botEmotes.js, SP_BOT_EMOTES=0 silences it)
    onHumanEmote(this, ps.playerId, id);
    return OK;
  }

  setAutoplay(ps, on) {
    if (ps.autoplay === on) return OK;
    ps.autoplay = on;
    this.markPublic();
    if (on) this.kickBot(ps);
    return OK;
  }

  /** Let the bot act for a (newly) bot-controlled seat in the current phase. */
  kickBot(ps) {
    if (!ps.botControlled || this.ended) return;
    this.offersChanged();
    if (this.phase === PHASE.INFO_CHECK && !ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
    else if (this.phase === PHASE.BAND_DRAFT && this.draftTurn() === ps.playerId) this.scheduleBandBot();
    else if (this.phase === PHASE.SP_DRAFT && this.spTurn() === ps.playerId) this.scheduleSpBot();
    else if (this.phase === PHASE.PREP && ps.alive && !ps.ready) this.scheduleBotPrep(ps, 0);
  }

  /**
   * g.unitStats { seq? } (user playtest #4 item 7: the detail card showed fixed record stats): the stats every unit of
   * the player's board will fight with at the start of its next battle — equipment, bonds and their layers, 特质, the
   * band and 机变 effects — computed exactly by the shared sim. The player's battle input after the onBattleStart meta
   * handlers (`ev.preview: true`, no enemies — those handlers must not change the match for a preview) builds a Battle
   * of the battle's options that is started (initial deployment + battleStart hooks), read and dropped: it is never
   * stepped: deployment skills contribute their initial stats but their timers do not advance. No SP / skill timer is
   * sent, and the real battle gets fresh units. Pushed to the player as `m.unitStats { seq, round, units }`
   * (units: shared/protocol.js unitStatsEntry, board operators and summons by uid); cached per input (a build costs
   * ≈ 0.3–0.7 ms). Prep phases only (ROUND_START, 机变, PREP); a battle's live stats come from the browser's own sim.
   * @param {PlayerState} ps @param {number|null} seq echoed (the client keeps the newest answer)
   */
  unitStats(ps, seq = null) {
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.ROUND_START && this.phase !== PHASE.SP_DRAFT && this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    const units = this._unitStatsOf(ps);
    this.sendTo(ps.playerId, { t: 'm.unitStats', seq: Number.isInteger(seq) ? seq : null, round: this.round, units });
    return OK;
  }

  /** The start-of-battle stats of a player's board units (see unitStats); [] when the preview battle cannot be built. */
  _unitStatsOf(ps) {
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const ev = { input, kind: 'normal', round: this.round, preview: true };
    this.dispatch(ps, 'onBattleStart', ev);
    const players = [ev.input && typeof ev.input === 'object' ? ev.input : input];
    let key = null;
    try { key = JSON.stringify([this.round, this.stageId, this.battleContent, players]); } catch { key = null; }
    if (!this._unitStatsCache) this._unitStatsCache = new WeakMap(); // PlayerState → { key, units } (the last preview)
    const cached = this._unitStatsCache.get(ps);
    if (key && cached && cached.key === key) return cached.units;
    const units = [];
    // the flags of the battle it previews: a normal round gains IN_BATTLE layers from its start (a <战斗开始时> layer gain
    // raises bond stats at t = 0 there too); the Final Assault / Hidden Core fight without (previewed as a normal field)
    const bossRound = this.round === this.gd.bossRound || this.round === this.gd.hiddenRound;
    const b = this.newBattle({
      seed: deriveSeed(this.seed, `preview:${this.round}:${ps.seat}`), kind: 'normal', modeId: this.modeId, round: this.round,
      stageId: this.stageId, rect: { ...GEO.NORMAL_RECT }, timeLimit: 60, players, spawns: [], routes: this.wave ? this.wave.routes : [],
      sharedBoss: null, flags: { layerGainsEnabled: !bossRound, ...this.gd.dp, ...this._ruleFlags() }, fieldId: `n:${ps.playerId}`, recordEvents: false,
    });
    try {
      if (typeof b.start === 'function') b.start();
      for (const u of Array.isArray(b.allyUnits) ? b.allyUnits : []) {
        if (u && Number.isInteger(u.uid) && (u.kind === 'op' || u.kind === 'token')) units.push(unitStatsEntry(u, u.s));
      }
    } catch (e) { this.reportError('unitStats', e); }
    this._unitStatsCache.set(ps, { key, units });
    return units;
  }
}
