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
  autoPoolPlan, autoPoolSizes, canonicalPoolPlan, evenPoolPlan, isPoolPlan, mergeLastPool, moveSeat,
  planLabel, poolCount, poolScale, poolSeats, splitPool,
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

// ── 界面用的摘要（shared/poolPlan.js 的 planLabel）───────────────────────
test('planLabel：各池人数从大到小，如 4+4 / 5 / 3+3+2', () => {
  assert.equal(planLabel([0, 0, 0, 0, 1, 1, 1, 1]), '4+4');
  assert.equal(planLabel([0, 0, 0, 0, 0]), '5');
  assert.equal(planLabel([0, 0, 0, 1, 1, 1, 2, 2]), '3+3+2');
  assert.equal(planLabel([0]), '1');
  // 编号顺序不影响结果（先出现的池不一定最大）
  assert.equal(planLabel([0, 1, 1, 1]), '3+1');
  // 空/非法输入给空串，界面不会崩
  assert.equal(planLabel(null), '');
  assert.equal(planLabel([]), '');
});

// ── 5–20 人：快捷预设（均分成 n 个池）─────────────────────────────────────
test('快捷预设：evenPoolPlan 把 20 人均分成 2–5 个池', () => {
  for (const pools of [2, 3, 4, 5]) {
    const plan = evenPoolPlan(20, pools);
    assert.equal(plan.length, 20, `${pools} 池：座位数不变`);
    assert.equal(poolCount(plan), pools, `${pools} 池：池数对`);
    const sizes = poolSeats(plan).map((ids) => ids.length);
    // 均衡：最大与最小相差不超过 1
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${pools} 池均衡（${sizes.join('+')}）`);
  }
  // 5 人房也能用
  assert.equal(poolCount(evenPoolPlan(5, 2)), 2);
  assert.deepEqual(poolSeats(evenPoolPlan(5, 2)).map((s) => s.length), [3, 2]);
});

test('5–20 人：autoPoolPlan 与自动规则一致，且每个容量都能用', () => {
  for (const capacity of [5, 6, 7, 8, 12, 16, 20]) {
    const plan = autoPoolPlan(capacity);
    assert.equal(plan.length, capacity, `${capacity} 人：长度对`);
    assert.ok(isPoolPlan(plan, capacity), `${capacity} 人：是合法编组`);
    assert.equal(plan[0], 0, `${capacity} 人：池 0 含座位 0`);
  }
  // 20 人按四人一组（twentyPlayerMode 的 fixedChunks 口径）
  assert.deepEqual(poolSeats(autoPoolPlan(20)).map((s) => s.length), [4, 4, 4, 4, 4]);
});

// ★ 这个盯的是一个真踩过的坑：初始编组要按**已坐的席位**撒，不是按满员容量。
//   20 人房只坐了 6 个人时，按满员撒会变成 5 个池（4+4+4+4+4），房主一打开编辑器
//   就看到一堆空池，和实际对局对不上。按已坐席位撒才是这 6 个人真正的分组。
//   注意「池的大小」和「池里坐了人」是两回事：chunkedPlan 让空席跟随前一个席位，
//   所以最后一个池会显得很大，但界面上显示的是**已坐人数**（poolStock 的 taken）。
test('初始编组按已坐席位撒（参考版 takenSeats 口径），不是按满员容量', () => {
  const seats6 = [0, 1, 2, 3, 4, 5];
  // 分块意图（autoPoolSizes）才是参考版注释里说的「八人房坐六个打 3+3」
  assert.deepEqual(autoPoolSizes(6, { experimental: true }).sizes, [3, 3], '8 人房坐 6 个：分块意图 3+3');
  assert.deepEqual(autoPoolSizes(6, { experimental: true, fixedChunks: true }).sizes, [4, 2], '20 人房固定四人一组：4+2');
  // 但最终编组里空席跟随前一个席位，所以末池会变大 —— 这是 chunkedPlan 的既定行为
  assert.deepEqual(poolSeats(autoPoolPlan(8, { seats: seats6 })).map((s) => s.length), [3, 5], '8 人房坐 6 个：末池含空席 6、7');
  assert.deepEqual(poolSeats(autoPoolPlan(20, { seats: seats6 })).map((s) => s.length), [4, 16], '20 人房坐 6 个：4+2 之后空席跟随');
  // 满员容量直接撒才是 5 个池
  assert.deepEqual(poolSeats(autoPoolPlan(20)).map((s) => s.length), [4, 4, 4, 4, 4], '满员才是 5 个池');
  // 12 人房坐 8 个：4+4 分块，末池含空席 8..11
  assert.deepEqual(poolSeats(autoPoolPlan(12, { seats: [0, 1, 2, 3, 4, 5, 6, 7] })).map((s) => s.length), [4, 8], '12 人房坐 8 个：4+4 分块');

  // 只坐 4 个人时不超过 MAX_SEATS，退回「按容量」铺满（房间还在进人）
  assert.deepEqual(poolSeats(autoPoolPlan(20, { seats: [0, 1, 2, 3] })).map((s) => s.length), [4, 4, 4, 4, 4], '4 人时仍按容量铺');
  assert.deepEqual(poolSeats(autoPoolPlan(20, { seats: [] })).map((s) => s.length), [4, 4, 4, 4, 4], '空房按容量铺');

  // ★ 关键差别：按已坐席位撒 vs 按满员撒，前 6 个人的**实际归属**不同
  const byTaken = autoPoolPlan(20, { seats: seats6 });
  const byCapacity = autoPoolPlan(20);
  // 按已坐：座位 4、5 在第二个池；按满员：座位 4、5 在第二个池，但座位 6..19 全是新池
  assert.equal(new Set(byTaken).size, 2, '按已坐撒：只有 2 个池');
  assert.equal(new Set(byCapacity).size, 5, '按满员撒：5 个池');
});

// 界面上的「N 人」读的是**已坐人数**，不是格位数 —— 所以上面那个 4+16 的编组
// 在 20 人房只坐 6 个人时，卡片上显示的是「4 人」和「2 人」，不会出现「16 人」。
test('poolStock：卡片显示的是已坐人数，不是格位数', () => {
  // poolStock 在浏览器模块（ui/poolEditor.js）里，Node 直接 import 不了（要 preact hooks）；
  // 这里按它的定义重算一遍，口径和 ui/poolEditor.js 里逐字一致。
  const stock = (seatIds, seats) => {
    const taken = seatIds.filter((seat) => seats[seat]).length;
    return { taken, scale: poolScale(taken || seatIds.length) };
  };
  const plan = autoPoolPlan(20, { seats: [0, 1, 2, 3, 4, 5] });
  const groups = poolSeats(plan);
  const seats = new Array(20).fill(null);
  for (const i of [0, 1, 2, 3, 4, 5]) seats[i] = { playerId: 'p' + i, name: '博士' + i };
  assert.equal(stock(groups[0], seats).taken, 4, '第一个池坐了 4 个人');
  assert.equal(stock(groups[1], seats).taken, 2, '第二个池坐了 2 个人（不是 16）');
  // 牌库倍率按已坐人数算：4 人 → 1，2 人 → 1
  assert.equal(stock(groups[0], seats).scale, 1);
  assert.equal(stock(groups[1], seats).scale, 1);
  // 空池（还没人坐）按格位数算，这样房间还在进人时倍率不会乱跳
  const emptySeats = new Array(20).fill(null);
  assert.equal(stock(groups[1], emptySeats).taken, 0);
  assert.equal(stock(groups[1], emptySeats).scale, poolScale(16), '空池按 16 个格位算倍率');
});
