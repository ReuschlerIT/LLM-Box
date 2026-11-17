# Filtert gesammelte UI-Texte nach deutschen Resten (bei aktiver Sprache English).
param(
  [string]$Path = 'D:\MeinProjekt\LLM-Box\tmp-texte-alle-reiter.txt',
  [string]$Out = 'D:\MeinProjekt\LLM-Box\tmp-deutsche-reste.txt'
)
$lines = Get-Content $Path -Encoding UTF8
# Typische deutsche Woerter/Wortformen, die in englischer Oberflaeche nicht vorkommen duerften.
$de = @(
  '\bund\b', '\bdie\b', '\bdas\b', '\bder\b', '\bden\b', '\bmit\b', '\bfür\b', '\bund\s', 
  '\bEinstellungen\b', '\bSpeichern\b', '\bAbbrechen\b', '\bSchließen\b', '\bÖffnen\b',
  '\bDatei', '\bOrdner', '\bModell', '\bAntwort', '\bChat', '\bWählen\b', '\bKeine\b',
  '\bBitte\b', '\bHinweis', '\bStatus', '\bZeit', '\bJahr', '\bMonat', '\bWoche', '\bTag\b',
  '\bstellen\b', '\bwird\b', '\bnicht\b', '\bdurch\b', '\büber\b', '\baus\b', '\bvom\b',
  '\bModus\b', '\bheller\b', '\bdunkler\b', '\bSprache', '\bFarben\b', '\bStandard\b',
  '\bWerkzeug', '\bRechner', '\bladen\b', '\bläuft\b', '\baktiv\b', '\bdeaktiviert\b',
  '\bdiese\b', '\bdeine\b', '\bdeinem\b', '\bIhre\b', '\bIhnen\b', '\bSie\b', '\bnach\b',
  '\bvon\b', '\bzum\b', '\bzur\b', '\beine\b', '\bein\s', '\boder\b', '\bauch\b', '\bnoch\b',
  '\bmehr\b', '\bweniger\b', '\bgespeichert\b', '\bgeladen\b', '\bgestartet\b', '\bbeendet\b',
  '\bZahl', '\bAnzahl', '\bGröße', '\bhoch\b', '\btief\b', '\bniedrig\b', '\bschnell\b',
  '\blangsam\b', '\bWerte', '\bFeld', '\bKnopf', '\bBereich', '\bFenster', '\bListe',
  '\bZeile', '\bSpalte', '\bSpalte', '\bVorschau', '\bVergleich', '\bUnterschied',
  '\bherunterladen\b', '\baktualisieren\b', '\berneuern\b', '\bentfernen\b', '\bhinzufügen\b',
  '\bdeaktivieren\b', '\baktivieren\b', '\berlaubt\b', '\bverboten\b', '\bunbekannt\b',
  '\bverfügbar\b', '\bbenutzt\b', '\bverwendet\b', '\bvorgabe', '\bVorgabe', '\bEmpfehlung',
  '\bAchtung\b', '\bFehler\b', '\bErfolg\b', '\bfertig\b', '\bgestoppt\b', '\bgestartet\b',
  '\bwird geladen\b', '\bbitte wählen\b', '\bkeine Auswahl\b', '\bZustand\b', '\bFortschritt\b'
)
$hits = @()
$seen = @{}
foreach ($l in $lines) {
  $parts = $l -split "`t"
  if ($parts.Count -lt 2) { continue }
  $tab = $parts[0]; $txt = ($parts[1..($parts.Count-1)] -join "`t").Trim()
  if ($txt.Length -lt 3) { continue }
  if ($seen.ContainsKey($txt)) { continue }
  $seen[$txt] = $true
  foreach ($p in $de) {
    if ($txt -match $p) { $hits += [pscustomobject]@{ Tab = $tab; Text = $txt; Muster = $p }; break }
  }
}
$hits | ForEach-Object { "{0}`t{1}`t[{2}]" -f $_.Tab, $_.Text, $_.Muster } | Set-Content $Out -Encoding UTF8
Write-Output ("Deutsche Treffer: " + $hits.Count + " von " + $seen.Count + " eindeutigen Texten")
Write-Output ("Gespeichert: " + $Out)
