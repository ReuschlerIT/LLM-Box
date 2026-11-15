# probe-auswerten.ps1 – liest eine Logcat-Datei und stellt die Messwerte der Debug-Sonde
# kompakt gegenueber (Tab-Leisten-Hoehe, sichtbarer Inhalt, Tab-Groessen).
param([string]$File = 'logU.txt')
$ErrorActionPreference = 'Stop'
$p = if ([System.IO.Path]::IsPathRooted($File)) { $File } else { Join-Path (Split-Path -Parent $PSScriptRoot) $File }
foreach ($line in Get-Content $p) {
  if ($line -notmatch 'probe_') { continue }
  $name = [regex]::Match($line, 'probe_(\w+)?=').Groups[1].Value
  if (-not $name) { $name = [regex]::Match($line, 'probe(\d*)=').Groups[1].Value }
  $navH = [regex]::Match($line, 'navH\D*?(\d+)').Groups[1].Value
  $pane = [regex]::Match($line, 'paneVisible\D*?(\d+/\d+)').Groups[1].Value
  $tabs = [regex]::Match($line, 'tabs\D*?\[(.*?)\]').Groups[1].Value
  Write-Host ("{0,-16} navH={1,-5} pane={2,-10} {3}" -f $name, $navH, $pane, $tabs)
}
