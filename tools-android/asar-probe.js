/* asar-probe.js – findet den JSON-Kopf einer .asar und meldet die Verschiebungen,
   damit asar-read.js die richtigen Offsets benutzt (Pickle-alignment variiert). */
'use strict';
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2]);
console.log('Datei', process.argv[2], 'Groesse', buf.length);
for (let i = 0; i < 8; i++) console.log(`  readUInt32LE(${i * 4}) = ${buf.readUInt32LE(i * 4)}`);
const idx = buf.indexOf('{"files"');
console.log('JSON-Kopf beginnt bei Offset', idx);
for (let o = Math.max(0, idx - 8); o < idx; o += 4) console.log(`  readUInt32LE(${o}) = ${buf.readUInt32LE(o)}`);
// Ende des Datenblocks: groesster offset+size
const head = JSON.parse(buf.toString('utf8', idx, idx + buf.indexOf('\u0000', idx)));
