// 「深渊回响」深潜的随机出怪（server/match/match/echoWaves.js）单元测试。
//
// 维护者 2026-11-03 的口径（最后一次收敛）：
//   * **不再沿用原版出怪公式**：条数 / 怪种 / 数量 / 时间 / 路线全部随机；
//   * **强度仍按回合增长**：走 mods（echoScale），同一只怪在不同回合强度不同；
//   * **精英有强度下限**：低数值的怪永远不会变成精英；
//   * **路线必须来自地图**：只在这张图真实存在的路线里选。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  echoPoolFor, echoRandomWave, echoProfileFor, ECHO_ELITE_MIN_HP, ECHO_MIN_ACTIONS, ECHO_MAX_ACTIONS, ECHO_MAX_UNITS,
} from '../../server/match/match/echoWaves.js';
import { isFlyKey, classOf, previewInfo, isLeaderTemplate, roundMods } from '../../server/match/waves.js';

/** 假敌人表：两个地面、一个飞行、两个精英（一强一弱）。 */
const ENEMIES = {
  g1: { stats: { maxHp: 100 } },
  g2: { stats: { maxHp: 250 } },
  f1: { stats: { maxHp: 80 }, isFlyEnemy: true },
  elStrong: { stats: { maxHp: 6000 }, rank: 'ELITE' },
  elWeak: { stats: { maxHp: 900 }, rank: 'ELITE' },   // 低于 ECHO_ELITE_MIN_HP：不能当精英
  N: null, NF: null,                                     // 模板占位符不是真实敌人
};

const ROUTES = [
  { start: [12, 3], motion: 'WALK' },
  { start: [9, 5], motion: 'FLY' },
  { start: [12, 9], motion: 'E_NUM' },   // 不是出兵口，不能被选中
];

const WAVES = {
  tplA: { routes: ROUTES, spawns: [{ key: 'g1' }, { key: 'f1' }, { key: 'elStrong' }, { key: 'elWeak' }] },
};

const gd = {
  enemy: (k) => ENEMIES[k] || null,
  roundCfg: () => ({ template: 'tplA' }),
  wave: () => WAVES.tplA,
};

const H = { isFlyKey, classOf, previewInfo, isLeaderTemplate, roundMods };
const SCALE = { hpMul: 6.687, atkMul: 2.14, speedMul: 1.15 };
const seq = (...xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };
const opts = (o = {}) => ({ echoGrowth: 1.2, echoPoolRound: 1, echoScale: SCALE, echoBudget: 400, echoTimeLimit: 60, ...o });

test('池子来自 1..N 回合的模板，按移动方式分桶，占位符被过滤', () => {
  const pool = echoPoolFor(gd, 1, H);
  // 池子只收模板里真出现过的敌人：模板是 g1 / f1 / elStrong / elWeak（g2 不在模板里，所以不进池）
  assert.deepEqual(pool.ground.map((x) => x.key).sort(), ['elStrong', 'elWeak', 'g1']);
  assert.deepEqual(pool.fly.map((x) => x.key), ['f1']);
  assert.equal(pool.all.find((x) => x.key === 'elStrong').elite, true);
});

test('普通回合：echoGrowth 缺失时返回 null（走原版出怪路径）', () => {
  assert.equal(echoRandomWave(gd, WAVES.tplA, null, seq(0.5), H), null);
  assert.equal(echoRandomWave(gd, WAVES.tplA, { echoGrowth: 1 }, seq(0.5), H), null, 'growth 必须 > 1');
  assert.equal(echoRandomWave(gd, WAVES.tplA, opts({ echoGrowth: undefined }), seq(0.5), H), null);
});

test('深潜：条数在 3..20 之间，每条都是真实敌人', () => {
  const w = echoRandomWave(gd, WAVES.tplA, opts(), seq(0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.6, 0.1, 0.5, 0.8), H);
  assert.ok(w, '必须生成波次');
  assert.ok(w.spawns.length >= ECHO_MIN_ACTIONS, `至少 ${ECHO_MIN_ACTIONS} 条`);
  assert.ok(w.spawns.length <= ECHO_MAX_ACTIONS, `最多 ${ECHO_MAX_ACTIONS} 条`);
  for (const s of w.spawns) {
    assert.ok(gd.enemy(s.enemyKey), `spawn ${s.enemyKey} 必须是真实敌人`);
    assert.ok(s.count >= 1 && s.count <= 3, '数量 1..3');
    assert.ok(s.time >= 0 && s.time <= 60 * 0.7 + 1e-9, '时间必须落在波次时限内');
    assert.equal(s.actions ? true : true, true);
  }
});

test('深潜：路线只从地图真实出兵口里选，且飞行怪只走飞行路线', () => {
  for (const seedSeq of [seq(0.05, 0.5, 0.9, 0.2, 0.7), seq(0.95, 0.1, 0.4, 0.85, 0.3)]) {
    const w = echoRandomWave(gd, WAVES.tplA, opts(), seedSeq, H);
    for (const s of w.spawns) {
      assert.notEqual(s.routeIndex, 2, 'E_NUM 不是出兵口，不能被选中');
      const route = ROUTES[s.routeIndex];
      const flyUnit = isFlyKey(gd, s.enemyKey);
      assert.equal(flyUnit, route.motion === 'FLY', `${s.enemyKey} 的移动方式必须和路线一致`);
    }
  }
});

test('强度按回合增长：mods 来自该回合的缩放（同一只怪不同回合不同强度）', () => {
  const early = echoRandomWave(gd, WAVES.tplA, opts({ echoScale: { hpMul: 6.687, atkMul: 2.14, speedMul: 1.15 } }), seq(0.3, 0.3, 0.3), H);
  const late = echoRandomWave(gd, WAVES.tplA, opts({ echoScale: { hpMul: 41.4, atkMul: 5.56, speedMul: 1.15 } }), seq(0.3, 0.3, 0.3), H);
  assert.equal(early.spawns[0].mods.hpMul, 6.687);
  assert.equal(late.spawns[0].mods.hpMul, 41.4);
  assert.ok(late.spawns[0].mods.hpMul > early.spawns[0].mods.hpMul, '越深越强');
});

test('精英：只从够强的怪里选，低数值的精英不会被提上来', () => {
  // 反复抽：只要出现精英，血量必须 ≥ 下限
  for (const seed of [0.1, 0.35, 0.6, 0.85]) {
    const w = echoRandomWave(gd, WAVES.tplA, opts({ echoElite: 3 }), seq(seed, 0.2, 0.7, 0.4, 0.9, 0.15, 0.55, 0.8), H);
    for (const s of w.spawns) {
      const e = gd.enemy(s.enemyKey);
      if (e.rank !== 'ELITE') continue;
      assert.ok(e.stats.maxHp >= ECHO_ELITE_MIN_HP, `精英 ${s.enemyKey} 血量 ${e.stats.maxHp} 低于下限`);
    }
  }
});

test('精英：这一类没有够强的候选时，不会硬塞一个弱精英', () => {
  // 池子里飞行类只有 f1（血量 80），且它不是精英 → 飞行格永远不该变成精英
  const w = echoRandomWave(gd, WAVES.tplA, opts({ echoElite: 5 }), seq(0.99, 0.99, 0.99, 0.99, 0.99), H);
  for (const s of w.spawns) {
    if (!isFlyKey(gd, s.enemyKey)) continue;
    assert.notEqual(gd.enemy(s.enemyKey).rank, 'ELITE', '飞行格不该出现精英（池里没有够强的飞行精英）');
  }
});

test('确定性：同一随机序列给同一整波', () => {
  const mk = () => echoRandomWave(gd, WAVES.tplA, opts(), seq(0.2, 0.5, 0.8, 0.1, 0.4, 0.7, 0.3), H);
  const a = mk();
  const b = mk();
  assert.deepEqual(a.spawns.map((s) => [s.enemyKey, s.count, s.time, s.routeIndex]), b.spawns.map((s) => [s.enemyKey, s.count, s.time, s.routeIndex]));
});

test('actions 与 spawns 一一对应（悬赏插入与客户端判断依赖它）', () => {
  const w = echoRandomWave(gd, WAVES.tplA, opts(), seq(0.3, 0.6, 0.15, 0.85, 0.45), H);
  assert.equal(w.actions.length, w.spawns.length);
  for (let i = 0; i < w.spawns.length; i++) {
    assert.equal(w.actions[i].index, w.spawns[i].actionIndex);
    assert.equal(w.actions[i].key, w.spawns[i].enemyKey);
    assert.equal(w.actions[i].count, w.spawns[i].count);
    assert.equal(w.actions[i].valid, true);
  }
});

test('形状参考原版：动作数与敌人总数贴着该数据回合的模板形状', () => {
  const profile = echoProfileFor(gd, 1, H);
  assert.equal(profile.actions, 4, '模板有 4 条真实出怪');
  assert.equal(profile.units, 4, '合计 4 只');
  assert.equal(profile.flyRatio, 0.25, '1/4 是飞行');
  const w = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 1, dataRound: 1 }), seq(0.2, 0.6, 0.1, 0.9, 0.4), H);
  const units = w.spawns.reduce((a, s) => a + s.count, 0);
  assert.equal(units, 4, '深度 1 的敌人数贴着原版形状');
  assert.ok(w.spawns.length >= 3 && w.spawns.length <= 4, '条数也贴着形状');
});

test('深度增幅：同一形状下越深敌人越多（每层 +6%）', () => {
  const sum = (w) => w.spawns.reduce((a, s) => a + s.count, 0);
  const shallow = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 1, dataRound: 1 }), seq(0.2, 0.6, 0.1, 0.9, 0.4), H);
  const deep = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 12, dataRound: 1 }), seq(0.2, 0.6, 0.1, 0.9, 0.4), H);
  assert.ok(sum(deep) > sum(shallow), `深度 12 (${sum(deep)}) 必须多于深度 1 (${sum(shallow)})`);
});

test('前期之后（第 5 层起）不再受模板约束：条数/时序可以由随机决定', () => {
  const template = [{ time: 1, enemyKey: 'g1', routeIndex: 0, count: 2, interval: 1 }];
  const w = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 5, echoTemplate: template }), seq(0.3, 0.7, 0.1, 0.9, 0.5, 0.2, 0.6), H);
  assert.ok(w.spawns.length >= ECHO_MIN_ACTIONS, '第 5 层起按随机条数生成');
  assert.ok(w.spawns.length > template.length, '不再是模板那一条');
});

test('没有路线 / 没有池子时返回 null（不崩、也不发空波）', () => {
  assert.equal(echoRandomWave(gd, { routes: [] }, opts(), seq(0.5), H), null);
  const noEnemies = { enemy: () => null, roundCfg: () => ({ template: 'tplA' }), wave: () => WAVES.tplA };
  assert.equal(echoRandomWave(noEnemies, WAVES.tplA, opts(), seq(0.5), H), null);
});

// ---------------------------------------------------------------------------------------------
// 16 层以后按层设计的规模（维护者 2026-11-04 §6）
// ---------------------------------------------------------------------------------------------
const unitsOf = (w) => w.spawns.reduce((a, s) => a + s.count, 0);

test('16 层以后：只数由深度决定，不再被数据回合拉回原版第 1 关', () => {
  // 深度 16 会轮回到数据回合 1（原版只有 6 只）；按层设计之后它必须和 15 层同一量级。
  const seqFor = () => seq(0.2, 0.6, 0.1, 0.9, 0.4, 0.7, 0.3);
  const d16 = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 16, dataRound: 1 }), seqFor(), H);
  const d20 = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 20, dataRound: 5 }), seqFor(), H);
  const d25 = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 25, dataRound: 10 }), seqFor(), H);
  assert.ok(unitsOf(d16) >= 100, `深度 16 只有 ${unitsOf(d16)} 只（旧版在这里掉到 14 只）`);
  assert.ok(unitsOf(d16) < unitsOf(d20), `16 层 ${unitsOf(d16)} → 20 层 ${unitsOf(d20)} 必须变多`);
  assert.ok(unitsOf(d20) < unitsOf(d25), `20 层 ${unitsOf(d20)} → 25 层 ${unitsOf(d25)} 必须变多`);
});

test('16 层以后：只数能越过旧上限 90，但不会超过 ECHO_MAX_UNITS', () => {
  const w = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 30, dataRound: 5 }), seq(0.3, 0.7, 0.2, 0.8, 0.5), H);
  assert.ok(unitsOf(w) > 90, `深度 30 应该有 ${unitsOf(w)} 只（旧上限 90）`);
  const huge = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 200, dataRound: 7, echoFunds: 0 }), seq(0.3, 0.7, 0.2, 0.8, 0.5), H);
  assert.ok(huge, '极深层也要能生成');
  assert.ok(unitsOf(huge) <= ECHO_MAX_UNITS, `极深层 ${unitsOf(huge)} 只超过硬顶 ${ECHO_MAX_UNITS}`);
  for (const s of huge.spawns) assert.ok(s.count >= 1 && s.count <= 6, `深层单条 ${s.count} 只超过上限 6`);
});

test('16 层以后：整波铺进时限的 36%，不会把 110 只挤在 20 秒里', () => {
  const w = echoRandomWave(gd, WAVES.tplA, opts({ echoDepth: 16, dataRound: 1, echoTimeLimit: 230 }), seq(0.9, 0.1, 0.6, 0.3, 0.75), H);
  const last = Math.max(...w.spawns.map((s) => s.time));
  assert.ok(last >= 230 * 0.25, `末怪只落在 ${last.toFixed(1)} 秒（时限 230）—— 又是一波洪水`);
  assert.ok(last <= 230 * 0.8 + 1e-9, `末怪 ${last.toFixed(1)} 秒超出时限的 80%`);
});

// 维护者 2026-11-05：深潜 16 层之后看到「没有本体的召唤物」。
// 召唤物（tokenOnly / 别人的 summons 目标）在数据里有 21 个，永远不该被当成普通怪抽出来。
test('召唤物不会被当成普通怪抽出来（没有本体绝不出现）', async () => {
  const { echoAllPool, echoSummonOnly, echoRoundPool } = await import('../../server/match/match/echoWaves.js');
  const { loadData } = await import('../../server/data.js');
  const DATA = await loadData();
  const gd = {
    raw: { enemies: DATA.enemies },
    token: () => null,
    enemy: (k) => DATA.enemies[k],
    roundCfg: (r) => DATA.rounds?.[r] || null,
  };
  const only = echoSummonOnly(gd);
  assert.ok(only.size >= 8, `召唤物名单太小：${only.size}`);
  const pool = echoAllPool(gd, { isFlyKey: () => false });
  const leaked = pool.all.filter((x) => only.has(x.key));
  assert.deepEqual(leaked.map((x) => x.key), [], '随机池里不该有召唤物');
  assert.ok(pool.all.length > 100, '池子不能因此被掏空');
  // 深潜深层用的是这张池子；抽查 20 个真实难度也都不该出现
  for (let r = 16; r <= 40; r += 4) {
    const rp = echoRoundPool(gd, r, { isFlyKey: () => false });
    for (const x of rp.all) assert.ok(!only.has(x.key), `第 ${r} 回合池里出现了召唤物 ${x.key}`);
  }
});