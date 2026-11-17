// 作弊控制台（cheatConsole）的单元测试：
//   * shared/experimental.js 认这个键，规范化后写进房间选项；
//   * 作弊房不进公开同盟列表；
//   * 结算的 _recordEchoBoard 跳过它；
//   * 客户端的 stats 不写作弊局的记录。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isExperimental, experimentalOptions, experimentalKey, sameExperimental,
} from '../../shared/experimental.js';

const base = (extra = {}) => ({ revivalEnabled: false, disableSharedPool: false, ...extra });

test('experimental：cheatConsole 是合法键，默认不出现', () => {
  assert.equal(isExperimental(base()), true, '老的两键房间仍然合法');
  assert.equal(isExperimental(base({ cheatConsole: true })), true, '作弊键合法');
  assert.equal(isExperimental(base({ cheatConsole: 'yes' })), false, '必须是布尔');
  const off = experimentalOptions(base());
  assert.equal(Object.hasOwn(off, 'cheatConsole'), false, '关着的时候一个键都不多写（房间指纹与旧版一致）');
  const on = experimentalOptions(base({ cheatConsole: true }));
  assert.equal(on.cheatConsole, true);
});
test('experimental：作弊房的指纹与普通房不同、且只受这个键影响', () => {
  const a = base();
  const b = base({ cheatConsole: true });
  assert.notEqual(experimentalKey(experimentalOptions(a)), experimentalKey(experimentalOptions(b)));
  assert.equal(sameExperimental(experimentalOptions(a), experimentalOptions(b)), false);
  assert.equal(sameExperimental(experimentalOptions(b), experimentalOptions(base({ cheatConsole: true }))), true);
});
