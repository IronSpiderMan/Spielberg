param(
    [string]$Target = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Build the Windows EXE on Windows." }
foreach ($tool in @("node", "npm.cmd", "cargo")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Required tool missing: $tool" }
}

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    if (-not (Test-Path node_modules)) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
    }
    # Resolve Cargo's output directory, including local configuration overrides.
    Push-Location src-tauri
    try {
        $metadata = & cargo metadata --no-deps --format-version 1 --offline
        if ($LASTEXITCODE -ne 0) { throw "Cannot read Cargo metadata." }
        $targetDirectory = ($metadata | ConvertFrom-Json).target_directory
    } finally { Pop-Location }

    $started = Get-Date
    & npm.cmd exec -- tauri build --target $Target --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "Windows build failed." }
    $releaseDirectory = Join-Path $targetDirectory "$Target/release"
    $application = Join-Path $releaseDirectory "spielberg-studio.exe"
    $installers = @(Get-ChildItem -LiteralPath (Join-Path $releaseDirectory "bundle/nsis") -Filter *.exe |
        Where-Object { $_.LastWriteTime -ge $started.AddSeconds(-2) })
    if (-not (Test-Path -LiteralPath $application) -or $installers.Count -eq 0) {
        throw "Build finished without the expected application and new NSIS installer."
    }
    Write-Host "Application: $application"
    foreach ($installer in $installers) { Write-Host "Installer: $($installer.FullName)" }
} finally { Pop-Location }
