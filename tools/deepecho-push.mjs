// tools/deepecho-push.mjs — 把 deepecho-repo 的当前文件树推到私有仓库（走 GitHub API）。
//
// 为什么不是 `git push`：这台机器的网络里 github.com:443 直连不通（20 秒超时），
// ghfast.top 代理只读（推送回 403）。api.github.com 是通的，所以走 Git Data API：
//   blobs → tree → commit → ref。
//
//   node tools/deepecho-push.mjs --check   # 只对比远端 main 与本地文件（不写）
//   node tools/deepecho-push.mjs --apply   # 推送（追加一个 commit）
//
// 令牌：.secrets/github-token.txt（需对该私有仓库有 contents:write）。
// 只新增/覆盖：不删除远端独有的文件（与 deploy/_gh-push.cjs 的约定一致）。
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '..', 'deepecho-repo');
const OWNER = 'SatsumaUton';
const REPO = 'Stronghold-Protocol-Deepecho';
const BRANCH = 'main';
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const MESSAGE = 'sync: 深渊回响内容更新';

const TOKEN = (() => {
  try { return fs.readFileSync(path.join(ROOT, '..', '.secrets', 'github-token.txt'), 'utf8').trim(); } catch { return ''; }
})();
if (!TOKEN) { console.error('缺少 .secrets/github-token.txt'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      host: 'api.github.com', path: p, method,
      headers: {
        Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'sp-deepecho-push',
        Accept: 'application/vnd.github+json',
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (s) => {
      let d = ''; s.setEncoding('utf8');
      s.on('data', (c) => { d += c; });
      s.on('end', () => {
        let b = null; try { b = JSON.parse(d); } catch { b = { raw: d }; }
        if (s.statusCode >= 400) {
          const e = new Error(`${method} ${p} → ${s.statusCode} ${b?.message || d.slice(0, 160)}`);
          e.status = s.statusCode;
          e.retryable = s.statusCode === 429 || s.statusCode >= 500;
          reject(e);
        } else resolve(b);
      });
    });
    r.on('error', (e) => { e.retryable = true; reject(e); });
    if (data) r.write(data);
    r.end();
  });
}
async function call(method, p, body, tries = 6) {
  let last;
  for (let t = 1; t <= tries; t++) {
    try { return await req(method, p, body); } catch (e) {
      last = e;
      if (!e.retryable) throw e;
      const wait = Math.min(8000, 500 * 2 ** (t - 1));
      console.log(`   重试 ${t}/${tries}（${e.message.slice(0, 70)}）${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

/** 目标树里的每个文件（相对路径 → 磁盘路径），跳过 .git */
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push({ rel: path.relative(base, p).split(path.sep).join('/'), abs: p });
  }
  return out;
}

const files = walk(OUT).sort((a, b) => (a.rel < b.rel ? -1 : 1));
if (!files.length) { console.error('deepecho-repo 是空的，先跑 tools/deepecho-repo.mjs'); process.exit(1); }
console.log(`本地文件：${files.length} 个（${OUT}）`);

const repoPath = `/repos/${OWNER}/${REPO}`;
const repo = await call('GET', repoPath);
console.log(`仓库：${repo.full_name} private=${repo.private} default=${repo.default_branch}`);

// 远端当前 head（空仓库没有）
let head = null;
// 空仓库：GET ref 回 404，GET commits 回 409「Git Repository is empty」——两种都当「没有 head」
try { head = await call('GET', `${repoPath}/git/ref/heads/${BRANCH}`); } catch (e) { if (e.status !== 404 && e.status !== 409) throw e; }
const headSha = head?.object?.sha || null;
console.log(`远端 ${BRANCH}：${headSha ? headSha.slice(0, 12) : '（空仓库）'}`);

// 远端已有文件的 blob sha（用于跳过未变文件）
const remoteBlobs = new Map();
if (headSha) {
  const commit = await call('GET', `${repoPath}/git/commits/${headSha}`);
  let treeSha = commit.tree.sha;
  let truncated = true;
  while (truncated) {
    const tr = await call('GET', `${repoPath}/git/trees/${treeSha}?recursive=1`);
    truncated = !!tr.truncated;
    for (const x of tr.tree || []) if (x.type === 'blob') remoteBlobs.set(x.path, x.sha);
    if (truncated) { console.log('（tree 被截断，跳过后半段比对）'); break; }
  }
}
console.log(`远端已有文件：${remoteBlobs.size}`);

let uploaded = 0;
const entries = [];
const CONCURRENCY = 6;
for (let i = 0; i < files.length; i += CONCURRENCY) {
  const chunk = files.slice(i, i + CONCURRENCY);
  const shas = await Promise.all(chunk.map(async (f) => {
    const buf = fs.readFileSync(f.abs);
    const sha = await (async () => {
      if (CHECK) return null;
      const b = await call('POST', `${repoPath}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
      uploaded++;
      return b.sha;
    })();
    return { f, sha };
  }));
  for (const { f, sha } of shas) entries.push({ ...f, sha });
  if ((i / CONCURRENCY) % 8 === 0) process.stdout.write(`  已处理 ${Math.min(i + CONCURRENCY, files.length)}/${files.length}\r`);
}
process.stdout.write('\n');

if (CHECK) {
  // --check 只比数量与文件名（没有 blob sha 没法逐字节比）
  console.log('（--check 模式下不写远端；如需逐字节核对请用 --apply 后的 tree 比对）');
  process.exit(0);
}

// 只有内容真的变了才提交：本地 blob sha 与远端同名文件比对（Git 的 blob sha 由内容决定）
const changed = entries.filter((e) => remoteBlobs.get(e.rel) !== e.sha);
console.log(`内容有变化的文件：${changed.length}    新增：${entries.filter((e) => !remoteBlobs.has(e.rel)).length}`);
if (!changed.length) { console.log('远端已是最新，无需提交'); process.exit(0); }

const tree = await call('POST', `${repoPath}/git/trees`, {
  tree: entries.map((e) => ({ path: e.rel, mode: '100644', type: 'blob', sha: e.sha })),
});
console.log(`tree ${tree.sha.slice(0, 12)}（${entries.length} 项）`);

const commit = await call('POST', `${repoPath}/git/commits`, {
  message: `${MESSAGE}（${entries.length} 个文件）`,
  tree: tree.sha,
  parents: headSha ? [headSha] : [],
});
console.log(`commit ${commit.sha.slice(0, 12)}`);

if (!headSha) await call('POST', `${repoPath}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
else await call('PATCH', `${repoPath}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
console.log(`已推送 ${BRANCH} → ${commit.sha.slice(0, 12)}`);
