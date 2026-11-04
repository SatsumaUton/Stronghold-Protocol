// 「深渊回响」延伸数值（server/match/match/echo.js）的单元测试。
//
// 背景：官方 enemyScale 表只到第 15 回合，运行时查不到会返回 hpMul: 1
// （不是钳到最后一档），所以延伸回合必须自己合成缩放，否则第 16 回合会突然变简单。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  echoScale, echoRoundAllowed, isEchoRound, echoStartRound, isDiveRound, echoDataRound, echoIsNormalRound, echoWaveBudget, pickWaveByBudget, remapWaveByBudget, ECHO_BUDGET_BASE, ECHO_BUDGET_SLACK, echoWaveGrowth, ECHO_EARLY_GROWTH,
  ECHO_LAST_ROUND, ECHO_HP_CAP, ECHO_ATK_CAP, ECHO_HP_STEP, ECHO_ATK_STEP, ECHO_SAFE_ROUND, isEchoNodeRound,
  ECHO_HP_STEP_SLOW, echoDeepWaveShape, ECHO_DEEP_FROM, ECHO_DEEP_CYCLE, ECHO_DEEP_MAX_ACTIONS,
} from '../../server/match/match/echo.js';

/** 第 15 档（终极多人 R15 的官方值）。 */
const LAST = { hpMul: 6.687075, atkMul: 2.143589, speedMul: 1.15 };

test('表内回合：原样返回官方值', () => {
  for (const r of [1, 7, ECHO_LAST_ROUND]) {
    const s = echoScale(r, LAST);
    assert.equal(s.hpMul, LAST.hpMul, `第 ${r} 回合不该被改写`);
    assert.equal(s.atkMul, LAST.atkMul);
    assert.equal(s.speedMul, 1.15, '速度不参与延伸曲线');
  }
});

test('延伸回合：从最后一档按官方节奏 1.2 / 1.1 递推', () => {
  const r16 = echoScale(ECHO_LAST_ROUND + 1, LAST);
  assert.ok(Math.abs(r16.hpMul - LAST.hpMul * ECHO_HP_STEP) < 1e-9, '第 16 回合 = 第 15 档 × 1.2');
  assert.ok(Math.abs(r16.atkMul - LAST.atkMul * ECHO_ATK_STEP) < 1e-9);

  const r20 = echoScale(20, LAST);
  assert.ok(Math.abs(r20.hpMul - LAST.hpMul * ECHO_HP_STEP ** 5) < 1e-9, '第 20 回合 = 第 15 档 × 1.2^5');
});

test('两段曲线：R15–R30 按 ×1.2，R31 起缓增 ×1.15（永不见顶）', () => {
  const r30 = echoScale(30, LAST);
  assert.ok(Math.abs(r30.hpMul - LAST.hpMul * ECHO_HP_STEP ** 15) < 1e-6, 'R30 = 6.687 × 1.2^15 ≈ 103 倍');
  // 硬封顶已取消：R31 起按 1.15 缓增，而不是锁死在 120 倍
  const r31 = echoScale(31, LAST);
  assert.ok(Math.abs(r31.hpMul - r30.hpMul * ECHO_HP_STEP_SLOW) < 1e-6, 'R31 = R30 × 1.15');
  assert.ok(r31.hpMul > r30.hpMul, '深处必须继续变难（否则玩家一叠满就无敌）');
  assert.ok(echoScale(60, LAST).hpMul > echoScale(59, LAST).hpMul, '永远不会停在同一个数上');
  assert.ok(echoScale(60, LAST).hpMul > r30.hpMul * 5, 'R60 应显著高于 R30');
  // 单调不减：再深也不会变简单
  for (let r = 16; r <= 120; r++) assert.ok(echoScale(r, LAST).hpMul >= echoScale(r - 1, LAST).hpMul);
});

test('补给线份额随基础档位透传，不参与延伸曲线', () => {
  const s = echoScale(20, { ...LAST, supplyHpMul: 1.7 });
  assert.equal(s.supplyHpMul, 1.7);
  const plain = echoScale(20, LAST);
  assert.equal(Object.hasOwn(plain, 'supplyHpMul'), false, '为 1 时不写这个键');
});

test('回合判定：15 是表内、16 是延伸、超过上限给 false', () => {
  assert.equal(isEchoRound(ECHO_LAST_ROUND), false);
  assert.equal(isEchoRound(ECHO_LAST_ROUND + 1), true);
  assert.equal(echoRoundAllowed(1), true);
  assert.equal(echoRoundAllowed(ECHO_SAFE_ROUND), true);
  assert.equal(echoRoundAllowed(ECHO_SAFE_ROUND + 1), false, '只有安全阀能拒绝');
  assert.equal(echoRoundAllowed(0), false);
});

test('固定节点：前三个锚点 深度 5/10/15，之后每 10 层（25/35/45…）', () => {
  for (const r of [5, 10, 15]) assert.equal(isEchoNodeRound(r), true, `深度 ${r} 是锚点`);
  assert.equal(isEchoNodeRound(20), false, '20 不再是节点（15 之后放稀到 10 层）');
  for (const r of [25, 35, 45]) assert.equal(isEchoNodeRound(r), true, `深度 ${r} 是后期节点`);
  for (const r of [1, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 34, 39, 41]) assert.equal(isEchoNodeRound(r), false, `深度 ${r} 不是节点`);
  assert.equal(isEchoNodeRound(0), false);
});

test('深潜入口：隐藏核心照旧要达成，但没达成也能从 R15 进深潜', () => {
  assert.equal(echoStartRound(15), 16, '达成隐藏（打到 R15）→ 从 R16 开始');
  assert.equal(echoStartRound(14), 15, '没达成隐藏（只到 R14）→ 从 R15 开始');
  assert.equal(isDiveRound(16, 15), true);
  assert.equal(isDiveRound(15, 15), false, 'R15 是隐藏核心本身，不是深潜');
  assert.equal(isDiveRound(15, 14), true, '没打隐藏时 R15 就是深潜第一回合');
  assert.equal(isDiveRound(14, 14), false);
});

test('两条路的曲线起点一致（R13/R14/R15 官方缩放相同）', () => {
  const LAST = { hpMul: 6.687075, atkMul: 2.143589, speedMul: 1.15 };
  const viaHidden = echoScale(echoStartRound(15), LAST);
  const noHidden = echoScale(echoStartRound(14), LAST);
  assert.ok(Math.abs(viaHidden.hpMul - noHidden.hpMul) < 6.687075 * 0.25,
    '起点只差一档 ×1.2，锚定的官方值相同');
});
test('深潜回合一律是普通回合：波次循环 1..13，且永不是 boss', () => {
  // 没打隐藏：深潜从 R15 起，bossRound = 14 → 循环 1..13
  assert.equal(echoDataRound(15, 15, 14), 1, '深潜第一回合用第 1 回合的波次');
  assert.equal(echoDataRound(16, 15, 14), 2);
  assert.equal(echoDataRound(27, 15, 14), 13, 'R27 是第 13 个深潜回合');
  assert.equal(echoDataRound(28, 15, 14), 13, '深度 14 收口到 13（14/15 原版是 boss 回合）');
  assert.equal(echoDataRound(30, 15, 14), 1, '深度 16 起回到 1..13 循环');
  assert.equal(echoDataRound(31, 15, 14), 2);
  // 打过隐藏：深潜从 R16 起，同样是 1..13
  assert.equal(echoDataRound(16, 16, 14), 1);
  assert.equal(echoDataRound(28, 16, 14), 13);

  assert.equal(echoIsNormalRound(15, 15), true);
  assert.equal(echoIsNormalRound(14, 15), false, 'R14 仍是 boss 回合');
  assert.equal(echoIsNormalRound(16, 16), true);
});

test('深潜的出怪成长：1–15 层按 ECHO_EARLY_GROWTH 加码，16 层起接 1.2 延伸段且连续', () => {
  assert.equal(echoWaveGrowth(1), 1, '第 1 层就是原版规模');
  assert.ok(Math.abs(echoWaveGrowth(2) - ECHO_EARLY_GROWTH) < 1e-9);
  for (let d = 2; d <= 40; d++) assert.ok(echoWaveGrowth(d) >= echoWaveGrowth(d - 1), `深度 ${d} 不该变小`);
  // 15 → 16 处不许跳档（只乘一次 1.2）
  const g15 = echoWaveGrowth(15);
  assert.ok(Math.abs(echoWaveGrowth(16) - g15 * 1.2) < 1e-9, '15→16 连续');
  assert.ok(g15 > 1.5 && g15 < 2.5, '第 15 层约为原版的 2 倍（当前旋钮）');
});

test('深潜用的数据回合永远落在 1..bossRound-1（不会撞到 boss 回合号）', () => {
  for (const diveStart of [15, 16]) {
    for (let r = diveStart; r <= 30; r++) {
      const d = echoDataRound(r, diveStart, 14);
      assert.ok(d >= 1 && d <= 13, `R${r} 的数据回合 ${d} 越界`);
    }
  }
});
test('威胁预算随回合按 1.2^n 增长（和血量曲线同源）', () => {
  const b15 = echoWaveBudget(15, 15);
  const b16 = echoWaveBudget(16, 15);
  const b20 = echoWaveBudget(20, 15);
  assert.equal(b15, ECHO_BUDGET_BASE, '深潜第一回合就是基准');
  assert.ok(Math.abs(b16 - b15 * 1.2) < 1e-9);
  assert.ok(Math.abs(b20 - ECHO_BUDGET_BASE * 1.2 ** 5) < 1e-9);
});

test('预算制随机：抽出来的总威胁贴着预算，不会白送也不会失控', () => {
  const pool = [
    { key: 'small', threat: 10 }, { key: 'mid', threat: 25 }, { key: 'big', threat: 60 },
  ];
  // 固定 rng 序列，结果可复现
  let i = 0;
  const seq = [0.1, 0.5, 0.9, 0.2, 0.7, 0.4, 0.8, 0.3, 0.6, 0.15];
  const rng = () => seq[(i++) % seq.length];
  const got = pickWaveByBudget(pool, 100, rng, { minPicks: 3, maxPicks: 8 });
  assert.ok(got.length >= 3, '至少抽到最少数量');
  const spent = got.reduce((a, x) => a + x.threat, 0);
  assert.ok(spent <= 100 * ECHO_BUDGET_SLACK, `总威胁 ${spent} 不能超过预算上限 ${100 * ECHO_BUDGET_SLACK}`);
  assert.ok(spent >= 100 * 0.5, `总威胁 ${spent} 不该远低于预算（否则等于白送）`);
});

test('空池返回空数组，不崩', () => {
  assert.deepEqual(pickWaveByBudget([], 100, () => 0.5), []);
  assert.deepEqual(pickWaveByBudget(null, 100, () => 0.5), []);
});

test('预算越高的回合抽到的敌人总量越多', () => {
  const pool = [{ key: 'a', threat: 10 }];
  let i = 0;
  const rng = () => [0.1, 0.5, 0.9, 0.2][(i++) % 4];
  const early = pickWaveByBudget(pool, echoWaveBudget(15, 15), rng);
  const late = pickWaveByBudget(pool, echoWaveBudget(22, 15), rng);
  assert.ok(late.length > early.length, 'R22 的波次应该比 R15 更大');
});
test('换血：保留时序与路线，只替换敌人种类', () => {
  const spawns = [
    { key: 'a', time: 1, routeIndex: 0 },
    { key: 'b', time: 5, routeIndex: 1 },
    { key: 'c', time: 9, routeIndex: 0 },
  ];
  const picked = [{ key: 'x' }, { key: 'y' }];
  const out = remapWaveByBudget(spawns, picked);
  assert.equal(out.length, 2, '抽到 2 个就出 2 条');
  assert.deepEqual(out.map((s) => s.key), ['x', 'y']);
  assert.equal(out[0].time, 1, '时序不变');
  assert.equal(out[1].routeIndex, 1, '路线不变');
  assert.equal(spawns[0].key, 'a', '不改原数组');
});

test('换血：抽到的比槽位多时，按最后一个槽位的时序追加', () => {
  const spawns = [{ key: 'a', time: 1, routeIndex: 0 }, { key: 'b', time: 5, routeIndex: 1 }];
  const picked = [{ key: 'x' }, { key: 'y' }, { key: 'z' }, { key: 'w' }];
  const out = remapWaveByBudget(spawns, picked);
  assert.equal(out.length, 4);
  assert.equal(out[3].time, 5, '追加的沿用最后一个槽位的时序');
  assert.equal(out[3].routeIndex, 1);
  assert.deepEqual(out.map((s) => s.key), ['x', 'y', 'z', 'w']);
});

test('换血：空输入安全返回', () => {
  assert.deepEqual(remapWaveByBudget([], [{ key: 'x' }]), []);
  assert.deepEqual(remapWaveByBudget([{ key: 'a' }], []), [{ key: 'a' }]);
  assert.deepEqual(remapWaveByBudget(null, null), []);
});
// ---------------------------------------------------------------------------------------------
// 16 层以后的出怪量（维护者 2026-11-04 §6：按层自己设计，不再跟数据回合的形状）
// ---------------------------------------------------------------------------------------------
test('深潜 16 层以后：从第 16 层起算，轮/位从 1 起', () => {
  assert.equal(ECHO_DEEP_FROM, 16, '16 = 原版模板循环段之后');
  assert.equal(ECHO_DEEP_CYCLE, 13, '一轮 13 层（原版可循环的普通回合数）');
  assert.deepEqual([echoDeepWaveShape(16).cycle, echoDeepWaveShape(16).pos], [1, 1]);
  assert.deepEqual([echoDeepWaveShape(28).cycle, echoDeepWaveShape(28).pos], [1, 13]);
  assert.deepEqual([echoDeepWaveShape(29).cycle, echoDeepWaveShape(29).pos], [2, 1], '第 29 层进第 2 轮');
});

test('深潜 16 层以后：只数随深度单调不减（不会再被数据回合带回原版第 1 关）', () => {
  let prev = 0;
  for (let d = ECHO_DEEP_FROM; d <= 80; d++) {
    const s = echoDeepWaveShape(d);
    assert.ok(s.units >= prev, `深度 ${d} 的只数 ${s.units} 不该少于深度 ${d - 1} 的 ${prev}`);
    assert.ok(s.units >= 100, `深度 ${d} 至少 100 只（旧版在第 16 层掉到 14 只）`);
    prev = s.units;
  }
  // 头一轮明显比上一档低层的循环起点高
  assert.ok(echoDeepWaveShape(16).units > 100);
  // 每轮整档抬升：第 2 轮第 1 层 > 第 1 轮第 13 层
  assert.ok(echoDeepWaveShape(29).units > echoDeepWaveShape(28).units);
});

test('深潜 16 层以后：条数与只数的关系能放进单条上限里（不是凭空多出来）', () => {
  for (let d = ECHO_DEEP_FROM; d <= 80; d++) {
    const s = echoDeepWaveShape(d);
    assert.ok(s.actions >= 1 && s.actions <= ECHO_DEEP_MAX_ACTIONS, `深度 ${d} 的条数 ${s.actions} 越界`);
    assert.ok(s.units >= s.actions, `深度 ${d} 的只数 ${s.units} 少于条数 ${s.actions}（会有空动作）`);
    assert.ok(s.units / s.actions <= 6, `深度 ${d} 平均每条 ${(s.units / s.actions).toFixed(2)} 只，超过单条上限 6`);
  }
});
