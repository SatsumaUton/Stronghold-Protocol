// 「深渊回响」深潜回合判定的单元测试（MatchEcho 的方法，用假 `this` 直接调原型）。
//
// 覆盖本会话后加的结构难度与日程逻辑：
//   * _echoWordCap     词条上限 3 → 每 10 层 +1 → 最多 8
//   * _echoEliteCount  精英每 3 层一次，R30 后 2 只、R60 后 3 只
//   * _echoBossReturn  boss 返场挂固定节点 R20 / R25 / R30…
//   * _echoNextNodeRound  下一个节点
//   * _echoIntel       备战只给威胁值 + 是否精英（不含敌人总数、不含空中数量）
//   * _echoAtEnd/无尽  只有安全阀才结束
//   * _echoHitLimitMul 限伤跟着深度缩放
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchEcho } from '../../server/match/match/echoPhase.js';

const P = MatchEcho.prototype;

/** 造一个只带判定所需字段的假 match（深潜从 R16 进，即打过隐藏核心）。
 *  从 MatchEcho.prototype 派生，这样方法内部互相调用（_echoDiveRound / _echoDepth …）也能解析。 */
const fakeMatch = ({ round = 20, diveStart = 16, variant = 'deepecho', spawns = [], hpMul = null } = {}) => Object.assign(Object.create(P), {
  echoVariant: variant,
  echoDiveStart: diveStart,
  echoBlessings: [],
  echoBlessingDraws: 0,
  echoBlessingOffer: null,
  _echoBlessingVotes: new Map(),
  round,
  wave: spawns.length ? { spawns } : null,
  bossWaves: null,
  gd: {
    enemy: (k) => ({ stats: { maxHp: k === 'big' ? 40000 : 1000 }, rank: k === 'elite' ? 'ELITE' : 'NORMAL' }),
    baseEnemyScale: () => ({ hpMul: 6.687075 }),
    enemyScale: () => ({ hpMul: hpMul ?? 6.687075 }),
  },
});

test('词条上限：3 条起，每深 10 层 +1，不封顶（2026-11-05 维护者：让诅咒一直加）', () => {
  assert.equal(P._echoWordCap.call(fakeMatch({ round: 16 }), 16), 3, '深度 1');
  assert.equal(P._echoWordCap.call(fakeMatch({ round: 25 }), 25), 3, '深度 10 仍是 3');
  assert.equal(P._echoWordCap.call(fakeMatch({ round: 26 }), 26), 4, '深度 11 → 4');
  assert.equal(P._echoWordCap.call(fakeMatch({ round: 66 }), 66), 8, '深度 51 → 8');
  assert.equal(P._echoWordCap.call(fakeMatch({ round: 90 }), 90), 10, '深度 75 → 10（越过旧封顶继续涨）');
  assert.equal(P._echoWordCap.call(fakeMatch({ round: 5, diveStart: 16 }), 5), 3, '深潜之前按基础值');
});

test('精英数量：每 3 层一次，R30 后 2 只，R60 后 3 只', () => {
  assert.equal(P._echoEliteCount.call(fakeMatch({ round: 16 }), 16), 0, '深度 1 不是精英层');
  assert.equal(P._echoEliteCount.call(fakeMatch({ round: 18 }), 18), 1, '深度 3 → 1 只');
  assert.equal(P._echoEliteCount.call(fakeMatch({ round: 21 }), 21), 1, '深度 6 → 1 只');
  assert.equal(P._echoEliteCount.call(fakeMatch({ round: 45 }), 45), 2, '深度 30 → 2 只');
  assert.equal(P._echoEliteCount.call(fakeMatch({ round: 75 }), 75), 3, '深度 60 → 3 只');
  assert.equal(P._echoEliteCount.call(fakeMatch({ round: 105 }), 105), 3, '封顶 3 只');
});

test('boss 返场：深度 15 起才返场（维护者 2026-11-04：5/10 层是挑战关，不返场 boss）', () => {
  for (const r of [40, 50, 60]) {
    assert.equal(P._echoBossReturn.call(fakeMatch({ round: r }), r), true, `R${r}（深度 ${r - 15}）应是返场`);
  }
  for (const r of [16, 19, 20, 25, 30, 34, 39, 41]) {
    assert.equal(P._echoBossReturn.call(fakeMatch({ round: r }), r), false, `R${r} 不是返场`);
  }
  assert.equal(P._echoBossReturn.call(fakeMatch({ round: 20, diveStart: 30 }), 20), false, '还没进深潜');
  assert.equal(P._echoBossReturn.call(fakeMatch({ round: 20, variant: null }), 20), false, '普通房不返场');
});

test('下一个节点：锚点段 5 层、R30 之后 10 层，且始终指向未来', () => {
  assert.equal(P._echoNextNodeRound.call(fakeMatch(), 16), 20);
  assert.equal(P._echoNextNodeRound.call(fakeMatch(), 19), 20);
  assert.equal(P._echoNextNodeRound.call(fakeMatch(), 20), 25, '正在节点上要指向下一个');
  assert.equal(P._echoNextNodeRound.call(fakeMatch(), 26), 30);
  assert.equal(P._echoNextNodeRound.call(fakeMatch(), 30), 40, 'R30 之后跳到 R40');
  assert.equal(P._echoNextNodeRound.call(fakeMatch(), 31), 40);
  assert.equal(P._echoNextNodeRound.call(fakeMatch(), 39), 40);
  assert.equal(P._echoNextNodeRound.call(fakeMatch(), 40), 50);
});

test('备战情报只给威胁值与是否精英（不发敌人总数 / 空中数量）', () => {
  const spawns = [
    { enemyKey: 'small', count: 3, preview: { fly: true, elite: false } },
    { enemyKey: 'elite', count: 1, preview: { fly: false, elite: true } },
    { enemyKey: 'part', count: 9, tag: 'part', preview: { elite: true } },
  ];
  const intel = P._echoIntel.call(fakeMatch({ round: 20, spawns }), 20);
  assert.equal(intel.threat, 1000 * 3 + 1000 * 1, '威胁值 = 最大生命 × 数量，part 不计');
  assert.equal(intel.elite, true);
  assert.equal(Object.hasOwn(intel, 'count'), false, '不能下发敌人总数');
  assert.equal(Object.hasOwn(intel, 'air'), false, '不能下发空中数量');
  assert.equal(intel.nextNodeRound, 25);
});

test('boss 返场回合不给聚合情报（明牌走原版预览）', () => {
  const m = fakeMatch({ round: 20, spawns: [{ enemyKey: 'small', count: 1, preview: {} }] });
  m.bossWaves = [{ players: [1], wave: { spawns: [] } }];
  assert.equal(P._echoIntel.call(m, 20), null);
});

test('普通房拿不到任何深潜情报', () => {
  const m = fakeMatch({ round: 20, variant: null, spawns: [{ enemyKey: 'small', count: 1, preview: {} }] });
  assert.equal(P._echoIntel.call(m, 20), null);
  assert.equal(P._echoDiveRound.call(m, 20), false);
});

test('无尽：只有安全阀才结束，30 关不再算终点', () => {
  assert.equal(P._echoAtEnd.call(fakeMatch({ round: 30 }), 30), false, 'R30 不再自动胜利');
  assert.equal(P._echoAtEnd.call(fakeMatch({ round: 60 }), 60), false);
  assert.equal(P._echoAtEnd.call({ echoVariant: 'deepecho', round: 999 }), true, '安全阀');
  assert.equal(P._echoAtEnd.call(fakeMatch({ round: 50, variant: null }), 50), false, '普通房与此无关');
});

test('限伤按深度缩放：官方档位是 1，越深越大', () => {
  const atBase = P._echoHitLimitMul.call(fakeMatch({ round: 15, hpMul: 6.687075 }));
  assert.ok(Math.abs(atBase - 1) < 1e-9, 'R15 官方档位 → ×1');
  const deep = P._echoHitLimitMul.call(fakeMatch({ round: 30, hpMul: 6.687075 * 15.407 }));
  assert.ok(Math.abs(deep - 15.407) < 1e-6, 'R30 ≈ ×15.4');
  assert.equal(P._echoHitLimitMul.call(fakeMatch({ round: 30, variant: null })), 1, '普通房恒为 1');
});
