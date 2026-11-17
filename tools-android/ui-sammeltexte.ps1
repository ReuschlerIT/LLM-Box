# Laeuft durch die Einstellungs-Reiter der laufenden App und sammelt alle sichtbaren Texte.
# Voraussetzung: der Einstellungsdialog ist geoeffnet.
param(
  [string]$Serial = '192.0.2.10.201:5555',
  [string]$Out = 'D:\MeinProjekt\LLM-Box\tmp-texte-alle-reiter.txt',
  [int]$TabY = 496
)
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$tabs = @(
  @{ x = 96;  name = '1 Verbindungen' },
  @{ x = 236; name = '2 Modell & Parameter' },
  @{ x = 380; name = '3 Darstellung' },
  @{ x = 520; name = '4 Kosten' },
  @{ x = 666; name = '5 Workspace & Dateien' },
  @{ x = 806; name = '6 Daten' },
  @{ x = 950; name = '7 Uebertragung' },
  @{ x = 1090; name = '8 Ueber' }
)
$sb = New-Object System.Text.StringBuilder
foreach ($t in $tabs) {
  & $adb -s $Serial shell input tap $t.x $TabY | Out-Null
  Start-Sleep -Seconds 2
  # dreimal scrollen, damit auch untere Abschnitte im Dump erscheinen
  for ($s = 0; $s -lt 4; $s++) {
    & $adb -s $Serial shell uiautomator dump /sdcard/t.xml | Out-Null
    $xml = & $adb -s $Serial exec-out cat /sdcard/t.xml
    foreach ($m in [regex]::Matches($xml, 'text="([^"]{3,})"')) {
      $txt = $m.Groups[1].Value -replace '&#10;', ' ' -replace '\s+', ' '
      [void]$sb.AppendLine(("{0}`t{1}" -f $t.name, $txt))
    }
    & $adb -s $Serial shell input swipe 700 2400 700 700 400 | Out-Null
    Start-Sleep -Milliseconds 700
  }
}
Set-Content -Path $Out -Value $sb.ToString() -Encoding UTF8
Write-Output ("Zeilen gesammelt: " + ($sb.ToString() -split "`n").Count + " -> " + $Out)
