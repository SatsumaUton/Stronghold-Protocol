// 祝福三选一的刷新额度（维护者 2026-11-05）：
//   1. 基础额度 3 → **5**（「再议」补到上限）；
//   2. 新增传说祝福「余韵」：立刻 +1 次刷新，且**本局上限 +1**（最多叠 2 层 → 上限最高 7）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import {
  echoBlessingById, ECHO_BLESSING_REFRESH_MAX, ECHO_BLESSING_REFRESH_BONUS_MAX, ECHO_BLESSINGS,
} from '../../server/match/match/echoBlessing.js';

const dive = () => makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 21, fake: true, variant: 'deepecho' });

test('基础刷新额度是 5，上限加成最多 2 层（最高 7）', () => {
  assert.equal(ECHO_BLESSING_REFRESH_MAX, 5);
  assert.equal(ECHO_BLESSING_REFRESH_BONUS_MAX, 2);
});

test('开局就是 5 次，「再议」只补到上限、不会突破', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  assert.equal(m._echoBlessingRefreshLeft(), 5, '开局 5 次');
  // 用掉 3 次 → 剩 2
  m.echoBlessingRefreshes = 2;
  assert.equal(m._echoGrantBlessingRefresh(1), 3, '「再议」+1');
  // 补到上限后再给也不会超过 5
  m.echoBlessingRefreshes = 5;
  assert.equal(m._echoGrantBlessingRefresh(1), 5, '封顶 5');
  assert.equal(m._echoGrantBlessingRefresh(5), 5, '一次给多次也封顶 5');
});

test('「余韵」：立刻 +1 次，且本局上限 +1（叠 2 层到 7，第 3 层不再加）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const b = echoBlessingById('afterglow');
  assert.ok(b, '余韵要在祝福池里');
  assert.equal(b.rarity, 'epic');
  assert.equal(b.repeatable, true, '可重复抽到（叠层靠这个）');
  assert.ok(ECHO_BLESSINGS.some((x) => x.id === 'afterglow'));
  // 先用掉几次，再吃「余韵」
  m.echoBlessingRefreshes = 1;
  assert.equal(m._echoBlessingRefreshCap(), 5);
  m._echoGrantBlessing(b);
  assert.equal(m._echoBlessingRefreshCap(), 6, '上限 5 → 6');
  assert.equal(m._echoBlessingRefreshLeft(), 2, '同时补了 1 次（1 → 2）');
  // 第二层：上限 6 → 7
  m._echoGrantBlessing(b);
  assert.equal(m._echoBlessingRefreshCap(), 7, '上限 6 → 7');
  // 第三层：加成封顶 2，上限不再涨
  m._echoGrantBlessing(b);
  assert.equal(m._echoBlessingRefreshCap(), 7, '上限最高 7');
});

test('上限抬起来之后，补额度能补到新上限', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  const b = echoBlessingById('afterglow');
  m._echoGrantBlessing(b);                 // 上限 6
  m.echoBlessingRefreshes = 5;
  assert.equal(m._echoGrantBlessingRefresh(1), 6, '现在能补到 6');
});

test('m.public.echo.blessingRefresh.cap 跟着上限走（界面显示 n/上限）', (t) => {
  const h = dive();
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 5;
  assert.equal(m._echoPublic().blessingRefresh.cap, 5, '默认 5');
  m._echoGrantBlessing(echoBlessingById('afterglow'));
  assert.equal(m._echoPublic().blessingRefresh.cap, 6, '吃一层余韵 → 6');
  assert.equal(m._echoPublic().blessingRefresh.left, 6, '顺带补满到 6（本来 5 次没用过，+1）');
});
