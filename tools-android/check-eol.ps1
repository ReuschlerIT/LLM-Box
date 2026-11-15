# Prueft Zeilenenden und den exakten Suchtext des Statuszeilen-Patches.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$f = Join-Path (Split-Path -Parent $root) 'android\app\src\main\assets\webapp\js\app.js'
$txt = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
$crlf = ([regex]::Matches($txt, "`r`n")).Count
$lf = ([regex]::Matches($txt, "(?<!`r)`n")).Count
Write-Host "CRLF=$crlf  LF-only=$lf"

$needle = @'
  $('#st-right').innerHTML = `${tl}Chat: <b>${tilde}${fmt.tok(t.total)}</b> Tokens (↑ ${fmt.tok(t.prompt)} · ↓ ${fmt.tok(t.comp)})` +
    ` · Ø <b>${avg ? tilde + fmt.tps(avg) : '–'}</b> Tokens/s` + (lv && liveTps ? ` (jetzt <b>~${fmt.tps(liveTps)}</b>)` : '') +
    ` · Dauer: <b>${fmt.dur(dur)}</b>`;
'@
Write-Host "Suchtext im Datei-Wortlaut gefunden: $($txt.Contains($needle))"

# Zeile fuer Zeile pruefen, damit der Unterschied sichtbar wird
$lines = $needle -split "`r?`n"
foreach ($l in $lines) { Write-Host ("Zeile [{0}] einzeln vorhanden: {1}" -f $l.Substring(0, [Math]::Min(48, $l.Length)), $txt.Contains($l)) }
