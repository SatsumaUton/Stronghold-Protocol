// tools/deepecho-repo.mjs — 把「深渊回响」的全部内容抽成**独立仓库**（与公开仓库彻底分开）。
//
// 维护者 2026-11-06：深渊回响要有一个独立仓库，所有深潜内容只更新到那个仓库；
// 公开仓库只放其余内容，且**绝不能**出现深渊回响的文件。
//
// 做法：以 `patcher/features.json` 里 deepecho 这一项为准（文件清单由 patcher/check-deepecho.mjs
// 维护，96 个运行文件），把「运行文件 + 测试 + 补丁快照 + 手册 + README + MANIFEST」复制成一份
// **可独立检出、可直接覆盖回生产**的树：
//
//   <目标目录>/
//     README.md                 这份仓库是什么、怎么用
//     MANIFEST.json             文件清单 + SHA256 + 来源提交（可核对）
//     docs/DEEPECHO-REPO.md     分离手册（和公开仓库同一份）
//     server/ public/ shared/ matchmaker/ dashboard/ data/ content/ mm/   运行文件（原路径）
//     test/...                  深潜的测试
//     patcher/features/deepecho/**  补丁快照
//
//   node tools/deepecho-repo.mjs                 # 生成/更新到默认目录（<部署根>/deepecho-repo）
//   node tools/deepecho-repo.mjs --out D:\x\dw   # 指定目录
//   node tools/deepecho-repo.mjs --push          # 生成后 git add/commit/push（需要远端已配好）
//   node tools/deepecho-repo.mjs --check         # 只核对：目标是否与当前仓库一致
//
// 这个脚本**只写目标目录**，从不碰公开仓库；反过来，公开仓库那边由
// patcher/check-repo-split.mjs 保证「深潜独占文件没有被公开仓库跟踪」。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.resolve(
  argValue('--out')
  || process.env.SP_DEEPECHO_REPO
  || path.join(path.basename(ROOT) === 'repo-sync' ? path.dirname(ROOT) : ROOT, 'deepecho-repo'),
);
const PUSH = process.argv.includes('--push');
const CHECK = process.argv.includes('--check');
const MESSAGE = argValue('--message') || 'sync: 深渊回响内容更新';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** 深潜的验收测试：命名带 echo 的 + 两条专项（叠层上限、独立性守卫）。 */
function testFiles() {
  const out = new Set();
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.test\.js$/.test(p)) continue;
      if (/echo/i.test(e.name) || p === 'test/patcher/deepecho-isolation.test.js' || p === 'test/content/whitw2-stack.test.js') out.add(p);
    }
  };
  walk('test');
  return [...out].sort();
}

const featuresJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'patcher/features.json'), 'utf8'));
const list = Array.isArray(featuresJson) ? featuresJson : featuresJson.features || [];
const entry = list.find((f) => f && f.id === 'deepecho');
if (!entry) {
  console.error('✗ patcher/features.json 里没有 deepecho 项：先跑 node patcher/check-deepecho.mjs --fix');
  process.exit(1);
}

/** 要搬走的全部文件：运行文件（原路径）+ 测试 + 补丁快照。 */
const runtime = entry.files;
const tests = testFiles();
const snapshot = [];
const snapDir = path.join(ROOT, 'patcher/features/deepecho');
const walkSnap = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walkSnap(p); continue; }
    snapshot.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
};
walkSnap(snapDir);

const docs = ['docs/DEEPECHO-REPO.md'].filter((p) => fs.existsSync(path.join(ROOT, p)));
const files = [...new Set([...runtime, ...tests, ...snapshot, ...docs])].sort();

// ---- 生成 ----
const manifest = { name: 'stronghold-protocol-deepecho', generatedAt: new Date().toISOString(), sourceCommit: null, files: [] };
try { manifest.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* 非 git 环境 */ }

let written = 0;
let same = 0;
for (const rel of files) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.warn('  ! 源文件不存在，跳过：' + rel); continue; }
  const buf = fs.readFileSync(src);
  manifest.files.push({ path: rel, sha256: sha(buf), bytes: buf.length });
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst) && sha(fs.readFileSync(dst)) === sha(buf)) { same++; continue; }
  if (CHECK) { console.log('  与目标不一致：' + rel); continue; }
  fs.writeFileSync(dst, buf);
  written++;
}

if (!CHECK) {
  // README / 手册 / MANIFEST
  const readme = [
    '# Stronghold Protocol · 深渊回响（独立仓库）',
    '',
    '这个仓库**只**放「深渊回响」（无尽深潜）这一模式的内容，和公开仓库 `Stronghold-Protocol` 完全分开。',
    '',
    '## 里面是什么',
    '',
    '| 目录 | 内容 |',
    '|---|---|',
    '| `server/` `public/` `shared/` `matchmaker/` `dashboard/` `data/` `content/` `mm/` | 深潜用到的运行文件（保持原路径，可直接覆盖回生产） |',
    '| `test/` | 深潜的验收测试（' + tests.length + ' 个文件） |',
    '| `patcher/features/deepecho/` | 补丁快照（上游升级时用来恢复） |',
    '| `docs/DEEPECHO-REPO.md` | **分离手册**：两个仓库的边界、同步方式、红线 |',
    '| `MANIFEST.json` | 文件清单 + SHA256 + 来源提交，可逐文件核对 |',
    '',
    '## 怎么用',
    '',
    '```bash',
    '# 1) 从主仓库同步到这里（只读主仓库，只写本目录）',
    'node tools/deepecho-repo.mjs --out <本仓库路径>',
    '',
    '# 2) 提交并推送',
    'git add -A && git commit -m "sync: …" && git push',
    '```',
    '',
    '生成脚本在主仓库的 `tools/deepecho-repo.mjs`；本仓库的文件清单以主仓库',
    '`patcher/features.json` 的 `deepecho` 项为准（由 `patcher/check-deepecho.mjs` 维护）。',
    '',
    '## 红线',
    '',
    '- 这个仓库**必须私有**（深潜还没公开）。',
    '- 任何深潜文件都**不许**再出现在公开仓库里；公开仓库那边由 `patcher/check-repo-split.mjs` 把关。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), readme);
  fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  // 让 MANIFEST 里的 sha 与实际一致（它自己也列进去？不：保持只列内容文件）
  const gitignore = [
    '# 只提交内容，不提交任何本地产物',
    'node_modules/',
    'logs/',
    '.cache/',
    '*.bak',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, '.gitignore'), gitignore);
}

console.log(`目标目录：${OUT}`);
console.log(`文件总数：${files.length}（运行 ${runtime.length} · 测试 ${tests.length} · 补丁快照 ${snapshot.length} · 文档 ${docs.length}）`);
if (CHECK) {
  console.log(`与目标一致：${same}    需要更新：${files.length - same}`);
  process.exit(same === files.length ? 0 : 1);
}
console.log(`已写入：${written}    未变：${same}`);

// ---- 可选：提交并推送 ----
if (PUSH) {
  const run = (args) => execFileSync('git', args, { cwd: OUT, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    if (!fs.existsSync(path.join(OUT, '.git'))) {
      run(['init', '-b', 'main']);
      console.log('已初始化 git 仓库（main）');
    }
    run(['add', '-A']);
    let dirty = '';
    try { dirty = run(['status', '--porcelain']); } catch { /* ignore */ }
    if (!dirty) { console.log('没有改动，跳过提交'); process.exit(0); }
    run(['-c', 'user.name=SP Deepecho', '-c', 'user.email=deepecho@local', 'commit', '-m', MESSAGE]);
    console.log('已提交：' + MESSAGE);
    run(['push', '-u', 'origin', 'main']);
    console.log('已推送');
  } catch (e) {
    console.error('git 操作失败：' + String(e.stderr || e.message).trim().split('\n').slice(-3).join(' | '));
    console.error('（先 git remote add origin <新仓库地址>，再重跑 --push）');
    process.exit(1);
  }
}
