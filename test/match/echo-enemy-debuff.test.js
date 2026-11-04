// 「深渊回响」对敌异常祝福：敌人生成时按概率挂 debuff（维护者 2026-11-05）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchEcho } from '../../server/match/match/echoPhase.js';

const P = MatchEcho.prototype;

/** 造一个只带 _echoHookBattle 所需字段的假对局 + 假战斗。 */
function setup(blessings, rngValue) {
  const handlers = [];
  const battle = {
    on(ev, fn, opts) { handlers.push({ ev, fn, opts }); },
    addBuff(enemy, buff) { enemy.buffs.push(buff); return buff; },
    rng: () => rngValue,
  };
  const m = Object.assign(Object.create(P), {
    echoVariant: 'deepecho',
    echoBlessings: blessings,
    echoWordsActive: null,
    _echoWords: () => [],
  });
  P._echoHookBattle.call(m, battle);
  const spawn = handlers.find((h) => h.ev === 'enemySpawn');
  return { spawn, battle };
}

test('概率命中时给敌人挂上对应的 debuff', () => {
  const { spawn } = setup(['frostbite', 'vulnerable'], 0);
  assert.ok(spawn, '必须注册 enemySpawn 钩子');
  const enemy = { buffs: [] };
  spawn.fn({ enemy });
  assert.equal(enemy.buffs.length, 2, '两条祝福各挂一个');
  const keys = enemy.buffs.map((b) => b.key);
  assert.ok(keys.includes('echo:bless:frost'));
  assert.ok(keys.includes('echo:bless:vuln'));
  for (const b of enemy.buffs) assert.equal(b.persist, true);
});

test('概率没中时不挂；没有这两条祝福时也不挂', () => {
  const miss = setup(['frostbite'], 0.99);
  const e1 = { buffs: [] };
  miss.spawn.fn({ enemy: e1 });
  assert.equal(e1.buffs.length, 0, 'rng 高于概率 → 不挂');

  const none = setup(['fund'], 0);
  const e2 = { buffs: [] };
  if (none.spawn) none.spawn.fn({ enemy: e2 });
  assert.equal(e2.buffs.length, 0, '没抽到这两条祝福 → 不挂');
});

test('同一敌人不会重复挂同一个 key', () => {
  const { spawn } = setup(['frostbite'], 0);
  const enemy = { buffs: [] };
  spawn.fn({ enemy });
  spawn.fn({ enemy });
  assert.equal(enemy.buffs.filter((b) => b.key === 'echo:bless:frost').length, 1);
});
