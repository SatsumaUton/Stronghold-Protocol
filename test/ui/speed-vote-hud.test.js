// 战斗 2 倍速那个开关上的票数（3/3、1/3）什么时候显示。
//
// 玩家报的问题：票已经投完、对局已经在 2 倍速上跑了，开关上还挂着「3/3」。
// 那两个数字这时候说明不了任何事 —— 标签「本场 2 倍速」已经讲完了。
//
// 但不能一刀切全隐藏：'ending'（这一场是 2 倍速，可下一场的票数掉到不够了）那个 1/3
// 正是在提示还差几票，得留着；'next' / 'idle' 更不用说，票数就是进度。
//
// 规则放在 ui/matchStatus.js 的 speedVoteCountShown()，这里测两件事：
//   1. 四个状态各自该不该显示（纯函数，直接测）；
//   2. hud.js 的 SpeedVote 真的按它来（观战席本来就不显示票数）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { speedVoteCountShown, speedVoteState, battleSpeedScale } from '../../public/js/ui/matchStatus.js';
import { PHASE } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hud = readFileSync(path.join(ROOT, 'public/js/ui/hud.js'), 'utf8');

describe('speedVoteCountShown：什么时候收起票数', () => {
  test('票过了、已经在 2 倍速、下一场也定了（on）→ 收起', () => {
    assert.equal(speedVoteCountShown({ status: 'on', count: 3, need: 3 }), false);
  });

  test('这一场是 2 倍速但下一场票不够（ending）→ 留着，1/3 是提示', () => {
    assert.equal(speedVoteCountShown({ status: 'ending', count: 1, need: 3 }), true);
  });

  test('还没到 2 倍速（next / idle）→ 留着，票数就是进度', () => {
    assert.equal(speedVoteCountShown({ status: 'next', count: 2, need: 3 }), true);
    assert.equal(speedVoteCountShown({ status: 'idle', count: 1, need: 3 }), true);
  });

  test('没有状态（开关整个不显示）→ 不显示票数', () => {
    assert.equal(speedVoteCountShown(null), false);
    assert.equal(speedVoteCountShown(undefined), false);
  });
});

describe('speedVoteState 的四个状态和 speedVoteCountShown 对得上', () => {
  const pub = (phase, speedVote) => ({ phase, speedVote });
  // m.public.speedVote 的形状（server/match/match/speedVote.js speedVoteView）：
  // agreed 是同意的人、need 是门槛、next 是「下一场也够了」、on 是「这一场已经在 2 倍速上跑」。
  const vote = (agreed, need, { next = false, on = false } = {}) => ({ agreed, need, next, on });

  test('战斗中票够了 → on，票数收起', () => {
    const p = pub(PHASE.COMBAT, vote(['a', 'b', 'c'], 3, { next: true, on: true }));
    const v = speedVoteState(p, 'a');
    assert.equal(v.status, 'on');
    assert.equal(battleSpeedScale(p), 2, '这一场的实时时钟走 2 倍');
    assert.equal(speedVoteCountShown(v), false);
  });

  test('战斗中票不够 → ending，票数留着', () => {
    const p = pub(PHASE.COMBAT, vote(['a'], 3, { next: false, on: true }));
    const v = speedVoteState(p, 'a');
    assert.equal(v.status, 'ending');
    assert.equal(speedVoteCountShown(v), true);
    assert.equal(v.count, 1);
    assert.equal(v.need, 3);
  });

  test('备战期票够了 → next，票数留着', () => {
    const p = pub(PHASE.PREP, vote(['a', 'b'], 3, { next: true }));
    const v = speedVoteState(p, 'a');
    assert.equal(v.status, 'next');
    assert.equal(speedVoteCountShown(v), true);
  });

  test('备战期票不够 → idle，票数留着', () => {
    const p = pub(PHASE.PREP, vote(['a'], 3));
    const v = speedVoteState(p, 'a');
    assert.equal(v.status, 'idle');
    assert.equal(speedVoteCountShown(v), true);
  });
});

describe('hud.js 的 SpeedVote 按这个规则渲染', () => {
  test('票数那段受 speedVoteCountShown 控制，且观战席不显示', () => {
    assert.match(hud, /import \{[^}]*speedVoteCountShown[^}]*\} from '\.\/matchStatus\.js'/);
    assert.match(hud, /const showCount = !spectator && speedVoteCountShown\(v\)/);
    assert.match(hud, /\$\{showCount \? html`<span class="speedvote__count num">\$\{count\}<\/span>` : null\}/);
  });

  test('aria-label 跟着一起收，不会屏幕阅读器还念 3/3', () => {
    assert.match(hud, /aria-label=\$\{showCount \? `\$\{label\} \$\{count\}` : label\}/);
  });

  test('没有残留的无条件渲染票数', () => {
    assert.doesNotMatch(hud, /spectator \? null : html`<span class="speedvote__count/);
    assert.doesNotMatch(hud, /speedvote__count num">\$\{v\.count\}\/\$\{v\.need\}/);
  });
});
