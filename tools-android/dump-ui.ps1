# dump-ui.ps1 – holt den UI-Hierarchie-Dump des Gerats und listet die sichtbaren Texte
# mit ihren Pixelbereichen. Damit laesst sich ohne Foto pruefen, ob z. B. die Tabs des
# Server-Fensters nebeneinander liegen (y-Bereich gleich) oder untereinander.
$ErrorActionPreference = 'Stop'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$dev = '192.0.2.10.201:5555'
$out = Join-Path (Split-Path -Parent $PSScriptRoot) 'ui-dump-server.xml'

& $adb -s $dev shell uiautomator dump /sdcard/ui.xml | Out-Null
& $adb -s $dev exec-out cat /sdcard/ui.xml | Set-Content -Path $out -Encoding UTF8

$t = Get-Content $out -Raw
Write-Host "Dump: $out ($($t.Length) Zeichen)"
$rx = [regex]'text="([^"]{2,})"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
foreach ($m in $rx.Matches($t)) {
  $x1=[int]$m.Groups[2].Value; $y1=[int]$m.Groups[3].Value
  $x2=[int]$m.Groups[4].Value; $y2=[int]$m.Groups[5].Value
  Write-Host ("{0,-26} x {1,4}-{2,4}  y {3,4}-{4,4}" -f $m.Groups[1].Value.Substring(0,[Math]::Min(26,$m.Groups[1].Value.Length)), $x1,$x2,$y1,$y2)
}
