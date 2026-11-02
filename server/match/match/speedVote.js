// server/match/match/speedVote.js — Match methods: 战斗 2 倍速 (移植自另一 fork 的 2026-11-01 规则), a standing vote of the
// connected humans to run the battles at twice the normal speed: SPEED_VOTE_MULT × the match's base game speed (the forced
// 2× of the official battle, or opts.combatSpeed), so 4 game seconds per real second by default.
// [ASSUMED] A remake convenience, not an official rule.
//
// The vote (g.speedVote { agree }): a switch every seated human holds at any time of a running match, spectator seats and
// AI seats excepted; an eliminated human keeps it. voters = the humans connected and not left, recounted on every read,
// so a vote of someone offline neither counts nor blocks (it counts again when they are back); need = rerollNeed(voters),
// ceil(0.75 × voters), the same bar as 重刷本局; a lone human passes it alone.
// It only takes effect when a battle starts: _applySpeedVote runs before the fields of a normal, 联防 or boss / hidden
// battle are built and sets m.gameSpeed for that battle, so everything that reads it — the deadline, the boss clock,
// the Worker's pacing, a replica's b.start — agrees for the battle's whole length: a running battle never changes speed.
// Falling under the bar puts the next battle back on the base speed. Only the clocks scale: game seconds, ticks and every
// result stay what they are, so the time limits in data and combatTimeScale are not touched.
// Everything here is transient: a checkpoint restore drops the votes and goes back to the base speed
// (server/match/snapshot.js MATCH_FIELDS).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { ERR, SPEED_VOTE_MULT } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { MAX_GAME_SPEED } from '../fields.js';
import { FLOW_TICKER_PRIORITY, OK, fail } from './common.js';
import { rerollNeed } from './setupVote.js';

export class MatchSpeedVote {
  /** g.speedVote { agree } */
  setSpeedVote(ps, agree) {
    if (this.disposed || this.ended) return fail(ERR.WRONG_PHASE);
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (this._speedVotes.has(ps.playerId) === agree) return OK;
    const now = this.sched.now();
    if (now - (this._speedVoteAt.get(ps.playerId) ?? -Infinity) < 300) return fail(ERR.RATE);
    this._speedVoteAt.set(ps.playerId, now);
    const before = this._speedVotes.size;
    if (agree) this._speedVotes.add(ps.playerId); else this._speedVotes.delete(ps.playerId);
    this.markPublic();
    // 发起提示：以前别人发起 2 倍速投票，其他人**完全没有感觉** —— 那个开关只是自己变了个样子，
    // 谁也不去点它就永远过不了。所以第一票投进来时广播一条提示条（m.ticker），
    // 说明是谁发起的、现在几票通过；剩下的人看到后就知道该去按那个开关了。
    //
    // 只在「这一轮投票的第一票」时说：before === 0 是原始的赞成人数（不看在线），
    // 所以后面的人跟着赞成不会再刷一条。已经能通过时不说 —— 单人对局 need=1，
    // 赞成即通过，没必要告诉玩家自己刚干了什么。
    if (agree && before === 0) {
      const v = this.speedVoteView();
      if (!v.next) {
        this.tickerText(msg('{name}博士发起了战斗 2 倍速投票（{agreed}/{need}）', { name: ps.name, agreed: v.agreed.length, need: v.need }), FLOW_TICKER_PRIORITY);
      }
    }
    return OK;
  }

  /**
   * m.public speedVote: `agreed` the voters counted now, `voters` their number, `need` the yes votes it takes; `next`:
   * the next battle starts at 2 倍速 as things stand; `on`: the battle running (or the last one) was started at it, at
   * `speed` game seconds per real second (a stream viewer's clock; a replica has it from b.start).
   */
  speedVoteView() {
    const voters = this.humans().filter((p) => p.connected).map((p) => p.playerId);
    const agreed = voters.filter((id) => this._speedVotes.has(id));
    const need = rerollNeed(voters.length);
    return { agreed, voters: voters.length, need, next: voters.length > 0 && agreed.length >= need,
      on: this._speedUp, speed: this.gameSpeed };
  }

  /** A battle is about to start: its speed, from the votes as they stand. */
  _applySpeedVote() {
    const up = this.speedVoteView().next;
    if (up === this._speedUp) return;
    this._speedUp = up;
    this.gameSpeed = up ? Math.min(this.baseGameSpeed * SPEED_VOTE_MULT, MAX_GAME_SPEED) : this.baseGameSpeed;
    this.log.info?.(`[match ${this.roomCode}] battle speed ${this.gameSpeed} (R${this.round})`);
    this.markPublic();
  }
}
