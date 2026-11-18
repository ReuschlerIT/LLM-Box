/* claude-strom-i18n.js – prueft die deutschen Bildschirmtexte der neuen Funktionen
   (Claude-Anbindung 1.0.68, Strom und Hinweise 1.0.70) gegen das Woerterbuch.

   Vorgehen: Die Plus-Zeilen des Diffs 1.0.67 -> 1.0.70 werden nach deutschen Texten
   durchsucht, die in settings.js, app.js, server.js oder llm.js als Beschriftung,
   Hilfetext oder Titel stehen. Jeder Fund wird gegen alle Woerterbuch-Dateien geprueft
   (einschliesslich i18n-lex-full.js, das test-i18n.js in Pruefung 1 nicht laedt).

   Aufruf: node tools-android\claude-strom-i18n.js [Pfad-zum-Diff] */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const diffPfad = process.argv[2] || path.join(root, '..', '..', 'tmp-diff-67-70.txt');
const JS = path.join(root, 'llm-box', 'renderer', 'js');

/* Alles aus den Woerterbuch-Dateien, roh als Text - reicht fuer die Pruefung
   "steht dieser Schluessel irgendwo als Woerterbuch-Schluessel". */
const lexDateien = fs.readdirSync(JS).filter(f => /^i18n-lex.*\.js$/.test(f));
const lexRoh = lexDateien.map(f => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n');
const lexKeys = new Set();
for (const m of lexRoh.matchAll(/^\s{2,4}(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)) lexKeys.add(m[2]);
console.log('Woerterbuch-Schluessel ueber alle ' + lexDateien.length + ' Dateien: ' + lexKeys.size);

/* Deutsche Beschriftungen aus den Plus-Zeilen des Diffs. */
const diff = fs.readFileSync(diffPfad, 'utf8');
let aktuelle = '';
const kandidaten = [];
for (const zeile of diff.split('\n')) {
  if (zeile.startsWith('+++ ')) { aktuelle = zeile.slice(4).replace(/^b\//, ''); continue; }
  if (!zeile.startsWith('+') || zeile.startsWith('+++')) continue;
  const t = zeile.slice(1);
  /* Beschriftungs- und Hilfetext-Stellen: label:, title:, text:, hint:, placeholder: */
  const re = /(?:label|title|text|hint|placeholder|name|titleText)\s*:\s*(['"])((?:\\.|(?!\1).){4,200})\1/g;
  let m;
  while ((m = re.exec(t))) {
    const s = m[2];
    if (!/[äöüÄÖÜß]/.test(s) && !/\b(Umgebung|Modell|Schluessel|Preis|Hinweis|Caching|Denk)\b/.test(s)) continue;
    kandidaten.push({ datei: aktuelle, text: s });
  }
}

const gesehen = new Set();
let fehlt = 0;
console.log('');
for (const k of kandidaten) {
  if (gesehen.has(k.text)) continue;
  gesehen.add(k.text);
  const direkt = lexKeys.has(k.text);
  const teil = !direkt && [...lexKeys].some(l => l.includes(k.text) || k.text.includes(l));
  if (direkt || teil) continue;
  fehlt++;
  console.log('FEHLT  [' + k.datei + ']  ' + JSON.stringify(k.text));
}
console.log('');
console.log('gepruefte Beschriftungen: ' + gesehen.size + '   ohne Woerterbuch-Eintrag: ' + fehlt);
