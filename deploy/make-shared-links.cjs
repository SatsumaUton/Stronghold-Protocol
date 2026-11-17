// deploy/make-shared-links.cjs —— 把「每个节点一份、内容却完全相同」的目录改成**共享 junction**。
//
// 为什么（维护者 2026-11-18）：30 个节点目录各自存了一份 public/download（安卓版本检测文件），
// 改一次要同步 30 份。这本来就是共享的东西，应该像 data / assets / css 那样指到 shared。
//
// 现状盘点（本脚本只负责下表，别的目录一律不碰）：
//   已共享（历史遗留，由部署时手工建好，本脚本会校验、断了就修）：
//     node-*/data           → shared/data            （30 台）
//     node-*/node_modules   → shared/node_modules    （29 台；node-1 仍是实目录）
//     node-*/public/{assets,css,fonts,i18n,icons,vendor} → shared/...
//   本次新增：
//     node-*/public/download → shared/public/download
//   故意**不**共享：
//     public/js、public/dev、public/studio —— deploy/sync-nodes.cjs 的 walk() 遇到 junction 会跳过
//     （Node 把 junction 报成 isSymbolicLink，不是 isDirectory），一旦共享，代码就再也同步不到节点了。
//
//   node deploy/make-shared-links.cjs            # 只报告
//   node deploy/make-shared-links.cjs --apply    # 建立/修复
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.SP_ROOT || path.resolve(__dirname, '..', '..');
const APPLY = process.argv.includes('--apply');

/** 共享表：节点内相对路径 → 共享根内的相对路径 */
const LINKS = [
  { at: 'data', to: 'data' },
  { at: 'node_modules', to: 'node_modules' },
  { at: 'public/assets', to: 'assets' },
  { at: 'public/css', to: 'public/css' },
  { at: 'public/fonts', to: 'public/fonts' },
  { at: 'public/i18n', to: 'public/i18n' },
  { at: 'public/icons', to: 'public/icons' },
  { at: 'public/vendor', to: 'public/vendor' },
  { at: 'public/download', to: 'public/download' },   // ★ 本次新增
];

/** 节点里绝不该共享的（sync-nodes 的同步范围，共享了就同步不进去） */
const NEVER = ['public/js', 'public/dev', 'public/studio', 'server', 'shared', 'plugins', 'packs', 'schemas'];

const sharedOf = (to) => path.join(ROOT, 'shared', to);
const nodeOf = (n, at) => path.join(ROOT, `node-${n}`, ...at.split('/'));

function state(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return { kind: 'link', target: fs.readlinkSync(p) };
    if (st.isDirectory()) return { kind: 'dir' };
    return { kind: 'other' };
  } catch { return { kind: 'missing' }; }
}

/** 把实目录的内容搬进共享目录（不覆盖已存在的同名文件，冲突则报出来）。 */
function mergeInto(srcDir, dstDir, log) {
  let moved = 0, same = 0, conflicts = [];
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, e.name);
    const d = path.join(dstDir, e.name);
    if (fs.existsSync(d)) {
      // 目录：递归比一次顶层就够了吗？不够。用整树大小+计数快速判同，不同就报冲突。
      const pick = (dir) => {
        let files = 0, bytes = 0;
        const walk = (q) => {
          for (const x of fs.readdirSync(q, { withFileTypes: true })) {
            const p = path.join(q, x.name);
            if (x.isDirectory()) walk(p);
            else { files++; bytes += fs.statSync(p).size; }
          }
        };
        walk(dir);
        return `${files}:${bytes}`;
      };
      const fs1 = e.isDirectory() ? pick(s) : fs.statSync(s).size;
      const fs2 = e.isDirectory() ? pick(d) : fs.statSync(d).size;
      if (String(fs1) === String(fs2)) same++;
      else conflicts.push(`${e.name}（源 ${fs1} ≠ 共享 ${fs2}）`);
      continue;
    }
    fs.renameSync(s, d);
    moved++;
  }
  if (moved) log(`    搬入 ${moved} 个`);
  if (same) log(`    ${same} 个已存在于共享目录且内容相同（未覆盖）`);
  if (conflicts.length) log(`    ⚠ 内容不同的（未覆盖，需人工确认）: ${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? ` …共 ${conflicts.length}` : ''}`);
  return { moved, conflicts };
}

// 1) 共享根先建好（下载目录里只有安卓版本文件）
fs.mkdirSync(sharedOf('public/download'), { recursive: true });

let made = 0, ok = 0, bad = 0;
for (let n = 1; n <= 30; n++) {
  const nd = path.join(ROOT, `node-${n}`);
  if (!fs.existsSync(nd)) continue;
  const todo = [];
  for (const link of LINKS) {
    const at = nodeOf(n, link.at);
    const to = sharedOf(link.to);
    const s = state(at);
    if (s.kind === 'link' && path.resolve(s.target) === path.resolve(to)) { ok++; continue; }
    todo.push({ link, at, to, s });
  }
  for (const x of todo) {
    if (!APPLY) {
      console.log(`node-${n}: ${x.link.at} 当前=${x.s.kind}${x.s.target ? `(${x.s.target})` : ''} → 应指向 ${x.to}`);
      bad++;
      continue;
    }
    console.log(`node-${n}: 处理 ${x.link.at}（当前 ${x.s.kind}）`);
    fs.mkdirSync(x.to, { recursive: true });
    if (x.s.kind === 'dir') {
      mergeInto(x.at, x.to, console.log);
      fs.rmSync(x.at, { recursive: true, force: true });
    } else if (x.s.kind === 'link') {
      fs.unlinkSync(x.at);                    // 指错了：删掉重指
    } else if (x.s.kind === 'other') {
      console.log('    ⚠ 不是目录，跳过（需要人工处理）');
      bad++;
      continue;
    }
    fs.symlinkSync(x.to, x.at, 'junction');
    made++;
  }
}

// 2) 兜底检查：绝不该共享的目录仍是实体目录
for (const forbidden of NEVER) {
  for (let n = 1; n <= 30; n++) {
    const nd = path.join(ROOT, `node-${n}`);
    if (!fs.existsSync(nd)) continue;
    const p = path.join(nd, ...forbidden.split('/'));
    const s = state(p);
    if (s.kind === 'link') console.log(`⚠ 不该共享却被共享: node-${n}/${forbidden} → ${s.target}`);
  }
}

console.log(`\n共享 junction: 已正确 ${ok} 处，本次建立/修复 ${made} 处${bad ? `，待人工 ${bad} 处` : ''}`);
if (!APPLY && bad) console.log('（报告模式；加 --apply 修复）');
