// 反隐匿祝福（维护者 2026-11-05）：「照破」周期性现形，「洞彻」永久反隐。
// 隐匿敌人默认不可选中（sim/content/targeting.js: f.stealth && !f.reveal），
// 所以这两条祝福走的是 `flags.reveal` 的 buff。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { echoBlessingById, ECHO_BLESSINGS } from '../../server/match/match/echoBlessing.js';

const dive = (o = {}) => makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 31, fake: true, variant: 'deepecho', ...o });
const hasReveal = (e) => (e.buffs || []).some((x) => x && x.key === 'echo:reveal' && x.flags && x.flags.reveal);

test('反隐匿祝福：一条周期性、一条永久，都在祝福池里', () => {
  const pulse = echoBlessingById('reveal_pulse');
  const always = echoBlessingById('reveal_always');
  assert.ok(pulse && always, '两条祝福都要存在');
  assert.equal(pulse.kind, 'reveal');
  assert.equal(always.kind, 'reveal');
  assert.ok(pulse.interval > 0 && pulse.duration > 0, '周期性那条要有间隔与持续时间');
  assert.equal(always.always, true);
  assert.ok(ECHO_BLESSINGS.some((b) => b.id === 'reveal_pulse'), '要进祝福池（三选一能抽到）');
  assert.ok(ECHO_BLESSINGS.some((b) => b.id === 'reveal_always'));
});

test('「洞彻」：敌人一生成就永久反隐，hidden 也被拉回可见', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['reveal_always'];
  const bh = makeBattle({ enemies: [{ key: 'enemy_1007_shield' }], content: 'none', autoFinish: false });
  const b = bh.b;
  m._echoHookBattle(b);
  bh.step(1);
  const e = (b.enemies || [])[0];
  assert.ok(e, '敌人要在 step 之后出场');
  assert.ok(hasReveal(e), '洞彻要挂永久 reveal');
  e.hidden = true;
  b.emit('enemySpawn', { enemy: e });
  assert.equal(e.hidden, false, 'hidden 要被拉回可见');
});

test('「照破」：每 interval 秒给敌人挂一次限时 reveal', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['reveal_pulse'];
  const bh = makeBattle({ enemies: [{ key: 'enemy_1007_shield' }], content: 'none', autoFinish: false });
  const b = bh.b;
  m._echoHookBattle(b);
  bh.step(1);
  const e = (b.enemies || [])[0];
  assert.ok(e, '敌人要在 step 之后出场');
  const pulse = echoBlessingById('reveal_pulse');
  // 出场时就会现形（对新生敌人立即生效），持续 duration 秒后消失，下一个 interval 再来一次
  assert.ok(hasReveal(e), '出场即现形');
  bh.run(pulse.duration + 0.5);
  assert.equal(hasReveal(e), false, `现形 ${pulse.duration} 秒后应当消失`);
  bh.run(pulse.interval - pulse.duration + 1);
  assert.ok(hasReveal(e), '下一个周期要再次现形');
});
