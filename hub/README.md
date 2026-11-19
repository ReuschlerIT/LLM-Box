# LLM Box Hub

Der Hub läuft **ohne Oberfläche** auf Linux oder Windows (Node.js 18 oder neuer, keine weiteren Pakete) und ist die gemeinsame Mitte für alle Geräte:

- Er **speichert die Chats**.
- Er **ruft die Modelle auf**: lokal (z. B. Strata auf demselben Rechner über `localhost`) oder Cloud (OpenAI-kompatibel, Claude). Die **API-Schlüssel liegen nur hier**.
- Er verteilt jede Änderung in **Echtzeit** an alle verbundenen Geräte (Windows-App, Android-App). Die Antwort **läuft auf dem Hub weiter**, auch wenn Handy oder PC ausgehen.

Die Apps verbinden sich über **Einstellungen → Live-Ansicht**. Der Hub spricht dasselbe Protokoll wie die Live-Quelle der Windows-App (`docs/LIVE-ANSICHT.md`) plus `/models`, `/delete`, `/rename`.

## Installieren

Den Ordner `hub/` samt `renderer/js/llm.js` auf den Rechner kopieren (die relative Lage `hub/` neben `renderer/` beibehalten, oder `llm.js` direkt neben `hub.js` legen).

```
node hub.js            # erster Start legt die Konfiguration an und zeigt die Adresse
```

Linux: `./start-hub.sh`, als Dienst `llm-box-hub.service` (siehe Kommentar darin). Windows: `start-hub.bat`; dauerhaft z. B. über die Aufgabenplanung („Beim Systemstart“) oder NSSM.

Daten und Konfiguration liegen in `~/.llm-box-hub` (Windows: `%USERPROFILE%\.llm-box-hub`), änderbar mit `--data <Ordner>` oder `LLMBOX_HUB_DATA`.

## Verbindungen einrichten

```
# lokaler Server, z. B. Strata auf diesem Rechner (Standard ist schon eingetragen: http://localhost:8080/v1)
node hub.js --add-connection Strata openai http://localhost:8080/v1 DEIN_STRATA_KEY

# Cloud
node hub.js --add-connection Claude anthropic https://api.anthropic.com/v1 sk-ant-...
node hub.js --add-connection OpenAI openai https://api.openai.com/v1 sk-...

# Standard-Verbindung und -Modell
node hub.js --set-default strata MODELLNAME

# Adresse (mit Schlüssel) für die Apps anzeigen
node hub.js --show
```

Die Datei `config.json` enthält außerdem den Zugriffsschlüssel (`token`), Port (Standard 45470), Systemprompt und Parameter. Nach Änderungen den Hub neu starten.

## In den Apps verbinden

**Einstellungen → Live-Ansicht → Adresse der Quelle:** die Adresse aus `--show` einfügen, „Verbinden“. In der Seitenleiste erscheint der Kasten **Hub** mit Modellauswahl und den Chats. **„+ Neuer Chat auf …“** beginnt einen Chat auf dem Hub. Auf Android geht das auch per QR-Code.

## Sicherheit

- Alle Anfragen brauchen den Schlüssel (`?t=…` oder `Authorization: Bearer …`). Nach 20 Fehlversuchen sperrt der Hub die Adresse 10 Minuten.
- Der Hub spricht **HTTP ohne Verschlüsselung**. Im eigenen WLAN/LAN ist das üblich. Soll er aus dem Internet erreichbar sein, dann nur hinter **WireGuard/Tailscale** oder einem **Reverse-Proxy mit TLS** (z. B. Caddy, nginx). Wer den Schlüssel hat, kann Chats lesen und über deine Cloud-Schlüssel Anfragen stellen (Kosten!).
- `config.json` ist nur für den Besitzer lesbar (Linux). Sie enthält API-Schlüssel im Klartext.

## Grenzen der ersten Fassung

- Reiner Chat mit Verlauf, Denkmodus, Bildern und Dateianhängen als Text (kommen später aus der App; der Hub nimmt bisher nur Text).
- **Keine Werkzeuge auf dem Hub**: Datei-Werkzeuge im Workspace, Programme, Websuche, Wissenssuche und Assistenten laufen weiter in der App auf dem Gerät, in lokalen Chats. Hub-Chats sind reine Chats.
- Keine automatische Kürzung langer Verläufe: Läuft der Kontext voll, meldet das Modell einen Fehler. Dann einen neuen Chat beginnen.
- Der Hub und die App teilen kein gemeinsames Chat-Verzeichnis: Hub-Chats liegen im Hub, lokale Chats in der App.

## Lizenz

MIT, siehe [`../LICENSE`](../LICENSE). Der Hub nutzt keine Fremdpakete, nur Node.js und `renderer/js/llm.js` aus diesem Projekt.
