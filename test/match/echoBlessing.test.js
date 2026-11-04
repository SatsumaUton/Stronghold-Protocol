// 「深渊回响」祝福（server/match/match/echoBlessing.js）的单元测试。
//
// 背景：祝福是房间级全局加成，落点是**既有字段**——钱包 `ps.pendingFunds`、玩家单位 mods `batPct`、
// 结算入账倍率。写错一个键名（比如 batPct 写成 atkSpeedPct）buff 就是空转，所以键名要对着
// units.js 的读取列表断言一次。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHO_BLESSINGS, ECHO_BLESSING_EVERY, echoBlessingById, echoBlessingDue, echoBlessingOffer,
  echoBlessingMods, echoBlessingCoinMul, echoBlessingFunds, applyEchoBlessingMods, ECHO_BLESSING_RARITY_WEIGHT,
  echoBlessingIsMoney,
} from '../../server/match/match/echoBlessing.js';

/** units.js 属性重算里真实读取的 mods 键（2026-11-03 从 units.js 提取，与 echoWords.test.js 同源）。 */
const VALID_MOD_KEYS = new Set([
  'hpFlat', 'hpPct', 'atkFlat', 'atkPct', 'atkFinal', 'defFlat', 'defPct', 'resFlat', 'resPct',
  'aspd', 'batPct', 'blockCnt', 'moveFlat', 'moveMul', 'spRecovery',
]);

/** 固定的随机源（可复现）。 */
const seq = (...xs) => {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)];
};

test('祝福池：至少 32 个、id 唯一、name/desc 齐全', () => {
  assert.ok(ECHO_BLESSINGS.length >= 32, '池子至少 32 个');
  const ids = ECHO_BLESSINGS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'id 必须唯一');
  for (const b of ECHO_BLESSINGS) {
    assert.equal(typeof b.name, 'string');
    assert.ok(b.name.length > 0, `${b.id} 缺名字`);
    assert.equal(typeof b.desc, 'string');
    assert.ok(b.desc.length > 0, `${b.id} 缺描述`);
  }
});

test('攻速祝福的 mods 键是 units.js 真会读的键（batPct）', () => {
  const haste = echoBlessingById('haste');
  assert.equal(haste.kind, 'mods');
  for (const k of Object.keys(haste.mods)) {
    assert.ok(VALID_MOD_KEYS.has(k), `mods 键 ${k} 不在 units.js 的读取列表里`);
  }
  // 负的 batPct = 攻击间隔变短 = 攻速变快
  assert.ok(haste.mods.batPct < 0, '攻速加成必须是负的 batPct');
  assert.equal(haste.mods.batPct, -0.1);
});

test('发放节奏：深潜每 5 个回合一次，隐藏通关开局多一次', () => {
  const diveStart = 16;
  assert.equal(echoBlessingDue(16, diveStart, 0), 1, '深潜第 1 回合就给一次（维护者 2026-11-04）');
  assert.equal(echoBlessingDue(19, diveStart, 0), 1, '第 4 个深潜回合仍是 1 次');
  assert.equal(echoBlessingDue(20, diveStart, 0), 1, '第 5 个深潜回合仍是 1 次');
  assert.equal(echoBlessingDue(24, diveStart, 0), 1, '第 9 个深潜回合仍是 1 次');
  assert.equal(echoBlessingDue(25, diveStart, 0), 2, '第 10 个深潜回合 → 2 次');
  // 打过隐藏核心：开局就有一次
  assert.equal(echoBlessingDue(16, diveStart, 1), 2, '隐藏通关：开局那次 + 第 1 层');
  assert.equal(echoBlessingDue(20, diveStart, 1), 2);
});

test('发放上限：三个都拿过就不再发', () => {
  assert.equal(echoBlessingDue(60, 16, 0), 3, '再深也不会超过 3');
  assert.equal(echoBlessingDue(60, 16, 1), 3, '隐藏奖励也不会顶破 3');
  // 深潜之前一律 0
  assert.equal(echoBlessingDue(15, 16, 0), 0);
  assert.equal(echoBlessingDue(1, 16, 0), 0);
});

test('三选一候选：不重复、最多 3 个、已拥有的不再出现', () => {
  const offer = echoBlessingOffer(seq(0.1, 0.9, 0.5), []);
  assert.equal(offer.length, 3);
  assert.equal(new Set(offer.map((b) => b.id)).size, 3, '候选不能重复');

  const after = echoBlessingOffer(seq(0.1, 0.9, 0.5), ['fund']);
  assert.ok(after.every((b) => b.id !== 'fund'), '已拥有的不该再进候选');
  assert.equal(after.length, 3, '池子还够，仍然给满 3 个候选');

  // 2026-11-05：反制祝福（kind === 'counter'）可重复，全拿过时仍会出现在候选里
  const all = echoBlessingOffer(seq(0.1), ECHO_BLESSINGS.map((b) => b.id));
  assert.ok(all.length > 0, '反制祝福总是可以再出现');
  assert.ok(all.every((b) => b.kind === 'counter'), '全拿过时只可能出现反制祝福');
});

test('候选是确定性的：同样的随机序列给同样的结果', () => {
  const a = echoBlessingOffer(seq(0.3, 0.6, 0.9), []).map((b) => b.id);
  const b = echoBlessingOffer(seq(0.3, 0.6, 0.9), []).map((b) => b.id);
  assert.deepEqual(a, b);
});

test('mods 合并：有疾风就是 batPct -0.1，没有就是空对象', () => {
  assert.deepEqual(echoBlessingMods(['haste']), { batPct: -0.1 });
  assert.deepEqual(echoBlessingMods([]), {});
  assert.deepEqual(echoBlessingMods(['fund', 'loot']), {}, '非 mods 类不产生加成');
  assert.deepEqual(echoBlessingMods(['nope']), {}, '未知 id 安全');
  // 同类不叠加：即便列表里重复出现也只算一份
  assert.deepEqual(echoBlessingMods(['haste', 'haste']), { batPct: -0.2 }, '列表重复时按加算处理（由 _echoGrantBlessing 保证不重复入列）');
});

test('资金倍率：现在所有祝福都不再影响金币倍率', () => {
  // 「丰收」2026-11-05 改成「每 3 层 +1 次免费刷新」，不再是 coinMul
  assert.equal(echoBlessingCoinMul(['loot']), 1);
  assert.equal(echoBlessingCoinMul([]), 1);
  assert.equal(echoBlessingCoinMul(['fund', 'haste']), 1);
  assert.equal(echoBlessingCoinMul(['loot', 'loot']), 1);
});

test('一次性资金：只有物资补给给 8（2026-11-05 大削弱，原来 25）', () => {
  assert.equal(echoBlessingFunds(echoBlessingById('fund')), 8);
  assert.equal(echoBlessingFunds(echoBlessingById('haste')), 0);
  assert.equal(echoBlessingFunds(echoBlessingById('loot')), 0);
  assert.equal(echoBlessingFunds(null), 0);
});

test('祝福 mods 注入幂等：同一单位不重复挂', () => {
  const added = [];
  const battle = { addBuff: (u, b) => { added.push(b); (u.buffs ||= []).push(b); } };
  const unit = { side: 'ally', buffs: [] };
  assert.equal(applyEchoBlessingMods(battle, unit, { batPct: -0.1 }), true);
  assert.equal(applyEchoBlessingMods(battle, unit, { batPct: -0.1 }), false, '第二次不该再挂');
  assert.equal(added.length, 1);
  assert.equal(added[0].key, 'echo:bl:mods');
  assert.deepEqual(added[0].mods, { batPct: -0.1 });
});

test('没有 addBuff 或单位为空时安全返回', () => {
  assert.equal(applyEchoBlessingMods(null, { buffs: [] }, { batPct: -0.1 }), false);
  assert.equal(applyEchoBlessingMods({}, { buffs: [] }, { batPct: -0.1 }), false);
  assert.equal(applyEchoBlessingMods({ addBuff() {} }, null, { batPct: -0.1 }), false);
  assert.equal(applyEchoBlessingMods({ addBuff() {} }, { buffs: [] }, {}), false, '空 mods 不挂');
});

test('每 5 回合一次的常量与节奏自洽', () => {
  assert.equal(ECHO_BLESSING_EVERY, 5);
  const diveStart = 15;
  const due = [];
  for (let r = diveStart; r <= diveStart + 14; r++) due.push(echoBlessingDue(r, diveStart, 0));
  assert.deepEqual(due.slice(0, 5), [1, 1, 1, 1, 1], '第 1 层就给，1-5 层都只有 1 次');
  assert.deepEqual(due.slice(5, 10), [1, 1, 1, 1, 2], '第 10 层第二次');
});

// ---- 稀有度（维护者 2026-11-05）--------------------------------------------------------------
test('每条祝福都有合法稀有度，且三档都有人', () => {
  const ok = new Set(['common', 'rare', 'epic']);
  const seen = new Set();
  for (const b of ECHO_BLESSINGS) {
    assert.ok(ok.has(b.rarity), `${b.id} 的稀有度 ${b.rarity} 非法`);
    seen.add(b.rarity);
  }
  assert.deepEqual([...seen].sort(), ['common', 'epic', 'rare'], '三档都要有实际词条');
});

test('三选一按稀有度加权：传说明显少于普通，但三个槽不重复、不出现已拥有的', () => {
  let s = 20261105;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const counts = { common: 0, rare: 0, epic: 0 };
  for (let i = 0; i < 300; i++) {
    const offer = echoBlessingOffer(rng, []);
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer.map((b) => b.id)).size, 3, '三个槽不能重复');
    for (const b of offer) counts[b.rarity] += 1;
  }
  assert.ok(counts.common > counts.rare, `普通(${counts.common}) 应多于稀有(${counts.rare})`);
  assert.ok(counts.rare > counts.epic, `稀有(${counts.rare}) 应多于传说(${counts.epic})`);
  assert.ok(counts.epic > 0, '传说不是永远抽不到');
});

test('已拥有的祝福不会再出现在候选里', () => {
  // 反制祝福（counter，一次性、不占名额）本来就允许重复出现，不能拿它们当「已拥有」样本
  const owned = ECHO_BLESSINGS.filter((b) => b.rarity === 'epic' && b.kind !== 'counter').map((b) => b.id);
  let s = 7;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 50; i++) {
    const offer = echoBlessingOffer(rng, owned);
    for (const b of offer) assert.ok(!owned.includes(b.id), `${b.id} 已拥有却仍被抽出`);
  }
});
test('每档稀有度都有抽取权重，且普通 > 稀有 > 传说（出现概率按稀有度递减）', () => {
  for (const b of ECHO_BLESSINGS) {
    assert.ok(ECHO_BLESSING_RARITY_WEIGHT[b.rarity] > 0, `${b.id} 的稀有度 ${b.rarity} 没有抽取权重`);
  }
  assert.ok(ECHO_BLESSING_RARITY_WEIGHT.common > ECHO_BLESSING_RARITY_WEIGHT.rare);
  assert.ok(ECHO_BLESSING_RARITY_WEIGHT.rare > ECHO_BLESSING_RARITY_WEIGHT.epic);

  // 实测：同一随机序列下，普通出现的次数应明显多于传说
  let s = 99;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const hits = { common: 0, rare: 0, epic: 0 };
  for (let i = 0; i < 400; i++) for (const b of echoBlessingOffer(rng, [])) hits[b.rarity] += 1;
  assert.ok(hits.common > hits.rare, `普通(${hits.common}) 应多于稀有(${hits.rare})`);
  assert.ok(hits.rare > hits.epic, `稀有(${hits.rare}) 应多于传说(${hits.epic})`);
  assert.ok(hits.epic > 0, '传说不是抽不到');
});
// 维护者 2026-11-05 反馈「资金类祝福还是太多」：降权重（fund/gold_s 4→2、fund_s 4→1、bigfund/gold_m 2→1）
// 并且**一轮三选一里最多 1 个资金类**。这里把两条都钉住，免得以后调池子又飘回去。
test('资金类祝福：一轮最多 1 个，整体出现比例低于 15%', () => {
  let s = 4242;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  let offers = 0;
  let withMoney = 0;
  for (let i = 0; i < 2000; i++) {
    const offer = echoBlessingOffer(rng, []);
    if (offer.length < 3) continue;
    offers += 1;
    const n = offer.filter((b) => echoBlessingIsMoney(b)).length;
    assert.ok(n <= 1, `一轮里出现了 ${n} 个资金类祝福：${offer.map((b) => b.id).join('、')}`);
    if (n === 1) withMoney += 1;
  }
  assert.ok(offers > 1900, `样本不足：${offers}`);
  const pct = withMoney / offers;
  assert.ok(pct < 0.15, `含资金类的比例 ${(pct * 100).toFixed(1)}% 仍然偏高`);
});

// 维护者 2026-11-05 反馈「延伸范围的祝福没有真正延伸」：这里用真实 sim 战斗验一遍。
test('祝福「远程」：单位的攻击范围真的多一格（不是只有文案）', async () => {
  const { makeBattle } = await import('../helpers/battleHarness.js');
  const { applyEchoBlessingMods } = await import('../../server/match/match/echoBlessing.js');
  const h = makeBattle({ units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 5 }], enemies: [] });
  const u = h.unit('chess_char_1_01_a');
  h.step(0.5);
  const before = u.rangeKeys.length;
  assert.ok(before > 0, '基准范围要读到');
  const mods = echoBlessingMods(['rng']);
  assert.equal(mods.rangeExtend, 1, '远程祝福的 mods 是 rangeExtend: 1');
  applyEchoBlessingMods(h.b, u, mods);
  h.step(0.5);
  assert.ok(u.rangeKeys.length > before, `范围应扩展（${before} → ${u.rangeKeys.length}）`);
  assert.equal(u.s.rangeExtend, 1, '面板上的 rangeExtend 也是 1');
  h.b.dispose?.();
});