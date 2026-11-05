// 盟约投影：面板必须真的弹出来（否则 buff 栏 / 祝福列表里永远看不到它）。
//
// 维护者 2026-11-05 反馈：buff 栏没有盟约投影，祝福列表里也没有。
// 原因不是渲染，是面板被延后之后**没有地方补开**：
//   · 16 层会同时触发「祝福三选一」（名额满时还会再开「弃选替换」）与「深潜补给」；
//   · 投影遇到别的面板打开时会把 echoProjectionPending 置真，等别人结算完再补开；
//   · 但「弃选替换」那条路径原来不 flush —— 投影就一直挂着，整层白丢（下一次要等到 26 层）。
// 现在补开统一放在 _echoMaybeResumePrepClock()（所有面板都关上的那一刻），任何路径都能补上。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { isEchoProjectionLayer, ECHO_PROJECTIONS } from '../../server/match/match/echoProjection.js';

const dive = (seed = 1, humans = 2) => makeMatch({ mode: 'coop', humans, bots: 0, seed, fake: true, variant: 'deepecho' });

/** 推进到 PREP，并把当前开着的面板都按第 0 项投掉，直到没有面板为止。 */
function clearPanels(h, rounds = 8) {
  const m = h.m;
  for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) h.sched.advance(200);
  const opened = [];
  for (let k = 0; k < rounds; k++) {
    const voters = m.alivePlayers();
    if (m.echoBlessingOffer) {
      opened.push('blessing');
      for (const ps of voters) m.setEchoBlessingVote(ps, 0);
      continue;
    }
    if (m.echoBlessingDiscardOffer) {
      opened.push('discard');
      for (const ps of voters) m.setEchoBlessingDiscardVote(ps, 0);
      continue;
    }
    if (m.echoSupply && m.echoSupply.pick == null) {
      opened.push('supply');
      for (const ps of voters) m.setEchoSupplyPick(ps, 0);
      continue;
    }
    if (m.echoProjectionOffer) {
      opened.push('projection');
      for (const ps of voters) m.setEchoProjectionPick(ps, 0);
      continue;
    }
    break;
  }
  return opened;
}

test('投影层：16 / 26 / 36 …（每 10 层一次）', () => {
  assert.equal(isEchoProjectionLayer(15), false);
  assert.equal(isEchoProjectionLayer(16), true);
  assert.equal(isEchoProjectionLayer(25), false);
  assert.equal(isEchoProjectionLayer(26), true);
  assert.equal(isEchoProjectionLayer(36), true);
  assert.ok(ECHO_PROJECTIONS.length >= 8, '8 条核心盟约都能投影');
});

test('16 层：祝福 / 补给 结算完之后，投影面板一定会弹，投票后进祝福列表', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  const opened = clearPanels(h);
  assert.ok(opened.includes('projection'), `投影面板要弹出来（实际开了：${opened.join(' → ') || '无'}）`);
  assert.equal(m.echoProjectionPending, false, '补开之后不该还挂着');
  assert.ok(m.echoProjection, '投票后要记下投影');
  const pub = m._echoPublic();
  const proj = (pub.blessings || []).find((b) => b.projection === true);
  assert.ok(proj, 'buff 栏 / 祝福列表的数据源里要有投影');
  assert.equal(proj.id, `projection:${m.echoProjection}`);
  assert.equal(proj.occupiesSlot, false, '投影不占祝福名额');
  assert.match(proj.name, /盟约投影/);
});

test('名额满的「弃选替换」路径也不能把投影吞掉', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  // 已经拿满 3 个祝福 → 16 层的三选一会走「弃选替换」
  m.echoBlessings = ['atk_s', 'hp_s', 'def_s'];
  m.echoBlessingDraws = 3;
  m.round = 15;
  m.startRound(16);
  const opened = clearPanels(h, 10);
  assert.ok(opened.includes('discard'), `应走到弃选替换（实际：${opened.join(' → ') || '无'}）`);
  assert.ok(opened.includes('projection'), `弃选之后投影也要弹（实际：${opened.join(' → ') || '无'}）`);
  assert.ok(m.echoProjection, '投影要真的生效');
});

test('面板不会同时开两个（一次只弹一个）', (t) => {
  const h = dive(3);
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  const open = () => [m.echoBlessingOffer, m.echoBlessingDiscardOffer, m.echoSupply && m.echoSupply.pick == null ? m.echoSupply : null, m.echoProjectionOffer].filter(Boolean).length;
  for (let i = 0; i < 40 && m.phase !== 'PREP'; i++) {
    h.sched.advance(200);
    assert.ok(open() <= 1, `同时开了 ${open()} 个面板`);
  }
  const voters = m.alivePlayers();
  for (let k = 0; k < 8; k++) {
    if (m.echoBlessingOffer) { for (const ps of voters) m.setEchoBlessingVote(ps, 0); continue; }
    if (m.echoBlessingDiscardOffer) { for (const ps of voters) m.setEchoBlessingDiscardVote(ps, 0); continue; }
    if (m.echoSupply && m.echoSupply.pick == null) { for (const ps of voters) m.setEchoSupplyPick(ps, 0); continue; }
    if (m.echoProjectionOffer) { for (const ps of voters) m.setEchoProjectionPick(ps, 0); continue; }
    break;
  }
  assert.ok(open() <= 1, '结算过程中也不能叠面板');
});
