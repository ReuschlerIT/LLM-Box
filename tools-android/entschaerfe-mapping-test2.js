/* entschaerfe-mapping-test2.js – zweite, abschliessende Anpassung von Abschnitt B in
   tools-android\test-uebernahme-fixes.js (oeffentliche Kopie).

   Stand nach dem ersten Schritt: der Vergleich mit Windows wird uebersprungen, wenn auf diesem
   Rechner kein Netzlaufwerk gemappt ist. Aber die erste Pruefung
       ok('Laufwerk Y wird auf einer UNC-Pfad abgebildet', ...)
   laeuft weiterhin unbedingt und schlaegt fehl, weil ohne Mapping nichts zurueckkommt.
   Deshalb: diese eine Erwartung an dieselbe Bedingung haengen wie der Rest von Abschnitt B.

   Nur EXAKTE Zeichenketten, keine Regex. Idempotent – zweite Ausfuehrung tut nichts.
   Aufruf: node tools-android\entschaerfe-mapping-test2.js <zielordner> [--dry]              */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) { console.log('usage: <zielordner> [--dry]'); process.exit(1); }

const datei = path.join(ziel, 'tools-android', 'test-uebernahme-fixes.js');
if (!fs.existsSync(datei)) { console.log('NICHT GEFUNDEN: ' + datei); process.exit(1); }

const ALT = "      ok('Laufwerk Y wird auf einer UNC-Pfad abgebildet',";
const NEU = "      if (erwartet) ok('Laufwerk Y wird auf einer UNC-Pfad abgebildet',";

let text = fs.readFileSync(datei, 'utf8');
if (!text.includes(ALT)) {
  console.log(text.includes(NEU) ? 'Bereits angepasst – nichts zu tun.' : 'MUSTER NICHT GEFUNDEN – bitte pruefen.');
  process.exit(text.includes(NEU) ? 0 : 2);
}
text = text.split(ALT).join(NEU);
console.log((dry ? 'Trockenlauf – nichts geschrieben.\n' : '') + 'Angepasst: ' + path.basename(datei));
if (!dry) fs.writeFileSync(datei, text, 'utf8');
