// 「深渊回响」整屏的两个新按钮：公开深潜 / 开始多人匹配（维护者 2026-11-06）。
//
// 深潜以前只有「开始深渊回响」一个出口：房建出来是私有的，也不能进匹配池。
// 现在补上和大厅同盟模拟一样的两条路：
//   · 公开深潜 = 建房 + 立刻挂到「公开同盟」列表（列表里显示成深渊回响）；
//   · 开始多人匹配 = 进**深潜自己的**匹配池（server/lobby.js quickMatch 的 variant 维度），
//     只会配到深潜房，凑不够就排队等人。
//
// 关键约束（两条都不能破）：
//   1) 深潜池只和深潜配（普通同盟永远进不来，反之亦然）；
//   2) 进房仍是管理员 / 测试名单专属（ECHO_FORBIDDEN 那道门不动）。
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

const admin = (id = 'p_host') => ({
  playerId: id, name: 'H', connected: true, roomCode: null, ws: null,
  guest: false, accountId: 'acc_test', adminId: true,
});

/** 一间深潜房（管理员才能建）。 */
function echoLobby() {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: class { constructor() {} start() {} dispose() {} }, getData: () => DATA, log: quiet });
  const host = admin();
  const made = lobby.create(host, { mode: 'coop', difficulty: 'ABYSS', variant: 'deepecho' });
  assert.equal(made.ok, true, `建深潜房要成功：${JSON.stringify(made)}`);
  return { registry, lobby, host, room: lobby.roomOf(host) };
}

test('协议：room.quickMatch 接受 variant（只有 deepecho）', () => {
  const schema = C2S['room.quickMatch'];
  assert.ok(schema, 'room.quickMatch 还在');
  assert.equal(schema.variant('deepecho'), true, '接受 deepecho');
  assert.equal(schema.variant('coop'), false, '别的值拒绝');
  assert.ok(schema.$optional.includes('variant'), 'variant 可省（普通多人匹配不传）');
});

test('公开深潜：深潜房能挂到公开列表，列表里带 variant', () => {
  const { lobby, host, room } = echoLobby();
  assert.equal(lobby.setListed(host, { listed: true }).ok, true, '深潜房要能公开（以前被硬拒）');
  assert.equal(room.listed, true);
  // 深潜房有自己的公开列表（2026-11-06）：普通列表不再混进深潜房，所以查深潜那一份
  const list = lobby.roomList({ variant: 'deepecho' });
  const row = list.reply.rooms.find((r) => r.code === room.code);
  assert.ok(row, '公开后要出现在房间列表里');
  assert.equal(row.variant, 'deepecho', '列表行要带 variant（界面据此显示深渊回响）');
  // 取消公开照旧
  assert.equal(lobby.setListed(host, { listed: false }).ok, true);
  assert.equal(lobby.roomList({ variant: 'deepecho' }).reply.rooms.some((r) => r.code === room.code), false);
  assert.equal(lobby.roomList().reply.rooms.some((r) => r.code === room.code), false, '普通列表里也不能有它');
});

test('开始多人匹配：深潜进自己的池，普通同盟进不来', () => {
  const { lobby, host, room } = echoLobby();
  // 深潜房挂公开 + 进匹配状态，普通房也进匹配状态
  assert.equal(lobby.setListed(host, { listed: true }).ok, true);
  assert.equal(lobby.matchmaking(host, { on: true }).ok, true);

  // 另一个管理员点「开始多人匹配」（深潜池）：应该被安排进这间深潜房
  const other = admin('p_two');
  lobby.registry.byPlayerId.set(other.playerId, other);
  const join = lobby.quickMatch(other, { difficulty: 'ABYSS', seats: 'four', rules: 'standard', variant: 'deepecho' });
  assert.equal(join.ok, true, `深潜多人匹配要成功：${JSON.stringify(join)}`);
  assert.equal(join.reply.code, room.code, '要被配进那间深潜房');
  assert.equal(join.reply.joined, true);
});

test('深潜池与普通池互不串台：普通多人匹配不会进深潜房', () => {
  const { lobby, host, room } = echoLobby();
  assert.equal(lobby.setListed(host, { listed: true }).ok, true);
  assert.equal(lobby.matchmaking(host, { on: true }).ok, true);
  const other = admin('p_three');
  lobby.registry.byPlayerId.set(other.playerId, other);
  const join = lobby.quickMatch(other, { difficulty: 'ABYSS', seats: 'four', rules: 'standard' });
  assert.equal(join.ok, true);
  assert.notEqual(join.reply.code, room.code, '普通多人匹配不能进深潜房');
  assert.equal(join.reply.queued, true, '没房可进就排队');
});

test('排队池按 variant 分开：深潜票据只和深潜票据凑成一局', () => {
  const { lobby, host } = echoLobby();
  assert.equal(lobby.setListed(host, { listed: false }).ok, true);
  const a = admin('p_a');
  const b = admin('p_b');
  lobby.registry.byPlayerId.set(a.playerId, a);
  lobby.registry.byPlayerId.set(b.playerId, b);
  const qa = lobby.quickMatch(a, { difficulty: 'ABYSS', seats: 'four', rules: 'standard', variant: 'deepecho' });
  assert.equal(qa.reply.queued, true);
  const qb = lobby.quickMatch(b, { difficulty: 'ABYSS', seats: 'four', rules: 'standard' });
  assert.equal(qb.reply.queued, true, '普通票据也要排队');
  // 深潜票据的池里只有它自己（普通票据不算同池）
  const st = lobby.quickState(a, { ticket: qa.reply.ticket });
  assert.equal(st.reply.waiting, 1, '深潜池里只应有 1 人');
  assert.equal(st.reply.need, 3);
});

test('界面：深潜整屏有「公开深潜」「开始多人匹配」，并接到建房 / 匹配', () => {
  const src = read('public/js/screens/lobby.js');
  assert.match(src, /data-testid="echo-public"/, '要有公开深潜按钮');
  assert.match(src, /data-testid="echo-quick"/, '要有开始多人匹配按钮');
  assert.match(src, /\$\{t\('公开深潜'\)\}/, '文案是公开深潜');
  assert.match(src, /\$\{t\('开始多人匹配'\)\}/, '文案是开始多人匹配');
  // 接线：公开 = 建房带 listed；匹配 = quickMatch 带 variant
  // 公开深潜 = 打开深潜专属列表（维护者 2026-11-06）；建房走列表里的「开一间公开的」
  assert.match(src, /setEchoBrowseOpen\(true\)/, '公开深潜要打开专属列表');
  assert.match(src, /create\('coop', 'deepecho', \{ difficulty: echoPick \|\| shownCoop, listed: true \}\)/, '列表里「开一间公开的」建公开房');
  assert.match(src, /quickMatch\(\{ difficulty: pickedDifficulty, seats: 'four', rules: 'standard', variant: 'deepecho' \}\)/, '多人匹配要带 variant');
  assert.match(src, /net\.request\('room\.setListed', \{ listed: true \}\)/, '建房后要真的挂上公开列表');
  // 样式
  assert.match(read('public/css/screens/lobby.css'), /\.echo-pill \{/, '按钮要有样式');
});

test('公开列表（跨节点）带 variant；大厅房间列表把深潜房显示成深渊回响', () => {
  const doc = { code: 'ABCD', mode: 'coop', difficulty: 'ABYSS', hostId: 'p1', capacity: 4, listed: true, variant: 'deepecho',
    seats: [{ playerId: 'p1', name: '房主' }, null, null, null] };
  const row = openRooms.pickOpenRoom('ABCD', 7, doc);
  assert.ok(row, '公开的深潜房要出现在跨节点列表里');
  assert.equal(row.variant, 'deepecho');
  const src = read('public/js/ui/roomList.js');
  assert.match(src, /row\.variant === 'deepecho'/, '列表行要按 variant 判断');
  assert.match(src, /t\('深渊回响'\)/, '显示成深渊回响');
});

test('英文包：两个新按钮与两条说明都有译文', () => {
  const en = JSON.parse(read('public/i18n/en.json'));
  for (const k of ['公开深潜', '开始多人匹配',
    '建一间公开的深潜房，其他博士能在「公开同盟」里看到（进房仍需深潜资格）',
    '进入深潜匹配池，和其他深潜房配对（只会配到深潜）']) {
    assert.equal(typeof en[k], 'string', `en.json 缺 ${k}`);
  }
});
