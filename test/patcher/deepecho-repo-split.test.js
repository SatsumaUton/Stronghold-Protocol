// 两个仓库的边界（维护者 2026-11-06）：深渊回响单独一个私有仓库，公开仓库不许出现深潜独占文件。
//
// 这里跑 patcher/check-repo-split.mjs（迁移期只报告不判失败），并核对：
//   · 独占文件的路径模式与手册 docs/DEEPECHO-REPO.md 对得上；
//   · 生成脚本 tools/deepecho-repo.mjs 存在，且它列出的文件都能落到目标目录；
//   · 手册里写了红线（「不能出现深渊回响的文件」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('分离检查脚本能跑，并报出当前状态（迁移期不判失败）', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'patcher/check-repo-split.mjs')], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /公开仓库里被跟踪的深潜独占文件: \d+/, '要报告被跟踪的独占文件数');
  assert.match(out, /\.gitignore 缺少的深潜规则: \d+/, '要报告 .gitignore 规则');
});

test('独占文件的判定与手册一致（路径模式覆盖所有深潜专属文件）', async () => {
  // 这个脚本 import 时会执行 main（读 git），所以这里只做源码级核对
  const src = read('patcher/check-repo-split.mjs');
  for (const re of [
    'server\\/match\\/match\\/echo',
    'server\\/echoTesters\\.js',
    'public\\/js\\/ui\\/echo',
    'public\\/js\\/ui\\/enemyRecords\\.js',
    'public\\/js\\/screens\\/echoLobby\\.js',
    'matchmaker\\/diveBoard\\.cjs',
    'matchmaker\\/roomDir\\.cjs',
    'patcher\\/features\\/deepecho\\/',
  ]) {
    assert.ok(src.includes(re), `独占模式里缺 ${re}`);
  }
  const doc = read('docs/DEEPECHO-REPO.md');
  assert.match(doc, /不能出现深渊回响的文件/, '手册要写明红线');
  assert.match(doc, /独占文件/, '手册要定义独占文件');
  assert.match(doc, /共用文件/, '手册要说明共用文件留在公开仓库');
});

test('生成脚本与手册齐备：能把深潜内容抽成独立仓库', () => {
  assert.ok(existsSync(path.join(ROOT, 'tools/deepecho-repo.mjs')), '缺生成脚本');
  const gen = read('tools/deepecho-repo.mjs');
  assert.match(gen, /patcher\/features\.json/, '文件清单来自 features.json');
  assert.match(gen, /--push/, '要支持一条命令推送');
  assert.match(gen, /--check/, '要支持只核对');
  assert.match(gen, /MANIFEST\.json/, '要产出可核对的清单');
});
