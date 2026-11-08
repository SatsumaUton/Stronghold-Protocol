// server/match/match/pauseVote.js — Match methods: 「暂停游戏」的全员投票（维护者 2026-11-08）。
//
// 为什么需要：深渊回响的多人局一局要打很久（几十层），中间有人要接电话 / 吃饭 / 网卡一下，
// 现在只能干等（准备阶段的倒计时还在跑、战斗还在打）。维护者要求加一个**投票暂停**：
//   * 按钮放在右上角「准备就绪」下面（客户端 ui/hud.js 的 PauseVote）；
//   * 暂停后弹一个和「服务器重启导致对局中断」同款的浮层，**房间里每个玩家都确认**之后才继续。
//
// 规则：
//   * 只对「深渊回响」的多人局开放（`echoVariant === 'deepecho'` 且房间里有 ≥2 个真人）。
//     单人局本来就能用 Space 暂停战斗（MatchPause 的 solo pause），不需要投票。
//   * 发起 / 同意是**站队式投票**（像 2 倍速）：`g.pauseVote { agree }`，voters = 在线真人，
//     **全票通过**才暂停（暂停会影响所有人，不能用 3/4 多数压着人停）。
//   * 暂停中：`m.public.paused = true`（HUD 的倒计时、浏览器里的战斗、服务端的战场时钟都跟着停，
//     这是 MatchPause 那套现成的机制），准备阶段的截止计时器被摘下来、恢复时按剩余时间重新挂上，
//     所以**回合不会在暂停期间推进**；暂停中 `g.ready` 被拒绝（否则全员就绪会直接把这一回合推走）。
//   * 继续：每个在线真人发 `g.pauseResume`，**全员确认**后恢复；恢复时把暂停的时长补给所有时钟
//     （`_resume()`），面板计时器不补偿（它们本来就短，暂停期间结算完就算了）。
//   * 兜底：暂停超过 `PAUSE_VOTE_MAX_MS`（10 分钟）自动恢复，免得一个人挂机把整局扣住；
//     暂停中有人掉线不算「没确认」（只数在线的人），全员走光则直接恢复。
//   * 全部状态是 transient（快照里不存，见 snapshot.js MATCH_FIELDS）。
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { FLOW_TICKER_PRIORITY, OK, fail } from './common.js';

/** 暂停多久之后自动继续（防止一个人挂机把整局扣住）。 */
export const PAUSE_VOTE_MAX_MS = 10 * 60 * 1000;

/** 能发起暂停的阶段：真正在「玩」的那些（SETTLE / ROUND_START 这类过场不暂停，它们马上自己就走完了）。 */
const PAUSE_PHASES = new Set([PHASE.PREP, PHASE.SP_DRAFT, PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);

export class MatchPauseVote {
  /** 这个房间能不能用「投票暂停」：深渊回响 + 至少两个真人。 */
  pauseVoteAllowed() {
    if (this.disposed || this.ended) return false;
    if (this.echoVariant !== 'deepecho') return false;
    if (this.isSolo) return false;
    return this.humans().filter((p) => !p.isBot && !p.left && !p.spectator).length >= 2;
  }

  /** 现在能不能**发起**暂停（阶段 + 是否已经暂停）。 */
  _pauseVoteOpen() {
    if (!this.pauseVoteAllowed()) return false;
    if (this.echoPaused) return false;
    return PAUSE_PHASES.has(this.phase);
  }

  /** 在线真人（暂停投票与继续确认都只数这些人：掉线的人既不能投票也不该挡着）。 */
  _pauseVoters() {
    return this.humans().filter((p) => p.connected && !p.botControlled && !p.spectator && p.alive !== false).map((p) => p.playerId);
  }

  /**
   * `g.pauseVote { agree }`：发起 / 同意 / 撤回一次暂停投票。
   * 全票通过 → `_echoPauseBegin()`。
   */
  setPauseVote(ps, agree) {
    if (!this.pauseVoteAllowed()) return fail(ERR.WRONG_PHASE, 'pause vote is for multiplayer deep echo only');
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (this.echoPaused) return fail(ERR.WRONG_PHASE, 'already paused');
    if (!this._pauseVoteOpen()) return fail(ERR.WRONG_PHASE, 'this phase cannot be paused');
    const now = this.sched.now();
    if (now - (this._pauseVoteAt.get(ps.playerId) ?? -Infinity) < 300) return fail(ERR.RATE);
    this._pauseVoteAt.set(ps.playerId, now);
    if (agree) this._pauseVotes.add(ps.playerId); else this._pauseVotes.delete(ps.playerId);
    this.markPublic();
    // 第一票进来时广播一条（否则别人根本不知道有人在发起，谁也不去点）
    if (agree && this._pauseVotes.size === 1) {
      const v = this.pauseVoteView();
      if (!v.pass) {
        this.tickerText(msg('{name}博士发起了「暂停游戏」投票（{agreed}/{need}）', { name: ps.name, agreed: v.agreed.length, need: v.need }), FLOW_TICKER_PRIORITY);
      }
    }
    if (this.pauseVoteView().pass) this._echoPauseBegin(ps);
    return OK;
  }

  /** m.public pauseVote：票数 / 需要几票 / 是否通过 / 当前是否暂停中。 */
  pauseVoteView() {
    const voters = this._pauseVoters();
    const agreed = voters.filter((id) => this._pauseVotes.has(id));
    const need = Math.max(1, voters.length);
    return {
      voters: voters.length,
      agreed,
      need,
      pass: voters.length >= 2 && agreed.length >= need,
      paused: !!this.echoPaused,
    };
  }

  /**
   * 全票通过：真的暂停。冻结的东西：
   *   * `paused = true` + `_pausedAt`（HUD 倒计时、浏览器里的战斗、服务端战场时钟都停 —— 现成的机制）；
   *   * 准备阶段的截止计时器摘下来（`_pauseHoldPhaseTimer`），恢复时按剩余时间重新挂上；
   *   * 战斗的截止 / 释放计时器、boss 时钟（`_resume` 会补回来）。
   * @param {any} [by] 发起人（最后投赞成票的那位）
   */
  _echoPauseBegin(by = null) {
    if (this.echoPaused || this.disposed || this.ended) return;
    const now = this.sched.now();
    this.paused = true;
    this._pausedAt = now;
    this._pauseHoldPhaseTimer();
    for (const f of this.fields) {
      if (!f.cc) continue;
      if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; f.rearmDeadline = true; }
      if (f.doneTimer) { this.cancel(f.doneTimer); f.doneTimer = null; f.rearmRelease = true; }
    }
    if (this._bossClock) { this.cancel(this._bossClock); this._bossClock = null; }
    this.echoPaused = { at: now, by: by && by.playerId ? by.playerId : null, byName: by && by.name ? by.name : '', resumed: new Set(), timer: null };
    this._pauseVotes.clear();
    this._pauseVoteAt.clear();
    // 兜底：暂停太久自动继续（一个人挂机不能把整局扣住）
    this.echoPaused.timer = this.later(PAUSE_VOTE_MAX_MS, () => {
      if (!this.echoPaused) return;
      this.tickerText(msg('暂停已超过 {n} 分钟，自动继续', { n: Math.round(PAUSE_VOTE_MAX_MS / 60000) }), FLOW_TICKER_PRIORITY);
      this._echoPauseEnd('timeout');
    });
    this.tickerText(msg('对局已暂停（{name}发起）：所有在线队友都点「继续游戏」后恢复', { name: this.echoPaused.byName || '队友' }), FLOW_TICKER_PRIORITY);
    this.markPublic();
  }

  /**
   * `g.pauseResume {}`：暂停中确认「我准备好了，可以继续」。全员确认 → 恢复。
   */
  pauseResume(ps) {
    if (!this.echoPaused) return fail(ERR.WRONG_PHASE, 'not paused');
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    this.echoPaused.resumed.add(ps.playerId);
    this.markPublic();
    const voters = this._pauseVoters();
    const all = voters.length > 0 && voters.every((id) => this.echoPaused.resumed.has(id));
    if (all) this._echoPauseEnd('all');
    return OK;
  }

  /** 还有谁没确认（客户端浮层用来列「等待中」）。 */
  pauseResumeView() {
    if (!this.echoPaused) return null;
    const voters = this._pauseVoters();
    return {
      by: this.echoPaused.by,
      byName: this.echoPaused.byName,
      resumed: voters.filter((id) => this.echoPaused.resumed.has(id)),
      voters: voters.length,
      need: voters.length,
      ready: voters.length > 0 && voters.every((id) => this.echoPaused.resumed.has(id)),
      endsAt: this.echoPaused.at + PAUSE_VOTE_MAX_MS,
    };
  }

  /**
   * 恢复：把暂停的时长补给所有时钟（`_resume()`）、把准备阶段的计时器按剩余时间挂回去，清状态。
   * @param {'all'|'timeout'|'gone'|'ended'} why
   */
  _echoPauseEnd(why = 'all') {
    if (!this.echoPaused) return;
    const box = this.echoPaused;
    this.echoPaused = null;
    if (box.timer) { this.cancel(box.timer); box.timer = null; }
    this._resume();                    // paused=false + 所有时钟往后挪 d
    this._pauseReleasePhaseTimer();
    if (why === 'all') this.tickerText(msg('全员已确认，对局继续'), FLOW_TICKER_PRIORITY);
    else if (why === 'gone') this.tickerText(msg('暂停中已无人在线，对局恢复', {}), FLOW_TICKER_PRIORITY);
    this.markPublic();
  }

  /**
   * 摘掉准备阶段的截止计时器，并记下「还剩多久 + 到点该做什么」。
   * `setDeadline` 只在测试模式下留过 fn，这里自己存一份（infra.js 里加了 `_phaseDeadlineFn`）。
   */
  _pauseHoldPhaseTimer() {
    this._pauseHeld = null;
    const fn = this._phaseDeadlineFn || null;
    const left = Math.max(0, (Number(this.deadline) || 0) - this.sched.now());
    if (!fn || !(left > 0)) { if (this._phaseTimer) { this.cancel(this._phaseTimer); this._phaseTimer = null; } return; }
    if (this._phaseTimer) { this.cancel(this._phaseTimer); this._phaseTimer = null; }
    this._pauseHeld = { fn, left };
  }

  /** 恢复时把截止计时器按剩余时间挂回去（`_resume()` 已经把 `this.deadline` 往后挪过了）。 */
  _pauseReleasePhaseTimer() {
    const held = this._pauseHeld;
    this._pauseHeld = null;
    if (!held || !held.fn) return;
    this._phaseTimer = this.later(held.left, () => {
      this._phaseTimer = null;
      this._phaseDeadlineFn = null;
      held.fn();
    });
  }

  /** 暂停中有人掉线 / 离开：只数在线的人；全员走光就直接恢复（不然这局永远停着）。 */
  _pauseMemberGone() {
    if (!this.echoPaused) return;
    if (!this._pauseVoters().length) { this._echoPauseEnd('gone'); return; }
    this.markPublic();
  }
}
