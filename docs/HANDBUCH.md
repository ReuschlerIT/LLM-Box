# LLM Box – Handbuch

Schlanke Windows-App für lokale und entfernte KI-Modelle: Chat, alle Parameter, Dateien und Ordner als Kontext, optionaler Dateizugriff für die KI.

## Starten

1. Node.js (LTS) von https://nodejs.org installieren.
2. `start.bat` doppelklicken. Beim ersten Start werden die Abhängigkeiten geladen.
3. Ollama (oder LM Studio usw.) starten. LLM Box erkennt die Modelle automatisch.

Eigene EXE bauen: `build-exe.bat`. Ergebnis im Ordner `dist` (Installer und portable Version).

## Verbindungen

| Typ | Beispiele | Standard-Adresse |
|---|---|---|
| Ollama | Ollama | `http://localhost:11434` |
| OpenAI-kompatibel | LM Studio, llama.cpp, vLLM, OpenAI, OpenRouter, Groq | z. B. `http://localhost:1234/v1` |

Anfragen laufen über den Hauptprozess der App. Dadurch brauchst du **kein** `OLLAMA_ORIGINS` und es gibt keine CORS-Probleme.
Über Einstellungen → Verbindungen kannst du beliebig viele Verbindungen anlegen, testen und (bei Ollama) Modelle herunterladen.

## Statistik

Unter jeder Antwort: Tokens/s, Prompt-Tokens, Antwort-Tokens, Gesamt, Zeit bis zum ersten Token und Dauer. Unten rechts die Summe des Chats samt Durchschnitts-Geschwindigkeit, oben der Füllstand des Kontextfensters.
Ollama und Server mit `usage` liefern echte Zahlen. Liefert ein Server nichts, werden Werte geschätzt und mit `~` markiert.

## Kosten und Dauer

Unter dem Eingabefeld steht für den jeweiligen Chat: Tokens (Prompt/Antwort), Ø Tokens/s, **Dauer** (Summe der Verarbeitungszeit aller Antworten, inklusive Werkzeug-Schritte) und **Kosten** in €. Unter jeder Antwort stehen deren eigene Werte.

Die Kosten sind ein **Vergleichswert**: was dieselbe Nutzung bei einem Cloud-Anbieter zu Listenpreisen kosten würde. Alle Preise sind in **Euro je 1 Mio. Token**. Standard ist der Mittelwert aus GPT-6.1 Sol, Claude Sonnet 5.5 und Gemini 3.1 Pro (1,80 € Eingabe / 9,60 € Ausgabe, umgerechnet aus 2 $ / 10,67 $ zum Kurs 0,90). Unter Einstellungen → Kosten wählst du andere Vorlagen oder trägst eigene Euro-Preise ein; pro Verbindung sind eigene Preise möglich.

## Denkaufwand

Im Eingabefeld: **Denken: Auto / Aus / Schnell / Normal / Hoch**. Bei Ollama wird `think` gesendet (gpt-oss mit Stufen). Bei OpenAI-kompatiblen Servern lässt sich in Einstellungen → Verbindungen wählen, wie die Stufe übertragen wird: `reasoning_effort`, Chat-Template (llama.cpp, vLLM, Qwen3), OpenRouter-`reasoning` oder gar nicht. Zahlen werden kompakt angezeigt (k, M, B, T); exakte Werte stehen im Tooltip.

## Dateien

- Dateien/Ordner per Drag & Drop, Büroklammer oder Ordner-Button anhängen. Bilder auch per Strg+V (für Vision-Modelle).
- Workspace-Panel rechts: Projektordner wählen, Datei anklicken = anhängen, `+` an einem Ordner = ganzen Ordner anhängen.
- **KI-Dateizugriff** (Schalter unter dem Eingabefeld): Die KI kann im Workspace Dateien auflisten, lesen, durchsuchen und schreiben (Tool Calling, z. B. llama3.1, qwen2.5, mistral-nemo). Jede Anfrage der KI erscheint als Karte im Chat mit „Genehmigen“, „Immer in diesem Chat erlauben“ und „Ablehnen“. Standard: Lesen läuft automatisch, Schreiben wird bestätigt (einstellbar). Nach 25 Werkzeug-Schritten hält die KI sichtbar an und du kannst mit „Weitermachen“ fortfahren. Antwortet das Modell nach einem Werkzeug-Ergebnis leer, fasst die App einmal automatisch nach. Hilft das nicht, erscheint ein Fehler mit „Erneut versuchen“ bzw. ein Hinweis mit „Weitermachen“. Zugriff außerhalb des Workspace ist gesperrt.
- Codeblöcke in Antworten lassen sich mit einem Klick als Datei speichern.

Grenzen für Dateigröße, Dateianzahl und Ignore-Liste stehen unter Einstellungen → Workspace & Dateien.

## Freigaben pro Chat (live umstellbar)

Unter dem Eingabefeld steht **Freigabe: …** (erscheint, sobald der KI-Dateizugriff an ist). Ein Klick öffnet ein Menü, das **nur für den aktuellen Chat** gilt und sofort wirkt, auch während eine Freigabe-Karte offen ist (die Karte wird dann automatisch genehmigt):

- **Standard aus Einstellungen / Alles bestätigen / Nur Schreiben und Befehle bestätigen / Nichts bestätigen.** „Nichts bestätigen“ gilt jetzt auch für `run_command` (vorher wurde dort trotzdem jedes Mal gefragt).
- **Alle Befehle in diesem Chat erlauben:** inklusive verketteter Befehle und PowerShell.
- **Installationen ohne Nachfrage:** getrennt schaltbar, standardmäßig aus.
- **Immer erlaubt:** Liste der freigegebenen Programme und Werkzeuge, einzeln entfernbar oder komplett zurücksetzbar.

Auf der Freigabe-Karte für einen Befehl gibt es zusätzlich **„<Programm> immer erlauben (beliebige Argumente)“** und **„Alle Befehle in diesem Chat erlauben“**. Eine Programm-Freigabe gilt für beliebige Argumente, aber nicht für Umleitungen (`>`), Unterbefehle (`$(…)`), Backticks und Variablen als Programm; bei verketteten Befehlen (`&&`, `|`, `;`) müssen alle beteiligten Programme freigegeben sein. Shells (cmd, powershell, pwsh, wsl, bash) lassen sich nicht als „Programm“ freigeben, dafür gibt es „Alle Befehle“. Die Freigaben werden mit dem Chat gespeichert und von „Neue Session mit Übergabe“ übernommen.

## Strata-Chats importieren

Die Strata-Weboberfläche speichert Chats nur im Browser (IndexedDB bzw. localStorage), **nicht auf dem Server**. LLM Box kann sie deshalb nicht automatisch abrufen. Über den Import-Button unten links in der Seitenleiste (Pfeil nach oben) gibt es einen einmaligen Weg: ein Skript in der Browser-Konsole der Strata-Seite exportiert `strata-chats.json`, LLM Box liest die Datei, erkennt die Unterhaltungen und legt sie als Chats an (Kennzeichnung „Strata“, Mehrfach-Import wird erkannt). Der Chat-Verlauf der Strata-Seite muss aktiv sein, sonst existiert nur der letzte Chat. Weil das Speicherformat von Strata nicht fest zugesagt ist, sucht der Import Nachrichtenlisten (`role` + `content`) im ganzen Export, statt ein festes Format vorauszusetzen. Bilder und Dateien hat Strata nur als Namen gespeichert; sie erscheinen als „[Anhang: …]“.

## Live-Anzeige von Programmen und Mitscrollen

- **Live-Karte für jedes Werkzeug:** Sobald die KI ein Werkzeug startet (PowerShell/cmd über `run_command`, Installation, Unteragent, Dateizugriff), erscheint im Chat sofort eine Karte. Sie zeigt den Befehl, die **Live-Ausgabe** des Programms (stdout und stderr, Fortschrittsbalken überschreiben ihre Zeile) und den Status: *in der Warteschlange*, *wartet auf deine Freigabe*, *läuft seit … · Ausgabe läuft*. Kommt länger als 5 Sekunden nichts Neues, steht dort **„wartet auf Ausgabe (seit … nichts Neues)“** und die Karte wird gelb markiert. So erkennst du, ob die KI gerade auf PowerShell wartet. Zusätzlich siehst du das Zeitlimit und kannst das Programm mit **Stopp** auf der Karte beenden. Nach dem Ende wird die Karte durch die normale, zugeklappte Werkzeug-Karte ersetzt.
- **Mitscrollen:** Der Chat, der Gedankengang, die Programm-Ausgabe und der Verlauf der Unteragenten laufen automatisch mit. Scrollst du nach oben, bleibt die Ansicht genau dort stehen. Sobald du wieder ganz unten bist, läuft sie wieder mit. Eine neue Freigabe-Karte springt dich nicht mehr aus deiner Leseposition: Stattdessen blinkt der Pfeil „Nach unten“.
- **Unteragenten:** Unter „Unteragenten“ (Karte anklicken) steht jetzt ein **Live-Verlauf** mit Gedanken, Antwort und Werkzeug-Schritten je Schritt, ebenfalls mit Mitscrollen. Derselbe Verlauf erscheint als Live-Karte im Chat und bleibt nach dem Lauf einsehbar (die letzten ca. 12.000 Zeichen werden im Chat gespeichert).

## Bilder erzeugen lassen

Ein Modell kann nur dann Bilder liefern, wenn die Anfrage das ausdrücklich verlangt (`modalities`). Ohne diesen Parameter antwortet auch ein bildfähiges Modell nur mit Text und sagt, es könne keine Bilder erzeugen.

- Unter **Einstellungen → Verbindungen → Bildausgabe** wählst du pro Verbindung:
  - **Automatisch** (Standard): Die App fordert Bilder an, wenn der Modellname darauf hindeutet (z. B. `google/gemini-2.5-flash-image`, `…flux…`, `…-image`).
  - **Immer anfordern**: für Modelle, die Bilder ausgeben können, deren Name das nicht verrät.
  - **Nie anfordern**.
- Erzeugte Bilder erscheinen unter der Antwort. Ein Klick vergrößert sie, **Speichern** legt sie als Datei ab, **Weiterbearbeiten** hängt sie an die nächste Nachricht an.
- Gilt für OpenAI-kompatible Verbindungen (z. B. OpenRouter). Bei Ollama gibt es keine Bildausgabe.
- Hinweis: Bilder werden im Chat gespeichert und machen die Chat-Datei größer.

## Dokumente und Konfigurationsdateien

Neben Text- und Bilddateien liest die LLM Box diese Formate **lokal** (nichts wird hochgeladen) und gibt der KI den Inhalt als Text:

| Format | Was die KI bekommt |
|---|---|
| PDF | Text je Seite (`--- Seite 3 von 12 ---`). Gescannte PDFs ohne Text-Ebene werden gemeldet, OCR gibt es nicht. |
| Word (.docx) | Überschriften, Absätze, Listen, Tabellen, Fußnoten und Kommentare |
| Excel (.xlsx, .xlsm) | jedes Blatt als Tabelle mit Spalten A, B, C … und Zeilennummern, Datumswerte als Datum, dazu eine Liste der Formeln. Ausgeblendete Blätter sind markiert. Pro Blatt werden die ersten 5000 Zeilen gelesen. |
| PowerPoint (.pptx) | je Folie Text, Tabellen und Notizen |
| OpenDocument (.odt, .ods, .odp) | Text bzw. Tabellen |

- **Als Anhang:** per Drag & Drop, Büroklammer oder Klick im Workspace-Panel. Das Limit „Max. Dateigröße“ gilt für den ausgelesenen Text, der bei Bedarf gekürzt wird.
- **Durch die KI:** Mit aktivem Dateizugriff liest sie diese Dateien im Workspace mit `read_file`, auch abschnittsweise (`start_line`/`end_line` beziehen sich auf den ausgelesenen Text).
- **Konfigurationsdateien** (.ini, .cfg, .json, .yaml, .toml, .env, .reg, .csv …) sind Textdateien. Die App erkennt UTF-8, UTF-16 und Windows-Umlaute (Windows-1252) automatisch. Ändert die KI eine solche Datei, wird sie in **derselben Kodierung** zurückgeschrieben.
- **Nicht möglich:** Die KI kann .docx/.xlsx/.pdf nicht erzeugen oder ändern, weil das nur mit Text eine ungültige Datei ergäbe. Sie soll dann .csv/.md/.html schreiben oder mit Freigabe ein Skript (z. B. Python mit openpyxl) über `run_command` ausführen. Alte Formate (.doc, .xls, .ppt) bitte vorher als .docx/.xlsx/.pptx speichern.
- Beim ersten Start nach diesem Update installiert `start.bat` die neuen Programmteile (PDF, Office) automatisch.

## Strata mit einem Klick starten („Modell laden“)

Im Fenster **Server** → **Monitor** startet die LLM Box Strata für dich, wenn der Server nicht läuft:

1. Trage einmal unter **Modell starten** deine Werte ein (Familie und Modell, Modell-Ordner oder ein Preset, dazu Kontext, Port usw.). Sie werden gespeichert.
2. Steht der Monitor auf „Offline“, heißt der Knopf oben rechts **„Strata starten & Modell laden“**. Ein Klick führt im Hintergrund `strata launch … --yes --no-tui` mit genau diesen Werten aus (ohne Fenster). Fortschritt und letzte Ausgabezeile erscheinen im Monitor, die komplette Ausgabe im Tab „Modell starten“.
3. Sobald der Server antwortet, lädt die App bei Bedarf das Modell. Danach zeigt der Monitor „Bereit“. Der Server läuft weiter, auch wenn du die LLM Box schließt.
4. Läuft der Server schon, heißt der Knopf wie bisher **„Modell laden“** und lädt nur das Modell.

Mögliche Meldungen: *Nichts eingetragen* (die App wechselt zu „Modell starten“), *Fehlercode 7 / läuft schon mit anderen Einstellungen* (dann „Laufendes Modell ersetzen“ einschalten), *Programm nicht gefunden* (Strata nicht installiert oder falscher Pfad unter „Zielrechner“), *API-Schlüssel stimmt nicht* (Knopf gesperrt: Schlüssel unter „Modell starten“ → „Schlüssel anzeigen“ holen und in der Verbindung eintragen).

**Läuft Strata schon?** Dann meldet `strata launch` „Already serving these choices; nothing was restarted“ und nennt die Adresse („This computer  http://127.0.0.1:8080/v1“). Die LLM Box liest diese Adresse aus der Ausgabe. Zeigt die Monitor-Verbindung woanders hin (anderer Port, falsche Verbindung ausgewählt), wählt sie die passende Verbindung oder legt eine neue „Strata (Adresse)“ an. Bestehende Verbindungen bleiben unverändert.

**Falscher API-Schlüssel:** Antwortet der Server mit 401/403, heißt der Knopf **„Schlüssel holen & verbinden“**. Er führt `strata launch --show-key` aus und fragt dich, ob der gemeldete Schlüssel in der Verbindung eingetragen werden soll.

Hinweis: Ein Start-Auftrag endet jetzt auch dann sauber, wenn Strata im Hintergrund weiterläuft und die Ausgabe-Leitungen offen hält. Vorher blieb der Auftrag dann hängen, und ein weiterer Start war nicht mehr möglich („Es läuft bereits ein Befehl“).

## Wenn die Verbindung nicht klappt oder kein Modell erscheint

Unter **Einstellungen → Verbindungen → „Verbindung genau prüfen“** fragt die App die wichtigen Adressen einzeln ab (`/models`, `/v1/status`, `/metrics`) und zeigt Statuscode, Antwortzeit und Fehler. Darunter steht die wahrscheinliche Ursache:

- **401/403:** Der Server verlangt einen API-Schlüssel, oder der eingetragene ist veraltet. Bei Strata erzeugt `strata launch` ohne festen Schlüssel bei jedem Start einen neuen. Den aktuellen zeigt Strata unter „Schlüssel anzeigen“, ein fester lässt sich beim Start vorgeben.
- **Verbindung abgelehnt (ECONNREFUSED):** Dort lauscht nichts: Server aus, anderer Port oder Zugriff nur lokal. Bei `localhost` probiert die App zusätzlich `127.0.0.1` und `[::1]` und sagt, welche Adresse antwortet.
- **404:** Die Adresse stimmt nicht ganz, z. B. fehlt oder fehlt zu viel `/v1`. Die Prüfung nennt die richtige Variante.
- **„Modell geladen: NEIN“ / 0 Modelle:** Der Server läuft, hat aber kein Modell geladen. Im Fenster „Server“ auf „Modell laden“ klicken.
- **Zeitüberschreitung:** Falsche IP, Firewall oder Rechner nicht erreichbar.

## Statuszeile unter dem Eingabefeld

Rechts unten stehen immer alle Werte des Chats: Tokens gesamt (Prompt ↑ und Antwort ↓), **Ø Tokens/s**, **Dauer** und **Kosten**. In einem neuen Chat beginnen sie bei 0 bzw. „–“. Während die KI antwortet, laufen sie **live** mit: Die laufende Anfrage wird eingerechnet (mit „~“ markiert, bis sie fertig ist), dazu steht die aktuelle Geschwindigkeit („jetzt ~…“). Nach der Antwort ersetzen die genauen Server-Zahlen die Schätzung.

## Rückfragen mit Antwortvorschlägen

Mit dem Werkzeug `ask_user` kann die KI dir Fragen stellen, statt zu raten. Du bekommst eine Karte im Chat:

- **Antwortvorschläge zum Anklicken.** Bei Einzelfrage mit genau einer Frage genügt ein Klick, sonst bestätigst du mit „Antworten“. Bei Mehrfachauswahl (steht an der Frage) kannst du mehrere Vorschläge wählen.
- **Eigene Antwort:** Unter den Vorschlägen steht ein Textfeld. Eine eigene Antwort ersetzt bei Einzelauswahl den Vorschlag, bei Mehrfachauswahl kommt sie dazu.
- **Überspringen:** Die KI trifft dann eigene Annahmen und nennt sie kurz. „Stopp“ überspringt ebenfalls.
- Auf der Live-Karte steht „wartet auf deine Antwort“. Die Antworten bekommt die KI als Werkzeug-Ergebnis zurück und arbeitet damit weiter.
- **Einstellungen → Workspace & Dateien:** „Rückfragen mit Antwortvorschlägen“ schaltet das Werkzeug ein oder aus. „Rückfragen auch ohne Dateizugriff“ bietet es der KI auch dann an, wenn der Dateizugriff aus ist.
- **Voraussetzung:** Das Modell muss Werkzeuge (Tool Calling) unterstützen und den Aufruf auch wirklich einsetzen. Die App weist die KI im Systemprompt darauf hin. Kleine Modelle fragen trotzdem oft nicht nach. Dann hilft eine Anweisung wie „Stelle mir Rückfragen mit ask_user, bevor du loslegst“.

## Geschwindigkeit: LLM Box und Server vergleichen

Zeigt die Server-Weboberfläche (z. B. Strata) mehr Tokens/s als die LLM Box, gibt es zwei mögliche Ursachen:

1. **Messung:** Die LLM Box misst vom ersten Token bis zum Ende der Antwort. Bei Strata steht unter der Antwort zusätzlich **„Tokens/s Server“**, die der Server selbst gemessen hat (`/metrics`). Das ist die Zahl, die auch seine Weboberfläche zeigt. Eine Messreihe mit simuliertem Server (100 und 300 Tokens/s, auch bei 4-fach gebremster CPU) ergab eine Abweichung der App-Messung von höchstens etwa 2 %.
2. **Andere Anfrage:** Die LLM Box sendet standardmäßig Temperatur, Top-P, Top-K und eine Wiederholungs-Strafe mit, dazu bei aktivem Dateizugriff die Werkzeug-Definitionen und den Systemprompt. Die Weboberfläche eines Servers schickt oft weniger oder andere Werte. Bei spekulativem Decodieren (MTP) kann das die Geschwindigkeit deutlich verändern.

So findest du es heraus:
- Unter der Antwort auf **„Anfrage“** klicken: Dort steht genau, was gesendet wurde.
- Unter **Einstellungen → Verbindungen → Sampling-Parameter** auf **„Dem Server überlassen“** stellen. Dann sendet die App keine Sampling-Werte mehr und der Server nimmt seine Standards.
- Zum fairen Vergleich den **Dateizugriff ausschalten** (sonst ist der Prompt durch die Werkzeuge größer) und denselben Prompt in beiden Oberflächen senden.
- Zeigt „Tokens/s Server“ in der LLM Box denselben Wert wie die Weboberfläche, lag es nur an der Messung. Zeigt sie einen niedrigeren Wert, unterscheidet sich die Anfrage.

**Eingebauter Geschwindigkeitstest:** Unter **Einstellungen → Verbindungen → „Geschwindigkeit testen“** macht die App einen Aufwärmlauf und dann drei Durchgänge mit vier Anfrage-Arten (je 256 Tokens, Reihenfolge wechselt): minimal (nur Nachricht), wie die App sendet, minimal mit Füllstand-Abfrage (`/slots`) und wie die App sendet mit Werkzeug-Definitionen. Angezeigt werden Median und Streuung (vom Server gemessen, wenn er das liefert). Einzelne Läufe schwanken auch auf demselben Server um 10 % und mehr, deshalb zählt ein Unterschied nur, wenn er größer als 8 % und größer als diese Streuung ist. Zusätzlich listet er alle Läufe in zeitlicher Reihenfolge, bei Strata mit GPU-Temperatur und -Leistung. Sinkt die Geschwindigkeit über den Test hinweg unabhängig von der Variante, weist er auf Wärme-Drosselung oder andere Last auf der Grafikkarte hin. Während des Tests ist die Oberfläche im Sparmodus (keine Animationen). Der Test dauert etwa eine Minute.

**Grafikkarte:** Läuft das Modell auf derselben Grafikkarte, die auch die Oberfläche zeichnet, konkurrieren beide um Rechenzeit. Dagegen gibt es zwei Schalter unter **Einstellungen → Darstellung**: **„Sparmodus beim Antworten“** (Standard an) schaltet Animationen und Unschärfe ab, solange die KI antwortet. **„Grafikkarte für die Oberfläche nutzen“** aus zeichnet die Oberfläche komplett ohne Grafikkarte (wirkt nach einem Neustart der LLM Box). Probiere beides, wenn die LLM Box langsamer ist als die Server-Weboberfläche im Browser.

Unter **„Anfrage“** steht außerdem die **Antwort des Servers** (Verbrauch `usage` und, falls geliefert, `timings`). Sie hilft, Zahlen wie Kosten oder Tokens/s nachzuvollziehen.

Außerdem baut die App die Antwortanzeige beim Streamen höchstens etwa 10-mal pro Sekunde neu auf und fragt den Server während einer Antwort nur alle 2 Sekunden nach dem Füllstand (`/slots`), damit sie so wenig wie möglich stört.

## Programme auf dem Rechner

Mit aktivem KI-Dateizugriff kann die KI drei weitere Werkzeuge nutzen (Einstellungen → Workspace & Dateien → „KI darf Programme ausführen“):

- `check_tool`: prüft, ob ein Programm im PATH gefunden wird (z. B. apktool, jadx, java), ohne Argument eine Übersicht der Paketmanager. Keine Freigabe nötig.
- `run_command`: führt einen Befehl aus (Windows: cmd, optional PowerShell), Arbeitsordner ist der Workspace. Ob nachgefragt wird, bestimmt die Freigabe (siehe unten).
- `install_tool`: Die KI bittet um die Installation eines fehlenden Programms (winget, choco, scoop, pip, pipx, npm). Die Rückfrage zeigt den exakten Befehl und muss bestätigt werden, außer du erlaubst Installationen im Chat ausdrücklich („Installationen ohne Nachfrage“). Windows kann dazu eine Administrator-Abfrage zeigen.

Nach einer Installation wird der PATH neu aus der Registry gelesen, ein Neustart der App ist nicht nötig. Ausgaben werden gekürzt (die KI soll filtern oder in eine Datei umleiten), Programme werden nach dem Zeitlimit beendet, „Stopp“ bricht laufende Programme ab. Die Programme laufen mit deinen Benutzerrechten: Genehmige nur, was du verstehst.

## Server & Monitor (Strata) – neu

Oben neben „Unteragenten“ öffnet **Server** ein Fenster mit vier Bereichen. Es ersetzt die Oberfläche von Strata: Du musst die Strata-App oder das Terminal-Menü nicht mehr bedienen. Die **Strata-Engine**, die das Modell auf der Grafikkarte rechnet, muss aber auf dem Server installiert sein (Button „Strata installieren …“ unter Zielrechner führt den offiziellen Installer nach Rückfrage aus).

- **Monitor:** Status (Bereit / Liest Prompt / Antwortet / Entladen / Offline), Kontextfüllung, Tokens/s, Prompt-Tempo, GPU-Last, VRAM, Temperatur, Leistung, CPU, RAM, Datenträger, PCIe mit Verlauf, parallele Plätze, letzte Anfragen, Summen und Gesprächs-Cache. Die Daten kommen aus `/metrics` des Servers. Knöpfe: **Modell laden**, **Entladen** (gibt den GPU-Speicher frei, der Server bleibt aktiv) und **VRAM-Reserve** für andere Programme.
- **Modell starten:** Formular für `strata launch`: Familie, Modell, eigene Dateien, Kontext, KV-Format, Bilder, parallele Anfragen, MTP, Tuning, GPUs, Zugriff (lokal, LAN, Cloudflare, Tailscale), Port, API-Schlüssel, eigene `--set`-Einstellungen, Preset speichern, Modell ersetzen. Darunter der genaue Befehl als Vorschau. Knöpfe: **Plan anzeigen**, **Modell starten**, **Status**, **Stoppen**, **Presets**, **Schlüssel anzeigen**, **Modelle auf dem Server**. Die Ausgabe erscheint live in einer Konsole und lässt sich abbrechen.
- **Konfiguration:** die Run-Config des Servers (Sampling, Reasoning-Budget, Leerlauf-Entladen, MTP, Aliase, VRAM-Reserve …) mit den Beschreibungen des Servers. Änderungen gelten ab dem nächsten Start.
- **Zielrechner:** welche Verbindung überwacht wird und wo die Strata-CLI läuft: **dieser Rechner** oder ein **anderer Rechner per SSH** (nur Schlüssel-Anmeldung, kein Passwortdialog; Windows 10/11 bringt `ssh` mit).

Sicherheit: Die CLI nimmt nur die Unterbefehle `launch`, `models`, `update`, `doctor`, `connect` und `--version`. Jedes Argument wird gegen eine enge Zeichenmenge geprüft (keine Shell-Sonderzeichen, keine Anführungszeichen). Stoppen, Entladen und Installation fragen vorher nach. Der API-Schlüssel steht in den Verbindungen (unverschlüsselt, wie alle Schlüssel) und wird bei `--api-key` als Befehlsargument übergeben.

Voraussetzung am Server: Strata ab Version 0.2.x. Monitor, Laden und Entladen nutzen `/metrics`, `/v1/load`, `/v1/unload`, `/config` und `/v1/vram` des Strata-Servers. Das Format wurde gegen den echten Strata-Servercode mit Test-Engine geprüft. Auf einem Rechner mit GPU und echtem Modell habe ich es nicht ausprobiert.

### Modell laden (Fernsteuerung)

„Modell laden“ ruft `POST /v1/load` (bei älteren Servern `/load`) auf und wartet bis zu 60 Minuten auf die Antwort. Vorher brach die App nach 5 Minuten ab, weil der eingebaute Netzwerk-Client ohne Antwort-Kopfzeilen nach 300 s aufgibt; große Modelle laden länger. Geht die Verbindung währenddessen verloren, fragt die App weiter den Zustand ab, statt „fehlgeschlagen“ zu melden. Fehler stehen als Text im Monitor (nicht mehr nur als kurze Meldung) mit Ursache: 401/403 (API-Schlüssel), 409 (Server beschäftigt), 415, 503 (zu wenig freier Grafikspeicher oder `before_load` fehlgeschlagen). Ist ein Server entladen und liefert dann kein `/metrics`, erkennt die App das über `/v1/status` bzw. `/health` und aktiviert den Knopf trotzdem. Ist der Server gar nicht erreichbar, führt ein Knopf direkt zu „Modell starten“: Das Laden per HTTP geht nur, wenn der Strata-Server selbst läuft.

## Kontext-Verwaltung

- **Automatisches Verschlanken:** Wird das Kontextfenster knapp, ersetzt die App alte Datei-Inhalte (read_file-Ergebnisse, große write_file/edit_file-Texte) im gesendeten Verlauf durch Kurznotizen. Der gespeicherte Chat bleibt vollständig. Verschlankt wird nur gelegentlich (auf ca. 55 % des Budgets), damit der Server seinen Prompt-Cache nutzen kann. Ein kleines Symbol „Kontext verschlankt“ in der Statistikzeile zeigt, wann es passiert ist. Einstellungen → Workspace & Dateien → Kontext-Verwaltung.
- **Wichtig bei Strata, llama.cpp, LM Studio:** Trage unter Einstellungen → Modell & Parameter die echte Kontextlänge des Servers ein (z. B. 262144). Bei OpenAI-kompatiblen Servern wird sie nicht gesendet, sie steuert Anzeige und Verschlanken. Meldet der Server „context window (N)“, übernimmt die App N automatisch.
- **Gezieltes Lesen:** `read_file` liefert Zeilennummern und kennt `start_line`/`end_line`, pro Aufruf höchstens 40 KB (einstellbar). Neu: `edit_file` ersetzt nur eine Textstelle statt die ganze Datei neu zu schreiben.
- **Sampling:** Min-P und Presence-Penalty sind neu. Top-K, Wiederholungsstrafe, Min-P und Presence-Penalty werden bei OpenAI-kompatiblen Servern nur gesendet, wenn in der Verbindung „Erweiterte Parameter“ aktiv ist.

## Strata und die Kontextgröße

Die „native“-Instanz von Strata meldet ihr Kontextfenster nicht über `/v1/models` (bekannte Lücke im Strata-Projekt). Die LLM Box probiert deshalb zusätzlich `/props`, `/slots`, `/status`, `/v1/status` und `/metrics`. Hilft das nicht, wähle unter Einstellungen → Verbindungen die Datei `strata-….json`: Die App liest daraus `--max-context`. „Verbindung testen“ zeigt, woher der Wert stammt.

## Echtzeit-Füllstand

Während eine Antwort läuft, aktualisieren sich die Kontext-Anzeige oben und die Zeile unter dem Eingabefeld laufend (ein pulsierender Punkt zeigt den Live-Modus). Der Prompt-Anteil wird zuerst geschätzt (mit `~`) und, sobald der Server `/slots` anbietet, durch den echten Wert (`n_prompt_tokens`) ersetzt. Der Antwort-Anteil zählt die gestreamten Stücke (≈ Tokens, inklusive Denken). Nach jedem Schritt zeigt die App wieder die exakten Zahlen aus der Server-Abrechnung. Bietet der Server `/slots` nicht, bleibt es bei der Schätzung.

## Unteragenten

Mit aktivem Dateizugriff kann die KI das Werkzeug `delegate_task` nutzen: Ein Unteragent bekommt eine Teilaufgabe, arbeitet mit eigenem, frischem Kontext (nur lesen und suchen) und liefert eine Zusammenfassung zurück. Mehrere Unteragenten in einer Antwort starten gleichzeitig. Oben neben der Modellauswahl zeigt **Unteragenten**, wie viele arbeiten, woran, wie lange und mit welchem Status (läuft, abgeschlossen, fehlgeschlagen, abgebrochen). Klick auf einen Eintrag zeigt Aufgabe und Ergebnis. Der Server arbeitet Anfragen nur dann wirklich parallel ab, wenn er das erlaubt (bei Strata: `"parallel": N` in der JSON). Einstellungen: Workspace & Dateien.

## Kontext leeren (bevorzugt) oder neue Session mit Übergabe

Wird der Kontext knapp (Standard ab 70 %), empfiehlt die KI das Leeren oder die App weist selbst darauf hin. Es erscheint die Schaltfläche **Kontext leeren und weiterarbeiten**, daneben **Stattdessen neue Session**. Die KI kann dafür das Werkzeug `propose_new_session` nutzen (mit Übergabe und nächstem Schritt).

- **Kontext leeren (Standard):** Der Chat bleibt derselbe. Der alte Verlauf bleibt sichtbar (gedämpft, mit Trennlinie „Kontext geleert“), wird der KI aber nicht mehr gesendet. Sie bekommt als erste Nachricht die Übergabe: ursprüngliches Ziel, Stand (von der KI), automatisch erfasste geänderte Dateien, Ergebnisse der Unteragenten, nächster Schritt und deine letzte Anweisung. Der Füllstand-Balken zählt danach nur den Kontext, den die KI noch sieht. Freigaben, Titel und Verlauf bleiben erhalten.
- **Neue Session:** öffnet wie bisher einen neuen Chat mit derselben Übergabe. Das passiert automatisch, wenn Leeren nicht möglich ist (nichts zu leeren, oder ein anderer Rechner arbeitet im Chat), oder wenn du es in den Einstellungen so bevorzugst.
- Der Knopf oben rechts startet den bevorzugten Weg jederzeit von Hand. **Umschalt+Klick** nimmt den anderen Weg.
- Einstellungen → Workspace & Dateien: „Bei vollem Kontext bevorzugen“ (Kontext leeren / Neue Session), Schwelle in %, „Übergabe sofort senden“.

## Pausieren und Fortsetzen

Solange die KI arbeitet, steht neben dem Senden-Knopf ein **Pause-Knopf**. Ein Klick hält den Auftrag an, ein zweiter Klick (**Fortsetzen**, auch in der Leiste über dem Eingabefeld) macht an derselben Stelle weiter. **Stopp** beendet den Auftrag sofort und hart, auch aus der Pause heraus: Modell-Antwort, laufende Programme (samt Unterprozessen), Dateisuche und andere Werkzeuge, Unteragenten und offene Rückfragen werden abgebrochen. Hängt ein Werkzeug (z. B. eine langsame Suche auf einem Netzlaufwerk), wartet die App nicht darauf. Noch offene Werkzeugaufrufe werden im Verlauf als „Vom Nutzer abgebrochen“ vermerkt, damit der Chat danach normal weitergeführt werden kann.

- **Während die KI schreibt oder nachdenkt:** Die Antwort wird sofort angehalten, der bisherige Text bleibt sichtbar. Beim Fortsetzen fragt die App genau diesen Schritt mit demselben Verlauf noch einmal an (der Server nutzt dafür meist seinen Prompt-Cache). Die bis dahin erzeugte Teilantwort wird dabei ersetzt, nicht angehängt.
- **Während ein Programm oder Unteragent läuft:** Es wird nicht abgebrochen oder zerstört. Die Pause greift, sobald dieser Schritt fertig ist; bis dahin zeigt die Leiste „Pause wird wirksam …“. Danach macht die KI mit dem nächsten Schritt weiter.
- Offene Rückfragen und Freigaben bleiben offen. Die Pause gilt für den laufenden Chat und endet mit dem Auftrag; sie wird nicht über einen Neustart der App gespeichert.

## Rechtschreibprüfung

Im Eingabefeld werden falsch geschriebene Wörter mit der bekannten roten Wellenlinie unterstrichen. **Rechtsklick** auf das Wort zeigt bis zu sechs Vorschläge (Klick ersetzt das Wort) und **Zum Wörterbuch hinzufügen**. Das Rechtsklick-Menü bietet außerdem Ausschneiden, Kopieren, Einfügen und Alles auswählen (in Eingabefeldern) bzw. Kopieren (bei markiertem Text im Chat).

- Einstellungen → Darstellung: **Rechtschreibprüfung** ein/aus und **Sprachen** (Deutsch und Englisch, nur Deutsch, nur Englisch). Bei „Deutsch und Englisch“ gilt ein Wort nur dann als falsch, wenn es in keiner der beiden Sprachen vorkommt. So werden englische Fachwörter nicht ständig markiert. Standard: eingeschaltet, Deutsch und Englisch.
- Die Wörterbücher lädt die App beim ersten Start selbst herunter (unter Windows ist dafür eine Internetverbindung nötig). Danach funktioniert die Prüfung auch offline. Eigene Wörter bleiben im Datenordner gespeichert.
- Die Prüfung läuft lokal im Fenster. Der Text wird nicht an dein Modell oder einen Dienst von uns geschickt.

## Gedankengang auf Deutsch

Denkt das Modell auf Englisch, übersetzt die App den Gedankengang mit demselben Modell und zeigt die deutsche Fassung an (Original per Klick). Einstellungen → Aussehen: „Automatisch“ (im Hintergrund nach Abschluss der Antwort), „Beim Aufklappen“ oder „Aus“. Die Übersetzung wird im Chat gespeichert. Optional kann das Modell per Systemprompt gebeten werden, gleich auf Deutsch zu denken.

## Transparenz für Farben

Unter Einstellungen → Aussehen hat jede Farbe (auch die Akzentfarbe) einen Regler für die Deckkraft (100 % = undurchsichtig, 0 % = unsichtbar). Er gilt getrennt für den dunklen und den hellen Modus. Auch ohne eigene Farbe lässt sich nur die Transparenz der Standardfarbe ändern. Unter „Fenstermaterial (Windows 11)“ lässt sich Acrylic oder Mica einschalten, damit der Desktop durch transparente Flächen scheint.

## Design anpassen

Einstellungen → Darstellung: 8 Farbschemata zum Anklicken, jede Farbe einzeln änderbar (getrennt für dunklen und hellen Modus: Chat-Hintergrund, Seitenleisten, Karten, Eingabefeld, Nachrichtenblasen, Text, Rahmen, Code), Akzentfarbe, Schriftart für Oberfläche und Code (auch eigene installierte Schriften), Schriftgröße, Zeilenabstand, Chatbreite, Eckenrundung, Seitenleistenbreite sowie Hintergrund (Reuschler-IT-Wallpaper, eigenes Bild mit Intensität und Weichzeichner, oder einfarbig).

## Daten

Chats und Einstellungen liegen unter `%APPDATA%\LLM Box`. API-Schlüssel werden dort unverschlüsselt gespeichert.

## Bekannte Grenzen

- Dokumente werden nur gelesen, nicht erzeugt. Gescannte PDFs ohne Text (OCR) und alte Formate (.doc, .xls, .ppt) werden nicht gelesen.
- Token-Schätzung vor dem Senden ist grob (Zeichen / 3,8).
- Getestet wurde die Logik gegen Mock-Server (Ollama, OpenAI-Stream). Die Electron-Oberfläche selbst habe ich hier nicht auf einem echten Windows-Rechner gestartet.

---
© 2026 Reuschler-IT. Alle Rechte vorbehalten.
