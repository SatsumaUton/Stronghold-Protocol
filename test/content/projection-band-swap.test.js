// test/content/projection-band-swap.test.js —— 盟约投影的说明必须跟随「策略换效果」（维护者 2026-11-21）。
//
// 背景：规程的核心盟约可以用策略的 `auto_chess_effect_replace` 换效果。例如
//   · 「裁度」band_siracusa: bondeffect_siracusa_2 → bondeffect_siracusa（换回带隐匿的下半版）
//   · 「望」band_yan2: bondeffect_yan_2 → bondeffect_yan（换回召唤炎佑的下半版）
// 战斗与盟约条都认这个替换（commandBondOverrides / bondList 的 effectId），
// 但投影说明原先只按版本取 → 玩家卡上显示的是**没换之前**的文案。
//
// 本用例把「规程里每一个换效果的策略」都跑一遍：盟约条和投影说明都必须等于替换后的那条 effect 的文字。
// 数据驱动（从 bands.json 扫 auto_chess_effect_replace），所以规程以后新增策略也自动被覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { getVersionData } from '../../server/data.js';
import { commandBondOverrides } from '../../server/match/bandCommands.js';
import { bondList, computeBonds } from '../../server/match/bondsMeta.js';

const QUIET = { warn() {}, error() {}, info() {} };
const RAW = getVersionData('act3autochess@V3_1', { log: QUIET });
const REG = createRegistry({ log: QUIET });

/** 从规程数据里扫出「策略 → 它替换的核心盟约 effect」的全部组合。 */
function swapCases() {
  const bands = RAW.bands || {};
  const rows = Array.isArray(bands) ? bands : Object.values(bands);
  const effects = RAW.effects || {};
  const bonds = RAW.bonds || {};
  const bondRows = Array.isArray(bonds) ? bonds : Object.values(bonds);
  const byEffect = new Map(bondRows.map((b) => [b.effectId, b.bondId]));
  const out = [];
  for (const b of rows) {
    const maps = [];
    for (const x of b.buffs || []) if (x && x.key === 'auto_chess_effect_replace') maps.push(x.bbStr || x.bb || {});
    for (const s of b.skills || []) for (const x of s.buffs || []) if (x && x.key === 'auto_chess_effect_replace') maps.push(x.bbStr || x.bb || {});
    for (const m of maps) {
      for (const [from, to] of Object.entries(m)) {
        const bondId = byEffect.get(from);
        if (bondId && effects[to]) out.push({ bandId: b.bandId, band: b.name, bondId, from, to });
      }
    }
  }
  // 同一个策略在 band 与 skill 上各声明一次：按 bandId|bondId 去重
  const seen = new Set();
  return out.filter((c) => {
    const k = `${c.bandId}|${c.bondId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const CASES = swapCases();

test('规程里存在「换盟约效果」的策略（数据自检）', () => {
  assert.ok(CASES.length >= 7, `应至少 7 个策略换效果，实际 ${CASES.length}：${CASES.map((c) => c.bandId).join(',')}`);
});

for (const c of CASES) {
  test(`${c.band}（${c.bandId}）换 ${c.bondId}：盟约条与投影说明都跟随`, (t) => {
    const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 7, fake: true, variant: 'deepecho', registry: REG, data: RAW }).start();
    h.toPrep(1, { band: c.bandId });
    const m = h.m;
    const ps = h.ps('p_0');
    t.after(() => m.dispose());

    // ① 策略表确实把 from 映射到 to
    const ov = commandBondOverrides(ps);
    assert.equal(ov[c.from], c.to, `${c.band} 的替换表`);

    // ② 盟约条带出替换后的 effectId
    const list = bondList(m.gd, computeBonds(m.gd, ps), { full: true, effectOverrides: ov });
    const entry = list.find((e) => e.bondId === c.bondId);
    if (entry) assert.equal(entry.effectId, c.to, `${c.band} 的盟约条 effectId`);

    // ③ 投影说明的文字 = 替换后那条 effect 的文字
    ps.echoProjection = c.bondId;
    ps.recompute();
    const info = m._echoProjectionInfo(c.bondId, ps);
    assert.ok(info, '投影解析得到条目');
    assert.equal(info.effectId, c.to, '投影条目的 effectId 跟随替换');
    const want = String(RAW.effects[c.to].desc || '');
    assert.equal(String(info.desc || ''), want, '投影说明就是替换后那条效果的原文');

    // ④ 不传 ps 时保持原口径（等于该版本自己的正文）—— 防止把默认行为改坏
    const plain = m._echoProjectionInfo(c.bondId);
    assert.ok(plain && plain.desc, '不传 ps 仍然给出版本正文');
    assert.ok(!plain.effectId || plain.effectId === m.gd.bond(c.bondId)?.effectId, '不传 ps 不做替换');
  });
}
