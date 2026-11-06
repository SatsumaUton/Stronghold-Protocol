// patcher/check-repo-split.mjs — 公开仓库里不许出现「深渊回响独占文件」。
//
// 维护者 2026-11-06：深渊回响单独一个仓库，公开仓库只放其余内容，
// **不能出现深渊回响的文件被上传到公开仓库**。
//
// 边界（详见 docs/DEEPECHO-REPO.md）：
//   独占文件 = 只为深潜存在的文件 → 只能在深渊回响仓库里；
//   共用文件（Match.js / lobby.js / theme.css / i18n …）同时含原版代码 → 留在公开仓库，
//   深潜那部分由 patcher/features/deepecho/files/ 的快照保护。
//
//   node patcher/check-repo-split.mjs            # 检查（报告 + 退出码 0，方便迁移期跑）
//   node patcher/check-repo-split.mjs --strict   # 有违规就退出码 1（迁移完成后接进 CI）
//   node patcher/check-repo-split.mjs --list     # 逐条列出违规文件
//   node patcher/check-repo-split.mjs --apply    # 真的把独占文件从 git 索引里摘掉（磁盘不动）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const STRICT = process.argv.includes('--strict');
const LIST = process.argv.includes('--list');
const APPLY = process.argv.includes('--apply');

/** 深潜独占文件的路径模式（与 docs/DEEPECHO-REPO.md 的第 2 节一一对应）。 */
export const EXCLUSIVE = [
  /^server\/match\/match\/echo[\w.-]*\.js$/,
  /^public\/js\/ui\/echo[\w.-]*\.js$/,
  /^public\/js\/ui\/enemyRecords\.js$/,
  /^public\/js\/screens\/echoLobby\.js$/,
  /^matchmaker\/diveBoard\.cjs$/,
  /^matchmaker\/roomDir\.cjs$/,
  /^patcher\/features\/deepecho\//,
  /^test\/.*echo[\w.-]*\.test\.js$/,
  /^test\/persist\/echo-resume\.test\.js$/,
  /^test\/content\/whitw2-stack\.test\.js$/,
  /^test\/patcher\/deepecho-isolation\.test\.js$/,
];

/** .gitignore 里必须存在的忽略行（保证摘掉以后不会再被 add 回来）。 */
const IGNORE_LINES = [
  'server/match/match/echo*.js',
  'public/js/ui/echo*.js',
  'public/js/ui/enemyRecords.js',
  'public/js/screens/echoLobby.js',
  'matchmaker/diveBoard.cjs',
  'matchmaker/roomDir.cjs',
  'patcher/features/deepecho/',
  'test/**/echo*.test.js',
  'test/persist/echo-resume.test.js',
  'test/content/whitw2-stack.test.js',
  'test/patcher/deepecho-isolation.test.js',
];

const isExclusive = (rel) => EXCLUSIVE.some((re) => re.test(rel));

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
}

let tracked = [];
try {
  tracked = git(['ls-files']).split('\n').filter(Boolean);
} catch (e) {
  console.error('找不到 git（或这里不是 git 仓库）：' + (e && e.message));
  process.exit(2);
}
const offenders = tracked.filter(isExclusive);

const ignorePath = path.join(ROOT, '.gitignore');
const ignoreText = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
const missingIgnore = IGNORE_LINES.filter((l) => !ignoreText.split('\n').map((x) => x.trim()).includes(l));

console.log(`公开仓库里被跟踪的深潜独占文件: ${offenders.length}`);
console.log(`.gitignore 缺少的深潜规则: ${missingIgnore.length}`);

if (LIST && offenders.length) {
  console.log('\n--- 违规文件 ---');
  offenders.forEach((f) => console.log('  ' + f));
}
if (LIST && missingIgnore.length) {
  console.log('\n--- 需要加进 .gitignore ---');
  missingIgnore.forEach((f) => console.log('  ' + f));
}

if (APPLY) {
  if (offenders.length) {
    // 分批：一次几百个参数在 Windows 上会超长
    for (let i = 0; i < offenders.length; i += 60) {
      git(['rm', '--cached', '--quiet', ...offenders.slice(i, i + 60)]);
    }
    console.log(`\n已从 git 索引摘掉 ${offenders.length} 个文件（磁盘上的文件没动）`);
  }
  if (missingIgnore.length) {
    const block = [
      '',
      '# ---- 深渊回响：独占文件只放在私有仓库（docs/DEEPECHO-REPO.md）----',
      '# 这里只是不让它们再被 add 回来；磁盘上的文件仍然用于部署。',
      ...IGNORE_LINES,
      '',
    ].join('\n');
    fs.appendFileSync(ignorePath, block);
    console.log(`已把 ${missingIgnore.length} 条深潜规则写进 .gitignore`);
  }
  console.log('下一步：git add -A && git commit -m "chore: 深渊回响迁出公开仓库"');
  process.exit(0);
}

const bad = offenders.length > 0 || missingIgnore.length > 0;
if (bad) {
  console.error('\n✗ 公开仓库里还有深渊回响的独占文件（或缺少 .gitignore 规则）：');
  console.error('  这些文件只应该出现在私有的深渊回响仓库里（docs/DEEPECHO-REPO.md）。');
  if (offenders.length) console.error(`  被跟踪的独占文件：${offenders.length} 个（--list 查看）`);
  if (missingIgnore.length) console.error(`  .gitignore 缺少规则：${missingIgnore.length} 条`);
  console.error('  迁移：node patcher/check-repo-split.mjs --apply');
  if (STRICT) process.exit(1);
  console.log('\n（迁移期不判失败；迁移完成后用 --strict 接进 CI）');
} else {
  console.log('\n✓ 公开仓库干净：没有任何深潜独占文件，.gitignore 规则齐全');
}
