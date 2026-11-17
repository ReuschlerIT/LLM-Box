# Liest ein gespeichertes uiautomator-Dump aus und gibt alle sichtbaren Texte aus.
# Aufruf: powershell -NoProfile -ExecutionPolicy Bypass -File tools-android\ui-texte-aus-datei.ps1 -Path tmp-A-ui2.xml [-Max 40]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Max = 40
)
$c = Get-Content $Path -Raw
$treffer = [regex]::Matches($c, 'text="([^"]{2,80})"')
$out = @()
foreach ($t in $treffer) {
  $v = $t.Groups[1].Value.Trim()
  if ($v -and $out -notcontains $v) { $out += $v }
  if ($out.Count -ge $Max) { break }
}
$out -join "`n"
