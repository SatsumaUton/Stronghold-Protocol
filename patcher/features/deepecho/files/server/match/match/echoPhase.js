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

import { echoDataRound, isDiveRound, isEchoNodeRound, ECHO_SAFE_ROUND, ECHO_LAST_ROUND, ECHO_NODE_FIRST, ECHO_NODE_EVERY, ECHO_NODE_ANCHOR_LAST, ECHO_NODE_LATE_EVERY } from './echo.js';
import { echoWordsForRound, echoWordById, applyEchoWords } from './echoWords.js';
import {
  echoBlessingDue, echoBlessingOffer, echoBlessingById, echoBlessingMods, echoBlessingCoinMul,
  echoBlessingFunds, applyEchoBlessingMods, ECHO_BLESSING_VOTE_MS,
} from './echoBlessing.js';
import { echoBountyDue, echoBountyCards } from './echoBounty.js';
import { createRng, deriveSeed } from '../../sim/rng.js';import { ERR } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { hiddenEligible } from '../finalAssault.js';
import { roundPick } from '../waves.js';
import { FLOW_TICKER_PRIORITY, OK, fail } from './common.js';

export class MatchEcho {
  /**
   * 深潜每回合**最多保留多少「免费刷新」**（维护者 2026-11-03 定）。
   *
   * 免费刷新来自选项事件 / 效果（不按层数给），但会随回合数累积 —— 打到 30 层就可能攒出几十次白嫖。
   * 这里只在**深潜**里每回合开始裁一次；普通房间的 freeRefreshes 一行都不碰。
   */
  static MAX_FREE_REFRESH = 3;
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
      ps.shop.freeRefreshes = Math.min(MatchEcho.MAX_FREE_REFRESH, (Number(ps.shop.freeRefreshes) || 0) + 1);
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
      const pool = Object.keys((this.gd.raw && this.gd.raw.enemies) || {})
        .map((k) => ({ k, e: this.gd.enemy(k) }))
        .filter(({ e }) => e && e.rank === 'ELITE' && Number(e.stats && e.stats.maxHp) <= cap && Number(e.stats && e.stats.moveSpeed) > 0);
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
    return Math.min(8, 3 + Math.floor((depth - 1) / 10));
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
    this.echoWordsActive = words.map((w) => w.id);
    return this.echoWordsActive;
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
   * 每回合开始把超出上限的「免费刷新」裁掉（只影响深潜，普通房间一行不碰）。
   * @returns {number} 被裁过的玩家数
   */
  _echoClampFreeRefreshes() {
    if (this.echoVariant !== 'deepecho') return 0;
    // 只在**深潜回合**夹（深潜现在从第 1 回合开始，所以实际上每回合都夹；普通房间一行不碰）
    if (!this._echoDiveRound(this.round)) return 0;
    const cap = MatchEcho.MAX_FREE_REFRESH;
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
      { id: 'layer', name: '层数上限', desc: '解除到 1e9（原版 999）——深渊不限层' },
      // 维护者 2026-11-05：深潜强制独立卡池（Match 构造时覆盖房间配置，见 Match.js 的 echoIndependentPool）。
      // 玩家开局就该知道「卡池是各用各的」——否则会以为队友拿走了自己商店里的干员。
      { id: 'pool', name: '独立卡池', desc: '每名博士使用自己的卡池（固定开启，不与他人共享）' },
    ];
  }
  _echoCurses() {
    if (this.echoVariant !== 'deepecho') return [];
    return [
      { id: 'miracle', name: '奇迹·诅咒', desc: `免费刷新总数上限 ${MatchEcho.MAX_FREE_REFRESH} 次（原版无上限）` },
      { id: 'foresight', name: '远见·诅咒', desc: '按层给钱结算到 999 层（与原版一致）' },
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
      blessings: this._echoBlessings().map((b) => ({ id: b.id, name: b.name, desc: b.desc })),
      offer,
      // 备战阶段的聚合情报（威胁值 / 是否精英 / 空中数量）；非深潜回合为 null
      curses: this._echoCurses(),
      rules: this._echoFixedRules(),
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
        return { id: (b && b.id) || String(id), name: (b && b.name) || String(id), desc: (b && b.desc) || '' };
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
    const due = echoBlessingDue(r, this.echoDiveStart, this.echoBlessingDraws);
    const owned = Array.isArray(this.echoBlessings) ? this.echoBlessings.length : 0;
    if (due <= owned) { this.echoBlessingOffer = null; return null; }
    if (Array.isArray(this.echoBlessingOffer) && this.echoBlessingOffer.length) return this.echoBlessingOffer;
    const rng = createRng(deriveSeed(this.seed, `echo:bless:${r}`));
    const offer = echoBlessingOffer(rng, this.echoBlessings);
    if (!offer.length) { this.echoBlessingOffer = null; return null; }
    this.echoBlessingOffer = offer.map((b) => b.id);
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
    this.cancel(this._echoBlessingTimer);
    this._echoBlessingTimer = null;
    this.echoBlessingOffer = null;
    this._echoBlessingVotes.clear();
    const b = Array.isArray(offer) ? echoBlessingById(offer[best]) : null;
    if (b) this._echoGrantBlessing(b);
    return OK;
  }
  /** 真正发放：记进 `echoBlessings`（同类不叠加）并立刻结算一次性效果。 */
  _echoGrantBlessing(b) {
    if (!b) return null;
    if (!Array.isArray(this.echoBlessings)) this.echoBlessings = [];
    if (this.echoBlessings.includes(b.id)) return null;          // 同类不叠加
    if (this.echoBlessings.length >= 3) return null;             // 上限 3
    this.echoBlessings.push(b.id);
    this._echoBlessingEndsAt = null;
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
    const cards = echoBountyCards(spawns, { gd: this.gd, depth: this._echoDepth(r), rng, maxCards: 1 });
    if (!cards.length) return 0;
    let n = 0;
    for (const ps of this.alivePlayers()) {
      for (const c of cards) if (this.addBounty(ps, c)) n += 1;
    }
    if (n) this.log.info?.(`[match ${this.roomCode}] echo bounty ${cards.map((c) => c.enemyKey).join(',')} (R${r})`);
    return n;
  }

  /** C 类祝福的资金倍率（结算入账时乘上去；没有祝福就是 1）。 */
  _echoCoinMul() {
    return this.echoVariant === 'deepecho' ? echoBlessingCoinMul(this.echoBlessings) : 1;
  }

  /**
   * 备战阶段的聚合情报（深潜专属，维护者 2026-11-03 定）：**只给威胁值 / 是否精英 / 空中数量**，
   * 不给怪种、不给出现位置 —— 明细由 `views.js: nextEnemiesFor` 在深潜回合整段掐掉。
   *
   * 威胁值用的是与预算同一个度量（敌人最大生命 × 数量），所以「预告的威胁值」和「本回合预算」可比。
   */
  _echoIntel() {
    if (!this._echoDiveRound()) return null;
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
