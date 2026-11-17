/* png-text.js – sucht in PNG-Dateien nach eingebettetem Klartext (tEXt/iTXt/zTXt-Chunks) und nach
   lesbaren Textstuecken in unkomprimierten Bereichen. Grund: ein Screenshot kann persoenliche Daten
   ZEIGEN (IP, Rechnername, Pfad), aber ein normaler Datei-Scan findet sie nicht, weil PNG-Bilddaten
   komprimiert sind. Dieses Skript zeigt zumindest Metadaten und rohe Textfragmente.

   Aufruf: node tools-android\png-text.js <pfad.odr.ordner> [...]                            */
'use strict';
const fs = require('fs');
const path = require('path');

function chunks(datei) {
  const buf = fs.readFileSync(datei);
  if (buf.slice(0, 4).toString('latin1') !== '\x89PNG') return console.log(path.basename(datei) + ': kein PNG');
  let pos = 8;
  const texte = [];
  while (pos + 8 <= buf.length) {
    const laenge = buf.readUInt32BE(pos);
    const typ = buf.slice(pos + 4, pos + 8).toString('latin1');
    const daten = buf.slice(pos + 8, pos + 8 + laenge);
    if (typ === 'tEXt' || typ === 'iTXt' || typ === 'zTXt') {
      texte.push(typ + ': ' + daten.toString('latin1').replace(/[^\x20-\x7e]/g, ' ').slice(0, 200));
    }
    if (typ === 'pHYs' || typ === 'tIME') { /* unkritisch */ }
    pos += 12 + laenge;
    if (typ === 'IEND') break;
  }
  console.log(path.basename(datei) + '  (' + buf.length + ' B)' + (texte.length ? '' : '  – keine Text-Metadaten'));
  for (const t of texte) console.log('   ' + t);
}

function laufe(p) {
  const st = fs.statSync(p);
  if (st.isFile()) { if (/\.png$/i.test(p)) chunks(p); return; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const voll = path.join(p, e.name);
    if (e.isDirectory()) laufe(voll); else if (/\.png$/i.test(e.name)) chunks(voll);
  }
}
for (const z of process.argv.slice(2)) laufe(z);
