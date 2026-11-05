// 「深层强化」（维护者 2026-11-05）：前期拿的祝福到 16 层以后基本没感觉，
// 所以 16 层起数值型祝福按 ×2.5 放大（计数类不放大），资金 / 金币同样放大。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  echoBlessingMods, echoBlessingScaledMods, echoBlessingLateMul, echoBlessingById,
  echoBlessingFunds, echoBlessingCoinMul, ECHO_BLESSING_LATE_FROM, ECHO_BLESSING_LATE_MUL,
} from '../../server/match/match/echoBlessing.js';

test('倍率：15 层及以前是 1，16 层起是 ECHO_BLESSING_LATE_MUL', () => {
  assert.equal(echoBlessingLateMul(15), 1);
  assert.equal(echoBlessingLateMul(16), ECHO_BLESSING_LATE_MUL);
  assert.equal(echoBlessingLateMul(60), ECHO_BLESSING_LATE_MUL);
  assert.equal(ECHO_BLESSING_LATE_FROM, 16);
});

test('数值型祝福放大的是「增量」：锐刃 1.06 → 1.15（×2.5）', () => {
  const base = echoBlessingMods(['atk_s'], 10);
  const late = echoBlessingMods(['atk_s'], 20);
  assert.ok(Math.abs(base.atkMul - 1.06) < 1e-9, `15 层前 ${base.atkMul}`);
  assert.ok(Math.abs(late.atkMul - (1 + 0.06 * 2.5)) < 1e-9, `16 层后 ${late.atkMul}`);
  // 平坦类直接乘
  const def = echoBlessingMods(['def_s'], 20);
  assert.equal(def.defFlat, 60 * 2.5);
  // 攻速（负数）也放大
  const spd = echoBlessingMods(['spd_s'], 20);
  assert.ok(Math.abs(spd.batPct - (-0.06 * 2.5)) < 1e-9);
});

test('计数类不放大：格挡 / 射程 / 目标数保持原值', () => {
  const block = echoBlessingById('block');
  assert.ok(block && block.mods && Number.isFinite(block.mods.blockCnt), '要找到带 blockCnt 的祝福');
  const late = echoBlessingScaledMods(block, 2.5);
  assert.equal(late.blockCnt, block.mods.blockCnt, '格挡数不能被放大');
});

test('资金与金币倍率同样放大', () => {
  const fund = echoBlessingById('fund');
  assert.ok(fund && fund.funds > 0);
  assert.equal(echoBlessingFunds(fund, 10), Math.trunc(fund.funds));
  assert.equal(echoBlessingFunds(fund, 20), Math.trunc(fund.funds * 2.5));
  // 金币类：丰收(loot) 没有 coinMul，用 余利(gold_s) 测
  const gold = echoBlessingById('gold_s');
  assert.ok(gold && gold.coinMul > 1, '要找到带 coinMul 的祝福');
  assert.equal(echoBlessingCoinMul(['gold_s'], 10), gold.coinMul);
  assert.ok(Math.abs(echoBlessingCoinMul(['gold_s'], 20) - (1 + (gold.coinMul - 1) * 2.5)) < 1e-9);
});

test('下发：16 层起 lateMul 出现在 m.public.echo 与祝福条目上', async (t) => {
  const { makeMatch } = await import('./harness.js');
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 3, fake: true, variant: 'deepecho' });
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['atk_s'];
  m.round = 10;
  let pub = m.publicView().echo;
  assert.equal(pub.blessingLateMul, 1);
  assert.equal(pub.blessings[0].lateMul, undefined, '15 层前不标倍率');
  m.round = 20;
  pub = m.publicView().echo;
  assert.equal(pub.blessingLateMul, 2.5);
  assert.equal(pub.blessings[0].lateMul, 2.5, '16 层后要标出来');
});
