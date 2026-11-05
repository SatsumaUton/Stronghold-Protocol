// 「深渊回响」断点续玩：节点重启后，深潜局要**接着潜**，而不是被丢弃。
//
// 背景（维护者 2026-11-06）：重启节点后深潜局没了，玩家看到「服务器重启导致对局中断，同盟已返回等待室」。
//
// 根因（两层）：
//   1) server/persist/lobbyState.js 的 roomDoc 会把 `variant: 'deepecho'` 写进存档，
//      但**读档的 roomFrom / fallbackRoom 从来不把它读回来** —— 恢复出来的房间 variant = null。
//   2) persister.restoreLocal 的 `lobby.startMatch(room, …, { restore })` 只在 room.variant 存在时
//      才把 `variant` 传进 Match 的 opts。于是新 Match 的构造函数：
//        · 不装深潜缩放（gd.echoScaleOf 仍是官方表）；
//        · 不强制独立卡池（deepecho 恒为「每人一池」）；
//        · echoCfg 丢失（房间级调参被悄悄改回默认）。
//      随后 restoreMatch 重建卡池组时组数与检查点里的对不上 → 「checkpoint refused (pool groups)」
//      → 恢复失败 → abortRestoredMatch → 整局丢弃。深度 / 祝福 / 祭坛 / 诅咒全白存。
//
// 这里钉住：房间存档带回 variant 与 echoCfg；恢复后的房间开局时 opts 里带着它们；
// 以及引擎层（检查点 → 新 Match）深潜状态确实能整份恢复。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { snapshotLobby, restoreLobby } from '../../server/persist/lobbyState.js';
import { snapshotMatch, restoreMatch, canSnapshot } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';
import { makeMatch, settleEchoPanels, DATA } from '../match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** 一个记录 opts 的假 Match：只验证 lobby 把哪些键灌给 Match。 */
function stubMatchClass(sink) {
  return class StubMatch {
    constructor(opts) { this.opts = opts; sink.push(opts); }
    start() {}
    dispose() {}
  };
}

/** 一间深潜房（管理员才能建）：房间级调参故意改成非默认，验证它一起被存回来。 */
function echoRoom(extra = {}) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: stubMatchClass([]), getData: () => DATA, log: quiet });
  const host = {
    playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null,
    guest: false, accountId: 'acc_test', adminId: true,
  };
  const made = lobby.create(host, { mode: 'coop', difficulty: 'ABYSS', variant: 'deepecho', echo: { depthCap: 60 }, ...extra });
  assert.equal(made.ok, true, `建深潜房要成功：${JSON.stringify(made)}`);
  return { registry, lobby, host, room: lobby.roomOf(host) };
}

test('房间存档带回 variant 与 echoCfg：读档后房间仍是深潜房', () => {
  const { registry, lobby, host, room } = echoRoom();
  assert.equal(room.variant, 'deepecho');
  assert.ok(room.echoCfg, '房间级调参记下来了（非默认值）');
  const doc = snapshotLobby({ registry, lobby, matchRef: () => null, now: Date.now(), kind: 'local' });
  const saved = doc.rooms.find((r) => r.code === room.code);
  assert.equal(saved.variant, 'deepecho', '存档里要有 variant');
  assert.ok(saved.echoCfg, '存档里要有房间级调参');

  // 换一个 Lobby 当「重启后的进程」
  const registry2 = new SessionRegistry();
  const lobby2 = new Lobby({ registry: registry2, MatchClass: stubMatchClass([]), getData: () => DATA, log: quiet });
  const out = restoreLobby({ doc, registry: registry2, lobby: lobby2, now: Date.now(), log: quiet });
  assert.equal(out.ok, true);
  const back = lobby2.rooms.get(room.code);
  assert.ok(back, '房间要回来');
  assert.equal(back.variant, 'deepecho', 'variant 必须一起回来（以前这里是 null → 整局被丢）');
  assert.deepEqual({ ...back.echoCfg }, { ...room.echoCfg }, '房间级调参也要回来');
  assert.equal(host.playerId, back.hostId);
});

test('普通房不受影响：存档里没有 variant / echoCfg 这两个键', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: stubMatchClass([]), getData: () => DATA, log: quiet });
  // 本机（生产库）开了「只允许管理员建房」，所以普通房也要用管理员会话建
  const host = { playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null, guest: false, accountId: 'acc_test', adminId: true };
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  const room = lobby.roomOf(host);
  const doc = snapshotLobby({ registry, lobby, matchRef: () => null, now: Date.now(), kind: 'local' });
  const saved = doc.rooms.find((r) => r.code === room.code);
  assert.equal('variant' in saved, false, '普通房不写 variant 键');
  assert.equal('echoCfg' in saved, false, '普通房不写 echoCfg 键');
});

test('恢复后的深潜房开局：opts 里带着 variant 与 echo（否则构造函数不装深潜那套）', () => {
  const { registry, lobby, room } = echoRoom();
  const doc = snapshotLobby({ registry, lobby, matchRef: () => null, now: Date.now(), kind: 'local' });
  const seen = [];
  const registry2 = new SessionRegistry();
  const lobby2 = new Lobby({ registry: registry2, MatchClass: stubMatchClass(seen), getData: () => DATA, log: quiet });
  restoreLobby({ doc, registry: registry2, lobby: lobby2, now: Date.now(), log: quiet });
  const back = lobby2.rooms.get(room.code);
  const seats = back.seats.filter(Boolean).map((s) => ({ ...s, connected: true }));
  const result = lobby2.startMatch(back, 'k1', null, { restore: { seed: 12345, matchNo: 1, seats, apply: () => true } });
  assert.equal(result.ok, true, `恢复开局要成功：${JSON.stringify(result)}`);
  const opts = seen.at(-1);
  assert.equal(opts.variant, 'deepecho', 'Match 必须拿到 variant');
  assert.deepEqual({ ...opts.echo }, { ...room.echoCfg }, 'Match 必须拿到房间级调参');
});

test('引擎层：深潜检查点能整份恢复（深度 / 祝福 / 诅咒 / 祭坛 / 禁令）', (t) => {
  const opts = { mode: 'coop', humans: 2, bots: 0, seed: 7, fake: true, variant: 'deepecho' };
  const h = makeMatch(opts);
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 16;
  m.startRound(17);
  // 面板开着时 canSnapshot 拒绝存档（准备倒计时被按住、剩余时长不存档），先结算掉
  settleEchoPanels(m);
  assert.equal(m._echoChoiceOpen(), false, '面板都结算完了');
  m.echoBlessings = ['bd_frostbite_amp', 'afterglow'];
  m.echoBlessingRefreshes = 3;
  m.echoCurseIds = ['erosion'];
  m.echoAltarBuffStacks = 2;
  m.echoSupplyWords = ['w1'];
  m.echoBannedTiles = [5, 9];
  m.echoBannedTilesUntil = 20;
  const doc = snapshotMatch(m);
  assert.ok(doc, '深潜的备战阶段能存检查点');
  assert.equal(doc.match.echoVariant, 'deepecho', '存档要认出这是深潜局');

  const h2 = makeMatch(opts);
  t.after(() => h2.m.dispose());
  assert.equal(restoreMatch(h2.m, doc, { createRngFromState }), true, '检查点要被接受');
  const r = h2.m;
  assert.equal(r.echoVariant, 'deepecho');
  assert.equal(r.round, 17, '深度（= 回合）要接着来');
  assert.deepEqual(r.echoBlessings, ['bd_frostbite_amp', 'afterglow']);
  assert.equal(r.echoBlessingRefreshes, 3);
  assert.deepEqual(r.echoCurseIds, ['erosion']);
  assert.equal(r.echoAltarBuffStacks, 2);
  assert.deepEqual(r.echoSupplyWords, ['w1']);
  assert.deepEqual(r.echoBannedTiles, [5, 9]);
  assert.equal(r.echoBannedTilesUntil, 20);
  // 深潜缩放必须还是深潜那套（构造函数装上的），不能退回官方表
  assert.equal(typeof r.gd.echoScaleOf, 'function', '读档后仍要有深潜缩放钩子');
});

test('决策面板开着时不存检查点：准备倒计时被按住，存了读回来会白丢一整回合', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, fake: true, variant: 'deepecho' });
  const m = h.m;
  t.after(() => m.dispose());
  m.round = 16;
  m.startRound(17);
  // 伪造一个开着的祝福面板（真实流程里由 _echoMaybeOfferBlessing 挂上）
  m.echoBlessingOffer = ['bd_frostbite_amp', 'bd_dread', 'afterglow'];
  m._echoPausePrepClock();
  assert.equal(m._echoChoiceOpen(), true);
  assert.equal(canSnapshot(m), false, '面板开着时不能存档');
  assert.equal(snapshotMatch(m), null, 'snapshotMatch 也要拒绝');
  // 结算掉面板 → 可以存
  m.echoBlessingOffer = null;
  m._echoMaybeResumePrepClock();
  assert.equal(canSnapshot(m), true, '面板关掉后恢复存档');
  assert.ok(snapshotMatch(m), '能存出检查点');
});
