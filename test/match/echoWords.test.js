// 深渊回响词条（DESIGN-ABYSS-CODE/echoWords.js）的单元测试。
//
// 重点守两件事：
//   1. buff 的 mods 键必须是 server/sim/units.js 真正会读的那几个（写错就是空转）
//   2. 注入是幂等的（同一敌人不重复叠同一条词条）
import { test } from 'node:test';
import { ENEMY_MOD_KEYS } from '../helpers/unitModKeys.js';
import assert from 'node:assert/strict';
import {
  ECHO_WORDS, ECHO_WORD_PREFIX, echoWordById, echoWordsForRound, applyEchoWords,
} from '../../server/match/match/echoWords.js';

/** units.js 属性重算里真实读取的 mods 键（2026-11-03 从 units.js 提取）。 */
// \u767d\u540d\u5355\u5df2\u62bd\u5230 test/helpers/unitModKeys.js\uff0c\u4e0e\u795d\u798f\u6d4b\u8bd5\u5171\u7528\u540c\u4e00\u4efd
const VALID_MOD_KEYS = ENEMY_MOD_KEYS;


test('词条池：20 条，id/name/描述都在', () => {
  assert.equal(ECHO_WORDS.length, 20);
  for (const w of ECHO_WORDS) {
    assert.ok(w.id && w.name && w.desc, '每条都要有 id/name/desc');
    assert.equal(typeof w.buffFor, 'function');
    assert.equal(echoWordById(w.id), w);
  }
  assert.equal(echoWordById('nope'), null);
});

test('所有 mods 键都是 units.js 真会读的键（防写错导致 buff 空转）', () => {
  const enemy = { base: { maxHp: 1000 }, buffs: [] };
  for (const w of ECHO_WORDS) {
    const buff = w.buffFor(enemy);
    assert.ok(buff.key.startsWith(ECHO_WORD_PREFIX), `${w.id} 的 key 要带前缀`);
    assert.equal(buff.persist, true, '词条要常驻');
    if (buff.mods) {
      for (const k of Object.keys(buff.mods)) {
        assert.ok(VALID_MOD_KEYS.has(k), `${w.id} 的 mods 键 ${k} 不在 units.js 的读取列表里`);
      }
    }
  }
});

test('护盾按最大生命的 30% 算，且不会是 0', () => {
  const shield = ECHO_WORDS.find((w) => w.id === 'shield');
  assert.equal(shield.buffFor({ base: { maxHp: 1000 } }).shield, 300);
  assert.equal(shield.buffFor({ base: { maxHp: 10 } }).shield, 3);
  assert.ok(shield.buffFor({ base: { maxHp: 1 } }).shield >= 1, '极低血量也至少 1');
});

test('词条按「每 3 个深潜回合叠一条」发放，且不重复', () => {
  const seq = [0.1, 0.6, 0.9, 0.3];
  let i = 0;
  const rng = () => seq[(i++) % seq.length];
  assert.deepEqual(echoWordsForRound(14, 15, rng), [], '深潜之前没有词条');
  assert.equal(echoWordsForRound(15, 15, rng).length, 1, '深潜第 1 回合 1 条');
  assert.equal(echoWordsForRound(17, 15, rng).length, 1, '第 3 回合仍是 1 条');
  assert.equal(echoWordsForRound(18, 15, rng).length, 2, '第 4 回合起 2 条');
  assert.equal(echoWordsForRound(21, 15, rng).length, 3, '第 7 回合 3 条');
  const many = echoWordsForRound(30, 15, rng);
  assert.equal(many.length, 3, '上限 3 条，不无限叠');
  assert.equal(new Set(many.map((w) => w.id)).size, many.length, '同一条不重复出现');
});

test('同一回合 + 同一随机序列 → 同样的词条（确定性）', () => {
  const make = () => { let i = 0; const s = [0.7, 0.2, 0.5]; return () => s[(i++) % s.length]; };
  const a = echoWordsForRound(21, 15, make()).map((w) => w.id);
  const b = echoWordsForRound(21, 15, make()).map((w) => w.id);
  assert.deepEqual(a, b);
});

test('注入幂等：同一敌人不重复挂同一条词条', () => {
  const added = [];
  const battle = { addBuff: (enemy, buff) => { added.push(buff.key); (enemy.buffs ||= []).push(buff); } };
  const enemy = { base: { maxHp: 1000 }, buffs: [] };
  const words = [ECHO_WORDS[1], ECHO_WORDS[2]];
  assert.equal(applyEchoWords(battle, enemy, words), 2, '第一次挂两条');
  assert.equal(applyEchoWords(battle, enemy, words), 0, '第二次一条都不该加');
  assert.equal(added.length, 2);
});

test('没有 addBuff 或敌人为空时安全返回 0', () => {
  assert.equal(applyEchoWords(null, {}, []), 0);
  assert.equal(applyEchoWords({}, {}, []), 0);
  assert.equal(applyEchoWords({ addBuff() {} }, null, []), 0);
  assert.equal(applyEchoWords({ addBuff() {} }, {}, null), 0);
});
