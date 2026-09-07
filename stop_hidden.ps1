# stop_hidden.ps1
# Usalk Helper backend (3001) ve frontend (5173) sunucularini durdurur.
# Bilerek WinForms kullanmiyor: sorunlu olan teknoloji zaten oydu.
#
# ONEMLI: Bu dosya UTF-8 *BOM ile* kaydedilmelidir; yoksa Turkce karakterler
# bozulur.

$projectDir = $PSScriptRoot
$logDir     = Join-Path $projectDir 'logs'

$BACKEND_PORT  = 3001
$FRONTEND_PORT = 5173

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Write-Log([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    try { Add-Content -Path (Join-Path $logDir 'hidden.log') -Value $line -Encoding utf8 } catch {}
}

function Test-Port([int]$Port, [int]$TimeoutMs = 150) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        try { $c.EndConnect($iar); return $true } catch { return $false }
    } catch {
        return $false
    } finally {
        $c.Close()
    }
}

function Kill-Port([int]$Port) {
    $killed = $false
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.OwningProcess -gt 0) {
            try { taskkill /f /t /pid $_.OwningProcess 2>$null | Out-Null; $killed = $true } catch {}
        }
    }
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline -and (Test-Port $Port)) {
        Start-Sleep -Milliseconds 200
    }
    return $killed
}

try {
    $b = Kill-Port $BACKEND_PORT
    $f = Kill-Port $FRONTEND_PORT
    Write-Log "Durduruldu. backend=$b frontend=$f"
} catch {
    Write-Log "HATA: $($_.Exception.Message)"
}
