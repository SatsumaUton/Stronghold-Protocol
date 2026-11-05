// 祝福三选一的「刷新投票」：投完必须变成已投状态（维护者 2026-11-05 二次反馈）。
//
// 症状：点「同意」或「不同意」之后没有任何变化 —— 两个按钮都还在、还能继续点，
// 玩家不知道自己那一票到底交没交。
//
// 原因：服务端只把 `agreed` 和 `voters` 发下来，没有发**明确拒绝**的那批人，
// 客户端因此算不出「我投了什么」，只能一直画两个按钮。
//
// 修法：服务端补 `rejected`；客户端用 refreshVoteState() 算出 true/false/null，
// 投过之后把两个按钮整组换成只读的「已同意 / 已拒绝 · 等待其他人…」角标。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch } from '../match/harness.js';
import { refreshVoteState } from '../../public/js/ui/echoBlessing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// 4 人房：门槛是 ceil(0.75 × 4) = 3 票，所以「一票同意 / 一票反对」都不会立刻结算，
// 状态才看得到（1 人房提案人一票就过半、2 人房一票反对就没戏，都会当场结算掉）
const dive = () => makeMatch({ mode: 'coop', humans: 4, bots: 0, seed: 11, fake: true, variant: 'deepecho' });

/** 开一个「刷新三选一」的投票（需要先有三选一的候选）。 */
function openVote(t) {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 5;
  const ps = h.ps('p_0');
  // 直接挂一组候选，不依赖具体回合的抽取
  m.echoBlessingOffer = ['atk_s', 'hp_s', 'def_s'];
  m._echoBlessingRound = m.round;
  m.requestEchoBlessingRefresh(ps);
  assert.ok(m.echoBlessingRefreshVote, '投票要开起来');
  return { h, m, ps };
}

test('refreshVoteState：同意 / 不同意 / 还没投', () => {
  const vote = { agreed: ['p_0', 'p_1'], rejected: ['p_2'], voters: ['p_0', 'p_1', 'p_2'] };
  assert.equal(refreshVoteState(vote, 'p_0').myVote, true, '在 agreed 里 = 同意');
  assert.equal(refreshVoteState(vote, 'p_2').myVote, false, '在 rejected 里 = 不同意');
  assert.equal(refreshVoteState(vote, 'p_9').myVote, null, '两边都不在 = 还没投');
  assert.equal(refreshVoteState(vote, null).myVote, null, '没有身份时不算投过');
  const st = refreshVoteState(vote, 'p_0');
  assert.equal(st.yes, 2);
  assert.equal(st.total, 3);
  // 字段缺失 / 空投票也不炸
  assert.deepEqual(refreshVoteState(null, 'p_0'), { myVote: null, yes: 0, total: 1 });
  assert.deepEqual(refreshVoteState({ agreed: ['p_0'] }, 'p_0'), { myVote: true, yes: 1, total: 1 });
});

test('服务端把「明确拒绝」的人一起发下来（客户端才画得出已投）', (t) => {
  const { m, ps } = openVote(t);
  // 提案人默认算同意
  let vote = m._echoPublic().blessingRefresh.vote;
  assert.deepEqual(vote.agreed, [ps.playerId]);
  assert.deepEqual(vote.rejected, []);
  assert.equal(refreshVoteState(vote, ps.playerId).myVote, true, '提案人自己是已同意');
  // 改投不同意：两边都要跟着变
  m.setEchoBlessingRefreshVote(ps, false);
  vote = m._echoPublic().blessingRefresh.vote;
  assert.ok(vote, '4 人房一票反对不足以结算，投票还要开着');
  assert.equal(vote.agreed.includes(ps.playerId), false);
  assert.equal(vote.rejected.includes(ps.playerId), true);
  assert.equal(refreshVoteState(vote, ps.playerId).myVote, false, '改投后是已拒绝');
});

test('面板：投过之后按钮整组消失，只剩只读角标', () => {
  const src = read('public/js/ui/echoBlessing.js');
  // 计算「我投了什么」走统一的纯函数
  assert.match(src, /const \{ myVote, yes, total \} = refreshVoteState\(refreshVote, myId\);/);
  // 两个按钮只在「还没投」的分支里
  const branch = src.slice(src.indexOf('${myVote == null ? html`'), src.indexOf('${leftSec != null ?'));
  assert.match(branch, /echoBlessingRefreshVote\(true\)/, '同意按钮在未投分支');
  assert.match(branch, /echoBlessingRefreshVote\(false\)/, '不同意按钮在未投分支');
  // 已投分支：只读角标，没有 onClick
  const voted = src.slice(src.indexOf('echo-bless__rbtn is-voted'), src.indexOf('${leftSec != null ?'));
  assert.ok(voted.length > 0, '要有已投角标');
  assert.doesNotMatch(voted.slice(0, voted.indexOf('`}')), /onClick/, '已投角标不能可点');
  assert.match(src, /is-voted/, '胶囊要带 is-voted 状态');
});

test('样式：投票条是胶囊（不是裸文字 + 默认按钮）', () => {
  const css = read('public/css/screens/game-panels.css');
  assert.match(css, /\.echo-bless__refreshvote \{[\s\S]*?border-radius: 999px/);
  assert.match(css, /\.echo-bless__rv-bar/, '要有进度条');
  assert.match(css, /\.echo-bless__rbtn\.is-voted \{[\s\S]*?cursor: default/, '已投是只读，不能显示可点');
});
