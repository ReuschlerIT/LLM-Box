/* readme-kopf-android.js – ergaenzt in der OEFFENTLICHEN Kopie den README-Kopf um die Android-App
   und einen kurzen Download-Hinweis.

   Warum: Der Kopf nennt nur "Desktop-App fuer Windows". In diesem Repository liegen aber beide
   Programme (download\LLM-Box-1.0.65-android.apk, Setup und portable EXE) und der README-Abschnitt
   "Android-App" beschreibt die Handy-Version bereits ausfuehrlich – oben fehlt sie nur.
   GitHub zeigt den README auf der Startseite, deshalb steht die Android-App jetzt dort.

   Nur EXAKTE Zeichenketten (keine Regex), idempotent. --dry schreibt nichts.
   Aufruf: node tools-android\readme-kopf-android.js <zielordner> [--dry]                    */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) { console.log('usage: <zielordner> [--dry]'); process.exit(1); }

const datei = path.join(ziel, 'README.md');
if (!fs.existsSync(datei)) { console.log('NICHT GEFUNDEN: ' + datei); process.exit(1); }

let text = fs.readFileSync(datei, 'utf8');
let anzahl = 0;

const PAARE = [
  // 1) Kopfzeile: beide Plattformen nennen.
  ['**Schlanke Desktop-App für Windows, mit der du lokale und entfernte KI-Modelle bequem nutzt:',
   '**Schlanke App für Windows und Android, mit der du lokale und entfernte KI-Modelle bequem nutzt:'],

  // 2) Die Zeile darunter (Technik-Kurzinfo) um die Plattformen ergaenzen.
  ['Von [Reuschler-IT](https://github.com/ReuschlerIT) · Electron · Deutsch · MIT-Lizenz',
   'Von [Reuschler-IT](https://github.com/ReuschlerIT) · Windows und Android · Electron · Deutsch · MIT-Lizenz'],

  // 3) Neuer Download-Abschnitt direkt vor "Was ist die LLM Box?" – damit die Programme von der
  //    Startseite aus zu finden sind (liegen im Repository-Ordner download/).
  ['## Was ist die LLM Box?',
`## Herunterladen

Die fertigen Programme liegen im Ordner \`download/\`:

| Datei | Für |
|---|---|
| \`LLM.Box.Setup.1.0.65.exe\` | Windows 10/11 (Installer) |
| \`LLM.Box.1.0.65.portable.exe\` | Windows 10/11 (portable, ohne Installation) |
| \`LLM-Box-1.0.65-android.apk\` | Android 8.0 oder neuer |

Beide Versionen haben dieselbe Oberfläche und dasselbe Chat-Format, der Austausch zwischen PC und
Handy funktioniert in beide Richtungen (QR-Code, WLAN oder JSON-Datei – siehe unten).

## Was ist die LLM Box?`],
];

for (const [alt, neu] of PAARE) {
  if (!text.includes(alt)) continue;
  text = text.split(alt).join(neu);
  anzahl++;
}

if (!anzahl) { console.log('Keine Anpassung noetig – alles bereits vorhanden.'); process.exit(0); }
console.log((dry ? 'Trockenlauf – nichts geschrieben.\n' : '') + 'Abschnitte angepasst: ' + anzahl);
if (!dry) fs.writeFileSync(datei, text, 'utf8');
