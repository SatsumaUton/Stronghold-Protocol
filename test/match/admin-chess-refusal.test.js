// 管理员工具「干员」页签的拒绝原因（维护者 2026-11-18：以前只显示「无效的目标」）。
//
// acquireChess（server/match/player/acquire.js:66）有四个拒绝分支，_testChess 现在逐条给出 detail：
//   no-such-chess  没有这个干员
//   diy-empty      这是自选位但本局没编入
//   bond-unpicked  本局还没选盟约
//   excluded       本局被禁用（所属盟约置灰）
//   grant-failed   拿不出来（手牌满 / 池子空）
// 客户端 ui/testAudit.js 的 explainTestDetail 把它们翻成人话。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

const setup = (t) => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 5, fake: true, test: true });
  t.after(() => h.m.dispose());
  h.start();
  h.toPrep();
  const ps = h.ps('p_0');
  const cmd = (args) => h.m.applyTestCommand(ps, { cmd: 'chess', args });
  return { h, ps, cmd };
};

test('id 拼错 → no-such-chess（不再是裸的「无效的目标」）', (t) => {
  const { cmd } = setup(t);
  const r = cmd({ id: 'chess_there_is_no_such' });
  assert.equal(r.error, 'BAD_TARGET');
  assert.equal(r.detail, 'no-such-chess');
});

test('自选位没编入 → diy-empty', (t) => {
  const { h, cmd } = setup(t);
  const diyId = Object.keys(h.m.gd.raw.chess || {}).find((id) => {
    const r = h.m.gd.chess(id);
    return r && r.isDiy && !r.diyFor;
  });
  if (!diyId) return t.skip('这一版数据没有空着的自选位');
  const r = cmd({ id: diyId });
  assert.equal(r.error, 'BAD_TARGET');
  assert.equal(r.detail, 'diy-empty', '★ 自选位要明确说「本局没编入」，而不是「无效的目标」');
});

test('可拿的干员照常成功（改动没有把正常路径也挡住）', (t) => {
  const { h, cmd } = setup(t);
  // 找一个本局没被禁、也不是自选位的普通干员
  const id = Object.keys(h.m.gd.raw.chess || {}).find((k) => {
    const r = h.m.gd.chess(k);
    return r && !r.isDiy && !h.m.chessExcluded(r);
  });
  assert.ok(id, '数据里应当有可拿的干员');
  const r = cmd({ id });
  assert.deepEqual(r, { ok: true }, `拿 ${id} 应当成功`);
});

test('被禁用的干员：管理员工具也能发出来（原版发不出来，这是维护者要求放开的）', (t) => {
  const { h, cmd } = setup(t);
  const ps = h.ps('p_0');
  const id = Object.keys(h.m.gd.raw.chess || {}).find((k) => {
    const r = h.m.gd.chess(k);
    return r && !r.isDiy;
  });
  assert.ok(id, '数据里应当有普通干员');
  const rec = h.m.gd.chess(id);
  // 确定性地把这条判成「本局置灰」：规程的置灰靠随机抽禁用盟约，测试里直接钉住这个判据。
  const real = h.m.chessExcluded;
  h.m.chessExcluded = (r) => (r === rec ? true : real.call(h.m, r));
  t.after(() => { h.m.chessExcluded = real; });
  assert.equal(h.m.chessExcluded(rec), true, '前提：这条被本局禁用');

  // ① 非管理员路径（购买 / 奖励 / 效果）仍然拒绝
  assert.equal(ps.acquireChess(id, { source: 'reward' }), null, '★ 非管理员路径不能绕过本局禁用');

  // ② 管理员指令可以发出来
  const r = cmd({ id });
  assert.deepEqual(r, { ok: true }, '★ 管理员指令要能发出被置灰的干员');
  const owned = [...ps.hand, ...(ps.temp || [])].some((p) => p && p.id === id);
  assert.equal(owned, true, '发出来之后要真的在手里');
});

test('自选位仍然拒绝：那是「没编入」，不是「被禁用」', (t) => {
  const { h, cmd } = setup(t);
  const diyId = Object.keys(h.m.gd.raw.chess || {}).find((id) => {
    const r = h.m.gd.chess(id);
    return r && r.isDiy && !r.diyFor;
  });
  if (!diyId) return t.skip('这一版数据没有空着的自选位');
  h.m.chessExcluded = () => false;
  const r = cmd({ id: diyId });
  assert.equal(r.error, 'BAD_TARGET');
  assert.equal(r.detail, 'diy-empty', '放开「被禁用」不能顺带放开「自选位没编入」');
});
