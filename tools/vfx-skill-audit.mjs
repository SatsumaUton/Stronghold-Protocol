// tools/vfx-skill-audit.mjs —— 技能特效完整性审计（可进 CI 的自动任务）。
//
// 判据：index 里每个技能的每一条 use，它的 key（含 slots 里的方向变体）都要么
//   ① 出现在 plan 的某个桶（start/range/loop/end/ready/targets/trigger/cond/pulse/modeCast/each/attacks），
//   ② 要么作为同一条 entry 的 `slots` 变体存在（带朝向的条目只取第一个 key 建 entry，其余按朝向在播放时选），
//   ③ 要么明确记在 plan.unmapped（带原因）。
// 三者都不满足才算「静默丢弃」——那才是客户端永远不播的条目。
//
//   node tools/vfx-skill-audit.mjs            # 报告（有问题时退出码 1）
//   node tools/vfx-skill-audit.mjs --verbose  # 逐条列出
// 依赖本机已抽取的特效索引（public/assets/local/fx/index.json 与 data/local-fx.json）。
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');
const IDX_PATH = join(SP, 'shared/assets/local/fx/index.json');
const GD_DIR = join(ROOT, 'data/versions/act3autochess-v3_1');
const VERBOSE = process.argv.includes('--verbose');

if (!existsSync(IDX_PATH)) {
  console.log('（没有本地特效索引，跳过审计）');
  process.exit(0);
}

const IDX = JSON.parse(readFileSync(IDX_PATH, 'utf8'));
const GD = JSON.parse(readFileSync(join(GD_DIR, 'chess.json'), 'utf8'));
const EF = JSON.parse(readFileSync(join(GD_DIR, 'enemies.json'), 'utf8'));
const { planFor, skillPlan, enemySkillsOf } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/skills.js')).href);

/**
 * 已核实的豁免（不是缺陷）。每条都要写清「为什么官方/我们的语义里它本就不播或不必播」——
 * 没有理由的豁免就是掩盖问题，所以这份清单要随审计一起评审。
 */
const EXEMPT = new Map([
  // 空动画能力（EmptyAnimatedAbility）：官方把 effect 挂在空能力上，由场景/形态自己驱动，不是技能播的
  ['enemy_9014_acstma/2:enemy_acstma_back_end', 'ability=EmptyAnimatedAbility（空能力，非技能行）'],
  ['enemy_9015_acstmb/2:enemy_acstmb_back_end', 'ability=EmptyAnimatedAbility（空能力，非技能行）'],
  // RangedAttackWithExtraActions 的两个 start 变体：我们只播其中一个（另一个按额外动作条件触发）
  ['enemy_1517_xi/crossattack:enemy_xi_skill_01_start_02', '与 enemy_xi_skill_01_start 同为该能力的 start 变体，按额外动作条件二选一'],
]);

const exemptKey = (p, k) => `${p.unitId}/${p.skillId}:${k}`;

const BUCKETS = ['start', 'range', 'loop', 'end', 'ready', 'targets', 'trigger', 'cond', 'pulse', 'modeCast'];

/** plan 里出现的 key，以及每个 entry 的 slots 变体。 */
function planKeys(p) {
  const keys = new Set();
  const slots = new Set();
  const add = (e) => {
    if (!e) return;
    if (e.key) keys.add(e.key);
    for (const s of e.slots || []) if (s) slots.add(s);
  };
  for (const b of BUCKETS) for (const e of p[b] || []) add(e);
  for (const e of p.each?.cast || []) add(e);
  for (const g of p.each?.hit || []) for (const e of g || []) add(e);
  for (const a of p.attacks || []) {
    for (const list of [a.cast, a.range, a.aim]) for (const e of list || []) add(e);
    for (const g of a.hit || []) for (const e of g || []) add(e);
  }
  return { keys, slots };
}

/** 一条 use 里「必须被放置」的 key：有 slots 的只要求第一个。 */
function requiredKeys(u) {
  const directional = Array.isArray(u.slots) && u.slots.some(Boolean);
  const list = directional ? u.keys.slice(0, 1) : u.keys;
  return list.map((k) => (typeof k === 'string' ? k.toLowerCase() : null)).filter(Boolean);
}

function auditSkill(label, unitId, skillId, plan) {
  const skill = IDX.units[unitId]?.skills?.[skillId] ?? IDX.skills?.[skillId];
  if (!skill || !plan) return [];
  const { keys, slots } = planKeys(plan);
  const unmapped = new Set((plan.unmapped || []).map((u) => u.key));
  const lost = [];
  for (const u of [...(skill.uses || []), ...(skill.unclassified || [])]) {
    if (!u || !Array.isArray(u.keys)) continue;
    for (const k of requiredKeys(u)) {
      if (keys.has(k) || slots.has(k) || unmapped.has(k)) continue;
      lost.push({ key: k, role: u.role, from: u.from, ability: u.ability });
    }
  }
  return lost.length ? [{ label, unitId, skillId, lost }] : [];
}

const problems = [];
let ops = 0, enemies = 0;

for (const cid of [...new Set(Object.values(GD).map((c) => c && c.charId).filter(Boolean))]) {
  if (!IDX.units[cid]) continue;
  const rec = Object.values(GD).find((c) => c && c.charId === cid) || {};
  for (let si = 0; si < 3; si++) {
    const r = planFor(IDX, { info: { id: 'x', charId: cid, skillIndex: si }, rec, unitKey: cid });
    if (!r.plan) continue;
    ops++;
    problems.push(...auditSkill('干员', cid, r.skillId, r.plan));
  }
}

for (const eid of Object.keys(EF)) {
  if (!IDX.units[eid]) continue;
  for (const { prefabKey } of enemySkillsOf(IDX, eid, EF[eid])) {
    const plan = skillPlan(IDX, eid, prefabKey);
    enemies++;
    problems.push(...auditSkill('敌人', eid, prefabKey, plan));
  }
}

console.log(`干员技能 ${ops} 个、敌人技能 ${enemies} 个`);
// 去掉已核实的豁免，剩下的才是真问题
const real = problems
  .map((p) => ({ ...p, lost: p.lost.filter((l) => !EXEMPT.has(exemptKey(p, l.key))) }))
  .filter((p) => p.lost.length);
if (!real.length) {
  console.log('✓ 每条 use 的 key 都落在 plan 的桶里、作为方向槽位存在，或已记入 unmapped');
  if (problems.length) console.log(`  （另有 ${problems.length} 个技能 / ${EXEMPT.size} 条已核实的豁免，见 EXEMPT）`);
  process.exit(0);
}
console.log(`✗ 有 ${real.length} 个技能存在「静默丢弃」的条目：`);
for (const p of real) {
  console.log(`  ${p.label} ${p.unitId} / ${p.skillId}`);
  for (const l of p.lost) {
    if (VERBOSE) console.log(`     ${l.key}  role=${l.role} ability=${l.ability ?? '-'} from=${l.from}`);
  }
}
process.exit(1);
