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
  const room = read('public/js/screens/room.js');
  const components = read('public/js/ui/components.js');
  // 面板的关闭判定必须放过弹窗，并在有命令式弹窗时停手
  assert.match(room, /anyDialogOpen\(\)/, 'room.js 的关闭判定要认命令式弹窗');
  assert.match(components, /export const anyDialogOpen = \(\) => dialogs\.length > 0;/, 'components.js 要导出 anyDialogOpen');
  // 确认框挂在 <UiHosts/> 上、不在 .rs-opts 里 —— 关闭判定必须也放过 .modal
  const awayLine = room.split('\n').find((l) => l.includes("closest?.('.rs-opts"));
  assert.ok(awayLine, '找不到关闭判定那一行');
  assert.match(awayLine, /\.modal/, '关闭判定要放过 .modal（确认框就在那里）');
});

test('作弊控制台的提示里不再提「深渊回响排行榜」（深潜不支持实验性功能）', () => {
  const room = read('public/js/screens/room.js');
  const cheatBlock = room.slice(room.indexOf('exp-cheat-console'), room.indexOf("${t('作弊控制台')}"));
  assert.ok(cheatBlock.length > 0, '找不到作弊开关那一段');
  assert.doesNotMatch(cheatBlock, /深渊回响排行榜/, '深潜根本不支持实验性功能，提示里不该提它的排行榜');
  assert.match(cheatBlock, /公开同盟/, '要说清它会挡住公开同盟这一条');
});
