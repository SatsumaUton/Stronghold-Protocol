// 预约盟约（g.bondPlan，移植自参考版）。纯显示功能：声明「这一局打算走哪个核心盟约」，
// 下发给 m.public 的 players[].bondPlan，队友和观战者都看得见。没有任何规则读它。
//
// 测四件事：
//   · 只有核心盟约（isCore）可以预约，特质盟约不行
//   · 可选相位：INFO_CHECK / 选策略 / 战前确认 / 第 1 回合（含它的备战）都可以，
//     第 1 回合的战斗开打后就不行
//   · 非法值 → BAD_TARGET，省略/null → 清空，重复同一个 → 不产生任何变化
//   · 视图：预约了才有这个键（默认房间的视图与以前逐字一致）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';

/** 起一局并返回常用句柄。 */
function started(o = {}) {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 3, ...o }).start();
  const m = h.m;
  return { h, m, p0: m.players.get('p_0'), p1: m.players.get('p_1'), gd: m.gd };
}

/** 最后一次广播的 m.public。 */
function lastPublic(h) {
  const pubs = h.bc.filter((x) => x.t === 'm.public');
  return pubs[pubs.length - 1];
}

test('可预约的盟约 = 所有核心盟约，冻结并缓存', () => {
  const { gd } = started();
  const ids = gd.plannableBondIds();
  assert.ok(ids.length > 0, '至少有核心盟约');
  assert.ok(ids.length < gd.bondIds.length, '不是全部盟约 —— 特质盟约不该在内');
  for (const id of ids) assert.equal(gd.bond(id).isCore, true, `${id} 应该是核心盟约`);
  // 反向：任何非核心盟约都不能预约
  const traits = gd.bondIds.filter((id) => gd.bond(id)?.isCore !== true);
  assert.ok(traits.length > 0);
  for (const id of traits.slice(0, 5)) assert.equal(gd.bondPlannable(id), false, `${id} 不是核心盟约，不能预约`);
  assert.ok(Object.isFrozen(ids), '冻结');
  assert.equal(gd.plannableBondIds(), ids, '缓存：同一数组');
});

test('bondPlannable 只认非空字符串', () => {
  const { gd } = started();
  const ids = gd.plannableBondIds();
  assert.equal(gd.bondPlannable(ids[0]), true);
  for (const bad of ['', 'nope', null, undefined, 42, {}, [], ids[0] + 'x']) {
    assert.equal(gd.bondPlannable(bad), false, `${String(bad)} 不该通过`);
  }
});

test('预约 / 改 / 清空，都在 m.public 里看得见', () => {
  const { h, m, p0, p1, gd } = started();
  const ids = gd.plannableBondIds();
  assert.equal(p0.bondPlan, null, '初始不预约');

  assert.deepEqual(m._handle(p0, { t: 'g.bondPlan', bondId: ids[0] }), { ok: true });
  assert.equal(p0.bondPlan, ids[0]);
  m.flush(true);
  let v = lastPublic(h).players.find((p) => p.playerId === 'p_0');
  assert.equal(v.bondPlan, ids[0], '队友看得到');

  // 换一个
  assert.deepEqual(m._handle(p0, { t: 'g.bondPlan', bondId: ids[1] }), { ok: true });
  assert.equal(p0.bondPlan, ids[1]);

  // 清空（省略 bondId）
  assert.deepEqual(m._handle(p0, { t: 'g.bondPlan' }), { ok: true });
  assert.equal(p0.bondPlan, null);
  m.flush(true);
  v = lastPublic(h).players.find((p) => p.playerId === 'p_0');
  assert.ok(!('bondPlan' in v), '清空后不下发这个键');

  // 只有预约的人才出现在视图里
  assert.ok(!('bondPlan' in lastPublic(h).players.find((p) => p.playerId === 'p_1')));
  assert.ok(p1);
});

test('非法盟约 → BAD_TARGET，且不改变原预约', () => {
  const { m, p0, gd } = started();
  const ids = gd.plannableBondIds();
  m._handle(p0, { t: 'g.bondPlan', bondId: ids[0] });
  const trait = gd.bondIds.find((id) => gd.bond(id)?.isCore !== true);
  assert.deepEqual(m._handle(p0, { t: 'g.bondPlan', bondId: trait }), { error: 'BAD_TARGET' }, '特质盟约不行');
  assert.deepEqual(m._handle(p0, { t: 'g.bondPlan', bondId: 'no-such-bond' }), { error: 'BAD_TARGET' });
  assert.equal(p0.bondPlan, ids[0], '失败不改变原来的预约');
});

test('重复预约同一个：返回 ok 但不触发广播', () => {
  const { h, m, p0, gd } = started();
  const id = gd.plannableBondIds()[0];
  m._handle(p0, { t: 'g.bondPlan', bondId: id });
  // 用不带 force 的 flush：只在下过 markPublic 时才发，才能证明「没变化就不发」
  m.flush();
  const before = h.bc.length;
  assert.deepEqual(m._handle(p0, { t: 'g.bondPlan', bondId: id }), { ok: true });
  m.flush();
  assert.equal(h.bc.length, before, '没有变化就不该重新下发');
});

test('可预约的相位：第 1 回合（含备战）之前都可以，之后不行', () => {
  const { m } = started();
  const savedPhase = m.phase;
  const savedRound = m.round;
  const open = (phase, round) => { m.phase = phase; m.round = round; return m.bondPlanOpen(); };
  // 开局到第 1 回合备战：都可以
  for (const ph of [PHASE.INFO_CHECK, PHASE.BAND_DRAFT, PHASE.BATTLE_CHECK, PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]) {
    assert.equal(open(ph, 1), true, `${ph} 第 1 回合应该可以`);
  }
  // 第 2 回合起：不行
  for (const ph of [PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]) {
    assert.equal(open(ph, 2), false, `${ph} 第 2 回合不该可以`);
  }
  // 战斗/结算/结束：任何回合都不行
  for (const ph of [PHASE.COMBAT, PHASE.SETTLE, PHASE.ENDED]) {
    assert.equal(open(ph, 1), false, `${ph} 不该可以`);
  }
  m.phase = savedPhase;
  m.round = savedRound;
});

test('战斗开打后再预约 → WRONG_PHASE，预约保持不变', () => {
  const { m, p0, gd } = started();
  const ids = gd.plannableBondIds();
  m._handle(p0, { t: 'g.bondPlan', bondId: ids[0] });
  const before = p0.bondPlan;
  m.phase = PHASE.COMBAT;
  m.round = 2;
  assert.deepEqual(m._handle(p0, { t: 'g.bondPlan', bondId: ids[1] }), { error: 'WRONG_PHASE' });
  assert.deepEqual(m._handle(p0, { t: 'g.bondPlan' }), { error: 'WRONG_PHASE' });
  assert.equal(p0.bondPlan, before);
});

test('bondPlan 跟着存档走（断点续玩不丢预约）', async () => {
  const { m, p0, gd } = started();
  const id = gd.plannableBondIds()[2];
  m._handle(p0, { t: 'g.bondPlan', bondId: id });
  const { snapshotMatch } = await import('../../server/match/snapshot.js');
  const doc = snapshotMatch(m, { reason: 'test', checkpointId: 'cp' });
  // 存档里玩家分两块：顶层放 special 字段（ready/loadout/…），`f` 放 PLAYER_FIELDS.saved
  const saved = doc.players.find((p) => p.playerId === 'p_0');
  assert.ok(saved, '存档里找得到 p_0');
  assert.equal(saved.f.bondPlan, id, '存档的 saved 区里有 bondPlan');
});

// ── 跨版本：预约盟约必须跟着版本切换 ─────────────────────────────────────────
// 四个官方版本各有自己的 data/versions/*/bonds.json，核心盟约数量不同
// （第二期 8 个、第一期 6 个）。plannableBondIds() 读的是当前 GameData 的盟约表，
// 所以它天然按版本切换 —— 这里把这个行为锁住，避免以后有人改成读某个全局常量。
test('跨版本：可预约盟约跟着版本走，不是固定的', async () => {
  const dataMod = await import('../../server/data.js');
  const { GameData } = await import('../../server/match/gamedata.js');
  const { VERSIONS } = await import('../../shared/versions.js');
  const log = { warn() {}, error() {}, info() {} };
  const got = new Map();
  for (const v of VERSIONS) {
    const dir = dataMod.versionDataDir(v.id);
    const data = dataMod.loadData(dir, { log, expected: dataMod.VERSION_DATA_FILES });
    const gd = new GameData(data, null);
    got.set(v.id, { all: gd.bondIds.length, plan: gd.plannableBondIds().slice() });
    // 每个版本都必须有可预约的盟约（不能因为数据里没有 isCore 就全空）
    assert.ok(gd.plannableBondIds().length > 0, `${v.id} 应该有可预约的核心盟约`);
    for (const id of gd.plannableBondIds()) assert.equal(gd.bond(id)?.isCore, true, `${v.id}: ${id} 应该是核心盟约`);
  }
  // 第一期的核心盟约比第二期少 —— 证明确实是按版本算的
  const act2 = got.get('act2autochess');
  const act1 = got.get('act1autochess');
  assert.ok(act2 && act1, '两个主版本都在');
  assert.ok(act2.plan.length > act1.plan.length, `第二期(${act2.plan.length}) 的核心盟约应多于第一期(${act1.plan.length})`);
  // 第一期独有的旧版和新版必须一致（同一份 act1 数据族）
  assert.deepEqual(got.get('act1autochess@V1_1').plan, act1.plan, '第一期上下半核心盟约一致');
});
