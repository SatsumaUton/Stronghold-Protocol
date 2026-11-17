// 深渊回响专用管理指令的测试（维护者 2026-11-17）：
//   * 目录里登记了 4 条新指令，解析层接受合法形状、拒绝非法形状；
//   * 层数上限放开到 BOND_LAYER_SAFE_MAX（深潜本来就不封顶）；
//   * 真在深潜局里执行：加祝福 / 加诅咒 / 设词条 / 设投影都会落到对局状态上。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTestArgs, TEST_COMMANDS, TEST_LAYERS_MAX } from '../../shared/testMode.js';
import { BOND_LAYER_SAFE_MAX } from '../../shared/constants.js';

test('目录：4 条深渊回响指令已登记', () => {
  for (const cmd of ['echoBlessing', 'echoCurse', 'echoWord', 'echoProjection']) {
    assert.ok(TEST_COMMANDS.includes(cmd), cmd);
  }
});

test('层数上限：解析层放到 BOND_LAYER_SAFE_MAX（深潜不封顶）', () => {
  assert.equal(TEST_LAYERS_MAX, BOND_LAYER_SAFE_MAX);
  assert.ok(parseTestArgs('bond', { id: 'x', layers: 1000 }).args, '1000 层现在要能过解析层');
  assert.equal(parseTestArgs('bond', { id: 'x', layers: BOND_LAYER_SAFE_MAX + 1 }).error, 'BAD_TARGET');
});

test('解析：echo 指令的形状', () => {
  assert.deepEqual(parseTestArgs('echoBlessing', { id: 'bigfund' }), { args: { id: 'bigfund' } });
  assert.deepEqual(parseTestArgs('echoBlessing', { clear: true }), { args: { clear: true } });
  assert.equal(parseTestArgs('echoBlessing', {}).error, 'BAD_TARGET', '既没有 id 也没有 clear');
  assert.equal(parseTestArgs('echoBlessing', { id: '../x' }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('echoCurse', { clear: 'yes' }).error, 'BAD_TARGET');
  assert.deepEqual(parseTestArgs('echoWord', { ids: ['harden', 'swift'] }), { args: { ids: ['harden', 'swift'] } });
  // 空数组 = 清空本回合词条（与 clear: true 等价，由指令自己处理）
  assert.deepEqual(parseTestArgs('echoWord', { ids: [] }), { args: { ids: [] } });
  assert.equal(parseTestArgs('echoWord', { ids: 'harden' }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('echoWord', { ids: ['x'.repeat(65)] }).error, 'BAD_TARGET');
  assert.deepEqual(parseTestArgs('echoProjection', { id: 'siracusaShip' }), { args: { id: 'siracusaShip' } });
  assert.equal(parseTestArgs('echoProjection', { id: 'constructor' }).error, 'BAD_TARGET');
});
