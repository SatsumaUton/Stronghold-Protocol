// 主题转化祝福（维护者 2026-11-05）：把**附加盟约**的主题变成对敌压制。
//
// 规则：
//   · 11 条（奥术 / 坚守 / 精准 / 灵巧 / 迅捷 / 助力 / 协防 / 奇迹 / 调和 / 突袭 / 绝技），
//     跳过 远见 / 投资人 / 不屈 / 独行（它们的效果是钱 / 招募 / 复活 / 独狼，转成对敌减益
//     会变成另一条机制）。
//   · **不看队伍有没有那条盟约**（维护者 2026-11-05 第二次定）：它们就是普通祝福，直接进三选一池，
//     抽到就生效。`bondTheme` 只记录主题来源，不参与任何判定。
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

/** 11 条主题转化：主题盟约 id → 祝福 id。 */
const THEMES = {
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
    units: [],
    statuses: [],
    damage: [],
    timers: [],
    applyStatus(e, key, opts) {
      this.statuses.push({ target: e, key, ...opts });
      return true;
    },
    dealDamage(src, tgt, opts) {
      this.damage.push({ src, tgt, ...opts });
    },
    every(sec, fn) {
      this.timers.push({ sec, fn });
    },
    /** 触发所有 every 定时器（模拟「到点了」）。 */
    tick() {
      for (const t of this.timers) t.fn();
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

test('11 条主题转化都在祝福池里，各自记着主题来源', () => {
  const themed = ECHO_BLESSINGS.filter((b) => b.bondTheme);
  // 11 条附加盟约的转化 + 4 条从核心盟约提的（霜噬 / 惊惧 / 震荡 / 鲸吞）
  assert.equal(themed.length, Object.keys(THEMES).length + 4, '11 条附加 + 4 条核心');
  for (const [bondId, id] of Object.entries({ ...THEMES, kjeragShip: 'bd_frostbite_amp', siracusaShip: 'bd_dread', kazimierzShip: 'bd_quake', egirShip: 'bd_devour' })) {
    const b = echoBlessingById(id);
    assert.ok(b, `${id} 要存在`);
    assert.equal(b.bondTheme, bondId, `${id} 的主题是 ${bondId}`);
    assert.equal(b.kind, 'bonddebuff');
    assert.ok(b.name && b.desc, `${id} 要有名字与说明`);
    assert.doesNotMatch(b.desc, /队伍激活/, `${id} 的文案不该再带门槛`);
  }
  // 11 条附加盟约的转化：描述里的秒数必须和稀有度分档一致
  for (const id of Object.values(THEMES)) {
    const b = echoBlessingById(id);
    const secs = echoBondDebuffSeconds(b.rarity);
    assert.match(b.desc, new RegExp(`每回合前 ${secs} 秒`), `${id} 的文案要写对秒数`);
  }
});

test('时长按稀有度分档：普通 10 / 稀有 15 / 传说 20', () => {
  assert.deepEqual({ ...ECHO_BOND_DEBUFF_SECONDS }, { common: 10, rare: 15, epic: 20 });
  assert.equal(echoBondDebuffSeconds('common'), 10);
  assert.equal(echoBondDebuffSeconds('rare'), 15);
  assert.equal(echoBondDebuffSeconds('epic'), 20);
  assert.equal(echoBondDebuffSeconds('nope'), 15, '没登记按稀有算');
});

test('三选一：不看盟约，直接进池子（维护者 2026-11-05）', () => {
  // rng 扫一遍，把三个候选都收下来
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const rng = () => (i % 400) / 400;
    for (const b of echoBlessingOffer(rng, [])) seen.add(b.id);
  }
  for (const id of Object.values(THEMES)) {
    assert.equal(seen.has(id), true, `${id} 必须能出现在三选一里（不需要任何盟约）`);
  }
});

test('战斗：开局给全场敌人挂上状态，窗口内出场的敌人只吃到剩余时长', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  // 棋盘上一条盟约都没有，效果照样生效
  h.ps('p_0').bonds = {};
  m.echoBlessings = ['bd_preci'];
  const b = fakeBattle();
  const early = { alive: true, side: 'enemy' };
  b.enemies = [early];
  m._echoHookBattle(b);
  const secs = echoBondDebuffSeconds(echoBlessingById('bd_preci').rarity);
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

test('反震（坚守）：窗口内敌人打己方会吃到 30% 真实反伤，窗口外没有', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
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

// —— 核心盟约主题的 4 条（维护者 2026-11-05）：同样不看盟约，抽到就生效 ——

test('霜噬：寒冷 / 冻结的敌人受到的伤害 +35%（走 hit，伤害计算之前）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  h.ps('p_0').bonds = {};                       // 一条盟约都没有
  m.echoBlessings = ['bd_frostbite_amp'];
  const b = fakeBattle();
  m._echoHookBattle(b);
  const cold = { alive: true, side: 'enemy', s: { flags: { cold: true } } };
  const warm = { alive: true, side: 'enemy', s: { flags: {} } };
  const hitOn = (target) => { const dmg = { mul: 1 }; b.emit('hit', { source: { side: 'ally' }, target, dmg }); return dmg.mul; };
  assert.equal(hitOn(cold), 1.35, '寒冷目标 ×1.35');
  assert.equal(hitOn(warm), 1, '没寒冷的不加');
  const frozen = { alive: true, side: 'enemy', s: { flags: { freeze: true } } };
  assert.equal(hitOn(frozen), 1.35, '冻结也算');
});

test('惊惧：窗口内被己方击中的敌人恐惧 3 秒，窗口外不再挂', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['bd_dread'];
  const b = fakeBattle();
  m._echoHookBattle(b);
  const ally = { alive: true, side: 'ally' };
  const enemy = { alive: true, side: 'enemy', s: { flags: {} } };
  b.emit('damaged', { source: ally, target: enemy, amount: 10 });
  assert.equal(b.statuses.length, 1);
  assert.equal(b.statuses[0].key, 'fear');
  assert.equal(b.statuses[0].duration, 3);
  // 已经在恐惧 → 不重复挂
  enemy.s.flags.fear = true;
  b.emit('damaged', { source: ally, target: enemy, amount: 10 });
  assert.equal(b.statuses.length, 1, '不重复挂');
  enemy.s.flags.fear = false;
  // 窗口结束（10 秒）
  b.time = 10;
  b.emit('damaged', { source: ally, target: enemy, amount: 10 });
  assert.equal(b.statuses.length, 1, '窗口过后不再挂');
  // 敌人打己方不触发
  b.time = 0;
  b.emit('damaged', { source: enemy, target: ally, amount: 10 });
  assert.equal(b.statuses.length, 1, '只认己方打敌人');
});

test('震荡：窗口内每 2 秒对全场敌人造成己方最高攻击 60% 的真实伤害', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['bd_quake'];
  const b = fakeBattle();
  b.units = [
    { side: 'ally', alive: true, s: { atk: 400 } },
    { side: 'ally', alive: true, s: { atk: 1000 } },
    { side: 'enemy', alive: true, s: { atk: 9999 } },
  ];
  const e1 = { alive: true, side: 'enemy' };
  const e2 = { alive: true, side: 'enemy' };
  b.enemies = [e1, e2];
  m._echoHookBattle(b);
  assert.equal(b.timers.length, 1, '要挂一个周期定时器');
  assert.equal(b.timers[0].sec, 2);
  b.time = 1.5;
  b.tick();
  assert.equal(b.damage.length, 2, '两只敌人各吃一次');
  assert.equal(b.damage[0].amount, 600, '最高攻击 1000 × 60%');
  assert.equal(b.damage[0].type, 'true');
  // 窗口结束（15 秒）之后不再造成伤害
  b.time = 16;
  b.tick();
  assert.equal(b.damage.length, 2, '窗口过后不再脉冲');
});

test('鲸吞：开战吞掉 1 只非领袖敌人，领袖不吞', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['bd_devour'];
  const b = fakeBattle();
  m._echoHookBattle(b);
  // 先来一只领袖：不吞
  const boss = { alive: true, side: 'enemy', tag: 'boss', hp: 5000, s: { maxHp: 5000 }, def: { rank: 'BOSS' } };
  b.emit('enemySpawn', { enemy: boss });
  assert.equal(b.damage.length, 0, '领袖不吞');
  // 再来一只普通怪：吞掉（伤害量 = 当前血量）
  const mob = { alive: true, side: 'enemy', hp: 1234, s: { maxHp: 1234 }, def: { rank: 'NORMAL' } };
  b.emit('enemySpawn', { enemy: mob });
  assert.equal(b.damage.length, 1);
  assert.equal(b.damage[0].tgt, mob);
  assert.equal(b.damage[0].amount, 1234);
  // 只吞一只
  const mob2 = { alive: true, side: 'enemy', hp: 999, s: { maxHp: 999 }, def: { rank: 'NORMAL' } };
  b.emit('enemySpawn', { enemy: mob2 });
  assert.equal(b.damage.length, 1, '每场只吞一只');
});
