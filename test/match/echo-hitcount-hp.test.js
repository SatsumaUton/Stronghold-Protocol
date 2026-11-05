// 「频次怪」（器物：青铜镜、铁矛头…）的血量必须**等于「需要被打几下」**，不能跟着深潜深度缩放。
//
// 维护者 2026-11-05 实测：25 层以后召唤出来的「铁矛头」血量 6080 / 6080（数据 baseHp = 30，文案
// 「需要30次伤害击倒」）—— 也就是要打 6080 下。原因：这类怪多数是**召唤物**（新硎被击倒时 DeadSpawn
// 出铁矛头），根本不在 `wave.spawns` 里，之前 `_echoTuneHitCount` 只改波次 spawns，碰不到它们。
// 现在改成走 spec flags `enemyHpMulCap`（Match._ruleFlags → sim spawnEnemy 统一封顶）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { echoHitCountEnemy } from '../../server/match/match/echoWaves.js';

const dive = (o = {}) => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true, variant: 'deepecho', ...o });

test('深潜的封顶表覆盖全部「频次怪」，且它们的 baseHp 恰好等于需要的次数', (t) => {
  const h = dive();
  t.after(() => h.m.dispose());
  const caps = h.m._echoHitCountHpCap();
  const keys = [...echoHitCountEnemy(h.m.gd)];
  assert.ok(keys.length >= 10, `数据里至少有 10 个器物，实际 ${keys.length}`);
  for (const k of keys) {
    assert.equal(caps[k], 1, `${k} 的血量倍率必须封顶在 1`);
    const e = h.m.gd.enemy(k);
    assert.ok(e, `${k} 是真实敌人`);
    assert.ok((e.abilities || []).some((a) => a && /^需要\d+次伤害击倒$/.test(String(a.text || '').trim())), `${k} 的文案是「需要 N 次伤害击倒」`);
    assert.equal(e.stats.maxHp, Number((e.abilities || []).map((a) => String(a && a.text || '')).join(' ').match(/需要(\d+)次伤害击倒/)?.[1]),
      `${k} 的 baseHp 必须等于需要的次数（否则封顶 1 就不对）`);
  }
  // 铁矛头（新硎的召唤物，实测出问题的那只）
  assert.equal(caps.enemy_1208_msfji_2, 1);
});

test('spec flags 只在深潜里带 enemyHpMulCap（普通房逐字节不变）', (t) => {
  const h = dive();
  t.after(() => h.m.dispose());
  assert.ok(h.m._ruleFlags().enemyHpMulCap, '深潜的每一份 battle spec 都带封顶表');
  const plain = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true });
  t.after(() => plain.m.dispose());
  assert.equal(plain.m._ruleFlags().enemyHpMulCap, undefined);
});

test('出怪处统一封顶：铁矛头按 202 倍深度缩放发下来也只有 30 血（30 下打死）', () => {
  const caps = { enemy_1208_msfji_2: 1 };
  const deep = makeBattle({ flags: { enemyHpMulCap: caps } }).b;
  const e = deep.spawnEnemy('enemy_1208_msfji_2', { mods: { hpMul: 202.6667 } });
  assert.ok(e, '召唤物能出怪');
  assert.equal(e.base.maxHp, 30, '封顶后血量 = baseHp = 需要被打的次数');
  assert.equal(e.hp, 30);

  // 对照：没有封顶表时就是被缩放后的血量（这正是维护者看到的 6080）
  const open = makeBattle({ flags: {} }).b;
  const e2 = open.spawnEnemy('enemy_1208_msfji_2', { mods: { hpMul: 202.6667 } });
  assert.ok(e2.base.maxHp > 6000, `未封顶时 ${e2.base.maxHp}`);

  // 封顶只对表里的 key 生效：同一份 spec 里的普通敌人照常缩放
  const big = makeBattle({ flags: { enemyHpMulCap: caps } }).b;
  const e3 = big.spawnEnemy('enemy_1207_sfji_2', { mods: { hpMul: 2 } });
  assert.equal(e3.base.maxHp, 14000 * 2, '新硎本体不受影响');
});
