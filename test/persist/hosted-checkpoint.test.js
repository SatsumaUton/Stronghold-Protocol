// 断点续玩 × 版本宿主（规程 / 一期 / 二期 / 内容集）：
// 宿主里的 Match 跑在 worker 里，主进程拿不到本体，所以检查点由 worker `snapshotMatch()` 回传、
// 主进程 persister 存；恢复时存档随 `create` 一起送进 worker，由它 `restoreMatch()`。
//
// 这个文件钉住主进程这一侧的接线（worker 侧由 server/match/host/entry.js 实现）：
//   * wireOptions 把 checkpoints / restoreDoc 带进 worker，但**不带回调**；
//   * IPC 校验只放行结构正确的 checkpoint / restored 消息；
//   * MatchProxy 把 checkpoint 交给 onCheckpointDoc、把 restored 变成 restoreDone；
//   * LobbyPersister.captureHosted 把宿主回传的文档写成检查点，matchRef 也会为宿主对局返回引用。
import test from 'node:test';
import assert from 'node:assert/strict';
import { wireOptions, MatchProxy } from '../../server/match/host/proxy.js';
import { validHostMessage } from '../../server/match/host/ipc.js';
import { LobbyPersister, localCheckpointId } from '../../server/persist/persister.js';
import { SessionRegistry } from '../../server/net.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const DOC = { v: 1, seats: [{ playerId: 'p1' }], round: 3, phase: 'PREP' };

test('wireOptions：checkpoints / restoreDoc 进 worker，回调不进', () => {
  const out = wireOptions({
    roomCode: 'ABCD', mode: 'coop', difficulty: 'NORMAL', version: 'act3autochess@V3_1',
    checkpoints: true, restoreDoc: DOC, restoreReplay: true,
    onCheckpoint: () => {}, onCheckpointDoc: () => {}, send: () => {},
  });
  assert.equal(out.checkpoints, true);
  assert.deepEqual(out.restoreDoc, DOC);
  assert.equal(out.restoreReplay, true);
  assert.equal(Object.hasOwn(out, 'onCheckpoint'), false);
  assert.equal(Object.hasOwn(out, 'onCheckpointDoc'), false);
  // 没开持久化的房间，payload 不多个键
  const plain = wireOptions({ roomCode: 'ABCD', mode: 'coop', difficulty: 'NORMAL', version: 'act3autochess@V3_1' });
  assert.equal(Object.hasOwn(plain, 'checkpoints'), false);
  assert.equal(Object.hasOwn(plain, 'restoreDoc'), false);
});

test('IPC：checkpoint / restored 消息的形状', () => {
  assert.equal(validHostMessage({ type: 'checkpoint', matchId: 'm1', reason: 'prep-end', doc: DOC }), true);
  assert.equal(validHostMessage({ type: 'checkpoint', matchId: 'm1', reason: 'prep-end', doc: null }), false);
  assert.equal(validHostMessage({ type: 'checkpoint', matchId: 'm1', doc: DOC }), false, 'reason 必填');
  assert.equal(validHostMessage({ type: 'restored', matchId: 'm1', ok: true }), true);
  assert.equal(validHostMessage({ type: 'restored', matchId: 'm1' }), false);
});

test('MatchProxy：checkpoint 交给 onCheckpointDoc，restored 让 restoreDone 落定', async () => {
  const posted = [];
  const got = [];
  const proxy = new MatchProxy({
    host: { post: (m) => posted.push(m) }, matchId: 'm1',
    opts: { roomCode: 'ABCD', seed: 1234, checkpoints: true, restoreDoc: DOC, onCheckpointDoc: (doc, reason) => got.push([doc, reason]) },
    log: quiet,
  });
  proxy.start();
  const create = posted.find((m) => m.type === 'create');
  assert.equal(create.opts.checkpoints, true);
  assert.deepEqual(create.opts.restoreDoc, DOC);

  proxy.deliver({ type: 'checkpoint', matchId: 'm1', reason: 'prep-end', doc: DOC });
  assert.deepEqual(got, [[DOC, 'prep-end']]);

  proxy.deliver({ type: 'restored', matchId: 'm1', ok: true });
  assert.equal(await proxy.restoreDone, true, 'restored → true');
});

test('captureHosted：宿主回传的文档写成检查点，matchRef 也认宿主对局', async () => {
  const saved = [];
  const store = {
    async saveCheckpoint(id, json) { saved.push([id, json]); return true; },
    async deleteCheckpoint() { return true; },
  };
  const registry = new SessionRegistry();
  const lobby = { rooms: new Map(), onCheckpoint: null };
  const persister = new LobbyPersister({ store, registry, lobby, log: quiet });
  const posted = [];
  const proxy = new MatchProxy({ host: { post: (m) => posted.push(m) }, matchId: 'm1', opts: { roomCode: 'ABCD', seed: 777, checkpoints: true }, log: quiet });
  const room = { code: 'ABCD', match: proxy, matchCtx: { live: true }, disposed: false, matchCount: 2, seats: [] };
  lobby.rooms.set(room.code, room);

  // 主进程收到宿主的安全点 → 存成检查点
  persister.captureHosted(room, proxy, DOC, 'prep-end');
  await persister.flush('tick');
  assert.equal(saved.length, 1);
  const [id, json] = saved[0];
  assert.equal(id, localCheckpointId('ABCD', 2, 777));
  const parsed = JSON.parse(json);
  assert.equal(parsed.reason, 'prep-end');
  assert.deepEqual(parsed.match, DOC);

  // 房间文档里会带这一局的引用 —— 重启后 restoreLobby 才会把它排进恢复队列
  const ref = persister.matchRef(room);
  assert.ok(ref, '宿主对局也有 matchRef');
  assert.equal(ref.id, id);
  assert.equal(ref.seed, 777);
  assert.equal(ref.matchNo, 2);
});
