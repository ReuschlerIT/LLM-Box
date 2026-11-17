# Zeigt alle Knoten in einem y-Bereich eines uiautomator-Dumps (Roh-Attribute).
param(
  [string]$Path = 'D:\MeinProjekt\LLM-Box\tmp-ui-dump.xml',
  [int]$Y1 = 400,
  [int]$Y2 = 620
)
$raw = Get-Content $Path -Raw
foreach ($n in [regex]::Matches($raw, '<node[^>]*>')) {
  $s = $n.Value
  $b = [regex]::Match($s, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  if (-not $b.Success) { continue }
  $top = [int]$b.Groups[2].Value
  $bot = [int]$b.Groups[4].Value
  if ($bot -lt $Y1 -or $top -gt $Y2) { continue }
  $t = [regex]::Match($s, 'text="([^"]*)"').Groups[1].Value
  $d = [regex]::Match($s, 'content-desc="([^"]*)"').Groups[1].Value
  $cls = [regex]::Match($s, 'class="([^"]*)"').Groups[1].Value
  $cx = ([int]$b.Groups[1].Value + [int]$b.Groups[3].Value) / 2
  $cy = ($top + $bot) / 2
  Write-Output ("[{0}|{1}] {2} | text='{3}' desc='{4}' clickable={5}" -f [int]$cx, [int]$cy, $cls, $t, $d, [regex]::Match($s,'clickable="(\w+)"').Groups[1].Value)
}
