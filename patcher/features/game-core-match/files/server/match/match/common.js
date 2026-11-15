// server/match/match/common.js — constants and small helpers shared by the Match method modules
// (server/match/match/*.js); server/match/Match.js re-exports FLOW_TICKER_PRIORITY, DELAYS and BAND_TURN_SECONDS.

/**
 * Ticker priority of the remake's match-flow notices (隐秘核心已解锁, 联防阶段, a player out or gone): the official lines
 * (research 06 §9.2) go BOSS_HIT 30 > CHAR_DAMAGE 20 > SHOP_LEVEL 11 > GOLDEN_CHAR 2 > CHAR_GIFT 1; ours sit under the
 * leader-damage lines [ASSUMED].
 */
export const FLOW_TICKER_PRIORITY = 25;
/** Boss clock period (overtime drain, end checks, silence watchdog) in real ms. */
export const BOSS_CLOCK_MS = 250;
export const OK = Object.freeze({ ok: true });
export const fail = (error, detail) => (detail ? { error, detail } : { error });

/** Fixed presentation delays (real ms, × timerScale). */
export const DELAYS = Object.freeze({
  ROUND_START: 2000,
  COMBAT_END: 1500,
  SETTLE: 3000,
  BOT_ACTION: 900,
  BOT_STAGGER: 350,
  PUBLIC_THROTTLE: 100,
});

/** Experimental rescue: a leak-free unite helper with at least 11 LP pays 10 to cancel a teammate's death. */
export const REVIVAL_COST = 10;
export const REVIVAL_MIN_DONOR_LP = 11;
export const REVIVAL_WINDOW_SECONDS = 15;
export const REVIVAL_UNAVAILABLE_REASONS = Object.freeze([
  'disabled', 'no-helper', 'donor-lp', 'window-expired', 'window-closed', 'already-used', 'left', 'match-ended',
]);

/**
 * 挂机移出（消极游戏）默认判定的回合数：连续这么多回合**没有任何实质操作**就移出。0 = 关闭。
 * `Match` 的 opts.afkRemoveRounds 覆盖它（server/match/match/platform.js 的 _checkIdle）。
 */
export const AFK_REMOVE_ROUNDS = 2;
/** 掉线多少个「备战结束」后由 AI 接管该座位（参考版口径，维护者 2026-11-06 移植）：接管后才允许被投票移出。 */
export const OFFLINE_TAKEOVER_ROUNDS = 2;

/**
 * 算作「有操作」的意图（移植自参考版 common.js；2026-11-07 晚补上「深渊回响」的 9 条）。
 *
 * 判据是「有没有**实质**操作」，不是「有没有点过任何东西」：点准备、观战、发表情都不算。
 * 前 13 条覆盖普通房间备战期能做的事 —— 买/卖/移动/刷新/升级/冻结/装备/销毁/选择/领奖/复活/选盟约/跳过盟约。
 *
 * 后 9 条是「深渊回响」的操作：祭坛献祭 / 祝福三选一 / 弃选 / 刷新祝福 / 补给 / 盟约投影 / 护盾投票 /
 * 反制提前结束 / 放弃深潜。**以前它们不在白名单里**，于是玩家整回合只在祭坛买东西，
 * 结算时仍被判「没有任何操作」（玩家反馈：深渊祭坛里的操作也算挂机）。
 * 这些操作都是一层只开一次的明确选择，和买/卖同级，不该被当成挂机。
 *
 * ⚠ 与旧的两条规则的关系：旧规则额外抓「只花钱不部署」和「什么都不做」，这条抓「什么都没干」。
 *   两者并存（见 intents.js _trackActivity 的说明）。
 */
export const AFK_ACTIONS = new Set([
  'g.buy', 'g.sell', 'g.move', 'g.refresh', 'g.levelUp', 'g.freeze', 'g.equip', 'g.destroy',
  'g.choice', 'g.reward', 'g.revive', 'g.band', 'g.bandSkip',
  // 「深渊回响」
  'g.echoAltar', 'g.echoBlessing', 'g.echoBlessingDiscard', 'g.echoBlessingRefresh',
  'g.echoSupply', 'g.echoProjection', 'g.echoShield', 'g.echoCounterUse', 'g.echoGiveUp',
]);

/**
 * 「深渊回响」实际生效的挂机回合数**下限**（2026-11-07 晚，维护者：普通房的挂机判定对深潜太严格）。
 *
 * 为什么深潜要放宽：普通房 2 个回合没有实质操作基本就是挂机；深潜不一样 ——
 *   * 准备期更长（祝福/补给/投影/祭坛的投票与三选一都占时间）；
 *   * 深层可买的东西更少（阵容早满、商店满级、祭坛每 3 层才开一次），
 *     玩家「这一层什么都不用买」是正常打法，不是消极游戏；
 *   * 深潜是各自打各自的战场，挂机的人会自己掉血，团队惩罚本来就更重。
 * 所以深潜至少给 3 个备战；配置值更大时按配置值。`afkRemoveRounds = 0` 仍然是整体关闭。
 */
export const AFK_REMOVE_ROUNDS_DEEPECHO = 3;

/**
 * Seconds of one turn of the co-op strategy draft (user playtest #4 item 4: the old 12 s per turn — research 06 §724,
 * itself [ASSUMED] — inside the 50 s step was far too little and counted apart from the header's 50 s). [ASSUMED]: the
 * official data only gives the whole BAND_CHECK step (autoChessData.enterStepList: 50 s, hint 15 s); the turn clock is
 * the remake's (50 s per turn per the owner's 2026-10-10 official-play report). It is also the step's only countdown (m.public.deadline = draft.turnDeadline). × timerScale.
 */
export const BAND_TURN_SECONDS = 50;
