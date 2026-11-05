// 谢拉格寒风祝福（维护者 2026-11-05）：「朔风」每 interval 秒刮一阵，让全场敌人寒冷 duration 秒。
// 直接复用原版盟约实现（sim/content/devices.js startColdWind），所以口径与谢拉格满档一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { echoBlessingById, ECHO_BLESSINGS } from '../../server/match/match/echoBlessing.js';

const dive = () => makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 41, fake: true, variant: 'deepecho' });
const isCold = (e) => !!(e && e.s && e.s.flags && (e.s.flags.cold || e.s.flags.freeze));

test('朔风：在祝福池里，带间隔与持续时间', () => {
  const b = echoBlessingById('kjerag_wind');
  assert.ok(b, '祝福要存在');
  assert.equal(b.kind, 'coldwind');
  assert.ok(b.interval > 0 && b.duration > 0, '要有间隔与持续时间');
  assert.ok(ECHO_BLESSINGS.some((x) => x.id === 'kjerag_wind'), '要进三选一池');
});

test('朔风：每 interval 秒让全场敌人寒冷一次', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.echoBlessings = ['kjerag_wind'];
  // 血量拉满，保证它在两阵风之间不会被打死 / 漏掉
  const bh = makeBattle({ enemies: [{ key: 'enemy_1007_shield', mods: { hpMul: 500, speedMul: 0 } }], content: 'none', autoFinish: false });
  const b = bh.b;
  m._echoHookBattle(b);
  bh.step(1);
  const e = (b.enemies || [])[0];
  assert.ok(e, '敌人要在 step 之后出场');
  const iv = echoBlessingById('kjerag_wind').interval;
  assert.equal(isCold(e), false, '还没到第一阵风');
  bh.run(iv + 0.5);
  assert.ok(isCold(e), '第一阵风要挂上寒冷');
  // 寒风的持续时间过了之后会消失，下一阵风再来（按秒采样，避免时序算错）
  const dur = echoBlessingById('kjerag_wind').duration;
  bh.run(dur + 0.5);
  assert.equal(isCold(e), false, `寒冷 ${dur} 秒后应当消失`);
  let again = false;
  for (let i = 0; i < iv + 2 && !again; i++) { bh.run(1); if (isCold(e)) again = true; }
  assert.ok(again, '下一阵风要再次寒冷');
});
