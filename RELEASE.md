# LLM Box 1.0.83 (Windows, Linux und Android)

**Stand dieser Datei:** Windows- und Android-Fassung sind auf **1.0.83** gebaut und als Dateien am
GitHub-Release [1.0.83](https://github.com/ReuschlerIT/LLM-Box/releases/tag/1.0.83) eingestellt
(Setup, portable EXE, APK). Im Repository liegen sie nicht mehr – die Windows-Programme sind rund
84 MB. Die Android-Fassung trägt **1.0.83-android**
(versionCode 83). Beide Fassungen entstehen aus **derselben
Quelle** (`llm-box/`), die Android-Oberfläche wird beim Bauen aus den Dateien von `llm-box/renderer/`
erzeugt. Vorgängerversion auf GitHub: [1.0.82](https://github.com/ReuschlerIT/LLM-Box/releases/tag/1.0.82),
[1.0.70](https://github.com/ReuschlerIT/LLM-Box/releases/tag/1.0.70),
[1.0.65](https://github.com/ReuschlerIT/LLM-Box/releases/tag/1.0.65),
[v1.0.50](https://github.com/ReuschlerIT/LLM-Box/releases/tag/v1.0.50)

Die aktuelle Fassung bringt das nachgereichte **Modellprofil für kleine, stark quantisierte Modelle
(IQ3/Q3)** nach der Qwen-Empfehlung für den Denkmodus (gegen Denkschleifen und abgeschnittene
Antworten), einen gestrafften **System-Prompt**, die **Strata-Entwurfsverfahren** und neue
Übersetzungen. Vorgängerversion 1.0.82 brachte **autonomen Modus**, **Live-Ansicht und Hub**,
**Module im Stil von Open WebUI**, den **Gesamtverbrauch**, rund 290 neue Sprachen-Texte und eine
**Linux-Fassung**.

## Programme

Android-Programm der aktuellen Fassung und die zuletzt gebauten Windows-Programme
(alle aus derselben Quelle, als Dateien am GitHub-Release):

| Datei | Für | Größe |
|---|---|---|
| `LLM.Box.Setup.1.0.83.exe` | Windows 10/11, Installer | 84,1 MB |
| `LLM.Box.1.0.83.portable.exe` | Windows 10/11, ohne Installation | 83,8 MB |
| `LLM-Box-1.0.83-android.apk` | Android 8.0 oder neuer, Fassung 1.0.83-android | 10,9 MB |

Beide Fassungen haben dieselbe Oberfläche und dasselbe Chat-Format. Bestehende Einstellungen,
Verbindungen und Chats bleiben beim Update erhalten.

---

## Die Höhepunkte seit 1.0.50

### Große Chats: Aufbau rund 50× schneller
Der Nachrichtenbereich wurde bisher vollständig geleert und jede Nachricht einzeln neu aufgebaut. An
einem echten Chat mit 3402 Nachrichten gemessen: **2966 ms und rund 110.000 DOM-Knoten** pro Aufbau –
jeder folgende Layout-Durchlauf war dadurch teuer (Zögern beim Öffnen, beim Umschalten von Panel oder
Dock, beim Übergeben an die KI).

Seit 1.0.59 wird **fensterweise** aufgebaut: nur die sichtbaren Nachrichten erscheinen vollständig,
darüber kompakte Zeilen und eine Sammelzeile „ältere anzeigen“. Derselbe Chat braucht jetzt
**60 ms und rund 2760 Knoten**; am größten echten Chat (13 MB, 3487 Nachrichten) bleibt der Aufbau
konstant bei etwa 2755 Knoten. Entlastend gemessen: Tippen war nie die Ursache – 100 Tastenanschläge
bei 3402 Nachrichten kosten 149 ms.

### Windows-Freigabe als Arbeitsordner (ab 1.0.61)
Ein Netzlaufwerk lässt sich direkt als Workspace nutzen, ohne etwas zu kopieren: neue Zeile im Reiter
„Workspace & Dateien“ mit Adresse, Benutzer, Domain, Passwort und dem Knopf **„Verbinden & übernehmen“**.
Zugangsdaten liegen in einer eigenen Datei im App-Ordner, getrennt von den App-Einstellungen. Auf dem
Handy gab es diese Möglichkeit schon früher; der PC zieht jetzt nach.

Dazu ab 1.0.63: Ein als **Laufwerksbuchstabe** eingebundenes Netzlaufwerk wurde vorher als frei
erfundener Rechner fehlgedeutet – die Übergabe des Netzwerkordners scheiterte daran. Jetzt wird die
dahinterliegende Freigabe bei Windows abgefragt und benutzt; ein einzelner Laufwerksbuchstabe wird als
Rechner-Adresse ausdrücklich abgelehnt.

### Übertragung zwischen PC und Handy
- **Ein QR-Code statt sechs** Bildern: Die Windows-App bietet ihre Daten im WLAN an, das andere Gerät
  sucht sie selbst („Im WLAN suchen“) oder liest den einen Code. (Windows-seitig behoben in 1.0.54)
- **Das Handy scannt selbst mit der Kamera**, ohne zusätzliche QR-App – erkannt wird die Adresse des
  Angebots ebenso wie eine mehrteilige Bildfolge; fremde Codes werden nur angezeigt, nicht übernommen
  (ab 1.0.62).
- **Netzwerkordner samt Zugangsdaten wandert mit** (ab 1.0.61).
- **Nach der Übernahme ist alles sofort wirksam** – Verbindung, Modell und Werkzeuge, ohne
  App-Neustart (ab 1.0.55).
- **„Im WLAN anbieten“ ist mehrfach hintereinander nutzbar**: Das Angebot wird nach dem Abruf
  vollständig abgeschaltet, auch das Rufsignal im WLAN (ab 1.0.56).

### Chats auf mehreren Geräten
Neue Einstellung **„Chats abgleichen alle …"** mit Stufen von 2 Sekunden bis 30 Minuten, ohne Neustart
wirksam (ab 1.0.57). Beim Zurückkehren ins Fenster wird sofort abgeglichen. Gesperrte Chat-Metadaten
gelten nicht mehr als „gelöscht“ – Chats verschwinden nicht mehr aus der Liste, wenn ein Netzlaufwerk
oder ein anderes Programm eine Datei blockiert (ab 1.0.58).

### Sprache: Deutsch, English, Français (ab 1.0.66)
Die ganze Oberfläche ist übersetzt – Beschriftungen, Knöpfe, Hilfetexte, Dialoge, Statuszeile, Tooltips
und Fehlermeldungen (Wörterbuch 1.036 Einträge, 150 Muster). Beim **allerersten Start** fragt die App
nach der Sprache; die Wahl gilt sofort auch für die Antwortsprache der KI und den Standard-Prompt. Chat-
Inhalt wird nie übersetzt. Umzuschalten unter *Einstellungen → Darstellung → Sprache der App* (ab 1.0.67).

### Modellprofil für kleine, stark quantisierte Modelle (ab 1.0.66)
Neues Profil **„Kleines / stark quantisiertes Modell (IQ3/Q3)"** – kurzer System-Prompt und kurze
Werkzeugbeschreibungen (rund 2.500 statt 4.000 Tokens je Anfrage), neue Einstellung
**„Arbeitskontext-Obergrenze (Tokens)"**. Dazu Korrekturen gegen vorzeitige Abbrüche im Werkzeugmodus
(`effCtx()`, `looksUnfinished()`, Prompt-Baustein `actHint`).

---

## Änderungen im Einzelnen

### Version 1.0.50 *(auf GitHub bereits veröffentlicht – hier als Ausgangspunkt)*
- **Rechtschreibprüfung** im Eingabefeld: falsch geschriebene Wörter mit roter Wellenlinie.
- **Rechtsklick-Menü** mit Rechtschreib-Vorschlägen (bis zu sechs), „Zum Wörterbuch hinzufügen“ sowie
  Ausschneiden/Kopieren/Einfügen/Alles auswählen – ein solches Menü gab es vorher nicht.
- **Sprachen wählbar**: Deutsch, Englisch oder beide; zwei neue Einstellungen unter „Darstellung“.
  Die Wörterbücher werden beim ersten Start geladen und arbeiten danach offline.

### Version 1.0.51
- **Behoben:** Fehlermeldung „Chat konnte nicht gespeichert werden … ENOENT: rename ‚….json.tmp' →
  ‚….json'". Ursache: alle Speichervorgänge einer Datei teilten sich denselben Temporärnamen. Beim
  Antworten wird sehr oft gespeichert; überlappen sich zwei Vorgänge, ist die Datei beim zweiten schon
  weg – auf Netzlaufwerken und mit Virenscanner häufiger. Jetzt: Warteschlange pro Datei, eindeutiger
  Name, bis zu fünf Wiederholungen, zuletzt direktes Schreiben.
- **Behoben:** Die Antwort sprang beim Tippen hoch und runter, während die KI arbeitete. Das Eingabefeld
  wurde bei jedem Zeichen kurz zusammengefaltet und änderte damit die Höhe des Nachrichtenbereichs.
  Jetzt wird die Höhe über ein unsichtbares Spiegel-Feld gemessen; eine einmal gewählte Leseposition
  bleibt erhalten.

### Version 1.0.52
- **Neu:** Einstellungsseite **„Übertragung“** mit QR-Bildfolge und JSON-Export. Übertragen werden alle
  Einstellungen, Verbindungen (inklusive API-Schlüssel), Modell, Parameter, System-Prompt, Darstellung
  und – wenn ausgewählt – Chats und Textdateien des Workspace. Ein einzelner QR-Code fasst rund 3 KB,
  deshalb gibt es die Bildfolge (zu je 600 Zeichen) und die JSON-Datei. Format dokumentiert in
  `llm-box/docs/TRANSFER-FORMAT.md`.
- **Grenze dieser Version:** Nur Export. Workspace-Dateien gingen nur in der JSON-Datei mit, und einen
  Import in die Windows-App gab es noch nicht.

### Version 1.0.53
Für diese Version ist **kein eigener Änderungsabschnitt belegt**. Nachgewiesen ist nur, dass dieser
Stand existierte und bereits den Reiter „Übertragung“ sowie die Einstellung „Max. Werkzeug-Schritte am
Stück“ (Standard 25) enthielt – außerdem beide in 1.0.54 behobenen Übertragungsfehler.

### Version 1.0.54
- **Behoben:** Fehlermeldung „ReferenceError: z is not defined" genau beim Klick auf „Im WLAN
  anbieten". Die Größenangabe des Angebots griff auf eine Variable zu, die bei einer früheren Umstellung
  weggefallen war.
- **Behoben:** Jeder Abruf antwortete „403 – Token passt nicht". Die erzeugten Adressen endeten auf
  `#token`; ein Fragment wird über HTTP aber nie an den Server übermittelt. Das Token hängt jetzt als
  Query-Parameter an der Adresse.

### Version 1.0.55
- **Behoben:** Übernommene Einstellungen waren erst nach einem App-Neustart wirksam. Die Datei war
  korrekt geschrieben, die laufende Oberfläche behielt aber ihren beim Start geladenen Stand – und ein
  verzögerter Speicher-Vorgang schrieb kurz danach den alten Zustand zurück. Nachgewiesen mit einem
  Vergleichswerkzeug: Die Dateien waren identisch, der Fehler lag im Neuladen.

### Version 1.0.56
- **Behoben:** „Im WLAN anbieten" war nur einmal benutzbar; das zweite Gerät bekam „HTTP 0". Nach dem
  Abruf wurde nur der HTTP-Dienst geschlossen, das Rufsignal im WLAN blieb gebunden – suchende Geräte
  fanden die tote Adresse des bereits abgerufenen Rechners.

### Version 1.0.57
- **Neu:** Abgleich-Rhythmus wählbar (2 s / 5 s / 10 s / 30 s / 1 min / 5 min / 10 min / 30 min), ohne
  Neustart wirksam; die Statuszeile zeigt die gewählte Stufe.
- **Verbessert:** Der feste Drei-Sekunden-Takt ist durch einen selbst nachplanenden Timer ersetzt – nur
  so greift eine längere Einstellung sofort. Beim Zurückkehren ins Fenster wird sofort abgeglichen.

### Version 1.0.58
- **Behoben:** Eine Chat-Metadatei, die sich nicht lesen ließ (Sperrung durch Netzlaufwerk oder ein
  anderes Programm), galt als „entfernt" – der Chat verschwand aus der Liste und die ganze Liste wurde
  neu aufgebaut. Jetzt gilt nur „Datei existiert nicht" als Entfernen; eine Sperre nutzt den zuletzt
  erfolgreich gelesenen Stand weiter.
- **Ehrliche Einordnung:** Die Vermutung, diese Sperren seien die Ursache für das Zögern großer Chats,
  wurde durch Messung **widerlegt** – die betroffenen Dateien waren dauerhaft gesperrt und gehörten zu
  Chats ohne zugehörige Datei. Der Fix bleibt sinnvoll, war aber nicht die Lösung; die kam in 1.0.59.

### Version 1.0.59
- **Der fensterweise Nachrichtenaufbau** (siehe Höhepunkte oben) – Windows und Android, weil beide
  dieselbe Oberfläche nutzen.

### Version 1.0.60
- **Behoben:** Eine im Abgleich fehlende Generations-Marke nachgebaut: Ein überholter Durchlauf konnte
  erneut nachplanen und damit eine zweite Abgleich-Kette erzeugen. Wirkt beim Wechsel des Rhythmus
  während eines laufenden Abgleichs – es war **nicht** die Ursache der Chat-Bremse (die hatte 1.0.59).

### Version 1.0.61
- **Neu:** Windows-Freigabe als Arbeitsordner, inklusive Verbindungstest und eigenem Speicher für
  Zugangsdaten (siehe Höhepunkte oben).
- **Behoben:** Workspace-Dateien wanderten beim WLAN-Weg bisher nie mit – der Auslieferungsdienst baute
  sein Angebot ohne diesen Anteil.

### Version 1.0.62
- **Neu (auf dem Handy):** Eigener QR-Scan mit der Kamera, ohne zusätzliche App. Erkannt wird die
  Adresse des Angebots ebenso wie eine mehrteilige Bildfolge; fremde Codes werden nicht übernommen.
- **Behoben:** Die Kamera blieb nach einem Abbruch belegt und der Scan-Knopf dauerhaft ausgegraut.
- **Verbessert:** Ein irreführender Hilfetext („… mit einer beliebigen QR-App lesen") ersetzt. In der
  Windows-Oberfläche erscheint der Scan-Knopf bewusst nicht – dort wird angeboten, nicht gescannt.

### Version 1.0.63
- **Behoben:** Auflösung eines gemappten Netzlaufwerks zur echten Freigabe (siehe Höhepunkte oben).
- **Behoben (auf dem Handy):** Der Scan-Dialog schloss nie, und der Knopf blieb ausgegraut, wenn der
  Dialog über Kreuz oder Escape geschlossen wurde.

### Version 1.0.64
Diese Nummer existiert **nur für Android** – ein Windows-Build 1.0.64 wurde nicht erstellt; die
Windows-Änderungen dieses Zeitraums stecken in 1.0.63.
- **Behoben:** Schwarze Kamera-Vorschau auf manchen Handys. Ursache war **nicht** die Berechtigung,
  sondern eine Wiedergaberegel der App: Die Vorschau durfte ohne vorangegangene Nutzeraktion nicht
  starten.
- Abbruch eines Scans gibt die Kamera wieder frei; der Dialog bleibt nicht mehr stehen.

### Version 1.0.65
- **Android:** Einheitliche Kopfzeile – der Knopf „Modelle neu laden" ist dort nicht mehr sichtbar,
  weil Modelle beim Start, bei einem Verbindungswechsel und beim Schließen der Einstellungen ohnehin neu
  geladen werden. Die Kopfzeile bleibt dadurch einzeilig statt zweizeilig (gemessen: 168 px → 87 px);
  die Auswahlfelder bleiben unverändert lesbar. Der Verbindungstest empfiehlt außerdem keinen Knopf
  mehr, den es auf dem Handy nicht gibt.
- **Windows:** Diese Version ist der Veröffentlichungsstand – Aufbau aus einer bereinigten Quelle,
  Diagnose-Sonden entfernt, Beispielwerte neutralisiert. Neue Funktionen kamen für Windows nicht hinzu.

### Version 1.0.66
- **Neu: Sprachauswahl Deutsch / English / Français** für die ganze Oberfläche (Beschriftungen, Knöpfe,
  Hilfetexte, Dialoge, Statuszeile, Tooltips, Fehlermeldungen, Server-Fenster, Übertragung,
  Platzhalter). Die KI antwortet in derselben Sprache; Chat-Inhalt wird nie übersetzt. Wörterbuch jetzt
  1.036 Einträge und 150 Muster, neue Datei `i18n-lex-full.js` mit rund 590 Einträgen.
- **Neu: Modellprofil „Kleines / stark quantisiertes Modell (IQ3/Q3)“** unter *Einstellungen → Modell &
  Parameter* (Temperatur 0,3, Top-K 20, Kontext-Obergrenze 64000, 40 Werkzeug-Schritte …) und die neue
  Einstellung **„Arbeitskontext-Obergrenze (Tokens)“** unter *Workspace & Dateien*. IQ3 ist der Standard
  für neue Installationen und wird bei bestehenden genau einmal gesetzt (Merker `profileIq3V65`).
- **Verbessert: kurzer System-Prompt und kurze Werkzeugbeschreibungen im IQ3-Profil** – rund 2.500 statt
  4.000 Tokens je Anfrage. Das Feld „System-Prompt“ zeigt jetzt die Fassung, die tatsächlich gesendet
  wird (Sprache und Profil); eigene Prompts bleiben unberührt. Neuer Knopf „Standard-Prompt
  wiederherstellen“.
- **Behoben: die KI brach im Werkzeugmodus ab.** Drei Ursachen: die Aufforderung „Du hast einen nächsten
  Schritt angekündigt“ erkannte Abbrüche auf einen Punkt nicht (`looksUnfinished()`, jetzt bis 3 Mal in
  Folge); Komprimierung und Übergabe-Hinweis richteten sich nach dem großen Server-Fenster statt nach dem
  wirksamen Arbeitskontext (`effCtx()`); der Prompt hatte keine Regel gegen „ankündigen ohne handeln“
  (neuer Baustein `actHint`).
- **Verbessert:** einheitliches Raster für alle Einstellungs-Reiter (Änderungen nur angehängt in
  `styles.css`, damit die Android-Build-Patches unverändert greifen).

### Version 1.0.67
- **Neu: Sprachabfrage beim allerersten Start** – Dialog „Sprache wählen · Choose your language ·
  Choisissez votre langue“ mit Deutsch, English, Français, dreisprachig und nie übersetzt. Er erscheint
  nur bei einer Installation ohne gespeicherte Einstellungen, schlägt die Systemsprache vor, ist nicht
  wegklickbar (Escape und Klick daneben gehen nicht) und die Wahl gilt sofort für Oberfläche,
  Antwortsprache und Standard-Prompt. Später änderbar unter *Einstellungen → Darstellung → Sprache der App*.
- **Behoben (Android): die Sprachwahl beim ersten Start ging verloren.** Die Android-Schicht
  (`tools-android\native-main.js`) hatte – anders als `llm-box\main.js` – **keine Schreib-Queue pro
  Datei**. Beim allerersten Start schreibt der Start viermal unabgewartet in `settings.json`
  (Design-Standard, Prompt-, Verbindungs- und Profil-Migration); die Schreibung der Sprachwahl lief
  dazwischen ein und wurde von einer später fertig werdenden Migration mit altem Stand überschrieben –
  `uiLang` blieb „de“, `langChosen` fehlte, der Dialog kam erneut. Jetzt sind die Schreibvorgänge pro
  Datei aufgereiht (`writeQueues`), die letzte Schreibung gewinnt. Am Handy geprüft: Sprache gewählt,
  `settings.json` enthält `uiLang` und `langChosen`, Oberfläche englisch, nach Neustart kein Dialog mehr.
- **Behoben (Android): drei deutsche Reste bei englischer Oberfläche** – „Farben (heller Modus)“,
  der Preisvorlagen-Hinweis und der SMB-Hinweis. Ursache beim Preisvorlagen-Hinweis war die
  Satztrennung in `i18n.js`: sie zerteilte „1 Mio. Token“ am Punkt der Abkürzung, übersetzt wurde nur
  der zweite Teilsatz. Neu: `splitSentences()` mit Abkürzungsliste (`ABBREV_RE`).

### Version 1.0.68
- **Neu: Claude (Anthropic) als eigener Verbindungstyp** – Messages-API mit Streaming, Werkzeugen,
  Bildern, Stop-Sequenzen, Denkaufwand („Adaptiv + effort" oder festes Budget) und Prompt-Caching;
  eigene Diagnose mit Testanfrage von höchstens 16 Token.

### Version 1.0.69 und 1.0.70 (gemeinsamer Abschnitt)
- **Neu: Stromverbrauch.** Einstellung „Strompreis (€ je kWh)" unter *Einstellungen → Kosten*,
  sekundliche GPU-Leistungsmessung des überwachten Servers, Anzeige „Strom ≈ … €" in der Statuszeile
  und Stromkosten pro Antwort.
- **Neu: Hinweise an die laufende KI.** Eingaben während einer Antwort gehen als Hinweis in den
  laufenden Auftrag (`inbox`) und werden nach dem aktuellen Schritt zugestellt; der Knopf „Jetzt"
  unterbricht die Antwort sofort. Nicht zugestellte Hinweise kommen ins Eingabefeld zurück.
- **Neu: mehrere Aufträge pro Chat** (`RUNS`, `viewRun()`, `discardAllRuns`), Werkzeugkarten an den
  Auftrag gebunden (`tlClear(R)`), Unteragenten an den Chat (`owner: chat.id`).
- **Behoben:** unübersetzter Platzhalter „(Fortsetzung des Gesprächs)"; zwei veraltete
  Wörterbuch-Einträge zum alten Vormerken entfernt.
- **Android-Bau:** mehrzeilige Suchtexte der Build-Patches werden an die Zeilenenden der Quelle
  angepasst (die Quelle liefert CRLF, die Skript-Here-Strings sind LF – sonst findet der
  Statuszeilen-Patch seinen Text nicht). Neue Stromangabe zusätzlich in eine eigene
  Statuszeilen-Zeile verpackt. Zwei neue Prüfläufe: `tools-android\patch-check.js` (alle
  Patch-Suchtexte gegen die Quelle, ohne zu bauen) und `tools-android\bruecken-check.js`
  (verweist die Android-Brücke noch auf existierende Interna der Desktop-Seite).

### Version 1.0.71 bis 1.0.83 (gemeinsamer Abschnitt)
- **1.0.71:** Modellauswahl zeigt jetzt alle installierten Strata-Modelle (Abfrage `/api/native`,
  entladen und nachladen auf Wunsch); Klick auf eine Datei im Workspace-Panel ist einstellbar
  (öffnen, anhängen, nachfragen, im Ordner zeigen).
- **1.0.72:** **Live-Ansicht** – Chats geräteübergreifend in Echtzeit, Wort für Wort. Die
  Windows-App bietet ihre Chats im WLAN an (Adresse mit geheimem Schlüssel, QR-Code), Windows und
  Android zeigen sie schreibgeschützt mit; „Fernsteuerung erlauben" erlaubt Senden und Stoppen.
  Protokoll: `docs/LIVE-ANSICHT.md`. Neue Datei `renderer/js/live.js`.
- **1.0.73:** **Funktionen & Ansicht** – jede Funktion einzeln schaltbar, Profile „Schlicht",
  „Standard", „Alles"; Einstellungen neu gegliedert. Neue Module: **Prompt-Bibliothek**
  („/"-Befehle), **Assistenten**, **Gedächtnis** (`/merke`), **Wissenssammlungen** (BM25),
  **Websuche**, **Vorlesen**, **Chats ordnen**. Neue Dateien `renderer/js/modules.js`, `renderer/js/owui.js`.
- **1.0.74:** **LLM Box Hub** (`hub/hub.js`) – Server ohne Oberfläche für Linux und Windows
  (Node.js 18+, keine Pakete): speichert Chats, ruft Modelle auf (Schlüssel nur auf dem Hub),
  verteilt alles in Echtzeit; die Antwort läuft weiter, wenn Gerät oder App zu sind. systemd-Datei,
  Start-Skripte, `--add-connection`/`--set-default`/`--show`.
- **1.0.75:** Rechtschreibprüfung auf Französisch (auch Kombinationen mit Deutsch/Englisch).
- **1.0.76:** **MIT-Lizenz** (`LICENSE`) und `THIRD-PARTY-NOTICES.md` (alle enthaltenen
  Open-Source-Bausteine), beides jetzt auch in der gebauten Programmdatei.
- **1.0.77/1.0.78:** **Websuche ohne eigenen Server** – DuckDuckGo (Standard, ohne Konto), Brave,
  Wikipedia, Tavily, Serper, Exa, SearXNG optional; klare Fehlermeldungen je Anbieter, kein
  stiller Anbieterwechsel bei Schlüsseln.
- **1.0.79:** Behoben: Anbieter der Websuche (und Live-Einstellungen, Sprechgeschwindigkeit)
  ließ sich nicht umstellen – die Einstellungen wurden bei jedem Zugriff durch eine Kopie ersetzt.
- **1.0.80:** **Autonomer Modus** – die KI arbeitet vollständig selbstständig (keine Rückfragen,
  keine Freigaben, Kontext leert sich selbst per Übergabe, Weitermachen bis `finish_task`,
  Höchstdauer 8 h, Höchstzahl Werkzeugaufrufe, Schleifenerkennung, Rechner wach halten,
  gefährliche Befehle blockiert). Neue Datei `renderer/js/auto.js`.
- **1.0.81:** Eingabeleiste: alle Knöpfe in einer Reihe mit Tooltips; Autonom-Leiste oben im Chat.
  **Abschluss-Prüfung**: der erste `finish_task` beendet den Lauf nicht – die KI prüft ihr Ergebnis
  selbst. Behoben: Die Chat-Schleife brach bei jedem `finish_task` ab.
- **1.0.82:** **Chatliste nach Erstellung** (feste Reihenfolge, springt nicht mehr); **Denken und
  Dateizugriff pro Chat**; **SearXNG als Hintergrunddienst** (Docker oder eigener Startbefehl,
  `searx:start`/`searx:stop`/`searx:status`); **Gesamtverbrauch** in der Seitenleiste
  (`renderer/js/usage.js`, `usage.json`, bleibt auch nach Chat-Löschung erhalten); rund **290 neue
  englische und französische Texte** (`i18n-lex-v82*.js`) und `TLines()` für mehrzeilige
  KI-Anweisungen in der App-Sprache; **Linux-Fassung** (`start.sh`, `build-linux.sh`,
  `llm-box.desktop`, `docs/LINUX.md`, Ziele AppImage/deb/tar.gz).
- **Android-Bau 1.0.82:** die 14 neuen api-Kanäle (live.\*, power.keepAwake, searx.\*, showItem)
  sind Desktop-only und auf Android defensiv gekapselt (`liveCanHost()`); der Prüflauf
  `tools-android\check-api.js` kennt eine desktopOnly-Liste. Die Live-**Empfänger**-Funktion
  (Adresse einfügen, QR-Code scannen) funktioniert auf Android über `api.stream`; die
  Live-**Quelle** (eigene Chats anbieten) bleibt dem Windows-Programm vorbehalten.
- **1.0.83:** **Modellprofil IQ3/Q3 nach der Qwen-Empfehlung** (Temperatur 1,0, Top-P 0,95, Top-K 20,
  Min-P 0, Max. Antwortlänge 32768, Denkaufwand „Niedrig"), gegen Denkschleifen und abgeschnittene
  Antworten; einmalige Umstellung bestehender Installationen. **System-Prompt** gestrafft (keine
  erzwungene Denksprache, „kurz planen, dann handeln", „nichts erfinden, erst lesen").
  **Strata-Entwurfsverfahren** (`--drafting auto|dflash2|mtp|off`) und Entwurfs-Fenster (spec) mit
  einem Knopf für empfohlene Engine-Werte. Neue Datei `renderer/js/i18n-lex-v83.js`.
- **Android-Bau 1.0.83:** zwei weiteren Desktop-only-Kanälen gekapselt: `discover.scan` (Entdecker
  zeigt auf Android einen Hinweis statt einer kryptischen Fehlermeldung) und `files.savePdf`
  (PDF-Export,chatmenu.js prüft den Kanal selbst). `tools-android\check-api.js` kennt beide.

---

## Geprüft

Die Prüfsuite läuft ohne Gerät und umfasst **11 Prüfläufe, 0 Fehler**
(Bridge-Vollständigkeit, portierte Kernschicht inklusive der neuen Schreib-Queue, Start der Oberfläche in
einer WebView-Attrappe, kompletter Chat inklusive KI-Werkzeugen, PDF-Auslese, Chat-Abgleich,
Übertragungsformat, Abgleich-Timer, QR-Scan, Übernahme-Korrekturen und die Übersetzungsprüfung
`tools-android\test-i18n.js`). Der Bridge-Prüflauf meldet seit 1.0.82 die 14 neuen api-Kanäle
(`live.*`, `power.keepAwake`, `searx.*`, `showItem`) als **bewusst Desktop-only** – auf Android sind
sie defensiv gekapselt, die Live-**Empfänger**-Funktion läuft dort über `api.stream`.

**Android-Fassung 1.0.83-android (versionCode 83):** gebaut aus einer bereinigten Kopie, APK 11.421.459 B.
Alle 16 Android-Anpassungen griffen weiterhin (`tools-android\patch-check.js`: 0 Suchtexte würden
abbrechen). Alle 11 Prüfläufe mit 0 Fehlern; `tools-android\check-api.js` meldet keine fehlenden
Kanäle mehr – die drei neuen Desktop-only-Kanäle von 1.0.83 (`discover`, `discover.scan`,
`files.savePdf`) sind gekapselt. **Am Gerät wurde diese Fassung nicht geprüft.** Der Server-Entdecker
und der PDF-Export sind auf Android ausdrücklich als Desktop-only gekapselt.

**Windows-Fassung 1.0.83:** gebaut mit `npm run dist` (electron-builder, NSIS-Setup und portable EXE)
aus derselben bereinigten Quelle wie die APK – Setup 84.079.864 B, portable 83.837.618 B. Beide
Programmdateien und die APK wurden vor dem Einstellen am GitHub-Release mit
`tools-android\scan-persoenlich.js` geprüft: im Setup und im portablen Programm je 4 Fundstellen,
ausschließlich Zufallsbytefolgen im komprimierten Code. Das entpackte `app.asar` (442 Dateien)
liefert 5 Fundstellen: eine Urheberangabe der mitgelieferten Bibliothek `fast-xml-parser` und vier
Wortmeldungen („Administrator-Abfrage", „ohne Administratorrechte"). Keine internen IP-Adressen,
Laufwerksbuchstaben, Freigabenamen, Rechner- oder Gerätenamen. Die Quelldateien im Repository nutzen
durchgehend Beispielwerte aus dem Testnetz nach RFC 5737 (`192.0.2.x`) und den Beispielordner
`D:\MeinProjekt`. **Installiert und gestartet wurden die Windows-Programme nicht.**

**Linux-Fassung:** nur kurz unter einem virtuellen Display gestartet (Oberfläche lädt, keine
Renderer-Fehler). Der Bau der Pakete (AppImage, deb, tar.gz) und der Betrieb auf echten Desktops
sind nicht geprüft.

## Bekannte Grenzen

- Dokumente werden gelesen, aber nicht geschrieben: Die KI kann keine .docx/.xlsx/.pdf erzeugen oder
  ändern (sie kann aber .csv, .md, .html schreiben oder über Skripte arbeiten). Gescannte PDFs ohne
  Text (OCR) und alte Formate (.doc, .xls, .ppt) werden nicht gelesen.
- Die Werkzeug-Funktionen brauchen ein Modell mit Tool Calling.
- Bildausgabe funktioniert über OpenAI-kompatible Chat-Schnittstellen; reine Bild-Endpunkte und
  Ollama-Bildmodelle werden noch nicht unterstützt.
- Die Token-Schätzung vor dem Senden ist grob.

## Sicherheitshinweise

- QR-Codes und JSON-Dateien enthalten API-Schlüssel im Klartext, wenn Verbindungen mit übertragen
  werden. Hinweis steht in der App und im Handbuch; übertrage solche Dateien nur auf eigene Geräte.
- Freigabe-Zugangsdaten gehören **nicht** in ein Repository. Sie liegen im App-Ordner unter
  `%APPDATA%\LLM Box`.
- API-Schlüssel werden unverschlüsselt im App-Ordner gespeichert, zusammen mit Chats und Einstellungen.
