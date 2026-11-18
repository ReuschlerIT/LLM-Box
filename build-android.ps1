# build-android.ps1 – Web-App aus der Desktop-Version aufbereiten und APK bauen.
# Quelle fuer Android-eigene Dateien ist tools-android\, kopierter Code kommt aus llm-box\.
param([switch]$SkipGradle)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$SRC = Join-Path $root 'llm-box'
$DST = Join-Path $root 'android\app\src\main\assets\webapp'
$TOOLS = Join-Path $root 'tools-android'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-File([string]$p) { [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8) }
function Write-File([string]$p, [string]$t) { [System.IO.File]::WriteAllText($p, $t, $utf8NoBom) }

# Zeilenenden anpassen: die Desktop-Quelle liefert seit 1.0.70 CRLF, die Here-Strings in
# diesem Skript (und damit alle mehrzeiligen Suchtexte) sind LF. Passt der Suchtext nicht,
# wird er auf CRLF umgesetzt und noch einmal versucht - sonst wirft z. B. der Patch fuer die
# Statuszeile ("Suchtext nicht gefunden"), obwohl die Stelle unveraendert da ist.
# Der neue Text bekommt dieselbe Zeilenendart wie der Fund, damit die Datei nicht gemischt wird.
function Align-Newlines([string]$fileContent, [string]$old, [string]$new) {
    if ($fileContent.Contains($old)) { return @($old, $new) }
    $crlf = $old.Replace("`r`n", "`n").Replace("`n", "`r`n")
    if ($fileContent.Contains($crlf)) { return @($crlf, $new.Replace("`r`n", "`n").Replace("`n", "`r`n")) }
    return @($old, $new)
}

# Ersetzt genau einmal; bricht ab, wenn der Suchtext fehlt oder mehrfach vorkommt.
function Patch([string]$file, [string]$old, [string]$new, [string]$label) {
    $t = Read-File $file
    if ($t.Contains($new)) { Write-Host "   .    $label (bereits gepatcht)"; return }
    $a = Align-Newlines $t $old $new
    $old = $a[0]; $new = $a[1]
    $n = ([regex]::Matches($t, [regex]::Escape($old))).Count
    if ($n -eq 0) { throw "Patch '$label': Suchtext nicht gefunden in $file" }
    if ($n -gt 1) { throw "Patch '$label': Suchtext $n-mal gefunden (eindeutig erwartet) in $file" }
    Write-File $file ($t.Replace($old, $new))
    Write-Host "   OK   $label"
}

# Wie Patch, akzeptiert aber mehrere moegliche Suchtexte (upstream aendert gern Details,
# z. B. hl-dark.css -> hl-light.css). Paare = @(alt1, neu1, alt2, neu2, ...).
# Genommen wird das erste Paar, dessen Suchtext genau einmal vorkommt.
function PatchAny([string]$file, [object[]]$pairs, [string]$label) {
    $t = Read-File $file
    for ($i = 0; $i -lt $pairs.Count; $i += 2) {
        if ($t.Contains($pairs[$i + 1])) { Write-Host "   .    $label (bereits gepatcht)"; return }
    }
    for ($i = 0; $i -lt $pairs.Count; $i += 2) {
        $a = Align-Newlines $t ([string]$pairs[$i]) ([string]$pairs[$i + 1])
        $n = ([regex]::Matches($t, [regex]::Escape($a[0]))).Count
        if ($n -eq 1) {
            Write-File $file ($t.Replace($a[0], $a[1]))
            Write-Host "   OK   $label"
            return
        }
    }
    throw "Patch '$label': keiner der $($pairs.Count / 2) Suchtexte eindeutig gefunden in $file"
}

Write-Host '[1/6] Web-App aus der Desktop-Version kopieren'
if (Test-Path $DST) { Remove-Item -Recurse -Force $DST }
New-Item -ItemType Directory -Force -Path $DST | Out-Null
Copy-Item -Force (Join-Path $SRC 'renderer\index.html') (Join-Path $DST 'index.html')
Copy-Item -Force (Join-Path $SRC 'renderer\styles.css')  (Join-Path $DST 'styles.css')
# Ordner in das noch leere Ziel kopieren, damit kein js\js oder vendor\vendor entsteht
foreach ($d in @('js', 'vendor', 'assets')) {
    $s = Join-Path $SRC "renderer\$d"
    if (Test-Path $s) { Copy-Item -Recurse -Force $s (Join-Path $DST $d) }
}

Write-Host '[2/6] docs.js unveraendert mit CommonJS-Huelle einsetzen'
$pre  = "var module = { exports: {} }, exports = module.exports;`n"
$post = "`nglobalThis.__setExports('docs', module.exports); globalThis.DOCS = module.exports;"
$docsrc = Read-File (Join-Path $SRC 'docs.js')
Write-File (Join-Path $DST 'js\docs.js') ($pre + $docsrc + $post)

Write-Host '[3/6] Android-eigene Skripte einsetzen'
foreach ($f in @('node-shim.js', 'native-main.js')) { Copy-Item -Force (Join-Path $TOOLS $f) (Join-Path $DST "js\$f") }
Copy-Item -Force (Join-Path $TOOLS 'android-adapter.js') (Join-Path $DST 'js\android-adapter.js')
Copy-Item -Force (Join-Path $TOOLS 'android.css')        (Join-Path $DST 'android.css')

# Syntaxprüfung: eigene Skripte werden nur kopiert, nicht kompiliert. Ein Tippfehler
# macht die ganze Datei wirkungslos (z. B. fehlender Hamburger, fehlendes SMB-Feld),
# ohne dass der Build oder das Gerat das deutlich melden wuerde.
foreach ($f in @('node-shim.js', 'native-main.js', 'android-adapter.js')) {
    & node --check (Join-Path $DST "js\$f") 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        & node --check (Join-Path $TOOLS $f)
        throw "Syntaxfehler in tools-android\$f - Build abgebrochen"
    }
}

Write-Host '[4/6] Browser-Bibliotheken (Buffer, JSZip, XML-Parser, PDF.js)'
$bundle = Join-Path $root 'webdeps\out\webdeps.js'
if (-not (Test-Path $bundle)) {
    throw 'webdeps\out\webdeps.js fehlt. Bitte ausfuehren: cd webdeps && npm i jszip@3.10.2 fast-xml-parser@4.5.7 pdfjs-dist@3.11.174 buffer esbuild && npx esbuild bundle-entry.js --bundle --format=iife --platform=browser --target=es2020 --minify --outfile=out\webdeps.js'
}
Copy-Item -Force $bundle (Join-Path $DST 'vendor\webdeps.js')
# pdf.js braucht ohne echten Web Worker seinen Handler als eigenes Skript
$worker = Join-Path $root 'webdeps\node_modules\pdfjs-dist\legacy\build\pdf.worker.min.js'
if (-not (Test-Path $worker)) { throw 'pdf.worker.min.js fehlt in webdeps\node_modules\pdfjs-dist\legacy\build' }
Copy-Item -Force $worker (Join-Path $DST 'vendor\pdf.worker.min.js')

Write-Host '[5/6] Android-Anpassungen in die kopierte Oberflaeche patchen'
$idx = Join-Path $DST 'index.html'
$app = Join-Path $DST 'js\app.js'
$set = Join-Path $DST 'js\settings.js'
$css = Join-Path $DST 'styles.css'

PatchAny $idx @(
  '  <link id="hl-theme" rel="stylesheet" href="vendor/hl-dark.css" />',
  "  <link id=`"hl-theme`" rel=`"stylesheet`" href=`"vendor/hl-dark.css`" />`n  <link rel=`"stylesheet`" href=`"android.css`" />",
  '  <link id="hl-theme" rel="stylesheet" href="vendor/hl-light.css" />',
  "  <link id=`"hl-theme`" rel=`"stylesheet`" href=`"vendor/hl-light.css`" />`n  <link rel=`"stylesheet`" href=`"android.css`" />"
) 'index.html: Mobil-Layout einbinden'

Patch $idx `
  '  <script src="js/llm.js"></script>' `
  "  <script src=`"vendor/webdeps.js`"></script>`n  <script src=`"vendor/pdf.worker.min.js`"></script>`n  <script src=`"js/node-shim.js`"></script>`n  <script src=`"js/docs.js`"></script>`n  <script src=`"js/native-main.js`"></script>`n  <script src=`"js/llm.js`"></script>" `
  'index.html: Shims, PDF-Worker, docs.js und portierten Hauptprozess laden'

Patch $idx `
  '  <script src="js/app.js"></script>' `
  "  <script src=`"js/app.js`"></script>`n  <script src=`"js/android-adapter.js`"></script>" `
  'index.html: Android-Adapter zuletzt laden'

# Standarddesign Hell (Desktop nutzt Dunkel). Bewusst gewaehlte eigene Einstellungen bleiben erhalten,
# weil nur der Default geaendert wird.
Patch $idx '<html lang="de" data-theme="dark">' '<html lang="de" data-theme="light">' 'index.html: Starttheme Hell'

# Das Workspace-Panel startet auf Android geschlossen. app.js setzt die collapsed-Klasse erst,
# nachdem alle Skripte gelaufen sind - bis dahin zeichnet der erste Frame das 280 px breite,
# helle Panel als weissen Block (vom Nutzer am 14.11. als "weises Seitenfenster beim Start"
# gemeldet). Deshalb steht die Klasse schon im HTML; app.js verwaltet sie danach wie bisher.
Patch $idx '    <aside id="filepanel"></aside>' `
         '    <aside id="filepanel" class="collapsed"></aside>' `
         'index.html: Workspace-Panel startet geschlossen (kein weisser Startblock)'

# Panel-Sichtbarkeit steuert allein die collapsed-Klasse, die app.js selbst verwaltet.
# Die pauschale Ausblendregel des Desktops wuerde sonst gegen das Schliessen arbeiten.
Patch $css `
  '@media (max-width: 1100px) { #filepanel { display: none; } }' `
  '@media (max-width: 1100px) { /* Panel-Sichtbarkeit uebernimmt die collapsed-Klasse */ }' `
  'styles.css: Panel-Ausblendregel durch collapsed-Steuerung ersetzt'

# execOn() ist die einzige Stelle, die Befehls-Werkzeuge steuert (Tool-Liste, Systemprompt, Freigaben).
Patch $app `
  "const execOn = () => S.settings.workspace.execEnabled !== false;" `
  "const execOn = () => !window.IS_ANDROID && S.settings.workspace.execEnabled !== false;" `
  'app.js: Befehls-Werkzeuge auf Android abgeschaltet'

# Panel startet zu, damit der Chat sofort die ganze Breite hat.
Patch $app '  panelOpen: true,' '  panelOpen: false,' 'app.js: Workspace-Panel startet geschlossen'

# Die Statuszeile unter dem Eingabefeld ist auf dem Handy knapp bemessen. Das vorangestellte
# "Modell:" kostet Zeichen, die fuer Tokens/Kosten/Dauer gebraucht werden - der Modellname
# steht bereits oben in der Auswahlliste. Der Fehlerfall bleibt unveraendert (dort ist der
# Text wichtig), und auch "Kein Modell gewaehlt" bleibt als Hinweis erhalten.
# Statuszeile unter dem Eingabefeld: der Modellname steht oben in der Auswahlliste, unten
# ist er auf dem Handy verschenkter Platz. Links bleiben nur Fehlermeldung und der Hinweis
# "Kein Modell gewaehlt" - beides Warnungen, keine Namen.
PatchAny $app @(
  "currentModel() ? 'Modell: ' + currentModel()",
  "currentModel() ? ''",
  "currentModel() ? currentModel()",
  "currentModel() ? ''"
) 'app.js: Statuszeile ohne Modellbezeichnung'

# Die drei Angaben bekommen je eine eigene Zeile, gleichmaessig verteilt:
#   Zeile 1: Chat (Tokens gesamt, Prompt/Antwort, Tokens/s)
#   Zeile 2: Dauer
#   Zeile 3: Kosten
# Vorher standen sie durch " · " getrennt in einem Fliesstext und brachen auf dem Handy
# mittendrin um, wodurch Werte halb abgeschnitten wirkten. Ein Patch ueber den ganzen Block
# (mehrere Zeilen) statt vier Einzel-Ersetzungen: die Quelle aendert hier oft Details.
$oldStatus = @'
  $('#st-right').innerHTML = `${tl}Chat: <b>${tilde}${fmt.tok(t.total)}</b> Tokens (↑ ${fmt.tok(t.prompt)} · ↓ ${fmt.tok(t.comp)})` +
    ` · Ø <b>${avg ? tilde + fmt.tps(avg) : '–'}</b> Tokens/s` + (lv && liveTps ? ` (jetzt <b>~${fmt.tps(liveTps)}</b>)` : '') +
    ` · Dauer: <b>${fmt.dur(dur)}</b>`;
'@
$newStatus = @'
  $('#st-right').innerHTML = `<span class="st-line">${tl}Chat: <b>${tilde}${fmt.tok(t.total)}</b> Tokens (↑ ${fmt.tok(t.prompt)} · ↓ ${fmt.tok(t.comp)})` +
    ` Ø <b>${avg ? tilde + fmt.tps(avg) : '–'}</b> Tokens/s` + (lv && liveTps ? ` (jetzt <b>~${fmt.tps(liveTps)}</b>)` : '') + `</span>` +
    `<span class="st-line">Dauer: <b>${fmt.dur(dur)}</b></span>`;
'@
Patch $app $oldStatus $newStatus 'app.js: Statuszeile mit Zeilen fuer Chat und Dauer'

$oldKosten = @'
    $('#st-right').innerHTML += ` · Kosten ${c.est || lv ? '~' : '≈'} <b>${fmt.money(amount, 'EUR')}</b>`;
'@
$newKosten = @'
    $('#st-right').innerHTML += `<span class="st-line">Kosten ${c.est || lv ? '~' : '≈'} <b>${fmt.money(amount, 'EUR')}</b></span>`;
'@
Patch $app $oldKosten $newKosten 'app.js: Statuszeile eigene Zeile fuer Kosten'

# Ab 1.0.70 zeigt die Statuszeile zusaetzlich den gemessenen Strom der Antwort
# (Einstellungen -> Kosten -> Strompreis). Ohne eigene Zeile haenge die Angabe hinter
# "Dauer" und waere auf dem Handy abgeschnitten, weil sie nicht in einem .st-line-Element
# steckt. Die bestehende Regel in android.css (.st-line { display: block }) macht daraus
# automatisch eine vierte Zeile - deshalb hier nur das HTML-Element ergaenzen.
$oldStrom = @'
      $('#st-right').innerHTML += ` · Strom ${lv ? '~' : '≈'} <b>${has ? fmt.money(energyCost(e.wh + lw), 'EUR') : '–'}</b>`;
'@
$newStrom = @'
      $('#st-right').innerHTML += `<span class="st-line">Strom ${lv ? '~' : '≈'} <b>${has ? fmt.money(energyCost(e.wh + lw), 'EUR') : '–'}</b></span>`;
'@
Patch $app $oldStrom $newStrom 'app.js: Statuszeile eigene Zeile fuer Strom'

# Enter im Eingabefeld macht auf dem Handy standardmaessig einen Umbruch (Touch-Tastatur),
# Senden wie am Desktop mit Strg+Enter bzw. der Sendetaste. Umstellbar in
# Einstellungen -> Darstellung -> "Mit Enter senden".
Patch $set `
  "fontSize: 15, showStats: true, enterToSend: true," `
  "fontSize: 15, showStats: true, enterToSend: false," `
  'settings.js: Enter macht standardmaessig eine neue Zeile'

# Einmalige Umstellung bestehender Installationen: ohne diesen Schritt behaelt ein bereits
# gespeichertes Settings den alten Wert (Enter = Senden) und der Nutzer haelte die neue
# Vorgabe fuer wirkungslos. Eingebaut nach demselben Muster wie die bestehenden Migrationen
# (V43/V46/V47) direkt im Start von app.js, mit eigenem Schalter-Feld - laeuft also genau einmal.
# Bewusst als Here-Strings: mit backtick-n fortgesetzten Einzelstrings verrutschen die
# Argumente von Patch (die neue Zeile wurde als zusaetzliches Argument gelessen), und der
# Patch meldet dann "bereits gepatcht", ohne etwas zu aendern.
$oldEnter = @'
  if (stored && stored.workspace && stored.workspace.confirmWrites === false && !stored.workspace.approval) S.settings.workspace.approval = 'none';
'@
$newEnter = @'
  if (stored && stored.workspace && stored.workspace.confirmWrites === false && !stored.workspace.approval) S.settings.workspace.approval = 'none';
  // Einmalig (Android): Enter war hier immer die Sendetaste. Auf dem Handy erzeugt Enter
  // jetzt standardmaessig eine neue Zeile; senden tut Strg+Enter oder die Sendetaste.
  // Umstellbar in Einstellungen -> Darstellung -> Mit Enter senden.
  if (window.IS_ANDROID && !S.settings.appearance.enterMigrated) {
    S.settings.appearance.enterMigrated = true;
    S.settings.appearance.enterToSend = false;
    api.store.set('settings', S.settings);
  }
'@
Patch $app $oldEnter $newEnter 'app.js: Enter macht auf Android einmalig eine neue Zeile'

# Der Kontext-Füllstand (Füllstand-Balken) steht auf dem Desktop rechts oben in der
# Kopfzeile. Auf dem Handy ist die Knopfzeile dort bereits voll; der Balken bekommt unten
# eine eigene Zeile (android.css), damit er vollstaendig lesbar ist. Der Adapter verschiebt
# das Element dafuer in die Statusleiste - siehe android-adapter.js ctxMeterUmzug().

Patch $set `
  "approval: 'write', execEnabled: true" `
  "approval: 'write', execEnabled: false" `
  'settings.js: Ausfuehren per Standard aus'

# Standarddesign Hell als Vorgabe (Desktop: Dunkel). Nur der Default geaendert, eine
# bewusst eigene Wahl des Nutzers bleibt danach erhalten.
Patch $set "    theme: 'dark', accent:" "    theme: 'light', accent:" 'settings.js: Standarddesign Hell'

Write-Host '[6/6] APK bauen'
if ($SkipGradle) { Write-Host '   (uebersprungen)'; return }

$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory | Where-Object { $_.Name -like 'jdk-21*' } | Select-Object -First 1).FullName
if (-not $env:JAVA_HOME) { throw 'JDK 21 nicht gefunden (Eclipse Adoptium)' }
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
$gradle = (Get-ChildItem "$env:USERPROFILE\.gradle\wrapper\dists" -Recurse -Filter 'gradle.bat' | Where-Object { $_.FullName -like '*8.13*' } | Select-Object -First 1).FullName
if (-not $gradle) { throw 'Gradle nicht gefunden' }

& $gradle -p (Join-Path $root 'android') assembleDebug --console=plain
if ($LASTEXITCODE -ne 0) { throw "Gradle-Build fehlgeschlagen ($LASTEXITCODE)" }

$apk = Join-Path $root 'android\app\app_build\outputs\apk\debug\app-debug.apk'
Write-Host ''
Write-Host "Fertig: $apk"
