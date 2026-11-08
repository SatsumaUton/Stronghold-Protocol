// public/js/ui/diveWords.js — 「深渊回响」的用语开关（维护者 2026-11-08）。
//
// 背景：深潜在协议里是 `mode:'coop'` + `variant:'deepecho'` —— 一套引擎、两个模式。所以对局内的
// 通用组件（队伍面板、结算、复活、相位横幅…）天然说的是「同盟 / 模拟」，深潜房里就漏出
// 「同盟成员」「模拟中断」「返回同盟」这种话。维护者要求：**深潜房里不该出现「同盟 / 模拟」**。
//
// 这个模块只做两件事：
//   1. `isDivePub(pub)` / `isDiveResult(res)` / `isDiveRoom(room)` —— 从哪个对象上认深潜；
//   2. 一组 `diveX(dive)` 取词函数。
//
// ⚠ 每个分支都写成**独立的 `t('…')` 字面量**（不是 `t(dive ? 'a' : 'b')`）：i18n 的提取器只认
// 直接传给 t() 的字符串字面量，三元表达式里的字符串它读不到 —— 那样这些 msgid 就不会进四个语言包，
// 英文界面会静默回退成中文。test/ui/dive-wording.test.js 钉住这一点。
//
// 为什么集中在这里而不是每个文件各写一遍：一处漏了就是一处「同盟」露在深潜房，而调用点有十几处；
// 集中以后由一个测试逐个钉住。

import { t } from '../../../shared/i18n.js';

/** The running match is a 深渊回响 deep dive? (m.public.echo.deepecho, or a match frame that says variant). */
export const isDivePub = (pub) => pub?.echo?.deepecho === true || pub?.variant === 'deepecho';
/** The settlement belongs to a dive? (m.result.variant, or the m.public that came with it). */
export const isDiveResult = (res) => res?.variant === 'deepecho';
/** The room is a dive room? (room.state.variant, mode:'coop'). */
export const isDiveRoom = (room) => room?.variant === 'deepecho';

/** 「同盟成员」/「深潜成员」 */
export const diveTeam = (dive) => (dive ? t('深潜成员') : t('同盟成员'));
/** 「同盟通过回合」/「深潜通过回合」 */
export const diveRounds = (dive) => (dive ? t('深潜通过回合') : t('同盟通过回合'));
/** 「同盟剩余生命」/「深潜剩余生命」 */
export const diveTeamLp = (dive) => (dive ? t('深潜剩余生命') : t('同盟剩余生命'));
/** 「返回同盟」/「返回深潜」 */
export const diveBack = (dive) => (dive ? t('返回深潜') : t('返回同盟'));
/** 「模拟即将开始」/「深潜即将开始」 */
export const diveSoonBanner = (dive) => (dive ? t('深潜即将开始') : t('模拟即将开始'));
/** 「正在进入模拟…」/「正在进入深潜…」 */
export const diveEntering = (dive) => (dive ? t('正在进入深潜…') : t('正在进入模拟…'));
/** 「正在载入模拟数据…」/「正在载入深潜数据…」 */
export const diveLoadingData = (dive) => (dive ? t('正在载入深潜数据…') : t('正在载入模拟数据…'));
/** 「已通过模拟{n}次」/「已通过深潜{n}次」 */
export const diveWonTimes = (dive, n) => (dive ? t('已通过深潜{n}次', { n }) : t('已通过模拟{n}次', { n }));
/** 「模拟完成」/「深潜完成」 */
export const diveCleared = (dive) => (dive ? t('深潜完成') : t('模拟完成'));
/** 「模拟中断」/「深潜中断」 */
export const diveInterrupted = (dive) => (dive ? t('深潜中断') : t('模拟中断'));
/** 「模拟失败」/「深潜失败」 */
export const diveFailed = (dive) => (dive ? t('深潜失败') : t('模拟失败'));
/** 「本局模拟已结束」/「本局深潜已结束」 */
export const diveRunEnded = (dive) => (dive ? t('本局深潜已结束') : t('本局模拟已结束'));
/** 「模拟已结束」/「深潜已结束」 */
export const diveClosed = (dive) => (dive ? t('深潜已结束') : t('模拟已结束'));
/** 「本局模拟已经结束，无法救援」/「本局深潜已经结束，无法救援」 */
export const diveReviveGone = (dive) => (dive ? t('本局深潜已经结束，无法救援') : t('本局模拟已经结束，无法救援'));
/** 「离开观战席并返回大厅，本局模拟不受影响；观战席空着时可以凭同盟密钥再次观战。」 */
export const diveSpectatorExit = (dive) => (dive
  ? t('离开观战席并返回大厅，本次深潜不受影响；观战席空着时可以凭深潜密钥再次观战。')
  : t('离开观战席并返回大厅，本局模拟不受影响；观战席空着时可以凭同盟密钥再次观战。'));
/** 统计页：这条记录的数据由房间的版本决定（深潜房说「深潜」） */
export const diveRecordNote = (dive, version) => (dive
  ? t('深潜中的数据由房间的版本决定，离开深潜后才能回看「{version}」的结算', { version })
  : t('同盟中的数据由房间的版本决定，离开同盟后才能回看「{version}」的结算', { version }));
/** 连接横幅：重连后正在同步房间状态 */
export const diveSyncing = (dive) => (dive ? t('正在同步深潜状态…') : t('正在同步同盟状态…'));
/** 已经坐在别的房间里了 */
export const diveAlreadyIn = (dive) => (dive ? t('你已在其他深潜中，请先离开当前深潜') : t('你已在其他同盟中，请先离开当前同盟'));
/** 座位已经不在了（被移出 / 在别处离开） */
export const diveSeatGone = (dive) => (dive ? t('你已不在该深潜中') : t('你已不在该同盟中'));

/**
 * 「还剩 N 小时 / N 分钟」——大厅的「恢复对局」、房间顶部、退出确认框共用一句。
 * 不到 1 小时说分钟（最后关头玩家要知道是 12 分钟还是 2 分钟）。
 * @param {number} leftMs
 */
export function holdLeftLabel(leftMs) {
  const ms = Number(leftMs);
  if (!(ms > 0)) return t('已过期');
  if (ms >= 3_600_000) return t('还剩 {h} 小时', { h: Math.ceil(ms / 3_600_000) });
  return t('还剩 {m} 分钟', { m: Math.max(1, Math.ceil(ms / 60_000)) });
}

/**
 * 服务端 `SESSION_IN_USE` 的 detail 里「这个账号挡在一间**保存中的单人深潜**门口」
 * （server/soloHold.js 的 `soloHoldConflictDetail`，格式 `solo-hold:<房号>:<剩余分钟>`）。
 *
 * 为什么需要它：这种情形下通用的 SESSION_IN_USE 文案是「请关闭原窗口后重试」—— 而这里
 * 「离开那间房」恰恰会把这局按 abandoned 结算掉。必须换成「还剩多久、离开就没了」。
 * @param {unknown} detail
 * @returns {{ code: string, minutes: number } | null}
 */
export function parseSoloHoldDetail(detail) {
  if (typeof detail !== 'string') return null;
  const m = /^solo-hold:([A-Za-z0-9]{2,12}):(\d{1,7})$/.exec(detail);
  if (!m) return null;
  return { code: m[1], minutes: Number(m[2]) };
}

/**
 * 「你的单人深潜 {code} 正在保存中（{left}）……」
 * @param {{ code: string, minutes: number }} held
 */
export function soloHoldBlockedText(held) {
  const left = holdLeftLabel(held.minutes * 60_000);
  return t('你的单人深潜 {code} 正在保存中（{left}），现在还开着别的对局就会把它放弃掉。要玩别的，请先回那间房离开这局；不想保留就直接放弃。', { code: held.code, left });
}
