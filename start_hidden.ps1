# start_hidden.ps1
# Usalk Helper backend (3001) ve frontend (5173) sunucularini pencere
# gostermeden arka planda baslatir, hazir olunca tarayiciyi acar ve cikar.
#
# Onceki tepsi (NotifyIcon/WinForms) yaklasimi terk edildi: surekli acik
# kalmasi gereken bir mesaj dongusu vardi ve bu makinede zaman zaman
# aciklanamayan sekilde cokup "hayalet" (tiklamalara cevap vermeyen) bir
# simge birakiyordu. Bu script boyle bir dongu icermez: islerini yapar,
# sunuculari arka planda BAGIMSIZ (kendisi kapansa da calismaya devam eden)
# surecler olarak baslatir, sonra kendisi sessizce sonlanir.
#
# ONEMLI: Bu dosya UTF-8 *BOM ile* kaydedilmelidir; yoksa Turkce karakterler
# bozulur.

$projectDir  = $PSScriptRoot
$backendDir  = Join-Path $projectDir 'backend'
$frontendDir = Join-Path $projectDir 'frontend'
$logDir      = Join-Path $projectDir 'logs'

$BACKEND_PORT  = 3001
$FRONTEND_PORT = 5173
$APP_URL       = "http://localhost:$FRONTEND_PORT"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Write-Log([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    try { Add-Content -Path (Join-Path $logDir 'hidden.log') -Value $line -Encoding utf8 } catch {}
}

function Test-Port([int]$Port, [int]$TimeoutMs = 250) {
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

function Wait-Port([int]$Port, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $Port) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

# Hazir olup olmadigini canlica baglanti kurmaya calisarak degil, sunucunun
# kendi log ciktisini okuyarak anlar. Bu makinede bir guvenlik yazilimi
# bazi sureclerden gelen yeni soket baglantilarini tutarsiz sekilde
# geciktirebiliyor/engelleyebiliyor (port disaridan erisilebilir olsa
# bile scriptin KENDI baglanti denemesi hicbir zaman sonuclanmayabiliyor).
# Dosya okumak aga hic dokunmadigi icin bu sorundan tamamen bagimsizdir.
function Wait-LogMarker([string]$LogFile, [string]$Pattern, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $LogFile) {
            $content = Get-Content -Path $LogFile -Raw -ErrorAction SilentlyContinue
            if ($content -and ($content -match $Pattern)) { return $true }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Kill-Port([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.OwningProcess -gt 0) {
            try { taskkill /f /t /pid $_.OwningProcess 2>$null | Out-Null } catch {}
        }
    }
    # taskkill donunce soket hemen serbest kalmayabilir (isletim sistemi
    # birazcik gecikmeli birakabiliyor). Yeni sunucuyu bu bosluga
    # yetismeden baslatmak Vite'in sessizce baska bir porta (5174 gibi)
    # kaymasina yol aciyordu -> saglik kontrolu hep zaman asimina ugruyordu.
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline -and (Test-Port $Port 150)) {
        Start-Sleep -Milliseconds 200
    }
}

try {
    Write-Log "--- baslatiliyor (PID $PID) ---"

    # Onceki calisan varsa temizle, sonra taze baslat
    Kill-Port $BACKEND_PORT
    Write-Log 'backend portu temizlendi'
    Kill-Port $FRONTEND_PORT
    Write-Log 'frontend portu temizlendi'

    # Onceki calistirmadan kalma log dosyalarini sil: Wait-LogMarker eski
    # "Server running on" / "Local: http" satirini gorup sunucu daha
    # baslamadan "hazir" sanabiliyordu.
    foreach ($f in @('backend.out.log','backend.err.log','frontend.out.log','frontend.err.log')) {
        Remove-Item (Join-Path $logDir $f) -Force -ErrorAction SilentlyContinue
    }

    $bp = Start-Process 'cmd.exe' `
        -ArgumentList '/c npm start' `
        -WorkingDirectory $backendDir `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'backend.out.log') `
        -RedirectStandardError  (Join-Path $logDir 'backend.err.log')
    Write-Log "backend cmd baslatildi, pid=$($bp.Id)"

    $fp = Start-Process 'cmd.exe' `
        -ArgumentList '/c npm run dev' `
        -WorkingDirectory $frontendDir `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'frontend.out.log') `
        -RedirectStandardError  (Join-Path $logDir 'frontend.err.log')
    Write-Log "frontend cmd baslatildi, pid=$($fp.Id)"

    $backendUp  = Wait-LogMarker (Join-Path $logDir 'backend.out.log')  'Server running on' 60
    Write-Log "backend hazir mi (log): $backendUp"
    $frontendUp = Wait-LogMarker (Join-Path $logDir 'frontend.out.log') 'Local:\s*http' 60
    Write-Log "frontend hazir mi (log): $frontendUp"

    if ($backendUp -and $frontendUp) {
        Write-Log 'Backend ve frontend hazir, tarayici aciliyor.'
        Start-Process $APP_URL
    } else {
        $hata = @()
        if (-not $backendUp)  { $hata += 'backend' }
        if (-not $frontendUp) { $hata += 'frontend' }
        Write-Log "Baslatilamadi: $($hata -join ', '). logs klasorune bak."
        [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
        [System.Windows.Forms.MessageBox]::Show(
            "Su sunucu(lar) baslatilamadi: $($hata -join ', ' )`n`nDetay icin logs klasorune bakin.",
            'Usalk Helper',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
} catch {
    Write-Log "HATA: $($_.Exception.Message)`r`n$($_.ScriptStackTrace)"
}
Write-Log "--- script sonlaniyor (PID $PID) ---"
