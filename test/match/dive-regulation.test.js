// 「规程·序列Ⅰ」支持深渊回响（维护者 2026-11-20）。
//
// 玩法侧的真实校验：用 act3 的数据 + variant 'deepecho' 起一局，跑到第一轮战斗结束，
// 确认（a）能开局、不报错；（b）抽到的战场是深潜池里的图（本版 10 张，或跨版本补齐的 act1/act2 图）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { echoStageLib } from '../../server/match/match/echoCrossVersion.js';
import { makeMatch } from './harness.js';

const REG = 'act3autochess@V3_1';
const data = getVersionData(REG);

test('规程·序列Ⅰ + 深渊回响：能开局，且战场来自深潜池', (t) => {
  const h = makeMatch({ data, mode: 'coop', difficulty: 'NORMAL', variant: 'deepecho', humans: 2, registry: createRegistry(), seed: 7 });
  t.after(() => h.m.dispose());

  const m = h.m;
  assert.equal(m.echoVariant, 'deepecho', '对局带深潜标记');
  assert.ok((m.gd.mode.stages || []).some((id) => String(id).startsWith('act3autochess_')), '用的是规程数据');
  assert.ok(m.gd, '规程数据载入');
  assert.ok(m.stage || m.mode?.stages, '抽到了战场');

  const lib = echoStageLib();
  const pool = new Set(lib.pools.mode_multi_normal || []);
  const stageId = m.stage?.id || m.stageId;
  if (stageId) {
    assert.ok(pool.has(stageId), `战场 ${stageId} 应该在深潜池里`);
  }

  // 跑到第一轮结束不崩
  assert.ok(m.stageId == null || pool.has(m.stageId), '首轮战场（若已抽）在深潜池里');
  assert.equal(h.logs.error.length, 0, `没有报错：${h.logs.error.slice(0, 2).join(' | ')}`);
});

test('规程·序列Ⅰ + 深渊回响：跨版本补齐的战场记录也能加载', (t) => {
  const h = makeMatch({ data, mode: 'coop', difficulty: 'ABYSS', variant: 'deepecho', humans: 2, registry: createRegistry(), seed: 3 });
  t.after(() => h.m.dispose());
  const m = h.m;
  const lib = echoStageLib();
  const pool = new Set(lib.pools.mode_multi_abyss || []);
  const stageId = m.stage?.id || m.stageId;
  if (stageId) assert.ok(pool.has(stageId), `深渊难度战场 ${stageId} 应该在深潜池里`);
  assert.equal(h.logs.error.length, 0);
});
