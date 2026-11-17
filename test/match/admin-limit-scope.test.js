// 上限放宽的作用范围（维护者 2026-11-17：「检查几个增加的关于上限调整是不是只有在深渊回响模式中才能使用」）。
//
// 服务端两个放宽：
//   ① `TEST_LAYERS_MAX` 解析层从 999 提到 1e9（否则深潜里 1000 层根本进不到对局）
//   ② 跳回合上限：深潜按 ECHO_SAFE_ROUND(999)，普通房仍是 lastRound / hiddenRound
//
// 要钉住的是：**解析层放宽不能让普通房绕过它自己的 999 层上限**。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { getData } from '../../server/data.js';
import { parseTestArgs, TEST_LAYERS_MAX } from '../../shared/testMode.js';
import { BOND_LAYER_CAP, BOND_LAYER_SAFE_MAX } from '../../shared/constants.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const DATA = getData({ log: quiet });

function make(extra) {
  const sched = new VirtualScheduler({ instantCombat: true });
  const seats = [
    { seat: 0, playerId: 'p_host', name: 'H', isBot: false, connected: true },
    { seat: 1, playerId: 'ai_0', name: 'AI', isBot: true, connected: true },
    { seat: 2, playerId: 'ai_1', name: 'AI', isBot: true, connected: true },
    { seat: 3, playerId: 'ai_2', name: 'AI', isBot: true, connected: true },
  ];
  const m = new Match({
    roomCode: 'RT', mode: 'coop', difficulty: 'NORMAL', modeId: 'mode_multi_normal',
    seats, spectators: [], seed: 7, matchNo: 1, data: DATA, log: quiet,
    now: () => sched.now(), scheduler: sched, botRehearsal: 0, hostId: 'p_host',
    experimental: { revivalEnabled: false, disableSharedPool: false, cheatConsole: true },
    send: () => true, broadcast: () => {}, onEnd: () => {},
    ...extra,
  });
  m.start();
  return m;
}

const BOND = Object.keys(DATA.bonds || {})[0];

test('层数上限：解析层放开到 1e9，但普通房仍被 999 挡住', () => {
  assert.equal(TEST_LAYERS_MAX, BOND_LAYER_SAFE_MAX);
  assert.ok(parseTestArgs('bond', { id: 'x', layers: 1000 }).args, '1000 层必须能过解析层');

  const plain = make({});
  try {
    assert.equal(plain.layerCapOff, false, '普通房不该解除层数上限');
    const r = plain.applyTestCommand(plain.players.get('p_host'), { cmd: 'bond', args: { id: BOND, layers: 1000 } });
    assert.equal(r.error, 'BAD_TARGET', '★ 普通房 1000 层必须被拒');
    assert.match(r.detail || '', new RegExp(`max":${BOND_LAYER_CAP}`), '拒绝要带真实上限（999）');
  } finally { plain.dispose?.(); }
});

test('层数上限：只有深渊回响（layerCapOff）才真的能加到 1000 层', () => {
  const dive = make({ variant: 'deepecho' });
  try {
    assert.equal(dive.layerCapOff, true, '深潜局解除层数上限');
    const r = dive.applyTestCommand(dive.players.get('p_host'), { cmd: 'bond', args: { id: BOND, layers: 1000 } });
    assert.equal(r.ok, true, '★ 深潜局 1000 层要成功');
  } finally { dive.dispose?.(); }
});

test('深渊指令：普通房一律 WRONG_PHASE（detail echo），只有深潜局放行', () => {
  const plain = make({});
  const dive = make({ variant: 'deepecho' });
  try {
    const a = plain.applyTestCommand(plain.players.get('p_host'), { cmd: 'echoBlessing', args: { id: 'bigfund' } });
    assert.equal(a.error, 'WRONG_PHASE');
    assert.equal(a.detail, 'echo', '拒绝要说明「这是深渊回响专用」');
    const b = dive.applyTestCommand(dive.players.get('p_host'), { cmd: 'echoBlessing', args: { id: 'bigfund' } });
    assert.equal(b.ok, true, '深潜局要能发祝福');
  } finally { plain.dispose?.(); dive.dispose?.(); }
});
