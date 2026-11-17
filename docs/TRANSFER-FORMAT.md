# Übertragungsformat Windows → Android (LLM Box ab V52)

Die Windows-App erzeugt unter **Einstellungen → Übertragung** entweder eine **JSON-Datei** oder eine **Folge von QR-Codes** mit demselben Inhalt (Funktion `buildTransfer()` in `renderer/js/transfer.js`). Dieses Dokument beschreibt beides für die Android-Seite.

## 1. Inhalt (JSON)

```json
{
  "format": "llm-box-transfer",
  "version": 1,
  "created": "2026-11-13T18:30:00.000Z",
  "source": { "app": "LLM Box", "version": "1.0.52", "platform": "win32", "device": "PC-NAME" },
  "contains": ["settings", "chats", "workspaceFiles", "smb"],
  "omitted": ["appearance.bgImage"],
  "settings": { },
  "chats": [ ],
  "workspace": { "path": "Y:\\Projekt", "files": [ { "path": "src/a.txt", "size": 12, "text": "..." } ], "skippedFiles": 3, "truncated": false, "note": "" },
  "smb": { "host": "NAS-01", "share": "Projekt", "sub": "src", "unc": "\\\\NAS-01\\Projekt\\src", "path": "/smb/NAS-01/Projekt/src", "user": "max", "domain": "ARBEITSGRUPPE", "pass": "geheim" }
}
```

- `contains` nennt, was enthalten ist. `settings` ist immer dabei. `chats` nur, wenn gewählt. `workspace` nur in der JSON-Datei und nur, wenn gewählt (nie im QR-Code). `smb` nur, wenn ein Netzwerkordner mitgenommen wurde (siehe unten).
- `settings` ist 1:1 das Einstellungsobjekt der Windows-App (`S.settings`). Wichtige Teile:
  - `connections[]`: `id`, `name`, `type` (`openai` oder `ollama`), `baseUrl`, **`apiKey`** (Klartext), `extraParams`, `thinkMode`, optional `priceIn`/`priceOut`
  - `activeConnection`, `model`, `thinking`, `systemPrompt`
  - `params`: `temperature`, `topP`, `topK`, `repeatPenalty`, `maxTokens`, `numCtx`, `autoCtx`, `minP`, `presencePenalty`, `seed`, `stop`, `keepAlive`
  - `workspace`: u. a. `toolsEnabled`, `askUser`, `subagents`, `subagentSteps`, `handoff*`, `approval`, `execEnabled`, `execTimeout`, **`maxSteps`** (Standard 25), `readKB`, `autoCompact`, `ctxBudgetPct`, `keepToolResults`, `maxFileKB`, `maxFiles`, `maxTotalKB`, `ignore`, `path` (Windows-Pfad, auf Android nicht nutzbar)
  - `pricing`, `appearance`, `server` (Strata; `server.target.key` ist nur der **Pfad** zu einem SSH-Schlüssel auf dem PC, nicht der Schlüssel)
  - Die Android-App darf unbekannte Felder ignorieren und fehlende mit eigenen Standardwerten füllen. Windows-spezifische Felder (`workspace.path`, `appearance.winMaterial`, `server.target.*`) sollten nicht übernommen werden.
- `chats[]`: vollständige Chat-Objekte, wie sie die Windows-App speichert (`id`, `title`, `model`, `messages` …). Bei gleicher `id` auf dem Zielgerät nicht überschreiben, sondern als Kopie anlegen oder den neueren Stand (Feld `updated`) behalten.
- Im QR-Code fehlt ein großes Hintergrundbild (steht dann in `omitted`).

### Netzwerkordner (`smb`) — ab Version 1.0.61

Wurde bei der Übertragung „Netzwerkordner (SMB) samt Zugangsdaten“ angehakt, kommt das Top-Level-Feld
`smb` dazu. Es stammt von `collectSmb()` in `renderer/js/transfer.js`:

| Feld | Bedeutung |
|---|---|
| `host` | Rechnername oder IP der Freigabe |
| `share` | Name der Freigabe (erster Ordner unterhalb des Rechners) |
| `sub` | Unterordner innerhalb der Freigabe, kann leer sein |
| `unc` | Windows-Schreibweise `\\host\share\sub` |
| `path` | Workspace-Pfad so, wie ihn die sendende App benutzt (Windows: Laufwerks-/UNC-Pfad, Android: `/smb/host/share/sub`) |
| `user`, `domain`, `pass` | Zugangsdaten **dieses** Rechners, falls auf dem sendenden Gerät hinterlegt; sonst leere Strings |

Regeln für die empfangende Seite (so in `apply()` von `tools-android/native-main.js` umgesetzt):

1. Erst die Zugangsdaten speichern (`smbSaveCreds(host, user, domain, pass)`), leere Felder überschreiben
   vorhandene Werte **nicht**.
2. Dann die Erreichbarkeit prüfen (Testlauf über den Freigabe-Pfad). Nur wenn diese Prüfung gelingt, den
   Workspace-Pfad übernehmen — sonst behält das Gerät seinen bisherigen Pfad und meldet den Grund.
3. Der Android-Workspace-Pfad hat die Form `/smb/<host>/<share>/<sub>`; ein Windows-Laufwerksbuchstabe
   (`Y:\…`) ist übertragbar, aber auf dem Handy nicht benutzbar und darf nicht gesetzt werden.

**Achtung:** `pass` steht im Klartext in der JSON-Datei **und im QR-Code**. Im Gegensatz zu `workspaceFiles`
(geschützt durch die Bedingung `opt.ws && !forQr` in `buildTransfer()`) wird das `smb`-Feld **nicht** für den
QR-Weg ausgelassen. Die Android-App liefert ihr gespeichertes Passwort über `credsForExport` deshalb nur für
eine ausdrücklich gestartete Übertragung, nie an eine beliebige Web-Seite. Übertragen wie API-Keys: nur im
eigenen WLAN, exportierte Datei danach löschen.

**Sicherheit:** API-Keys stehen im Klartext in der JSON-Datei und im QR-Code. Die Android-App sollte sie in den Android Keystore bzw. EncryptedSharedPreferences übernehmen und die importierte JSON-Datei nicht dauerhaft liegen lassen.

## 2. QR-Code-Folge

Der JSON-Text (kompakt, UTF-8) wird mit **zlib** komprimiert (Format RFC 1950, `Inflater` in Java/Kotlin ohne `nowrap`), **Base64** (Standard-Alphabet mit `+` und `/`, mit Padding) kodiert und in Stücke zu je 600 Zeichen geteilt. Jedes Stück ist ein eigener QR-Code (Byte-Modus, Fehlerkorrektur M). Der Text jedes Codes:

```
LBX1|<Sitzung>|<Nr>|<Anzahl>|<Prüfsumme>|<Base64-Teil>
```

| Feld | Bedeutung |
|---|---|
| `LBX1` | Kennung und Formatversion |
| `<Sitzung>` | 8 Zeichen, gleich in allen Codes einer Übertragung |
| `<Nr>` | Nummer des Teils, beginnt bei 1 |
| `<Anzahl>` | Gesamtzahl der Teile |
| `<Prüfsumme>` | die ersten 16 Hex-Zeichen von SHA-256 über die **komprimierten Bytes** (nach dem Base64-Dekodieren, vor dem Entpacken) |
| `<Base64-Teil>` | Stück des Base64-Texts |

Die Windows-App zeigt die Codes **im Kreis** (1–4 Bilder pro Sekunde, mit Pause und Vor/Zurück). Die Android-App soll:

1. Jeden gescannten Code mit `split("|", limit = 6)` zerlegen und `LBX1` prüfen.
2. Teile je `<Sitzung>` in einer Map `Nr → Text` sammeln (doppelte ignorieren, Reihenfolge egal). Fortschritt anzeigen („3 von 10“). Kommt eine andere Sitzung, nachfragen oder verwerfen.
3. Sobald `Anzahl` Teile da sind: Teile in Reihenfolge verbinden, Base64 dekodieren, SHA-256 bilden und die ersten 16 Hex-Zeichen mit `<Prüfsumme>` vergleichen. Bei Abweichung: Übertragung verwerfen und neu scannen.
4. Mit `Inflater` entpacken, als UTF-8 lesen, JSON parsen, `format == "llm-box-transfer"` und `version <= 1` prüfen.
5. Vor dem Übernehmen zeigen, was importiert wird (Verbindungen, Chats), und bestätigen lassen.

Mehr als 400 Codes erzeugt die Windows-App nicht (dann Hinweis auf die JSON-Datei). Nur Einstellungen sind meist 6 bis 12 Codes.

### 2.1 Weg über das WLAN und eigener QR-Scan (ab 1.0.62)

Neben der Bildfolge bietet die Windows-App dieselben Daten direkt im Netz an
(`transfer:serveStart` in `main.js`):

- HTTP auf einem frei gewählten Port, Pfad `/llmbox-transfer?t=<token>`. Der Token kommt als
  **Query-Parameter** (ein URL-Fragment würde von HTTP nicht übertragen und der Vergleich schlug fehl).
- Ausgeliefert wird der **unkomprimierte JSON-Text**, weil die Android-Brücke Antworten als String liest;
  rohe deflate-Bytes würden dabei zerstört. Nach dem ersten Abruf schließen HTTP-Server **und** UDP-Signal.
- Rufsignal: die Android-App sendet `LLMBOX?` als Broadcast an Port **45455** und erhält
  `LLMBOX|<port>|<token>|<sha16>` zurück. Deshalb braucht das Handy zum Finden weder Kamera noch Tippen.

Der angezeigte QR-Code enthält genau eine dieser Adressen. Seit 1.0.62 kann die Android-App ihn selbst
lesen: `jsQR` steckt im WebView-Bundle (`vendor/webdeps.js`, Quelle `webdeps/bundle-entry.js`), die
Kamera-Erlaubnis holt `Native.qrScanStart()` ein, und `WebChromeClient.onPermissionRequest` in
`MainActivity.java` muss die `getUserMedia`-Anfrage ausdrücklich erlauben (sonst bleibt die Vorschau schwarz).
Erkannt wird beides: eine Adresse (`http://…/llmbox-transfer?t=…` → direkt abrufen) und ein `LBX1|`-Stück
(→ wie oben stückweise sammeln). Fremde Codes werden nur angezeigt, nicht übernommen.

## 3. JSON-Datei als Fallback

Dieselbe Struktur wie oben, aber mit Einrückung und ohne Kürzung (inklusive Hintergrundbild, optional Chats, optional Workspace-Textdateien). In der Android-App: **Einstellungen → Aus JSON-Datei importieren** (Dateiauswahl, dann Schritt 4 und 5 wie oben). Der JSON-Export in der Android-App sollte dasselbe Format schreiben, damit sich Dateien in beide Richtungen eignen.

## 4. Grenzen

- Workspace-Dateien werden nur in der JSON-Datei mitgegeben (nur Textdateien, je Datei so groß wie „Max. Dateigröße“, insgesamt höchstens 5 MB und 2000 Dateien, Ordner aus „Ignorieren“ ausgenommen). Auf Android gibt es meist keinen passenden Ordner; die App kann sie in einem eigenen Projektordner ablegen oder ignorieren.
- Nicht übertragen werden gerätebezogene Daten der Windows-App: Fensterposition, Rechner-ID und der gemeinsame Chat-Ordner.
