// test/match/echoConfig.test.js — 深潜的房间级调参（server/match/match/echoConfig.js）。
//
// 两条硬规则要守住：
//   1. 默认值 = 现行行为（不传配置的房间一个字都不变）
//   2. 调过参 = 不进排行榜（深度只在标准配置下可比）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHO_CONFIG_DEFAULTS, ECHO_CURVES, ECHO_CURVE_IDS, normalizeEchoConfig, echoConfigRanked, echoCurveOf,
} from '../../server/match/match/echoConfig.js';

test('默认配置 = 现行行为，且算「标准配置」（可进榜）', () => {
  const { cfg, changed, errors } = normalizeEchoConfig(null);
  assert.deepEqual(errors, []);
  assert.equal(changed, false, '不传配置就是标准配置');
  assert.deepEqual(cfg, ECHO_CONFIG_DEFAULTS);
  assert.equal(echoConfigRanked(cfg), true);
  assert.equal(echoConfigRanked(null), true, 'null 也按标准算');
});

test('传了等于默认值的配置：仍然算标准（可进榜）', () => {
  const { cfg, changed } = normalizeEchoConfig({ ...ECHO_CONFIG_DEFAULTS });
  assert.equal(changed, false);
  assert.equal(echoConfigRanked(cfg), true);
});

test('改了任意一项就算调过参 → 不进榜', () => {
  for (const [k, v] of [['curve', 'gentle'], ['eliteEvery', 5], ['wordCap', 3], ['bounty', false], ['depthCap', 60]]) {
    const { cfg, changed } = normalizeEchoConfig({ [k]: v });
    assert.equal(changed, true, `${k} 改了应该算调过参`);
    assert.equal(echoConfigRanked(cfg), false, `${k} 改过就不该进榜`);
  }
});

test('越界数值被夹回合法区间（不让客户端把参数写成负数或天文数字）', () => {
  const { cfg } = normalizeEchoConfig({ eliteEvery: 999, eliteMax: 99, wordCap: -1, blessingEvery: 0, depthCap: 1e9 });
  assert.equal(cfg.eliteEvery, ECHO_CONFIG_DEFAULTS.eliteEvery, '越界退回默认');
  assert.equal(cfg.eliteMax, ECHO_CONFIG_DEFAULTS.eliteMax);
  assert.equal(cfg.wordCap, ECHO_CONFIG_DEFAULTS.wordCap);
  assert.equal(cfg.blessingEvery, ECHO_CONFIG_DEFAULTS.blessingEvery);
  assert.equal(cfg.depthCap, ECHO_CONFIG_DEFAULTS.depthCap);
});

test('未知曲线档位报错并退回默认档', () => {
  const { cfg, errors } = normalizeEchoConfig({ curve: 'ludicrous' });
  assert.equal(cfg.curve, ECHO_CONFIG_DEFAULTS.curve);
  assert.ok(errors.some((e) => e.startsWith('echo.curve')), '要报出来，不能静默');
});

test('非对象配置报错但不崩', () => {
  for (const bad of [42, 'x', [1, 2]]) {
    const { errors } = normalizeEchoConfig(bad);
    assert.ok(errors.length > 0, `${JSON.stringify(bad)} 应该报错`);
  }
});

test('三档曲线：名字齐全、每档都比上一档陡', () => {
  assert.deepEqual(ECHO_CURVE_IDS, ['gentle', 'standard', 'aggressive']);
  const [g, s, a] = ECHO_CURVE_IDS.map((id) => ECHO_CURVES[id]);
  assert.ok(g.hp < s.hp && s.hp < a.hp, '血量增速递增');
  assert.ok(g.atk < s.atk && s.atk < a.atk, '攻击增速递增');
  assert.equal(echoCurveOf({ curve: 'gentle' }).hp, g.hp);
  assert.equal(echoCurveOf(null).hp, ECHO_CURVES[ECHO_CONFIG_DEFAULTS.curve].hp, '不传就用默认档');
  assert.equal(echoCurveOf({ curve: 'nope' }).hp, ECHO_CURVES[ECHO_CONFIG_DEFAULTS.curve].hp, '未知档退回默认');
});
