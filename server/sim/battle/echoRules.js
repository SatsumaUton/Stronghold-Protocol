// server/sim/battle/echoRules.js — 「深渊回响」的战斗规则，由 **BattleSpec.flags.echoRules** 驱动（2026-11-06）。
//
// 为什么要有这一层：深潜的战斗效果原先全部写在 `server/match/match/echoPhase.js` 的 `_echoHookBattle()`
// 里 —— 那是 Match 层，只挂在**服务端那份 battle** 上。而 `SP_COMBAT` 未设时深潜默认由浏览器按 BattleSpec
// 跑（`public/js/battle/runner.js` → `/sim/spec.js`），客户端重建出来的战斗里没有这些钩子，于是玩家反馈
// 「侵蚀词条没效果」「部分祝福不生效」。
//
// 解法：Match 不再挂回调，而是把规则序列化成 **纯 JSON** 放进 spec；这份文件在 sim 里解释它。
// sim 是服务端与浏览器共用的同一套代码，所以两边逐字节一致；flag 缺省时这里什么都不做，原版 / golden 不变。
//
// 目前搬运到这里的：
//   * 侵蚀词条（敌人生成时挂 buff，含「护盾 = 最大生命 30%」这种按敌人算的字段）
//   * 对敌异常祝福（按概率挂永久 debuff）
//   * 祝福 / 祭坛 / 补给的部署加成（deploy 时挂 mods）
// 仍在 Match 层（尚未搬运）：主题转化的反震/霜噬/惊惧/震荡/鲸吞、朔风、炎佑、照破、干员减益诅咒。
// 那些在「服务端跑战斗」的路径上照常生效（深潜目前强制服务端模拟）。

/**
 * 装上 spec 带来的深潜战斗规则。幂等（同一个 battle 调两次不会重复挂）。
 * @param {import('../Battle.js').Battle} battle
 * @returns {number} 装上的规则组数（诊断 / 测试用）
 */
export function installEchoRules(battle) {
  const rules = battle && battle.flags && battle.flags.echoRules;
  if (!rules || typeof rules !== 'object' || typeof battle.on !== 'function') return 0;
  if (battle.__echoRulesInstalled) return 0;
  let groups = 0;

  const words = Array.isArray(rules.words) ? rules.words.filter((w) => w && w.key) : [];
  const debuffs = Array.isArray(rules.enemyDebuffs) ? rules.enemyDebuffs.filter((d) => d && d.key && d.mods) : [];
  if (words.length || debuffs.length) {
    battle.on('enemySpawn', ({ enemy }) => {
      if (!enemy || enemy.alive === false || typeof battle.addBuff !== 'function') return;
      const have = new Set((enemy.buffs || []).map((b) => (b && b.key) || null).filter(Boolean));
      const seen = new Map();
      for (const w of words) {
        // 同一条词条出现多次（深层允许重复）→ key 加序号，mods 会叠加（与 Match 层的老实现一致）
        const k = seen.get(w.key) || 0;
        seen.set(w.key, k + 1);
        const key = k === 0 ? w.key : `${w.key}#${k}`;
        if (have.has(key)) continue;
        const buff = { key, name: w.name, desc: w.desc || '', persist: true, visible: true };
        if (w.mods && typeof w.mods === 'object') buff.mods = { ...w.mods };
        if (Number(w.shieldPct) > 0) {
          // 「护盾」要按这只敌人的血量算，所以 spec 只发比例，这里用实际 maxHp 换算
          const hp = Number((enemy.base && enemy.base.maxHp) ?? (enemy.s && enemy.s.maxHp) ?? 0) || 0;
          buff.shield = Math.max(1, Math.round(hp * Number(w.shieldPct)));
        }
        battle.addBuff(enemy, buff);
      }
      for (const d of debuffs) {
        if ((have && have.has(d.key))) continue;
        const roll = Number(typeof battle.rng === 'function' ? battle.rng() : 0) || 0;
        if (roll >= (Number(d.chance) || 0)) continue;
        if ((enemy.buffs || []).some((x) => x && x.key === d.key)) continue;
        battle.addBuff(enemy, { key: d.key, name: d.name, desc: d.desc || '', mods: { ...d.mods }, persist: true, visible: true });
      }
    }, { priority: 60, owner: 'echo:rules' });
    groups++;
  }

  const mods = rules.deployMods && typeof rules.deployMods === 'object' ? rules.deployMods : null;
  if (mods && Object.keys(mods).length && typeof battle.addBuff === 'function') {
    battle.on('deploy', ({ unit }) => {
      if (!unit || unit.side !== 'ally') return;
      const key = 'echo:bl:mods';
      if ((unit.buffs || []).some((x) => x && x.key === key)) return;
      battle.addBuff(unit, { key, name: '疾风', desc: '攻速 +10%', mods: { ...mods }, persist: true, visible: true });
    }, { priority: 60, owner: 'echo:rules' });
    groups++;
  }

  battle.__echoRulesInstalled = groups > 0;
  return groups;
}
