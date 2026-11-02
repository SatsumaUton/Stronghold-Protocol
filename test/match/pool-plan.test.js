// 手动指定卡池编组（shared/poolPlan.js + 房间的 experimental.poolPlan，移植自参考版反馈 #49）。
//
// 编组就是「每个座位一个卡池号」，规范形式按首次出现从 0 编号，所以 [1,1,0,0] 和 [0,0,1,1]
// 是同一套布局。它是**整个状态**：一个池之所以存在，就是因为有座位在它里面，没有空池要存。
//
// 测四件事：
//   · 纯函数（分组、均分、增/减池、移座位、缩放）算得对
//   · 没有编组时自动规则**逐字不变**（这是最容易搞坏的地方）
//   · 有编组时它覆盖自动规则，同一个池的人共用一个 SharedPool 实例
//   · 校验：长度、负数、非整数、越界都拒；两种编号得到同一个 experimentalKey
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import {
  autoPoolPlan, canonicalPoolPlan, evenPoolPlan, isPoolPlan, mergeLastPool, moveSeat,
  poolCount, poolScale, poolSeats, splitPool,
} from '../../shared/poolPlan.js';
import { experimentalKey, experimentalOptions, isExperimental, sameExperimental } from '../../shared/experimental.js';

/** 一局的池分组，写成 "4+4 scale=1,1"。 */
const groupsOf = (m) => ({
  sizes: m.poolGroups.map((g) => g.playerIds.length),
  scales: m.poolGroups.map((g) => g.scale),
});

/** 起一局，可选编组。 */
function started(n, plan = null) {
  const experimental = { revivalEnabled: false, disableSharedPool: false, ...(n > 4 ? { playerCapacity: n } : {}) };
  if (plan) experimental.poolPlan = plan;
  return makeMatch({ mode: 'coop', humans: n, bots: 0, seed: 11, experimental }).start();
}

// ── 纯函数 ───────────────────────────────────────────────────────────────
test('poolScale：四席以内是 1，更多按席数缩放', () => {
  assert.equal(poolScale(1), 1);
  assert.equal(poolScale(4), 1);
  assert.equal(poolScale(5), 1.25);
  assert.equal(poolScale(8), 2);
  assert.equal(poolScale(20), 5);
});

test('canonicalPoolPlan：按首次出现从 0 编号，编号不同的同一布局归一', () => {
  assert.deepEqual(canonicalPoolPlan([1, 1, 0, 0]), [0, 0, 1, 1]);
  assert.deepEqual(canonicalPoolPlan([5, 5, 5, 5]), [0, 0, 0, 0]);
  assert.deepEqual(canonicalPoolPlan([0, 1, 0, 1]), [0, 1, 0, 1]);
});

test('poolSeats / poolCount：每个池的座位，按池号', () => {
  assert.deepEqual(poolSeats([0, 0, 1, 1]), [[0, 1], [2, 3]]);
  assert.deepEqual(poolSeats([0, 1, 1, 2]), [[0], [1, 2], [3]]);
  assert.equal(poolCount([0, 0, 1, 1]), 2);
  assert.equal(poolCount([0, 0, 0, 0]), 1);
});

test('autoPoolPlan：就是自动规则本身', () => {
  // 8 人自动是 4＋4
  assert.deepEqual(autoPoolPlan(8), [0, 0, 0, 0, 1, 1, 1, 1]);
  // 6 人是 3＋3（反馈 #49 的分界）
  assert.deepEqual(autoPoolPlan(6), [0, 0, 0, 1, 1, 1]);
  // 4 人一个池
  assert.deepEqual(autoPoolPlan(4), [0, 0, 0, 0]);
});

test('evenPoolPlan / splitPool / mergeLastPool / moveSeat', () => {
  assert.deepEqual(evenPoolPlan(8, 2), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual(evenPoolPlan(8, 4), [0, 0, 1, 1, 2, 2, 3, 3]);
  // 拆最大的池的后半
  assert.deepEqual(splitPool([0, 0, 0, 0]), [0, 0, 1, 1]);
  // 每个座位自己一池时不再拆
  assert.deepEqual(splitPool([0, 1, 2, 3]), [0, 1, 2, 3]);
  // 合并最后一个池
  assert.deepEqual(mergeLastPool([0, 0, 1, 1]), [0, 0, 0, 0]);
  // 只剩一个池时不再合
  assert.deepEqual(mergeLastPool([0, 0, 0, 0]), [0, 0, 0, 0]);
  // 移座位后重新规范化（池 0 被搬空就消失）
  assert.deepEqual(moveSeat([0, 1, 1, 1], 0, 1), [0, 0, 0, 0]);
  assert.deepEqual(moveSeat([0, 0, 1, 1], 1, 1), [0, 1, 1, 1]);
});

// ── 校验 ─────────────────────────────────────────────────────────────────
test('isPoolPlan：长度、负数、非整数、越界都拒', () => {
  assert.equal(isPoolPlan([0, 0, 1, 1], 4), true);
  assert.equal(isPoolPlan([0, 0, 1], 4), false, '长度不符');
  assert.equal(isPoolPlan([0, 0, 1, 1, 0], 4), false, '长度不符（长）');
  assert.equal(isPoolPlan([0, 0, 1, -1], 4), false, '负数');
  assert.equal(isPoolPlan([0, 0, 1, 1.5], 4), false, '非整数');
  assert.equal(isPoolPlan([0, 0, 1, 4], 4), false, '越界（>= 容量）');
  assert.equal(isPoolPlan('nope', 4), false);
  assert.equal(isPoolPlan(null, 4), false);
});

test('experimental：编组通过校验、被规范化，并取代 disableSharedPool', () => {
  const base = { revivalEnabled: false, disableSharedPool: false, playerCapacity: 8 };
  assert.equal(isExperimental({ ...base, poolPlan: [0, 0, 0, 0, 1, 1, 1, 1] }), true);
  assert.equal(isExperimental({ ...base, poolPlan: [0, 0, 0] }), false, '长度不符要被 isExperimental 拒掉');
  const o = experimentalOptions({ ...base, poolPlan: [1, 1, 1, 1, 0, 0, 0, 0] });
  assert.deepEqual(o.poolPlan, [0, 0, 0, 0, 1, 1, 1, 1], '规范化');
  assert.ok(Object.isFrozen(o.poolPlan), '冻结');
  // 有编组时 disableSharedPool 被取代（编组已经把每个座位说清楚了）
  assert.equal(experimentalOptions({ ...base, disableSharedPool: true, poolPlan: [0, 0, 0, 0, 1, 1, 1, 1] }).disableSharedPool, false);
  // 没有编组时照旧保留
  assert.equal(experimentalOptions({ ...base, disableSharedPool: true }).disableSharedPool, true);
});

test('experimentalKey / sameExperimental：同一布局（不论编号）等价', () => {
  const base = { revivalEnabled: false, disableSharedPool: false, playerCapacity: 8 };
  const a = experimentalOptions({ ...base, poolPlan: [0, 0, 0, 0, 1, 1, 1, 1] });
  const b = experimentalOptions({ ...base, poolPlan: [1, 1, 1, 1, 0, 0, 0, 0] });
  const c = experimentalOptions({ ...base, poolPlan: [0, 0, 1, 1, 1, 1, 0, 0] });
  assert.equal(experimentalKey(a), experimentalKey(b), '同一布局同 key');
  assert.ok(sameExperimental(a, b));
  assert.notEqual(experimentalKey(a), experimentalKey(c), '不同布局不同 key');
  assert.ok(!sameExperimental(a, c));
  // 没有编组的房间形状不变（不多个键）
  const plain = experimentalOptions({ revivalEnabled: false, disableSharedPool: false });
  assert.deepEqual(plain, { revivalEnabled: false, disableSharedPool: false });
  assert.ok(!experimentalKey(plain).includes(':plan'));
});

// ── 自动规则回归：没有编组时必须逐字不变 ────────────────────────────────
test('没有编组：自动分组与加这个功能之前逐字一致', () => {
  // 这些数字是「加功能之前」的实测值，改动自动规则会在这里炸出来
  const expected = {
    4: { sizes: [4], scales: [1] },
    5: { sizes: [5], scales: [1.25] },
    6: { sizes: [3, 3], scales: [1, 1] },
    7: { sizes: [4, 3], scales: [1, 1] },
    8: { sizes: [4, 4], scales: [1, 1] },
    12: { sizes: [4, 4, 4], scales: [1, 1, 1] },
  };
  for (const [n, want] of Object.entries(expected)) {
    const h = started(Number(n));
    assert.deepEqual(groupsOf(h.m), want, `${n} 人的自动分组`);
    assert.equal(h.m.poolPlan, null, `${n} 人没有编组`);
  }
});

// ── 编组生效 ─────────────────────────────────────────────────────────────
test('有编组：覆盖自动规则，同一个池的人共用一个 SharedPool', () => {
  // 8 人自动是 4＋4，编成 3＋3＋2
  const plan = [0, 0, 0, 1, 1, 1, 2, 2];
  const h = started(8, plan);
  const m = h.m;
  assert.deepEqual(m.poolPlan, plan);
  assert.deepEqual(groupsOf(m).sizes, [3, 3, 2], '按编组分，不按自动规则');
  // 路由：同池同实例，异池不同实例
  const [g0, g1] = m.poolGroups;
  assert.equal(m.playerPools.get(g0.playerIds[0]), m.playerPools.get(g0.playerIds[2]), '同池共用');
  assert.notEqual(m.playerPools.get(g0.playerIds[0]), m.playerPools.get(g1.playerIds[0]), '异池分开');
  assert.equal(m.playerPools.size, 8, '每个座位都有池');
});

test('有编组：m.public 下发 poolGroups 与 experimental.poolPlan', () => {
  const plan = [0, 0, 0, 1, 1, 1, 2, 2];
  const h = started(8, plan);
  const m = h.m;
  m.markPublic();
  m.flush(true);
  const frames = h.bc.filter((x) => x.t === 'm.public');
  const pub = frames[frames.length - 1];
  assert.ok(pub, '有 m.public');
  assert.deepEqual(pub.poolGroups.map((g) => g.playerIds.length), [3, 3, 2], 'poolGroups 下发');
  assert.deepEqual(pub.experimental.poolPlan, plan, 'experimental.poolPlan 下发');
});

test('大池缩放：8 人编成一个大池 → scale 2', () => {
  const h = started(8, [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(groupsOf(h.m).sizes, [8]);
  assert.deepEqual(groupsOf(h.m).scales, [2]);
});

test('单人局：poolPlan 恒为 null（一个人没有分组可言）', () => {
  const h = makeMatch({ mode: 'solo', humans: 1, bots: 3, seed: 11 }).start();
  assert.equal(h.m.poolPlan, null);
  assert.deepEqual(groupsOf(h.m).sizes, [1]);
});

// ── 断点续玩 ─────────────────────────────────────────────────────────────
test('编组跟着存档走：续玩后分组不变', async () => {
  const plan = [0, 0, 0, 1, 1, 1, 2, 2];
  const h = started(8, plan);
  const m = h.m;
  const { snapshotMatch } = await import('../../server/match/snapshot.js');
  const doc = snapshotMatch(m, { reason: 'test', checkpointId: 'cp' });
  assert.deepEqual(doc.experimental.poolPlan, plan, '存档里带着编组');
  assert.equal(doc.pools.length, 3, '三个池都存了');
});
