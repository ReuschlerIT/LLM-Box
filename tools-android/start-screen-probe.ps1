# start-screen-probe.ps1 – beweist, wie die Android-App beim Start aussieht.
# Die App wird kalt gestartet und in kurzen Zeitabstaenden abfotografiert, damit man sieht,
# ob der weisse Workspace-Block (Panel) beim ersten Bild da ist oder nicht.
# Auswertung: tools-android\png-sample.js (Helligkeit pro Streifen + rechtes Viertel).
$ErrorActionPreference = 'Stop'
$adb   = 'C:\Users\<Benutzer>\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$t     = if ($args.Count -ge 1) { $args[0] } else { '8' }
$out   = Join-Path $PSScriptRoot '..\geraet-start'
New-Item -ItemType Directory -Force -Path $out | Out-Null

# WICHTIG: PowerShell kann keine Binariausgabe von adb umleiten ("exec-out ... > datei"
# zerstoert das PNG, die Datei bleibt aber ~30 KB gross). Deshalb im Gerat speichern und holen.
function Cap([string]$name, [int]$verz) {
  if ($verz) { Start-Sleep -Milliseconds $verz }
  $dev = '/sdcard/llmbox-cap.png'
  & $adb -t $t shell screencap -p $dev | Out-Null
  $lokal = Join-Path $out $name
  if (Test-Path $lokal) { Remove-Item $lokal -Force }
  & $adb -t $t pull $dev $lokal | Out-Null
  Write-Host ("  {0} : {1} KB" -f $name, [math]::Round((Get-Item $lokal).Length / 1KB))
}

Write-Host 'Gerat:'; & $adb -t $t shell getprop ro.product.model

# Display wecken und entsperren. Gesperrter Bildschirm = screencap liefert nur Schwarz
# (erste Messrunde zeigte durchgaengig RGB 0,0,0).
& $adb -t $t shell input keyevent KEYCODE_WAKEUP | Out-Null
Start-Sleep -Milliseconds 500
& $adb -t $t shell wm dismiss-keyguard | Out-Null
Start-Sleep -Milliseconds 800
Write-Host ('Display an: ' + ((& $adb -t $t shell dumpsys power | Select-String 'mWakefulness=' | Select-Object -First 1).Line.Trim()))

& $adb -t $t shell am force-stop de.reuschlerit.llmbox
Start-Sleep -Milliseconds 600
& $adb -t $t logcat -c
& $adb -t $t shell monkey -p de.reuschlerit.llmbox -c android.intent.category.LAUNCHER 1 | Out-Null

Cap 'start-0400ms.png' 400
Cap 'start-0900ms.png' 500
Cap 'start-1600ms.png' 700
Cap 'start-3000ms.png' 1400
Cap 'start-6000ms.png' 3000

Write-Host "`nUI-Sonde (panelCollapsed / theme):"
& $adb -t $t shell am start -n de.reuschlerit.llmbox/.MainActivity --ez probe true | Out-Null
Start-Sleep -Seconds 6
& $adb -t $t logcat -d -s LLMBOX-UI > (Join-Path $out 'logcat-ui.txt')
Select-String -Path (Join-Path $out 'logcat-ui.txt') -Pattern 'panelCollapsed|theme=|probe_ui' | ForEach-Object { Write-Host ('  ' + $_.Line) }

Write-Host "`nBildauswertung:"
foreach ($f in Get-ChildItem $out -Filter '*.png') { node (Join-Path $PSScriptRoot 'png-sample.js') $f.FullName 90,50 | Write-Host }
