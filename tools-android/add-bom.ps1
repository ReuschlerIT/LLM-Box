# Gibt PowerShell-Skripten ein UTF-8-BOM, damit Umlaute und Sonderzeichen in Suchtexten
# beim Ausfuehren nicht als ANSI missverstanden werden.
param([string[]]$Files)
$ErrorActionPreference = 'Stop'
foreach ($f in $Files) {
  $b = [System.IO.File]::ReadAllBytes($f)
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { Write-Host "BOM vorhanden: $f"; continue }
  $out = New-Object byte[] ($b.Length + 3)
  $out[0] = 0xEF; $out[1] = 0xBB; $out[2] = 0xBF
  [System.Array]::Copy($b, 0, $out, 3, $b.Length)
  [System.IO.File]::WriteAllBytes($f, $out)
  Write-Host "BOM gesetzt: $f"
}
