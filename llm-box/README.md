# LLM Box – Windows-App (Electron)

Dieser Ordner enthält den Quelltext der **Desktop-Fassung**. Die vollständige
Projektbeschreibung, alle Funktionen und die Anleitung stehen eine Ebene höher in
[`../README.md`](../README.md), die ausführliche Dokumentation in
[`docs/HANDBUCH.md`](docs/HANDBUCH.md).

## Starten

```
npm install
npm start
```

## Eigene Programmdatei bauen

```
npm run dist
```

Das Ergebnis liegt anschließend in `dist/` (Installer und portable EXE). Die fertigen,
geprüften Programmdateien für diese Veröffentlichung liegen im Ordner [`../download/`](../download/).

## Android-Fassung

Die Android-App wird aus dem übergeordneten Ordner gebaut (`build-android.ps1`) und teilt sich
die Oberfläche mit dieser Desktop-Fassung. Das Format der Übertragung zwischen beiden
Programmen ist in [`docs/TRANSFER-FORMAT.md`](docs/TRANSFER-FORMAT.md) beschrieben.
