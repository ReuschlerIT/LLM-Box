# LLM Box unter Linux

Die Oberfläche ist dieselbe wie unter Windows. Unter Linux nutzt das Fenster die normale Titelleiste des Desktops (GNOME, KDE, Xfce …) und startet unter Wayland nativ.

## Aus dem Quelltext starten
```
./start.sh
```
Voraussetzung: Node.js (LTS). Beim ersten Start installiert das Skript die Abhängigkeiten.

## Pakete bauen
```
./build-linux.sh          # optional: ./build-linux.sh 1.0.83
```
Ergebnis in `dist/`: AppImage, .deb und .tar.gz. Für das .deb-Paket steht in `package.json` unter `build.linux.maintainer` eine Platzhalter-Adresse, bitte durch eine echte ersetzen.

## Bekannte Stolpersteine
- **Ubuntu 24.04 und neuer:** Das System sperrt unprivilegierte User-Namespaces. Ein AppImage startet dann nur mit `--no-sandbox`. `start.sh` setzt das automatisch. Das .deb-Paket hat dieses Problem nicht.
- **Befehle der KI:** `run_command` läuft über `/bin/sh`. PowerShell gibt es nur unter Windows.
- **Datenordner:** `~/.config/LLM Box`.
- **Startmenü-Eintrag aus dem Quelltext:** `llm-box.desktop` anpassen (Pfade) und nach `~/.local/share/applications/` kopieren.
