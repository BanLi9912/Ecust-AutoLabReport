# Start an Edge instance with CDP enabled, reusing the login state of the normal profile.
# Edge 136+ refuses --remote-debugging-port on the default user-data-dir, so we use a separate
# profile directory. Keep that path ASCII: a non-ASCII path silently breaks the debug port.
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-edge.ps1 -Url "https://chemzoo.ecust.edu.cn/..." [-Port 9222]
param(
  [string]$Url = 'https://chemzoo.ecust.edu.cn/#/home/eln/notebooks',
  [int]$Port = 9222,
  [string]$Profile = 'C:\edge-dbg'
)
$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$real = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'

# 0) Already listening? reuse.
$busy = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($busy) { Write-Host "[i] port $Port already listening - reuse"; exit 0 }

# 1) Copy minimal login state (site keeps its token in localStorage, cookies are usually locked).
$pairs = @(
  @{S = "$real\Local State"; D = "$Profile\Local State"},
  @{S = "$real\Default\Preferences"; D = "$Profile\Default\Preferences"}
)
foreach ($p in $pairs) {
  if (-not (Test-Path -LiteralPath $p.S)) { continue }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p.D) | Out-Null
  try { [System.IO.File]::WriteAllBytes($p.D, [System.IO.File]::ReadAllBytes($p.S)) }
  catch { Write-Warning "skip $($p.S): $($_.Exception.Message)" }
}
$dirs = @('Local Storage\leveldb', 'Session Storage')
foreach ($d in $dirs) {
  $s = Join-Path $real "Default\$d"
  if (-not (Test-Path -LiteralPath $s)) { continue }
  $t = Join-Path $Profile "Default\$d"
  New-Item -ItemType Directory -Force -Path $t | Out-Null
  Get-ChildItem -LiteralPath $s -File -ErrorAction SilentlyContinue | ForEach-Object {
    try { Copy-Item -LiteralPath $_.FullName -Destination $t -Force -ErrorAction Stop } catch {}
  }
}

# 2) Launch with an isolated profile so the debug port is allowed.
$args = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$Profile",
  '--no-first-run',
  '--no-default-browser-check',
  $Url
)
Start-Process -FilePath $edge -ArgumentList $args | Out-Null

# 3) Wait for CDP.
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $v = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    Write-Host "[ok] CDP ready: $($v.Browser)"
    exit 0
  } catch {}
}
Write-Warning 'CDP port did not come up within 20s'
exit 1
