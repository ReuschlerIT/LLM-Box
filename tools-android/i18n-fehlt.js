/* Listet die noch fehlenden Schluessel, gruppiert nach Quelldatei und nach Laenge.
   Aufruf: node tools-android\i18n-fehlt.js [dateiname]  -> z. B. js_settings.js */
const fs = require('fs');
const path = require('path');

const alle = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-schluessel.json'), 'utf8'));
const LEX = {};
for (const f of ['i18n-lex.js', 'i18n-lex-settings.js', 'i18n-lex-extra.js', 'i18n-lex-android.js', 'i18n-lex-hints.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'llm-box', 'renderer', 'js', f), 'utf8');
  for (const m of src.matchAll(/^\s{2}((?:'(?:[^'\\]|\\.)*')\s*):/gm)) {
    try { LEX[JSON.parse(m[1].replace(/'/g, '"').replace(/\\"/g, '"'))] = true; } catch {}
  }
}

const fehlt = alle.filter((k) => !(k in LEX));
const ordner = path.join(__dirname, 'sprachen');
const nachDatei = new Map();
for (const k of fehlt) {
  for (const datei of fs.readdirSync(ordner)) {
    const liste = fs.readFileSync(path.join(ordner, datei), 'utf8').split('\n');
    if (liste.some((z) => z.replace(/\s+/g, ' ').trim() === k.replace(/\s+/g, ' ').trim())) {
      nachDatei.set(datei, (nachDatei.get(datei) || 0) + 1);
      break;
    }
  }
}

const filter = process.argv[2];
if (filter) {
  const liste = fs.readFileSync(path.join(ordner, filter), 'utf8').split('\n');
  const offen = liste.filter((k) => k.trim() && !(k.replace(/\s+/g, ' ').trim() in LEX));
  console.log('# ' + filter + ': ' + offen.length + ' von ' + liste.length + ' fehlen');
  for (const k of offen) console.log(JSON.stringify(k));
} else {
  console.log('fehlend gesamt: ' + fehlt.length);
  for (const [d, n] of [...nachDatei.entries()].sort((a, b) => b[1] - a[1])) console.log('  ' + d + ': ' + n);
}
