// deploy/check-node1-drift.mjs — 部署前的最后一道闸：**repo-sync 与 node-1 的运行时文件逐个比对**。
//
// 为什么需要它（2026-11-18 实际踩到）：
//   `deploy/sync-nodes.cjs` 的参照物是 **node-1**，不是 repo-sync：
//       for (const d of DIRS) ref[d] = walk(path.join(ROOT, 'node-1', d));
//   所以「改了 repo-sync、忘了拷到 node-1」的文件，sync-nodes 会照报「0 处差异」，
//   而线上 30 台跑的全是旧代码 —— 看起来部署成功，其实没生效。
//
//   最容易漏的是**被 .gitignore 排除的运行时文件**：`git show --name-only <commit>` 不会列出它们，
//   照提交清单拷文件就会漏：
//       server/match/match/echo*.js      深渊回响的全部服务端逻辑
//       public/js/ui/echo*.js            深渊回响的界面
//       data/echo-stages.json            跨版本战场池（随包记录）
//       data/local-fx.json、data/local-assets.json   本地素材清单
//
//   这一次就是这么漏的：echoPhase.js 的「盟约投影」修复在所有 30 台上都没生效，
//   而 sync-nodes 一直报「0 处差异」。
//
// 用法：
//   node deploy/check-node1-drift.mjs          # 报告差异；有差异时退出码 1
//   node deploy/check-node1-drift.mjs --list   # 只列出，不判失败（排查用）
//
// 已知的**故意不同**（生产环境与公开仓库本来就不一样），列在 INTENTIONAL 里；
// 新增一条要写清理由，否则下次它会被当成噪音，闸门就白做了。
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const ROOT = process.env.SP_ROOT || join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'repo-sync');
const DST = join(ROOT, 'node-1');

/** 与 sync-nodes.cjs 的 DIRS 对齐（多列 public/css，因为样式也会改）。 */
const DIRS = ['server', 'public/js', 'public/css', 'shared', 'data', 'content', 'plugins', 'packs', 'schemas'];

/**
 * 故意不同、不该判失败的路径（相对 repo-sync）。
 * 每条都要写理由 —— 没有理由的差异就是真的漏了。
 */
const INTENTIONAL = new Map([
  ['data/create-room.json', '公开仓库默认关闭建房（{"enabled":false}），生产是开放的（true）'],
  ['data/assets.json', '生成本地素材清单的摘要文件，两处各自生成'],
  ['server/http/csp.js', '内容相同，仅换行符不同（生产 CRLF / 仓库 LF）'],
  ['content/announcements.json', 'node-1 的公告由管理后台写入，仓库里是初始版本'],
]);

const mode = process.argv.slice(2);
const listOnly = mode.includes('--list');
const hex = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|json|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 忽略行尾差异：只比内容（CRLF/LF 不算改动）。 */
const same = (a, b) => {
  if (hex(a) === hex(b)) return true;
  const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  try { return norm(a) === norm(b); } catch { return false; }
};

const changed = [], missing = [];
let checked = 0;
for (const d of DIRS) {
  for (const a of walk(join(SRC, d))) {
    const rel = relative(SRC, a).split(sep).join('/');
    const b = join(DST, rel.split('/').join(sep));
    checked++;
    if (!existsSync(b)) { missing.push(rel); continue; }
    if (!same(a, b)) changed.push(rel);
  }
}

const unexpectedChanged = changed.filter((p) => !INTENTIONAL.has(p));
const unexpectedMissing = missing.filter((p) => !INTENTIONAL.has(p));
const hiddenChanged = changed.filter((p) => INTENTIONAL.has(p));

console.log(`比对 ${checked} 个运行时文件（repo-sync → node-1）。`);
if (hiddenChanged.length) {
  console.log(`\n故意不同（已放行 ${hiddenChanged.length} 个）：`);
  for (const p of hiddenChanged) console.log(`  · ${p} —— ${INTENTIONAL.get(p)}`);
}
if (missing.length) {
  console.log(`\n只在 repo-sync 里的文件（${missing.length} 个）：`);
  for (const p of missing) console.log(`  ${unexpectedMissing.includes(p) ? '✗' : '·'} ${p}`);
}
if (changed.length) {
  console.log(`\n内容不同（${changed.length} 个）：`);
  for (const p of changed) console.log(`  ${unexpectedChanged.includes(p) ? '✗' : '·'} ${p}`);
}

const bad = unexpectedChanged.length + unexpectedMissing.length;
if (!bad) { console.log('\n✓ node-1 与 repo-sync 一致（放行项之外没有差异）'); process.exit(0); }
console.log(`\n✗ 有 ${bad} 个文件没同步到 node-1 —— sync-nodes 会报「0 处差异」，但线上跑的是旧代码。`);
console.log('  修：把它们拷到 node-1 再跑 deploy/sync-nodes.cjs --apply');
process.exit(listOnly ? 0 : 1);
