// 「16 层起每 10 层一次」的完整长跑：跑到 126 层，11 个投影层必须**一个不漏、按顺序**各开一次。
//
// 维护者 2026-11-18：「所有的 16 层以后开始原来的设计实现」——
//   * 设计只有「每 10 层一次」，没有 boss 层例外（原来的 `if (this.bossWaves) return 0;` 是我们自己加的，
//     会让那一层被静默跳过）；
//   * 延后结算也不能丢层（2026-11-17 的玩家反馈）。
// 这里用真实 Match 逐层推进，面板都按第 0 项投掉，跨回合也照投。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { isEchoProjectionLayer } from '../../server/match/match/echoProjection.js';

const allLayers = (from = 16, to = 126) => {
  const out = [];
  for (let d = from; d <= to; d++) if (isEchoProjectionLayer(d)) out.push(d);
  return out;
};

test('★ 16→126 层：11 个投影层全部开到，顺序与设计一致', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 11, fake: true, variant: 'deepecho', test: true });
  const m = h.m;
  t.after(() => m.dispose());
  m.echoDiveStart = 1;                       // 深度 == 回合

  const want = allLayers(16, 126);
  assert.deepEqual(want, [16, 26, 36, 46, 56, 66, 76, 86, 96, 106, 116, 126].filter((d) => d <= 126));

  const opened = [];
  for (const depth of want) {
    // 上一层收干净
    for (let i = 0; i < 2000 && m._echoChoiceOpen(); i++) {
      if (m.echoProjectionOffer) for (const ps of m.alivePlayers()) m.setEchoProjectionPick(ps, 0);
      if (m.echoBlessingOffer) for (const ps of m.alivePlayers()) m.setEchoBlessingVote(ps, 0);
      if (m.echoBlessingDiscardOffer) for (const ps of m.alivePlayers()) m.setEchoBlessingDiscardVote(ps, 0);
      if (m.echoSupply && m.echoSupply.pick == null) for (const ps of m.alivePlayers()) m.setEchoSupplyPick(ps, 0);
      h.sched.advance(50);
    }
    m.round = depth;
    m.startRound(depth);
    // 这一层可能压着别的面板：投到出现投影为止
    for (let i = 0; i < 2000; i++) {
      if (m.echoProjectionOffer && m.echoProjectionOffer.depth === depth) {
        opened.push(depth);
        for (const ps of m.alivePlayers()) m.setEchoProjectionPick(ps, 0);
        break;
      }
      if (m.echoBlessingOffer) { for (const ps of m.alivePlayers()) m.setEchoBlessingVote(ps, 0); h.sched.advance(50); continue; }
      if (m.echoBlessingDiscardOffer) { for (const ps of m.alivePlayers()) m.setEchoBlessingDiscardVote(ps, 0); h.sched.advance(50); continue; }
      if (m.echoSupply && m.echoSupply.pick == null) { for (const ps of m.alivePlayers()) m.setEchoSupplyPick(ps, 0); h.sched.advance(50); continue; }
      h.sched.advance(50);
    }
  }

  assert.deepEqual(opened, want, `★ 投影层必须一个不漏：缺 ${want.filter((d) => !opened.includes(d)).join(',') || '无'}`);
  assert.deepEqual(m.echoProjectionLayers, want, '每一层都要记进 echoProjectionLayers');
  assert.ok(m.alivePlayers().every((p) => p.echoProjection), '每名玩家都真的拿到了投影');
});

test('投影层与固定节点层不重叠（删掉 boss 例外不会和 boss 流程打架）', async () => {
  const { isEchoNodeDepth } = await import('../../server/match/match/echo.js');
  const overlaps = [];
  for (let d = 16; d <= 300; d++) if (isEchoProjectionLayer(d) && isEchoNodeDepth(d)) overlaps.push(d);
  assert.deepEqual(overlaps, [], '投影层不应落在 boss 返场的固定节点上');
});
