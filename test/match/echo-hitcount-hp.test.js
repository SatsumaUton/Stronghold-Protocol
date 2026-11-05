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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { echoHitCountEnemy, echoHitCountHp, ECHO_HITCOUNT_HP_MIN, ECHO_HITCOUNT_HP_MAX } from '../../server/match/match/echoWaves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dive = (o = {}) => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true, variant: 'deepecho', ...o });

test('血量曲线：1–15 层不覆盖（原版血量），16 层 500 下起每层 +40，第 54 层封顶 2000', () => {
  assert.equal(ECHO_HITCOUNT_HP_MIN, 500);
  assert.equal(ECHO_HITCOUNT_HP_MAX, 2000);
  for (const d of [1, 5, 10, 14, 15]) assert.equal(echoHitCountHp(d), null, `第 ${d} 层用原版血量`);
  assert.equal(echoHitCountHp(16), 500);
  assert.equal(echoHitCountHp(17), 540);
  assert.equal(echoHitCountHp(25), 860);
  assert.equal(echoHitCountHp(35), 1260);
  assert.equal(echoHitCountHp(53), 1980);
  assert.equal(echoHitCountHp(54), 2000);
  assert.equal(echoHitCountHp(60), 2000, '封顶 2000');
  assert.equal(echoHitCountHp(0), null);
  assert.equal(echoHitCountHp(undefined), null);
  // 16 层起单调不减，且始终在 500–2000 之间
  let prev = 0;
  for (let d = 16; d <= 70; d++) {
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
  // 第 1–15 层：原版血量（baseHp 就是需要的次数，不跟深度缩放）
  for (const d of [1, 10, 15]) {
    m.round = d;
    const map = m._echoHitCountHp();
    assert.equal(Object.keys(map).length, keys.length, `第 ${d} 层也要覆盖（否则会被深度倍率放大）`);
    for (const k of keys) {
      const base = Math.floor(Number(m.gd.enemy(k)?.stats?.maxHp) || 0);
      assert.equal(map[k], base, `${k} 第 ${d} 层应保持原版 ${base} 下`);
    }
    assert.equal(map.enemy_1208_msfji_2, 30, '铁矛头原版 30 下');
    assert.equal(map.enemy_1210_msfden_2, 45, '铁灯盘原版 45 下');
    assert.equal(map.enemy_1204_msfhu, 4, '青瓷茶器原版 4 下');
  }
  // 第 16 层起：500 → 每层 +40
  m.round = 16;
  const from16 = m._echoHitCountHp();
  for (const k of keys) assert.equal(from16[k], 500, `${k} 第 16 层 500 下`);
  // 第 25 层：860
  m.round = 25;
  const deep = m._echoHitCountHp();
  for (const k of keys) assert.equal(deep[k], 860, `${k} 第 25 层 860 下`);
  // 铁矛头（新硎的召唤物，两版问题都是它）
  assert.equal(deep.enemy_1208_msfji_2, 860);
});

test('spec flags：普通房没有这个键；深潜每层都带（1–15 层是原版血量）', (t) => {
  const h = dive();
  t.after(() => h.m.dispose());
  // 1–15 层：带表，但值是原版血量（不覆盖就会被深度倍率放大成 13260）
  h.m.round = 10;
  const early = h.m._ruleFlags().enemyHpAbs;
  assert.ok(early, '第 10 层也要带表（值 = 原版血量）');
  assert.equal(early.enemy_1208_msfji_2, 30, '第 10 层铁矛头 30 下');
  // 16 层起：带深度曲线
  h.m.round = 16;
  const flags = h.m._ruleFlags();
  assert.ok(flags.enemyHpAbs && Object.keys(flags.enemyHpAbs).length > 0, '第 16 层起每份 spec 都带绝对血量表');
  assert.equal(flags.enemyHpAbs.enemy_1208_msfji_2, 500);
  assert.equal(flags.enemyHpMulCap, undefined, '旧的倍率封顶表已经不再使用');
  const plain = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true });
  t.after(() => plain.m.dispose());
  assert.equal(plain.m._ruleFlags().enemyHpAbs, undefined, '普通房间完全没有这个键');
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
  m.round = 25;                       // 第 25 层 → 860 下
  const flags = m._ruleFlags();
  const bh = makeBattle({ flags, enemies: [{ key: 'enemy_1208_msfji_2', mods: { hpMul: 202.6667, speedMul: 0 } }], content: 'full', autoFinish: false });
  bh.step(1);
  const e = (bh.b.enemies || [])[0];
  assert.ok(e, '铁矛头要出场');
  assert.equal(e.base.maxHp, 860, '血量 = 第 25 层的 860 下');
  assert.equal(e.hp, 860);
  // 频次怪的判定靠 hitCount 标记（每次伤害只扣 1），数据里 12 条器物都该带上
  const flagged = (e.buffs || []).some((b) => b && b.flags && (b.flags.hitCount || b.flags.hitCountArts));
  assert.ok(flagged, '铁矛头必须带 hitCount 标记（否则会按普通血量结算）');
  bh.b.dispose?.();
});

test('检出集合 == sim 里 kitTimes 的那 14 条（茶器的「法术或真实伤害」文案也要认）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  // sim 的 times.js 是「频次怪」的权威名单：每一条都用 kitTimes() 装上 hitCount
  const src = readFileSync(path.join(ROOT, 'server/sim/content/enemies/times.js'), 'utf8');
  const keys = [...src.matchAll(/(enemy_\w+):\s*kitTimes\(/g)].map((mm) => mm[1]);
  assert.ok(keys.length >= 14, `times.js 里应有 14 条，实际 ${keys.length}`);
  const set = echoHitCountEnemy(m.gd);
  assert.equal(set.size, keys.length, `检出的条数要和 times.js 一致（实际 ${set.size}）`);
  for (const k of keys) assert.ok(set.has(k), `${k} 必须被识别为频次怪`);
  // 青瓷茶器 / 彩瓷茶器：文案是「需要 N 次法术或真实伤害击倒」（hitCountArts），
  // 之前只认「需要 N 次伤害击倒」把它们漏掉了 → 血量跟着深度缩放成 13267（维护者 2026-11-05 实测）
  for (const k of ['enemy_1204_msfhu', 'enemy_1204_msfhu_2']) assert.ok(set.has(k), `${k} 是频次怪`);
});

test('茶器也被绝对血量覆盖：第 25 层青瓷茶器就是 860 血（不再 13267）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 25;
  const flags = m._ruleFlags();
  assert.ok(flags.enemyHpAbs && flags.enemyHpAbs.enemy_1204_msfhu === 860, '覆盖表要含茶器');
  const bh = makeBattle({ flags, enemies: [{ key: 'enemy_1204_msfhu', mods: { hpMul: 442, speedMul: 0 } }], content: 'full', autoFinish: false });
  bh.step(1);
  const e = (bh.b.enemies || [])[0];
  assert.ok(e, '青瓷茶器要出场');
  assert.equal(e.base.maxHp, 860, '血量 = 第 25 层的 860，而不是被深度缩放成上万');
  bh.b.dispose?.();
});
