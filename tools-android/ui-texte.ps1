param([string]$Path = 'D:\MeinProjekt\LLM-Box\tmp-ui-s948b-start.xml', [int]$Max = 120)
$raw = Get-Content $Path -Raw
$m = [regex]::Matches($raw, 'text="([^"]*)"')
$i = 0
foreach ($x in $m) {
  $t = $x.Groups[1].Value
  if ($t.Trim().Length -eq 0) { continue }
  $i++
  Write-Output ("{0,3}: {1}" -f $i, $t)
  if ($i -ge $Max) { break }
}
Write-Output ("--- {0} Textknoten, {1} gefüllt" -f $m.Count, $i)
