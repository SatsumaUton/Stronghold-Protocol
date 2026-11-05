// 「深渊回响」的联防：敌人必须**在时限内全部出场**（维护者 2026-11-05）。
//
// 症状：深潜后期每回合上百只怪，漏怪也跟着上百；联防按模板排队出怪，
// 最后一只排到了本回合的作战时限之外 —— 敌人还没出完，联防时间就结束了。
//
// 修法（两条一起）：
//   1. 按**实际出怪窗口**把联防时限抬上去（出完再留 30 游戏秒收尾）；
//   2. 真超过上限（300 游戏秒）就把出怪间隔等比压紧，保证全部出完。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { buildUniteWave, uniteWaveWindow } from '../../server/match/waves.js';

const dive = () => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 5, fake: true, variant: 'deepecho' });
const plain = () => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 5, fake: true });

/** n 个来源 × per 只漏怪（用一条真实、非 token、非 BOSS 的怪）。 */
function leaks(m, owners, per) {
  const key = Object.keys(m.gd.raw.enemies).find((k) => {
    const e = m.gd.enemy(k);
    return e && !e.tokenOnly && e.rank !== 'BOSS';
  });
  const out = [];
  for (let o = 0; o < owners; o++) {
    for (let i = 0; i < per; i++) out.push({ enemyKey: key, mods: null, sourcePlayerId: `p_${o}` });
  }
  return out;
}

const lastSpawn = (spawns) => spawns.reduce((mx, s) => Math.max(mx, Number(s.time) || 0), 0);

test('深潜：时限按出怪窗口抬上去，全部敌人都能出场', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 20;
  m.startRound(20);
  // boss 层没有普通波次 → 基础时限只有 60 秒，正是玩家看到「还没出完就结束」的场景
  m.wave = null;
  const leaked = leaks(m, 4, 60);           // 240 只
  const plan = { leaked, helpers: m.alivePlayers(), uniteRound: 1 };
  const need = uniteWaveWindow(m.gd, leaked, plan.helpers.length).last;
  const limit = m.uniteTimeLimit(plan);
  assert.ok(need > 60, `这条用例要有超过 60 秒的出怪窗口（实际 ${need.toFixed(1)}）`);
  assert.ok(limit >= need + 29, `时限要盖住出怪窗口 + 30 秒收尾（need=${need.toFixed(1)} limit=${limit}）`);
  const wave = buildUniteWave(m.gd, leaked, plan.helpers.length, limit, { maxLastSpawn: plan.maxLastSpawn });
  assert.equal(wave.spawns.length, 240, '一只都不能少');
  assert.ok(lastSpawn(wave.spawns) <= limit - 29, `最后一只必须在收尾之前出场（${lastSpawn(wave.spawns).toFixed(1)} / ${limit}）`);
});

test('深潜：漏怪多到超过上限时压缩出怪间隔，而不是继续拉长时限', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 20;
  m.startRound(20);
  m.wave = null;
  const leaked = leaks(m, 4, 300);          // 1200 只：窗口远超上限
  const plan = { leaked, helpers: m.alivePlayers(), uniteRound: 1 };
  const limit = m.uniteTimeLimit(plan);
  assert.equal(limit, 300, '时限封顶 300 游戏秒');
  assert.ok(plan.maxLastSpawn > 0 && plan.maxLastSpawn < 300, '给了压缩目标');
  const wave = buildUniteWave(m.gd, leaked, plan.helpers.length, limit, { maxLastSpawn: plan.maxLastSpawn });
  assert.equal(wave.spawns.length, 1200, '一只都不能少');
  assert.ok(lastSpawn(wave.spawns) <= plan.maxLastSpawn + 0.01,
    `最后一只要压到 ${plan.maxLastSpawn} 之前（实际 ${lastSpawn(wave.spawns).toFixed(1)}）`);
});

test('普通房间不受影响：还是用本回合的作战时限', (t) => {
  const h = plain();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 3;
  m.startRound(3);
  const leaked = leaks(m, 2, 10);
  const plan = { leaked, helpers: m.alivePlayers(), uniteRound: 1 };
  const base = m.wave && m.wave.timeLimit;
  const limit = m.uniteTimeLimit(plan);
  assert.equal(limit, base, '普通房不额外抬时限');
  assert.equal(plan.maxLastSpawn, undefined, '普通房不压缩出怪间隔');
});

test('不传 maxLastSpawn 时排队规则完全不变（普通房的老行为）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const leaked = leaks(m, 2, 12);
  const a = buildUniteWave(m.gd, leaked, 2, 60);
  const b = buildUniteWave(m.gd, leaked, 2, 60, {});
  assert.deepEqual(a.spawns.map((s) => s.time), b.spawns.map((s) => s.time), '两次构建的时间轴一致');
});
