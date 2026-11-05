// 深渊回响的「独立性」守卫（维护者 2026-11-06：原版更新不许让深潜失效）。
//
// 上游更新走 restore → 升级 → apply / merge-features.py：官方文件整文件覆盖，只有
// patcher/features/<id>/files 的快照能救回来。所以「深潜会不会被原版更新搞坏」这件事，
// 完全等于「带深潜逻辑的文件有没有最新快照、有没有在 features.json + index.json 登记」。
//
// 这里跑 patcher/check-deepecho.mjs，把它变成 npm test 的一部分：
//   · 任何一个提到深潜的运行文件没有快照 / 快照过期 → 红
//   · features.json 或 index.json 缺登记 → 红（index.json 是 merge-features.py 的唯一输入）
//   · 深潜测试文件缺失 → 红
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('深渊回响自包含：快照、features.json、index.json 全部就位', () => {
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'patcher/check-deepecho.mjs')], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    assert.fail(`check-deepecho 失败（上游一升级深潜就会丢东西）：\n${e.stdout || ''}${e.stderr || ''}`);
  }
  assert.match(out, /深渊回响相关运行文件: \d+/, '要报告扫到多少个文件');
  assert.match(out, /快照缺失: 0\s+快照过期\(内容不同\): 0/, '快照必须齐全且与仓库一致');
  assert.match(out, /features\.json 未登记: 0/, 'features.json 必须登记');
  assert.match(out, /index\.json 未登记: 0/, 'index.json（merge-features.py 的输入）必须登记');
  assert.match(out, /✓ 深渊回响自包含/, '要给出通过结论');
});

test('登记表里确实有 deepecho，且文件数对得上快照', () => {
  const fj = JSON.parse(read('patcher/features.json'));
  const feats = Array.isArray(fj) ? fj : fj.features;
  const entry = feats.find((f) => f.id === 'deepecho');
  assert.ok(entry, 'features.json 要有 deepecho');
  assert.equal(entry.status, 'ported');
  assert.ok(entry.files.length >= 90, `登记的文件数偏少：${entry.files.length}`);
  assert.ok(entry.tests.length >= 10, '要列出深潜的验收项');
  // 每个登记的文件都要有快照（guard 已逐字节比过，这里只查存在性）
  const missing = entry.files.filter((rel) => !existsSync(path.join(ROOT, 'patcher/features/deepecho/files', rel)));
  assert.deepEqual(missing, [], `这些文件没有快照：${missing.join(', ')}`);

  const idx = JSON.parse(read('patcher/features/index.json'));
  const ie = idx.find((f) => f.id === 'deepecho');
  assert.ok(ie, 'index.json 要有 deepecho（merge-features.py 只读这份）');
  assert.equal(ie.files.length, entry.files.length, 'index.json 与 features.json 的文件数要一致');
  const paths = new Set(ie.files.map((f) => (typeof f === 'string' ? f : f.path)));
  for (const rel of entry.files) assert.ok(paths.has(rel), `index.json 缺 ${rel}`);
});

test('深潜的核心文件都在补丁里（抽查几个最容易在升级时丢的）', () => {
  const must = [
    'server/match/match/echoPhase.js',
    'server/match/match/echoBlessing.js',
    'server/match/match/echoCurse.js',
    'server/match/Match.js',
    'server/persist/lobbyState.js',
    'server/match/snapshot.js',
    'shared/protocol.js',
    'public/js/ui/echoStatus.js',
    'public/js/screens/echoLobby.js',
    'matchmaker/openRooms.cjs',
  ];
  for (const rel of must) {
    assert.ok(existsSync(path.join(ROOT, 'patcher/features/deepecho/files', rel)), `${rel} 没有快照`);
  }
});
