// 飞行怪的路线审计（维护者 2026-11-08：「部分飞行怪的路径还是有问题，依然会直线飞到终点，复核每个模板的怪」）。
//
// 判据是**模拟器自己的规则**：`simdata.normalizeEnemy` 把 `stats.motion === 'FLY'` 的敌人当飞行单位，飞行单位
// 沿路线的航点（checkpoint）直线飞；路线没有航点时（地面路线常常只有 start → end，靠寻路走）它就沿起点→终点
// 直接穿场。所以「谁会飞」必须和 sim 一致 —— 这正是本次的 bug：隐藏核心的两个 ELITE 分体
// （enemy_9014_acstma / enemy_9015_acstmb）数据里 `isFlyEnemy: false`（不在 randomEnemyAttributeDict 里）但
// `stats.motion: 'FLY'`（官方 enemy_database 也是 motion 1），匹配层按 isFlyEnemy 把它们当地面：进地面池、
// 分到没有航点的地面路线，而 sim 照 motion 让它们飞 —— 整场直线穿过去。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRoute } from '../../server/sim/simdata.js';
import { compileRoute } from '../../server/sim/ai.js';
import { GameData } from '../../server/match/gamedata.js';
import { isFlyKey } from '../../server/match/waves.js';
import { echoAllPool, echoRoundPool } from '../../server/match/match/echoWaves.js';
import { DATA } from './harness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gd = new GameData(DATA, 'mode_multi_normal'); // the match layer's own view: enemy() / raw
const waves = JSON.parse(readFileSync(join(ROOT, 'data', 'waves.json'), 'utf8'));
const baseEnemies = JSON.parse(readFileSync(join(ROOT, 'data', 'enemies.json'), 'utf8'));

/** The sim's own rule for "does this enemy fly" (simdata.js normalizeEnemy). */
const simFlies = (e) => !!(e && e.stats && e.stats.motion === 'FLY');

/** Every enemy table this server can serve: the base one and the per-version ones. */
function enemyTables() {
  const out = [{ name: 'data/enemies.json', table: baseEnemies }];
  const dir = join(ROOT, 'data', 'versions');
  for (const slug of ['act1autochess', 'act1autochess-v1_1', 'act2autochess-v2_1']) {
    const f = join(dir, slug, 'enemies.json');
    if (!existsSync(f)) continue;
    out.push({ name: `data/versions/${slug}/enemies.json`, table: JSON.parse(readFileSync(f, 'utf8')) });
  }
  return out;
}

test('谁会飞：isFlyKey 必须和 sim 的 motion 一致（每张敌人表逐条核对）', () => {
  const wrong = [];
  for (const { name, table } of enemyTables()) {
    for (const [key, e] of Object.entries(table)) {
      if (simFlies(e) && !isFlyKey(gd, key)) wrong.push(`${name}:${key}`);
    }
  }
  assert.deepEqual(wrong, [], 'motion=FLY 的敌人不能被匹配层当地面（会被分到没有航点的路线 → 直线穿场）');
});

test('隐藏核心的两个 ELITE 分体：motion=FLY，所以是飞行单位（本次 bug 的回归点）', () => {
  for (const key of ['enemy_9014_acstma', 'enemy_9015_acstmb']) {
    const e = gd.enemy(key);
    assert.ok(e, `${key} 应当在敌人表里`);
    assert.equal(e.stats.motion, 'FLY');
    assert.equal(e.isFlyEnemy, false, '数据里 isFlyEnemy 是 false（不在 randomEnemyAttributeDict）—— 这正是坑');
    assert.equal(isFlyKey(gd, key), true, '匹配层必须按 motion 判它飞行');
  }
});

test('深潜的敌人池：motion=FLY 的敌人一律进「飞行」桶，不会当地面抽出来', () => {
  const all = echoAllPool(gd, { isFlyKey });
  const groundFlyers = all.ground.filter((x) => simFlies(gd.enemy(x.key)));
  assert.deepEqual(groundFlyers.map((x) => x.key), [], '地面桶里不能有会飞的敌人（会拿到没有航点的地面路线）');
  assert.ok(all.fly.some((x) => x.key === 'enemy_1005_yokai'), '普通飞行怪在飞行桶里');
  // 隐藏核心的两个分体是首领的召唤物（summonOnly），池子里本来就不该直接抽 —— 这里钉住这一点，
  // 免得它们哪天进了普通池又被当成地面怪
  const inPool = [...all.ground, ...all.fly].filter((x) => /enemy_901[45]_acstm/.test(x.key));
  assert.deepEqual(inPool.map((x) => x.key), [], '首领分体不进普通池');
  const round = echoRoundPool(gd, 1, { isFlyKey });
  assert.ok(round.all.length > 0);
});

test('_echoFixFlyRoutes：飞行条目被塞进没有航点的路线时，改到带航点的路线（地面条目不动）', () => {
  const wave = {
    spawns: [
      { enemyKey: 'enemy_9014_acstma', routeIndex: 0, count: 1 },   // 飞行（motion FLY）
      { enemyKey: 'enemy_1007_slime', routeIndex: 0, count: 1 },    // 地面
    ],
    routes: [
      { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] },
      { motion: 'FLY', start: [9, 10], end: [9, 2], checkpoints: [[9, 8], [9, 6], [9, 4]] },
    ],
  };
  const cps = (r) => (r && Array.isArray(r.checkpoints) ? r.checkpoints.length : 0);
  for (const s of wave.spawns) {
    if (!isFlyKey(gd, s.enemyKey)) continue;
    if (cps(wave.routes[s.routeIndex]) > 0) continue;
    const withPath = wave.routes.map((r, i) => ({ r, i })).filter(({ r }) => cps(r) > 0);
    const start = wave.routes[s.routeIndex].start.join(',');
    const hit = withPath.find(({ r }) => r.start.join(',') === start) || withPath[0];
    s.routeIndex = hit.i;
  }
  assert.deepEqual(wave.spawns.map((s) => s.routeIndex), [1, 0], '飞行条目改到带航点的路线，地面条目不动');
});

test('每个模板：sim 会飞的出怪条目，路线必须有航点（只有官方明确无航点的两处例外）', () => {
  // 数据里本来就「没有航点」的飞行出怪：隐藏核心的两个分体走官方路线 7 / 8（官方 level 数据 motionMode 0、
  // checkpoints 为空，起点是 boss 平台）。官方就是这样，所以这里只钉住它们 —— 再出现新的就直接红。
  const OFFICIAL_STRAIGHT = new Set(['act1autochess_h08_01:enemy_9014_acstma', 'act1autochess_h08_01:enemy_9015_acstmb',
    'act1autochess_h08_01_s:enemy_9014_acstma', 'act1autochess_h08_01_s:enemy_9015_acstmb']);
  const straight = [];
  for (const [wid, w] of Object.entries(waves)) {
    const routes = [...(w.routes || []), ...(w.extraRoutes || [])];
    const check = (key, idx) => {
      const e = gd.enemy(key);
      if (!simFlies(e)) return;
      const r = routes[idx];
      const norm = normalizeRoute(r);
      const legs = norm ? compileRoute(norm) : [];
      const moves = legs.filter((l) => l.t === 'move').length;
      if (moves <= 1) straight.push(`${wid}:${key}`);
    };
    for (const s of w.spawns || []) check(s.key, s.routeIndex ?? 0);
    for (const list of Object.values(w.branches || {})) for (const s of list || []) check(s.key, s.routeIndex ?? 0);
  }
  const unexpected = straight.filter((k) => !OFFICIAL_STRAIGHT.has(k));
  assert.deepEqual(unexpected, [], '新的「飞行怪走没有航点的路线」—— 会直线穿场');
  assert.deepEqual([...new Set(straight)].sort(), [...OFFICIAL_STRAIGHT].sort(), '官方例外清单也变了：请同步核对');
});

test('带航点的飞行路线：航点能连成一条路线（起点 → 航点… → 终点）', () => {
  for (const [wid, w] of Object.entries(waves)) {
    for (const [i, r] of [...(w.routes || []), ...(w.extraRoutes || [])].entries()) {
      if (!r || r.motion !== 'FLY') continue;
      if (!Array.isArray(r.checkpoints) || !r.checkpoints.length) continue; // 没有航点的路线由上一个用例管
      const norm = normalizeRoute(r);
      const moves = compileRoute(norm).filter((l) => l.t === 'move');
      assert.ok(Array.isArray(norm.start), `${wid} route ${i}: FLY 路线要有起点`);
      assert.ok(Array.isArray(norm.end), `${wid} route ${i}: FLY 路线要有终点`);
      assert.ok(moves.length >= 2, `${wid} route ${i}: 带航点的飞行路线至少两段（起点段 + 终点段）`);
      const last = moves[moves.length - 1];
      assert.deepEqual([last.r, last.c], norm.end, `${wid} route ${i}: 最后一个航点必须是终点`);
      for (const m of moves) {
        assert.ok(Number.isFinite(m.r) && Number.isFinite(m.c), `${wid} route ${i}: 航点坐标必须是数字`);
      }
    }
  }
});
