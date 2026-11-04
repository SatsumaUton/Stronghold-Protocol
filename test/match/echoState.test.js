// 「深渊回响」状态机测试：祝福三选一（开票 → 投票 → 结算 → 发放）与悬赏发放。
//
// 为什么单独测：这些逻辑全在深潜分支里，golden 的 67k 场景一次都走不到；
// 而它们又是**会卡住玩家**的（祝福不投完票不结算）。用假 match 直接调原型方法。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchEcho } from '../../server/match/match/echoPhase.js';

const P = MatchEcho.prototype;

const human = (id, { connected = true, spectator = false } = {}) => ({
  playerId: id, connected, spectator, isBot: false, left: false,
  funds: 0, pendingFunds: 0, stats: { fundsGained: 0 }, dirty() {}, addFunds(n) { this.funds += n; },
});

/** 假 match：原型派生（方法互相调用能解析），带最小可用的状态与方法桩。 */
function fakeMatch({ round = 20, diveStart = 16, humans = [human(1)], variant = 'deepecho' } = {}) {
  const m = Object.assign(Object.create(P), {
    echoVariant: variant,
    echoDiveStart: diveStart,
    echoBlessings: [],
    echoBlessingDraws: 0,
    echoBlessingOffer: null,
    _echoBlessingVotes: new Map(),
    round,
    seed: 12345,
    roomCode: 'TEST',
    wave: null,
    bossWaves: null,
    tickers: [],
    publics: 0,
    log: { info() {} },
    gd: { enemy: () => ({ stats: { maxHp: 1000 } }), bossRound: 14 },
  });
  m.humans = () => m._humans;
  m._humans = humans;
  m.alivePlayers = () => humans;
  m.markPublic = () => { m.publics += 1; };
  m.tickerText = (txt) => { m.tickers.push(txt); };
  // 投票超时用到的调度：记录下来，测试里手动触发
  m.timers = [];
  m.later = (ms, fn) => { m.timers.push({ ms, fn }); return m.timers.length; };
  m.cancel = (h) => { m.cancelled.push(h); };
  m.cancelled = [];
  return m;
}

test('祝福发放节奏：深潜第 1 层就开票，之后每 5 层一次', () => {
  const first = fakeMatch({ round: 16 });
  const offer = P._echoMaybeOfferBlessing.call(first, 16);
  assert.ok(Array.isArray(offer) && offer.length === 3, '深度 1 → 三选一（维护者 2026-11-04）');
  assert.deepEqual(offer, first.echoBlessingOffer);
  // 已经拿过一次：深度 4 不再开第二次
  const m4 = fakeMatch({ round: 19 });
  m4.echoBlessings = [offer[0]];
  m4.echoBlessingOffer = null;
  assert.equal(P._echoMaybeOfferBlessing.call(m4, 19), null, '深度 4 不开第二次');
  // 深度 10 才是第二次：已有两个时就该关掉
  const m10 = fakeMatch({ round: 25 });
  m10.echoBlessings = [offer[0], offer[1]];
  m10.echoBlessingOffer = null;
  assert.equal(P._echoMaybeOfferBlessing.call(m10, 25), null, '深度 10 已有 2 次');
});

test('已有一个没投完的候选时不会重抽（否则每回合看到的三项都在变）', () => {
  const m = fakeMatch({ round: 20 });
  const first = P._echoMaybeOfferBlessing.call(m, 20);
  const again = P._echoMaybeOfferBlessing.call(m, 21);
  assert.deepEqual(again, first, '同一份候选');
});

test('投票：全投完才结算，票多者得', () => {
  const humans = [human(1), human(2), human(3)];
  const m = fakeMatch({ round: 20, humans });
  const offer = P._echoMaybeOfferBlessing.call(m, 20);
  assert.equal(offer.length, 3);
  // 前两票不该结算
  P.setEchoBlessingVote.call(m, humans[0], 1);
  P.setEchoBlessingVote.call(m, humans[1], 1);
  assert.equal(m.echoBlessings.length, 0, '还差一票，不能生效');
  P.setEchoBlessingVote.call(m, humans[2], 0);
  assert.equal(m.echoBlessings.length, 1, '投完立即结算');
  assert.equal(m.echoBlessings[0], offer[1], '2:1 → 选第 2 项');
  assert.equal(m.echoBlessingOffer, null, '结算后候选清空');
});

test('离线的人既不计数也不阻塞', () => {
  const off = human(9, { connected: false });
  const humans = [human(1), off];
  const m = fakeMatch({ round: 20, humans });
  P._echoMaybeOfferBlessing.call(m, 20);
  P.setEchoBlessingVote.call(m, humans[0], 0);
  assert.equal(m.echoBlessings.length, 1, '在线的一个人投完就结算');
});

test('观战席不能投，非法下标被拒', () => {  const spec = human(7, { spectator: true });
  const m = fakeMatch({ round: 20, humans: [human(1), spec] });
  P._echoMaybeOfferBlessing.call(m, 20);
  const r1 = P.setEchoBlessingVote.call(m, spec, 0);
  assert.ok(r1.error, '观战席不能投票');
  const r2 = P.setEchoBlessingVote.call(m, human(1), 99);
  assert.ok(r2.error, '下标越界');
});

test('同类不叠加：同一个祝福只会入列一次', () => {  const m = fakeMatch({ round: 20 });
  const b = P._echoMaybeOfferBlessing.call(m, 20)[0];
  P._echoGrantBlessing.call(m, { id: b, name: 'x', desc: '', kind: 'coin', coinMul: 1.2 });
  P._echoGrantBlessing.call(m, { id: b, name: 'x', desc: '', kind: 'coin', coinMul: 1.2 });
  assert.deepEqual(m.echoBlessings, [b], '同类不叠加');
});

test('物资补给：一次性进钱包，且记进 stats', () => {
  const humans = [human(1), human(2)];
  const m = fakeMatch({ round: 20, humans });
  P._echoGrantBlessing.call(m, { id: 'fund', name: '物资补给', desc: '', kind: 'fund', funds: 40 });
  for (const h of humans) {
    assert.equal(h.funds, 40, '每个活着的玩家 +40（立刻入账）');
    assert.equal(h.stats.fundsGained, 40);
  }
  assert.equal(m.tickers.length, 1, '广播一条提示');
});

test('丰收：资金倍率 1.2；没有祝福时是 1；普通房恒为 1', () => {
  const m = fakeMatch({ round: 20 });
  assert.equal(P._echoCoinMul.call(m), 1);
  m.echoBlessings = ['loot'];
  assert.equal(P._echoCoinMul.call(m), 1, '丰收已改成每 3 层 +1 次免费刷新，不再是资金倍率');
  const normal = fakeMatch({ round: 20, variant: null });
  normal.echoBlessings = ['loot'];
  assert.equal(P._echoCoinMul.call(normal), 1, '普通房不受影响');
});

test('悬赏：只在非 boss 节点发，且从本回合波次里抽', () => {
  const humans = [human(1)];
  const m = fakeMatch({ round: 38, humans });
  const granted = [];
  m.addBounty = (ps, card) => { granted.push({ pid: ps.playerId, card }); return 'b1'; };
  m.wave = { spawns: [{ enemyKey: 'e1', count: 2 }, { enemyKey: 'e2', count: 1 }] };
  assert.equal(P._echoMaybeGrantBounty.call(m, 38), 1, '深度 23 是悬赏层');
  assert.equal(granted.length, 1);
  assert.ok(['e1', 'e2'].includes(granted[0].card.enemyKey), '目标必须来自本回合波次');
  // boss 节点不发
  const m2 = fakeMatch({ round: 40, humans });
  m2.addBounty = () => 'x';
  m2.wave = { spawns: [{ enemyKey: 'e1', count: 1 }] };
  assert.equal(P._echoMaybeGrantBounty.call(m2, 40), 0, '深度 25 是 boss 返场，不发悬赏');
  // 非节点不发
  const m3 = fakeMatch({ round: 19, humans });
  m3.addBounty = () => 'x';
  m3.wave = { spawns: [{ enemyKey: 'e1', count: 1 }] };
  assert.equal(P._echoMaybeGrantBounty.call(m3, 19), 0, 'R19 不发');
});

test('30 秒超时：已投的人按票数最高结算（不必等挂机的人）', () => {
  const humans = [human(1), human(2)];
  const m = fakeMatch({ round: 20, humans });
  const offer = P._echoMaybeOfferBlessing.call(m, 20);
  assert.equal(m.timers.length, 1, '开票时要挂一个超时');
  assert.equal(m.timers[0].ms, 30000, '维护者定的 30 秒');
  P.setEchoBlessingVote.call(m, humans[0], 2);
  assert.equal(m.echoBlessings.length, 0, '还差一个人，不能立即结算');
  m.timers[0].fn(); // 模拟超时触发
  assert.deepEqual(m.echoBlessings, [offer[2]], '超时按已投的最高票结算');
  assert.equal(m.echoBlessingOffer, null, '结算后候选清空');
});

test('30 秒超时：一个人都没投就取候选第一项', () => {
  const m = fakeMatch({ round: 20, humans: [human(1)] });
  const offer = P._echoMaybeOfferBlessing.call(m, 20);
  assert.equal(m.timers.length, 1);
  m.timers[0].fn();
  assert.deepEqual(m.echoBlessings, [offer[0]], '没人投 → 候选第一项');
});

test('结算会取消超时定时器（避免重复结算）', () => {
  const humans = [human(1)];
  const m = fakeMatch({ round: 20, humans });
  P._echoMaybeOfferBlessing.call(m, 20);
  P.setEchoBlessingVote.call(m, humans[0], 1);
  assert.equal(m.echoBlessings.length, 1, '立即结算');
  assert.ok(m.cancelled.length >= 1, '必须 cancel 掉那个定时器');
});
