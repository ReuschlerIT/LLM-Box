# Liest den UI-Dump eines Gerats und zeigt Textknoten mit Mittelpunkt (zum Antippen).
param(
  [string]$Serial = '192.0.2.10.201:5555',
  [string]$Out = 'D:\MeinProjekt\LLM-Box\tmp-ui-dump.xml',
  [string]$Filter = '',
  [int]$MaxY = 0,
  [int]$Max = 200
)
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb -s $Serial shell uiautomator dump /sdcard/llmbox-ui.xml | Out-Null
& $adb -s $Serial exec-out cat /sdcard/llmbox-ui.xml | Out-File -FilePath $Out -Encoding utf8
$raw = Get-Content $Out -Raw
$nodes = [regex]::Matches($raw, '<node[^>]*>')
$i = 0
foreach ($n in $nodes) {
  $s = $n.Value
  $t = [regex]::Match($s, 'text="([^"]*)"').Groups[1].Value
  $d = [regex]::Match($s, 'content-desc="([^"]*)"').Groups[1].Value
  $b = [regex]::Match($s, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  $label = if ($t) { $t } elseif ($d) { 'desc: ' + $d } else { continue }
  if ($Filter -and $label -notlike "*$Filter*") { continue }
  if ($MaxY -gt 0 -and $b.Success -and ([int]$b.Groups[2].Value + [int]$b.Groups[4].Value) / 2 -gt $MaxY) { continue }
  $i++
  if ($b.Success) {
    $cx = ([int]$b.Groups[1].Value + [int]$b.Groups[3].Value) / 2
    $cy = ([int]$b.Groups[2].Value + [int]$b.Groups[4].Value) / 2
    Write-Output ("{0,3}: [{1}|{2}] {3}" -f $i, [int]$cx, [int]$cy, ($label -replace '\s+', ' '))
  } else {
    Write-Output ("{0,3}: [ - ] {1}" -f $i, ($label -replace '\s+', ' '))
  }
  if ($i -ge $Max) { break }
}
Write-Output ("--- {0} Knoten, {1} Treffer" -f $nodes.Count, $i)
