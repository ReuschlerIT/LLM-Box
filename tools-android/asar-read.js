/* asar-read.js – liest Dateien aus einer Electron-.asar ohne Fremdwerkzeug.
   Noetig, um die WIRKLICH installierte Windows-Fassung zu pruefen statt nur die Quelle im Projekt.

   asar-Format:  UInt32LE (Groesse des Pickle-Headers) | Pickle: UInt32LE payloadSize,
   UInt32LE stringLength | JSON-Kopf (offset/size je Datei, als Strings) | Datenblock.

   Aufruf: node tools-android\asar-read.js <datei.asar> [--list | --out <Zielordner> [nur-Pfad]]      */
'use strict';
const fs = require('fs');
const path = require('path');

const arg = process.argv.slice(2);
const asarFile = arg[0];
if (!asarFile || !fs.existsSync(asarFile)) { console.log('usage: node tools-android\\asar-read.js <app.asar> [--list | --out <ordner> [filter]]'); process.exit(1); }

/* asar-Format (asar/lib/disk.js):
     [0..4)   UInt32LE = 4                      (Pickle mit einer Zahl)
     [4..8)   UInt32LE = Laenge des Header-Pickles
     [8..12)  UInt32LE = Nutzdatenlaenge des Header-Pickles
     [12..16) UInt32LE = Laenge der JSON-Kopfs
     [16..)   JSON-Kopf (auf 4 Bytes aufgefuellt)
     danach   Datenblock                                                */
const buf = fs.readFileSync(asarFile);
const headerPickleLen = buf.readUInt32LE(4);   // Groesse des Header-Pickles ab Offset 8
const strLen = buf.readUInt32LE(12);           // Laenge des JSON-Kopfs
const header = JSON.parse(buf.toString('utf8', 16, 16 + strLen));
const baseSize = 8 + headerPickleLen;          // Beginn des Datenblocks

function walk(node, prefix, out) {
  if (node.files) for (const [name, child] of Object.entries(node.files)) walk(child, prefix + '/' + name, out);
  else if (node.offset !== undefined) out[prefix] = node;
  return out;
}
const entries = walk(header, '', {});

if (!arg.includes('--out')) {
  const keys = Object.keys(entries).sort();
  console.log(`${asarFile}: ${keys.length} Dateien, Datenblock ab ${baseSize}`);
  for (const k of keys) console.log(`  ${k}  offset=${entries[k].offset} size=${entries[k].size}${entries[k].unpacked ? ' UNPACKED' : ''}`);
  return;
}

const outIdx = arg.indexOf('--out');
const ziel = arg[outIdx + 1];
const filter = arg[outIdx + 2];
fs.mkdirSync(ziel, { recursive: true });
let n = 0;
for (const [k, e] of Object.entries(entries)) {
  if (filter && !k.includes(filter)) continue;
  const dest = path.join(ziel, k.replace(/^\//, '').replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (e.unpacked) {                       // liegt bereits ungepackt neben der asar
    fs.copyFileSync(path.join(path.dirname(asarFile), 'app.asar.unpacked', k.replace(/^\//, '')), dest);
  } else {
    const off = baseSize + Number(e.offset);
    fs.writeFileSync(dest, buf.slice(off, off + Number(e.size)));
  }
  n++;
}
console.log(`${n} Dateien nach ${ziel} entpackt (aus ${asarFile}).`);
