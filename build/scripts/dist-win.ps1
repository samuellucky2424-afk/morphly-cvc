$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$localRcedit = Join-Path $repoRoot "node_modules\electron-winstaller\vendor\rcedit.exe"

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
