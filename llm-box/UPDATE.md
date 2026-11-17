# Update: Version 1.0.36

Datum: 10. November 2026 · Vorgängerversion: 1.0.32

Dieses Update behebt, dass der Monitor bei der **Strata-Desktop-App** „Antwort 200“ und „Offline“ anzeigte, obwohl das Modell geladen war. Dazu kommen ein **Monitor-Dock** unter dem Workspace-Panel, funktionierende Knöpfe „Modell laden“ und „Entladen“ für die Desktop-App und eine korrigierte obere Leiste.

## Neu

### Monitor unter dem Workspace-Panel
- Neuer Button **„Monitor“** in der oberen Leiste (neben „Server“). Er blendet unter dem Dateibaum eine kompakte Live-Anzeige ein oder aus: Zustand, Modell, Kontextfüllung, Tempo (mit Verlauf), GPU-Last, VRAM, Temperatur, Leistung, Arbeitsspeicher.
- Im Dock öffnet das Chip-Symbol das Fenster „Server & Monitor“, das Kreuz blendet das Dock aus. Der Button „Server“ und das Fenster bleiben unverändert.
- Dock und Fenster nutzen **dieselbe Abfrage**. Die Einstellung wird gespeichert (`server.dock`, Standard: aus).
- **Schutz:** Das Dock fragt nur lokale oder private Adressen ab oder die unter „Zielrechner“ ausdrücklich gewählte Verbindung. Cloud-Verbindungen werden nie still abgefragt, damit der API-Schlüssel nicht dauerhaft an fremde Server geht. Es pausiert bei geschlossenem Panel, ausgeschaltetem Dock und verstecktem Fenster.
- Bei einer Fensterbreite unter etwa 1100 Pixel ist das rechte Panel ausgeblendet. Dann öffnet der Button das Fenster.

### Strata-Desktop-App
- Die Desktop-App bietet unter ihrem Host-Port (Standard 47831) die Oberfläche und die Schnittstelle `/v1`, aber **kein `/metrics`**. Die LLM Box erkennt das und liest die Daten von `/api/native` und `/api/monitor`.
- Anzeige: „Online · geladen“, „Entladen“ oder „Modell nicht verfügbar“. Enthält die Instanz eine Metrik im Format des Modell-Servers, wird sie vollständig angezeigt. Sonst nennt der Monitor die Datenquelle.
- **Modell laden und Entladen** funktionieren über die App-API:
  - Entladen: `POST /api/native/instances/<id>/unload` (mit Rückfrage)
  - Laden: `POST /api/native/resume`, ersatzweise `POST /api/native/operations` mit `{"kind":"load","args":{"model":"<id>"}}`
  - Danach wartet die App bis zu 30 Minuten auf den Zustand „bereit“. Eine abgestürzte Instanz wird vorher entladen. Ist schon ein Modell geladen, passiert nichts. Bei mehreren installierten Modellen erscheint eine Auswahlliste.
- Tab **„Konfiguration“**: Statt „Konfiguration nicht lesbar: HTTP 200“ erklärt die App, dass die Desktop-App ihre Run-Konfiguration nicht über HTTP bereitstellt, und öffnet auf Wunsch die App-Oberfläche. Die Konfigurationsdatei wird bewusst **nicht** bearbeitet (sie enthält eigene Schlüssel der App wie `user_args`).

### Fehlersuche
- **Webseite statt Daten:** Liefert ein Server HTML statt JSON, nennt die Meldung, was kam (Webseite, Prometheus-Text, JSON ohne bekannte Felder), mit Anfang der Antwort und der abgefragten Adresse.
- **Port-Suche:** Zeigt die Verbindung nur auf die Oberfläche, sucht der Monitor auf diesem Rechner nach einer Strata-API (Ports 8080, 8190, 8081, 8000) und bietet an, die Verbindung umzustellen (mit Rückfrage). Es wird **kein API-Schlüssel** an fremde Ports gesendet, und entfernte Rechner werden nicht abgesucht.
- **„Verbindung genau prüfen“** zeigt zusätzlich den Anfang der Antworten, fragt bei der Desktop-App `/api/native`, `/api/monitor` und `/api/health` ab (mit Feldnamen, ohne Werte) und vergleicht Antworten mit und ohne Schlüssel.
- **Statusleiste:** Links unten steht zusätzlich „Modell geladen“ oder „Modell entladen“, wenn der Server das über `/v1/status` oder `/health` meldet.

## Verbessert
- **Monitor-Fenster:** Liefert die Datenquelle keine Messwerte, werden leere Kacheln, die Tabellen „Letzte Anfragen“ und die VRAM-Reserve ausgeblendet.
- **Rückfall bei fehlendem `/metrics`:** Der Monitor nutzt `/v1/status` und `/health` jetzt auch bei geladenem Modell. Vorher galt der Server dann fälschlich als offline. Hüllformate wie `{"data": …}` werden ausgepackt.
- **Modellliste:** Liefert der Server eine Webseite oder Text statt JSON, steht eine verständliche Meldung statt „Unexpected token <“ (das war der Grund für die rote Statusleiste).
- Anfragen des Monitors, der Modellliste und der Diagnose senden `Accept: application/json`.
- **Dokumentation:** README und Handbuch neu gefasst, neue Screenshots im dunklen und hellen Design. Im Handbuch sind zwei Aussagen korrigiert: Strata erzeugt nicht in jedem Fall bei jedem Start einen neuen Schlüssel (laut Release-Notizen von Strata 0.2.3 bleibt er bis `--new-key` erhalten), und ein falscher Schlüssel wird mit 401 beantwortet, nicht mit einer Webseite.

## Behoben
- **Obere Leiste:** „Server“, „Monitor“ und „Unteragenten“ wurden bei schmalem Hauptbereich rechts abgeschnitten. Ursache waren feste Mindestbreiten der Auswahlfelder (`#sel-conn` 130 px, `#sel-model` 150 px). Jetzt zeigen die drei Buttons bei einem Hauptbereich unter 1100 Pixel nur das Symbol (Tooltip bleibt), und die Auswahlfelder schrumpfen. Vermessen: Bei einem Hauptbereich von 712 Pixel (Fenster 1260 px, Panel offen) passen alle Buttons hinein.
- **Monitor „Offline“ trotz geladenem Modell** bei der Desktop-App (siehe oben).
- **„Antwort 200“** ohne erkennbare Ursache: Die Meldung nennt jetzt Art und Anfang der Antwort.

## Geänderte Dateien

| Datei | Änderung |
|---|---|
| `renderer/js/server.js` | App-Host-Anbindung, Laden/Entladen, Monitor-Dock, Port-Suche, HTML-Erkennung, Konfigurations-Hinweis, Ausblenden leerer Kacheln |
| `renderer/js/llm.js` | Modellliste erkennt HTML und Nicht-JSON, `Accept`-Header |
| `renderer/js/settings.js` | Diagnose „Verbindung genau prüfen“ erweitert, neue Einstellung `server.dock` |
| `renderer/js/app.js` | Button „Monitor“, Dock im Workspace-Panel, Statusleiste „Modell geladen/entladen“ |
| `renderer/index.html` | Button „Monitor“ |
| `renderer/styles.css` | Dock, Kopfleiste (Symbole bei schmalem Hauptbereich, Auswahlfelder schrumpfen) |
| `package.json` | Version 1.0.36 |
| `README.md`, `docs/HANDBUCH.md` | Neu gefasst |
| `docs/screenshots/` | Neu: `01-chat`, `05-monitor`, `08-monitor-dock`, `09-desktop-app`, `10-konfiguration-desktop-app`, jeweils `-dunkel` und `-hell`. Entfernt: `01-chat.png`, `05-monitor.png`, `06-hell.png` |

`main.js`, `preload.js` und `docs.js` sind unverändert.

## Geprüft und nicht geprüft

**Geprüft** (mit simulierten Servern und Oberflächen, ohne Strata-Hardware):
- Monitor-Logik: 14 Fälle (u. a. HTML, Prometheus-Text, Fehler-JSON, 401, nicht erreichbar, Hüllformate), 7 App-Host-Fälle, 4 Fälle der Port-Suche (inkl. Prüfung, dass kein Schlüssel an fremde Ports geht)
- Laden und Entladen: 7 Abläufe (mit und ohne `resume`, abgestürzte Instanz, Doppelstart, kein Modell installiert, Modellauswahl)
- Monitor-Dock: 19 Prüfungen (Darstellung, Schutzregeln, Button), dazu ein Start der echten App-Logik ohne Fehler
- Die App wurde unter Electron 33 mit simulierten Strata- und Ollama-Servern gestartet. Daraus stammen die Screenshots. Dabei wurden der Fehler in der oberen Leiste gefunden und die Höhe der Chat-Ansicht geprüft.

**Nicht geprüft:**
- Die Anbindung der **Desktop-App**: Adressen und Feldnamen (`/api/native`, `/api/monitor`, `/api/native/resume`, `/api/native/operations`, `/api/native/instances/<id>/unload`) stammen aus öffentlichen Strata-Tickets (u. a. #4973, #4726, #4289, #3402, PR #4651) und nicht aus einer echten Desktop-App. Ob die Instanz Messwerte wie Geschwindigkeit und GPU liefert, ist offen. Ob die App für diese Aufrufe den API-Schlüssel der Verbindung akzeptiert, ist ebenfalls offen. Bei 401 erscheint eine eindeutige Meldung.
- Die Windows-Anwendung selbst. Die Screenshots entstanden unter Linux mit der Schrift Inter statt Segoe UI. Das Arbeitsverzeichnis im Screenshot (`C:\Projekte\kundenportal`) ist ein Demo-Wert, alle Daten sind Demo-Daten.
- Die Screenshots `02-live-powershell`, `03-freigabe`, `04-unteragenten` und `07-rueckfrage` sind unverändert aus der früheren Version (nur dunkles Design).

Rückmeldungen von echten Strata-Rechnern sind willkommen: Zeigt der Monitor bei der Desktop-App leere Kacheln oder lehnt die App das Laden ab, hilft der Text aus Einstellungen → Verbindungen → „Verbindung genau prüfen“ (ohne API-Schlüssel).

## Update einspielen

1. Dateien dieses Release in das Repository kopieren (gleiche Pfade). Veraltet und zu löschen: `docs/screenshots/01-chat.png`, `05-monitor.png`, `06-hell.png`.
2. `npm install` ist nur nötig, wenn sich Abhängigkeiten geändert haben. In diesem Update ist das nicht der Fall.
3. App starten (`start.bat`). Das Dock ist standardmäßig aus: Button „Monitor“ in der oberen Leiste.
4. Für eine neue EXE: `build-exe.bat` (die Version 1.0.36 steht in `package.json`).

Bestehende Einstellungen, Verbindungen und Chats bleiben erhalten. Neu ist nur der Eintrag `server.dock` in den Einstellungen.
---

# Update-Chronik ab Version 1.0.37

Die folgenden Abschnitte setzen die obige Beschreibung (Version 1.0.36) fort und führen jede
veröffentlichte Version bis zur aktuellen **1.0.67** auf – chronologisch aufsteigend, damit zu jeder
Version nachvollziehbar ist, was sich geändert hat.

Hinweise zur Lesart:
- „Windows“ = die Desktop-Anwendung, „Android“ = die Handy-App (eigene Versionsnummern mit dem
  Zusatz `-android`). Wo eine Änderung in beiden gilt, steht das dabei.
- Beispiele sind neutral gehalten (`D:\MeinProjekt`, `192.0.2.x` – Dokumentationsadresse nach RFC 5737).
- „Nicht bestätigt“ bedeutet: der Stand wurde nur mit Syntaxprüfung oder Simulation geprüft, nicht in
  einer echten Fenster-Oberfläche bzw. nicht am Gerät.
- Zwei Nummern sind Lücken, und das ist so richtig so: **1.0.53** hat keinen eigenen Änderungsabschnitt
  (nur Nachweise, dass dieser Stand existierte) und **1.0.64** wurde nie als Windows-Version gebaut –
  die Nummer gibt es nur auf dem Handy. Beide sind der Vollständigkeit halber aufgeführt.

| Version | Kurz gesagt |
|---|---|
| 1.0.37 | Monitor-Dock mit Verlaufsdiagrammen, Kopfleiste schneidet nichts mehr ab |
| 1.0.38 | App reagiert wieder, wenn das Fenster minimiert oder verdeckt ist |
| 1.0.39 | Statusanzeige neben „Monitor“ springt nicht mehr in der Breite |
| 1.0.40 | „Stoppen“ erwischt auch abgelöste Hintergrundprozesse (Gradle-Daemon) |
| 1.0.41 | Nachricht vormerken, während die KI noch antwortet |
| 1.0.42 | Programm-Karte wartet nicht mehr auf Hintergrundprozesse |
| 1.0.43 | Helles Design als Standard, Chat wechseln während die KI arbeitet, Mitscrollen repariert |
| 1.0.44 | Chats auf mehreren Rechnern (gemeinsamer Ordner, Konflikt-Schutz) |
| 1.0.45 | Keine automatisch angelegten Verbindungen mehr |
| 1.0.46 | Einzige Vorgabe heißt „Strata_API“ |
| 1.0.47 | Neuer Standard-System-Prompt (Agent-Prompt, ohne personenbezogene Pfade) |
| 1.0.48 | Pausieren/Fortsetzen und „Kontext leeren“ statt neuer Chat |
| 1.0.49 | Stopp-Knopf wirkt jetzt immer (harter Abbruch inkl. laufender Suche) |
| 1.0.50 | Rechtschreibprüfung und Rechtsklick-Menü im Eingabefeld |
| 1.0.51 | Paralleles Chat-Speichern schlägt nicht mehr fehl, Eingabefeld springt nicht |
| 1.0.52 | Übertragung auf die Android-App: QR-Bildfolge und JSON-Export |
| 1.0.53 | (kein eigener Änderungsabschnitt belegt) |
| 1.0.54 | „Im WLAN anbieten“ repariert (zwei Fehler behoben) |
| 1.0.55 | Übernommene Einstellungen sind sofort wirksam |
| 1.0.56 | WLAN-Angebot ist mehrfach hintereinander nutzbar |
| 1.0.57 | Abgleich-Rhythmus wählbar (2 Sekunden bis 30 Minuten) |
| 1.0.58 | Gesperrte Chat-Metadaten gelten nicht mehr als gelöscht |
| 1.0.59 | Sehr große Chats: fensterweiser Aufbau, rund 50× schnellerer Aufbau |
| 1.0.60 | Abgleich-Kette kann sich nicht mehrfach aufbauen |
| 1.0.61 | Windows-Freigabe als Arbeitsordner, Zugangsdaten wandern mit |
| 1.0.62 | Handy scannt QR-Codes selbst mit der Kamera |
| 1.0.63 | Gemapptes Netzlaufwerk wird zur echten Freigabe aufgelöst |
| 1.0.64 | (nur Android: Kamera-Vorschau und Scan-Abbruch) |
| 1.0.65 | Einheitliche Kopfzeile auf dem Handy; Windows = Veröffentlichungsstand |
| 1.0.66 | Sprachen Deutsch/Englisch/Französisch vollständig, weniger Abbrüche der KI, Modellprofil für IQ3/Q3, neues Raster der Einstellungen |
| 1.0.67 | Sprachauswahl beim allerersten Start |

---

# Update: Version 1.0.37

Vorgängerversion: 1.0.36 · Windows

## Verbessert
- **Obere Leiste:** Der Knopf „Monitor“ wurde bei schmaler Leiste abgeschnitten. Unterhalb von etwa
  1400 Pixel Breite zeigen „Unteragenten“, „Server“ und „Monitor“ nur noch das Symbol (bei
  Unteragenten zusätzlich den Zähler), die Beschriftung bleibt im Tooltip. Die Auswahlfelder für
  Verbindung und Modell dürfen etwas schmaler werden.
- **Monitor-Dock:** Alle Kacheln mit Messreihe zeigen jetzt ein Verlaufsdiagramm – GPU-Auslastung,
  VRAM, GPU-Temperatur, GPU-Leistung und Arbeitsspeicher; bisher gab es den Verlauf nur beim Tempo.
- Liefert der Server für einen Wert keinen Verlauf, sammelt die LLM Box die Messwerte selbst
  (die letzten 90 Abfragen).
- Sinnvolle Achsen: Temperatur 20 bis 100 °C, Leistung bis zum Limit der Grafikkarte – damit die
  Kurve nicht flach wirkt. Gilt auch im Fenster „Server & Monitor“.

## Geänderte Dateien
`renderer/styles.css`, `renderer/js/server.js`, `package.json` (Version 1.0.37)

---

# Update: Version 1.0.38

Vorgängerversion: 1.0.37 · Windows

## Behoben
- **App reagierte nicht mehr, wenn das Fenster minimiert oder verdeckt war.** Ursache: Chromium
  drosselt standardmäßig Timer und Darstellung in Fenstern ohne Fokus (spart sonst Akku und CPU).
  Lief gerade ein Werkzeug wie `run_command` mit PowerShell, produzierte der Hauptprozess im
  Hintergrund weiter Ausgaben, während die Oberfläche – inklusive beider Stopp-Knöpfe – stark
  verzögert oder gar nicht mehr reagierte.

## Behoben durch
- Drei Chromium-Schalter vor dem App-Start (`disable-background-timer-throttling`,
  `disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding`) und
  `backgroundThrottling: false` im Fenster selbst. Die App
  bleibt im Hintergrund voll reaktionsfähig. Nebenwirkung: etwas mehr CPU, wenn im Hintergrund
  tatsächlich etwas läuft; normaler Leerlauf ist nicht betroffen.

## Geänderte Dateien
`main.js`, `package.json` (Version 1.0.38)

---

# Update: Version 1.0.39

Vorgängerversion: 1.0.38 · Windows

## Behoben
- **Die Statusanzeige neben „Monitor“ sprang in der Breite.** Der Text („Bereit“, „Liest den Prompt“,
  „Antwortet“, …) hatte je nach Länge eine andere Breite, dadurch verschob die Oberfläche bei jedem
  Statuswechsel sichtbar ihre Knöpfe. Die Anzeige hat jetzt eine feste Breite (158 px); zu langer
  Text wird mit „…“ abgeschnitten statt die Breite zu ändern.

## Verbessert
- Ist der Text abgeschnitten, zeigt ein Tooltip beim Überfahren den vollständigen Status – im kleinen
  Monitor-Dock ebenso wie im Fenster „Server & Monitor“.

## Geänderte Dateien
`renderer/styles.css`, `renderer/js/server.js`, `package.json` (Version 1.0.39)

---

# Update: Version 1.0.40

Vorgängerversion: 1.0.39 · Windows

## Behoben
- **„Stoppen“ wirkte bei manchen Programmen nicht**, gemeldet am Beispiel eines Android-/Gradle-Builds:
  Die Oberfläche zeigte „Vom Nutzer abgebrochen“, der Build lief aber weiter. Ursache: Programme wie
  Gradle starten bewusst einen Hintergrund-Daemon, der sich vom aufrufenden Skript löst. Windows’
  `taskkill /T` verlässt sich auf eine eigene Baum-Logik und kann solche Prozesse übersehen.

## Behoben durch
- `killTree()` ermittelt auf Windows zusätzlich selbst alle Nachkommen-Prozess-IDs (über die
  ParentProcessId, beliebig tief) und beendet jeden einzeln, statt sich nur auf `taskkill /T` zu
  verlassen. Ergänzung aus der Dokumentation: Wer Gradle-Probleme von vornherein vermeiden will, kann
  im eigenen Build-Skript `--no-daemon` ergänzen.

## Geänderte Dateien
`main.js`, `package.json` (Version 1.0.40)

---

# Update: Version 1.0.41

Vorgängerversion: 1.0.40 · Windows

## Neu
- **Nachricht vormerken, während die KI noch antwortet.** Eine neue Nachricht kann jetzt trotzdem
  abgeschickt werden (Knopf oder Eingabetaste). Sie wird nicht sofort gesendet, sondern als
  vorgemerkter Chip im Eingabebereich angezeigt („wird gesendet, sobald die KI fertig ist“) und
  automatisch abgeschickt, wenn die laufende Antwort beendet ist.

## Verbessert
- Der Senden-Knopf zeigt während der Generierung das Stopp-Symbol **nur noch bei leerem Feld**. Steht
  Text oder ein Anhang im Feld, zeigt er das Senden-Symbol mit dem Tooltip „Vormerken“ – Stoppen bleibt
  über den leeren Knopf also weiterhin möglich.
- Die Eingabetaste blockiert während der Generierung nicht mehr mit einem Hinweistext, sondern merkt
  denselben Text vor.
- Über das Kreuz am Vormerk-Chip lässt sich die Nachricht jederzeit zurück ins Eingabefeld holen –
  nichts geht verloren.
- Sicherheitsnetz: Die vorgemerkte Nachricht ist an den Chat gebunden, in dem sie geschrieben wurde,
  und kann nicht versehentlich in einem anderen Chat landen.

## Geänderte Dateien
`renderer/index.html`, `renderer/js/app.js`, `renderer/styles.css`, `package.json` (Version 1.0.41)

---

# Update: Version 1.0.42

Vorgängerversion: 1.0.41 · Windows

## Behoben
- **Programm-Karte blieb auf „wartet auf Ausgabe“ stehen, obwohl der Befehl fertig war** (z. B.
  `BUILD SUCCESSFUL`, Exit 0), und Stopp half nicht. Ursache: Die App wartete auf das Ereignis
  `close`. Das kommt erst, wenn alle Ausgabe-Leitungen geschlossen sind – ein Gradle-Daemon oder
  ähnlicher Hintergrundprozess erbt diese Leitungen und hält sie offen.

## Behoben durch
- Als Abschluss gilt jetzt „exit“ plus 1,5 Sekunden Frist zum Auslesen der Restausgabe. Danach werden
  die Leitungen geschlossen und das Ergebnis geliefert; der Daemon darf im Hintergrund weiterlaufen.
- Stopp und Zeitlimit liefern spätestens nach 1,2 Sekunden ein Ergebnis, auch wenn ein Nachzügler die
  Leitungen offen hält. Dasselbe gilt für Strata-Aufträge.

## Geänderte Dateien
`main.js` (`runProc`, Strata-Auftrag), `package.json` (Version 1.0.42)

---

# Update: Version 1.0.43

Vorgängerversion: 1.0.42 · Windows

## Neu
- **Chats wechseln, während die KI arbeitet.** Die Antwort läuft im Hintergrund weiter – auch laufende
  Programme, Rückfragen und Freigaben. Beim Zurückwechseln erscheint alles wieder (streamende Antwort,
  laufende Programm-Karten, offene Karte). Im anderen Chat kann normal gelesen und geschrieben werden;
  eine dort abgeschickte Nachricht wird vorgemerkt. Intern sind Speichern, Freigaben pro Chat und
  Unteragenten jetzt an den Chat gebunden, in dem die KI läuft – nicht an den angezeigten. Es läuft
  weiterhin höchstens eine Antwort gleichzeitig (ein lokales Modell bedient eine Anfrage nach der
  anderen).
- **Punkte in der Seitenleiste** zeigen den Zustand eines Chats: blau pulsierend = KI arbeitet,
  orange = wartet auf dich, grün = neue Antwort fertig.

## Geändert
- **Das helle Design ist Standard** (neue Installationen und „Zurücksetzen“); Fensterfarbe und
  Titelleiste passen dazu. Beim ersten Start dieser Version wird ein früher gespeichertes „Dunkel“
  einmalig auf Hell gesetzt – jede spätere eigene Wahl bleibt erhalten.

## Behoben
- **Weiße Rechtecke im hellen Design:** Die halbtransparente Hintergrund-Ebene des Chat-Bereichs wurde
  auch ohne gesetztes Hintergrundbild gezeichnet, was auf manchen Grafikkarten als weiße Kacheln
  erschien. Die Ebene gibt es jetzt nur noch bei gesetztem Bild, der Filter nur bei Unschärfe größer 0.
- **Mitscrollen hielt grundlos an:** Die App stoppte das Mitlaufen, sobald die Scroll-Position sich nach
  oben verschob – egal warum. Das passiert aber auch von selbst, wenn Inhalt schrumpft (Live-Karte wird
  durch die zugeklappte Karte ersetzt, Programm startet oder endet). Jetzt zählt nur eine echte
  Nutzerbewegung (Mausrad, Scrollleiste, Touch, Tasten). Zusätzlich beobachtet die App die Größe von
  Chat und Programmausgabe und bleibt unten, wenn Inhalt wächst – auch bei vielen Zeilen auf einmal.

## Geänderte Dateien
`renderer/index.html`, `renderer/js/settings.js`, `renderer/js/app.js`, `renderer/js/livetools.js`,
`renderer/js/subagents.js`, `main.js`, `renderer/styles.css`, `package.json` (Version 1.0.43)

---

# Update: Version 1.0.44

Vorgängerversion: 1.0.43 · Windows

## Neu: Chats auf mehreren Rechnern
- Chats können in einem **gemeinsamen Ordner** liegen (Netzlaufwerk, NAS, Cloud-Ordner). Angelegt wird
  der Unterordner `LLM-Box-Chats`. Einstellungen, Verbindungen und Zugangsdaten bleiben je Rechner
  getrennt.
- Pro Chat zwei Dateien: `<id>.json` (Inhalt) und `<id>.meta.json` (Titel, Zeit, Revision, Gerät,
  „arbeitet gerade“). Die frühere gemeinsame `index.json` entfällt – sie wäre bei zwei Rechnern ständig
  kollidiert. Bestehende Datenstände werden beim ersten Start automatisch um Meta-Dateien ergänzt.
- **Konflikt-Schutz:** Hat ein anderer Rechner einen Chat geändert, seit dieser Rechner ihn zuletzt
  gelesen hat, wird nichts überschrieben. Die eigene Fassung wird als Kopie „Titel (Konflikt …)“
  gespeichert. Ist der Ordner nicht lesbar (Netzlaufwerk getrennt), wird nichts als gelöscht behandelt.
- Änderungserkennung alle 3 Sekunden, nur wenn ein gemeinsamer Ordner aktiv ist.
- **Fortschritt über Rechner hinweg:** Während die KI auf einem Rechner antwortet, speichert sie nach
  jedem Schritt und setzt alle 45 Sekunden ein Lebenszeichen. Andere Rechner zeigen den Fortschritt
  Schritt für Schritt und melden über dem Eingabefeld „Auf <Rechner> arbeitet die KI gerade“; Senden ist
  dort bis zum Ende gesperrt. Ohne Lebenszeichen (Absturz) endet die Sperre nach 3 Minuten.
- Neue Einstellung: **Einstellungen → Daten → „Chats auf mehreren Rechnern“** (Ordner wählen, lokale
  Chats kopieren, wieder nur lokal). Auf jedem Rechner denselben Ordner wählen.

## Geänderte Dateien
`main.js`, `preload.js`, `renderer/js/app.js`, `renderer/index.html`, `renderer/styles.css`,
`renderer/js/settings.js`, `package.json` (Version 1.0.44)

---

# Update: Version 1.0.45

Vorgängerversion: 1.0.44 · Windows

## Geändert
- Die Vorgaben „Ollama (lokal)“ und „LM Studio“ werden **nicht mehr automatisch angelegt**. Neue
  Installationen starten ohne Verbindung; angelegt wird sie unter Einstellungen → Verbindung →
  „+ Verbindung hinzufügen …“. Die Vorlagen (Ollama, LM Studio, Strata, llama.cpp, vLLM, OpenAI,
  OpenRouter, Groq, Eigene) bleiben als Auswahl erhalten.
- „Mindestens eine Verbindung muss bleiben“ entfällt – es können alle entfernt werden. Die erste
  angelegte Verbindung wird automatisch die aktive; ohne Verbindung zeigt der Editor einen Hinweis.
- „Einstellungen zurücksetzen“ entfernt ebenfalls alle Verbindungen.

## Verbessert
- Ohne Verbindung läuft die App fehlerfrei: Statusanzeige „Keine Verbindung“, Senden weist auf die
  fehlende Verbindung hin, und beim Start ohne Verbindung öffnen sich die Einstellungen direkt auf dem
  Reiter „Verbindung“. Bereits gespeicherte Verbindungen bleiben unverändert und lassen sich einzeln
  entfernen.

## Geänderte Dateien
`renderer/js/settings.js`, `renderer/js/app.js`, `package.json` (Version 1.0.45)

---

# Update: Version 1.0.46

Vorgängerversion: 1.0.45 · Windows

## Geändert
- Die einzige vorgegebene Verbindung heißt jetzt **„Strata_API“** (OpenAI-kompatibel,
  `http://localhost:8080/v1`, Denk-Modus „Chat-Template“). „Ollama (lokal)“ und „LM Studio“ sind keine
  Vorgabe mehr; weitere Verbindungen legt der Nutzer selbst an. Gilt auch für „Einstellungen zurücksetzen“.

## Verbessert
- Einmalige Bereinigung beim ersten Start: bereits gespeicherte, **unveränderte** Einträge „Ollama
  (lokal)“ und „LM Studio“ werden entfernt, „Strata_API“ ergänzt, falls es den Namen noch nicht gibt.
  Selbst geänderte oder umbenannte Verbindungen bleiben unangetastet. Die Absicherung „keine Verbindung
  vorhanden“ aus der Vorgängerversion bleibt bestehen.

## Geänderte Dateien
`renderer/js/settings.js`, `renderer/js/app.js`, `package.json` (Version 1.0.46)

---

# Update: Version 1.0.47

Vorgängerversion: 1.0.46 · Windows

## Geändert
- Der **Standard-System-Prompt** ist jetzt der Agent-Prompt (Sprache, Werkzeuge, Autonomie,
  Unteragenten, Chronik-Datei, Arbeitsweise). Entfernt wurden alle nutzerspezifischen Angaben:
  persönliche Pfade, der Abschnitt „Kontext dieses Projekts“ und projektbezogene Ordnerverweise. Die
  Überschrift der Chronik-Regel heißt jetzt „ÄNDERUNGEN.MD“ (passend zum Dateinamen).

## Verbessert
- Einmalig beim ersten Start: Steht noch der alte Kurz-Prompt („Du bist ein hilfreicher, präziser
  Assistent …“) oder gar nichts, wird der neue Standard übernommen. Selbst geschriebene Prompts bleiben
  unverändert.

## Geänderte Dateien
`renderer/js/settings.js`, `renderer/js/app.js`, `package.json` (Version 1.0.47)

---

# Update: Version 1.0.48

Vorgängerversion: 1.0.47 · Windows

## Neu
- **Pausieren und Fortsetzen.** Neuer Pause-Knopf neben „Senden“ (nur solange die KI arbeitet) und eine
  Leiste „Pausiert“ mit „Fortsetzen“. Schreibt die KI gerade, wird die Antwort sofort angehalten (Text
  bleibt sichtbar); beim Fortsetzen wird genau dieser Schritt mit demselben Verlauf neu angefragt. Läuft
  ein Programm oder Unteragent, wird er **nicht** abgebrochen – die Pause greift zwischen zwei Werkzeugen
  und vor dem nächsten Schritt. Offene Rückfragen und Freigaben bleiben offen. „Stopp“ funktioniert auch
  aus der Pause heraus (die Teilantwort bleibt als abgebrochen stehen).
- **Kontext-Grenze** (`chat.ctxStart`): Nachrichten vor der Grenze bleiben sichtbar (gedämpft, mit
  Trennlinie „Kontext geleert“), werden der KI aber nicht mehr gesendet. Der Füllstand-Balken zählt nur
  noch den sichtbaren Kontext. Bearbeitet man eine Nachricht vor der Grenze, wird die Grenze zurückgesetzt.

## Geändert
- **„Kontext leeren“ ist der bevorzugte Weg bei vollem Kontext** (Hinweis, Karte der KI, Knopf oben
  rechts). Die Übergabe wird wie bisher erstellt, steht aber als erste Nachricht im selben Chat. Eine
  neue Session bleibt als zweite Schaltfläche erhalten (oben rechts: Umschalt+Klick) und dient als
  Rückfall, wenn Leeren nicht möglich ist (nichts zu leeren, anderer Rechner arbeitet) oder so
  eingestellt.

## Neu (Einstellung)
- „Bei vollem Kontext bevorzugen“: **Kontext leeren** (Standard) oder Neue Session. Gespeicherte
  Einstellungen ohne diesen Wert verhalten sich wie der Standard.

## Geänderte Dateien
`renderer/js/app.js`, `renderer/index.html`, `renderer/styles.css`, `renderer/js/util.js`,
`renderer/js/handoff.js`, `renderer/js/settings.js`, `renderer/js/llm.js`, `package.json` (Version 1.0.48)

---

# Update: Version 1.0.49

Vorgängerversion: 1.0.48 · Windows

## Behoben
- **Der Stopp-Knopf wirkte nicht immer.** Er brach bisher nur den Modell-Stream und per `run_command`
  gestartete Programme ab; die Schleife wartete aber weiter auf Dateiwerkzeuge (zum Beispiel „Text
  suchen“, das im Hauptprozess viele Dateien durchläuft). Solange ein Werkzeug hing, passierte nichts.

## Behoben durch
- Neues Stopp-Signal (`hardStop`): Die Schleife wartet auf Stream, Werkzeuge und Unteragenten nur noch
  bis zum Stopp. Danach endet der Auftrag sofort, auch wenn ein Werkzeug hängt. Alle noch offenen
  Werkzeugaufrufe bekommen das Ergebnis „Vom Nutzer abgebrochen“, damit der Verlauf gültig bleibt (kein
  Aufruf ohne Ergebnis) und der Chat normal weitergeführt werden kann. Wirkt auch während der Pause, bei
  offenen Rückfragen/Freigaben und während die Modell-Antwort läuft.
- Neuer Kanal `ws:abort`: Laufende Dateiwerkzeuge (Textsuche) werden beim Stopp tatsächlich abgebrochen
  und lesen keine weiteren Dateien mehr.

## Nachtrag (keine Programmänderung, Version bleibt 1.0.49)
- Alle Screenshots neu im hellen Standard-Design erstellt; das dunkle Design erscheint in der README nur
  noch einmal unter „Aussehen“.

## Geänderte Dateien
`renderer/js/app.js`, `main.js`, `preload.js`, `docs/HANDBUCH.md`, `package.json` (Version 1.0.49),
`docs/screenshots/`

---

# Update: Version 1.0.50

Vorgängerversion: 1.0.49 · Windows

## Neu
- **Rechtschreibprüfung im Chatfenster.** Falsch geschriebene Wörter im Eingabefeld erhalten die rote
  Wellenlinie (bisher abgeschaltet).
- **Rechtsklick-Menü** mit Rechtschreib-Vorschlägen (bis zu sechs), „Zum Wörterbuch hinzufügen“ sowie
  Ausschneiden/Kopieren/Einfügen/Alles auswählen in Eingabefeldern bzw. Kopieren bei markiertem Text –
  ein solches Menü gab es vorher nicht.
- **Sprachen wählbar:** Deutsch, Englisch oder beide (`applySpell()`). Kürzel werden gegen die
  vorhandenen Wörterbücher abgeglichen (zum Beispiel `de`, `de-DE`, `en-US`, `en-GB`).

## Neu (Einstellungen)
- Standardwerte `spell = { enabled: true, lang: 'de-en' }` und zwei Einstellungen unter Darstellung
  („Rechtschreibprüfung“, „Sprachen der Rechtschreibprüfung“). Gespeicherte Einstellungen ohne diese
  Werte übernehmen den Standard. Die Prüfung wird beim Start und bei jeder Änderung angewandt.

## Hinweis
- Die Wörterbücher lädt die Laufzeitumgebung unter Windows beim ersten Start selbst herunter (Internet
  nötig); danach läuft es lokal. Alle Screenshots zeigen jetzt v1.0.50 in der Titelleiste.

## Geänderte Dateien
`main.js`, `preload.js`, `renderer/index.html`, `renderer/js/settings.js`, `renderer/js/app.js`,
`docs/HANDBUCH.md`, `README.md`, `package.json` (Version 1.0.50), `docs/screenshots/`

---

# Update: Version 1.0.51

Vorgängerversion: 1.0.50 · Windows

## Behoben
- **„Chat konnte nicht gespeichert werden … ENOENT: rename ‚….json.tmp' → ‚….json'“.** Ursache: Jede
  Datei wurde über eine .tmp-Datei mit immer gleichem Namen geschrieben und dann umbenannt. Beim
  Antworten wird der Chat sehr oft gespeichert; überlappen sich zwei Vorgänge, ist die .tmp-Datei beim
  zweiten schon weg. Auf Netzlaufwerken, in Sync-Ordnern oder mit Virenscanner passiert das häufiger.
  Jetzt laufen Schreibvorgänge pro Datei strikt nacheinander (Warteschlange), jeder Vorgang nutzt einen
  eindeutigen .tmp-Namen, bei Fehlern bis zu fünf Wiederholungen mit kurzer Pause und zuletzt direktes
  Schreiben in die Zieldatei.
- **Die Antwort sprang beim Tippen hoch und runter**, während die KI arbeitete. Ursache: Das Eingabefeld
  wurde bei jedem Zeichen kurz auf `height:auto` zusammengeklappt; dadurch änderte sich die Höhe des
  Nachrichtenbereichs, der Browser klemmte die Scroll-Position ab, und das Mitlaufen zog die Ansicht
  wieder nach unten. Jetzt wird die Höhe über ein unsichtbares Spiegel-Feld gemessen und das echte Feld
  nur bei geänderter Zeilenzahl angefasst. Hat der Nutzer hochgescrollt, bleibt seine Leseposition erhalten.

## Geänderte Dateien
`main.js` (`writeJsonAtomic`), `renderer/js/app.js` (`autosize`), `package.json` (Version 1.0.51)

## Nicht bestätigt
- Nur mit Syntaxprüfung geprüft, nicht in einer echten Fenster-Oberfläche.

---

# Update: Version 1.0.52

Vorgängerversion: 1.0.51 · Windows (nur die Windows-Seite; die Android-App war noch nicht Teil dieser Version)

## Neu: Übertragung auf die Android-App
- Neue Einstellungsseite **„Übertragung“** (links zwischen „Daten“ und „Über“).
- `buildTransfer()` als gemeinsamer Baustein für QR-Code und JSON. Enthält alle Einstellungen
  (Verbindungen mit API-Schlüsseln, Modell, Parameter, System-Prompt, Kosten, Darstellung,
  Server/Strata, Workspace-Einstellungen wie Werkzeug-Schritte). Wählbar: Chats (keine / letzte 3 /
  letzte 10 / alle) und Workspace-Textdateien.
- **QR-Bildfolge:** Der Inhalt wird komprimiert und in QR-Bilder zu je 600 Zeichen geteilt, die
  automatisch im Kreis wechseln (1 bis 4 Bilder/s, Pause, Vor/Zurück). Nur Einstellungen ergeben etwa
  6 bis 12 Bilder. Ein einzelner QR-Code fasst höchstens rund 3 KB – „alles“ passt deshalb nur als
  Bildfolge oder JSON-Datei; ab 400 Bildern wird auf JSON verwiesen.
- **JSON-Export:** derselbe Inhalt als Datei (eingerückt, ohne Kürzung) über den Speichern-Dialog.
- Neue IPC-Handler `transfer:info`, `transfer:pack` (Komprimierung plus SHA-256-Prüfsumme) und
  `transfer:wsFiles` (Textdateien des Workspace mit Ignorierliste, Größen- und Mengengrenzen,
  Binärdateien übersprungen). Bridge: `api.transfer`. Neues Format dokumentiert in
  `docs/TRANSFER-FORMAT.md`.

## Grenzen dieser Version
- Nicht übertragen werden gerätebezogene Dinge (Fensterposition, Rechner-Kennung, gemeinsamer
  Chat-Ordner) und der SSH-Schlüssel selbst (nur sein Pfad). Workspace-Dateien gehen nur in der
  JSON-Datei mit, nur als Text. **Einen Import in die Windows-App gab es noch nicht** (nur Export).

## Sicherheitshinweis
- QR-Bilder und JSON-Datei enthalten API-Schlüssel im Klartext; der Hinweis steht im Dialog und im
  Handbuch.

## Geänderte Dateien
`renderer/js/transfer.js` (neu), `main.js`, `preload.js`, `renderer/vendor/qrcode.js` (neu,
qrcode-generator 1.4.4 MIT), `renderer/index.html`, `renderer/styles.css`, `renderer/js/settings.js`,
`docs/TRANSFER-FORMAT.md` (neu), `docs/HANDBUCH.md`, `README.md`, `package.json` (Version 1.0.52)

## Nicht bestätigt
- Geprüft: Syntax, Komprimierung, Prüfsumme, Zerlegung in Bilder, Wiedereinlesen in zufälliger
  Reihenfolge, QR-Erzeugung und Workspace-Auslese in Tests. Nicht geprüft in einer echten
  Fenster-Oberfläche und nicht mit einer echten Handy-Kamera.

---

# Update: Version 1.0.53

Vorgängerversion: 1.0.52 · Windows

**Zur Vollständigkeit:** Für diese Version ist im Projektverlauf **kein eigener Änderungsabschnitt
belegt**. Belegbar ist nur Folgendes:
- Die Quelle war zu diesem Stand bereits 1.0.53, und auf dem Rechner war 1.0.53 installiert
  (Programme-Ordner, gebaut am Morgen des 14. November).
- Enthalten waren zu diesem Zeitpunkt die Einstellungszeile „Max. Werkzeug-Schritte am Stück“
  (`workspace.maxSteps`, Standard 25) und der komplette Reiter „Übertragung“.
- Diese Installation enthielt beide in Version 1.0.54 behobenen Übertragungsfehler (siehe unten).

---

# Update: Version 1.0.54

Vorgängerversion: 1.0.53 · Windows

## Behoben („Im WLAN anbieten“ funktionierte nicht)
- **Fehlermeldung „ReferenceError: z is not defined“ genau beim Klick auf das Angebot.** Ursache: Der
  Handler `transfer:serveStart` berichtete die Größe über `z.length`, obwohl die Komprimierung bei der
  Text-Auslieferung vorher entfernt worden war. Gelöst durch `bytes: Buffer.byteLength(json)`; die
  Anzeige in `transfer.js` nutzt jetzt `r.bytes` mit dem Text „unkomprimiert als Text“.
- **Jeder Abruf antwortete „403 – Token passt nicht“.** Ursache: Die erzeugten Adressen endeten auf
  `#token`. Ein Fragment wird über HTTP aber nie an den Server gesendet. Gelöst durch `mkUrl()` mit
  dem Token als Query-Parameter `?t=` (URL-codiert).

## Geänderte Dateien
`main.js`, `renderer/js/transfer.js`; Build nachgewiesen als Setup und portable Version 1.0.54.

---

# Update: Version 1.0.55

Vorgängerversion: 1.0.54 · Windows (Android-Anteile getrennt genannt)

## Behoben
- **Übernommene Einstellungen waren erst nach einem Neustart wirksam.** Die Einstellungsdatei wurde
  korrekt geschrieben, aber die laufende Oberfläche behielt ihren beim Start geladenen Stand –
  Verbindung, Modell und Werkzeuge blieben sichtbar unverändert. Zusätzlich schrieb der verzögerte
  Speicher-Vorgang (`saveSettings()`, ausgelöst durch `refreshModelInfo()`) kurz danach den alten Stand
  zurück. Nachgewiesen mit einem Vergleichswerkzeug: die Dateien waren identisch, der Fehler lag im
  Neuladen der Oberfläche.

## Neu
- `applyIncomingSettings()` in `renderer/js/app.js`, aufgerufen nach einer Übernahme aus
  `transfer.js`: Verbindung, Modell und Werkzeuge sind danach **sofort** wirksam, ohne App-Neustart.

## Geänderte Dateien
`renderer/js/app.js`, `renderer/js/transfer.js`; Build nachgewiesen als Setup und portable Version 1.0.55.

## Android-Anteil (nicht in Windows)
- Die Übernahme nutzt ein tiefes Zusammenführen statt flachem Ersetzen, damit geräteeigene Schlüssel
  erhalten bleiben; die Rückmeldung nennt übertragene Verbindungen, aktive Verbindung und Modell. Die
  Enter-Regel wird auf dem Handy nicht mehr umgeschrieben (Geräte-Einstellung bleibt).

---

# Update: Version 1.0.56

Vorgängerversion: 1.0.55 · Windows

## Behoben
- **„Im WLAN anbieten“ war nur einmal benutzbar; das zweite Gerät bekam „HTTP 0“.** Ursache: Nach dem
  Abruf wurde nur der HTTP-Dienst geschlossen, das **Rufsignal im WLAN (UDP)** blieb gebunden. Ein
  suchendes Handy fand dadurch die tote Adresse des bereits abgerufenen Rechners und erhielt keine
  Daten.

## Behoben durch
- `stopTransferServe(onlyForServer)` beendet jetzt beide Anteile, und zwar an drei Stellen: nach dem
  Abruf (mit kurzer Verzögerung), beim Ablauf des Zeitlimits und beim manuellen Stoppen. Dasselbe
  Verhalten setzt der Test-Dienst jetzt um, damit der Fehler reproduzierbar bleibt.

## Geänderte Dateien
`main.js`; Build nachgewiesen als Setup und portable Version 1.0.56.

---

# Update: Version 1.0.57

Vorgängerversion: 1.0.56 · Windows (Wirksam in beiden Oberflächen, weil die Einstellungsseite auch im
Android-Build verwendet wird)

## Neu: wählbarer Abgleich-Rhythmus
- Neue Einstellung **„Chats abgleichen alle …“** mit Stufen von 2 Sekunden bis 30 Minuten
  (2 s / 5 s / 10 s / 30 s / 1 min / 5 min / 10 min / 30 min), ohne Neustart wirksam. Der Wert liegt in
  der Abgleich-Konfiguration, nicht in den App-Einstellungen; die Statuszeile zeigt die gewählte Stufe.
- Neuer Kanal `sync:setEvery` mit Bereichsprüfung (1 Sekunde bis 30 Minuten, Standard 2 Sekunden) und
  `sync.get` für den aktuellen Wert.

## Verbessert
- Der bisher feste Drei-Sekunden-Takt ist durch einen **selbst nachplanenden Timer** ersetzt
  (`pollChats()` + `schedulePoll()`). Nur so greift eine längere Einstellung sofort; ein überholter
  Durchlauf plant nicht mehr nach.
- Beim Zurückkehren ins Fenster wird sofort abgeglichen (`focus`-Ereignis des Fensters), damit Änderungen
  von anderen Geräten ohne Wartezeit sichtbar werden.

## Geänderte Dateien
`main.js`, `preload.js`, `renderer/js/settings.js`; Build nachgewiesen als Setup und portable Version
1.0.57. Tests: 170 Prüfungen, 0 Fehler.

## Android-Anteil
- Dieselben Konstanten und Kanäle in der portierten Kernschicht. In dieser Zeit wurde außerdem eine
  zweite, parallel laufende Abgleich-Kette gefunden und mit einer Generations-Marke (`pollGen`) behoben.

---

# Update: Version 1.0.58

Vorgängerversion: 1.0.57 · Windows (Android-Anteile getrennt genannt)

## Behoben
- **Gesperrte Chat-Metadaten galten als „gelöscht“.** Ließ sich eine Meta-Datei nicht lesen (weil ein
  anderes Programm oder ein Netzlaufwerk sie blockiert), verschwand der Chat aus der Liste und die ganze
  Liste wurde neu aufgebaut. Jetzt gilt: Nur „Datei existiert nicht“ ist ein Entfernen, alle anderen
  Fehler gelten als **gesperrt**. `listMetas()` liefert `{ metas, blockiert }`, ein Zwischenspeicher
  (`metaCache`, Schlüssel enthält den Ordner) verwendet im Sperrfall den zuletzt erfolgreich gelesenen
  Stand, und die Liste der entfernten Chats schließt gesperrte IDs ausdrücklich aus. Angepasst wurden
  alle drei Aufrufer (Chatliste, Umzug in einen gemeinsamen Ordner, Abgleich).
- `schedulePoll()` bekam denselben Fix wie die Android-Seite: synchrone Planung plus Generations-Marke,
  damit sich in Windows keine zweite Abgleich-Kette bilden kann.

## Ehrliche Einordnung (aus eigener Messung)
- Der Verdacht, gesperrte Meta-Dateien seien die Ursache für das Zögern großer Chats, wurde **durch
  Messung widerlegt**: Die betroffenen Dateien waren dauerhaft gesperrt und gehörten zu Chats ohne
  zugehörige Chat-Datei – sie flatterten also nicht. Der Fix bleibt sinnvoll (vermeidbarer Neuaufbau,
  richtiger Vergleichswert), war aber nicht die Lösung für die Bremse. Die eigentliche Ursache wurde in
  Version 1.0.59 behoben.

## Geänderte Dateien
`main.js`; Build nachgewiesen als Setup Version 1.0.58. Tests: 53 Prüfungen im Abgleich-Test, 0 Fehler.

## Android-Anteil
- Dieselbe Korrektur in der portierten Kernschicht (dort kommen Fehler als Text zurück, deshalb prüft der
  Code auf den Meldungstext). Zusätzlich behoben: **weißer Block beim Start** – das
  Arbeitsbereichs-Panel startete offen im kopierten HTML und wurde erst nach dem Laden geschlossen; ein
  Build-Patch setzt es jetzt von Anfang an auf geschlossen. Das helle Startthema blieb bewusst erhalten.

---

# Update: Version 1.0.59

Vorgängerversion: 1.0.58 · Windows (gilt auch für Android, weil die Oberfläche in den Android-Build
übernommen wird)

## Behoben / verbessert: sehr große Chats deutlich schneller
- **Ursache der Bremse:** Der Nachrichtenbereich wurde bei jedem Aufbau vollständig geleert und jede
  Nachricht einzeln neu angehängt. Gemessen an einem echten Chat mit 3402 Nachrichten: 2966 Millisekunden
  und rund 110.000 DOM-Knoten pro Aufbau – jeder folgende Layout-Durchlauf war dadurch teuer (Zögern beim
  Öffnen, bei Panel-/Dock-Änderungen und beim Übergeben an die KI).
- **Neu: fensterweiser Aufbau.** Aufgebaut werden nur die sichtbaren Nachrichten
  (`MSG_VOLL = 60`, `MSG_KOMPAKT = 200`, `MSG_SCHRITT = 100`); weiter oben stehen kompakte Zeilen und
  eine Sammelzeile „ältere anzeigen“. Dazu ein Scrollpositions-Halt, damit die Ansicht beim Nachladen
  nicht springt.
- **Gemessener Erfolg:** dieselben 3402 Nachrichten jetzt in 60 Millisekunden und rund 2760 Knoten; am
  größten echten Chat (13 MB, 3487 Nachrichten) bleibt der Aufbau konstant bei etwa 2755 Knoten.
- Entlastend gemessen: Tippen war nicht die Ursache – 100 Tastenanschläge bei 3402 Nachrichten kosten
  149 Millisekunden, es wird pro Tastendruck nicht neu gerendert.

## Geänderte Dateien
`renderer/js/app.js`, `renderer/styles.css`; Build nachgewiesen als Setup Version 1.0.59 (der Fix war in
1.0.58 noch nicht enthalten).

## Wichtiger Nebenbefund
- Ein großer Teil der gemeldeten Bremse stammte davon, dass eine **alte installierte Version** ohne diese
  Korrekturen in Benutzung war – nachgewiesen durch Vergleich der Paketinhalte. Diagnose vor weiteren
  Änderungen: erst die installierte Version prüfen.

## Android-Anteil
- Version 1.0.59-android auf beiden Geräten installiert; weißer Startblock beseitigt; Testsuite zu diesem
  Stand 191 Prüfungen, 0 Fehler.

---

# Update: Version 1.0.60

Vorgängerversion: 1.0.59 · Windows

## Behoben
- **Nachträgliche Generations-Marke im Abgleich nachgebaut.** Die Dokumentation beschrieb sie, der
  Windows-Code hatte sie nicht: Ein überholter Abgleich-Durchlauf konnte erneut nachplanen und damit eine
  zweite Kette erzeugen. Jetzt plant ein Durchlauf nur weiter, wenn er noch zur aktuellen Generation
  gehört; dazu eine abgefangene Fehlerkette, damit ein fehlgeschlagener Durchlauf die Kette nicht beendet.

## Ehrliche Einordnung
- Wirkt nur beim Wechsel des Abgleich-Rhythmus während eines laufenden Abgleichs. Es war **nicht** die
  Ursache der Chat-Bremse (die war schon in 1.0.59 behoben).

## Geändert / geprüft
- Neuer Regressionstest für den Abgleich-Timer (Prüflauf 8 der Testsuite). Zu diesem Stand: 208
  Prüfungen, 0 Fehler. Zusätzlich gemessen: CPU-Leerlauf 1,2 %, kein Flattern der Chatliste,
  Paketinhalt byte-genau vergleichbar.

## Geänderte Dateien
`main.js`; Build nachgewiesen als Setup Version 1.0.60 (im Paket verifiziert). Auf dem Rechner blieb
zunächst 1.0.59 in Benutzung.

## Android-Anteil
- Die Android-Version wurde bewusst **nicht** erhöht: die portierte Kernschicht hatte diesen Fix bereits.

---

# Update: Version 1.0.61

Vorgängerversion: 1.0.60 · Windows (Windows-Seite erstmals)

## Neu: Windows-Freigabe als Arbeitsordner
- Eigener Speicher für Freigabe-Zugangsdaten unter `%APPDATA%\LLM Box` (`smb.json`, getrennt von den
  App-Einstellungen). Helfer `smbHostOf()` und `smbPartsOf()` zerlegen eine UNC-Adresse; neue Kanäle:
  Zugangsdaten holen/speichern, für die Übertragung bereitstellen, bekannte Rechner auflisten und eine
  Verbindung **prüfen**. Bridge: `api.smb`.
- Neue Zeile im Reiter „Workspace & Dateien“: Adresse, Benutzer, Domain, Passwort und der Knopf
  **„Verbinden & übernehmen“** – ein Netzlaufwerk wird direkt als Arbeitsordner genutzt, ohne Kopieren.

## Neu bei der Übertragung
- Das Feld `smb` überträgt Rechner, Freigabe, Unterordner, UNC-Pfad, Benutzer, Domain und Passwort mit
  (Haken „Netzwerkordner (SMB) samt Zugangsdaten“), mit Rückmeldung nach der Übernahme.

## Behoben
- **Workspace-Dateien wanderten im WLAN-Weg bisher nie mit.** Ursache: Der Auslieferungsdienst rief den
  Baustein ohne die Option für Workspace-Dateien auf. Jetzt wird er wie beim QR- und JSON-Weg mit allen
  Inhalten gebaut.

## Geänderte Dateien
`main.js`, `preload.js`, `renderer/js/settings.js`, `renderer/js/transfer.js`; Build nachgewiesen als
Setup Version 1.0.61 (enthält noch nicht den eigenen QR-Scan).

## Android-Anteil
- Dieselben Freigabe-Kanäle in der portierten Kernschicht; das Handy gibt bewusst **kein** Passwort
  heraus. Übernahme-Reihenfolge überarbeitet; Version 1.0.61-android auf beiden Geräten installiert.

---

# Update: Version 1.0.62

Vorgängerversion: 1.0.61 · Windows (die neue Scan-Funktion wirkt nur auf dem Handy)

## Neu (nur Android wirksam)
- **Die App scannt QR-Codes selbst mit der Handy-Kamera**, ohne zusätzliche QR-App. Eingebaut wurde ein
  QR-Decoder in das Web-Bundle; dazu `scanQr()`, `qrVerwerten()` und der Knopf „QR-Code scannen …“.
  Erkannt wird die Adresse des WLAN-Angebots ebenso wie eine mehrteilige Bildfolge; fremde Codes werden
  nur angezeigt, nicht übernommen. Kamera-Berechtigung und -Vorschau sind im Manifest vorbereitet.

## Verbessert
- Der Hilfetext „… mit einer beliebigen QR-App lesen“ wurde durch eine zutreffende Beschreibung ersetzt.
  In der Windows-Oberfläche erscheint der Scan-Knopf bewusst nicht (dort wird gescannt, nicht angeboten).

## Behoben
- **Die Kamera blieb nach einem Abbruch belegt** und der Scan-Knopf dauerhaft ausgegraut: Der Suchlauf
  stoppt jetzt sofort und gibt die Kamera frei.

## Geänderte Dateien
`webdeps/bundle-entry.js`, `renderer/js/transfer.js`, `renderer/js/util.js`; Build nachgewiesen als Setup
und portable Version 1.0.62 (im Paketinhalt verifiziert; auf dem Rechner war zunächst eine ältere Version
in Benutzung). Neuer Prüfstand für den QR-Scan mit 47 Prüfungen.

## Android-Anteil
- Version 1.0.62-android auf beiden Geräten installiert, Kamera-Berechtigung am Gerät bestätigt. Ein
  Java-Fehler beim Einbau (Ressourcen werden als Zeichenketten übergeben) wurde behoben. Dokumentation:
  `docs/TRANSFER-FORMAT.md` beschreibt den Netzwerkordner ab 1.0.61 und den eigenen QR-Scan ab 1.0.62.

---

# Update: Version 1.0.63

Vorgängerversion: 1.0.62 · Windows (Android-Korrekturen im selben Build)

## Behoben
- **Ein gemapptes Netzlaufwerk wurde als Rechner fehlgedeutet.** Aus einem als Laufwerksbuchstaben
  eingebundenen Netzlaufwerk wurde ein frei erfundener Rechner namens „Y:“ abgeleitet – die Übergabe des
  Netzwerkordners scheiterte daran. Neu in `main.js`: `uncOfLaufwerk()` fragt die echte Freigabe ab
  (Windows-Abfrage für Laufwerkszuordnungen, Rückfall über die Konsolenabfrage), `smbPartsAufgeloest()`
  nutzt sie, und der Kanal `smb:resolve` stellt sie der Oberfläche bereit. Die Zerleger lehnen einen
  einzelnen Laufwerksbuchstaben jetzt ausdrücklich ab; „Verbinden & übernehmen“ und „Prüfen“ arbeiten mit
  der aufgelösten Freigabe.

## Behoben (Android-Anteil, im selben Build enthalten)
- **Der Scan-Dialog schloss nie** – er wurde über den falschen Mechanismus beendet (Rückgabe des
  Dialogobjekts statt Aufruf von `close`).
- **Der Knopf blieb ausgegraut**, wenn der Dialog über Kreuz oder Escape geschlossen wurde (der
  Abschluss wurde nicht ausgeführt).
- Ein durch den Test gefundener Programmierfehler (`const`-Variable später zugewiesen) wurde entfernt.

## Geänderte Dateien
`main.js`, `preload.js`, `renderer/js/util.js`; Build nachgewiesen als Setup Version 1.0.63 (im
Paketinhalt verifiziert). Neuer Prüfstand für Übernahme und Scan mit 36 Prüfungen; Stand der Suite zu
diesem Zeitpunkt: 9 Prüfläufe, 291 Prüfungen, 0 Fehler.

## Wichtiger Hinweis aus der Praxis
- Ohne hinterlegte Freigabe-Zugangsdaten kann die Übernahme eines Netzwerkordners nicht gelingen (die
  Anmeldung wird abgelehnt). Zugangsdaten gehören nicht in das Repository.

---

# Update: Version 1.0.64

**Zur Vollständigkeit:** Für Windows ist **kein eigener Build und kein Änderungsabschnitt belegt** – die
Nummer 1.0.64 existiert nur als Android-Version (`1.0.64-android`). Die Windows-Änderungen dieses Zeitraums
stecken in 1.0.63.

## Android-Anteil (1.0.64-android)
- **Schwarze Kamera-Vorschau** auf manchen Handys behoben. Ursache war nicht die Berechtigung, sondern
  eine Wiedergaberegels der App: Die Vorschau durfte ohne Nutzeraktion nicht starten. Behoben durch die
  entsprechende Einstellung am Web-View (nachgemessen an einer Geräte-Sonde mit korrekter Auflösung).
- Abbruch eines Scans gibt die Kamera wieder frei; der Scan-Knopf bleibt nicht dauerhaft ausgegraut.
- Der Scan-Dialog bleibt nicht mehr stehen.

---

# Update: Version 1.0.65

Vorgängerversion: 1.0.63 (Windows) bzw. 1.0.64-android · Windows und Android

## Android
- **Einheitliche Kopfzeile:** Der Knopf „Modelle neu laden“ ist auf dem Handy nicht mehr sichtbar –
  Modelle werden beim Start, bei einem Verbindungswechsel und beim Schließen der Einstellungen ohnehin
  neu geladen. Die Kopfzeile bleibt dadurch einzeilig statt zweizeilig (gemessen: 168 px → 87 px), die
  Auswahlfelder bleiben unverändert lesbar. Der Knopf wird nur ausgeblendet, nicht aus dem Aufbau
  entfernt, weil ihn andere Stellen der Oberfläche direkt ansprechen; die Breitenberechnung der Kopfzeile
  rechnet ihn nicht mehr ein.
- Der Verbindungstest in den Einstellungen empfiehlt nicht mehr einen Knopf, den es auf dem Handy nicht
  gibt (eigener Hinweis).

## Windows
- Diese Version ist im Wesentlichen der **Veröffentlichungsstand**: Aufbau aus einer bereinigten Quelle,
  Geräte-Sonden zur Fehlerdiagnose entfernt, Beispielwerte und Platzhalter neutralisiert. Neue
  Funktionen kamen für Windows nicht hinzu.

## Geänderte Dateien (Android-Anteil)
`tools-android/android.css`, `tools-android/android-adapter.js`; Version in `android/app/build.gradle`
auf 1.0.65-android gesetzt, Windows-Version in `package.json` auf 1.0.65. Stand der Testsuite:
10 Prüfläufe, 297 Prüfungen, 0 Fehler – die Suite läuft damit auch auf einem Rechner ohne gemapptes
Netzlaufwerk durch.

---

# Update: Version 1.0.66

Vorgängerversion: 1.0.65 · Windows (Oberfläche, wirkt über den Android-Build auch auf dem Handy)

Diese Version macht die **Sprachauswahl Deutsch / English / Français** vollständig, behebt die
**vorzeitigen Abbrüche der KI im Werkzeugmodus** bei kleinen, stark quantisierten Modellen (z. B. IQ3) und
bringt ein **einheitliches Raster für alle Einstellungen**. Grundlage ist der Vergleich mit dem Archiv
`llm-box63` (Diff `llm-box-v67.diff`, kumulativ); die Sprachschicht war dort bereits angelegt, aber unvollständig und
fehlerhaft.

## Neu

### Sprachauswahl (Deutsch, English, Français)
- **Einstellungen → Darstellung → „Sprache der App“.** Die Sprache gilt für die gesamte Oberfläche:
  Beschriftungen, Knöpfe, Hilfetexte, Dialoge, Statuszeile, Tooltips, Fehler- und Statusmeldungen, das
  Server-Fenster, die Übertragung und die Platzhalter im Eingabefeld. Die KI antwortet ebenfalls in dieser
  Sprache (Systemprompt und Werkzeugbeschreibungen gibt es in allen drei Sprachen).
- Die Sprachnamen in der Auswahl bleiben immer in der eigenen Sprache stehen („Deutsch“, „English“, „Français“).
- **Chat-Inhalt wird nie übersetzt.** Nachrichten, Code und Dateivorschauen bleiben, wie sie geschrieben wurden;
  die Knöpfe und Hinweiskarten darin werden übersetzt.
- Das Wörterbuch umfasst jetzt **1.036 Einträge und 150 Muster** (Texte mit eingebetteten Werten, z. B.
  Zahlen und Fehlermeldungen) mit je englischer und französischer Fassung. Neu ist die Datei
  `i18n-lex-full.js` mit rund 590 zusätzlichen Einträgen (Server & Monitor, Übertragung, Einstellungen,
  Fehlermeldungen, Farbschema, Nachrichten-Fußzeile, Statuszeile, Menüs, Werkzeugbeschreibungen).
- Die Übersetzung erkennt jetzt auch **mehrzeilige Tooltips** (Zeile für Zeile), **mehrsätzige Hilfetexte**
  (Satz für Satz) und zusammengesetzte Meldungen (bekannte Bruchstücke werden ersetzt).
- Reine KI-Texte (Übergabe-Prompts, Rückmeldungen der Werkzeuge an das Modell) sowie Eigennamen und
  technische Begriffe bleiben bewusst unübersetzt.

### Modellprofil für kleine, stark quantisierte Modelle (IQ3/Q3)
- Neues Auswahlfeld **„Modellprofil“** mit Knopf „Profil anwenden“ unter *Einstellungen → Modell &
  Parameter*. Zwei Profile: „Kleines / stark quantisiertes Modell (IQ3/Q3)“ und „Standard (große oder
  Cloud-Modelle)“.
- **Profil IQ3:** Temperatur 0,3 · Top-P 0,9 · Top-K 20 · Min-P 0,05 · Wiederholungsstrafe 1,0 ·
  Max. Antwortlänge 12288 · Arbeitskontext-Obergrenze 64000 · Kontext-Budget 80 % · letzte
  Werkzeug-Ergebnisse 4 · Übergabe-Hinweis ab 60 % · 40 Werkzeug-Schritte am Stück · 8 Schritte je Unteragent.
- Das IQ3-Profil ist der **Standard für neue Installationen**. Bestehende Installationen bekommen es beim
  ersten Start **genau einmal** (Merker `profileIq3V65`); danach gelten die eigenen Werte. Das Standard-Profil
  setzt die früheren Werte zurück (Temperatur 0,7, Top-K 40, Wiederholungsstrafe 1,1, 25 Schritte).
- Steht eine Verbindung auf „Sampling dem Server überlassen“, wirken Temperatur, Top-K und Co. nicht; dann
  zählen nur die Kontext- und Schritt-Werte.
- **Neu: Arbeitskontext-Obergrenze (Tokens)** unter *Workspace & Dateien* (Einstellung
  `workspace.ctxSoftCap`, Standard 64000, 0 = nur das Server-Fenster zählt).
- **Kurzer System-Prompt und kurze Werkzeugbeschreibungen im IQ3-Profil.** Der ausführliche Standard-Prompt
  kostete mit Bausteinen und Werkzeugdefinitionen rund **4.000 Tokens je Anfrage** (System ≈ 1.560, Werkzeuge
  ≈ 2.420), bevor die Aufgabe beginnt. Die Kurzfassung (Deutsch, Englisch, Französisch) braucht rund
  **2.500 Tokens** (System ≈ 680, Werkzeuge ≈ 1.860), also etwa 1.400 weniger. Das Profil „Standard“ behält die
  ausführlichen Texte. Bewusst weggelassen sind zwei Anweisungen, die kleinen Modellen schaden: „mehrere
  parallele Unteragenten statt seriell“ (die Berichte füllen den Hauptkontext) und „Änderungen.md zu Beginn
  komplett lesen“ (die Datei wird schnell mehrere tausend Zeilen lang); stattdessen wird nur das Ende gelesen.
- **Der Standard-Prompt folgt der Sprache.** Das Feld „System-Prompt“ zeigte bisher immer den deutschen Text,
  obwohl beim Senden eine andere Fassung ging. Ein **unveränderter** Standard-Prompt wird jetzt bei
  Sprachwechsel, Profilwechsel und beim Start durch die Fassung für Sprache und Profil ersetzt, sodass das Feld
  zeigt, was tatsächlich gesendet wird. **Eigene Prompts bleiben unberührt** (sie bekommen nur die Sprachregel).
  Neuer Knopf **„Standard-Prompt wiederherstellen“** (*Modell & Parameter*). Bestehende Installationen werden
  einmalig angeglichen (Merker `promptSyncV66`).

## Behoben

### KI bricht im Werkzeugmodus ab
- **Ursache 1:** Die automatische Aufforderung „Du hast einen nächsten Schritt angekündigt“ erkannte nur
  Antworten, die auf „:“, „…“ oder „...“ endeten. Abgebrochene Antworten endeten aber auf einen Punkt
  („Ich baue jetzt den Test.“) und wurden nie nachgefasst. `looksUnfinished()` erkennt Ankündigungen jetzt
  auch mit Punkt (Deutsch, Englisch, Französisch), ignoriert Rückfragen, lange Antworten und
  Abschlussmeldungen („Ich habe …“, „Fertig“). Die Aufforderung wird bis zu **3 Mal** in Folge gesendet
  (vorher 2) und steht in der Sprache der Oberfläche.
- **Ursache 2:** Komprimierung (80 %) und Übergabe-Hinweis (70 %) richteten sich nach dem **Server-Fenster**.
  Bei einem großen Fenster (z. B. 262k) griffen sie erst bei etwa 180k Tokens, weit über der Grenze, ab der
  stark quantisierte Modelle Werkzeugaufrufe vergessen und Details erfinden. Sie richten sich jetzt nach dem
  kleineren Wert aus Server-Fenster und Arbeitskontext-Obergrenze (`effCtx()`).
- **Ursache 3:** Der Systemprompt enthielt keine Regel gegen „ankündigen ohne handeln“. Neuer Baustein
  (`actHint`, in drei Sprachen): Schritte nie nur ankündigen, ohne Werkzeugaufruf nur bei vollständig
  erledigter Aufgabe oder Rückfrage, keine Dateinamen, Schlüssel oder Texte erfinden – vorher lesen.

### Sprachschicht
- **Leere, hängende Oberfläche in Englisch/Französisch:** Der Beobachter, der Texte beim Einfügen übersetzt,
  bekam seine eigenen Änderungen zurückgemeldet, setzte dabei den Merker für den Originaltext auf `null`, und
  `T(null)` lieferte einen leeren Text. Der Knoten wurde geleert, löste die nächste Meldung aus und so weiter
  (Endlosschleife). Jetzt merkt sich jeder Knoten den zuletzt selbst geschriebenen Text und ignoriert dessen
  Rückmeldung. Der Wechsel Deutsch → Englisch → Französisch → Deutsch stellt das Fenster wieder exakt her.
- **Abbruch mitten in der Übersetzung:** Ein `TypeError` bei losgelösten Textknoten (`parentElement` ist
  `null`) brach den Rest eines Beobachter-Stapels ab; einzelne Texte blieben deshalb deutsch.
- **Muster ohne Endanker** schnitten den Rest eines Satzes ab (z. B. „… Chat(s) kopiert, 2 waren schon
  vorhanden“). Sechs Muster in `i18n-lex.js`, `-hints.js`, `-settings.js` und `-extra.js` korrigiert.
- **Platzhalter im Eingabefeld** („Nachricht schreiben … (Dateien per Drag & Drop oder Strg+V)“) blieb
  deutsch, weil Eingabefelder (`textarea`) komplett übersprungen wurden. Platzhalter und Tooltips werden
  jetzt übersetzt; der eingetippte Inhalt bleibt unangetastet.

### Einstellungen
- **Absturz im Reiter „Daten“:** Steht beim Abgleich-Rhythmus ein Wert ohne exakte Stufe (z. B. 3000 ms), brach
  `syncEveryRow()` mit einem `TypeError` ab, weil die Suche mit einer Zahl statt einem Objekt startete.

## Verbessert

### Einstellungen: einheitliches Raster
- **Dialog größer** (bis 1120 × 800 Pixel); die Navigation ist breiter, Reiternamen brechen nicht mehr um.
- **Zwei Spalten pro Zeile:** links Beschriftung und Hilfetext (nimmt die restliche Breite, Umbruch erst am
  Zeilenende, nicht mehr nach etwa fünf Wörtern), rechts eine Steuerungsspalte fester Breite (höchstens
  380 Pixel, bei schmalerem Fenster 46 % der Reiterbreite, mindestens 300 Pixel).
- **Alle Eingabefelder, Auswahlfelder und Knöpfe** haben dieselbe Breite, 36 Pixel Höhe, gleiche Rundung und
  Schrift. Gemessen über alle Reiter, drei Sprachen und zwei Fensterbreiten (1280 und 1100 Pixel): je Reiter
  exakt gleiche Breite, kein seitliches Überlaufen.
- **Reiter „Verbindungen“:** Die Liste steht als Chip-Leiste über dem Formular statt links in einer
  schmalen Restspalte, das Formular nutzt die volle Breite.
- **Farbzeilen** sind ein festes Raster (Farbe, Hex-Wert, „Standard“-Knopf, Regler, Deckkraft); bei der
  Akzentfarbe stehen Regler und sechs Farbpunkte in einer Reihe.
- **Zeilen mit mehreren Feldern** (Netzwerkordner): gleichmäßiges 3-Spalten-Raster. Beim Workspace-Ordner
  behalten Pfadtext und Knopf ihre natürliche Breite.
- **Schmale Fenster:** Unter 640 Pixel Reiterbreite eine Spalte, unter 760 Pixel Fensterbreite
  Vollbild-Dialog mit Symbol-Navigation (gilt auch für die Handy-Oberfläche).
- Die Änderungen stehen als **eigener Block am Ende von `styles.css`**; bestehende Zeilen sind unverändert,
  weil der Android-Build in dieser Datei feste Textstellen sucht.

## Geänderte Dateien
`renderer/js/i18n.js` (+70/−8), `renderer/js/i18n-lex-full.js` (neu, +693), `renderer/js/i18n-lex-ctx.js`
(neu), `renderer/js/i18n-lex.js`, `i18n-lex-hints.js`, `i18n-lex-settings.js`, `i18n-lex-extra.js` (je
Mustern korrigiert), `renderer/js/i18n-prompts.js` (Baustein `actHint`), `renderer/js/app.js` (+32/−6:
Erkennung von Ankündigungen, `effCtx()`, Nachfass-Text je Sprache, einmalige Profil-Anwendung beim Start),
`renderer/js/handoff.js` (Füllstand nach wirksamem Fenster), `renderer/js/settings.js` (Profile,
Auswahlfeld, Arbeitskontext-Obergrenze, Abgleich des Standard-Prompts, Knopf „Standard-Prompt
wiederherstellen“, Sprachnamen geschützt, Korrektur `syncEveryRow()`), `renderer/js/i18n-prompts.js`
(Kurzfassungen von Prompt, Bausteinen und Werkzeugbeschreibungen), `renderer/js/i18n.js` (Werkzeugbeschreibungen
je Profil),
`renderer/index.html` (zwei Skripte eingebunden), `renderer/styles.css` (+101, nur angehängt),
`GEAENDERTE-DATEIEN.txt` (Protokoll). **Hinweis zur Versionsnummer:** `package.json` steht auf **1.0.66**
(die Nummer 1.0.65 ist in dieser Chronik schon vergeben); eine Android-Version müsste beim Bauen
entsprechend gesetzt werden.

## Geprüft und nicht geprüft
- **Geprüft** (simulierter Browser mit Attrappe der Electron-Schnittstelle, echte `index.html` und alle
  Skripte): Start ohne Fehler; Wechsel Deutsch → Englisch → Französisch → Deutsch ergibt das Hauptfenster
  Byte für Byte wieder; alle 8 Einstellungsreiter, 4 Server-Reiter, Strata-Import, Denken- und
  Freigabe-Menü und ein Chat mit Werkzeugkarten, Fehler- und Hinweisleiste: **0 deutsche Reste** in Englisch
  und Französisch (übrig bleiben nur Eigennamen und technische Begriffe). Profilwerte, Profilwechsel per
  Knopf, Sprachauswahl und der Abgleich des Standard-Prompts (neue und bestehende Installation, eigener
  Prompt, Profilwechsel, Wiederherstellen-Knopf) wurden getestet. Die Erkennung von Ankündigungen wurde an 20 Beispielsätzen
  geprüft (12 echte Abbrüche, 8 Abschlüsse/Rückfragen).
- **Layout** in Chromium geprüft (Screenshots und Messung, auch dunkles Design, Server-Fenster und
  700-Pixel-Fenster).
- **Nicht geprüft:** ein echtes Electron-Fenster, Meldungen, die nur bei echten Serverfehlern erscheinen
  (übersetzt, aber nicht am Bildschirm gesehen), und die **Android-Oberfläche** (WebView). Die
  Android-Build-Patches in `build-android.ps1` konnten nicht gelaufen werden; sie melden fehlende Suchtexte
  laut. Ob das IQ3-Profil mit dem kurzen Prompt die Abbrüche im Dauerbetrieb tatsächlich verringert, zeigt erst der Einsatz.

---

# Update: Version 1.0.67

Vorgängerversion: 1.0.66 · Windows (Oberfläche, wirkt über den Android-Build auch auf dem Handy)

## Neu
- **Sprachauswahl beim allerersten Start.** Beim ersten Aufruf der Anwendung erscheint ein Dialog „Sprache
  wählen · Choose your language · Choisissez votre langue“ mit **Deutsch, English und Français**. Er ist
  dreisprachig und wird nie übersetzt.
  - **Nur beim ersten Start:** Der Dialog erscheint nur, wenn noch nie Einstellungen gespeichert waren (neue
    Installation). Bestehende Installationen sehen ihn nicht und behalten ihre Sprache.
  - **Vorschlag nach Systemsprache** (hervorgehoben, Fokus darauf): Deutsch → Deutsch, Französisch →
    Français, jede andere Sprache → English. Bedienung per Klick, Enter oder Pfeiltasten.
  - **Nicht wegklickbar:** Escape und ein Klick neben den Dialog schließen ihn nicht; der Fokus bleibt im
    Dialog (das Eingabefeld holt sich beim Start sonst den Fokus). So wird die Wahl nicht übersehen.
  - **Die Wahl gilt sofort für alles:** Oberfläche, Antwortsprache der KI und der Standard-Prompt (in der
    gewählten Sprache, kurz im IQ3-Profil). Sie wird **sofort gespeichert**, nicht erst nach der
    Verzögerung des normalen Speicherns, und beim nächsten Start erscheint der Dialog nicht mehr.
  - Beim allerersten Start entfällt die Hinweismeldung zum Modellprofil (die Werte sind dort ohnehin schon
    der Standard).
  - Später änderbar unter *Einstellungen → Darstellung → Sprache der App* (Hinweis steht im Dialog).

## Geänderte Dateien
`renderer/js/settings.js` (`showLanguageChooser()`, `applyProfileOnce(silent)`), `renderer/js/app.js`
(Erkennung des ersten Starts in `init()`), `renderer/styles.css` (neuer Block am Dateiende),
`package.json` (Version 1.0.67), `GEAENDERTE-DATEIEN.txt` (Protokoll).

## Geprüft und nicht geprüft
- **Geprüft** (Chromium, echte `index.html`): Dialog nur beim allerersten Start; Vorschlag nach Systemsprache
  (Englisch, Deutsch, Französisch, Spanisch → English); Escape und Hintergrundklick schließen nicht;
  Pfeiltasten, Enter und Klick; die Wahl wird sofort gespeichert und setzt Oberfläche und Prompt; Neustart
  ohne Dialog; bestehende Installation ohne Dialog; kein Hinweis-Toast; helles und dunkles Design.
  Alle früheren Prüfungen (Übersetzung, Profil, Prompt, Raster) laufen weiter fehlerfrei.
- **Nicht geprüft:** ein echtes Electron-Fenster und die Android-Oberfläche. Auf dem Handy muss der
  Speicher beim ersten Start ebenfalls „leer“ melden, damit der Dialog erscheint.
