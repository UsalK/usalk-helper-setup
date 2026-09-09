# Usalk Helper — hazirlanmis guncellemeyi uygular.
#
# Bu betigi elle calistirmaniz gerekmez; uygulama "Guncelle" dendiginde kendisi
# baslatir. Calisan uygulama kendi dosyalarinin uzerine yazamadigi icin islem
# ayri bir surecte yapilir.
#
# Kisisel dosyalara (veritabani, .env, storage, loglar) dokunulmaz.

param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [int]$ParentPid = 0,
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$staging = Join-Path $ProjectRoot '.update-staging'
$ready   = Join-Path $staging 'ready'
$logFile = Join-Path $staging 'apply.log'

function Write-Log($message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $message
    Write-Host $line
    try { Add-Content -Path $logFile -Value $line -Encoding utf8 } catch { }
}

# Guncellemenin asla ellemeyecegi yollar (proje koküne gore).
$protected = @(
    'backend\.env',
    'backend\db',
    'storage',
    'backups',
    'logs',
    'backend\scratch',
    'node_modules',
    'backend\node_modules',
    'frontend\node_modules',
    '.update-staging',
    '.git'
)

# backend\db tamamen korunuyor ama bu ikisi uygulama kodu, guncellenmeli.
$dbCodeFiles = @('backend\db\db.js', 'backend\db\schema.sql')

function Is-Protected([string]$relative) {
    foreach ($p in $protected) {
        if ($relative -eq $p -or $relative.StartsWith($p + '\')) {
            foreach ($allow in $dbCodeFiles) {
                if ($relative -eq $allow) { return $false }
            }
            return $true
        }
    }
    return $false
}

try {
    if (-not (Test-Path $ready)) { throw "Hazirlanmis guncelleme bulunamadi: $ready" }

    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Write-Log 'Guncelleme uygulaniyor.'

    # 1) Uygulamayi durdur. Once cagiran sunucunun kapanmasini bekle.
    if ($ParentPid -gt 0) {
        Write-Log "Sunucunun kapanmasi bekleniyor (pid $ParentPid)."
        for ($i = 0; $i -lt 30; $i++) {
            if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 500
        }
        try { Stop-Process -Id $ParentPid -Force -ErrorAction SilentlyContinue } catch { }
    }

    $stopScript = Join-Path $ProjectRoot 'stop_hidden.ps1'
    if (Test-Path $stopScript) {
        Write-Log 'stop_hidden.ps1 calistiriliyor.'
        try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null } catch {
            Write-Log "Durdurma betigi uyarisi: $($_.Exception.Message)"
        }
    }
    Start-Sleep -Seconds 2

    # 2) Degisecek dosyalarin yedegini al (geri donus icin).
    $backupDir = Join-Path $staging ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

    # 3) Yeni dosyalari uzerine kopyala.
    #
    # Goreli yol -Name ile dogrudan alinir. Tam yoldan Substring ile kesmek
    # guvenli degil: ProjectRoot 8.3 kisa bicimde (USALKP~1) gelip
    # Get-ChildItem uzun bicimde donerse kesme kayar, hicbir korumali yol
    # eslesmez ve kisisel dosyalar sessizce ezilir.
    $relatives = @(Get-ChildItem -LiteralPath $ready -Recurse -File -Name)
    if ($relatives.Count -eq 0) { throw 'Guncelleme paketi bos gorunuyor.' }

    $copied = 0
    $skipped = 0
    foreach ($relative in $relatives) {
        if (Is-Protected $relative) {
            $skipped++
            continue
        }

        $source = Join-Path $ready $relative
        $target = Join-Path $ProjectRoot $relative
        $targetDir = Split-Path $target -Parent
        if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Force -Path $targetDir | Out-Null }

        if (Test-Path $target) {
            $backupTarget = Join-Path $backupDir $relative
            $backupTargetDir = Split-Path $backupTarget -Parent
            if (-not (Test-Path $backupTargetDir)) { New-Item -ItemType Directory -Force -Path $backupTargetDir | Out-Null }
            Copy-Item -LiteralPath $target -Destination $backupTarget -Force
        }

        Copy-Item -LiteralPath $source -Destination $target -Force
        $copied++
    }
    Write-Log "$copied dosya guncellendi, $skipped kisisel dosya atlandi."
    Write-Log "Yedek: $backupDir"

    # 4) Bagimlilik kilidi degistiyse npm ci calistir.
    foreach ($component in @('backend', 'frontend')) {
        $lockNew = Join-Path $ready "$component\package-lock.json"
        $lockOld = Join-Path $backupDir "$component\package-lock.json"
        if ((Test-Path $lockNew) -and (Test-Path $lockOld)) {
            $newHash = (Get-FileHash $lockNew -Algorithm SHA256).Hash
            $oldHash = (Get-FileHash $lockOld -Algorithm SHA256).Hash
            if ($newHash -eq $oldHash) {
                Write-Log "$component bagimliliklari degismedi."
                continue
            }
        }
        Write-Log "$component icin npm ci calistiriliyor."
        Push-Location (Join-Path $ProjectRoot $component)
        try {
            & npm.cmd ci 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "$component bagimlilik kurulumu basarisiz." }
        } finally { Pop-Location }
    }

    # 5) Temizlik ve yeniden baslatma.
    Remove-Item -LiteralPath $ready -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $staging 'staged.json') -Force -ErrorAction SilentlyContinue
    Write-Log 'Guncelleme tamamlandi.'

    if ($Restart) {
        $runner = Join-Path $ProjectRoot 'run_hidden.vbs'
        if (Test-Path $runner) {
            Write-Log 'Uygulama yeniden baslatiliyor.'
            Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$runner`"" -WorkingDirectory $ProjectRoot
        } else {
            Write-Log 'run_hidden.vbs bulunamadi; uygulamayi elle baslatin.'
        }
    }
    exit 0
} catch {
    Write-Log "HATA: $($_.Exception.Message)"
    Write-Log 'Kurulum degistirilmediyse uygulamayi normal sekilde baslatabilirsiniz.'
    exit 1
}
