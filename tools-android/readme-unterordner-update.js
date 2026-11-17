/* readme-unterordner-update.js – ergaenzt die kurze Verweis-README des Windows-Ordners um den
   Hinweis auf die Versionschronik (UPDATE.md). Idempotent, nur EXAKTE Zeichenketten.
   Aufruf: node tools-android\readme-unterordner-update.js <kopie-ordner> [--dry]             */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) { console.log('usage: <kopie-ordner> [--dry]'); process.exit(1); }

const datei = path.join(ziel, 'llm-box', 'README.md');
if (!fs.existsSync(datei)) { console.log('NICHT GEFUNDEN: ' + datei); process.exit(1); }

let text = fs.readFileSync(datei, 'utf8').replace(/\r\n/g, '\n');

const ALT = '[`docs/HANDBUCH.md`](docs/HANDBUCH.md).';
const NEU = ['[`docs/HANDBUCH.md`](docs/HANDBUCH.md), die Änderungen jeder einzelnen Version seit 1.0.36',
  'in [`UPDATE.md`](UPDATE.md).'].join('\n');

if (text.includes(NEU)) { console.log('Bereits ergaenzt – nichts zu tun.'); process.exit(0); }
if (!text.includes(ALT)) { console.log('MUSTER NICHT GEFUNDEN – bitte pruefen.'); process.exit(2); }

text = text.split(ALT).join(NEU);
console.log((dry ? 'Trockenlauf – nichts geschrieben.\n' : '') + 'Ergaenzt: ' + datei);
if (!dry) fs.writeFileSync(datei, text.replace(/\n/g, '\r\n'), 'utf8');
