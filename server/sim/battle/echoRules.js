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
//   * 朔风（周期性寒冷）、炎佑之契（开战召唤）、照破（周期性现形）
// 仍在 Match 层（尚未搬运）：主题转化的反震/霜噬/惊惧/震荡/鲸吞、干员减益诅咒。
import { startColdWind } from '../content/devices.js';
import { spawnYanyou } from '../content/tokens.js';

/**
 * 这只刚生成的敌人是不是**召唤物**（维护者 2026-11-06：侵蚀词条只挂本体，召唤物一律不吃）。
 *
 * 为什么必须排除：召唤物是本体的一部分（首领的分体、只会跟着本体出现的敌人），它们本来就按本体的
 * 强度结算；词条再叠一遍生命 / 护盾 / 防御，同一条词条就收了两次费。其中一批还是「打几下就碎」的
 * 频次怪（器物类），被护盾 + 巨兽一叠就彻底打不动 —— 玩家反馈的「召唤物打不死」就是这里。
 *
 * 判定（任一命中即是）：
 *   * `tag === 'part'`：首领分体（胄的双手、铳的部件…），出怪时就带这个 tag；
 *   * `def.tokenOnly`：数据里只能被召唤出来的敌人；
 *   * 键名 `token_*`：数据侧另一套召唤物命名；
 *   * `keys`：spec 下发的召唤物名单（Match 侧 `echoSummonOnly(gd)`：tokenOnly + 别人的 `summons`
 *     目标 + 波次里 tag:part 的分体）——这是这套代码里「召唤物」的既有定义，出怪处也用它。
 *
 * @param {any} enemy 刚生成的单位
 * @param {Set<string>|null} [keys] spec 下发的召唤物键集合
 * @returns {boolean}
 */
export function isEchoSummon(enemy, keys = null) {
  if (!enemy) return false;
  if (enemy.tag === 'part' || enemy.tag === 'summon') return true;
  const def = enemy.def || null;
  if (def && def.tokenOnly === true) return true;
  const key = enemy.defId ?? (def && def.key) ?? null;
  if (typeof key !== 'string') return false;
  if (key.startsWith('token_')) return true;
  return !!(keys && typeof keys.has === 'function' && keys.has(key));
}

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
  // 召唤物名单（spec `summonKeys`）：词条只挂本体，见 isEchoSummon
  const summonKeys = new Set((Array.isArray(rules.summonKeys) ? rules.summonKeys : []).filter((k) => typeof k === 'string'));
  if (words.length || debuffs.length) {
    battle.on('enemySpawn', ({ enemy }) => {
      if (!enemy || enemy.alive === false || typeof battle.addBuff !== 'function') return;
      const have = new Set((enemy.buffs || []).map((b) => (b && b.key) || null).filter(Boolean));
      // 召唤物不吃侵蚀词条（维护者 2026-11-06）；祝福的对敌异常（debuffs）照旧
      const wordList = isEchoSummon(enemy, summonKeys) ? [] : words;
      const seen = new Map();
      for (const w of wordList) {
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

  // 主题转化（11 条祝福）：开局前 N 秒的对敌施压 / 反震 / 霜噬 / 惊惧 / 震荡 / 鲸吞。
  // 逻辑与 Match 层的老实现逐行对应（`secs` 由 Match 按稀有度算好一起下发）。
  const bondDebuffs = Array.isArray(rules.bondDebuffs) ? rules.bondDebuffs : [];
  if (bondDebuffs.length) {
    for (const b of bondDebuffs) {
      const secs = Number(b.secs) || 0;
      const leftNow = () => secs - (Number(battle.time) || 0);
      // 开局窗口内对全场敌人挂异常（new 出来的敌人也补挂）
      const strike = (e, left) => {
        if (!e || e.alive === false || !(left > 0)) return;
        if (typeof battle.applyStatus !== 'function') return;
        for (const st of (b.statuses || [])) {
          battle.applyStatus(e, st.key, { duration: left, value: st.value == null ? undefined : st.value, source: null });
        }
      };
      if (Array.isArray(b.statuses) && b.statuses.length) {
        for (const e of battle.enemies || []) strike(e, leftNow());
        battle.on('enemySpawn', ({ enemy }) => strike(enemy, leftNow()), { priority: 57, owner: 'echo:rules' });
      }
      // 反震：窗口内敌人对己方造成伤害时吃真实反伤（source 为 null 的伤害不会触发，所以不递归）
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
        }, { priority: 40, owner: 'echo:rules' });
      }
      // 霜噬：处于寒冷 / 冻结的敌人受到的伤害 +X%
      if (Number(b.coldAmp) > 0) {
        battle.on('hit', (c) => {
          const t = c && c.target;
          if (!t || t.side !== 'enemy' || !c.dmg) return;
          const f = t.s && t.s.flags;
          if (!f || (!f.cold && !f.freeze)) return;
          c.dmg.mul = (Number(c.dmg.mul) || 1) * (1 + Number(b.coldAmp));
        }, { priority: 45, owner: 'echo:rules' });
      }
      // 惊惧：窗口内被己方击中的敌人恐惧 duration 秒
      if (b.fearOnHit && Number(b.fearOnHit.secs) > 0) {
        const win = Number(b.fearOnHit.secs);
        const dur = Math.max(0.5, Number(b.fearOnHit.duration) || 3);
        battle.on('damaged', (c) => {
          if ((Number(battle.time) || 0) >= win) return;
          if (!c || !c.source || c.source.side !== 'ally') return;
          const t = c.target;
          if (!t || t.side !== 'enemy' || t.alive === false) return;
          if (t.s && t.s.flags && t.s.flags.fear) return;
          if (typeof battle.applyStatus === 'function') battle.applyStatus(t, 'fear', { duration: dur, source: c.source });
        }, { priority: 38, owner: 'echo:rules' });
      }
      // 震荡：窗口内每 interval 秒对全场敌人造成「己方最高攻击 × atkScale」的真实伤害
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
        }, { owner: 'echo:rules' });
      }
      // 鲸吞：开战吞掉第一只出场的非领袖敌人（直接击杀，记真实伤害）
      if (b.devour === true && typeof battle.dealDamage === 'function') {
        let done = false;
        battle.on('enemySpawn', ({ enemy }) => {
          if (done || !enemy || enemy.alive === false) return;
          if (enemy.tag === 'boss' || (enemy.def && enemy.def.rank === 'BOSS')) return;
          done = true;
          const hp = Number(enemy.hp ?? (enemy.s && enemy.s.hp) ?? (enemy.s && enemy.s.maxHp)) || 0;
          battle.dealDamage(null, enemy, {
            amount: Math.max(hp, 1), type: 'true', canDodge: false, tags: ['echo:devour'],
          });
        }, { priority: 37, owner: 'echo:rules' });
      }
      groups++;
    }
  }

  // 干员减益诅咒：部署时按站位过滤给己方干员挂负面 mods（敌人、召唤物、装置都不吃）。
  const unitCurses = Array.isArray(rules.unitCurses) ? rules.unitCurses : [];
  if (unitCurses.length && typeof battle.addBuff === 'function') {
    const matches = (filter, unit) => {
      if (!unit || !filter || typeof filter !== 'object') return false;
      if (filter.position) {
        const pos = (unit.def && unit.def.position) || unit.position || null;
        if (pos !== filter.position) return false;
      }
      return true;
    };
    battle.on('deploy', ({ unit }) => {
      if (!unit || unit.side !== 'ally') return;
      for (let ci = 0; ci < unitCurses.length; ci++) {
        const c = unitCurses[ci];
        if (!matches(c.filter, unit)) continue;
        // 同一条诅咒叠了 N 层就要挂 N 个 buff，所以 key 带序号
        const key = `echo:curse:${c.id}:${ci}`;
        if ((unit.buffs || []).some((x) => x && x.key === key)) continue;
        battle.addBuff(unit, { key, name: c.name, desc: '', mods: { ...c.mods }, persist: true, visible: true });
      }
    }, { priority: 59, owner: 'echo:rules' });
    groups++;
  }

  // 「腐蚀 / 溃烂」：全场己方单位每秒按最大生命比例掉血（诅咒 DOT）。
  if (Number(rules.curseDot) > 0) {
    const dot = Number(rules.curseDot);
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
    }, { priority: 30, owner: 'echo:rules' });
    groups++;
  }

  // 朔风（谢拉格寒风）：每 interval 秒让全场敌人寒冷 duration 秒 —— 直接用原版盟约的实现。
  if (rules.coldWind && Number(rules.coldWind.interval) > 0) {
    try {
      startColdWind(battle, {
        playerId: null,
        interval: Number(rules.coldWind.interval),
        duration: Number(rules.coldWind.duration) || 3,
      });
      groups++;
    } catch { /* 数值异常时当作没有这条祝福 */ }
  }

  // 炎佑之契：开战召唤 count 只炎佑，攻/血按「己方场上干员总和的 30%」，lifetime 秒后消失。
  if (rules.yanyou && typeof battle.spawnToken === 'function') {
    const stacks = Math.max(1, Math.min(2, Math.floor(Number(rules.yanyou.stacks) || 1)));
    const lifetime = Math.max(0, Number(rules.yanyou.lifetime) || 0);
    battle.on('battleStart', () => {
      const pid = battle.players && battle.players[0] ? battle.players[0].playerId : null;
      if (pid == null) return;
      let atk = 0;
      let hp = 0;
      for (const u of battle.units || []) {
        if (u.side !== 'ally' || u.ownerId !== pid) continue;
        if (u.kind !== 'op' && u.kind !== 'chess') continue;
        atk += Number(u.s && u.s.atk) || 0;
        hp += Number(u.s && u.s.maxHp) || 0;
      }
      if (!(hp > 0)) return;
      const out = spawnYanyou(battle, pid, { atk: atk * 0.3, hp: hp * 0.3, count: stacks });
      if (lifetime > 0 && out && out.length) {
        battle.after(lifetime, () => { for (const y of out) if (y && y.alive) battle.kill(y, null); });
      }
    }, { once: true, owner: 'echo:rules' });
    groups++;
  }

  // 照破：每 interval 秒让隐匿敌人现形 duration 秒（出场时也给一次，和 Match 层原实现一致）。
  if (rules.revealPulse && Number(rules.revealPulse.interval) > 0 && typeof battle.addBuff === 'function') {
    const dur = Math.max(0.5, Number(rules.revealPulse.duration) || 3);
    const reveal = (e) => {
      if (!e || e.alive === false) return;
      if (e.hidden && typeof battle._setHidden === 'function') battle._setHidden(e, false);
      battle.addBuff(e, { key: 'echo:reveal', name: '照破', duration: dur, flags: { reveal: true } });
    };
    battle.on('enemySpawn', ({ enemy }) => reveal(enemy), { priority: 58, owner: 'echo:rules' });
    if (typeof battle.every === 'function') {
      battle.every(Math.max(1, Number(rules.revealPulse.interval)), () => {
        for (const e of battle.enemies || []) reveal(e);
      }, { owner: 'echo:rules' });
    }
    groups++;
  }

  battle.__echoRulesInstalled = groups > 0;
  return groups;
}
