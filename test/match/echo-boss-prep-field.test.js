// 「深渊回响」深潜的 boss 返场（25 / 35 / 45 层）在准备阶段也要站在 **boss 专用场地**上。
//
// 维护者 2026-11-05 报的问题：25 / 35 层自己是普通准备场地，切到别人的视角（scout）却是 boss 场地。
// 根因：客户端 `prepCamera` 只认原版 mode 的两个固定回合（`m.public.bossRound` / `hiddenRound` = 14 / 15），
// 深潜的返场 boss 不在 mode 配置里；而 scout 视角走服务端 `bossGroupOf()`，所以两边不一致。
// 现在客户端读服务端发的 `m.public.echo.bossRound`（echoPhase `_echoBossReturn()`），两边同源。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { prepCamera, deployFieldOf, bossRoundNow } from '../../public/js/ui/gameLogic/camera.js';

const dive = (seed = 21) => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed, fake: true, variant: 'deepecho' });

/** 跳到某一回合的准备阶段（借 startRound，和深潜集成测试同一手法）。 */
function prepAt(h, round) {
  h.m.round = round - 1;
  h.m.startRound(round);
  h.drive(() => h.m.phase === PHASE.PREP && h.m.round === round);
  return h.m.publicView();
}

for (const round of [14, 25, 35]) test(`深潜第 ${round} 层：自己的准备视角也是 boss 场地，且与服务端一致`, (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const pub = prepAt(h, round);
  assert.equal(pub.round, round);
  assert.equal(pub.phase, PHASE.PREP, '停在准备阶段');
  assert.equal(pub.echo?.bossRound, true, `${round} 层是 boss 关（服务端判定）`);
  assert.equal(bossRoundNow(pub), true);
  for (const p of m.alivePlayers()) {
    const cam = prepCamera(pub, p.playerId);
    assert.equal(cam.kind, 'bossPrep', `${round} 层自己视角必须是 boss 准备场地`);
    const g = m.bossGroupOf(p);
    assert.ok(g, '服务端有 boss 分组');
    assert.equal(cam.opts.side, g.side, '左右半边与服务端分组一致');
    const field = deployFieldOf(pub, p.playerId);
    assert.equal(field, m.deployFieldOf(p), '客户端部署场地与服务端一致');
    assert.equal(field, g.side === 'R' ? 'bossR' : 'bossL');
  }
});

for (const round of [21, 26]) test(`深潜第 ${round} 层不是 boss 关：准备阶段仍是普通场地`, (t) => {
  const h = dive(22);
  const m = h.m;
  t.after(() => m.dispose());
  const pub = prepAt(h, round);
  assert.equal(pub.round, round);
  assert.equal(pub.echo?.bossRound, false);
  assert.equal(bossRoundNow(pub), false);
  for (const p of m.alivePlayers()) {
    assert.equal(prepCamera(pub, p.playerId).kind, 'prep');
    assert.equal(deployFieldOf(pub, p.playerId), 'normal');
  }
});

test('原版房间不受影响：mode 的 bossRound / hiddenRound 仍然决定 boss 准备场地', () => {
  const base = {
    phase: PHASE.PREP, bossRound: 14, hiddenRound: 15,
    players: [{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }], bossPairs: [['a', 'b']],
  };
  assert.equal(prepCamera({ ...base, round: 14 }, 'a').kind, 'bossPrep');
  assert.equal(prepCamera({ ...base, round: 15 }, 'b').kind, 'bossPrep');
  assert.equal(prepCamera({ ...base, round: 13 }, 'a').kind, 'prep');
  // 没有 echo 块的房间绝不会因为别的字段被当成 boss 关
  assert.equal(bossRoundNow({ ...base, round: 25 }), false);
  // 深潜里 14 层仍然走 boss 场地（echo.bossRound 之外的那条老路径不冲突）
  assert.equal(bossRoundNow({ ...base, round: 25, echo: { bossRound: true } }), true);
});
