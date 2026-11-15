# png-hell.ps1 – zaehlt helle und dunkle Pixel eines Screenshots, um den weissen Startblock
# messbar zu machen (Auge allein sieht an einem PNG nicht, wie gross der weisse Anteil ist).
# Aufruf: powershell -File tools-android\png-hell.ps1 start-01.png start-02.png
param([string[]]$Dateien)

Add-Type -AssemblyName System.Drawing
foreach ($d in $Dateien) {
  if (-not (Test-Path $d)) { Write-Host "fehlt: $d"; continue }
  $img = [System.Drawing.Bitmap]::FromFile((Resolve-Path $d))
  $hell = 0; $dunkel = 0; $total = 0
  # every 4. Pixel -> schnell genug, Genauigkeit reicht fuer den Anteil
  for ($y = 0; $y -lt $img.Height; $y += 4) {
    for ($x = 0; $x -lt $img.Width; $x += 4) {
      $c = $img.GetPixel($x, $y)
      $lum = (0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)
      $total++
      if ($lum -gt 235) { $hell++ } elseif ($lum -lt 60) { $dunkel++ }
    }
  }
  $img.Dispose()
  Write-Host ("{0}: gesamt {1}  hell(>235) {2} ({3:N1}%)  dunkel(<60) {4} ({5:N1}%)" -f (Split-Path $d -Leaf), $total, $hell, (100.0 * $hell / $total), $dunkel, (100.0 * $dunkel / $total))
  # Rechter Bildrand: dort sitzt das Workspace-Panel (280 px von 1080) -> getrennt zaehlen
}
