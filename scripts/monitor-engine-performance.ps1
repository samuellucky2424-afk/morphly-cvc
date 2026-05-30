param(
    [string]$EngineUrl = "http://127.0.0.1:18000",
    [int]$IntervalSeconds = 2,
    [string]$LogPath = ""
)

$ErrorActionPreference = "Continue"

if (-not $LogPath) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $LogPath = Join-Path (Join-Path (Get-Location) "logs") "engine-performance-$stamp.log"
}

$logDir = Split-Path -Parent $LogPath
if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Read-JsonEndpoint {
    param([string]$Url)

    try {
        return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 4
    } catch {
        return @{
            error = $_.Exception.Message
        }
    }
}

"# Morphly engine performance monitor started $(Get-Date -Format o)" | Out-File -FilePath $LogPath -Encoding utf8 -Append
"# EngineUrl=$EngineUrl IntervalSeconds=$IntervalSeconds" | Out-File -FilePath $LogPath -Encoding utf8 -Append

while ($true) {
    $info = Read-JsonEndpoint "$EngineUrl/info?reloadDevices=false"
    $performance = Read-JsonEndpoint "$EngineUrl/performance"

    $entry = [ordered]@{
        timestamp = Get-Date -Format o
        modelSlotIndex = $info.modelSlotIndex
        pipelineInfo = $info.pipelineInfo
        f0Detector = $info.f0Detector
        serverAudioStated = $info.serverAudioStated
        enableServerAudio = $info.enableServerAudio
        passThrough = $info.passThrough
        serverInputDeviceId = $info.serverInputDeviceId
        serverOutputDeviceId = $info.serverOutputDeviceId
        serverReadChunkSize = $info.serverReadChunkSize
        serverAudioSampleRate = $info.serverAudioSampleRate
        performance = $performance
        error = $info.error
    }

    $entry | ConvertTo-Json -Compress -Depth 6 | Out-File -FilePath $LogPath -Encoding utf8 -Append
    Start-Sleep -Seconds $IntervalSeconds
}
