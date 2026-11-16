// test/lobby-diy-versions.test.js — 自选编队按版本分键后的读取（维护者 2026-11-16）。
//
// 症状（玩家反馈 2026-11-16）：选完策略、进入「选择自编」时**列表是空的**，自选干员整局不出现。
// 根因是 `pickDiyFor` 的读取顺序：旧格式（整张表就是 picks，键是 `5_diy1` 这种槽位）本来等于「默认版本那一份」，
// 但「默认版本直接返回 own」排在「旧格式」判定之前 —— `bucketOf('act2autochess')` 找不到这个键就返回 null，
// 于是老存档（升级前存过、之后没再保存过）的玩家拿到空名单。另外「只配过某一个版本」的玩家也会拿到 null。
//
// 这里钉住四种输入形态 + 与 Match 的接缝（`ps.diy` 必须是槽位表，否则客户端 `roster[id]` 全部落空 → 空列表）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDiyFor, storeDiyFor, diySlotIds } from '../shared/diy.js';
import { getData } from '../server/data.js';

const PICKS = { 'chess_char_5_diy1_a': { charId: 'char_1001_amiya2', skillIndex: 1, uniEquipId: null, level: 1 } };
const LOG = { warn() {}, error() {}, info() {} };
const DATA = getData({ log: LOG });

test('新格式（按版本分键）：默认版本 / 指定版本 都取到那一格', () => {
  const map = storeDiyFor(null, 'act2autochess', PICKS);
  assert.deepEqual(pickDiyFor(map, 'act2autochess'), PICKS);
  assert.deepEqual(pickDiyFor(map, 'act3autochess-v3_1'), PICKS, '本版没配 → 回退默认版本');
  assert.deepEqual(pickDiyFor(map, null), PICKS, '房间没有版本（默认房）也要取到');
});

test('★ 旧格式（整张表就是 picks）：默认版本必须取到，不能是 null', () => {
  // 这正是玩家遇到空列表的那种存档：升级前的 session.diy / 导入的老设置
  assert.deepEqual(pickDiyFor({ ...PICKS }, 'act2autochess'), PICKS);
  assert.deepEqual(pickDiyFor({ ...PICKS }, 'act3autochess-v3_1'), PICKS, '老格式对任何版本都算默认版本那份');
  assert.deepEqual(pickDiyFor({ ...PICKS }, null), PICKS);
});

test('只配过一个版本：另一个版本读它（否则「明明配过却是空列表」）', () => {
  const only = storeDiyFor(null, 'act3autochess-v3_1', PICKS);
  assert.deepEqual(pickDiyFor(only, 'act2autochess'), PICKS);
  assert.deepEqual(pickDiyFor(only, 'act3autochess-v3_1'), PICKS);
});

test('两版都配过：默认版本优先，本版本设过的槽覆盖它', () => {
  const map = storeDiyFor(storeDiyFor(null, 'act2autochess', PICKS), 'act3autochess-v3_1', {
    ...PICKS, 'chess_char_5_diy1_a': { ...PICKS['chess_char_5_diy1_a'], charId: 'char_2002_amiya' },
  });
  assert.equal(pickDiyFor(map, 'act2autochess')['chess_char_5_diy1_a'].charId, 'char_1001_amiya2');
  assert.equal(pickDiyFor(map, 'act3autochess-v3_1')['chess_char_5_diy1_a'].charId, 'char_2002_amiya');
});

test('空表 / 坏值：一律 null，不抛、不返回半个对象', () => {
  assert.equal(pickDiyFor(null, 'act2autochess'), null);
  assert.equal(pickDiyFor(undefined, null), null);
  assert.equal(pickDiyFor({}, 'act2autochess'), null);
  assert.equal(pickDiyFor({ act2autochess: '坏值' }, 'act2autochess'), null);
});

test('接缝：Match 拿到的 diy 必须能被 diySlotIds 认成槽位表（否则客户端列表是空的）', () => {
  const bundle = DATA;
  const slots = new Set(diySlotIds(bundle));
  assert.ok(slots.size > 0, '数据里有自选槽位');
  // startMatch 走 pickDiyFor 之后再交给 Match（server/lobby.js humanSeat / startMatch 的 seats 映射）
  for (const map of [storeDiyFor(null, 'act2autochess', PICKS), { ...PICKS }]) {
    const picks = pickDiyFor(map, 'act2autochess');
    assert.ok(picks, '取到了名单');
    const keys = Object.keys(picks);
    assert.ok(keys.every((k) => slots.has(k)), `槽位键必须都在 diySlotIds 里：${keys.join(',')}`);
    assert.ok(keys.length > 0, '名单不为空 —— 客户端据此渲染分组');
  }
});
