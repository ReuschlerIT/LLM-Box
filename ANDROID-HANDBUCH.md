# LLM Box für Android – Handbuch

Android-Version der Desktop-App „LLM Box“ (gleiche Oberfläche, gleiche Funktionen bis auf die
unten genannten Ausnahmen). Stand: Version 1.0.67-android.

Neu ab dieser Fassung (Auswahl): Oberfläche in **Deutsch, Englisch, Französisch** (Beim allerersten
Start fragt die App nach der Sprache; später umschaltbar unter Einstellungen → Darstellung →
Sprache), **Modellprofil „Kleines / stark quantisiertes Modell“ (IQ3)** wird bei der Installation
einmalig gesetzt, **Windows-Freigabe (SMB) als Arbeitsordner**, Übertragung zwischen PC und Handy
in beide Richtungen.

## 1. APK installieren

Datei: `android\app\app_build\outputs\apk\debug\app-debug.apk` (ca. 11 MB)

> Der Build-Ordner heißt bewusst `app_build` (nicht `build`): auf dem Netzlaufwerk Y: blockiert
> der Windows-Explorer das `build`-Verzeichnis, und Gradle blieb beim Aufräumen hängen.

**Direkt aufs Handy:** APK per USB-Kabel, Dateimanager oder Cloud übertragen, antippen und
„Unbekannte Apps zulassen“ bestätigen.

**Per adb (empfohlen zum Testen):**
```bash
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" install -r android\app\app_build\outputs\apk\debug\app-debug.apk
```

Die Debug-APK ist mit dem Android-Testschlüssel signiert – für die eigene Nutzung ausreichend.

## 2. Erste Schritte in der App

1. **Sprache wählen** – beim allerersten Start (noch keine Einstellungen gespeichert) fragt die App
   „Sprache wählen · Choose your language · Choisissez votre langue“. Die Wahl gilt sofort für die ganze
   Oberfläche und für die Sprache, in der die KI antwortet; der Dialog kommt danach nicht wieder.
   Später umschaltbar: Zahnrad → Darstellung → **Sprache**.
2. **Verbindung anlegen** (Zahnrad oben links → Verbindungen): Adresse des LLM-Servers eintragen,
   z. B. `http://192.0.2.1.20:11434` (Ollama) oder `http://192.0.2.1.20:8080/v1` (Strata/LM Studio).
   Wichtig: Vom Handy aus ist `localhost` **nicht** der Server – die IP des Rechners verwenden.
3. **Modell wählen** (Auswahl oben), dann chatten.
4. **Workspace für den KI-Dateizugriff**: Zahnrad → Workspace & Dateien → „Wählen …“.
   Android zeigt den Systemordner-Wähler; die App kopiert den gewählten Ordner in ihren
   App-Speicher (`Android/data/de.reuschlerit.llmbox/files/workspace/…`). Von dort liest und
   schreibt die KI – genau wie am Desktop.

## 3. Bedienung auf dem Handy

- **☰ oben links** öffnet die Chatliste (Drawer). Nach der Auswahl schließt sie automatisch.
- **Querformat / großes Display**: ab 1101 px Breite erscheint das bekannte Desktop-Raster mit
  Seitenleiste und Workspace-Panel nebeneinander.
- **Workspace-Panel**: Knopf rechts oben. Auf dem Handy klappt es als Overlay von rechts auf,
  darunter der Live-Monitor.
- **Senden**: Der Senden-Knopf sendet; die Bildschirmtastatur macht Enter einen Umbruch
  (Tastenkürzel wie Strg+N gibt es auf dem Handy nicht).
- **Lange auf einen Codeblock tippen** markiert den Text zum Kopieren.
- **Zurück-Taste** legt die App ab, sie verlässt nicht den Chat.

## 4. Was auf Android anders ist

| Funktion | Status |
|---|---|
| Chat, Streaming, Denkmodus, Unteragenten, Session-Übergabe | unverändert |
| KI-Werkzeuge list_files / read_file / edit_file / write_file / search_text | unverändert |
| Datei-Anhänge inkl. PDF, Word, Excel, PowerPoint, OpenDocument | unverändert (Textauslese wie am Desktop) |
| Server & Monitor: Modell laden/entladen, VRAM, Live-Monitoring | funktioniert über die HTTP-Schnittstelle des Servers |
| Chats importieren/exportieren (JSON/Markdown) | funktioniert |
| **Oberfläche Deutsch / English / Français** (ab 1.0.66) | unverändert, inklusive Sprachabfrage beim ersten Start und Umschalten unter *Einstellungen → Darstellung → Sprache* |
| **Modellprofil IQ3/Q3** und Arbeitskontext-Obergrenze (ab 1.0.66) | unverändert, wird bei der Installation einmalig gesetzt |
| **Windows-Freigabe (SMB) als Arbeitsordner** (ab 1.0.61) | funktioniert, Adresse und Zugangsdaten unter *Einstellungen → Workspace & Dateien* |
| **Programme ausführen** (`run_command`, `check_tool`, `install_tool`) | **nicht vorhanden** – gibt es auf Android nicht. Schalter ausgeblendet, Werkzeuge der KI nicht im Angebot. |
| **Strata-CLI / SSH-Verwaltung** („Modell starten“, „Presets“, „Verbindung testen“) | durch HTTP-Bedienung ersetzt; CLI-Knöpfe ausgeblendet |
| Windows-Fenstermaterial, GPU-Umschaltung für die Oberfläche | entfällt |
| Drag & Drop von Dateien | nicht möglich – stattdessen Heftchen „Dateien anhängen“ / „Ordner anhängen“ |

## 5. Eigene APK bauen

Voraussetzungen (sind hier installiert): JDK 21, Android-SDK, Gradle 8.13, Node.

```bat
cd LLM-Box
:: einmalig die Browser-Bibliotheken holen
cd webdeps && npm i jszip@3.10.2 fast-xml-parser@4.5.7 pdfjs-dist@3.11.174 buffer esbuild ^&^& npx esbuild bundle-entry.js --bundle --format=iife --platform=browser --target=es2020 --minify --outfile=out\webdeps.js && cd ..

:: Web-App aufbereiten und APK bauen
powershell -NoProfile -ExecutionPolicy Bypass -File build-android.ps1
```

Das Skript kopiert die Desktop-Oberfläche, setzt `docs.js` unverändert ein, patcht gezielt die
Android-Anpassungen (jeder Patch bricht ab, wenn er nicht exakt passt) und ruft Gradle auf.
Wichtig: Die Android-eigene Brückenschicht liegt in `tools-android\` (`native-main.js`,
`android-adapter.js`) und wird von dort in `assets\webapp\js` kopiert – Änderungen daran wirken erst
nach einem neuen Build. Die Desktop-Datei `llm-box\main.js` (Electron-Hauptprozess) hat eine eigene,
leicht abweichende Fassung derselben Funktionen; Korrekturen dort müssen sinngemäß nachgezogen werden
(beispiel 1.0.67: die Schreib-Queue pro Datei in `writeJsonAtomic()`).

**Prüfungen ohne Gerät:**
```bat
tools-android\run-tests.cmd
```
Deckt ab: Bridge-Vollständigkeit, Dateisystem/Werkzeuge/Kodierung/Office/PDF, Oberflächenstart,
kompletter Chat inklusive KI-Werkzeugen über die Brücke, Chat-Abgleich, Übertragungsformat,
Abgleich-Timer, QR-Scan, Übernahme-Korrekturen und die Übersetzung (Wörterbuch-Schlüssel, Abdeckung,
Regression der 1.0.67-Korrekturen). Aktuell 11 Prüfläufe, 330 Prüfungen.

**Am Gerät prüfen (adb über WLAN):** `settings.json` der App liegt unter
`files/data/settings.json` und ist nur mit `run-as de.reuschlerit.llmbox` lesbar:
```bat
adb -s <IP>:5555 exec-out "run-as de.reuschlerit.llmbox cat files/data/settings.json"
```
Um den Zustand „allererster Start“ zu testen, die Datei umbenennen (vorher sichern!), App starten,
Dialog bestätigen, Datei prüfen (`uiLang` und `langChosen` müssen gesetzt sein) und die Sicherung
zurückbenennen.

## 6. Daten und Speicherorte

- Chats und Einstellungen: App-interner Speicher (`files/data/chats/…`), bei App-Deinstallation weg.
- Workspace-Kopien: `Android/data/de.reuschlerit.llmbox/files/workspace/`.
- Desktop-Chats übernehmen: „Chats importieren“ (Export-JSON der Desktop-Version auswählen).
