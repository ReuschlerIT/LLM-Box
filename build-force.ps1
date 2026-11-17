# build-force.ps1 – wie build-android.ps1, aber mit garantiertem Neu-Bauen des Java-Codes.
# Auf Netzlaufwerken (Y:) vergleichen Gradle/AGP Zeitstempel unzuverlässig; ein normaler
# "assembleDebug" ueberspringt dann die Kompilierung. Deshalb: Zeitstempel setzen + clean compile.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 1) Web-App und Patches wie gehabt
& (Join-Path $root 'build-android.ps1') -SkipGradle

# 2) Java-/Ressourcen-Zeitstempel auf jetzt setzen, damit der Compiler wirklich arbeitet
$now = Get-Date
Get-ChildItem (Join-Path $root 'android\app\src') -Recurse -File | ForEach-Object { $_.LastWriteTime = $now }

# 3) Build-Verzeichnis des Moduls loeschen (Kompilat liegt auf Y: und ist dort zuverlaessig loeschbar,
#    solange kein Daemon es haelt) und neu bauen
$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory | Where-Object { $_.Name -like 'jdk-21*' } | Select-Object -First 1).FullName
if (-not $env:JAVA_HOME) { throw 'JDK 21 nicht gefunden' }
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
$gradle = (Get-ChildItem "$env:USERPROFILE\.gradle\wrapper\dists" -Recurse -Filter 'gradle.bat' | Where-Object { $_.FullName -like '*8.13*' } | Select-Object -First 1).FullName

& $gradle --stop | Out-Null
& $gradle -p (Join-Path $root 'android') :app:clean :app:assembleDebug --console=plain
if ($LASTEXITCODE -ne 0) { throw "Gradle-Build fehlgeschlagen ($LASTEXITCODE)" }

Write-Host ''
Write-Host "Fertig: $(Join-Path $root 'android\app\app_build\outputs\apk\debug\app-debug.apk')"
