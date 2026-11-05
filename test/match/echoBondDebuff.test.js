// 主题转化祝福（维护者 2026-11-05「按这个做」）：把**附加盟约**的主题变成对敌压制。
//
// 规则：
//   · 11 条（奥术 / 坚守 / 精准 / 灵巧 / 迅捷 / 助力 / 协防 / 奇迹 / 调和 / 突袭 / 绝技），
//     跳过 远见 / 投资人 / 不屈 / 独行（它们的效果是钱 / 招募 / 复活 / 独狼，转成对敌减益
//     会变成另一条机制）。
//   · 只有**队伍真的激活了那条盟约**才会进三选一 —— 否则抽到就是死牌。
//   · 生效窗口 = 每回合**开局前 N 秒**，N 按稀有度分档（普通 10 / 稀有 15 / 传说 20）。
//   · 实现只用 sim 已有的异常状态 + dealDamage（反伤），server/sim 不改，golden 不动。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import {
  ECHO_BLESSINGS, echoBlessingById, echoBlessingOffer, echoBondDebuffSeconds, ECHO_BOND_DEBUFF_SECONDS,
} from '../../server/match/match/echoBlessing.js';

const dive = () => makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 41, fake: true, variant: 'deepecho' });

/** 11 条主题转化：盟约 id → 祝福 id。 */
const PAIRS = {
  arcaneShip: 'bd_arcane',
  steadShip: 'bd_stead',
  preciShip: 'bd_preci',
  skillfulShip: 'bd_skillful',
  swiftShip: 'bd_swift',
  deputShip: 'bd_deput',
  emptyShip: 'bd_empty',
  miraShip: 'bd_mira',
  maniShip: 'bd_mani',
  raidShip: 'bd_raid',
  suntShip: 'bd_sunt',
};

/** 假战斗：只记 on / applyStatus / dealDamage，用来精确检查窗口与时长。 */
function fakeBattle() {
  const handlers = new Map();
  const b = {
    time: 0,
    enemies: [],
    statuses: [],
    damage: [],
    applyStatus(e, key, opts) {
      this.statuses.push({ target: e, key, ...opts });
      return true;
    },
    dealDamage(src, tgt, opts) {
      this.damage.push({ src, tgt, ...opts });
    },
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
    },
    emit(name, ctx) {
      for (const fn of handlers.get(name) || []) fn(ctx);
    },
  };
  return b;
}

test('11 条主题转化都在祝福池里，且都带盟约门槛', () => {
  const gated = ECHO_BLESSINGS.filter((b) => b.bondGate);
  assert.equal(gated.length, Object.keys(PAIRS).length, '一条盟约一条转化');
  for (const [bondId, id] of Object.entries(PAIRS)) {
    const b = echoBlessingById(id);
    assert.ok(b, `${id} 要存在`);
    assert.equal(b.bondGate, bondId, `${id} 的门槛是 ${bondId}`);
    assert.equal(b.kind, 'bonddebuff');
    assert.ok(b.name && b.desc, `${id} 要有名字与说明`);
    // 描述里的秒数必须和稀有度分档一致（改稀有度忘了改文案会被这条钉住）
    const secs = echoBondDebuffSeconds(b.rarity);
    assert.match(b.desc, new RegExp(`每回合前 ${secs} 秒`), `${id} 的文案要写对秒数`);
    assert.match(b.desc, new RegExp(`队伍激活【${b.bondLabel}】时`), `${id} 的文案要写出门槛盟约`);
  }
});

test('时长按稀有度分档：普通 10 / 稀有 15 / 传说 20', () => {
  assert.deepEqual({ ...ECHO_BOND_DEBUFF_SECONDS }, { common: 10, rare: 15, epic: 20 });
  assert.equal(echoBondDebuffSeconds('common'), 10);
  assert.equal(echoBondDebuffSeconds('rare'), 15);
  assert.equal(echoBondDebuffSeconds('epic'), 20);
  assert.equal(echoBondDebuffSeconds('nope'), 15, '没登记按稀有算');
});

test('三选一：没激活那条盟约就抽不到，激活了才进池子', () => {
  // rng 扫一遍，把三个候选都收下来（每个 rng 值都会给出不同的三张）
  const seen = (bonds) => {
    const out = new Set();
    for (let i = 0; i < 400; i++) {
      const rng = () => (i % 400) / 400;
      for (const b of echoBlessingOffer(rng, [], { bonds })) out.add(b.id);
    }
    return out;
  };
  const none = seen(new Set());
  assert.equal(none.has('bd_preci'), false, '没盟约时一条转化都不发');
  assert.equal([...none].some((id) => id.startsWith('bd_')), false);
  const withPreci = seen(new Set(['preciShip']));
  assert.equal(withPreci.has('bd_preci'), true, '激活【精准】后「洞穿」要能抽到');
  assert.equal(withPreci.has('bd_mani'), false, '没激活【调和】就抽不到「调律」');
});

test('_echoTeamBonds：只算还活着的玩家的激活盟约', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  h.ps('p_0').bonds = {
    preciShip: { count: 3, active: true, tier: 1, layers: 3 },
    maniShip: { count: 1, active: false, tier: 0, layers: 0 },
  };
  const team = m._echoTeamBonds();
  assert.equal(team.has('preciShip'), true);
  assert.equal(team.has('maniShip'), false, '没激活的不算');
  h.ps('p_0').alive = false;
  assert.equal(m._echoTeamBonds().size, 0, '淘汰的玩家不再提供门槛');
});

test('战斗：开局给全场敌人挂上状态，窗口内出场的敌人只吃到剩余时长', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  h.ps('p_0').bonds = { preciShip: { count: 3, active: true, tier: 1, layers: 3 } };
  m.echoBlessings = ['bd_preci'];
  const b = fakeBattle();
  const early = { alive: true, side: 'enemy' };
  b.enemies = [early];
  m._echoHookBattle(b);
  const secs = echoBondDebuffSeconds(echoBlessingById('bd_preci').rarity);
  // 开局那一刻：场上已有的敌人拿到完整时长
  assert.equal(b.statuses.length, 1);
  assert.equal(b.statuses[0].key, 'defDown');
  assert.equal(b.statuses[0].duration, secs);
  assert.equal(b.statuses[0].target, early);
  // 窗口内出场：只剩剩余时长
  b.time = secs - 4;
  const late = { alive: true, side: 'enemy' };
  b.emit('enemySpawn', { enemy: late });
  const last = b.statuses[b.statuses.length - 1];
  assert.equal(last.target, late);
  assert.equal(last.duration, 4);
  // 窗口结束之后出场的：不挂
  b.time = secs + 1;
  const after = { alive: true, side: 'enemy' };
  b.emit('enemySpawn', { enemy: after });
  assert.equal(b.statuses.some((s) => s.target === after), false, '窗口过后不再挂');
});

test('战斗：那条盟约没激活就不生效（描述写的是「队伍激活时」）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  h.ps('p_0').bonds = { maniShip: { count: 3, active: true, tier: 1, layers: 3 } };
  m.echoBlessings = ['bd_preci'];
  const b = fakeBattle();
  b.enemies = [{ alive: true, side: 'enemy' }];
  m._echoHookBattle(b);
  assert.equal(b.statuses.length, 0, '【精准】没激活 → 洞穿不生效');
});

test('反震（坚守）：窗口内敌人打己方会吃到 30% 真实反伤，窗口外没有', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  h.ps('p_0').bonds = { steadShip: { count: 3, active: true, tier: 1, layers: 3 } };
  m.echoBlessings = ['bd_stead'];
  const b = fakeBattle();
  m._echoHookBattle(b);
  const enemy = { alive: true, side: 'enemy' };
  const ally = { alive: true, side: 'ally' };
  b.emit('damaged', { source: enemy, target: ally, amount: 100, type: 'phys' });
  assert.equal(b.damage.length, 1, '要吃一次反伤');
  assert.equal(b.damage[0].tgt, enemy);
  assert.equal(b.damage[0].amount, 30);
  assert.equal(b.damage[0].type, 'true');
  // 反伤自身（source = null）不会再反弹，不会递归
  b.emit('damaged', { source: null, target: enemy, amount: 30, type: 'true' });
  assert.equal(b.damage.length, 1, '反伤不递归');
  // 窗口结束
  b.time = echoBondDebuffSeconds(echoBlessingById('bd_stead').rarity) + 1;
  b.emit('damaged', { source: enemy, target: ally, amount: 100, type: 'phys' });
  assert.equal(b.damage.length, 1, '窗口过后不再反伤');
});

test('真战斗里也用得上：洞穿让敌人的防御真的降下来', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  h.ps('p_0').bonds = { preciShip: { count: 3, active: true, tier: 1, layers: 3 } };
  m.echoBlessings = ['bd_preci'];
  const bh = makeBattle({
    enemies: [{ key: 'enemy_1007_shield', mods: { hpMul: 500, speedMul: 0 } }],
    content: 'none', autoFinish: false,
  });
  const b = bh.b;
  m._echoHookBattle(b);
  bh.step(1);
  const e = (b.enemies || [])[0];
  assert.ok(e, '敌人要出场');
  const buffs = (e.buffs || []).map((x) => x.key).join(',');
  assert.match(buffs, /defDown/, `敌人身上要有 defDown（实际：${buffs}）`);
});
