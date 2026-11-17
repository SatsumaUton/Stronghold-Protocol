// 墓碑（DIY_CLEARED）的端到端回归：
//   ① 协议：room.diy 允许 `picks.__cleared`，checkDiyPicks 原样带回；
//   ② shared/diy.js：pickDiyFor 按墓碑剔除默认版本的继承槽位，且返回结果里不含墓碑键；
//   ③ 客户端：本地设置里清空后重新读设置不再回退（loadout-charid 已有），这里只盯纯函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { checkDiyPicks } from '../../shared/protocol.js';
import { pickDiyFor, storeDiyFor, DIY_CLEARED } from '../../shared/diy.js';

const data = loadData(new URL('../../data/versions/act3autochess-v3_1', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), { log: { warn() {} } });
const SLOT5 = 'chess_char_5_diy1_a';
const SLOT6 = 'chess_char_6_diy1_a';

test('协议：picks 里带 __cleared 合法，checkDiyPicks 把它带回来', () => {
  const r = checkDiyPicks({ [SLOT5]: null, [DIY_CLEARED]: [SLOT5] }, { data, kitted: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.cleared, [SLOT5], '★ 墓碑要能穿过协议校验');
  assert.deepEqual(r.picks, {}, '墓碑不是 picks');
});

test('协议：__cleared 只接受字符串 id 数组，超长/非数组一律 BAD_MSG', () => {
  assert.equal(checkDiyPicks({ [DIY_CLEARED]: 'not-an-array' }, { data }).error, 'BAD_MSG');
  assert.equal(checkDiyPicks({ [DIY_CLEARED]: [1, 2] }, { data }).error, 'BAD_MSG');
  assert.equal(checkDiyPicks({ [DIY_CLEARED]: Array.from({ length: 13 }, (_, i) => `s${i}`) }, { data }).error, 'BAD_MSG');
});

test('pickDiyFor：默认版本的继承槽位被墓碑剔掉（服务端不再把第二期下半塞回来）', () => {
  const base = { [SLOT5]: { charId: 'char_102_texas' }, [SLOT6]: { charId: 'char_103_angel' } };
  const map = storeDiyFor({ act2autochess: base }, 'act3autochess-v3_1', {});
  // 没有墓碑 → 老行为，仍回退默认版本
  assert.deepEqual(pickDiyFor(map, 'act3autochess-v3_1'), base, '没设过墓碑时保持原行为');
  // 加上墓碑 → 只剔掉被清的那一槽
  const withTomb = { act2autochess: base, 'act3autochess-v3_1': { [DIY_CLEARED]: [SLOT5] } };
  assert.deepEqual(pickDiyFor(withTomb, 'act3autochess-v3_1'), { [SLOT6]: base[SLOT6] }, '★ 清掉的槽位不能被继承回来');
});

test('pickDiyFor：返回结果里永远不含墓碑键', () => {
  const map = { act2autochess: {}, 'act3autochess-v3_1': { [SLOT5]: { charId: 'char_102_texas' }, [DIY_CLEARED]: [SLOT6] } };
  const out = pickDiyFor(map, 'act3autochess-v3_1');
  assert.equal(Object.hasOwn(out, DIY_CLEARED), false, '墓碑不能漏进 picks（否则下游会把它当槽位）');
  assert.deepEqual(out, { [SLOT5]: { charId: 'char_102_texas' } });
});

test('pickDiyFor：本版配成空（有墓碑）时不回退，默认版本自己也不受墓碑影响', () => {
  const base = { [SLOT5]: { charId: 'char_102_texas' } };
  const map = { act2autochess: base, 'act3autochess-v3_1': { [DIY_CLEARED]: [SLOT5] } };
  assert.deepEqual(pickDiyFor(map, 'act3autochess-v3_1'), {}, '★ 清空后本版就是空');
  assert.deepEqual(pickDiyFor(map, 'act2autochess'), base, '默认版本照旧');
});
