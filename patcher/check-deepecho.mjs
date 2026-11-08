// 深渊回响（deepecho）独立性守卫。
//
// 目标（维护者 2026-11-06）：**原版更新不许让深渊回响失效**。
//
// 上游发新版时的流程是 restore → 升级 → apply：官方文件会**整文件覆盖**掉我们改过的东西，
// 只有 `patcher/features/<id>/files/` 里那份快照能把它们救回来。所以对深渊回响来说，
// 唯一会「因为原版更新而失效」的情况就是：**某个带深潜逻辑的文件没有被快照、或者快照是旧的**。
//
// 这个脚本把这条不变量钉死：
//   1. 扫描仓库里所有**提到深潜**的运行文件（标记词见 MARK）—— 这是权威清单，不靠人记；
//   2. 每个文件都必须在 `patcher/features/deepecho/files/` 里有一份**逐字节相同**的快照；
//   3. `patcher/features.json` 里必须有 `deepecho` 这一项，并且把上面每个文件都列进 files；
//      **`patcher/features/index.json` 也要有** —— 升级时 merge-features.py 只读 index.json，
//      没有它这份功能在合并阶段就整个被忽略（比快照过期更致命）；
//   4. 深潜的测试文件必须存在（升级后按清单重跑）。
//
//   node patcher/check-deepecho.mjs          # 检查（有问题退出码 1）
//   node patcher/check-deepecho.mjs --list   # 同时打印完整清单
//   node patcher/check-deepecho.mjs --fix    # 把漂移/缺失的文件补进快照（只写 patcher/features）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const FEATURE = 'deepecho';
const SNAP = path.join(ROOT, 'patcher', 'features', FEATURE, 'files');
const FEATURES_JSON = path.join(ROOT, 'patcher', 'features.json');
const INDEX_JSON = path.join(ROOT, 'patcher', 'features', 'index.json');
const LIST = process.argv.includes('--list');
const FIX = process.argv.includes('--fix');

/** 深潜代码的标记词：文件里出现任意一个，就算「深渊回响相关」。 */
const MARK = /deepecho|echoVariant|EchoAltar|echoBlessing|echoCurse|echoPhase|echoWaves|echoBoard|DEEP_ECHO|深渊回响|深潜/;

/** 扫描范围：运行时会跑到的目录（不含 test/tools/docs，也不含第三方与素材）。 */
const ROOTS = ['server', 'public', 'shared', 'matchmaker', 'dashboard', 'data', 'content', 'mm'];
const SKIP_DIR = /(^|\/)(node_modules|logs|state|\.cache|bundles|\.git|assets|fonts|vendor)\//;
const EXT = /\.(js|mjs|cjs|json|css|html)$/;

/**
 * 只存在于服务器、**不进 Git** 的文件（.gitignore：dashboard 与管理后台页面）。
 * 它们的快照只能在线上机器上刷新；克隆出来的仓库里本来就没有，所以缺了只警告、不判失败。
 */
const SERVER_ONLY = [/^dashboard\//, /^matchmaker\/public\/admin\.html$/];
const isServerOnly = (rel) => SERVER_ONLY.some((re) => re.test(rel));

/** 必须存在的深潜测试（升级后按这份清单重跑）。 */
const TESTS = [
  'test/match/echoDive.integration.test.js',
  'test/match/echoBondDebuff.test.js',
  'test/match/echo-cross-enemy.test.js',
  'test/match/echo-boss-return-pick.test.js',
  'test/match/echo-hitcount-hp.test.js',
  'test/match/echo-projection-open.test.js',
  'test/match/echo-unite-time.test.js',
  'test/match/echo-altar-deploy-cap.test.js',
  'test/match/echo-room-dir.test.js',
  'test/match/echo-queue.test.js',
  'test/match/echo-public-queue.test.js',
  'test/match/echo-public-list.test.js',
  'test/persist/echo-resume.test.js',
  'test/content/whitw2-stack.test.js',
  'test/ui/echo-altar-visible.test.js',
  'test/ui/echo-best-account.test.js',
  'test/ui/echo-blessing-refresh-vote.test.js',
  'test/ui/echo-blessing-look.test.js',
  'test/ui/echo-projection-confirm.test.js',
  'test/match/echo-projection-bonds.test.js',
  'test/ui/stats-echo-record.test.js',
  'test/ui/echo-exit-words.test.js',
];

const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** 仓库里所有提到深潜的运行文件（相对 ROOT，正斜杠）。 */
function echoFiles() {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${rel}/${e.name}`;
      if (SKIP_DIR.test(`${p}/`)) continue;
      if (e.isDirectory()) { walk(p); continue; }
      if (!EXT.test(p)) continue;
      let txt;
      try { txt = fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { continue; }
      if (MARK.test(txt)) out.push(p);
    }
  };
  for (const r of ROOTS) walk(r);
  return out.sort();
}

const files = echoFiles();

/** 扫一遍快照：缺失 / 过期 / 只存在于服务器的（不入库）。 */
/** 扫一遍快照：缺失 / 过期 / 只存在于服务器的（不入库）。 */
function scanSnapshots(list) {
  const missing = [];
  const drifted = [];
  const serverOnlyGap = [];
  for (const rel of list) {
    const snap = path.join(SNAP, rel);
    const gone = !fs.existsSync(snap) || sha(snap) !== sha(path.join(ROOT, rel));
    if (!gone) continue;
    // dashboard / admin.html 不入库：克隆仓库里没有快照是正常的，只提醒在服务器上刷新
    if (isServerOnly(rel)) { serverOnlyGap.push(rel); continue; }
    if (!fs.existsSync(snap)) missing.push(rel); else drifted.push(rel);
  }
  return { missing, drifted, serverOnlyGap };
}
let { missing, drifted, serverOnlyGap } = scanSnapshots(files);

// features.json 登记：files 里必须覆盖到每个深潜文件（支持精确路径与 * / ** 通配）
let doc = null;
let entry = null;
try { doc = JSON.parse(fs.readFileSync(FEATURES_JSON, 'utf8')); } catch { /* 下面报错 */ }
const list = doc ? (Array.isArray(doc) ? doc : doc.features || []) : [];
entry = list.find((f) => f && f.id === FEATURE) || null;

const globToRe = (g) => new RegExp('^' + g.replace(/\\/g, '/').replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?') + '$');
const declared = entry && Array.isArray(entry.files) ? entry.files : [];
const declaredRes = declared.map(globToRe);
const unregistered = files.filter((rel) => !declaredRes.some((re) => re.test(rel)));const deadDeclared = declared.filter((g) => !globToRe(g).test(g) ? false : true).filter((g) => {
  const re = globToRe(g);
  return !files.some((rel) => re.test(rel));
});
const missingTests = TESTS.filter((t) => !fs.existsSync(path.join(ROOT, t)));

// index.json：merge-features.py 的输入，没有这一项 = 升级时整份功能被忽略
let indexDoc = null;
try { indexDoc = JSON.parse(fs.readFileSync(INDEX_JSON, 'utf8')); } catch { /* 下面报错 */ }
const indexEntry = Array.isArray(indexDoc) ? indexDoc.find((f) => f && f.id === FEATURE) : null;
const indexed = new Set((indexEntry && Array.isArray(indexEntry.files) ? indexEntry.files : [])
  .map((f) => (typeof f === 'string' ? f : f && f.path)).filter(Boolean));
const notIndexed = files.filter((rel) => !indexed.has(rel));

// ---- 修复：把漂移 / 缺失的文件补进快照 ----
if (FIX) {
  let wrote = 0;
  for (const rel of [...missing, ...drifted]) {
    const dst = path.join(SNAP, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
    wrote++;
  }
  console.log(`[deepecho] 已刷新 ${wrote} 个快照文件 → patcher/features/${FEATURE}/files/`);
  // 修完重新扫一遍：下面的结论要基于修复后的状态
  ({ missing, drifted, serverOnlyGap } = scanSnapshots(files));
  // features.json 的 files 也要补：新增的共享文件里只要出现深潜标记词，就必须登记，
  // 否则 `--fix` 之后仍然报「未登记」，得靠人记得手改（踩过：resumeMatch.js 的注释提到深潜）。
  //
  // ★ 2026-11-08：这里同时**删掉不再匹配任何深潜文件的确切路径**。
  //   起因：`resumeMatch.js` 的注释里原来提到深潜，被 `--fix` 补登进 `deepecho.files`；
  //   后来那段注释搬走，文件不再带标记词，于是 features.json 留着 112 条、实际扫描只有 111 条，
  //   两份清单对不上（`test/patcher/deepecho-isolation.test.js` 报「文件数要一致」）。
  //   通配符（* / **）一律不动：它们本来就该覆盖未来新增的文件。
  try {
    const doc = JSON.parse(fs.readFileSync(FEATURES_JSON, 'utf8'));
    const list = (Array.isArray(doc) ? doc : doc.features) || [];
    const f = list.find((x) => x && x.id === FEATURE);
    if (f && Array.isArray(f.files)) {
      const hasGlob = (g) => /[*?]/.test(g);
      const kept = f.files.filter((g) => hasGlob(g) || files.includes(g));
      const pruned = f.files.filter((g) => !hasGlob(g) && !files.includes(g));
      const seen = new Set(kept);
      const added = unregistered.filter((rel) => !seen.has(rel));
      for (const rel of added) { kept.push(rel); seen.add(rel); }
      kept.sort();
      f.files = kept;
      fs.writeFileSync(FEATURES_JSON, JSON.stringify(doc, null, 2) + '\n');
      if (added.length || pruned.length) {
        console.log(`[deepecho] 已更新 patcher/features.json（${f.files.length} 个文件：新增 ${added.length}，移除已不再匹配的 ${pruned.length}）`);
        if (pruned.length) console.log(`[deepecho]   移除：${pruned.join(', ')}`);
      }
      unregistered.length = 0;   // 就地清空：下面的结论要反映「已经补完」的状态
    }
  } catch (e) { console.error('[deepecho] features.json 同步失败：' + (e && e.message)); }
  // index.json 最后写（merge-features.py 的唯一输入），顺序不能颠倒：先 features.json 再 index.json，
  // 否则 index 会按旧清单生成，守卫照样红。
  try {
    const idx = JSON.parse(fs.readFileSync(INDEX_JSON, 'utf8'));
    const i = idx.findIndex((f) => f && f.id === FEATURE);
    const rows = files.map((rel) => ({ path: rel, baseExists: fs.existsSync(path.join(ROOT, 'patcher', 'features', FEATURE, 'base', rel)), customBytes: fs.statSync(path.join(ROOT, rel)).size }));
    if (i < 0) idx.push({ id: FEATURE, name: '深渊回响（无尽深潜）', status: 'ported', files: rows });
    else idx[i].files = rows;
    fs.writeFileSync(INDEX_JSON, JSON.stringify(idx, null, 2) + '\n');
    console.log(`[deepecho] 已同步 patcher/features/index.json（${rows.length} 个文件）`);
  } catch (e) { console.error('[deepecho] index.json 同步失败：' + (e && e.message)); }
}

console.log(`深渊回响相关运行文件: ${files.length}`);
console.log(`快照缺失: ${missing.length}    快照过期(内容不同): ${drifted.length}`);
if (serverOnlyGap.length) console.log(`仅服务器文件（不入库，需在线上刷新）: ${serverOnlyGap.length}`);
console.log(`features.json 未登记: ${unregistered.length}${entry ? '' : '（整项缺失）'}    index.json 未登记: ${notIndexed.length}${indexEntry ? '' : '（整项缺失）'}    测试缺失: ${missingTests.length}`);

if (LIST) {
  if (missing.length) { console.log('\n--- 快照缺失 ---'); missing.forEach((f) => console.log('  ' + f)); }
  if (drifted.length) { console.log('\n--- 快照过期 ---'); drifted.forEach((f) => console.log('  ' + f)); }
  if (unregistered.length) { console.log('\n--- features.json 未登记 ---'); unregistered.forEach((f) => console.log('  ' + f)); }
  if (notIndexed.length) { console.log('\n--- index.json 未登记 ---'); notIndexed.forEach((f) => console.log('  ' + f)); }
  if (missingTests.length) { console.log('\n--- 测试缺失 ---'); missingTests.forEach((f) => console.log('  ' + f)); }
}

let bad = false;
if (!entry) {
  bad = true;
  console.error(`\n✗ patcher/features.json 里没有 ${FEATURE} 这一项：升级时没人知道深渊回响要移植。`);
}
if (missing.length || drifted.length) {
  bad = true;
  console.error('\n✗ 有深潜文件的补丁快照缺失或过期 —— 上游一升级，这些改动就会丢：');
  [...missing, ...drifted].slice(0, 20).forEach((f) => console.error('  ' + f));
  if (missing.length + drifted.length > 20) console.error(`  …还有 ${missing.length + drifted.length - 20} 个（用 --list 查看）`);
  console.error('  修复：node patcher/check-deepecho.mjs --fix');
}
if (unregistered.length) {
  bad = true;
  console.error('\n✗ 有深潜文件没写进 features.json 的 deepecho.files（快照刷新时会漏掉它们）：');
  unregistered.slice(0, 20).forEach((f) => console.error('  ' + f));
}
if (!indexEntry || notIndexed.length) {
  bad = true;
  console.error('\n✗ patcher/features/index.json 里缺少 deepecho 的文件登记 —— merge-features.py 只读这份文件，');
  console.error('  缺项的文件在升级合并时会被整个忽略（比快照过期更致命）：');
  if (!indexEntry) console.error('  （整个 deepecho 功能项缺失）');
  notIndexed.slice(0, 20).forEach((f) => console.error('  ' + f));
  console.error('  修复：node patcher/check-deepecho.mjs --fix（会同时补 index.json）');
}
if (missingTests.length) {
  bad = true;
  console.error('\n✗ 深潜的测试文件不见了（升级后没法验收）：');
  missingTests.forEach((f) => console.error('  ' + f));
}
if (bad) process.exit(1);
console.log(`\n✓ 深渊回响自包含：${files.length} 个文件全部有最新快照、已在 features.json 与 index.json 登记，${TESTS.length} 个测试齐全`);
