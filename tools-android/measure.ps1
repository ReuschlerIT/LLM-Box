# measure.ps1 – liest per uiautomator die Geometrie der Web-Inhalte auf dem Handy.
# Nutzen: node-Grenzen und Elemente (Topbar, Eingabefeld) nach Pruefung der Insets.
param([string]$Device = '192.0.2.10.201:5555', [string]$Out = 'ui-dump.xml')

$ErrorActionPreference = 'Stop'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'

& $adb -s $Device exec-out uiautomator dump /sdcard/ui.xml | Out-Null
$xml = & $adb -s $Device exec-out cat /sdcard/ui.xml
Set-Content -Path $Out -Value $xml -Encoding UTF8

$t = Get-Content $Out -Raw
Write-Host ("Knoten gesamt: " + ([regex]::Matches($t, '<node').Count))

# Klassen ueberblicken
$classes = @{}
foreach ($m in [regex]::Matches($t, 'class="([^"]+)"')) {
    $c = $m.Groups[1].Value
    if ($classes.ContainsKey($c)) { $classes[$c]++ } else { $classes[$c] = 1 }
}
Write-Host "`nHaeufigste Klassen:"
$classes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object { Write-Host ("  {0,4}  {1}" -f $_.Value, $_.Key) }

# Web-Knoten: bounds + text/content-desc, sortiert nach y
Write-Host "`nWeb-/Bedienelemente (y, x, Text):"
$rows = @()
foreach ($m in [regex]::Matches($t, '<node[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*/?>')) {
    $tag = $m.Value
    $x1 = [int]$m.Groups[1].Value; $y1 = [int]$m.Groups[2].Value
    $x2 = [int]$m.Groups[3].Value; $y2 = [int]$m.Groups[4].Value
    $desc = ''
    $dm = [regex]::Match($tag, 'content-desc="([^"]*)"')
    if ($dm.Success) { $desc = $dm.Groups[1].Value }
    $tm = [regex]::Match($tag, 'text="([^"]*)"')
    if ($tm.Success -and $tm.Groups[1].Value) { $desc = ($desc + ' | ' + $tm.Groups[1].Value).Trim(' |') }
    if (-not $desc) { continue }
    $rows += [pscustomobject]@{ y1 = $y1; x1 = $x1; y2 = $y2; x2 = $x2; text = $desc }
}
$rows | Sort-Object y1 | Select-Object -First 30 | ForEach-Object {
    Write-Host ("  y {0,5}-{1,-5} x {2,5}-{3,-5}  {4}" -f $_.y1, $_.y2, $_.x1, $_.x2, $_.text.Substring(0, [Math]::Min(60, $_.text.Length)))
}
