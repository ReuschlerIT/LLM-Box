# Zeigt klickbare Knoten aus einem uiautomator-Dump (Bounds + text/content-desc).
param(
  [string]$Path = 'D:\MeinProjekt\LLM-Box\tmp-ui-dump.xml',
  [string]$Filter = '',
  [int]$Max = 120
)
$raw = Get-Content $Path -Raw
$nodes = [regex]::Matches($raw, '<node[^>]*>')
$i = 0
foreach ($n in $nodes) {
  $s = $n.Value
  if ($s -notmatch 'clickable="true"') { continue }
  $t = [regex]::Match($s, 'text="([^"]*)"').Groups[1].Value
  $d = [regex]::Match($s, 'content-desc="([^"]*)"').Groups[1].Value
  $cls = [regex]::Match($s, 'class="([^"]*)"').Groups[1].Value
  $b = [regex]::Match($s, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  $label = if ($t) { $t } elseif ($d) { 'desc: ' + $d } else { '(' + $cls + ')' }
  if ($Filter -and $label -notlike "*$Filter*") { continue }
  $i++
  if ($b.Success) {
    $cx = ([int]$b.Groups[1].Value + [int]$b.Groups[3].Value) / 2
    $cy = ([int]$b.Groups[2].Value + [int]$b.Groups[4].Value) / 2
    Write-Output ("{0,3}: [{1}|{2}] {3}" -f $i, [int]$cx, [int]$cy, ($label -replace '\s+', ' '))
  }
  if ($i -ge $Max) { break }
}
Write-Output ("--- {0} Knoten, {1} klickbare Treffer" -f $nodes.Count, $i)
