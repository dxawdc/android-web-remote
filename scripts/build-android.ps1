$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$buildRoot = $root
$mappedDrive = $null

if (($root.ToCharArray() | Where-Object { [int][char]$_ -gt 127 }).Count -gt 0) {
    foreach ($candidate in "RSTUVWXYZ".ToCharArray()) {
        if (-not (Get-PSDrive -Name $candidate -ErrorAction SilentlyContinue)) {
            cmd /c "subst $candidate`: `"$root`""
            $buildRoot = "$candidate`:\"
            $mappedDrive = $candidate
            break
        }
    }
    if (-not $mappedDrive) { throw "No free drive letter is available for the Android build." }
}

try {
    $jdkRoot = Join-Path $buildRoot ".tools\jdk"
    $sdkRoot = Join-Path $buildRoot ".tools\android-sdk"
    $gradle = Join-Path $buildRoot ".tools\gradle\gradle-8.9\bin\gradle.bat"
    if (Test-Path $jdkRoot) {
        $env:JAVA_HOME = (Get-ChildItem $jdkRoot -Directory | Select-Object -First 1).FullName
    }
    if (Test-Path $sdkRoot) {
        $env:ANDROID_HOME = $sdkRoot
        $env:ANDROID_SDK_ROOT = $sdkRoot
    }
    if (-not (Test-Path $gradle)) {
        throw "Local Gradle not found. Open apps/android with Android Studio or install Gradle 8.9."
    }
    $env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
    Push-Location (Join-Path $buildRoot "apps\android")
    try {
        & $gradle :app:assembleDebug :app:testDebugUnitTest --no-daemon --console=plain
        if ($LASTEXITCODE -ne 0) { throw "Android build failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }

    $apkDir = Join-Path $buildRoot "apps\android\app\build\outputs\apk\debug"
    $metadata = Get-Content (Join-Path $apkDir "output-metadata.json") -Raw | ConvertFrom-Json
    $artifact = $metadata.elements[0]
    $version = $artifact.versionName
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Unexpected APK version: $version" }
    $filename = "remote-control-agent-$version.apk"
    $outputDir = Join-Path $root "output\android"
    New-Item -ItemType Directory -Force $outputDir | Out-Null
    $destination = Join-Path $outputDir $filename
    Copy-Item -Force (Join-Path $apkDir $artifact.outputFile) $destination
    $stream = [IO.File]::OpenRead($destination)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $sha256 = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace("-", "").ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
    $manifest = [ordered]@{
        version = $version
        versionCode = $artifact.versionCode
        filename = $filename
        size = (Get-Item $destination).Length
        sha256 = $sha256
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $outputDir "latest.json"), $manifest, [Text.UTF8Encoding]::new($false))
    Write-Host "APK: $destination"
    Write-Host "Manifest: $outputDir\latest.json"
} finally {
    if ($mappedDrive) { cmd /c "subst $mappedDrive`: /d" }
}
