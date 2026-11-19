// deploy/render-nginx.cjs —— 把脱敏的 nginx 快照还原成线上配置。
//
// `deploy/nginx.conf` 是**快照**：正文里的 `__SP_ROOT__` 是占位符（资源站写域名，不写 IP），
// 头部那一段说明（含当时的 SHA）在还原时丢弃。服务器重装时用这个脚本还原。
//
// 用法：
//   node deploy/render-nginx.cjs --check     # 只比对：线上配置与快照渲染结果是否一致（退出码 0/1）
//   node deploy/render-nginx.cjs --apply     # 写出到 <SP_ROOT>/nginx/conf/nginx.conf（先备份）
//   node deploy/render-nginx.cjs --stdout    # 打到标准输出
//
// 环境变量：
//   SP_ROOT       部署根目录（默认：本文件上一级）
//
// 安全约束：占位符没替换干净就拒绝写出 —— 宁可失败，也不要写出一份指向 __SP_ROOT__ 的坏配置。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BODY_MARK = '# ---8<--- 快照正文开始（这一行之前都是说明，还原时丢弃） ---8<---';

const ROOT = process.env.SP_ROOT || path.resolve(__dirname, '..');
const TPL = path.join(__dirname, 'nginx.conf');
const LIVE = path.join(ROOT, 'nginx', 'conf', 'nginx.conf');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

if (!fs.existsSync(TPL)) { console.error(`找不到快照：${TPL}`); process.exit(1); }
const tplRaw = fs.readFileSync(TPL, 'utf8');

// 头部说明丢掉，只留正文（否则比对永远不等）
const i = tplRaw.indexOf(BODY_MARK);
const body = i >= 0 ? tplRaw.slice(i + BODY_MARK.length).replace(/^\r?\n/, '') : tplRaw;


// nginx 在 Windows 上两种斜杠都认，但配置里统一写成正斜杠更稳
const rootPosix = ROOT.split(path.sep).join('/');
const rendered = body.split('__SP_ROOT__').join(rootPosix);

const leftover = rendered.match(/__SP_ROOT__/g);
if (leftover) {
  console.error(`占位符未替换：${[...new Set(leftover)].join(', ')}`);
  process.exit(2);
}

if (has('--stdout')) { process.stdout.write(rendered); process.exit(0); }

if (has('--check')) {
  if (!fs.existsSync(LIVE)) { console.error(`线上配置不存在：${LIVE}`); process.exit(1); }
  const live = fs.readFileSync(LIVE, 'utf8');
  const same = sha(live) === sha(rendered);
  console.log(same ? '✓ 线上配置与快照渲染结果一致' : '✗ 线上配置与快照不一致');
  if (!same) {
    let k = 0;
    while (k < Math.min(live.length, rendered.length) && live[k] === rendered[k]) k++;
    console.log(`  第一处差异 @${k}`);
    console.log('  线上:', JSON.stringify(live.slice(Math.max(0, k - 50), k + 50)));
    console.log('  快照:', JSON.stringify(rendered.slice(Math.max(0, k - 50), k + 50)));
  }
  process.exit(same ? 0 : 1);
}

if (has('--apply')) {
  // 保护 ①：必须**显式**给 SP_ROOT。默认值是仓库根，而仓库里也有个 nginx/ 目录（run-nginx.mjs 等），
  //   只查「有没有 nginx/」是拦不住的 —— 实测就把配置写进了 repo-sync/nginx/conf/。
  if (!process.env.SP_ROOT) {
    console.error('--apply 必须显式设 SP_ROOT（部署根，含 repo-sync/ 与 nginx/），不接受默认值');
    process.exit(2);
  }
  // 保护 ②：部署根的形态 —— 同时有 repo-sync/ 与 nginx/conf/。
  if (!fs.existsSync(path.join(ROOT, 'repo-sync')) || !fs.existsSync(path.join(ROOT, 'nginx', 'conf'))) {
    console.error(`${ROOT} 不像部署根（缺 repo-sync/ 或 nginx/conf/）—— 检查 SP_ROOT`);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(LIVE), { recursive: true });
  if (fs.existsSync(LIVE)) {
    const bak = `${LIVE}.before-restore-${Date.now()}`;
    fs.copyFileSync(LIVE, bak);
    console.log(`已备份：${bak}`);
  }
  fs.writeFileSync(LIVE, rendered);
  console.log(`已写出：${LIVE}（${rendered.length} 字节）`);
  console.log('生效：schtasks /Run /TN "SP-Nginx-Reload"（nginx 由 SYSTEM 托管，会话里 -s reload 会被拒）');
  process.exit(0);
}

console.log('用法：node deploy/render-nginx.cjs --check | --apply | --stdout');
console.log(`  部署根：${ROOT}`);
