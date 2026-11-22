# deploy\archive-security-audit.ps1 - snapshot the Security log to D: (2026-11-22)
#
# Why: the Security event log CANNOT be relocated. Security.evtx is fixed at
#   %SystemRoot%\System32\Winevt\Logs\ , held by LSA; "wevtutil sl Security /lfn:D:\..." is refused
#   (only logs you create yourself may live on another drive).
#
#   So the practical equivalent: keep the LIVE log on C: as a rolling buffer (512 MB,
#   Circular) and snapshot it to D: on a schedule, with retention. The archived .evtx files
#   are ordinary event logs - query them with:
#     Get-WinEvent -Path D:\Stronghold-Protocol\logs\security\Security-20261122-0300.evtx -FilterXPath "*[System[(EventID=4688)]]"
#   or with deploy\find-process.ps1 -File <archive>
#
# Usage:
#   powershell -File deploy\archive-security-audit.ps1                 # snapshot now
#   powershell -File deploy\archive-security-audit.ps1 -KeepDays 365  # retention (default 180)
#   powershell -File deploy\archive-security-audit.ps1 -WhatIf        # show, do nothing
#
# Scheduled task: SP-Audit-Archive (SYSTEM, daily 03:00).

param(
  [int]$KeepDays = 180,
  [string]$OutDir = "D:\Stronghold-Protocol\logs\security",
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$text) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $text
  Write-Host $line
  try {
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
    $line | Out-File -FilePath (Join-Path $OutDir 'archive.log') -Append -Encoding utf8
  } catch { }
}

if (-not (Test-Path $OutDir)) {
  if ($WhatIf) { Write-Host "WhatIf: would create $OutDir" }
  else { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutDir ("Security-" + $stamp + ".evtx")

if ($WhatIf) {
  Write-Log ("WhatIf: would export Security to " + $target)
} else {
  # wevtutil writes a real .evtx snapshot; Get-WinEvent can query it later
  try {
    & wevtutil epl Security $target
    if (Test-Path $target) {
      $mb = [Math]::Round((Get-Item $target).Length / 1MB, 2)
      Write-Log ("snapshot ok: " + $target + " (" + $mb + " MB)")
    } else {
      Write-Log ("snapshot produced no file: " + $target)
    }
  } catch {
    Write-Log ("snapshot failed: " + $_.Exception.Message)
    exit 1
  }
}

# retention: drop snapshots older than KeepDays
$cutoff = (Get-Date).AddDays(-1 * [Math]::Abs($KeepDays))
$old = Get-ChildItem -Path $OutDir -Filter 'Security-*.evtx' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff }
foreach ($f in $old) {
  if ($WhatIf) { Write-Host ("WhatIf: would delete " + $f.Name) }
  else {
    try { Remove-Item $f.FullName -Force; Write-Log ("removed old snapshot: " + $f.Name) }
    catch { Write-Log ("cannot remove " + $f.Name + ": " + $_.Exception.Message) }
  }
}

$kept = @(Get-ChildItem -Path $OutDir -Filter "Security-*.evtx" -ErrorAction SilentlyContinue)
$totalMb = [Math]::Round((($kept | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Log ("done: " + $kept.Count + " snapshot(s), " + $totalMb + " MB in " + $OutDir)
