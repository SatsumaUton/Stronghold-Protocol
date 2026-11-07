// 复活（联防救援）完整流程验证。
//
// 覆盖三件事：
//   1. Match.revive() 在满足条件时能把死亡队友救回来（lp=1，donor 扣 10）
//   2. 各种不满足条件时的拒绝原因正确
//   3. _revivalDeathReason() 的提示不再因为「死者自己」而误报「都不足 11」
//      （2026-10-29 维护者反馈的 bug，见 MAINTENANCE §9.25）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { REVIVAL_COST, REVIVAL_MIN_DONOR_LP } from '../../server/match/match/common.js';

/**
 * 构造一个已进入 SETTLE、救援窗口打开的双人合作局。
 * 直接改内部状态而不是跑完一整局：本测试验证的是 revive 的准入与效果，不是战斗。
 */
function rescueFixture(t) {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7, fake: true }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const m = h.m;
  const donor = h.ps('p_0');
  const victim = h.ps('p_1');

  // 模拟「本轮联防结束、victim 被打死、窗口打开」的状态
  m.revivalEnabled = true;
  m.phase = PHASE.SETTLE;
  m.ended = false;
  m.teamLp = null;
  m._revival = {
    round: m.round,
    eligible: new Set([donor.playerId]),
    windowOpen: true,
    deadline: m.sched.now() + 15000,
  };
  donor.alive = true;
  donor.left = false;
  donor.lp = 20;
  // victim 处于 pendingDeath：死了但还能救
  victim.alive = false;
  victim.pendingDeath = true;
  victim.left = false;
  victim.revived = false;
  victim.lp = 0;
  return { ...h, m, donor, victim };
}

test('复活：满足条件时队友回到 1 点，施救者扣 10 点', (t) => {
  const { m, donor, victim } = rescueFixture(t);
  assert.equal(m.revivalWindowOpen(), true, '窗口应当是开的');

  const r = m.revive(donor, { playerId: victim.playerId, round: m.round, matchId: m.battlePrefix });
  assert.deepEqual(r, { ok: true }, '复活应当成功');

  assert.equal(victim.alive, true, '队友应当复活');
  assert.equal(victim.pendingDeath, false, '不再处于待死状态');
  assert.equal(victim.lp, 1, '复活的队友回到 1 点生命');
  assert.equal(victim.revived, true, '标记本局已用过复活');
  assert.equal(donor.lp, 20 - REVIVAL_COST, '施救者扣 10 点');
});

test('复活：同一队友第二次复活被拒绝', (t) => {
  const { m, donor, victim } = rescueFixture(t);
  assert.deepEqual(m.revive(donor, { playerId: victim.playerId, round: m.round, matchId: m.battlePrefix }), { ok: true });

  // 第一次复活消耗 10 点，补给施救者后让他仍够门槛，这样拒绝原因才是「目标已用过」
  donor.lp = REVIVAL_MIN_DONOR_LP + 5;
  victim.alive = false;
  victim.pendingDeath = true;
  const r2 = m.revive(donor, { playerId: victim.playerId, round: m.round, matchId: m.battlePrefix });
  assert.equal(r2.ok, undefined, '第二次应当失败');
  assert.equal(r2.detail, 'revival-target-ineligible', '原因：目标本局已用过复活');
});

test('复活：施救者生命值不足 11 被拒绝', (t) => {
  const { m, donor, victim } = rescueFixture(t);
  donor.lp = REVIVAL_MIN_DONOR_LP - 1;
  const r = m.revive(donor, { playerId: victim.playerId, round: m.round, matchId: m.battlePrefix });
  assert.equal(r.ok, undefined, '应当失败');
  assert.equal(r.detail, 'revival-lp-insufficient', '原因：生命值不足');
});

test('复活：窗口关闭后无法复活', (t) => {
  const { m, donor, victim } = rescueFixture(t);
  m._revival.windowOpen = false;
  const r = m.revive(donor, { playerId: victim.playerId, round: m.round, matchId: m.battlePrefix });
  assert.equal(r.ok, undefined, '应当失败');
  assert.equal(r.detail, 'revival-window-closed', '原因：窗口已关');
});

// ---- 2026-10-29 bug：提示「都不足 11」把死者自己算了进去 ----

test('提示：除死者外仍有队友能付款时，不报 donor-lp', (t) => {
  const { m, donor, victim } = rescueFixture(t);
  donor.lp = 15;   // 够 11
  // 死者自己 lp=0，但 donorsome 是别人，所以不能因此报「都不足 11」
  const reason = m._revivalDeathReason(victim);
  assert.notEqual(reason, 'donor-lp', '有人能付款时不该说「都不足 11」');
});

test('提示：确实全队都不足 11 时才报 donor-lp', (t) => {
  const { m, donor, victim } = rescueFixture(t);
  donor.lp = 5;    // 不够
  const reason = m._revivalDeathReason(victim);
  assert.equal(reason, 'donor-lp', '全队不够时才是 donor-lp');
});

test('提示：没有合格队友时是 no-helper 而不是 donor-lp', (t) => {
  const { m, victim } = rescueFixture(t);
  m._revival.eligible = new Set();   // 没人有资格
  const reason = m._revivalDeathReason(victim);
  assert.equal(reason, 'no-helper', '没有合格队友');
});

// 维护者 2026-11-06：深潜取消「每人每局只能被救一次」——只要条件满足就能反复救。
// 普通房间仍是一命一次（上一条用例钉住）。
test('深潜：救援不限次数，同一队友可以反复救回', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7, fake: true, variant: 'deepecho' }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const m = h.m;
  const donor = h.ps('p_0');
  const victim = h.ps('p_1');
  assert.equal(m.revivalUnlimited, true, '深潜必须开启不限次数');
  m.revivalEnabled = true;
  m.phase = PHASE.SETTLE;
  m.ended = false;
  m.teamLp = null;
  m._revival = { round: m.round, eligible: new Set([donor.playerId]), windowOpen: true, deadline: m.sched.now() + 15000 };
  donor.alive = true;
  donor.left = false;
  donor.lp = 40;

  for (let n = 1; n <= 3; n++) {
    victim.alive = false;
    victim.pendingDeath = true;
    victim.left = false;
    victim.lp = 0;
    const r = m.revive(donor, { playerId: victim.playerId, round: m.round, matchId: m.battlePrefix });
    assert.deepEqual(r, { ok: true }, `第 ${n} 次救援应当成功`);
    assert.equal(victim.alive, true);
    assert.equal(victim.lp, 1, '每次都回到 1 点生命');
    assert.equal(victim.revivedCount, n, `复活次数应当累计到 ${n}`);
    assert.equal(donor.lp, 40 - REVIVAL_COST * (n - 1) - REVIVAL_COST, '每次扣 10 点');
  }

  // 施救者自己没血了就不再能救 —— 上限是「生命值」，不是次数
  donor.lp = REVIVAL_MIN_DONOR_LP - 1;
  victim.alive = false;
  victim.pendingDeath = true;
  victim.lp = 0;
  const r2 = m.revive(donor, { playerId: victim.playerId, round: m.round, matchId: m.battlePrefix });
  assert.equal(r2.ok, undefined, '付不起时仍然拒绝');
});

// 维护者 2026-11-07：普通房间恢复参考版（原版）设计 —— 救援只发生在联防结算后，
// 且只有「本轮实际出场、自己这一轮没漏怪」的 helper 能付 10 血救人；深潜保持不变。
test('普通房间（参考版口径）：非联防回合没有救援资格，0 血直接淘汰', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7, fake: true }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.equal(m.revivalAnyDonor, false, '普通房间不放开 anyDonor');
  m.revivalEnabled = true;
  m.phase = PHASE.SETTLE;
  assert.equal(m._revivalHelpers(null, null).size, 0, '各自行动的回合没人有资格');
  m.phase = PHASE.COMBAT;
  assert.equal(m._revivalHelpers(null, null).size, 0);
});

test('普通房间（参考版口径）：联防回合只收「实际出场且本轮未漏怪」的 helper', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 7, fake: true }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const m = h.m;
  m.revivalEnabled = true;
  const [a, b, c] = ['p_0', 'p_1', 'p_2'].map((id) => h.ps(id));
  const plan = { helpers: [a, b, c], leakers: [], leaked: [], notReentered: new Map() };
  m.phase = PHASE.UNITE;
  m.unitePlan = plan;
  m.fields = [{ fieldId: 'u', kind: 'unite', players: [a.playerId, b.playerId], live: false }];
  m.lastResults.set(a.playerId, { perfect: true, leaked: [] });
  m.lastResults.set(b.playerId, { perfect: false, leaked: [{ counted: true }] });
  m.lastResults.set(c.playerId, { perfect: true, leaked: [] });
  const perPlayer = { [a.playerId]: { perfect: true, leaked: [] }, [b.playerId]: { perfect: true, leaked: [] } };
  assert.deepEqual([...m._revivalHelpers(plan, { reason: 'cleared', perPlayer })], [a.playerId],
    'c 没上联防场、b 自己漏了怪，只有 a 合格');
  // 没打穿 / 没跑起来的联防：一个人都不合格
  assert.equal(m._revivalHelpers(plan, { reason: 'failed', perPlayer }).size, 0);
  assert.equal(m._revivalHelpers(plan, { reason: 'cleared', synthetic: true, perPlayer }).size, 0);
  // 不是本轮的联防（旧 plan）：不合格
  assert.equal(m._revivalHelpers({ helpers: [a], leakers: [] }, { reason: 'cleared', perPlayer }).size, 0);
});

test('深潜（不变）：任何存活队友、任何回合都能救援', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7, fake: true, variant: 'deepecho' }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.equal(m.revivalAnyDonor, true);
  assert.equal(m.revivalUnlimited, true);
  m.revivalEnabled = true;
  m.phase = PHASE.COMBAT;
  const alive = m.order.filter((ps) => !ps.isBot && ps.alive && !ps.left).map((ps) => ps.playerId).sort();
  assert.deepEqual([...m._revivalHelpers(null, null)].sort(), alive, '不要求联防、不要求完美');
});
