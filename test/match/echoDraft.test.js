// test/match/echoDraft.test.js — 深潜房不再抽原版的「悬赏决策」（6 选 1）。
//
// 深潜有自己的悬赏：按最大生命值分档自动给币、击杀目标从本波随机。两套同时存在会重复计账、
// 也会让玩家以为要手动挑目标，所以 `generateDraft` 多了 `allowBounty` 开关，深潜房传 false。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { generateDraft } from '../../server/match/choices.js';

test('深潜房：allowBounty=false 时永不抽到悬赏家族，且普通抽取仍能抽到（证明开关有效）', () => {
  const m = (makeMatch({ mode: 'coop', humans: 2, seed: 'echo-draft', fake: true })).m;
  let sawBountyWhenAllowed = false;
  for (let round = 1; round <= 40; round++) {
    for (let i = 0; i < 8; i++) {
      const off = generateDraft(m.gd, m.rngDraft, round, { stageId: m.stageId, allowBounty: false });
      if (off) assert.notEqual(off.family, 'bounty', `第 ${round} 回合在深潜房里仍然抽到了悬赏`);
      const on = generateDraft(m.gd, m.rngDraft, round, { stageId: m.stageId, allowBounty: true });
      if (on && on.family === 'bounty') sawBountyWhenAllowed = true;
    }
  }
  assert.equal(sawBountyWhenAllowed, true, '允许时应当能抽到悬赏，否则这条测试证明不了什么');
});

test('R1–15 是原版开局：这些回合的草稿照旧允许悬赏（深潜只在进入深潜回合后停用）', () => {
  const m = (makeMatch({ mode: 'coop', humans: 2, seed: 'echo-draft-open', fake: true, variant: 'deepecho' })).m;
  m.echoDiveStart = 16;                     // 典型值：最后一个 boss 回合 15 + 1
  assert.equal(m._echoDiveRound(3), false, 'R3 不是深潜回合');
  assert.equal(m._echoDiveRound(15), false, 'R15 仍不是深潜回合');
  assert.equal(m._echoDiveRound(16), true, 'R16 起才是深潜回合');
});

test('深潜房：关掉悬赏后抽到的仍是合法草稿（有卡、有名字）', () => {
  const m = (makeMatch({ mode: 'coop', humans: 2, seed: 'echo-draft-2', fake: true })).m;
  const d = generateDraft(m.gd, m.rngDraft, 3, { stageId: m.stageId, allowBounty: false });
  assert.ok(d, '第 3 回合应当有草稿');
  assert.notEqual(d.family, 'bounty');
  assert.ok(Array.isArray(d.cards) && d.cards.length > 0, '必须还有可选的卡');
  assert.ok(typeof d.name === 'string' && d.name.length > 0);
});
