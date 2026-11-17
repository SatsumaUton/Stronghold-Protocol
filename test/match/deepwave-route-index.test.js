// 深渊回响「敌人穿墙走」的回归测试（维护者 2026-11-18 玩家反馈）。
//
// 根因：`echoRandomWave` 分配 `routeIndex` 用的是 `stageRoutes()` 的结果（它会把**同图其它模板**的出兵口
// 并进来），但以前只有 `echoAllRoutes`（16 层以后）才把这张表返回给 waves.js 替换 `wave.routes`；
// 1–15 层返回 null → wave.routes 仍是模板自带的几条 → routeIndex 越界 → 战斗层退回 routes[0]
// 甚至「起点→终点」默认直线，敌人便穿过墙体直走。
//
// 钉住：① 任何深度都返回路线表且覆盖所有 routeIndex；② 路线移动方式与敌人一致；③ wave.routes 与索引同源。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { buildNormalWave, isFlyKey, classOf, previewInfo } from '../../server/match/waves.js';
import { echoRandomWave } from '../../server/match/match/echoWaves.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';

const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 3, fake: true });
const gd = h.m.gd;
test.after(() => h.m.dispose());

const tpl = Object.values(gd.raw.waves).find((w) => Array.isArray(w.routes) && w.routes.length);
assert.ok(tpl, '数据里应当有带路线的波次模板');

const isFly = (k) => {
  const e = gd.enemy(String(k).replace(/^.*:/, ''));
  return !!(e && e.stats && e.stats.motion === 'FLY');
};
const helpers = { isFlyKey, classOf, previewInfo, isLeaderTemplate: () => false, roundMods: () => ({}) };

for (const allRoutes of [false, true]) {
  test(`任何深度都带回路线表，且所有 routeIndex 落在表内（echoAllRoutes=${allRoutes}）`, () => {
    let checked = 0;
    for (const depth of [8, 12, 16, 24]) {
      const rng = createRng(deriveSeed(7, `echo:wave:${depth}:${allRoutes}`));
      const w = echoRandomWave(gd, tpl, {
        echoGrowth: 1.6, echoScale: 1.2, echoBudget: 2000, echoTimeLimit: 180, echoDepth: depth,
        echoAllRoutes: allRoutes, echoTemplates: true, echoPoolAll: depth >= 16,
      }, rng, helpers);
      if (!w) continue;
      checked++;
      assert.ok(Array.isArray(w.routes) && w.routes.length, `★ 第 ${depth} 层必须带回路线表（以前 1–15 层是 null）`);
      for (const s of w.spawns) {
        assert.ok(Number.isInteger(s.routeIndex) && s.routeIndex < w.routes.length,
          `★ 第 ${depth} 层 ${s.enemyKey} 的 routeIndex=${s.routeIndex} 越界（routes=${w.routes.length}）`);
        const route = w.routes[s.routeIndex];
        assert.equal(!!(route && route.motion === 'FLY'), isFly(s.enemyKey),
          `★ ${s.enemyKey} 的移动方式与路线不符：fly=${isFly(s.enemyKey)} route.motion=${route && route.motion}`);
      }
    }
    assert.ok(checked > 0, '至少要生成出一波');
  });
}

test('buildNormalWave：深潜波次的 routes 与 spawns 的索引同源', () => {
  const rng = createRng(deriveSeed(11, 'echo:normal-wave'));
  const wave = buildNormalWave(gd, rng, [], 12, {
    dataRound: 4, echoGrowth: 1.6, echoShapeScale: 1.6, echoDepth: 12, echoPoolAll: false,
    echoPoolRoundOnly: false, echoTemplates: true, echoAllRoutes: false, echoSkipSeeds: true, echoBudget: 2000,
  });
  if (!wave || !Array.isArray(wave.spawns) || !wave.spawns.length) return;
  assert.ok(Array.isArray(wave.routes) && wave.routes.length, '波次必须带路线表');
  for (const s of wave.spawns) {
    assert.ok(s.routeIndex < wave.routes.length, `★ ${s.enemyKey} 的 routeIndex 必须落在 wave.routes 内`);
  }
});
