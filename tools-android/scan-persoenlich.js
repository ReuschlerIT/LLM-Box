/* scan-persoenlich.js – findet persoenliche Daten in Dateien, auch in BINAERDATEIEN.

   Anlass: Die fertigen Programme (APK und Windows-Setup) sollen auf GitHub veroeffentlicht
   werden. Eine APK ist eine ZIP-Datei mit kompiliertem Code; personengebundene Werte koennen
   also mitten in classes.dex stecken, ohne dass eine Textsuche in den Quelltext-Dateien sie
   zeigt. Genau das war zu erwarten: die Geraete-Sonden der App enthalten als Standardwerte die
   LAN-Adressen des Nutzers (192.168.1.30 fuer die Freigabe, 192.168.10.50 fuer den PC).

   Vorgehen: Dateien werden als Bytes gelesen und mit Buffer.indexOf durchsucht. Damit findet
   der Scan auch Strings in dex-, so- und asar-Inhalten. Gefunden wird NUR gemeldet (nichts wird
   geaendert), damit zuerst entschieden werden kann, was bereinigt werden muss.

   Aufruf: node tools-android\scan-persoenlich.js <pfad> [<pfad2> …] [--max <bytes>]            */
'use strict';
const fs = require('fs');
const path = require('path');

/* Was als persoenlich gilt. Bewusst konkret und erklaerbar – keine vagen Begriffe wie "Passwort",
   sonst meldet der Scan jeden Hinweis-Text der Oberflaeche ("Bitte Passwort eingeben"). */
const MUSTER = [
  ['LAN-IP 192.168.x', '192.168.'],
  ['Workspace-Laufwerk', 'Z:\\'],
  ['Projektordner des Nutzers', 'MeinProjekt'],
  ['Windows-Benutzerprofil', 'C:\\Users\\'],
  ['Benutzername Administrator', 'Administrator'],
  ['eigener Rechnername', 'EIGENER-RECHNERNAME'],
  ['Freigabe-Server (IP)', '192.168.1.30'],
  ['Arbeits-PC (IP)', '192.168.10.50'],
  ['Handy-IP', '192.168.10.117'],
  ['E-Mail-Adresse', '@gmx.'],
  ['E-Mail-Adresse', '@web.de'],
  ['E-Mail-Adresse', '@gmail.com'],
  ['E-Mail-Adresse', '@outlook.com'],
  ['E-Mail-Adresse', '@t-online.de'],
  ['Laufwerks-Freigabe homes', '\\homes'],
  ['Android-Geraetename', 'EIGENE-GERAETESERIENNUMMER'],
];

const arg = process.argv.slice(2);
const maxIdx = arg.indexOf('--max');
const MAX = maxIdx >= 0 ? Number(arg[maxIdx + 1]) : 40 * 1024 * 1024;
if (maxIdx >= 0) { arg.splice(maxIdx, 2); }

/* --dateien <listendatei>: nur die aufgezaehlten Dateien pruefen. Noetig fuer den letzten Nachweis
   vor dem Push – gescannt wird dann genau das, was ins Repository kommt (Ausgabe von
   "git diff --cached --name-only"), nicht der ganze Ordner mit Build-Resten und node_modules. */
const listIdx = arg.indexOf('--dateien');
let ziele = arg.length ? arg : ['.'];
if (listIdx >= 0) {
  const listendatei = arg[listIdx + 1];
  if (!listendatei || !fs.existsSync(listendatei)) { console.log('Liste nicht gefunden: ' + listendatei); process.exit(1); }
  /* Erste Position ist der Basisordner, die Dateinamen in der Liste sind relativ dazu
     (genau so liefert "git diff --cached --name-only" sie). */
  const basis = arg[0] && fs.existsSync(arg[0]) ? arg[0] : '.';
  const namen = fs.readFileSync(listendatei, 'utf8').split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  ziele = namen.map((n) => path.join(basis, n));
  console.log('Dateilisten-Modus: ' + namen.length + ' Dateien aus ' + listendatei + ' (Basis ' + basis + ')');
}

let trefferGesamt = 0, dateien = 0, uebersprungen = 0;
const funde = [];

function durchsuche(datei) {
  let st;
  try { st = fs.statSync(datei); } catch { return; }
  if (!st.isFile()) return;
  if (st.size > MAX) { uebersprungen++; console.log('UEBERSPRUNGEN (zu gross ' + st.size + ' B): ' + datei); return; }
  let buf;
  try { buf = fs.readFileSync(datei); } catch { return; }
  dateien++;
  const relativ = path.basename(datei);
  for (const [name, muster] of MUSTER) {
    const needle = Buffer.from(muster, 'utf8');
    let pos = -1, anzahl = 0;
    while ((pos = buf.indexOf(needle, pos + 1)) !== -1) {
      anzahl++;
      if (anzahl <= 3) {
        // Kontext lesbar machen: druckbare Zeichen um die Fundstelle herum.
        const von = Math.max(0, pos - 45), bis = Math.min(buf.length, pos + needle.length + 45);
        const kontext = buf.slice(von, bis).toString('latin1').replace(/[^\x20-\x7e]/g, '·');
        funde.push({ datei, name, anzahl: 0, kontext });
      }
    }
    if (anzahl) { trefferGesamt += anzahl; console.log('TREFFER  ' + relativ.padEnd(26) + ' ' + name.padEnd(24) + anzahl + 'x'); }
  }
}

function laufe(pfad) {
  let st;
  try { st = fs.statSync(pfad); } catch (e) { console.log('nicht lesbar: ' + pfad + ' (' + e.code + ')'); return; }
  if (st.isFile()) return durchsuche(pfad);
  for (const eintrag of fs.readdirSync(pfad, { withFileTypes: true })) {
    const voll = path.join(pfad, eintrag.name);
    if (eintrag.isDirectory()) laufe(voll);
    else durchsuche(voll);
  }
}

for (const z of ziele) laufe(z);

console.log('\nGepruefte Dateien: ' + dateien + '   uebersprungen: ' + uebersprungen + '   Treffer gesamt: ' + trefferGesamt);
if (funde.length) {
  console.log('\nKontext der ersten Funde:');
  for (const f of funde.slice(0, 40)) console.log('  [' + path.basename(f.datei) + ' · ' + f.name + '] …' + f.kontext + '…');
}
process.exitCode = trefferGesamt ? 2 : 0;
