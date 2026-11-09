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

## Neue Session mit Übergabe

Wird der Kontext knapp (Standard ab 70 %), empfiehlt die KI eine neue Session oder die App weist selbst darauf hin, erscheint eine Schaltfläche **Neue Session mit Übergabe starten**. Die KI kann dafür das Werkzeug `propose_new_session` nutzen (mit Übergabe und nächstem Schritt). Ein Klick öffnet einen neuen Chat und übergibt automatisch: ursprüngliches Ziel, Stand (von der KI), automatisch erfasste geänderte Dateien, Ergebnisse der Unteragenten, nächster Schritt und deine letzte Anweisung. Die Schaltfläche oben rechts (Pfeil im Kreis) startet das jederzeit von Hand. Einstellungen: Workspace & Dateien.

## Gedankengang auf Deutsch

Denkt das Modell auf Englisch, übersetzt die App den Gedankengang mit demselben Modell und zeigt die deutsche Fassung an (Original per Klick). Einstellungen → Aussehen: „Automatisch“ (im Hintergrund nach Abschluss der Antwort), „Beim Aufklappen“ oder „Aus“. Die Übersetzung wird im Chat gespeichert. Optional kann das Modell per Systemprompt gebeten werden, gleich auf Deutsch zu denken.

## Transparenz für Farben

Unter Einstellungen → Aussehen hat jede Farbe (auch die Akzentfarbe) einen Regler für die Deckkraft (100 % = undurchsichtig, 0 % = unsichtbar). Er gilt getrennt für den dunklen und den hellen Modus. Auch ohne eigene Farbe lässt sich nur die Transparenz der Standardfarbe ändern. Unter „Fenstermaterial (Windows 11)“ lässt sich Acrylic oder Mica einschalten, damit der Desktop durch transparente Flächen scheint.

## Design anpassen

Einstellungen → Darstellung: 8 Farbschemata zum Anklicken, jede Farbe einzeln änderbar (getrennt für dunklen und hellen Modus: Chat-Hintergrund, Seitenleisten, Karten, Eingabefeld, Nachrichtenblasen, Text, Rahmen, Code), Akzentfarbe, Schriftart für Oberfläche und Code (auch eigene installierte Schriften), Schriftgröße, Zeilenabstand, Chatbreite, Eckenrundung, Seitenleistenbreite sowie Hintergrund (Reuschler-IT-Wallpaper, eigenes Bild mit Intensität und Weichzeichner, oder einfarbig).

## Daten

Chats und Einstellungen liegen unter `%APPDATA%\LLM Box`. API-Schlüssel werden dort unverschlüsselt gespeichert.

## Bekannte Grenzen

- Nur Text- und Bilddateien. PDF/Word werden nicht ausgelesen.
- Token-Schätzung vor dem Senden ist grob (Zeichen / 3,8).
- Getestet wurde die Logik gegen Mock-Server (Ollama, OpenAI-Stream). Die Electron-Oberfläche selbst habe ich hier nicht auf einem echten Windows-Rechner gestartet.

---
© 2026 Reuschler-IT. Alle Rechte vorbehalten.
