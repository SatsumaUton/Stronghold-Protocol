// 房主给 AI 座位指定策略（room.setBotBand）：协议放行 + 「允许重复选择策略」的判据。
//
// 背景（2026-11-02 维护者实测报的 bug）：
//   点「指定 AI 策略」→ 界面弹「无效的请求」。
//   原因不是服务端拒绝，而是 shared/protocol.js 的 C2S 表里**根本没有 room.setBotBand**，
//   于是 net.request 在客户端就被 validateC2S 拦下抛 BAD_MSG —— 消息连发都没发出去。
//   服务端 setBotBand 一直都在，只是永远收不到请求。
//
// 第二件事：扩容房开了「允许重复选择策略」(allowRepeat) 时，两个 AI 可以拿同一个盟约。
//   服务端 setBotBand 原来无条件拒绝重复，与 Match 的 bandTaken()（allowRepeat 下恒为 false）
//   口径不一致 —— 房间说允许重复，房主却被拒。判据必须与 Match.js:342-345 逐字一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateC2S } from '../../shared/protocol.js';
import { MAX_SEATS } from '../../shared/constants.js';

test('协议：room.setBotBand 被放行（这是「无效的请求」的根因）', () => {
  // 正常指定
  assert.equal(validateC2S({ t: 'room.setBotBand', seat: 1, bandId: 'band_default' }), null);
  // 「自动选择」= bandId null
  assert.equal(validateC2S({ t: 'room.setBotBand', seat: 0, bandId: null }), null);
  // 省略 bandId（服务端默认 null）
  assert.equal(validateC2S({ t: 'room.setBotBand', seat: 0 }), null);
});

test('协议：room.setBotBand 的非法参数仍然被拒', () => {
  // 座位越界（MAX_PLAYER_CAPACITY - 1 = 19）
  assert.match(String(validateC2S({ t: 'room.setBotBand', seat: 99, bandId: 'band_default' })), /seat/);
  assert.match(String(validateC2S({ t: 'room.setBotBand', seat: -1, bandId: 'band_default' })), /seat/);
  // bandId 不是合法 id
  assert.match(String(validateC2S({ t: 'room.setBotBand', seat: 0, bandId: 'bad id!' })), /bandId/);
  // bandId 类型不对
  assert.match(String(validateC2S({ t: 'room.setBotBand', seat: 0, bandId: 42 })), /bandId/);
});

test('「允许重复选择策略」的判据与 Match 一致', async () => {
  // Match.js:342-345 —— capacityExperiment = !isSolo && playerCapacity > 4;
  //                      allowRepeat = capacityExperiment && experimental.allowRepeat === true
  // lobby 的 roomAllowsRepeatBands 必须逐字一致，否则两边打架。
  const { Lobby } = await import('../../server/lobby.js');
  const lobby = Object.create(Lobby.prototype);
  const room = (mode, capacity, experimental) => ({ mode, capacity, experimental });

  // 扩容房 + 开 allowRepeat → 允许重复
  assert.equal(lobby.roomAllowsRepeatBands(room('coop', 8, { allowRepeat: true })), true);
  assert.equal(lobby.roomAllowsRepeatBands(room('coop', 20, { allowRepeat: true })), true);

  // 扩容房但没开 allowRepeat → 不允许
  assert.equal(lobby.roomAllowsRepeatBands(room('coop', 8, { allowRepeat: false })), false);
  assert.equal(lobby.roomAllowsRepeatBands(room('coop', 8, {})), false);
  assert.equal(lobby.roomAllowsRepeatBands(room('coop', 8, null)), false);

  // 非扩容房（capacity 就是 MAX_SEATS=4）即使 experimental 里有 allowRepeat 也不生效
  // —— 与 Match 的 capacityExperiment 判据一致（playerCapacity > 4 才成立）
  assert.equal(lobby.roomAllowsRepeatBands(room('coop', MAX_SEATS, { allowRepeat: true })), false);

  // solo 房永远没有 AI 队友
  assert.equal(lobby.roomAllowsRepeatBands(room('solo', 1, { allowRepeat: true })), false);

  // allowRepeat 只认严格的 true
  assert.equal(lobby.roomAllowsRepeatBands(room('coop', 8, { allowRepeat: 'yes' })), false);
  assert.equal(lobby.roomAllowsRepeatBands(room('coop', 8, { allowRepeat: 1 })), false);
});
