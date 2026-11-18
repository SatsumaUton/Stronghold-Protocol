// test/render/vfx-skill-audit.test.js —— 把「技能特效完整性审计」接入 CI。
//
// 判据：index 里每个技能的每条 use，key 必须落在 plan 的某个桶、或作为方向槽位存在、
// 或明确记入 unmapped；三者都不满足才算「静默丢弃」。
// 已核实的豁免（EXEMPT，带原因）单独计，不算失败 —— 但审计工具会把它们列出来供评审。
//
// 这一步是「不再出现其他干员技能异常」的自动闸门：改动 skills.js 后跑它，
// 任何一个干员的技能条目变丢都会红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SP = process.env.SP_ROOT || join(ROOT, '..');
const INDEX = join(SP, 'shared/assets/local/fx/index.json');
const TOOL = join(ROOT, 'tools/vfx-skill-audit.mjs');

test('技能特效完整性审计：每条 use 都有落点（或已记入 unmapped）', { skip: !existsSync(INDEX) && '本机没有特效索引' }, () => {
  const out = execFileSync(process.execPath, [TOOL], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SP_ROOT: SP },
  });
  assert.match(out, /干员技能 \d+ 个、敌人技能 \d+ 个/, '审计要跑起来');
  assert.ok(out.includes('✓ 每条 use 的 key'), `审计必须全绿，实际输出：\n${out}`);
});

test('审计工具本身检查「干员」与「敌人」两条路径', { skip: !existsSync(INDEX) && '本机没有特效索引' }, () => {
  const out = execFileSync(process.execPath, [TOOL, '--verbose'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SP_ROOT: SP },
  });
  const m = /干员技能 (\d+) 个、敌人技能 (\d+) 个/.exec(out);
  assert.ok(m, '要报出两边的技能数');
  assert.ok(Number(m[1]) > 100, `干员技能数要 > 100，实际 ${m[1]}`);
  assert.ok(Number(m[2]) > 50, `敌人技能数要 > 50，实际 ${m[2]}`);
});
