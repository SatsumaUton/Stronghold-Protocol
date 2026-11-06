// 维护者 2026-11-05：**管理员无视所有惩罚机制**（挂机移出 / 消极游戏 / 踢出记录）。
//
// 背景：管理员平时就是拿普通号在打（没去后台换码 → 只有身份门，没有 tools.game 与验证码），
// 而旧实现只认 `ps.admin`（三道门全过），于是自己挂机盯盘时被「长时间没有操作，已被移出对局」踢掉。
// 现在判定读 `_isPunishImmune()`：身份门 `ps.adminId` 或三道门 `ps.admin` 任一为真即豁免。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PLAYER_FIELDS, MATCH_FIELDS } from '../../server/match/snapshot.js';

const two = () => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 9, fake: true });

test('管理员（身份门）不会被挂机移出，普通玩家照常被移出', (t) => {
  const h = two();
  const m = h.m;
  t.after(() => m.dispose());
  const [admin, normal] = m.alivePlayers();
  // 测试台默认关掉了挂机判定（afkRemoveRounds = 0），这里打开
  m.afkRemoveRounds = 2;
  // 只有身份门（没换码的管理员）
  admin.admin = false;
  admin.adminId = true;
  admin.afkRounds = 99;
  normal.afkRounds = 99;
  m._checkIdle();
  assert.equal(m._isPunishImmune(admin), true, '身份门即豁免');
  assert.notEqual(admin._idleKicked, true, '管理员不能被标记为挂机踢出');
  assert.equal(admin.left, false, '管理员不能被移出对局');
  assert.equal(admin.afkRounds, 0, '管理员的挂机计数永远归零');
  assert.equal(normal._idleKicked, true, '普通玩家照常被移出');
});

test('管理员不会被「消极游戏」判定踢出（花钱不部署 / 什么都不做）', (t) => {
  const h = two();
  const m = h.m;
  t.after(() => m.dispose());
  const [admin] = m.alivePlayers();
  admin.admin = false;
  admin.adminId = true;
  m.round = 3;
  // 已经攒到触发线：上一回合花钱 3 次、部署 0 次
  admin._act = { round: 2, spend: 3, place: 0, strikes: 1, idleStrikes: 1 };
  m._trackActivity(admin, { t: 'g.buy' });
  assert.notEqual(admin._idleKicked, true, '管理员不该被消极游戏踢出');
  // 对照：同样的状态，普通玩家会被踢
  const normal = m.alivePlayers()[1];
  normal._act = { round: 2, spend: 3, place: 0, strikes: 1, idleStrikes: 1 };
  m._trackActivity(normal, { t: 'g.buy' });
  assert.equal(normal._idleKicked, true, '普通玩家照常被踢');
});

test('管理员标记进存档：读档续玩后仍然豁免', () => {
  assert.ok(PLAYER_FIELDS.saved.includes('admin'), '三道门标记要进存档');
  assert.ok(PLAYER_FIELDS.saved.includes('adminId'), '身份门标记也要进存档（否则读档后又被踢）');
  assert.ok(MATCH_FIELDS.saved.includes('echoOneShotIds'));
});
