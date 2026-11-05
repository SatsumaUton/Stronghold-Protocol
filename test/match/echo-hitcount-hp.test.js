// 「频次怪」（器物：青铜镜、铁矛头…）在深潜里的血量。
//
// 这类怪的 maxHp **就是**「需要被打几下」：sim 的 hitCount 让每次伤害只扣 1（server/sim/damage.js）。
//
// 两版维护者决定：
//   1. 2026-11-05 第一版：封顶在数据 baseHp（30 / 45 下）—— 因为跟着深度缩放会变成 6080 下打不完；
//   2. 2026-11-05 第二版（当前）：30 下在深层等于「一刀就没」，太简单 → 改成**按深度给绝对血量**，
//      落在 500–2000 区间：第 1 层 500 下，每深一层 +40，第 39 层起固定 2000 下。
//
// 走 spec flags `enemyHpAbs`（Match._ruleFlags → sim spawnEnemy 统一覆盖）：它们多数是召唤物
//（新硎的 DeadSpawn 出铁矛头），不在 `wave.spawns` 里，只有出怪那一处管得到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { echoHitCountEnemy, echoHitCountHp, ECHO_HITCOUNT_HP_MIN, ECHO_HITCOUNT_HP_MAX } from '../../server/match/match/echoWaves.js';

const dive = (o = {}) => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true, variant: 'deepecho', ...o });

test('血量曲线：第 1 层 500 下 → 每层 +40 → 第 39 层起固定 2000 下', () => {
  assert.equal(ECHO_HITCOUNT_HP_MIN, 500);
  assert.equal(ECHO_HITCOUNT_HP_MAX, 2000);
  assert.equal(echoHitCountHp(1), 500);
  assert.equal(echoHitCountHp(2), 540);
  assert.equal(echoHitCountHp(10), 860);
  assert.equal(echoHitCountHp(20), 1260);
  assert.equal(echoHitCountHp(39), 2000);
  assert.equal(echoHitCountHp(60), 2000, '封顶 2000');
  assert.equal(echoHitCountHp(0), 500, '非法深度按第 1 层');
  assert.equal(echoHitCountHp(undefined), 500);
  // 单调不减，且始终在 500–2000 之间
  let prev = 0;
  for (let d = 1; d <= 60; d++) {
    const hp = echoHitCountHp(d);
    assert.ok(hp >= ECHO_HITCOUNT_HP_MIN && hp <= ECHO_HITCOUNT_HP_MAX, `第 ${d} 层 ${hp} 超出区间`);
    assert.ok(hp >= prev, `第 ${d} 层不该比上一层低`);
    prev = hp;
  }
});

test('深潜的覆盖表覆盖全部「频次怪」，血量跟着当前深度走', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const keys = [...echoHitCountEnemy(m.gd)];
  assert.ok(keys.length >= 10, `数据里至少有 10 个器物，实际 ${keys.length}`);
  // 第 1 层
  m.round = 1;
  const shallow = m._echoHitCountHp();
  assert.equal(Object.keys(shallow).length, keys.length);
  for (const k of keys) assert.equal(shallow[k], 500, `${k} 第 1 层 500 下`);
  // 第 25 层：1460
  m.round = 25;
  const deep = m._echoHitCountHp();
  for (const k of keys) assert.equal(deep[k], 1460, `${k} 第 25 层 1460 下`);
  // 铁矛头（新硎的召唤物，两版问题都是它）
  assert.equal(deep.enemy_1208_msfji_2, 1460);
});

test('spec flags 只在深潜里带 enemyHpAbs（普通房逐字节不变）', (t) => {
  const h = dive();
  t.after(() => h.m.dispose());
  const flags = h.m._ruleFlags();
  assert.ok(flags.enemyHpAbs && Object.keys(flags.enemyHpAbs).length > 0, '深潜的每份 spec 都带绝对血量表');
  assert.equal(flags.enemyHpMulCap, undefined, '旧的倍率封顶表已经不再使用');
  const plain = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true });
  t.after(() => plain.m.dispose());
  assert.equal(plain.m._ruleFlags().enemyHpAbs, undefined);
});

test('出怪处统一覆盖：铁矛头按 202 倍深度缩放发下来，血量仍是表里的绝对血量', () => {
  const flags = { enemyHpAbs: { enemy_1208_msfji_2: 1260 } };
  const deep = makeBattle({ flags }).b;
  const e = deep.spawnEnemy('enemy_1208_msfji_2', { mods: { hpMul: 202.6667 } });
  assert.ok(e, '召唤物能出怪');
  assert.equal(e.base.maxHp, 1260, '绝对血量覆盖掉深度缩放');
  assert.equal(e.hp, 1260);

  // 对照：没有覆盖表时就是被缩放后的血量（这正是第一版要修的 6080）
  const open = makeBattle({ flags: {} }).b;
  const e2 = open.spawnEnemy('enemy_1208_msfji_2', { mods: { hpMul: 202.6667 } });
  assert.ok(e2.base.maxHp > 6000, `未覆盖时 ${e2.base.maxHp}`);

  // 只对表里的 key 生效：同一份 spec 里的普通敌人照常缩放
  const big = makeBattle({ flags }).b;
  const e3 = big.spawnEnemy('enemy_1207_sfji_2', { mods: { hpMul: 2 } });
  assert.equal(e3.base.maxHp, 14000 * 2, '新硎本体不受影响');
});

test('真战斗里也一样：频次怪的 maxHp = 当前深度的血量，且它带 hitCount 标记', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 25;                       // 第 25 层 → 1460 下
  const flags = m._ruleFlags();
  const bh = makeBattle({ flags, enemies: [{ key: 'enemy_1208_msfji_2', mods: { hpMul: 202.6667, speedMul: 0 } }], content: 'full', autoFinish: false });
  bh.step(1);
  const e = (bh.b.enemies || [])[0];
  assert.ok(e, '铁矛头要出场');
  assert.equal(e.base.maxHp, 1460, '血量 = 第 25 层的 1460 下');
  assert.equal(e.hp, 1460);
  // 频次怪的判定靠 hitCount 标记（每次伤害只扣 1），数据里 12 条器物都该带上
  const flagged = (e.buffs || []).some((b) => b && b.flags && (b.flags.hitCount || b.flags.hitCountArts));
  assert.ok(flagged, '铁矛头必须带 hitCount 标记（否则会按普通血量结算）');
  bh.b.dispose?.();
});
