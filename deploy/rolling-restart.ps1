# 等节点空闲时逐个重启，让新的 server/ 代码生效。
#
# 背景（2026-10-28）：server/ 下的改动（例如 lobby.js 的座位保护）**必须重启节点**
# 才生效。而重启会打断对局，所以只能在节点空闲时做。
#
# 这个脚本每 30 分钟跑一次：找出「跑着旧代码 + 当前没有对局也没有连接」的节点，
# 逐个 startOrReload。有玩家在的节点一律跳过 —— 重启纪律不变。
#
# 由计划任务 SP-Rolling-Restart 以 SYSTEM 身份每 30 分钟调用。
$ErrorActionPreference = 'SilentlyContinue'
$root = 'D:\Stronghold-Protocol'
$log = Join-Path $root 'logs\rolling-restart.log'
$marker = Join-Path $root 'data\rolling-restart-disabled'
$pm2 = Join-Path $env:APPDATA '..\..\npm\pm2.cmd'
if (-not (Test-Path $pm2)) { $pm2 = 'C:\Users\Administrator\AppData\Roaming\npm\pm2.cmd' }

function Write-Log([string]$text) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}

# 一键关闭开关（维护者要求人性化停止）
if (Test-Path -LiteralPath $marker) { exit 0 }

# ---- 1) 新代码的时间：server/ 下最新的 .js ----
# ⚠ 2026-10-29：这里原来只取最新 mtime。问题是 `sync-nodes --apply` 每分发一次就会
#   刷新 mtime（即使内容一模一样），于是 codeAt 不断前移，而进程启动时间不动，
#   节点就永远被判成「旧代码」。node-8/10/30 因此卡了 23 小时没被重启：
#   每次都判旧、又恰好轮流有对局，一直等不到窗口。
#   现在补一层内容指纹：server/ 树内容没变就把 codeAt 压回部署时刻，避免无意义重启。
$serverDir = Join-Path $root 'node-1\server'
# 单行：5.1 对管道跨行续行（行尾 | 后换行）容易出问题，实测会算出 null 然后静默 exit。
$newest = Get-ChildItem $serverDir -Recurse -File -Filter '*.js' | Measure-Object LastWriteTime -Maximum
$codeAt = $newest.Maximum
if (-not $codeAt) { Write-Log 'cannot read code mtime -> skip'; exit 0 }

$stampPath = Join-Path $root 'content\rolling-code-stamp.json'
# ⚠ 2026-10-29：这段踩了三个 5.1 的坑，记录一下别再犯：
#   ① Get-FileHash 逐文件调用 537 次，实测卡到几分钟不出结果；
#   ② `$ErrorActionPreference='SilentlyContinue'` 会把异常全吞掉，指纹算不出来时
#      脚本只是「无候选」退出，看不出任何异常 —— 所以下面临时改成 Stop；
#   ③ `[System.Text.Encoding]::UTF8.GetBytes()` / `[System.Text.Encoding]::UTF8` 这种
#      静态属性访问在计划任务的精简环境下可能返回 null，于是 `.Length` 直接抛
#      「You cannot call a method on a null-valued expression」。
#   改成纯 PowerShell 的字符串拼接 + Get-FileHash 之外的哈希：用 .NET 的 SHA256
#   但输入交给 [System.IO.File]::ReadAllBytes 的返回值拼成字符串再算。
#   实测 537 文件约 1 秒。
$ErrorActionPreference = 'Stop'
try {
  $parts = New-Object System.Collections.Generic.List[string]
  $shaF = [System.Security.Cryptography.SHA256]::Create()
  if ($null -eq $shaF) { throw 'SHA256.Create returned null' }
  foreach ($f in (Get-ChildItem $serverDir -Recurse -File -Filter '*.js' | Sort-Object FullName)) {
    $rel8 = $f.FullName.Substring($serverDir.Length)
    # 不用 Get-FileHash：它来自 Microsoft.PowerShell.Utility 模块，在计划任务的
    # 精简环境里可能整个模块都没加载（实测报 "Get-FileHash is not recognized"）。
    # 直接用 .NET 的 SHA256 读字节算，任何宿主都可用。
    $b = [System.IO.File]::ReadAllBytes($f.FullName)
    $h = [System.BitConverter]::ToString($shaF.ComputeHash($b)).Replace('-', '').ToLower()
    $parts.Add($rel8 + '=' + $h)
  }
  $joined = [string]::Join(';', $parts)
  # ⚠ 三个 5.1 的坑，全部实测踩过（2026-10-29）：
  #   ① [System.Text.Encoding]::UTF8.GetBytes() 在某些宿主下返回 null；
  #   ② New-Object System.Text.UTF8Encoding $false —— 位置参数传 $false 会静默返回 null；
  #   ③ 上面两种失败都被全局 SilentlyContinue 吞掉，表现成「无候选直接退出」。
  #   所以用 -ArgumentList 显式传参，并在拿不到对象时立刻抛出。
  #   ⚠ throw 的消息保持 ASCII：本文件若无 BOM，5.1 会按 GBK 解析中文，
  #     引号和括号配对会错乱、整个脚本语法崩掉（这是 2026-10-29 真正的元凶）。
  $enc = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList @($false)
  if ($null -eq $enc) { throw 'UTF8Encoding ctor returned null' }
  $fpBytes = $enc.GetBytes($joined)
  if ($null -eq $fpBytes) { throw 'UTF8Encoding.GetBytes returned null' }
  $fingerprint = [System.BitConverter]::ToString($shaF.ComputeHash($fpBytes)).Replace('-', '').ToLower()
  $shaF.Dispose()
} catch {
  Write-Log ('fingerprint error: ' + $_.Exception.Message)
  $fingerprint = ''
}
$ErrorActionPreference = 'SilentlyContinue'
if (-not $fingerprint) {
  Write-Log 'fingerprint failed -> fall back to mtime (no stamp written)'
  $fingerprint = ''
}

$oldStamp = $null
try {
  if (Test-Path -LiteralPath $stampPath) {
    $oldStamp = Get-Content -LiteralPath $stampPath -Raw | ConvertFrom-Json
  }
} catch { $oldStamp = $null }

if ($oldStamp -and $fingerprint -and $oldStamp.fingerprint -eq $fingerprint -and $oldStamp.at) {
  # 内容没变：沿用上次记录的部署时刻，不让刷新过的 mtime 造成误判
  # ★★ 2026-11-01 修正（维护者反复被「连接已中断」打扰的根因）：
  #   这里原本是 `$codeAt = [datetime]::Parse($oldStamp.at)` —— 用的是**脚本发现变化的那一刻**
  #   （`at` 是 Write-Log 时的 Get-Date），而不是**代码文件的真实 mtime**。
  #
  #   实测踩到的例子：
  #     代码实际改于 23:10:55，但脚本 23:22:02 才跑到这一轮 → stamp.at = 23:22:02
  #     于是「进程启动 ≥ 23:22」才算新代码。
  #     而 node-16 是 23:12 启动的（比代码新 1 分钟，完全是最新代码）→ 被判成「旧代码」→ 被重启。
  #     结果是脚本无意义地反复重启已经最新的节点，玩家一直在看「连接已中断」。
  #
  #   正确做法：`at` 只用来判断「内容有没有变过」，判断新旧一律用**代码 mtime**（$codeAt 上面已算好）。
  #   `$newest.Maximum` 取的是 node-1\server 下最新 .js 的 mtime —— 那才是这批代码的部署时刻。
  #   为了容错：万一带 at 的 timestamp 比真实 mtime 还早（时钟回拨等），取**较晚**的那个，
  #   保证不会把「确实比代码旧」的进程误判成新。
  $stampAt = $null
  try { $stampAt = [datetime]::Parse($oldStamp.at) } catch { $stampAt = $null }
  if ($stampAt -and $stampAt -lt $codeAt) {
    # 上次记的「发现时刻」比代码 mtime 还早：说明 mtime 被刷新过（sync-nodes 重写过文件）。
    # 这种情况仍沿用 stamp.at（它代表「这批内容最早什么时候就已经到位」），避免把已经重启过的节点再判一遍。
    $codeAt = $stampAt
  }
  # 否则保留上面算出的 $codeAt（真实 mtime），不要用 stamp.at 覆盖它。
} elseif ($fingerprint) {
  # 内容变了（或首次运行）：记下这一次的发现时刻
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stampPath) | Out-Null
  $stampObj = [ordered]@{ fingerprint = $fingerprint; at = (Get-Date).ToString('o') }
  ($stampObj | ConvertTo-Json) | Set-Content -LiteralPath $stampPath -Encoding UTF8
  Write-Log ('server/ content changed -> new stamp ' + $fingerprint.Substring(0, 12))
}

# ---- 2) 每个节点的进程启动时间 ----
$tmp = Join-Path $env:TEMP 'sp-rolling.json'
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
$null = & cmd.exe /c ('""' + $pm2 + '" jlist > "' + $tmp + '" 2>nul"')
if (-not (Test-Path -LiteralPath $tmp) -or (Get-Item -LiteralPath $tmp).Length -lt 1000) {
  Write-Log 'cannot read pm2 status -> skip'
  exit 0
}
$started = @{}
try {
  # ⚠ 两个坑，都是 2026-10-28 踩到的：
  #   ① pm2 的 jlist 里同时有 username / USERNAME 两个键，ConvertFrom-Json 会抛
  #      「无法转换 JSON 字符串，因为它包含具有不同大小写的键」。
  #   ② `-AsHashtable` 是 PowerShell **7** 的参数。本脚本由计划任务以 SYSTEM 运行时用的是
  #      `WindowsPowerShell\v1.0\powershell.exe`（5.1），传它会报
  #      「找不到与参数名称 AsHashtable 匹配的参数」。
  #   所以先把重复的大小写键名改写掉，再用 5.1 也能解析的普通 ConvertFrom-Json。
  $raw = Get-Content -LiteralPath $tmp -Raw
  $raw = $raw -replace '"username"\s*:', '"user_name_lc":'
  $raw = $raw -replace '"USERNAME"\s*:', '"user_name_uc":'
  $raw = $raw -replace '"USERPROFILE"\s*:', '"user_profile_uc":'
  $j = $raw | ConvertFrom-Json
  foreach ($a in @($j)) {
    $name = [string]$a.name
    if (-not ($name -match '^node-(\d+)$')) { continue }
    $n = [int]$Matches[1]
    $up = $a.pm2_env.pm_uptime
    if ($up) { $started[$n] = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$up).LocalDateTime }
  }
} catch {
  Write-Log ('pm2 json unreadable -> skip: ' + $_.Exception.Message)
  exit 0
}
if ($started.Count -eq 0) { Write-Log 'no node processes visible -> skip'; exit 0 }

# ---- 3) 找出「旧代码 + 完全空闲」的节点 ----
$candidates = @()
# ★★ 2026-11-01 第二次修正（维护者反复看到「连接已中断」的根因）：
#   原判定只有一条 `进程启动时间 >= $codeAt`，凭它决定「是不是新代码」。单独用两个方向都会错：
#
#   ① 误判成「旧代码」→ 白重启（维护者感受到的正是这个）
#      代码 mtime 23:10:55，而 node-16 是 23:12 启动的 —— 明明是最新代码；
#      只要 $codeAt 被算成 23:22（脚本自己的发现时刻），它就被判旧 → 重启 → 玩家断线。
#
#   ② 误判成「新代码」→ 漏重启
#      /healthz 的 build **不含 server/*.js**（BUILD_INPUTS 只有 public/、server/sim、shared、data），
#      所以「build 相同」不能证明 lobby.js / match.js 是新的。
#
#   正确判据 = **两个条件都满足**才算新代码：
#       (a) 进程启动时间 >= server/ 的真实 mtime（$codeAt）  —— 覆盖 server/*.js
#       (b) /healthz 的 build 与多数派一致                    —— 覆盖 public/、shared、data、server/sim
#   两者互补，缺一个都不够。
#
#   多数派 build = 30 个节点里出现次数最多的那个。比「拿某个节点当基准」稳：单点重启不会动摇多数派。
# ★★ 2026-11-02 第三次修正（**重启死循环**的根因）：
#
#   症状：node-10 / node-13 / node-25 每 10 分钟被重启一次，玩家反复「连接已中断」，
#         而这三个节点 error.log 是 0 字节、restart-watch 全程 ok、进程每次都正常起来
#         —— 不是崩溃，是**被这个脚本判成「旧代码」**。
#
#   根因：上面 (b) 用的是 /healthz 的 build，而那个值是**进程启动时算一次就缓存**的
#         （buildTag.js 的 buildCache：「files changing on disk do not advertise a new
#         build before restart」）。于是：
#
#           26 个节点 24 小时前启动 → 缓存 db206a112ca2
#           磁盘这 24 小时一直在改   → 当前实算 e00a8dc6b16b
#           任何节点重启 → 用当前磁盘重算 → 得到 e00a8dc6b16b
#           e00a8dc6b16b ≠ db206a112ca2（陈旧多数派）→ 下一轮又判 stale → 再重启
#
#         结果就是**自我维持的死循环**：越重启越偏离多数派，越偏离越被判旧。
#         而且这个多数派永远追不上磁盘，除非把 26 个节点全部重启一遍。
#
#   修法：多数派**不再取运行时缓存的众数**，改为**磁盘当前实算的 build**
#         （直接调用节点自己的 computeBuildTag，口径与 /healthz 完全一致）。
#         基准描述「这批文件现在是什么版本」，与任何进程何时启动无关，
#         所以重启不会让节点偏离基准，循环消失。
#
#   为什么保留 (a)：build **不含 server/*.js**（BUILD_INPUTS 只有 public/、server/sim、
#         shared、data），所以 build 一致仍不能证明 lobby.js / match.js 是新的。
#         (a) 覆盖 server/*.js，(b) 覆盖其余四棵树，两者互补，缺一不可。
$health = @{}
for ($n = 1; $n -le 30; $n++) {
  if (-not $started.ContainsKey($n)) { continue }
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$((3000 + $n))/healthz?traffic=1" -TimeoutSec 3
  } catch { continue }
  $health[$n] = $h
}

# ---- 3a) 基准 build：磁盘当前实算（不是运行时缓存）----
# 用节点自己的 computeBuildTag 算，保证与 /healthz 的口径逐字节一致。
#
# ⚠ 必须传 servedVersionDirs（index.js:203 就是这么调的）：
#   buildTag.js:83 只把「本进程实际服务的」data/versions/<slug>/ 计入指纹，
#   漏传这个参数会把三个版本目录全排除，算出一个**根本不存在**的值。
#   实测（2026-11-02）：漏传得 e00a8dc6b16b（无任何节点在跑），
#   传对得 00c10f37d21e（正是刚重启过的节点的真实值）。
#
# 版本列表从 /healthz 的 versions.enabled 里取：**排除 default 之后**剩下的，
# 就是 server/versions.js servedDirs() 的 `[...others.values()]`。
# 目录名规则（实测 data/versions/）：`act2autochess@V2_1` -> `act2autochess-v2_1`（后缀小写）。
$servedSlugs = @()
foreach ($n in $health.Keys) {
  $en = @($health[$n].versions.enabled)
  $def = [string]$health[$n].versions.default
  if (-not $en -or $en.Count -eq 0) { continue }
  foreach ($v in $en) {
    $id = [string]$v
    if ($id -eq $def) { continue }                      # others 不含默认版本
    $slug = $id
    if ($id -match '^(.+)@(.+)$') {
      $slug = $Matches[1] + '-' + $Matches[2].ToLower()  # act2autochess@V2_1 -> act2autochess-v2_1
    }
    if ($servedSlugs -notcontains $slug) { $servedSlugs += $slug }
  }
  break   # 取任一节点的列表即可，30 个节点配置相同
}

# node 的位置：优先 PATH（计划任务的 SYSTEM 环境通常已含），再退回常见安装目录。
# 不在代码里写死本机绝对路径（仓库是公开的，见 MAINTENANCE §十-7）。
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
  foreach ($cand in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
    if ($cand -and (Test-Path -LiteralPath $cand)) { $nodeExe = $cand; break }
  }
}
$majorityBuild = $null
$majorityN = 0
$buildSource = 'runtime'
if ($nodeExe) {
  try {
    # 探测脚本在 node-1 目录下算；node-1 若与其余节点只有 mtime 精度差异，
    # 会算出另一个值 —— 所以下面用「多数节点一致的值」而不是单点值。
    # ⚠ 探测脚本写在 %TEMP% 里，相对路径会按 TEMP 解析而找不到模块（实测 ERR_MODULE_NOT_FOUND），
    #   所以 import 和 root 一律用绝对路径。
    $rootEsc = $root.Replace('\', '/')
    $slugList = ($servedSlugs | ForEach-Object { "'$_'" }) -join ','
    $probe = @"
import { computeBuildTag } from 'file:///$rootEsc/node-1/server/http/buildTag.js';
import path from 'path';
const root = '$rootEsc';
const slugs = [$slugList];
const counts = {};
for (let n = 1; n <= 30; n++) {
  const dirs = slugs.map((s) => path.resolve(root + '/node-' + n + '/data/versions/' + s));
  const t = computeBuildTag(root + '/node-' + n, { servedVersionDirs: dirs });
  if (t) counts[t] = (counts[t] || 0) + 1;
}
let best = null, bestN = 0;
for (const [t, c] of Object.entries(counts)) if (c > bestN) { best = t; bestN = c; }
console.log(best || '');
"@
    $probePath = Join-Path $env:TEMP 'sp-buildtag-probe.mjs'
    Set-Content -LiteralPath $probePath -Value $probe -Encoding UTF8
    $tag = (& $nodeExe $probePath 2>$null | Select-Object -First 1)
    if ($tag) { $tag = $tag.Trim() }
    if ($tag -and $tag -match '^[0-9a-f]{12}$') {
      $majorityBuild = $tag
      $buildSource = 'disk'
      $majorityN = 0
    }
  } catch { /* 落回运行时众数 */ }
}

if (-not $majorityBuild) {
  # 兜底：退回旧口径（运行时众数），并明确记日志，避免静默走错分支
  $buildCount = @{}
  foreach ($n in $health.Keys) {
    $b = $health[$n].build
    if ($b) { if ($buildCount.ContainsKey($b)) { $buildCount[$b]++ } else { $buildCount[$b] = 1 } }
  }
  foreach ($k in $buildCount.Keys) {
    if ($buildCount[$k] -gt $majorityN) { $majorityN = $buildCount[$k]; $majorityBuild = $k }
  }
  $buildSource = 'runtime-fallback'
}

if ($majorityBuild) {
  Write-Log ('baseline build ' + $majorityBuild.Substring(0, [Math]::Min(12, $majorityBuild.Length)) + ' (from ' + $buildSource + ')')
} else {
  Write-Log 'baseline build unavailable -> build check disabled this round'
}

$candidates = @()
for ($n = 1; $n -le 30; $n++) {
  if (-not $started.ContainsKey($n)) { continue }        # 进程都看不到，不动
  if (-not $health.ContainsKey($n)) { continue }         # 无响应，不动
  $h = $health[$n]
  $newByMtime = ($started[$n] -ge $codeAt)               # (a) 进程比 server/ 代码新？
  $newByBuild = [bool]($majorityBuild -and $h.build -eq $majorityBuild)   # (b) build 与多数派一致？
  if ($newByMtime -and $newByBuild) { continue }         # 两个都满足 ⇒ 确实是新代码
  # 重启纪律：有对局或有任何连接都不碰
  if ([int]$h.matches -ne 0) { continue }
  if ([int]$h.sockets -ne 0) { continue }
  if ([int]$h.rooms -ne 0) { continue }
  $why = @()
  if (-not $newByMtime) { $why += 'mtime' }
  if (-not $newByBuild) { $why += 'build' }
  Write-Log ('stale node-' + $n + ' (' + ($why -join '+') + ')')
  $candidates += $n
}

if ($candidates.Count -eq 0) { exit 0 }   # 没有可动的，不写日志避免噪音

# ---- 4) 逐个重启（每轮最多 6 个，避免一次抖动太大）----
# ★ 2026-11-02：观察模式开关。`data\rolling-restart-observe` 存在时**只判定不重启**，
#   每轮把「本会重启谁」写进日志。用于新判据上线后先核对一轮，确认无误再放开。
#   这个开关比「把 6 改成 0」安全：日志会明确写出 observe 状态，不会静默失效。
$observe = Test-Path -LiteralPath (Join-Path $root 'data\rolling-restart-observe')
$maxBatch = 6
$batch = $candidates | Select-Object -First $maxBatch
if ($observe) {
  Write-Log ('OBSERVE ONLY (no restart): would restart ' + $batch.Count + '/' + $candidates.Count + ' -> ' + (($batch | ForEach-Object { "node-$_" }) -join ',') + ' [all candidates: ' + ($candidates -join ',') + ']')
  exit 0
}
$names = ($batch | ForEach-Object { "node-$_" }) -join ','
Write-Log ('idle + old code: ' + ($batch -join ',') + ' -> startOrReload')

$out = & cmd.exe /c ('""' + $pm2 + '" startOrReload "' + (Join-Path $root 'ecosystem.config.cjs') + '" --only ' + $names + ' --update-env 2>&1"')
$code = $LASTEXITCODE
if ($code -ne 0 -or ($out -join "`n") -match '\[PM2\]\[ERROR\]') {
  Write-Log ('ALERT startOrReload failed: ' + (($out | Select-Object -Last 3) -join ' '))
  exit 0
}
$null = & cmd.exe /c ('""' + $pm2 + '" save >nul 2>nul"')

Start-Sleep -Seconds 8

# ---- 5) 复查 ----
$okn = 0
foreach ($n in $batch) {
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$((3000 + $n))/healthz" -TimeoutSec 5
    if ([int]$h.uptimeSec -lt 120) { $okn++ }
  } catch { Write-Log ("node-$n did not come back") }
}
Write-Log ('restarted ' + $okn + '/' + $batch.Count + ' (' + ($batch -join ',') + ')')
