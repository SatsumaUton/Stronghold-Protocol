// server/match/match/echoPhase.js — 「深渊回响」的回合推进（DESIGN-ABYSS.md，2026-11-03）。
//
// 这个模式在实现上是 `mode: 'coop'` + `variant: 'deepecho'`：只有 `this.echoVariant` 是那个字符串时下面的
// 任何一段才会跑，所以普通房间（独立模拟 / 同盟模拟）的键集、随机流与行为一个字都不变。
//
// 深潜是什么：打完玩家实际到达的最后一个 boss（没打隐藏核心是 R14，打了是 R15）之后不结算，继续发普通回合。
// **显示回合**（HUD、深潜深度、数值缩放）照常数 16、17…，但**数据回合**（波次模板 / 地图 / 战斗时限 / 编组抽取）
// 按 1..bossRound-1 循环 —— 阵容会重复，数值一直往上（echo.js 的延伸曲线）。
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { echoDataRound, echoBossScale, isDiveRound, isEchoNodeRound, ECHO_SAFE_ROUND, ECHO_LAST_ROUND, ECHO_MAX_FREE_REFRESH, ECHO_BOND_BAN_ROUNDS, ECHO_DEPLOY_BAN_ROUNDS, ECHO_CHALLENGE_BLESSING_PCT, ECHO_NODE_FIRST, ECHO_NODE_EVERY, ECHO_NODE_ANCHOR_LAST, ECHO_NODE_LATE_EVERY } from './echo.js';
import { echoWordsForRound, echoWordById, applyEchoWords } from './echoWords.js';
import { echoCurseList, echoCurseEffects, echoCurseById, ECHO_CURSE_MAX_STACK, echoCurseUnitMods, curseUnitMatches, pickEchoCurse, pickRoundCurse, removeEchoCurses, mergeCurseEffects, ECHO_CURSE_RARITY_LABEL, isEchoFixedCurseLayer, isEchoBanCurse, ECHO_BAN_CURSE_FROM } from './echoCurse.js';
import {
  echoBlessingDue, echoBlessingOffer, echoBlessingById, echoBlessingMods, echoBlessingCoinMul,
  echoBlessingFunds, echoBlessingLateMul, echoBlessingHeal, echoBlessingFree, echoBlessingCurseRemove, echoBlessingOneShot, ECHO_BLESSING_REFRESH_MAX, ECHO_BLESSINGS, applyEchoBlessingMods, ECHO_BLESSING_MAX, ECHO_BLESSING_VOTE_MS, ECHO_BLESSING_RARITY_LABEL, ECHO_BLESSING_REFRESH_BONUS_MAX, echoBondDebuffSeconds,
} from './echoBlessing.js';
import { echoBountyDue, echoBountyCards } from './echoBounty.js';
import { echoSummonOnly, echoHitCountEnemy } from './echoWaves.js';
import { isEchoProjectionLayer, pickProjectionOffer, echoProjectionById } from './echoProjection.js';
import { startColdWind } from '../../sim/content/devices.js';
import { spawnYanyou } from '../../sim/content/tokens.js';
import { createRng, deriveSeed } from '../../sim/rng.js';import { ERR, PHASE } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { hiddenEligible } from '../finalAssault.js';
import { pieceBonds } from '../bondsMeta.js';
import { roundPick, isFlyKey } from '../waves.js';
import { FLOW_TICKER_PRIORITY, OK, fail } from './common.js';

export class MatchEcho {
  /**
   * 深潜每回合**最多保留多少「免费刷新」**（维护者 2026-11-03 定）。
   *
   * 免费刷新来自选项事件 / 效果（不按层数给），但会随回合数累积 —— 打到 30 层就可能攒出几十次白嫖。
   * 这里只在**深潜**里每回合开始裁一次；普通房间的 freeRefreshes 一行都不碰。
   */
  static MAX_FREE_REFRESH = ECHO_MAX_FREE_REFRESH;
  /**
   * 这一回合是不是深潜回合。
   *
   * 判据是「显示回合 ≥ 深潜第一回合」，**不是** `isDiveRound(round, bossRound)`：打过隐藏核心的队伍从 R16 起，
   * 没打过的从 R15 起，两条路的起点不同（DESIGN-ABYSS.md「深潜入口」）。
   */
  _echoDiveRound(r = this.round) {
    if (this.echoVariant !== 'deepecho' || this.echoDiveStart == null) return false;
    return Math.floor(Number(r) || 0) >= this.echoDiveStart;
  }

  /** 深潜回合用来查模板 / 时限 / 编组的数据回合（1..bossRound-1）。 */
  _echoDataRound(r = this.round) {
    const depth = this._echoDepth(r);
    // 14 层 = 原版 boss 回合：模板/场地查 bossRound
    if (depth === 14) return Math.max(1, Math.floor(Number(this.gd?.bossRound) || 14));
    return echoDataRound(r, this.echoDiveStart ?? 1, this.gd.bossRound);
  }

  /**
   * 【深渊回响】预生成的「横向模板」（维护者 2026-11-05）。
   *
   * 做法：先用原版机制（roundPick + 模板）把 1..13 每回合各生成 N 套，
   * 组成 N 个「完整集合」。正式玩的时候，**每回合随机挑一个集合**，
   * 取它在该回合的编组——于是相邻回合可以来自不同集合，达到横向随机。
   *
   * 每一套都是 roundPick 的真实输出，所以不可能出现原版没有的组合。
   */
  /**
   * 【深渊回响】横向随机的落点（维护者 2026-11-05）。
   *
   * 原版每一关的编组是**唯一**的（roundPick 不吃 rng，实测不同种子输出相同），
   * 所以随机只能来自「用哪一关的模板」。这里对每个深度用种子选一关（1..13）。
   *
   * 好处：每层都是一套完整的、原版验证过的出怪配置；不同层可以抽到不同的关。
   */
  /**
   * 【深渊回响】每一关的变体池（维护者 2026-11-05）。
   *
   * 原版一关只有一套编组（roundPick 不吃 rng），但编组里的
   * normal / elite / key 是**可以换的**（templateSpawns 用它们填占位）。
   * 所以本层只要把这几个角色换成同一关模板里出现过的其他敌人，
   * 就得到「同一关、不同配置」的若干套变体，且永远是原版合法组合。
   */
  /**
   * 挑战关（深度 5 / 10）：把波次里的 2 个槽位换成**强力精英**。
   *
   * 注意：1–15 层现在走原版生成路径，不经过 echoRandomWave，
   * 所以精英必须在这里补上（维护者 2026-11-05 实测：之前根本没加）。
   */
  /** 祝福「丰收」：每 3 层全队 +1 次免费刷新（维护者 2026-11-05 改掉了有条件的资金掉落）。 */
  _echoMaybeLootRefresh(r = this.round) {
    if (!Array.isArray(this.echoBlessings) || !this.echoBlessings.includes('loot')) return 0;
    const d = this._echoDepth(r);
    if (!(d > 0) || d % 3 !== 0) return 0;
    let n = 0;
    for (const ps of this.alivePlayers()) {
      if (!ps || !ps.shop) continue;
      this._echoGrantFreeRefresh(ps, 1, r);
      n += 1;
    }
    if (n) this.markPublic?.();
    return n;
  }

  _echoChallengeBoost(wave, r = this.round) {
    if (!wave || !Array.isArray(wave.spawns)) return wave;
    // 挑战关（5/10）与 15 层「非隐藏」：都要加压，但**只有 5/10 发奖励**（维护者 2026-11-05）
    const d = Math.max(1, this._echoDepth(r));
    if (!(d === 5 || d === 10 || d === 15)) return wave;
    const inject = d === 15 ? 3 : 2;
    try {
      const cap = 3000 * 1.35 ** (Math.max(1, this._echoDepth(r)) - 1);
      // 召唤物（tokenOnly / 别人的 summons 目标）不能被顶成精英发出来：这里从「所有 ELITE」里抽，
      // 那批召唤物也在里面（维护者 2026-11-05：16 层后看到没本体的召唤物）。
      const summonOnly = echoSummonOnly(this.gd);
      const hitCount = echoHitCountEnemy(this.gd);
      const pool = Object.keys((this.gd.raw && this.gd.raw.enemies) || {})
        .map((k) => ({ k, e: this.gd.enemy(k) }))
        .filter(({ k, e }) => e && !summonOnly.has(k) && !hitCount.has(k) && e.rank === 'ELITE' && Number(e.stats && e.stats.maxHp) <= cap && Number(e.stats && e.stats.moveSpeed) > 0);
      if (!pool.length) return wave;
      let n = 0;
      for (const s of wave.spawns) {
        if (n >= inject) break;
        if (!s || typeof s.enemyKey !== 'string') continue;
        const pick = pool[Math.floor((Number(this.rngWaves && this.rngWaves()) || 0) * pool.length)] || pool[0];
        if (!pick) break;
        s.enemyKey = pick.k;
        // 注入的精英**固定 1 只**：原来只换了 key、保留原条目的 count（×3），
        // 于是「2 条精英」实际会变成 6~8 只（维护者 2026-11-05：只保留 2 只，不要很多）
        s.count = 1;
        s.interval = 0;
        s.preview = null;
        n += 1;
      }
    } catch { /* 加不上也不能影响正常出怪 */ }
    return wave;
  }

  _echoVariantsFor(round) {
    const r = Math.max(1, Math.floor(Number(round) || 1));
    if (!this._echoVariantLib) this._echoVariantLib = new Map();
    let arr = this._echoVariantLib.get(r);
    if (arr) return arr;
    arr = [];
    // 原版的流程是「按势力抽一个，再取该势力该回合的 entry」。
    // 把它拆开：**每个势力各生成一套**，就得到属性不同的几套模板（深池 / 飞行 / 反射 ……）。
    const types = Array.isArray(this.factions) ? this.factions : [];
    for (const t0 of types) {
      try {
        const rng = createRng(deriveSeed(this.seed, `echo:fac:${r}:${t0}`));
        const pick = roundPick(this.gd, rng, [t0], r);
        if (pick) arr.push(pick);
      } catch { /* 该势力没有这一关，跳过 */ }
    }
    // 再补一套对局自带的（不同势力混合的那种）
    try {
      const base = roundPick(this.gd, createRng(deriveSeed(this.seed, `echo:base:${r}`)), this.factions, r);
      if (base && !arr.some((x) => JSON.stringify(x) === JSON.stringify(base))) arr.push(base);
    } catch { /* ignore */ }
    this._echoVariantLib.set(r, arr);
    return arr;
  }

  /**
   * 本回合用哪一套：按种子在该关的变体里抽一套（同一局里避开上层用过的）。
   */
  _echoPickVariant(round) {
    const arr = this._echoVariantsFor(round);
    if (!arr.length) return null;
    const rng = createRng(deriveSeed(this.seed, `echo:variant:${this.round}`));
    const pool = arr.length > 1 && this._echoPickUse ? arr.filter((x) => x !== this._echoPickUse) : arr;
    const idx = Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length));
    this._echoPickUse = pool[idx];
    return pool[idx];
  }

  /** 深潜第几回合（1 起；深潜之前是 0）。深度数字本身就是这个模式要比较的东西。 */
  _echoDepth(r = this.round) {
    if (this.echoDiveStart == null) return 0;
    return Math.max(0, Math.floor(Number(r) || 0) - this.echoDiveStart + 1);
  }

  /**
   * 词条上限（C 方案的结构难度）：基础 3 条，每深 10 层 +1，最多 8 条。
   *
   * 为什么要有这条：数值在 R31 就锁死 120 倍了（ECHO_HP_CAP），光靠数值推不出无尽难度，
   * 所以把「每层再多一条侵蚀词条」当成长线压力 —— 越深越讲阵容，而不是越深越堆血。
   */
  _echoWordCap(r = this.round) {
    const depth = this._echoDepth(r);
    if (!(depth > 0)) return 3;
    // 诅咒里带「侵蚀词条上限 +N」的（echoCurse.js）：按层累加，最多 8 条
    const curseCap = Math.max(0, echoCurseEffects(this.echoCurseIds).wordCap);
    // 2026-11-05 维护者：不设上限 —— 词池 20 条，能叠多少就放多少（深渊就是越来越狠）
    return 3 + Math.floor((depth - 1) / 10) + curseCap;
  }

  /**
   * 本回合的精英数量（C 方案的结构难度）：每 3 层一次，深度 30+ 起每回合 2 只、60+ 起 3 只。
   * 位置在 waves.js 的 echoRemapByBudget 里随机。
   */
  _echoEliteCount(r = this.round) {
    if (!this._echoDiveRound(r)) return 0;
    const depth = this._echoDepth(r);
    if (depth <= 0 || depth % 3 !== 0) return 0;
    return Math.min(3, 1 + Math.floor(depth / 30));
  }

  /**
   * 【已删除】`_echoBeginDive`。
   *
   * 旧语义是「打完最后一个 boss 时把深潜起点定在 16」，bossRounds 拿它的返回值当下一回合。
   * 2026-11-03 维护者改成**建房即深潜**（`echoDiveStart = 1`）之后，它只会返回 1，
   * 于是 boss 通关会 `startRound(1)` 把整局打回第 1 回合（2026-11-04 实测：15 层打完变深度 1、出怪回 R1）。
   * 现在 boss 通关只用 `startRound(this.round + 1)`；隐藏通关的「多一次祝福抽取」在 bossRounds 里显式设置。
   */

  /**
   * 本回合生效的侵蚀词条（写进 `echoWordsActive` 的 id 列表，存档也存这一项）。
   *
   * 随机源用 `deriveSeed(seed, 'echo:<round>')` 单独开一条流：不消耗商店 / 波次 / 选秀 / 战斗的随机数，
   * 所以同一个种子下深潜的词条固定，且不会让别的系统抽到不同的结果。
   */
  _echoRollWords(r = this.round) {
    if (!this._echoDiveRound(r)) {
      this.echoWordsActive = null;
      return null;
    }
    const rng = createRng(deriveSeed(this.seed, `echo:${r}`));
    const words = echoWordsForRound(r, this.echoDiveStart, rng, { maxWords: this._echoWordCap(r) });
    const prev = Array.isArray(this.echoWordsActive) ? this.echoWordsActive.join(',') : '';
    this.echoWordsActive = words.map((w) => w.id);
    // 播报（2026-11-05）：词条有变化才播，免得每回合重复刷屏
    if (this.echoWordsActive.join(',') !== prev && words.length) {
      this._echoPushAnnounce(`侵蚀词条：${words.map((w) => w.name).join('、')}`);
    }
    this._echoFlushAnnounce();
    return this.echoWordsActive;
  }

  /** 攒一条播报（同一回合的多条会在 _echoFlushAnnounce 里合成一行）。 */
  _echoPushAnnounce(text) {
    if (!text) return;
    if (!Array.isArray(this._echoAnnounce)) this._echoAnnounce = [];
    if (!this._echoAnnounce.includes(text)) this._echoAnnounce.push(text);
  }

  /** 把攒下的播报一次性发出去（ticker 会被覆盖，所以必须合并）。 */
  _echoFlushAnnounce() {
    if (!Array.isArray(this._echoAnnounce) || !this._echoAnnounce.length) return;
    const text = this._echoAnnounce.join('　｜　');
    this._echoAnnounce = [];
    this.tickerText?.(text, 1);
    this.log?.info?.(`[match ${this.roomCode}] echo announce: ${text}`);
  }

  /** 当前词条的对象形式（HUD / 测试用）。 */
  _echoWords() {
    return Array.isArray(this.echoWordsActive)
      ? this.echoWordsActive.map((id) => echoWordById(id)).filter(Boolean)
      : [];
  }

  /**
   * 给一场新战斗挂上词条注入。
   *
   * 只用 `battle.on('enemySpawn')` + `addBuff`：server/sim 一行都不用改，golden 的既有场景不受影响
   * （DESIGN-ABYSS.md §4 的「最重要的成本约束」）。
   */
  _echoHookBattle(battle) {
    if (this.echoVariant !== 'deepecho' || !battle || typeof battle.on !== 'function') return;
    const words = this._echoWords();
    if (words.length) battle.on('enemySpawn', ({ enemy }) => applyEchoWords(battle, enemy, words), { priority: 60, owner: 'echo' });
    // 祝福 B（全体攻速）：挂己方单位。用 `deploy`（初始部署与后续部署都会触发），
    // 只认 `side === 'ally'`，所以敌人与召唤物不会吃到。
    // 对敌异常（2026-11-05）：敌人生成时按概率挂永久 debuff（用已知的 enemySpawn 钩子）
    const debuffs = this._echoBlessings().filter((b) => b && b.enemyDebuff);
    if (debuffs.length) {
      battle.on('enemySpawn', ({ enemy }) => {
        if (!enemy || typeof battle.addBuff !== 'function') return;
        for (const b of debuffs) {
          const d = b.enemyDebuff || {};
          if (!d.mods) continue;
          if ((Number(battle.rng && battle.rng()) || 0) >= (Number(d.chance) || 0)) continue;
          const key = `echo:bless:${d.tag || b.id}`;
          if ((enemy.buffs || []).some((x) => x && x.key === key)) continue;
          battle.addBuff(enemy, { key, name: b.name, desc: b.desc || '', mods: { ...d.mods }, persist: true, visible: true });
        }
      }, { priority: 59, owner: 'echo:blessing' });
    }
    // 主题转化（维护者 2026-11-05）：每回合**开局前 N 秒**对全场敌人施压
    // （N 按祝福稀有度：普通 10 / 稀有 15 / 传说 20）。
    // ★ 不看队伍有没有对应盟约（维护者 2026-11-05「不用看队伍盟约激活，直接进入祝福卡池」）：
    //   这些是普通祝福，抽到就生效；`bondTheme` 只记录它从哪条盟约的主题来，不参与判定。
    const bondDebuffs = this._echoBlessings().filter((b) => b && b.kind === 'bonddebuff');
    if (bondDebuffs.length) {
      for (const b of bondDebuffs) {
        const secs = echoBondDebuffSeconds(b.rarity);
        const leftNow = () => secs - (Number(battle.time) || 0);
        const strike = (e, left) => {
          if (!e || e.alive === false || !(left > 0)) return;
          if (typeof battle.applyStatus !== 'function') return;
          for (const st of b.enemyStatuses || []) {
            battle.applyStatus(e, st.key, { duration: left, value: st.value, source: null });
          }
        };
        for (const e of battle.enemies || []) strike(e, leftNow());
        battle.on('enemySpawn', ({ enemy }) => strike(enemy, leftNow()), { priority: 57, owner: 'echo:bonddebuff' });
        // 反震（坚守）：窗口内敌人每次对己方造成伤害，都会吃到其中 reflect 比例的真实反伤。
        // source 为 null 的伤害不会再触发这条（`c.source.side === 'enemy'` 挡住），所以不会递归。
        if (Number(b.reflect) > 0 && typeof battle.dealDamage === 'function') {
          battle.on('damaged', (c) => {
            if (!(leftNow() > 0)) return;
            if (!c || !c.source || c.source.side !== 'enemy') return;
            if (!c.target || c.target.side !== 'ally') return;
            const amount = Number(c.amount) || 0;
            if (!(amount > 0)) return;
            battle.dealDamage(null, c.source, {
              amount: amount * Number(b.reflect), type: 'true', canDodge: false, tags: ['echo:reflect'],
            });
          }, { priority: 40, owner: 'echo:reflect' });
        }
        // 霜噬（谢拉格主题）：处于寒冷 / 冻结的敌人受到的伤害 +35%。
        // 必须挂 `hit`（伤害计算**之前**）：原版谢拉格 6 档就是这么乘 `c.dmg.mul` 的，
        // 挂到 `damaged` 上已经结算完了，改不动。
        if (Number(b.coldAmp) > 0) {
          battle.on('hit', (c) => {
            const t = c && c.target;
            if (!t || t.side !== 'enemy' || !c.dmg) return;
            const f = t.s && t.s.flags;
            if (!f || (!f.cold && !f.freeze)) return;
            c.dmg.mul = (Number(c.dmg.mul) || 1) * (1 + Number(b.coldAmp));
          }, { priority: 45, owner: 'echo:frost' });
        }
        // 惊惧（叙拉古主题）：窗口内被己方击中的敌人恐惧 duration 秒（原版暗杀就是 3 秒）。
        if (b.fearOnHit && Number(b.fearOnHit.secs) > 0) {
          const win = Number(b.fearOnHit.secs);
          const dur = Math.max(0.5, Number(b.fearOnHit.duration) || 3);
          battle.on('damaged', (c) => {
            if ((Number(battle.time) || 0) >= win) return;
            if (!c || !c.source || c.source.side !== 'ally') return;
            const t = c.target;
            if (!t || t.side !== 'enemy' || t.alive === false) return;
            if (t.s && t.s.flags && t.s.flags.fear) return;   // 已经在恐惧：不重复挂
            if (typeof battle.applyStatus === 'function') battle.applyStatus(t, 'fear', { duration: dur, source: c.source });
          }, { priority: 38, owner: 'echo:fear' });
        }
        // 震荡（卡西米尔主题）：窗口内每 interval 秒，对全场敌人造成「己方最高攻击 × atkScale」的真实伤害。
        if (b.pulse && Number(b.pulse.secs) > 0 && typeof battle.every === 'function') {
          const win = Number(b.pulse.secs);
          const iv = Math.max(0.5, Number(b.pulse.interval) || 2);
          const scale = Number(b.pulse.atkScale) || 0.6;
          battle.every(iv, () => {
            if ((Number(battle.time) || 0) > win + 1e-9) return;
            let atk = 0;
            for (const u of battle.units || []) {
              if (!u || u.side !== 'ally' || u.alive === false || !u.s) continue;
              if (Number.isFinite(u.s.atk)) atk = Math.max(atk, u.s.atk);
            }
            const amount = atk * scale;
            if (!(amount > 0) || typeof battle.dealDamage !== 'function') return;
            for (const e of battle.enemies || []) {
              if (!e || e.alive === false) continue;
              battle.dealDamage(null, e, { amount, type: 'true', canDodge: false, tags: ['echo:pulse'] });
            }
          }, { owner: 'echo:pulse' });
        }
        // 鲸吞（阿戈尔主题）：开战吞掉 1 只敌人（第一只出场的非领袖，直接击杀，记作真实伤害）。
        if (b.devour === true && typeof battle.dealDamage === 'function') {
          let done = false;
          battle.on('enemySpawn', ({ enemy }) => {
            if (done || !enemy || enemy.alive === false) return;
            if (enemy.tag === 'boss' || (enemy.def && enemy.def.rank === 'BOSS')) return;
            done = true;
            // 血量在单位顶层的 `hp`（`s` 里只有 maxHp 等属性）；用「当前血量」当伤害量 = 直接击杀
            const hp = Number(enemy.hp ?? (enemy.s && enemy.s.hp) ?? (enemy.s && enemy.s.maxHp)) || 0;
            battle.dealDamage(null, enemy, {
              amount: Math.max(hp, 1), type: 'true', canDodge: false, tags: ['echo:devour'],
            });
          }, { priority: 37, owner: 'echo:devour' });
        }
      }
    }
    // 反隐匿（维护者 2026-11-05）：「照破」每 interval 秒让隐匿敌人现形 duration 秒；「洞彻」永久反隐。
    // 隐匿敌人默认不可选中（sim/content/targeting.js：f.stealth && !f.reveal），所以挂一个 flags.reveal 的 buff；
    // 顺带把已经 DISAPPEAR 掉的（e.hidden）拉回可见，否则它连打都打不到。
    const reveals = this._echoBlessings().filter((b) => b && b.kind === 'reveal');
    if (reveals.length && typeof battle.addBuff === 'function') {
      const always = reveals.some((b) => b.always === true);
      const pulse = reveals.find((b) => b.always !== true) || null;
      const revealOne = (e) => {
        if (!e || !e.alive) return;
        if (e.hidden && typeof battle._setHidden === 'function') battle._setHidden(e, false);
        if (always) {
          if ((e.buffs || []).some((x) => x && x.key === 'echo:reveal')) return;
          battle.addBuff(e, { key: 'echo:reveal', name: '洞彻', persist: true, flags: { reveal: true } });
        } else if (pulse) {
          battle.addBuff(e, { key: 'echo:reveal', name: '照破', duration: Math.max(0.5, Number(pulse.duration) || 3), flags: { reveal: true } });
        }
      };
      battle.on('enemySpawn', ({ enemy }) => revealOne(enemy), { priority: 58, owner: 'echo:reveal' });
      if (always) for (const e of battle.enemies || []) revealOne(e);
      if (pulse && typeof battle.every === 'function') {
        battle.every(Math.max(1, Number(pulse.interval) || 8), () => { for (const e of battle.enemies || []) revealOne(e); }, { owner: 'echo:reveal' });
      }
    }
    // 谢拉格寒风（维护者 2026-11-05）：祝福「朔风」每 interval 秒刮一阵，让全场敌人寒冷 duration 秒。
    // 直接调原版盟约的实现（sim/content/devices.js startColdWind），数值口径与谢拉格满档一致。
    const winds = this._echoBlessings().filter((b) => b && b.kind === 'coldwind');
    for (const w of winds) {
      try {
        startColdWind(battle, { playerId: null, interval: Number(w.interval) || 10, duration: Number(w.duration) || 3 });
      } catch (e) { this.reportError('echo cold wind', e); }
    }
    // 炎佑之契（维护者 2026-11-05）：开战召唤 stacks 只炎佑（最多 2 只，token 自身 deployLimit 也是 2），
    // 存在 lifetime 秒后消失。攻/血按「己方场上干员总和的 30%」——和炎盟约满档同一口径。
    const yanyouBlessings = this._echoBlessings().filter((b) => b && b.kind === 'yanyou');
    if (yanyouBlessings.length && typeof battle.spawnToken === 'function') {
      const b = yanyouBlessings[0];
      const stacks = Math.max(1, Math.min(2, Math.floor(Number(b.stacks) || 1)));
      const lifetime = Math.max(0, Number(b.lifetime) || 0);
      const pid = battle.players && battle.players[0] ? battle.players[0].playerId : null;
      battle.on('battleStart', () => {
        if (pid == null) return;
        let atk = 0;
        let hp = 0;
        for (const u of battle.units || []) {
          // 干员（kind 可能是 'op' 或 'chess'）：battleStart 时还没部署，所以不能要求 alive/deployed
          if (u.side !== 'ally' || u.ownerId !== pid) continue;
          if (u.kind !== 'op' && u.kind !== 'chess') continue;
          atk += Number(u.s && u.s.atk) || 0;
          hp += Number(u.s && u.s.maxHp) || 0;
        }
        if (!(hp > 0)) return;
        const out = spawnYanyou(battle, pid, { atk: atk * 0.3, hp: hp * 0.3, count: stacks });
        if (lifetime > 0 && out.length) {
          battle.after(lifetime, () => { for (const y of out) if (y && y.alive) battle.kill(y, null); });
        }
      }, { once: true });
    }
    const altarStacks = Math.max(0, Math.min(2, Number(this.echoAltarBuffStacks) || 0));
    // 深潜补给选的「临时词条」：只在本层生效
    this.echoSupplyWords = (Array.isArray(this.echoSupplyWords) ? this.echoSupplyWords : []).filter((w) => w && w.round === this.round);
    const supplyMods = {};
    for (const w of this.echoSupplyWords) {
      for (const [k, v] of Object.entries(w.mods || {})) supplyMods[k] = (Number(supplyMods[k]) || 0) + (Number(v) || 0);
    }
    // 深层强化：16 层起数值型祝福按 ×2.5 放大（维护者 2026-11-05）
    const mods = echoBlessingMods(this.echoBlessings, this._echoDepth());
    for (const [k, v] of Object.entries(supplyMods)) mods[k] = (Number(mods[k]) || 0) + v;
    if (altarStacks > 0) {
      // 深渊祭坛：本层全队强化（每层最多叠 2 次）
      mods.atkPct = (Number(mods.atkPct) || 0) + 0.06 * altarStacks;
      mods.batPct = (Number(mods.batPct) || 0) + 0.04 * altarStacks;
      mods.hpPct = (Number(mods.hpPct) || 0) + 0.05 * altarStacks;
    }
    if (Object.keys(mods).length) {
      battle.on('deploy', ({ unit }) => {
        if (unit && unit.side === 'ally') applyEchoBlessingMods(battle, unit, mods);
      }, { priority: 60, owner: 'echo:blessing' });
    }
    // 干员减益诅咒（2026-11-05）：只在**命中的干员**身上挂负面 mods（按站位过滤），敌人和召唤物不吃。
    const unitCurses = echoCurseUnitMods([
      ...(Array.isArray(this.echoCurseIds) ? this.echoCurseIds : []),
      ...(this.echoRoundCurse ? [this.echoRoundCurse] : []),
    ]);
    if (unitCurses.length) {
      battle.on('deploy', ({ unit }) => {
        if (!unit || unit.side !== 'ally' || typeof battle.addBuff !== 'function') return;
        for (let ci = 0; ci < unitCurses.length; ci++) {
          const c = unitCurses[ci];
          if (!curseUnitMatches(c.filter, unit)) continue;
          // 同一条诅咒叠了 N 层就要挂 N 个 buff，所以 key 带序号
          const key = `echo:curse:${c.id}:${ci}`;
          if ((unit.buffs || []).some((x) => x && x.key === key)) continue;
          battle.addBuff(unit, { key, name: c.name, desc: '', mods: { ...c.mods }, persist: true, visible: true });
        }
      }, { priority: 59, owner: 'echo:curse' });
    }
    // 悬赏击杀回执（2026-11-05）：悬赏怪身上带着 mods.bountyId，死的时候记一笔，
    // 结算时用它对账「这张卡到底有没有打掉」（否则只能靠汇总 coin 猜）。
    battle.on('kill', ({ victim }) => {
      const id = victim && victim.mods && victim.mods.bountyId;
      if (!id) return;
      if (!Array.isArray(this.echoBountyPaid)) this.echoBountyPaid = [];
      if (!this.echoBountyPaid.includes(id)) this.echoBountyPaid.push(id);
    }, { priority: 40, owner: 'echo:bounty' });
    // 「腐蚀 / 溃烂」诅咒（2026-11-05）：全场持续伤害 —— 己方单位每秒按最大生命比例掉血。
    // 用 battle 的 `tick` 钩子（lifecycle.js emit('tick', { dt })），不改模拟器。
    const dot = this._echoCurseFx().dot;
    if (dot > 0) {
      let acc = 0;
      battle.on('tick', ({ dt } = {}) => {
        acc += Math.max(0, Number(dt) || 0);
        if (acc < 1) return;
        acc -= 1;
        const units = Array.isArray(battle.allyUnits) ? battle.allyUnits : [];
        for (const u of units) {
          if (!u || !u.alive) continue;
          const maxHp = Number(u.maxHp ?? (u.s && u.s.maxHp)) || 0;
          if (!(maxHp > 0)) continue;
          const amount = Math.max(1, Math.round(maxHp * dot));
          if (typeof battle.dealHPLose === 'function') battle.dealHPLose({ target: u, amount });
        }
      }, { priority: 30, owner: 'echo:curse-dot' });
    }
  }

  /**
   * 深潜只在**安全阀**（ECHO_SAFE_ROUND）按胜利结算。无尽模式下正常永远到不了 ——
   * 玩家是被深度墙打死的，走的是团灭的常规结算路径，深度就是成绩。
   */
  _echoAtEnd() {
    return this.echoVariant === 'deepecho' && Math.floor(Number(this.round) || 0) >= ECHO_SAFE_ROUND;
  }

  /** 这一回合是不是深潜的**固定节点**（深度 5 / 10 / 15 / 25 / 35…）。
   *  15 层之前只算「挑战关」（多来几只精英），**不返场 boss** —— 维护者 2026-11-04：
   *  前期就放第 14 回合的 boss，玩家打不过。 */
  /**
   * 【深渊回响】返场 boss 的选择（维护者 2026-11-05）：
   * 不再固定用 R14 的那个 boss，而是从全部 boss 里**随机换一个其他的**（排除本局 R14 已经打过的那个）。
   * 用种子 + 回合做随机源，同一局可复现。
   *
   * ★ 维护者 2026-11-05 第二次定：**隐秘核心的 boss 也要能返场**（之前把它排除了，
   *   结果 16 层以后翻来覆去只有 R14 那只）。所以池子里保留 `hiddenBossId`，只排除 `bossId`。
   */
  _echoBossPick(r = this.round) {
    const all = Object.keys((this.gd && this.gd.raw && this.gd.raw.bosses) || {});
    const pool = all.filter((id) => id !== this.bossId);
    if (!pool.length) return this.bossId;
    const rng = createRng(deriveSeed(this.seed, `echo:boss:${r}`));
    return pool[Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length))];
  }

  /**
   * 这一回合**真正打的** boss id（波次、共享血池、准备阶段面板、结算全部用它）。
   *
   * 深潜：隐藏核心层 → `hiddenBossId`；返场层 → `_echoBossPick()`（随机，含隐秘核心那只）；
   * 其他 → `bossId`。普通房间保持原逻辑（隐藏核心 / R14 的 boss）。
   */
  _echoBossIdFor(r = this.round) {
    if (this.echoVariant !== 'deepecho') {
      const eff = this._echoDiveRound(r) ? this._echoBossTemplateRound() : r;
      const hidden = eff === this.gd.hiddenRound && eff !== this.gd.bossRound;
      return hidden ? this.hiddenBossId : this.bossId;
    }
    if (this._echoHiddenBossRound(r)) return this.hiddenBossId;
    if (this._echoBossReturn(r)) {
      // 深度 14 是**原版 boss 回合**（不是返场）：就打本局那只 bossId
      if (this._echoDepth(r) === 14) return this.bossId;
      return this._echoBossPick(r);
    }
    return this.bossId;
  }

  _echoBossReturn(r = this.round) {
    if (!this._echoDiveRound(r)) return false;
    const depth = this._echoDepth(r);
    // 维护者 2026-11-05：深度 14 = 原版 boss 回合（用 boss 专用场地），不受「固定节点」限制
    if (depth === 14) return true;
    if (!isEchoNodeRound(r, this.echoDiveStart)) return false;
    // 15 层由「隐藏核心」单独判定（见 _echoHiddenBossRound），这里从 20 层才开始返场
    return depth >= 20;
  }

  /**
   * 15 层的**隐藏 boss**（维护者 2026-11-04）：达成隐藏条件才打隐藏核心；
   * 没达成的队伍这一层就是普通回合（正常地图刷怪），不是 boss。
   *
   * 判定与结算沿用原版 `hiddenEligible`（同一套条件，不额外放宽）。
   */
  _echoHiddenBossRound(r = this.round) {
    if (!this._echoDiveRound(r)) return false;
    if (this._echoDepth(r) !== 15) return false;
    if (!this.hiddenBossId) return false;
    try {
      return hiddenEligible(this.gd, {
        layerSum: this.hiddenLayerSum,
        teamLp: this.teamLp,
        aliveCount: (typeof this.alivePlayers === "function" ? this.alivePlayers().length : this.finalAliveCount),
        experimental: this.capacityExperiment,
      });
    } catch {
      return false;
    }
  }

  /** 挑战关（深度 5 / 10）：不返场 boss，改用「更强的精英怪」加压。 */
  _echoChallengeRound(r = this.round) {
    if (!this._echoDiveRound(r)) return false;
    const depth = this._echoDepth(r);
    return depth === 5 || depth === 10;
  }

  /**
   * 悬赏没打掉就吃诅咒（维护者 2026-11-05）。
   *
   * 判定放在结算开始、悬赏倒计时还没减之前：`roundsLeft <= 1` 的卡这一轮到期，
   * 如果目标真被打掉了，卡会在击杀时结算并移除，所以「到期还留着」就是没打掉。
   * 每条到期卡只降一层诅咒，按深度抽（和挑战关同一套 pickEchoCurse）。
   */
  _echoSettleBountyFailure(players = this.alivePlayers()) {
    // 击杀回执：_echoHookBattle 的 `kill` 钩子把 victim.mods.bountyId 记进来。
    const paid = Array.isArray(this.echoBountyPaid) ? this.echoBountyPaid : [];
    let failed = 0;
    for (const ps of Array.isArray(players) ? players : []) {
      if (!ps) continue;
      const r = this.lastResults.get(ps.playerId) || {};
      const coins = Math.max(0, Math.trunc(Number(r.coins) || 0));
      for (const b of ps.bounties || []) {
        if (!b || !(b.roundsLeft <= 1)) continue;
        const card = b.card || {};
        // 完美结算类：本轮 own battle 完美就直接付了，不算失败
        if (card.payout === 'perfect' && r.perfect !== false) continue;
        // 真的打掉了（击杀钩子有回执）
        if (b.id && paid.includes(b.id)) continue;
        // 兜底：本轮有悬赏收入就按「已达成」处理 —— 服务端只拿到汇总 coin，分不清是哪张卡；
        // 宁可漏判（少降诅咒）也不要把成功的一局判成失败。
        if (coins > 0) continue;
        failed += 1;
      }
    }
    if (!failed) return null;
    const rng = createRng(deriveSeed(this.seed, `echo:bountyfail:${this.round}`));
    const depth = this._echoDepth(this.round);
    const picked = pickEchoCurse(depth, rng, { exclude: this._echoCurseExclude(depth) });
    const c = (picked && this._echoAddCurse(picked.id, rng)) || this._echoAddCurse('erosion', rng);
    if (!c) return null;
    this._echoPushAnnounce(`悬赏未达成：深渊降下诅咒「${c.name}」`);
    this._echoFlushAnnounce();
    this.markPublic?.();
    return c.id;
  }

  /**
   * 挑战关（深度 5 / 10）的结算奖励（维护者 2026-11-05 第二次改）。
   *
   * 旧实现：按本人漏怪发资金（30 / 15 / 8 / 1，10 层 ×1.5），团队完美再 +1 次祝福抽取。
   * 那段写在 settle 的 per-player 循环里，4 个人会重复加 4 次，这次一并修掉。
   *
   * 新实现：**不发资金**。只看全队清怪率 —— 达到 `ECHO_CHALLENGE_BLESSING_PCT` 就给
   * **全队一次祝福三选一**（完美通关 = 100%，自然也在线内）。
   * 分母 = 本回合波次只数 × 还活着的人数（每个阵地跑同一份波次），分子 = 分母 − 全队计入的漏怪。
   *
   * @returns {{ ratio: number, granted: boolean } | null} 不是挑战关 / 没有波次时 null
   */
  _echoSettleChallenge() {
    if (!this._echoChallengeRound(this.round)) return null;
    const total = Array.isArray(this.wave?.spawns)
      ? this.wave.spawns.reduce((a, s) => a + Math.max(0, Number(s.count) || 0), 0)
      : 0;
    const players = this.alivePlayers();
    if (!(total > 0) || !players.length) return null;
    let leaked = 0;
    for (const ps of players) {
      const r = this.lastResults.get(ps.playerId) || {};
      leaked += (r.leaked || []).filter((l) => l && l.counted !== false).length;
    }
    const denom = total * players.length;
    const ratio = Math.max(0, Math.min(1, 1 - leaked / denom));
    const denied = !(ratio + 1e-9 >= ECHO_CHALLENGE_BLESSING_PCT / 100);
    if (!denied) {
      // 全队共享一次抽取（echoBlessingOffer 是团队级投票，不是每人一份）
      this.echoBlessingDraws = (Number(this.echoBlessingDraws) || 0) + 1;
      this.tickerText?.(`挑战关：全队清怪 ${Math.round(ratio * 100)}%，获得一次祝福三选一`, 1);
      this.markPublic?.();
    } else {
      // 没达成 → 不给祝福，改为深渊降下诅咒。按深度抽（echoCurse.js 的 pickEchoCurse）：
      // 5 层只会是普通诅咒，10 层起有稀有，16 层以后才可能出传说。
      const rng = createRng(deriveSeed(this.seed, `echo:curse:${this.round}`));
      const depth = this._echoDepth(this.round);
      const picked = pickEchoCurse(depth, rng, { exclude: this._echoCurseExclude(depth) });
      // 统一入口：排异类若已无盟约可禁会返回 null，这时退回「侵蚀」（不记假账）
      const curse = (picked && this._echoAddCurse(picked.id, rng)) || this._echoAddCurse('erosion', rng);
      const tier = curse ? (ECHO_CURSE_RARITY_LABEL[curse.rarity] || '普通') : '';
      if (curse) {
        this._echoPushAnnounce(`挑战关：全队清怪 ${Math.round(ratio * 100)}%，深渊降下诅咒「${curse.name}」（${tier}）`);
        this._echoFlushAnnounce();
      }
      this.markPublic?.();
    }
    return { ratio, granted: !denied };
  }

  /**
   * boss 返场借用哪一回合的模板。
   *
   * 旧入口下是 `diveStart − 1`（玩家实际打过的最后一个 boss）。现在从第 1 回合就深潜，
   * 玩家一个 boss 都没打过，所以退回官方最后一关（`gd.bossRound`，通常是 R14）。
   */
  _echoBossTemplateRound() {
    // 15 层的隐藏核心：模板用官方隐藏关（R15），不是 bossRound
    if (this._echoHiddenBossRound()) return Math.max(1, Math.floor(Number(this.gd?.hiddenRound) || 15));
    const start = Math.max(1, Math.floor(Number(this.echoDiveStart) || 1));
    if (start > 1) return start - 1;
    return Math.max(1, Math.floor(Number(this.gd?.bossRound) || ECHO_LAST_ROUND));
  }

  /**
   * 当前诅咒的聚合效果（echoCurse.js）。
   *
   * 每次现算：诅咒会被挑战关加上、也会被「净化 / 涤罪」祝福清掉，缓存一定过期。
   * 已接入的 kind 及消费点见 echoCurse.js 的 ECHO_CURSE_LIVE_KINDS。
   */
  _echoCurseFx() {
    const run = echoCurseEffects(this.echoCurseIds);
    const round = this.echoRoundCurse ? echoCurseEffects([this.echoRoundCurse]) : null;
    return round ? mergeCurseEffects(run, round) : run;
  }

  /**
   * 商店条目的禁用判定（**所有房间通用**，不限深潜）：
   * 在 `bannedChess` 里，或「所有盟约都在 disabledBonds / staticInactiveBonds 里」。
   *
   * 池子本身不会给出禁用干员，但几条旁路（自选补位、出售回填、装备特殊刷新）是直接
   * `setShopSlot` 塞进去的 —— 这里给它们同一道闸（维护者 2026-11-05：和原版一样，
   * 被禁用的干员不可能出现在商店）。
   */
  _shopChessBanned(id) {
    if (Array.isArray(this.bannedChess) && this.bannedChess.includes(id)) return true;
    const c = this.gd && typeof this.gd.chess === 'function' ? this.gd.chess(id) : null;
    const bonds = c && Array.isArray(c.bonds) ? c.bonds : [];
    if (!bonds.length) return false;
    const off = new Set([...(this.disabledBonds || []), ...(this.staticInactiveBonds || [])]);
    return bonds.every((b) => off.has(b));
  }

  /**
   * 「深渊通胀」倍率：**16 层起**商店购买价 / 刷新价随深度 +4%/层，封顶 ×1.5（维护者 2026-11-05）。
   *
   * 抽成独立函数是因为它现在**既是真实价格、也是界面上的固定规则**：
   * 「本局信息 → 深渊回响」里那条固定规则要显示当前倍率，必须和 `priceOf()` 算同一个数，
   * 不能在两个地方各写一遍公式。
   *
   * @param {number} [r] 显示回合（默认当前回合）
   * @returns {number} 1 = 未生效（≤15 层）
   */
  _echoShopInflate(r = this.round) {
    if (this.echoVariant !== 'deepecho') return 1;
    const depth = this._echoDepth(r);
    return depth >= 16 ? Math.min(1.5, 1 + 0.04 * (depth - 15)) : 1;
  }

  /** 商店加价倍率（诅咒「通胀 / 暴利」× 深渊通胀）：`player/economy.js` 的 priceOf 消费它。 */
  _echoShopPriceMul() {
    if (this.echoVariant !== 'deepecho') return 1;
    // 16 层以后的资金出口：玩家此时已满级，继续买干员/装备/刷新时资金自然被消耗。
    return this._echoCurseFx().shopPriceMul * this._echoShopInflate();
  }

  /** 漏怪扣血（含诅咒「失血 / 溃血 / 剧痛」）：只放大已有漏怪，仍受每回合上限约束。 */
  _echoLpLoss(raw, cap) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    const limit = Math.max(0, Math.floor(Number(cap) || 0));
    const fx = this.echoVariant === 'deepecho' ? this._echoCurseFx() : null;
    const adj = fx && n > 0 && (fx.lpMul !== 1 || fx.lpExtra)
      ? Math.ceil(n * (fx.lpMul || 1)) + (fx.lpExtra || 0)
      : n;
    return Math.min(limit, Math.max(0, adj));
  }

  /** 免费刷新上限：奇迹·诅咒的 `ECHO_MAX_FREE_REFRESH`（当前 5）次，再被「枯竭」这类减（最低 0）。 */
  _echoFreeRefreshCap() {
    // 用常量而不是 MatchEcho.MAX_FREE_REFRESH：后者在静态初始化顺序变化时会变成 undefined，
    // 于是 Math.max(0, NaN) = NaN，所有 Math.min(NaN, x) 的钳制**静默失效**（维护者 2026-11-05 实测）。
    const base = Number(ECHO_MAX_FREE_REFRESH) || 0;
    const delta = Number(this._echoCurseFx().freeRefresh) || 0;
    return Math.max(0, base + delta);
  }

  /**
   * 「奇迹·诅咒」的真实口径（维护者 2026-11-05 更正）：
   * **每回合能拿到的免费刷新总数 ≤ 5**，不是「库存上限 5」。
   *
   * 差别很要命：库存封顶时，玩家把这 5 次刷完（库存归 0），再去买/卖干员、吃祝福、触发按层效果，
   * 每个授予点又各给 5 次 —— 一回合实际能白嫖几十次。所以这里改成**按回合累计**：
   *   * `shop.echoGrantRound` 记录「本回合」，换回合即把 `echoRefreshGranted` 归零；
   *   * 每次授予只发 `min(想要, 剩余额度, 库存余量)`，买卖干员、祝福、按层效果全部走同一个口子。
   *
   * @param {object} ps 玩家状态
   * @param {number} n 想给几次
   * @returns {number} 实际发出几次
   */
  _echoGrantFreeRefresh(ps, n = 1, r = this.round) {
    const shop = ps && ps.shop ? ps.shop : null;
    const want = Math.trunc(Number(n) || 0);
    if (!shop || !(want > 0)) return 0;
    if (shop.echoGrantRound !== r) {
      shop.echoGrantRound = r;
      shop.echoRefreshGranted = 0;
    }
    const cap = this._echoFreeRefreshCap();
    const granted = Math.max(0, Math.trunc(Number(shop.echoRefreshGranted) || 0));
    const stock = Math.max(0, Math.trunc(Number(shop.freeRefreshes) || 0));
    const add = Math.max(0, Math.min(want, cap - granted, cap - stock));
    if (add > 0) {
      shop.echoRefreshGranted = granted + add;
      shop.freeRefreshes = stock + add;
      ps.dirty?.();
    }
    return add;
  }

  /**
   * 特殊回合的**入场播报**（维护者 2026-11-05）：玩家一进准备阶段就知道这一回合是什么性质，
   * 而不是打起来了才发现是挑战关 / boss 返场。普通回合什么都不播。
   */
  _echoAnnounceRoundKind(r = this.round) {
    if (!this._echoDiveRound(r)) return;
    const depth = this._echoDepth(r);
    if (this._echoChallengeRound(r)) {
      this._echoPushAnnounce(`挑战关：全队清怪 ≥${ECHO_CHALLENGE_BLESSING_PCT}% 得一次祝福三选一，未达成则降诅咒`);
      return;
    }
    if (this._echoHiddenBossRound(r)) { this._echoPushAnnounce('隐藏核心：达成条件，本回合迎战隐藏 boss'); return; }
    if (this._echoBossReturn(r)) { this._echoPushAnnounce('深渊节点：boss 返场（明牌）'); return; }
    if (depth === 15) this._echoPushAnnounce('第 15 层：精英加压（本层不出 boss）');
    // 16 层起的经济消耗：进入这一层就播报一次（挂机玩家回来也能在播报里看到），
    // 之后每层的实际倍率挂在「本局信息 → 深渊回响 → 固定规则」的「深渊通胀」条目上。
    if (depth === 16 && this.echoInflationAnnounced !== true) {
      this.echoInflationAnnounced = true;
      // 广播口径（维护者 2026-11-05）：要说清楚「新增了什么」，而不是只报一个倍率。
      // ⚠ 这里**直接发一条独立 ticker**，不走 `_echoPushAnnounce` 队列：
      // 队列会把「本回合诅咒 / 侵蚀词条」拼成一行（用竖线连接），长文本还会被服务端截到 200 字，
      // 16 层的规则播报就容易被挤没（维护者 2026-11-05 反馈「没有房间广播」）。
      const text = `新增固定规则「深渊通胀」：16 层起，商店购买价与刷新价每层 +4%（当前 ×${this._echoShopInflate(r).toFixed(2)}，封顶 ×1.5）。可在「本局信息 → 深渊回响」查看。`;
      this.tickerText?.(text, FLOW_TICKER_PRIORITY);
      this.log?.info?.(`[match ${this.roomCode}] echo inflation announced`);
    }
  }

  /**
   * 每回合开始刷新诅咒（维护者 2026-11-05）。
   *
   * 两件事：
   *   1. **固定回合**（`ECHO_FIXED_CURSE_ROUNDS`）：到这一层就永久加一条（已在列表里就不重复）；
   *   2. **回合诅咒**（`ECHO_ROUND_CURSES`）：按深度随机，只影响本回合，下回合重刷。
   *      其中的 `destroyEquip` 当场结算（每人随机销毁 1 件已装备的装备）。
   */
  /**
   * 抽诅咒时的排除规则（维护者 2026-11-05）：
   *   ① 25 层起不再出现「限制部署 / 限制盟约」两类（深层已经很难，再封地块 / 排异盟约没法玩）；
   *   ② 已经叠到上限的同类不再抽（否则 `_echoAddCurse` 会拒收，等于白抽一条）。
   * 固定层、悬赏失败、挑战关未达成这三处抽诅咒都用它，口径一致。
   * @param {number} [depth]
   * @returns {(c: object) => boolean}
   */
  _echoCurseExclude(depth = this._echoDepth()) {
    const held = Array.isArray(this.echoCurseIds) ? this.echoCurseIds : [];
    return (c) => (depth >= ECHO_BAN_CURSE_FROM && isEchoBanCurse(c))
      || held.filter((x) => x === (c && c.id)).length >= ECHO_CURSE_MAX_STACK;
  }

  _echoRefreshCurses(r = this.round) {
    if (!this._echoDiveRound(r)) { this.echoRoundCurse = null; return null; }
    const depth = this._echoDepth(r);
    // 排异到期：到层就解除（先清名单，下面的扫场会把场上干员放回来）
    this._echoExpireBondBans(depth);
    const fixed = isEchoFixedCurseLayer(depth);
    // 每层只给一次：`startRound` 可能因为重规划 / 有人退出被重跑，随机抽的话每次都会抽到新的，
    // 同一层就会叠出好几条（维护者 2026-11-05 改成随机后必须补这个去重）。
    if (!Array.isArray(this.echoFixedCurseLayers)) this.echoFixedCurseLayers = [];
    if (fixed && !this.echoFixedCurseLayers.includes(depth)) {
      this.echoFixedCurseLayers.push(depth);
      // 维护者 2026-11-05：固定层**还是那些层**（6/8/10/12/14/18/22，之后每 4 层一个），
      // 但给哪条诅咒改成按种子随机 —— 这样固定层能一直延伸到很后面，不再是「22 层以后就没有了」。
      // 25 层起不再随机到「限制部署 / 限制盟约」（深层本来已经很难了）。
      const held = Array.isArray(this.echoCurseIds) ? this.echoCurseIds : [];
      const rngF = createRng(deriveSeed(this.seed, `echo:fixed:${r}`));
      // 统一入口：记 id + 施加副作用（封锁 / 排异）；排除规则见 _echoCurseExclude
      const pickFixed = pickEchoCurse(depth, rngF, { exclude: this._echoCurseExclude(depth) });
      const fc = pickFixed ? this._echoAddCurse(pickFixed.id, rngF) : null;
      if (fc) {
        const tier = ECHO_CURSE_RARITY_LABEL[fc.rarity] || '普通';
        this._echoPushAnnounce(`深渊诅咒「${fc.name}」（${tier}）：${fc.desc}`);
        const kind = fc.effect && fc.effect.kind;
        if (kind === 'deployBan' && this.echoBannedTiles.length) {
          this._echoPushAnnounce(`已封锁 ${this.echoBannedTiles.length} 个地块（无法部署）`);
        } else if (kind === 'bondBan' && this.echoBannedBonds.length) {
          const names = this.echoBannedBonds.map((b) => this.gd.bond(b)?.name || b).join('、');
          this._echoPushAnnounce(`已排异【${names}】：该盟约干员无法部署`);
        }
      }
    }
    this._echoAnnounceRoundKind(r);
    const rng = createRng(deriveSeed(this.seed, `echo:rcurse:${r}`));
    // 回合诅咒也走同一套深层排除：25 层起不再出封锁 / 排异 / 随机销毁装备（维护者 2026-11-05）
    const pick = pickRoundCurse(depth, rng, { exclude: this._echoCurseExclude(depth) });
    this.echoRoundCurse = pick ? pick.id : null;
    if (pick) {
      const tier = ECHO_CURSE_RARITY_LABEL[pick.rarity] || '普通';
      this._echoPushAnnounce(`本回合诅咒「${pick.name}」（${tier}）：${pick.desc}`);
    }
    // 每回合 prep 开始时再扫一遍棋盘（维护者 2026-11-05「接入」持续约束）：
    // 玩家可能用同构体装备临时获得被排异的盟约，或把干员重新摆上场 —— 都要当场收回。
    const swept = this._echoWithdrawBannedBond();
    if (swept) this._echoPushAnnounce(`排异：${swept} 名干员被收回`);
    // 禁放地块上的干员自动回整备区（维护者 2026-11-05：被封锁的位置不该继续站着人）
    const recalled = this._echoRecallFromBannedTiles();
    if (recalled) this._echoPushAnnounce(`封锁：${recalled} 名干员被收回整备区`);
    if (pick && pick.effect && pick.effect.kind === 'destroyEquip') {
      let n = 0;
      for (const ps of this.alivePlayers()) n += this._echoDestroyEquipped(ps, rng);
      if (n) this.tickerText?.(`深渊诅咒「${pick.name}」：销毁了 ${n} 件装备`, 1);
    }
    return this.echoRoundCurse;
  }

  /**
   * 把站在「禁放地块」上的干员自动收回整备区（维护者 2026-11-05）。
   *
   * 诅咒「封锁」可能在本回合中途降下，也可能玩家刚把干员摆上去 —— 每回合 prep 开始都扫一遍，
   * 命中就把棋子 detach 出场并 stow 回手牌（手牌满则进待命队列）。
   *
   * @returns {number} 被收回的干员数
   */
  _echoRecallFromBannedTiles() {
    const banned = this.echoBannedTiles;
    if (!Array.isArray(banned) || !banned.length) return 0;
    const tiles = new Set(banned);
    let n = 0;
    for (const ps of this.alivePlayers()) {
      if (!ps || !ps.board) continue;
      // ps.board 的键就是 `${row},${col}`（棋子本身不带坐标）
      for (const [key, piece] of [...ps.board.entries()]) {
        if (!piece || piece.kind !== 'chess') continue;
        if (!tiles.has(key)) continue;
        try {
          ps._detach({ area: 'board', key, piece });
          ps.stow(piece, { allowTemp: true });
          n += 1;
        } catch { /* 回收失败不影响本回合 */ }
      }
    }
    return n;
  }

  /** 销毁该玩家随机 1 件已装备的装备（从棋盘干员身上摘掉，不回手牌、不退池）。 */
  _echoDestroyEquipped(ps, rng = () => 0.5) {
    if (!ps || !ps.board) return 0;
    const holders = [...ps.board.values()].filter((p) => p && Array.isArray(p.items) && p.items.length);
    if (!holders.length) return 0;
    const piece = holders[Math.min(holders.length - 1, Math.floor((Number(rng()) || 0) * holders.length))];
    const idx = Math.min(piece.items.length - 1, Math.floor((Number(rng()) || 0) * piece.items.length));
    piece.items.splice(idx, 1);
    ps.dirty?.();
    return 1;
  }

  /**
   * 加一条诅咒（统一入口，维护者 2026-11-05 审计）：
   * 记录 id 的同时**施加副作用** —— 「封锁 / 排异」不是纯数值，光记 id 等于没生效。
   * 排异若已经没得禁（所有附加盟约都被禁过），这条不成立，返回 null（不记假账）。
   */
  _echoAddCurse(id, rng = () => 0.5) {
    const c = echoCurseById(id);
    if (!c) return null;
    // 叠层上限（维护者 2026-11-05）：同一条最多 ECHO_CURSE_MAX_STACK 层，到顶就不再入账
    if (!Array.isArray(this.echoCurseIds)) this.echoCurseIds = [];
    if (this.echoCurseIds.filter((x) => x === id).length >= ECHO_CURSE_MAX_STACK) return null;
    const kind = c.effect && c.effect.kind;
    if (kind === 'bondBan') {
      const bond = this._echoApplyBondBan(rng);
      if (!bond) return null;
      // 排异是有时限的（维护者 2026-11-05）：记下到期层，回调时自动解除
      if (!this.echoBannedBondsUntil || typeof this.echoBannedBondsUntil !== 'object') this.echoBannedBondsUntil = {};
      this.echoBannedBondsUntil[bond] = this._echoDepth(this.round) + ECHO_BOND_BAN_ROUNDS;
    } else if (kind === 'deployBan') {
      this._echoApplyDeployBan(c.effect.value, rng);
    }
    if (!Array.isArray(this.echoCurseIds)) this.echoCurseIds = [];
    this.echoCurseIds.push(c.id);
    return c;
  }

  /**
   * 诅咒条目被移除后，把它的**实际效果**也撤掉（维护者 2026-11-05）。
   *
   * 以前「净化 / 反制」只删 `echoCurseIds`：诅咒图标从列表里消失了，可封锁的地块还在封、
   * 排异的盟约还在禁 —— 玩家看到的是「诅咒没了但我还是不能部署」。
   * 这里把对应的禁令一起清掉，并把场上受影响的干员收回整备区。
   *
   * @param {string[]} removedIds 刚被移除的诅咒 id
   * @returns {boolean} 是否动过禁令
   */
  _echoSyncBanCurse(removedIds = []) {
    const ids = Array.isArray(removedIds) ? removedIds : [];
    let changed = false;
    if (ids.includes('block_tiles') && Array.isArray(this.echoBannedTiles) && this.echoBannedTiles.length) {
      this.echoBannedTiles = [];
      this.echoBannedTilesUntil = 0;
      changed = true;
    }
    if (ids.includes('block_bond') && Array.isArray(this.echoBannedBonds) && this.echoBannedBonds.length) {
      this.echoBannedBonds = [];
      this.echoBannedBondsUntil = {};
      changed = true;
    }
    if (changed) {
      this._echoRecallFromBannedTiles?.();
      this._echoWithdrawBannedBond?.();
      this.markPublic?.();
    }
    return changed;
  }

  /**
   * 排异到期清理（维护者 2026-11-05）：`echoBannedBondsUntil[bond] <= depth` 的一律解除。
   * 解除后由 `_echoWithdrawBannedBond()` 把场上那些干员收回（它在同一个 prep 里紧接着跑）。
   *
   * @returns {string[]} 本层刚解除的盟约 id
   */
  _echoExpireBondBans(depth = this._echoDepth(this.round)) {
    const until = this.echoBannedBondsUntil;
    if (!until || typeof until !== 'object') return [];
    const out = [];
    for (const [bond, at] of Object.entries(until)) {
      if (!(Number(at) > 0) || Number(at) > depth) continue;
      out.push(bond);
      delete until[bond];
    }
    if (out.length && Array.isArray(this.echoBannedBonds)) {
      this.echoBannedBonds = this.echoBannedBonds.filter((b) => !out.includes(b));
      // 诅咒列表也要跟着消失：`echoCurseIds` 里每条排异记一次 `block_bond`，
      // 解除几个就删几条（维护者 2026-11-05：3 回合后诅咒还在列表里、干员也放不上去）。
      if (Array.isArray(this.echoCurseIds)) {
        let left = out.length;
        this.echoCurseIds = this.echoCurseIds.filter((id) => {
          if (left > 0 && id === 'block_bond') { left -= 1; return false; }
          return true;
        });
      }
      const names = out.map((b) => this.gd.bond(b)?.name || b).join('、');
      this._echoPushAnnounce(`排异解除：【${names}】的干员可以重新部署了`);
    }
    return out;
  }

  /**
   * 手动提前结束「排异 / 封锁」（维护者 2026-11-05）：持有对应的反制祝福（`counterBans`，如「开路」）时，
   * 玩家可以不等诅咒自己到期，直接消耗一次把它清掉。
   *
   * `g.echoCounterUse` → 这里。没持有 / 当前没有可解除的效果都返回失败，不消耗。
   */
  setEchoCounterUse(ps) {
    if (this.echoVariant !== 'deepecho') return fail(ERR.WRONG_PHASE);
    if (!ps || ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    const held = Array.isArray(this.echoCounterIds) ? this.echoCounterIds : [];
    const idx = held.findIndex((id) => {
      const b = echoBlessingById(id);
      return !!(b && b.counterBans);
    });
    if (idx < 0) return fail(ERR.BAD_TARGET, 'no counter for bans');
    const hadTiles = Array.isArray(this.echoBannedTiles) ? this.echoBannedTiles.length : 0;
    const hadBonds = Array.isArray(this.echoBannedBonds) ? this.echoBannedBonds.length : 0;
    if (!hadTiles && !hadBonds) return fail(ERR.WRONG_PHASE, 'nothing to lift');
    const b = echoBlessingById(held[idx]);
    held.splice(idx, 1);
    this.echoBannedTiles = [];
    this.echoBannedBonds = [];
    // 解除后诅咒列表里对应的条目也要一起消失（维护者 2026-11-05）
    if (Array.isArray(this.echoCurseIds)) this.echoCurseIds = this.echoCurseIds.filter((id) => id !== 'block_bond' && id !== 'block_tiles');
    if (this.echoBannedBondsUntil && typeof this.echoBannedBondsUntil === 'object') this.echoBannedBondsUntil = {};
    this._echoPushAnnounce(`祝福「${b.name}」：提前解除封锁 / 排异`);
    this._echoFlushAnnounce();
    this.markPublic();
    return OK;
  }

  /** 「护盾」祝福：开一次全队投票，指定要保护的附加盟约（30 秒，票多者得，2026-11-05）。 */
  _echoOpenShieldVote() {
    const rawBonds = (this.gd.raw && this.gd.raw.bonds) || {};
    const banned = Array.isArray(this.echoBannedBonds) ? this.echoBannedBonds : [];
    const cands = Object.keys(rawBonds).filter((b) => {
      const rec = rawBonds[b];
      return rec && rec.isCore !== true && !banned.includes(b);
    });
    if (!cands.length) return null;
    // 护盾指定盟约也是一次决策：别吃准备时间（维护者 2026-11-05）
    this._echoPausePrepClock();
    this.echoShieldOffer = cands.slice(0, 12);
    this._echoShieldVotes.clear();
    this.echoShieldEndsAt = (this.sched?.now?.() ?? 0) + ECHO_BLESSING_VOTE_MS;
    this.cancel(this._echoShieldTimer);
    this._echoShieldTimer = this.later(ECHO_BLESSING_VOTE_MS, () => {
      this._echoShieldTimer = null;
      try { this._echoForceResolveShield(); } catch { /* 结算失败不该炸掉整局 */ }
    });
    this.markPublic();
    return this.echoShieldOffer;
  }

  /** 护盾投票（`g.echoShield { pick }`），票齐才结算。 */
  setEchoShieldVote(ps, pick) {
    if (this.echoVariant !== 'deepecho') return fail(ERR.WRONG_PHASE);
    const offer = this.echoShieldOffer;
    if (!Array.isArray(offer) || !offer.length) return fail(ERR.WRONG_PHASE, 'no shield offer');
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (ps.alive === false) return fail(ERR.SPECTATOR, 'dead players do not vote');
    const i = Math.floor(Number(pick));
    // 允许 i === offer.length：那是「放弃本次」那一张（维护者 2026-11-05）
    if (!(i >= 0 && i <= offer.length)) return fail(ERR.BAD_TARGET);
    this._echoShieldVotes.set(ps.playerId, i);
    this.markPublic();
    // 只有**活着**的玩家参与投票（维护者 2026-11-05：死亡的玩家不再参与祝福选择）
    const voters = this.humans().filter((p) => p.connected && !p.spectator && p.alive !== false && !p.left).map((p) => p.playerId);
    if (!voters.length || !voters.every((id) => this._echoShieldVotes.has(id))) return OK;
    return this._echoSettleShield(this._echoTallyPick(this._echoShieldVotes));
  }

  /** 30 秒没投完 → 强制结算（没票就取候选第一条）。 */
  _echoForceResolveShield() {
    if (!Array.isArray(this.echoShieldOffer) || !this.echoShieldOffer.length) return OK;
    return this._echoSettleShield(this._echoTallyPick(this._echoShieldVotes));
  }

  /** 落定护盾盟约。 */
  _echoSettleShield(best) {
    const offer = this.echoShieldOffer;
    this.cancel(this._echoShieldTimer);
    this._echoShieldTimer = null;
    this.echoShieldOffer = null;
    this.echoShieldEndsAt = null;
    this._echoShieldVotes.clear();
    if (!Array.isArray(offer) || !offer.length) return OK;
    const i = Math.max(0, Math.min(offer.length - 1, Math.floor(Number(best) || 0)));
    // 只保护**附加盟约**：核心盟约本来就不会被排异，选了也没有意义（维护者 2026-11-05）
    const chosen = offer[i];
    const rec = this.gd.raw && this.gd.raw.bonds ? this.gd.raw.bonds[chosen] : null;
    if (!rec || rec.isCore === true) return OK;
    this.echoShieldBond = chosen;
    this._echoMaybeResumePrepClock();
    const name = this.gd.bond(offer[i])?.name || offer[i];
    this._echoPushAnnounce(`护盾：指定保护【${name}】——排异随机到它时将被抵消`);
    this._echoFlushAnnounce();
    this.markPublic();
    return OK;
  }

  /** 诅咒「封锁」：从当前可部署地块里随机封掉 n 个（抽不到就少封，不硬造格子）。 */
  _echoApplyDeployBan(count = 3, rng = () => 0.5) {
    const ps = this.alivePlayers()[0];
    let keys = [];
    try {
      const map = ps && typeof ps.deployMap === 'function' ? ps.deployMap() : null;
      if (map && typeof map.keys === 'function') keys = [...map.keys()];
      else if (Array.isArray(map)) keys = map.slice();
    } catch { keys = []; }
    if (!keys.length) { this.echoBannedTiles = []; return 0; }
    const have = Array.isArray(this.echoBannedTiles) ? this.echoBannedTiles.slice() : [];
    const pool = keys.filter((k) => !have.includes(k));
    const out = [];
    const n = Math.max(0, Math.floor(Number(count) || 0));
    while (out.length < n && pool.length) {
      const at = Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length));
      out.push(pool.splice(at, 1)[0]);
    }
    // 叠层：新封的追加在已有之上（维护者 2026-11-05「封锁也支持叠加」），最多留 8 个
    this.echoBannedTiles = [...have, ...out].slice(0, 8);
    // 封锁也是有时限的（维护者 2026-11-05）：记下到期层，到时整批解除
    if (out.length) this.echoBannedTilesUntil = this._echoDepth(this.round) + ECHO_DEPLOY_BAN_ROUNDS;
    return out.length;
  }

  /**
   * 深潜普通波次的**最后一道闸**：把首领分体 / 召唤物从出怪里剔掉（维护者 2026-11-05
   * 反复看到「碎铳之簧」这类分体单独刷出来）。
   *
   * 池子与精英注入都已经排除了，但模板变体 / 跨版本前缀（`act1:enemy_x`）等旁路仍可能漏，
   * 所以在波次生成后按 key（去前缀）再筛一遍。boss 返场回合不经过这里。
   */
  /**
   * 飞行条目不能走「没有航点」的路线（维护者 2026-11-05）。
   *
   * 数据里地面路线常常只有 start → end（cp=0，靠寻路走），飞行路线才带 8–10 个航点。
   * 一旦飞行怪被塞进这种路线（模板错配 / 旁路注入 / 召唤），它就会沿起点→终点**直线穿场**。
   * 这里每层出怪后兜一次：把飞行条目改到同一张图上真正带航点的路线（起点相同优先）。
   */
  _echoFixFlyRoutes(wave) {
    if (!wave || !Array.isArray(wave.spawns) || !Array.isArray(wave.routes) || !wave.routes.length) return wave;
    const routes = wave.routes;
    const cps = (r) => (r && Array.isArray(r.checkpoints) ? r.checkpoints.length : 0);
    const withPath = routes.map((r, i) => ({ r, i })).filter(({ r }) => cps(r) > 0);
    if (!withPath.length) return wave;
    const flyOf = (k) => {
      try { return isFlyKey(this.gd, String(k || '').replace(/^.*:/, '')); } catch { return false; }
    };
    let fixed = 0;
    for (const s of wave.spawns) {
      if (!s || !flyOf(s.enemyKey)) continue;
      const at = Number.isInteger(s.routeIndex) ? s.routeIndex : 0;
      if (cps(routes[at]) > 0) continue;
      const start = routes[at] && Array.isArray(routes[at].start) ? routes[at].start.join(',') : '';
      const hit = withPath.find(({ r }) => Array.isArray(r.start) && r.start.join(',') === start) || withPath[0];
      s.routeIndex = hit.i;
      fixed += 1;
    }
    if (fixed) this.log?.info?.('[match ' + this.roomCode + '] echo: ' + fixed + ' 个飞行条目改到带航点的路线');
    return wave;
  }

  _echoSanitizeSpawns(wave) {
    if (!wave || !Array.isArray(wave.spawns)) return wave;
    let only = null;
    try { only = echoSummonOnly(this.gd); } catch { only = null; }
    if (!only || !only.size) return wave;
    const keep = [];
    for (const s of wave.spawns) {
      const key = String(s && s.enemyKey || '');
      const base = key.replace(/^.*:/, '');
      if (only.has(key) || only.has(base)) continue;
      keep.push(s);
    }
    // 「频次怪」再硬限一次：整波只留 1 条、每条最多 2 只（防止模板/旁路成片带出来）
    try {
      const hit = echoHitCountEnemy(this.gd);
      if (hit && hit.size) {
        let seenHit = false;
        const lim = [];
        for (const s of keep) {
          const base = String(s && s.enemyKey || '').replace(/^.*:/, '');
          if (!hit.has(base)) { lim.push(s); continue; }
          if (seenHit) continue;
          seenHit = true;
          lim.push({ ...s, count: Math.min(Math.max(1, Number(s.count) || 1), 2) });
        }
        if (lim.length !== keep.length) { keep.length = 0; keep.push(...lim); }
        else for (let i = 0; i < keep.length; i++) keep[i] = lim[i];
      }
    } catch { /* 兜底失败不影响出怪 */ }
    const removed = wave.spawns.length - keep.length;
    if (removed > 0) {
      wave.spawns = keep;
      if (Array.isArray(wave.routes) && !keep.length) wave.spawns = [];
    }
    return wave;
  }

  /**
   * 「频次怪」（靠攻击次数结算）统一降血（维护者 2026-11-05）。
   *
   * 随机波次里它们已经被限制成「每波最多 1 种、每条最多 2 只」，但 boss 返场 / 隐藏核心的分体
   * 仍然是这些怪，血量按原版给。这里在**每一波**（普通 + boss）统一乘 0.6，首领本体不动。
   */
  _echoTuneHitCount(wave) {
    if (!wave || !Array.isArray(wave.spawns)) return wave;
    let hit = null;
    try { hit = echoHitCountEnemy(this.gd); } catch { hit = null; }
    if (!hit || !hit.size) return wave;
    for (const s of wave.spawns) {
      if (!s || s.leader === true || s.tag === 'boss' || s.role === 'boss') continue;
      const key = String(s.enemyKey || '');
      const base = key.replace(/^.*:/, '');
      if (!hit.has(key) && !hit.has(base)) continue;
      // 「频次怪」（被打 N 下才死）的血量必须是**绝对小值**，不是「按深度缩放后再打个折」：
      // 深层 hpMul 能到 38+，再乘 0.6 仍是几百上千（维护者 2026-11-05 实测青铜镜 1150）。

      // 器物类的 baseHp 恰好就是「需要几次伤害击倒」（青铜镜 30、黄铜镜 35），
      // 所以只要**不让它被正向缩放**即可：hpMul 封顶 1，负向修正（如果有）保留。
      const curMul = Number(s.mods && s.mods.hpMul) || 1;
      s.mods = { ...(s.mods || {}), hpMul: Math.min(curMul, 1) };
    }
    return wave;
  }

  /**
   * 封锁到期清理（维护者 2026-11-05）：`echoBannedTilesUntil <= depth` 时整批解除，
   * 并把 `block_tiles` 从诅咒列表里删掉（和排异同一套口径）。
   *
   * @returns {number} 解除的地块数
   */
  _echoExpireDeployBans(depth = this._echoDepth(this.round)) {
    const tiles = Array.isArray(this.echoBannedTiles) ? this.echoBannedTiles : [];
    if (!tiles.length) return 0;
    let until = Number(this.echoBannedTilesUntil) || 0;
    // 兜底：旧存档 / 旧进程写下的封锁没有到期层（until=0）—— 这里补成「本层 + 3」，
    // 否则它会永远挂着（维护者 2026-11-05 实测：3 回合后地块仍在封锁）。
    if (!(until > 0)) {
      until = depth + ECHO_DEPLOY_BAN_ROUNDS;
      this.echoBannedTilesUntil = until;
    }
    if (until > depth) return 0;
    this.echoBannedTiles = [];
    this.echoBannedTilesUntil = 0;
    if (Array.isArray(this.echoCurseIds)) {
      let left = 1;
      this.echoCurseIds = this.echoCurseIds.filter((id) => {
        if (left > 0 && id === 'block_tiles') { left -= 1; return false; }
        return true;
      });
    }
    this._echoPushAnnounce('封锁解除：被封锁的地块重新可以部署了');
    return tiles.length;
  }

  /**
   * 诅咒「排异」：从场上已有的盟约里随机禁掉一个。
   * 用 `pieceBonds`（bondsMeta）算，所以**同构体授予的盟约也算在内** —— 维护者要求「同构体改变的干员也受影响」。
   */
  _echoApplyBondBan(rng = () => 0.5) {
    // 2026-11-05 维护者：这是**团队模式**，可以提前禁 —— 候选不再要求「场上已经有人用」，
    // 直接取数据里所有附加盟约；优先禁场上/商店在用的（惩罚更直观），没有就随机禁一条。
    const seen = new Set();
    for (const ps of this.alivePlayers()) {
      for (const p of (ps.board ? ps.board.values() : [])) {
        if (!p || p.kind !== 'chess') continue;
        try { for (const b of (pieceBonds(this.gd, p, this.rules) || [])) seen.add(b); } catch { /* 数据缺失跳过 */ }
      }
    }
    for (const ps of this.alivePlayers()) {
      for (const s of (ps.shop && Array.isArray(ps.shop.slots) ? ps.shop.slots : [])) {
        if (!s || s.kind !== 'chess' || !s.id) continue;
        const rec = this.gd.chess(s.id);
        for (const b of (rec && rec.bonds) || []) seen.add(b);
      }
    }
    // 只排异**附加盟约**（data/bonds.json 里 isCore !== true 的那 15 条）：
    // 8 条核心盟约（炎/萨尔贡/维多利亚/谢拉格/拉特兰/阿戈尔/叙拉古/卡西米尔）是干员身份的一部分，
    // 禁掉它们等于禁掉整个阵营，维护者 2026-11-05 已明确不许。
    // 已禁用的不能再禁（必须先被「开路」解除），不同附加盟约可以叠加
    const already = Array.isArray(this.echoBannedBonds) ? this.echoBannedBonds : (this.echoBannedBonds = []);
    const rawBonds = (this.gd.raw && this.gd.raw.bonds) || {};
    const allAdd = Object.keys(rawBonds).filter((b) => {
      const rec = rawBonds[b];
      if (!rec || rec.isCore === true) return false;        // 核心盟约永不排异
      return !already.includes(b);                          // 已禁过 → 不重复（要先「开路」解除）
    });
    if (!allAdd.length) return null;
    const preferred = allAdd.filter((b) => seen.has(b));
    const pool = preferred.length ? preferred : allAdd;
    const picked = pool[Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length))];
    // 「护盾」祝福（维护者 2026-11-05）：排异随机到被护盾指定的盟约 → 护盾抵消，诅咒不生效、不进咒诅列表
    if (this.echoShieldBond && picked === this.echoShieldBond) {
      const name = this.gd.bond(picked)?.name || picked;
      this.echoShieldBond = null;
      // 护盾是「用掉就没」的一次性效果，但**不能从列表里消失**（维护者 2026-11-05：
      // 「等护盾的祝福被诅咒抵消后在祝福列表消失」—— 玩家会以为祝福丢了 / 列表出 bug）。
      // 现在留在 echoBlessings 里，用 echoShieldSpent 标成已消耗：列表与 HUD 上都显示成灰掉的「护盾」。
      this.echoShieldSpent = true;
      this._echoPushAnnounce(`护盾：抵消了针对【${name}】的排异（护盾已消耗）`);
      this._echoFlushAnnounce();
      this.markPublic?.();
      return null;
    }
    already.push(picked);
    // 已经上场的同盟约干员**当场收回修正区**（2026-11-05 维护者要求）：
    // 排异不是「不让你动」，而是「这个人不能再上战场」。
    const moved = this._echoWithdrawBannedBond(picked);
    if (moved) this._echoPushAnnounce(`排异：${moved} 名干员被收回`);
    return picked;
  }

  /** 把场上带 `bonds`（默认取全部已禁盟约）的干员收回手牌/暂存区。@returns {number} 收回人数 */
  _echoWithdrawBannedBond(bonds = null) {
    const list = Array.isArray(bonds) ? bonds : (Array.isArray(this.echoBannedBonds) ? this.echoBannedBonds : []);
    if (!list.length) return 0;
    let n = 0;
    for (const ps of this.alivePlayers()) {
      if (!ps || !ps.board) continue;
      for (const [key, p] of [...ps.board.entries()]) {
        if (!p || p.kind !== 'chess') continue;
        let bonds = [];
        try { bonds = pieceBonds(this.gd, p, this.rules) || []; } catch { bonds = []; }
        if (!bonds.some((x) => list.includes(x))) continue;
        if (this._echoWithdrawPiece(ps, key)) n += 1;
      }
    }
    return n;
  }

  /** 把一个干员从棋盘收回容器（手牌/暂存）。满了就放回原位并返回 0。 */
  _echoWithdrawPiece(ps, key) {
    const piece = ps.board.get(key);
    if (!piece || piece.kind !== 'chess') return 0;
    ps.board.delete(key);
    ps.removeTokensOf?.(piece.uid);
    const ok = typeof ps.stow === 'function' ? ps.stow(piece, { allowTemp: true }) : false;
    if (!ok) { ps.board.set(key, piece); return 0; }
    ps.recompute?.();
    ps.dirty?.();
    return 1;
  }

  /**
   * 落子前的否决（`player/placement.js` 调）。
   *
   * @param {any} piece 要落下的棋子
   * @param {string} key 目标地块 `r,c`
   * @param {boolean} fromHand true = 从手牌/暂存新上场（盟约排异只拦这一类，不拦已上场干员的移动）
   * @returns {string|null} 非空 = 禁止，值是原因
   */
  _echoDeployBlocked(piece, key, fromHand = false) {
    if (this.echoVariant !== 'deepecho') return null;
    if (Array.isArray(this.echoBannedTiles) && this.echoBannedTiles.includes(key)) {
      return '深渊封锁：这个地块无法部署';
    }
    const bannedBonds = (Array.isArray(this.echoBannedBonds) ? this.echoBannedBonds : [])
      .filter((b) => this.gd.bond(b)?.isCore !== true);   // 核心盟约即使混进来也不拦（防御性）
    if (bannedBonds.length && piece && piece.kind === 'chess') {
      let bonds = [];
      try { bonds = pieceBonds(this.gd, piece, this.rules) || []; } catch { bonds = []; }
      const hit = bonds.find((b) => bannedBonds.includes(b));
      if (hit) {
        const name = this.gd.bond(hit)?.name || hit;
        // 新上场说「无法部署」，已经在场的说「无法行动」（正常会被收回，这里兜底手牌满的情况）
        return fromHand ? `深渊排异：【${name}】干员无法部署` : `深渊排异：【${name}】干员无法行动`;
      }
    }
    return null;
  }

  /** 战斗时限倍率（「滞重」= 0.9）。 */
  _echoTimeMul() {
    return this._echoCurseFx().timeMul;
  }

  /** 同时持有的祝福上限（「静默」−1，最低 1）。 */
  _echoBlessingMax() {
    return Math.max(1, ECHO_BLESSING_MAX + this._echoCurseFx().blessingMax);
  }

  /**
   * 每回合开始把超出上限的「免费刷新」裁掉（只影响深潜，普通房间一行不碰）。
   * @returns {number} 被裁过的玩家数
   */
  _echoClampFreeRefreshes() {
    if (this.echoVariant !== 'deepecho') return 0;
    // 只在**深潜回合**夹（深潜现在从第 1 回合开始，所以实际上每回合都夹；普通房间一行不碰）
    if (!this._echoDiveRound(this.round)) return 0;
    const cap = this._echoFreeRefreshCap();
    let n = 0;
    for (const ps of this.alivePlayers()) {
      const shop = ps && ps.shop;
      if (!shop) continue;
      // 维护者 2026-11-05：**上回合没花完的免费刷新要占用本回合的额度**。
      // 否则「带 3 次进新回合 + 本回合再拿 5 次」= 一回合能用 8 次，玩家看到的就是「第 6 次还是免费」。
      // 回合开始时把「已有库存」记成本回合已获得，本回合只剩 (cap − 库存) 次可拿。
      if (shop.echoGrantRound !== this.round) {
        shop.echoGrantRound = this.round;
        shop.echoRefreshGranted = Math.min(cap, Math.max(0, Math.trunc(Number(shop.freeRefreshes) || 0)));
      }
      if (shop.freeRefreshes > cap) {
        shop.freeRefreshes = cap;
        ps.dirty?.();
        n += 1;
      }
    }
    if (n) this.markPublic();
    return n;
  }

  /**
   * 限伤上限的缩放倍数：保持「防一击必杀」的**相对强度**不变。
   *
   * 官方 300000 是按 R15 那一档（6.687 倍血量）定的；深潜里血量会继续涨，所以上限按同一比例放大。
   * 出发点取官方最后一档，当前回合取 `gd.enemyScale`（深潜回合已经走 echoScaleOf）。
   * 不这么做的后果：血量涨到几十倍后，300k 会变成隐形的降伤墙 —— 玩家叠满也打不动 boss。
   */
  _echoHitLimitMul() {
    if (this.echoVariant !== 'deepecho') return 1;
    const base = Number(this.gd?.baseEnemyScale?.(ECHO_LAST_ROUND)?.hpMul) || 1;
    const cur = Number(this.gd?.enemyScale?.(this.round)?.hpMul) || base;
    return Math.max(1, cur / Math.max(1e-6, base));
  }

  /**
   * 返场 boss 本回合的缩放（维护者 2026-11-05：**随深度递增**，不再是固定值）。
   *
   * 三处共用同一个数：共享血池、boss 波次领袖的 mods、boss 战场 flags.enemyScale。
   * @param {number} [r] 显示回合
   */
  _echoBossScale(r = this.round) {
    const base = this.gd?.baseEnemyScale?.(ECHO_LAST_ROUND) || { hpMul: 1, atkMul: 1, speedMul: 1 };
    if (this.echoVariant !== 'deepecho') return base;
    return echoBossScale(r, base, ECHO_LAST_ROUND);
  }

  /**
   * 返场 boss **共享血池**的深度倍率（相对 R15 官方档）：`_echoBossScale().hpMul / base.hpMul`。
   *
   * 为什么必须动血池而不是只改领袖单位：boss 的血量来自 `SharedBossPool`
   * （finalAssault.bossPoolHp，单人 675000 的固定值），领袖单位只是按池子比例显示。
   * 之前只调波次缩放，血池一点没变 —— 所以 25 层以后「一进场 boss 就没了」。
   */
  _echoBossPoolMul(r = this.round) {
    if (this.echoVariant !== 'deepecho') return 1;
    const base = Number(this.gd?.baseEnemyScale?.(ECHO_LAST_ROUND)?.hpMul) || 1;
    const cur = Number(this._echoBossScale(r)?.hpMul) || base;
    return Math.max(1, cur / Math.max(1e-6, base));
  }

  /**
   * 【诅咒】深渊对原版强力机制的限制（维护者 2026-11-05）。
   *
   * 为什么要显式告诉玩家：「奇迹」与「远见」在原版里按层无限叠，
   * 深渊里必须封顶，否则层数一高就是无限刷新 / 无限资金。
   * 不写出来的话玩家会以为是 bug（已经被问过一次）。
   */
  /**
   * 【固定规则】深渊的固定优势 / 规则（维护者 2026-11-05）。
   * 和祝福的区别：不进随机池、不占 3 个祝福名额，每局固定生效。
   */
  _echoFixedRules() {
    if (this.echoVariant !== 'deepecho') return [];
    return [
      // 维护者 2026-11-05：深潜同样按原版 999 层封顶（层数无限会让「每 N 层」的效果失控）
      { id: 'layer', name: '层数上限', desc: '解除到 1e9（原版 999）——深渊不限层；「按层给钱」只结算到 999 层' },
      // 维护者 2026-11-05：深潜强制独立卡池（Match 构造时覆盖房间配置，见 Match.js 的 echoIndependentPool）。
      // 玩家开局就该知道「卡池是各用各的」——否则会以为队友拿走了自己商店里的干员。
      { id: 'pool', name: '独立卡池', desc: '每名博士使用自己的卡池' },
      // 维护者 2026-11-05：救援默认开启，且**不要求进入联防**
      ...(this.revivalEnabled ? [{
        id: 'revive', name: '救援',
        desc: '目标生命耗尽时不会立刻淘汰：任一存活队友可支付 10 点目标生命，救回 1 点',
      }] : []),
      // 挑战关（深度 5 / 10）的清怪线**不写进固定规则**（维护者 2026-11-05）：
      // 它是奖励条件而不是一局固定的规则，只在结算时用 ticker 报结果，避免把「规则」页变成任务说明。
    ];
  }
  /**
   * 这条祝福**当前能清掉几条诅咒**（维护者 2026-11-05：三选一界面要标「推荐」）。
   *
   * 口径必须和真正结算时一致（`_echoSettleBlessing`）：
   *   * 净化（`curseRemove: 1`）：按稀有度从高到低清 n 条 → 有任意诅咒就推荐；
   *   * 涤罪（`curseRemove: 'common'`）：只清普通 → 只有普通诅咒时才算；
   *   * 反制（`counterCurses`）：按 id 匹配，永久诅咒和本回合诅咒都算。
   * 固定诅咒（奇迹 / 远见 / 深渊通胀）不在 `echoCurseIds` 里，天然不会被推荐。
   *
   * @returns {{ count: number, names: string[] } | null} null = 这条祝福不消诅咒
   */
  _echoClearableCurses(b) {
    if (!b) return null;
    const ids = Array.isArray(this.echoCurseIds) ? this.echoCurseIds.slice() : [];
    const round = this.echoRoundCurse ? [this.echoRoundCurse] : [];
    const nameOf = (id) => echoCurseById(id)?.name || id;
    const spec = echoBlessingCurseRemove(b);
    if (typeof spec === 'number' && spec > 0) {
      const rank = { epic: 3, rare: 2, common: 1 };
      const picked = ids
        .slice()
        .sort((x, y) => (rank[echoCurseById(y)?.rarity] || 1) - (rank[echoCurseById(x)?.rarity] || 1))
        .slice(0, spec);
      return picked.length ? { count: picked.length, names: picked.map(nameOf) } : null;
    }
    if (spec === 'common') {
      const picked = ids.filter((id) => (echoCurseById(id)?.rarity || 'common') === 'common');
      return picked.length ? { count: picked.length, names: picked.map(nameOf) } : null;
    }
    const counters = Array.isArray(b.counterCurses) ? b.counterCurses : null;
    if (counters) {
      const picked = [...ids, ...round].filter((id) => counters.includes(id));
      return picked.length ? { count: picked.length, names: picked.map(nameOf) } : null;
    }
    return null;
  }

  _echoCurses() {
    if (this.echoVariant !== 'deepecho') return [];
    // 词条类诅咒顶到上限之后不会空转：溢出层数转为敌方生命（见 _echoCurseFx），
    // 这里把换算结果写给玩家看，避免「多叠一层却没反应」的误解。
    const applied = echoCurseList(this.echoCurseIds).map(({ id, name, desc }) => {
      const c = echoCurseById(id);
      // 排异（bondBan）：把「禁了哪几个盟约 + 还剩几层」写进描述，玩家一眼能看到（维护者 2026-11-05）
      if (c && c.effect && c.effect.kind === 'bondBan' && Array.isArray(this.echoBannedBonds) && this.echoBannedBonds.length) {
        const names = this.echoBannedBonds.map((b) => this.gd.bond(b)?.name || b).join('、');
        const depth = this._echoDepth();
        const left = this.echoBannedBonds
          .map((b) => Number(this.echoBannedBondsUntil && this.echoBannedBondsUntil[b]) - depth)
          .filter((n) => n > 0);
        const tail = left.length ? `；剩余 ${Math.max(...left)} 层` : '';
        return {
          id, name, rarity: c.rarity || 'common', rarityLabel: ECHO_CURSE_RARITY_LABEL[c.rarity] || '普通',
          desc: `${desc}（已禁：${names}${tail}）`,
          // buff 栏角标：还会持续几层（维护者 2026-11-05）
          ...(left.length ? { roundsLeft: Math.max(...left) } : {}),
        };
      }
      // 封锁（deployBan）：把「还剩几层」写进描述（维护者 2026-11-05）
      if (c && c.effect && c.effect.kind === 'deployBan' && Array.isArray(this.echoBannedTiles) && this.echoBannedTiles.length) {
        const left = Number(this.echoBannedTilesUntil) - this._echoDepth();
        const tail = left > 0 ? `（剩余 ${left} 层）` : '';
        return {
          id, name, rarity: c.rarity || 'common', rarityLabel: ECHO_CURSE_RARITY_LABEL[c.rarity] || '普通',
          desc: `${desc}${tail}`,
          ...(left > 0 ? { roundsLeft: left } : {}),
        };
      }
      return { id, name, desc, rarity: c?.rarity || 'common', rarityLabel: ECHO_CURSE_RARITY_LABEL[c?.rarity] || '普通' };
    });
    const withRarity = (c) => ({ id: c.id, name: c.name, desc: c.desc, rarity: c.rarity || 'common', rarityLabel: ECHO_CURSE_RARITY_LABEL[c.rarity] || '普通' });
    return [
      // 固定的两条是深渊自身的限制，不属于随机诅咒池： rarity 标 special（客户端显示「固定」）
      { id: 'miracle', name: '奇迹·诅咒', desc: `免费刷新总数上限 ${this._echoFreeRefreshCap()} 次（原版无上限）`, rarity: 'special', rarityLabel: '固定' },
      { id: 'foresight', name: '远见·诅咒', desc: '按层给钱结算到 999 层（与原版一致）', rarity: 'special', rarityLabel: '固定' },
      // 16 层起的经济消耗（维护者 2026-11-05：从「不改界面」改成**明示的固定规则**）。
      // 倍率取自 _echoShopInflate()，与真实价格同源，不会出现「界面写 ×1.2、实际收 ×1.28」。
      {
        id: 'abyss_inflation', name: '深渊通胀',
        desc: this._echoShopInflate() > 1
          ? `16 层起商店购买价与刷新价每层 +4%，当前 ×${this._echoShopInflate().toFixed(2)}（封顶 ×1.5）`
          : '16 层起商店购买价与刷新价每层 +4%，封顶 ×1.5（16 层开始生效）',
        rarity: 'special', rarityLabel: '固定',
      },
      // 挑战关没达成等来源累积的诅咒（echoCurse.js 的词条表；同类合并成「侵蚀 ×2」）
      ...applied,
      // 本回合随机刷新的那条（只作用于本回合，下回合可能换掉或消失）
      ...(this.echoRoundCurse ? (() => {
        const c = echoCurseById(this.echoRoundCurse);
        return c ? [{ ...withRarity(c), name: `${c.name}（本回合）`, temporary: true, rounds: 1 }] : [];
      })() : []),
    ];
  }

  /** 公开视图里的深潜信息（普通房间不出现这些键）。 */
  /**
   * 本回合会出场的**跨版本敌人**记录（`<version>:enemy_…`），给客户端补数据表里缺的那些条。
   *
   * 为什么需要：深潜的波次会从各版本的模板库里抽怪（`echoCrossVersion`），抽到第一期独有的敌人时
   * key 会带 `act1autochess:` 前缀，而客户端加载的是本房版本的数据表 —— 查不到这条记录，
   * 于是准备阶段「敌方情报」里没有名字和图标，战斗中点开敌人也没有说明框（维护者 2026-11-05）。
   *
   * 只带**本回合真正会出场**的 key（普通波次 + boss 分组波次），并且去重：一回合最多几条。
   *
   * @returns {Record<string, object>} key → 敌人记录（data/enemies.json 的形状）
   */
  _echoCrossEnemyDefs() {
    const out = {};
    const take = (spawns) => {
      for (const s of Array.isArray(spawns) ? spawns : []) {
        const key = s && s.enemyKey;
        if (typeof key !== 'string' || !key.includes(':') || out[key]) continue;
        const rec = this.gd && typeof this.gd.enemy === 'function' ? this.gd.enemy(key) : null;
        if (rec) out[key] = rec;
      }
    };
    take(this.wave && this.wave.spawns);
    for (const g of Array.isArray(this.bossWaves) ? this.bossWaves : []) take(g && g.wave && g.wave.spawns);
    return out;
  }

  _echoPublic() {
    if (this.echoVariant !== 'deepecho') return null;
    const offer = this._echoOfferView();
    // 16 层起数值型祝福按 ×2.5 放大（维护者 2026-11-05：前期祝福后期没感觉）
    const lateMul = echoBlessingLateMul(this._echoDepth());
    return {
      deepecho: true,
      diveStart: this.echoDiveStart,
      depth: this._echoDepth(),
      // 词条带上说明，客户端圆片的 title 才能显示「硬化 · 防御 +200」这类效果
      words: this._echoWords().map((w) => ({ id: w.id, name: w.name, desc: w.desc })),
      // 跨版本敌人（key 形如 `act1autochess:enemy_…`）：客户端的数据表里**没有**这些记录，
      // 只发 key 的话准备阶段的情报列表没有名字/图标、战斗中点击也没有说明框
      //（维护者 2026-11-05 反馈：有的敌对目标查不到信息）。这里把本回合真正会出场的记录一起带上。
      crossEnemyDefs: this._echoCrossEnemyDefs(),
      // 深潜补给选的「本层词条」（维护者 2026-11-05：HUD 上完全看不到，玩家以为补给没生效）。
      // ★ 放**己方**侧（它加的是全队属性，不是敌人词条），带 temporary + rounds 让 buff 栏打「本」角标。
      tempBuffs: (Array.isArray(this.echoSupplyWords) ? this.echoSupplyWords : [])
        .filter((w) => w && w.round === this.round)
        .map((w) => ({
          id: `supply:${w.round}:${w.name || 'word'}`,
          name: w.name || '本层词条',
          desc: '深潜补给：本层全队生效，下一层消失',
          temporary: true,
          rounds: 1,
        })),
      // 本回合的随机诅咒单独给一份（维护者 2026-11-05：buff 栏要**明显标注**是它，玩家好及时查看效果）。
      // 它同时仍在 curses 里（带 temporary 角标），这里只是给客户端一个「本回合新出现的诅咒」入口。
      roundCurse: (() => {
        const c = this.echoRoundCurse ? echoCurseById(this.echoRoundCurse) : null;
        return c ? {
          id: c.id, name: c.name, desc: c.desc,
          rarity: c.rarity || 'common',
          rarityLabel: ECHO_CURSE_RARITY_LABEL[c.rarity] || '普通',
        } : null;
      })(),
      // 「盟约投影」：当前生效的那条 + 进行中的三选一（维护者 2026-11-05）
      projection: this._echoProjectionView(),
      // 16 层起祝福数值 ×2.5（echoBlessing.js ECHO_BLESSING_LATE_MUL）
      ...(() => ({ blessingLateMul: echoBlessingLateMul(this._echoDepth()) }))(),
      blessings: [
        // 「盟约投影」：也放进祝福列表（显示用，occupiesSlot: false 不占名额），
        // 这样放大镜、敌方情报的「已获祝福」都能看到它（维护者 2026-11-05：玩家反馈列表里看不到）
        ...(() => {
          const proj = this.echoProjection ? echoProjectionById(this.echoProjection) : null;
          return proj ? [{
            id: `projection:${proj.id}`, name: `盟约投影 · ${proj.name}`, desc: proj.desc,
            rarity: 'epic', rarityLabel: '投影', oneShot: false, consumed: false, occupiesSlot: false,
            projection: true, lateMul: undefined, rangeExtend: 0,
          }] : [];
        })(),
        ...this._echoBlessings().map((b) => ({
        id: b.id,
        name: b.name,
        rarity: b.rarity || 'common',
        rarityLabel: ECHO_BLESSING_RARITY_LABEL[b.rarity] || '普通',
        // 一次性祝福（资金 / 回血 / 涤罪 / 反制）：立刻结算、不挂在干员身上
        oneShot: echoBlessingOneShot(b) || b.kind === 'counter',
        // 可叠加的祝福（炎佑之契）带层数
        ...(Number(b.stacks) > 1 ? { stacks: Number(b.stacks) } : {}),
        // 已消耗（拿到就结算过）：列表里照常显示，只是不占名额
        consumed: b.consumed === true,
        // 是否占 3 个祝福名额：护盾、一次性、反制都不占（显示在列表里，但不计数）
        occupiesSlot: b.id !== 'shield_bond' && !echoBlessingOneShot(b) && !echoBlessingFree(b),
        // 深层强化（16 层起 ×2.5）：把倍率写进描述，玩家才知道后期拿到的数值更高（维护者 2026-11-05）
        lateMul: lateMul > 1 && b.kind === 'mods' ? lateMul : undefined,
        // 护盾：把「保护的是哪条盟约」写进描述；抵消过排异之后写「已被诅咒抵消」（维护者 2026-11-05）
        desc: b.id === 'shield_bond'
          ? `${b.desc}${b.consumed ? '（已被诅咒抵消）' : this.echoShieldBond ? `（已指定：${this.gd.bond(this.echoShieldBond)?.name || this.echoShieldBond}）` : '（尚未指定盟约）'}`
          : b.desc,
        // 「远程」这类改攻击范围的祝福：准备阶段没有战斗、客户端拿不到 live 范围，
        // 靠这个值把棋盘上的范围预览画对（2026-11-05）。
          rangeExtend: Number(b.mods && b.mods.rangeExtend) || 0,
        })),
      ],
      offer,
      // 祝福名额：隐藏核心通关会临时 +1（客户端显示 n/3 → n/4）
      blessingMax: this._echoBlessingMax() + Math.max(0, Number(this.echoBlessingBonus) || 0),
      // 本回合是不是 boss 关（14 层 / 15 层隐藏核心 / 25·35·45 返场）：
      // 客户端要在准备阶段显示「敌方领袖」块（维护者 2026-11-05：15 层 boss 看不到了）。
      bossRound: !!(this._echoBossReturn() || this._echoHiddenBossRound()),
      // 这一层真正打的 boss（返场层是随机那只，可能是隐秘核心；之前这里固定发 R14 的 bossId，
      // 面板上就永远是同一只 —— 维护者 2026-11-05）
      bossId: (this._echoBossReturn() || this._echoHiddenBossRound()) ? this._echoBossIdFor() : null,
      blessingRefresh: {
        left: this._echoBlessingRefreshLeft(),
        cap: this._echoBlessingRefreshCap(),
        vote: this.echoBlessingRefreshVote ? {
          id: this.echoBlessingRefreshVote.id,
          agreed: [...this.echoBlessingRefreshVote.agreed],
          // 明确投了「不同意」的人（维护者 2026-11-05：客户端要能把自己那一票画成「已投」，
          // 否则点完按钮没有任何反馈、两个按钮还能继续点）
          rejected: [...(this.echoBlessingRefreshVote.rejected || [])],
          voters: this.echoBlessingRefreshVote.voters.slice(),
          endsAt: this.echoBlessingRefreshVote.endsAt,
        } : null,
      },
      // 名额已满时的「弃选」投票（维护者 2026-11-05）：全队投掉哪个，再换入新的
      blessingReplace: this.echoBlessingReplace === true,
      // 「护盾」祝福：投票指定要保护的盟约 + 当前已指定的那条（2026-11-05）
      shield: {
        bond: this.echoShieldBond || null,
        bondName: this.echoShieldBond ? (this.gd.bond(this.echoShieldBond)?.name || this.echoShieldBond) : null,
        offer: Array.isArray(this.echoShieldOffer) && this.echoShieldOffer.length
          ? {
            options: this.echoShieldOffer.map((id) => ({ id, name: this.gd.bond(id)?.name || id })),
            votes: Object.fromEntries(this._echoShieldVotes instanceof Map ? this._echoShieldVotes : []),
            endsAt: this.echoShieldEndsAt ?? null,
          }
          : null,
      },
      // 手上握着的反制祝福（不占名额）：客户端据此显示「提前结束排异 / 封锁」按钮（2026-11-05）
      counters: (Array.isArray(this.echoCounterIds) ? this.echoCounterIds : []).map((id) => {
        const b = echoBlessingById(id);
        return { id, name: (b && b.name) || id, desc: (b && b.desc) || '', canLiftBans: !!b && b.counterBans === true };
      }),
      canLiftBans: (Array.isArray(this.echoCounterIds) ? this.echoCounterIds : []).some((id) => {
        const b = echoBlessingById(id);
        return !!b && b.counterBans === true;
      }) && ((Array.isArray(this.echoBannedTiles) && this.echoBannedTiles.length > 0)
        || (Array.isArray(this.echoBannedBonds) && this.echoBannedBonds.length > 0)),
      discard: Array.isArray(this.echoBlessingDiscardOffer) && this.echoBlessingDiscardOffer.length
        ? {
          pick: this.echoBlessingPendingPick || null,
          options: this.echoBlessingDiscardOffer.map((id) => {
            const b = echoBlessingById(id);
            return {
              id, name: (b && b.name) || id, desc: (b && b.desc) || '',
              rarity: (b && b.rarity) || 'common', rarityLabel: ECHO_BLESSING_RARITY_LABEL[b && b.rarity] || '普通',
              oneShot: echoBlessingOneShot(b),
          // 深层强化：16 层起数值型祝福 ×2.5，卡片上也要标出来
          lateMul: echoBlessingLateMul(this._echoDepth()) > 1 && b && b.kind === 'mods' ? echoBlessingLateMul(this._echoDepth()) : undefined,
            };
          }),
          votes: Object.fromEntries(this._echoDiscardVotes instanceof Map ? this._echoDiscardVotes : []),
          endsAt: this.echoBlessingDiscardEndsAt ?? null,
        }
        : null,
      // 备战阶段的聚合情报（威胁值 / 是否精英 / 空中数量）；非深潜回合为 null
      curses: this._echoCurses(),
      rules: this._echoFixedRules(),
      // 部署禁令（2026-11-05）：客户端据此把地块标成禁放 / 把盟约标成排异
      bans: {
        tiles: Array.isArray(this.echoBannedTiles) ? this.echoBannedTiles : [],
        bonds: Array.isArray(this.echoBannedBonds) ? this.echoBannedBonds.slice() : [],
        bondNames: (Array.isArray(this.echoBannedBonds) ? this.echoBannedBonds : []).map((b) => this.gd.bond(b)?.name || b),
        // 兼容只认单个盟约的旧客户端：给第一个
        bond: (Array.isArray(this.echoBannedBonds) && this.echoBannedBonds[0]) || null,
      },
      // 生命惩罚（2026-11-05）：客户端据此把「预计扣血」也乘上去，别让预览和服务端不一致
      lp: { mul: this._echoCurseFx().lpMul, extra: this._echoCurseFx().lpExtra },
      intel: this._echoIntel(),
      // 深潜补给（16 层起）：每名玩家自己的三选一
      supply: this._echoSupplyView(),
      // 深渊祭坛（16 层起）：每名玩家各自的已购次数与价格
      altar: (() => {
        if (this.echoVariant !== 'deepecho' || this._echoDepth(this.round) < 16) return null;
        if (!this._echoAltarOpen()) return null;
        const used = {};
        for (const p of this.alivePlayers()) used[p.playerId] = this._echoAltarUsed(p);
        return {
          costs: this.echoAltarCosts(),
          limits: { blessing: 1, buff: 2, permanent: 1 },
          used,
          stacks: Number(this.echoAltarBuffStacks) || 0,
          canPermanent: this._echoDepth(this.round) % 5 === 0,
        };
      })(),
      // 日程信息**始终**给（不泄露敌人构成）：迷雾/遮蔽或 boss 返场回合时，客户端至少还能显示
      // 「下次节点」这一项，而不是整块空白（维护者 2026-11-05）。
      schedule: (() => {
        if (!this._echoDiveRound()) return null;
        const cur = Math.floor(Number(this.round) || 0);
        const next = this._echoNextNodeRound(cur);
        return { nextNodeRound: next, nextNodeIn: next - cur };
      })(),
      // 无尽模式：没有「最大回合」可展示，只暴露安全阀（客户端不必显示它）
      safeRound: ECHO_SAFE_ROUND,
    };
  }

  /**
   * 【深渊祭坛】16 层以后的资金出口（维护者 2026-11-05：成型后钱没处花，只能干看着）。
   *
   * 三种献祭，**每层**限购，价格随深度上涨：
   *   * `blessing`：抽一个一次性祝福（回血 / 资金 / 涤罪），不占 3 个名额；
   *   * `buff`    ：本层全队 +6% 攻击 / +4% 攻速 / +5% 生命（可叠 2 层）；
   *   * `permanent`：永久升级（每 5 层 1 次）：+1 部署位。
   *
   * 只在深潜 16 层以后开放，其它房间一行都不碰。
   */
  /**
   * 祭坛本层是否开放（维护者 2026-11-05：不要每层都有，做成随机事件，约 45%，保底 3 层）。
   */
  _echoAltarOpen() {
    if (this.echoVariant !== 'deepecho') return false;
    const depth = this._echoDepth(this.round);
    if (depth < 16) return false;
    if (this.bossWaves) return false;
    if (this.echoAltarOpenRound === this.round) return this.echoAltarOpen === true;
    // 简化口径：每 3 层必开一次，其余层 35% 随机
    const forced = depth % 3 === 0;
    const roll = Number(this.rngWaves());
    const open = forced || (Number.isFinite(roll) ? roll : 1) < 0.35;
    this.echoAltarOpenRound = this.round;
    this.echoAltarOpen = open;
    if (open) this.echoAltarLastDepth = depth;
    return open;
  }

  echoAltarCosts() {
    const d = Math.max(16, this._echoDepth(this.round));
    return {
      blessing: 60 + 12 * (d - 16),
      buff: 45 + 10 * (d - 16),
      permanent: 180 + 30 * (d - 16),
    };
  }

  /** 本层已经买过的次数（按玩家）。 */
  _echoAltarUsed(ps) {
    if (!this.echoAltar) this.echoAltar = { round: 0, used: new Map() };
    if (this.echoAltar.round !== this.round) {
      this.echoAltar.round = this.round;
      this.echoAltar.used = new Map();
      this.echoAltarBuffStacks = 0;
    }
    return this.echoAltar.used.get(ps.playerId) || { blessing: 0, buff: 0, permanent: 0 };
  }

  /** `g.echoAltar`：买一次献祭。 */
  buyEchoAltar(ps, kind) {
    if (this.echoVariant !== 'deepecho') return fail(ERR.WRONG_PHASE);
    if (!ps || ps.spectator) return fail(ERR.SPECTATOR);
    if (this._echoDepth(this.round) < 16) return fail(ERR.WRONG_PHASE);
    if (!['blessing', 'buff', 'permanent'].includes(kind)) return fail(ERR.BAD_MSG);
    const cost = this.echoAltarCosts()[kind];
    const used = this._echoAltarUsed(ps);
    const limits = { blessing: 1, buff: 2, permanent: 1 };
    if (used[kind] >= limits[kind]) return fail(ERR.BAD_MSG);
    if (kind === 'permanent' && this._echoDepth(this.round) % 5 !== 0) return fail(ERR.WRONG_PHASE);
    if (Number(ps.funds) < cost) return fail(ERR.NO_FUNDS);
    ps.spend(cost);
    used[kind] += 1;
    this.echoAltar.used.set(ps.playerId, used);
    if (kind === 'blessing') {
      const once = (Array.isArray(ECHO_BLESSINGS) ? ECHO_BLESSINGS : []).filter((b) => echoBlessingOneShot(b) && b.kind !== 'counter');
      const pick = once.length ? once[Math.floor((Number(this.rngWaves()) || 0) * once.length)] : null;
      if (pick) this._echoGrantBlessing(pick);
    } else if (kind === 'buff') {
      this.echoAltarBuffStacks = Math.min(2, Math.max(0, Number(this.echoAltarBuffStacks) || 0) + 1);
    } else if (kind === 'permanent') {
      ps.deployCapBonus = Math.max(0, Number(ps.deployCapBonus) || 0) + 1;
      ps.invalidateDeployMap?.();
      ps.recompute?.();
    }
    ps.stats.fundsSpent = Number(ps.stats.fundsSpent) || 0;
    this.markPublic();
    return OK;
  }

  _echoAltarView(ps) {
    if (this.echoVariant !== 'deepecho' || this._echoDepth(this.round) < 16) return null;
    const used = this._echoAltarUsed(ps);
    const costs = this.echoAltarCosts();
    const limits = { blessing: 1, buff: 2, permanent: 1 };
    return {
      costs, limits, used,
      stacks: Number(this.echoAltarBuffStacks) || 0,
      permanent: Number(ps.echoAltarDeployBonus) || 0,
      canPermanent: this._echoDepth(this.round) % 5 === 0,
    };
  }

  /** 已拥有的祝福对象列表（HUD / 测试用）。 */
  /**
   * 【深潜补给】16 层起，每层准备阶段给每名玩家一次**个人三选一**（维护者 2026-11-05：
   * 深层没有 1–15 层那种道具 / 词条奖励界面，玩到后期就没东西可点）。
   *
   * 三个候选固定是三类：装备 / 资金 / 一次性祝福，各自独立随机。
   */
  /** 祝福面板结算之后，把「挂起中」的深潜补给放出来（一次只弹一个面板，维护者 2026-11-05）。 */
  _echoFlushSupplyIfPending() {
    if (!this.echoSupplyPending) return 0;
    if (this.echoBlessingOffer || this.echoBlessingDiscardOffer || this.echoBlessingRefreshVote) return 0;
    this.echoSupplyPending = false;
    try { return this._echoOpenSupply(true); } catch { return 0; }
  }

  _echoOpenSupply(force = false) {
    if (this.echoVariant !== 'deepecho') return 0;
    const depth = this._echoDepth(this.round);
    if (depth < 16) return 0;
    // 一次只弹一个决策面板（维护者 2026-11-05：补给和祝福三选一叠在一起了）。
    // 祝福 / 弃选 / 刷新投票还没结束时先挂起，等它结算完再开（见 _echoFlushSupplyIfPending）。
    if (!force && (this.echoBlessingOffer || this.echoBlessingDiscardOffer || this.echoBlessingRefreshVote)) {
      this.echoSupplyPending = true;
      return 0;
    }
    // 不是每层都给（维护者 2026-11-05）：做成**随机触发**的补给事件，
    // 平均每 3 层左右来一次；boss 返场层不触发。
    if (this.bossWaves) return 0;
    // 随机触发 + 保底间隔：连续 4 层没出就一定给一次（避免脸黑整局都没有）
    const last = Number(this.echoSupplyLastDepth) || 0;
    const forced = last > 0 && depth - last >= 4;
    if (!force && !forced && (Number(this.rngWaves()) || 0) >= 0.34) return 0;
    this.echoSupplyLastDepth = depth;
    if (this.echoSupply && this.echoSupply.round === this.round) return 0;
    // 维护者 2026-11-05：补给改成**团队投票、共享一份**（原来是每人各选一次，
    // 全员选词条/祝福叠加太超模）。候选是固定的三个方向，全队同一份。
    const once = (Array.isArray(ECHO_BLESSINGS) ? ECHO_BLESSINGS : []).filter((b) => echoBlessingOneShot(b) && b.kind !== 'counter');
    const bless = once.length ? once[Math.floor((Number(this.rngWaves()) || 0) * once.length)] : null;
    const options = [
      { kind: 'word', id: 'word_atk', name: '词条 · 强攻', desc: '本层全队攻击 +8%', mods: { atkPct: 0.08 } },
      { kind: 'word', id: 'word_bat', name: '词条 · 疾速', desc: '本层全队攻速 +6%', mods: { batPct: 0.06 } },
      bless
        // 补给是**全队共享一次**：祝福描述前面统一加「全队」，避免玩家以为是个人奖励
        ? { kind: 'blessing', id: bless.id, name: bless.name, desc: bless.desc ? `全队共享：${bless.desc}` : '全队共享一次' }
        : { kind: 'word', id: 'word_hp', name: '词条 · 坚韧', desc: '本层全队生命 +8%', mods: { hpPct: 0.08 } },
    ];
    this.echoSupply = { round: this.round, options, votes: new Map(), pick: null };
    this.echoSupplyEndsAt = (this.sched?.now?.() ?? 0) + ECHO_BLESSING_VOTE_MS;
    this._echoPausePrepClock();
    this.cancel(this._echoSupplyTimer);
    this._echoSupplyTimer = this.later(ECHO_BLESSING_VOTE_MS, () => {
      this._echoSupplyTimer = null;
      try { this._echoForceResolveSupply(); } catch { /* 结算失败不该炸掉整局 */ }
    });
    this.markPublic();
    return 1;
  }

  /** `g.echoSupply`：投一票（团队投票，票多者得，全队共享一份）。 */
  setEchoSupplyPick(ps, idx) {
    if (this.echoVariant !== 'deepecho') return fail(ERR.WRONG_PHASE);
    if (!ps || ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (ps.alive === false) return fail(ERR.SPECTATOR, 'dead players do not vote');
    const box = this.echoSupply && this.echoSupply.round === this.round ? this.echoSupply : null;
    if (!box || box.pick != null) return fail(ERR.WRONG_PHASE);
    const at = Math.floor(Number(idx));
    if (!(at >= 0 && at < box.options.length)) return fail(ERR.BAD_TARGET);
    if (!box.votes) box.votes = new Map();
    box.votes.set(ps.playerId, at);
    this.markPublic();
    return this._echoResolveSupply();
  }

  /** 票齐了就结算；没齐就等着（幂等，照搬祝福投票）。 */
  _echoResolveSupply() {
    const box = this.echoSupply && this.echoSupply.round === this.round ? this.echoSupply : null;
    if (!box || !Array.isArray(box.options) || !box.options.length) return OK;
    const voters = this.humans().filter((p) => p.connected && !p.spectator && p.alive !== false && !p.left).map((p) => p.playerId);
    if (!voters.length || !voters.every((id) => (box.votes || new Map()).has(id))) return OK;
    const tally = new Map();
    for (const id of voters) {
      const v = box.votes.get(id);
      tally.set(v, (tally.get(v) || 0) + 1);
    }
    let best = 0;
    let bestN = -1;
    for (const v of [...tally.keys()].sort((a, b) => a - b)) {
      const n = tally.get(v);
      if (n > bestN) { best = v; bestN = n; }
    }
    return this._echoSettleSupply(best);
  }

  /** 30 秒超时强制结算：没人投取候选第一项，投过的按票数最高（照搬祝福投票）。 */
  _echoForceResolveSupply() {
    const box = this.echoSupply && this.echoSupply.round === this.round ? this.echoSupply : null;
    if (!box || !Array.isArray(box.options) || !box.options.length) return OK;
    const tally = new Map();
    for (const v of (box.votes || new Map()).values()) tally.set(v, (tally.get(v) || 0) + 1);
    let best = 0;
    let bestN = -1;
    for (const v of [...tally.keys()].sort((a, b) => a - b)) {
      const n = tally.get(v);
      if (n > bestN) { best = v; bestN = n; }
    }
    return this._echoSettleSupply(best);
  }

  /** 发放中选的那一项（全队共享一次），清空状态。 */
  _echoSettleSupply(best) {
    const box = this.echoSupply && this.echoSupply.round === this.round ? this.echoSupply : null;
    this.cancel(this._echoSupplyTimer);
    this._echoSupplyTimer = null;
    if (!box || !Array.isArray(box.options)) { this.echoSupply = null; return OK; }
    const card = box.options[best];
    box.pick = best;
    if (card && card.kind === 'word' && card.mods) {
      // 临时词条：本层全队生效一次（结算后失效，不进祝福列表）
      this.echoSupplyWords = Array.isArray(this.echoSupplyWords) ? this.echoSupplyWords : [];
      this.echoSupplyWords.push({ round: this.round, mods: { ...card.mods }, name: card.name });
      this._echoPushAnnounce(`深潜补给：全队共享「${card.name}」`);
    } else if (card && card.kind === 'blessing') {
      const b = echoBlessingById(card.id);
      if (b) { this._echoGrantBlessing(b); this._echoPushAnnounce(`深潜补给：全队共享「${b.name}」`); }
    }
    this._echoFlushAnnounce?.();
    this._echoMaybeResumePrepClock();
    // 补给结算完，把延后的「盟约投影」面板补开（维护者 2026-11-05）
    this._echoFlushProjectionIfPending();
    this.markPublic();
    return OK;
  }

  /**
   * 「盟约投影」：16 层起每 10 层一次的全队三选一（维护者 2026-11-05）。
   *
   * 拿到之后**即使没有那条核心盟约**，场上所有己方干员也按满档享受它的效果；
   * 全程只能同时存在一个，不占 3 个祝福名额，也不进原版三选一池；再触发时选新的会替换旧的。
   *
   * @param {boolean} [force] 跳过「别的面板还开着」的延后判断
   * @returns {number} 1 = 开了面板，0 = 没开
   */
  _echoOpenProjection(force = false) {
    if (this.echoVariant !== 'deepecho') return 0;
    const depth = this._echoDepth(this.round);
    if (!isEchoProjectionLayer(depth)) return 0;
    // boss 返场层不弹（那时候面板已经够多了）
    if (this.bossWaves) return 0;
    // 一次只弹一个面板：祝福 / 弃选 / 刷新投票 / 补给还开着就延后
    if (!force && (this.echoBlessingOffer || this.echoBlessingDiscardOffer || this.echoBlessingRefreshVote || this.echoSupply)) {
      this.echoProjectionPending = true;
      return 0;
    }
    if (this.echoProjectionOffer && this.echoProjectionOffer.round === this.round) return 0;
    if (!Array.isArray(this.echoProjectionLayers)) this.echoProjectionLayers = [];
    if (this.echoProjectionLayers.includes(depth)) return 0;
    this.echoProjectionLayers.push(depth);
    const rng = createRng(deriveSeed(this.seed, `echo:projection:${this.round}`));
    const options = pickProjectionOffer(rng, this.echoProjection || null);
    if (!options.length) return 0;
    this.echoProjectionOffer = { round: this.round, options, votes: new Map(), pick: null };
    this.echoProjectionEndsAt = (this.sched?.now?.() ?? 0) + ECHO_BLESSING_VOTE_MS;
    this._echoPausePrepClock();
    this.cancel(this._echoProjectionTimer);
    this._echoProjectionTimer = this.later(ECHO_BLESSING_VOTE_MS, () => {
      this._echoProjectionTimer = null;
      try { this._echoForceResolveProjection(); } catch { /* 投票失败不该炸掉整局 */ }
    });
    this.markPublic();
    return 1;
  }

  /** 延后的投影事件：别的面板结算完之后补开。 */
  _echoFlushProjectionIfPending() {
    if (this.echoProjectionPending !== true) return;
    this.echoProjectionPending = false;
    try { this._echoOpenProjection(true); } catch { /* ignore */ }
  }

  /** `g.echoProjection { pick }`：投给第 i 个候选（全队票多者得）。 */
  setEchoProjectionPick(ps, idx) {
    if (this.echoVariant !== 'deepecho') return fail(ERR.WRONG_PHASE);
    if (!ps || ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (ps.alive === false) return fail(ERR.SPECTATOR, 'dead players do not vote');
    const box = this.echoProjectionOffer && this.echoProjectionOffer.round === this.round ? this.echoProjectionOffer : null;
    if (!box || box.pick != null) return fail(ERR.WRONG_PHASE);
    const at = Math.floor(Number(idx));
    // 允许投「放弃本次」（索引 = 候选数）：全队都不想换就保留当前投影（维护者 2026-11-05）
    if (!(at >= 0 && at <= box.options.length)) return fail(ERR.BAD_TARGET);
    if (!box.votes) box.votes = new Map();
    box.votes.set(ps.playerId, at);
    this.markPublic();
    return this._echoResolveProjection();
  }

  /** 票齐了就结算，否则等着（幂等，和补给/祝福投票同款）。 */
  _echoResolveProjection() {
    const box = this.echoProjectionOffer && this.echoProjectionOffer.round === this.round ? this.echoProjectionOffer : null;
    if (!box || !Array.isArray(box.options) || !box.options.length) return OK;
    const voters = this.humans().filter((p) => p.connected && !p.spectator && p.alive !== false && !p.left).map((p) => p.playerId);
    if (!voters.length || !voters.every((id) => (box.votes || new Map()).has(id))) return OK;
    const tally = new Map();
    for (const id of voters) {
      const v = box.votes.get(id);
      tally.set(v, (tally.get(v) || 0) + 1);
    }
    let best = 0;
    let bestN = -1;
    for (const v of [...tally.keys()].sort((a, b) => a - b)) {
      const n = tally.get(v);
      if (n > bestN) { best = v; bestN = n; }
    }
    return this._echoSettleProjection(best);
  }

  /** 倒计时到点：按当前票数直接结算（没人投票就取第 0 个）。 */
  _echoForceResolveProjection() {
    const box = this.echoProjectionOffer && this.echoProjectionOffer.round === this.round ? this.echoProjectionOffer : null;
    if (!box) return OK;
    const tally = new Map();
    for (const v of (box.votes || new Map()).values()) tally.set(v, (tally.get(v) || 0) + 1);
    let best = 0;
    let bestN = -1;
    for (const v of [...tally.keys()].sort((a, b) => a - b)) {
      const n = tally.get(v);
      if (n > bestN) { best = v; bestN = n; }
    }
    return this._echoSettleProjection(best);
  }

  /** 结算：记下（或替换）投影，然后收面板。 */
  _echoSettleProjection(best) {
    const box = this.echoProjectionOffer && this.echoProjectionOffer.round === this.round ? this.echoProjectionOffer : null;
    this.cancel(this._echoProjectionTimer);
    this._echoProjectionTimer = null;
    this.echoProjectionEndsAt = 0;
    if (!box || !Array.isArray(box.options) || !box.options.length) {
      this.echoProjectionOffer = null;
      this._echoMaybeResumePrepClock();
      this.markPublic();
      return OK;
    }
    // 放弃本次：不换投影（保留当前那条），也不占任何名额
    if (Math.floor(Number(best) || 0) === box.options.length) {
      this.echoProjectionOffer = null;
      this._echoPushAnnounce('全队放弃了本次盟约投影（保留当前投影）');
      this._echoFlushAnnounce?.();
      this._echoMaybeResumePrepClock();
      this._echoFlushSupplyIfPending?.();
      this.markPublic();
      return OK;
    }
    const idx = Math.max(0, Math.min(box.options.length - 1, Math.floor(Number(best) || 0)));
    const id = box.options[idx];
    const proj = echoProjectionById(id);
    box.pick = idx;
    this.echoProjectionOffer = null;
    if (proj) {
      const replaced = this.echoProjection && this.echoProjection !== id ? echoProjectionById(this.echoProjection) : null;
      this.echoProjection = id;
      this._echoPushAnnounce(replaced
        ? `盟约投影：「${proj.name}」替换了「${replaced.name}」（全体干员按满档生效）`
        : `盟约投影：「${proj.name}」—— 全体干员按满档享受该核心盟约`);
    }
    this._echoFlushAnnounce?.();
    this._echoMaybeResumePrepClock();
    this._echoFlushSupplyIfPending?.();
    this.markPublic();
    return OK;
  }

  /** 下发给客户端的投影视图（候选 + 票数 + 倒计时 + 当前生效的那条）。 */
  _echoProjectionView() {
    if (this.echoVariant !== 'deepecho') return null;
    const box = this.echoProjectionOffer && this.echoProjectionOffer.round === this.round ? this.echoProjectionOffer : null;
    return {
      current: this.echoProjection ? echoProjectionById(this.echoProjection) : null,
      offer: box ? {
        round: box.round,
        options: box.options.map((id) => echoProjectionById(id)).filter(Boolean),
        votes: Object.fromEntries(box.votes instanceof Map ? box.votes : []),
        pick: box.pick,
        endsAt: this.echoProjectionEndsAt ?? null,
      } : null,
    };
  }

  /**
   * 战斗输入要用的「投影注入」：把这个盟约按满档塞进 `bonds` 快照，
   * 并给玩家输入带上 `projectedBond`（sim 的 unitBonds 会让**所有己方干员**都算该盟约成员）。
   * @returns {{ bondId: string, state: object } | null}
   */
  echoProjectionBond() {
    if (this.echoVariant !== 'deepecho' || !this.echoProjection) return null;
    const proj = echoProjectionById(this.echoProjection);
    if (!proj) return null;
    return {
      bondId: proj.id,
      state: { count: Math.max(0, Math.floor(Number(proj.tier) || 6)), active: true, tier: 3, layers: 0 },
    };
  }

  /** 下发给客户端的补给视图（全队同一份，含票数与倒计时）。 */  _echoSupplyView() {
    if (this.echoVariant !== 'deepecho') return null;
    const box = this.echoSupply && this.echoSupply.round === this.round ? this.echoSupply : null;
    if (!box || !Array.isArray(box.options) || !box.options.length) return null;
    return {
      round: this.round,
      options: box.options,
      votes: Object.fromEntries(box.votes instanceof Map ? box.votes : []),
      pick: box.pick,
      endsAt: this.echoSupplyEndsAt ?? null,
    };
  }

  /**
   * 队伍当前**激活**的盟约 id 集合（只读查询 / 测试用）。
   *
   * 主题转化祝福**不再**用它做门槛（维护者 2026-11-05：「不用看队伍盟约激活，直接进入祝福卡池」），
   * 所以抽卡与战斗两边都不再调用它；留着是因为「这一队现在亮了哪些盟约」本身是有用的查询。
   *
   * `ps.bonds` 是 computeBonds 的产物（`{ [bondId]: { count, active, tier, layers } }`），
   * 备战区的干员也算人数，所以这里跟「盟约面板上亮着的」完全一致。
   */
  _echoTeamBonds() {
    const out = new Set();
    const list = this.players && typeof this.players.values === 'function' ? [...this.players.values()] : [];
    for (const ps of list) {
      if (!ps || ps.alive === false) continue;
      const bonds = ps.bonds;
      if (!bonds || typeof bonds !== 'object') continue;
      for (const id of Object.keys(bonds)) {
        if (bonds[id] && bonds[id].active === true) out.add(id);
      }
    }
    return out;
  }

  /** 已拥有的祝福对象列表（HUD / 测试用）。 */
  /**
   * 已获得的祝福（HUD / 列表用）。
   *
   * 占名额的祝福照常返回；**一次性祝福**（资金 / 回血 / 净化 / 涤罪 / 反制）虽然拿到就结算，
   * 也以 `consumed: true` 并进列表 —— 玩家要能看到「这一局吃过什么」，
   * 否则只出现在广播里，buff 栏和「已获得祝福」都查不到（维护者 2026-11-05）。
   * 它们不占名额：`_echoPublic` 会给 `occupiesSlot: false`，界面计数不会把 n/3 撑爆。
   */
  _echoBlessings() {
    const spent = this.echoShieldSpent === true;
    const counts = new Map();
    for (const id of (Array.isArray(this.echoBlessings) ? this.echoBlessings : [])) counts.set(id, (counts.get(id) || 0) + 1);
    const out = [...counts.entries()]
      .map(([id, n]) => {
        const b = echoBlessingById(id);
        if (!b) return null;
        // 护盾是**唯一**「用掉之后就消失」的祝福（维护者 2026-11-05 确认）：抵消一次排异之后就不再显示
        if (b.id === 'shield_bond' && spent) return null;
        // 可叠加的祝福（炎佑之契）合成一条，带 stacks（维护者 2026-11-05）
        return n > 1 ? { ...b, stacks: n } : b;
      })
      .filter(Boolean);
    // 维护者 2026-11-05（第二次改）：**一次性祝福 / 反制祝福拿到就结算，用掉之后不再显示在列表里**。
    // 之前把它们并进列表（标「已消耗」），结果列表越堆越长、还全是已经用掉的东西（玩家反馈）。
    // 记录仍然保留在 echoOneShotIds / echoCounterIds 里（名额计数、反制能力、抽取次数都还要用），
    // 只是不再往「已获祝福」里塞。
    return out;
  }

  /** 当前三选一的候选与票数（没有进行中的抽取时为 null）。 */
  _echoOfferView() {
    const offer = this.echoBlessingOffer;
    if (!Array.isArray(offer) || !offer.length) return null;
    const votes = {};
    for (const [pid, pick] of this._echoBlessingVotes || []) votes[pid] = pick;
    // echoBlessingOffer 存的是**id 数组**，名字与说明要按 id 查回来 —— 之前直接从字符串上读
    // `.name/.desc`，结果三个候选全是 undefined，界面上就是三个空按钮（2026-11-03 修）。
    return {
      options: offer.map((id) => {
        const b = typeof id === 'string' ? echoBlessingById(id) : id;
        // 「推荐」标记（维护者 2026-11-05）：这条祝福此刻**真的能清掉**诅咒才亮，
        // 并告诉玩家能清几条 / 清的是哪条（固定诅咒不算）。
        const clear = this._echoClearableCurses(b);
        return {
          id: (b && b.id) || String(id),
          name: (b && b.name) || String(id),
          desc: (b && b.desc) || '',
          // 稀有度（2026-11-05）：客户端可据此给卡片描边 / 加角标；没有字段的老客户端会忽略它
          rarity: (b && b.rarity) || 'common',
          rarityLabel: ECHO_BLESSING_RARITY_LABEL[(b && b.rarity) || 'common'] || '普通',
          oneShot: echoBlessingOneShot(b),
          // 深层强化：16 层起数值型祝福 ×2.5，卡片上也要标出来
          lateMul: echoBlessingLateMul(this._echoDepth()) > 1 && b && b.kind === 'mods' ? echoBlessingLateMul(this._echoDepth()) : undefined,
          recommend: !!clear,
          recommendText: clear ? (clear.count > 1 ? `可清除 ${clear.count} 条诅咒` : `可清除「${clear.names[0]}」`) : '',
        };
      }),
      votes,
      // 投票截止（服务端时间戳），客户端据此显示倒计时
      endsAt: this._echoBlessingEndsAt ?? null,
    };
  }

  /**
   * 该发祝福了就开一次三选一。
   *
   * 只在深潜回合跑，且「应得数 > 已拥有数」时才开；已经有一个没投完的候选时原样返回（不重抽，
   * 否则玩家每回合看到的三个选项都会变）。
   */
  /**
   * 决策面板（祝福三选一 / 深潜补给）打开时**暂停准备阶段倒计时**（维护者 2026-11-05）。
   * 原版里这类选择不吃准备时间，深潜也不该吃 —— 否则 30 秒投票直接把一整回合的准备时间耗光。
   */
  _echoPausePrepClock() {
    if (this.phase !== PHASE.PREP || !(this.deadline > 0)) return;
    if (this._echoPrepPausedMs != null) return;          // 已经暂停过（另一个面板还开着）
    const now = this.sched?.now?.() ?? 0;
    this._echoPrepPausedMs = Math.max(1000, this.deadline - now);
    this.setDeadline(0);
  }

  /** 面板全部关掉之后，把剩下的准备时间接回来。 */
  _echoResumePrepClock() {
    const left = Number(this._echoPrepPausedMs) || 0;
    if (!(left > 0)) return;
    if (this.phase !== PHASE.PREP || this.ended) { this._echoPrepPausedMs = null; return; }
    this._echoPrepPausedMs = null;
    this.setDeadline(left / 1000, () => this.prepDeadline());
  }

  /**
   * 现在还有没有**没结算完的决策面板**（维护者 2026-11-05：这些面板不吃准备时间）。
   * 六处：祝福三选一 / 弃选替换 / 刷新投票 / 深潜补给 / 盟约投影 / 护盾指定盟约。
   */
  _echoChoiceOpen() {
    if (this.echoBlessingOffer) return true;
    if (this.echoBlessingDiscardOffer) return true;
    if (this.echoBlessingRefreshVote) return true;
    if (this.echoSupply && this.echoSupply.pick == null) return true;
    if (this.echoProjectionOffer && this.echoProjectionOffer.pick == null) return true;
    if (Array.isArray(this.echoShieldOffer) && this.echoShieldOffer.length) return true;
    return false;
  }

  /**
   * 进入准备阶段时**扣住倒计时**（返回 true = 已经扣住，调用方不要再 setDeadline）。
   *
   * 为什么需要它：祝福三选一 / 补给 / 投影都是在 ROUND_START 阶段就开好的，那时 phase 还不是 PREP，
   * `_echoPausePrepClock()` 直接返回；等 `enterPrep()` 设 deadline 时面板还开着，倒计时就照跑
   * （玩家反馈：选祝福的时候右上角一直在倒数）。这里把整段准备时间先存起来，等面板全关再放出来。
   */
  _echoHoldPrepClock(secs) {
    if (!(secs > 0)) return false;
    if (!this._echoChoiceOpen()) return false;
    // enterPrep 是新一段准备时间：无条件覆盖（上一回合残留的暂停时长不能带过来）
    this._echoPrepPausedMs = Math.max(1000, Math.round(secs * 1000));
    this.setDeadline(0);
    return true;
  }

  /** 还有面板开着就别恢复倒计时。 */
  _echoMaybeResumePrepClock() {
    if (this._echoChoiceOpen()) return;
    this._echoResumePrepClock();
  }

  _echoMaybeOfferBlessing(r = this.round) {
    if (!this._echoDiveRound(r)) return null;
    // 上回合的深潜补给还没投完就先结算掉，避免和祝福三选一叠在一起（维护者 2026-11-05）
    if (this.echoSupply && this.echoSupply.pick == null && typeof this._echoForceResolveSupply === 'function') {
      try { this._echoForceResolveSupply(); } catch { /* 结算失败不影响祝福 */ }
    }
    // 隐藏核心通关会临时 +1 名额（`echoBlessingBonus`）：不发出去就会一直占着，
    // 所以这里把上限一起抬高，开完三选一立刻清零（玩家最多能看到 4/3）。
    const bonus = Math.max(0, Number(this.echoBlessingBonus) || 0);
    // 名额上限 + bonus，并把应得数也 +bonus —— 只抬上限还不够：`echoBlessingDue` 的
    // 「每 5 层一次」在 16 层刚好是 3，拿满 3 个时 due 仍然 ≤ owned，多出来的名额永远发不出去。
    const cap = this._echoBlessingMax() + bonus;
    const skipped = Math.max(0, Number(this.echoBlessingSkipped) || 0);
    const due = Math.max(0, Math.min(cap, echoBlessingDue(r, this.echoDiveStart, this.echoBlessingDraws, this._echoBlessingMax()) + bonus) - skipped);
    // 反制祝福不占 3 个上限，但**每次都消耗一次抽取机会**（拿在手里也不存底）
    const owned = (Array.isArray(this.echoBlessings) ? this.echoBlessings.filter((id) => id !== 'shield_bond').length : 0)
      + (Array.isArray(this.echoCounterIds) ? this.echoCounterIds.length : 0);
    // 名额已满但还有「没发出去的抽取」→ 走替换流程（维护者 2026-11-05：
    // 祝福满了也要能拿，选中之后由全队投票弃掉一个，投票同样 30 秒）。
    const rawDue = echoBlessingDue(r, this.echoDiveStart, this.echoBlessingDraws, 999);
    const replace = rawDue > owned && owned >= cap;
    if (!replace && due <= owned) { this.echoBlessingOffer = null; return null; }
    // 上一回合遗留的三选一：隐藏核心 / boss 结算会把回合推进，而这一版 offer 还没被投票结算。
    // 旧代码在这里直接 `return this.echoBlessingOffer`，于是**新回合又挂出同一个面板**，
    // 玩家看到「连续两个祝福界面」，点第二个时服务端其实已经结算过 → 「当前阶段无法进行该操作」
    // （维护者 2026-11-05 玩家反馈）。现在先把旧的那次按票数强制结算，再开新的。
    if (Array.isArray(this.echoBlessingOffer) && this.echoBlessingOffer.length) {
      if (Number(this._echoBlessingRound) === r) return this.echoBlessingOffer;
      try { this._echoForceResolveBlessing(); } catch { /* 结算失败不阻塞新回合 */ }
    }
    const rng = createRng(deriveSeed(this.seed, `echo:bless:${r}`));
    const offer = echoBlessingOffer(rng, this.echoBlessings);
    if (!offer.length) { this.echoBlessingOffer = null; return null; }
    this.echoBlessingOffer = offer.map((b) => b.id);
    this._echoBlessingRound = r;          // 这一版 offer 属于哪一回合（跨回合要先结算旧的）
    this.echoBlessingReplace = replace;
    if (bonus > 0) this.echoBlessingBonus = bonus - 1;
    this._echoBlessingVotes.clear();
    // 30 秒不投完就强制结算，否则一个人挂机会把全队卡死（维护者 2026-11-03 定）
    this.cancel(this._echoBlessingTimer);
    this._echoBlessingEndsAt = (this.sched?.now?.() ?? 0) + ECHO_BLESSING_VOTE_MS;
    this._echoPausePrepClock();
    this._echoBlessingTimer = this.later(ECHO_BLESSING_VOTE_MS, () => {
      this._echoBlessingTimer = null;
      try { this._echoForceResolveBlessing(); } catch { /* 结算失败不该炸掉整局 */ }
    });
    return this.echoBlessingOffer;
  }

  /**
   * 三选一的投票（g.echoBlessing { pick }）。连着的真人**全部投完**才结算，票多者得；平票取候选里靠前的。
   * 与 2 倍速投票同一个范式（speedVote.js）：离线的人既不计票也不阻塞。
   */
  setEchoBlessingVote(ps, pick) {
    if (this.echoVariant !== 'deepecho') return fail(ERR.WRONG_PHASE);
    const offer = this.echoBlessingOffer;
    if (!Array.isArray(offer) || !offer.length) return fail(ERR.WRONG_PHASE, 'no blessing offer');
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (ps.alive === false) return fail(ERR.SPECTATOR, 'dead players do not vote');
    const i = Math.floor(Number(pick));
    // 允许 i === offer.length：那是「放弃本次」那一张（维护者 2026-11-05）
    if (!(i >= 0 && i <= offer.length)) return fail(ERR.BAD_TARGET);
    this._echoBlessingVotes.set(ps.playerId, i);
    this.markPublic();
    return this._echoResolveBlessing();
  }

  // ---- 刷新祝福三选一（维护者 2026-11-05） ----------------------------------------------
  //
  // 口径：
  //   * 每局开局 **5 次**刷新额度（维护者 2026-11-05 从 3 提到 5）；「再议」补到上限，
  //     传说祝福「余韵」能把上限再往上抬（见 ECHO_BLESSING_REFRESH_BONUS_MAX）；
  //   * 刷新由**活着的在线玩家投票**决定（过半同意即刷新，1 人房直接通过）；
  //   * 投票**不占用**选择祝福的 30 秒：开投票时把选祝福的倒计时暂停，投票结束后
  //     —— 刷新成功 → 从 30 秒重新计时；刷新被否 → 接着用暂停时剩下的时间。

  /** 本局刷新次数上限 = 基础额度 + 「余韵」加的上限加成。 */
  _echoBlessingRefreshCap() {
    const bonus = Math.max(0, Math.min(ECHO_BLESSING_REFRESH_BONUS_MAX, Math.floor(Number(this.echoBlessingRefreshBonus) || 0)));
    return ECHO_BLESSING_REFRESH_MAX + bonus;
  }

  /** 当前还能刷新几次（0..本局上限）。 */
  _echoBlessingRefreshLeft() {
    const cap = this._echoBlessingRefreshCap();
    const n = Number(this.echoBlessingRefreshes);
    return Math.max(0, Math.min(cap, Number.isFinite(n) ? Math.floor(n) : cap));
  }

  /** 发一次刷新额度（「再议」/「余韵」用），封顶到本局上限。 */
  _echoGrantBlessingRefresh(n = 1) {
    const add = Math.max(0, Math.floor(Number(n) || 0));
    if (!add) return this._echoBlessingRefreshLeft();
    this.echoBlessingRefreshes = Math.min(this._echoBlessingRefreshCap(), this._echoBlessingRefreshLeft() + add);
    return this._echoBlessingRefreshLeft();
  }

  /**
   * 抬一次本局刷新上限（传说祝福「余韵」用）：最多叠 ECHO_BLESSING_REFRESH_BONUS_MAX 层。
   * 注意只抬**上限**；「立刻补 1 次」由 `_echoGrantBlessingRefresh` 单独发。
   */
  _echoGrantBlessingRefreshCap(n = 1) {
    const add = Math.max(0, Math.floor(Number(n) || 0));
    if (!add) return this._echoBlessingRefreshCap();
    const cur = Math.max(0, Math.floor(Number(this.echoBlessingRefreshBonus) || 0));
    this.echoBlessingRefreshBonus = Math.min(ECHO_BLESSING_REFRESH_BONUS_MAX, cur + add);
    return this._echoBlessingRefreshCap();
  }

  /** `g.echoBlessingRefresh { agree }`：开一次「要不要刷新当前三选一」的投票。 */
  requestEchoBlessingRefresh(ps) {
    if (this.echoVariant !== 'deepecho') return fail(ERR.WRONG_PHASE);
    const offer = this.echoBlessingOffer;
    if (!Array.isArray(offer) || !offer.length) return fail(ERR.WRONG_PHASE, 'no blessing offer');
    if (this.echoBlessingRefreshVote) return fail(ERR.WRONG_PHASE, 'refresh vote in progress');
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (ps.alive === false) return fail(ERR.SPECTATOR, 'dead players do not vote');
    if (this._echoBlessingRefreshLeft() <= 0) return fail(ERR.WRONG_PHASE, 'no blessing refresh left');
    const voters = this.humans().filter((p) => p.connected && !p.spectator && p.alive !== false && !p.left).map((p) => p.playerId);
    if (!voters.length) return fail(ERR.WRONG_PHASE, 'no voters');
    // 暂停选祝福的倒计时：投票时间不算进那 30 秒
    const now = this.sched?.now?.() ?? 0;
    const pausedMs = Math.max(0, Number(this._echoBlessingEndsAt) > 0 ? Number(this._echoBlessingEndsAt) - now : ECHO_BLESSING_VOTE_MS);
    this.cancel(this._echoBlessingTimer);
    this._echoBlessingTimer = null;
    this._echoBlessingEndsAt = 0;
    this.echoBlessingRefreshVote = {
      id: (Number(this._echoBlessingRefreshSeq) || 0) + 1,
      proposerId: ps.playerId,
      voters,
      agreed: new Set([ps.playerId]),
      rejected: new Set(),
      pausedMs,
      endsAt: now + ECHO_BLESSING_VOTE_MS,
    };
    this._echoBlessingRefreshSeq = this.echoBlessingRefreshVote.id;
    this.cancel(this._echoBlessingRefreshTimer);
    this._echoBlessingRefreshTimer = this.later(ECHO_BLESSING_VOTE_MS, () => {
      this._echoBlessingRefreshTimer = null;
      try { this._echoResolveBlessingRefresh(true); } catch { /* 投票失败不该炸掉整局 */ }
    });
    this.markPublic();
    return this._echoResolveBlessingRefresh();
  }

  /** 刷新投票：同意 / 不同意（超时按「不同意」结算，回到原来的倒计时）。 */
  setEchoBlessingRefreshVote(ps, agree) {
    const vote = this.echoBlessingRefreshVote;
    if (!vote) return fail(ERR.WRONG_PHASE, 'no refresh vote');
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (ps.alive === false) return fail(ERR.SPECTATOR, 'dead players do not vote');
    if (!vote.voters.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    if (!vote.rejected) vote.rejected = new Set();
    if (agree) { vote.agreed.add(ps.playerId); vote.rejected.delete(ps.playerId); }
    else { vote.agreed.delete(ps.playerId); vote.rejected.add(ps.playerId); }
    this.markPublic();
    return this._echoResolveBlessingRefresh(false, ps.playerId, agree === true);
  }

  /**
   * 刷新投票结算。
   * @param {boolean} timedOut 超时调用（按「不刷新」处理）
   * @param {string} [pid] 刚投票的人
   * @param {boolean} [agree] 他投的什么
   */
  _echoResolveBlessingRefresh(timedOut = false, pid = null, agree = false) {
    const vote = this.echoBlessingRefreshVote;
    if (!vote) return OK;
    // 有人明确拒绝且已经不可能过半 → 直接结束投票
    // 与「重刷本局」同一条门槛：ceil(0.75 × 人数)。2 人房 = 2（要一致同意），4 人房 = 3。
    const need = Math.ceil(vote.voters.length * 0.75);
    // 只有**明确投了不同意**的人算反对（没投票的人不算）
    const rejected = vote.rejected ? vote.rejected.size : 0;
    if (!timedOut && vote.agreed.size < need && rejected > vote.voters.length - need) {
      return this._echoCloseBlessingRefresh(false);
    }
    if (vote.agreed.size >= need) return this._echoCloseBlessingRefresh(true);
    return OK;
  }

  /** 结束刷新投票：refresh=true 就重抽三选一，否则恢复原来的倒计时。 */
  _echoCloseBlessingRefresh(refresh) {
    const vote = this.echoBlessingRefreshVote;
    if (!vote) return OK;
    this.cancel(this._echoBlessingRefreshTimer);
    this._echoBlessingRefreshTimer = null;
    this.echoBlessingRefreshVote = null;
    const now = this.sched?.now?.() ?? 0;
    if (!refresh) {
      // 不刷新：把暂停的选祝福时间接回来（至少留 1 秒，别一回来就强制结算）
      const left = Math.max(1000, Number(vote.pausedMs) || 0);
      this._echoBlessingEndsAt = now + left;
      this.cancel(this._echoBlessingTimer);
      this._echoBlessingTimer = this.later(left, () => {
        this._echoBlessingTimer = null;
        try { this._echoForceResolveBlessing(); } catch { /* 结算失败不该炸掉整局 */ }
      });
      this._echoPushAnnounce('祝福刷新投票未通过：继续从原来的候选里选');
      this._echoFlushAnnounce();
      this.markPublic();
      return OK;
    }
    // 刷新：扣 1 次额度、重抽三个候选、**从 30 秒重新计时**
    this.echoBlessingRefreshes = Math.max(0, this._echoBlessingRefreshLeft() - 1);
    const r = this.round;
    const nonce = (Number(this.echoBlessingRefreshNonce) || 0) + 1;
    this.echoBlessingRefreshNonce = nonce;
    const rng = createRng(deriveSeed(this.seed, `echo:bless:${r}:refresh:${nonce}`));
    const offer = echoBlessingOffer(rng, this.echoBlessings);
    if (!offer.length) { this.markPublic(); return OK; }
    this.echoBlessingOffer = offer.map((b) => b.id);
    this._echoBlessingRound = r;
    this._echoBlessingVotes.clear();
    this.cancel(this._echoBlessingTimer);
    this._echoBlessingEndsAt = now + ECHO_BLESSING_VOTE_MS;
    this._echoBlessingTimer = this.later(ECHO_BLESSING_VOTE_MS, () => {
      this._echoBlessingTimer = null;
      try { this._echoForceResolveBlessing(); } catch { /* 结算失败不该炸掉整局 */ }
    });
    this._echoPushAnnounce(`祝福已刷新：重新三选一（剩余 ${this._echoBlessingRefreshLeft()} 次）`);
    this._echoFlushAnnounce();
    this.markPublic();
    return OK;
  }

  /** 票齐了就结算并发放；没齐就等着（幂等）。 */
  _echoResolveBlessing() {
    const offer = this.echoBlessingOffer;
    if (!Array.isArray(offer) || !offer.length) return OK;
    // 只有**活着**的玩家参与投票（维护者 2026-11-05：死亡的玩家不再参与祝福选择）
    const voters = this.humans().filter((p) => p.connected && !p.spectator && p.alive !== false && !p.left).map((p) => p.playerId);
    if (!voters.length || !voters.every((id) => this._echoBlessingVotes.has(id))) return OK;
    const tally = new Map();
    for (const id of voters) {
      const v = this._echoBlessingVotes.get(id);
      tally.set(v, (tally.get(v) || 0) + 1);
    }
    let best = 0;
    let bestN = -1;
    for (const v of [...tally.keys()].sort((a, b) => a - b)) {
      const n = tally.get(v);
      if (n > bestN) { best = v; bestN = n; }
    }
    return this._echoSettleBlessing(best);
  }

  /**
   * 30 秒强制结算（维护者 2026-11-03 定）：没人投就取候选第一项，投过的按「票数最高、平票取靠前」。
   * 没有这个，一个挂机的人就能把全队卡在投票界面。
   */
  _echoForceResolveBlessing() {
    const offer = this.echoBlessingOffer;
    if (!Array.isArray(offer) || !offer.length) return OK;
    const tally = new Map();
    for (const v of this._echoBlessingVotes.values()) tally.set(v, (tally.get(v) || 0) + 1);
    let best = 0;
    let bestN = -1;
    for (const v of [...tally.keys()].sort((a, b) => a - b)) {
      const n = tally.get(v);
      if (n > bestN) { best = v; bestN = n; }
    }
    return this._echoSettleBlessing(best);
  }

  /** 发放选中的那一项并清空状态（正常结算与超时强制结算共用）。 */
  _echoSettleBlessing(best) {
    const offer = this.echoBlessingOffer;
    const replace = this.echoBlessingReplace === true;
    this.cancel(this._echoBlessingTimer);
    this._echoBlessingTimer = null;
    this.echoBlessingOffer = null;
    this._echoBlessingRound = null;
    this._echoBlessingVotes.clear();
    this.echoBlessingReplace = false;
    this._echoMaybeResumePrepClock();
    // 「放弃本次」（维护者 2026-11-05）：全队都不想要时投它 —— 本轮不发祝福，
    // 并记一次 skipped，避免下一层又弹出同一批候选（due 会把它扣掉）。
    if (Array.isArray(offer) && best === offer.length) {
      this.echoBlessingSkipped = (Number(this.echoBlessingSkipped) || 0) + 1;
      this._echoPushAnnounce('全队放弃了本次祝福（本轮不发）');
      this._echoFlushAnnounce();
      this._echoFlushProjectionIfPending();
      this.markPublic();
      return OK;
    }
    const b = Array.isArray(offer) ? echoBlessingById(offer[best]) : null;
    if (!b) return OK;
    // 名额已满 + 这次是替换模式：先让全队投票「弃掉哪个」，投完再发新的（维护者 2026-11-05）。
    // 反制祝福不占名额，不需要弃选。
    // 一次性祝福（回血 / 资金 / 涤罪）**无视名额上限**：直接发，不进入弃选流程（维护者 2026-11-05）
    if (replace && !echoBlessingFree(b) && !echoBlessingOneShot(b) && this.echoBlessings.filter((id) => id !== 'shield_bond').length >= this._echoBlessingMax()) {
      this.echoBlessingPendingPick = b.id;
      // 弃选替换也是一次决策：别吃准备时间（维护者 2026-11-05）
      this._echoPausePrepClock();
      this.echoBlessingDiscardOffer = this.echoBlessings.slice();
      this._echoDiscardVotes.clear();
      this.echoBlessingDiscardEndsAt = (this.sched?.now?.() ?? 0) + ECHO_BLESSING_VOTE_MS;
      this.cancel(this._echoDiscardTimer);
      this._echoDiscardTimer = this.later(ECHO_BLESSING_VOTE_MS, () => {
        this._echoDiscardTimer = null;
        try { this._echoForceResolveDiscard(); } catch { /* 结算失败不该炸掉整局 */ }
      });
      this.markPublic();
      return OK;
    }
    this._echoGrantBlessing(b);
    this._echoFlushSupplyIfPending();
    // 祝福面板结算完，把延后的「盟约投影」补开（维护者 2026-11-05：投影一直不弹）
    this._echoFlushProjectionIfPending();
    return OK;
  }

  /**
   * 弃选投票：`g.echoBlessingDiscard { pick }` —— pick 是 `echoBlessingDiscardOffer` 的下标。
   * 与三选一同一套范式：票多者弃、平票取靠前、30 秒超时强制结算、离线的人不计票也不阻塞。
   */
  setEchoBlessingDiscardVote(ps, pick) {
    if (this.echoVariant !== 'deepecho') return fail(ERR.WRONG_PHASE);
    const offer = this.echoBlessingDiscardOffer;
    if (!Array.isArray(offer) || !offer.length) return fail(ERR.WRONG_PHASE, 'no discard offer');
    if (ps.spectator) return fail(ERR.SPECTATOR);
    if (ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (ps.alive === false) return fail(ERR.SPECTATOR, 'dead players do not vote');
    const i = Math.floor(Number(pick));
    // 允许 i === offer.length：那是「放弃本次」那一张（维护者 2026-11-05）
    if (!(i >= 0 && i <= offer.length)) return fail(ERR.BAD_TARGET);
    if (!this._echoDiscardVotes) this._echoDiscardVotes = new Map();
    this._echoDiscardVotes.set(ps.playerId, i);
    this.markPublic();
    return this._echoResolveDiscard();
  }

  /** 弃选票齐了就结算。 */
  _echoResolveDiscard() {
    const offer = this.echoBlessingDiscardOffer;
    if (!Array.isArray(offer) || !offer.length) return OK;
    // 只有**活着**的玩家参与投票（维护者 2026-11-05：死亡的玩家不再参与祝福选择）
    const voters = this.humans().filter((p) => p.connected && !p.spectator && p.alive !== false && !p.left).map((p) => p.playerId);
    if (!voters.length || !voters.every((id) => this._echoDiscardVotes.has(id))) return OK;
    return this._echoSettleDiscard(this._echoTallyPick(this._echoDiscardVotes));
  }

  /** 30 秒超时强制结算弃选。 */
  _echoForceResolveDiscard() {
    const offer = this.echoBlessingDiscardOffer;
    if (!Array.isArray(offer) || !offer.length) return OK;
    return this._echoSettleDiscard(this._echoTallyPick(this._echoDiscardVotes));
  }

  /** 票数最高的一项（平票取下标小的），没有票就 0。 */
  _echoTallyPick(votes) {
    const tally = new Map();
    for (const v of (votes || new Map()).values()) tally.set(v, (tally.get(v) || 0) + 1);
    let best = 0;
    let bestN = -1;
    for (const v of [...tally.keys()].sort((a, b) => a - b)) {
      const n = tally.get(v);
      if (n > bestN) { best = v; bestN = n; }
    }
    return best;
  }

  /** 执行弃选并发放先前选定的祝福。 */
  _echoSettleDiscard(best) {
    const offer = Array.isArray(this.echoBlessingDiscardOffer) ? this.echoBlessingDiscardOffer : [];
    const pick = this.echoBlessingPendingPick;
    this.cancel(this._echoDiscardTimer);
    this._echoDiscardTimer = null;
    this.echoBlessingDiscardOffer = null;
    this.echoBlessingDiscardEndsAt = null;
    this._echoDiscardVotes.clear();
    this.echoBlessingPendingPick = null;
    if (!offer.length || !pick) return OK;
    const dropIdx = Math.max(0, Math.min(offer.length - 1, Math.floor(Number(best) || 0)));
    const dropId = offer[dropIdx];
    const at = this.echoBlessings.indexOf(dropId);
    if (at >= 0) {
      this.echoBlessings.splice(at, 1);
      const dropped = echoBlessingById(dropId);
      if (dropped) this._echoPushAnnounce(`全队投票舍弃「${dropped.name}」，换入新的祝福`);
    }
    const b = echoBlessingById(pick);
    if (b) this._echoGrantBlessing(b);
    // 这次额外抽取已经用掉了：不扣掉的话每回合都会再开一次替换（owned 不变、rawDue 不变）
    this.echoBlessingDraws = Math.max(0, (Number(this.echoBlessingDraws) || 0) - 1);
    this._echoFlushAnnounce?.();
    this._echoMaybeResumePrepClock();
    this.markPublic();
    return OK;
  }
  /** 真正发放：记进 `echoBlessings`（同类不叠加）并立刻结算一次性效果。 */
  _echoGrantBlessing(b) {
    if (!b) return null;
    if (!Array.isArray(this.echoBlessings)) this.echoBlessings = [];
    // 反制祝福（2026-11-05）：不占 3 个名额，但**每次抽到都记一次消耗** ——
    // 即使当前没有对应的诅咒，这次抽取也照常花掉，不会存着等以后。
    // ★ 只看 kind（echoBlessingFree）；`repeatable` 只表示「可以再抽到」（如「开路」是反制、
    //   「余韵」是消耗品），不能拿来判断它是不是反制 —— 否则「余韵」会被记进反制名单。
    const free = echoBlessingFree(b);
    if (!Array.isArray(this.echoCounterIds)) this.echoCounterIds = [];
    if (free) {
      this.echoCounterIds.push(b.id);
    } else if (echoBlessingOneShot(b)) {
      // 一次性祝福（回血 / 资金 / 涤罪…）**不占 3 个名额**（维护者 2026-11-05）：
      // 它拿到就立刻结算，留在列表里只是为了给玩家看「这一局吃过什么」，不参与上限判断。
      // 同一个 id 可以重复拿（因为是即时效果，不是持有物）。
      if (!Array.isArray(this.echoOneShotIds)) this.echoOneShotIds = [];
      this.echoOneShotIds.push(b.id);
    } else {
      // 同类不叠加；**可叠加**的祝福（炎佑之契）按 maxStacks 封顶（维护者 2026-11-05）
      const copies = this.echoBlessings.filter((x) => x === b.id).length;
      const maxCopies = b.stackable === true ? Math.max(1, Math.floor(Number(b.maxStacks) || 2)) : 1;
      if (copies >= maxCopies) return null;
      // 上限（静默会压低）；隐藏核心通关的临时名额要算进去，否则第 4 个祝福会被这里拒掉
      const cap = this._echoBlessingMax() + Math.max(0, Number(this.echoBlessingBonus) || 0);
      // 只数**占名额**的祝福：一次性祝福不算
      const held = this.echoBlessings.filter((id) => {
        // 护盾是一次性效果（用掉就没了），不占名额（维护者 2026-11-05）
        if (id === 'shield_bond') return false;
        const x = echoBlessingById(id);
        return x ? !echoBlessingOneShot(x) : true;
      }).length;
      if (held >= cap) return null;
      this.echoBlessings.push(b.id);
    }
    this._echoBlessingEndsAt = null;
    if (b.kind === 'shield') this._echoOpenShieldVote();
    // A 类：**立刻进钱包**（维护者 2026-11-04：原来走 pendingFunds，要等下一回合 prep 才入账，
    // 玩家选了 40 资金当场看不到，以为没生效）。
    const funds = echoBlessingFunds(b);
    if (funds > 0) {
      for (const ps of this.alivePlayers()) {
        ps.addFunds(funds, { reason: 'echoBlessing' });
        ps.stats.fundsGained += funds;
        ps.dirty?.();
      }
    }
    // H 类（2026-11-05）：全队一次性回复生命。封顶到**各自的初始生命**（gd.startLp），
    // 所以不会把深渊的漏怪抹平，也不会让「生命」超过开局值。
    // 消耗式祝福（机变 / 时之沙漏）：立刻给免费刷新，封顶到当前上限（维护者 2026-11-05 审计发现漏接）
    const refresh = b.kind === 'fund' && Number(b.freeRefresh) > 0 ? Math.trunc(Number(b.freeRefresh)) : 0;
    if (refresh > 0) {
      for (const ps of this.alivePlayers()) {
        const shop = ps && ps.shop;
        if (!shop) continue;
        this._echoGrantFreeRefresh(ps, refresh);
      }
    }
    // 刷新祝福三选一：先抬上限（「余韵」），再补次数（「再议」/「余韵」）——
    // 顺序反了的话补出来的那 1 次会被旧上限夹掉。
    if (Number(b.blessingRefreshCap) > 0) this._echoGrantBlessingRefreshCap(Number(b.blessingRefreshCap));
    if (Number(b.blessingRefresh) > 0) this._echoGrantBlessingRefresh(Number(b.blessingRefresh));
    const heal = echoBlessingHeal(b);
    if (heal > 0) {
      // 维护者 2026-11-05：回血祝福**允许超过玩家的初始生命上限**（深渊里血量就是资源，
      // 上限只用来显示，不该把祝福的收益截断）。
      for (const ps of this.alivePlayers()) {
        const before = Math.max(0, Math.floor(Number(ps.lp) || 0));
        const after = before + heal;
        if (after > before) { ps.lp = after; ps.dirty?.(); }
      }
    }
    // C 类（2026-11-05）：消除诅咒。**只动 `echoCurseIds`**（挑战关失败累积的那些）；
    // 奇迹·诅咒 / 远见·诅咒写死在 `_echoCurses()` 里，不经过这个列表，所以清不掉 —— 故意的。
    const removeSpec = echoBlessingCurseRemove(b);
    if (removeSpec != null && Array.isArray(this.echoCurseIds) && this.echoCurseIds.length) {
      // 'common' = 只清普通诅咒（涤罪，稀有/传说保留）；数字 = 清最早的 n 层；'all' = 全清
      const before = this.echoCurseIds.length;
      if (typeof removeSpec === 'number') {
        // 数字 = 清 n 层，**优先清稀有度最高**的（维护者 2026-11-05：玩家拿了「净化」
        // 却发现「静默」没被清掉 —— 原来是按列表顺序清的，先清到了普通诅咒）。
        const rank = { epic: 3, rare: 2, common: 1 };
        const order = this.echoCurseIds
          .map((id, i) => ({ id, i, r: rank[echoCurseById(id)?.rarity] || 1 }))
          .sort((a, b) => b.r - a.r || a.i - b.i)
          .slice(0, Math.max(0, Math.trunc(removeSpec)));
        const drop = new Set(order.map((x) => x.i));
        const names = order.map((x) => echoCurseById(x.id)?.name || x.id);
        this.echoCurseIds = this.echoCurseIds.filter((_, i) => !drop.has(i));
        // 被清掉的如果是「封锁 / 排异」，对应的实际效果也要一起撤（维护者 2026-11-05）
        this._echoSyncBanCurse(order.map((x) => x.id));
        if (names.length) {
          this._echoPushAnnounce(`净化：移除了「${names.join('、')}」`);
          this._echoFlushAnnounce();
        }
      } else {
        this.echoCurseIds = removeEchoCurses(this.echoCurseIds, removeSpec).kept;
        const removed = before - this.echoCurseIds.length;
        if (removed > 0) {
          this._echoPushAnnounce(`净化：移除 ${removed} 层诅咒`);
          this._echoFlushAnnounce();
        }
      }
    }
    // 灾厄祝福（2026-11-05）：拿到就**立刻附加**一条诅咒（强力但有代价）
    if (b && typeof b.curseOnTake === 'string' && b.curseOnTake) {
      const seedKey = `echo:blessCurse:${b.id}:${this.round}`;
      const added = this._echoAddCurse(b.curseOnTake, createRng(deriveSeed(this.seed, seedKey)));
      if (added) {
        this._echoPushAnnounce(`「${b.name}」的代价：深渊降下诅咒「${added.name}」`);
        this._echoFlushAnnounce();
      }
    }
    // 克制祝福（2026-11-05）：直接驱散对应的诅咒 / 解除部署禁令
    if (b && b.kind === 'counter') {
      const ids = Array.isArray(b.counterCurses) ? b.counterCurses : [];
      let removed = 0;
      if (ids.length && Array.isArray(this.echoCurseIds) && this.echoCurseIds.length) {
        // 诅咒可以叠层（同一个 id 出现多次）：一次反制只消掉**一层**，
        // 所以要靠重复拿反制来逐层解（维护者 2026-11-05「可以多次出现生效」）。
        // 每次清掉多少层：普通反制 1 层，强效反制（彻愈 / 肃清 / 富源）2–3 层
        const stacks = Math.max(1, Math.floor(Number(b.counterStacks) || 1));
        for (const id of ids) {
          for (let k = 0; k < stacks; k++) {
            const at = this.echoCurseIds.indexOf(id);
            if (at < 0) break;
            this.echoCurseIds.splice(at, 1);
            removed += 1;
          }
        }
      }
      if (this.echoRoundCurse && ids.includes(this.echoRoundCurse)) this.echoRoundCurse = null;
      if (b.counterBans) {
        const had = (Array.isArray(this.echoBannedTiles) ? this.echoBannedTiles.length : 0)
          + (Array.isArray(this.echoBannedBonds) ? this.echoBannedBonds.length : 0);
        this.echoBannedTiles = [];
        this.echoBannedBonds = [];
        // 禁令解了，诅咒条目也要一起消失，否则 HUD 上还挂着「封锁 / 排异」两个图标
        if (Array.isArray(this.echoCurseIds)) {
          this.echoCurseIds = this.echoCurseIds.filter((id) => id !== 'block_tiles' && id !== 'block_bond');
        }
        if (had) this._echoPushAnnounce(`祝福「${b.name}」：解除封锁 / 排异`);
      }
      if (removed > 0) this._echoPushAnnounce(`祝福「${b.name}」：驱散 ${removed} 层诅咒`);
      // 反制掉「封锁 / 排异」时，把地块禁令 / 盟约禁令也一起解除（维护者 2026-11-05）
      this._echoSyncBanCurse(ids);
      this._echoFlushAnnounce();
    }
    this.tickerText(msg('深渊回响：全队获得祝福「{name}」', { name: b.name }), FLOW_TICKER_PRIORITY);
    this.log.info?.(`[match ${this.roomCode}] echo blessing ${b.id} (R${this.round})`);
    this.markPublic();
    return b.id;
  }

  /**
   * 深潜的悬赏（echoBounty.js）：每 5 个深潜回合一次，目标**从本回合已生成的波次里现抽**。
   *
   * 复用原版的 `addBounty(ps, card)` 通道，所以卡面展示、`tag: 'bounty'` 标记、击杀结算全部沿用现有逻辑；
   * 赏金按「威胁值 / 15000 × 深度系数」定价（见 echoBounty.js），不会出现小怪给大钱。
   */

  _echoMaybeGrantBounty(r = this.round) {
    if (!this._echoDiveRound(r)) return 0;
    // 维护者 2026-11-04：1–15 层沿用原版的「悬赏决策 / 道具补给 / 机密商店 / 战术决策」，
    // 深潜自己的随机悬赏从 16 层起才接管。
    if (this._echoDepth(r) < 16) return 0;
    if (!echoBountyDue(r, this.echoDiveStart)) return 0;
    const spawns = Array.isArray(this.wave && this.wave.spawns) ? this.wave.spawns : [];
    if (!spawns.length) return 0;
    const rng = createRng(deriveSeed(this.seed, `echo:bounty:${r}`));
    const rolled = echoBountyCards(spawns, { gd: this.gd, depth: this._echoDepth(r), rng, maxCards: 1 });
    // 「贪婪」诅咒：每张卡少 1 币（最低 1）。不改 echoBounty 的纯函数，只在发卡前改币数。
    const coinAdj = this._echoCurseFx().bountyCoin;
    const cards = coinAdj
      ? rolled.map((c) => ({ ...c, coin: Math.max(1, Math.round((Number(c.coin) || 1) + coinAdj)) }))
      : rolled;
    if (!cards.length) return 0;
    let n = 0;
    for (const ps of this.alivePlayers()) {
      for (const c of cards) if (this.addBounty(ps, c)) n += 1;
    }
    if (n) this.log.info?.(`[match ${this.roomCode}] echo bounty ${cards.map((c) => c.enemyKey).join(',')} (R${r})`);
    return n;
  }

  /** C 类祝福的资金倍率（结算入账时乘上去；没有祝福就是 1）。诅咒的 `coinMul` 也在同一处生效。 */
  _echoCoinMul() {
    if (this.echoVariant !== 'deepecho') return 1;
    return echoBlessingCoinMul(this.echoBlessings) * echoCurseEffects(this.echoCurseIds).coinMul;
  }

  /**
   * 备战阶段的聚合情报（深潜专属，维护者 2026-11-03 定）：**只给威胁值 / 是否精英 / 空中数量**，
   * 不给怪种、不给出现位置 —— 明细由 `views.js: nextEnemiesFor` 在深潜回合整段掐掉。
   *
   * 威胁值用的是与预算同一个度量（敌人最大生命 × 数量），所以「预告的威胁值」和「本回合预算」可比。
   */
  _echoIntel() {
    if (!this._echoDiveRound()) return null;
    // 「迷雾」只关威胁值；「遮蔽」更狠，连精英 / 日程一起掐掉（两者都返回 null，客户端就没有情报块）
    const fx = this._echoCurseFx();
    if (fx.intel || fx.blackout) return null;
    // boss 返场回合（R20 / R25 / R30…）是明牌：走原版预览（bossWaves），不给聚合情报
    if (this.bossWaves) return null;
    const spawns = Array.isArray(this.wave && this.wave.spawns) ? this.wave.spawns : [];
    let threat = 0;
    let elite = false;
    for (const s of spawns) {
      if (!s || typeof s.enemyKey !== 'string' || s.tag === 'part') continue;
      const n = Math.max(1, Math.trunc(Number(s.count) || 1));
      const hp = Number(this.gd.enemy(s.enemyKey)?.stats?.maxHp) || 0;
      threat += Math.max(1, hp) * n;
      if (s.preview && s.preview.elite) elite = true;
    }
    // 只发这两项（维护者 2026-11-03 明确）：威胁值 / 是否精英。
    // **不返回敌人总数、也不返回空中数量** —— public 会发给所有客户端，发了就等于告诉改过客户端的玩家。
    // 另外附一个纯日程信息：距离下一个 boss 返场节点还有几回合（不泄露任何敌人构成）。
    // 用途是干员/爆发节奏，**不是攒钱** —— 原版规则不允许留资金。
    // 注意：本方法没有参数（views.js 直接 `_echoIntel()` 调），所以用 this.round，不能引用 r。
    const cur = Math.floor(Number(this.round) || 0);
    const nextNodeRound = this._echoNextNodeRound(cur);
    return { threat: Math.round(threat), elite, nextNodeRound, nextNodeIn: nextNodeRound - cur };
  }

  /** 下一个固定节点回合；已在节点上时返回下一个。锚点段 5 层、15 层之后 10 层（见 echo.js）。 */
  _echoNextNodeRound(r = this.round) {
    const cur = Math.floor(Number(r) || 0);
    const start = Math.max(1, Math.floor(Number(this.echoDiveStart) || 1));
    const depth = cur - start + 1;
    let n = ECHO_NODE_FIRST;
    while (n <= depth) n += n >= ECHO_NODE_ANCHOR_LAST ? ECHO_NODE_LATE_EVERY : ECHO_NODE_EVERY;
    return start + n - 1;   // 深度 → 显示回合
  }
}
