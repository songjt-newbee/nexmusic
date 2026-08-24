# Patch generated Android project: SDK 36, localhost audio, media notification
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root "src-tauri\gen\android"
if (-not (Test-Path $android)) {
    Write-Host "Run: npm run tauri android init"
    exit 1
}

$xmlDir = Join-Path $android "app\src\main\res\xml"
New-Item -ItemType Directory -Force -Path $xmlDir | Out-Null
Copy-Item -Force (Join-Path $root "src-tauri\android-patch\network_security_config.xml") (Join-Path $xmlDir "network_security_config.xml")

$javaDir = Join-Path $android "app\src\main\java\top\nexmusic\app"
if (-not (Test-Path $javaDir)) {
    $found = Get-ChildItem -Path (Join-Path $android "app\src\main") -Recurse -Filter "MainActivity.kt" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $javaDir = $found.Directory.FullName }
}
if ($javaDir -and (Test-Path (Split-Path $javaDir -Parent))) {
    New-Item -ItemType Directory -Force -Path $javaDir | Out-Null
    foreach ($name in @("MediaSessionPlugin.kt", "PlaybackService.kt", "CookieBridgePlugin.kt")) {
        $src = Join-Path $root "src-tauri\android-patch\$name"
        if (Test-Path $src) {
            Copy-Item -Force $src (Join-Path $javaDir $name)
        }
    }
}

$manifest = Join-Path $android "app\src\main\AndroidManifest.xml"
if (Test-Path $manifest) {
    $text = Get-Content $manifest -Raw
    if ($text -notmatch "networkSecurityConfig") {
        $text = $text -replace "<application", '<application android:networkSecurityConfig="@xml/network_security_config"'
    }
    $perms = @(
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "android.permission.WAKE_LOCK"
    )
    foreach ($name in $perms) {
        if ($text -notmatch [regex]::Escape($name)) {
            $perm = "    <uses-permission android:name=`"$name`" />`r`n"
            $text = $text -replace "<application", ($perm + "    <application")
        }
    }
    if ($text -notmatch "PlaybackService") {
        $svc = @"
        <service
            android:name=".PlaybackService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback"
            android:stopWithTask="false" />
"@
        $text = $text -replace "</application>", "$svc`r`n    </application>"
    }
    Set-Content -Path $manifest -Value $text -Encoding UTF8
}

$gradle = Join-Path $android "app\build.gradle.kts"
if (Test-Path $gradle) {
    $g = Get-Content $gradle -Raw
    $g = $g -replace "compileSdk\s*=\s*\d+", "compileSdk = 36"
    $g = $g -replace "targetSdk\s*=\s*\d+", "targetSdk = 36"
    $g = $g -replace 'manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"false"', 'manifestPlaceholders["usesCleartextTraffic"] = "true"'
    Set-Content -Path $gradle -Value $g -Encoding UTF8
}

Write-Host "Android patch applied (SDK 36 + localhost cleartext + media notification)."
