// Community report of 2026-10-06, item 56: 「死亡观战时每一回合结束都会被转回自己家」. An eliminated human (and a spectator
// seat) now follows a player through every phase reset — the official keeps observing after death (research 09 §3.1:
// self_dead_dialog KEEP_WATCH, DeadAutoObDn { obIndex, state, preparation }, FindFirstAvailObTarget): the player it last
// watched with a manual g.watch (Match.watchPref), else the first player still in (seat order, AI seats included —
// they are players of the remake). Round start: that player's prep board (m.field prep); 各自行动 (both combat modes),
// 最终攻势 / 隐秘核心: that player's field; a resync / a spectator joining in prep: the board again. The idea and most
// cases come from PR #189 by @2321Robin (watch preference), not merged; the shared-field rule of its review is solved
// with g.watch's optional `playerId` (the tapped player). The client side: battle/observe.js followedScout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { makeMatch } from './harness.js';
import { followedScout } from '../../public/js/battle/observe.js';

const S = 's_spec';

test('round start: an eliminated viewer scouts the board it last watched; a spectator without a pick the first player still in', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 1001, fake: true, spectators: [S] }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.equal(m.watchPref.get('p_0'), 'p_1', 'the manual scout is the preference');
  h.ps('p_0').eliminate(1);
  h.toPrep(2);
  assert.equal(m.watchers.get('p_0'), 'n:p_1', 'the eliminated viewer scouts its preference again');
  const meta = h.lastTo('p_0', 'm.field');
  assert.deepEqual([meta?.fieldId, meta?.prep], ['n:p_1', true], 'the prep board itself was pushed');
  assert.equal(m.watchPref.get('p_0'), 'p_1', 'the automatic assignment leaves the preference alone');
  assert.equal(m.watchers.get(S), 'n:p_1', 'the spectator (no pick) follows the first player still in: p_1 (p_0 is out)');
  assert.equal(h.lastTo(S, 'm.field')?.fieldId, 'n:p_1');
  m.dispose();
});

test('the item: one human with AI teammates — eliminated, it follows an AI seat\'s board every round, never its own empty one', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 3, seed: 1010, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  h.ps('p_0').eliminate(1);
  h.toPrep(2);
  assert.equal(m.watchers.get('p_0'), 'n:ai_0', 'the first player still in');
  assert.equal(h.lastTo('p_0', 'm.field')?.fieldId, 'n:ai_0');
  // a row tapped: that AI seat from now on, in combat and at the next round start
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:ai_2' }), { ok: true });
  h.runToPhase(PHASE.COMBAT, 2);
  assert.equal(m.watchers.get('p_0'), 'n:ai_2', 'its battle (server-run combat)');
  h.toPrep(3);
  assert.equal(m.watchers.get('p_0'), 'n:ai_2', 'its board again at the round start');
  assert.equal(h.lastTo('p_0', 'm.field')?.fieldId, 'n:ai_2');
  m.dispose();
});

test('a dead preference falls back to the first player still in; a followed player who quits mid-prep hands over at once', () => {
  const h = makeMatch({ mode: 'coop', humans: 4, seed: 1002, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_3' }), { ok: true });
  h.ps('p_0').eliminate(1);
  h.ps('p_3').eliminate(1);
  h.toPrep(2);
  assert.equal(m.watchers.get('p_0'), 'n:p_1', 'p_3 is gone → the first player still in (p_1)');
  // p_1 quits during the prep: whoever scouted it follows the next player still in at once
  m.onLeave('p_1');
  assert.equal(m.watchers.get('p_0'), 'n:p_2');
  assert.deepEqual([h.lastTo('p_0', 'm.field')?.fieldId, h.lastTo('p_0', 'm.field')?.prep], ['n:p_2', true]);
  m.dispose();
});

test('server-run combat: the default watch starts an eliminated viewer on its preference; a mid-phase switch re-records it', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 1003, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  h.ps('p_0').eliminate(1);
  h.runToPhase(PHASE.COMBAT, 1);
  assert.equal(m.watchers.get('p_0'), 'n:p_2');
  assert.equal(m.watchers.get('p_1'), 'n:p_1', 'a fighting player stays on its own field');
  assert.equal(m.watchPref.get('p_0'), 'p_2', 'the combat assignment does not touch the preference');
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.equal(m.watchers.get('p_0'), 'n:p_1');
  assert.equal(m.watchPref.get('p_0'), 'p_1', 'the manual switch is the new preference');
  m.dispose();
});

test('client combat: an eliminated human is started on the field of the player it last watched; a reconnect puts it back there', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 1004, fake: true, clientCombat: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  h.ps('p_0').eliminate(1);
  h.runToPhase(PHASE.COMBAT, 1);
  let start = h.lastTo('p_0', 'b.start');
  assert.deepEqual([start?.watch, start?.fieldId], [true, 'n:p_2'], 'the preference\'s field, not the first seat\'s');
  m.onDisconnect('p_0');
  m.onReconnect('p_0');
  start = h.lastTo('p_0', 'b.start');
  assert.deepEqual([start?.watch, start?.fieldId], [true, 'n:p_2']);
  m.dispose();
});

test('Final Assault: an eliminated viewer is started on its preference\'s boss field; a shared field records the tapped player only', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 4, seed: 54, fake: true, instant: false, script: (b) => (b.kind === 'boss' ? { bossDps: 1 } : {}) }).start();
  const m = h.m;
  m.bossPairs = [['p_0', 'p_1'], ['p_2', 'p_3']]; // named watcher-role fixture; random assignment has its own tests
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  h.ps('p_3').eliminate(13);
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true }, 'records the preference in prep');
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.deepEqual(m.fields.map((f) => [f.fieldId, f.players]), [['b1', ['p_0', 'p_1']], ['b2', ['p_2']]]);
  assert.equal(m.watchers.get('p_3'), 'b2', 'follows p_2 into b2 without a tap');
  assert.equal(m.watchers.get('p_0'), 'b1', 'a fighting player stays on its own boss field');
  // PR #189's review: a shared field's id does not say who was tapped — without `playerId` nothing is recorded
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b1' }), { ok: true });
  assert.equal(m.watchPref.get('p_3'), 'p_2');
  // with it (the client sends the row tapped), that player is the preference; a player not on the field is not
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b1', playerId: 'p_1' }), { ok: true });
  assert.equal(m.watchPref.get('p_3'), 'p_1');
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b1', playerId: 'p_2' }), { ok: true });
  assert.equal(m.watchPref.get('p_3'), 'p_1', 'p_2 is not on b1');
  m.dispose();
});

test('a resync in prep sends the followed board: a spectator joining, an eliminated human reconnecting (client combat)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 1006, fake: true, clientCombat: true }).start();
  h.toPrep(1);
  const m = h.m;
  m.addSpectator(S);
  let meta = h.lastTo(S, 'm.field');
  assert.deepEqual([meta?.fieldId, meta?.prep], ['n:p_0', true], 'no pick → the first player still in');
  assert.equal(m.watchers.get(S), 'n:p_0', 'registered as a scout: later board changes push again');
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  h.ps('p_0').eliminate(1);
  m.onDisconnect('p_0');
  const n = h.allTo('p_0', 'm.field').length;
  m.onReconnect('p_0');
  assert.ok(h.allTo('p_0', 'm.field').length > n, 'the reconnect pushed a board');
  meta = h.lastTo('p_0', 'm.field');
  assert.deepEqual([meta?.fieldId, meta?.prep], ['n:p_1', true], 'the preference survived the disconnect');
  m.dispose();
});

test('entering the prep pushes the followed board again: a battle m.field that overwrote the round-start push cannot strand a viewer', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 1011, fake: true, spectators: [S] }).start();
  h.toPrep(1);
  const m = h.m;
  // the viewer's preference is p_2 — the re-push must be that player's board, not the first seat's
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  h.ps('p_0').eliminate(1);
  const pushes = [];   // the prep boards sent to the eliminated viewer, tagged with the phase they were sent in
  const spec = [];
  h.onSend.push((pid, msg) => {
    if (msg.t !== 'm.field' || !msg.prep) return;
    if (pid === 'p_0') pushes.push([m.phase, msg.fieldId]);
    if (pid === S) spec.push([m.phase, msg.fieldId]);
  });
  h.toPrep(2);
  // 回合开始一次、准备阶段开始再一次：客户端 store 里最后那条 m.field 可能是上一场战斗的（runner 的 show()/reshow
  // 会把屏幕上那场的 meta 重新写回），只推一次时观战者整个准备阶段停在自己的空棋盘上（玩家反馈 2026-11-08，
  // 深渊回响第 15 回合的准备阶段）
  assert.deepEqual(pushes, [[PHASE.ROUND_START, 'n:p_2'], [PHASE.PREP, 'n:p_2']], 'round start, then the prep itself');
  assert.deepEqual(spec, [[PHASE.ROUND_START, 'n:p_1'], [PHASE.PREP, 'n:p_1']], 'a spectator seat (no pick) follows the first player still in');
  assert.equal(m.watchers.get('p_0'), 'n:p_2', 'the re-push keeps the followed player');
  m.dispose();
});

test('the prep re-push goes to eliminated viewers and spectator seats only — a living player and a bot get none', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 1012, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  h.ps('p_0').eliminate(1);
  const got = [];
  h.onSend.push((pid, msg) => { if (msg.t === 'm.field' && msg.prep) got.push([pid, m.phase]); });
  h.toPrep(2);
  const prep = got.filter(([, ph]) => ph === PHASE.PREP);
  assert.deepEqual(prep.map(([pid]) => pid), ['p_0'], 'only the eliminated human');
  assert.ok(!prep.some(([pid]) => pid === 'p_1' || pid === 'ai_0'), 'the living player and the AI seat are not scouted');
  m.dispose();
});

test('g.watch\'s optional playerId passes the protocol check; junk does not', () => {
  assert.equal(validateC2S({ t: 'g.watch', fieldId: 'b1' }), null);
  assert.equal(validateC2S({ t: 'g.watch', fieldId: 'b1', playerId: 'p_1' }), null);
  assert.notEqual(validateC2S({ t: 'g.watch', fieldId: 'b1', playerId: 7 }), null);
});

test('client: followedScout adopts the server\'s prep board for an eliminated player / spectator seat only, from home', () => {
  const scout = { t: 'm.field', fieldId: 'n:p_1', prep: true };
  assert.equal(followedScout({ field: scout, watching: null, alive: false, myId: 'p_0' }), 'n:p_1');
  assert.equal(followedScout({ field: scout, watching: null, alive: false, spectator: true, myId: 's_x' }), 'n:p_1');
  assert.equal(followedScout({ field: scout, watching: null, alive: true, myId: 'p_0' }), null, 'a living player keeps its own board');
  assert.equal(followedScout({ field: scout, watching: 'n:p_2', alive: false, myId: 'p_0' }), null, 'already watching');
  assert.equal(followedScout({ field: { ...scout, prep: false }, alive: false, myId: 'p_0' }), null, 'a battle field');
  assert.equal(followedScout({ field: { ...scout, fieldId: 'n:p_0' }, alive: false, myId: 'p_0' }), null, 'its own board');
  assert.equal(followedScout({ field: null, alive: false, myId: 'p_0' }), null);
});
