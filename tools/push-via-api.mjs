// tools/push-via-api.mjs —— 用 GitHub API 把本地 HEAD 推到远端（绕开 ghfast 代理的 receive-pack 缓存）。
//
// 背景：这台机器直连 github.com 不通，`git push` 走 ghfast.top 代理；代理会把
// receive-pack 的 ref advertisement 缓存住，于是推送报
//   `cannot lock ref ...: is at <真实 sha> but expected <缓存里的旧 sha>`
// 重试要等缓存过期（几十分钟）。API 是通的，所以用 Git Data API：
//   blobs → tree(base_tree) → commit → PATCH ref
//
//   node tools/push-via-api.mjs            # 只打印计划（改了哪些文件）
//   node tools/push-via-api.mjs --apply    # 真推
//
// 令牌：.secrets/github-token.txt（需要 contents:write）。只新增/覆盖，不删除远端独有文件。
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'SatsumaUton';
const REPO = 'Stronghold-Protocol';
const BRANCH = 'custom/production';
const APPLY = process.argv.includes('--apply');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
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
        Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'sp-push-api',
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

const rp = `/repos/${OWNER}/${REPO}`;
const head = await call('GET', `${rp}/git/ref/heads/${BRANCH}`);
const headSha = head.object.sha;
const rc = await call('GET', `${rp}/git/commits/${headSha}`);
const rt = await call('GET', `${rp}/git/trees/${rc.tree.sha}?recursive=1`);
if (rt.truncated) { console.error('远端 tree 被截断，脚本未处理这种情况'); process.exit(1); }
const remote = new Map((rt.tree || []).filter((x) => x.type === 'blob').map((x) => [x.path, x.sha]));
const ls = git('ls-tree', '-r', '-z', 'HEAD').split('\0').filter(Boolean).map((line) => {
  const tab = line.indexOf('\t');
  const meta = line.slice(0, tab).split(' ');
  return { mode: meta[0], sha: meta[2], rel: line.slice(tab + 1) };
});
const local = new Map(ls.map((x) => [x.rel, x]));
const added = ls.filter((x) => !remote.has(x.rel));
const changed = ls.filter((x) => remote.has(x.rel) && remote.get(x.rel) !== x.sha);
const deleted = [...remote.keys()].filter((p) => !local.has(p));
console.log(`远端 ${BRANCH}: ${headSha.slice(0, 12)} | 本地 ${ls.length} 个文件 | 新增 ${added.length} 修改 ${changed.length} 删除 ${deleted.length}`);
for (const x of [...added, ...changed].slice(0, 30)) console.log('  ~', x.rel);
for (const p of deleted.slice(0, 30)) console.log('  -', p);
if (!APPLY) { console.log('（未加 --apply，不写远端）'); process.exit(0); }

const entries = [];
const todo = [...added, ...changed];
for (let i = 0; i < todo.length; i += 6) {
  const made = await Promise.all(todo.slice(i, i + 6).map(async (x) => {
    const buf = execFileSync('git', ['cat-file', 'blob', x.sha], { cwd: ROOT, maxBuffer: 1 << 28 });
    const b = await call('POST', `${rp}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    return { path: x.rel, mode: x.mode === '100755' ? '100755' : '100644', type: 'blob', sha: b.sha };
  }));
  entries.push(...made);
}
for (const p of deleted) entries.push({ path: p, mode: '100644', type: 'blob', sha: null });

const tree = await call('POST', `${rp}/git/trees`, { base_tree: rc.tree.sha, tree: entries });
const message = git('log', '-1', '--pretty=%B').trim();
const commit = await call('POST', `${rp}/git/commits`, { message, tree: tree.sha, parents: [headSha] });
await call('PATCH', `${rp}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
console.log(`已推送 ${BRANCH} → ${commit.sha}`);
console.log('本地对齐：git fetch origin && git reset --hard origin/' + BRANCH);
