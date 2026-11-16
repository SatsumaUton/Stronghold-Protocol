import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

/**
 * 5–20 人房「允许重复选择策略」：房主可以给多个 AI 座位指定同一个策略（room.setBotBand）。
 *
 * 回归点：Match 构造时把 opts.seats[].band 收进 botBands，以前无条件按 bandId 去重 ——
 * 第二个 AI 的指定被丢掉，草稿时它退回自己挑，玩家看到的就是「允许重复了、AI 还是各选各的」。
 */
const BASE = { revivalEnabled: false, disableSharedPool: false, playerCapacity: 8 };

function seatsWith(picks) {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }];
  picks.forEach((band, i) => {
    seats.push({ seat: seats.length, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true, ...(band ? { band } : {}) });
  });
  return seats;
}

test('allowRepeat: two AI seats may be designated the same strategy', () => {
  const BAND = 'band_bldsk';
  const h = makeMatch({ seats: seatsWith([BAND, BAND]), experimental: { ...BASE, allowRepeat: true } });
  const m = h.m;
  assert.equal(m.capacityExperiment, true, '8 人容量才算扩容房');
  assert.equal(m.allowRepeat, true);
  assert.equal(m.botBands.size, 2, '两个 AI 都该拿到房主指定的策略');
  assert.equal(m.botBands.get('ai_0'), BAND);
  assert.equal(m.botBands.get('ai_1'), BAND);
});

test('allowRepeat off: the same designation is still de-duplicated (原行为不变)', () => {
  const BAND = 'band_bldsk';
  const h = makeMatch({ seats: seatsWith([BAND, BAND]), experimental: { ...BASE } });
  const m = h.m;
  assert.equal(m.allowRepeat, false);
  assert.equal(m.botBands.size, 1, '没开允许重复时，一个策略只留给一个 AI 座位');
});

test('allowRepeat: different designations keep working', () => {
  const h = makeMatch({ seats: seatsWith(['band_bldsk', 'band_lisa']), experimental: { ...BASE, allowRepeat: true } });
  const m = h.m;
  assert.equal(m.botBands.size, 2);
  assert.notEqual(m.botBands.get('ai_0'), m.botBands.get('ai_1'));
});
