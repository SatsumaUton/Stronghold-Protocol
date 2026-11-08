# deploy/backup-redis.ps1 — 每日给 Redis 的 dump.rdb 留一份快照（维护者 2026-11-09）。
#
# 为什么需要：房间 / 会话 / 对局检查点全在那一个 dump.rdb 里，而 Redis 的 save 策略是
# `900 1 300 10 60 10000` —— 每几分钟就**覆盖重写**一次。删错了房间（2026-11-09 那次 15 间）
# 没有任何东西可回滚：appendonly=no、没有从库、没有卷影副本，MySQL 的每日备份也不含 Redis。
#
# 成本几乎为零（dump.rdb 才 ~270 KB），保留 7 天。
# 由计划任务 SP-Redis-Backup 以 SYSTEM 身份每天 04:10 调用（排在 SP-DB-Backup 04:00 之后）。
$ErrorActionPreference = 'SilentlyContinue'

$redisDir = 'D:\Redis'
$outDir = 'D:\Stronghold-Protocol\backups\redis'
$redisCli = Join-Path $redisDir 'redis-cli.exe'
$keepDays = 7

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 1) 先让 Redis 落一次盘（BGSAVE 是后台做，LASTSAVE 变了才说明写完了）
$before = (& $redisCli LASTSAVE 2>$null)
& $redisCli BGSAVE 2>$null | Out-Null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  $now = (& $redisCli LASTSAVE 2>$null)
  if ($now -and $now -ne $before) { break }
}

# 2) 复制一份带日期的快照
$ts = (Get-Date).ToString('yyyyMMdd-HHmm')
$src = Join-Path $redisDir 'dump.rdb'
# ⚠ 必须是 ${ts}：PowerShell 里 "$ts.rdb" 会解析成「$ts 的 .rdb 属性」，结果文件名变成 dump-.rdb（实测踩到）
$dst = Join-Path $outDir ("dump-{0}.rdb" -f $ts)
if (-not (Test-Path -LiteralPath $src)) { Write-Output 'backup failed: dump.rdb missing'; exit 1 }
Copy-Item -LiteralPath $src -Destination $dst -Force
if (-not (Test-Path -LiteralPath $dst)) { Write-Output "backup failed: copy to $dst"; exit 1 }

# 3) 校验：文件头必须是 REDIS（别把一个写了一半的文件当备份）
$head = [System.IO.File]::ReadAllBytes($dst)[0..4]
$magic = -join ($head | ForEach-Object { [char]$_ })
if ($magic -ne 'REDIS') { Remove-Item -LiteralPath $dst -Force; Write-Output "backup failed: bad magic '$magic'"; exit 1 }

# 4) 只留 7 天
Get-ChildItem (Join-Path $outDir 'dump-*.rdb') | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepDays) } | Remove-Item -Force

$size = (Get-Item -LiteralPath $dst).Length
Write-Output ("redis backup ok: {0} ({1} bytes)" -f $dst, $size)
