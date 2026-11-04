// 跨版本敌人池的单测：只验证「合并规则」与「真实数据能被读到」，不碰 Match。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossVersionEnemies, isUsableEnemy, _resetCrossVersionCache } from '../../server/match/match/echoCrossVersion.js';

test('合并规则：只收本版没有的、会走的、非 BOSS，且 key 带版本前缀', () => {
  _resetCrossVersionCache();
  const base = { enemy_keep: { stats: { maxHp: 100, moveSpeed: 1 }, rank: 'NORMAL' } };
  const extra = crossVersionEnemies(base);
  const keys = Object.keys(extra);
  assert.ok(keys.length > 0, '真实数据里应当有可合并的敌人（至少一个版本能读到）');
  for (const k of keys) {
    assert.match(k, /^act\d/, `key 必须带版本前缀：${k}`);
    assert.ok(k.includes(':'), `key 必须形如 version:enemy：${k}`);
    assert.equal(base[k], undefined, '不得覆盖本版 key');
    assert.ok(isUsableEnemy(extra[k]), `${k} 不该被收进来`);
    assert.ok(Number(extra[k].stats.maxHp) > 0);
  }
});

test('缓存：第二次调用返回同一批 key（不重复读盘）', () => {
  const a = Object.keys(crossVersionEnemies({}));
  const b = Object.keys(crossVersionEnemies({}));
  assert.deepEqual(a, b);
});
