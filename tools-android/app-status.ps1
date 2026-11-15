# app-status.ps1 – prueft die LAUFENDE Windows-App (installierte Fassung), nicht die Quelle.
# Belegt: Version, Prozess-Rollen, CPU-Last im Leerlauf, Speicher, Abgleich-Konfiguration,
# Schreibreste im Chatordner und (optional) ein Bildschirmfoto der Oberflaeche.
#
# Aufruf:  powershell -ExecutionPolicy Bypass -File tools-android\app-status.ps1 [sekunden] [--foto]
$ErrorActionPreference = 'Continue'
$dauer = if ($args.Count -ge 1 -and $args[0] -match '^\d+$') { [int]$args[0] } else { 12 }

Write-Host '=== 1) Installierte Fassung ==='
$exe = 'C:\Program Files\LLM Box\LLM Box.exe'
if (Test-Path $exe) {
  $vi = (Get-Item $exe).VersionInfo
  Write-Host ("  Version: " + $vi.FileVersion + "   Datei: " + $exe)
} else { Write-Host '  NICHT installiert unter C:\Program Files\LLM Box' }

Write-Host "`n=== 2) Prozesse, Rollen und CPU-Last ueber $dauer s ==="
function Snapshot {
  $h = @{}
  Get-CimInstance Win32_Process -Filter "Name='LLM Box.exe'" | ForEach-Object {
    $rolle = 'MAIN'
    if ($_.CommandLine -match '--type=([a-z-]+)') { $rolle = $matches[1] }
    $h[[int]$_.ProcessId] = $rolle
  }
  return $h
}
$rollen = Snapshot
$vor = @{}
foreach ($p in (Get-Process -Name 'LLM Box' -ErrorAction SilentlyContinue)) { $vor[$p.Id] = $p.TotalProcessorTime }
Start-Sleep -Seconds $dauer
$gesamt = 0.0
foreach ($p in (Get-Process -Name 'LLM Box' -ErrorAction SilentlyContinue)) {
  if (-not $vor.ContainsKey($p.Id)) { continue }
  $ms = ($p.TotalProcessorTime - $vor[$p.Id]).TotalMilliseconds
  $gesamt += $ms
  $r = if ($rollen.ContainsKey($p.Id)) { $rollen[$p.Id] } else { 'unbekannt' }
  Write-Host ("  PID {0,-6} Rolle {1,-12} CPU {2,6:N0} ms   Arbeitsspeicher {3,5:N0} MB" -f $p.Id, $r, $ms, ($p.WorkingSet64 / 1MB))
}
Write-Host ("  SUMME ueber $dauer s Leerlauf: {0:N0} ms ({1:N1} % eines Kerns)" -f $gesamt, (($gesamt / 10) / $dauer))

Write-Host "`n=== 3) Fenster der App ==="
foreach ($p in (Get-Process -Name 'LLM Box' -ErrorAction SilentlyContinue)) {
  if ($p.MainWindowTitle) { Write-Host ("  PID " + $p.Id + " Fenster: '" + $p.MainWindowTitle + "'") }
}

Write-Host "`n=== 4) Abgleich-Konfiguration (sync.json) ==="
$sync = Join-Path $env:APPDATA 'LLM Box\sync.json'
if (Test-Path $sync) { Write-Host ('  ' + (Get-Content $sync -Raw)) } else { Write-Host '  keine sync.json' }

Write-Host "`n=== 5) Chatordner: Schreibreste und Gesperrtes ==="
$dir = 'D:\MeinProjekt\LLM-Box-Chats'
if (Test-Path $dir) {
  $tmp = @(Get-ChildItem $dir -Filter '*.tmp' -ErrorAction SilentlyContinue)
  Write-Host ('  .tmp-Reste: ' + $tmp.Count)
  $metas = @(Get-ChildItem $dir -Filter '*.meta.json' -ErrorAction SilentlyContinue)
  Write-Host ('  Meta-Dateien: ' + $metas.Count)
  # Genau der Fall, der in 1.0.57 das Flattern ausloeste: Meta-Dateien, die sich nicht lesen lassen.
  $blockiert = 0; $ok = 0
  foreach ($m in $metas) { try { [void][System.IO.File]::ReadAllText($m.FullName); $ok++ } catch { $blockiert++; Write-Host ('    gesperrt: ' + $m.Name + '  (' + $_.Exception.Message.Split("`n")[0] + ')') } }
  Write-Host ("  lesbar: $ok   gesperrt: $blockiert")
} else { Write-Host '  Chatordner nicht gefunden' }

if ($args -contains '--foto') {
  Write-Host "`n=== 6) Bildschirmfoto ==="
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap ($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $ziel = Join-Path $PSScriptRoot '..\geraet-start\desktop.png'
    $bmp.Save($ziel, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host ('  gespeichert: ' + $ziel)
  } catch { Write-Host ('  Foto fehlgeschlagen: ' + $_.Exception.Message) }
}
