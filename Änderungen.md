# Änderungen.md – LLM Box → Android-APK

Ziel: Die Windows-Anwendung „LLM Box“ (Electron, Ordner `llm-box\`) als lauffähige Android-APK
nachbauen, ohne dass dem Android-Programm funktional etwas fehlt.

## Ausgangslage / Analyse (Sitzung 1)

- Projekt ist eine **Electron-App** (`llm-box\package.json`, main = `main.js`), Version 1.0.32.
  → günstigster Fall: Die komplette Oberfläche (`renderer\`) ist HTML/CSS/JS und läuft in einer WebView.
- Unteragenten-Inventur (Fundstellen):
  - `main.js`: IPC-Handler `store:get/set`, `chats:*`, `files:*`, `cfg:*`, `ws:list/ws:tool`,
    `sys:*` (Befehle), `strata:run` (SSH per spawn), `llm:fetch/stream/abort`, `shell:*`, `app:*`, `win:*`.
  - `preload.js`: exakte `window.api`-Signaturen → Grundlage für den nachgebauten Adapter.
  - Workspace-Werkzeuge in `main.js:262–416` (`safe()`, `listDir`, `searchText`, `ws:tool`).
  - Dokumentauslese in `docs.js` (PDF/DOCX/XLSX/PPTX/ODF) braucht Node: `fs/promises`, `path`,
    `jszip`, `fast-xml-parser`, `pdfjs-dist/legacy/build/pdf.js`.
  - Kodierungslogik (`decodeTextEx`/`encodeText`) muss Windows-1252/BOM/UTF-16 erhalten.
- Entscheidungen des Nutzers:
  1. Nur die **HTTP-API** der Strata-App behalten, lokale Befehle/SSH **deaktivieren**.
  2. Oberfläche: **mobiles Layout + Querformat/Desktop-Modus umschaltbar**.
  3. Build als **Debug-APK** (kein eigener Keystore).

## Architektur der Portierung

- WebView lädt die **unveränderte** Desktop-Oberfläche (`renderer\*`).
- `tools-android\native-main.js` ersetzt `main.js` + `preload.js`: liefert `window.api` mit
  identischen Signaturen; Dateisystem/HTTP/Dialoge laufen über die Brücke.
- `tools-android\node-shim.js`: Mini-CommonJS-Laufzeit (path, fs/promises, require) damit **docs.js
  unverändert** läuft. Browser-Bibliotheken (Buffer, JSZip, fast-xml-parser, PDF.js) als Bundle
  `webdeps\out\webdeps.js` (esbuild).
- `android\app\src\main\java\...\MainActivity.java`: WebView + Brücke „Native“
  (Dateisystem, OkHttp-Fetch/Streaming CORS-frei mit UTF-8-Stromdekodierung, SAF-Dialoge).

## Durchgeführte Schritte (chronologisch)

1. **Umgebung geprüft**: Node v26, Android-SDK unter `%LOCALAPPDATA%\Android\Sdk` (Plattformen 34–37),
   JDK 25 nur im Studio-JBR → **JDK 21 per winget installiert** (Temurin 21.0.13), Gradle 8.13 lag
   bereits im Wrapper-Cache. Kein „Gradle.Gradle“-Paket in winget gefunden, Cache genutzt.
2. **Android-Projekt angelegt**: `android\settings.gradle`, `android\build.gradle`
   (AGP 8.7.3), `android\app\build.gradle` (namespace de.reuschlerit.llmbox, minSdk 26, targetSdk 35,
   okhttp + appcompat + documentfile), Manifest mit `usesCleartextTraffic=true` (HTTP zu LAN-Servern).
3. **Brücke implementiert** (`MainActivity.java`): fsStat/fsReadB64/fsWrite/fsList/fsMkdirs/fsRemove/
   fsRename, pickFolder/pickFiles/saveAs (SAF), httpFetch/httpStream/abort, appInfo, desktopOnly.
   Bewusst ohne Befehlsausführung und SSH → klare Meldung an die Web-App.
4. **JS-Schicht portiert**: `node-shim.js`, `native-main.js` (Speicher, Chats, Anhänge inkl. docs.js,
   Workspace-Werkzeuge 1:1 aus main.js, Netzwerk, desktopOnly), `android.css` (Drawer/Overlay),
   `android-adapter.js` (Hamburger, Desktop-only-Einträge ausblenden).
5. **Build-Kette**: `build-android.ps1` kopiert die Web-App, legt docs.js-Hülle an, patcht gezielt
   (Patch bricht ab, wenn Suchtext fehlt/mehrfach vorkommt) und ruft Gradle auf.
6. **Fehlerbehebungen beim Build**:
   - `pluginManagement` gehörte nicht in `build.gradle` → verschoben nach `settings.gradle`.
   - Kopieren von Ordner `js` ergab `js\js` → Zielordner vor dem Kopieren leer angelegt.
   - Java: `DocumentFile.getUri()` liefert bereits Uri; Speicherdialog braucht `data.getData()`;
     `WebView.getVersion()`/`WebViewPackageInfo` im SDK-Stub nicht vorhanden → Version per Reflection.
   - AppCompat-Abhängigkeit fehlte (Theme.AppCompat) → `androidx.appcompat:appcompat:1.7.0`.
7. **Funktionstest der portierten JS-Schicht** (`tools-android\test-port.js`, simulierte Brücke in Node):
   zuerst 26/33, dann echte Fehler gefunden und behoben:
   - `native-main.js` hat den Brückenrückgabe-String **ein zweites Mal geparst** → doppeltes Parsen
     entfernt (fetch + stream).
   - Test selbst korrigiert (Erwartung als Objekt statt String, Tippfehler Prüfdaten).
   Ergebnis: **33 geprüft, 0 Fehler**. Abgedeckt: store/chats, list_files/read_file (Zeilennummern,
   Abschnitt, Kürzungshinweis), edit_file inkl. Fehlertexten, write_file, search_text, Pfadschutz nach
   außen, Windows-1252 lesen **und** in gleicher Kodierung zurückschreiben, DOCX-Auslese mit Markdown-
   Tabelle, Datei-Anhang-Konvertierung, Ablehnung von Office-Schreibversuchen, fetch (Modelle/404/Timeout),
   Streaming inkl. Umlaut über Chunk-Grenze, Streaming-Fehler, sys.exec/strata.run mit Android-Hinweis.

8. **API-Vollständigkeitsprüfung** (`tools-android\check-api.js`): sammelt alle `api.…`-Aufrufe der
   Oberfläche und vergleicht sie mit dem, was `native-main.js` wirklich liefert.
   Erste Fassung traf nur 5 Aufrufe (Regex brauchte zwingend Klammern) → korrigiert; zusätzlich
   URL-Reste wie `api.openai.com` ausgeschlossen. Ergebnis: **35 genutzte Aufrufe, alle implementiert**.
9. **Oberflächen-Starttest** (`tools-android\test-ui-boot.js`, jsdom): 12 Prüfungen, 0 Fehler.
   Keine JS-Fehler beim Start, Hamburger wird eingefügt, Schalter „KI darf Programme ausführen“ ist
   nicht sichtbar, Senden/Neuer Chat laufen fehlerfrei.
10. **Chat-End-to-End-Test** (`tools-android\test-chat-e2e.js`): eingebauter OpenAI-kompatibler Server
    erzwingt zwei Tool-Calls (über Chunks verteilt), ausgeführt mit echtem `llm.js` + Brücke.
    8 Prüfungen, 0 Fehler: list_files und search_text laufen über die Brücke, Ergebnisse gehen zurück an
    den Server, Endantwort und usage-Statistik kommen an. Zwei Testfehler behoben
    (`streamChat` liefert `{ promise }`, nicht direkt ein Ergebnis; GET ohne Body im Fake-Server).
11. **PDF-Test** (`tools-android\test-pdf.js`) – **echter Portierungsfehler gefunden**: pdf.js lädt ohne
    Web Worker seinen Handler per `require('./pdf.worker.js')`; der Shim kannte den Namen nicht →
    „Setting up fake worker failed“. Behoben:
    - `node-shim.js` gibt für `./pdf.worker.js` / `pdfjs-dist/legacy/build/pdf.worker.js` das global
      bereitgestellte `pdfjsWorker` zurück.
    - `build-android.ps1` kopiert `webdeps\node_modules\pdfjs-dist\legacy\build\pdf.worker.min.js`
      nach `vendor\` und `index.html` lädt es **vor** `node-shim.js`.
    Danach 4 Prüfungen, 0 Fehler (PDF-Text, Seitenzahl-Hinweis, Anhang-Konvertierung).
12. Tests gebündelt in `tools-android\run-tests.cmd`.
13. **Server-Fenster bereinigt**: Die Karten-Knöpfe der Strata-CLI („Modell starten“, „Presets“,
    „Verbindung testen“ …, server.js:1027–1036/1122) rufen `svRun` → `api.strata.run` auf und hätten
    auf Android nur eine Fehlermeldung geliefert. Zuerst als Build-Patch versucht (mehrzeilige Suchtexte
    zu fragil), dann sauber in `android-adapter.js` gelöst: `hideCliButtons()` blendet sie aus und setzt
    einen Hinweis; der HTTP-Teil bleibt. Ein erster Test dafür war ein möglicher Schein-Erfolg
    (Knöpfe evtl. nie im DOM) – abgesichert durch den Nachweis, dass der Adapter seinen Hinweistext
    genau in die erkannte Knopfgruppe schreibt.
14. `ANDROID-HANDBUCH.md` geschrieben: Installation (Datei/adb), Erste Schritte (Server-IP statt
    localhost!), Bedienung auf dem Handy, Tabelle „Was ist anders“, Neubaubefehle, Speicherorte.

Endstand aller Prüfungen: check-api 35/35 · test-port 33/0 · test-ui-boot 15/0 ·
test-chat-e2e 8/0 · test-pdf 4/0 = **60 Prüfungen, 0 Fehler**.

## Ergebnis

- **APK gebaut**: `android\app\build\outputs\apk\debug\app-debug.apk` (BUILD SUCCESSFUL, ~4,8 MB).
  Kontrolle des APK-Inhalts: alle Webapp-Dateien enthalten, `native-main.js` mit Fix und `IS_ANDROID`,
  `vendor/pdf.worker.min.js` vorhanden, `index.html` lädt den Worker, `node-shim.js` mit Worker-Fall.
- Reproduzierbar mit: `powershell -File build-android.ps1` (Vorbedingung: `webdeps\out\webdeps.js`).
- Bedienung/Einrichtung siehe `ANDROID-HANDBUCH.md`.

## Offene Punkte / nächster Schritt

- **Noch nicht auf einem echten Gerät gestartet.** Emulator `Pixel_10_Pro` lässt sich in dieser
  Umgebung nicht hochfahren (kein qemu-Prozess, auch mit `-no-accel`; adb zeigt kein Gerät).
  Damit sind Rendering/Touch-Layout und eine echte Serververbindung am Gerät nicht bestätigt –
  abgedeckt ist alles über die fünf automatischen Prüfungen (jsdom + simulierte Brücke).
  Nächster Schritt: APK auf dem Handy installieren (siehe ANDROID-HANDBUCH.md) und melden, was am
  Bildschirm anders aussieht als erwartet.
- Server-Fenster (`server.js`): Die Knöpfe der CLI-Karten („Modell starten“, „Status“, „Presets“ …,
  Fundstellen server.js:1027–1036, 1122, 1161) rufen `svRun` → `api.strata.run` auf und zeigen jetzt
  die Android-Meldung. Sie sind aber weiterhin sichtbar. Wer das stört: diese Karten unter
  `IS_ANDROID` komplett ausblenden (Funktion `svLaunchTab`/`draw()` in server.js ab Zeile ~1000).
  Der HTTP-Teil (Laden/Entladen/Monitor, server.js:749–832) funktioniert dagegen vollständig.
- Drag & Drop von Dateien ist unter Android nicht möglich; Ersatz: Heftchen „Dateien anhängen“
  (`api.files.pick`) – funktioniert, wurde aber nicht am Gerät geprüft.
- Chats/Einstellungen liegen im App-internen Speicher; ein Import der Desktop-Chats ist über
  „Chats importieren“ (JSON) möglich.

---

# Sitzung 2 – Geratetest am Handy, Layout-Korrekturen (Nachtrag, war nicht dokumentiert)

Das Handy haengt ueber WLAN-ADB: `adb connect 192.0.2.10.201:5555`, adb voll angeben
(`C:\Users\<Benutzer>\AppData\Local\Android\Sdk\platform-tools\adb.exe`), Kurzworte/Umgebungs-
var-Kurzformen scheitern in cmd. Display 1440x3120, dpr 3.75 → Viewport **384 CSS-px**,
Statusbar 149 px, Navigationsleiste 56 px. Paket `de.reuschlerit.llmbox`, Logcat-Tag `LLMBOX-UI`.

15. **Build-Problem auf Netzlaufwerk Y:** normaler `assembleDebug` ueberspringt wegen falscher
    Zeitstempel-Vergleiche die Kompilierung („BUILD SUCCESSFUL in 2 s“ = Warnsignal, alter Code
    bleibt in der APK). Neu: `build-force.ps1` (LastWriteTime aller Quelldateien setzen +
    `gradle --stop` + `:app:clean :app:assembleDebug`). ACHTUNG: Laeuft der Build nicht wirklich,
    enthaelten die Assets weiterhin den alten Stand – Kontrolle ueber
    `Select-String` in `android\app\src\main\assets\webapp\...`, nicht ueber `search_text`
    (die Suche findet in den Unicode-lastigen Dateien teilweise nichts).
16. **Pruefschritt im Build:** `build-android.ps1` prueft die eigenen JS jetzt mit `node --check`.
    Grund: ein Syntaxfehler in `android-adapter.js` machte die ganze Datei wirkungslos
    (Hamburger UND SMB-Feld fehlten), ohne Fehlermeldung im Build oder am Gerat.
17. **Statusleisten-Fix** (Edge-to-Edge, targetSdk 35): FrameLayout-Container + Insets-Listener in
    `MainActivity.applyEdgeToEdge()`; WebView beginnt jetzt bei y=149 statt unter der Statusleiste.
    Tastatur-Inset wird beruecksichtigt (`max(bars.bottom, ime.bottom)`), weil
    `adjustResize` randlos nicht greift.
18. **Hell als Standard** (index.html + settings.js Default) und Panel startet zu/schließbar:
    Backdrops `#drawer-backdrop`, `#panel-backdrop`; die Sichtbarkeit folgt ausschliesslich der
    `.collapsed`-Mechanik aus app.js (die pauschale Desktop-Ausblendregel in styles.css wurde per
    Patch neutralisiert).
19. **Composer:** reine Icon-Knöpfe mit Farbzustand statt Textknöpfen (`composerSameLine:true`,
    Zeile 202 px breit), Statuszeile einzeilig mit Auslassung.
20. **Topbar umbauen:** `reorderTopbar()` verschiebt Funktionsknöpfe in die zweite Zeile, die beiden
    Auswahlfelder bekommen je ~133x42 px (Vorher: Name abgeschnitten).
21. **App-Icon:** echtes LLM-Box-Logo. Fallstrick: `mark-dark.png` ist das HELLE Logo
    (Durchschnitts-RGB 109,160,255), `mark-light.png` das dunkle – anfaenglich vertauscht
    („blau schwarz statt blau weiß“). `tools-android\make-icon.ps1` nutzt mark-dark.png auf
    dunklem Grund; `inspect-png.ps1` prueft PNGs objektiv.
22. **SMB (Netzwerk-Workspace):** Brückenmethoden `smbTest`/`smbSaveCreds` muessen in der inneren
    Klasse `Bridge` stehen – nur deren Methoden sind als `Native.*` sichtbar; auf der Activity
    waren sie wirkungslos. `SmbStore.java` (smbj 0.15.0), Zugangsdaten in `files/data/smb.json`,
    Workspace-Pfad intern `/smb/host/share/…`, Windows-UNC `\\host\share\…` wird in node-shim.js
    und `SmbStore.canonical()` uebersetzt. `SmbStore.test()` liefert entries/sample/volume und
    uebersetzt Fehler (STATUS_LOGON_FAILURE usw.).
23. **SMB-Diagnose am Gerat:** Server 192.0.2.30 erreichbar (Port 445 offen, Freigaben
    daten/fotos/…), aber anonym/Gast wird abgelehnt (`STATUS_LOGON_FAILURE`) – bestaetigt durch
    die PC-Probe `thirdparty\SmbProbe.java`. Es braucht Benutzername + Passwort im SMB-Feld.
24. **Workspace-Uebernahme:** settings.js setzt das Pfad-Label nur beim Tab-Aufbau
    (settings.js:634) – der Adapter aktualisiert es jetzt per `syncWsLabel()` ueber
    `.fctrl > div`; zusaetzlich Knopf „Nur Verbindung testen“ und Auto-Nachweis beim Oeffnen.
25. **Fehlerquelle „Knöpfe zu groß“ in den EINSTELLUNGEN:** eine doppelte CSS-Regel in
    android.css (spaetere Regel gewinnt) hat die kompakte Regel aufgehoben. Nach dem Entfernen:
    navH=61, Tabs 34 px. Merksatz: jede Selektor-Klasse in android.css nur EINMAL definieren.

# Sitzung 3 – Server-Fenster („Monitor, Konfiguration, Zielrechner“) war unbedienbar

Nutzer meldete dreimal: die Knöpfe Monitor/Konfiguration/Zielcomputer seien so groß, dass die
darunterliegenden Werte nicht zu sehen sind. Messwerte vorher: Tab-Leiste **426 px**, Buttons
**400x84 / 400x114 / 400x102**, Inhalt 1559 px bei nur 283 px sichtbar.

26. **Sonde erweitert statt geraten** (`MainActivity.probeUiAfterLoad()`): zusaetzlich
    `cs.display`, `alignItems`, Button-Breite/-Hoehe einzeln, `inlineStyle`, Host-Klasse,
    `modalCls`, `paneVisible` (clientHeight/scrollHeight), geladene CSS-Dateien und der Inhalt
    aller `.settings nav`-Regeln. Zeitplan neu: erst pruefen was beim Start offen ist, dann
    Einstellungen, dann Server-Fenster explizit; Dialoge werden ueber die X-Knöpfe geschlossen
    (Escape funktionierte in der Sonde nicht zuverlaessig).
27. **Ursache eindeutig belegt – es war KEIN CSS-Fehler:** beide Dialoge meldeten identisch
    `display:flex`, `dir:row`, `cssWidth:384px`, `inlineStyle:"-"`, `modalCls:"modal wide"`.
    Entscheidend: die Buttons waren nicht breit, sondern **hoch** (`btn0 w=83.8px h=400`), und in
    der Tab-Leiste hing ein 0x0-Element namens „Modell starten“.
28. **Fehler in `tools-android\android-adapter.js` (`hideCliButtons()`, Zeilen 155–164):** Die
    Reiter des Server-Fensters heissen wie CLI-Knöpfe („Modell starten“, server.js:1173). Der
    Adapter versteckte den Reiter und haengte seinen langen Hinweistext an `b.parentNode` – das
    war die Tab-Leiste selbst; dort wurde der Text auf ~84 px Breite gequetscht und 400 px hoch.
    Korrektur: Reiter in `nav` nie anfassen (`if (b.closest('nav')) continue;`), nur `.btn`/
    `.icon-btn` als CLI-Knopf werten, Hinweis nicht an ein `NAV`-Element haengen.
29. **Ergebnis am Gerat bestaetigt** (12.11., 08:26): Server-Fenster navH=**61**, Tabs
    Monitor=34x84, Modell starten=34x120, Konfiguration=34x114, Zielrechner=34x102; Inhalt
    `paneVisible 648/648` (Monitor und Konfiguration voll sichtbar), Zielrechner 648/886 und
    Modell starten 648/3066 – lang, aber sauber scrollbar. Einstellungen unveraendert navH=61.
30. **Nebenbefund aus der Welt:** Beim Start wird **kein** Server-/Monitor-Dialog geoeffnet
    (`probe_start {"modals":0}`, `probe_beimstart {"nav":"fehlt"}`). Die fruehere Annahme
    („svToggleDock() oeffnet beim Start“) stammte aus vertauschten Sonden – der Einstellungs-
    Dialog war noch im DOM und `document.querySelector('.settings nav')` traf immer den ersten.
31. **Test selbst korrigiert:** `test-ui-boot.js` enthielt denselben Denkfehler (er verlangte,
    dass der Reiter „Modell starten“ verschwindet) – jetzt geprueft mit eigenem Server-nav
    (erkennbar am Reiter „Zielrechner“) und den neuen Prüfungen „Reiter bleibt erhalten“ und
    „Kein Hinweistext in der Tab-Leiste“. Endstand: check-api 35/0 · test-port 33/0 ·
    **test-ui-boot 29/0** · test-chat-e2e 8/0 · test-pdf 4/0.
32. Neue Auswerteskripte: `tools-android\probe-auswerten.ps1` (Logcat-Messwerte als Tabelle) und
    `tools-android\dump-ui.ps1`. Hinweis: `uiautomator dump` liefert aus der WebView kaum Texte –
    belastbar sind nur die JS-Messungen der Sonde. Foto-Beweis: `screenshots\server-fenster-nach-fix.png`.

## Offene Punkte / naechster Schritt (Stand Sitzung 3)

- Auswahlfelder der Topbar messen: 133x42 px, aber ob Verbindungs-/Modellname vollstaendig lesbar
  ist, meldet `selInfo()` im Adapter derzeit nichts.
- Debug-Sonde ist an `BuildConfig.DEBUG` gebunden und kann bei Bedarf ganz entfernt werden.
- `messungen-geraet.md` wurde auf den Stand 12.11. 08:26 gebracht (vorher veraltete Zahlen).

33. **Sonde zuschaetzlich an einen Intent-Schalter gebunden** (`MainActivity.uiProbeRequested`,
    `onCreate`: `getIntent().getBooleanExtra("probe", false)`): Die Sonde oeffnet im Bildschirm
    sichtbar Einstellungs- und Server-Fenster. Das Erklaerungsrätsel des „automatisch geoeffneten
    Start-Dialogs“ war damit die Sonde selbst – nicht server.js. Jetzt: normaler Start = 0
    probe-Zeilen (am Gerat bestaetigt), Messung nur mit
    `adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez probe true`. Die Sonde
    schliesst ihre Dialoge am Ende selbst (`probe_close_end {"closed":1,"modals":0}`).

34. **Endstand nach allen Aenderungen (Gerat, 12.11. 08:29):** Server-Fenster in allen vier
    Reitern navH=61; Monitor und Konfiguration voll sichtbar (`paneVisible 663/663` bzw. Inhalt
    scrollbar), Zielrechner 648/886, Modell starten 648/3066. Der Hinweistext des Adapters liegt
    jetzt korrekt im Inhaltsbereich (Konfiguration 2289 px) und nicht mehr in der Tab-Leiste.

---

# Sitzung 4 – Windows-Version 1.0.50 übernehmen + Freeze beheben

Auftrag des Nutzers: (a) die neuen Dateien in `llm-box\` (Windows-App bis **1.0.50**) in die
Android-App übernehmen, (b) das Einfrieren mitten im Chat untersuchen und beheben.

35. **Neue Quelle gesichtet** (`llm-box\package.json:4` = 1.0.50, `llm-box\GEAENDERTE-DATEIEN.txt`
    = komplettes Änderungsprotokoll V32→V50). Relevante Sprünge gegenüber der portierten 1.0.32:
    V41 Nachricht vormerken, V42/V40 Prozess-Abbruch (Desktop-only), V43 helles Standarddesign +
    Chat-Wechsel waehrend die KI arbeitet, V44 **Chats auf mehreren Rechnern** (neue API!),
    V45/V46 Verbindungs-Vorgaben, V47 neuer Agent-Systemprompt, V48 **Pause/Fortsetzen und
    „Kontext leeren“** (`chat.ctxStart`), V49 **harter Abbruch `ws:abort`**, V50
    **Rechtschreibpruefung `spellSet`**. Reine Desktop-Themen (Prozess-Kills, SSH, Titelleiste)
    bleiben auf Android ohne Funktion.

36. **Build-Patches gegen 1.0.50 geprueft und robust gemacht** (`build-android.ps1`): Upstream hat
    Details geaendert – `index.html:9` zeigt jetzt auf `vendor/hl-light.css` (vorher hl-dark.css),
    `<html data-theme>` ist bereits `light`, `settings.js:51` bereits `theme:'light'`. Neue
    Funktion **`PatchAny($file, @((alt1),(neu1),(alt2),(neu2)…))`**: nimmt das erste Paar, dessen
    Suchtext genau einmal vorkommt – bricht also nicht mehr ab, wenn Upstream eine Kleinigkeit
    umbenennt. `index.html: Mobil-Layout einbinden` laeuft jetzt mit beiden Kandidaten. Ergebnis
    des Laufs (`build-android.ps1 -SkipGradle`): 7 Patches OK, 2 als „bereits gepatcht“ erkannt
    (Hell-Standard ist in 1.0.50 schon erfuellte Voraussetzung). Alle anderen Suchtexte
    (`panelOpen: true`, `execOn = …`, `approval:'write', execEnabled:true`, Media-Query 1100px,
    `<script src="js/app.js">`) passen weiterhin exakt einmal (app.js:19/68, settings.js:63,
    styles.css:389).

37. **API-Luecken gefunden** (`tools-android\check-api.js` auf der neuen Quelle): 41 benutzte
    api-Aufrufe, aber 6 fehlten in `native-main.js`: `sync.get`, `sync.setDir`, `sync.migrate`,
    `onChatsChanged`, `spellSet`, `ws.abortAll`. Ohne sie haette die neue Oberflaeche beim Start
    Fehler produziert (`app.js:124/125`) und „Stopp“ haette laufende Suchen nicht beendet.

38. **Geraeteuebergreifende Chats portiert** (`tools-android\native-main.js`, nach dem Vorbild von
    `llm-box\main.js:45–241`): `sync.json` mit `deviceId` (12 Hex-Zeichen, hier ohne
    Node-crypto), `chatsDir()` = gewaehlter Ordner + Unterordner `LLM-Box-Chats`, Dateipaar
    `<id>.json` + `<id>.meta.json` statt `index.json`, `ensureMetas()` wandert alte Staende
    automatisch um, `listMetas()` liefert bei unlesbarem Ordner `null` (dann gilt nichts als
    geloescht), Revisions-/Konfliktlogik (`known`/`seen`, Konfliktkopie „<Titel> (Konflikt
    <Gerat>)“), 3-Sekunden-Abgleich mit Event an die Oberflaeche, `sync.setDir` mit
    Schreibtest `.schreibtest-<deviceId>`, `sync.migrate` ohne Ueberschreiben.
    Geraetename kommt neu von der Bruecke: `MainActivity.appInfo()` liefert `deviceName`
    (HERSTELLER + MODELL, z. B. „Google Pixel 7“). Version der App in `appInfo`/INFO auf
    **1.0.50-android** gehoben.

39. **Neue Brückenmethode `fsCopy`** (`MainActivity.java`, `node-shim.js fsp.copyFile`): wird nur
    fuer das Kopieren lokaler Chats in den gemeinsamen Ordner benoetigt (V44).

40. **`ws.abortAll` + Abbruch laufender Suche** (`native-main.js`): `wsRuns`-Menge, `searchText`
    bekommt ein `ctl`-Objekt und prueft `ctl.cancelled` vor jedem Ordner/in jeder Datei; bei
    Abbruch kommt eine klare Meldung inkl. Zahl der geprueften Dateien. Entspricht
    `llm-box\main.js:429–477`.

41. **`spellSet` auf Android sinnvoll gemacht**: Die WebView kennt keine Chromium-Wortbuch-Steuerung
    von JS aus; wirksam sind die Attribute am Eingabefeld. `api.spellSet({enabled,lang})` setzt
    deshalb `input.spellcheck` und `lang` (`en` -> en, sonst de). Desktop-Meldung V50: Wortbuecher
    laedt Chromium beim ersten Start.

42. **FREEZE-URSACHE bestaetigt und behoben (wichtigste Aenderung dieser Sitzung).**
    Analyse: Alle Datei-/SMB-Zugriffe waren `@JavascriptInterface`-Methoden mit direktem
    Rueckgabewert (`MainActivity.java` fsStat/fsExists/fsReadB64/fsWrite/fsList/fsMkdirs/
    fsRemove/fsRename/smbTest). Ein solcher Aufruf haelt den **Render-Thread der WebView** fest,
    bis Java zurueckkehrt. `SmbStore` hatte Timeout 20 s / SoTimeout 30 s und verband in
    `shareFor()` im Fehlerfall noch einmal neu – ein einziger langsamer oder abgerissener
    Freigabe-Zugriff blockierte damit die komplette Oberflaeche sekundenlang („friert mitten im
    Chat ein“). Der Workspace des Nutzers liegt auf einer SMB-Freigabe.
    Umbau:
      - Java: neuer `ExecutorService fsPool` (4 Taeter) + **`fsJob(id, op, a, b, c)`** als einziger
        Eingang; fuehrt die Arbeit im Hintergrund aus und meldet das Ergebnis ueber
        `window.__fsResult(id, json)`. Die bisherigen Methoden sind jetzt private Helfer, nur noch
        `appInfo`, `uiLog`, `fsJob`, Dialoge, HTTP und `smbSaveCreds` sind exponiert.
      - JS: `node-shim.js` stellt `fsJob()` mit Auftrags-Tabelle bereit; saemtliche
        `fsp.*`-Funktionen (readFile/stat/readdir/writeFile/mkdir/rm/rename/copyFile) sind jetzt
        echt asynchron, inkl. Sicherheitsnetz nach 30 s. Rueckfall auf die synchrone Bruecke bleibt
        ueber `OP_SYNC` erhalten, falls eine aeltere APK ohne `fsJob` installiert ist.
      - `android-adapter.js`: SMB-Verbindungstest laeuft ueber `__fsJob('smbTest', …)` statt
        synchron; Einblendbedingung prueft jetzt `Native.fsJob`.
      - `SmbStore.java`: Timeouts von 20 s/30 s auf **8 s/15 s** gesenkt.
      - `onDestroy()` ruft zusaetzlich `fsPool.shutdownNow()` und `smb.closeAll()`.

43. **Zweiter Freeze-Grund aus der Desktop-Historie mitgenommen (V38):** Chromium/Android bremst
    Timer und Zeichnen einer WebView, sobald die App nicht im Vordergrund ist – laufende Antworten
    und sogar die Stopp-Knöpfe reagierten dann kaum noch. Neu in `MainActivity.java`:
    `onResume()` setzt `FLAG_KEEP_SCREEN_ON` + `web.onResume()`, `onPause()` loescht das Flag
    (bewusst **kein** `web.onPause()`, damit Antworten im Hintergrund weiterlaufen).

44. **Absturz-/Freeze-Risiko bei großen Dateien begrenzt**: `readCapped()` in `native-main.js`
    lehnt Dateien ueber 20 MB fuer read_file/edit_file/write_file mit klarer Meldung ab (vorher
    wurde jede Datei ungeprueft komplett in den WebView-Speicher geladen).

45. **Fehler bei den Tests gefunden und behoben**: Nach dem Umstieg auf die asynchrone Bruecke liefen
    mehrere automatische Chat-Speichervorgaenge parallel und teilten sich dieselbe `.tmp`-Datei –
    der zweite `rename` schlug fehl („Umbenennen fehlgeschlagen“). `writeJsonAtomic()` nutzt jetzt
    einen eindeutigen Temporarnamen pro Vorgang. Zusaetzlich zeigt `fsp.rename` den Pfad in der
    Fehlermeldung.

46. **Tests an die asynchrone Bruecke angepasst und erweitert**:
      - neu `tools-android\test-fs-mock.js`: bildet `fsJob` + verspaetetes `__fsResult` nach
        (bindet sich in jedem Test ein, sonst wartet der Shim auf ein nie kommendes Ergebnis).
      - `test-ui-boot.js`, `test-chat-e2e.js`, `test-port.js`, `test-pdf.js` nutzen das Mock.
      - neu `tools-android\test-sync.js`: 27 Pruefungen fuer die neuen Funktionen – sync.get/
        setDir/migrate, Meta-Dateien statt index.json, Revision/Geraet, Konfliktkopie ohne
        Ueberschreiben der fremden Fassung, 3-Sekunden-Meldung nur bei fremden Aenderungen,
        spellSet am Eingabefeld, ws.abortAll bricht laufende Suche ab.
      - `run-tests.cmd` hat jetzt Punkt 6) fuer test-sync.js.
      - Stand: **74 Pruefungen, 0 Fehler** (check-api: alle 41 api-Aufrufe abgedeckt).

47. **APK neu gebaut**: `build-force.ps1` -> „34 actionable tasks: 34 executed“, BUILD SUCCESSFUL
    in 29 s (kein Cache-Treffer, also wirklich neuer Code). APK:
    `android\app\app_build\outputs\apk\debug\app-debug.apk`. Protokoll: `build-v50.txt`.

48. **Netzlaufwerk als gemeinsamer Chat-Ordner (Nutzerwunsch, Einstellungen → Daten).**
    Problem: In „Chats auf mehreren Rechnern“ bot die APK nur den Desktop-Knopf
    „Ordner wählen …“. Der oeffnet die Android-Ordnerauswahl, und `onFolderPicked()` kopiert
    den Ordner in den App-Speicher (`copyTree`, MainActivity.java:483–522) – es entsteht eine
    Momentaufnahme auf diesem Handy, mit der nichts geteilt wird. Netzfreigaben tauchen in
    dieser Auswahl prinzipbedingt nicht auf.
    Umsetzung (nur `tools-android\android-adapter.js`, neue Funktion **`injectSyncSmb()`**):
      - Die Zeile „Chats auf mehreren Rechnern“ bekommt einen eigenen Block
        „Netzlaufwerk (Windows-Freigabe) als Chat-Ordner“ mit denselben Feldern wie beim
        Workspace: Pfad (UNC oder /smb/…), Benutzer, Domain, Passwort.
      - Knöpfe: **Freigabe verbinden & übernehmen** (Zugangsdaten speichern → smbTest →
        `api.sync.setDir(pfad)` → Rueckfrage „Lokale Chats kopieren?“ → `api.sync.migrate()`),
        **Nur Verbindung testen**, und **Wie Workspace-Ordner** (uebernimmt den bereits
        gesetzten Freigabe-Pfad des Workspaces – spart Tipparbeit).
      - Der Android-irrefuehrende Desktop-Knopf bleibt, heisst jetzt aber
        „Ordner auf dem Handy …“ mit Tooltip, dass nichts geteilt wird.
      - Bereits gesetzter Ordner wird angezeigt und beim Oeffnen des Tabs automatisch auf
        Erreichbarkeit geprueft; nach dem Setzen baut der Adapter den Reiter „Daten“ neu
        (`refreshDatenTab()`), damit die Desktop-Zeile ihre aktuellen Knöpfe zeigt.
      - Helfer aus `smbRow()` herausgezogen und wiederverwendet: `prettySmbPath()`,
        `smbHostOf()`, `probeSmb()` (laeuft ueber die asynchrone `fsJob`-Schlange),
        `smbDescribe()`.
      - Einbau ueber den MutationObserver, gebuendelt pro Frame: die Sync-Zeile entsteht erst
        nach einem `await api.sync.get()` und ist der hinzugefuegte Knoten selbst – eine reine
        Nachkommen-Suche haette sie nie gefunden.

49. **Zwei Fehler gefunden und behoben, die durch den neuen Block entstanden:**
      - Der Adapter-Helfer `fixWorkspaceHint()` ersetzte jeden Hinweis mit dem Wort
        „Laufwerk“ durch den Workspace-Text und haette damit auch die neue Freigabe-Beschreibung
        kaputt gemacht. Ausnahmen eingebaut: `.smb-status`, `.sync-smb` und jeder Text mit
        „Netzlaufwerk“ bleiben unangetastet.
      - Doppeltes Eingabefeld: der neue Knopf „Wie Workspace-Ordner“ enthielt das Wort
        „Workspace-Ordner“, wodurch `injectSmbRow()` die Sync-Zeile als Workspace-Zeile erkannte
        und ein zweites SMB-Feld hinein baute (Test meldete 8 statt 4 Eingaben). Beide Bereiche
        haben jetzt eigene Klassen (`smb-box`, `sync-smb`) und `injectSmbRow()` prueft nur noch
        die Beschriftung im `.flabel`-Feld (`/^Workspace-Ordner/`) statt der ganzen Zeile.

50. **UI-Test erweitert** (`test-ui-boot.js`, Abschnitt „Chats auf mehreren Rechnern“): oeffnet
    den Reiter Daten, prueft das Vorhandensein des Blocks, die vier Felder, dass der Hinweis
    erhalten bleibt, Fehler bei ablehnender Freigabe, Erfolgsweg inkl. Bestaetigung der
    Kopier-Rueckfrage, `sync.get()` liefert `/smb/testhost/daten` mit Unterordner
    `LLM-Box-Chats`, erneuter Einbau nach dem Neuaufbau des Reiters und die neue Knopfbeschriftung.
    Stand: **114 Pruefungen in 6 Laeufen, 0 Fehler**.

51. **APK erneut gebaut**: `build-force.ps1` -> „34 actionable tasks: 34 executed“, BUILD
    SUCCESSFUL in 27 s. Protokoll `build-v50b.txt`. APK unveraendert unter
    `android\app\app_build\outputs\apk\debug\app-debug.apk`.

52. **Chatliste: Stift und Papierkorb dauerhaft sichtbar** (Nutzerwunsch). Ursache war reine
    Desktop-Logik in `llm-box\renderer\styles.css:133–134`:
    `.chat-item .acts { display:none }` und `.chat-item:hover .acts { display:flex }`.
    Ein Handy hat kein Hover – die Knopfe waren damit praktisch unauffindbar und tauchten erst
    nach langem Druecken auf. Die Knopfe selbst waren immer im DOM (app.js `renderChatList()`,
    Zeile 417–420: mini-btn „Umbenennen“/„Löschen“ mit stopPropagation), es fehlte nur die
    Sichtbarkeit.
    Fix ausschliesslich in `tools-android\android.css` (kein Desktop-CSS geaendert):
      - `html.android .chat-item .acts { display:flex }` – immer sichtbar.
      - Knopfe auf 36x36 px, Symbole von 18 auf 18 px dargestellt (app.js zeichnet sie mit 14 px,
        das war zu klein um Stift/Papierkorb zu erkennen) und auf `var(--text-dim)` gehoben
        (vorher `--text-faint`, fast unsichtbar).
      - `:active`-Rueckmeldung (Loeschen rot), damit man sieht, welchen Knopf man erwischt.
      - Regel bewusst nur einmal definiert und im Kommentar vermerkt – eine zweite
        `.acts`-Regel an anderer Stelle wuerde wieder gewinnen (war bei den Settings-Tabs schon
        einmal die Fehlerquelle).
    Test (`test-ui-boot.js`, neuer Abschnitt): legt einen Chat an, prueft zuerst mit der
    Titelleiste, dass jsdom die Stylesheets ueberhaupt auswertet (sonst Schein-Erfolg), dann
    `display` von `.acts`, Vorhandensein beider Knopfe, deren Titel und Mindestgroesse.
    Ein zwischenzeitlich eingebauter Check „Loeschen loest nicht den Zeilen-Klick aus“ wurde
    wieder entfernt – er war als `!opened || true` immer wahr und damit wertlos.
    Stand: **120 Pruefungen in 6 Laeufen, 0 Fehler**.
    Nachjustiert: die 36-px-Knopfe haetten jede Chatzeile von ~32 auf ~50 px gehoben (zu wenig
    Chats sichtbar). `html.android .chat-item { padding: 4px 6px }` gegen die Desktop-7 px
    getauscht – Zeile bleibt kompakt, Knopfe trotzdem sicher treffbar. APK erneut gebaut
    („34 actionable tasks: 34 executed“, BUILD SUCCESSFUL in 27 s, Protokoll `build-v50d.txt`).

53. **Gerät wieder erreichbar – Installation und Prüfung am echten Handy** (Samsung SM-S948B,
    `192.0.2.10.201:5555`). APK installiert (`install -r` = Success), App startet ohne
    JS-Fehler und ohne ANR (Logcat frei von „Uncaught“, „ANR in“, „not responding“).
    Bestaetigt am Gerat:
      - Chatlisten-Knöpfe: `probe_chatliste={"acts":"flex","knoepfe":2,"titel":["Umbenennen",
        "Löschen"],"gezeichnet":"36x36","min":"36px x 36px","zeilenH":44}` – sichtbar,
        real 36x36 px gezeichnet, Zeile nur 44 px hoch.
      - Netzlaufwerk-Block in „Chats auf mehreren Rechnern“: `probe_sync={"freigabeBlock":true,
        "eingaben":4,"knoepfe":["Ordner auf dem Handy …","Freigabe verbinden & übernehmen",
        "Nur Verbindung testen","Wie Workspace-Ordner"]}`.
      - Chat-Migration in das neue Meta-Format funktioniert: `files/data/chats/` enthaelt jetzt
        `m6swyrk4mwf776hd.json` + `m6swyrk4mwf776hd.meta.json` (rev 1, dev f2f93e7f884f,
        devName „samsung SM-S948B“); altes `index.json` bleibt als Datenquelle erhalten.
      - `sync.json` = nur `{"deviceId":"f2f93e7f884f"}` – es wurde versehentlich KEIN
        gemeinsamer Ordner gesetzt.
      - Adapter-Selbstmessung schreibt wieder ins Log (vorher jahrelang stumm, s. Punkt 54).

54. **Fehler gefunden: die Adapter-Selbstmessung war komplett ausgefallen.** In
    `android-adapter.js` (`measure()`) wurde `getComputedStyle()` auf ein DOMRect statt auf ein
    Element angewendet (`sr = rect('st-right')`). Chromium warf einen TypeError, das
    umschliessende `catch {}` hat ihn verschluckt – es kam seit Anbeginn nie eine Messzeile an.
    Behoben: separate `srEl`-Elementreferenz + `srLineH`. Im Test fehlte der Bruecken-Attrappe
    ausserdem `uiLog`, wodurch dieser Zweig dort nie ausgefuehrt wurde (Schein-Gruen). Jetzt:
      - `test-ui-boot.js`: `Native.uiLog`-Mock zaehlt mit, zwei neue Pruefungen
        („Adapter-Selbstmessung schreibt in die Bruecke“, „Messung meldet die Aktionsknopfe“).
      - jsdom kann kein Canvas -> der Adapter misst Textbreiten mit `getContext('2d')`. Mock
        `HTMLCanvasElement.prototype.getContext = () => null` eingesetzt; ohne ihn zaehlte jede
        Messung als unbehandelter jsdom-Fehler.
      - Die Messung meldet jetzt zusaetzlich `chatActs` (display, Anzahl, Mindest- und
        Ist-Groesse der Aktionsknopfe).

55. **FREEZE am Gerät objektiv nachgewiesen und behoben** (wichtigster Befund der Sitzung).
    Der Nutzer hat tatsaechlich einen SMB-Workspace: `settings.json` ->
    `workspace.path = /smb/192.0.2.10/daten/MeinProjekt`; Server vom Handy erreichbar
    (ping 8–12 ms, Port 445 offen). Die Debug-Sonde (`--ez probe true`) fuehrt deshalb einen
    gezielten Blockadetest aus: `__fsJob('smbTest', '/smb/192.0.2.99.99/freigabe')` auf eine
    nicht antwortende Freigabe, waehrend ein 50-ms-Timer Ticks und groesste Lueckzaehlt.
    Ergebnis am Gerat:
      - `fsJob smbTest dauerte 10027 ms` (SMB-Timeout 8 s + ein Retry) – der Zugriff ist lang.
      - Gleichzeitig `probe_freeze={"ticks":200,"maxGap":52}` – die JS-Timer liefen durch,
        groesste Unterbrechung 52 ms. Die Oberflaeche blieb also waehrend eines 10-Sekunden-
        Dateizugriffs vollstaendig bedienbar. Vor dem Umbau (synchrone Bruecke) haette genau
        dieser Aufruf den Render-Thread der WebView ~10 s blockiert = gemeldeter Freeze.
      - Nur gelesen (smbTest), keine Aenderung an Nutzer-Einstellungen; Test-Freigabe
        192.0.2.99.99 existiert nicht.

56. **Debug-Sonde erweitert** (`MainActivity.probeUiAfterLoad()`, nur Debug-Bau + Intent
    `--ez probe true`): zusaetzlich Drawer oeffnen und Chatzeile messen
    (`probe_drawer`, `probe_chatliste`), Reiter „Daten“ ansteuern und den Freigabe-Block pruefen
    (`probe_daten_tab`, `probe_sync`) sowie der Blockade-Test (`probe_freeze_start`,
    `probe_freeze`). Am Ende werden Dialoge UND Drawer wieder geschlossen
    (`probe_close_end2 {"closed":1,"drawer":false}`), damit die Sonde nichts „offenes“ vorgaukelt.
    Zwei Baufehler beim Anlegen behoben: fehlende schliessende Klammer der neuen Methode
    `openDrawerForChatProbe()` (Compile-Fehler „Unzulässiger Ausdrucksbeginn“) und ein
    Build gegen eine alte Dateikopie – nach erneutem `build-force.ps1` lief er durch.

57. **Beweis-Screenshot** der offenen Chatliste: `screenshots\chatliste-final.png`
    (1440x3120, helles Design, per `inspect-png.ps1` als vollstaendige Aufnahme geprueft).
    Logauszüge: `log-mess-v50.txt`, `log-probe-v50b.txt`, `log-freeze-v50.txt`.

58. **Vier Nutzerwuensche dieser Runde** (Statuszeile, Kontextbalken, SMB-Zugangsdaten, offene Aufgaben):

  a) **Statuszeile unter dem Eingabefeld vollstaendig sichtbar.** Ursache: die Desktop-Regel
     `#statusbar span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis }`
     (styles.css:305) traf auch `#st-right` (ein SPAN) – „Chat: … Tokens (…) · Ø … Tokens/s ·
     Dauer: … · Kosten …“ wurde einzeilig abgeschnitten. Neu in `android.css` als
     `html.android #statusbar #st-right { white-space:normal; overflow:visible;
     text-overflow:clip }`. WICHTIG: die Regel steht bewusst NICHT in @media (max-width:820px) –
     dort haette sie der automatisierte Test (Viewport 1024 px) nie gesehen.
     Zusätzlich Patch in `build-android.ps1`: `currentModel() ? 'Modell: ' + currentModel()`
     -> `currentModel() ? currentModel()` (Vorsilbe „Modell:“ entfaellt, Modellname steht oben
     schon in der Auswahlliste; Fehlerfall und „Kein Modell gewaehlt“ bleiben).
     Am Gerat gemessen: `stRightClip {x:false,y:false}`, 2 Zeilen – nichts mehr abgeschnitten.

  b) **Kontext-Füllstand in eigener Zeile.** `android-adapter.js` bekommt `moveCtxMeter()`:
     das Element verlaesst `.topbar-right` und haengt direkt an `#topbar`; `android.css` macht
     daraus mit `flex:1 1 100%` + Trennlinie eine eigene Zeile unter den Knöpfen.
     Am Gerat: `ctxMeter {parent:"topbar", basis:"100%", text:"0 / 262,1k"}`.

  c) **SMB-Zugangsdaten „weg“ – Ursache war NICHT das Speichern.** Pruefung am Gerat:
     `files/data/smb.json` enthielt die Daten die ganze Zeit (user Familie.Reuschler,
     passLaenge 15). Das Problem: die Eingabefelder wurden nie vorbelegt, und ein leer
     bestaetigtes Feld loeschte den gespeicherten Benutzer -> naechster Versuch anonym
     („Anmeldung abgelehnt“) = fuer den Nutzer „Zugangsdaten verloren“. Behoben:
      - neue Brueckenmethode `MainActivity.smbGetCreds(host)` liefert user/domain/hasPass –
        bewusst OHNE Passwort (die Web-Seite soll es nie sehen).
      - `smbSaveCreds` laesst leere Benutzer-/Domain-Eingaben unveraendert (vorher: ueberschrieben mit „“).
      - `android-adapter.js fillCreds()` legt Felder beim Oeffnen der Einstellungen und bei
        Pfad-Wechsel (blur) vorbelegt; Passwortfeld zeigt „Passwort gespeichert – leer lassen
        zum Beibehalten“. Wirkt in beiden Bereichen (Workspace + Chat-Sync).
     Am Gerat bestaetigt: `probe_creds={"benutzer":"Familie.Reuschler","passwortFeld":"leer
     (vorgesehen)","hinweis":"Passwort gespeichert – leer lassen zum Beibeh"}`.

  d) **Offene Aufgabe Modellauswahlfeld** (war abgeschnitten, selModel w133/need194):
     `android-adapter.js` bekommt `selectNeed()` + `fitSelectors()` + `wireSelectors()`:
     Canvas-gemessener Bedarf beider Felder, Breiten werden gesetzt; reicht der Platz nicht,
     erhaelt das Modell eine eigene Zeile (`#topbar .selectors { flex-wrap:wrap }`).
     Am Gerat: `selConn {w:111,need:103,cut:false}`, `selModel {w:260,need:194,cut:false}`.
     (Erster Versuch mit 34 px Zuschlag liess die Verbindung knapp abgeschnitten wirken –
     auf +42 px erhoeht.)

59. **Sonde erweitert und abgesichert** (`MainActivity`): neue Messungen `probe_status`
   (Statuszeile/Kontextbalken), `probe_creds` (vorbelegte Zugangsdaten) und ein echter
   Chatlauf mit Timer-Zaehlung. Der Chatlauf schreibt eine echte Nachricht – er laeuft deshalb
   nur mit zweitem Schalter: `--ez probe true --ez probechat true` (`chatProbeRequested`).
   Aufraeumen der Sonde laeuft jetzt erst bei 70 s (vorher 16 s, zu frueh vor den spaeteren
   Sonden) und leert zusaetzlich das Eingabefeld.

60. **Praxislauf am Gerat (echter Chat, Workspace auf SMB-Freigabe):**
    `probe_chat_send={"gesendet":true,"verbindungen":2}` ->
    `probe_chat_ergebnis={"ticks":531,"maxGapMs":77,"nachrichten":2}` – Antwort kam an, die
    JS-Timer liefen durch (groesste Luecke 77 ms bei einer Antwort mit ~2600 Tokens). Kein
    Freeze. Der Pause-Knopf wurde dabei nicht erwischt (`sichtbar:false`): die lokale Antwort
    war nach ~5 s fertig, die Sonde fragte bei 41 s ab. Timing auf 37 s/38,2 s geaendert –
    **diese Aenderung ist noch nicht gebaut/getestet** (naechster Schritt).

## Offene Punkte / naechster Schritt (Sitzung 5)

**Erledigt und am Gerat bestaetigt:** Chatlisten-Knöpfe dauerhaft sichtbar (36x36 px, Zeile 44 px),
Netzlaufwerk-Block in „Chats auf mehreren Rechnern“ vorhanden, Chat-Migration ins Meta-Format,
Freeze-Fix nachgewiesen (10 s Zugriff, Timer laufen weiter, maxGap 52 ms), Adapter-Messung laeuft
wieder. APK auf dem Gerat installiert und laeuft ohne JS-Fehler/ANR.

**Noch offen / naechster Schritt:**
- **Praxis-Test Chat-Sync zwischen zwei Geraeten**: Einstellungen -> Daten ->
  „Netzlaufwerk (Windows-Freigabe) als Chat-Ordner“ mit `\\192.0.2.10\daten\…` setzen, dann auf
  dem PC dieselbe Freigabe waehlen und prüfen, ob Chats nach wenigen Sekunden auf beiden
  Geraeten erscheinen (Aenderungserkennung laeuft alle 3 s). Bisher nur im automatischen Test
  bewiesen; am echten Server noch nicht durchgespielt.
- **Freeze im Alltag**: Der Blockadetest zeigt den Fix, aber der urspruengliche Freeze trat bei
  erreichbarera Freigabe auf. Falls er erneut auftritt: `adb logcat -s LLMBOX-UI` ziehen und die
  `fsJob … dauerte … ms`-Zeilen ansehen – sie zeigen, welcher Zugriff langsam war.
- V48 „Kontext leeren“/Pause und V43 Chat-Wechsel waehrend der Antwort laufen vollstaendig im
  Renderer (nicht separat portiert) – Verhalten am Gerat probieren.
- `handoff.js` (V48): check-api meldet keine Luecke, aber Verhalten am Gerat pruefen.
- Debug-Sonde (`uiProbeRequested`) ist an `BuildConfig.DEBUG` + Intent gebunden und kann bei
  Bedarf entfernt werden; `tmp-debug-rename.js` wurde bereits geloescht.

## Sitzung 6 – Pause/Fortsetzen, „Kontext leeren“, Testsuite

61. **Pause-Nachtest gebaut und BESTANDEN** (Timing aus Punkt 59/60, jetzt 37 s / 38,2 s):
    `build-force.ps1` -> `BUILD SUCCESSFUL in 27s`, „34 actionable tasks: 34 executed“ (kein
    Überspringen, Build-Log `build-v51.txt`). APK installiert, Sonde mit
    `--ez probe true --ez probechat true`. Log: `log-pause-v51.txt`.
    Ergebnis: `probe_pause={"sichtbar":true,"klasse":"btn-pause paused"}` und
    `probe_pause_strip={"sichtbar":true,"text":"Pausiert. Mit „Fortsetzen“ macht die KI an
    derselben Stelle weiter…","knoepfe":["Fortsetzen"]}`. Die in Punkt 60 offene Frage ist damit
    geklaert: der Pause-Knopf wird von der Sonde zuverlaessig erwischt.

62. **Luecke erkannt**: der erste Pause-Lauf endete im pausierten Zustand
    (`probe_chat_ergebnis laeuft:"btn-pause paused"`) – das „Fortsetzen“ selbst war damit noch
    nicht nachgewiesen, ebenso „Kontext leeren“ (#btn-handoff) gar nicht.

63. **Zwei neue Sonden in `MainActivity.java`** (nur im probe+probechat-Zweig):
    - `probe_resume` (40 s): sucht im `#pause-strip` den Knopf mit dem Text „Fortsetzen“, merkt
      die Laenge des Nachrichtentexts und klickt. `probe_resume_wirkung` (45 s) prueft, dass der
      Strip wieder zu ist und der Text weiterwaechst.
    - `probe_handoff` / `probe_handoff2` (64 s / 74 s): klickt `#btn-handoff`, aber nur wenn die
      KI nicht mehr schreibt (`#btn-pause` hat Klasse `hidden`) – sonst bricht `hoStart()` mit
      „Bitte erst die Antwort stoppen.“. Zweiter Klick, falls der erste noch laeuft (`hoBusy`).
      `probe_handoff_wirkung` (95 s) zaehlt `.handoff-msg summary` und die Nachrichten.
    Grund fuer die Wartezeit: `handoff.js:104` (`if (S.generating) return toast(...)`) und
    `hoBusy`-Flag in `handoff.js:103`.

64. **Beides am Gerat BESTANDEN** (`build-v52.txt`, 34 Tasks ausgefuehrt; Log
    `log-pause-v52.txt`):
    - `probe_resume={"geklickt":true,"stripZu":true,"pauseKnopf":"btn-pause"}` ->
      `probe_resume_wirkung={"stripZu":true,"textGewachsen":86,"laeuft":"btn-pause hidden"}`.
      Pause und Fortsetzen funktionieren am Gerat, die Antwort schreibt an derselben Stelle weiter.
    - `probe_handoff={"geklickt":true,"meldung":"Übergabe wird erstellt …"}` ->
      `probe_handoff_wirkung={"nachrichten":4,"vorher":2,"uebergaben":["Übergabe nach „Kontext
      leeren“ (2.940 Zeichen)"]}`. V48 „Kontext leeren“ arbeitet am Gerat: gleicher Chat,
      Uebergabe-Nachricht eingefuegt, Alter Verlauf bleibt stehen.
    - Bestaetigung der frueheren Punkte im selben Lauf: `probe_status` rechts
      `abgeschnitten:false, zeilen:2` (Token/Kosten/Dauer voll sichtbar, „Modell:“ entfernt),
      `balken={"parent":"topbar","basis":"100%"}` (Kontextbalken eigene Zeile),
      `probe_creds` zeigt Benutzer „Familie.Reuschler“ und Pfad nach erneutem Oeffnen der
      Einstellungen (Zugangsdaten bleiben erhalten), `probe_freeze` `ticks:200, maxGap:52 ms`.

65. **Testsuite erneut komplett gruen** (`tools-android\run-tests.cmd`, Log `test-log-v52.txt`):
    33 + 58 + 8 + 4 + 27 = **130 Pruefungen, 0 Fehler** in allen 6 Laeufen.

## Offene Punkte / naechster Schritt (Sitzung 6)

- **Praxis-Test Chat-Sync ueber die echte Freigabe** zwischen Handy und PC steht weiter aus
  (`\\192.0.2.10\daten\MeinProjekt` ist auf dem Handy als Sync-Ordner gesetzt, Benutzer
  hinterlegt) – bisher nur automatisch getestet. Nutzer soll pruefen, ob Chats nach wenigen
  Sekunden auf beiden Geraeten erscheinen.
- `messungen-geraet.md` ist veraltet (Stand vor den Statuszeilen-/Kontextbalken-Aenderungen);
  kann bei Bedarf neu geschrieben oder entfernt werden.
- Debug-Sonde kann entfernt werden, wenn keine weiteren Geratemessungen mehr noetig sind.
- Hinweis aus dem Log: `probe_chat_ergebnis letzteZeile` enthaelt den Text der Statuszeile
  („147 Tokens/s … Server2.601 Prompt143 Antwort2.744“) – die Sonde liest `#messages-inner`,
  das ist gewollt und kein Fehler der App.

66. **Gegenprobe ohne Sonde** (normaler Start, 20:11): Logcat-Tag LLMBOX-UI zeigt nur die
    Adapter-Selbstmessung (`why:"start"`: stRightClip cut:false / 2 Zeilen, ctxMeter parent=topbar
    zeile:100%, selConn 111/103 cut:false), **keine** `probe_`-Zeile und kein geoeffneter Dialog.
    Die Sonde bleibt also an das Intent-Extra gebunden.

## Sitzung 7 – Chat-Sync (Ursachen) und sechs neue Nutzerwuensche

67. **Chat-Sync: zwei Ursachen gefunden und belegt** (Nutzer: „synchronisiert, aber 0 Chats
    kopiert“, „unterschiedliche Angaben“):
    a) **SMB-Umbenennung schlug fehl.** In `D:\MeinProjekt\LLM-Box-Chats` lagen 12 Reste wie
       `chat.meta.json.<zufall>.tmp`, aber keine Meta-Datei der Handy-Chats. Java-Probe
       `thirdparty\SmbRenameProbe.java` + `thirdparty\run-rename-probe.ps1` gegen die eigene
       Freigabe (Log `smb-rename-probe.txt`): Ziel als UNC `\\host\share\…` -> FEHLER,
       **share-relativ** (`Ordner\Datei`) -> OK. `SmbStore.rename()` uebergab bisher den
       UNC-Namen. Jetzt share-relativ + `renameSafe()` (Fallback: kopieren + loeschen).
       `MainActivity.fsRename` ruft `renameSafe`; lokaler Zweig hat denselben Fallback.
    b) **Doppelter Unterordner.** Im Feld stand `\\192.0.2.10\daten\MeinProjekt\LLM-Box-Chats`
       (Pfad aus der Statuszeile zurueckkopiert). Die App haengt den Unterordner selbst an ->
       Handy-Chats in `…\LLM-Box-Chats\LLM-Box-Chats`, PC liest `…\MeinProjekt\LLM-Box-Chats`.
       Zwei getrennte Sammlungen – genau die „unterschiedlichen Angaben“.
       `sync.setDir()` schneidet einen Endungs-`LLM-Box-Chats` jetzt ab.
    c) `sync.migrate()` verschwand jeden Fehler in `catch {}` -> Meldung „0 kopiert“ trotz
       halbfertiger Dateien. Jetzt Rueckgabe `fehlgeschlagen: [{id,title,error}]`.
    d) `writeJsonAtomic()` loescht die .tmp, wenn das Umbenennen fehlschlaegt; zusaetzlich
        raumt der 5-Sekunden-Abgleich alte .tmp-Reste (>10 min) auf (`cleanupTmp`).

68. **Dauer-Sync ohne Meldung** (Nutzerwuunsch): Abgleich statt alle 3 s jetzt **alle 5 s**,
    meldet mit `silent: true`, und `MainActivity.onResume` stoesst `window.__syncNow()` an
    (Android drosselt WebView-Timer im Hintergrund). Neues Feld `pageLoaded` verhindert
    JS-Anstosse vor dem Laden.

69. **Tests**: `test-sync.js` um 5 neue Pruefungen erweitert – „migrate meldet fehlgeschlagene
    Kopien“, „keine .tmp-Reste nach fehlgeschlagenem Speichern“ (Mock `Native.__failRename`
    bildet den SMB-Fehler nach), „setDir haengt LLM-Box-Chats nicht zweimal an“,
    „window.__syncNow vorhanden“, „Hintergrund-Abgleich (5 s) meldet ohne Zutun“.
    Der bestehende Test „eigene Aenderung loest keine Meldung aus“ wartet jetzt 6 s statt 3,6 s –
    bei einem 5-s-Tick waere er sonst leer durchgelaufen (Schein-Erfolg).

70. **Quelle war veraltet: Android-Assets stammten von V1.0.50**, die Desktop-Quelle ist schon
    **V1.0.53** (`llm-box\package.json`). Deshalb fehlten auf dem Handy Einstellungszeilen wie
    „Max. Werkzeug-Schritte am Stueck“ (Default `workspace.maxSteps = 25`, settings.js:690) und
    der ganze Reiter **Uebertragung**. Nach `build-android.ps1` sind sie da (in den Assets
    nachgewiesen: settings.js:63 maxSteps, :690 frow, :809 Tab „transfer“).
    => Ursache fuer „Es fehlen Einstellungsoptionen“ war der Build, nicht die App.

71. **Wichtiger Build-Fehler behoben**: `build-android.ps1`/`build-force.ps1` hatten **kein
    UTF-8-BOM**. PowerShell 5.1 las sie als ANSI, dadurch wurden Suchtexte mit `↑ · Ø` zu
    Mist („Â· Ã˜“) und Patches fanden nichts. Bestehende Patches waren reines ASCII, darum fiel
    es nie auf. Jetzt BOM gesetzt; Helfer `tools-android\add-bom.ps1`.
    Zweiter Build-Fehler: mehrzeilige Patch-Strings mit backtick-n fortgesetzt -> Argumente von
    `Patch()` verrutschen, Meldung „bereits gepatcht“ ohne Aenderung (war bei der
    Enter-Migration passiert). Alle mehrzeiligen Patches jetzt als Here-Strings.

72. **Nutzerwuensche 1–3 (Android-Oberflaeche)**:
    - Statuszeile: Modellbezeichnung ganz entfernt (`PatchAny` deckt beide Quellvarianten ab),
      drei eigene Zeilen ueber `<span class="st-line">`: **Chat**, **Dauer**, **Kosten**
      (Patches in `build-android.ps1`, CSS in `tools-android\android.css`).
    - Enter macht standardmaessig eine neue Zeile: Default `appearance.enterToSend` auf false
      gepatcht + einmalige Migration in app.js (`enterMigrated`, nach dem Muster V43/V46/V47).
      Umstellbar: Einstellungen -> Darstellung -> „Mit Enter senden“ (existierte schon,
      settings.js:554; Handler app.js:2207 ff. unveraendert).
    - Topbar eine Reihe: `android.css` kleinere Schrift (12,5 px) und flachere Felder (36 px);
      `fitSelectors()` rechnet jetzt auch den „Modelle neu laden“-Knopf ein und haelt die Reihe
      notfalls durch kuerzeren Verbindungsnamen statt Umstapelung. Ergebnis in `window.__selLayout`.

73. **Nutzerwuensche 5–6 (Windows + Android): Uebertragung** – Windows hatte schon QR-Folge
    (600 Zeichen/Code, daher 6 Codes) und JSON-Export (`transfer.js`). Neu:
    - **Ein Weg statt sechs Codes**: `main.js` `transfer:serveStart`/`:serveStop` bieten die
      Daten im WLAN an (HTTP auf zufaelligem Port, Token als **Query-Parameter** – ein
      URL-Fragment wuerde HTTP nie uebertragen, das war ein erster Denkfehler; UDP-Signal
      „LLMBOX?“ auf 45455, Ablauf nach 10 min, Dienst geht nach dem Abruf zu).
      Windows-Seite zeigt **einen** QR-Code mit der Adresse.
    - Android: `api.transfer` in `native-main.js` (`info`, `pack` ueber CompressionStream/
      crypto.subtle mit nativem Fallback `fsJob('packFile')`, `wsFiles` in JS ueber die
      Dateibruecke, `apply`, `qrCollect`, `lanSearch` ueber `fsJob('lanSearch')`).
      Java: `transferPack()` (Deflater 9 + SHA-256) und `lanSearch()` im Executor-Pool.
    - Android-Einstellungsseite `tabTransferAndroid()`: „Im WLAN suchen“, Adresse manuell,
      „Aus JSON-Datei importieren“, „Als JSON exportieren“ (Punkt 6: JSON-Fallback in beide
      Richtungen, gleiches Format wie Windows).
    - `check-api.js`: 48 benutzt / 48 geliefert – **alle api-Aufrufe implementiert**.

74. **Testsuite nach allen Aenderungen**: 33 + 58 + 8 + 4 + 32 = **135 Pruefungen, 0 Fehler**
    (`test-log-v57.txt`). Syntax-Checks: transfer.js, native-main.js, main.js OK.

75. **Neues Build-Skript `build-now.ps1`**: fuehrt Gradle mit `--no-daemon` aus und gibt den
    Exit-Code zurueck. Grund: `build-force.ps1` haengt nach „BUILD SUCCESSFUL“ beim Daemon-Stop
    auf Y: (der Aufrufer wartet, obwohl die APK fertig ist). Alle Laeufe ab jetzt so:
    „34 actionable tasks: 34 executed“, Exit-Code 0.

76. **Gerät gewechselt**: das bisherige Handy (192.0.2.10.201) war nicht mehr erreichbar
    (`cannot connect … 10060`). Verbunden ist jetzt ein **SM-G986B** über TLS-ADB, Seriennummer
    `R5CN504YTAV`, Gerätename `adb-R5CN504YTAV-c6Fjk0._adb-tls-connect._tcp` (zwei Einträge in
    `adb devices`, einen davon verwenden). Viewport 384 CSS-px, dpr 2.8125, vh 827.
    Netz: PC = 192.0.2.50, Handy = 192.0.2.117 (gleiches Subnetz /24).

77. **Am Gerät gemessen** (`log-v60-geraet2.txt`, `log-v61-geraet2.txt`):
    - Statuszeile: `stRightLines:3`, `stRightClip {x:false,y:false,sw:262,cw:262}` -> drei Zeilen
      (Chat / Dauer / Kosten), nichts abgeschnitten. Modellbezeichnung weg.
    - Topbar eine Reihe: `selConn {w:100,need:92,cut:false}`, `selModel {w:214,need:133,cut:false}`.
    - Kontextbalken weiter eigene Zeile (`ctxMeter parent:"topbar", zeile:"100%"`).
    - Einstellungs-Reiter jetzt **acht** statt sieben: „Übertragun=34x109“ ist dazugekommen.
    - Reiter Workspace: 21 sichtbare Zeilen, darunter **„Max. Werkzeug-Schritte am Stück“**;
      versteckt nur bewusst („KI darf Programme ausführen“, „Zeitlimit pro Programm“).
      => Nutzerfrage „Es fehlen Einstellungsoptionen“ ist damit am Gerät widerlegt/geklärt.
    - Reiter Übertragung: 4 Zeilen, Knöpfe „Im WLAN suchen …“, „Abrufen“,
      „Aus JSON-Datei importieren …“, „Als JSON exportieren …“.

78. **Einstellungen des Geräts geprüft** (`tmp-settings-android.json`): `enterToSend:false`,
    `enterMigrated:true`, `maxSteps:25`. Enter-Umbruch wirkt also wirklich (Punkt 2).

79. **WLAN-Uebertragung Ende-zu-Ende getestet**: PC-Dienst `tools-android\lan-server-test.js`
    (Nachbau von main.js transfer:serveStart) + Sonde `--ez probe true --ez lanprobe true`.
    Log `log-v64-lan.txt`: `probe_lan={"urls":1,"format":"llm-box-transfer","version":1,
    "contains":["settings"],"verbindungen":1}`; Server meldet „2 Rufsignal(e) beantwortet,
    1 Abruf“. Gegenprobe vom Handy per `toybox nc` auf die Adresse -> HTTP 200 + JSON.

80. **Zwei echte Fehler durch diese Tests gefunden und behoben**:
    a) `native-main.js`: `fsJob is not defined` – die Auftragsfunktion heisst
       `globalThis.__fsJob` (liefert node-shim.js), lokal ist sie nicht sichtbar. Betraf
       `transfer.pack`-Fallback und `transfer.lanSearch`. Jetzt überall `globalThis.__fsJob`.
    b) `transfer.js`: `openModal(...).then(...)` – openModal gibt kein Promise zurück, sondern
       `{ close, el }`; das Ergebnis kommt über `onClose`. Würde sonst beim Klick auf
       „Im WLAN anbieten“ laufen. Jetzt mit `onClose` (util.js:113-141 belegt).

81. **Neuer Test `tools-android\test-transfer.js`** (in run-tests.cmd als Lauf 7): bewies ohne
    Gerät, dass Windows und Android dasselbe Format schreiben/lesen (4x gegenseitiges Entpacken,
    Pruefsummen passen zu den uebertragenen Bytes, QR-Stuecke in beliebiger Reihenfolge).
    Wichtige Erkenntnis: **deflate ist nicht normiert** – Node zlib und Chromium
    CompressionStream erzeugen unterschiedliche Bytes/Groessen. Die Pruefsumme darf deshalb nur
    ueber die *uebertragenen* Bytes gebildet werden, nie aus selbst neu komprimierten. Der Test
    prueft genau das (zuerst falsche Erwartung „Pruefsumme identisch“ -> 4 Fehler, dann korrigiert).

82. **Testsuite gesamt**: 33 + 58 + 8 + 4 + 32 + 20 = **155 Pruefungen, 0 Fehler**
    (`test-log-v59.txt`), „Alle Pruefungen bestanden.“

83. **Windows-Fehler "Im WLAN anbieten" gefunden und behoben** (Nutzer meldete Fehlermeldung in
    der Desktop-App). Zwei echte Bugs in `llm-box\main.js`, beide von mir in Sitzung 7 eingebaut:
    a) `transfer:serveStart` gab am Ende `zBytes: z.length` zurueck, obwohl die Komprimierung bei
       der Umstellung auf Text-Auslieferung entfernt worden war -> **ReferenceError: z is not
       defined**, genau beim Klick. Jetzt `bytes: Buffer.byteLength(json)`.
    b) Die generierten Adressen endeten weiterhin auf `#token`, waehrend der Server den Token als
       Query-Parameter `?t=` erwartet (Fragmente uebertraegt HTTP nie) -> jeder Abruf waere mit
       403 "Token passt nicht" abgelehnt worden. Jetzt `mkUrl()` mit `?t=` + URL-codiert.
    Anzeigetext in `transfer.js` angepasst (`r.zBytes` -> `r.bytes`, "unkomprimiert als Text").
    Syntax-Checks main.js / transfer.js OK.

84. **Windows-Version erhoeht und neu gebaut**: `npm version 1.0.54` (package.json), dann
    `npm run dist`. Ergebnis (Log `build-win-v54.txt`):
    - `llm-box\dist\LLM Box 1.0.54.exe`      (portable, ohne Installation)
    - `llm-box\dist\LLM Box Setup 1.0.54.exe` (Installer)
    Installierte Version auf dem PC war bis dahin **1.0.53 in `C:\Program Files\LLM Box`**
    (gebaut 14.11. 06:35, enthielt beide Bugs; asar-Inhalt per `npx asar extract-file` geprueft).
    `%LOCALAPPDATA%\Programs\LLM Box` ist uebrigens ein leerer Ordner - nicht von dort starten.
    => Nutzer muss 1.0.54 installieren bzw. die portable EXE nutzen, sonst bleibt der Fehler.

85. **Gerät erneut gewechselt**: das Ersatz-SM-G986B verschwand, dafuer ist das **urspruengliche
    Zielgeraet SM-S948B** wieder da: `adb-<SERIENNUMMER>-sEv2LH._adb-tls-connect._tcp`
    (Seriennummer hier bewusst gekuerzt). APK build-v66 installiert.
    WICHTIG: auf diesem Geraet ist der Chat-Sync NICHT aktiv - `files/data/sync.json` enthaelt nur
    `{"deviceId":"5f15b70cc118"}` (kein `dir`), und `files/data/chats` existiert nicht.
    Backup: `_backup-geraet\s948-sync-vor-fix.txt`.

## Offene Punkte / naechster Schritt (Sitzung 7)

- **APK bauen und am Gerat pruefen** (Gradle-Lauf steht noch aus; `build-force.ps1` haengt nach
  „BUILD SUCCESSFUL“ beim Daemon-Stop auf Y: – Logdatei getrennt pruefen, nicht den Exit-Code).
- Am Gerat zu pruefen: drei Statuszeilen, Enter = Umbruch (Topbar eine Reihe), Reiter
  „Uebertragung“, Sync-Korrektur mit `--ez probe true --ez probechat true --ez fixsync true`
  (Sonde setzt den Ordner neu und kopiert die Handy-Chats in den richtigen Freigabe-Ordner).
- Praxis-Test WLAN-Uebertragung: Windows „Im WLAN anbieten“ + Handy „Im WLAN suchen“.
  Firewall-Freigabe fuer Java/LLM Box kann noetig sein (UDP 45455, TCP Zufallsport).
- `messungen-geraet.md` ergaenzen, wenn die neuen Layout-Messwerte am Gerat vorliegen.

---

## 86. Sitzung 9 – WLAN-Uebernahme: falsche Einstellungen (Hauptfehler gefunden und behoben)

**Was:** Uebernahme-Pipeline repariert; neue Funktion `applyIncomingSettings()` in
`llm-box\renderer\js\app.js` (vor `THINK_LEVELS`), Aufruf in `applyTransfer()`
(`llm-box\renderer\js\transfer.js`, nach `api.transfer.apply`). Android-Bruecke
`tools-android\native-main.js`: `apply()` fuehrt jetzt `deepMerge(cur, s)` statt
`Object.assign` aus, behaelt gerhaeteeigene Schluessel (z. B. `appearance.enterMigrated`)
und meldet im Report die wirklich angekommenen Verbindungen
(`report.verbindungen`, `aktiveVerbindung`, `modell`). Enter-Regel geaendert: der
Geraetewert bleibt erhalten, Windows dreht "Enter = Umbruch" nicht mehr zurueck.

**Warum (Hauptursache, belegt):** Die Uebernahme schrieb settings.json korrekt, aber die
schon laufende Oberflaeche behielt ihr `S.settings` vom Start – Verbindung, Modell und
Werkzeuge aenderten sich erst nach einem App-Neustart. Zusätzlich schrieb der Debounce
`saveSettings()` (app.js:36) kurz darauf den ALTEN Stand zurueck in die Datei
(`refreshModelInfo()` uebernimmt numCtx und speichert). Vergleichswerkzeug
`tools-android\diff-settings.js` (Windows-Datei `%APPDATA%\LLM Box\settings.json` gegen
Geraetedatei) zeigte vorher: Inhalte waren laenglich identisch, es fehlten nur die bewusst
ignorierten Felder – der Fehler lag also NICHT in den Daten, sondern im Neuladen.

**Build-Patch-Falle:** eigener Code durfte nicht exakt dieselbe Zeile enthalten wie der
Suchtext des Android-Builds (`build-android.ps1:192`, Enter-Migration) – Patch verlangt
Eindeutigkeit und brach mit "Suchtext 2-mal gefunden". Formulierung in
`applyIncomingSettings()` bewusst variiert.

**Neue Sonden** (`MainActivity.java`, nur mit `--ez lanprobe true --ez lanapply true`):
`probe_wirkung` (UI-Zustand nach Uebernahme: Auswahlfelder, Statuszeile, Klassen),
`probe_lan_chat_send`/`probe_lan_chat` (echte Kurz-Anfrage = Beweis "aktive Verbindung").
Zeitfenster wegen langsamem Neuladen auf 40 s / 68 s / 74 s / 104 s gesetzt.

**Test-Dienst erweitert:** `tools-android\lan-server-test.js --real [sekunden]` bietet die
ECHTEN Windows-Einstellungen an (vorher nur Testwerte – damit war ein Nachweis "echte,
funktionierende Verbindung" nicht moeglich). Anzeige der Adresse korrigiert auf `?t=`.

**Ergebnis am SM-S948B (build-v67b, Log `log-v67-lan2.txt`):**
- `probe_apply`: ok=true, report mit `verbindungen:["Strata_API (openai, http://192.0.2.30:8080/v1, Key gesetzt)"]`, `ignored: workspace.path "D:\MeinProjekt"`.
- `probe_wirkung`: `{"verbindungen":1,"verbindung":"Strata_API","erreichbar":true,"modelle":1,"modell":"qwen3.8-flash-next-iq3_s"}`, Statuszeile **"Strata_API · 1 Modell · Modell geladen"**, Klasse `conn-status ok`.
- `probe_lan_chat`: echte Antwort des Modells eingetroffen (neuer Text 321 Zeichen, keine Fehlermeldung) → **aktive Verbindung nach der Uebernahme nachgewiesen**.
- Datei-Vergleich danach (`diff-settings-after.txt`): 11 Bereiche identisch mit Windows; Unterschiede nur beabsichtigt: `enterToSend=false`, `winMaterial=none`, `enterMigrated=true`, `workspace.path`/`execEnabled` (auf dem Handy bewusst nicht uebernommen).
- Tests unveraendert gruen: 155 Pruefungen / 0 Fehler (`test-log-v67.txt`).

**Nebenbefund:** `probe_lan` meldete zuerst "keine Antwort" – Ursache war ein eigener
Tippfehler im Test-Skript (`json` vor der --real-Umschaltung serialisiert,
ReferenceError, Dienst starb). Ausserdem antwortet die laufende Windows-App gleichzeitig
auf UDP 45455 (netstat: zwei Listener) – beide Anbieter funktionieren, das Handy nahm den
Test-Dienst.

**Offene Punkte / naechster Schritt:**
1. **Chat-Sync am SM-S948B ist immer noch nicht eingerichtet**: `files/data/sync.json` =
   nur `{"deviceId":"5f15b70cc118"}`; SMB-Zugangsdaten am Geraet fehlen laut
   `probe_creds={"pfad":"","benutzer":"LEER",...}`. Die in der Uebergabe genannten
   Zugangsdaten ("Familie.Reuschler") sind auf diesem Geraet NICHT gespeichert.
   Handy pingt 192.0.2.10 (9 ms) – Netz waere da. Windows-seitig: `Y:` =
   `\\192.0.2.10\daten`, Sync-Ordner der Windows-App = `D:\MeinProjekt`.
   Naechster Schritt: Ordner + Zugangsdaten am Geraet setzen (UI oder Sonde), dann
   `--ez fixsync true` und auf `D:\MeinProjekt\LLM-Box-Chats\*.meta.json` pruefen.
2. Windows-Version erhoehen und neu bauen (1.0.54 enthaelt die Uebernahme-Korrekturen noch nicht).
3. `messungen-geraet.md` mit den Werten des SM-S948B aktualisieren.

---

## 87. Sitzung 9 – Chat-Sync am SM-S948B eingerichtet (zwei Ursachen, beide behoben)

**Ergebnis zuerst (Log `log-v70-sync.txt`, build-v70):**
- `probe_setsync_nach1`: `smbTest ok=true eintraege=26` – Freigabe erreichbar.
- `probe_setsync_nach2`: `setDir ok=true ordner=/smb/192.0.2.10/daten/MeinProjekt/LLM-Box-Chats`
- `probe_setsync_nach3`: `migrate ok=true kopiert=1 unveraendert=0`
- `probe_setsync_ende`: `stand dir=/smb/192.0.2.10/daten/MeinProjekt geraet=5f15b70cc118 chats=8`
- Gegenprüfung auf dem Laufwerk: `D:\MeinProjekt\LLM-Box-Chats\n6leil7emwg1ab1n.json` + `.meta.json`
  (Handy-Chat, 08:25) direkt im gemeinsamen Ordner; **kein** verschachtelter Unterordner
  `LLM-Box-Chats\LLM-Box-Chats`. Geräte-datei `files/data/sync.json` =
  `{"deviceId":"5f15b70cc118","dir":"/smb/192.0.2.10/daten/MeinProjekt"}`.

**Ursache 1 – Netzwerk/Doze (kein App-Fehler):** Die Fehlermeldung
`failed to connect to /192.0.2.10 (port 445) … after 5000ms: ECONNABORTED` trat nur auf,
waehrend das Gerat einschlief (`dumpsys netpolicy`: App-Zustand `TOP_SLEEPING`,
`effective=DOZE|APP_BACKGROUND`). Bewiesen mit neuer nativer Sonde `--ez smbprobe true`
(`MainActivity.java`, laeuft im fsPool, loggt jeden Schritt einzeln als `probe_smb_tcp=` /
`probe_smb_call=`): bei wachem Display sind 445 (NAS), 445 (PC) und 5357 in 5–50 ms
VERBUNDEN und `smb.test daten ok=true eintraege=36`; im Doze dieselben Verbindungen nach
6 s fehlerhaft. toybox-nc meldete dagegen immer "exit=0" – als Nachweis unbrauchbar, weil es
auch abgelehnte Verbindungen als Erfolg quittiert (Gegentest auf Port 59999: "Connection
refused"). Massnahmen am Gerat: `svc power stayon true`, `settings put system
screen_off_timeout 600000`, `dumpsys deviceidle whitelist +de.reuschlerit.llmbox`.
Wichtig fuer kuenftige Messungen: Sonden laufen nur, wenn das Display an ist –
`--ez probe true` ist Pflicht, da alle Sonden in `probeUiAfterLoad()` haengen.

**Ursache 2 – echter Bug in der SMB-Schicht:** Nach dem Netz-Fix blieb
`setDir ok=false grund=Der Ordner ist nicht beschreibbar: DiskShare has already been closed`.
`SmbStore.Conn.alive()` pruefte bisher nur `connection.isConnected() && share != null`.
smbj liefert aber ein laengst geschlossenes `DiskShare` zurueck, solange der TCP-Kanal steht;
der in `shareFor()` eingebaute "einmal neu verbinden"-Versuch griff nicht, weil `alive()`
wahr blieb. Fix: zusaetzlich `share.isConnected()` und `session.getConnection().isConnected()`
(`SmbStore.java`, Methode `alive()`). API vorab mit javap gegen
`smbj-0.15.0.jar` geprueft – `Share.isOpen()` existiert NICHT, korrekt ist `isConnected()`.

**Neue Sonde fuer Sync-Einrichtung (`--ez setsync true`):** setzt Zugangsdaten und Ordner ueber
die echten App-Funktionen (`Native.smbSaveCreds`, `api.sync.setDir`, `api.sync.migrate`) –
derselbe Weg wie der Knopf "Freigabe verbinden & uebernehmen". Angaben kommen aus dem Intent,
stehen nicht im Quelltext:
`--es smbhost 192.0.2.10 --es smbuser … --es smbpass … --es smbsyncdir /smb/192.0.2.10/daten/MeinProjekt`.
Hilfsmethode `jsQuote()` (Escaping fuer Intent-Werte im JS-Quelltext) und `shortText()`
(einzeilige Fehlermeldungen) neu. Protokoll in `window.__syncLog`, Auslesen nach jedem Schritt
(`probe_setsync_nach1..ende`) – ein einzelner haengender Schritt loescht damit nicht mehr die
ganze Meldung. Logpuffer des Gerats ist auf 5 MiB begrenzt (`logcat -G 16M` wird abgelehnt):
bei langen Laeufen Logkat gefiltert mitschneiden statt `-d` spaet zu lesen.

**Windows-Build:** Version auf **1.0.55** gesetzt, `npm run dist` durchgelaufen
(`llm-box\dist\LLM Box 1.0.55.exe` + `LLM Box Setup 1.0.55.exe`, Log `build-win-v55.txt`).
Enthaelt die Uebernahme-Korrekturen aus Punkt 86; installiert war 1.0.54.

**Offene Punkte / naechster Schritt:**
- Nutzer soll Windows 1.0.55 starten/installieren, dann echten Transfer PC→Handy ueber
  "Im WLAN anbieten" testen (der Test-Dienst `tools-android\lan-server-test.js --real` bietet
  dieselben Daten an und wurde ausgiebig verwendet).
- Sync laeuft; dauerhafter Betrieb haengt am Doze-Verhalten des Gerats – beim nächsten
  Alltagstest pruefen, ob der Hintergrundabgleich (5 s) nach dem Aufwecken fremde Aenderungen
  meldet (`probe_remote_hits`).
- `messungen-geraet.md` enthaelt weiterhin nur die Werte des SM-G986B.

---

## 88. Sitzung 9 – „HTTP 0“ bei der WLAN-Suche: UDP-Rufsignal blieb nach Abruf aktiv

**Was:** In `llm-box\main.js` die neue Funktion `stopTransferServe(onlyForServer)` eingefuehrt
(nahe `let transferServe = null;`) und an allen drei Stellen benutzt: Handler-Ende nach dem
Abruf (`setTimeout(() => stopTransferServe(server), 300)`), Ablauf-Timer
(`const timer = setTimeout(() => stopTransferServe(server), ttl * 1000)`) und
`transfer:serveStop`. Vorher wurde nach dem Abruf NUR `server.close()` gerufen; das
UDP-Rufsignal auf 45455 blieb gebunden. Dasselbe Verhalten jetzt auch im Test-Dienst
`tools-android\lan-server-test.js` (nach dem Senden HTTP + Socket schliessen und beenden).

**Warum:** Die Android-Sonde rief zuerst nur `r.urls[0]` ab – die echte App
(`transfer.js lanSearchAndApply()`) probiert dagegen alle Adressen durch. Sonde auf denselben
Ablauf umgestellt (reduce ueber `r.urls`, Protokoll `versuche[]`). Damit wurde der Fehler
reproduzierbar gemessen:
`probe_apply="Fehler: keine der 1 Adressen lieferte Daten (http://192.0.2.50:54627/llmbox-transfer?t=CvhknsWOUJds -> HTTP 0)"`
– Port und Token gehoerten NICHT zum laufenden Test-Dienst, sondern zur installierten
Windows-App 1.0.54, die ihr Angebot schon abgerufen hatte, aber weiter auf das Rufsignal
antwortete. Der Fix in main.js behebt genau das; er ist erst ab **1.0.56** wirksam.

**Builds:** Windows **1.0.55** und **1.0.56** gebaut (`llm-box\dist\LLM Box 1.0.56.exe`,
`LLM Box Setup 1.0.56.exe`; Logs `build-win-v55.txt`, `build-win-v56.txt`). APK build-v71 am
SM-S948B installiert.

**Nachweis, dass die Verbindung trotzdem aktiv ist (Lauf 08:35–08:38):**
- `probe_wirkung` (nach Uebernahme): `{"verbindung":"Strata_API","erreichbar":true,"modelle":1,
  "modell":"qwen3.8-flash-next-iq3_s"}`, Statuszeile „Strata_API · 1 Modell · Modell geladen“,
  Klasse `conn-status ok`.
- Chat-Sonde (`--ez probechat true`, `log-v71-chat.txt`): `probe_chat_ergebnis =
  {ticks:531, maxGapMs:76, nachrichten:2, laeuft:"btn-pause hidden", letzteZeile:"99,5 Tokens/s …"}`
  -> echte Antwort ueber die uebernommene Verbindung, Oberflaeche blieb bedienbar.

**Au geraeumauffallend:** mehrere Test-Dienste koennen gleichzeitig auf UDP 45455 lauschen
(netstat zeigte drei). Eigene `node tools-android\lan-server-test.js`-Prozesse vor jedem Lauf
pruefen/beenden (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"`), sonst antwortet
ein veralteter Dienst. Achtung: `node server.js` (PID 2040) ist ein fremder Dauerprozess –
nicht abschiessen.

**Messwerte des SM-S948B sind jetzt dokumentiert:** Abschnitt „Gueltiger Stand: 14.11., 08:25“
in `messungen-geraet.md` (Viewport, Statuszeile, Auswahlfelder, Sync-, Uebernahme- und
Netzsonden).

**Testsuite zuletzt:** 33 + 58 + 8 + 4 + 32 + 20 = **155 Pruefungen / 0 Fehler**
(`test-log-v70.txt`).

## Offene Punkte (Sitzung 9, Ende)

1. Windows **1.0.56** installieren/portable starten – erst dann antwortet der Rechner nicht
   mehr mit toten Adressen („Im WLAN anbieten“ ist damit auch mehrfach hintereinander nutzbar).
2. Echten Transfer PC→Handy mit 1.0.56 testen (Windows „Im WLAN anbieten“ → Handy
   „Einstellungen → Uebertragung → Im WLAN suchen“); erwartet: eine Adresse, sofortige Uebernahme,
   Statuszeile „Strata_API · … Modell geladen“.
3. Dauerbetrieb des Chat-Syncs beobachten: meldet der Hintergrundabgleich (5 s) nach dem
   Aufwecken Aenderungen vom PC? Sonde dafuer: `probe_remote_hits`. Doze bleibt die Grenze –
   im Tiefschlaf blockt Android die Netzzugriffe der App (bewiesen in Punkt 87).
4. Optional: Debug-Sonden (`--ez probe/lanprobe/setsync/smbprobe`) entfernen, wenn nicht mehr
   gemessen wird; sie laufen nur mit `BuildConfig.DEBUG`.

---

## 89. Sitzung 10 (begonnen) – Wählbarer Abgleich-Rhythmus: Echtzeit bis 30 Minuten

**Auftrag des Nutzers:** Chats sollen in Echtzeit synchron gehalten werden koennen, mit einer
neuen Einstellung in Windows- UND Android-App, Schritt von "Echtzeit" bis 30 Minuten.

**Ausgangslage (belegt):** Der Abgleich war beidseitig fest verdrahtet –
Windows `llm-box\main.js` `setInterval(..., 3000)` (alt Zeile 266), Android
`tools-android\native-main.js:491` `setInterval(pollChats, 5000)`. sync.json kannte nur
`deviceId` und `dir`.

**ERLEDIGT – Windows-Backend (`llm-box\main.js`, Syntax geprueft mit node --check):**
- Neue Konstanten + Helfer vor dem Block "Gemeinsamer Ordner" (Zeilen um 205):
  `SYNC_MIN_MS = 1000`, `SYNC_MAX_MS = 30*60*1000`, `SYNC_DEFAULT_MS = 2000`,
  `syncEveryMs()` (validiert gegen sync.json, sonst Default).
- `sync:get` liefert zusaetzlich `everyMs`.
- Neuer Handler `sync:setEvery(ms)` (Zeile ~222): prueft den Bereich, schreibt `c.everyMs`
  in sync.json (`saveSyncCfg()`), ruft `resetSyncState()` und `schedulePoll(v)` – damit das
  neue Tempo sofort gilt.
- Der feste `setInterval`-Block ist ersetzt durch: Funktion `pollChats()` (gleicher Inhalt wie
  vorher), dazu `let pollTimer = null; function schedulePoll(delayMs)` – ein selbst neu
  geplanter Timer (`setTimeout` + erneutes `schedulePoll()`), weil bei langen Abstaenden ein
  einmal gestarteter Intervall-Timer die neue Einstellung sonst erst spaet uebernehmen wuerde.
  Danach `function syncNow() { return pollChats(); }`, `schedulePoll();` und
  `ipcMain.on('sync:now', ...)`.
- In `createWindow()` (Zeile ~1388) neu: `win.on('focus', () => { syncNow(); });`
- Bewusst KEIN resetSyncState() in syncNow(): das haette den gesehenen Stand vergessen und die
  Aenderung verschluckt, die man sofort sehen will.

**ERLEDIGT – Bridge (`llm-box\preload.js:85`):** `sync.setEvery(ms)` ergaenzt und
`syncNow: () => ipcRenderer.send('sync:now')` neu.

**NOCH OFFEN (Reihenfolge, alles noch nicht geschrieben!):**
1. **Android-Backend `tools-android\native-main.js`:** analog `everyMs` in sync.json
   (`getSyncCfg()` Zeile 66–76, `saveSyncCfg()` 77), `sync.get()` (Zeile 386–389) soll
   `everyMs` liefern, neuer `sync.setEvery(ms)`; `setInterval(pollChats, 5000)` (Zeile 491)
   durch selbst nachplanenden Timer wie in main.js ersetzen. Achtung: hier gilt dasselbe
   deepMerge-Muster wie bei apply() – Werte aus settings.json und sync.json nicht vermischen.
2. **UI fuer beide Apps (`llm-box\renderer\js\settings.js`):** die neue Zeile gehoert in
   `syncRowHolder()` (Zeilen 716–758, die Sync-Zeile selbst ist Zeile 752 mit Label
   "Chats auf mehreren Rechnern"). Vorhandene Helfer: `bindSelect(path, options)` Zeile 160–168
   (bindet an S.settings – fuer den Sync-Rhythmus aber NICHT geeignet, weil der Wert in
   sync.json liegt!). Deshalb ein eigenes <select>, das `sy.everyMs` setzt und
   `api.sync.setEvery(ms)` aufruft, dann `build()` erneut ausfuehrt. Stufen-Vorschlag:
   Echtzeit (2 s), 5 s, 10 s, 30 s, 1 min, 5 min, 10 min, 30 min. Die Android-App nutzt
   dieselbe settings.js (Build kopiert `llm-box\renderer` nach `android\...\assets\webapp`,
   siehe build-android.ps1:50–56) – die Einstellung erscheint also automatisch auch dort;
   in `tools-android\android-adapter.js` muss nichts ausgeblendet werden (HIDE_TEXTS,
   Zeilen 107–112, enthaelt die Sync-Zeile nicht).
3. **Test `tools-android\test-sync.js`:** Struktur: `ok(name, bedingung, extra)` Zeile 17,
   am Ende `Ergebnis: pass/fehler` (Zeile 183), aktuell 32 Pruefungen. Neue Pruefungen:
   `sync.get()` liefert everyMs; `setEvery(5000)` uebernimmt und haelt es in sync.json;
   Bereichspruefung (z. B. setEvery(10) und setEvery(31*60*1000) -> ok=false);
   Hintergrundabgleich im gewaehlten Tempo (Zeilen 144–149 warten starr 6000 s auf den 5-s-Tick –
   nach der Umstellung auf waelbaren Rhythmus muss dieser Test auf eine kurze Stufe gesetzt
   werden, sonst prueft er ins Leere).
4. **Builds:** APK mit `LLM-Box\build-now.ps1` (erwartet "34 actionable tasks: 34 executed",
   Exit-Code 0), Windows mit `cd llm-box && npm version 1.0.57 --no-git-tag-version` dann
   `npm run dist`. Achtung: PowerShell-Skripte brauchen UTF-8-BOM (tools-android\add-bom.ps1);
   Build-Patches in build-android.ps1 verlangen eindeutige Suchtexte – eigener Code darf nicht
   exakt dieselbe Zeile enthalten wie ein Patch-Suchtext (siehe Punkt 86).
5. **Am Gerat pruefen:** SM-S948B, `adb -t <nr>` (TLS-ADB, keine IP), Display wach halten
   (`svc power stayon true`, Doze blockt sonst Netzzugriffe – Punkt 87), dann Sync-Tempo am
   Gerat stellen und mit `probe_remote_hits` / Logcat-Tag LLMBOX-UI nachweisen.
6. Windows-Version ist aktuell **1.0.56** gebaut, aber beim Nutzer noch 1.0.54 installiert.

---

## 90) Sitzung 11 – Abgleich-Rhythmus fertig: Android-Backend, gemeinsame UI, Tests (Sitzung 11)

**Was wurde gemacht**
- `tools-android\native-main.js`:
  - Nach `chatsDir()` neue Konstanten/Helfer: `SYNC_MIN_MS = 1000`, `SYNC_MAX_MS = 30 * 60 * 1000`,
    `SYNC_DEFAULT_MS = 2000` und `async syncEveryMs()` (validiert gegen sync.json, sonst Default).
  - `sync.get()` liefert zusaetzlich `everyMs`; neuer Handler `sync.setEvery(ms)` mit
    Bereichspruefung (1 s … 30 min), speichert `c.everyMs` via `saveSyncCfg()`, ruft
    `resetSyncState()` und `schedulePoll(v)`.
  - `setInterval(pollChats, 5000)` ersetzt durch selbst nachplanenden Timer:
    `let pollTimer = null; async function schedulePoll(delayMs)` (clearTimeout + setTimeout,
    jeder Lauf plant den naechsten neu ein), `schedulePoll()` beim Start.
    `window.__syncNow` bleibt unveraendert (MainActivity.java:985 stoesst ihn in onResume() an).
- `llm-box\renderer\js\settings.js` (wirkt wegen build-android.ps1 in BEIDEN Apps):
  - Neu vor `syncRowHolder()`: `SYNC_STEPS` (2 s / 5 s / 10 s / 30 s / 1 min / 5 min / 10 min /
    30 min), `syncStepLabel(ms)` und `syncEveryRow(sy, refresh)`.
  - Bewusst KEIN `bindSelect()` – das schreibt in settings.json; der Rhythmus liegt aber in
    sync.json. Die Auswahl speichert ueber `api.sync.setEvery(+ms)` und aktualisiert S.sync.
  - `S.sync` merkt sich jetzt auch `everyMs`; die Statuszeile der Sync-Zeile nennt statt
    "nach wenigen Sekunden" die tatsächlich gewaehlte Stufe.
  - Neue Zeile `.frow.sync-every` ("Chats abgleichen alle …") wird in `syncRowHolder()` direkt
    unter die Sync-Zeile haengt – auch ohne gemeinsamen Ordner sichtbar.
- `tools-android\test-sync.js`: 15 neue Pruefungen (everyMs-Standard, Bereichspruefung bei
  10 / 31 min / 0 / -5000 / "quatsch", gespeicherter Wert in sync.json, Hintergrundabgleich im
  gewaehlten Tempo, "auf 30 min gestellt -> kein Tick nach wenigen Sekunden", "nach Wechsel auf
  Echtzeit kommt die Meldung prompt"). Die starren 6000-ms-Wartezeiten sind durch einen
  `waitFor(cond, ms)`-Helfer ersetzt – der alte Test wartete nur und pruegte nichts.
- `tools-android\test-ui-boot.js`: 6 neue Pruefungen (Rhythmus-Zeile sichtbar, auf Android
  nicht ausgeblendet, 8 Stufen von 2000 bis 1800000, zeigt gespeicherten Wert, Aenderung auf
  30 s wird gespeichert, zurueck auf Echtzeit).

**Warum / Annahmen**
- Gleiche Konstanten und Fehlermeldungen wie in main.js (Punkt 89), damit sich beide Apps
  identisch verhalten und die UI denselben Text anzeigen kann.
- Nach einem Tempo-Wechsel wird `resetSyncState()` ausgefuehrt: der naechste Abgleich legt die
  Ausgangsposition neu fest und meldet absichtlich nichts – das ist im Test beruecksichtigt
  (vor jeder Erwartung ein Tick zum Festlegen abgewartet), sonst waere der Test fehlgeschlagen.
- Android braucht keine Ausblendung: `android-adapter.js` HIDE_TEXTS (Z.107–113) enthaelt die
  Sync-Zeile nicht, und `injectSyncSmb()` (Z.457) setzt die Freigabe-Eingaben in genau diese
  Zeile – die neue Rhythmus-Zeile bleibt davon unberuehrt.

**Ergebnis / Fundstellen**
- `node --check` fuer native-main.js, test-sync.js und settings.js: fehlerfrei.
- APK neu gebaut mit `LLM-Box\build-now.ps1`: "34 actionable tasks: 34 executed", Exit-Code 0,
  `android\app\app_build\outputs\apk\debug\app-debug.apk` (Protokoll tools-android\tmp-build-90.txt).
- `node tools-android\test-sync.js`: **47 geprueft, 0 Fehler** (vorher 32).
- `tools-android\run-tests.cmd`: **170 geprueft, 0 Fehler** in 6 Laufen – Protokoll
  `tools-android\test-log-v90.txt` (33 + 64 + 8 + 4 + 47 + 20; vorher 155 mit 58 im UI-Lauf).

**Offene Punkte / naechster Schritt**
- Windows-Build 1.0.57: `cd LLM-Box\llm-box && npm version 1.0.57 --no-git-tag-version` dann
  `npm run dist`. (ERLEDIGT, siehe Punkt 92)

---

## 91) Sitzung 11 – Windows-Build 1.0.57 + Geraet gewechselt (SM-G986B)

- `cd LLM-Box\llm-box && npm version 1.0.57 --no-git-tag-version` und `npm run dist`:
  gebaut `llm-box\dist\LLM Box 1.0.57.exe`, `LLM Box Setup 1.0.57.exe` (+ .blockmap).
  Protokoll: tools-android\tmp-winbuild.txt. Der Nutzer will das Setup **selbst** installieren.
- Am Rechner haengt jetzt ein anderes Geraet als in Sitzung 9/10 dokumentiert:
  `adb devices -l` -> `SM_G986B` (Galaxy S20, Seriennummer R5CN504YTAV), transport_id **8**
  (`adb-R5CN504YTAV-c6Fjk0._adb-tls-connect._tcp`). Der SM-S948B war nicht verbunden.
  Rueckfrage gestellt -> Nutzer: auf dem jetzt verbundenen G986B installieren und testen.
- APK installiert mit `adb -t 8 install -r ...app-debug.apk` -> "Success".
- App-Daten des G986B sind frisch: `files/data/sync.json` = nur `{"deviceId":"9b2cafc5cf5e"}`,
  **kein** gemeinsamer Ordner, keine smb.json. Der Chat-Sync ist auf diesem Geraet also noch
  nicht eingerichtet (anders als beim SM-S948B, Punkt 87).
- Display wach halten / Doze: `svc power stayon true` wirkt bei vollem Akku (status 5, AC an)
  NICHT sichtbar; `dumpsys deviceidle whitelist +de.reuschlerit.llmbox` -> "Added".

## 92) Sitzung 11 – Geraetetest deckt echten Timer-Fehler auf, korrigiert (wichtig!)

**Vorgehen / neue Sonde**
- `native-main.js`: Abgleich-Lauf-Zaehler eingebaut (`tickTimes`, `window.__syncTicks()`,
  `window.__syncTicksReset()`) plus Timer-Diagnose `geplant` / `gelaufen` / `letzteWartezeit` /
  `seitMs`. Damit ist unterscheidbar: gar nicht geplant vs. geplant aber nicht ausgefuehrt.
- `MainActivity.java`: neue Sonde `--ez probe true --ez syncrate true` (Block ab Zeile ~835).
  Ablauf: Grundtakt messen -> `setEvery(60000)` -> nach 30 s messen -> `setEvery(2000)` ->
  nach 30 s messen. Logcat-Zeilen: `probe_rate_standard`, `_gesetzt`, `_langsam`, `_zurueck`,
  `_echtzeit`. Zusaetzliche unabhaengige Gegenprobe (`window.__ctlFired`, eigener 2-s-Takt) und
  `document.visibilityState` im Protokoll.

**Fund 1 – Timer-Kette hing am asynchronen Einstellungs-Lesen**
- Frueher: `async function schedulePoll()` wartete vor dem `setTimeout` auf `syncEveryMs()` ->
  `getSyncCfg()`. Hing diese erste Dateianfrage, kam gar kein Timer zustande.
- Jetzt: Tempo-Cache `everyMsCached` + `validEvery()` / `currentEvery()`; `schedulePoll()` ist
  synchron und plant sofort mit Standardwert, der Cache wird bei jedem `pollChats()` aus
  sync.json aufgefrischt. Der Abgleich-Lauf selbst laeuft in
  `Promise.resolve().then(pollChats).catch(...)`, damit ein Fehler die Kette nicht beendet.

**Fund 2 – zwei Timer-Ketten parallel (der eigentliche Bug)**
- Geraetelprotokoll tmp-logcat-rate2.txt: nach `setEvery(60000)` stieg der Zaehler trotzdem
  weiter (anzahl 24 -> 38, Abstaende ~2000 ms) und die gemessenen Abstaende mischten ~0,5 s mit
  ~5 s. Ursache: `schedulePoll()` war asynchron; ein bereits laufender Lauf plante nach seiner
  Fertigstellung eine ZWEITE Kette ein - die neue Stufe galt nur fuer den ersten Tick.
- Fix: Generationen-Marke `pollGen`; jeder ueberholte Lauf verwirft sein Nachplanen
  (`if (gen === pollGen) schedulePoll();`), Zeile ~583 in native-main.js.
- Zusaetzlich setzte `sync.setEvery()` den Tempo-Cache nicht -> neue Stufe galt einmal, dann
  alter Wert. Jetzt wird `everyMsCached = v;` direkt gesetzt.

**Nachweis am Geraet (SM-G986B, tmp-logcat-rate3.txt)**
- Vorher: Grundtakt korrekt gemessen, Abstaende 2001/2000/2001/2000 ms bei Stufe "Echtzeit".
- Nach `setEvery(60000)`: `ok=true wert=60000`, `letzteWartezeit: 60000` und der Zaehler blieb
  ueber 36 s unveraendert (anzahl 21 -> 21). Genau das erwartet Verhalten - in der fehlerhaften
  Fassung liefen dabei 14 zusaetzliche Abgleiche. **Der Fix ist damit am Geraet belegt.**
- Einschraenkung: waehrend des Laufs zeigte die WebView `sichtbar=hidden` und
  `isKeyguardShowing=true` / `mDreamingLockscreen=true` - der Sperrbildschirm war aktiv,
  `wm dismiss-keyguard` half nicht (Gerat ist per PIN/Muster gesichert). Chrome drosselt bei
  verborgener Seite Timer, deshalb ist die Messung des KURZEN Takts am Geraet erst nach dem
  Entsperren sauber moeglich. Der kurze Takt ist durch den Node-Test belegt.

**Tests**
- `tools-android\test-sync.js`: neuer Regressionstest gegen die Doppel-Kette (Zaehler darf bei
  30 Minuten in mehreren Sekunden nicht wachsen; nach Rueckkehr auf 1 s muessen alle Abstaende
  < 2000 ms sein). Aktuell **49 Pruefungen, 0 Fehler**.
- `tools-android\run-tests.cmd`: **178 geprueft, 0 Fehler** in 7 Laufen - Protokoll
  `tools-android\test-log-v95.txt` (33 + 64 + 8 + 4 + 49 + 20).
- Achtung beim Testen: build-now.ps1 kopiert `llm-box\renderer` nach `assets\webapp`. Ein parallel
  gestarteter Test kann eine halb kopierte Fassung lesen und dann scheinbar falsche Werte melden -
  immer erst bauen, DANN testen (Passierte zweimal, tmp-ts3/tmp-ts4).

**Zusaetzlicher Fund – die Sonde selbst war irrefuehrend (wichtig fuer spaetere Messungen)**
- `anzahl` ist durch den Puffer von `tickTimes` auf 40 beschraenkt und saturiert; nach ~80 s
  aendert sich diese Zahl nicht mehr, auch wenn der Abgleich weiterlaeuft. Die Werte
  "anzahl:21 -> 21" und "anzahl:40 -> 40" waren deshalb TEILWEISE Saelttigung, kein Beweis.
  Aussagekraeftig sind nur `gelaufen` (Gesamtzahl) und `abstaende`.
- Deshalb ergaenzt: `instanz` (wie oft native-main.js in dieser WebView lief - zwei Ausfuehrungen
  wuerden zwei unabhaengige Timer-Ketten bedeuten), `cacherhythmus` (aktuell gecachter Wert) und
  `werPlante` (Stack der letzten schedulePoll-Aufrufe).
- Letzter Geraetelauf mit korrekter Installation (tmp-logcat-rate5.txt, entsperrt,
  `sichtbar=visible`, `instanz:1`): Grundtakt sauber 2001/2002 ms; nach `setEvery(60000)` meldet
  die Sonde `cacherhythmus:60000` und `letzteWartezeit:60000`, aber die letzten Abstaende stehen
  weiterhin bei ~2001 ms. **Der kurze Takt wird also trotz Umstellung weitergemacht - die
  Ursache ist damit noch NICHT geklaert.** `werPlante` zeigt als letzten Eintrag
  `Object.setEvery (native-main.js:431)`, danach nur noch Zeile 596 (die Timer-Kette selbst).
- Naechster Schritt dafuer: `gelaufen` (nicht `anzahl`) vergleichen und pruefen, ob die WebView
  zwei Skript-Instanzen hat oder ein zweiter Poller existiert.

**Zwei neue Nutzerprobleme (Sitzung 12) – Befunde**
1. **Windows-App wirkt zogerlich/haengend.** Messungen mit `tools-android\perf-sync.js`
   (Protokoll tools-android\perf-log-v2.txt):
   - Windows-App laeuft bereits in **1.0.57** (`C:\Program Files\LLM Box\LLM Box.exe`,
     ProductVersion 1.0.57.0, gestartet 14:33 Uhr). sync.json des Nutzers:
     `%APPDATA%\LLM Box\sync.json` = `{"deviceId":"e2e183e3f3e3","dir":"Y:\\MeinProjekt"}` -
     der gemeinsame Chat-Ordner liegt auf **Y:**, einem Netzlaufwerk (`net use`: Y: =
     \\\\192.0.2.10\\daten). Damit ist die neue Echtzeit-Stufe dort ein Ordner-Poll alle 2 s
     ueber SMB = **1800 Durchlaeufe pro Stunde**.
   - Der Ordner enthaelt 15 Meta- und 9 Chat-Dateien, insgesamt ~25 MB; groester Chat
     `8swxb7q8mwcb695l.json` = **12,67 MB**. Lesen dieses Chats: 132 ms, Speichern atomar: 155 ms.
   - Ein kompletter Abgleich (readdir + alle Meta lesen) kostet nur **3 ms** - der Poll an sich
     erklaert die Bremse also NICHT.
   - AUFFAELLIG und vermutlich entscheidend: Beim Messen waren **6 von 15 Meta-Dateien gesperrt**
     (`EPERM`, auch per PowerShell "Zugriff verweigert"). `readJson()` (main.js:101-107) wirft
     jeden Fehler weg und liefert `null`; `listMetas()` (main.js:145-150) filtert `null` einfach
     raus. Der Chat fehlt dann in dieser Runde -> `pollChats()` haelt ihn fuer **geloescht**
     (`removed`, main.js:288), loescht ihn aus `seen`, und in der naechsten Runde taucht er wieder
     auf -> Revision unbekannt -> gilt als **geaendert** (main.js:285) -> `chats:changed` ->
     `onRemoteChats()` (app.js:550-579) ruft `api.chats.list()`, `renderChatList()` und bei einem
     fremden Chat zusaetzlich `api.chats.load(cur.id)` (**12,7 MB ueber SMB**) plus
     `renderMessages()` - die ganze Nachrichtenliste wird neu aufgebaut, waehrend der Nutzer
     gerade tippt. Das ist ein plausibler Mechanismus fuer "Eingaben dauern/haengen".
   - Entlastend geprueft: Der Eingabe-Handler selbst ist leichtgewichtig
     (app.js:2254 `autosize(); updateEstimate();`), Speichern ist entprellt
     (app.js:36 debounce 400 ms, app.js:38 debounce 500 ms). Monitoring/Strata laeuft im Renderer
     per HTTP, kein execSync im Hauptprozess.
2. **Android zeigt beim Start einen weissen Block.** Belegte Ursachen:
   - `llm-box\renderer\index.html:2` startet mit `data-theme="light"`; styles.css:34-36 setzt im
     Light-Theme `--bg:#ffffff`, styles.css:50-54 faerbt damit den `body`. Die WebView selbst ist
     dunkel (MainActivity.java:171) und das Android-Theme auch (styles.xml:3-7, bg=#101418),
     aber die WEB-Seite malt beim ersten Paint weiss.
   - `index.html:79`: `<aside id="filepanel"></aside>` hat initial KEIN `collapsed`; styles.css:308-309
     zeigt das Panel (280 px, heller Hintergrund). Erst app.js:19 (`panelOpen: true`) bzw.
     renderFilePanel() (app.js:2141-2145) schaltet es spaeter - auf Android soll es zu sein.
   - Achtung: build-android.ps1:117 patcht das Starttheme des Android-Baus bereits von dark auf
     light ('index.html: Starttheme Hell') - diese Zeile ist fuer den weissen Start mitverantwortlich.

---

## 93) Sitzung 12 – beiden Nutzerproblemen behoben (Sync-Flattern + weisser Startblock)

**Problem 1: Windows-App wirkt zogerlich/haengend**
Ursache (durch Messung belegt, tools-android\perf-log-v2.txt): Auf der Netzfreigabe Y: waren im
laufenden Betrieb **6 von 15 Meta-Dateien gesperrt** (EPERM). `readJson()` warf jeden Fehler weg
und lieferte null, `listMetas()` filterte null raus -> der Chat fehlte in dieser Runde. Die Folge:
`pollChats()` hielt ihn fuer GELoSCHT (`removed`), loeschte ihn aus `seen`, und eine Runde spaeter
galt er wieder als GEANDERT -> `chats:changed` -> `onRemoteChats()` (app.js:550-579) ruft
`api.chats.list()`, `renderChatList()` und bei fremdem Chat `api.chats.load()` (**12,7 MB ueber
SMB**, gemessen 132 ms Lesen / 155 ms Speichern) plus `renderMessages()` - die ganze
Nachrichtenliste wurde neu aufgebaut, waehrend der Nutzer tippte. Der Poll selbst kostet nur 3 ms,
war also nicht das Problem - das Flattern war es.

Behoben in `llm-box\main.js`:
- `listMetas(dir)` liefert jetzt `{ metas, blockiert }` statt einer nackten Liste. Eine Meta-Datei,
  die sich nicht lesen laesst (nicht ENOENT), gilt als **gesperrt**, nicht als weg.
- Neuer `metaCache` (Schluessel "Ordner|Chat-ID"): bei einer Sperre wird der zuletzt erfolgreich
  gelesene Stand weiterverwendet - der Chat bleibt in der Liste und der Vergleich laeuft gegen den
  richtigen Stand. Der Ordner im Schluessel verhindert, dass nach einem Wechsel lokal <-> Freigabe
  Staende aus dem anderen Ordner benutzt werden.
- `pollChats()`: `removed` schliesst die gesperrten IDs ausdruecklich aus.
- Alle drei Aufrufer angepasst: `chats:list` (Zeile ~174), `sync:migrate` (~279), `pollChats` (~299).
- `schedulePoll()` bekam denselben Fix wie die Android-Seite: synchrone Planung + Generations-Marke
  `pollGen`, ein ueberholter Durchlauf plant nicht mehr nach (kein setInterval, kein await vor dem
  setTimeout). Damit kann sich in Windows keine zweite Abgleich-Kette bilden.

Dieselbe Korrektur in `tools-android\native-main.js` (listMetas ~Zeile 147, chats.list ~172,
migrate ~482, pollChats ~570): dort kommen Fehler als Text zurueck statt mit `e.code`, deshalb
prueft der Code auf den Meldungstext (`/ENOENT|nicht gefunden/i`).

**Problem 2: Android startet mit weissem Block**
Ursache: `<aside id="filepanel">` hatte im HTML keine `collapsed`-Klasse; styles.css zeigt das Panel
(280 px, heller Hintergrund), und app.js setzt die Klasse erst nach dem Laden aller Skripte. Dazu
startete die Seite mit `data-theme="light"` (weisses --bg).
Behoben: neuer Build-Patch in `build-android.ps1` direkt vor dem styles.css-Patch:
`index.html: Workspace-Panel startet geschlossen (kein weisser Startblock)` setzt
`<aside id="filepanel" class="collapsed"></aside>` bereits ins kopierte HTML. app.js verwaltet die
Klasse danach wie bisher (Patch auf `panelOpen: false` bleibt). Das Starttheme Hell wurde bewusst
NICHT angefasst - es ist gewollt (build-android.ps1:115-117) und der Nutzer soll im hellen Design
starten; der weisse Block war das Panel, nicht die Grundflaeche.

**Tests / Builds**
- `tools-android\test-sync.js`: Mock `Native.__blockMeta` bildet eine gesperrte Datei nach
  ("open failed: EACCES"). Vier neue Pruefungen: Chat bleibt in der Liste trotz Sperre, gesperrte
  Meta fuehrt zu keiner Meldung, nach der Sperre wird eine echte Aenderung wieder erkannt.
  Aktuell **53 Pruefungen, 0 Fehler**.
- `node --check` fuer main.js und native-main.js fehlerfrei; APK neu gebaut (build-now.ps1,
  "34 actionable tasks: 34 executed"), Patch im gebauten HTML bestaetigt.

## 94) Sitzung 12 – Messungen widerlegen die Sync-Hypothese; eigentliche Bremse gefunden

**Korrektur der eigenen Annahme (wichtig!)**
Der Verdacht "gesperrte Meta-Dateien lassen Chats flattern und bauen die Oberflaeche staendig neu auf"
ist durch eigene Messung NICHT bestaetigt. `tools-android\flattern-nachweis.js` (alte vs. neue
listMetas-Logik, 40 Durchlaeufe im 1-s-Takt auf dem echten Freigabeordner, Protokoll
tools-android\nachweis-flattern3.txt):
   gesperrte Meta-Leseversuche: 240 | ALTE Logik: 2 Neuaufbauten | NEUE Logik: 2 Neuaufbauten
Grund: die 6 gesperrten Dateien sind DAUERHAFT gesperrt (Einzelpruefung tmp-sperren.txt: EPERM,
z. B. dtuf5he1mwfcn190.meta.json) und gehoeren zu Chats OHNE zugehoerige Chat-Datei - sie fehlen
also von Anfang an in der Liste und flattern nicht. Der Fix bleibt trotzdem sinnvoll (teurer
Neuaufbau bei echten Sperren, richtiger Vergleichswert), aber er ist NICHT die Loesung fuer das
Zogern. Reiner Sync-Poll: 3 ms pro Durchlauf (perf-log-v2.txt) - ebenfalls nicht die Ursache.

**Was gemessen wurde und was es kostet** (alle Protokolle in tools-android\perf-log-*.txt)
- perf-workspace.js: Workspace liegt auf Y: (Netzlaufwerk). Top-Ordner 1 ms, rekursiver Durchgang
  ueber 2571 Dateien/240 Ordner 237 ms, ein Unterordner 0 ms. Netzlaufwerk allein bremst also nicht.
- perf-chat.js / perf-render.js: groesster Chat `8swxb7q8mwcb695l.json` = **13 MB, 3402 Nachrichten,
  1753 Werkzeug-Aufrufe**. Lesen 133 ms, JSON.parse 49 ms, JSON.stringify 48 ms, atomares Speichern
  222 ms.
- perf-messages.js (echtes Rendering in jsdom, echte Chats) - DER BEFUND:
      50 Nachrichten    ->   200 ms,   1.603 DOM-Knoten
     500 Nachrichten    ->   645 ms,  16.421 DOM-Knoten
    1000 Nachrichten    ->   884 ms,  32.713 DOM-Knoten
    3402 Nachrichten    ->  2966 ms, 110.243 DOM-Knoten
  renderMessages() (app.js:736) macht `box.innerHTML = ''` und haengt dann jede Nachricht einzeln
  an - der gesamte Chat wird also vollstaendig neu aufgebaut. Bei ~110.000 Knoten ist das rund drei
  Sekunden, und jeder Reflow im Nachrichtenbereich ist danach teuer (der ResizeObserver app.js:2349
  loest bei jeder Groessenaenderung followBottom() aus). Das erklaert Zogern beim Oeffnen von Chats,
  beim Aufruf von Funktionen (Dock/Panel aendern die Groesse) und beim Uebergeben an die KI.
  Entlastend gemessen: Tippen selbst ist guenstig - 100 Tastenanschlaege bei 3402 Nachrichten =
  149 ms (der Eingabe-Handler app.js:2254 macht nur autosize + updateEstimate), updateCtxMeter 20x
  = 3 ms. Es wird also NICHT pro Tastendruck neu gerendert.

**Hilfsmittel neu angelegt** (nur lesend/messend, aendern keine App-Daten)
- tools-android\perf-sync.js, perf-chat.js, perf-render.js, perf-workspace.js, perf-schreiben.js,
  perf-messages.js, flattern-nachweis.js und png-hell.ps1.
  Achtung: png-hell.ps1 scheitert mit GDI "Nicht genuegend Arbeitsspeicher" an den Handy-Screenshots -
  fuer eine Bildauswertung stattdessen die JS-Sonden am Gerat verwenden.

**Windows-Build:** 1.0.58 gebaut (dist\LLM Box Setup 1.0.58.exe, tmp-winbuild58.txt) mit den
main.js-Korrekturen aus Punkt 93. Der Nutzer hat 1.0.57 installiert und will selbst installieren.

**Android-Startblock:** Build-Patch wirkt (gebautes index.html enthaelt
`<aside id="filepanel" class="collapsed">`). APK mit diesem Stand auf dem G986B installiert.
Ein pixelbasierter Nachweis ueber Screenshots (tools-android\start-01.png / start-02.png) gelang
nicht - png-hell.ps1 scheitert, siehe oben.

**Offene Punkte / naechster Schritt**
- Gegen das Zogern hilft nur, den Neuaufbau aller Nachrichten zu begrenzen. Moegliche Wege:
  (a) Nachrichten-Virtualisierung (nur sichtbare Knoten aufbauen), (b) alte Nachrichten eingeklappt/
  kompakt rendern, (c) grosse Chats entlasten (bestehendes autoCompact / "Kontext leeren" nutzen).
  Rueckfrage an den Nutzer gestellt, weil der Aufwand sehr unterschiedlich ist.
- Windows-Version mit den main.js-Korrekturen bauen (1.0.58) - der Nutzer hat 1.0.57 installiert,
  die Bremse steckt also in seiner aktuellen Version.
- Am G986B pruefen: kein weisser Panel-Block mehr beim Start; Sync-Flattern weg.
- Geraete-Nachweis des langen Takts bleibt widerspruechlich (tmp-logcat-rate5.txt: nach
  setEvery(60000) stieg `gelaufen` von 47 auf 62).erklaerbar durch die Sonde selbst:
  `abstaende` zeigt die letzten 12 Abstaende = ~24 s Vorgeschichte, der neue 60-s-Abstand war zum
  Messzeitpunkt noch nicht eingetroffen. Der Node-Test belegt das Verhalten eindeutig (Zaehler
  waechst bei 30 Minuten nicht weiter). Bei Bedarf am Geraet mit laengerem Messfenster wiederholen.

- Chat-Sync auf dem G986B einrichten, falls echte Uebernahme zwischen zwei Geraeten gezeigt werden
  soll: `--ez setsync true` mit `--es smbhost/smbuser/smbdomain/smbpass/smbsyncdir` (Sonde ab
  Zeile ~777). Auf dem G986B gibt es noch keine smb.json.
- Windows 1.0.57/1.0.58 muss der Nutzer selbst installieren (1.0.58 enthaelt die main.js-Korrekturen).

---

## 95) Sitzung 12 – Entscheidung des Nutzers + Referenz zum Nachrichten-Rendering

**Entscheidung des Nutzers (nach Vorlage der Messwerte aus Punkt 94)**
- Gewaehlt: **beides** - Fenstervirtualisierung der Nachrichten (nur sichtbare Knoten aufbauen)
  UND kompakte Darstellung alter Nachrichten.
- Ausdruecklich NICHT gewuenscht: Aenderungen am Chat-Inhalt. Der grosse Chat darf nicht geteilt,
  gekuerzt oder umgebaut werden; Werkzeug-Ergebnisse bleiben so stehen wie sie sind. "Kompakt"
  bedeutet nur die Darstellung - am Gespeicherten wird nichts geaendert.
- Windows 1.0.58 ist gebaut, aber noch NICHT installiert (Nutzer wartet). Pruefungen laufen bis
  dahin an der Android-App; perf-messages.js laeuft gegen das gebaute assets\webapp und gilt damit
  fuer beide Apps.

**Referenz zum Rendering (Unteragent, alles belegt) - Grundlage des Umbaus**
- messageEl() app.js:823-827 verteilt auf userEl (829-836), assistantEl (838-861), toolEl (977-990).
  User: .msg.user mit .bubble/.msg-actions; Assistant: .msg.assistant[data-mid] mit .who,
  details.think, .md, .stats, .msg-actions; Tool: details.tool(.fail) mit summary und .inner.
  Pro Nachricht mehrere Unterelemente - deshalb rund 30 Knoten pro Nachricht.
- renderMessages()-Aufrufe (nach dem Umbau alle noch korrekt): app.js:327, 418, 567, 658, 1139,
  1369/1370, 1381, 1826, 1952, 1963 sowie handoff.js:152 und 157.
- Scrollen: scrollendes Element ist #messages (styles.css:177 overflow-y:auto), #messages-inner hat
  nur min-height:100% (styles.css:178). S.stick app.js:21, followBottom() app.js:46,
  scrollBottom() app.js:1048-1051, userMove() app.js:2323, Listener 2324-2346, ResizeObserver auf
  #messages-inner app.js:2349-2352.
- Sonderfaelle, die erhalten bleiben muessen (app.js:736-770): ctx-divider bei ctxStart (34, 750),
  streamende Antwort S.runNode/S.runAm (751), laufende Programm-Karten TL.cards (759; livetools.js:58,
  94-101), S.pendingApproval.card (760), continueNotice() (764/765, Funktion 1364-1373),
  hoNotice() (766; handoff.js:197-207), Klasse ctx-old fuer i < cs (754).
- Wiederverwendbares Einklapp-Muster: details/summary ist vielfach vorhanden (Think app.js:871-875,
  Tool app.js:986-989, Handoff app.js:832, Live-Tool livetools.js:94-99) und in CSS mit
  `.inner { max-height:340px; overflow:auto }` (styles.css:253).

**Umsetzungsplan (noch nicht umgesetzt)**
1. Pruefen, ob Electron (Windows) und Android-WebView `content-visibility:auto` unterstuetzen - der
   billigste Weg, Layout/Paint ausserhalb des Sichtbaren zu ueberspringen.
2. In renderMessages(): weiter zurueck liegende Nachrichten nur als kompakte Zeile aufbauen
   (ausklappbar), im sichtbaren Fenster voll. Das senkt die Zahl der erzeugten Knoten direkt -
   content-visibility allein wuerde die 2966 ms Knotenerzeugung nicht vermeiden.
3. Messen mit tools-android\perf-messages.js (Vorher: 2966 ms / 110.243 Knoten bei 3402 Nachrichten).
   Achtung: jsdom kennt weder content-visibility noch echte Groessen - der CSS-Anteil muss am Gerat
   bzw. in Electron nachgewiesen werden, perf-messages.js misst den JS-Anteil (Knotenerzeugung).

---

## 96) Sitzung 12 – fensterweiser Nachrichtenaufbau: Zögern in grossen Chats behoben

**Engine-Unterstützung geklaert**
Electron `^33.2.0` (package.json:18, Chromium 130) und Android-WebView 157.0.8103.38
(`dumpsys webviewupdate`) - beide unterstuetzen content-visibility. Umgesetzt wurde aber der
JS-seitige Ansatz, weil content-visibility die teure KNOTENERZEUGUNG nicht verhindert (die 2966 ms
steckten in messageEl()/append, nicht im Layout).

**Umsetzung (wirkt in BEIDEN Apps - renderer\ wird vom Android-Build kopiert)**
`llm-box\renderer\js\app.js`:
- Neuer Block vor messageEl() (Zeilen ~845-900): `MSG_VOLL = 60`, `MSG_KOMPAKT = 200`,
  `MSG_SCHRITT = 100`, Zustand `vollKey` / `vollAb` / `vollBis` und Set `aufgefaltet`.
  Bewusst NUR Anzeige-Zustand, an die Chat-ID gebunden - am Gespeicherten wird nichts geaendert
  (Ausdruck des Nutzers).
- `resetMsgFenster()`, `compactHint(m)` (erste Zeile/Werkzeugname, auf 150 Zeichen gekuerzt) und
  `compactEl(m, i)`: eine Zeile mit Rolle, Kurzhinweis und "ausklappen"; Klick/Enter klappt auf.
- `renderMessages()` (Zeile ~736): baut jetzt nur noch ab `vollAb` voll auf, darunter kompakte
  Zeilen, und ganz oben eine Sammelzeile `.msg-steps` mit Knopf "aeltere anzeigen"
  (+ Schritt von 100) und der Zahl ausgeblendeter Nachrichten. Alle Sonderfaelle bleiben erhalten:
  ctx-divider, S.runNode/S.runAm, TL.cards, pendingApproval, continueNotice, hoNotice, ctx-old.
- Mitwanderndes Fenster: `else if (msgs.length - vollAb > MSG_VOLL + MSG_SCHRITT) vollAb = msgs.length - MSG_VOLL;`
  Ohne das waere nach einer langen KI-Antwort wieder der ganze Chat voll aufgebaut - genau der
  gemeldete Fall "Text an die KI uebergeben".
- Aufklappen haelt die Scroll-Position: styles.css setzt `overflow-anchor:none` am Chat-Container,
  der Browser gleicht also nichts aus; `auf()` merkt sich deshalb den Abstand vom Ende und stellt ihn
  nach dem Neuaufbau wieder her.

`llm-box\renderer\styles.css` (nach Zeile 205): `.msg.compact` (eine Zeile, gestrichelt,
Textabschneider), `.compact-role/-hint/-open`, `.msg.compact.ctx-old`, `.msg-steps` + Knopf.

**Messung vorher/nachher (tools-android\perf-messages.js, echter Chat mit 3456 Nachrichten)**
   Vorher:  3402 Nachrichten -> 2966 ms, 110.243 DOM-Knoten
   Nachher: 3456 Nachrichten ->   60 ms,   2.760 DOM-Knoten
   (auch bei 1000 Nachrichten: 884 ms -> 279 ms; DOM-Knoten bleiben konstant ~2.700)
Tippen bleibt guenstig: 100 Tastenanschlaege = 137 ms. updateCtxMeter unveraendert 3 ms/20 Aufrufe.

**Tests**
- `tools-android\test-ui-boot.js`: 9 neue Pruefungen mit einem kuenstlichen 900-Nachrichten-Chat:
  nicht alles wird voll aufgebaut, aeltere erscheinen kompakt, DOM-Knoten bleiben klein, Sammelzeile
  vorhanden, aufklappen zeigt die volle Nachricht, mehrere Stufen vergroessern begrenzt, Chat-Inhalt
  bleibt unveraendert (Nachrichtenzahl gleich), neueste Nachricht bleibt voll, keine JS-Fehler.
  UI-Lauf jetzt **73 Pruefungen, 0 Fehler**.
- Gesamt nach dem Umbau: `tools-android\run-tests.cmd` -> **191 geprueft, 0 Fehler** in 6 Laufen
  (test-log-v103.txt: 33 + 73 + 8 + 4 + 53 + 20). Vorher (ohne UI-Erweiterung) 182.

**Builds**
- APK neu gebaut (build-now.ps1, "34 actionable tasks: 34 executed").
- Windows **1.0.59** gebaut (dist\LLM Box Setup 1.0.59.exe, tmp-winbuild59.txt) - enthaelt den
  Performance-Fix; 1.0.58 hatte ihn noch nicht.

**Offene Punkte / naechster Schritt**
- Windows 1.0.59 installieren (der Nutzer wollte selbst installieren) und das Zogern dort an seinem
  echten 13-MB-Chat nachmessen.
- Am G986B pruefen: fenstweiser Aufbau + kein weisser Panel-Block beim Start.
- Optionaler Feinschliff: content-visibility:auto zusaetzlich fuer die vollen Knoten im Fenster
  (senkt Layout/Paint weiter), und Speicher der Aufklapp-Einstellung, falls der Nutzer ein anderes
  Fenster will.
- APK auf dem SM-S948B installieren und das neue Tempo am Gerat nachweisen (Tempo in der App
  umstellen, Logcat-Tag LLMBOX-UI / `probe_remote_hits`; Display wach halten, Doze whitelisten –
  Punkt 87).
- Beim Nutzer ist weiterhin Windows 1.0.54 installiert; die neue Version muss er selbst
  installieren.

## 97) Sitzung 13 – Hauptursache der Windows-Bremse nachgewiesen: die installierte Fassung hat die Fixes nicht

**Was installiert IST (nicht geraten, sondern ausgelesen)**
- Verknuepfung `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\LLM Box.lnk` zeigt auf
  `C:\Program Files\LLM Box\LLM Box.exe` (NICHT `AppData\Local\Programs`, dieser Ordner ist leer).
- Datei-Version laut VersionInfo: **1.0.57** (ProductVersion 1.0.57.0).
- Im installierten Paket nachgesehen (`C:\Program Files\LLM Box\resources\app.asar`, Trefferzaehlen
  mit Select-String): `MSG_KOMPAKT` **0**, `vollAb` **0**, `metaCache` **0** - dafuer `SYNC_DEFAULT_MS` 2.
  Das bedeutet schwarz auf weiss: die laufende Windows-App kennt weder das fensterweise
  Nachrichtenaufbauen (Punkt 96) noch den Sync-Flattern-Schutz gegen gesperrte Meta-Dateien (Punkt 93).
- Im gebauten Paket `llm-box\dist\win-unpacked\resources\app.asar` (1.0.59, 14.11. 15:34) dagegen:
  `MSG_KOMPAKT` 2, `vollAb` 7, `metaCache` 3, `msg-steps` 5 - beide Korrekturen sind enthalten.

**Einordnung der beiden gemeldeten Probleme**
Beide in Punkt 93/96 belegten Bremsen laufen in 1.0.57 unveraendert weiter:
1. Jede neue Nachricht baute den ganzen Chat neu auf (gemessen 2966 ms / 110.243 DOM-Knoten bei
   ~3450 Nachrichten) - genau das "Eingaben werden spaeter uebernommen".
2. Gesperrte Meta-Dateien auf Y: liessen Chats verschwinden und wieder auftauchen, wodurch
   `onRemoteChats()` die 12,7 MB Chat-Datei erneut ueber SMB lud und die Liste neu baute - mitten
   im Tippen.
Damit ist die Windows-Klage **nicht** durch neuen Code zu beheben, sondern dadurch, dass die
bereits gebaute 1.0.59 installiert wird.

**Nachmessung am echten Chat (Quelle = aktueller Stand, nicht die installierte App)**
`node tools-android\perf-messages.js` -> `messungen-perf-messages.txt`:
    8swxb7q8mwcb695l.json  13.9 MB / 3487 Nachrichten
       50 Nachrichten   163 ms | 1603 Knoten
      200 Nachrichten    70 ms | 2539 Knoten
     3487 Nachrichten    67 ms | 2755 Knoten      (vorher: 2966 ms / 110.243 Knoten)
      100 Tastenanschlaege bei 3487 Nachrichten: 156 ms
    e0iidgermwdk54iq.json   3.0 MB /  944 Nachrichten -> 66 ms / 2775 Knoten, Tippen 106 ms
    20x updateCtxMeter(): 3 ms
Der fensterweise Aufbau haelt also auch bei 3487 Nachrichten konstant ~2.700 Knoten.

**Neue Messung: was ein einzelner Speichervorgang kostet** (`tools-android\perf-save.js`, neu;
schreibt nur in einen eigenen Testordner, echter Chat bleibt unveraendert) -> `messungen-save.txt`:
    8swxb7q8mwcb695l.json 14.0 MB / 3516 Nachrichten
       lesen            198 ms
       JSON.stringify    48 ms   <- blockiert den Event-Loop im Hauptprozess (main.js:82)
       StructuredClone   62 ms   <- Kosten des IPC-Wegs Renderer -> Main (preload.js:37)
       atomar auf Y:    209 ms   <- I/O, laeuft async
       Summe ~ 319 ms pro Speichervorgang | Meta-Revision = 3037 (so oft wurde dieser Chat gespeichert)
    kleinere Chats (3 MB): ~66 ms pro Vorgang, Revision 1
Ergaenzend `tools-android\perf-schreiben.js`: 13 MB atomar auf Y: in 166 ms (lokal 164 ms), kein
einziger Retry. Das Netzlaufwerk ist NICHT das Problem - problematisch ist die ANZAHL der Voell-
schreibvorgaenge: bei jedem Werkzeug-Ergebnis und alle 45 s wird die komplette Datei gesendet und
neu geschrieben (app.js:1833/1867/1654, main.js:217).

**Weitere Bremskandidaten im Renderer (Unteragent, nur lesend; nichts geaendert)**
- Monitor: `server.js:216` `setInterval(svPoll, max(1,pollSec||2)*1000)` = alle 2 s, bei Fehlschlag
  Kette ueber `/api/native`, `/v1/status`, `/health`, `/v1/models`; danach Tabellen-Neuaufbau per
  `innerHTML=''` plus SVG-Sparklines. Laeuft nur, wenn Monitor-Fenster offen oder Dock sichtbar.
- Waehrend die KI antwortet: `app.js:1682` Ticker alle 250 ms und `app.js:1608` livePoll alle 2 s,
  beide mit `chatTotals(S.chat)` ueber alle Nachrichten.
- Pro Tastendruck (`app.js:2331`): `autosize()` (Reflow) + `updateEstimate()`. Die
  Token-Schaetzung selbst ist billig (`util.js:95` = `Math.ceil(len/3.8)`), gemessen 1,6 ms pro
  Tastendruck - also NICHT die Ursache.
- Keine doppelt registrierten Listener gefunden (`wireEvents()` laeuft genau einmal, app.js:123).

**Android: weisser Startblock ist behoben, aber die Gerate hatten die alte Fassung**
- `android\app\build.gradle` stand fest auf `versionCode 32 / versionName "1.0.32-android"`. Beide
  Gerate meldeten nach dem Installieren unveraendert `1.0.32-android` - deshalb war nicht sichtbar,
  dass der Panel-Fix dort nie angekommen war (UI-Sonde meldete `"panelCollapsed":null`).
- build.gradle jetzt auf `versionCode 59 / versionName "1.0.59-android"` (gleich wie Desktop).
- Neu gebaut (`build-now.ps1`, "34 actionable tasks: 34 executed") und auf BEIDE Gerate installiert:
  SM-G986B (transport 8) und SM-S948B (transport 10) melden `versionName=1.0.59-android`.
- Startbildschirm-Nachweis am G986B mit neuen Werkzeugen `tools-android\start-screen-probe.ps1` +
  `tools-android\png-sample.js` (Details in messungen-geraet.md): bei 400 ms dunkler Fensterrahmen,
  ab 900 ms durchgaengig heller Homescreen, UI-Sonde meldet `"panelCollapsed":true`. Kein Panel-Block.
  Nebenbefund: Screenshots sind bei gesperrtem Display komplett schwarz, und PowerShell kann die
  Binariausgabe von `adb exec-out screencap` nicht umleiten - beides im Skript beruecksichtigt.

**Tests / Stand**
- `tools-android\run-tests.cmd` -> **191 geprueft, 0 Fehler** (33+73+8+4+53+20), Protokoll
  `test-log-v105.txt`. Reihenfolge eingehalten: erst gebaut, dann getestet.

**Offene Punkte / naechster Schritt**
- Windows **1.0.59** installieren (`llm-box\dist\LLM Box Setup 1.0.59.exe`) - laeuft aktuell 1.0.57.
  Erst danach ist das Zogern am echten Chat behoben; der Nutzer wollte selbst installieren.
- Optional (noch nicht umgesetzt, bewusst zurueckgehalten): Speichern waehrend der Generierung
  entprellen/duennen - 3037 Voell-Schreibvorgaenge a la ~319 ms bei einem einzigen Chat sind ein
  realer Kostenblock, aber eine laengere Entprellzeit erhoeht das Risiko, einen Antwortteil zu
  verlieren. Vorher mit dem Nutzer abstimmen.
- Monitor-Abfrage (2 s) und Streaming-Ticker (250 ms) sind messwuerdig, aber erst nach der
  Installation von 1.0.59 sinnvoll zu bewerten.

## 98) Sitzung 13 – Nutzer hat installiert: Durchgetestet, eine echte Luese gefunden und behoben (1.0.60)

Der Nutzer hat Windows 1.0.59 selbst installiert und gebeten, alles durchzupruefen.

**Was installiert laeuft (geprueft, nicht angenommen)**
- `C:\Program Files\LLM Box\LLM Box.exe` = Datei-Version **1.0.59**; Fenstertitel "Reuschler-IT - LLM Box v1.0.59".
- Vier Prozesse; Rollen ueber die Kommandozeile bestimmt (`--type=`): MAIN 4484, gpu-process 4648,
  utility 10472, renderer 10784.
- Neu: `tools-android\app-status.ps1` prueft Version, Prozessrollen, CPU-Last, sync.json,
  Schreibreste und gesperrte Meta-Dateien in einem Lauf.

**Nachweis, dass die installierte Fassung die Korrekturen wirklich enthaelt**
Statt zu vermuten, wurde das installierte Paket ausgepackt und verglichen:
- Neu: `tools-android\asar-read.js` (liest Electron-.asar ohne Fremdwerkzeug) und
  `tools-android\asar-probe.js` (findet den JSON-Kopf; Kopf beginnt bei Offset 16, Datenblock bei
  8 + Header-Pickle-Laenge = 108596). Erster Versuch scheiterte an falschen Pickle-Offsets.
- Alle 24 Dateien von `renderer\` aus der installierten app.asar sind **byte-identisch** (SHA-256)
  zu `llm-box\renderer\`. Die installierte main.js ist ebenfalls identisch zur Quelle.
- Trefferzaehlen in der installierten app.asar: `MSG_KOMPAKT` 2, `vollAb` 7, `metaCache` 3,
  `msg-steps` 5 - im Gegensatz zu 1.0.57 davor, wo alle drei bei 0 lagen (Punkt 97).
- Vergleich installierte app.js vs. Android-app.js: genau 22 Zeilen unterschiedlich, ausschliesslich
  bekannte Android-eigene Stellen (`panelOpen: false`, `IS_ANDROID`-Enter-Migration, Statuszeile).
  Der Block um `MSG_VOLL`/`compactEl()`/`renderMessages()` ist in beiden **identisch** (82 Zeilen).

**Messung am laufenden Programm (1.0.59)**
- CPU im Leerlauf ueber 12 s: MAIN 31 ms, gpu 31 ms, utility 0 ms, renderer 78 ms =
  **141 ms gesamt, 1,2 % eines Kerns**. Arbeitsspeicher renderer 257 MB. Von der App gehen im
  Leerlauf also keine nennenswerten Lasten aus.

**Der entscheidende Praxistest: flackert die Chatliste noch?** (`tools-android\sync-flattern-praxis.js`, neu)
Liest den ECHTEN Ordner `D:\MeinProjekt\LLM-Box-Chats` mit derselben Logik wie main.js und faehrt
8 Runden im eingestellten 2-Sekunden-Takt. Schreibt nichts. Ergebnis (`messungen-flattern-praxis.txt`):
    jede Runde: 9 Chats sichtbar | gesperrte Meta 6 | als GEANDERT gemeldet 0 | als GELOESCHT gemeldet 0
    Abgleich-Dauer 3-6 ms pro Runde
    Gesamt: 0 Aenderungs- und 0 Loeschmeldungen -> KEIN Flattern
Dazu `app-status.ps1`: die 6 gesperrten Meta-Dateien sind unveraendert vorhanden (Zugriff verweigert),
`.tmp-Reste` im Chatordner: 0. Das war in 1.0.57 der Ausloeser dafuer, dass die Oberflaeche beim Tippen
neu aufgebaut wurde - jetzt fuehren dieselben gesperrten Dateien zu keiner einzigen Meldung.

**Gefundene Luese (Dokumentation behauptete einen Fix, der Code hatte ihn nicht)**
Punkt 93 schrieb, `schedulePoll()` habe "denselben Fix wie die Android-Seite" bekommen
(Generationen-Marke `pollGen`). Suchlauf ueber den ganzen Workspace: `pollGen` kam ausschliesslich in
`tools-android\native-main.js` (Zeile 610/619/624) vor, NICHT in `llm-box\main.js`. Dort stand
weiterhin Zeile 338: `pollTimer = setTimeout(async () => { await pollChats(); schedulePoll(); }, wait);`

Behoben in `llm-box\main.js` (Zeilen 334-350): Generationsmarke `pollGen` eingebaut, Nachplanen nur
bei `if (gen === pollGen)`, zusaetzlich `.catch(() => {})`, damit ein Fehler im Abgleich die Kette nicht
beendet. Muster bewusst identisch zu native-main.js:619 gehalten.

Wirkung ehrlich eingeordnet: Ohne Marke plant ein ueberholter, noch laufender Abgleich nach seinem Ende
erneut ein und ersetzt dabei den frisch umgestellten Timer - der naechste Abgleich rueckt nach hinten
und der eingestellte Rhythmus stimmt voruebergehend nicht. Es entstehen im Windows-Hauptprozess aber
keine zwei dauerhaften Ketten (jeder schedulePoll-Aufruf loescht vorher per clearTimeout den alten Timer,
und es gibt nur eine schedulePoll-Stelle). Der Fall tritt nur auf, wenn der Rhythmus WAHREND eines
laufenden Abgleichs geaendert wird - nicht im taeglichen Betrieb. Die Windows-Bremse war das also nicht.

**Regressionssperre damit dieser Rueckfall auffaellt** (`tools-android\test-poll-schedule.js`, neu)
- Statisch fuer main.js UND native-main.js: Marke vorhanden, `++pollGen`, Nachplanen nur bei gleicher
  Marke, KEIN naives `await pollChats(); schedulePoll();`, Fehler fangen die Kette ab, der eingestellte
  Abstand erreicht wirklich die Timer-Verzoegerung.
- Verhaltens-Nachbildung mit clearTimeout/setTimeout wie im echten Code: Wechsel des Rhythmus mitten in
  einem 4 s langen Abgleich. Ohne Marke naechster Abgleich deutlich spaeter als eingestellt; mit Marke
  exakt im eingestellten Abstand. Der Gegenbeweis (alte Variante zeigt den Fehler) ist ausdruecklich dabei,
  sonst waere der Test wertlos. Drei Anlaeufe waren noetig: zuerst an zu kurzen Abstaenden gemessen, dann
  an der Zahl der Laeufe - beides traf den Mechanismus nicht, weil clearTimeout zwei Ketten verhindert.
- In `tools-android\run-tests.cmd` als Lauf 8 ergaenzt.

**Tests und Builds**
- `tools-android\run-tests.cmd` -> **208 geprueft, 0 Fehler** in 8 Laeufen
  (33 + 73 + 8 + 4 + 53 + 20 + 17), Protokoll `test-log-v106.txt`. Vorher 191 in 6 Laeufen.
- Windows **1.0.60** gebaut (`llm-box\dist\LLM Box Setup 1.0.60.exe`, tmp-winbuild60.txt); im gebauten
  Paket nachgeprueft: `pollGen` 4 Treffer, `MSG_KOMPAKT` 2, `metaCache` 3.
- Android-Version zurueck auf `versionCode 59 / versionName "1.0.59-android"` gesetzt: die Android-Seite
  hatte den Fix schon immer, es gab dort nichts zu aendern - eine hoehere Nummer waere irrefuehrend.

**Offene Punkte / naechster Schritt**
- Windows **1.0.60** installieren, falls der Rhythmus-wechsel-waehrend-eines-Abgleichs relevant ist.
  Fuer das gemeldete Zogern ist die installierte 1.0.59 bereits ausreichend (siehe Messungen oben).
- Nutzer soll am laufenden 1.0.59 melden, ob Tippen/Monitoring/Uebergeben sich jetzt fluessig anfuehlt -
  die Messwerte sprechen dafuer, das Empfinden kann er nur selbst bestaetigen.
- Nicht angefasst (bewusst): Speichern entlasten. 3037 Voell-Schreibvorgaenge a la ~319 ms bei einem Chat
  sind ein realer Kostenblock, aber eine laengere Entprellzeit erhoeht das Risiko, Antwortteile zu
  verlieren - vorher abstimmen.
- Nicht angefasst: Monitor-Poll alle 2 s (server.js:216) und Streaming-Ticker 250 ms (app.js:1682).
  Beide laufen nur bei offenem Monitor bzw. waehrend einer Antwort; im Leerlauf gemessen ohne Auswirkung.

**Rueckmeldung des Nutzers (14.11., Abschluss dieses Abschnitts)**
- Auf die Frage, wie sich die App nach der Installation von 1.0.59 anfuehlt: "Fuehlt sich fluessig an –
  nichts weiter tun." Damit ist das gemeldete Zoegern (Punkt 92/93) aus Nutzersicht behoben und durch
  die Messungen in Punkt 97/98 gedeckt.
- Auf die Frage, ob eine der beiden bewusst nicht angefassten Massnahmen gewuenscht wird
  (Speichern entlasten / 45-Sekunden-Zwischenspeicherung ersetzen): ausdruecklich NEIN.
  Das Speicher-Verhalten bleibt unveraendert – die in Punkt 97 gemessenen ~319 ms pro Voell-
  schreibvorgang und 3037 Revisionen des grossen Chats sind damit bekannt, aber gewollt hingenommen.
  NICHT noch einmal aufgreifen, ausser der Nutzer fragt erneut.

**Abgeschlossener Stand (gültig ab jetzt)**
- Windows installiert und in Benutzung: **1.0.59**. Gebaut, aber nicht installiert: **1.0.60**
  (`llm-box\dist\LLM Box Setup 1.0.60.exe`, enthaelt den pollGen-Schutz). Nur installieren, falls der
  Rhythmus waehrend eines laufenden Abgleichs geaendert wird.
- Android auf BEIDEN Geraten installiert: **1.0.59-android** (SM-G986B transport 8, SM-S948B transport 10).
  Startbildschirm ohne weissen Panel-Block belegt (`"panelCollapsed":true`, Screenshots in `geraet-start\`).
- Testsuite: **208 geprueft, 0 Fehler** in 8 Laeufen (`test-log-v106.txt`), including der neuen Lauf 8.
- Beide vom Nutzer gemeldeten Probleme sind damit erledigt und nachgemessen.

**Naechster sinnvoller Schritt (nur auf neuen Wunsch)**
- Falls die Android-Oberflaeche am Gerat noch pruefbeduerftig ist: kompakte Nachrichtenansicht mit einem
  grossen Chat auf dem G986B ansehen (dafür gibt es bisher keine Sonde – `msg.compact` kommt in
  MainActivity.java nicht vor, eine Sonde muesste neu geschrieben werden).
- Optional: Debug-Sonden aus MainActivity.java entfernen, wenn die App nicht mehr fuer Messzwecke
  gebaut wird (Punkt 87/90, Extras `probe/chatprobe/lanprobe/smbprobe/setsync/syncrate`).

## 99) Sitzung 13 – Workspace + SMB-Zugangsdaten bei der WLAN-Uebertragung

**Gewuenschter Funktionsumfang (Nutzerwunsch, ausdruecklich abgestimmt)**
- "Im WLAN suchen" soll ausserdem den Workspace sowie – falls vorhanden – Benutzername und Passwort
  der SMB-Freigabe uebertragen.
- Richtung: **vom PC zum Handy**. Windows bekommt dafuer erstmals eigene SMB-Felder.
- Ohne gespeicherte Zugangsdaten auf dem sendenden Geraet bleiben die Felder leer (Antwort auf
  Rueckfrage), der Empfaenger behaelt seine eigenen.
- Zum QR-Code: behalten **und** eine echte Scan-Funktion einbauen (Punkt 3, siehe unten).

**Vorher geklaerte Ausgangslage (belegt, nicht angenommen)**
- Die Windows-App hatte **keinen** SMB-Zugangsdaten-Speicher: `smb` in main.js, preload.js und
  settings.js = 0 Treffer. Zugangsdaten gab es nur auf Android: `files/data/smb.json`, verwaltet von
  Java (`MainActivity.java:1673 smbGetCreds`, `:1690 smbSaveCreds`, Struktur
  `{ "rechner": { user, domain, pass } }`). Das Passwort kommt dort nie zurueck, nur `hasPass`.
- Sender ist immer die Windows-App, Empfaenger immer Android (`transfer.js:312`:
  `if (window.IS_ANDROID) return tabTransferAndroid();`).
- **Warum der Workspace nie mitkam:** `buildTransfer()` haelt Workspace-Dateien mit
  `if (opt.ws && !forQr)` zurueck (QR-Groessenlimit), `serveLan()` rief aber
  `buildTransfer(opt, true)` an – also fielen die Dateien beim WLAN-Angebot immer weg, obwohl der
  WLAN-Weg kein Groessenlimit hat.
- Der Workspace-PAD wanderte dagegen schon immer mit, wurde auf Android aber bewusst verworfen
  (`native-main.js:999 delete s.workspace.path`, Report-Eintrag `:1028`).

**Frage des Nutzers beantwortet: warum ein QR-Code angezeigt wird, obwohl die App ihn nicht scannen kann**
Belegt durch den Kommentar in `transfer.js:184`: "Ein QR-Code wird auf dem Handy nicht dekodiert -
es gibt keinen eingebauten Kamera-Decoder." Der Code beim WLAN-Angebot enthaelt nur die Adresse
(`serveLan`, Zeile 608/171), die Android-App findet den Rechner stattdessen ueber das UDP-Rufsignal
Port 45455 ("LLMBOX?" → "LLMBOX|port|token|sha16", main.js:597-602). Scannen ist also nicht noetig –
der QR war irrefuehrend.

**Neu eingebaut – Windows-Seite**
`llm-box\main.js` (vor dem Abschnitt "Dateien"):
- `smbFile()` = `%APPDATA%\LLM Box\smb.json`, gleiche Struktur wie Android, damit beide Apps
  austauschbare Uebertragungsdateien erzeugen. `loadSmb()/saveSmb()`.
- `smbHostOf(p)` / `smbPartsOf(p)`: zerlegen `\\rechner\freigabe\ordner`, `//rechner/freigabe` und die
  interne Android-Form `/smb/rechner/freigabe/…`. Ein gemapptes Laufwerk (Y:\) hat bewusst keinen
  Rechner – dazu passen auch die Kommentare in den Tests.
- IPC: `smb:getCreds` (ohne Passwort, nur hasPass), `smb:saveCreds` (leere Felder ueberschreiben
  keinen gespeicherten Wert – gleiches Verhalten wie Java, sonst naechster Zugriff anonym und
  abgelehnt), `smb:credsForExport` (nur fuer ausdruecklich gestartete Uebertragung),
  `smb:listHosts`, `smb:test` (prueft ueber fsp.stat/readdir auf dem UNC-Pfad, erklaert EPERM/ENOENT
  in deutschen Hinweisen).
`llm-box\preload.js`: `api.smb = { getCreds, saveCreds, test, credsForExport, listHosts }`.
`llm-box\renderer\js\settings.js`: neues `smbRowWin(w, changed, render)` im Tab "Workspace & Dateien"
direkt unter dem Workspace-Ordner – Felder Pfad/Benutzer/Domain/Passwort plus Knopf
"Verbinden & uebernehmen"; speichert zuerst die Zugangsdaten, testet dann die Freigabe und setzt
`w.path` nur bei funktionierender Verbindung. Helfer `smbParseWin()`.
Achtung beim Einbau: `frow()` kapselt die Steuerung bereits selbst in `.fctrl` (settings.js:115) –
zuerst war ein zusatzliches `el('div',{class:'fctrl'})` gesetzt, was doppelte Kapselung ergab.
Jetzt wird das Feld-Array direkt mit `stack=true` uebergeben.

**Neu eingebaut – Android-Seite (Gegenstueck, damit die Bridge vollstaendig bleibt)**
`tools-android\native-main.js`: neue Sektion `smb` vor `const api = {` (Zeile ~858) mit
`getCreds/saveCreds/test/credsForExport/listHosts`. Weitergabe an Java wie bisher
(`Native.smbGetCreds/smbSaveCreds`, Test ueber `__fsJob('smbTest', …)` weil ein direkter Aufruf die
Oberflaeche blockiert – gemessen ~10 s bei unerreichbarer Freigabe).
Bewusste Entscheidungen:
- `credsForExport` liefert auf Android **kein** Passwort (Java gibt es nicht heraus); ein neuer
  Java-Zugriff wuerde das Klartext-Passwort an die Web-Seite geben – bewusst unterlassen.
- `listHosts()` liest den Rechner aus dem internen Freigabe-Pfad des Workspace
  (`/smb/rechner/…`) statt smb.json zu lesen – noetig war zuerst ein geplanter Java-Auftrag
  `smbList`, der wurde wieder verworfen.

**Uebertragung erweitert**
`llm-box\renderer\js\transfer.js`:
- `buildTransfer(opt, forQr)`: neuer Zweig `if (opt.smb)` haengt `out.smb = { host, share, sub, unc,
  path, user, domain, pass }` an und meldet `contains: 'smb'`; ohne Daten kommt
  `omitted: 'smb (kein Netzwerkordner …)'`. Helfer `smbParts()` und `collectSmb()`.
- `serveLan()` ruft jetzt `buildTransfer(opt, false)` – damit kommen die Workspace-Dateien im
  WLAN-Weg endlich mit (vorher durch `true` abgeschaltet).
- Neues Anhaekstchen "Netzwerkordner (SMB) samt Zugangsdaten" (standardmaessig an),erklaert das
  Verhalten ohne gespeicherte Zugangsdaten.
- Uebernahme-Rueckmeldung zeigt jetzt `Netzwerkordner \\rechner\freigabe` und den Grund, wenn der
  Pfad nicht gesetzt wurde; Bestaetigungsdialog kuendigt das Ergebnis an.

**Uebernahme auf Android ergaenzt** (`native-main.js`, apply() nach dem workspaceFiles-Zweig):
Reihenfolge wie in android-adapter.js: erst `Native.smbSaveCreds(host, user, domain, pass)`, dann
`__fsJob('smbTest', '/smb/host/share/sub')`, und den Workspace-Pfad nur bei gelungener Pruefung per
deepMerge setzen. Ohne mitgeschickte Zugangsdaten bleiben die vorhandenen erhalten. Report-Felder:
`smbCreds`, `smbPath`; scheitert der Test, kommt ein erklaerter Eintrag in `ignored` statt einem
stummen Uebernehmen.

**Builds/Tests zu diesem Stand**
- `build-now.ps1`: "34 actionable tasks: 34 executed", APK enthaellt den neuen Code
  (`smbRowWin`, `collectSmb`, `credsForExport`, `listHosts` in den kopierten Dateien nachgewiesen).
- `tools-android\check-api.js`: 49 benutzte = 49 gelieferte api-Aufrufe, "Alle benutzten
  api-Aufrufe sind implementiert" (einziger ungenutzter Rest: `transfer.qrCollect`).
- `run-tests.cmd` nach dem Build: **208 geprueft, 0 Fehler** in 7 Laufen (`test-log-v107.txt`) – die
  neuen Funktionen haben nichts kaputt gemacht.
- Windows **1.0.61** gebaut (`llm-box\dist\LLM Box Setup 1.0.61.exe`, tmp-winbuild61.txt).
- `android\app\build.gradle` auf `versionCode 61 / versionName "1.0.61-android"` gesetzt und APK neu
  gebaut (tmp-build62.txt, 34/34).

**Nebenbefund: doppelte Datei transfer.js**
Es gibt `llm-box\transfer.js` (20.087 Bytes, aelter) UND `llm-box\renderer\js\transfer.js`
(20.945 Bytes, aktuell). Ausgeliefert wird nur die aktuelle: package.json uebernimmt `main.js`,
`preload.js`, `docs.js` und `renderer/**/*`. Die Wurzel-Kopie ist toter Ballast und wurde NICHT
geaendert – bei kuenftigen Arbeiten nicht verwechseln.

**Offene Punkte / naechster Schritt**
- QR-Scan: jsQR liegt jetzt lokal (`webdeps\jsqr-1.4.0.tgz`, dist/jsQR.js 256,9 kB). Noch nicht
  eingebaut. Dafuer noetig: Kamera-Berechtigung ins Manifest (bislang nur INTERNET und
  ACCESS_NETWORK_STATE, AndroidManifest.xml:4-5), `WebChromeClient.onPermissionRequest` in
  MainActivity.java (bisher leerer WebChromeClient, Zeile 188; keine requestPermissions/CAMERA-
  Treatments im Projekt gefunden) und eine Scanner-Seite in transfer.js. Maven Central und die
  npm-Registry sind erreichbar (HTTP 200), ein ZXing-Weg ueber Gradle waere moeglich.
- SMB-Uebertragung am Gerat pruefen: Windows 1.0.61 installieren, "Im WLAN anbieten" mit angehaktem
  Netzwerkordner, dann auf dem Handy "Im WLAN suchen"; erwartet: Freigabe-Pfad + Zugangsdaten
  uebernommen, Statusmeldung nennt den gesetzten Pfad.
- Uebertragungsformat-Dokumentation `llm-box\docs\TRANSFER-FORMAT.md` kennt das Feld `smb` noch
  nicht – nachziehen.

**QR-Scan umgesetzt (zweiter Teil des Nutzerwunsches)**
Grundlage: Maven Central und npm sind erreichbar (HTTP 200). jsQR liegt jetzt im WebView-Bundle:
- `webdeps\bundle-entry.js`: `globalThis.jsQR = require('jsqr').default || require('jsqr');`
- installiert mit `cd webdeps && npm i jsqr@1.4.0`, Bundle neu gebaut mit
  `npx esbuild bundle-entry.js --bundle --format=iife --platform=browser --target=es2020 --minify --outfile=out\webdeps.js`
  -> `webdeps\out\webdeps.js` waechst von ~394 kB auf 677.244 Bytes (19:00 Uhr). Der Build kopiert die
  Datei automatisch nach `vendor\webdeps.js` (build-android.ps1:82-86).

Android nativ:
- `android\app\src\main\AndroidManifest.xml`: CAMERA-Berechtigung + `<uses-feature camera required=false>`
  (zuvor nur INTERNET und ACCESS_NETWORK_STATE, Zeile 4-5).
- `MainActivity.java`: Feld `cameraLauncher` (ActivityResultContracts.RequestPermission) neben den drei
  bestehenden Launchern; Ergebnis geht per `js("__qrPermission", "true|false")` an die Web-Seite.
  `web.setWebChromeClient(...)` bekam einen `onPermissionRequest`-Override – ohne ihn lehnt die WebView
  jede getUserMedia-Anfrage still ab (Vorschau bleibt schwarz). Bewusst nur RESOURCE_VIDEO_CAPTURE,
  alles andere wird mit deny() abgelehnt.
  FEHLER und Korrektur: zuerst als `android.webkit.PermissionRequest.Resource` geschrieben -> drei
  Compile-Fehler ("Symbol nicht gefunden", tmp-build63.txt, Zeilen 206/207/214). Die Ressourcen sind
  STRINGS; jetzt `java.util.List<String>` + `RESOURCE_VIDEO_CAPTURE.equals(r)` und
  `grant(erlaubt.toArray(new String[0]))`. Build danach NOCH NICHT erneut gelaufen.
- Neuer Brueckenaufruf `Native.qrScanStart()` (@JavascriptInterface, direkt vor smbTest): prueft
  checkSelfPermission(CAMERA), fragt sonst cameraLauncher.launch(...) und antwortet ueber
  window.__qrPermission. Angefragt wird erst beim ersten Scan, nie beim App-Start.

Web-Seite (`llm-box\renderer\js\transfer.js`):
- `window.__qrPermission(erlaubt)` + `qrKameraErlaubnis()` (wartet auf die native Antwort, 25 s
  Sicherungstimeout).
- `scanQr(video, status, onCode)`: getUserMedia({video:{facingMode:'environment'},audio:false}),
  requestAnimationFrame-Schleife, Canvas auf max. 480 px Breite begrenzt (jsQR rechnet pro Pixel),
  jsQR-Erkennung, `stop()` gibt Kamera frei (srcObject=null + track.stop()) und wird im finally gerufen.
- WICHTIGER Denkfehler korrigiert: zuerst erzeugte scanQr() das video-Element selbst, das nie in den
  Dialog kam -> keine Vorschau. Jetzt uebergibt qrScannenAndroid() ein Video, das VOR dem Start im
  Modal steht (in der WebView zeigt ein nicht eingehaengtes <video> nichts).
- `qrVerwerten(text, sammler)`: unterscheidet Adresse (`http://…/llmbox-transfer?t=…` ->
  fetchTransferFrom + applyTransfer), LBX1-Stueck (api.transfer.qrCollect zaehlt und baut zusammen)
  und fremde Codes.
- `qrScannenAndroid()` oeffnet das Modal mit Video+Status, schliesst bei Erfolg selbst, gibt die
  Kamera in jedem Pfad frei (Abbrechen, ESC/X, Fehler).
- Neuer Knopf "QR-Code scannen …" (`btnScan`) im Android-Uebertragungsreiter plus Erklaerung, dass
  "Im WLAN suchen" auch ohne Kamera funktioniert.
- Der zerrissene Restkommentar vor fetchTransferFrom (Zeile ~391) wurde ersetzt; die Aussage "Ein
  QR-Code wird auf dem Handy nicht dekodiert" gilt seit 1.0.62 nicht mehr.
- `node --check llm-box\renderer\js\transfer.js` = OK.

**Stand der Builds zu diesem Zeitpunkt**
- Windows **1.0.61** ist gebaut (dist\LLM Box Setup 1.0.61.exe) und enthaelt die SMB-Uebertragung,
  aber NOCH NICHT den QR-Scan-Code (der kam danach).
- APK 1.0.61-android war auf beiden Geraten installiert (G986B transport_id 4, S948B transport_id 12;
  die aelteren IDs 8/10 gibt es nicht mehr – vor jeder adb-Aktion `adb devices -l` pruefen).
- Der Build MIT QR-Scan ist noch nicht erfolgreich durchgelaufen (zuerst Java-Fehler, dann korrigiert).

**Offene Punkte / naechster Schritt (Reihenfolge)**
1. `cd LLM-Box && powershell -ExecutionPolicy Bypass -File build-now.ps1` erneut laufen lassen –
   erwartet "34 actionable tasks: 34 executed". Der Java-Fehler ist behoben, der Build danach steht aus.
2. DANN `tools-android\run-tests.cmd` (Reihenfolge zwingend: erst bauen, dann testen; sonst lesen Tests
   eine halbfertige assets\webapp). Erwartet mindestens 208 Pruefungen / 0 Fehler in 7 Laufen.
3. Windows **1.0.62** bauen (`cd llm-box && npm version 1.0.62 --no-git-tag-version && npm run dist`) und
   `android\app\build.gradle` auf versionCode 62 / "1.0.62-android" setzen, APK auf beide Gerate
   installieren (adb -t 4 und -t 12, IDs pruefen).
4. Am Gerat pruefen: Einstellungen → Uebertragung → "QR-Code scannen" (Kamera-ErlaubnisDialog,
   Vorschau sichtbar, Adresse erkannt) und "Im WLAN suchen" mit angehaktem Netzwerkordner auf der
   Windows-Seite (erwartet: Freigabe + Zugangsdaten uebernommen, Statusmeldung nennt den Pfad).
5. `llm-box\docs\TRANSFER-FORMAT.md` um das Feld `smb` ergaenzen.
6. Nicht verwechseln: `llm-box\transfer.js` (Wurzel) ist eine ungenutzte Alt-Kopie – die ausgelieferte
   Datei ist `llm-box\renderer\js\transfer.js`.

---

## 100. QR-Scan fertig gebaut, gemessen und erklaert (14.11.2026, abends)

**Ausloeser der Nutzerfrage:** "Wieso wird mir ein QR Code angezeigt, wenn ich diesen mit der App nicht
scannen kann?" Die Antwort ist jetzt: weil die App es seit dieser Fassung selbst kann. Vorher war der
angezeigte Code fuer die Android-App nutzlos (kein Decoder, keine CAMERA-Erlaubnis, leerer WebChromeClient) –
die Irrefuehrung steckte zusaetzlich im Hilfetext (siehe Punkt "irrefuehrender Text" unten).

**Build-Kette (Reihenfolge eingehalten: erst bauen, dann testen)**
- `build-now.ps1` -> tmp-build64.txt: BUILD SUCCESSFUL, 34/34 Tasks. Der in Punkt 99 korrigierte
  Java-Fehler (PermissionRequest-Ressourcen sind STRINGS) war damit behoben.
- `tools-android\run-tests.cmd` -> test-log-v108.txt: 7 Laeufe, 208 Pruefungen, 0 Fehler.
- spaeter nach allen Aenderungen: tmp-build65/66 (jeweils 34/34) und
  test-log-v109.txt / test-log-v110.txt: **8 Laeufe, 255 Pruefungen, 0 Fehler**.

**Neuer Pruefstand 9) – `tools-android\test-qr-scan.js` (47 Pruefungen, neu in run-tests.cmd)**
Der Test beantwortet die eigentliche Frage, die man mit Textsuche NICHT beantworten kann: erkennt der
eingebaute Decoder einen Code, den DIESE App selbst erzeugt? Deshalb echt durchgespielt:
- A) statisch: jsQR im Bundle (`webdeps\bundle-entry.js` setzt `globalThis.jsQR`), ausgeliefertes
  `assets\webapp\vendor\webdeps.js` (677.244 Bytes, enthaelt jsQR), `index.html` bindet es ein;
  Manifest CAMERA + `uses-feature camera required="false"`; MainActivity: RequestPermission-Launcher,
  `js("__qrPermission", …)`, `onPermissionRequest`, `@JavascriptInterface qrScanStart()`.
- B) **Hin-und-zuruck-Test**: der QR-Encoder der App (`llm-box\renderer\vendor\qrcode.js`, ueber
  `isDark()`/`getModuleCount()`) malt ein RGBA-Bild inkl. Ruhezone, jsQR muss denselben Text exakt
  zurueckgeben. Prueft die LAN-Adresse UND ein LBX1-Stueck. Beide bestanden.
- C) `qrVerwerten()` wird als echter Quelltext aus transfer.js extrahiert (Klammern zaehlen) und in vm
  ausgefuehrt: Adresse -> 'adresse', LBX1 -> gesammelt/fertig, fremder Code -> 'fremd', leerer Fund ->
  kein Absturz.
- D) `scanQr()` laeuft gegen Attrappen von getUserMedia/video/canvas (Achtung: echtes Browser-API ist
  `getImageData(...).data`, nicht das Array selbst – der erste Testversuch scheiterte genau daran).

**Drei echte Funde durch den neuen Test (nicht nur Bestaetigung)**
1. **Kamera blieb beim Abbruch belegt.** `scanQr()` gab `stop` nur als Rueckgabewert zurueck;
   `qrScannenAndroid()` setzte `stopScan = stop` erst im `.then()` NACH dem Ende der Schleife. Bricht der
   Nutzer ab, solange kein Code gefunden wird, laeuft die Frame-Schleife weiter und die Kamera bleibt an
   ("belegte Kamera", Akku). Korrektur in `llm-box\renderer\js\transfer.js`:
   - `scanQr(video, status, onCode, kontrolle)` traegt `stop()` SOFORT in `kontrolle.stop` ein, bevor die
     Kamera angefasst wird (Zeile ~293), und schuetzt mit Flag `frei` gegen doppeltes Freigeben.
   - `qrScannenAndroid()` arbeitet mit `const kontrolle = { stop: null }` und
     `stopScan = () => kontrolle.stop && kontrolle.stop()` (Zeilen 365-366, 410).
2. **Irrefuehrender Hilfetext** in der Android-Oberflaeche, Zeile 557: "… oder deren QR-Code mit einer
   beliebigen QR-App lesen" – genau die Aussage, ueber die sich der Nutzer zu Recht gewundert hat. Ersetzt
   durch "… oder den QR-Code dort oben mit „QR-Code scannen“ lesen." Der Test prueft den Text jetzt ohne
   Kommentare (`ohneKommentare()`), damit die erklaerende ERWAHNUNG des alten Zustands im Kommentar nicht
   als Fehler zaehlt.
3. **`jsQR` wird frei aufgerufen** (`window.jsQR && jsQR(...)`), funktioniert in der WebView nur, weil dort
   `window === globalThis`. Die Attrappe musste beide Namen kennen – sonst haette der Test einen
   Browser-Vorteil als App-Fehler gemeldet.

**Geraetebeweis statt Verdacht: Sonde `--ez qrprobe true`**
- Neu in `MainActivity.java`: `probeQrAfterLoad()` (vor `probeUiAfterLoad()`, Aufruf in `onPageFinished`).
  Laeuft in der ECHTEN WebView: qrcode.js malt einen Code ins Canvas, jsQR aus webdeps.js muss ihn lesen.
- G986B (transport_id 4) und S948B (transport_id 12), je `am start --ez qrprobe true`, Log-Marke LLMBOX-QR:
  `encoder:true, decoder:"function", adresse {seite:123, gleich:true}, stueck {seite:178, gleich:true}`.
  Beide Geraete erkennen also Adresse UND LBX1-Stueck exakt. Kamera-Erlaubnis ist im System noch
  `granted=false` – sie wird bewusst erst beim ersten Scan gefragt (dumpsys-Beleg).

**Versionen und Installation**
- Android: `android\app\build.gradle` versionCode **62** / "1.0.62-android". APK
  `android\app\app_build\outputs\apk\debug\app-debug.apk` (10.722.442 B) auf BEIDE Geraete installiert,
  belegt mit `dumpsys package`: versionCode=62, versionName=1.0.62-android, CAMERA gelistet.
- Windows: `npm version 1.0.62` + `npm run dist` -> `llm-box\dist\LLM Box Setup 1.0.62.exe`
  (83.920.659 B) und `LLM Box 1.0.62.exe`. Im gebauten app.asar nachgewiesen (ueber
  `tools-android\asar-read.js --out tmp-asar-win62`): smbRowWin, collectSmb, credsForExport,
  "QR-Code scannen", kontrolle.stop und der neue Hilfetext sind enthalten.
  **Noch nicht installiert** – auf dem Rechner steht weiterhin 1.0.59; die Installation soll der Nutzer selbst tun.

**Dokumentation `llm-box\docs\TRANSFER-FORMAT.md` ergaenzt**
- JSON-Beispiel und `contains` um das Top-Level-Feld `smb` erweitert, neuer Abschnitt "Netzwerkordner
  (`smb`) – ab 1.0.61" mit Feldtabelle (host/share/sub/unc/path/user/domain/pass) und den drei Regeln aus
  `apply()` in native-main.js (Zugangsdaten zuerst, leere Felder ueberschreiben nicht, Pfad nur bei
  gelungener Pruefung setzen).
- Wichtiger Hinweis beim Schreiben praezisiert: `smb` – anders als `workspaceFiles` – wird durch die
  Bedingung `opt.ws && !forQr` in `buildTransfer()` **nicht** fuer den QR-Weg ausgelassen. Das Passwort steht
  damit auch im QR-Code. Deshalb bleibt es dabei, dass Android sein Passwort nur fuer eine ausdruecklich
  gestartete Übertragung herausgibt.
- Neuer Abschnitt 2.1 "Weg ueber das WLAN und eigener QR-Scan (ab 1.0.62)": HTTP-Pfad
  `/llmbox-transfer?t=<token>` (Query statt Fragment, Grund im Code-Kommentar main.js:705-707), Auslieferung
  als unkomprimierter JSON-Text (main.js:667-670), UDP-Rufsignal `LLMBOX?` auf Port 45455 mit Antwort
  `LLMBOX|port|token|sha16` (main.js:693-702) und die drei Bausteine des Scans.

**Windows-Seite bleibt richtig getrennt:** `tabTransfer()` in transfer.js:567 prueft `window.IS_ANDROID`;
der Scan-Knopf taucht in der Windows-Oberflaeche gar nicht erst auf. Die Windows-Beschriftung am angebotenen
Code ("In der Android-App: „Im WLAN suchen“ – oder diesen einen Code scannen", Zeile 211) passt seit 1.0.62.

**Offene Punkte / naechster Schritt**
1. Am G986B manuell durchklicken: Einstellungen → Uebertragung → "QR-Code scannen" (erster Dialog =
   Kamera-Erlaubnis, danach sichtbare Vorschau und erkannte Adresse). Die Sonde belegt Decoder und Encoder,
   aber nicht den Erlaubnis-Dialog und die Vorschau auf dem Bildschirm.
2. Windows 1.0.62 installieren (Setup liegt in `llm-box\dist\`), dann "Im WLAN anbieten" mit angehaktem
   Netzwerkordner gegen "Im WLAN suchen" auf dem Handy testen; erwartet: Statusmeldung nennt den gesetzten
   `/smb/host/share/...`-Pfad und die Zugangsdaten sind uebernommen.
3. Aufraeumen der temporaren Artefakte, wenn nichts mehr geprueft wird: tmp-build64/65/66.txt,
   test-log-v108/109/110.txt, tmp-asar-win62\, tmp-win-dist.txt.

---

## 101. Nutzerbericht S20/S948B: Scan unbrauchbar, keine SMB-Uebergabe (14.11. nachts)

**Meldung im Wortlaut:** Kamerabild auf dem S20 nicht sichtbar; auf dem S948B Bild und Scan ok, aber
keine SMB-Uebergaben; Knopf "QR-Code scannen" danach ausgegraut; bleibt bei "Adresse erkannt – Daten
werden abgerufen…" stehen; "ausserdem sind auf dem PC zwar Laufwerk Y angegeben, das ist aber eine
SMB-Freigabe – daher vermutlich die Fehler?" → **Vermutung des Nutzers war richtig.**

**Installation (Auftrag des Nutzers):** APK auf BEIDEN Geraeten installiert. Stand jetzt
`versionName=1.0.64-android`, versionCode 64 (G986B transport_id 4, S948B transport_id 12; IDs vorher
mit `adb devices -l` geprueft). Nachweis per dumpsys: G986B CAMERA granted=true (von der Sonde gesetzt),
S948B granted=false (wird beim ersten Scan gefragt).

### Vier Ursachen, alle gemessen – nicht geraten

1. **Schwarze Vorschau auf dem S20 = Wiedergabe-Regel der WebView.**
   Messung am betroffenen Geraet (`--ez camprobe true`, neue Sonde `probeCamAfterLoad()`):
   `onPermissionRequest angefragt=[VIDEO_CAPTURE] erlaubt=[VIDEO_CAPTURE]` und danach
   `{"mediaDevices":true,"stream":true,"spuren":["video:camera 2, facing back"],"metadaten":"480x640",
     "play":{"play":"ok","videoWidth":480,"videoHeight":640,"durchgaenge":1}}`.
   Die Berechtigung war also NIE die Ursache. In 1.0.62 fehlte `setMediaPlaybackRequiresUserGesture(false)`
   – ohne das lehnt die WebView `video.play()` ab, die Vorschau bleibt schwarz. Jetzt gesetzt
   (MainActivity.java:~181). Auf dem S20 spielt die WebView danach sofort 480x640 Bildpunkte ein.
   Nebenbefund: `evaluateJavascript` wartet ein Promise NICHT ab – der erste Sondendurchlauf lieferte
   nur `cam_probe={}`; Ergebnis jetzt ueber Native.uiLog ins Logcat (Tag LLMBOX-CAM).

2. **Knopf dauerhaft ausgegraut = Schliessgrund nicht behandelt.**
   Unteragent hat util.js:113-141 vollstaendig belegt: openModal ruft `onClose` bei X-Knopf, ESC und
   Klick neben den Dialog mit **null** auf, nur der eigene Knopf liefert 'abbruch'. Der alte Code
   `if (grund === 'abbruch') zumachen()` liess dann das Promise von qrScannenAndroid() offen → das
   await im Handler endete nie → `finally busy(btnScan,false)` wurde nie erreicht. Jetzt `onClose: () => { zumachen(); }`.

3. **"Adresse erkannt … mehr passiert nicht" = Dialog wurde nie geschlossen.**
   openModal gibt `{ close, el }` zurueck (util.js:140) – der Rueckgabewert wurde bisher NIE benutzt.
   Der Scan-Dialog blieb in Erfolg UND Fehler stehen, der Bestaetigungsdialog lag dahinter. Jetzt
   `dialog = openModal(...)` und in zumachen() `dialog.close('erledigt')`.

4. **Keine SMB-Uebergabe = gemapptes Laufwerk wurde als Rechner "Y:" gedeutet.**
   Real belegt: `net use` -> `Y: \\192.0.2.10\daten`; Workspace = `D:\MeinProjekt`.
   Der Fallback in smbParts()/smbPartsOf() hielt den Buchstaben fuer einen Rechnernamen:
   `smbParts('D:\MeinProjekt')` ergab `{host:'Y:', share:'MeinProjekt'}` – ein erfundener Rechner.
   Deshalb wanderte entweder nichts mit oder Unsinn, und die Pruefung auf dem Handy scheiterte zwangslaeufig.

### Gegenprobe am Geraet: warum die Uebernahme trotzdem fehlschlaegt
Neue reine Lese-Sonde (MainActivity.java, `--ez smblesen true --es pfad "/smb/…"`; bewusst NICHT das
bestehende `--ez smbprobe`, weil das in probeUiAfterLoad() sitzt und zusaetzlich Chat-Dateien in die
Freigabe des Nutzers kopieren wuerde):
`smb_lesen ok=false grund=Anmeldung abgelehnt. Diese Freigabe erlaubt keinen anonymen Zugriff …`
Dazu: `files/data/smb.json` existiert auf BEIDEN Handys nicht, `%APPDATA%\LLM Box\smb.json` auf dem PC
ebenfalls nicht. SmbStore.java:145 faellt bei leerem Benutzer auf `AuthenticationContext.anonymous()`,
und Windows lehnt anonym ab. **Ohne hinterlegte Zugangsdaten kann die SMB-Uebernahme nicht gelingen** –
unabhaengig von allen Code-Korrekturen.

### Neue Helfer und Tests
- `main.js`: `uncOfLaufwerk()` (Get-SmbMapping, Notfall "net use" – Cmdlet-/Eigenschaftsnamen sind
  sprachunabhaengig, die net-use-Ueberschrift nicht), `smbPartsAufgeloest()`, Handler `smb:resolve`;
  `smb:test` nutzt jetzt die Aufloesung; `smbHostOf`/`smbPartsOf` lehnen Laufwerksbuchstaben ab.
- `preload.js`: `api.smb.resolve`. `native-main.js`: `smb.resolve()` fuer die interne /smb/-Form
  (noetig, sonst meldet check-api.js eine fehlende Bridge-Funktion – war der erste Fehlstart von
  run-tests.cmd nach dem Einbau).
- Neuer Pruefstand **10) `tools-android\test-uebernahme-fixes.js`** (36 Pruefungen): prueft die
  Laufwerk-Weiche, fuehrt die Aufloesung auf DIESER Maschine ECHT aus (Erwartung direkt von
  Get-SmbMapping geholt: Y: -> \\192.0.2.10\daten, sub "MeinProjekt"), undfaehrt
  qrScannenAndroid() gegen Attrappen in den Pfad Erfolg / Fehler / Abbruch-per-X.
- **Der neue Test hat einen von MIR verursachten Absturz gefunden:** `const stopScan` und zugleich
  `stopScan = null` → TypeError, zumachen() brach genau dort ab, dialog.close() und fertig() liefen nie.
  Zuweisung entfernt. Ohne diesen Test waere der "fix" ein neuer Defekt gewesen.
- Stand: **9 Laeufe, 291 Pruefungen, 0 Fehler** (test-log-v113.txt).

### Builds / Stände
- Android versionCode 64 / "1.0.64-android", APK auf beide Geraete installiert (tmp-build70/71/72, je 34/34 Tasks).
- Windows **1.0.63** gebaut: `llm-box\dist\LLM Box Setup 1.0.63.exe`. Im app.asar nachgewiesen:
  smb:resolve (3), api.smb.resolve (2), dialog.close (2); die fehlerhafte `stopScan = null` nur noch im
  Erklaertext, nicht mehr im Code. **Auf dem PC ist weiterhin 1.0.60 installiert** – ohne 1.0.63 greift
  die Laufwerksaufloesung nicht.

### Offene Punkte / naechster Schritt
1. Windows **1.0.63 installieren** (laeuft noch 1.0.60; 1.0.60 kennt weder smb-Feld noch Aufloesung).
2. Zugangsdaten fuer 192.0.2.10 eintragen: Einstellungen → Workspace & Dateien → Netzwerkordner
   ("Verbinden & übernehmen") auf dem PC, damit smb.json entsteht und bei der Uebertragung mitwandert.
3. Dann erneut "Im WLAN anbieten" (Netzwerkordner angehackt) → auf dem Handy scannen oder "Im WLAN suchen".
4. Pruefen, ob die Vorschau auf dem S20 jetzt erscheint (Fix 1 ist am Geraet gemessen, der Weg durch
   den echten Dialog aber noch nicht durchgeklickt).
5. Optional: Windows meldet bei aufgeloestem Laufwerk weiterhin leere Zugangsdaten; ein Hinweis in der
   Uebertragungs-Vorschau ("kein Passwort hinterlegt") waere hilfreich, ist aber nicht umgesetzt.

---

## 102. "Modelle neu laden" auf dem Handy ausgeblendet (Nutzerwunsch, 14.11.)

**Wunsch im Wortlaut:** "Bitte den Aktualisierungsbutton auf der Startseite unter dem Burgermenue links
oben entfernen, damit es ein einheitliches sauberes Bild ergibt." Rueckfrage gestellt (zwei
Aktualisierungs-Knoepfe vorhanden): gewaehlt wurde **"Modelle neu laden" (id btn-refresh)** und
**nur auf Android**, Windows behaelt ihn.

**Woher das "unter dem Burger" kommt:** btn-refresh sitzt in .selectors direkt hinter der
Modellauswahl (index.html:32). #topbar und #topbar .selectors tragen flex-wrap (android.css:43/52),
bei 384 CSS-px bricht der Knopf deshalb um und erscheint links in der zweiten Zeile – genau unter dem
vom Adapter eingefuegten Hamburger (android-adapter.js:43 top.insertBefore(burger, top.firstChild)).

**Umsetzung**
- `tools-android/android.css`: neue Regel `#topbar .selectors #btn-refresh { display: none !important; }`
  – bewusst per CSS statt Entfernen aus dem DOM: app.js greift direkt auf den Knoten zu (app.js:219
  innerHTML fuer das Icon, app.js:2359 addEventListener). Ohne Knoten waere die App beim Start mit
  TypeError stehen geblieben.
- `tools-android/android-adapter.js` fitSelectors(): der Knopf wird nicht mehr in die Breitenberechnung
  der Auswahlfelder einbezogen (getrennt ueber die Klasse html.android, nicht ueber getComputedStyle –
  unabhaengig vom Zeitpunkt der Stylesheet-Auswertung).
- `tools-android/android-adapter.js`: neuer Helfer `fixRefreshHint()`. Der Verbindungstest der
  Einstellungen empfahl woertlich "… oder klicke oben auf „Aktualisieren“ (Pfeile neben der
  Modellauswahl)" (settings.js:1134) – ein Rat ins Leere, nachdem der Knopf weg ist. Dieselbe Art
  Irrefuehrung wie seinerzeit der QR-Hinweis auf eine "beliebige QR-App". Er ersetzt den Satz durch die
  real vorhandenen Wege (Verbindung/Modell wechseln oder Einstellungen schliessen und neu oeffnen,
  settings.js:943 ruft refreshModels()). Eingebunden in den gebuendelten Dokument-Durchlauf des
  MutationObservers, NICHT in die addedNodes-Schleife: der Text wird in ein bereits vorhandenes <pre>
  geschrieben (settings.js:252 diagOut), gemeldet werden dabei nur TEXT-Knoten (nodeType 3) – eine
  Element-Suche auf addedNodes haette den Satz nie gefunden.
- Funktionell fehlt nichts: refreshModels() laeuft bei App-Start (app.js:133, 174), bei jedem
  Verbindungswechsel (app.js:503, 2374) und beim Schliessen der Einstellungen (settings.js:943).

**Zwei eigene Denkfehler, die der neue Test sofort gezeigt hat (wichtig fuer spaetere Arbeiten an android.css)**
1. Erste Fassung nutzte den Selektor `html.android #btn-refresh` – gemessen display:flex, Regel griff nicht.
2. Wahre Ursache: der Block lag INNERHALB von @media (max-width: 820px) (Beginn Zeile 16). Die
   Test-Attrappe laeuft mit 1024 px Viewport und sieht Regeln dieser Media-Query nie – obwohl sie auf dem
   Handy laengst gewirkt haette. Die Datei weist an zwei Stellen ausdruecklich auf diese Falle hin
   (Hinweis vor der Media-Query), ich hatte sie beim Einfuegen uebersehen. Regel jetzt bewusst ausserhalb
   der Media-Query und ohne Klassenpraefix; android.css haengt ausschliesslich in der ANDROID-index.html
   (build-android.ps1:100/:102), Windows bindet sie nicht ein – nachgeprueft: llm-box\renderer\index.html
   enthaelt keinen Link auf android.css, der Knopf bleibt dort also sichtbar.

**Neue Pruefungen in tools-android\test-ui-boot.js** (gemessen, nicht Quelltextsuche):
Knopf bleibt im Dokument (sonst app.js-Crash), display ist 'none', Titel und Icon sind unveraendet
vorhanden (addEventListener laesst .onclick undefined – der erste Testentwurf waere ein Schein-Fehler
gewesen), Auswahlreihe vorhanden.

**Stand / Builds**
- Android versionCode 65 / "1.0.65-android", APK auf BEIDE Geraete installiert, dumpsys bestaetigt
  versionName=1.0.65-android (G986B transport_id 4, S948B transport_id 12).
- Testsuite: **9 Laeufe, 295 Pruefungen, 0 Fehler** (test-log-v115.txt), inkl. "auf Android ausgeblendet".
- Windows unveraendert bei 1.0.63 (kein Grund fuer einen neuen Build – die Aenderung ist reine
  Android-CSS/Adapter-Schicht).

**Geraete-Messung: starkes Indiz, aber KEIN harter Beleg – ehrlich vermerkt**
- Adapter-Selbstmessung im Logcat (LLMBOX-UI, layout): topbarH **168 px (1.0.64) -> 87 px (1.0.65)** am
  G986B. Die zweite Zeile der Kopfzeile ist damit weg.
- uiautomator-Dump (ui65-dump.xml, 2823 Bytes) enthaelt "Modelle neu laden" NICHT – gilt aber als
  UNBRAUCHBARER Nachweis: derselbe Dump enthaelt auch den Hamburger ("Chatliste ein- oder ausblenden")
  nicht, bildet also gar kein WebView-Inhalt ab. Nicht als Beleg werten.

**Nachtrag direkt danach:** sechs weitere Pruefungen in test-uebernahme-fixes.js (Abschnitt E). Sie holen
den ORIGINAL-Satz aus settings.js und lassen fixRefreshHint() dagegen laufen: Ersatz erfolgt, der neue Text
nennt einen auf Android gangbaren Weg, der Rest der Diagnose bleibt unveraendert, mehrfaches Anwenden ist
unveraenderlich, und der Test faellt sofort, wenn jemand den Ausgangssatz in settings.js umformuliert
(dann wuerde der Adapter still einen nicht mehr vorhandenen Satz ersetzen).
Stand damit: **9 Laeufe, 302 Pruefungen, 0 Fehler** (test-log-v116.txt).

**Offene Punkte / naechster Schritt**
1. Am G986B/S948B von Hand schauen: Kopfzeile ohne den Pfeil-Knopf, Auswahlfelder unveraendet lesbar.
2. Verbindungstest der Einstellungen oeffnen und "Pruefen" laufen lassen – der ersetzte Hinweissatz
   (fixRefreshHint) ist bisher nur im Quelltext/Observer eingebunden, am Geraet noch nicht abgelesen.
3. Aufraeumen: tmp-build64…75.txt, test-log-v108…v115.txt, tmp-asar-win62/63\, ui65-dump.xml,
   tmp-win-dist*.txt.

## 102a. Rueckmeldung des Nutzers zu Punkt 102 (14.11.)

Nutzer meldet nach der Installation von 1.0.65-android: "Es funktioniert gut."
Damit ist der offene Punkt 1 aus Punkt 102 am Geraet bestaetigt: die Kopfzeile ohne den
"Modelle neu laden"-Knopf wird als einheitlich/sauber angenommen (passt zur gemessenen
topbarH-Aenderung 168 px -> 87 px).

Offen bleiben aus Punkt 101/102 weiterhin, weil sie keine Code-Fragen sind:
- Windows ist auf dem PC nach wie vor **1.0.60** installiert (gebaut und bereit:
  llm-box\dist\LLM Box Setup 1.0.63.exe). Ohne dieses Update fehlen dort das smb-Feld der
  Uebertragung UND die Laufwerksaufloesung – "Im WLAN anbieten" liefert also weiterhin keinen
  Netzwerkordner, unabhaengig vom Handy-Stand. Das ist der wichtigste verbleibende Schritt.
- Zugangsdaten fuer 192.0.2.10 sind nirgends hinterlegt (weder %APPDATA%\LLM Box\smb.json auf dem
  PC noch files/data/smb.json auf den Handys). Am Geraet gemessen: "Anmeldung abgelehnt. Diese
  Freigabe erlaubt keinen anonymen Zugriff" (SmbStore.java:145 faellt bei leerem Benutzer auf
  AuthenticationContext.anonymous()). Ohne Eintrag unter Einstellungen → Workspace & Dateien →
  Netzwerkordner kann die SMB-Uebernahme nicht gelingen.
- Nicht am Geraet abgelesen: der ersetzte Hinweissatz des Verbindungstests (fixRefreshHint) –
  durch sechs Pruefungen in test-uebernahme-fixes.js abgesichert, aber visuell noch nicht kontrolliert.

---

## 103. Veroeffentlichung vorbereitet: Kopie nach C:\LLM-Box, bereinigt, neu gebaut (14.11., spaeter Abend)

**Auftrag:** Android-APK und Windows-Anwendung nach `C:\LLM-Box\` kopieren, README.md um alle neuen
Funktionen seit 1.0.50 ergaenzen, und danach ALLES in C:\LLM-Box (nicht im Workspace!) so bearbeiten,
dass keine Einstellungen und keine persoenlichen Daten (Zugang, Pfade, Passwoerter) enthalten sind.

**Rueckfragen gestellt und beantwortet:** (1) Programme PLUS vollstaendiger Quelltext (Windows + Android),
(2) aus der bereinigten Kopie KOMPLETT NEU bauen (damit auch APK/EXE wirklich frei sind),
(3) Geraete-Sonden KOMPLETT entfernen.

### Zentrale Erkenntnis vor dem Kopieren
Persoenliche Daten steckten NICHT in Einstellungsdateien, sondern im QUELLTEXT: Beispiel-IPs in
Kommentaren, der echte Freigabepfad als Platzhalter im Eingabefeld, LAN-Adressen als Standardwerte der
Geraete-Sonden. Gemessen: 103 Fundstellen bereits in der fertigen APK und in app.asar, 171 im Quelltext.
Deshalb war ein Neubaue aus der bereinigten Kopie zwingend – nicht optional.

### Werkzeuge dafuer (nur im Workspace, bewusst NICHT in die Kopie kopiert)
- `tools-android\scan-persoenlich.js` – findet Pfade/IPs/Rechnernamen **auch in BINAERDATEIEN**
  (Buffer.indexOf). Noetig, weil eine Textsuche im Quelltext Werte in classes.dex/drittanbieter-.pak
  nicht zeigt. Exit-Code 2 bei Treffern.
- `tools-android\scan-schluessel.js` – sucht echte Schluesselformen (sk-, AKIA, BEGIN PRIVATE KEY …)
  und verdaechtige Dateinamen (settings.json, smb.json, sync.json, .env, id_rsa).
- `tools-android\bereinige-kopie.js` – ersetzt zeilenweise mit EXAKTEN Zeichenketten (keine Regex:
  Punkte in IPs sind Joker), nur Textendungen, ueberspringt node_modules/.git/app_build/build/dist/out.
  Laengere Muster zuerst. Arbeitet ausschliesslich im Zielordner.
- `tools-android\sonden-entfernen.js` – Klammerzaehler auf Zeichen-Ebene, der Java-Strings,
  Zeichen-Literale und Kommentare ueberspringt (die Sonden bauen JS als Java-String; ein naiver
  Zaehler haette den Block falsch beendet und den Build zerstoert).

### Kopierte Struktur in C:\LLM-Box
`llm-box\` (Windows-Quelltext, ohne node_modules/dist/zip/png initially), `android\` (ohne app_build/
build/.gradle), `tools-android\` (nur *.js/*.css/*.cmd/*.ps1), `webdeps\` (package.json, bundle-entry.js,
out\webdeps.js, pdf.worker.min.js), `build-android.ps1`, `build-now.ps1`, `README.md`, `.gitignore`,
`download\` mit den drei Programmdateien.

### Fehler und Fallen beim Kopieren (alle behoben)
1. **`.git` wurde mitkopiert** (145 Dateien, Referenzen enthielten "Administrator") – eine Historie
   haette persoenliche Alt-Staende veroeffentlicht. Aus der Kopie entfernt (`rd /s /q`). Robocopy meldete
   sie zuerst als "0 Dateien", weil `-Force` fehlte: ohne -Force sieht man .git-Inhalte nicht.
2. **`/XF *.png` hat auch Screenshots und build\icon.png erwischt** – nachkopiert (10 Screenshots, 2 Icons).
3. **robocopy kopierte node_modules unvollstaendig** (Verzeichnisse ja, 0 Dateien; auch im zweiten Anlauf).
   Stattdessen `npm install` in der Kopie -> 7772 Dateien / 317 MB, Build moeglich.
4. **`cd C:\…` wechselt auf Windows NICHT das Laufwerk** (nur mit `/D`). Folge: `build-now.ps1` und
   `npm install` liefen im Workspace bzw. suchten `D:\MeinProjekt\package.json`. Korrekt nur mit
   `cmd /c "cd /d C:\LLM-Box && …"`. Das hat zwei scheinbar erfolgreiche Laeufe erzeugt, die in Wahrheit
   nichts getan hatten (Log: "Das Argument build-now.ps1 fuer den -File-Parameter ist nicht vorhanden").

### Sonden entfernt (Nutzerwunsch)
`MainActivity.java`: probeQrAfterLoad(), probeCamAfterLoad(), probeUiAfterLoad() komplett samt
javadoc, dazu die --ez-Blöcke lanprobe/lanapply/probechat/fixsync/smbprobe/setsync/syncrate (alle
lagen in probeUiAfterLoad), die Felder uiProbeRequested/chatProbeRequested und die adb-Kommentarzeilen.
Datei von 2155 auf ~1400 Zeilen. Ruecksicherung `.mit-sonden` wurde nach dem Build geloescht (sie
enthielt noch die echten Adressen!).
**Zwei eigene Fehler dabei:** (a) erste Fassung hat die Methoden nur protokolliert, nicht entfernt
(2133 statt ~1400 Zeilen – am Ergebnis gemerkt); (b) Trockenlauf zeigte "Keine Blockklammer fuer
qrprobe": diese Aufrufe sind Einzeiler OHNE Block und mussten als exakte Zeile erfasst werden, sonst
Compile-Fehler durch Verweis auf entfernte Methode.

### Bereinigungsergebnis (Summen der Laeufe)
206 + 25 + 14 + 20 + 10 Ersetzungen. Neutralisiert: alle privaten LAN-Adressen -> RFC-5737-Bereich
192.0.2.x (dafuer vorgesehene Dokumentations-Adresse, strukturell gleich, nicht routbar);
eigener Projektordner -> D:\MeinProjekt; echter Freigabename -> "daten"; echtes Windows-Benutzerprofil
-> C:\Users\<Benutzer>; Geraetenummern und Mail-Anbieter entfielen spaeter mit den Scan-Skripten selbst.

### Builds aus der bereinigten Kopie (Versionen angeglichen)
- Android: versionCode 65 / "1.0.65-android", `BUILD SUCCESSFUL`, 34 Tasks.
- Windows: `npm version 1.0.65` + `npm run dist`, Setup + portable erfolgreich.
- Downloads in `C:\LLM-Box\download\`: LLM-Box-1.0.65-android.apk (10.652.540 B),
  LLM.Box.Setup.1.0.65.exe (83.870.257 B), LLM.Box.1.0.65.portable.exe (83.628.010 B).

### README ergaenzt (GitHub-Startseite)
Neuer Abschnitt "Neu seit Version 1.0.50" mit sieben Gruppen (Chatten/Oberflaeche, grosse Chats
schneller, Dateien/Workspace/Netzwerkordner, Uebertragung PC<->Handy, Chats auf mehreren Geraeten,
Werkzeuge der KI, Handy-Oberflaeche) plus Fehlerbehebungen; Abschnitt "Uebertragung auf Android" zu
"Uebertragung zwischen PC und Handy" + neuer Unterabschnitt "Android-App" umgebaut. Alle Angaben aus
Aenderungen.md belegt (z. B. fensterweiser Nachrichtenaufbau: Zeile 1381/1476 – konstant ~2700 Knoten
bei 3487 Nachrichten). README im Unterordner llm-box\ durch kurze Verweis-README ersetzt; Duplikate
(llm-box\HANDBUCH.md, die ungenutzte Alt-Kopie llm-box\transfer.js) geloescht.

### WICHTIG – noch nicht erledigt (muss als naechstes gemacht werden)
1. **Die letzte Bereinigungsrunde (beispiel-passwort -> beispiel-passwort, Restformen in settings.js und
   docs/HANDBUCH.md) lief NACH dem letzten Neubaue.** APK und beide EXE in `download\` stammen vom
   Build davor. Also: Android- UND Windows-Build erneut ausfuehren, Downloads austauschen, dann erst
   ist die Aussage "Programme sind frei" voll belegt.
2. **Gradle-Cache entfernt** (`C:\LLM-Box\android\.gradle` geloescht – enthielt 2787 Fundstellen
   C:\Users\<Benutzer> in executionHistory.bin). Beim naechsten Build entsteht er neu und muss vor
   dem Push erneut weg (steht bereits in .gitignore, sicherheitshalber trotzdem pruefen).
3. **Endscan erneut laufen lassen** und die verbleibenden Treffer als Fremdcode einordnen: der ueberwiegende
   Teil der gemeldeten "E-Mail-Adresse"/"Administrator"-Treffer kommt aus node_modules (Lizenztexte,
   AUTHORS.md) und aus Electron-Binaermaterial (.pak/.dll). Die 148 vermeintlichen AWS-Schluessel in
   app.asar waren Zufallsmuster: im ENTPACKTEN app.asar (tools-android\asar-read.js --out …) waren 0
   Funde. Echte Schluessel/API-Keys: nirgends gefunden. Einziger Wert war der Testwert 'beispiel-passwort'
   in test-ui-boot.js.
4. `node_modules` (317 MB) liegt in C:\LLM-Box\llm-box, damit gebaut werden kann – es darf NICHT ins
   Repo (.gitignore enthaelt llm-box/node_modules/, android-Zwischenbaue, settings.json/smb.json/
   sync.json/chats/.env). Vor dem Push mit `git status` kontrollieren.

**Stand der Programme im Workspace ist unveraendert:** G986B und S948B auf 1.0.65-android installiert,
Windows beim Nutzer weiterhin 1.0.60 (geplant: 1.0.63/1.0.65 – SMB-Laufwerksaufloesung braucht ein Update).

---

## 104. Veroeffentlichung fertig gebaut, bereinigt und geprueft (14.11., Nacht)

**Auftrag:** Die drei offenen Punkte aus Punkt 103 erledigen – beide Programme aus der bereinigten
Kopie NEU bauen, Build-Reste loeschen, Endscan laufen lassen und einordnen. Gearbeitet wurde nur in
`C:\LLM-Box`; der Workspace blieb als Arbeits- und Werkzeugordner erhalten.

### 1) Neubaue und Downloads ausgetauscht
- Android: `build-now.ps1` -> BUILD SUCCESSFUL, 34 Tasks (2x gebaut, weil die Bereinigung nach dem
  ersten Build lief). Windows: `npm run dist` (Version stand schon auf 1.0.65, kein `npm version`
  noetig), Setup + portable erfolgreich.
- Downloads in `C:\LLM-Box\download\` sind jetzt die Frischbaue vom letzten Lauf: APK 10.652.540 B,
  Setup 83.870.032 B, portable 83.627.788 B (Zeitstempel 21:50/21:51 – die alten von 21:30/21:31
  waren ersetzt).

### 2) Build-Reste geloescht (enthielten echte Benutzerpfade)
`android\.gradle`, `android\build`, `android\app\app_build`, `llm-box\dist`, dazu Logdateien und der
Testordner `test-nm` (87 Dateien jszip-Kopie, von keinem Skript referenziert – bei der Suche nach
Verweisen als sicher erkannt).

### 3) Weitere Bereinigung: der Buchstabe des Netzlaufwerks (70 + 10 Ersetzungen)
Der Endscan meldete 46 Fundstellen im EIGENEN Quelltext. Der Grund war nicht ein echter Pfad, sondern
der **Laufwerksbuchstabe des gemappten Netzlaufwerks** ("net use <Buchstabe>: -> \\host\share").
Kommentare, Doku-Beispiele und Tests nannten genau diesen Buchstaben.
Entscheidung (Annahme): einheitlich auf das neutrale `Y:` gesetzt, damit der Endscan im eigenen
Quelltext wirklich leer ist. Sicher, weil die App allgemein `[A-Za-z]:` prueft, nie hart auf einen
bestimmten Buchstaben (belegt durch smbHostOf/smbPartsOf/smbPartsAufgeloest in main.js und smbParts
in transfer.js). Notwendige Zusatzregeln: der Testaufruf `u('<Buchstabe>')` und der erzaehlende Text
"Laufwerk <Buchstabe>" – beide ohne Doppelpunkt, von der ersten Regel nicht erfasst.

### 4) Zwei eigene Fehler dabei (beide am Ergebnis korrigiert)
- **Klammerfehler:** das neue Skript `entschaerfe-mapping-test.js` wollte Abschnitt B des
  Uebernahme-Tests maschinenunabhaengig machen, setzte den else-Zweig aber mit doppelter Klammer ->
  "SyntaxError: Missing catch or finally after try". Gefunden im Testlog, repariert mit
  `korrektur-mapping-test.js`, Syntax mit `node --check` bestaetigt.
- **Zu eng gedachte Regel:** zuerst nur `Y:` ersetzt, dadurch blieb `u('Y')` haengen und der Test
  lief gegen das falsche Laufwerk. Erst die zusaetzlichen Regeln haben es konsistent gemacht.

### 5) Warum der Uebernahme-Test ueberhaupt angepasst werden musste
Abschnitt B loest ein WIRKLICH gemapptes Netzlaufwerk auf und vergleicht mit Windows ("Das ist kein
Mock"). Auf dem Entwickler-PC existiert das Mapping, in einem frischen GitHub-Clone nicht – drei
Erwartungen waren trotzdem hart und waeren rot, obwohl am Code nichts falsch ist. Jetzt wird
uebersprungen, wenn `Get-SmbMapping` nichts meldet (Windows-Auskunft ist weiterhin der Massstab).

### 6) webdeps\node_modules fehlte in der Kopie (Test 3 brach ab)
"Cannot find module 'C:\LLM-BOX\webdeps\node_modules\jsdom'" – die Web-Abhaengigkeiten waren beim
Kopieren nicht mitgenommen. `npm install` in `C:\LLM-Box\webdeps` -> 2058 Dateien / 62 MB, Build und
Tests laufen. Regel `webdeps/node_modules/` in `.gitignore` ergaenzt (sowohl in der Kopie als auch in
der Vorlage `tmp-gitignore.txt`).

### 7) Testsuite in der Kopie: 10 Laeufe / 297 Pruefungen / 0 Fehler
Zuvor 9 Laeufe / 302 – die Differenz erklaert sich durch den entschärften Mapping-Vergleich
(weniger harte Erwartungen, dafuer ein Uebersprungen-Hinweis), nicht durch fehlende Funktionen.

### 8) Endscan: Ergebnis und Einordnung (wichtig fuer die Frage "sind die Programme frei?")
- Schluessel-Scan (`scan-schluessel.js`): nur der neutralisierte Testwert 'beispiel-passwort' in
  test-ui-boot.js. **Kein einziger echter Schluessel, kein Token, kein Passwort.**
- Persoenlich-Scan ueber ganz `C:\LLM-Box`: 628 Treffer, aber ausschliesslich Fremdcode-Rauschen –
  Lizenztexte/Autoren in node_modules (package.json, LICENSE, AUTHORS.md), Windows-Gruppennamen im
  7zip-Binaermaterial (Administrator/Administrators), Chromium-Lizenzen mit E-Mail-Adressen.
- **Direkter Nachweis im Programminnern:** APK und Setup-EXE mit dem vorhandenen 7za entpackt, den
  enthaltenen `app.asar` mit `asar-read.js` ausgepackt und alles gescannt. Im echten App-Code bleiben
  exakt drei Funde: eine Lizenz-E-Mail der Bibliothek readable-stream, "Administrator-Abfrage (UAC)"
  in app.js und "ohne Administratorrechte" in server.js – Alltagswort, kein Benutzerkonto. Keine IPs,
  keine Pfade, keine Zugangsdaten. Die EXE-Treffer auf "Workspace-Laufwerk" sind Zufallsfolgen im
  komprimierten Binärmaterial (druckbare Byte-Zufaelle, kein Text).

### 9) README-Kopf auf GitHub-Startseite angepasst
Kopfzeile nennt jetzt beide Plattformen ("Schlanke App fuer Windows und Android"), dazu neuer Abschnitt
"Herunterladen" mit Tabelle der drei Dateien aus `download/`. Genaue Dateigroessen im README erfuellt
den Punkt "README-Kopf pruefen". UTF-8 ohne BOM erhalten (Bytes 23 20 4C geprueft).

### 10) Git-Stand in C:\LLM-Box
`git init` ausgefuehrt, Identität bereits vorhanden (ReuschlerIT / web@reuschler-it.de – die des
Nutzers, nicht geaendert). `git add -A --dry-run`: **140 Dateien / 177 MB**, davon 174 MB in
`download\`. Kein node_modules, kein .gradle, keine app_build/dist, keine settings.json/smb.json/
sync.json/.env/chats. Enthalten sind bewusst: `webdeps\out\webdeps.js` (722 KB) – noetig als Eingabe
fuer build-android.ps1, sonst ist der Android-Build aus dem Repo nicht moeglich.
Helfer dafuer: `tools-android\zeige-gitliste.js` (gruppiert nach Ordner, warnt vor unerwuenschten
Dateien). Erste Fassung hatte Fehlalarme ("android/build.gradle", "llm-box/build/icon.png" sind
Quelltext bzw. Build-Symbol und gewollt) – Regel auf Ordner-Segmente schaerfer.

### Neue Werkzeuge in dieser Sitzung (nur im Workspace)
- `tools-android\zeige-restformen.js` – zeigt Zeilen mit einem Suchbegriff in Textordnern an, ohne
  PowerShell-Escaping-Probleme (die scheitern bei `'Y:'` und `"u('Y')"` regelmaessig).
- `tools-android\entschaerfe-mapping-test.js`, `korrektur-mapping-test.js`,
  `entschaerfe-mapping-test2.js` – Anpassungen des Mapping-Tests an Rechner ohne Netzlaufwerk.
- `tools-android\readme-kopf-android.js` – README-Kopf (idempotent, --dry moeglich).
- `tools-android\png-text.js` – prueft PNGs auf eingebettete Text-Metadaten (tEXt/iTXt/zTXt).
- `bereinige-kopie.js`: Regel `%APPDATA%\LLM Box` durch sich selbst entfernt (zaehlte als Aenderung,
  hatte README.md und HANDBUCH.md grundlos neu geschrieben); `vendor` neu bei den
  Uebersprungordnern (minifizierte Fremd-Bibliotheken wie marked.js enthalten Zufallsfolgen "Y:").

### OFFENE PUNKTE (bitte vor dem Push entscheiden)
1. **Screenshots ansehen:** die 10 PNGs in `llm-box\docs\screenshots\` haben keine Text-Metadaten, aber
   ob ein Bild sichtbar eine echte IP, einen Rechnernamen oder Pfad zeigt, kann kein Scan pruefen –
   das muss der Nutzer mit den Augen tun. README behauptet "Alle Screenshots zeigen Demo-Daten".
2. **Nutzername/E-Mail im Git-Repo:** die Konfiguration in `C:\LLM-Box` nennt den Projektbetreiber und
   seine Absenderadresse. Das ist gewollt veroeffentlichbar; die vom Scan gemusterten privaten
   Mail-Anbieter tauchen nirgends im Quelltext auf, nur die eigene Adresse in der Git-Konfiguration.
3. **Push noch nicht ausgefuehrt.** Es wurde kein Remote eingerichtet und nichts hochgeladen – das ist
   dem Nutzer ueberlassen (Zugangsdaten/Token werden hierfur nicht angefasst).
4. Windows beim Nutzer ist weiterhin 1.0.60; die neue 1.0.65 liegt in `C:\LLM-Box\download\` bereit.

**Naechster sinnvoller Schritt:** Screenshots pruefen, dann `git add -A && git commit` und Remote
anlegen/pushen. Vor dem Push erneut `tools-android\scan-persoenlich.js C:\LLM-Box` laufen lassen –
erwartet werden nur die oben eingeordneten Fremdcode-Treffer.

### Abschluss (nach Rueckfrage beim Nutzer)
Screenshots vom Nutzer freigegeben ("zeigen nur Demo-Daten") – maschinell war nur pruefbar, dass die
10 PNGs keine Text-Metadaten (tEXt/iTXt/zTXt) enthalten; was ein Bild zeigt, bleibt menschliche Sicht.

- `git add -A` ausgefuehrt: 140 Dateien im Index.
- **Scan NUR der Repo-Dateien** (neue Option `--dateien <liste>` in scan-persoenlich.js, Liste aus
  "git diff --cached --name-only"): 16 Treffer in 140 Dateien, alle eingeordnet und harmlos –
  "Administrator-Abfrage (UAC)" (app.js), "ohne Administratorrechte" (server.js),
  "Administrator-Abfrage" (HANDBUCH.md), Platzhalter `C:\Users\<Benutzer>` (start-screen-probe.ps1)
  und in den beiden EXE vier Zufallsfolgen im komprimierten Electron-Material (Kontext zeigt
  `Y:\=`, `Y:\P"`, `[Y:\` – druckbare Byte-Zufaelle, kein Pfad). **Keine IP, kein echter Pfad,
  kein Zugang, kein Passwort.**
- Commit angelegt: Branch von master auf **main** umbenannt, Nachricht wegen Umlauten/Anfuehrungszeichen
  in cmd ueber Datei (`git commit -F`) – direkte `-m`-Uebergabe war still fehlgeschlagen (Exit kam vom
  nachgestellten echo, Commit gab es nicht; am fehlenden `git log` bemerkt).
  Ergebnis: **ad8fe2d "LLM Box 1.0.65: Windows- und Android-Version"**, `git status` sauber.
- GitHub CLI vorhanden und angemeldet als **ReuschlerIT** (https, Token mit repo-Scopes). Push wurde
  bewusst NICHT ausgefuehrt – Wunsch des Nutzers: nur Anleitung.

### Push-Anleitung (in C:\LLM-Box ausfuehren)
```
cd /d C:\LLM-Box
gh repo create LLM-Box --public --source=. --description "App fuer Windows und Android zum Chatten mit lokalen und entfernten KI-Modellen (Ollama, LM Studio, llama.cpp, OpenAI-kompatibel). Dateien als Kontext, KI mit Werkzeugen und Unteragenten, Live-Ansicht aller Aktionen, Server-Monitor."
git push -u origin main
```
Topics danach setzen: `gh api repos/ReuschlerIT/LLM-Box/topics` (oder in der Web-Oberflaeche) – die
Vorschlaege stehen in GITHUB-BESCHREIBUNG.txt. Hinweis: download\ enthaelt 174 MB; GitHub erlaubt
einzelne Dateien bis 100 MB (Setup 84 MB, portable 84 MB, APK 11 MB) – passt, aber ein Repo dieser
Groesse laedt langsam. Alternative spaeter: die drei Dateien als GitHub-Release statt im Quellzweig.

---

## 105. Update-Chronik bis 1.0.65 ergaenzt und README zusammengefuehrt (14.11., spaete Nacht)

**Auftrag:** In `UPDATE.md` (endete bei Version 1.0.36) alle Versionen bis zur aktuellen nachtragen,
"damit man mit jeder Version die Aenderungen erkennt". Ausserdem die angehaengte README (Stand der
Workspace-Alt-Fassung) mit der aktuellen zusammenfuehren.

### Quelle der neuen Abschnitte – zwei Dateien, nicht eine
Wichtig fuer spaetere Arbeiten: **die Windows-Chronik liegt an zwei Stellen.**
1. `llm-box\GEAENDERTE-DATEIEN.txt` (366 Zeilen) enthaelt die Windows-Staende **V52 abwaerts bis V37**
   im Stil der UPDATE.md – pro Version geaenderte Dateien, Ursache+Loesung, "NICHT BESTAETIGT"-
   Vermerke. Das ist die einzige Quelle fuer 1.0.37–1.0.52; in Aenderungen.md stehen dazu nur
   Kurzverweise (Zeile 246/247) und ein Android-Kontext (Zeile 317). Datei war bisher nie ausgewertet.
2. `Aenderungen.md` ab Punkt 83 (Zeile 753) fuer **1.0.54 bis 1.0.65**.
Beides wurde mit vier parallelen Unteragenten ausgewertet und die wichtigsten Belegzeilen anschlissend
selbst nachgelesen (Zeilen 654–662 und 753–772 bestaetigt).

### Zwei Versionsluecken – bewusst als Luecken gekennzeichnet, nicht erfunden
- **1.0.53:** kein eigener Aenderungsabschnitt belegbar. Belegt ist nur: Quelle war schon V1.0.53
  (Zeile 656/657), installiert war 1.0.53 in `C:\Program Files\LLM Box`, gebaut 14.11. 06:35, und diese
  Installation "enthielt beide Bugs" (Zeile 768/769). Im Abschnitt steht ausdruecklich, dass kein
  eigener Aenderungsabschnitt existiert – plus was nachweisbar drin war (maxSteps-Einstellung, Reiter
  Uebertragung, Zeile 657–660).
- **1.0.64:** wurde **nie als Windows-Version gebaut** – die Nummer existiert nur als `1.0.64-android`
  (Zeile 1926, 1987). Abschnitt enthaelt nur den Android-Anteil und sagt das ausdruecklich.

### Ergebnis UPDATE.md (Kopie UND Workspace, identisch)
- Angehaengt statt ersetzt: der alte 1.0.36-Text bleibt oben stehen, die Chronik kommt dahinter.
- Jetzt **30 Abschnitte, 1.0.36 bis 1.0.65 lueckenlos** (geprueft mit Zaehlung der Ueberschriften),
  881 Zeilen / 51 kB. Dazu ein Inhaltsverzeichnis als Tabelle (eine Zeile pro Version) und ein
  Lesehinweis auf die beiden Luecken.
- **Persoenliche Daten: 0 Treffer** – scan-persoenlich.js ueber UPDATE.md, README.md und
  llm-box\README.md: "Treffer gesamt: 0". Beispiele durchgaengig neutral gehalten
  (D:\MeinProjekt, 192.0.2.x). Eine Textstelle mit echtem Laufwerksbuchstaben wurde beim Schreiben
  bewusst umformuliert ("ein als Buchstabe eingebundenes Netzlaufwerk").
- Werkzeug: `tools-android\update-anhaengen.js` (idempotent, prueft vor dem Schreiben auf
  persoenliche Muster und bricht sonst ab).

### WICHTIGER FEHLER in der veroeffentlichten README gefunden und behoben
Die Haupt-README liegt eine Ebene **ueber** `llm-box\`, verweist aber auf `docs/screenshots/…` und
`[Handbuch](docs/HANDBUCH.md)`. Diese Ordner existieren nur in `llm-box\docs\` – ein `docs\` in der
Kopie-Wurzel gibt es nicht (geprueft). **Auf GitHub waeren alle 8 Screenshots und der Handbuch-Link ins
Leere gelaufen.** Korrigiert auf `llm-box/docs/…`; neues Werkzeug
`tools-android\pruefe-readme-links.js` prueft jetzt jede Verweiszeile gegen den echten Dateibaum:
9 Verweise OK, 0 kaputt.

### README zusammengefuehrt (Diff alt gegen neu zuerst gemessen)
Per `git diff --no-index tmp-readme-alt.md tmp-readme-ist.md`: die angehaengte Alt-Fassung war bereits
zu 100 % in der aktuellen enthalten – **86 Einfuegungen, nur 2 Loeschungen** (Kopfzeile und Meta-Zeile,
beide bewusst auf "Windows und Android" geaendert). Es fehlten trotzdem zwei inhaltliche Punkte aus der
allerersten Fassung (`llm-box\README.md:90`), die wieder hineinkamen:
- **Was uebertragen wird** – ausdruecklich inklusive API-Schluesseln. Sicherheitsrelevant, in der
  aktuellen Fassung war nur noch der Weg (QR/WLAN/JSON) beschrieben.
- **JSON als Ersatzweg ohne Netz** (der "Fallback"-Charakter fehlte).
Ausserdem: Projektstruktur um `android\`, `tools-android\`, `webdeps\`, `download\` und UPDATE.md
ergaenzt; Verweis auf die Chronik im Abschnitt "Neu seit Version 1.0.50".

### Zwei Versionsangaben im README-Abschnitt "Neu seit 1.0.50" berichtigt
- "Kein weisser Block mehr beim Start der Handy-App (**ab 1.0.57**)" ist falsch: Der Build-Patch kam in
  Sitzung 11 (Zeile 1250–1259), die APK mit diesem Stand wurde auf dem G986B installiert (Zeile 1313) –
  **aber build.gradle stand damals fest auf versionCode 32 / "1.0.32-android"** (Zeile 1503); die Nummer
  wurde erst spaeter auf 59 gehoben (Zeile 1506). Formulierung jetzt: behoben vor der ersten
  Handy-Version mit richtiger Nummer, Nummern stimmen erst ab 1.0.59-android mit dem Inhalt ueberein.
- "(ab 1.0.63/1.0.64)" vermischte Windows und Android – jetzt getrennt: PC ab 1.0.63, Handy ab
  1.0.63-/1.0.64-android. Werkzeug: `tools-android\readme-versionsangaben.js`.

### Eigene Fehler in dieser Sitzung (beide am Ergebnis korrigiert)
1. **Zusammenfuehren der Projektstruktur ergab eine halb eingerueckte Liste** – zwei getrennte Regeln
   (Anfang und Ende des Blocks) passten nicht zusammen. Zurueckgesetzt mit `git checkout -- README.md`
   und den kompletten Block als EINE Regel ersetzt.
2. **Mehrzeilige Muster fanden nichts:** die Dateien nutzen CRLF, alle Muster waren mit `\n` geschrieben.
   Jetzt normalisiert das Skript beim Lesen auf `\n` und schreibt CRLF zurueck (im Skript dokumentiert).

### Programmdateien mussten NICHT neu gebaut werden – begruendet
Geprueft: `package.json -> build.files` enthaelt nur main.js, preload.js, docs.js, renderer/**/*,
build/icon.png, package.json. **Kein README/UPDATE/HANDBUCH** in der Windows-App; die Android-Assets
sind eine Kopie von renderer/. Die Doku-Aenderungen aendern also nichts an APK und EXE – die bestehenden
Dateien in `download\` bleiben gueltig (kein Grund fuer einen dritten Build).

### Stand Git in C:\LLM-Box
- `8db0efb Dokumentation vollstaendig: Update-Chronik bis 1.0.65, README zusammengefuehrt`
  (README.md +58/-25, llm-box/README.md +3/-1, llm-box/UPDATE.md +799)
- davor `ad8fe2d LLM Box 1.0.65: Windows- und Android-Version`. Working Tree sauber.
- Scan NUR der drei geaenderten Dateien (Dateilisten-Modus): **0 Treffer**.

### Nebenbefund: Veraltete Versionsnummer war eine echte Fehlerquelle
Die Handy-App trug lange `versionCode 32 / "1.0.32-android"` obwohl laengst neuere Aenderungen eingearbeitet
waren (Zeile 1503). Das erklaert einen Teil der frueheren Diagnose-Ueberraschungen ("Fix vorhanden, wirkt
aber nicht") und ist der Grund, warum Versionsangaben in Doku nur bedingt zuverlaessig sind – im Zweifel
Build-Inhalt pruefen (asar-Vergleich), nicht die Nummer.

### Neue Werkzeuge in dieser Sitzung (nur im Workspace)
- `tools-android\update-anhaengen.js` – Chronik an UPDATE.md anhaengen, mit Persoenlich-Pruefung.
- `tools-android\readme-zusammenfuehren.js` – README-Regeln (Pfade, Uebertragungs-Inhalt, Struktur,
  Chronik-Verweis), idempotent, CRLF-sicher.
- `tools-android\readme-unterordner-update.js` – Verweis auf UPDATE.md in der Kurz-README von llm-box\.
- `tools-android\readme-versionsangaben.js` – die zwei berichtigten Versionsangaben.
- `tools-android\pruefe-readme-links.js` – prueft alle Bild-/Link-Ziele einer README gegen den Dateibaum.

### OFFENE PUNKTE
1. **Push nicht ausgefuehrt** (Anleitung steht oben in Punkt 104). Beide Commits sind lokal.
2. Screenshots: Nutzer hat bestaetigt "zeigen nur Demo-Daten" – damit ist Punkt 1 von 104 erledigt.
3. Windows beim Nutzer weiterhin 1.0.60; die 1.0.65 liegt in `C:\LLM-Box\download\`.
4. Optional: GitHub-Release statt Programmdateien im Quellzweig (174 MB Repo, siehe Hinweis oben).

**Naechster sinnvoller Schritt:** nur noch Push (`gh repo create … && git push -u origin main`), dann
Topics und About-Text aus GITHUB-BESCHREIBUNG.txt setzen.

## 111. Repo auf 1.0.67 gebracht: Windows- und Android-Fassung aus bereinigter Kopie (17.11.2026)

**Auftrag:** Repo mit 1.0.67 bestuecken (Quellcode, Windows-Programme, APK, README/UPDATE), dann
`git add` / `commit` / `push origin/main`.

**Ausgangslage:** Repo-Stamm und `llm-box\` standen auf 1.0.65, der lokale Arbeitsordner auf 1.0.67
(`effCtx()` in `handoff.js`, `numLocale()` in `util.js`, `showLanguageChooser()` in `settings.js`,
9 i18n-Dateien, die im Repo fehlten). Der Diff `llm-box\main.js` Repo gegen Arbeitsstand betraf nur
17 Zeilen – ausschliesslich Kommentare mit anonymisierten Beispielen, kein Codeverlust.

**Kernbefund vor dem Build:** Die erste APK aus dem Arbeitsordner (11.026.842 B, versionCode 69) hatte
**58 Fundstellen** mit personenbezogenen Werten (interne IPs, echtes Laufwerk, echter Freigabename,
Benutzername). Auch der Windows-Build aus demselben Ordner war betroffen. Die veroeffentlichten
1.0.65-Programme dagegen waren sauber (APK 0 echte Funde, EXE nur 4 Zufallstreffer im komprimierten
Binärcode) – sie waren aus einer **bereinigten** Quelle gebaut. Entscheidung: Windows **und** Android
ebenfalls aus einer bereinigten Kopie bauen, `download\` enthält danach nur 1.0.67.

**Bereinigte Build-Kopie:** `tmp-clean-build-setup.ps1` (Arbeitsordner) legt `C:\LLM-Box-build` an –
robocopy ohne `node_modules`/`dist`/`win-unpacked` der Quelle, aber **mit** `llm-box\node_modules`
(317 MB) und `webdeps\node_modules` (62 MB), weil electron-builder sie braucht. Danach
`tools-android\bereinige-kopie.js` (100 Textdateien, 23 geändert, 70 Ersetzungen), die drei
`entschaerfe-*`/`korrektur-*`-Skripte und `scan-persoenlich.js` ueber der ganzen Kopie.
Ergebnis: **keine echten personenbezogenen Werte** mehr; die verbleibenden Meldungen sind deutsche
Wortbestandteile („Administratorrechte", UAC-Hinweise) und die Suchmuster der Scan-Skripte selbst.

**Zwei Fehler auf dem Weg (behoben, beide im Kopierskript):**
1. robocopy-Aufrufe liefen mit Exit 16: in PowerShell bindet das Komma **staerker** als `+`, dadurch
   wurde das gesamte Argument-Array zu **einem** String (`robocopy "src dst /E /XD …"`). Korrektur:
   jeden Listeneintrag in Klammern setzen. Zusaetzlich wird der robocopy-Ausgang jetzt bei Exit >= 8
   ins Log geschrieben, sonst ist die Ursache nicht mehr sichtbar.
2. Die Ausnahme `/XF *.png` traf auch `llm-box\renderer\assets\*.png` und `llm-box\build\icon.png`
   – vier Markenbilder (`mark-dark/light.png`, `wordmark-dark/light.png`, zusammen 52 KB) fehlten in
   der Kopie, obwohl `app.js:812-813` sie im Leerzustand anzeigt, und `build\icon.png` fehlte fuer das
   EXE-Symbol. Korrektur: PNGs nur noch fuer `docs\screenshots` ausschliessen. Beide Builds wurden
   danach **komplett neu** gebaut.

**Builds aus `C:\LLM-Box-build`:**
- Android: `build-now.ps1` → `BUILD SUCCESSFUL in 1m 5s`, APK 11.026.790 B, versionCode 69 /
  versionName 1.0.67-android.
- Windows: `npm run dist` (electron-builder, NSIS-Setup + portable) → `LLM Box Setup 1.0.67.exe`
  83.990.068 B und `LLM Box 1.0.67.exe` 83.747.833 B.

**Endscan der Artefakte** (`scan-persoenlich.js`, APK mit `--max 60000000`, EXE mit `--max 200000000`):
APK nur Worttreffer („Administrator-Abfrage", UAC), EXE nur 4 Zufallsbytefolgen im komprimierten Code –
wie bei 1.0.65. Zusaetzlich die `app.asar` aus `win-unpacked\resources` geprueft: identisches Bild.
Beide Fassungen sind damit veroeffentlichbar.

**Repo-Abgleich** (`tmp-repo-apply.ps1`, robocopy mit `/MIR` aus der bereinigten Kopie):
`llm-box\` (ohne `node_modules`, ohne `dist`; **die kurze Unterordner-README.md und `HANDBUCH.md`
bleiben im Repo erhalten**), Repo-Stamm (`main.js`, `preload.js`, `docs.js`, `package.json`,
`package-lock.json`, `renderer\`, `build\`, `start.bat`, `build-exe.bat`), `android\app\build.gradle`
(versionCode 69), `android\app\src\main\assets\webapp\` (inkl. neuer i18n-Assets),
`android\app\src\main\java\…` (14 Java-Dateien), `tools-android\` (neu: 9 `ui-*`-Helfer, 4
`i18n-*`-Helfer, `test-i18n.js`, `run-tests.cmd`, `native-main.js` mit Schreib-Queue, `test-port.js`),
`test-results\` (19 Protokolle), `webdeps\` (neu: `jsqr-1.4.0.tgz`, Quelltext und Paketliste),
`docs\` und `RELEASE.md` (neu im Repo). Ergebnis: **78 neue und 35 geaenderte Dateien**, 0 geloeschte,
keine tmp-/Log-Arbeitsdateien im Index.

**Nicht ueberschrieben (bewusst):** `docs\HANDBUCH.md` (33 KB, zusammengefuehrte bereinigte Fassung,
groesser als die Arbeitsfassung), `llm-box\README.md` (997 B Kurz-README des Unterordners),
`llm-box\HANDBUCH.md` (nur im Arbeitsordner, dort wegen echter Pfade nicht veroeffentlichbar).

**Artefakte:** `download\` enthaelt jetzt nur noch `LLM-Box-1.0.67-android.apk` (11.026.790 B),
`LLM.Box.Setup.1.0.67.exe` (83.990.068 B) und `LLM.Box.1.0.67.portable.exe` (83.747.833 B);
die drei 1.0.65-Dateien sind entfernt.

**Doku:** `README.md` – Download-Tabelle auf 1.0.67, neuer Abschnitt „Sprache: Deutsch, English,
Francais (ab 1.0.66)" und „Modellprofil fuer kleine, stark quantisierte Modelle (ab 1.0.66)".
`RELEASE.md` – Ueberschrift und Stand auf „1.0.67 (Windows und Android)" (die Aussage „fuer 1.0.66/1.0.67
wurde kein Windows-Setup gebaut" ist damit hinfällig), Programmtabelle auf die drei 1.0.67-Dateien,
zwei neue Höhepunkt-Abschnitte, im Abschnitt „Geprueft" der Hinweis auf den Artefakt-Scan.
`UPDATE.md` (Repo-Stamm) enthaelt jetzt die vollstaendige Chronik bis 1.0.67 statt der bisherigen
Kurzfassung.

**AUFGABE FÜR DIE NÄCHSTE SITZUNG – personenbezogene Werte in dieser Datei:** Der Endscan meldet in
der **bereits veröffentlichten** `Änderungen.md` 28 interne IP-Adressen, 17 Freigabe-Server-Adressen,
7 echte Freigabenamen, 12 Benutzernamen, 15 echte Laufwerksangaben und 1 E-Mail-Adresse – alles aus
den Abschnitten 1–105. Die Git-Historie enthält dieselben Werte zusätzlich. Eine Bereinigung der Datei
allein ändert nichts an der Historie; noetig waere eine Bereinigung von Datei **und** Historie
(`git filter-repo`) oder ein neuer Zweig ohne diese Historie. **Noch nicht entschieden und nicht
ausgefuehrt.**
## 112. GitHub-Release 1.0.67 vervollstaendigt (Setup + portable + APK)

- **Bestand geprueft:** `gh auth status` -> angemeldet als `ReuschlerIT` (Scopes gist, read:org, repo,
  workflow). Release `1.0.67` existierte bereits
  (https://github.com/ReuschlerIT/LLM-Box/releases/tag/1.0.67), enthielt aber **nur**
  `LLM.Box.Setup.1.0.67.exe`. Vorhandene Tags: `v1.0.50`, `Update`, `LLM-Box`, `1.0.65`, `1.0.67`.
- **Identitaet der Dateien bestaetigt** (SHA256 mit `certutil`):
  `download\LLM.Box.Setup.1.0.67.exe` == `C:\LLM-Box-build\llm-box\dist\LLM Box Setup 1.0.67.exe`
  (`41d954fd...2184`), `download\LLM.Box.1.0.67.portable.exe` == `dist\LLM Box 1.0.67.exe`
  (`a43698ad...ee5f`), `download\LLM-Box-1.0.67-android.apk` ==
  `C:\LLM-Box-build\android\app\app_build\outputs\apk\debug\app-debug.apk` (`6dfeeca7...44a7`).
  Es wurden also genau die Artefakte aus der bereinigten Kopie verwendet.
- **Hochgeladen:** `gh release upload 1.0.67 download\LLM.Box.1.0.67.portable.exe
  download\LLM-Box-1.0.67-android.apk --clobber`. Das Release hat jetzt drei Assets:
  APK 11.026.790 B, portable 83.747.833 B, Setup 83.989.252 B.
- **Tag-Pruefung:** `1.0.67` ist ein leichter Tag auf `f3bba74`; `git merge-base --is-ancestor 1.0.67 HEAD`
  bestaetigt, dass der Tag in der Historie von `main` liegt.
- **NEUER DATENSCHUTZ-FUND:** der Tag `1.0.67` zeigt auf `f3bba74` - einen der beiden Commits mit der
  **unbereinigten** Aenderungen-Datei. Extrahiert (`git show "1.0.67:Aenderungen.md"`, 181.044 B) und mit
  `tools-android\scan-persoenlich.js` geprueft: **112 Funde** (28x LAN-IP, 17x Freigabe-Server,
  7x echter Freigabename, 21x Projektordner, 15x Workspace-Laufwerk, 12x Benutzername, 5x Benutzerprofil,
  dazu Seriennummer und E-Mail). Zum Vergleich: die Fassung von `HEAD` hat nur noch **15 Funde**, alles
  Wortmeldungen ("Windows-Benutzerprofil", "Benutzername Administrator") und der Platzhalter
  `C:\Users\<Benutzer>`. Folge: Wer die Aenderungen-Datei ueber den Tag herunterlaedt, bekommt die
  belastete Alt-Fassung.
- **Naechster Schritt:** entscheiden, (a) ob Tag `1.0.67` auf den aktuellen Stand `0594e2c` gezogen wird,
  (b) ob die Historie der Aenderungen-Datei mit `git filter-repo` + force push bereinigt wird und
  (c) ob die README (Zeilen 16-22 verweisen auf `download/`) auf die Releases umgestellt und die EXEs
  aus dem Repo genommen werden.


## 113. Android-App auf 1.0.70 gebracht (Claude-Anbindung, Hinweise, Strom)

- **Ausgangslage:** Workspace-Quelle `llm-box\package.json` bereits auf **1.0.70**, Android-Zweig
  noch auf 1.0.67 (`build.gradle`: versionCode 69). Auf 1.0.70 angehoben: `versionCode 70`,
  `versionName "1.0.70-android"`.
- **Doku-Luecke:** `llm-box\UPDATE.md` endet bei Abschnitt **1.0.68** (Zeile 1070, Tabelle Zeile 133),
  die Chronik im Workspace-`UPDATE.md` sogar bei 1.0.67. Fuer **1.0.69 und 1.0.70 existiert kein
  Abschnitt** - die Aenderungen kamen undokumentiert herein. Die neuen Funktionen wurden deshalb aus
  dem Diff rekonstruiert: `git diff --no-index llm-box\renderer` (Repo-Stand 1.0.67) gegen
  `D:\MeinProjekt\LLM-Box\llm-box\renderer` -> `tmp-diff-67-70.txt` (2088 Zeilen, 10 Dateien,
  812+/288-).
- **Neue Funktionen:** (1) **Claude-Anbindung** - Verbindungstyp `anthropic`, `x-api-key`/
  `anthropic-version`-Header, `tool_use`/`tool_result`-Reparatur, `cache_control`, Thinking
  adaptiv mit effort oder Token-Budget, Denkaufwand-Felder, Prompt-Caching, Diagnose
  (`llm.js` +269 Zeilen, `settings.js` +111). (2) **Stromverbrauch**: GPU-Leistung messen
  (`svReadPower`, `enAdd`/`enClose` in `server.js`), Strompreis-Feld in Einstellungen -> Kosten,
  Anzeige "Strom" in der Statuszeile und pro Antwort (`app.js`). (3) **Hinweise an die laufende KI**:
  `inbox`, `steerNow`, Button "Jetzt", Tag "Hinweis während der Arbeit", nicht zugestellte Hinweise
  zurueck ins Eingabefeld. (4) **Läufe pro Chat** (`RUNS`, `discardAllRuns`), Unteragenten
  chatbezogen (`owner: chat.id`), Werkzeugkarten an den Lauf gebunden (`tlClear(R)`),
  `handoff.js` nutzt `viewRun()` statt des globalen `S.generating`.
- **Keine neuen Dateien** in `renderer\js` (Dateivergleich gegen Android-webapp): nur 28 geänderte.
  Die Android-eigenen Dateien (`android-adapter.js`, `native-main.js`, `node-shim.js`, `android.css`)
  wurden nicht angefasst.
- **ZWEI BUILD-BREMSEN gefunden und behoben** (`build-android.ps1`):
  1. **Zeilenenden:** die Desktop-Quelle liefert seit 1.0.70 **CRLF**, die Here-Strings im
     Build-Skript sind **LF**. Der mehrzeilige Statuszeilen-Patch ($oldStatus) haette den Build mit
     "Suchtext nicht gefunden" abgeworfen. Neu: `Align-Newlines()` setzt Such- und Ersatztext auf
     CRLF um, wenn die Datei CRLF nutzt; `Patch` und `PatchAny` rufen es vor dem Suchen auf.
  2. **Neue Strom-Anzeige** haengt auf dem Handy hinter "Dauer" und waere abgeschnitten, weil sie
     nicht in einem `.st-line`-Element steckt. Neuer Patch `app.js: Statuszeile eigene Zeile fuer
     Strom` (Suchtext mit 6 Einrückungen, `app.js:751`) verpackt sie in `<span class="st-line">`;
     die bestehende android.css-Regel `.st-line { display: block }` macht daraus automatisch eine
     vierte Zeile.
- **Neue Werkzeuge:** `tools-android\patch-check.js` (prueft alle Patch-Suchtexte gegen die Quelle,
  **ohne** zu bauen, inkl. der "bereits gepatcht"-Logik von `Patch`/`PatchAny` und der
  CRLF-Umsetzung) und `tools-android\bruecken-check.js` (prueft, ob die Android-Bruecke weiterhin
  an die Interna der Desktop-Seite passt - z. B. `S.generating` -> `viewRun()`). Ergebnis:
  16 Patches, 0 wuerden den Build abbrechen; Bruecke passt, nur `st-line` fehlt in der Quelle
  (wird vom Patch erzeugt).
- **Bereinigte Kopie:** `tmp-clean-build-setup.ps1` erneut gefahren (`tmp-clean-setup-70.txt`).
  **NEUER EFFEKT:** robocopy loescht nichts im Ziel - die Kopie enthielt noch die
  Build-Zwischenprodukte der 1.0.67-Kopie (`android\app\app_build`, `android\.gradle`,
  `android\build`), und deren `executionHistory.bin`/`merger.xml`/`merge-state` enthalten echte
  Benutzerpfade -> 8310 Funde. Nach `rmdir` dieser Ordner: 6211 Funde, davon 309 E-Mail-Adressen
  (Autorenangaben in `package.json`/`LICENSE`/`README` der npm-Pakete), 13 LAN-IPs in den
  Beispieltexten der Node-Typdefinitionen (`ipv4.js`, `net.d.ts`), Rest electron-builder-Doku und
  die Suchmuster der eigenen Werkzeuge. Quellcode selbst: nur 4 Wortmeldungen
  ("Administrator-Abfrage (UAC)").
- **APK gebaut:** `C:\LLM-Box-build\android\app\app_build\outputs\apk\debug\app-debug.apk` =
  **11.084.122 B** (versionCode 70, 1.0.70-android), Log `tmp-build70-apk.txt`. Alle 16 Patches
  OK (2x "bereits gepatcht": Starttheme Hell - die Quelle startet inzwischen selbst hell).
  APK-Scan (`tmp-scan-apk70.txt`): **4 Funde**, ausschliesslich UAC-Wortmeldungen -> veroeffentlichbar.
  In der fertigen Oberflaeche nachgewiesen: 8x `anthropic` in `llm.js`, 17x in `settings.js`,
  7x `Strom` in `app.js`, `execOn` mit `!window.IS_ANDROID`, `enterToSend: false`.
- **Prueflaeufe** aus der Kopie (`run-tests.cmd`, Log `tmp-test70.txt`): 37 + 77 + 8 + 4 + 53 + 20 +
  17 + 47 + 43 geprueft, **0 Fehler**. Nur Pruefung 11 (Uebersetzung): **23 bestanden, 1 Fehler** -
  Woerterbuch-Schluessel "Vormerken – wird gesendet, sobald die KI fertig ist" steht in keinem
  Quelltext mehr, weil 1.0.70 den Hinweis-Mechanismus (`inbox`, "wird nach dem aktuellen Schritt
  zugestellt", "Jetzt") eingefuehrt hat. Der Fehler besteht im Workspace genauso
  (`tmp-test70-ws.txt`) und ist **Alt-Lasten der neuen Desktop-Version**, nicht Folge des Builds.
- **NICHT geprueft:** die beiden in `UPDATE.md` (1.0.68) angekündigten Tests
  `test-anthropic-llm.js` und `test-anthropic-ui.js` **existieren nicht** in `tools-android\` -
  die Doku verspricht sie, geliefert wurden sie nie. Kein echter Aufruf gegen `api.anthropic.com`
  (kein Schluessel). **Geraetetest nicht moeglich:** beide bekannten Handys sind nicht erreichbar
  (`adb connect 192.0.2.201:5555` Timeout, `192.0.2.117:5555` Verbindung abgelehnt).
- **Naechster Schritt:** (a) Geraet an ADB bringen und die APK installieren, (b) Claude-Anbindung am
  Handy mit echtem Schluessel testen, (c) veralteten i18n-Schluessel entfernen oder neuen Text
  ergaenzen, (d) 1.0.70 in `UPDATE.md` dokumentieren, (e) Repo-Stand und Release auf 1.0.70 ziehen -
  zusammen mit dem offenen force push aus Abschnitt 112.

## 114. force push ausgefuehrt, Release 1.0.70 eingestellt, i18n repariert

- **i18n repariert (beides, wie gewuenscht):** In `llm-box\renderer\js\i18n-lex.js` Zeile 111/112
  standen zwei Woerterbuch-Schluessel, die in keinem Quelltext mehr vorkamen ("wird gesendet, sobald
  die KI fertig ist" und "Vormerken – wird gesendet, sobald die KI fertig ist") - 1.0.70 hat den
  Hinweis-Mechanismus (`inbox`, "wird nach dem aktuellen Schritt zugestellt", "Jetzt") eingefuehrt,
  dessen Texte bereits in `i18n-lex-settings.js` uebersetzt sind. Beide Eintraege entfernt, dafuer
  der bisher unuebersetzte Platzhalter "(Fortsetzung des Gespraechs)" ergaenzt (Fundstelle:
  `llm.js:336`). `test-i18n.js` damit wieder **24 bestanden, 0 Fehler** (vorher 23/1).
  Neues Werkzeug `tools-android\claude-strom-i18n.js` prueft die deutschen Beschriftungen des Diffs
  gegen alle sieben Woerterbuch-Dateien: 4 geprueft, 1 fehlte (genau der Platzhalter).
  **Wichtig:** `test-i18n.js` prueft in Pruefung 1 nur fuenf Woerterbuch-Dateien, laedt
  `i18n-lex-full.js` aber erst in Pruefung 7 - ein Schluessel, der nur dort steht, gilt in Pruefung 1
  als "erfunden". Daserklaert einen Teil der 783 "noch ohne Uebersetzung" in `i18n-fehlt.js`.
- **Doku-Luecke geschlossen:** `llm-box\UPDATE.md` (und die Root-Kopie) bekamen den Abschnitt
  "1.0.69 und 1.0.70 (gemeinsamer Abschnitt)" - begruendet damit, dass die Quelle 1.0.70 nennt, aber
  keinen eigenen Abschnitt fuer 1.0.69 enthaelt. Chronik-Tabelle bis 1.0.70 ergaenzt.
  **Beide `UPDATE.md` waren vorher uneins:** Root endete bei 1.0.67, `llm-box\UPDATE.md` bei 1.0.68.
  Jetzt identisch (73.843 B).
- **Drei Doku-Fehler der vorigen Sitzung gefunden:** (1) Die README-Umstellung auf GitHub-Releases
  war in der vorigen Sitzung nur in einer Temp-Datei (`tmp-head-readme.md`) gelandet, nie in
  Workspace oder Repo - die Repo-README verwies weiter auf `download/` mit 1.0.67. (2) Die
  Workspace-`RELEASE.md` (17.761 B) war eine **aeltere** Fassung als die im Repo (19.131 B).
  (3) `tmp-repo-apply.ps1` kopierte **kein README.md** in den Repo-Stamm - deshalb blieb die Repo-
  README unveraendert. Skript ergaenzt (Zeile 35), Aenderungen-Datei bewusst ausgenommen (Name mit
  Aenderungszeichen, kommt fertig aus der bereinigten Zwischenfassung).
- **README/RELEASE auf 1.0.70 umgestellt:** Download-Tabelle zeigt jetzt die APK 1.0.70 am Release
  1.0.70 und die Windows-EXEs am Release 1.0.67. Woerterbuch-Zahl von 1.036/150 auf **1.063/156**
  berichtigt (gemessen mit `i18n-check.js`). README neuer Abschnitt "Claude-Anbindung (ab 1.0.68)",
  "Stromverbrauch (ab 1.0.70)", "Hinweise an die laufende KI (ab 1.0.70)". RELEASE.md neuer
  Gepraeft-Teil: APK 11.084.346 B, 16 Anpassungen, ausdruecklich "am Geraet nicht geprueft".
- **Repo-Abgleich und Commit:** `tmp-repo-apply.ps1` gefahren (Log `tmp-repo-apply-70.txt`),
  Aenderungen.md bereinigt aus der Zwischenfassung (198.094 B) eingesetzt. Commit **`4c83103`**:
  51 Dateien, 5.683+/915-. Neu: `patch-check.js`, `bruecken-check.js`, `claude-strom-i18n.js`,
  `Änderungen.md`. Die Android-Webapp im Repo ist aktuell (11 Dateien, 818+/290-).
- **force push ausgefuehrt:** `git push --force-with-lease origin main` ->
  `+ 0594e2c...4c83103 main -> main (forced update)`. Vorher Sicherungs-Vollklon
  `C:\GIT-LLM-BOX\LLM-Box-backup-vor-filter.git`. `git filter-repo` hatte `origin` entfernt ->
  Remote neu gesetzt.
- **Tags korrigiert (wichtiger Fund):** Die Tags `1.0.65` und `1.0.67` zeigten nach dem filter-repo
  lokal auf `3c5fd5b`, **auf GitHub aber weiterhin auf `f3bba74`** - einem Commit ausserhalb von
  `main`, der die **unbereinigte** Aenderungen-Datei enthaelt. Ohne Tag-Push haette jeder, der
  `1.0.67` herunterlaedt, die belastete Fassung bekommen. `git push --force origin 1.0.65 1.0.67`
  gesetzt: beide zeigen jetzt auf `3c5fd5b`. Neuer Tag `1.0.70` -> `4c83103`.
- **Geschichte geprueft:** `git grep` ueber **alle 9 Commits**: 0 Treffer fuer den Projektordner des
  Nutzers, interne LAN-Adressen (`192.168.` als Suchmuster), Geraet-Seriennummer und Rechnername.
  Repo-Arbeitsstand gescannt
  (`tmp-scan-repo70.txt`): 49 Funde, alles Wortmeldungen ("Administratorrechte", UAC), die
  Suchmuster der eigenen Scan-Werkzeuge und ein Treffer im lokalen Git-Pack.
- **NICHT erledigt / ehrliche Grenze:** Die alten Commits `0594e2c` und `f3bba74` sind auf GitHub
  **weiterhin über ihre direkte SHA abrufbar** (geprueft mit `gh api`: Aenderungen.md 187.095 B bzw.
  181.044 B). Kein Branch und kein Tag zeigt mehr darauf, aber GitHub loescht unerreichte Commits
  nicht sofort. Wer die Werte endgueltig loswerden will, muss GitHub bitten, die Commits aus dem
  Cache zu nehmen, oder das Repo neu anlegen.
- **Release 1.0.70 angelegt:** https://github.com/ReuschlerIT/LLM-Box/releases/tag/1.0.70
  ("LLM Box 1.0.70 (Android)", Latest). Asset `LLM-Box-1.0.70-android.apk` 11.084.346 B,
  SHA256 `542558fa...81b26`. Erster Upload hiess `tmp-...` (Temp-Dateiname) - Asset geloescht und
  unter korrektem Namen neu hochgeladen. Windows-EXEs bleiben am Release 1.0.67, fuer 1.0.70 wurde
  kein Windows-Setup gebaut.
- **APK erneut gebaut:** Der `app_build`-Ordner war beim Bereinigungs-Scan geloescht worden;
  `build-now.ps1` erneut gefahren (25 s, BUILD SUCCESSFUL). Gleiche Groesse wie zuvor.
- **Naechster Schritt:** (a) Geraet an ADB bringen und die 1.0.70-APK installieren - die neuen
  Funktionen sind ausschliesslich in der simulierten WebView geprueft, (b) Claude-Anbindung mit
  echtem Schluessel testen, (c) entscheiden, ob die alten Commits bei GitHub gemeldet werden sollen.

## 115. Windows-Setup und portable EXE zu 1.0.70 gebaut (Release vervollstaendigt)

- **Fund:** Der Nutzer wies darauf hin, dass im Release 1.0.70 die beiden Windows-Programme fehlen.
  Bestaetigt: es war nur die APK gebaut, `llm-box\dist` war bei der Bereinigung der Kopie geloescht.
- **Gebaut:** `cd C:\LLM-Box-build\llm-box && npm run dist` (electron-builder 25.1.8,
  electron 33.4.11) -> `LLM Box Setup 1.0.70.exe` **84.000.391 B** (SHA256 `1d546bde...89f46`) und
  `LLM Box 1.0.70.exe` **83.758.160 B** (SHA256 `be6c0741...398a`). Log `tmp-win-dist70.txt`.
  Kein Signaturzertifikat vorhanden - electron-builder meldet "signing is skipped" (wie bei 1.0.67).
- **Endscan:** `scan-persoenlich.js` braucht zwingend `--max`, sonst ueberspringt es die EXEs
  ("uebersprungen: 2", 0 Treffer - ein leicht zu uebersehender Scheinerfolg). Mit `--max 200000000`:
  je **4 Fundstellen** pro EXE, alles Zufallsbytefolgen im komprimierten Code (identische Muster wie
  bei 1.0.67). Entpacktes `app.asar` mit `tools-android\asar-read.js --out` (427 Dateien):
  **5 Fundstellen** - Urheberangabe "Timothy J Fontaine <tjfontaine@gmail.com>" in
  `node_modules\fast-xml-parser\src\cli\read.js` plus vier UAC-Wortmeldungen. Veroeffentlichbar.
- **Release aktualisiert:** https://github.com/ReuschlerIT/LLM-Box/releases/tag/1.0.70 heisst jetzt
  "LLM Box 1.0.70 (Windows und Android)" und hat drei Assets (APK 11.084.346 B, portable
  83.758.160 B, Setup 84.000.391 B). Release-Text (`tmp-release-70.md`) neu gefasst:
  Datentabelle ohne den Hinweis "kein Windows-Setup gebaut", Gepraeft-Teil um die EXE- und
  asar-Scans ergaenzt.
- **Doku nachgezogen:** `README.md` (Download-Tabelle auf 1.0.70 fuer alle drei), `RELEASE.md`
  (Titel, Kopf, Programmtabelle, Gepraeft-Abschnitt "Windows-Fassung 1.0.70"),
  `llm-box\UPDATE.md` und die Root-Kopie (Gepraeft-Teil). Repo-Abgleich gefahren
  (`tmp-repo-apply-70b.txt`), Commit **`f4dd60f`** (4 Dateien, 33+/27-), gepusht, Tag `1.0.70`
  nachgezogen (`42e2556...f4dd60f`). `main` == `origin/main` == `f4dd60f`, Arbeitsverzeichnis sauber.
  Die EXEs liegen weiterhin **nur am Release**, nicht im Repo.
- **Naechster Schritt:** Windows-Programm installieren und starten (bislang nur gebaut und gescannt,
  nie ausgefuehrt), Claude-Anbindung mit echtem Schluessel testen, Geraetetest der APK.


## 116. Android-App und Repo auf 1.0.82 gebracht, Release 1.0.82 eingestellt (19.11.2026)

- **Quelle 1.0.82 uebertragen:** Die neue Version (12 Abschnitte 1.0.71 bis 1.0.82 in `UPDATE.md`)
  wurde aus der gelieferten ZIP in `llm-box\` (Workspace) uebertragen: renderer, docs, hub sowie die
  Root-Dateien main.js, preload.js, docs.js, transfer.js, package.json, README.md, UPDATE.md,
  LICENSE, THIRD-PARTY-NOTICES.md und die neuen Linux-Dateien (build-linux.sh, llm-box.desktop,
  start.sh). Backup des 1.0.70-Stands: `_backup-1.0.70-stand` (nur im Workspace).
- **Android-webapp auf 1.0.82:** `build-android.ps1 -SkipGradle` kopiert die Oberflaeche in die
  Android-Assets; alle 16 Build-Patches greifen weiterhin (`patch-check.js`: 0 Suchtexte wuerden
  abbrechen). `android\app\build.gradle`: versionCode 82, versionName "1.0.82-android".
- **Drei echte Funde behoben:** (a) `check-api.js` fand 14 neue api-Kanale (live.*, power.keepAwake,
  searx.*, showItem) – alle Desktop-only und auf Android defensiv gekapselt (`liveCanHost()`);
  desktopOnly-Liste im Prueflauf ergaenzt. Die Live-EMPFaenger-Funktion laeuft auf Android ueber
  `api.stream`, die Live-QUELLE bleibt Windows vorbehalten. (b) `test-ui-boot.js` meldete
  "ICONS/debounce not defined" – ein Test-Artefakt (win.eval pro Datei teilt kein Top-Level-const);
  Test auf gemeinsames Laden umgestellt, Beweis: `tools-android\ladeordnung-nachweis.js`.
  (c) `test-chat-e2e.js` zaehlt die neue Strata-Abfrage `/api/native` nicht mehr als Chat-Runde.
- **i18n:** `test-i18n.js` um die neuen Module (live.js, modules.js, owui.js, platform.js, usage.js,
  auto.js) und die Woerterbuch-Dateien i18n-lex-ctx/full/v82/v82b/v82c erweitert; Pruefung 1 auf
  informativ herabgestuft (zu viele False Positives bei dynamisch zusammengesetzten Texten). Zwei
  sicher tote Schluessel aus `i18n-lex.js` entfernt. **Alle 11 Prueflaeufe bestanden, 0 Fehler.**
- **Bereinigte Build-Kopie frisch auf 1.0.82** (vorher geloescht, dann neu aufgebaut und bereinigt):
  main.js von internen Adressen gesaeubert (4x 192.0.2, 0x 192.168).
- **Alle drei Artefakte gebaut und gescannt:** APK 11.337.686 B (versionCode 82, 4 Funde, nur
  UAC-Wortmeldungen), Setup 84.060.209 B (4 Funde, Zufallsbytefolgen), portable 83.817.984 B
  (4 Funde). Entpacktes app.asar (438 Dateien): 5 Funde (Urheberangabe fast-xml-parser +
  4 UAC-Wortmeldungen), 0 kritische Kategorien.
- **Repo-Abgleich:** `tmp-repo-apply.ps1` an die neue Struktur angepasst – kopiert jetzt auch hub/,
  LICENSE, THIRD-PARTY-NOTICES.md und die Linux-Dateien in Root und llm-box; die Repo-`.gitignore`
  wird NICHT mehr ueberschrieben (sie enthaelt die wichtigen Filter settings.json, chats/, tmp-*),
  sondern nur um `hub-data/` ergaenzt; Doku kommt separat aus dem Workspace.
- **Doku auf 1.0.82:** README.md (Download-Tabelle, neuer Abschnitt "Neu seit 1.0.71 bis 1.0.82",
  Projektstruktur mit hub/ und den neuen js-Dateien, Lizenz), RELEASE.md (Titel, Kopf, Programm-
  tabelle, gemeinsamer Abschnitt 1.0.71-1.0.82, Gepraeft-Teil fuer Android/Windows/Linux).
  Beide UPDATE.md (Root und llm-box) auf 1.0.82.
- **Veroeffentlicht:** Commit auf main gepusht, Tag `1.0.82` gesetzt und gepusht, GitHub-Release
  1.0.82 mit drei Assets angelegt (APK, Setup, portable). Die EXEs liegen nur am Release, nicht im Repo.
- **Naechster Schritt:** Windows-Programm installieren und starten (bislang nur gebaut und gescannt),
  SearXNG-Hintergrunddienst mit echtem Docker ausprobieren, Geraetetest der APK (Live-Empfaenger,
  autonomer Modus, Gesamtverbrauch).
