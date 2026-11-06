// server/match/player/economy.js �?PlayerState methods: the economy �?funds, spending (onSpend), prep-side bond layer
// gains (clamped by layerGainRoom), the shop (onPrice prices, copy-weighted rolls from the shared pool plus the player's
// own 自�?stock �?player/diy.js �? freeze) and its intents: g.buy, g.refresh, g.freeze, g.levelUp, g.sell.
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, PHASE, layerGainRoom } from '../../../shared/constants.js';
import { ruleOption } from '../../../shared/plugins/rules.js';
import { freeSlot } from '../board.js';
import { computeBonds } from '../bondsMeta.js';
import { OK, fail } from './common.js';

export class PlayerEconomy {
  addFunds(n, { reason = '' } = {}) {
    if (!Number.isFinite(n) || n === 0) return 0;
    const v = Math.trunc(n);
    const before = this.funds;
    this.funds = Math.max(0, this.funds + v);
    if (v > 0) this.stats.fundsGained += v;
    this.dirty();
    return this.funds - before;
  }

  spend(n) {
    const v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    if (v > this.funds) return false;
    this.funds -= v;
    this.stats.gold += v;
    this.round.spent += v;
    this.dirty();
    return true;
  }

  /** onSpend, dispatched once a payment's action is complete (buy / refresh / levelUp / reward / effect). */
  _afterSpend(amount, reason) {
    if (!(amount > 0)) return;
    this.m.dispatch(this, 'onSpend', { amount, reason, total: this.stats.gold });
  }

  /**
   * Bond layer gain (prep-side). `requireActive` = "使已激活的【X】层�?N". Returns layers added: at most the room left
   * under BOND_LAYER_CAP (999, shared/constants.js) �?a gain at the cap adds 0 and dispatches nothing.
   */
  addLayers(bondId, n, { requireActive = false, reason = '' } = {}) {
    if (!this.gd.bond(bondId) || !Number.isFinite(n) || n <= 0) return 0;
    if (requireActive && !(this.bonds[bondId] && this.bonds[bondId].active)) return 0;
    const before = this.layers[bondId] || 0;
    const add = layerGainRoom(before, Math.floor(n), this.m.layerCapOff);
    if (add <= 0) return 0;
    this.layers[bondId] = before + add;
    this.recompute();
    // A live prep gain, not a view delta: reconnects and combat-result backfill must not replay the cue.
    if ([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP].includes(this.m.phase)) {
      this.m.sendTo(this.playerId, { t: 'm.layer', playerId: this.playerId, bondId, add });
    }
    this.m.dispatch(this, 'onLayers', { bondId, from: before, to: before + add, reason });
    return add;
  }

  /** Effective price of a shop slot after onPrice modifiers (never negative). */
  /** 刷新价的实际倍率：深潜 16 层后的「深渊通胀」+ 诅咒「通胀 / 暴利」；普通房恒为 1。 */
  _refreshPriceMul() {
    const m = this.m;
    if (!m || m.echoVariant !== 'deepecho' || typeof m._echoShopPriceMul !== 'function') return 1;
    const mul = Number(m._echoShopPriceMul());
    return Number.isFinite(mul) && mul > 0 ? mul : 1;
  }
  priceOf(slot) {
    if (!slot) return 0;
    const ev = { slot, kind: slot.kind, id: slot.id, price: slot.basePrice };
    this.m.dispatch(this, 'onPrice', ev, { quiet: true });
    const p = Number(ev.price);
    const base = Number.isFinite(p) ? Math.max(0, Math.round(p)) : slot.basePrice;
    // 「深渊回响」诅咒「通胀 / 暴利」：商店干员与装备加价。
    // 视图里的 price 就是这里算出来的（player/views.js），所以客户端**实际显示的**就是加价后的价。
    const mul = this.m && this.m.echoVariant === 'deepecho' && typeof this.m._echoShopPriceMul === 'function'
      ? this.m._echoShopPriceMul()
      : 1;
    return mul === 1 ? base : Math.max(0, Math.round(base * mul));
  }

  /**
   * 这个干员在本局是不是「被禁用」：在 `bannedChess` 里，或者**所有盟约都被禁**。
   *
   * 池子本身已经排除了禁用干员，这里是**最后一道闸**（2026-11-05 玩家反馈「禁用的干员还能刷出来」）：
   * 有些旁路不经过池子（自选补位、出售回填商店、装备触发的特殊刷新），
   * 万一它们塞进一个禁用干员，这里会把它替换掉并记一条 warn。
   */
  _shopBanned(id) {
    const m = this.m;
    if (!m) return false;
    // 判定只有一处（Match._shopChessBanned），商店这边只是复用
    if (typeof m._shopChessBanned === 'function') return m._shopChessBanned(id);
    if (Array.isArray(m.bannedChess) && m.bannedChess.includes(id)) return true;
    const c = this.gd.chess(id);
    const bonds = c && Array.isArray(c.bonds) ? c.bonds : [];
    if (!bonds.length) return false;
    const off = new Set([...(m.disabledBonds || []), ...(m.staticInactiveBonds || [])]);
    return bonds.every((b) => off.has(b));
  }

  _rollChessSlot() {
    // the slotted 自�?pieces join the draw once the 调度中心 reaches their slot's level (player/diy.js diyRollEntries)
    for (let attempt = 0; attempt < 4; attempt++) {
      const id = this.pool.roll(this.m.rngShop, { maxTier: this.shop.level, extra: this.diyRollEntries() });
      if (!id) return null;
      if (!this._shopBanned(id)) {
        return { kind: 'chess', id, basePrice: this.gd.chessPrice(id), frozen: false, sold: false };
      }
      this.m.log?.warn?.(`[shop] banned chess rolled and replaced: ${id} (player=${this.playerId}, round=${this.m.round})`);
    }
    return null;
  }

  _rollItemSlot() {
    // startRound rolls the shop before recompute, so the cached this.bonds can be one round behind.
    // bondBias therefore calls computeBonds at the roll (no rng). The official rule passes null and
    // does not call it, so the shop's rng stays today's two draws.
    let bias = null;
    if (ruleOption(this.m?.rules, 'shopBias') === 'bondBias') {
      const bonds = computeBonds(this.gd, this);
      bias = new Set();
      for (const [id, st] of Object.entries(bonds)) if (st && st.active) bias.add(id);
    }
    const id = this.pool.rollItem(this.m.rngShop, this.shop.level, this.itemPool, bias);
    return id ? { kind: 'item', id, basePrice: this.gd.itemPrice(id), frozen: false, sold: false } : null;
  }

  /**
   * Reroll the shop. keepFrozen �?frozen unsold slots survive (round start); otherwise everything is rerolled
   * (manual refresh). Slot counts follow the current level.
   */
  rollShop({ keepFrozen = false } = {}) {
    if (this._consumeTestShop()) return;
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    const oldChess = old.slice(0, layout.chess);
    const oldItems = old.slice(layout.chess);
    const keep = (s, kind) => (keepFrozen && s && s.kind === kind && !s.sold && s.frozen ? { ...s } : null);
    // frozen slots keep their position; sold / empty / unfrozen positions are rerolled
    const slots = [];
    for (let i = 0; i < nChess; i++) slots.push(keep(oldChess[i], 'chess') ?? this._rollChessSlot());
    for (let i = 0; i < nItem; i++) slots.push(keep(oldItems[i], 'item') ?? this._rollItemSlot());
    this.shop.slots = slots;
    this.shop.layout = { chess: nChess, item: nItem };
    for (const s of slots) if (s) s.frozen = this.shop.frozen;
    this.dirty();
  }

  /**
   * A test match's queued next shop (g.test shop) replaces this roll once and draws no rng. Queued layouts are validated by the command; level upgrades stay blocked until the roll consumes the queue.
   * The defensive fallback handles only corrupted internal state.
   * [ASSUMED] The queue replaces frozen slots too. Absent on a normal match, so this returns false immediately.
   * @returns {boolean} true when the queue was applied
   */
  _consumeTestShop() {
    const queued = this._testShopNext;
    if (this.m.test !== true || !queued) return false;
    this._testShopNext = null;
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const ok = Array.isArray(queued) && queued.length === nChess + nItem && queued.every((s, i) => {
      const kind = i < nChess ? 'chess' : 'item';
      return !!s && s.kind === kind && (kind === 'chess' ? !!this.gd.chess(s.id) : !!this.gd.item(s.id));
    });
    if (!ok) return false;
    const slots = queued.map((s) => ({
      kind: s.kind, id: s.id,
      basePrice: s.kind === 'chess' ? this.gd.chessPrice(s.id) : this.gd.itemPrice(s.id),
      frozen: false, sold: false,
    }));
    this.shop.slots = slots;
    this.shop.layout = { chess: nChess, item: nItem };
    for (const s of slots) if (s) s.frozen = this.shop.frozen;
    this.dirty();
    return true;
  }

  /**
   * The 调度中心's upgrade opens the new level's extra slots at once �?EMPTY: no card is drawn into them (a `null` slot).
   * The next roll (a manual refresh or the round start) fills them with the other unfrozen slots; the cards already shown
   * stay where they are (chess slots keep their index, the item slot stays after them). Official: the footage of a 1�?
   * upgrade (bilibili BV1AXwuzdEys 1:39, GitHub #332 / PR #333 by @2321Robin) shows the new slot appear and stay empty, and
   * the texts only name the slots �?the tutorial's 休整�?page 「升级后将出现更多的商品栏位�? PRTS 帮助 「增加刷新栏位�?�?
   * never a card that comes with them. 0.2.0 drew a card into each new slot instead (item 19 of the community report of
   * 2026-10-06, 「升级商店获得新的商店位时用新卡补上，而不是空着�? one uncorroborated remark; its follow-on, that the new card
   * follows the freeze toggle, was [ASSUMED]); until then the extra slots waited for the next roll as well.
   */
  _openLevelSlots() {
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    if (nChess <= layout.chess && nItem <= layout.item) return;
    const chess = old.slice(0, layout.chess);
    const items = old.slice(layout.chess);
    while (chess.length < nChess) chess.push(null); // loop-cap: shopSlots chess max 8
    while (items.length < nItem) items.push(null);
    this.shop.slots = [...chess, ...items];
    this.shop.layout = { chess: chess.length, item: items.length };
  }

  /** Combat start: unfrozen slots are emptied (research 01 A1). */
  clearUnfrozenShop() {
    this.shop.slots = this.shop.slots.map((s) => (s && s.frozen && !s.sold ? s : null));
    this.dirty();
  }

  /**
   * g.buy {slot}. A full regular hand refuses every purchase, also one whose copy would complete a merge at once (PRTS
   * Stronghold-Protocol/帮助 §手牌�?"当常规手牌区全满无空位时，玩家将无法执行使手牌溢出的操作" �?"例如招募/购入等通常情况下会增加手牌�?   * 操作"; BWIKI 盟约 "当整备区达到上限后将无法进行涉及到整备区的操作（购买、撤回等�?; GitHub #82: the reporter's first-hand
   * check in the official game, "哪怕是已经有了两个相同干员情况"). Until 0.1.3 such a purchase was let through.
   */
  /**
   * 「深渊回响」买 / 卖**不补货**（维护者 2026-11-05 更正）：买走的格子保持空位，和原版一致；
   * 想换一批就按「刷新」（深潜自己的免费刷新额度 / 递增后的刷新价）。
   *
   * 2026-11-05 00:20 那个 commit（f557cf40）曾让买卖后自动补货并顺带扣 1 次免费额度，
   * 实测手感是「买完立刻又冒出一个干员」，而且「卖」在没有任何已售格子时也会白扣一次额度 —— 已移除。
   */
  buy(slotIdx) {    const g = this._gate(); if (g) return g;
    if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= this.shop.slots.length) return fail(ERR.BAD_TARGET);
    const slot = this.shop.slots[slotIdx];
    if (!slot) return fail(ERR.BAD_TARGET);
    if (slot.sold) return fail(ERR.SOLD_OUT);
    const price = this.priceOf(slot);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    const handFull = freeSlot(this.hand) < 0;
    let piece;
    if (slot.kind === 'chess') {
      const rec = this.gd.chess(slot.id);
      // a DIY slot sells only as this player's own 自�?piece (a slotted slot's record carries `diyFor`)
      if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
      // Already displayed operators stay purchasable after stock runs out (#498; 路标月报#2,
      // BV1eLXXBqEgF 2:50�?:57: nine owned + four shop offers => thirteen owned).
      // acquireChess records every copy, including the deficit; future rolls still exclude empty stock.
      if (handFull) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireChess(slot.id, { source: 'buy' });
    } else {
      if (!this.gd.item(slot.id)) return fail(ERR.BAD_TARGET);
      // Already displayed equipment stays purchasable after stock runs out (#624, maintainer 2026-10-14).
      // acquireItem records the debt. Future rolls still exclude empty stock. SOLD_OUT is only this slot, already sold.
      if (handFull) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireItem(slot.id, { source: 'buy', displayed: true });
    }
    this.stats.buys++;
    this.round.buys++;
    this.m.dispatch(this, 'onBuy', { piece, slot, price, kind: slot.kind });
    this._afterSpend(price, 'buy');
    this.recompute();
    return OK;
  }

  refresh() {
    const g = this._gate(); if (g) return g;
    // 兜底：深潜里任何来源多发的免费刷新，在**用之前**再按当前上限钳一次
    // （维护者 2026-11-05：奇迹·诅咒的上限必须真的挡得住）。
    const mm = this.m;
    if (mm && mm.echoVariant === 'deepecho' && typeof mm._echoFreeRefreshCap === 'function') {
      this.shop.freeRefreshes = Math.min(Math.max(0, Number(this.shop.freeRefreshes) || 0), mm._echoFreeRefreshCap());
    }
    const free = this.shop.freeRefreshes > 0;
    // 深潜 16 层以后：刷新价随深度上涨（资金出口，不改界面，维护者 2026-11-05）
    // 与 views.js 用**同一个**倍率函数：界面显示的价格必须等于这里实际扣的钱
    const price = free ? 0 : Math.max(0, Math.round(this.gd.refreshPrice * this._refreshPriceMul()));
    if (!free && this.funds < price) return fail(ERR.NO_FUNDS);
    if (free) this.shop.freeRefreshes--;
    else this.spend(price);
    // A manual refresh cancels the freeze: the new cards are not frozen (official, the owner's play of 2026-10-14;
    // GitHub #584, DESIGN §32.14.7). A refresh that fails (funds, phase) returns above and leaves the freeze on.
    this.shop.frozen = false;
    this.rollShop({ keepFrozen: false });
    this.stats.refreshes++;
    this.round.refreshes++;
    this.m.dispatch(this, 'onRefresh', { slots: this.shop.slots, free, price });
    this._afterSpend(price, 'refresh');
    this.dirty();
    return OK;
  }

  freeze() {
    const g = this._gate(); if (g) return g;
    this.shop.frozen = !this.shop.frozen;
    for (const s of this.shop.slots) if (s && !s.sold) s.frozen = this.shop.frozen;
    this.dirty();
    return OK;
  }

  levelUp() {
    if (this.m.test === true && this._testShopNext) return fail(ERR.WRONG_PHASE);
    const g = this._gate(); if (g) return g;
    if (this.shop.level >= this.gd.maxShopLevel) return fail(ERR.MAX_LEVEL);
    const price = Math.max(0, this.shop.upgradePrice);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    this.spend(price);
    this.shop.level++;
    this.shop.upgradePrice = this.gd.upgradeBase(this.shop.level) ?? 0;
    this._openLevelSlots();
    this.m.tickerFor('SHOP_LEVEL', [this.name, String(this.shop.level)], { playerId: this.playerId, param: String(this.shop.level) });
    this.m.dispatch(this, 'onLevelUp', { level: this.shop.level, price });
    this._afterSpend(price, 'levelUp');
    this.dirty();
    return OK;
  }

  sell(uid) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc) return fail(ERR.BAD_TARGET);
    if (loc.piece.kind !== 'chess') return fail(ERR.BAD_TARGET, loc.piece.kind === 'item' ? 'items cannot be sold' : 'tokens cannot be sold');
    const piece = loc.piece;
    // Returned equipment can always wait in the overflow queue, even when all fifteen visible slots are occupied.
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    for (const it of piece.items || []) this.stow(it, { allowTemp: true });
    piece.items = [];
    this.returnCopies(piece);
    const ev = { piece, gain: this.gd.sellPrice(piece.id) };
    this.m.dispatch(this, 'onSold', ev);
    const gain = Number.isFinite(ev.gain) ? Math.max(0, Math.trunc(ev.gain)) : 1;
    this.addFunds(gain, { reason: 'sell' });
    this.stats.sells++;
    this.round.sells++;
    this.checkItemMerges();
    this.recompute();
    return OK;
  }
}
