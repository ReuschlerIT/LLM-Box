/* readme-versionsangaben.js – verbessert zwei Versionsangaben im README-Abschnitt "Neu seit
   Version 1.0.50", weil sie nach dem Abgleich mit der Chronik nicht genau sind.

   Befund 1 ("Kein weisser Block mehr beim Start der Handy-App (ab 1.0.57)"):
     Der Build-Patch dafuer kam in Sitzung 11 (Aenderungen.md:1250-1259), die APK mit diesem Stand
     wurde auf dem G986B installiert (Zeile 1313). Zu diesem Zeitpunkt stand build.gradle aber fest
     auf versionCode 32 / "1.0.32-android" (Zeile 1503); die Nummer wurde erst spaeter auf 59 gehoben
     (Zeile 1506). Die Aussage "ab 1.0.57" ist deshalb falsch - korrekt ist: behoben vor der ersten
     Handy-Version mit richtiger Nummer (1.0.59-android).

   Befund 2 ("... ab 1.0.63/1.0.64"): vermischt Windows und Android. Getrennt richtig:
     PC = 1.0.63, Handy = 1.0.63/1.0.64-android.

   Idempotent, nur EXAKTE Zeichenketten. --dry schreibt nichts.
   Aufruf: node tools-android\readme-versionsangaben.js <kopie-ordner> [--dry]                */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) { console.log('usage: <kopie-ordner> [--dry]'); process.exit(1); }

const datei = path.join(ziel, 'README.md');
if (!fs.existsSync(datei)) { console.log('NICHT GEFUNDEN: ' + datei); process.exit(1); }
let text = fs.readFileSync(datei, 'utf8').replace(/\r\n/g, '\n');

const REGELN = [
  ['Kein weißer Block mehr beim Start der Handy-App (ab 1.0.57)',
   'Kein weißer Block mehr beim Start der Handy-App – behoben schon vor der ersten Handy-Version mit richtiger Nummer (die App trug lange eine veraltete Versionsnummer, erst ab 1.0.59-android stimmen Nummern und Inhalt überein)'],
  ['vorher ging auf diesem Weg kein Netzwerkordner mit (ab 1.0.63/1.0.64)',
   'vorher ging auf diesem Weg kein Netzwerkordner mit (am PC ab 1.0.63, auf dem Handy ab 1.0.63-/1.0.64-android)'],
];

let anzahl = 0;
for (const [alt, neu] of REGELN) {
  if (text.includes(neu)) { console.log('  bereits korrekt: ' + alt.slice(0, 50)); continue; }
  if (!text.includes(alt)) { console.log('  MUSTER NICHT GEFUNDEN: ' + alt.slice(0, 60)); process.exitCode = 2; continue; }
  text = text.split(alt).join(neu);
  anzahl++;
  console.log('  korrigiert: ' + alt.slice(0, 50) + ' …');
}

console.log((dry ? '\nTrockenlauf – nichts geschrieben.\n' : '\n') + 'Korrekturen: ' + anzahl);
if (!dry && anzahl) fs.writeFileSync(datei, text.replace(/\n/g, '\r\n'), 'utf8');
