// In-match intents (`g.*`, DESIGN §8.2) with uniform error handling: every request goes through
// `act()`, which plays a UI sound on success, shows the ERR_TEXT toast on failure and never throws.
// The UI never mutates state optimistically — it waits for the next m.private / m.public push.
// `net.request` is looked up at call time so the dev mock harness can stub it.

import { net } from '../net.js';
import { toastError } from './toasts.js';
import { audio } from '../audio.js';

const SUCCESS_SFX = {
  'g.buy': 'buy', 'g.sell': 'sell', 'g.refresh': 'refresh', 'g.freeze': 'freeze', 'g.levelUp': 'levelup',
  'g.move': 'drop', 'g.equip': 'equip', 'g.art': 'artPlace', 'g.reward': 'pick', 'g.choice': 'pick',
  'g.band': 'confirm', 'g.bandSkip': 'back', 'g.infoReady': 'ready', 'g.emote': 'emote', 'g.destroy': 'back', 'g.unequip': 'back',
};

let inflight = 0;
const busyListeners = new Set();
const emitBusy = () => { for (const fn of [...busyListeners]) { try { fn(inflight); } catch { /* ignore */ } } };

/** Subscribe to the number of in-flight intents (for subtle busy indicators). */
export function onBusy(fn) { busyListeners.add(fn); return () => busyListeners.delete(fn); }

// Single-flight shop refresh (GitHub #501, single-ptilopsis): under a high RTT the shop has not answered yet while the
// player taps 刷新 again — every extra g.refresh the client sends is a paid refresh (server/match intents.js → ps.refresh).
// A tap while the previous request is still on the wire is dropped; the button dims and the R hotkey stays inert (both
// call actions.refresh) until the request settles (success or failure). This is not server-side cancellation or
// idempotency: a timed-out request may already have executed. The shop bar receives onRefreshBusy via the game screen.
let refreshPending = false;
const refreshBusyListeners = new Set();
const emitRefreshBusy = () => { for (const fn of [...refreshBusyListeners]) { try { fn(refreshPending); } catch { /* ignore */ } } };

/**
 * Subscribe to the shop refresh's in-flight state — fires once with the current state.
 * @param {(busy: boolean) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onRefreshBusy(fn) { refreshBusyListeners.add(fn); try { fn(refreshPending); } catch { /* ignore */ } return () => refreshBusyListeners.delete(fn); }

/**
 * Send an intent. Resolves true on `ok`, false on error (already toasted).
 * @param {string} t
 * @param {object} [fields]
 * @param {{ sfx?: string|false, quiet?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export async function act(t, fields = {}, opts = {}) {
  inflight += 1;
  emitBusy();
  try {
    await net.request(t, fields);
    const s = opts.sfx === undefined ? SUCCESS_SFX[t] : opts.sfx;
    if (s) audio.sfx(s);
    return true;
  } catch (err) {
    if (!opts.quiet) {
      toastError(err);
      audio.sfx('error', { volume: 0.6 });
    }
    return false;
  } finally {
    inflight = Math.max(0, inflight - 1);
    emitBusy();
  }
}

export const actions = {
  infoReady: (setupRevision = 0) => act('g.infoReady', { setupRevision }),
  rerollSetup: (setupRevision) => act('room.rerollSetup', { setupRevision }, { sfx: 'confirm' }),
  rerollVote: (voteId, agree) => act('g.rerollVote', { voteId, agree }, { sfx: agree ? 'confirm' : 'back' }),
  cancelReroll: (voteId) => act('room.cancelReroll', { voteId }, { sfx: 'back' }),
  band: (bandId) => act('g.band', { bandId }),
  bandSkip: () => act('g.bandSkip'),
  buy: (slot) => act('g.buy', { slot }),
  // a tap while the previous g.refresh is still on the wire is dropped (GitHub #501) — see onRefreshBusy above
  refresh: () => {
    if (refreshPending) return Promise.resolve(false);
    refreshPending = true;
    emitRefreshBusy();
    return act('g.refresh').finally(() => { refreshPending = false; emitRefreshBusy(); });
  },
  freeze: () => act('g.freeze'),
  levelUp: () => act('g.levelUp'),
  sell: (uid) => act('g.sell', { uid }),
  // `dir` (UP|RIGHT|DOWN|LEFT): the direction chosen with the deploy wheel (research 09 §6.1 — g.move / g.art carry it;
  // the server defaults to RIGHT when absent)
  move: (uid, to, dir) => act('g.move', dir ? { uid, to, dir } : { uid, to }),
  // `replaceUid`: the equipped item the replace dialog picked (ui/equipReplace.js) — it is destroyed; absent ⇒ none needed
  equip: (itemUid, targetUid, replaceUid) => act('g.equip', Number.isInteger(replaceUid) ? { itemUid, targetUid, replaceUid } : { itemUid, targetUid }),
  art: (itemUid, row, col, dir) => act('g.art', dir ? { itemUid, row, col, dir } : { itemUid, row, col }),
  destroy: (uid) => act('g.destroy', { uid }),
  unequip: (itemUid) => act('g.unequip', { itemUid }),
  reward: (idx) => act('g.reward', { idx }),
  offer: (offer, idx, refresh = false, cardId) => act(refresh ? 'g.offerRefresh' : 'g.offer', { offerId: offer.id, pluginId: offer.pluginId, seq: offer.seq, idx, cardId }),
  choice: (idx, choiceId) => act('g.choice', choiceId === undefined ? { idx } : { idx, choiceId }),
  ready: (ready) => act('g.ready', { ready }, { sfx: ready ? 'ready' : 'back' }),
  emote: (id) => act('g.emote', { id }, { quiet: true }),
  // `playerId`: the player tapped in the team panel (a shared field shows two) — what an eliminated viewer follows
  watch: (fieldId, playerId = null) => act('g.watch', typeof playerId === 'string' && playerId ? { fieldId, playerId } : { fieldId }, { sfx: 'tab' }),
  autoplay: (on) => act('g.autoplay', { on }),
  // solo battles only (ui/matchStatus.js pauseAvailable): m.public.paused follows
  pause: (on) => act('g.pause', { on: !!on }, { sfx: on ? 'click' : 'confirm' }),
  // 「暂停游戏」的全员投票（深渊回响多人局，server/match/match/pauseVote.js）：
  // agree=true 发起/同意、false 撤回；暂停中每个人发 pauseResume 确认，全员确认后恢复
  pauseVote: (agree) => act('g.pauseVote', { agree: !!agree }, { sfx: 'click' }),
  pauseResume: () => act('g.pauseResume', {}, { sfx: 'confirm' }),
  // room-level intent (NOT g.*): the host frees a spectator seat while the match runs — the server takes room.removeSpectator at
  // any time (server/lobby.js removeSpectator), the game screen had no entry for it (ui/hud.js SpectatorPill; GitHub #120)
  removeSpectator: (playerId) => act('room.removeSpectator', { playerId }, { sfx: 'back' }),
  // 战斗 2 倍速: this seat's standing vote (m.public speedVote follows)
  speedVote: (agree) => act('g.speedVote', { agree: !!agree }, { sfx: agree ? 'confirm' : 'back' }),
  // 「深渊回响」的祝福三选一（ui/echoBlessing.js）：m.public.echo.offer 跟着更新
  echoBlessing: (pick) => act('g.echoBlessing', { pick: Number(pick) }, { sfx: 'confirm' }),
  // 名额满时的弃选投票（同样 30 秒）
  echoBlessingDiscard: (pick) => act('g.echoBlessingDiscard', { pick: Number(pick) }, { sfx: 'confirm' }),
  // 刷新三选一（维护者 2026-11-05）：发起投票 / 投同意或不同意
  echoBlessingRefresh: () => act('g.echoBlessingRefresh', { start: true }),
  echoBlessingRefreshVote: (agree) => act('g.echoBlessingRefresh', { agree: !!agree }),
  // 用反制祝福提前结束「排异 / 封锁」
  echoCounterUse: () => act('g.echoCounterUse', {}, { sfx: 'confirm' }),
  // 深渊祭坛（16 层起）：kind = 'blessing' | 'buff' | 'permanent'
  echoAltar: (kind) => act('g.echoAltar', { kind }, { sfx: 'confirm' }),
  // 深潜补给（16 层起）：个人三选一
  echoSupply: (pick) => act('g.echoSupply', { pick: Number(pick) }, { sfx: 'confirm' }),
  // 盟约投影（16 层起每 10 层）：每人各自三选一（2026-11-07 起不再全队投票）
  echoProjection: (pick) => act('g.echoProjection', { pick: Number(pick) }, { sfx: 'confirm' }),
  // 护盾：投票指定要保护的盟约
  echoShield: (pick) => act('g.echoShield', { pick: Number(pick) }, { sfx: 'confirm' }),
  // 主动放弃深潜（维护者 2026-11-07）：start=true 发起（单人立刻结算 / 多人开全员投票），否则按 agree 投票
  echoGiveUp: () => act('g.echoGiveUp', { start: true }, { sfx: 'back' }),
  echoGiveUpVote: (agree) => act('g.echoGiveUp', { agree: !!agree }, { sfx: agree ? 'confirm' : 'back' }),
};
