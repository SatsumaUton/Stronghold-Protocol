// 维护者 2026-11-05：**决策面板没结算完之前，准备阶段倒计时不许动**。
// 以前祝福三选一是在 ROUND_START 就开好的，那时 phase 还不是 PREP，`_echoPausePrepClock()` 直接返回；
// 等 enterPrep() 设 deadline 时面板还开着，右上角就一直在倒数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';

const dive = () => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 13, fake: true, variant: 'deepecho' });

test('面板开着时进入准备阶段不开始倒数；结算后把整段时间接回来', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 15;
  m.startRound(16);
  // 造一个没结算的祝福三选一（ROUND_START 阶段就开）
  m.echoBlessingOffer = ['atk_s', 'hp_s', 'def_s'];
  assert.equal(m._echoChoiceOpen(), true);
  h.drive(() => m.phase === PHASE.PREP);
  assert.equal(m.phase, PHASE.PREP, '进入准备阶段');
  assert.equal(m.deadline, 0, '面板还开着 → 倒计时不能开始');
  assert.ok(m._echoPrepPausedMs > 0, '整段准备时间被扣住了');
  // 结算面板 → 倒计时接回来
  m.echoBlessingOffer = null;
  m._echoMaybeResumePrepClock();
  assert.ok(m.deadline > 0, '面板关掉后倒计时才恢复');
});

test('_echoChoiceOpen 覆盖全部决策面板', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const probes = [
    () => { m.echoBlessingOffer = ['atk_s']; },
    () => { m.echoBlessingDiscardOffer = ['atk_s']; },
    () => { m.echoBlessingRefreshVote = { id: 1 }; },
    () => { m.echoSupply = { round: m.round, options: [{}], pick: null }; },
    () => { m.echoProjectionOffer = { round: m.round, options: ['yanShip'], pick: null }; },
    () => { m.echoShieldOffer = ['lateranoShip']; },
  ];
  for (const set of probes) {
    m.echoBlessingOffer = null;
    m.echoBlessingDiscardOffer = null;
    m.echoBlessingRefreshVote = null;
    m.echoSupply = null;
    m.echoProjectionOffer = null;
    m.echoShieldOffer = null;
    assert.equal(m._echoChoiceOpen(), false, '清空后应当没有面板');
    set();
    assert.equal(m._echoChoiceOpen(), true, '这个面板要被认出来');
  }
});
