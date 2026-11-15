# inspect-png.ps1 – analysiert PNGs objektiv: wieviele Pixel sind sichtbar,
# wo liegt die Bounding-Box des Motivs, welche Farben dominieren?
param([string]$Path = '')

Add-Type -AssemblyName System.Drawing

function Inspect([string]$file) {
    Write-Host "--- $file"
    $b = [Drawing.Bitmap]::FromFile($file)
    $w = $b.Width; $h = $b.Height
    $visible = 0
    $minX = $w; $minY = $h; $maxX = -1; $maxY = -1
    $rs = 0; $gs = 0; $bs = 0
    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            $c = $b.GetPixel($x, $y)
            if ($c.A -lt 16) { continue }
            $visible++
            if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
            $rs += $c.R; $gs += $c.G; $bs += $c.B
        }
    }
    Write-Host ("  Format: " + $b.PixelFormat + "   Größe: ${w}x${h}")
    Write-Host ("  sichtbare Pixel: $visible von " + ($w * $h) + ' (' + [math]::Round(100 * $visible / ($w * $h), 1) + ' %)')
    if ($visible -gt 0) {
        Write-Host ("  Bounding-Box des Motivs: x $minX..$maxY  y $minY..$maxY")
        Write-Host ("  mittlere Farbe der sichtbaren Pixel: RGB " + [int]($rs / $visible) + "," + [int]($gs / $visible) + "," + [int]($bs / $visible))
    } else {
        Write-Host '  ACHTUNG: Bild ist vollstaendig transparent!'
    }
    $b.Dispose()
}

if ($Path) { Inspect $Path; return }
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Inspect (Join-Path $root 'llm-box\renderer\assets\mark-dark.png')
Inspect (Join-Path $root 'llm-box\renderer\assets\mark-light.png')
Inspect (Join-Path $root 'android\app\src\main\res\mipmap-xxhdpi\ic_launcher.png')
