$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$localRcedit = Join-Path $repoRoot "node_modules\electron-winstaller\vendor\rcedit.exe"
$backendDir = Join-Path $repoRoot "backend"
$backendPayload = Join-Path $repoRoot "build\backend-payload.zip"
$sevenZip = Join-Path $repoRoot "node_modules\7zip-bin\win\x64\7za.exe"

if (-not (Test-Path -LiteralPath (Join-Path $backendDir "vcclient-beatrice\dist\main\main.exe"))) {
  throw "Missing packaged Beatrice engine at backend\vcclient-beatrice\dist\main\main.exe"
}

if (-not (Test-Path -LiteralPath (Join-Path $backendDir "voice-mode\manifest.json"))) {
  throw "Missing voice-mode manifest at backend\voice-mode\manifest.json"
}

if (-not (Test-Path -LiteralPath $sevenZip)) {
  throw "Missing 7za.exe at $sevenZip"
}

Remove-Item -LiteralPath $backendPayload -Force -ErrorAction SilentlyContinue
Push-Location $backendDir
try {
  Write-Host "Creating backend payload archive: $backendPayload"
  & $sevenZip a -tzip -mx=1 $backendPayload `
    start_http.bat `
    README.md `
    sync_voice_mode_models.py `
    native-client-headless-stub.exe `
    vcclient-beatrice `
    voice-mode `
    '-xr!*.log' `
    '-xr!tmp_dir' `
    '-xr!upload_dir' `
    '-xr!__pycache__'

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create backend payload archive. 7za exited with $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if (Test-Path -LiteralPath $localRcedit) {
  $env:ELECTRON_BUILDER_RCEDIT_PATH = (Resolve-Path -LiteralPath $localRcedit).Path
  Write-Host "Using local rcedit: $env:ELECTRON_BUILDER_RCEDIT_PATH"
}

$windowsKitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
if (Test-Path -LiteralPath $windowsKitsRoot) {
  $signtool = Get-ChildItem -Path $windowsKitsRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1

  if ($signtool) {
    $env:SIGNTOOL_PATH = $signtool.FullName
    Write-Host "Using Windows SDK signtool: $env:SIGNTOOL_PATH"
  }
}

$builderArgs = @(
  "electron-builder",
  "--win",
  "--config.win.signAndEditExecutable=false"
)

$electronDist = Join-Path $repoRoot "node_modules\electron\dist"
if (Test-Path -LiteralPath (Join-Path $electronDist "electron.exe")) {
  $builderArgs += "--config.electronDist=$electronDist"
  Write-Host "Using local Electron dist: $electronDist"
}

npx @builderArgs
exit $LASTEXITCODE
