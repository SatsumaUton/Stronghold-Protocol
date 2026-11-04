// server/match/match/echo.js — 「深渊回响」新模式的延伸数值（2026-11-03）。
//
// 为什么需要这个文件：官方 `enemyScale` 表只到第 15 回合（multi_abyss 15 档）。
// 运行时 `gamedata.baseEnemyScale(r)` 在表里查不到就直接返回 `hpMul: 1`（不是钳到最后一档）——
// 也就是说**第 16 回合的敌人会和第 1 回合一样弱**。深潜必须自己合成缩放，否则延伸毫无压力。
//
// 曲线（[ASSUMED]，官方无依据）：从最后一档起每多一回合
//   hp  ×1.2^(n-last) —— 与官方 R1-R14 一致（实测官方就是每回合 ×1.2）
//   atk ×1.1^(n-last)
// 封顶是为了让「无限模式」不会在第 100 回合把数值撑爆。
//
// 本文件只有纯函数，没有 I/O、没有副作用 —— 单测直接调用。

/** 官方表的最大回合（拓展起点）。 */
export const ECHO_LAST_ROUND = 15;
/**
 * 无尽的两段曲线（维护者 2026-11-03 定：C 方案 + 防「玩家跑飞」）：
 *   R15–R30：血 ×1.20 / 攻 ×1.10（与官方 1–14 回合同一节奏，保持现有体感）
 *   R31+   ：血 ×1.10 / 攻 ×1.05（**永不见顶**，但增长放缓，避免数值爆炸）
 *
 * 为什么不能硬封顶：原来 ECHO_HP_CAP=120 会让敌人血量在 R31 锁死，而玩家还能靠盟约层数 / 词条继续长，
 * 结果就是「到了某个深度之后没有任何东西能克制玩家」，无尽模式直接失去意义。
 * 下面的 CAP 只是防 Infinity 的保险丝，正常永远碰不到。
 */
export const ECHO_HP_CAP = 1e6;
export const ECHO_ATK_CAP = 1e4;
/** 每多一回合的增长：**与官方 1–14 回合同一节奏**（血 ×1.2、攻 ×1.1）。 */
export const ECHO_HP_STEP = 1.2;
export const ECHO_ATK_STEP = 1.1;
/** 从第几个延伸回合起转入缓增段（15 = R30 之后，即 R31 起）。 */
export const ECHO_SLOW_FROM_OVER = 15;
/**
 * 1–15 层的出怪量成长系数（**手感旋钮**，维护者 2026-11-03 调）。
 *
 * 口径：以原版同回合的波次形状为**基准**（`echoDataRound` 用同一回合、缩放用官方表），
 * 再乘这个系数逐层放大 —— 也就是「在原版难度上适当加码」，而不是照抄原版。
 *   1.05 → 第 15 层约为原版的 2.1 倍出怪量（当前档）
 *   1.02 → 约 1.35 倍（更接近原版）
 *   1.10 → 约 3.8 倍（明显更难）
 * 只想调 1–15 的手感时，改这一个数就够了；16 层之后走 1.2 的延伸段，不受它影响。
 */
export const ECHO_EARLY_GROWTH = 1.05;
/** 缓增段的增速（维护者 2026-11-03 选「激进档」）。 */
export const ECHO_HP_STEP_SLOW = 1.15;
export const ECHO_ATK_STEP_SLOW = 1.08;
/** 硬性回合上限：无限模式也不许超过它（防数值与内存失控）。 */
/**
 * 无尽模式的安全阀（维护者 2026-11-03 选 C 方案后改）。
 *
 * 从前这里是 30 —— 跑满 R30 即按胜利结算。改成无尽后：**只有团灭才结束**，深度就是成绩；
 * 这个上限只用来防数值 / 内存失控。数值侧本来就会自己收敛（血量 R31 起锁 120×、攻击 R34 起锁 12×，
 * 见 ECHO_HP_CAP / ECHO_ATK_CAP），所以难度增长改由**结构**承担（词条上限、精英密度、boss 返场频率）。
 */
export const ECHO_SAFE_ROUND = 999;
/**
 * 深渊里「免费刷新」的总量封顶（维护者 2026-11-05 放宽到 5）。
 *
 * 原来是 2：担心「奇迹」按层给刷新把商店变成无限白嫶。
 * 但玩家手上还有**干员 / 策略 / 选项**给的刷新，封在 2 会把它们一起吃掉。
 * 5 既能容纳那些正当来源，又不会回到「无限刷新」。
 */
export const ECHO_MAX_FREE_REFRESH = 2;
/** 排异诅咒持续多少层（维护者 2026-11-05：不是永久，到期自动解除）。 */
export const ECHO_BOND_BAN_ROUNDS = 3;

/**
 * 挑战关（深度 5 / 10）的奖励线：全队清怪率 ≥ 这个百分比 → 全队 +1 次祝福三选一。
 *
 * 维护者 2026-11-05 第二次定：挑战关**不再发资金**，奖励只有祝福；
 * 完美通关 = 100%，自然也在线内。改这一行就能调松紧。
 */
export const ECHO_CHALLENGE_BLESSING_PCT = 90;

/**
 * 固定节点：boss 返场与深潜悬赏都挂在这些回合上（深度 5 / 10 / 15 / 25 / 35…，可无限延续）。
 *
 * ⚠ 2026-11-03 第二次改（维护者）：深潜**从第 1 回合开始**（`Match.echoDiveStart` 建房即 1），
 * 于是「显示回合」恒等于「深度」，下面的数字直接就是深度。
 * 旧方案用绝对回合（R20 起）是为「打完最后一个 boss 才进深潜」的旧入口服务的 ——
 * 那个入口已经不存在了（`_echoBeginDive` 已删除：boss 通关只做 `startRound(round + 1)`）。
 */
export const ECHO_NODE_FIRST = 5;
export const ECHO_NODE_EVERY = 5;
/** 前三个锚点用 5 层间隔（深度 5 / 10 / 15）；之后放稀到 10 层（25 / 35 / 45…），
 *  维护者 2026-11-03 定：R31 起数值改缓增，boss 再密就只剩重复劳动，稀疏化当里程碑更合适。 */
export const ECHO_NODE_ANCHOR_COUNT = 3;
export const ECHO_NODE_LATE_EVERY = 10;
/** 最后一个「锚点」深度（15）。 */
export const ECHO_NODE_ANCHOR_LAST = ECHO_NODE_FIRST + (ECHO_NODE_ANCHOR_COUNT - 1) * ECHO_NODE_EVERY;
/** 深度是不是固定节点（5 / 10 / 15，之后 25 / 35 / 45…）。 */
export const isEchoNodeDepth = (depth) => {
  const d = Math.floor(fin(depth, 0));
  if (d < ECHO_NODE_FIRST) return false;
  if (d <= ECHO_NODE_ANCHOR_LAST) return (d - ECHO_NODE_FIRST) % ECHO_NODE_EVERY === 0;
  return (d - ECHO_NODE_ANCHOR_LAST) % ECHO_NODE_LATE_EVERY === 0;
};

/**
 * 这一回合（显示回合）是不是固定节点。
 *
 * 判定按**深度**：`深度 = 回合 − 深潜起点 + 1`。现在深潜从第 1 回合开始，所以深度恒等于回合；
 * 传 `diveStart` 是为了兼容旧存档 / 单元测试里手工摆的深潜起点（省略时视作 1）。
 *
 * @param {number} round 显示回合
 * @param {number} [diveStart] 深潜第一回合
 */
export const isEchoNodeRound = (round, diveStart = null) => {
  const r = Math.floor(fin(round, 0));
  const first = diveStart == null ? 1 : Math.max(1, Math.floor(fin(diveStart, 1)));
  return isEchoNodeDepth(r - first + 1);
};

const fin = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * 第 `round` 回合应该用的敌人缩放。表内回合原样返回；表外按曲线合成。
 * @param {number} round 目标回合（1 起）
 * @param {{ hpMul?: number, atkMul?: number, speedMul?: number, supplyHpMul?: number }} [base]
 *   最后一档（`ECHO_LAST_ROUND`）的官方缩放；省略时用 1
 * @param {number} [lastRound] 官方表的最后一回合
 * @returns {{ hpMul: number, atkMul: number, speedMul: number, supplyHpMul?: number }}
 */
/**
 * **boss 专用**的延伸曲线（维护者 2026-11-05）。
 *
 * 为什么单开一条：boss 没有「只数」可涨，全靠倍率；
 * 用小怪那条 (1.2/层) 的话，R25→R35 血量翻 5 倍，深层会变成「打不动的墙」。
 * 这里改成 血 ×1.10/层、攻 ×1.06/层，R31 之后再放缓到 1.06 / 1.03。
 *
 * @param {number} round 显示回合
 * @param {{ hpMul?: number, atkMul?: number, speedMul?: number }} base 官方最后一档
 * @param {number} [lastRound] 官方表末尾
 */
export function echoBossScale(round, base = null, lastRound = ECHO_LAST_ROUND) {
  const r = Math.max(1, Math.floor(fin(round, 1)));
  const last = Math.max(1, Math.floor(fin(lastRound, ECHO_LAST_ROUND)));
  const hp0 = Math.max(0.01, fin(base?.hpMul, 1));
  const atk0 = Math.max(0, fin(base?.atkMul, 1));
  const speedMul = Math.max(0.01, fin(base?.speedMul, 1));
  if (r <= last) return { hpMul: hp0, atkMul: atk0, speedMul };
  const over = r - last;
  const fast = Math.min(over, 15);
  const slowN = Math.max(0, over - 15);
  return {
    hpMul: Math.min(ECHO_HP_CAP, hp0 * 1.10 ** fast * 1.06 ** slowN),
    atkMul: Math.min(ECHO_ATK_CAP, atk0 * 1.06 ** fast * 1.03 ** slowN),
    speedMul,
  };
}

export function echoScale(round, base = null, lastRound = ECHO_LAST_ROUND, slow = null) {
  const r = Math.max(1, Math.floor(fin(round, 1)));
  const last = Math.max(1, Math.floor(fin(lastRound, ECHO_LAST_ROUND)));
  const hp0 = Math.max(0.01, fin(base?.hpMul, 1));
  const atk0 = Math.max(0, fin(base?.atkMul, 1));
  const speedMul = Math.max(0.01, fin(base?.speedMul, 1));
  const supplyHpMul = fin(base?.supplyHpMul, 1);
  if (r <= last) {
    // 表内：原样返回（调用方负责先用官方表）
    return { hpMul: hp0, atkMul: atk0, speedMul, ...(supplyHpMul > 0 && supplyHpMul !== 1 ? { supplyHpMul } : {}) };
  }
  const over = r - last;
  const fast = Math.min(over, ECHO_SLOW_FROM_OVER);
  const slowN = Math.max(0, over - ECHO_SLOW_FROM_OVER);
  // 缓增段的增速可以按房间配置覆盖（深潜大厅的「曲线档位」）；不传就是默认档 = 原行为
  const hpStep = Number.isFinite(slow && slow.hp) ? slow.hp : ECHO_HP_STEP_SLOW;
  const atkStep = Number.isFinite(slow && slow.atk) ? slow.atk : ECHO_ATK_STEP_SLOW;
  return {
    hpMul: Math.min(ECHO_HP_CAP, hp0 * ECHO_HP_STEP ** fast * hpStep ** slowN),
    atkMul: Math.min(ECHO_ATK_CAP, atk0 * ECHO_ATK_STEP ** fast * atkStep ** slowN),
    speedMul,
    ...(supplyHpMul > 0 && supplyHpMul !== 1 ? { supplyHpMul } : {}),
  };
}

/**
 * 深潜第 `depth` 层的出怪量成长系数。
 *
 * 分两段、在 15→16 处连续：
 *   1..15 ：`ECHO_EARLY_GROWTH^(depth−1)` —— 以原版为底、按小系数加码；
 *   16+   ：接着 15 层的值再乘 `1.2^(depth−15)`（与数值曲线同源，不会突然跳一档）。
 *
 * @param {number} depth 深度（1 起）
 * @returns {number} 相对原版同回合的倍数（≥1）
 */
export function echoWaveGrowth(depth) {
  const d = Math.max(0, Math.floor(fin(depth, 0)));
  if (!(d > 0)) return 1;
  const early = Math.min(d, ECHO_LAST_ROUND);
  const base = ECHO_EARLY_GROWTH ** (early - 1);
  if (d <= ECHO_LAST_ROUND) return base;
  return base * ECHO_HP_STEP ** (d - ECHO_LAST_ROUND);
}

// ---------------------------------------------------------------------------------------------
// 16 层以后的出怪量（维护者 2026-11-04 §6：循环段按层自己设计，不再跟数据回合的形状走）
//
// 为什么必须单独设计：数据回合在 1..13 之间循环，若 16 层以后继续用「原版该回合的只数」，
// 那么深度 16（正好轮回到数据回合 1）会从 15 层的 112 只**掉到 14 只** —— 深层反而变简单。
// 所以 16 层起改由深度自己决定数量，模板库只负责「这一层的怪种组合」（种类仍取自原版某一关，
// 不拼原版没有的超模搭配）。
//
// 曲线（[ASSUMED]，官方无依据；维护者给的参数按 §6 的建议取 1.15–1.2 档）：
//   轮 = floor((深度 − 16) / 13)      每 13 层一轮（13 = 原版可循环的普通回合数）
//   位 = (深度 − 16) mod 13           轮内第几层（0..12）
//   只数 = 110 × 1.2^轮 × (1 + 0.15 × 位/12)
//
// 轮内从 1.00 爬到 1.15，轮间整档 ×1.2 —— 因为 1.2 > 1.15，整条曲线**单调不减**，
// 不会出现「29 层比 28 层少」的错觉。160 只的硬顶（ECHO_MAX_UNITS）要到 43 层才碰到，
// 之后靠 `echoScale` 的数值曲线继续加压（那是深潜的主压力来源）。
/**
 * 深潜从第几层开始走「按层设计」的出怪量（16 = 原版模板循环段之后）。
 */
export const ECHO_DEEP_FROM = ECHO_LAST_ROUND + 1;
/**
 * 单回合敌人总数上限（维护者 2026-11-04 §6：从 90 抬到 160）。
 *
 * 旧值 90 是「第 12 层就撞顶」的原因：旧曲线在第 12 层就要求 120 只，于是 12 层以后全被压平成 90，
 * 深潜的只数再也看不清。抬到 160 之后，16 层以后的按层设计曲线能一直涨到 43 层才碰顶。
 */
export const ECHO_MAX_UNITS = 160;
/** 一轮的层数：与原版可循环的普通回合数一致（1..13）。 */
export const ECHO_DEEP_CYCLE = 13;
/** 第 1 轮第 1 层（深度 16）的目标敌人数：紧接 15 层的形状，不回落。 */
export const ECHO_DEEP_UNITS_BASE = 110;
/** 轮内爬升：轮末 = 轮首 × (1 + 这个数)。 */
export const ECHO_DEEP_UNITS_RAMP = 0.15;
/** 每多一轮，整条曲线 ×这个数（维护者 §6：建议 1.15 起调；这里取 1.2，与血量曲线同源）。 */
export const ECHO_DEEP_CYCLE_STEP = 1.2;
/** 每条出怪指令平均放几只（换成条数用）：110 只 ≈ 24 条，160 只 ≈ 28 条（封顶）。 */
export const ECHO_DEEP_UNITS_PER_ACTION = 4.5;
/** 深层单回合的出怪条数区间（条数决定「几波」，数量决定「多厚」）。 */
export const ECHO_DEEP_MIN_ACTIONS = 18;
export const ECHO_DEEP_MAX_ACTIONS = 28;

/**
 * 深潜 16 层以后这一层的出怪形状（只给数量，怪种由模板库决定）。
 *
 * @param {number} depth 深度（1 起）
 * @returns {{ cycle:number, pos:number, units:number, actions:number }} cycle/pos 从 1 起
 */
export function echoDeepWaveShape(depth) {
  const d = Math.max(ECHO_DEEP_FROM, Math.floor(fin(depth, ECHO_DEEP_FROM)));
  const n = d - ECHO_DEEP_FROM;
  const cycle = Math.floor(n / ECHO_DEEP_CYCLE);
  const pos = n % ECHO_DEEP_CYCLE;
  const ramp = 1 + ECHO_DEEP_UNITS_RAMP * (pos / (ECHO_DEEP_CYCLE - 1));
  const units = Math.min(ECHO_MAX_UNITS, Math.round(ECHO_DEEP_UNITS_BASE * ECHO_DEEP_CYCLE_STEP ** cycle * ramp));
  const actions = Math.max(
    ECHO_DEEP_MIN_ACTIONS,
    Math.min(ECHO_DEEP_MAX_ACTIONS, Math.round(units / ECHO_DEEP_UNITS_PER_ACTION)),
  );
  return { cycle: cycle + 1, pos: pos + 1, units, actions };
}

/** 是否允许进入第 `round` 回合（无尽模式也不许越过安全阀）。 */
export const echoRoundAllowed = (round) => Math.floor(fin(round, 0)) >= 1 && Math.floor(fin(round, 0)) <= ECHO_SAFE_ROUND;

/**
 * 这一回合是不是「延伸」回合（超过官方最后一档）。
 * @param {number} round @param {number} [lastRound]
 */
export const isEchoRound = (round, lastRound = ECHO_LAST_ROUND) => Math.floor(fin(round, 0)) > Math.floor(fin(lastRound, ECHO_LAST_ROUND));

/**
 * 深潜的起始回合：**打完玩家实际到达的最后一个 boss** 之后的那一回合。
 *
 * 隐藏核心（R15）仍然要达成 `hiddenEligible` 才进得去（这是原有规则，不因深潜而放宽）：
 *   - 达成条件 → 打完 R15 → 从 R16 开始深潜
 *   - 没达成   → 打完 R14 → 从 R15 开始深潜
 * 两条路都能进，深度用「R14 之后又打了几回合」比较才公平。
 *
 * 巧合但有用：官方表里 R13/R14/R15 的缩放相同（都是 6.687075），所以两条路的曲线起点一致。
 * @param {number} lastBossRound 玩家实际到达的最后一个 boss 回合（14 或 15）
 * @returns {number} 深潜的第一回合
 */
export const echoStartRound = (lastBossRound) => {
  const last = Math.max(1, Math.floor(fin(lastBossRound, ECHO_LAST_ROUND)));
  return Math.min(ECHO_SAFE_ROUND + 1, last + 1);
};

/**
 * 这一回合是不是深潜回合（相对玩家实际到达的最后一关）。
 * @param {number} round @param {number} lastBossRound
 */
export const isDiveRound = (round, lastBossRound) => Math.floor(fin(round, 0)) >= echoStartRound(lastBossRound);
/**
 * 深潜回合的「数据回合」：深潜永远是**普通回合**，所以波次/地图要循环用 1..(bossRound-1) 的配置。
 *
 * 为什么必须区分：`phases.js` 里 `isBoss = r === gd.bossRound || r === gd.hiddenRound`。
 * 没打隐藏的人从 R15 进深潜，若直接拿 R15 当回合号就会命中 `hiddenRound` →
 * 进 boss 分支（boss 地图 + boss 波次），但场上没有 boss。所以深潜必须显式走普通分支。
 *
 * @param {number} round 显示回合（深潜里是 15、16、17…）
 * @param {number} diveStart 深潜第一回合（`echoStartRound`）
 * @param {number} bossRound 官方 boss 回合（通常 14），它本身不可循环
 * @returns {number} 用来查 `gd.roundCfg` / 波次模板的数据回合（1..bossRound-1）
 */
export function echoDataRound(round, diveStart, bossRound) {
  const first = Math.max(1, Math.floor(fin(diveStart, 1)));
  const r = Math.floor(fin(round, first));
  const last = Math.max(1, Math.floor(fin(bossRound, 14)));
  const cycle = Math.max(1, last - 1);                 // 可循环的普通回合数：1..last-1
  const depth = r - first + 1;                          // 第几个深潜回合（1 起）
  if (depth < 1) return Math.max(1, Math.min(cycle, r));
  // 前 15 层：**按原版同一回合出怪**（维护者 2026-11-03：1–15 的难度照原版走）。
  // 深潜从 R1 开始，所以深度 1..15 就是原版 R1..R15；14/15 在原版是 boss 回合，
  // 这里收口到 13（boss 由固定节点单独发，不走普通波次）。
  if (depth <= ECHO_LAST_ROUND) return Math.min(depth, cycle);
  // 15 层之后：沿用原版 1..(bossRound-1) 的配置循环
  return ((depth - ECHO_LAST_ROUND - 1) % cycle) + 1;
}

/**
 * 深潜回合是不是普通回合（永不是 boss）。
 * @param {number} round @param {number} diveStart
 */
export const echoIsNormalRound = (round, diveStart) => Math.floor(fin(round, 0)) >= Math.max(1, Math.floor(fin(diveStart, ECHO_LAST_ROUND + 1)));
// ---------------------------------------------------------------------------------------------
// 威胁预算随机出怪（维护者 2026-11-03 定：随机强度用「预算制」）
//
// 为什么不能纯随机：同样标称 R20，抽到一堆小怪就是白送、抽到一堆重甲就是不可能，
// 「深度」就没意义了。所以随机只体现在**组合**上，强度由预算决定：
//   本回合预算 = 基准 × 1.2^(深潜第几回合)
//   从池子里随机抽，直到威胁值凑满预算（允许最后一次略微超出，但不超过 slack）
// ---------------------------------------------------------------------------------------------

/** 深潜第一回合的威胁预算基准。 */
export const ECHO_BUDGET_BASE = 100;
/** 允许最后一次抽取把预算撑破的上限比例（1.15 = 最多超 15%）。 */
export const ECHO_BUDGET_SLACK = 1.15;
/** 单回合最少/最多抽几个敌人，防止极端组合。 */
export const ECHO_MIN_PICKS = 3;
export const ECHO_MAX_PICKS = 24;

/** 第几个深潜回合（0 起）。 */
const diveIndex = (round, diveStart) => Math.max(0, Math.floor(fin(round, diveStart)) - Math.max(1, Math.floor(fin(diveStart, 1))));

/**
 * 某深潜回合的威胁预算：`基准 × 1.2^n`（与血量曲线同源，保证「预算涨得和怪一样快」）。
 * @param {number} round 显示回合（15、16…）
 * @param {number} diveStart 深潜第一回合
 * @param {number} [base] 基准，默认 ECHO_BUDGET_BASE
 */
export const echoWaveBudget = (round, diveStart, base = ECHO_BUDGET_BASE) =>
  Math.max(1, fin(base, ECHO_BUDGET_BASE)) * ECHO_HP_STEP ** diveIndex(round, diveStart);

/**
 * 按预算随机抽一波敌人。
 *
 * @param {Array<{ key: string, threat?: number, elite?: boolean, boss?: boolean }>} pool
 *   候选池（深潜里是 1–13 回合出现过的那批普通敌人；boss/elite 由调用方决定要不要放进来）
 * @param {number} budget 本回合预算（`echoWaveBudget` 的结果）
 * @param {() => number} rng 返回 [0,1) 的随机源（测试传固定序列，线上传对局的 rngWaves）
 * @param {{ minPicks?: number, maxPicks?: number, slack?: number }} [opts]
 * @returns {Array<{ key: string, threat: number }>} 抽中的敌人（按 key 可能有重复）
 */
export function pickWaveByBudget(pool, budget, rng, opts = {}) {
  const list = Array.isArray(pool) ? pool.filter((x) => x && typeof x.key === 'string') : [];
  if (!list.length) return [];
  const minPicks = Math.max(1, Math.floor(fin(opts.minPicks, ECHO_MIN_PICKS)));
  const maxPicks = Math.max(minPicks, Math.floor(fin(opts.maxPicks, ECHO_MAX_PICKS)));
  const slack = Math.max(1, fin(opts.slack, ECHO_BUDGET_SLACK));
  const cap = Math.max(1, fin(budget, ECHO_BUDGET_BASE)) * slack;
  const pick = () => list[Math.min(list.length - 1, Math.floor(fin(rng(), 0) * list.length))];
  const threatOf = (x) => Math.max(1, fin(x.threat, 1));
  const out = [];
  let spent = 0;
  while (out.length < maxPicks) {
    const cand = pick();
    const t = threatOf(cand);
    // 预算还够、或者还没到最少数量 → 收下
    if (out.length < minPicks || spent + t <= cap) {
      out.push({ key: cand.key, threat: t });
      spent += t;
    }
    if (spent >= cap) break;
    // 剩下的钱不够任何一个候选 → 收工
    const cheapest = Math.min(...list.map(threatOf));
    if (spent + cheapest > cap && out.length >= minPicks) break;
  }
  return out;
}
/**
 * 把模板生成的 spawn 列表「换血」：**保留每一条的时序与路线**，只替换敌人种类。
 *
 * 为什么这么设计：`buildNormalWave` 的 spawns 已经带好了 time / routeIndex / pos，
 * 直接另起一套生成器会和地图路线对不上（出怪走到不存在的路上）。
 * 所以随机只作用在「这一格出什么怪」上，不动「什么时候、从哪条路出」。
 *
 * 规则：
 *   - 抽到的敌人比槽位多 → 多出来的按最后一个槽位的时序追加（密集收尾）
 *   - 抽到的比槽位少 → 截断到抽到的数量（前期回合本来敌人就少）
 *
 * @param {Array<any>} spawns 模板产出的 spawn 列表（不改原数组）
 * @param {Array<{ key: string }>} picked `pickWaveByBudget` 的结果
 * @returns {Array<any>} 新的 spawn 列表
 */
export function remapWaveByBudget(spawns, picked) {
  const slots = Array.isArray(spawns) ? spawns : [];
  const keys = (Array.isArray(picked) ? picked : []).map((x) => x && x.key).filter((k) => typeof k === 'string');
  if (!slots.length || !keys.length) return slots.slice();
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const slot = slots[Math.min(i, slots.length - 1)];
    out.push({ ...slot, key: keys[i] });
  }
  return out;
}
