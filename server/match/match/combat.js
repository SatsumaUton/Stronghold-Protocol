// server/match/match/combat.js — Match methods: the battles of a normal round — Battle construction (newBattle, the
// spawn list sanitised, a player's normal field after the onBattleStart handlers), the COMBAT phase in both modes
// (server-run streaming, client-side combat), the per-field results and the sim-error log, then 联防 or SETTLE.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { withBounties } from '../waves.js';
import { planUnite } from '../unite.js';
import { FieldRunner, DeadBattle } from '../fields.js';
import { DELAYS } from './common.js';
import { previewPlayer } from '../preview.js';
import { morphBattleOpt } from '../../../shared/plugins/rules.js';
import { echoHitCountEnemy } from './echoWaves.js';

export class MatchCombat {
  /** Construct a battle; a constructor failure yields a finished stand-in (clean result) and is logged. */
  newBattle(opts, { preview = false } = {}) {
    const full = { data: this.ds, content: this.battleContent, logger: this.log, ...opts, ...morphBattleOpt(this.rules),
      ...(preview ? { logger: {}, quiet: true } : {}) };
    let battle;
    try {
      battle = new this.BattleClass(full);
    } catch (e) {
      if (!preview) this.reportError(`battle ${opts.fieldId} construct`, e);
      return new DeadBattle(full, 'forced');
    }
    // 「深渊回响」: 深潜回合的侵蚀词条在这一场战斗的 enemySpawn 上注入（空操作 when the room is not a dive）
    if (!preview) this._echoHookBattle(battle);
    return battle;
  }

  /**
   * Spawn list of a field after the onBattleStart handlers (which may edit `ev.spawns`): malformed entries are dropped
   * and a kill bounty is copied into `mods.bountyCoins`, so a leaked bounty enemy keeps paying its killer in 联防.
   */
  _sanitizeSpawns(list, ownerPlayerId = null) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || typeof s !== 'object' || typeof s.enemyKey !== 'string' || !this.gd.enemy(s.enemyKey)) continue;
      const spec = { ...s, mods: s.mods && typeof s.mods === 'object' ? { ...s.mods } : {} };
      if (ownerPlayerId && spec.ownerPlayerId == null) spec.ownerPlayerId = ownerPlayerId;
      const coins = spec.bounty && typeof spec.bounty === 'object' ? Math.trunc(Number(spec.bounty.coins) || 0) : 0;
      if (coins > 0 && spec.mods.bountyId == null && spec.mods.bountyCoins == null) spec.mods.bountyCoins = coins;
      out.push(spec);
    }
    return out;
  }

  _normalBattle(ps) { return this.newBattle(this._normalOpts(ps)); }

  /**
   * The room's experimental battle rules as spec flags. A rule a battle reads rides on its spec, so the Worker, a
   * browser's local replica, a client-run field and the server's check of it all fight the same battle. Nothing when off.
   */
  _ruleFlags() {
    // 「频次怪」的绝对血量表：1–15 层是空表（原版血量），空的时候连键都不发 —— 普通房/前期逐字节不变
    const hpAbs = this.echoVariant === 'deepecho' ? this._echoHitCountHp() : null;
    // 「深渊回响」的战斗规则（侵蚀词条 / 对敌异常 / 部署加成）：以**纯 JSON** 随 spec 下发，
    // 由 server/sim/battle/echoRules.js 在两端（服务端复算 + 浏览器）用同一份代码装上。
    const echoRules = this.echoVariant === 'deepecho' && typeof this._echoBattleRules === 'function'
      ? this._echoBattleRules() : null;
    return { ...(this.layerCapOff ? { layerCapOff: true } : {}), ...(this.disableHitLimit ? { hitLimitOff: true } : {}),
      ...(echoRules ? { echoRules } : {}),
      // 「深渊回响」：限伤上限跟着深度缩放（普通房没有这个键 → sim 走官方 300000）
      ...(this.echoVariant === 'deepecho' ? { hitLimitMul: this._echoHitLimitMul() } : {}),
      // 「深渊回响」：「频次怪」（器物，血量 == 需要被打几下）16 层起按深度给**绝对血量**（见 _echoHitCountHp）
      ...(hpAbs && Object.keys(hpAbs).length ? { enemyHpAbs: hpAbs } : {}),
      // 「深渊回响」：「洞彻」（永久反隐）必须走 **spec flags**，不能只靠 `_echoHookBattle` 的事件钩子。
      // 深潜的战斗默认在**客户端**按 BattleSpec 跑（Match.clientCombat，SP_COMBAT 未设 = 客户端权威），
      // 服务端钩子只挂在服务端自己那份 battle 上，玩家看到的那份没有 → 隐匿敌人照样隐匿
      // （玩家反馈 2026-11-06「反隐匿词条没有效果，出来的敌对目标依然有隐匿状态」）。
      // sim 在出怪处读这个 flag（battle/spawns.js spawnEnemy），客户端/服务端两边逐字节一致。
      ...(this.echoVariant === 'deepecho' && typeof this._echoBlessings === 'function'
        && this._echoBlessings().some((b) => b && b.id === 'reveal_always') ? { revealAll: true } : {}),
      ...(this.enemyHpMulAt(this.round) !== 1 ? { enemyHpMul: this.enemyHpMulAt(this.round) } : {}), ...(this.enemyAtkMul !== 1 ? { enemyAtkMul: this.enemyAtkMul } : {}) };
  }

  /**
   * 「频次怪」的绝对血量表（enemyKey → 血量 = 需要被打几下），深潜专用。
   *
   * 维护者 2026-11-06 **最终定**：所有频次怪一律用数据里的**原版血量**（铁矛头 30、铁灯盘 45、
   * 青瓷茶器 4 —— 原版「打 N 下」的手感），不再有「16 层起按深度给 500–2000」那套深渊回响算法。
   *
   * 为什么还要下发这张表：它同时挡住深度倍率 —— 波次的 `hpMul` 会把 30 下放大成 6080 下；
   * 而它们多数是**召唤物**（新硎的 DeadSpawn 出铁矛头），根本不在 `wave.spawns` 里，
   * 只有出怪那一处（sim spawnEnemy 读 `flags.enemyHpAbs`）能统一覆盖。
   * @returns {Record<string, number>}
   */
  _echoHitCountHp() {
    const cache = this._echoHpAbsCache;
    if (cache && cache.gd === this.gd) return cache.map;
    const map = {};
    try {
      for (const k of echoHitCountEnemy(this.gd)) {
        map[k] = Math.max(1, Math.floor(Number(this.gd.enemy(k)?.stats?.maxHp) || 1));
      }
    } catch { /* 数据异常时按普通血量走 */ }
    this._echoHpAbsCache = { gd: this.gd, map };
    return map;
  }

  /**
   * 「频次怪」的绝对血量表（enemyKey → 血量 = 需要被打几下），深潜专用。
   *
   * 维护者 2026-11-05 定：**1–15 层用原版血量**（数据 baseHp 就是需要的次数：铁矛头 30、铁灯盘 45、
   * 青瓷茶器 4 —— 也就是原版「打 N 下」的手感，不跟深度缩放），**16 层起**改成按深度给的绝对血量，
   * 落在 500–2000 区间（`echoHitCountHp`）：第 16 层 500 下 → 每层 +40 → 第 54 层起固定 2000 下。
   *
   * 为什么不能只改波次：它们多数是**召唤物**（新硎的 DeadSpawn 出铁矛头），根本不在 `wave.spawns` 里
   * —— 只有出怪那一处（sim spawnEnemy 读 `flags.enemyHpAbs`）能统一覆盖。
   * @returns {Record<string, number>}
   */
  _echoHitCountHp() {
    const depth = typeof this._echoDepth === 'function' ? this._echoDepth(this.round) : 1;
    const band = echoHitCountHp(depth);
    const cache = this._echoHpAbsCache;
    if (cache && cache.gd === this.gd && cache.hp === band) return cache.map;
    const map = {};
    try {
      for (const k of echoHitCountEnemy(this.gd)) {
        // 1–15 层：原版血量（baseHp == 需要的次数），同样走绝对覆盖，这样才不会被深度倍率放大
        const base = band == null ? Math.max(1, Math.floor(Number(this.gd.enemy(k)?.stats?.maxHp) || 1)) : band;
        map[k] = base;
      }
    } catch { /* 数据异常时按普通血量走 */ }
    this._echoHpAbsCache = { gd: this.gd, hp: band, map };
    return map;
  }

  /** Battle options of a player's normal field (after the onBattleStart handlers). */
  _normalOpts(ps, { preview = false, board = ps.board } = {}) {
    // `this.wave` 为 null = 这一回合没有普通波次（boss 回合、或建波失败）。以前这里直接
    // `structuredClone(null)` / 交给 withBounties，会抛 `Cannot read properties of null (reading 'spawns')`，
    // 对局就卡在 COMBAT（客户端「作战结束，等待队友完成作战」，node-2 2026-11-05 实测）。
    const src = this.wave || { spawns: [], routes: [], extraRoutes: [], overrides: {}, templateId: null, timeLimit: 0 };
    const wave = preview ? structuredClone(src) : src;
    if (preview) ps = previewPlayer(ps, board);
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    // the client's list: bounty units inserted among their host action's own units, which are re-timed around them
    const spawns = withBounties(this.gd, this.round, wave, ps.bounties, ps.playerId).map((s) => ({ ...s, ownerPlayerId: ps.playerId }));
    // `waveSpawns`: the round's own wave before this player's bounties (a copy), so a draw every player shares picks the
    // same units (鸭爵, GitHub #839)
    const waveSpawns = (wave.spawns || []).map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    const ev = { input, kind: 'normal', round: this.round, spawns, waveSpawns, ...(preview ? { preview: true } : {}) };
    // Preview construction failures go to the rehearsal's discard path, never Match.dispatch's live error sink.
    if (preview) this.dispatcher.dispatch(ps, 'onBattleStart', ev);
    else this.dispatch(ps, 'onBattleStart', ev);
    return {
      seed: deriveSeed(this.seed, `n:${this.round}:${ps.seat}`),
      kind: 'normal',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.NORMAL_RECT },
      timeLimit: wave.timeLimit,
      players: [ev.input && typeof ev.input === 'object' ? ev.input : input],
      spawns: this._sanitizeSpawns(Array.isArray(ev.spawns) ? ev.spawns : spawns, ps.playerId),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: true, ...this.gd.dp, ...this._ruleFlags() },
      fieldId: `n:${ps.playerId}`,
      enemyOverrides: wave.overrides,
      waveId: wave.templateId,
    };
  }

  startCombat() {
    // 战斗 2 倍速：本场速度在开战前一次写入（未开打时投票不改已开战斗的速度）。
    this._applySpeedVote();
    if (this.clientCombat) { this._startCombatClient(); return; }
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    this._normalAliveCount = alive.length;
    this.lastResults = new Map();
    this.fields = alive.map((ps) => ({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], battle: this._normalBattle(ps), live: true }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, { onDone: (runner) => this.combatDone(runner) });
    this.runner.start();
  }

  _startCombatClient() {
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    this._normalAliveCount = alive.length;
    this.lastResults = new Map();
    this.watchers.clear();
    const fields = alive.map((ps) => this._ccField({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], opts: this._normalOpts(ps) }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._launch(fields);
    // every fighting human runs its own field; eliminated humans (and spectator seats) keep watching (research 09 §3.1
    // "Keep-watching auto-observes the first available field", switching freely with 前往查看): a replica of the field
    // of the player they follow — the one they last watched, else the first player still in (item 56) — else the first
    for (const f of fields) for (const pid of f.players) {
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left) continue;
      this.watchers.set(pid, f.fieldId);
      this._sendStart(pid, f);
    }
    const first = fields.find((f) => f.mode === 'client') || fields[0] || null;
    if (first) {
      for (const ps of this._viewers()) {
        if (ps.alive || this.watchers.has(ps.playerId)) continue;
        const f = this._watchTargetField(ps, fields) || first;
        this.watchers.set(ps.playerId, f.fieldId);
        this._sendStart(ps.playerId, f, { watch: true });
      }
    }
    this.markPublic();
  }

  /** Aggregate a finished field's content/engine errors (battle.errors: unique records) for diagnostics. */
  _collectSimErrors(f, res) {
    this.simErrors += Number(res && res.errors) || 0;
    const list = f && f.battle && Array.isArray(f.battle.errors) ? f.battle.errors : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const key = `${e.label}|${e.who || ''}|${e.message}`;
      let rec = this.simErrorLog.get(key);
      if (!rec) {
        if (this.simErrorLog.size >= 500) continue;
        rec = { label: String(e.label), who: String(e.who || ''), message: String(e.message), stack: e.stack ? String(e.stack) : null, battles: 0, count: 0 };
        this.simErrorLog.set(key, rec);
      }
      rec.battles++;
      rec.count++;
    }
  }

  combatDone(runner) { this._finishCombat((f) => runner.resultOf(f)); }

  /** Every normal field has its result: record them, then 联防 or SETTLE. */
  _finishCombat(resultOf) {
    if (this.phase !== PHASE.COMBAT) return;
    this._stopClientCombat();
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        this.lastResults.set(pid, pp || { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, unitsEnd: [], unitStats: [] });
        // the views show the layers the battle reached until settle() makes them persistent (DESIGN §20.15)
        const ps = this.players.get(pid);
        const gains = pp && pp.layerGains && typeof pp.layerGains === 'object' ? pp.layerGains : null;
        if (ps && gains && Object.keys(gains).length) { ps.pendingLayerGains = { ...gains }; ps.dirty(); }
      }
    }
    for (const f of this.fields) f.live = false;
    this.deadline = 0;
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterCombat());
  }

  /**
   * After the COMBAT_END pause: 联防 or SETTLE. The plan is made now, from the players still in — a player who quit
   * during the last field or the pause (中途退出 = eliminated, board cleared) is neither a helper nor a leaker whose
   * enemies re-enter.
   */
  _afterCombat() {
    if (this.phase !== PHASE.COMBAT) return;
    const plan = planUnite(this, this.lastResults);
    if (plan) this.startUnite(plan);
    else this.settle(null, null);
  }
}
