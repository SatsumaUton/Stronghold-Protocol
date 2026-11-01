// 安全重启 nginx（清掉残留 worker），并确保新进程不挂在任何用户会话上
//
//   node tools/restart-nginx.mjs          # 只报告，不动
//   node tools/restart-nginx.mjs --apply  # 真的重启
//
// 为什么需要这个脚本（2026-10-27）：
//   1) nginx 有十几个残留 worker（配置只要 2 个），最老的活了两天，
//      导致地图场景资源加载从毫秒级恶化到 60–81 秒。
//   2) nginx master 的 SessionId = 2（桌面会话），说明当初是从交互式会话启动的。
//      维护者要求：**不能挂在任何用户会话上**（否则注销 / 重启桌面应用可能带走它）。
//
// ★ 2026-10-27 第二次事故，本脚本因此重写：
//   原来的流程是「发 quit → 等 15 秒 → 触发计划任务」。实测踩了两个坑：
//     * `nginx -s quit` 只让 master 退出，**卡住的 worker 不会自己结束**
//       （那次 16 个进程只退了 1 个）。脚本等不到归零就继续，把还活着的进程留在 Session 2。
//     * 计划任务里的 _start-nginx.ps1 开头有「已经在跑就直接退出」的保护，
//       于是看到残留进程 → 什么都不做 → 新旧混在一起，进程数从 14 涨到 17。
//   现在的流程（顺序不能改）：
//     1. quit（给正在传输的请求机会收尾）
//     2. **确认归零**：还没退完就强制结束 —— 不归零就不启动
//     3. 确认 443 已释放
//     4. 再触发计划任务（此时必然新建一套，落在 Session 0）
//     5. 校验：进程数、全部 session 0、HTTPS 200、素材加载速度
//   任何一步不达标就明确报失败，绝不说「已重启」。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const NGX_DIR = 'D:\\Stronghold-Protocol\\nginx';
const NGX = NGX_DIR + '\\nginx.exe';
const TASK = 'SP-Nginx-Start';
/**
 * 进程数上限 = master + worker。worker 数从配置里现读，不要写死。
 *
 * ★ 2026-11-02：原来这里写死 `const EXPECTED_MAX = 3;`（注释说「配置 worker_processes 2」），
 *   但 nginx.conf 实际是 `worker_processes 4;` → 正常明明有 5 个进程，脚本却按 3 判。
 *   后果是每次重启都必然误报，而且会把 2 个**正常** worker 当成「残留」强杀：
 *     第 0 步  「有 2 个残留 worker」
 *     第 2 步  等它们退出 → 永远等不到 → 强杀
 *     第 5 步  强杀后进程句柄还没被 Windows 回收 → 「✗ 仍有 1 个无法结束，已中止」
 *   服务其实由计划任务 SP-Nginx-Start 拉起来了，是好的；脚本报的错是假的。
 *   改成读配置后，以后调 worker_processes 也不会再对不上。
 */
function readWorkerProcesses() {
  try {
    const conf = readFileSync(NGX_DIR + '\\conf\\nginx.conf', 'utf8');
    // 只认指令本身（行首，允许前导空白）；忽略被 # 注释掉的那些
    const m = conf.match(/^\s*worker_processes\s+([^;]+);/m);
    if (!m) return null;
    const v = m[1].trim();
    if (/^\d+$/.test(v)) return Number(v);
    // `auto` 和其他表达式：算不出来，退回 null（不判残留，只报实际数）
    return null;
  } catch {
    return null;
  }
}
const WORKERS = readWorkerProcesses();
/** master + worker；读不到配置时用 null 表示「不做上限判断」，避免用错误数字误杀。 */
const EXPECTED_MAX = WORKERS == null ? null : WORKERS + 1;

function run(exe, args) {
  try {
    return { ok: true, out: execFileSync(exe, args, { encoding: 'utf8', stdio: 'pipe' }).trim() };
  } catch (e) {
    return { ok: false, out: ((e.stdout || '') + (e.stderr || '') + e.message).trim() };
  }
}
const ps = (cmd) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** [pid, sessionId, creationDate] of every nginx process. */
function nginxProcs() {
  // 用单引号包 PowerShell 命令，内层用双引号 —— 少一层转义，避免 \\\" 被吞掉导致查询返回空。
  const cmd = "Get-CimInstance Win32_Process -Filter \"Name='nginx.exe'\" | Sort-Object CreationDate | ForEach-Object { \"$($_.ProcessId)|$($_.SessionId)|$($_.CreationDate)\" }";
  const r = ps(cmd);
  return r.out.split('\n').map((s) => s.trim()).filter(Boolean).map((p) => {
    const [pid, sid, ...rest] = p.split('|');
    return { pid, sid, created: rest.join(' ') };
  });
}

/** Is anything listening on 443? Returns the owning pid or null. */
function port443() {
  const r = ps("(Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess");
  const v = r.out.trim();
  return v && v !== '0' && /^\d+$/.test(v) ? v : null;
}

function httpsStatus() {
  const r = run('powershell.exe', ['-NoProfile', '-Command',
    "try { (Invoke-WebRequest 'https://127.0.0.1/' -UseBasicParsing -SkipCertificateCheck -TimeoutSec 10).StatusCode } catch { 'FAIL' }"]);
  return r.out.trim();
}

// ---- 0) 现状 ----
console.log('=== 当前 nginx 状态 ===');
const before = nginxProcs();
before.forEach((p) => {
  console.log(`  pid=${p.pid}  session=${p.sid}  ${p.created}${p.sid === '0' ? '' : '  ⚠ 不在 Session 0'}`);
});
const expectText = EXPECTED_MAX == null
  ? '配置里的 worker_processes 读不出数字（可能是 auto），不做上限判断'
  : `配置 worker_processes ${WORKERS}，正常应为 master + ${WORKERS} worker = ${EXPECTED_MAX}`;
console.log(`  共 ${before.length} 个进程（${expectText}）`);
if (EXPECTED_MAX != null && before.length > EXPECTED_MAX) {
  console.log(`  ⚠ 有 ${before.length - EXPECTED_MAX} 个残留 worker —— 这正是素材加载变慢的原因`);
}

console.log('\n=== 当前对局 ===');
const status = run('node', ['-e', `
let m=0,h=0;const http=require('http');
(async()=>{for(let n=1;n<=30;n++){await new Promise(r=>{const req=http.get('http://127.0.0.1:'+(3000+n)+'/healthz',{timeout:2000},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const j=JSON.parse(d);m+=j.matches||0;h+=j.humans||0}catch{};r()})});req.on('error',()=>r());req.on('timeout',()=>{req.destroy();r()})})}console.log(m+' '+h)})()
`]);
const [matchCount, humans] = status.out.split(' ').map(Number);
console.log(`  对局 ${matchCount} 局，在线玩家 ${humans} 位`);
console.log('  ⚠ 重启会让这些玩家断线（浏览器自动重连，对局数据不丢）；');
console.log('    从停止到重新可用大约 5–20 秒，本脚本会强制清干净，不会新旧混在一起。');

if (!APPLY) {
  console.log('\n（只报告。加 --apply 才真的重启）');
  process.exit(0);
}

// ---- 1) 优雅停止 ----
// 先放一个「正在重启」标记：server-watchdog 每 60 秒检查 443，发现没监听就会去「救」，
// 与这里的重启打架（2026-10-27 实测 3 分钟内抢了两次）。脚本结束时会删掉它。
const RESTART_HINT = 'D:\\Stronghold-Protocol\\logs\\.nginx-restarting';
ps(`New-Item -ItemType File -Force -Path "${RESTART_HINT}" | Out-Null`);
// 无论怎么退出都清掉标记
process.on('exit', () => {
  try { ps(`Remove-Item -LiteralPath "${RESTART_HINT}" -Force -ErrorAction SilentlyContinue`); } catch { /* ignore */ }
});
// ⚠ nginx 以 SYSTEM 运行时，普通管理员账户发 quit 会被拒绝：
//   `OpenEvent("Global\ngx_quit_<pid>") failed (5: Access is denied)`
//   这不是故障 —— 下面的强制结束会兜住。这里说清楚，免得看到 error 以为脚本坏了。
console.log('\n=== 1) 优雅停止（给正在传输的请求收尾的机会）===');
const quit = run(NGX, ['-p', NGX_DIR + '\\', '-c', 'conf/nginx.conf', '-s', 'quit']);
if (quit.ok) {
  console.log('  quit: OK');
} else {
  const denied = /Access is denied|拒绝访问|OpenEvent/i.test(quit.out);
  console.log('  quit:', denied
    ? '被拒绝（nginx 以 SYSTEM 运行，当前账户没有它的信号权限）→ 交给第 2 步强制结束，属正常'
    : (quit.out.split('\n')[0] || '失败'));
}

// ---- 2) 确认归零；不归零就强杀 —— 关键一步，原版没有 ----
console.log('\n=== 2) 确认进程归零（不归零就强制结束）===');
let left = nginxProcs();
for (let i = 0; i < 10 && left.length; i++) {
  await sleep(1000);
  left = nginxProcs();
  if (left.length) console.log(`  等待中… 还剩 ${left.length} 个`);
}
if (left.length) {
  console.log(`  ${left.length} 个 worker 没有自己退出（nginx 卡住的 worker 不会响应 quit）→ 强制结束`);
  ps("Get-Process nginx -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch {} }");
  await sleep(3000);
  left = nginxProcs();
}
if (left.length) {
  console.log(`\n✗ 仍有 ${left.length} 个 nginx 进程无法结束，**已中止**，没有启动新的（避免新旧混在一起）`);
  left.forEach((p) => console.log(`  pid=${p.pid} session=${p.sid}`));
  process.exit(1);
}
console.log('  ✓ 进程已全部退出');

// ---- 3) 确认 443 释放 ----
console.log('\n=== 3) 确认 443 端口已释放 ===');
let holder = port443();
for (let i = 0; i < 10 && holder; i++) {
  await sleep(500);
  holder = port443();
}
if (holder) {
  console.log(`  ✗ 443 仍被 pid ${holder} 占用，**已中止**`);
  process.exit(1);
}
console.log('  ✓ 443 已释放');

// ---- 4) 用计划任务以 SYSTEM 启动 ----
// 只有在进程真正归零之后触发，新进程才会是一套完整的、落在 Session 0 的实例。
// （若还有残留，_start-nginx.ps1 的「已在运行」保护会直接跳过启动。）
console.log('\n=== 4) 用计划任务启动（SYSTEM / Session 0）===');
const startTask = run('schtasks.exe', ['/Run', '/TN', TASK]);
console.log('  schtasks:', startTask.ok ? 'OK' : (startTask.out.split('\n')[0] || '失败'));
if (!startTask.ok) process.exit(1);

// 等它起来并稳定。
// ⚠ 2026-10-28：原来循环里一旦 after.length 就 break，此时 HTTPS 往往还没开始监听
// （nginx 起进程和 bind 443 之间有一小段），于是校验报 FAIL，但站点其实几秒后就正常。
// 现在必须「端口在监听 + 返回 200」才 break，否则一直等到超时。
let after = [];
let code = 'FAIL';
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  after = nginxProcs();
  if (!after.length) continue;
  fmtWait(i + 1);
  code = httpsStatus();
  if (code === '200') break;
}
function fmtWait(s) { if (s % 5 === 0) console.log(`  启动中… ${s} 秒`); }

// ---- 5) 校验 ----
console.log('\n=== 5) 校验 ===');
after.forEach((p) => {
  console.log(`  pid=${p.pid}  session=${p.sid}${p.sid === '0' ? '  ✓' : '  ✗ 不在 Session 0！'}`);
});
const allZero = after.length > 0 && after.every((p) => p.sid === '0');
// 读不到 worker_processes 时不做上限判断（null → 视为通过），免得用错的数字判失败
const sizeOk = after.length > 0 && (EXPECTED_MAX == null || after.length <= EXPECTED_MAX);
code = httpsStatus();
console.log(`\n  进程数: ${after.length}${sizeOk
  ? (EXPECTED_MAX == null ? '  ✓（未判上限：读不到 worker_processes）' : '  ✓')
  : `  ✗ 期望 ≤ ${EXPECTED_MAX}（还有残留）`}`);
console.log(`  全部在 Session 0: ${allZero ? '✓' : '✗'}`);
console.log(`  HTTPS 首页: ${code}`);

// 素材加载速度（这次事故的直接指标）
let assetOk = false;
if (code === '200') {
  const t = run('node', ['-e', `
const t0=Date.now();
fetch('https://127.0.0.1/assets/local/scene/act2autochess_m01/scene.bin',{headers:{'X-SP-Asset-Cache':'BYPASS'}})
 .then(r=>r.arrayBuffer()).then(b=>console.log(((Date.now()-t0)/1000).toFixed(3)+' '+(b.byteLength/1048576).toFixed(1)))
 .catch(()=>console.log('FAIL'));
`]);
  const [sec, mb] = t.out.trim().split(' ');
  if (sec && sec !== 'FAIL') {
    assetOk = Number(sec) < 5;
    console.log(`  素材加载: ${mb} MB 用时 ${sec} 秒${assetOk ? '  ✓' : '  ⚠ 仍然偏慢（残留 worker 可能没清干净）'}`);
  }
}

const ok = allZero && sizeOk && code === '200';
console.log(ok
  ? '\n✓ nginx 已干净重启：进程数正常、全部在 Session 0、站点 200'
  : '\n⚠ 未达预期，请按上面的 ✗ 逐项检查');
process.exit(ok ? 0 : 1);
