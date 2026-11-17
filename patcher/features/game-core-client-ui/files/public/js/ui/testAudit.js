// Host-dock formatting for a test-command audit row (DESIGN §34.8). Plain ESM, no DOM.
import { t } from '../../../shared/i18n.js';
import { ERR_TEXT } from '../../../shared/constants.js';

/** Scheduler milliseconds as HH:MM:SS. A bad value is 00:00:00. */
export function matchClock(ms) {
  const n = Number(ms);
  const s = Number.isFinite(n) && n > 0 ? Math.floor(n / 1000) : 0;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Newest row first. The input array is not mutated. */
export function newestFirst(log) {
  return Array.isArray(log) ? log.slice().reverse() : [];
}

/**
 * Player-facing reason carried in a test refusal's `detail`.
 * `shop|{chess,item}` and `round|{hi}` include the numbers the server checked.
 * @param {unknown} detail
 * @returns {string}
 */
export function explainTestDetail(detail) {
  if (typeof detail !== 'string' || !detail) return '';
  const bar = detail.indexOf('|');
  const kind = bar < 0 ? detail : detail.slice(0, bar);
  let params = {};
  if (bar >= 0) {
    try { params = JSON.parse(detail.slice(bar + 1)); } catch { params = {}; }
  }
  if (!params || typeof params !== 'object') params = {};
  switch (kind) {
    case 'shop': return t('这一级商店要 {chess} 个干员和 {item} 个装备', params);
    case 'round': return t('回合只能是 1 到 {hi}', params);
    case 'layers': return t('层数不能减少');
    case 'timers': return t('作战进行中不能开关计时');
    case 'bond': return t('这个盟约不能在本模式使用');
    // 盟约指令失败时以前回的是不带原因的 BAD_TARGET：控制台上只显示一句「无效的目标」，
    // 甚至漏出原始 code（bad_target），维护者不知道该改哪儿。现在每种都带上具体原因。
    case 'no-such-bond': return t('没有这个盟约：检查盟约 id 是否拼对');
    // 管理员工具「干员」页签的拒绝原因（2026-11-18，维护者：以前只显示「无效的目标」）：
    // acquireChess 有四个拒绝分支，这里逐条翻成人话，省得维护者去猜是 id 错、自选位空，还是这局被禁。
    case 'no-such-chess': return t('没有这个干员：检查干员 id 是否拼对');
    case 'diy-empty': return t('这是自选位，但本局没有编入干员：先在干员调配里编好自选，再用这条指令');
    case 'bond-unpicked': return t('本局还没选盟约（开局简报的盟约分组未确认），现在不能改干员');
    case 'excluded': return t('这个干员本局被禁用（所属盟约被置灰），拿不出来');
    case 'grant-failed': return t('这个名字的干员现在拿不出来（手牌已满或池子已空）');
    case 'cap': return t('层数超过上限：现在是 {cur} 层，最多 {max} 层，请求的是 {want} 层', params);
    case 'add': return t('这个盟约加不上去（现在是 {cur} 层，请求 {want} 层，只加到 {got} 层）', params);
    default: return '';
  }
}

/**
 * Toast text for a refused test command. A known detail is the reason itself. Otherwise the message of the
 * error code (ERR_TEXT), then the error's own message. 无效的目标 is only the fallback for a real bad target
 * or a refusal that carries neither.
 * @param {any} err
 * @returns {string}
 */
export function testRefusalText(err) {
  const why = explainTestDetail(err?.detail);
  if (why) return why;
  if (err && typeof err === 'object' && err.code && Object.hasOwn(ERR_TEXT, err.code)) return t(ERR_TEXT[err.code]);
  if (typeof err?.message === 'string' && err.message) return t(err.message);
  return t('无效的目标');
}

/** One audit line: one number, the actor's name, a clock, the command, the translated result. */
export function formatAuditLine(entry, name) {
  const e = entry || {};
  const who = name || e.playerId || '';
  const result = e.ok ? t('成功') : (explainTestDetail(e.detail) || (e.code && Object.hasOwn(ERR_TEXT, e.code) ? t(ERR_TEXT[e.code]) : (e.code || '')));
  return `${e.seq} ${who} ${matchClock(e.at)} ${e.cmd} ${result}`;
}
