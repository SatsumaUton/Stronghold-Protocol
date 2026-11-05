// 炎佑之契（维护者 2026-11-05）：开战召唤 1 只炎佑、存在 20 秒；最多叠 2 次，最多 2 只。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { echoBlessingById, ECHO_BLESSINGS } from '../../server/match/match/echoBlessing.js';

const dive = () => makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 51, fake: true, variant: 'deepecho' });
// 炎佑是 token（底层 defId 是 enemy_9012_acloon），所以按 kind 数
const yanyouOf = (b) => (b.units || []).filter((u) => u && u.alive && u.kind === 'token');

test('炎佑之契：可叠加 2 次，带存在时长', () => {
  const b = echoBlessingById('yanyou_gift');
  assert.ok(b, '祝福要存在');
  assert.equal(b.kind, 'yanyou');
  assert.equal(b.stackable, true);
  assert.equal(b.maxStacks, 2);
  assert.ok(b.lifetime > 0, '要有存在时长');
  assert.ok(ECHO_BLESSINGS.some((x) => x.id === 'yanyou_gift'), '要进三选一池');
});

test('叠加：同一条祝福最多拿 2 次，列表合并成一条带 stacks', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const b = echoBlessingById('yanyou_gift');
  m._echoGrantBlessing(b);
  assert.equal(m.echoBlessings.filter((x) => x === 'yanyou_gift').length, 1, '第 1 次能拿');
  m._echoGrantBlessing(b);
  assert.equal(m.echoBlessings.filter((x) => x === 'yanyou_gift').length, 2, '第 2 次能拿（可叠加）');
  m._echoGrantBlessing(b);
  assert.equal(m.echoBlessings.filter((x) => x === 'yanyou_gift').length, 2, '第 3 次被拒（最多 2 层）');
  const list = m._echoPublic().blessings.filter((x) => x.id === 'yanyou_gift');
  assert.equal(list.length, 1, '列表里合并成一条');
  assert.equal(list[0].stacks, 2);
});

test('开战召唤炎佑：1 层 1 只、2 层 2 只，超时后消失', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['yanyou_gift'];
  const bh = makeBattle({ players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_1_01_a', row: 10, col: 5, dir: 'RIGHT' }], bonds: {}, bandId: null, playerEffects: [] }] });
  m._echoHookBattle(bh.b);
  bh.b.emit('battleStart', {});
  bh.step(1);
  const one = yanyouOf(bh.b);
  assert.equal(one.length, 1, `1 层应当召唤 1 只，实际 ${one.length}`);
  // 2 层
  const h2 = dive();
  t.after(() => h2.m.dispose());
  h2.m.echoBlessings = ['yanyou_gift', 'yanyou_gift'];
  const bh2 = makeBattle({ players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_1_01_a', row: 10, col: 5, dir: 'RIGHT' }], bonds: {}, bandId: null, playerEffects: [] }] });
  h2.m._echoHookBattle(bh2.b);
  bh2.b.emit('battleStart', {});
  bh2.step(1);
  assert.equal(yanyouOf(bh2.b).length, 2, '2 层应当召唤 2 只（上限也是 2）');
  // 存在时长：过了 lifetime 就消失
  const life = echoBlessingById('yanyou_gift').lifetime;
  bh2.run(life + 1);
  assert.equal(yanyouOf(bh2.b).length, 0, `${life} 秒后炎佑应当消失`);
});