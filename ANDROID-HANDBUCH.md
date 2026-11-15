# LLM Box für Android – Handbuch

Android-Version der Desktop-App „LLM Box“ (gleiche Oberfläche, gleiche Funktionen bis auf die
unten genannten Ausnahmen). Stand: Version 1.0.32-android.

## 1. APK installieren

Datei: `android\app\build\outputs\apk\debug\app-debug.apk` (ca. 6 MB)

**Direkt aufs Handy:** APK per USB-Kabel, Dateimanager oder Cloud übertragen, antippen und
„Unbekannte Apps zulassen“ bestätigen.

**Per adb (empfohlen zum Testen):**
```bash
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Die Debug-APK ist mit dem Android-Testschlüssel signiert – für die eigene Nutzung ausreichend.

## 2. Erste Schritte in der App

1. **Verbindung anlegen** (Zahnrad oben links → Verbindungen): Adresse des LLM-Servers eintragen,
   z. B. `http://192.0.2.1.20:11434` (Ollama) oder `http://192.0.2.1.20:8080/v1` (Strata/LM Studio).
   Wichtig: Vom Handy aus ist `localhost` **nicht** der Server – die IP des Rechners verwenden.
2. **Modell wählen** (Auswahl oben), dann chatten.
3. **Workspace für den KI-Dateizugriff**: Zahnrad → Workspace & Dateien → „Wählen …“.
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

**Prüfungen ohne Gerät:**
```bat
tools-android\run-tests.cmd
```
Deckt ab: Bridge-Vollständigkeit, Dateisystem/Werkzeuge/Kodierung/Office/PDF, Oberflächenstart,
kompletter Chat inklusive KI-Werkzeugen über die Brücke.

## 6. Daten und Speicherorte

- Chats und Einstellungen: App-interner Speicher (`files/data/chats/…`), bei App-Deinstallation weg.
- Workspace-Kopien: `Android/data/de.reuschlerit.llmbox/files/workspace/`.
- Desktop-Chats übernehmen: „Chats importieren“ (Export-JSON der Desktop-Version auswählen).
