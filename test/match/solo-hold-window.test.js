// 「深渊回响」单人房的 24 小时保存（维护者 2026-11-08）：
//
//   A：同一节点的提示文案要改 —— 通用 SESSION_IN_USE 说「请先离开原房间」，而这里「离开」正好把这局
//      按 abandoned 结算掉。改成「还剩 N 小时、离开就没了」。
//   B：保持**硬截止**（不因去别处玩而暂停），但剩余时间要显示得更醒目。
//
// 这条链路横跨四处，测试逐个钉住：
//   server/soloHold.js               一条判据（保存中 + 剩余毫秒 + 冲突 detail 格式）
//   server/lobby.js                  room.state.soloHold；三处「账号已在别的房间」改走 inUseFail
//   server/net.js                    fail(ERR, msg('…')) 的 detail 不再变成 "[object Object]"
//   public/js/ui/{diveWords,toasts,resumeMatch,accountRoom}.js   玩家看到的那句话
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { soloHoldOf, holdLeftText, soloHoldConflictDetail, SOLO_HOLD_FALLBACK_SEC } from '../../server/soloHold.js';
import { errorMsg } from '../../server/net.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { DATA } from './harness.js';
import { holdLeftLabel, parseSoloHoldDetail, soloHoldBlockedText } from '../../public/js/ui/diveWords.js';
import { normalizeHold } from '../../public/js/ui/accountRoom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const HOUR = 3600_000;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** 保存中的单人深潜房（socket 不需要：这里只问判据）。 */
function heldRoom({ variant = 'deepecho', humans = 1, connected = false, mode = 'coop', match = true } = {}) {
  const seat = { playerId: 'p_1', name: '博士', connected, isBot: false };
  return {
    mode, variant, disposed: false, match: match ? {} : null, lastHumanLeftAt: 0,
    activeHumans: () => (humans === 1 ? [seat] : [seat, { playerId: 'p_2', name: '另一位', connected: true, isBot: false }]),
  };
}

test('soloHoldOf：只有「深潜 + 单人 + 不在线」才算保存中', () => {
  const now = 1_800_000_100_000;
  const sess = { disconnectedAt: 1_800_000_000_000, resumeWindowMs: 24 * HOUR };
  const of = () => sess;
  const got = soloHoldOf(heldRoom(), of, undefined, now);
  assert.ok(got, '应当算保存中');
  assert.equal(got.until, 1_800_000_000_000 + 24 * HOUR, '到期 = 断线 + 24 小时');
  assert.equal(got.leftMs, 24 * HOUR - 100_000, '剩余毫秒');

  assert.equal(soloHoldOf(heldRoom({ connected: true }), of), null, '有人在玩不算保存');
  assert.equal(soloHoldOf(heldRoom({ humans: 2 }), of), null, '多人局没有「保存单人房」');
  assert.equal(soloHoldOf(heldRoom({ variant: null }), of), null, '普通房没有这回事');
  assert.equal(soloHoldOf(heldRoom({ mode: 'solo' }), of), null, 'mode 必须是 coop');
  assert.equal(soloHoldOf(heldRoom({ match: false }), of), null, '没开局不叫保存');

  // 没有会话（重启后还没回来）：退回官方 24 小时，并从「最后一个人离开」算起
  const noSess = heldRoom();
  noSess.lastHumanLeftAt = 1_800_000_000_000;
  const fallback = soloHoldOf(noSess, () => null, undefined, now);
  assert.equal(fallback.windowMs, SOLO_HOLD_FALLBACK_SEC * 1000, '兜底窗口');
  assert.equal(fallback.since, 1_800_000_000_000, '从最后一个人离开算');
  // 连起点都不知道：宁可不标
  assert.equal(soloHoldOf(heldRoom(), () => null), null, '没有起点就不标');
});

test('冲突 detail：`solo-hold:<房号>:<剩余分钟>`，能转成「还剩 N 小时」', () => {
  const detail = soloHoldConflictDetail({ room: { code: 'ABCD' }, hold: { leftMs: 5 * HOUR } });
  assert.equal(detail, 'solo-hold:ABCD:300');
  assert.deepEqual(parseSoloHoldDetail(detail), { code: 'ABCD', minutes: 300 });
  assert.equal(parseSoloHoldDetail('solo-hold:ABCD:300').minutes, 300);
  assert.equal(parseSoloHoldDetail('别的 detail'), null, '别的 detail 不认');
  assert.equal(parseSoloHoldDetail(null), null);
  assert.equal(soloHoldConflictDetail({ room: { code: 'ABCD' }, hold: null }), null, '没在保存就不带');

  assert.equal(holdLeftLabel(5 * HOUR), '还剩 5 小时');
  assert.equal(holdLeftLabel(20 * 60_000), '还剩 20 分钟');
  assert.equal(holdLeftLabel(0), '已过期');
  assert.equal(holdLeftText(5 * HOUR), '剩 5 小时', '服务端那一份（诊断用）');
  const text = soloHoldBlockedText({ code: 'ABCD', minutes: 300 });
  assert.match(text, /ABCD/);
  assert.match(text, /还剩 5 小时/);
  assert.match(text, /放弃/, '要说明「离开 = 放弃」');
  assert.doesNotMatch(text, /请先离开原房间/, '不能给那句错的办法');
});

test('net.js：fail(ERR, msg(…)) 的 detail 不再变成 "[object Object]"', () => {
  const frame = errorMsg('VERSION_UNSUPPORTED', 7, { msgid: '「深渊回响」只支持「第二期下半」，不支持其他版本' });
  assert.equal(frame.detail, '「深渊回响」只支持「第二期下半」，不支持其他版本', 'detail = 中文渲染（老客户端/日志/测试）');
  assert.equal(frame.detailMsg.msgid, '「深渊回响」只支持「第二期下半」，不支持其他版本', 'detailMsg = 可翻译的那份');
  assert.ok(frame.detailMsg.text, '带 text 给老客户端');
  // 普通字符串 detail 逐字不变（很多测试与日志在用它）
  assert.equal(errorMsg('BAD_MSG', 1, 'unknown type foo').detail, 'unknown type foo');
  assert.equal(Object.hasOwn(errorMsg('BAD_MSG', 1, 'x'), 'detailMsg'), false, '字符串 detail 不带 detailMsg');
});

/** 一间保存中的单人深潜 + 一间别人开的房。 */
function twoRooms() {
  let t = 1_800_000_000_000;
  const now = () => t;
  const registry = new SessionRegistry({ now });
  const lobby = new Lobby({
    registry, getData: () => DATA, log: quiet, now,
    MatchClass: class { constructor(o) { this.opts = o; } start() {} dispose() {} onLeave() {} onDisconnect() {} onReconnect() {} },
  });
  const who = (name, accountId) => {
    const s = registry.create(name);
    Object.assign(s, { guest: false, accountId, adminId: true, connected: true });
    return s;
  };
  const a = who('A', 'acc_A');
  assert.deepEqual(lobby.create(a, { mode: 'coop', difficulty: 'NORMAL', variant: 'deepecho' }), { ok: true });
  const solo = lobby.roomOf(a);
  lobby.addBot(a);
  lobby.startMatch(solo, 'k1');
  a.connected = false;
  lobby.onDisconnect(a);
  const b = who('B', 'acc_B');
  lobby.create(b, { mode: 'coop', difficulty: 'NORMAL' });
  return { lobby, registry, solo, other: lobby.roomOf(b), who, advance: (ms) => { t += ms; } };
}

test('room.state.soloHold：房间把剩余时间发给页面（B：显示得更醒目用）', () => {
  const h = twoRooms();
  const st = h.solo.toState(1_800_000_000_000);
  assert.ok(st.soloHold, '保存中的深潜房要带这个键');
  assert.equal(st.soloHold.windowMs, 24 * HOUR);
  assert.equal(st.soloHold.leftMs, 24 * HOUR);
  assert.equal(st.soloHold.name, 'A');
  // 普通房不带这个键（room.state 逐字节不变）
  assert.equal(Object.hasOwn(h.other.toState(), 'soloHold'), false, '普通房不能带');
});

test('A：账号卡在保存中的深潜门口时，拒绝语换成「还剩 N、离开就没了」', () => {
  const h = twoRooms();
  const a2 = h.who('A', 'acc_A');
  const r = h.lobby.join(a2, { code: h.other.code });
  assert.equal(r?.error, 'SESSION_IN_USE');
  const held = parseSoloHoldDetail(r.detail);
  assert.ok(held, `detail 要是 solo-hold 格式，实际 ${JSON.stringify(r.detail)}`);
  assert.equal(held.code, h.solo.code, '说的是那间保存中的深潜房');
  assert.equal(held.minutes, 24 * 60, '24 小时');
  // 客户端那句（玩家真正看到的）
  assert.match(soloHoldBlockedText(held), /正在保存中/);
  assert.doesNotMatch(soloHoldBlockedText(held), /请先离开原房间/);
});

test('A：普通房（不是保存中的深潜）仍走原来那句，不受影响', () => {
  const h = twoRooms();
  // 让 A 的深潜结束保存状态：他回来了（在线）
  const a3 = h.who('A', 'acc_A');
  assert.deepEqual(h.lobby.join(a3, { code: h.solo.code }), { ok: true }, '先回自己的房');
  // 现在 A 在跑着的深潜里，再去 join 别人的房 → 还是 SESSION_IN_USE，但**不是** solo-hold 格式
  const a4 = h.who('A', 'acc_A');
  const r = h.lobby.join(a4, { code: h.other.code });
  assert.equal(r?.error, 'SESSION_IN_USE');
  assert.equal(parseSoloHoldDetail(r.detail), null, '在线上的人不算「保存中」');
});

test('toasts.js：SESSION_IN_USE 的 solo-hold detail 走深潜那句话', () => {
  const src = read('public/js/ui/toasts.js');
  assert.match(src, /parseSoloHoldDetail\(err\.detail\)/, '先认 solo-hold');
  assert.match(src, /soloHoldBlockedText\(held\)/, '换成深潜的说法');
  assert.match(src, /translateWire\(err\.detailMsg\)/, 'fail(…, msg()) 的那句解释优先');
  // 顺序：detailMsg 在 SESSION_IN_USE 之前（服务端明说了就听服务端的）
  const iMsg = src.indexOf('translateWire(err.detailMsg)');
  const iHold = src.indexOf('parseSoloHoldDetail(err.detail)');
  assert.ok(iMsg > 0 && iHold > iMsg, 'detailMsg 先判');
});

test('B：大厅右上角常驻「正在保存 · 还剩 N 小时」', () => {
  const src = read('public/js/ui/resumeMatch.js');
  assert.match(src, /data-testid="resume-hold"/, '有独立的提示条');
  assert.match(src, /holdLeftLabel\(hold\.leftMs\)/, '剩余时间来自 hold');
  assert.match(src, /t\('恢复深潜 · \{left\}', \{ left: holdLeft \}\)/, '按钮也写剩余时间');
  assert.match(src, /normalizeHold\(j\?\.room\?\.soloHold\)/, '从 /mm/api/account/room 取');
  // CSS 要有自己的样式（不靠内联）
  const css = read('public/css/components.css');
  assert.match(css, /\.resume-hold \{/, '有自己的样式');
  assert.match(css, /\.resume-hold b \{[^}]*font-weight: 800/, '标题更重');
});

test('B：退出确认框说明「硬截止、不去别处也会走」', () => {
  const src = read('public/js/ui/matchChrome.js');
  assert.match(src, /这 24 小时从你关掉页面那一刻开始算，中途去玩别的对局也照样走/, '把硬截止说清楚');
});

test('accountRoom.normalizeHold：缺字段/坏时间戳 → null，不编造倒计时', () => {
  assert.equal(normalizeHold(null), null);
  assert.equal(normalizeHold({}), null);
  assert.equal(normalizeHold({ until: 0 }), null);
  const ok = normalizeHold({ since: 1000, until: Date.now() + 2 * HOUR, windowMs: 24 * HOUR, name: 'A' });
  assert.equal(ok.name, 'A');
  assert.ok(ok.leftMs > 1.9 * HOUR && ok.leftMs <= 2 * HOUR, '剩余毫秒');
  assert.equal(normalizeHold({ until: Date.now() - 1000 }).leftMs, 0, '过期记 0，不出现负数');
});

test('matchmaker /api/account/room 透传 soloHold（页面才拿得到剩余时间）', () => {
  const src = read('matchmaker/account.cjs');
  assert.match(src, /const named = \(code, n, soloHold\) => /, 'named 要能带 soloHold');
  assert.match(src, /named\(room\.code, n\.n, room\.soloHold \|\| null\)/, '账号命中时一起带上');
});
