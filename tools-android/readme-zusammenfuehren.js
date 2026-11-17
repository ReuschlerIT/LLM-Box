/* readme-zusammenfuehren.js – fuehrt die veroeffentlichte Haupt-README mit der aeiteren Fassung
   zusammen und repariert Verweise. Arbeitet nur im angegebenen Zielordner (die Kopie), nie im
   Workspace. Idempotent: jede Regel prueft, ob sie schon angewendet ist. --dry schreibt nichts.

   Warum diese einzelnen Regeln (alle begruendet durch den Vergleich der beiden Fassungen):
   1) BILDPFADE: Die Haupt-README liegt eine Ebene ueber llm-box\, verweist aber auf
      "docs/screenshots/…". Diese Ordner existieren nur in llm-box\docs\ – auf GitHub waeren alle
      acht Bilder und der Handbuch-Link ins Leere gelaufen. (gemessen: kein docs\ in der Kopie-Wurzel)
   2) INHALT DER UEBERTRAGUNG: Die aeltere Fassung nannte ausdruecklich, WAS uebertragen wird
      (Verbindungen inklusive API-Schluessel, auf Wunsch Chats). Die aktuelle beschreibt nur den Weg
      (QR/WLAN/JSON). Genau das ist aber sicherheitsrelevant – es gehoert wieder hinein.
   3) JSON als Ersatzweg: die aeltere Fassung nannte JSON den "Fallback"; die aktuelle stellt beide
      Wege gleich. Der Hinweis, dass QR ohne Netz funktioniert, fehlt sonst.
   4) PROJEKTSTRUKTUR: beschreibt nur den Windows-Ordner. Nach der Android-Veroeffentlichung gehoeren
      android\, tools-android\ und download\ dazu, sonst wirkt die Struktur unvollstaendig.
   5) CHANGELOG: Die UPDATE.md fuehrt jetzt jede Version ab 1.0.36 – die README verlinkt sie, damit
      man die Aenderungen pro Version findet (Auftrag des Nutzers).

   Aufruf: node tools-android\readme-zusammenfuehren.js <kopie-ordner> [--dry]                */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) { console.log('usage: node tools-android\\readme-zusammenfuehren.js <kopie-ordner> [--dry]'); process.exit(1); }

const datei = path.join(ziel, 'README.md');
if (!fs.existsSync(datei)) { console.log('NICHT GEFUNDEN: ' + datei); process.exit(1); }
let text = fs.readFileSync(datei, 'utf8');

/* Zeilenenden vereinheitlichen: die Datei nutzt CRLF, alle Muster unten sind mit \n geschrieben.
   Ohne diese Umstellung haetten mehrzeilige Muster nicht gepasst (einzige Erfahrung beim ersten Lauf).
   Beim Schreiben wird die urspruengliche Form zurueckgesetzt. */
const CRLF = /\r\n/.test(text);
text = text.replace(/\r\n/g, '\n');

/* Regel 1: alle docs-Verweise der Haupt-README auf den Unterordner lenken. */
const BILD_RULEN = [
  ['src="docs/screenshots/', 'src="llm-box/docs/screenshots/'],
  ['[Handbuch](docs/HANDBUCH.md)', '[Handbuch](llm-box/docs/HANDBUCH.md)'],
  ['`docs/TRANSFER-FORMAT.md`', '`llm-box/docs/TRANSFER-FORMAT.md`'],
];

/* Regel 2 + 3: was uebertragen wird, und JSON als Ersatzweg. */
const TRANSFER_ALT = '- **Ein QR-Code statt sechs:** Die Windows-App bietet ihre Daten im WLAN an, das Handy holt sie ab – über „Im WLAN suchen" (das Handy findet den Rechner von selbst) oder durch Scannen des einen Codes. Format: `docs/TRANSFER-FORMAT.md`.';
const TRANSFER_NEU = '- **Ein QR-Code statt sechs:** Die Windows-App bietet ihre Daten im WLAN an, das Handy holt sie ab – über „Im WLAN suchen" (das Handy findet den Rechner von selbst) oder durch Scannen des einen Codes. Format: `llm-box/docs/TRANSFER-FORMAT.md`.\n' +
  '- **Was übertragen wird:** alle Einstellungen und Verbindungen **inklusive API-Schlüssel**, dazu Modell, Parameter, Darstellung und – wenn ausgewählt – Chats und Textdateien des Workspace. Gerätebezogenes (Fensterposition, Rechner-Kennung) bleibt dagegen auf jedem Gerät.\n' +
  '- **Ohne Netz funktioniert dasselbe als Datei:** QR-Code oder WLAN sind der bequeme Weg; notfalls geht derselbe Inhalt als JSON-Datei, die man auf das andere Gerät kopiert.';

/* Regel 4: Projektstruktur – der komplette Block wird ersetzt, damit die Einrueckung in einer
   Ebene konsistent bleibt (ein stueckweises Aendern haette eine halb eingerueckte Liste ergeben). */
const STRUKTUR_ALT = '```\nmain.js            Hauptprozess: Netzwerk, Dateien, Programme, Fenster\npreload.js         Sichere Brücke zwischen Hauptprozess und Oberfläche\nrenderer/          Oberfläche (HTML, CSS, JavaScript ohne Framework)\n  js/app.js        Chat, Senden, Agenten-Schleife\n  js/livetools.js  Live-Karten und Mitscrollen\n  js/subagents.js  Unteragenten\n  js/server.js     Server und Monitor\n  js/llm.js        Anbindung an Ollama und OpenAI-kompatible APIs\n  js/transfer.js   Übertragung auf Android: QR-Bildfolge und JSON-Export\n  vendor/qrcode.js QR-Code-Erzeugung (qrcode-generator 1.4.4, MIT)\ndocs/HANDBUCH.md   Ausführliche Dokumentation\ndocs/TRANSFER-FORMAT.md  Format der Übertragung (für die Android-Seite)\n```';
const STRUKTUR_NEU = '```\nREADME.md                diese Beschreibung\nllm-box/                 Windows-App (Electron)\n  main.js                  Hauptprozess: Netzwerk, Dateien, Programme, Fenster\n  preload.js               Sichere Brücke zwischen Hauptprozess und Oberfläche\n  renderer/                Oberfläche (HTML, CSS, JavaScript ohne Framework)\n    js/app.js              Chat, Senden, Agenten-Schleife\n    js/livetools.js        Live-Karten und Mitscrollen\n    js/subagents.js        Unteragenten\n    js/server.js           Server und Monitor\n    js/llm.js              Anbindung an Ollama und OpenAI-kompatible APIs\n    js/transfer.js         Übertragung zwischen PC und Handy\n    vendor/qrcode.js       QR-Code-Erzeugung (qrcode-generator 1.4.4, MIT)\n  docs/HANDBUCH.md         Ausführliche Dokumentation\n  docs/TRANSFER-FORMAT.md  Format der Übertragung (für die Android-Seite)\n  UPDATE.md                Änderungen pro Version (ab 1.0.36)\nandroid/                 Android-App (Java, WebView) – gebaut mit build-android.ps1\ntools-android/           Portierungshelfer und Prüfläufe\nwebdeps/                 Web-Bausteine für die Android-Oberfläche\ndownload/                fertige Programmdateien (Setup, portable EXE, APK)\n```';

/* Regel 5: Link auf die Versionschronik im Abschnitt "Neu seit Version 1.0.50". */
const CHANGELOG_ALT = 'Die wichtigsten Änderungen seit 1.0.50 – gruppiert, damit du siehst, was sich für dich ändert:';
const CHANGELOG_NEU = 'Die wichtigsten Änderungen seit 1.0.50 – gruppiert, damit du siehst, was sich für dich ändert.\n' +
  'Der vollständige Verlauf **einzelner Versionen ab 1.0.36** steht in [`llm-box/UPDATE.md`](llm-box/UPDATE.md):';

let geaendert = 0;
function ersetze(name, alt, neu) {
  if (text.includes(neu)) { console.log('  übersprungen (bereits drin): ' + name); return; }
  if (!text.includes(alt)) { console.log('  FEHLER – Muster nicht gefunden: ' + name); process.exitCode = 2; return; }
  text = text.split(alt).join(neu);
  geaendert++;
  console.log('  angewendet: ' + name);
}

console.log('Regeln:');
/* Reihenfolge: erst die Ubertragungsregel (sie enthaelt den neuen docs-Pfad schon richtig),
   danach die allgemeinen Pfadregeln fuer die uebrigen Verweise. */
ersetze('Übertragung: Inhalt und Ersatzweg', TRANSFER_ALT, TRANSFER_NEU);
for (const [alt, neu] of BILD_RULEN) ersetze('Pfad ' + alt, alt, neu);
ersetze('Projektstruktur (kompletter Block)', STRUKTUR_ALT, STRUKTUR_NEU);
ersetze('Verweis auf die Versionschronik', CHANGELOG_ALT, CHANGELOG_NEU);

/* Sicherheitsnetz: nichts Persoenliches soll hier stehen. */
const VERBOTEN = ['MeinProjekt', 'Y:\\', '192.0.2.', '\\daten', 'C:\\Users\\Administrator'];
const funde = VERBOTEN.filter((w) => text.includes(w));
if (funde.length) { console.log('ABBRUCH – persoenliches Muster gefunden: ' + funde.join(', ')); process.exit(2); }

if (CRLF) text = text.replace(/\n/g, '\r\n');
console.log('\nZeilen: ' + text.split(/\r?\n/).length + '   Regeln angewendet: ' + geaendert);
if (!dry) fs.writeFileSync(datei, text, 'utf8');
console.log(dry ? 'Trockenlauf – nichts geschrieben.' : 'Geschrieben: ' + datei);
