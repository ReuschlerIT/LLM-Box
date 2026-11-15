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
