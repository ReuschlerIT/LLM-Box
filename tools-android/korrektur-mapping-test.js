/* korrektur-mapping-test.js – repariert den bei der Entschaerfung falsch gesetzten else-Zweig.
   Fehlerbild: 'SyntaxError: Missing catch or finally after try' in test-uebernahme-fixes.js,
   weil das Ende des if-Blocks und der Anfang des else doppelt geklammert wurden.
   Ersetzt eine EXAKTE Zeichenkette. Aufruf: node tools-android\korrektur-mapping-test.js <ziel> [--dry] */
'use strict';
const fs = require('fs');
const path = require('path');
const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
const datei = path.join(ziel, 'tools-android', 'test-uebernahme-fixes.js');

/* Zwei moegliche kaputte Formen abdecken (doppelte Klammer direkt hintereinander). */
const VARIANTEN = [
  { alt: "      }\n      } else if (resolveFn) {", neu: "      } else if (resolveFn) {" },
];

let text = fs.readFileSync(datei, 'utf8');
let getroffen = 0;
for (const v of VARIANTEN) {
  if (!text.includes(v.alt)) continue;
  const n = text.split(v.alt).length - 1;
  text = text.split(v.alt).join(v.neu);
  getroffen += n;
}
if (!getroffen) { console.log('Keine kaputte Klammer gefunden – nichts getan.'); process.exit(0); }
console.log((dry ? 'Trockenlauf – nichts geschrieben.\n' : '') + 'Korrektur: ' + getroffen + ' Stelle(n) in ' + path.basename(datei));
if (!dry) fs.writeFileSync(datei, text, 'utf8');
