// test/health/offline-not-counted.test.js —— 离线玩家不算进「在线人数」（维护者 2026-11-28）。
//
// 以前 `lobby.stats()` 只判断 `!seat.left`，于是**掉线但座位还在**的真人也被计入 humans：
// 后台节点控制台显示的「N 玩家」其实是「N 个座位有人」。现在 humans 只数 connected，
// 离线单独给 `offline`，两处（节点卡片 / 房间表）都按这个口径显示。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const read = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8');

test('lobby.stats：humans 只数在线，离线单独计', () => {
  const src = read('server/lobby.js');
  const i = src.indexOf('  stats() {');
  assert.ok(i > 0, '找得到 stats()');
  const body = src.slice(i, src.indexOf('\n  }', i));
  assert.match(body, /if \(s\.connected\) humans\+\+; else offline\+\+;/, '在线/离线分流');
  assert.match(body, /offline, bots, spectators/, '返回值带 offline');
  assert.ok(
    !/\(s\.isBot \? bots\+\+ : humans\+\+\)/.test(body),
    '不能再写成「非 bot 一律算 humans」',
  );
});

test('matchmaker roomInfo：房间的 humans 也只数在线', () => {
  const src = read('../matchmaker/server.js');
  assert.match(src, /const humans = seatList\.filter\(\(s\) => !s\.isBot && s\.connected !== false\)\.length;/, 'humans 只数 connected');
  assert.match(src, /const offline = seatList\.filter\(\(s\) => !s\.isBot && s\.connected === false\)\.length;/, 'offline 单独算');
  assert.match(src, /humans, offline, bots, players/, 'roomInfo 返回 offline');
});

test('控制台：节点卡片显示「N 玩家 · M 离线」，汇总带 offline', () => {
  const app = read('dashboard/public/app.js');
  assert.match(app, /const offline = h \? \(h\.offline \?\? 0\) : 0;/, '读 offline');
  assert.match(app, /`\$\{players\} 玩家 · \$\{offline\} 离线`/, '离线时追加显示');
  const srv = read('dashboard/server.js');
  assert.match(srv, /offline: Number\(h\.offline\) \|\| 0,/, '节点行带 offline');
  assert.match(srv, /offline: nodes\.reduce\(\(s, x\) => s \+ \(x\.offline \|\| 0\), 0\)/, '汇总带 offline');
});
