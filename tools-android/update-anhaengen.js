/* update-anhaengen.js – fuegt die neue Update-Chronik (1.0.37 bis 1.0.65) an die bestehende
   UPDATE.md der OEFFENTLICHEN Kopie an.

   Warum: Die UPDATE.md endete bei Version 1.0.36. Der Auftrag war, jede Version bis zur aktuellen
   (1.0.65) auszuweisen, damit man zu jeder Version die Aenderungen erkennt.
   Grundgeruest der neuen Abschnitte ist die projektinterne Chronik (GEAENDERTE-DATEIEN.txt fuer
   V37-V52, Aenderungen.md ab 1.0.54) – alles mit Zeilenbelegen, nichts erfunden.

   Sicherheit: Die neue Chronik enthaelt keine personenbezogenen Pfade, IPs oder Schluessel;
   Beispiele sind neutral (D:\MeinProjekt, 192.0.2.x). Vor dem Schreiben wird das geprueft.

   Idempotent – ein bereits vorhandener Marker fuert zu keiner zweiten Anfuegung.
   Aufruf: node tools-android\update-anhaengen.js <kopie-ordner> [--dry]                     */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) { console.log('usage: node tools-android\\update-anhaengen.js <kopie-ordner> [--dry]'); process.exit(1); }

const updatePfad = path.join(ziel, 'llm-box', 'UPDATE.md');
const neuPfad = path.resolve(__dirname, '..', 'tmp-update-neu.md');
if (!fs.existsSync(updatePfad)) { console.log('NICHT GEFUNDEN: ' + updatePfad); process.exit(1); }
if (!fs.existsSync(neuPfad)) { console.log('NICHT GEFUNDEN (Quelltext der neuen Abschnitte): ' + neuPfad); process.exit(1); }

const alt = fs.readFileSync(updatePfad, 'utf8');
const neu = fs.readFileSync(neuPfad, 'utf8').replace(/^\r?\n/, '');
const MARKER = '# Update-Chronik ab Version 1.0.37';

if (alt.includes(MARKER)) { console.log('Bereits angefuegt – nichts zu tun.'); process.exit(0); }

/* Was unten dranstehen muss, damit die alte Fassung erhalten bleibt: die neue Chronik kommt hinter
   den bestehenden Inhalt (der bei 1.0.36 steht), nicht davor. */
const text = alt.replace(/\s+$/, '') + '\n' + neu;

/* Nachweis, dass nichts Persoenliches hineingekommen ist. */
const VERBOTEN = ['MeinProjekt', 'Y:\\', 'Y:/', '192.0.2.', '\\daten', 'C:\\Users\\Administrator', 'beispiel-passwort'];
const funde = VERBOTEN.filter((w) => text.includes(w));

console.log('bestehende UPDATE.md:  ' + alt.split(/\r?\n/).length + ' Zeilen');
console.log('neue Abschnitte:       ' + neu.split(/\r?\n/).length + ' Zeilen');
console.log('gemeinsam:             ' + text.split(/\r?\n/).length + ' Zeilen, ' + Buffer.byteLength(text) + ' B');
console.log('persoenliche Muster:   ' + (funde.length ? 'TREFFER: ' + funde.join(', ') : 'keine'));
if (funde.length) { console.log('Abbruch – zuerst bereinigen.'); process.exit(2); }

if (!dry) fs.writeFileSync(updatePfad, text, 'utf8');
console.log((dry ? '\nTrockenlauf – nichts geschrieben.\n' : '\nGeschrieben: ' + updatePfad));
