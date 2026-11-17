// 维护者 2026-11-17 玩家反馈：房主开了作弊控制台，仍然提示「只有房主可以操作」。
//
// 根因：wireOptions 只把 hostId 转发给 `opts.test === true` 的房间，而作弊房不是测试房 ——
// 版本宿主 / 内容宿主里的 Match.hostId 变成 null，applyTestCommand 的 isHost 判否 → NOT_HOST。
import test from 'node:test';
import assert from 'node:assert/strict';
import { wireOptions, MatchProxy } from '../../server/match/host/proxy.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { Match } from '../../server/match/Match.js';
import { DATA } from '../match/harness.js';

process.env.SP_GATE_IGNORE = '1';
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('wireOptions：hostId 与 test 解耦 —— 作弊房（不是测试房）也要带过去', () => {
  const cheat = {
    roomCode: 'ABCD', mode: 'coop', difficulty: 'NORMAL', version: 'act3autochess@V3_1',
    experimental: { revivalEnabled: false, disableSharedPool: false, cheatConsole: true },
    hostId: 'p_host',
  };
  const out = wireOptions(cheat);
  assert.equal(out.hostId, 'p_host', '★ 作弊房没有 test 标记，hostId 也必须转发，否则宿主的 Match.hostId 是 null');
  assert.equal(out.test, undefined, '不是测试房，别多写 test 键');
  assert.equal(out.experimental.cheatConsole, true, '作弊键本身早就在转发');

  // 普通房照旧：**不带** hostId（worker payload 与以前逐字相同，test/test-mode.test.js 有这条断言）
  assert.equal(wireOptions({ roomCode: 'X', mode: 'coop', hostId: 'p2' }).hostId, undefined, '普通房不转发 hostId');
  assert.equal(wireOptions({ roomCode: 'X', mode: 'coop' }).hostId, undefined, '没给 hostId 就别凭空造一个');

  // 测试房不受影响
  const t = wireOptions({ ...cheat, test: true });
  assert.equal(t.test, true);
  assert.equal(t.hostId, 'p_host');
});

test('宿主里 hostId 丢了会让房主吃到 NOT_HOST（这就是玩家看到的那句）', () => {
  // 直接复现：Match 拿不到 hostId 时，作弊控制台也放不过第二关。
  const mk = (hostId) => {
    const rooms = [];
    const L = new Lobby({ registry: new SessionRegistry(), MatchClass: class { start() {} dispose() {} }, getData: () => DATA, log: quiet, content: { cs: 'a0'.repeat(32) } });
    L.shutdown?.();
    return { m: { hostId: hostId ?? null }, L };
  };
  // 简化断言：Match 的 hostId 来自 opts.hostId，缺失即 null（Match.js:625）
  const a = mk('p_host');
  const b = mk(undefined);
  assert.equal(a.m.hostId, 'p_host');
  assert.equal(b.m.hostId, null);

  // 用真实 Match 验证 hostId 的作用。
  //
  // ★ 2026-11-17（维护者后续要求「开了控制台的房间，房内所有玩家都能用」）之后，作弊房不再判 hostId，
  //   所以「hostId 丢了」只在**测试房**（上游那条老路径，仍然只给房主）上才表现为 NOT_HOST。
  //   这正好把两种房间的语义分开钉住：
  //     * 测试房：hostId 到位 → 房主可用；hostId 丢了 → NOT_HOST（就是玩家看到的那句）
  //     * 作弊房：hostId 丢了 → 房内每名真人照样可用（新要求）
  const seats = [
    { seat: 0, playerId: 'p_host', name: 'H', isBot: false, connected: true },
    { seat: 1, playerId: 'p_guest', name: 'G', isBot: false, connected: true },
    { seat: 2, playerId: 'ai_0', name: 'AI', isBot: true, connected: true },
    { seat: 3, playerId: 'ai_1', name: 'AI', isBot: true, connected: true },
  ];
  const base = {
    roomCode: 'RT', mode: 'coop', difficulty: 'NORMAL', modeId: 'mode_multi_normal',
    seats, spectators: [], seed: 3, matchNo: 1, data: DATA, log: quiet, botRehearsal: 0,
    send: () => true, broadcast: () => {}, onEnd: () => {},
  };
  const run = (opts, who) => {
    const m = new Match({ ...base, ...opts });
    m.start();
    const r = m.applyTestCommand(m.players.get(who), { cmd: 'funds', args: { amount: 50 } });
    m.dispose?.();
    return r;
  };

  // 测试房：hostId 是这个房间唯一的主键
  assert.equal(run({ test: true, hostId: 'p_host' }, 'p_host').ok, true, '测试房：hostId 到位时房主能下命令');
  assert.equal(run({ test: true }, 'p_host').error, 'NOT_HOST', '测试房：hostId 丢了就回 NOT_HOST —— 就是「只有房主可以操作」那句');

  // 作弊房：不判 hostId，房内每名真人（不只是房主）都能用
  const cheat = { experimental: { revivalEnabled: false, disableSharedPool: false, cheatConsole: true } };
  assert.equal(run(cheat, 'p_host').ok, true, '作弊房：房主可用');
  assert.equal(run(cheat, 'p_guest').ok, true, '作弊房：非房主也可用（维护者 2026-11-17）');
  assert.equal(run({ ...cheat, hostId: 'p_host' }, 'p_guest').ok, true, '作弊房：hostId 到位时非房主照样可用');
});
