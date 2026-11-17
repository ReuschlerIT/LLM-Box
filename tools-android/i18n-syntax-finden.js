/* Findet die fehlerhafte Zeile in den i18n-lex*-Dateien: haengt die Datei Stueck fuer
   Stueck aneinander und prueft mit new Function(), bis der Fehler auftritt. */
const fs = require('fs');
const path = require('path');

for (const name of ['i18n-lex.js', 'i18n-lex-settings.js', 'i18n-lex-extra.js']) {
  const p = path.join(__dirname, '..', 'llm-box', 'renderer', 'js', name);
  const zeilen = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n');
  let fehlerZeile = -1;
  for (let i = 1; i <= zeilen.length && fehlerZeile < 0; i++) {
    const stueck = ['const I18N_LEX = {}; const I18N_PAT = [];'].concat(zeilen.slice(0, i)).join('\n');
    try { new Function(stueck); } catch (e) { fehlerZeile = i; }
  }
  console.log('== ' + name + (fehlerZeile < 0 ? ': kein Fehler im Stueckeln' : ' <- Fehler zuerst in Zeile ' + fehlerZeile));
  if (fehlerZeile > 0) {
    for (let i = Math.max(0, fehlerZeile - 3); i < Math.min(zeilen.length, fehlerZeile + 1); i++) {
      console.log(String(i + 1).padStart(4) + ' | ' + zeilen[i]);
    }
  }
}
