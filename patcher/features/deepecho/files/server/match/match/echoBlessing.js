// server/match/match/echoBlessing.js — 「深渊回响」的祝福（DESIGN-ABYSS.md §6，2026-11-03）。
//
// 三个祝福，全部落在既有字段上，**server/sim 一行都不改**（和 echoWords.js 同一条成本约束）：
//   A 开局资金 +40    → 钱包：`ps.pendingFunds`（与悬赏资金同一条通道，settle.js:66）
//   B 全体攻速 +10%   → 玩家单位的 mods：`batPct: -0.1`（units.js 的 interval = bat×(1+ΣbatPct)×100/aspd）
//   C 全局资金 +20%   → 同 A 的通道，但作用在**结算时的入账**（settle.js 把 coins 乘上去）
//
// 节奏（§5②）：深潜里每 5 个深潜回合三选一；打过隐藏核心的队伍开局多一次（`echoBlessingDraws`）。
// 硬约定（§8 风险 2）：同类不叠加，且最多 3 个 —— 所以 `echoBlessingDue` 封顶 `ECHO_BLESSINGS.length`。
//
// 本文件只有纯函数 + 数据，没有 I/O、没有副作用 —— 单测直接调用。

/** buff key 前缀，便于在 buff 列表里一眼认出来源。 */
export const ECHO_BLESSING_PREFIX = 'echo:bl:';
/** 深潜里几个回合发一次祝福。 */
export const ECHO_BLESSING_EVERY = 5;
/**
 * 三选一的投票时限（维护者 2026-11-03 定：30 秒）。
 *
 * 为什么必须有：结算是「在线真人全投完」才触发的，一个人挂着不投就会把**全队卡死**。
 * 到点后按「票数最高、平票取靠前」强制结算 —— 已经投过的人的选择仍然生效。
 */
export const ECHO_BLESSING_VOTE_MS = 30000;

/**
 * 三个祝福。`kind` 决定生效通道：
 *   `fund`   —— 拿到的那一刻直接进钱包（一次性）
 *   `mods`   —— 给每个上场的己方单位挂 buff（持续整局）
 *   `coin`   —— 结算入账时乘上去（`coinMul`）
 *   `heal`   —— 拿到的那一刻**全队回复生命**（一次性，封顶到各自的初始生命 `gd.startLp`）
 *   `cleanse`—— 拿到的那一刻**移除诅咒**（一次性；固定的奇迹 / 远见诅咒不在可移除列表里）
 */
export const ECHO_BLESSING_MAX = 3;   // 同时持有的最多个数（扩池后不能用池子长度当上限）
/** 刷新三选一的额度上限（维护者 2026-11-05：开局 3 次，任何来源都不能突破）。 */
export const ECHO_BLESSING_REFRESH_MAX = 3;
export const ECHO_BLESSINGS = Object.freeze([
  Object.freeze({
    id: 'fund', weight: 1, rarity: 'common',
    name: '物资补给',
    desc: '立刻获得 8 资金',
    kind: 'fund',
    funds: 8,
  }),
  Object.freeze({
    id: 'haste', rarity: 'rare',
    name: '疾风',
    desc: '全体干员攻速 +10%',
    kind: 'mods',
    // units.js: interval = bat × (1 + ΣbatPct) × 100 / aspd，所以 −0.1 就是「攻速 +10%」
    mods: Object.freeze({ batPct: -0.1 }),
  }),
  Object.freeze({
    id: 'loot', weight: 2, rarity: 'rare',
    name: '丰收',
    desc: '每 3 层，全队 +1 次免费刷新',
    kind: 'coin',
    refreshEvery: 3,
  }),

  // —— 扩展池（2026-11-05）：全部走模拟器已有的 mods 字段，不新造机制 ——
  { id: 'atk_s', rarity: 'common', name: '锐刃', desc: '全体干员攻击 +6%', kind: 'mods', group: 'atk', mods: { atkMul: 1.06 } },
  { id: 'atk_m', rarity: 'rare', name: '强攻', desc: '全体干员攻击 +12%', kind: 'mods', group: 'atk', mods: { atkMul: 1.12 } },
  { id: 'hp_s', rarity: 'common', name: '韧性', desc: '全体干员生命 +6%', kind: 'mods', group: 'hp', mods: { hpMul: 1.06 } },
  { id: 'hp_m', rarity: 'rare', name: '铁壁', desc: '全体干员生命 +12%', kind: 'mods', group: 'hp', mods: { hpMul: 1.12 } },
  { id: 'def_s', rarity: 'common', name: '护甲', desc: '全体干员防御 +60', kind: 'mods', group: 'def', mods: { defFlat: 60 } },
  { id: 'def_m', rarity: 'rare', name: '重甲', desc: '全体干员防御 +120', kind: 'mods', group: 'def', mods: { defFlat: 120 } },
  { id: 'res_s', rarity: 'common', name: '护符', desc: '全体干员法术抗性 +10', kind: 'mods', group: 'res', mods: { resFlat: 10 } },
  { id: 'res_m', rarity: 'rare', name: '降临', desc: '全体干员法术抗性 +20', kind: 'mods', group: 'res', mods: { resFlat: 20 } },
  { id: 'spd_s', rarity: 'common', name: '轻装', desc: '全体干员攻速 +6%', kind: 'mods', group: 'spd', mods: { batPct: -0.06 } },
  { id: 'spd_m', rarity: 'rare', name: '狂风', desc: '全体干员攻速 +15%', kind: 'mods', group: 'spd', mods: { batPct: -0.15 } },
  { id: 'dmg_s', rarity: 'common', name: '振幅', desc: '全体干员造成伤害 +6%', kind: 'mods', group: 'dmg', mods: { dmgDealtMul: 1.06 } },
  { id: 'dmg_m', rarity: 'rare', name: '凿穿', desc: '全体干员造成伤害 +12%', kind: 'mods', group: 'dmg', mods: { dmgDealtMul: 1.12 } },
  { id: 'taken_s', rarity: 'common', name: '避锋', desc: '全体干员受到伤害 -6%', kind: 'mods', group: 'taken', mods: { dmgTakenMul: 0.94 } },
  { id: 'taken_m', rarity: 'rare', name: '坚守', desc: '全体干员受到伤害 -12%', kind: 'mods', group: 'taken', mods: { dmgTakenMul: 0.88 } },
  { id: 'regen_s', rarity: 'common', name: '恢复', desc: '全体干员每秒回复 40 生命', kind: 'mods', group: 'regen', mods: { hpRegen: 40 } },
  { id: 'regen_m', rarity: 'rare', name: '治愈', desc: '全体干员每秒回复 80 生命', kind: 'mods', group: 'regen', mods: { hpRegen: 80 } },
  { id: 'sp_s', rarity: 'common', name: '节奏', desc: '全体干员技力回复 +0.15/秒', kind: 'mods', group: 'sp', mods: { spRecoveryFlat: 0.15 } },
  { id: 'sp_m', rarity: 'rare', name: '澎湃', desc: '全体干员技力回复 +0.3/秒', kind: 'mods', group: 'sp', mods: { spRecoveryFlat: 0.3 } },
  { id: 'block', rarity: 'rare', name: '阵列', desc: '全体干员阻挡数 +1', kind: 'mods', group: 'block', mods: { blockCnt: 1 } },
  { id: 'defpen', rarity: 'epic', name: '破甲', desc: '全体干员无视 80 点防御', kind: 'mods', group: 'pen', mods: { defIgnoreFlat: 80 } },
  { id: 'respen', rarity: 'epic', name: '穿透', desc: '全体干员无视 10 点法抗', kind: 'mods', group: 'pen', mods: { resIgnoreFlat: 10 } },
  { id: 'rng', rarity: 'epic', name: '远程', desc: '全体干员攻击范围延伸 1 格', kind: 'mods', group: 'range', mods: { rangeExtend: 1 } },
  { id: 'tgt', rarity: 'epic', name: '多目标', desc: '全体干员最大目标数 +1', kind: 'mods', group: 'range', mods: { maxTargets: 1 } },
  { id: 'gold_s', weight: 2, rarity: 'common', name: '余利', desc: '结算资金 +8%', kind: 'coin', group: 'coin', coinMul: 1.08 },
  { id: 'gold_m', weight: 1, rarity: 'rare', name: '商运', desc: '结算资金 +15%', kind: 'coin', group: 'coin', coinMul: 1.15 },
  { id: 'fund_s', weight: 1, rarity: 'common', name: '应急包', desc: '立刻获得 5 资金', kind: 'fund', group: 'fund', funds: 5 },
  { id: 'refresh_s', weight: 2, rarity: 'common', name: '机变', desc: '立刻获得 1 次免费刷新', kind: 'fund', group: 'refresh', funds: 0, freeRefresh: 1 },
  { id: 'bigfund', weight: 1, rarity: 'rare', name: '深渊源泉', desc: '立刻获得 15 资金', kind: 'fund', group: 'fund', funds: 15 },
  { id: 'bigrefresh', weight: 1, rarity: 'rare', name: '时之沙漏', desc: '立刻获得 2 次免费刷新', kind: 'fund', group: 'refresh', funds: 0, freeRefresh: 2 },
  // 刷新祝福三选一（维护者 2026-11-05）：「再议」一次性 +1 次刷新额度，每局最多 3 次。
  { id: 'recall', weight: 2, rarity: 'rare', name: '再议', desc: '立刻获得 1 次刷新祝福三选一（每局最多 3 次）', kind: 'fund', group: 'refresh', funds: 0, blessingRefresh: 1 },

  // —— 全队回复生命（2026-11-05）：一次性、数值刻意做小 ——
  // 生命（LP）一格是「一次漏怪抵扣 1 点、每回合最多扣 lpCapPerRound(10)」的量级，
  // 所以这里只给 2–8 点：够救一次失误，不够把深渊的漏怪抹平。
  // 四档分开写而不是「随机数值」，是为了让三选一里能同时出现两种不同档位。
  { id: 'heal_xs', weight: 3, rarity: 'common', name: '绷带', desc: '立刻让全队回复 2 点生命（可超过上限）', kind: 'heal', group: 'heal', healLp: 2 },
  { id: 'heal_s', weight: 3, rarity: 'common', name: '急救', desc: '立刻让全队回复 3 点生命（可超过上限）', kind: 'heal', group: 'heal', healLp: 3 },
  { id: 'heal_m', weight: 2, rarity: 'rare', name: '支援', desc: '立刻让全队回复 6 点生命（可超过上限）', kind: 'heal', group: 'heal', healLp: 6 },
  { id: 'heal_l', weight: 2, rarity: 'rare', name: '战地医疗', desc: '立刻让全队回复 8 点生命（可超过上限）', kind: 'heal', group: 'heal', healLp: 8 },

  // —— 灾厄祝福（2026-11-05）：强力但**拿到就立刻附上一条诅咒** ——
  { id: 'doom_atk', rarity: 'epic', name: '血契', desc: '全体干员攻击 +18%；立刻附加诅咒「狂怒」（敌方攻击 +10%）', kind: 'mods', mods: { atkMul: 1.18 }, curseOnTake: 'frenzy' },
  { id: 'doom_bat', rarity: 'epic', name: '疾影', desc: '全体干员攻速 +15%；立刻附加诅咒「断弦」（本回合远程干员攻速 −10%）', kind: 'mods', mods: { batPct: 0.15 }, curseOnTake: 'weak_ranged' },
  { id: 'doom_hp', rarity: 'epic', name: '铁壁', desc: '全体干员生命 +20%；立刻附加诅咒「甲壳」（敌方防御 +200）', kind: 'mods', mods: { hpMul: 1.20 }, curseOnTake: 'carapace' },
  // —— 消除诅咒（2026-11-05）——
  // 只能清掉**对局中累积**的诅咒（`echoCurseIds`：挑战关失败降下的「侵蚀」等）。
  // 奇迹·诅咒 / 远见·诅咒是深渊的固定限制（`_echoCurses()` 里的两条），**永远消不掉** ——
  // 否则「免费刷新上限」「按层给钱到 999 层」会随着祝福一起被洗掉，等于没有诅咒。
  { id: 'cleanse', rarity: 'epic', name: '净化', desc: '立刻移除 1 层诅咒（任意稀有度；固定的奇迹 / 远见不受影响）', kind: 'cleanse', group: 'cleanse', curseRemove: 1 },
  { id: 'cleanse_all', weight: 2, rarity: 'rare', name: '涤罪', desc: '立刻移除所有**普通**诅咒（稀有 / 传说保留；固定的奇迹 / 远见不受影响）', kind: 'cleanse', group: 'cleanse', curseRemove: 'common' },

  // —— 克制祝福（2026-11-05，维护者要求）：每个诅咒都能被对应的祝福抵消 ——
  // 拿到就把对应的诅咒从 `echoCurseIds` 里删掉（效果现算，删掉即恢复）；部署禁令类直接解除。
  // 稀有度普遍比对应诅咒低一档，保证「抽得到」。
  { id: 'staunch', rarity: 'rare', name: '止血', desc: '驱散「失血 / 溃血 / 剧痛 / 渗血」：漏怪伤害恢复正常', kind: 'counter', group: 'counter',
    counterCurses: ['bleed', 'hemorrhage', 'ache', 'r_bleed'] },
  // 护盾（维护者 2026-11-05）：拿到后全队投票指定一条附加盟约；排异随机到它时护盾抵消该诅咒。
  { id: 'shield_bond', rarity: 'epic', name: '护盾', desc: '全队投票指定一条附加盟约：排异随机到它时护盾抵消该诅咒（一次性）', kind: 'shield', group: 'counter' },
  { id: 'unlock', rarity: 'rare', name: '开路', desc: '解除「封锁 / 排异」：被封的地块重新可部署、盟约排异取消', kind: 'counter', group: 'counter',
    // 可重复出现（维护者 2026-11-05）：排异会分批降临，每次都需要新的开路；且不占 3 个祝福名额
    repeatable: true, counterBans: true },
  { id: 'recon', rarity: 'rare', name: '侦察', desc: '驱散「迷雾 / 遮蔽」：敌方情报恢复显示', kind: 'counter', group: 'counter',
    counterCurses: ['fog', 'blackout'] },
  // ---- 反隐匿（维护者 2026-11-05）----
  // 隐匿敌人（s.flags.stealth）默认不可选中（targeting.js）；被「照破 / 洞彻」打上 reveal 标记后可以正常打。
  { id: 'reveal_pulse', rarity: 'rare', name: '照破', desc: '每 8 秒使全场隐匿敌人现形 3 秒', kind: 'reveal', group: 'reveal', interval: 8, duration: 3 },
  { id: 'reveal_always', rarity: 'epic', name: '洞彻', desc: '全场敌人永久现形（反隐匿）', kind: 'reveal', group: 'reveal', always: true },
  // ---- 谢拉格寒风（维护者 2026-11-05）----
  // 直接复用原版盟约的寒风实现（server/sim/content/devices.js startColdWind），所以数值口径与谢拉格满档一致。
  { id: 'kjerag_wind', rarity: 'epic', name: '朔风', desc: '每 10 秒刮一阵寒风，使全场敌人寒冷 3 秒', kind: 'coldwind', group: 'wind', interval: 10, duration: 3 },
  // ---- 炎佑（维护者 2026-11-05）----
  // 开战召唤 1 只炎佑，存在 lifetime 秒；可叠加 maxStacks 次（最多 2 只，token 本身的 deployLimit 也是 2）。
  { id: 'yanyou_gift', rarity: 'epic', name: '炎佑之契', desc: '开战召唤 1 只炎佑，存在 20 秒；最多叠加 2 次', kind: 'yanyou', group: 'summon', lifetime: 20, stackable: true, maxStacks: 2 },
  { id: 'thrift', rarity: 'common', name: '开源', desc: '驱散所有资金类诅咒（贡赋 / 征收 / 重税 / 什一税 / 抽成）', kind: 'counter', group: 'counter',
    counterCurses: ['tribute', 'levy', 'heavytax', 'tithe', 'r_levy'] },
  { id: 'cleanse_words', rarity: 'rare', name: '净言', desc: '驱散「侵蚀」：侵蚀词条上限恢复', kind: 'counter', group: 'counter',
    counterCurses: ['erosion'] },
  { id: 'echo_back', rarity: 'rare', name: '回响', desc: '驱散「静默」：祝福上限恢复', kind: 'counter', group: 'counter',
    counterCurses: ['silence'] },
  { id: 'quench', rarity: 'common', name: '畅饮', desc: '驱散「枯竭 / 干涸」：免费刷新上限恢复', kind: 'counter', group: 'counter',
    counterCurses: ['drought', 'r_drought'] },
  // 2026-11-05 第二批：把后续新增的诅咒也逐类配上反制（每条诅咒都要有解法）
  { id: 'swift_oath', rarity: 'rare', name: '疾行', desc: '驱散「滞重 / 迟滞」：战斗时限恢复', kind: 'counter', group: 'counter',
    counterCurses: ['leaden', 'r_leaden'] },
  { id: 'clearfield', rarity: 'rare', name: '清野', desc: '驱散「蜂拥 / 涌潮」：出怪量恢复', kind: 'counter', group: 'counter',
    counterCurses: ['swarm', 'r_swarm'] },
  { id: 'rally', rarity: 'rare', name: '压阵', desc: '驱散「狂怒 / 甲壳 / 躁动 / 硬壳」：敌方数值恢复', kind: 'counter', group: 'counter',
    counterCurses: ['frenzy', 'carapace', 'r_frenzy', 'r_carapace'] },
  { id: 'bounty_grace', rarity: 'common', name: '厚赏', desc: '驱散「贪婪」：悬赏币恢复', kind: 'counter', group: 'counter',
    counterCurses: ['greed'] },
  { id: 'inspire', rarity: 'rare', name: '提振', desc: '驱散「削锋 / 断弦 / 钝刃」：干员减益解除', kind: 'counter', group: 'counter',
    counterCurses: ['weak_melee', 'weak_ranged', 'r_weak_melee', 'r_weak_ranged'] },
  { id: 'bargain', rarity: 'rare', name: '议价', desc: '驱散「通胀 / 暴利」：商店价格恢复', kind: 'counter', group: 'counter',
    counterCurses: ['inflation', 'profiteer'] },
  { id: 'spring', rarity: 'rare', name: '活泉', desc: '驱散「腐蚀 / 溃烂」：全场持续伤害停止', kind: 'counter', group: 'counter',
    counterCurses: ['rot', 'r_rot'] },

  // —— 强效反制（2026-11-05）：一次清**多层**叠加诅咒。稀有度更高、出现概率更低 ——
  // counterStacks = 一次能清掉同一条诅咒的层数（默认 1）。
  { id: 'staunch_x', rarity: 'epic', name: '彻愈', desc: '一次清掉 3 层漏怪类诅咒（失血 / 溃血 / 剧痛 / 渗血）', kind: 'counter', group: 'counter',
    counterStacks: 3, counterCurses: ['bleed', 'hemorrhage', 'ache', 'r_bleed'] },
  { id: 'purge_x', rarity: 'epic', name: '肃清', desc: '一次清掉 3 层敌方数值类诅咒（狂怒 / 甲壳 / 躁动 / 硬壳）', kind: 'counter', group: 'counter',
    counterStacks: 3, counterCurses: ['frenzy', 'carapace', 'r_frenzy', 'r_carapace'] },
  { id: 'thrift_x', rarity: 'rare', name: '富源', desc: '一次清掉 2 层资金类诅咒（贡赋 / 征收 / 重税 / 什一税 / 抽成）', kind: 'counter', group: 'counter',
    counterStacks: 2, counterCurses: ['tribute', 'levy', 'heavytax', 'tithe', 'r_levy'] },

  // —— 对敌方上异常（2026-11-05）：敌人**生成时**按概率挂上持续 debuff ——
  { id: 'frostbite', rarity: 'rare', name: '寒冻', group: 'debuff', kind: 'mods',
    desc: '40% 的敌人移动速度 -40%',
    enemyDebuff: { chance: 0.4, mods: { moveMul: 1.4 }, tag: 'frost' } },
  { id: 'vulnerable', rarity: 'rare', name: '易伤', group: 'debuff', kind: 'mods',
    desc: '35% 的敌人受到伤害 +15%',
    enemyDebuff: { chance: 0.35, mods: { dmgTakenMul: 0.85 }, tag: 'vuln' } },

  // —— 主题转化（维护者 2026-11-05）：把**附加盟约**的主题变成对敌压制 ——
  //
  // 15 条附加盟约里只有 奥术 / 坚守 本身带对敌异常，其余基本只服务己方数值。这里给它们
  // 各配一条「转化」祝福，把盟约的主题搬到敌人身上：
  //   · **不看队伍有没有这条盟约**（维护者 2026-11-05 明确）：它们就是普通祝福，直接进三选一池，
  //     谁抽到都生效。`bondTheme` 只记录「这条是从哪条盟约的主题来的」，不参与任何判定。
  //   · 生效窗口是每回合**开局前 N 秒**（不是永久）：N 按稀有度分档，见 ECHO_BOND_DEBUFF_SECONDS。
  //   · 实现只用 sim 已有的异常状态（`battle.applyStatus`）与 `battle.dealDamage`（反伤），
  //     server/sim 一行不改，golden 的既有场景不受影响。
  //   · 数值口径：原版盟约效果 ×1.5~2（维护者 2026-11-05 认可这档估值）。
  // 跳过 远见 / 投资人 / 不屈 / 独行：它们的效果是「钱 / 招募 / 复活 / 独狼」，转成对敌减益
  // 会变成另一条机制，不像「主题转化」。
  { id: 'bd_arcane', rarity: 'rare', name: '术蚀', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'arcaneShip', bondLabel: '奥术',
    desc: '每回合前 15 秒，全场敌人受到的法术伤害 +25%',
    enemyStatuses: [{ key: 'artsFragile', value: 0.25 }] },
  { id: 'bd_stead', rarity: 'epic', name: '反震', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'steadShip', bondLabel: '坚守',
    desc: '每回合前 20 秒，敌人对己方造成伤害时受到其中 30% 的真实反伤',
    reflect: 0.3 },
  { id: 'bd_preci', rarity: 'rare', name: '洞穿', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'preciShip', bondLabel: '精准',
    desc: '每回合前 15 秒，全场敌人防御 -30%',
    enemyStatuses: [{ key: 'defDown', value: 0.3 }] },
  { id: 'bd_skillful', rarity: 'common', name: '缠足', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'skillfulShip', bondLabel: '灵巧',
    desc: '每回合前 10 秒，全场敌人攻击速度 -30',
    enemyStatuses: [{ key: 'aspdDown', value: -30 }] },
  { id: 'bd_swift', rarity: 'rare', name: '迟滞', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'swiftShip', bondLabel: '迅捷',
    desc: '每回合前 15 秒，全场敌人移动速度 -60%',
    enemyStatuses: [{ key: 'slow', value: 0.6 }] },
  { id: 'bd_deput', rarity: 'rare', name: '削壁', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'deputShip', bondLabel: '助力',
    desc: '每回合前 15 秒，全场敌人防御 -20%、法术抗性 -15',
    enemyStatuses: [{ key: 'defDown', value: 0.2 }, { key: 'resDown', value: 15 }] },
  { id: 'bd_empty', rarity: 'epic', name: '压制', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'emptyShip', bondLabel: '协防',
    desc: '每回合前 20 秒，全场敌人攻击力 -25%',
    enemyStatuses: [{ key: 'weaken', value: 0.25 }] },
  { id: 'bd_mira', rarity: 'rare', name: '厄运', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'miraShip', bondLabel: '奇迹',
    desc: '每回合前 15 秒，全场敌人受到的伤害 +20%',
    enemyStatuses: [{ key: 'fragile', value: 0.2 }] },
  { id: 'bd_mani', rarity: 'rare', name: '调律', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'maniShip', bondLabel: '调和',
    desc: '每回合前 15 秒，全场敌人法术抗性 -25',
    enemyStatuses: [{ key: 'resDown', value: 25 }] },
  { id: 'bd_raid', rarity: 'common', name: '袭扰', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'raidShip', bondLabel: '突袭',
    desc: '每回合前 10 秒，全场敌人移动速度 -40%、攻击速度 -15',
    enemyStatuses: [{ key: 'slow', value: 0.4 }, { key: 'aspdDown', value: -15 }] },
  { id: 'bd_sunt', rarity: 'epic', name: '绝境', kind: 'bonddebuff', group: 'bonddebuff',
    bondTheme: 'suntShip', bondLabel: '绝技',
    desc: '每回合前 20 秒，全场敌人受到的伤害 +25%',
    enemyStatuses: [{ key: 'fragile', value: 0.25 }] },
]);

/**
 * 主题转化祝福的生效时长（秒）：每回合**开局前**多久对全场敌人施压。
 *
 * 维护者 2026-11-05 选「按稀有度分档」（而不是统一 15 秒）：越难抽到的转化，压得越久。
 */
export const ECHO_BOND_DEBUFF_SECONDS = Object.freeze({ common: 10, rare: 15, epic: 20 });
/** 这条转化祝福持续几秒（没登记稀有度时按稀有 15 秒）。 */
export const echoBondDebuffSeconds = (rarity) => ECHO_BOND_DEBUFF_SECONDS[rarity] || ECHO_BOND_DEBUFF_SECONDS.rare;

/** 按 id 取祝福。 */
export const echoBlessingById = (id) => ECHO_BLESSINGS.find((b) => b.id === id) || null;

/**
 * 这条祝福是不是**一次性**的（拿完立刻结算，不挂在干员身上）。
 *
 * 判据：`kind !== 'mods'`（资金 / 回血 / 涤罪 / 免费刷新这类即时效果），
 * 或者反制祝福（`counter` / `repeatable`：用完即弃）。客户端据此打「一次性」标记
 * （维护者 2026-11-05：玩家不知道它会立刻消失）。
 */
// 只有**拿到就立刻结算**的才算一次性：回血 / 资金 / 涤罪。coin（结算资金倍率）与 shield（护盾）
// 是持续性效果，仍占 3 个名额。
const ONESHOT_KINDS = new Set(['heal', 'fund', 'cleanse']);
export const echoBlessingOneShot = (b) => !!b && (b.counter === true || b.repeatable === true || ONESHOT_KINDS.has(b.kind));

/**
 * 到第 `round` 回合为止**应该已经拿到几个**祝福。
 *
 * 规则：深潜第 5、10、15… 个回合各一次（`depth % 5 === 0`），外加开局奖励次数 `bonus`（打过隐藏核心 = 1）。
 * 封顶 3（三个祝福拿完就不再发，避免无限叠）。
 *
 * @param {number} round 显示回合
 * @param {number} diveStart 深潜第一回合
 * @param {number} [bonus] 开局奖励次数（隐藏核心通关 = 1）
 * @returns {number} 应有的祝福总数（0..3）
 */
export function echoBlessingDue(round, diveStart, bonus = 0, max = ECHO_BLESSING_MAX) {
  const first = Math.max(1, Math.floor(Number(diveStart) || 1));
  const r = Math.floor(Number(round) || 0);
  const depth = r - first + 1;
  if (!Number.isFinite(depth) || depth < 1) return 0;
  const b = Math.max(0, Math.floor(Number(bonus) || 0));
  // 维护者 2026-11-04：**第 1 层就给一次**（进深潜就有选择），之后仍然是每 5 层一次。
  // 所以 1–4 层 = 1，10 层 = 2，15 层 = 3（封顶 3）。
  const every = Math.max(1, Math.floor(depth / ECHO_BLESSING_EVERY));
  // max 可被诅咒（「静默」）压低；不传就是常规上限 3。
  const cap = Math.max(0, Math.floor(Number(max) || ECHO_BLESSING_MAX));
  return Math.min(cap, b + every);
}

/**
 * 稀有度 → 抽中权重（维护者 2026-11-05：祝福也要有稀有度，越强越难抽到）。
 * 注意这是**单个候选槽**的权重，不是概率本身：三个槽一起抽，所以传说仍可能出现在三选一里。
 */
export const ECHO_BLESSING_RARITY_WEIGHT = Object.freeze({ common: 8, rare: 3, epic: 1 });

/** 稀有度中文名（界面用）。 */
export const ECHO_BLESSING_RARITY_LABEL = Object.freeze({ common: '普通', rare: '稀有', epic: '传说' });

/**
 * 「资金类」祝福：直接给钱（`fund`）或乘结算资金（`coin`）。
 * 维护者 2026-11-05：这类出现得太频繁 —— 除了降权重，三选一里**最多只给 1 个**。
 */
export const echoBlessingIsMoney = (b) => !!b && ((b.kind === 'fund' && Number(b.funds) > 0) || (b.kind === 'coin' && Number(b.coinMul) > 0));

/**
 * 本次三选一的候选：从**还没拿过**的祝福里按稀有度加权抽最多 3 个（不足 3 个时给剩下的全部）。
 *
 * 用独立种子流（调用方传 `deriveSeed(seed, 'echo:bless:<round>')`），不消耗商店 / 波次 / 战斗的随机数。
 * 加权抽是**不放回**的：已经抽中的不会再进池子，所以三个槽不会重复。
 *
 * @param {() => number} rng [0,1) 随机源
 * @param {string[]} [owned] 已拥有的祝福 id
 * @returns {Array<typeof ECHO_BLESSINGS[number]>} 候选（可能为空 = 三个都拿过了）
 */
export function echoBlessingOffer(rng, owned = []) {
  const have = new Set(Array.isArray(owned) ? owned : []);
  const pool = ECHO_BLESSINGS
    .filter((b) => (echoBlessingFree(b) || b.repeatable === true || !have.has(b.id)) && b.disabled !== true)
    // 允许单条祝福覆盖权重（.weight）：给钱类祝福出现得太频繁，维护者要求降频（2026-11-05）
    .map((b) => ({ b, w: Number(b.weight) > 0 ? Number(b.weight) : ECHO_BLESSING_RARITY_WEIGHT[b.rarity] || 1 }));
  const out = [];
  let moneyTaken = false;
  // 一次性祝福（资金 / 回血 / 免费刷新 / 净化 / 涤罪）：拿到立刻结算、不占名额，
  // 所以以前三选一里经常一次冒两个（维护者 2026-11-05：41% 的轮次至少一个）。
  // 除了降权重，这里再钉一条：**一轮最多 1 个一次性**。
  let oneShotTaken = false;
  while (pool.length && out.length < 3) {
    // 已经给过资金类 / 一次性 → 剩下的槽优先给别的；池子只剩那一类时才退回，保证槽位不空。
    // 注意：反制类（开路 / 侦察 / 畅饮…）虽然也「用掉就没」，但它们是应对手段、可重复出现，
    // 不参与这条「一轮最多 1 个」的限制（维护者 2026-11-05：限制的是回血/资金/净化这类消耗品）。
    const ok = (x) => (!moneyTaken || !echoBlessingIsMoney(x.b))
      && (!oneShotTaken || !echoBlessingOneShot(x.b) || echoBlessingFree(x.b));
    const pref = pool.filter(ok);
    const cand = pref.length ? pref : pool;
    const total = cand.reduce((sum, x) => sum + x.w, 0);
    let r = (Number(rng()) || 0) * total;
    let picked = cand[cand.length - 1];
    for (let i = 0; i < cand.length; i++) {
      r -= cand[i].w;
      if (r < 0) { picked = cand[i]; break; }
    }
    if (echoBlessingIsMoney(picked.b)) moneyTaken = true;
    if (echoBlessingOneShot(picked.b)) oneShotTaken = true;
    out.push(picked.b);
    pool.splice(pool.indexOf(picked), 1);
  }
  return out;
}

/**
 * 已拥有祝福合并出来的玩家单位 mods（加法语义：两个 batPct 会相加，但同类不叠加所以最多一份）。
 * @param {string[]} ids
 * @returns {object} 空对象 = 没有加成
 */
/**
 * 祝福的「深层强化」（维护者 2026-11-05：前期拿的祝福到 16 层以后基本没感觉）。
 *
 * 16 层起，数值型祝福按 `ECHO_BLESSING_LATE_MUL` 放大（默认 ×2.5）：
 *   * 乘法类（`*Mul`，如 atkMul 1.06）放大的是**增量**：1 + (v-1)×2.5 → 1.15；
 *   * 百分比 / 平坦类（`*Pct`、`*Flat`）直接乘；
 *   * 计数类（格挡数 / 射程 / 目标数）不放大 —— 整数机制放大只会变味。
 * 资金 / 金币 / 回血这类一次性效果同样放大（见 echoBlessingFunds / echoBlessingCoinMul）。
 */
export const ECHO_BLESSING_LATE_FROM = 16;
export const ECHO_BLESSING_LATE_MUL = 2.5;
/** 这些键是「计数」而不是「数值」，不参与深层放大。 */
const ECHO_BLESSING_COUNT_KEYS = new Set(['blockCnt', 'rangeExtend', 'maxTargets']);

/** 这个深度下祝福的放大倍率（16 层起生效）。 */
export const echoBlessingLateMul = (depth) => (Math.floor(Number(depth) || 0) >= ECHO_BLESSING_LATE_FROM ? ECHO_BLESSING_LATE_MUL : 1);

/** 单条祝福的 mods 按倍率放大（不修改原表）。 */
export function echoBlessingScaledMods(b, mul = 1) {
  if (!b || !b.mods) return {};
  const out = {};
  for (const [k, v] of Object.entries(b.mods)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!(mul > 1) || ECHO_BLESSING_COUNT_KEYS.has(k)) { out[k] = v; continue; }
    out[k] = /Mul$/.test(k) ? 1 + (v - 1) * mul : v * mul;
  }
  return out;
}

export function echoBlessingMods(ids, depth = 0) {
  const mul = echoBlessingLateMul(depth);
  const out = {};
  for (const id of Array.isArray(ids) ? ids : []) {
    const b = echoBlessingById(id);
    if (!b || b.kind !== 'mods' || !b.mods) continue;
    for (const [k, v] of Object.entries(echoBlessingScaledMods(b, mul))) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/**
 * 已拥有祝福的资金倍率（`coin` 类相乘；没有就是 1）。
 * @param {string[]} ids
 */
export function echoBlessingCoinMul(ids) {
  // 资金 / 金币**不参与深层放大**（维护者 2026-11-05）：钱是按层给的核心资源，放大只会让经济失控
  let mul = 1;
  for (const id of Array.isArray(ids) ? ids : []) {
    const b = echoBlessingById(id);
    if (!b || b.kind !== 'coin' || !(b.coinMul > 0)) continue;
    mul *= b.coinMul;
  }
  return mul;
}

/**
 * 拿到这个祝福时一次性发放的资金（`fund` 类；其它返回 0）。
 * 资金**不参与深层放大**（维护者 2026-11-05）。
 * @param {typeof ECHO_BLESSINGS[number]} b
 */
export const echoBlessingFunds = (b) => (b && b.kind === 'fund' && b.funds > 0 ? Math.trunc(b.funds) : 0);

/**
 * 拿到这个祝福时一次性回复的生命（`heal` 类；其它返回 0）。
 * 数值由调用方封顶到玩家自己的初始生命（`gd.startLp`），这里只负责给出「该回多少」。
 * @param {typeof ECHO_BLESSINGS[number]} b
 */
/**
 * 反制祝福（kind === 'counter'）：一次性生效、**不占 3 个祝福名额**、可以重复抽到。
 * 维护者 2026-11-05：排异/诅咒会分批降临，把反制塞进原本的名额会逼玩家在「变强」和「能玩」之间二选一。
 */
export const echoBlessingFree = (b) => !!(b && b.kind === 'counter');

export const echoBlessingHeal = (b) => (b && b.kind === 'heal' && b.healLp > 0 ? Math.trunc(b.healLp) : 0);

/**
 * 拿到这个祝福时一次性移除几层诅咒（`cleanse` 类；其它返回 0，'all' 返回 Infinity）。
 *
 * ⚠ 只作用于 `echoCurseIds`（对局中累积的诅咒）。奇迹·诅咒 / 远见·诅咒是 `_echoCurses()` 里写死的
 * 固定限制，不在这个列表里，所以这个函数天然清不掉它们 —— 这是设计，不要为了让「净化」更强去改。
 * @param {typeof ECHO_BLESSINGS[number]} b
 */
export function echoBlessingCurseRemove(b) {
  if (!b || b.kind !== 'cleanse') return null;
  const v = b.curseRemove;
  if (typeof v === 'string') return v;                 // 'common'（只清普通）/ 'all'
  const n = Math.max(0, Math.trunc(Number(v) || 0));
  return n > 0 ? n : null;
}

/**
 * 给一个己方单位挂上祝福的 mods buff（幂等：同一个 key 只挂一次）。
 *
 * @param {{ addBuff: Function }} battle
 * @param {any} unit 己方单位
 * @param {object} mods `echoBlessingMods` 的结果
 * @returns {boolean} 是否真的挂上去了
 */
export function applyEchoBlessingMods(battle, unit, mods) {
  if (!battle || typeof battle.addBuff !== 'function' || !unit || !mods) return false;
  const keys = Object.keys(mods);
  if (!keys.length) return false;
  const key = `${ECHO_BLESSING_PREFIX}mods`;
  if ((unit.buffs || []).some((x) => x && x.key === key)) return false;
  battle.addBuff(unit, { key, name: '疾风', desc: '攻速 +10%', mods: { ...mods }, persist: true, visible: true });
  return true;
}