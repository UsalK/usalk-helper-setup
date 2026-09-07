$ErrorActionPreference = 'Stop'
$installRoot = $PSScriptRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or newer, then run install again.' }
    $nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
    if ($nodeMajor -lt 24) { throw 'Node.js 24 or newer is required.' }
    foreach ($component in @('backend', 'frontend')) {
        Push-Location (Join-Path $installRoot $component)
        try {
            & npm.cmd ci
            if ($LASTEXITCODE -ne 0) { throw "$component dependency installation failed." }
        } finally { Pop-Location }
    }
    Push-Location $installRoot
    try {
        & node backend/scripts/init-local-data.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Local data initialization failed.' }
    } finally { Pop-Location }
    Write-Host 'Setup complete. Double-click run_hidden.vbs to start Usalk Helper.'
    Write-Host 'Existing settings, database and storage were preserved.'
} catch {
    Write-Error $_
    exit 1
}
