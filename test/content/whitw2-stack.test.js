// 荒芜拉普兰德（char_1038_whitw2）浮游单元「叠层」的上限，以及深渊回响是否解除它。
//
// 背景（维护者 2026-11-06，玩家反馈）：「深度 50 层左右，精二的荒芜拉普兰德不能叠层了」。
//
// 查下来**不是 bug，是数据上限**：
//   · 驭械术师特性的浮游单元对**同一个敌人**连续攻击时伤害逐层提升，
//     init_atk_scale + delta_atk_scale × n，封顶 max_atk_scale。
//   · 精二（chess_char_6_18_b）的 data 是 0.35 + 0.15×n → 1.1，也就是 **5 层**就封顶
//     （普通档 0.2 + 0.15×n → 1.1 = 6 层）。
//   · 深潜**只解除盟约层数**上限（Match.layerCapOff → 1e9），干员自身的叠层上限一个都没动。
//
// 所以深层（敌人血量厚、浮游单元能一直锁着同一个目标）反而更容易打满上限：6 次攻击后就恒定在
// 1.1× 攻击力，玩家看到的就是「不叠了」。这里把这个行为钉住 —— 以后要改（比如深潜里放宽），
// 改的就是这条测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ds = getDefaultSource();
const rec = (id, sid) => ds.rawChess(id).skills.find((s) => s.skillId === sid);

const ELITE = 'chess_char_6_18_b';
const S3 = 'skchr_whitw2_3';

/** 精二荒芜拉普兰德 S3，站在 (10,4)，对面一只不动、超厚血的敌人。 */
function dive() {
  const h = makeBattle({
    seed: 7, autoFinish: false, timeLimit: 400, captureNoisy: true,
    defs: { enemies: { big: enemyRec({ key: 'big', hp: 1e9, speed: 0 }) } },
    units: [{ chessId: ELITE, row: 10, col: 4, skillIndex: rec(ELITE, S3).index, carryState: { sp: 999 } }],
    enemies: [{ key: 'big', pos: [10, 6] }],
  });
  const u = h.unit(ELITE);
  assert.ok(h.runUntil(() => u.skill.active, 20), 'S3 要开得起来');
  return { h, u };
}

const droneHits = (h, u) => h.hooksOf('damaged')
  .filter((c) => c.source === u && (c.dmg?.tags || []).includes('droneAttack'));

test('浮游单元叠层：0.35 → 1.1 共 5 层封顶，之后伤害恒定', () => {
  const { h, u } = dive();
  const f = u.profile.funnel;
  assert.deepEqual({ init: f.init, delta: f.delta, max: f.max }, { init: 0.35, delta: 0.15, max: 1.1 },
    '精二的数据就是 0.35 / 0.15 / 1.1');
  const stacks = Math.round((f.max - f.init) / f.delta);
  assert.equal(stacks, 5, '上限 = 5 层');

  // 打满之前伤害逐级上升，打满之后不再变化
  for (let i = 0; i < 10; i++) h.run(1);
  const amounts = droneHits(h, u).map((c) => Math.round(c.amount ?? 0));
  const distinct = [...new Set(amounts)];
  assert.equal(distinct.length, 6, `应当正好 6 档伤害（初始 + 5 层），实际 ${distinct.join(',')}`);
  const tail = amounts.slice(-6);
  assert.equal(new Set(tail).size, 1, `封顶后伤害必须恒定：${tail.join(',')}`);
  const ramp = u.mem.drones[0].ramp;
  assert.equal(ramp, f.max, '叠层值停在 max');
});

test('数据里所有驭械术师都是同一套上限（普通档 6 层、精二 5 层）', () => {
  const j = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
  const caps = new Map();
  for (const c of Object.values(j)) {
    const bb = c && typeof c === 'object' ? c.trait?.bb : null;
    if (!bb || bb.max_atk_scale === undefined) continue;
    const init = Number(bb.init_atk_scale ?? 0.2), delta = Number(bb.delta_atk_scale ?? 0.15), max = Number(bb.max_atk_scale ?? 1.1);
    if (!(delta > 0)) continue;
    caps.set(`${c.name}${c.isGolden ? '（精二）' : ''}`, { stacks: Math.round((max - init) / delta), data: bb.max_stack_cnt ?? null, max });
  }
  assert.ok(caps.size >= 6, `应当覆盖多张驭械术师：${[...caps.keys()].join('、')}`);
  for (const [name, v] of caps) {
    assert.ok(v.stacks >= 5 && v.stacks <= 8, `${name} 的叠层数应在 5–8：${v.stacks}`);
    assert.ok(v.max >= 1.1 && v.max <= 1.3, `${name} 的伤害上限应在 1.1–1.3× 攻击力（实际 ${v.max}）`);
  }
  // 精二荒芜拉普兰德 5 层，其余 6 层 —— 都是 data 说了算
  assert.equal(caps.get('荒芜拉普兰德（精二）').stacks, 5);
});

test('深渊回响只解除盟约层数上限，干员自身的叠层上限一个都没动', async () => {
  const { makeMatch } = await import('../match/harness.js');
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, seed: 7, fake: true, variant: 'deepecho' });
  try {
    assert.equal(h.m.layerCapOff, true, '深潜里盟约层数无上限（1e9）');
    // 盟约层数确实能突破 999
    const ps = h.m.alivePlayers()[0];
    for (let i = 0; i < 12; i++) ps.addLayers('siracusaShip', 100, { reason: 'probe' });
    assert.ok((ps.layers.siracusaShip || 0) > 999, '盟约层数能过 999');
  } finally { h.m.dispose(); }
  // 而干员叠层（浮游单元的 funnel 上限）在深潜代码里没有任何放宽
  const echoSrc = readFileSync(path.join(ROOT, 'server/match/match/echoPhase.js'), 'utf8')
    + readFileSync(path.join(ROOT, 'server/match/match/echoBlessing.js'), 'utf8')
    + readFileSync(path.join(ROOT, 'server/match/match/echoCurse.js'), 'utf8');
  assert.doesNotMatch(echoSrc, /profile\.funnel|max_atk_scale|max_stack_cnt/, '深潜不碰干员叠层上限');
});
