// 掉线由 AI 接管（server/match/match/platform.js `_checkOffline`，维护者 2026-11-06 要求移植）：
//
//   * 连续 `OFFLINE_TAKEOVER_ROUNDS`(2) 个**备战结束**该座位都掉线 → 从下一次备战起由 AI 打
//     （`autoplay = true` + `offlineAutoplay = true`），全队看到一条 ticker；
//   * 接管后 AI 要**真的把席位打下去**：买人、上人、准备就绪（不是只把座位标成「托管」就完事）；
//   * 重连立刻收回（`autoplay` 复位 + toast + ticker）；
//   * 掉线期间不算挂机（`afkRounds` 归零，不会被挂机判定移出）；
//   * **不限时的房间（单人 / 1 真人 + AI）不接管**：对局停在备战等人回来（「24 小时保存」靠这条）。
//
// 这些是维护者 2026-11-08 要求复核的点（「掉线 AI 接管有没有在正常功能」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { OFFLINE_TAKEOVER_ROUNDS } from '../../server/match/match/common.js';
import { makeMatch } from './harness.js';

/** 2 真人（有倒计时的同盟房）：跑到 R1 战斗，然后 p_1 掉线。 */
function dropped(o = {}) {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 77, fake: true, script: () => ({ duration: 4 }), ...o }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 1, { ready: false });
  const a = h.ps('p_0');
  const b = h.ps('p_1');
  m.handle(a.playerId, { t: 'g.ready', ready: true });
  h.run(() => m.phase !== PHASE.PREP || m.ended, { maxSteps: 4e6 });
  assert.equal(m.phase, PHASE.COMBAT, '前提：进入战斗');
  m.onDisconnect(b.playerId);
  return { h, m, a, b };
}

/** 只让 p_0 准备（不要用 h.drive：它会替掉线的人也点准备，把 AI 的备战任务作废）。 */
function prepOnlyA(h, m, a, r) {
  h.run(() => m.phase === PHASE.PREP && m.round === r || m.ended, { maxSteps: 4e6 });
  assert.equal(m.phase, PHASE.PREP, `前提：到 R${r} 备战`);
  m.handle(a.playerId, { t: 'g.ready', ready: true });
  h.run(() => m.phase !== PHASE.PREP || m.ended, { maxSteps: 4e6 });
}

test(`连续 ${OFFLINE_TAKEOVER_ROUNDS} 个备战结束掉线才接管，接管后 AI 真的买人上人并自己准备`, (t) => {
  const { h, m, a, b } = dropped();
  t.after(() => m.dispose());
  assert.equal(OFFLINE_TAKEOVER_ROUNDS, 2);

  // 第 1 个备战结束：只记数，还没接管
  prepOnlyA(h, m, a, 2);
  assert.equal(b.offlineRounds, 1, '掉线第 1 个备战结束');
  assert.equal(b.autoplay, false, '还没到接管回合');
  assert.equal(b.offlineAutoplay, false);

  // 第 2 个备战结束：接管
  prepOnlyA(h, m, a, 3);
  assert.equal(b.offlineRounds, 2);
  assert.equal(b.autoplay, true, '连续 2 个备战结束 → AI 接管');
  assert.equal(b.offlineAutoplay, true);
  assert.equal(b.botControlled, true, 'botControlled 跟着为真（备战 / 选秀 / 领奖都会自动走机器人）');

  // 接管后的下一次备战：AI 必须自己打完（买人 / 上人 / 准备）
  const funds0 = b.funds;
  h.run(() => m.phase === PHASE.PREP && m.round === 4 || m.ended, { maxSteps: 4e6 });
  assert.equal(m.phase, PHASE.PREP, '前提：到 R4 备战');
  assert.equal(b.ready, false, '前提：新一回合的备战是空的');
  m.handle(a.playerId, { t: 'g.ready', ready: true });
  h.run(() => m.phase !== PHASE.PREP || m.ended, { maxSteps: 4e6 });
  assert.equal(b.ready, true, 'AI 把席位准备就绪了');
  assert.ok(b.deployCount > 0, `AI 应该上场了干员（实际 ${b.deployCount} 个）`);
  assert.ok(b.funds < funds0 || b.deployCount > 0, 'AI 会花钱买人（或本来就有场上干员）');
});

test('接管会广播一条 ticker，m.public 里只有「掉线 + 已接管」的座位带 offlineTakeover', (t) => {
  const { h, m, a, b } = dropped();
  t.after(() => m.dispose());
  prepOnlyA(h, m, a, 2);
  const before = h.bc.filter((x) => x.t === 'm.ticker').length;
  prepOnlyA(h, m, a, 3);
  const tickers = h.bc.filter((x) => x.t === 'm.ticker');
  assert.ok(tickers.length > before, '接管要有一条播报');
  assert.match(tickers.map((x) => x.text).join('\n'), /AI 托管/, '播报要说清楚由 AI 托管');
  const rows = m.publicView().players;
  const row = (id) => rows.find((p) => p.playerId === id);
  assert.equal(row(b.playerId).offlineTakeover, true, '掉线 + 接管 → 客户端才亮「投票移出」');
  assert.equal(row(a.playerId).offlineTakeover, undefined, '在线的人没有这个标记');
});

test('重连立刻收回托管：autoplay / offlineAutoplay 复位，并给本人一条 toast', (t) => {
  const { h, m, a, b } = dropped();
  t.after(() => m.dispose());
  prepOnlyA(h, m, a, 2);
  prepOnlyA(h, m, a, 3);
  assert.equal(b.autoplay, true, '前提：已接管');
  const toasts = [];
  h.onSend.push((pid, msg) => { if (pid === b.playerId && msg.t === 'm.toast') toasts.push(msg); });
  m.onReconnect(b.playerId);
  assert.equal(b.connected, true);
  assert.equal(b.offlineRounds, 0, '掉线计数清零');
  assert.equal(b.offlineAutoplay, false, '收回');
  assert.equal(b.autoplay, false, '自动操作关掉');
  assert.equal(b.botControlled, false, '席位回到真人手里');
  assert.ok(toasts.some((x) => /AI 托管已解除/.test(x.text || '')), '要告诉玩家托管已经解除');
});

test('掉线期间不算挂机：连续掉线多回合也不会被挂机判定移出', (t) => {
  const { h, m, a, b } = dropped();
  t.after(() => m.dispose());
  for (let r = 2; r <= 4; r++) {
    prepOnlyA(h, m, a, r);
    assert.equal(b.afkRounds, 0, `R${r}：掉线的座位不该累计挂机回合`);
    assert.equal(b.left, false, `R${r}：不能被移出`);
  }
  assert.equal(b.offlineAutoplay, true, '期间一直是 AI 在打');
});

test('不限时的房间（1 真人 + AI 队友）不接管：掉线后对局停在备战等人回来', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 3, seed: 11, fake: true, script: () => ({ duration: 4 }) }).start();
  const m = h.m;
  t.after(() => m.dispose());
  h.drive(() => m.phase === PHASE.PREP && m.round === 1, { ready: false });
  const me = h.ps('p_0');
  assert.equal(m.soloUntimed, true, '前提：1 真人 → 不限时');
  m.handle(me.playerId, { t: 'g.ready', ready: true });
  h.run(() => m.phase !== PHASE.PREP || m.ended, { maxSteps: 4e6 });
  m.onDisconnect(me.playerId);
  // 战斗照样打完（服务端战斗），然后停在下一回合的备战
  h.run(() => (m.phase === PHASE.PREP && m.round === 2) || m.ended, { maxSteps: 4e6 });
  assert.equal(m.phase, PHASE.PREP);
  const round = m.round;
  const moved = h.run(() => m.round > round || m.ended, { maxSteps: 2e5 });
  assert.equal(moved, false, '没人操作就不该自己往下打（这是「24 小时保存」的前提）');
  assert.equal(me.autoplay, false, '不限时的房间不做掉线接管');
  assert.equal(me.offlineAutoplay, false);
});
