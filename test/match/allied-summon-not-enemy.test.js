// test/match/allied-summon-not-enemy.test.js —— 我方召唤物绝不能被当成敌人
// （玩家 2026-11-22：莱塔尼亚「一个小节 / 一个乐部」与谢拉格「不眠雪山」被录进了敌对目标）。
//
// 根因：这几个召唤物在 enemies.json 里是**普通敌人记录**（有血、会走、非 BOSS，也不是 token_ 前缀、
// 不在别人的 summons 里），sim 用 `battle.spawnToken(..., { def })` 把它们当我方单位召出来。
// 深潜的随机出怪池与跨版本注入都只看「能不能用」，于是把它们当敌人抽了出来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { getVersionData } from '../../server/data.js';
import { echoAllPool, echoSummonOnly } from '../../server/match/match/echoWaves.js';
import { crossVersionEnemies, _resetCrossVersionCache } from '../../server/match/match/echoCrossVersion.js';
import { ECHO_ALLIED_ENEMY_KEYS, isEchoAlliedKey } from '../../server/match/match/echoAllied.js';

const QUIET = { warn() {}, error() {}, info() {} };
const DEF = getVersionData('act2autochess', { log: QUIET });
const REG = getVersionData('act3autochess@V3_1', { log: QUIET });
const REGISTRY = createRegistry({ log: QUIET });

/** 深潜房（指定版本数据）。 */
const dive = (data) => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 7, fake: true, variant: 'deepecho', registry: REGISTRY, data }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  return h;
};

test('清单：四个用敌人记录做的我方召唤物都在', () => {
  for (const k of ['enemy_9012_acloon', 'enemy_9025_aclts', 'enemy_9026_acltm', 'enemy_9024_acsgnt']) {
    assert.ok(ECHO_ALLIED_ENEMY_KEYS.includes(k), `${k} 要在清单里`);
    assert.equal(isEchoAlliedKey(k), true);
  }
  // 带版本前缀的同样认得
  assert.equal(isEchoAlliedKey('act3autochess-v3_1:enemy_9025_aclts'), true);
  assert.equal(isEchoAlliedKey('enemy_1005_yokai'), false, '普通敌人不算');
  assert.equal(isEchoAlliedKey(''), false);
});

test('跨版本注入：召唤物不会被注入成敌人', () => {
  _resetCrossVersionCache();
  const extra = crossVersionEnemies(JSON.parse('{}'));
  for (const k of ECHO_ALLIED_ENEMY_KEYS) {
    assert.equal(extra[k], undefined, `${k} 不该被注入`);
    assert.equal(extra[`act3autochess-v3_1:${k}`], undefined, `act3autochess-v3_1:${k} 不该被注入`);
  }
});

for (const [label, data] of [['第二期下半', DEF], ['规程', REG]]) {
  test(`${label} 深潜池：召唤物既不进池子，也被判成召唤物`, (t) => {
    const h = dive(data);
    const m = h.m;
    t.after(() => m.dispose());

    const summonOnly = echoSummonOnly(m.gd);
    const pool = echoAllPool(m.gd, {}).all;
    for (const k of ECHO_ALLIED_ENEMY_KEYS) {
      const hit = pool.find((e) => e.key === k || e.key.endsWith(`:${k}`));
      assert.equal(hit, undefined, `${k} 不该出现在深潜出怪池（实际: ${hit && hit.key}）`);
      // 本版根本没有这条记录时（例如第二期下半没有莱塔尼亚召唤物）不需要标记；
      // 只要它在局内敌人表里，就必须被判成召唤物。
      const present = Object.keys(m.gd.raw.enemies).some((x) => x === k || x.endsWith(`:${k}`));
      if (!present) continue;
      const marked = [...summonOnly].some((x) => x === k || x.endsWith(`:${k}`));
      assert.equal(marked, true, `${k} 要被标成召唤物`);
    }
  });
}

test('规程深潜：召唤物不在本局敌人表里的前缀形态（回归）', (t) => {
  const h = dive(REG);
  const m = h.m;
  t.after(() => m.dispose());
  const prefixed = Object.keys(m.gd.raw.enemies).filter((k) => k.includes(':') && isEchoAlliedKey(k));
  assert.deepEqual(prefixed, [], `不该有带前缀的召唤物：${prefixed.join(',')}`);
  // 但它们作为「本版敌人记录」仍然存在（sim 要用它当 def 召友军）
  for (const k of ECHO_ALLIED_ENEMY_KEYS) {
    if (k === 'enemy_9012_acloon') continue; // 炎佑在不同版本里可能没有
    assert.ok(m.gd.raw.enemies[k], `${k} 作为本版记录应当保留（sim 拿它当友军定义）`);
  }
});
