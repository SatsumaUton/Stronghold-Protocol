// test/render/vfx-extra-buffs.test.js —— `_extraBuffs` 挂到被选目标（遥 S2 的友军）的回归闸门。
//
// 玩家反馈（2026-11-18）：遥的 S2 在**友方干员身上**没有出现技能特效。
//
// 四层缺口（本条测试盯住 ②③④，① 在提取器里）：
//   ① fx.py buff_target：`_extraBuffs` 被判成 owner（`_selector` 空指针）→ 已改判 targets
//   ② targetsOf 的 ACTIVE_BUFFS 只认 `_activeBuffs` → `_extraBuffs` 落到 none（没人播）
//   ③ targetsOf 的 isAttack(能力类名)：ActiveOneOfBuffAbility 不含 Attack/Heal → 仍落到 none
//   ④ SkillFx.seen：遥 S2 是 lasting + 治疗型、plan.attacks=0，_kitHit 要一条 attack 做节点匹配 → 整段不跑；
//      且 windows 为空会提前 return；且后续路径要求 e.node == null（遥的条目 node 是 skchr_haruka_2）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');

const { planKeys, targetsOf, planFor } = await import(pathToFileURL(join(ROOT, 'public/js/render/vfx/skills.js')).href);

test('targetsOf：_extraBuffs 进 hit（不看能力类名）', () => {
  const plan = {
    targets: [
      { key: 't_a', from: 'ActiveOneOfBuffAbility._extraBuffs' },
      { key: 't_b', from: 'ActiveOneOfBuffAbility._extraBuffs → template x' },
      { key: 't_c', from: 'ActiveOneOfBuffAbility._activeBuffs' },     // 类名不含 Attack → 仍为 none
      { key: 't_d', from: 'MeleeAttack._activeBuffs' },                // Attack → hit
    ],
  };
  const out = targetsOf({}, plan);
  assert.deepEqual(out.hit.map((e) => e.key), ['t_a', 't_b', 't_d'], '_extraBuffs 与 Attack 类都要进 hit');
  assert.deepEqual(out.none.map((e) => e.key), ['t_c'], '非 Attack 类的 _activeBuffs 仍是 none');
});

test('静读：SkillFx.seen 的「无 attack 的治疗技能」路径在 windows 提前返回之前', () => {
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/skillfx.js'), 'utf8');
  const fn = src.slice(src.indexOf('seen(v, heal, claimed)'), src.indexOf('/** The attack of an instant activation'));
  const guard = fn.indexOf('if (!this.windows.length)');
  assert.ok(guard > 0, '要有 windows 为空的提前返回');
  const healPath = fn.indexOf('U.plan.attacks.length');
  assert.ok(healPath > 0, '要有「无 attack 的治疗技能」路径');
  assert.ok(healPath < guard, '★ 该路径必须在 windows 提前返回之前（遥 S2 不开窗口）');
  assert.doesNotMatch(
    fn.slice(healPath, guard),
    /e\.node == null/,
    '★ 不能按 node 过滤（遥的条目 node 是 skchr_haruka_2，没有 attack 可匹配）',
  );
});

test('遥 S2：targets 里出现 on=targets 的 buff（需要本机 fx index）', { skip: existsSync(join(SP, 'shared/assets/local/fx/index.json')) ? false : '本机没有特效索引' }, () => {
  const IDX = JSON.parse(readFileSync(join(SP, 'shared/assets/local/fx/index.json'), 'utf8'));
  const GD = JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/chess.json'), 'utf8'));
  const unit = IDX.units['char_4202_haruka'];
  assert.ok(unit, '遥要在特效索引里');
  const sk = unit.skills['skchr_haruka_2'];
  assert.ok(sk, 'S2 要在');
  const uses = sk.uses || [];
  assert.ok(uses.some((u) => u.on === 'targets' && (u.keys || []).includes('haruka_skill_02_buff')),
    '★ _extraBuffs 的那条必须是 on=targets（否则友军身上不播）');

  const rec = Object.values(GD).find((c) => c && c.charId === 'char_4202_haruka') || {};
  const r = planFor(IDX, { info: { id: 'x', charId: 'char_4202_haruka', skillIndex: 1 }, rec, unitKey: 'char_4202_haruka' });
  const t = targetsOf(IDX, r.plan);
  assert.ok(t.hit.some((e) => e.key === 'haruka_skill_02_buff'), '★ targetsOf 必须把它归到 hit（否则 SkillFx 不播）');
});

test('planKeys 带上投射物事件特效（银灰 S3 的地面范围）', { skip: existsSync(join(SP, 'shared/assets/local/fx/index.json')) ? false : '本机没有特效索引' }, () => {
  const IDX = JSON.parse(readFileSync(join(SP, 'shared/assets/local/fx/index.json'), 'utf8'));
  const GD = JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/chess.json'), 'utf8'));
  const rec = Object.values(GD).find((c) => c && c.charId === 'char_1045_svash2') || {};
  const r = planFor(IDX, { info: { id: 'x', charId: 'char_1045_svash2', skillIndex: 2 }, rec, unitKey: 'char_1045_svash2' });
  const keys = planKeys(r.plan, IDX.projectiles);
  // 2026-11-18：这个特效按官方语义是「施法者脚下、朝向目标方向」的范围框
  // （Svash2ProjectileEffectBehaviour._effectsAlignToTargetDirection），
  // 已从 projectile.onReached 挪到 skill 的 role=range，所以它在 plan.range 里。
  assert.ok(keys.includes('svash2_skill_03_range_01'), '★ 银灰 S3 的范围框必须进 planKeys（预加载）');
  // 传 projs 时不一定更长：这个特效现在走 plan.range（owner），不再挂在投射物上。
  assert.ok(keys.length > 0, 'planKeys 非空');
});
