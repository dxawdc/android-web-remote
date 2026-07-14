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
} finally {
    Pop-Location
}

$source = Join-Path $buildRoot "apps\android\app\build\outputs\apk\debug\app-debug.apk"
$outputDir = Join-Path $root "output\android"
New-Item -ItemType Directory -Force $outputDir | Out-Null
Copy-Item -Force $source (Join-Path $outputDir "remote-control-agent-debug.apk")
Write-Host "APK: $outputDir\remote-control-agent-debug.apk"
if ($mappedDrive) { cmd /c "subst $mappedDrive`: /d" }
