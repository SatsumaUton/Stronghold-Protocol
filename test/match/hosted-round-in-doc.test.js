// test/match/hosted-round-in-doc.test.js —— 规程房（跑在版本宿主里）的存档必须带回合数
// （玩家 2026-11-22：节点控制台里规程版本的深渊回响保存房间，重启后没有回合数了）。
//
// 根因链：
//   ① 规程房 `room.match` 是 MatchProxy，以前没有 `round`/`phase` 属性；
//   ② persister.matchRef 读 `m.round` → 写成 `doc.match.round = null`；
//   ③ matchmaker 在 `matchLive=false`（重启后）时只认 snapshotRound → 控制台显示「—」。
// 修法：proxy 从 m.public 记下进度；matchRef 再退回 room.liveRound；matchmaker 不再按 matchLive 分支；
//      对局结束时 lobby.onMatchEnd 把 liveRound 清零（避免显示上一局的回合）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MatchProxy } from '../../server/match/host/proxy.js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const read = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8');

/** 一个不真的连 worker 的 host：post 只记录。 */
const fakeHost = () => ({ posted: [], post(m) { this.posted.push(m); } });

const makeProxy = () => new MatchProxy({
  host: fakeHost(),
  matchId: 'm1',
  opts: { roomCode: 'TEST', broadcast: () => {}, send: () => {}, onEnd: () => {} },
  log: { info() {}, warn() {}, error() {} },
});

test('MatchProxy 从 m.public 记下 round / phase', () => {
  const p = makeProxy();
  assert.equal(p.round, null, '初始为 null');
  assert.equal(p.phase, null);
  // 模拟 worker 推来的 m.public（扁平帧，与 views.js publicView 一致）
  p.deliver({ type: 'broadcast', matchId: 'm1', msg: { t: 'm.public', phase: 'PREP', round: 11, players: [] } });
  assert.equal(p.round, 11, 'round 要记下来');
  assert.equal(p.phase, 'PREP');
  // 其它帧不影响
  p.deliver({ type: 'broadcast', matchId: 'm1', msg: { t: 'm.toast', text: 'x' } });
  assert.equal(p.round, 11);
  // round 0 也要记（准备阶段）
  p.deliver({ type: 'broadcast', matchId: 'm1', msg: { t: 'm.public', phase: 'INFO_CHECK', round: 0 } });
  assert.equal(p.round, 0);
});

test('persister.matchRef：宿主对局取不到 m.round 时退回 room.liveRound', () => {
  const src = read('server/persist/persister.js');
  const i = src.indexOf('matchRef(room)');
  assert.ok(i > 0, '有 matchRef');
  const body = src.slice(i, src.indexOf('\n  }', i));
  assert.match(body, /Number\(m\.round\)/, '先读对局自己的 round');
  assert.match(body, /room\.liveRound|liveRound/, '取不到时退回 room.liveRound');
  assert.ok(!/round: Number\.isFinite\(m\.round\) \? m\.round : null/.test(body), '不能再用「取不到就 null」的老写法');
});

test('lobby.onMatchEnd 会对局结束时清掉 liveRound（避免显示上一局回合）', () => {
  const src = read('server/lobby.js');
  const i = src.indexOf('room.lastEndReason = summary');
  assert.ok(i > 0, '有 onMatchEnd');
  const around = src.slice(i, i + 600);
  assert.match(around, /room\.liveRound = 0/, '要清零');
  assert.match(around, /room\.livePhase = null/, '要清空 phase');
});

test('matchmaker 的回合数不再按 matchLive 分支', () => {
  const src = read('matchmaker/server.js');
  assert.ok(!src.includes('doc.matchLive ? (liveRound || snapshotRound || 0) : snapshotRound'), '旧分支要去掉');
  assert.match(src, /const round = liveRound \|\| snapshotRound \|\| 0;/, '两者谁有值用谁');
});
