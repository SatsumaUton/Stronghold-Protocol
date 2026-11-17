// 回归测试：**面板跨回合结算时，盟约投影仍然必须弹出来**（维护者 2026-11-17 玩家反馈「72 层只选到 3 次」）。
//
// 曾经的 bug：
//   `_echoFlushProjectionIfPending` 先把 pending 清成 false，再让 `_echoOpenProjection(true)` **按当时的回合**
//   重新判断是不是投影层。只要「祝福/补给结算」拖到了下一个回合（玩家拖到倒计时结束、重连、
//   当层面板排队），那时 depth 已经不是投影层 → 直接 return 0，而 pending 已经被清掉 → **那层投影永久丢失**。
//
//   实测症状：16/26/36 三层面板少、当场结算成功；46 层之后每层都压着祝福+补给，投影全部丢失
//   → 玩家在 72 层只选到 3 次。
//
// 修法：pending 记**是哪一层**（数字，能进存档），补开时按那一层开，不再看当前回合。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { MATCH_FIELDS } from '../../server/match/snapshot.js';
import { isEchoProjectionLayer } from '../../server/match/match/echoProjection.js';

const dive = (seed = 1, humans = 2) => makeMatch({ mode: 'coop', humans, bots: 0, seed, fake: true, variant: 'deepecho' });

/** 把这一层「压住」再推进一回合，然后才收面板 —— 就是玩家遇到的延迟结算。 */
function settleNextRound(m, h, depth) {
  m.echoProjectionPending = false;
  m.round = depth;
  m.startRound(depth);
  // 不结算，先把回合推进（投影此时已被置成 pending = 该层的深度）
  m.round = depth + 1;
  m.startRound(depth + 1);
  // 现在才把所有面板收干净 —— flush 在这里发生
  for (let i = 0; i < 4000 && m._echoChoiceOpen(); i++) {
    if (m.echoProjectionOffer) for (const ps of m.alivePlayers()) m.setEchoProjectionPick(ps, 0);
    if (m.echoBlessingOffer) for (const ps of m.alivePlayers()) m.setEchoBlessingVote(ps, 0);
    if (m.echoBlessingDiscardOffer) for (const ps of m.alivePlayers()) m.setEchoBlessingDiscardVote(ps, 0);
    if (m.echoSupply && m.echoSupply.pick == null) for (const ps of m.alivePlayers()) m.setEchoSupplyPick(ps, 0);
    h.sched.advance(50);
  }
}

test('★ 面板跨回合结算：6 个投影层一个都不能丢', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoDiveStart = 1;

  const layers = [];
  for (const depth of [16, 26, 36, 46, 56, 66]) {
    assert.ok(isEchoProjectionLayer(depth), `${depth} 应当是投影层`);
    settleNextRound(m, h, depth);
    if (!Array.isArray(m.echoProjectionLayers) || !m.echoProjectionLayers.includes(depth)) layers.push(depth);
  }
  assert.deepEqual(layers, [], `★ 这些层的投影被丢掉了：${layers.join(',')}`);
  assert.deepEqual(
    m.echoProjectionLayers,
    [16, 26, 36, 46, 56, 66],
    '每一层都要记进 echoProjectionLayers',
  );
  assert.ok(m.alivePlayers().every((p) => p.echoProjection), '每名玩家都要真的拿到投影');
});

test('延后时 pending 记的是**层数**，不是 true（否则补开时算不出该开哪层）', (t) => {
  const h = dive(3);
  const m = h.m;
  t.after(() => m.dispose());
  m.echoDiveStart = 1;
  m.round = 16;
  m.startRound(16);
  // 16 层同时会开祝福三选一 → 投影被延后
  if (m.echoBlessingOffer) {
    assert.equal(m.echoProjectionPending, 16, '★ pending 必须是数字 16（层数），不能是 true');
  }
});

test('pending 进存档名额 —— 否则断线续玩后那层投影照样白丢', () => {
  assert.ok(
    MATCH_FIELDS.saved.includes('echoProjectionPending'),
    'echoProjectionPending 必须在 MATCH_FIELDS.saved 里',
  );
});
