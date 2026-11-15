/* diff-settings.js – vergleicht die Einstellungen der Windows-App mit denen des Handys.
   Ziel: objektiv zeigen, WELCHE Felder bei einer WLAN-Uebernahme falsch oder zu kurz
   gekommen sind (Nutzermeldung: "nicht die richtigen Einstellungen uebertragen").

   Aufruf: node tools-android\diff-settings.js [geraete-datei]
   Die Geraetedatei wird zuvor geholt mit:
     adb -t <transport> shell run-as de.reuschlerit.llmbox cat files/data/settings.json  */
'use strict';

const fs = require('fs');
const path = require('path');

const WIN = process.env.APPDATA + '\\LLM Box\\settings.json';
const DEV = process.argv[2] || path.join(__dirname, '..', 'tmp-settings-device-now.json');

function load(p) {
  if (!fs.existsSync(p)) { console.log('FEHLT: ' + p); return null; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.log('Fehler ' + p + ': ' + e.message); return null; }
}

const w = load(WIN), d = load(DEV);
if (!w || !d) process.exit(1);

console.log('Windows : ' + WIN + '  (' + fs.statSync(WIN).size + ' B, Stand ' + fs.statSync(WIN).mtime.toISOString() + ')');
console.log('Ger\u00e4t : ' + DEV + '  (' + fs.statSync(DEV).size + ' B)');

const keys = [...new Set([...Object.keys(w), ...Object.keys(d)])];
const same = [], diff = [], nurW = [], nurD = [];
for (const k of keys) {
  const a = JSON.stringify(w[k]), b = JSON.stringify(d[k]);
  if (!(k in w)) { nurD.push(k); continue; }
  if (!(k in d)) { nurW.push(k); continue; }
  (a === b ? same : diff).push(k);
}

console.log('\nGLEICH   (' + same.length + '): ' + same.join(', '));
console.log('NUR WIN  (' + nurW.length + '): ' + nurW.join(', '));
console.log('NUR GER\u00c4T (' + nurD.length + '): ' + nurD.join(', '));

function kurz(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return (s || '').replace(/\s+/g, ' ').slice(0, 150);
}

console.log('\nUNTERSCHIEDE (' + diff.length + ')');
for (const k of diff) {
  console.log('\n### ' + k);
  if (k === 'connections') {
    const list = (x) => (x || []).map((c, i) => `  [${i}] id=${c.id} name=${c.name} type=${c.type} url=${c.baseUrl} key=${(c.apiKey || '').slice(0, 12)}… extra=${JSON.stringify(Object.keys(c))}`);
    console.log('WIN:\n' + list(w.connections).join('\n'));
    console.log('GER\u00c4T:\n' + list(d.connections).join('\n'));
  } else if (typeof w[k] === 'object' && w[k] && typeof d[k] === 'object' && d[k]) {
    const sub = [...new Set([...Object.keys(w[k]), ...Object.keys(d[k])])];
    for (const s of sub) {
      const a = JSON.stringify(w[k][s]), b = JSON.stringify(d[k][s]);
      if (a !== b) console.log(`  ${s}: WIN=${kurz(w[k][s])} | GER\u00c4T=${kurz(d[k][s])}`);
    }
  } else {
    console.log('  WIN:   ' + kurz(w[k]));
    console.log('  GER\u00c4T: ' + kurz(d[k]));
  }
}
