// 「公开深潜」：深渊回响专属的公开列表（维护者 2026-11-06）。
//
// 之前「公开深潜」只是把深潜房挂进**普通**「公开同盟」列表（混在一起，普通玩家也会看到）。
// 现在深潜有自己的一份列表：
//   · room.list { variant: 'deepecho' } 只列深潜房；不带 variant 的普通列表**不再**混进深潜房；
//   · 跨节点 /mm/api/rooms/open?variant=deepecho 同理（collectOpenRooms 的 variant 过滤）；
//   · 大厅「深渊回响」整屏的「公开深潜」按钮打开这份列表（想开一间就点列表里的「开一间公开的」）；
//   · 房间设置里同一个开关，深潜房显示成「公开深潜：已公开 / 未公开」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { C2S } from '../../shared/protocol.js';
import { DATA } from '../match/harness.js';
import openRooms from '../../matchmaker/openRooms.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const admin = (id) => ({
  playerId: id, name: 'H', connected: true, roomCode: null, ws: null,
  guest: false, accountId: `acc_${id}`, adminId: true,
});

/** 一间公开的深潜房 + 一间公开的普通同盟房。 */
function twoRooms() {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: class { constructor() {} start() {} dispose() {} }, getData: () => DATA, log: quiet });
  const a = admin('p_echo');
  const b = admin('p_plain');
  registry.byPlayerId.set(a.playerId, a);
  registry.byPlayerId.set(b.playerId, b);
  assert.equal(lobby.create(a, { mode: 'coop', difficulty: 'ABYSS', variant: 'deepecho' }).ok, true);
  const echoRoom = lobby.roomOf(a);
  assert.equal(lobby.setListed(a, { listed: true }).ok, true);
  assert.equal(lobby.create(b, { mode: 'coop', difficulty: 'HARD' }).ok, true);
  const plainRoom = lobby.roomOf(b);
  assert.equal(lobby.setListed(b, { listed: true }).ok, true);
  return { lobby, echoRoom, plainRoom };
}

test('协议：room.list 接受 variant（只有 deepecho）', () => {
  const schema = C2S['room.list'];
  assert.ok(schema, 'room.list 还在');
  assert.equal(schema.variant('deepecho'), true);
  assert.equal(schema.variant('coop'), false);
  assert.ok(schema.$optional.includes('variant'), '不带 variant = 普通列表');
});

test('本节点：公开深潜列表只列深潜房，普通列表不混深潜房', () => {
  const { lobby, echoRoom, plainRoom } = twoRooms();
  const echoList = lobby.roomList({ variant: 'deepecho' }).reply.rooms.map((r) => r.code);
  assert.deepEqual(echoList, [echoRoom.code], '深潜列表里只有深潜房');
  const plainList = lobby.roomList().reply.rooms.map((r) => r.code);
  assert.deepEqual(plainList, [plainRoom.code], '普通列表里只有普通房');
  // 两份列表各自缓存，不会互相污染
  assert.deepEqual(lobby.roomList().reply.rooms.map((r) => r.code), [plainRoom.code], '再查一次普通列表仍然干净');
  assert.deepEqual(lobby.roomList({ variant: 'deepecho' }).reply.rooms.map((r) => r.code), [echoRoom.code], '再查一次深潜列表仍然只有它');
});

test('跨节点：collectOpenRooms 按 variant 分开（默认只给普通房）', () => {
  const doc = (extra) => JSON.stringify({ code: extra.code, mode: 'coop', difficulty: 'ABYSS', hostId: 'p1', capacity: 4, listed: true,
    seats: [{ playerId: 'p1', name: '房主' }, null, null, null], ...extra });
  const perNode = [{ node: 3, flat: ['AAAA', doc({ code: 'AAAA', variant: 'deepecho' }), 'BBBB', doc({ code: 'BBBB' })] }];
  const plain = openRooms.collectOpenRooms(perNode);
  assert.deepEqual(plain.map((r) => r.code), ['BBBB'], '默认列表不混深潜房');
  const echo = openRooms.collectOpenRooms(perNode, { variant: 'deepecho' });
  assert.deepEqual(echo.map((r) => r.code), ['AAAA'], '深潜列表只有深潜房');
  assert.equal(echo[0].variant, 'deepecho');
});

test('界面：公开深潜列表用专属标题 / 加入文案 / 空态，并能一键开一间公开的', () => {
  const src = read('public/js/ui/roomList.js');
  assert.match(src, /export function RoomListDialog\(\{ online, queued = false, busy = null, onJoin, onClose, variant = null \}\)/,
    '对话框要收 variant / onCreatePublic');
  assert.match(src, /const echo = variant === 'deepecho';/, '要认深潜');
  assert.match(src, /net\.request\('room\.list', echo \? \{ variant: 'deepecho' \} : \{\}\)/, '本节点列表要带 variant');
  assert.match(src, /\/mm\/api\/rooms\/open\$\{variant === 'deepecho' \? '\?variant=deepecho' : ''\}/, '跨节点列表要带 variant');
  assert.match(src, /title=\$\{echo \? t\('公开深潜'\) : t\('公开同盟'\)\}/, '标题分开');
  assert.match(src, /t\('加入深潜'\)/, '加入按钮文案');
  assert.match(src, /t\('暂时没有公开的深渊回响房'\)/, '空态文案');
});

test('大厅：公开深潜按钮打开这份列表（列表里不再有「开一间公开的」）', () => {
  const src = read('public/js/screens/lobby.js');
  assert.match(src, /const \[echoBrowseOpen, setEchoBrowseOpen\] = useState\(false\)/, '要有列表开关');
  assert.match(src, /setEchoBrowseOpen\(true\)/, '公开深潜按钮要打开列表');
  assert.match(src, /\$\{RoomListDialog\} variant="deepecho"/, '渲染深潜列表');
  assert.doesNotMatch(src, /onCreatePublic/, '公开深潜列表不再有「开一间公开的」（维护者 2026-11-06）');
  assert.match(src, /浏览公开的深潜房（进房仍需深潜资格）；想公开自己的房，进房后打开「公开深潜」/, '按钮提示语改成浏览');
});

test('房间设置：深潜房的同一个开关叫「公开深潜」', () => {
  const src = read('public/js/screens/room.js');
  assert.match(src, /t\('公开深潜：已公开'\)/, '已公开文案');
  assert.match(src, /t\('公开深潜：未公开'\)/, '未公开文案');
  assert.match(src, /const echoRoom = room\.variant === 'deepecho';/, '要在 RoomOptions 里自己判断（作用域内）');
  assert.match(src, /t\(echoRoom \? '其他博士可以在「深渊回响 → 公开深潜」里看到这个房间并加入（需要深潜资格）'/, '提示语按深潜说');
});


test('建房后「要不要公开」的询问框：深潜房说「公开深潜」，并且深潜房也会被问一次', () => {
  const list = read('public/js/ui/roomList.js');
  assert.match(list, /export function ListPromptDialog\(\{ busy = false, onPublic, onPrivate, echo = false \}\)/, '询问框要认深潜');
  assert.match(list, /title=\$\{echo \? t\('要公开这次深潜吗？'\) : t\('要公开这个同盟吗？'\)\}/, '标题按模式切换');
  assert.match(list, /\$\{echo \? t\('公开深潜'\) : t\('公开同盟'\)\}/, '按钮按模式切换');
  assert.match(list, /公开以后，你创建的这个深潜房会出现在「深渊回响 → 公开深潜」列表里/, '说明按深潜说');
  const room = read('public/js/screens/room.js');
  assert.match(room, /echo=\$\{echoRoom\}/, '房间把 echoRoom 传给询问框');
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /if \(mode === 'coop' && !\(variant === 'deepecho' && overrides && overrides\.listed\)\) markListPrompt\(\);/,
    '深潜房也要问一次（已经公开过的不再问）');
});
test('英文包：新增文案都有译文', () => {
  const en = JSON.parse(read('public/i18n/en.json'));
  for (const k of ['公开深潜', '加入深潜', '暂时没有公开的深渊回响房', '要公开这次深潜吗？',
    '公开以后，你创建的这个深潜房会出现在「深渊回响 → 公开深潜」列表里，其他博士可以直接看到并加入（需要深潜资格）。',
    '公开深潜：已公开', '公开深潜：未公开',
    '由创建者公开、尚未开局的深渊回响房显示在这里（进房仍需深潜资格）。']) {
    assert.equal(typeof en[k], 'string', `en.json 缺 ${k}`);
  }
});
