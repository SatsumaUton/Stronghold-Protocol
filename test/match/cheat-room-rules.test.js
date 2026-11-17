// 作弊控制台的三条房间约束 + 「仍然开启」按钮把面板关掉的那个 bug（维护者 2026-11-17）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { Match } from '../../server/match/Match.js';
import { DATA } from './harness.js';
import { panelClosesOn } from '../../public/js/screens/room.js';

process.env.SP_GATE_IGNORE = '1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function makeLobby() {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: Match, getData: () => DATA, log: quiet, content: { cs: 'a0'.repeat(32) } });
  const host = { playerId: 'p_0123456789', name: 'H', connected: true, roomCode: null, ws: null, guest: false, accountId: 'acc_1' };
  registry.byPlayerId.set(host.playerId, host);
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  return { lobby, host, room: lobby.roomOf(host) };
}
const CHEAT = { revivalEnabled: false, disableSharedPool: false, cheatConsole: true };
const PLAIN = { revivalEnabled: false, disableSharedPool: false };

test('已公开的房间打开作弊控制台：自动取消公开', () => {
  const { lobby, host, room } = makeLobby();
  try {
    assert.equal(lobby.setListed(host, { listed: true }).ok, true);
    assert.equal(room.listed, true, '先挂到公开同盟');
    assert.equal(lobby.setExperimental(host, { experimental: CHEAT }).ok, true);
    assert.equal(room.listed, false, '开作弊后必须自动从公开同盟列表摘下来');
  } finally { lobby.shutdown(); }
});

test('作弊房不能打开公开同盟（服务端拒绝，不是只在界面上置灰）', () => {
  const { lobby, host, room } = makeLobby();
  try {
    assert.equal(lobby.setExperimental(host, { experimental: CHEAT }).ok, true);
    const res = lobby.setListed(host, { listed: true });
    assert.equal(res.error, 'BAD_TARGET');
    assert.equal(room.listed, false);
  } finally { lobby.shutdown(); }
});

test('作弊房不会被多人匹配选中（roomOpen / room.list / quickMatch 都看不到它）', () => {
  const { lobby, host, room } = makeLobby();
  try {
    assert.equal(lobby.setExperimental(host, { experimental: CHEAT }).ok, true);
    assert.equal(lobby.listable(room), false, 'listable 判否');
    assert.equal(lobby.roomOpen(room), false, 'roomOpen 判否（匹配器只挑 roomOpen 的房）');
    const list = lobby.roomList({});
    assert.equal(list.reply.rooms.some((r) => r.code === room.code), false, '公开同盟列表里也没有它');
  } finally { lobby.shutdown(); }
});

test('关掉作弊控制台后又能公开（不是一次性锁死）', () => {
  const { lobby, host, room } = makeLobby();
  try {
    lobby.setExperimental(host, { experimental: CHEAT });
    assert.equal(lobby.setListed(host, { listed: true }).error, 'BAD_TARGET');
    assert.equal(lobby.setExperimental(host, { experimental: PLAIN }).ok, true);
    assert.equal(lobby.setListed(host, { listed: true }).ok, true);
    assert.equal(room.listed, true);
  } finally { lobby.shutdown(); }
});

test('「仍然开启」的确认框不再被当成「点空白处」把设置面板关掉', () => {
  // 假事件目标：closest 只认这些选择器
  const el = (...classes) => ({ closest: (sel) => classes.some((c) => sel.includes(c)) ? {} : null });
  const panel = el('.rs-opts');
  const gear = el('.rs-pill__gear');
  const dialog = el('.modal');
  const outside = el('.backdrop');

  // 面板自己 / 齿轮 / 任何弹窗：都不关
  assert.equal(panelClosesOn(panel, false), false, '点面板本身不该关');
  assert.equal(panelClosesOn(gear, false), false, '点齿轮不该关');
  assert.equal(panelClosesOn(dialog, false), false, '点弹窗（含确认框）不该关 —— 这就是那个 bug');
  // 真正的空白处：关
  assert.equal(panelClosesOn(outside, false), true, '点空白处要关');
  // 有命令式弹窗开着：无论点哪儿都不关（那一层属于弹窗）
  for (const t of [panel, gear, dialog, outside, null]) {
    assert.equal(panelClosesOn(t, true), false, '弹窗开着时不该关面板');
  }
  // 没有 closest 的目标（例如合成事件）按空白处处理，且不能抛
  assert.equal(panelClosesOn(null, false), true);
  assert.equal(panelClosesOn({}, false), true);
});
test('作弊控制台的提示里不再提「深渊回响排行榜」（深潜不支持实验性功能）', () => {
  const room = read('public/js/screens/room.js');
  const cheatBlock = room.slice(room.indexOf('exp-cheat-console'), room.indexOf("${t('作弊控制台')}"));
  assert.ok(cheatBlock.length > 0, '找不到作弊开关那一段');
  assert.doesNotMatch(cheatBlock, /深渊回响排行榜/, '深潜根本不支持实验性功能，提示里不该提它的排行榜');
  assert.match(cheatBlock, /公开同盟/, '要说清它会挡住公开同盟这一条');
});
