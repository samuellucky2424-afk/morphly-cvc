$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$localRcedit = Join-Path $repoRoot "node_modules\electron-winstaller\vendor\rcedit.exe"
$backendDir = Join-Path $repoRoot "backend"
$backendPayload = Join-Path $repoRoot "build\backend-payload.zip"
$backendPayloadUrl = $env:MORPHLY_BACKEND_PAYLOAD_URL
$backendPayloadAuthHeader = $env:MORPHLY_BACKEND_PAYLOAD_AUTH_HEADER
$sevenZip = Join-Path $repoRoot "node_modules\7zip-bin\win\x64\7za.exe"

function Test-BackendPayload {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $payload = Get-Item -LiteralPath $Path
  return $payload.Length -gt 100MB
}

function New-BackendPayloadFromLocalAssets {
  if (-not (Test-Path -LiteralPath (Join-Path $backendDir "vcclient-beatrice\dist\main\main.exe"))) {
    return $false
  }

  if (-not (Test-Path -LiteralPath (Join-Path $backendDir "voice-mode\manifest.json"))) {
    return $false
  }

  if (-not (Test-Path -LiteralPath $sevenZip)) {
    throw "Missing 7za.exe at $sevenZip"
  }

  Remove-Item -LiteralPath $backendPayload -Force -ErrorAction SilentlyContinue
  Push-Location $backendDir
  try {
    Write-Host "Creating backend payload archive from local backend assets: $backendPayload"
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

  return Test-BackendPayload -Path $backendPayload
}

function Get-BackendPayloadFromUrl {
  if (-not $backendPayloadUrl) {
    return $false
  }

  Write-Host "Downloading backend payload archive from MORPHLY_BACKEND_PAYLOAD_URL"
  Remove-Item -LiteralPath $backendPayload -Force -ErrorAction SilentlyContinue

  $requestOptions = @{
    Uri = $backendPayloadUrl
    OutFile = $backendPayload
  }

  if ($backendPayloadAuthHeader) {
    $requestOptions.Headers = @{ Authorization = $backendPayloadAuthHeader }
  }

  Invoke-WebRequest @requestOptions

  return Test-BackendPayload -Path $backendPayload
}

if (New-BackendPayloadFromLocalAssets) {
  Write-Host "Backend payload ready from local assets."
} elseif (Get-BackendPayloadFromUrl) {
  Write-Host "Backend payload ready from MORPHLY_BACKEND_PAYLOAD_URL."
} elseif (Test-BackendPayload -Path $backendPayload) {
  Write-Host "Using existing backend payload archive: $backendPayload"
} else {
  throw @"
Missing Morphly backend payload.

This installer needs Beatrice engine assets, but this checkout does not have:
  backend\vcclient-beatrice\dist\main\main.exe
  backend\voice-mode\manifest.json

For local release builds, keep those folders under backend\ and run npm run dist:win again.
For GitHub Actions, commit build\backend-payload.zip through Git LFS, or upload a
prebuilt backend-payload.zip somewhere private/public and set:
  MORPHLY_BACKEND_PAYLOAD_URL
If the URL needs an Authorization header, also set:
  MORPHLY_BACKEND_PAYLOAD_AUTH_HEADER

The payload is intentionally not committed because it is hundreds of MB.
"@
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
