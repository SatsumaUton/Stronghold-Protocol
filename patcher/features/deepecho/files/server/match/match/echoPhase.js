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

import { echoDataRound, isDiveRound, isEchoNodeRound, ECHO_SAFE_ROUND, ECHO_LAST_ROUND, ECHO_MAX_FREE_REFRESH, ECHO_BOND_BAN_ROUNDS, ECHO_CHALLENGE_BLESSING_PCT, ECHO_NODE_FIRST, ECHO_NODE_EVERY, ECHO_NODE_ANCHOR_LAST, ECHO_NODE_LATE_EVERY } from './echo.js';
import { echoWordsForRound, echoWordById, applyEchoWords } from './echoWords.js';
import { echoCurseList, echoCurseEffects, echoCurseById, ECHO_CURSE_MAX_STACK, echoCurseUnitMods, curseUnitMatches, pickEchoCurse, pickRoundCurse, removeEchoCurses, mergeCurseEffects, ECHO_FIXED_CURSE_ROUNDS, ECHO_CURSE_RARITY_LABEL } from './echoCurse.js';
import {
  echoBlessingDue, echoBlessingOffer, echoBlessingById, echoBlessingMods, echoBlessingCoinMul,
  echoBlessingFunds, echoBlessingHeal, echoBlessingFree, echoBlessingCurseRemove, echoBlessingOneShot, applyEchoBlessingMods, ECHO_BLESSING_MAX, ECHO_BLESSING_VOTE_MS, ECHO_BLESSING_RARITY_LABEL,
} from './echoBlessing.js';
import { echoBountyDue, echoBountyCards } from './echoBounty.js';
import { echoSummonOnly } from './echoWaves.js';
import { createRng, deriveSeed } from '../../sim/rng.js';import { ERR } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { hiddenEligible } from '../finalAssault.js';
import { pieceBonds } from '../bondsMeta.js';
import { roundPick } from '../waves.js';
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
      ps.shop.freeRefreshes = Math.min(this._echoFreeRefreshCap(), (Number(ps.shop.freeRefreshes) || 0) + 1);
      ps.dirty?.();
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
      const pool = Object.keys((this.gd.raw && this.gd.raw.enemies) || {})
        .map((k) => ({ k, e: this.gd.enemy(k) }))
        .filter(({ k, e }) => e && !summonOnly.has(k) && e.rank === 'ELITE' && Number(e.stats && e.stats.maxHp) <= cap && Number(e.stats && e.stats.moveSpeed) > 0);
      if (!pool.length) return wave;
      let n = 0;
      for (const s of wave.spawns) {
        if (n >= inject) break;
        if (!s || typeof s.enemyKey !== 'string') continue;
        const pick = pool[Math.floor((Number(this.rngWaves && this.rngWaves()) || 0) * pool.length)] || pool[0];
        if (!pick) break;
        s.enemyKey = pick.k;
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
    }    const mods = echoBlessingMods(this.echoBlessings);
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
   * 不再固定用 R14 的那个 boss，而是从全部 boss 里**随机换一个其他的**（排除本局已经打过的）。
   * 用种子 + 回合做随机源，同一局可复现。
   */
  _echoBossPick(r = this.round) {
    const all = Object.keys((this.gd && this.gd.raw && this.gd.raw.bosses) || {});
    const pool = all.filter((id) => id !== this.bossId && id !== this.hiddenBossId);
    if (!pool.length) return this.bossId;
    const rng = createRng(deriveSeed(this.seed, `echo:boss:${r}`));
    return pool[Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length))];
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
    const picked = pickEchoCurse(this._echoDepth(this.round), rng);
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
      const picked = pickEchoCurse(this._echoDepth(this.round), rng);
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

  /** 商店加价倍率（诅咒「通胀 / 暴利」）：`player/economy.js` 的 priceOf 消费它。 */
  _echoShopPriceMul() {
    return this.echoVariant === 'deepecho' ? this._echoCurseFx().shopPriceMul : 1;
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

  /** 免费刷新上限：奇迹·诅咒的 3 次，再被「枯竭」这类减（最低 0）。 */
  _echoFreeRefreshCap() {
    return Math.max(0, MatchEcho.MAX_FREE_REFRESH + this._echoCurseFx().freeRefresh);
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
  }

  /**
   * 每回合开始刷新诅咒（维护者 2026-11-05）。
   *
   * 两件事：
   *   1. **固定回合**（`ECHO_FIXED_CURSE_ROUNDS`）：到这一层就永久加一条（已在列表里就不重复）；
   *   2. **回合诅咒**（`ECHO_ROUND_CURSES`）：按深度随机，只影响本回合，下回合重刷。
   *      其中的 `destroyEquip` 当场结算（每人随机销毁 1 件已装备的装备）。
   */
  _echoRefreshCurses(r = this.round) {
    if (!this._echoDiveRound(r)) { this.echoRoundCurse = null; return null; }
    const depth = this._echoDepth(r);
    // 排异到期：到层就解除（先清名单，下面的扫场会把场上干员放回来）
    this._echoExpireBondBans(depth);
    const fixed = ECHO_FIXED_CURSE_ROUNDS[depth];
    if (fixed && !(Array.isArray(this.echoCurseIds) && this.echoCurseIds.includes(fixed))) {
      // 统一入口：记 id + 施加副作用（封锁 / 排异）
      const fc = this._echoAddCurse(fixed, createRng(deriveSeed(this.seed, `echo:fixed:${r}`)));
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
    const pick = pickRoundCurse(depth, rng);
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
    const i = Math.floor(Number(pick));
    if (!(i >= 0 && i < offer.length)) return fail(ERR.BAD_TARGET);
    this._echoShieldVotes.set(ps.playerId, i);
    this.markPublic();
    const voters = this.humans().filter((p) => p.connected && !p.spectator).map((p) => p.playerId);
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
    return out.length;
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
      this._echoPushAnnounce(`护盾：抵消了针对【${name}】的排异`);
      this._echoFlushAnnounce();
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
      if (!shop || !(shop.freeRefreshes > cap)) continue;
      shop.freeRefreshes = cap;
      ps.dirty?.();
      n += 1;
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
      { id: 'layer', name: '层数上限', desc: '999 层封顶' },
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
        };
      }
      return { id, name, desc, rarity: c?.rarity || 'common', rarityLabel: ECHO_CURSE_RARITY_LABEL[c?.rarity] || '普通' };
    });
    const withRarity = (c) => ({ id: c.id, name: c.name, desc: c.desc, rarity: c.rarity || 'common', rarityLabel: ECHO_CURSE_RARITY_LABEL[c.rarity] || '普通' });
    return [
      // 固定的两条是深渊自身的限制，不属于随机诅咒池： rarity 标 special（客户端显示「固定」）
      { id: 'miracle', name: '奇迹·诅咒', desc: `免费刷新总数上限 ${this._echoFreeRefreshCap()} 次（原版无上限）`, rarity: 'special', rarityLabel: '固定' },
      { id: 'foresight', name: '远见·诅咒', desc: '按层给钱结算到 999 层（与原版一致）', rarity: 'special', rarityLabel: '固定' },
      // 挑战关没达成等来源累积的诅咒（echoCurse.js 的词条表；同类合并成「侵蚀 ×2」）
      ...applied,
      // 本回合随机刷新的那条（只作用于本回合，下回合可能换掉或消失）
      ...(this.echoRoundCurse ? (() => {
        const c = echoCurseById(this.echoRoundCurse);
        return c ? [{ ...withRarity(c), name: `${c.name}（本回合）` }] : [];
      })() : []),
    ];
  }

  /** 公开视图里的深潜信息（普通房间不出现这些键）。 */
  _echoPublic() {
    if (this.echoVariant !== 'deepecho') return null;
    const offer = this._echoOfferView();
    return {
      deepecho: true,
      diveStart: this.echoDiveStart,
      depth: this._echoDepth(),
      // 词条带上说明，客户端圆片的 title 才能显示「硬化 · 防御 +200」这类效果
      words: this._echoWords().map((w) => ({ id: w.id, name: w.name, desc: w.desc })),
      blessings: this._echoBlessings().map((b) => ({
        id: b.id,
        name: b.name,
        desc: b.desc,
        rarity: b.rarity || 'common',
        rarityLabel: ECHO_BLESSING_RARITY_LABEL[b.rarity] || '普通',
        // 一次性祝福（资金 / 回血 / 涤罪 / 反制）：立刻结算、不挂在干员身上
        oneShot: echoBlessingOneShot(b),
        // 「远程」这类改攻击范围的祝福：准备阶段没有战斗、客户端拿不到 live 范围，
        // 靠这个值把棋盘上的范围预览画对（2026-11-05）。
        rangeExtend: Number(b.mods && b.mods.rangeExtend) || 0,
      })),
      offer,
      // 祝福名额：隐藏核心通关会临时 +1（客户端显示 n/3 → n/4）
      blessingMax: this._echoBlessingMax() + Math.max(0, Number(this.echoBlessingBonus) || 0),
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
      // 无尽模式：没有「最大回合」可展示，只暴露安全阀（客户端不必显示它）
      safeRound: ECHO_SAFE_ROUND,
    };
  }

  /** 已拥有的祝福对象列表（HUD / 测试用）。 */
  _echoBlessings() {
    return Array.isArray(this.echoBlessings) ? this.echoBlessings.map((id) => echoBlessingById(id)).filter(Boolean) : [];
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
        return {
          id: (b && b.id) || String(id),
          name: (b && b.name) || String(id),
          desc: (b && b.desc) || '',
          // 稀有度（2026-11-05）：客户端可据此给卡片描边 / 加角标；没有字段的老客户端会忽略它
          rarity: (b && b.rarity) || 'common',
          rarityLabel: ECHO_BLESSING_RARITY_LABEL[(b && b.rarity) || 'common'] || '普通',
          oneShot: echoBlessingOneShot(b),
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
  _echoMaybeOfferBlessing(r = this.round) {
    if (!this._echoDiveRound(r)) return null;
    // 隐藏核心通关会临时 +1 名额（`echoBlessingBonus`）：不发出去就会一直占着，
    // 所以这里把上限一起抬高，开完三选一立刻清零（玩家最多能看到 4/3）。
    const bonus = Math.max(0, Number(this.echoBlessingBonus) || 0);
    // 名额上限 + bonus，并把应得数也 +bonus —— 只抬上限还不够：`echoBlessingDue` 的
    // 「每 5 层一次」在 16 层刚好是 3，拿满 3 个时 due 仍然 ≤ owned，多出来的名额永远发不出去。
    const cap = this._echoBlessingMax() + bonus;
    const due = Math.min(cap, echoBlessingDue(r, this.echoDiveStart, this.echoBlessingDraws, this._echoBlessingMax()) + bonus);
    // 反制祝福不占 3 个上限，但**每次都消耗一次抽取机会**（拿在手里也不存底）
    const owned = (Array.isArray(this.echoBlessings) ? this.echoBlessings.length : 0)
      + (Array.isArray(this.echoCounterIds) ? this.echoCounterIds.length : 0);
    // 名额已满但还有「没发出去的抽取」→ 走替换流程（维护者 2026-11-05：
    // 祝福满了也要能拿，选中之后由全队投票弃掉一个，投票同样 30 秒）。
    const rawDue = echoBlessingDue(r, this.echoDiveStart, this.echoBlessingDraws, 999);
    const replace = rawDue > owned && owned >= cap;
    if (!replace && due <= owned) { this.echoBlessingOffer = null; return null; }
    if (Array.isArray(this.echoBlessingOffer) && this.echoBlessingOffer.length) return this.echoBlessingOffer;
    const rng = createRng(deriveSeed(this.seed, `echo:bless:${r}`));
    const offer = echoBlessingOffer(rng, this.echoBlessings);
    if (!offer.length) { this.echoBlessingOffer = null; return null; }
    this.echoBlessingOffer = offer.map((b) => b.id);
    this.echoBlessingReplace = replace;
    if (bonus > 0) this.echoBlessingBonus = bonus - 1;
    this._echoBlessingVotes.clear();
    // 30 秒不投完就强制结算，否则一个人挂机会把全队卡死（维护者 2026-11-03 定）
    this.cancel(this._echoBlessingTimer);
    this._echoBlessingEndsAt = (this.sched?.now?.() ?? 0) + ECHO_BLESSING_VOTE_MS;
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
    const i = Math.floor(Number(pick));
    if (!(i >= 0 && i < offer.length)) return fail(ERR.BAD_TARGET);
    this._echoBlessingVotes.set(ps.playerId, i);
    this.markPublic();
    return this._echoResolveBlessing();
  }

  /** 票齐了就结算并发放；没齐就等着（幂等）。 */
  _echoResolveBlessing() {
    const offer = this.echoBlessingOffer;
    if (!Array.isArray(offer) || !offer.length) return OK;
    const voters = this.humans().filter((p) => p.connected && !p.spectator).map((p) => p.playerId);
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
    this._echoBlessingVotes.clear();
    this.echoBlessingReplace = false;
    const b = Array.isArray(offer) ? echoBlessingById(offer[best]) : null;
    if (!b) return OK;
    // 名额已满 + 这次是替换模式：先让全队投票「弃掉哪个」，投完再发新的（维护者 2026-11-05）。
    // 反制祝福不占名额，不需要弃选。
    if (replace && !echoBlessingFree(b) && this.echoBlessings.length >= this._echoBlessingMax()) {
      this.echoBlessingPendingPick = b.id;
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
    const i = Math.floor(Number(pick));
    if (!(i >= 0 && i < offer.length)) return fail(ERR.BAD_TARGET);
    if (!this._echoDiscardVotes) this._echoDiscardVotes = new Map();
    this._echoDiscardVotes.set(ps.playerId, i);
    this.markPublic();
    return this._echoResolveDiscard();
  }

  /** 弃选票齐了就结算。 */
  _echoResolveDiscard() {
    const offer = this.echoBlessingDiscardOffer;
    if (!Array.isArray(offer) || !offer.length) return OK;
    const voters = this.humans().filter((p) => p.connected && !p.spectator).map((p) => p.playerId);
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
    this.markPublic();
    return OK;
  }
  /** 真正发放：记进 `echoBlessings`（同类不叠加）并立刻结算一次性效果。 */
  _echoGrantBlessing(b) {
    if (!b) return null;
    if (!Array.isArray(this.echoBlessings)) this.echoBlessings = [];
    // 反制祝福（2026-11-05）：不占 3 个名额，但**每次抽到都记一次消耗** ——
    // 即使当前没有对应的诅咒，这次抽取也照常花掉，不会存着等以后。
    const free = echoBlessingFree(b) || b.repeatable === true;
    if (!Array.isArray(this.echoCounterIds)) this.echoCounterIds = [];
    if (free) {
      this.echoCounterIds.push(b.id);
    } else {
      if (this.echoBlessings.includes(b.id)) return null;                       // 同类不叠加
      // 上限（静默会压低）；隐藏核心通关的临时名额要算进去，否则第 4 个祝福会被这里拒掉
      const cap = this._echoBlessingMax() + Math.max(0, Number(this.echoBlessingBonus) || 0);
      if (this.echoBlessings.length >= cap) return null;
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
        shop.freeRefreshes = Math.min(this._echoFreeRefreshCap(), (Number(shop.freeRefreshes) || 0) + refresh);
        ps.dirty?.();
      }
    }
    const heal = echoBlessingHeal(b);
    if (heal > 0) {
      // 桩 gd（单测里的假数据）可能没有 startLp：这时不封顶，也不让发放失败
      const lpMax = (ps) => (typeof this.gd.startLp === 'function' ? Math.max(0, Math.floor(Number(this.gd.startLp(ps.bandId)) || 0)) : 0);
      for (const ps of this.alivePlayers()) {
        const before = Math.max(0, Math.floor(Number(ps.lp) || 0));
        const max = lpMax(ps);
        const after = max > 0 ? Math.min(max, before + heal) : before + heal;
        if (after > before) { ps.lp = after; ps.dirty?.(); }
      }
    }
    // C 类（2026-11-05）：消除诅咒。**只动 `echoCurseIds`**（挑战关失败累积的那些）；
    // 奇迹·诅咒 / 远见·诅咒写死在 `_echoCurses()` 里，不经过这个列表，所以清不掉 —— 故意的。
    const removeSpec = echoBlessingCurseRemove(b);
    if (removeSpec != null && Array.isArray(this.echoCurseIds) && this.echoCurseIds.length) {
      // 'common' = 只清普通诅咒（涤罪，稀有/传说保留）；数字 = 清最早的 n 层；'all' = 全清
      const before = this.echoCurseIds.length;
      this.echoCurseIds = removeEchoCurses(this.echoCurseIds, removeSpec).kept;
      const removed = before - this.echoCurseIds.length;
      if (removed > 0) {
        this._echoPushAnnounce(`净化：移除 ${removed} 层诅咒`);
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
        if (had) this._echoPushAnnounce(`祝福「${b.name}」：解除封锁 / 排异`);
      }
      if (removed > 0) this._echoPushAnnounce(`祝福「${b.name}」：驱散 ${removed} 层诅咒`);
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
