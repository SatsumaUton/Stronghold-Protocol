// 【按回合设置敌人生命倍率】(参考版 feedback #118 移植) —— 端到端回归。
//
// 规则：`enemyHpPlan = [[起始回合, 倍率], …]`（「从第 N 回合起 ×M」），第一段必须从第 1 回合起，
// 最多 6 段，倍率取自 ENEMY_MULTIPLIERS。整段同一个倍率时退化成单个 `enemyHpMul`
// （canonicalEnemyHpPlan → null），普通房间的指纹与存档形状因此逐字节不变。
//
// 这里守住移植时最容易漏的三件事：
//   1. 校验 / 规范化 / 指纹（`isEnemyHpPlan`、`canonicalEnemyHpPlan`、`enemyHpMulAt`）；
//   2. `Match.enemyHpMul` 在按回合模式下**恒为 1**，每回合真正的值只能从 `enemyHpMulAt(round)` 取 ——
//      战斗 spec 的 flags 与**领袖共享血池**都必须走它（bossRounds.js 曾经读单值，领袖血池因此完全不吃倍率）；
//   3. 倍率真的落到 sim 的敌人血量上（spawns.js 的 `flags.enemyHpMul`），不是只写在 spec 里。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import {
  ENEMY_MULTIPLIERS, isEnemyHpPlan, canonicalEnemyHpPlan, enemyHpMulAt,
  experimentalOptions, experimentalKey, sameExperimental, isExperimental,
} from '../../shared/experimental.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';
import { makeMatch, DATA } from './harness.js';

/** 两个默认键 + 计划（`isExperimental` 要求两个默认键都在） */
const planExp = (plan) => ({ revivalEnabled: false, disableSharedPool: false, enemyHpPlan: plan });

test('isEnemyHpPlan：只接受「从第 1 回合起、严格递增、≤20 回合、倍率在表里」的 1–6 段', () => {
  assert.equal(isEnemyHpPlan([[1, 1]]), true);
  assert.equal(isEnemyHpPlan([[1, 1], [8, 2]]), true);
  assert.equal(isEnemyHpPlan([[1, 1], [8, 2], [14, 5]]), true, '三段');
  assert.equal(isEnemyHpPlan([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]), true, '六段 = 上限');
  assert.equal(isEnemyHpPlan([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]]), false, '七段超上限');

  assert.equal(isEnemyHpPlan(null), false);
  assert.equal(isEnemyHpPlan([]), false);
  assert.equal(isEnemyHpPlan([[1]]), false, '每段必须正好两个数');
  assert.equal(isEnemyHpPlan([[1, 1, 2]]), false);
  assert.equal(isEnemyHpPlan([[2, 1]]), false, '第一段必须从第 1 回合起');
  assert.equal(isEnemyHpPlan([[1, 1], [8, 2], [8, 3]]), false, '回合必须严格递增');
  assert.equal(isEnemyHpPlan([[1, 1], [8, 2], [5, 3]]), false, '不能回退');
  assert.equal(isEnemyHpPlan([[1, 1], [21, 2]]), false, '回合上限 20');
  assert.equal(isEnemyHpPlan([[1, 1.1]]), false, '倍率必须是房间里能选的档位');
  assert.equal(isEnemyHpPlan([[1, 7]]), false);
  assert.equal(isEnemyHpPlan([[1.5, 2]]), false, '回合必须是整数');
  for (const m of ENEMY_MULTIPLIERS) assert.equal(isEnemyHpPlan([[1, m]]), true, `×${m} 是合法档位`);
});

test('canonicalEnemyHpPlan：整段同一个倍率 → null（退化成单值）；否则冻结成段', () => {
  assert.equal(canonicalEnemyHpPlan([[1, 1]]), null, '只有一段 ×1 = 没开');
  assert.equal(canonicalEnemyHpPlan([[1, 2], [8, 2]]), null, '整段 ×2 = 单值 ×2');
  const plan = canonicalEnemyHpPlan([[1, 1], [8, 2]]);
  assert.deepEqual(plan.map((s) => [...s]), [[1, 1], [8, 2]]);
  assert.ok(Object.isFrozen(plan) && plan.every(Object.isFrozen), '冻结，避免房间配置被就地改掉');
});

test('enemyHpMulAt：有计划按回合取那一段，没计划取单值，非法回合按第 1 回合', () => {
  const plan = planExp([[1, 1], [8, 2], [14, 3]]);
  assert.equal(enemyHpMulAt(plan, 1), 1);
  assert.equal(enemyHpMulAt(plan, 7), 1);
  assert.equal(enemyHpMulAt(plan, 8), 2);
  assert.equal(enemyHpMulAt(plan, 13), 2);
  assert.equal(enemyHpMulAt(plan, 14), 3);
  assert.equal(enemyHpMulAt(plan, 99), 3, '超过最后一段就一直是最后一段');
  assert.equal(enemyHpMulAt(plan, undefined), 1, '回合不合法 → 第 1 回合');
  assert.equal(enemyHpMulAt({ enemyHpMul: 2 }, 9), 2, '单值：每回合都一样');
  assert.equal(enemyHpMulAt({ enemyHpMul: 1 }, 9), 1);
  assert.equal(enemyHpMulAt(undefined, 9), 1, '没有配置 = 原版');
});

test('experimentalOptions：计划取代单值；整段同倍率退化成 enemyHpMul；产物本身仍合法（读档 / 重连会再校验一次）', () => {
  const withPlan = experimentalOptions({ ...planExp([[1, 1], [8, 2]]), enemyHpMul: 5 });
  assert.deepEqual(withPlan.enemyHpPlan.map((s) => [...s]), [[1, 1], [8, 2]]);
  assert.equal('enemyHpMul' in withPlan, false, '有计划时不写单值（两者只存一个）');
  assert.equal(isExperimental(withPlan), true, '规范化后的 DTO 必须能通过校验');

  const flatPlan = experimentalOptions(planExp([[1, 2], [8, 2]]));
  assert.equal('enemyHpPlan' in flatPlan, false, '整段 ×2 退化成单值');
  assert.equal(flatPlan.enemyHpMul, 2);

  const plain = experimentalOptions({ revivalEnabled: false, disableSharedPool: false });
  assert.equal('enemyHpPlan' in plain && 'enemyHpMul' in plain, false, '普通房间两个键都不带');
});

test('experimentalKey / sameExperimental：不同的按回合计划是两套规则（不能混坐、不能互相顶掉）', () => {
  const a = experimentalOptions(planExp([[1, 1], [8, 2]]));
  const b = experimentalOptions(planExp([[1, 1], [8, 3]]));
  const c = experimentalOptions(planExp([[1, 1], [10, 2]]));
  const flat2 = experimentalOptions({ revivalEnabled: false, disableSharedPool: false, enemyHpMul: 2 });
  const keys = [a, b, c, flat2].map(experimentalKey);
  assert.equal(new Set(keys).size, 4, `四套规则四个指纹（${keys.join(' / ')}）`);
  assert.match(experimentalKey(a), /hpplan1x1,8x2/);
  assert.equal(sameExperimental(a, experimentalOptions(planExp([[1, 1], [8, 2]]))), true, '同样的计划 = 同样的规则');
  assert.equal(sameExperimental(a, b), false);
  assert.equal(sameExperimental(a, c), false);
  assert.equal(sameExperimental(a, flat2), false, '按回合 ×2 与全程 ×2 不是同一套规则');
});

/** 直接建一个 2 人房（不跑对局）：只验证每回合的规则值。 */
function twoSeatMatch(experimental) {
  const seats = [0, 1].map((i) => ({ seat: i, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true }));
  const m = new Match({
    roomCode: 'ABCD', mode: 'coop', difficulty: 'NORMAL', seed: 1, data: DATA,
    scheduler: new VirtualScheduler(), send() {}, broadcast() {}, onEnd() {}, seats, experimental,
  });
  return m;
}

test('Match：按回合模式下 enemyHpMul 恒为 1，_ruleFlags() 每回合取自己的倍率', () => {
  const m = twoSeatMatch(planExp([[1, 1], [8, 2]]));
  try {
    assert.equal(m.enemyHpMul, 1, '单值在按回合模式下没有意义（它必须是 1，否则会二次乘算）');
    assert.equal(m.enemyHpMulAt(7), 1);
    assert.equal(m.enemyHpMulAt(8), 2);
    m.round = 7;
    assert.equal('enemyHpMul' in m._ruleFlags(), false, '第 7 回合 ×1：连键都不发（普通房逐字节不变）');
    m.round = 8;
    assert.equal(m._ruleFlags().enemyHpMul, 2, '第 8 回合起 ×2 落在战斗 spec 的 flags 上');
    m.round = 14;
    assert.equal(m._ruleFlags().enemyHpMul, 2, '最后一段一直生效');
  } finally { m.dispose(); }
});

test('领袖共享血池吃按回合倍率（bossRounds.js 必须用 enemyHpMulAt，不能读单值）', () => {
  const experimental = planExp([[1, 1], [8, 2]]);
  // fake 战斗：只关心血池怎么算、boss 关的 spec flags 带了什么
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 21, fake: true, captureFrames: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : {}), experimental,
  });
  const m = h.m;
  try {
    m.start();
    h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.bossRound);
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
    assert.equal(m.phase, PHASE.FINAL_ASSAULT, '到达最终攻势');
    assert.equal(m.enemyHpMul, 1, '单值是 1 —— 读它的血池会完全不吃倍率（移植前的 bug）');
    assert.equal(m.enemyHpMulAt(m.round), 2, '这一回合是 ×2');
    const alive = m.alivePlayers().length;
    const want = bossPoolHp(m.gd, m.bossId, alive, { experimental: m.capacityExperiment, hpMul: 2 });
    assert.equal(m.bossPool.maxHp, want, `血池 = 官方值 × 4 × 本回合倍率（${want}）`);
    assert.equal(m.bossPool.maxHp, bossPoolHp(m.gd, m.bossId, alive, { experimental: m.capacityExperiment }) * 2);
    // 领袖关的战斗 spec 走同一个 `_ruleFlags()`（fake 战斗不保留 spec flags，所以在这里直接查规则）
    assert.equal(m._ruleFlags().enemyHpMul, 2, '领袖关的 spec flags 与本回合一致');
  } finally { m.dispose(); }
});

test('sim：flags.enemyHpMul 真的把敌人血量翻倍（spawns.js，同一波次逐单位比对）', () => {
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 31, instant: false,
    experimental: planExp([[1, 1], [8, 2]]),
  });
  const m = h.m;
  try {
    m.start();
    // 走到 R1 的作战阶段：这时 `m.wave` 才有真实出怪表
    h.drive(() => m.phase === PHASE.COMBAT && m.round === 1);
    assert.equal(m.phase, PHASE.COMBAT, '进入作战');
    const ps = h.ps('p_0');
    const opts = m._normalOpts(ps);
    assert.ok(opts.spawns.length > 0, '这一回合有出怪');
    // 出怪时间归零：两种倍率下每个单位都在第一步就出现，逐一比对
    const base = { ...opts, spawns: opts.spawns.map((s) => ({ ...s, time: 0 })) };
    const hpOf = (flags) => {
      const b = createBattleFromSpec({ ...base, flags: { ...base.flags, ...flags } }, m.ds, { quiet: true, recordEvents: false });
      for (let i = 0; i < 3; i++) b.step();
      return b.units.filter((u) => u.side === 'enemy' && u.alive).map((u) => u.s.maxHp);
    };
    const plain = hpOf({ enemyHpMul: 1 });
    const doubled = hpOf({ enemyHpMul: 2 });
    assert.ok(plain.length > 0 && plain.length === doubled.length, `两种倍率下出怪数量一致（${plain.length}）`);
    for (let i = 0; i < plain.length; i++) {
      assert.ok(Math.abs(doubled[i] - plain[i] * 2) <= 1e-6 * doubled[i], `第 ${i} 只：${plain[i]} → ${doubled[i]}（应为 ×2）`);
    }
  } finally { m.dispose(); }
});
