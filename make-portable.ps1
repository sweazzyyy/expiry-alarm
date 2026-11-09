# Builds a portable folder that runs on any Windows PC (works with Smart App Control):
# original signed electron.exe + our app in resources\app
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out  = Join-Path $root 'portable\ExpiryAlarm'
$zip  = Join-Path $root 'portable\ExpiryAlarm.zip'
$dist = Join-Path $root 'node_modules\electron\dist'

if (-not (Test-Path (Join-Path $dist 'electron.exe'))) { throw "Electron not found in $dist" }

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Path $out | Out-Null

Write-Host 'Copying Electron...'
Copy-Item "$dist\*" $out -Recurse
Rename-Item (Join-Path $out 'electron.exe') 'ExpiryAlarm.exe'

Write-Host 'Copying app...'
$app = Join-Path $out 'resources\app'
New-Item -ItemType Directory -Path $app | Out-Null
'package.json','main.js','preload.js','index.html','styles.css','app.js','icon.png' | ForEach-Object {
  Copy-Item (Join-Path $root $_) $app
}

Write-Host 'Creating zip...'
Compress-Archive -Path $out -DestinationPath $zip

Write-Host ''
Write-Host "Done: $zip" -ForegroundColor Green
Write-Host 'On the other PC: unzip, run ExpiryAlarm.exe'
