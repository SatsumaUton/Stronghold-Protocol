# deploy\collect-process-audit.ps1 - write process-creation audit to a LOG FILE ON D: (2026-11-23)
#
# Why: Security.evtx cannot be relocated (fixed at %SystemRoot%\System32\Winevt\Logs, held by LSA).
#   So this script makes D: the real log store: it reads the 4688 events the audit policy produces
#   and APPENDS them, incrementally, to a plain-text log on D: - one JSON object per line, greppable.
#
#   C:\...\Security.evtx  = rolling buffer (128 MB, Circular)   - short-term, managed by Windows
#   D:\...\logs\security\process-audit-<yyyyMMdd>.log = THE LOG  - long-term, plain text
#
# State: .last-collected.json remembers the last RecordId + time so runs never duplicate or skip.
# Scheduled task: SP-Audit-Collect (SYSTEM, every 5 minutes).
#
# Usage:
#   powershell -File deploy\collect-process-audit.ps1              # collect new events
#   powershell -File deploy\collect-process-audit.ps1 -BackfillHours 24   # first run: fill a day
#   powershell -File deploy\collect-process-audit.ps1 -WhatIf       # show, write nothing

param(
  [int]$BackfillHours = 2,
  [int]$MaxEvents = 20000,
  [int]$KeepDays = 180,
  [string]$OutDir = "D:\Stronghold-Protocol\logs\security",
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutDir)) {
  if ($WhatIf) { Write-Host "WhatIf: would create $OutDir" } else { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
}

$stateFile = Join-Path $OutDir ".last-collected.json"
$state = $null
if (Test-Path $stateFile) {
  try { $state = Get-Content $stateFile -Raw | ConvertFrom-Json } catch { $state = $null }
}

if ($state -and $state.lastTime) {
  $since = [datetime]::Parse($state.lastTime)
  $lastId = [long]$state.lastId
} else {
  $since = (Get-Date).AddHours(-1 * [Math]::Abs($BackfillHours))
  $lastId = 0
}

$events = Get-WinEvent -FilterHashtable @{ LogName = "Security"; Id = 4688; StartTime = $since } -ErrorAction SilentlyContinue |
  Sort-Object RecordId |
  Where-Object { $_.RecordId -gt $lastId } |
  Select-Object -First $MaxEvents

$count = 0
$maxId = $lastId
$maxTime = $since
foreach ($e in @($events)) {
  $p = @($e.Properties | ForEach-Object { [string]$_.Value })
  $rec = [ordered]@{
    t      = $e.TimeCreated.ToString("yyyy-MM-dd HH:mm:ss")
    rid    = $e.RecordId
    user   = $p[2] + "\" + $p[1]
    pid    = $p[4]
    proc   = $p[5]
    ppid   = $p[7]
    parent = $p[13]
    cmd    = $p[8]
  }
  $line = ($rec | ConvertTo-Json -Compress)
  if (-not $WhatIf) {
    $dayFile = Join-Path $OutDir ("process-audit-" + $e.TimeCreated.ToString("yyyyMMdd") + ".log")
    Add-Content -Path $dayFile -Value $line -Encoding utf8
  } else {
    Write-Host ("WhatIf: " + $line)
  }
  $count++
  if ($e.RecordId -gt $maxId) { $maxId = $e.RecordId }
  if ($e.TimeCreated -gt $maxTime) { $maxTime = $e.TimeCreated }
}

if (-not $WhatIf -and $count -gt 0) {
  $out = [ordered]@{ lastId = $maxId; lastTime = $maxTime.ToString("o") }
  $out | ConvertTo-Json -Compress | Set-Content -Path $stateFile -Encoding utf8
}

# retention on the D: log files
$cutoff = (Get-Date).AddDays(-1 * [Math]::Abs($KeepDays))
$old = Get-ChildItem -Path $OutDir -Filter "process-audit-*.log" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff }
foreach ($f in $old) {
  if ($WhatIf) { Write-Host ("WhatIf: would delete " + $f.Name) }
  else { try { Remove-Item $f.FullName -Force } catch { } }
}

if ($count -gt 0 -or $old) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $msg = "[" + $stamp + "] collected " + $count + " event(s), lastRecordId=" + $maxId + ", removed " + @($old).Count + " old file(s)"
  Write-Host $msg
  try { $msg | Out-File -FilePath (Join-Path $OutDir "collect.log") -Append -Encoding utf8 } catch { }
}
