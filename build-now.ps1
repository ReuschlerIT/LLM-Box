# Baut die APK ohne Gradle-Daemon. build-force.ps1 haengt nach "BUILD SUCCESSFUL" beim
# Daemon-Stop auf dem Netzlaufwerk Y: (der Prozess laeuft weiter, der Aufrufer wartet).
# Ohne --no-daemon gibt es diesen Daemon gar nicht; Kompilieren muss trotzdem garantiert
# passieren, deshalb Zeitstempel setzen + clean.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

& (Join-Path $root 'build-android.ps1') -SkipGradle
if ($LASTEXITCODE -ne 0) { throw "Web-Aufbereitung fehlgeschlagen" }

# Java-/Ressourcen-Zeitstempel auf jetzt: Gradle vergleicht auf Y: Zeitstempel unzuverlaessig.
$now = Get-Date
Get-ChildItem (Join-Path $root 'android\app\src') -Recurse -File | ForEach-Object { $_.LastWriteTime = $now }

$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory | Where-Object { $_.Name -like 'jdk-21*' } | Select-Object -First 1).FullName
if (-not $env:JAVA_HOME) { throw 'JDK 21 nicht gefunden' }
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
$gradle = (Get-ChildItem "$env:USERPROFILE\.gradle\wrapper\dists" -Recurse -Filter 'gradle.bat' | Where-Object { $_.FullName -like '*8.13*' } | Select-Object -First 1).FullName

& $gradle --stop 2>$null | Out-Null
& $gradle --no-daemon -p (Join-Path $root 'android') :app:clean :app:assembleDebug --console=plain
$code = $LASTEXITCODE

Write-Host ''
Write-Host "Gradle-Exit-Code: $code"
if ($code -ne 0) { throw "Gradle-Build fehlgeschlagen ($code)" }
Write-Host "Fertig: $(Join-Path $root 'android\app\app_build\outputs\apk\debug\app-debug.apk')"
