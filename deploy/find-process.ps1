# deploy\find-process.ps1 - process-creation forensics (2026-11-22)
#
# Why: on 2026-11-22 someone ran "pm2 update", which emptied dump.pm2 and took
#   30 nodes + matchmaker + dashboard offline for 53 minutes (players: "the web page will not load").
#   We could not find who did it: Windows "Audit Process Creation" was off, so the
#   Security log held no 4688 events at all.
#
#   Enabled the same day (see MAINTENANCE section 9.9c):
#     - auditpol process creation = Success
#     - ProcessCreationIncludeCmdLine_Enabled = 1   (without it 4688 has no command line)
#     - Security log 20 MB -> 512 MB                (Circular at 20 MB lost evidence within hours)
#
# Usage:
#   powershell -File deploy\find-process.ps1 -Pattern pm2
#   powershell -File deploy\find-process.ps1 -Pattern "pm2 update" -Hours 24
#   powershell -File deploy\find-process.ps1 -Pattern node.exe -Hours 1 -Limit 40
#
# Prints, one block per hit: time, account, new process, PARENT process, command line.

param(
  [Parameter(Mandatory = $true)][string]$Pattern,
  [int]$Hours = 12,
  [int]$Limit = 30
)

$ErrorActionPreference = 'SilentlyContinue'
$since = (Get-Date).AddHours(-1 * [Math]::Abs($Hours))

# Say so when the audit policy is off, otherwise an empty result reads as "it never happened"
$policy = (auditpol /get /subcategory:"{0CCE922B-69AE-11D9-BED3-505054503030}") -join " "
if ($policy -notmatch 'Success') {
  Write-Host 'WARNING: process-creation auditing is OFF - an empty result does not mean it did not happen.' -ForegroundColor Yellow
  Write-Host 'See MAINTENANCE section 9.9c for how to enable it.' -ForegroundColor Yellow
}

$events = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4688; StartTime = $since } -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match $Pattern } |
  Select-Object -First $Limit

if (-not $events) {
  Write-Host ("No process-creation event matched '{0}' in the last {1} hour(s)." -f $Pattern, $Hours)
  exit 0
}

Write-Host ("Matched '{0}': {1} event(s) in the last {2} hour(s)" -f $Pattern, @($events).Count, $Hours) -ForegroundColor Cyan
Write-Host ''

foreach ($e in $events) {
  $p = @($e.Properties | ForEach-Object { [string]$_.Value })
  # 4688 field order: SubjectUserSid, SubjectUserName, SubjectDomainName, SubjectLogonId,
  #   NewProcessId, NewProcessName, TokenElevationType, ProcessId, CommandLine, TargetUserSid,
  #   TargetUserName, TargetDomainName, TargetLogonId, CreatorProcessId, CreatorProcessName
  $when = $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
  $who = $p[1] + '\' + $p[2]
  Write-Host ($when + "  " + $who)
  Write-Host ('    new     : ' + $p[5])
  Write-Host ('    parent  : ' + $p[13])
  Write-Host ('    cmdline : ' + $p[8])
  Write-Host ''
}
