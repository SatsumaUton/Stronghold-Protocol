// server/sim/battle/spawns.js — Battle methods: enemies: the spawn queue (the stage's own enemies: `inTotal`, counted in
// `total` up front — the HUD capsule's numerator/denominator, deploy.js killedInTotal / leakedInTotal), routes and the
// owner of a tile, spawnEnemy, and the enemies on the field — hidden ones, the shared boss pool sync, the field clamp
// and the list compaction.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { MAX_ALIVE_ENEMIES, FIELD_EDGE_INSET } from '../constants.js';
import { Unit } from '../units.js';
import { compileRoute } from '../ai.js';
import { unitInfo } from '../snapshot.js';
import { normalizeRoute, normalizeEnemy } from '../simdata.js';
import { fin } from './util.js';
import { isEchoSummon } from './echoRules.js';

const FALLBACK_ENEMY = Object.freeze({
  type: 'enemy', id: 'enemy_unknown', key: 'enemy_unknown', name: '未知敌人', rank: 'NORMAL', maxHp: 2000, atk: 200, def: 100, res: 0,
  aspd: 100, bat: 2, rangeRadius: 0, moveSpeed: 1, massLevel: 1, lpr: 1, motion: 'WALK', applyWay: 'MELEE', dmgType: 'phys',
  immune: new Set(), tauntLevel: 0, blockCnt: 1, epResistance: 0, epDamageResistance: 0, hpRecoveryPerSec: 0, notCountInTotal: false,
  tags: [], abilities: [], skills: [], talent: {}, spine: 'unknown', avatar: 'unknown', raw: {},
});

export class BattleSpawns {
  _queueSpawn(s, precount) {
    if (Number(s.time) === Infinity) return; // "never" — not scheduled, not counted
    // capped: a bogus count (Infinity, 1e9) would otherwise hang the constructor / exhaust memory
    const count = Math.min(MAX_ALIVE_ENEMIES, Math.max(1, Math.floor(fin(s.count ?? 1, 1)) || 1));
    const interval = Math.max(0, fin(s.interval, 0));
    // 数据表里没有这个 key 时（深潜的跨版本敌人 `<version>:enemy_…`）用出怪自带的记录，
    // 否则会拿到 FALLBACK_ENEMY（「未知敌人」，客户端贴图是红水滴）（维护者 2026-11-05）。
    const def = this.data.getEnemy(s.enemyKey) || (s.enemyDef ? normalizeEnemy(s.enemyKey, s.enemyDef) : null);
    for (let i = 0; i < count; i++) {
      const p = {
        time: Math.max(0, fin(s.time, 0)) + i * interval, enemyKey: s.enemyKey, routeIndex: s.routeIndex ?? 0, route: s.route ?? null,
        mods: s.mods ?? null, sourcePlayerId: s.sourcePlayerId ?? null, bounty: s.bounty ?? null, tag: s.tag ?? null,
        ownerPlayerId: s.ownerPlayerId ?? null, pos: s.pos ?? null, seq: ++this._spawnSeq, countInTotal: s.countInTotal,
        // 跨版本敌人自带记录（数据表里没有这个 key）；spawnEnemy 的 opts.def 会用它
        def: s.enemyDef ?? null,
      };
      p.counted = p.countInTotal ?? (!(def && def.notCountInTotal) && p.tag !== 'boss' && p.tag !== 'part');
      // inTotal: the enemies THIS STAGE scheduled that count — the HUD capsule's own set (DESIGN §14 "顶栏胶囊"). A
      // runtime spawn (a split child, a summon, a part, a form change) is never in it, so the capsule's denominator stays
      // the stage's own enemies while `counted` keeps counting them all. What a 联防 field adds on top is about billing
      // only (`uniteRuntime` in spawnEnemy): it moves no counter.
      p.inTotal = !!p.counted;
      if (precount && p.inTotal) {
        this.total++;
        const owner = p.ownerPlayerId ?? this._ownerForTile(p.pos ?? this._routeFor(p.routeIndex, p.route)?.start);
        const pp = this._pp(owner);
        if (pp) pp.total++;
        p.precounted = true;
      }
      this._pending.push(p);
    }
  }

  _processSpawns() {
    const now = this.time + 1e-9;
    while (this._pending.length && this._pending[0].time <= now) { // loop-cap: pending spawn queue
      const p = this._pending.shift();
      this._safe(() => this.spawnEnemy(p.enemyKey, { ...p, _precounted: p.precounted, _scheduled: true }), 'spawnEnemy');
    }
  }

  _routeFor(idx, explicit = null) {
    if (explicit) return normalizeRoute(explicit);
    return this.routes[idx] ?? this.routes[0] ?? this._defaultRoute();
  }

  _defaultRoute() {
    if (this._defRoute !== undefined) return this._defRoute;
    const starts = this.grid.specialTiles('start');
    const ends = this.grid.specialTiles('end');
    this._defRoute = starts.length && ends.length ? { motion: 'WALK', start: starts[0], end: ends[0], checkpoints: [] } : null;
    return this._defRoute;
  }

  _ownerForTile(tile) {
    if (!this.players.length) return null;
    if (this.players.length === 1 || !tile) return this.players[0].playerId;
    const c = Array.isArray(tile) ? tile[1] : tile.c;
    const half = c >= 11 ? 'R' : 'L';
    return (this.players.find((p) => p.half === half) ?? this.players[0]).playerId;
  }

  /**
   * 「深渊回响」里这只刚出场的敌人是不是**召唤物**（与 Match 侧 `echoSummonOnly(gd)` 同口径：
   * tokenOnly / 别人的 `summons` 目标 / 首领分体 tag:part / `token_*` / 频次类器物召唤物）。
   *
   * 维护者 2026-11-06：**所有召唤物都用原版数值** —— 不吃深度倍率（hpMul / atkMul / speedMul），
   * 也不吃 `enemyHpAbs` 的绝对血量表。普通房 / 原版没有这两个 flag，这里恒为 false，逐字节不变。
   */
  _echoSummonOf(def, enemyKey, tag) {
    const f = this.flags;
    const rules = f && f.echoRules;
    if (!rules && !(f && f.enemyHpAbs)) return false;   // 普通房 / 原版：完全不动
    if (this.__echoSummonKeys === undefined) {
      const arr = rules && Array.isArray(rules.summonKeys) ? rules.summonKeys : [];
      this.__echoSummonKeys = new Set(arr.filter((k) => typeof k === 'string'));
    }
    return isEchoSummon({ tag, def, defId: (def && def.key) || enemyKey }, this.__echoSummonKeys);
  }

  /**
   * Spawn an enemy now. opts: { routeIndex, route, pos:[r,c], mods:{hpMul,atkMul,defMul,resMul,speedMul}, tag,
   * sourcePlayerId, ownerPlayerId, bounty:{coins,ownerPlayerId}, countInTotal, inTotal }
   */
  spawnEnemy(enemyKey, opts = {}) {
    if (this.enemies.length >= MAX_ALIVE_ENEMIES && this.aliveEnemies().length >= MAX_ALIVE_ENEMIES) {
      this._handlerError('spawnEnemy', null, new Error(`more than ${MAX_ALIVE_ENEMIES} living enemies; spawn of ${enemyKey} refused`));
      return null;
    }
    // opts.def: an inline record (data/enemies.json shape, or an already normalised EnemyDef) for keys absent from data
    let def = null;
    if (opts.def && typeof opts.def === 'object') {
      try { def = opts.def.type === 'enemy' && opts.def.immune instanceof Set ? opts.def : normalizeEnemy(enemyKey, opts.def); } catch (e) { this._handlerError('spawnEnemy.def', null, e); }
    }
    if (!def) def = this.data.getEnemy(enemyKey);
    if (!def) { this.log(`unknown enemy ${enemyKey}`); def = { ...FALLBACK_ENEMY, id: enemyKey, key: enemyKey }; }
    // 「深渊回响」里这只是不是**召唤物**（见 _echoSummonOf）：后面三处都要用，所以先算出来
    const isSummon = this._echoSummonOf(def, enemyKey, opts.tag);
    // 召唤物的**同场数量上限**（spec `echoRules.summonCaps`，Match 侧 ECHO_SUMMON_CAPS）：
    // 只数还活着的 —— 打掉之后照常可以再召唤（维护者 2026-11-07：枯朽之种同场最多 50 只）。
    if (isSummon) {
      const caps = this.flags && this.flags.echoRules && this.flags.echoRules.summonCaps;
      const cap = caps && typeof caps === 'object' ? Number(caps[def.key] ?? caps[enemyKey]) : NaN;
      if (Number.isFinite(cap) && cap > 0) {
        let alive = 0;
        for (const u of this.enemies) if (u.alive && u.defId === (def.key ?? enemyKey)) alive++;
        if (alive >= cap) return null;
      }
    }
    const ov = this.enemyOverrides[def.key] ?? this.enemyOverrides[enemyKey];
    if (ov && ov.stats) {
      const st = ov.stats;
      def = { ...def,
        maxHp: Math.max(1, fin(st.maxHp ?? st.hp, def.maxHp)), atk: Math.max(0, fin(st.atk, def.atk)), def: Math.max(0, fin(st.def, def.def)),
        res: Math.max(0, fin(st.res, def.res)), moveSpeed: Math.max(0, fin(st.moveSpeed, def.moveSpeed)),
        bat: Math.max(0.1, fin(st.bat, def.bat)), aspd: fin(st.aspd, def.aspd) || def.aspd,
        rangeRadius: Math.max(0, fin(st.rangeRadius, def.rangeRadius)), massLevel: fin(st.massLevel, def.massLevel),
        lpr: fin(st.lpr, def.lpr), blockCnt: Math.max(1, fin(st.blockCnt, def.blockCnt)) };
    }
    const route = opts.route ? normalizeRoute(opts.route) : this._routeFor(opts.routeIndex ?? 0);
    let start = opts.pos ?? route?.start ?? [this.rect.r0, this.rect.c1];
    if (!Array.isArray(start) || !Number.isFinite(start[0]) || !Number.isFinite(start[1])) start = route?.start ?? [this.rect.r0, this.rect.c1];
    const R = this.rect; // spawn inside the field (same bounds as _clampPos)
    start = [Math.max(R.r0 - 0.5, Math.min(R.r1 + 0.5, start[0])), Math.max(R.c0 - 0.5, Math.min(R.c1 + 0.5, start[1]))];
    // multipliers: finite and ≥ 0 (hp > 0), anything else counts as 1
    const mm = (v, pos = false) => { const n = fin(v, 1); return n < 0 || (pos && n <= 0) ? 1 : n; };
    const m0 = opts.mods || {};
    // 召唤物自带的**相对**血量倍率（首领分体的 `summon.hp_ratio`：手 = 本体的 30%）。它与「本回合的
    // 敌人缩放」分开传（content/bosses.js summonMods），因为召唤物要按原版各难度算血量，不能把深度倍率
    // 混进来（维护者 2026-11-07）。
    const hpRatio = Number(m0.hpRatio) > 0 && Number.isFinite(Number(m0.hpRatio)) ? Number(m0.hpRatio) : 1;
    const m = { hpMul: mm(m0.hpMul, true), atkMul: mm(m0.atkMul), defMul: mm(m0.defMul), resMul: mm(m0.resMul), speedMul: mm(m0.speedMul) };
    // a room's experimental multipliers (spec flags, on every copy of the battle) reach every enemy here, summons and
    // split children too. Never in `mods`: a leak carries its mods into 联防 and a child inherits them, so they would
    // apply twice.
    const roomHp = mm(this.flags.enemyHpMul, true), roomAtk = mm(this.flags.enemyAtkMul);
    // 深潜的「频次怪」绝对血量（spec flags `enemyHpAbs`：enemyKey → 血量，Match._ruleFlags()）。
    // 这类怪（器物：青铜镜、铁矛头…）的 maxHp **就是**「需要被打几下」（sim 的 hitCount 让每次伤害只扣 1）。
    // 数据 baseHp 只有 30 / 45 这种「击倒次数」，跟着深度缩放会变成几千下（实测铁矛头 6080）。
    // 维护者 2026-11-06 最终定：**所有频次怪一律用原版血量**（不再有 500–2000 的深度曲线），
    // 这张表就是「原版血量 + 挡住深度倍率」—— 它们多数是召唤物（新硎的 DeadSpawn 出铁矛头），
    // 不在波次 spawns 里，只有出怪这一处管得到。
    const absAll = this.flags && this.flags.enemyHpAbs;
    const absHp = absAll && typeof absAll === 'object' ? Number(absAll[def.key] ?? absAll[enemyKey]) : NaN;
    // 「深渊回响」：召唤物用**原版**数值（见 _echoSummonOf）—— 深度倍率（hpMul / atkMul / speedMul，含从父体
    // 波次继承下来的 mods）与 `enemyHpAbs` 的绝对血量表都不套用（维护者 2026-11-06）。
    // 血量另有口径（维护者 2026-11-07）：**原版各难度下的血量** = 数据血量 × 官方该难度该回合的倍率
    // （spec `echoRules.summonScale.hpMul`，表外取最后一档） × 召唤物自带的相对倍率（`mods.hpRatio`）。
    // 普通房没有 summonScale，走原来的 mods.hpMul，逐字节不变。
    const summonScale = isSummon && this.flags && this.flags.echoRules && this.flags.echoRules.summonScale;
    const summonHpMul = summonScale && typeof summonScale === 'object' ? mm(summonScale.hpMul, true) : null;
    const hpMulAll = isSummon ? (summonHpMul == null ? 1 : summonHpMul) : (m.hpMul ?? 1) * roomHp;
    const atkMulAll = isSummon ? 1 : (m.atkMul ?? 1) * roomAtk;
    const speedMulAll = isSummon ? 1 : (m.speedMul ?? 1);
    // 绝对血量表（`enemyHpAbs`：频次怪「需要被打几下」）永远优先 —— 它本身就是原版血量，
    // 召唤物也照用（否则 30 下会被召唤物的官方档乘成 86 下）。
    // 维护者 2026-11-07：BOSS（敌方领袖）可以额外叠一个攻击/生命倍率（spec flags bossAtkMul / bossHpMul），
    // 与全体的 enemyHpMul / enemyAtkMul **叠乘**。普通房没有这两个 flag，`mm(undefined)` = 1，逐字节不变。
    const bossHere = !!(def.isBoss || def.tag === 'boss' || (Array.isArray(this.flags.bossKeys) && this.flags.bossKeys.includes(String(def.key ?? enemyKey))));
    const bossAtkMul = bossHere ? mm(this.flags.bossAtkMul) : 1;
    const bossHpMul = bossHere ? mm(this.flags.bossHpMul, true) : 1;
    const hpFinalBoss = Number.isFinite(absHp) && absHp > 0 ? absHp : def.maxHp * hpMulAll * hpRatio * bossHpMul;
    const e = new Unit({
      id: ++this._idSeq, side: 'enemy', kind: 'enemy', def, defId: def.key ?? enemyKey, name: def.name,
      x: start[1], y: start[0], motion: def.motion,
      base: {
        maxHp: hpFinalBoss, atk: def.atk * atkMulAll * bossAtkMul, def: def.def * (m.defMul ?? 1), res: def.res * (m.resMul ?? 1),
        aspd: def.aspd, bat: def.bat, blockCnt: 0, moveSpeed: def.moveSpeed * speedMulAll, spRecovery: 0,
        tauntLevel: def.tauntLevel, massLevel: def.massLevel, hpRecoveryPerSec: def.hpRecoveryPerSec, rangeRadius: def.rangeRadius,
      },
    });
    e.alive = true;
    e.deployed = true;
    e.blockWeight = def.blockCnt ?? 1;
    e.hitArea = def.hitArea ?? null;   // 巨型单位 hit rectangle (body.js); null = a point
    e.lpr = def.lpr;
    e.mods = opts.mods ?? null;
    e.tag = opts.tag ?? null;
    e.bounty = opts.bounty ?? null;
    e.sourcePlayerId = opts.sourcePlayerId ?? null;
    e.ownerId = opts.ownerPlayerId ?? this._ownerForTile(start);
    e.spawnX = e.x; e.spawnY = e.y;
    e.spawnSeq = ++this._spawnSeq;
    e.deploySeq = ++this._deploySeq;
    e.deployedAt = this.time;
    e.atkCd = 0;
    e.pauseUntil = -Infinity;      // content holds (暴鸰's drop)
    e.atkStandUntil = -Infinity;   // standing for its attack clip (ai.js attackStand)
    e.unbalanceUntil = -Infinity;  // 失衡 (UNBALANCE) after a push / pull (battle/displacement.js _unbalance, ai.js)
    e.atkStandCutAt = -Infinity;   // display metadata: when its stand was last cut or ignored (snapshot standCut)
    e.swing = false;               // a normal attack swung, its damage frame not reached yet (ai.js enemyAttack)
    // every enemy profile starts with the same fields (stable object shapes keep the hot loop's property reads fast);
    // `dmgType` null = the data's (content may arm a data-unarmed enemy: ai.js enemyAttack); `blockFree` = its 索敌不受阻挡
    // 影响 (content: 自制投石机 — targeting.js canTargetAlly / sortAllyTargets, ai.js attackTargets)
    e.profile = { noAttack: def.dmgType === 'none', maxTargets: 1, atkScale: 1, dmgType: null, blockFree: false };
    e.route = { legs: route ? compileRoute(route, this.rect) : [], legIdx: 0, pts: null, ptIdx: 0, suffix: null, version: -1, waitLeft: null };
    if (!e.route.legs.length) {
      const end = this.grid.specialTiles('end')[0];
      if (end) e.route.legs.push({ t: 'move', r: end[0], c: end[1], final: true });
    }
    e.counted = opts.countInTotal ?? (!def.notCountInTotal && e.tag !== 'boss' && e.tag !== 'part');
    // 联防 (player report, 2026-10-16): on a 联防 field only the enemies the escaped wave SENT IN are billable. An enemy
    // that appears while the field runs — a split child (磨砻's 木制瑞印, 沉沙's 断刃), a summon, a 变身 copy, a boss
    // phantom — never crossed the leaker's own goal, so it must raise neither the HUD's ×N nor the LP the round settles
    // (unite.js uniteSurvivors / spec.js uniteLeft filter exactly this flag). It is a real enemy of the fight like any
    // other: `counted` (kills, 破坏完美作战) reads as on every field. `_scheduled` is the stage's own queue above, the
    // wave itself.
    if (this.kind === 'unite' && !opts._scheduled) e.uniteRuntime = true;
    // inTotal (the HUD capsule's own counter, DESIGN §14): only an enemy the stage scheduled (`_queueSpawn`, which
    // pre-counts it) — or, for future content, an explicit `opts.inTotal: true` — and that counts. Everything spawned
    // while the battle runs (a split child, a summon — bosses included —, a part, a 变身 copy) stays out of the capsule's
    // numerator and denominator, while `counted` (LP, 破坏完美作战, `killed`) keeps counting it as before (`uniteRuntime`
    // above is a billing flag only: it moves no counter).
    e.inTotal = opts.inTotal === true && e.counted;
    if (e.inTotal && !opts._precounted) {
      this.total++;
      const pp = this._pp(e.ownerId);
      if (pp) pp.total++;
    }
    if (e.tag === 'boss') {
      e.isBoss = true;
      if (this.sharedBoss) { e.bossPool = this.sharedBoss; this._syncBossHp(e); }
    }
    e.hp = e.bossPool ? e.hp : e.s.maxHp;
    this.units.push(e);
    this.enemies.push(e);
    // 深潜「洞彻」的永久反隐（spec flags `revealAll`，Match._ruleFlags()）：每只敌人一出生就挂 reveal。
    // 为什么放在 sim 而不是服务端的事件钩子：深潜的战斗在**客户端**按 spec 跑，服务端钩子客户端看不到
    // （玩家反馈 2026-11-06）。flag 缺失时这段是空操作，原版 / golden 逐字节不变。
    if (this.flags && this.flags.revealAll === true) {
      this.addBuff(e, { key: 'reveal:all', persist: true, flags: { reveal: true } });
      if (e.hidden) this._setHidden(e, false);
    }
    this._ev(['spawn', unitInfo(e)]);
    if (this._hooks.deploy) this.emit('deploy', { unit: e, initial: false });
    if (this._hooks.enemySpawn) this.emit('enemySpawn', { enemy: e });
    return e;
  }

  // =============================================================================================================
  // enemies on the field: hidden, boss pool, clamp, compaction

  _setHidden(e, on) {
    if (e.hidden === on) return;
    e.hidden = on;
    if (on) this._unblock(e);
    this.fx(on ? 'disappear' : 'appear', { x: e.x, y: e.y, id: e.id });
  }

  _syncBossHp(e) {
    const pool = e.bossPool;
    if (!pool) return;
    if (Number.isFinite(pool.maxHp) && pool.maxHp > 0 && e.base.maxHp !== pool.maxHp) { e.base.maxHp = pool.maxHp; e.markDirty(); }
    // a broken pool (NaN hp) must not leak NaN into the unit: show it full until the pool is sane again
    const ratio = pool.maxHp > 0 ? (Number.isFinite(pool.hp) ? Math.max(0, pool.hp) / pool.maxHp : 1) : 0;
    e.hp = e.s.maxHp * Math.min(1, ratio);
  }

  _bossSync() {
    if (!this.sharedBoss) return;
    for (const e of this.enemies) if (e.alive && e.bossPool) {
      this._syncBossHp(e);
      if (e.bossPool.hp <= 0) this.kill(e, null);
    }
  }

  _clampPos(e) {
    const R = this.rect, m = 0.5 - FIELD_EDGE_INSET; // inside the edge: on the edge tile, never halfway (body.js)
    if (e.x < R.c0 - m) e.x = R.c0 - m;
    if (e.x > R.c1 + m) e.x = R.c1 + m;
    if (e.y < R.r0 - m) e.y = R.r0 - m;
    if (e.y > R.r1 + m) e.y = R.r1 + m;
  }

  _compactEnemies() {
    if (!this._enemiesDirty) return;
    this.enemies = this.enemies.filter((e) => e.alive);
    this._enemiesDirty = false;
  }
}
