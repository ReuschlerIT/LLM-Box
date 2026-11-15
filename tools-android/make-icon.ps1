# make-icon.ps1 – erzeugt aus dem LLM-Box-Logo ein quadratisches Launcher-Icon fuer Android.
# Wichtig: mark-dark.png ist das HELLE Logo (farbig fuer dunkle Oberflaechen),
# mark-light.png das DUNKLE. Auf dem dunklen Icon-Grund muss die helle Fassung sitzen,
# sonst wirkt das Icon blau-schwarz und ist nicht zu erkennen.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Add-Type -AssemblyName System.Drawing

$src = Join-Path $root 'llm-box\renderer\assets\mark-dark.png'
if (-not (Test-Path $src)) { throw "Logo fehlt: $src" }

function Make-Icon([string]$out, [int]$size) {
    $bmp = New-Object Drawing.Bitmap($size, $size)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Hintergrund wie die App (dunkles Blaugrau), damit das helle Logo kontrastiert
    $g.Clear([Drawing.Color]::FromArgb(255, 16, 20, 24))

    $img = [Drawing.Image]::FromFile($src)
    # Logo mit Rand einpassen (adaptive Icons schneiden Rander zu stark ab)
    $pad = [int]($size * 0.16)
    $avail = $size - 2 * $pad
    $ratio = [Math]::Min($avail / $img.Width, $avail / $img.Height)
    $w = [int]($img.Width * $ratio); $h = [int]($img.Height * $ratio)
    $x = [int](($size - $w) / 2); $y = [int](($size - $h) / 2)
    $g.DrawImage($img, $x, $y, $w, $h)
    $img.Dispose()

    $g.Dispose()
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $out) | Out-Null
    $bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  Icon: $out ($size x $size)"
}

$res = Join-Path $root 'android\app\src\main\res'
Make-Icon (Join-Path $res 'mipmap-mdpi\ic_launcher.png') 96
Make-Icon (Join-Path $res 'mipmap-hdpi\ic_launcher.png') 144
Make-Icon (Join-Path $res 'mipmap-xhdpi\ic_launcher.png') 192
Make-Icon (Join-Path $res 'mipmap-xxhdpi\ic_launcher.png') 288
Make-Icon (Join-Path $res 'mipmap-xxxhdpi\ic_launcher.png') 384
