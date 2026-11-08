// server/soloHold.js — 「深渊回响」单人房正在被保存（24 小时窗口）的**唯一**判定。
//
// 为什么单独一个文件：这条判定的答案有三个使用方，而且它们的 import 方向互相打架 ——
//   * `server/persist/lobbyState.js`（房间文档 → Redis → 控制台「保存中」角标）
//   * `server/lobby.js`（`room.state` 要把它发给页面，玩家才知道还剩多久）
//   * 而 lobbyState 已经 import lobby（Room），lobby 再反过来 import lobbyState 就是循环依赖。
// 所以判定本身抽到这里，谁都可以 import，谁都不用 import 谁。
//
// 判据（维护者 2026-11-08 定的，`Lobby.soloLikeRun` + `Lobby.soloResumeWindowMs` 同一条链路）：
//   * `variant === 'deepecho'`，而且这一局真的开着（`room.match`）；
//   * 房间里**只有 1 个真人**（AI 座位不算人）；
//   * 这个人**不在线** —— 关掉页面 / 掉线 / 换设备，总之没有人在玩；
//   * 他的会话还挂着 `resumeWindowMs`（单人房 = 官方 `singleReconnectTime` 24 小时）。
//
// 返回 `{ since, until, windowMs, name, playerId }`：`since` = 他断线的时刻，`until` = 窗口到期时刻
// （到点 onExpire 释放座位、对局以 abandoned 结束）。**只是展示**：没有任何玩法判定读它。

/** 会话上没有 `resumeWindowMs` 时（重启后会话还没回来）退回官方 `singleReconnectTime` = 24 小时。 */
export const SOLO_HOLD_FALLBACK_SEC = 86_400;

/**
 * @param {any} room
 * @param {((playerId: string) => any) | null | undefined} sessionOf
 * @param {number} [fallbackSec] 没有会话时用的窗口（秒），默认官方 24 小时
 * @param {number} [now] 当前时刻（只用于把「窗口是否已经过期」算进返回值）
 * @returns {{ since: number, until: number, windowMs: number, name: string, playerId: string, leftMs: number } | null}
 */
export function soloHoldOf(room, sessionOf, fallbackSec = SOLO_HOLD_FALLBACK_SEC, now = Date.now()) {
  // 深潜房在协议里是 `mode:'coop'` + `variant:'deepecho'`（见 lobbyState.roomDoc 的 variant 注释）——
  // 两个条件都要，别让一个只带 variant 的怪文档在控制台上标出「保存中」。
  if (!room || room.disposed || room.mode !== 'coop' || room.variant !== 'deepecho' || !room.match) return null;
  const humans = typeof room.activeHumans === 'function' ? room.activeHumans() : [];
  if (humans.length !== 1) return null;              // 多人局没有「保存单人房」这回事
  const seat = humans[0];
  if (!seat || seat.connected) return null;          // 有人在玩 → 不是在「保存」
  const session = sessionOf ? sessionOf(seat.playerId) : null;
  const own = session && Number.isFinite(Number(session.resumeWindowMs)) && Number(session.resumeWindowMs) > 0
    ? Number(session.resumeWindowMs) : 0;
  const windowMs = own || Math.max(1, Number(fallbackSec) || SOLO_HOLD_FALLBACK_SEC) * 1000;
  const since = Number(session && session.disconnectedAt) || Number(room.lastHumanLeftAt) || 0;
  if (!(since > 0)) return null;                     // 连断线时刻都不知道：宁可不标，也不给假倒计时
  const until = Math.round(since + windowMs);
  return {
    since: Math.round(since),
    until,
    windowMs: Math.round(windowMs),
    name: String(seat.name || ''),
    playerId: String(seat.playerId || ''),
    leftMs: Math.max(0, until - Number(now)),
  };
}

/**
 * 一串给人看的「还剩多久」（服务端只发毫秒，客户端自己翻成小时/分钟）。
 * 不足 1 小时写分钟；已过期写「已过期」。
 * @param {number} leftMs
 * @returns {string}
 */
export function holdLeftText(leftMs) {
  const ms = Number(leftMs);
  if (!(ms > 0)) return '已过期';
  if (ms >= 3_600_000) return `剩 ${Math.ceil(ms / 3_600_000)} 小时`;
  return `剩 ${Math.max(1, Math.ceil(ms / 60_000))} 分钟`;
}

/**
 * SESSION_IN_USE 的 detail：这个账号挡在哪个**正在保存的**单人深潜门口。
 *
 * 为什么必须带上这件事（维护者 2026-11-08）：`SESSION_IN_USE` 的通用文案是
 * 「此对局仍在其他窗口中……请关闭原窗口后重试」—— 在保存中的单人深潜上，这句话**给错了办法**：
 * 玩家照做（离开那间房）恰恰会把这局按 `abandoned` 结算掉。所以要告诉他是哪一间、还剩多久、
 * 以及「离开 = 放弃」。
 *
 * 传输格式 `solo-hold:<房间码>:<剩余分钟>`（detail 在线上限 120 字符，且只走字符串）；
 * 用**剩余分钟**而不是到期时间戳，客户端不必相信自己的时钟。客户端见
 * public/js/ui/diveWords.js 的 parseSoloHoldDetail。
 * @param {{ hold: { name: string, leftMs: number } | null, room?: { code?: string } } | null} conflict
 * @returns {string | null}
 */
export function soloHoldConflictDetail(conflict) {
  const hold = conflict && conflict.hold;
  const code = conflict && conflict.room && conflict.room.code;
  if (!hold || typeof code !== 'string' || !code) return null;
  const minutes = Math.max(0, Math.ceil(Number(hold.leftMs) / 60_000) || 0);
  return `solo-hold:${code}:${minutes}`;
}
