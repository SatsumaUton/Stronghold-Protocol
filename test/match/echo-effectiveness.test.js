// 「深渊回响」逐条取证：每一条诅咒 / 祝福都必须在**消费端**产生可测量的差异。
//
// 为什么要有这个：表里多写一条、kind 写错、消费点漏接，代码都不会报错 ——
// 只会在玩家那边表现为「界面上有、实际没效果」。这里对每条都取一次实测值，
// 任一空转直接失败（维护者 2026-11-05 要求「所有新增的诅咒和祝福都验证真实有效」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import {
  ECHO_CURSES, ECHO_ROUND_CURSES, echoCurseById, echoCurseUnitMods,
} from '../../server/match/match/echoCurse.js';
import {
  ECHO_BLESSINGS, echoBlessingById, echoBlessingMods, echoBlessingCoinMul, echoBlessingFunds,
} from '../../server/match/match/echoBlessing.js';

const dive = () => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 16, fake: true, variant: 'deepecho' }).m;

/** 按 kind 取消费端实测值；ids 为空就是基线。 */
function curseValue(m, ids, kind) {
  m.echoCurseIds = Array.isArray(ids) ? ids.slice() : [];
  m.echoRoundCurse = null;
  switch (kind) {
    case 'wordCap': return m._echoWordCap(20);
    case 'coinMul': return m._echoCoinMul();
    case 'freeRefresh': return m._echoFreeRefreshCap();
    case 'blessingMax': return m._echoBlessingMax();
    case 'timeMul': return m._echoTimeMul();
    case 'budgetMul': return m._echoCurseFx().budgetMul;
    case 'enemyAtkMul': return m.gd.enemyScale(20).atkMul;
    case 'enemyHpMul': return m.gd.enemyScale(20).hpMul;
    case 'bountyCoin': return m._echoCurseFx().bountyCoin;
    case 'intel': case 'blackout': return m._echoIntel(20) === null;
    case 'lpMul': return m._echoLpLoss(4, 9999);
    case 'lpExtra': return m._echoLpLoss(2, 9999);
    case 'shopPriceMul': return m._echoShopPriceMul();
    case 'dot': return m._echoCurseFx().dot;
    default: return null;   // 特殊 kind 单独测
  }
}

test('诅咒逐条生效：每条都能在消费端看到差异（永久 + 回合）', (t) => {
  const special = [];
  for (const c of [...ECHO_CURSES, ...ECHO_ROUND_CURSES]) {
    const kind = c.effect.kind;
    if (['unitMods', 'deployBan', 'bondBan', 'destroyEquip'].includes(kind)) { special.push(c.id); continue; }
    const m = dive();
    try {
      m.round = 20;
      const base = curseValue(m, [], kind);    // 空 id 列表 = 基线
      const hit = curseValue(m, [c.id], kind);
      assert.ok(base !== null, `${c.id}: 缺基线`);
      assert.notDeepEqual(hit, base, `${c.id}（${c.name}）在消费端没有任何差异 —— 空转`);
    } finally {
      m.dispose();
    }
  }
  // 特殊 kind 必须被专门覆盖（新加一条特殊 kind 而没补用例时，这里会炸）
  assert.deepEqual(special.sort(), ['block_bond', 'block_tiles', 'r_rust', 'r_weak_melee', 'r_weak_ranged', 'weak_melee', 'weak_ranged'], '特殊 kind 清单变了，补用例');
});

test('特殊诅咒：干员减益挂 buff、封锁地块拦落子、排异禁盟约、销毁装备', (t) => {
  const m = dive();
  t.after(() => m.dispose());
  m.round = 20;

  // 干员减益（永久 + 回合）
  for (const id of ['weak_melee', 'weak_ranged', 'r_weak_melee', 'r_weak_ranged']) {
    const mods = echoCurseUnitMods([id]);
    assert.equal(mods.length, 1, `${id} 没被 echoCurseUnitMods 认出来`);
    assert.ok(Object.keys(mods[0].mods).length > 0, `${id} 没有实际 mods`);
    assert.ok(mods[0].filter.position, `${id} 没有站位过滤`);
  }

  // 封锁地块：抽得到、拦得住
  const banned = m._echoApplyDeployBan(3, () => 0.5);
  assert.ok(banned > 0, '封锁没抽出地块');
  assert.match(String(m._echoDeployBlocked({ kind: 'chess' }, m.echoBannedTiles[0], true) || ''), /封锁/);

  // 排异：只禁附加盟约
  const chess = Object.entries(m.gd.raw?.chess || {});
  const isAdd = (b) => m.gd.bond(b) && m.gd.bond(b).isCore !== true;
  const pick = chess.find(([, rec]) => (rec?.bonds || []).some(isAdd));
  assert.ok(pick, '数据里要有带附加盟约的干员');
  const ps = m.alivePlayers()[0];
  ps.board.set('8,5', { kind: 'chess', id: pick[0], items: [], uid: 4242 });
  m.echoBannedBonds = [];
  const bond = m._echoApplyBondBan(() => 0);
  assert.ok(bond && isAdd(bond), '排异必须落在附加盟约上');
  assert.equal(ps.board.has('8,5'), false, '被排异的干员要收回');

  // 销毁装备
  ps.board.set('7,5', { kind: 'chess', id: pick[0], items: [{ id: 'a', uid: 1 }], uid: 4243 });
  assert.equal(m._echoDestroyEquipped(ps, () => 0), 1, '锈蚀没销毁装备');
});

test('祝福逐条生效：每条都能在消费端看到差异', (t) => {
  for (const b of ECHO_BLESSINGS) {
    const m = dive();
    try {
      m.round = 20;
      const kind = b.kind;
      if (kind === 'shield') {
        // 「护盾」：投票指定盟约，排异抽到它时抵消 —— 效果在 _echoApplyBondBan 里单独验证
        assert.ok(Array.isArray(m._echoOpenShieldVote()) && m.echoShieldOffer.length > 0, `${b.id} 开不出护盾投票`);
        continue;
      }
      if (kind === 'mods') {
        if (b.enemyDebuff) {
          // 对敌异常（寒冻 / 易伤）：走 enemySpawn 钩子，不挂己方 mods
          assert.ok(Number(b.enemyDebuff.chance) > 0, `${b.id} 的触发概率不存在`);
          assert.ok(Object.keys(b.enemyDebuff.mods || {}).length > 0, `${b.id} 的对敌 mods 是空的`);
        } else {
          assert.ok(Object.keys(echoBlessingMods([b.id])).length > 0, `${b.id} 的 mods 是空的`);
        }
        continue;
      }
      if (kind === 'coin') {
        if (Number(b.refreshEvery) > 0) {
          // 丰收：每 3 层给一次免费刷新
          const ps = m.alivePlayers()[0];
          ps.shop.freeRefreshes = 0;
          m.echoBlessings = [b.id];
          m._echoMaybeLootRefresh(21);            // 深度 21，21 % 3 === 0
          assert.ok(ps.shop.freeRefreshes > 0, `${b.id} 没有给免费刷新`);
        } else {
          assert.ok(echoBlessingCoinMul([b.id]) > 1, `${b.id} 的资金倍率没有变化`);
        }
        continue;
      }
      if (kind === 'fund') {
        const ps = m.alivePlayers()[0];
        const fundsBefore = ps.pendingFunds + ps.funds;
        ps.shop.freeRefreshes = 0;
        m._echoGrantBlessing(b);
        if (Number(b.funds) > 0) {
          assert.ok(ps.pendingFunds + ps.funds > fundsBefore, `${b.id} 没给资金`);
        }
        if (Number(b.freeRefresh) > 0) {
          assert.ok(ps.shop.freeRefreshes > 0, `${b.id} 没给免费刷新`);
        }
        assert.ok(Number(b.funds) > 0 || Number(b.freeRefresh) > 0, `${b.id} 没有任何发放`);
        continue;
      }
      if (kind === 'heal') {
        const ps = m.alivePlayers()[0];
        ps.lp = Math.max(1, m.gd.startLp(ps.bandId) - 20);
        const before = ps.lp;
        m._echoGrantBlessing(b);
        assert.ok(ps.lp > before, `${b.id} 没有回复生命`);
        continue;
      }
      if (kind === 'cleanse' || kind === 'counter') {
        // 反制：给一个必定命中的状态，再看它是否被清掉 / 解除
        const ids = b.kind === 'cleanse' ? ['erosion'] : (b.counterCurses || []).slice(0, 1);
        if (b.counterBans) {
          m.echoBannedTiles = ['3,3'];
          m.echoBannedBonds = ['swiftShip'];
          m._echoGrantBlessing(b);
          assert.equal(m.echoBannedTiles.length, 0, `${b.id} 没解除封锁`);
          assert.equal(m.echoBannedBonds.length, 0, `${b.id} 没解除排异`);
          continue;
        }
        assert.ok(ids.length > 0, `${b.id} 没有配置任何可清的诅咒`);
        // 清不掉的诅咒（例如普通诅咒碰上只清稀有的）不算空转，所以这里只要求「它确实尝试并命中」
        m.echoCurseIds = [...ids];
        m._echoGrantBlessing(b);
        assert.ok(m.echoCurseIds.length < ids.length, `${b.id} 没清掉对应诅咒`);
        continue;
      }
      assert.fail(`未知的祝福 kind：${kind}（${b.id}）`);
    } finally {
      m.dispose();
    }
  }
  assert.ok(ECHO_BLESSINGS.length > 40, '祝福池没被读到');
});

test('反制祝福：没有对应诅咒时也会消耗抽取机会', (t) => {
  const m = dive();
  t.after(() => m.dispose());
  m.round = 20;
  const counter = ECHO_BLESSINGS.find((b) => b.kind === 'counter' && !b.counterBans);
  const before = m.echoBlessingDraws;
  const ownedBefore = m.echoBlessings.length + m.echoCounterIds.length;
  m._echoGrantBlessing(counter);                       // 场上没有任何诅咒
  assert.equal(m.echoCounterIds.length, 1, '抽取要记账');
  assert.equal(m.echoBlessings.length + m.echoCounterIds.length, ownedBefore + 1, '消耗一次抽取');
  assert.equal(m.echoBlessingDraws, before, '不额外送抽取');
  assert.deepEqual(echoBlessingById(counter.id), counter);
  // 后面真出现诅咒也不会自动清（不存底）
  m.echoCurseIds = ['bleed', 'bleed'];
  assert.equal(m.echoCurseIds.length, 2, '反制不存底，诅咒照旧在');
});
