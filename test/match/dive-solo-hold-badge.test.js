// 「深渊回响」单人房的 24 小时保存标记：控制台与后台要能**一眼看出**这些房间在「替人留着」。
//
// 维护者 2026-11-08：「在管理后台与节点控制台增加深渊回响单人房处于没有游玩状态保存24小时的房间增加标记显示」。
//
// 判据（与 lobby.soloLikeRun / soloResumeWindowMs 同一条链路，落在 lobbyState.soloHoldDoc）：
//   * 深潜房（variant === 'deepecho'）且这一局真的开着；
//   * 房间里只有 **1 个真人**（AI 座位不算人）；
//   * 那个人**不在线**（关掉页面 / 掉线 / 换设备）；
//   * 他的会话还挂着 resumeWindowMs（单人房 = 官方 singleReconnectTime = 24 小时）。
//
// 数据流：lobbyState.roomDoc 写 `soloHold = { since, until, windowMs, name }` → Redis → matchmaker 的
// roomInfo() 清洗后透传 → content/rooms.json → 节点控制台（dashboard/public/app.js）与
// 管理后台（matchmaker/public/admin.html）各画一枚「已保存 · 剩 N 小时」的紫色角标。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { soloHoldDoc } from '../../server/persist/lobbyState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const HOUR = 3600_000;
const T0 = 1_800_000_000_000;

/** 一个「深渊回响单人房」的最小替身：`roomDoc` 只读这几个字段。 */
function room(over = {}) {
  const seat = { seat: 0, playerId: 'p_0', name: '博士', isBot: false, connected: false, ...(over.seat || {}) };
  return {
    code: 'PBJH', mode: 'coop', difficulty: 'ABYSS', variant: 'deepecho',
    match: {},                                 // 这一局真的开着（没结束）
    disposed: false, modded: false,
    seats: [seat, null, null, null],
    spectators: [],
    hostId: 'p_0',
    activeHumans: () => [seat].filter((s) => s && !s.isBot && !s.left),
    lastHumanLeftAt: T0,
    ...over.room,
  };
}

/** 一个掉线中的会话：24 小时窗口。 */
const session = (over = {}) => ({ playerId: 'p_0', connected: false, disconnectedAt: T0, resumeWindowMs: 24 * HOUR, ...over });

test('深潜单人房 + 那个人不在线 → 有保存标记，窗口是 24 小时', () => {
  const hold = soloHoldDoc(room(), () => session());
  assert.ok(hold, '要有标记');
  assert.equal(hold.since, T0, '从断线那一刻算起');
  assert.equal(hold.until, T0 + 24 * HOUR, '24 小时后到期');
  assert.equal(hold.windowMs, 24 * HOUR);
  assert.equal(hold.name, '博士', '带上是谁的房（角标 tooltip 用）');
});

test('有人在玩 / 两个真人 / 不是深潜 / 没开局 → 都没有标记', () => {
  // 在线：正常游戏，不叫「保存」
  assert.equal(soloHoldDoc(room({ seat: { connected: true } }), () => session({ connected: true })), null, '在线不打标记');

  // 两个真人：不是单人房，走的是「等队友」而不是「替他保存」
  const two = room();
  two.seats[1] = { seat: 1, playerId: 'p_1', name: 'T', isBot: false, connected: false };
  two.activeHumans = () => two.seats.filter((s) => s && !s.isBot && !s.left);
  assert.equal(soloHoldDoc(two, () => session()), null, '两人房没有「保存单人房」这回事');

  // 普通房（不是深潜）
  assert.equal(soloHoldDoc(room({ room: { variant: null } }), () => session()), null, '只有深渊回响才标');
  // 单人模拟（mode: 'solo'）也不是深潜
  assert.equal(soloHoldDoc(room({ room: { variant: 'deepecho', mode: 'solo' } }), () => session()), null, 'mode 必须是 coop');

  // 这一局已经结束（没有 match）：房间在等人开局，不是「保存」
  assert.equal(soloHoldDoc(room({ room: { match: null } }), () => session()), null, '没开局不叫保存');
});

test('会话没了 / 没有断线时刻 → 不给猜出来的倒计时', () => {
  // 没有会话：窗口退回官方 24 小时，起点用 room.lastHumanLeftAt
  const noSession = soloHoldDoc(room(), () => null);
  assert.ok(noSession, '重启后会话还没回来，也要能标出来');
  assert.equal(noSession.windowMs, 24 * HOUR, '退回官方 singleReconnectTime');
  assert.equal(noSession.since, T0, '起点用「最后一个人离开」的时刻');

  // 连断线时刻都不知道：宁可不标，也不给假倒计时
  assert.equal(soloHoldDoc(room({ room: { lastHumanLeftAt: 0 } }), () => null), null, '没有起点就不标');
});

test('会话窗口比 24 小时短（普通 10 分钟）时按会话的真实窗口算', () => {
  const hold = soloHoldDoc(room(), () => session({ resumeWindowMs: 10 * 60_000 }));
  assert.ok(hold);
  assert.equal(hold.windowMs, 10 * 60_000, '用会话自己的窗口，不硬编码 24 小时');
  assert.equal(hold.until, T0 + 10 * 60_000);
});

test('roomDoc 只在「保存中」时写 soloHold 键（普通房间的存档逐字节不变）', () => {
  const docSrc = read('server/persist/lobbyState.js');
  assert.match(docSrc, /const soloHold = soloHoldDoc\(room, sessionOf\);/, 'roomDoc 里算一次');
  assert.match(docSrc, /\.\.\.\(soloHold \? \{ soloHold \} : \{\}\)/, '只在有标记时写键');

  // persister 的 roomKey 必须把标记算进去 —— 否则玩家关掉页面时房间文档根本不会重写
  const persister = read('server/persist/persister.js');
  assert.match(persister, /soloHoldDoc\(room,/, 'roomKey 里也要算');
  assert.match(persister, /key\.push\(hold \? hold\.since : null, hold \? hold\.until : null\)/, 'since/until 进 key');
});

test('roomDoc：真的把 soloHold 写进房间文档（走完整的存档路径）', async () => {
  const { roomDoc } = await import('../../server/persist/lobbyState.js');
  const sessions = new Map([['p_0', session()]]);
  const sessionOf = (id) => sessions.get(id) || null;

  const holding = roomDoc(room(), () => null, sessionOf);
  assert.ok(holding, 'roomDoc 要能保存这间房');
  assert.deepEqual(holding.soloHold && Object.keys(holding.soloHold).sort(), ['name', 'playerId', 'since', 'until', 'windowMs'], '标记字段齐全');
  assert.equal(holding.soloHold.until, T0 + 24 * HOUR);

  // 人回来了：同一个房间不再带这个键（存档与从前逐字节一致）
  const back = roomDoc(room({ seat: { connected: true } }), () => null, sessionOf);
  assert.equal(Object.hasOwn(back, 'soloHold'), false, '在线时不写这个键');
});

test('matchmaker：roomInfo 透传并清洗 soloHold（缺字段 → 整条省掉）', () => {
  const mm = read('matchmaker/server.js');
  assert.match(mm, /const soloHold = soloHoldView\(doc\.soloHold\);/, '读 doc.soloHold');
  assert.match(mm, /\.\.\.\(soloHold \? \{ soloHold \} : \{\}\)/, '没有就不下发');
  assert.match(mm, /function soloHoldView\(raw\)/, '有清洗函数');
  assert.match(mm, /until <= since\) return null/, '时间戳不合法就当没有');
});

test('节点控制台：状态写「保存中」，房间号后面挂「已保存 · 剩 N 小时」', () => {
  const app = read('dashboard/public/app.js');
  assert.match(app, /const state = x\.soloHold \? '保存中' : x\.started \? '对局中'/, '状态列优先显示保存中');
  assert.match(app, /function soloHoldBadge\(hold\)/, '有角标函数');
  assert.match(app, /'已保存 · 剩 ' \+ hours \+ ' 小时'/, '文案带剩余小时');
  assert.match(app, /Math\.ceil\(left \/ 3600000\)/, '小时向上取整（剩 30 分钟不写成 0 小时）');
  assert.match(app, /class="room-hold' \+ \(hold\.expired \? ' is-expired' : ''\)/, '过期的标红');
  assert.match(app, /const holdBadge = hold \?/, '渲染到行里');
  assert.match(app, /const holds = rooms\.filter\(\(x\) => x\.soloHold\)\.length;/, '统计里计数');
  const html = read('dashboard/public/index.html');
  assert.match(html, /#rooms-bar \.room-state\.is-hold:before\{background:#b79cff/, '状态点紫色');
  assert.match(html, /#rooms-bar \.room-hold\{/, '角标样式');
  assert.match(html, /#rooms-bar \.room-hold\.is-expired\{/, '过期样式');
});

test('管理后台：同一套标记与文案', () => {
  const admin = read('matchmaker/public/admin.html');
  assert.match(admin, /const state = r\.soloHold \? '保存中' : r\.started \? '对局中'/, '状态列同理');
  assert.match(admin, /function soloHoldBadge\(hold\)/, '有角标函数');
  assert.match(admin, /'已保存 · 剩 ' \+ hours \+ ' 小时'/, '文案一致');
  assert.match(admin, /room-hold' \+ \(hold\.expired \? ' is-expired' : ''\)/, '过期标红');
  assert.match(admin, /esc\(r\.code\) \+ '<\/span>' \+ capBadge \+ adminBadge \+ holdBadge/, '挂在房间号后面');
  assert.match(admin, /保存中 ' \+ rooms\.filter\(\(x\) => x\.soloHold\)\.length/, '统计里计数');
  assert.match(admin, /#roomBody \.room-state\.is-hold:before\{background:#b79cff/, '状态点紫色');
  assert.match(admin, /#roomBody \.room-hold\{/, '角标样式');
  assert.match(admin, /#roomBody \.room-hold\.is-expired\{/, '过期样式');
});
