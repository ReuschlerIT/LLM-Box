/* Zaehlt deutsche Bildschirm-Texte in der Web-Oberflaeche (Windows + Android identisch).
   Nur lesend, aendert nichts. Aufruf: node tools-android\scan-ui-texte.js [wurzel] */
const fs = require('fs');
const path = require('path');

const wurzel = process.argv[2] || path.join(__dirname, '..', 'llm-box', 'renderer');

// Deutsche Worter/Muster, die typisch fuer Bildschirmtexte sind (keine Code-Woerter).
const DE_WORTER = /\b(der|die|das|und|oder|mit|für|für |nicht|kein|keine|Chat|Ordner|Datei|Dateien|Einstellungen|Speichern|Abbrechen|OK|Schließen|laden|wählen|setzen|Prüfen|Test|Verbindung|Modell|Workspace|übernehmen|entfernen|hinzufügen|bearbeiten|umbenennen|kopieren|verschieben|größer|kleiner|Sekunden|Minuten|Token|Nachricht|Nachrichten|antworten|Sprache|Rechner|Netzwerk|Passwort|Benutzer)\b/;
const UMLAUTE = /[äöüÄÖÜß]/;

function stripComments(src) {
  // Zeilen- und Blockkommentare grob entfernen, damit Kommentare nicht zaehlen.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function stringsIn(src) {
  // Alle Einzel-, Doppel- und Backtick-Strings einsammeln.
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\[\s\S])*)`|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) {
    out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  }
  return out;
}

function isUiText(s) {
  if (!s || s.trim().length === 0) return false;
  // CSS/Selektoren, Dateinamen, Pfade, HTML-Snippets aussondern.
  if (/^[.#&>?[\]()\s]*$/.test(s)) return false;
  if (/\.(js|css|html|json|png|svg|ico)$/i.test(s.trim())) return false;
  if (/^(#[0-9a-fA-F]{3,8}|rgba?\(|var\(--)/.test(s.trim())) return false;
  if (/^[a-z0-9_-]+$/i.test(s.trim()) && !DE_WORTER.test(s)) return false;   // reine Schluessel/IDs
  if (/^(https?:|data:|file:|\\\\|[A-Z]:\\)/.test(s.trim())) return false;
  const human = UMLAUTE.test(s) || DE_WORTER.test(s);
  if (!human) return false;
  // Enthaelt der String Grossbuchstaben am Wortanfang eines deutschen Wortes?
  return true;
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); }
    else if (/\.(js|html)$/.test(e.name)) files.push(p);
  }
})(wurzel);

let gesamt = 0;
const zeilen = [];
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const all = stringsIn(src);
  const ui = all.filter(isUiText);
  // Eindeutige Texte zaehlen (Duplikate wie 'Abbrechen' nur einmal pro Datei).
  const uniq = new Set(ui.map(s => s.trim()));
  gesamt += ui.length;
  zeilen.push([path.relative(wurzel, f), all.length, ui.length, uniq.size]);
}

zeilen.sort((a, b) => b[2] - a[2]);
console.log('Datei'.padEnd(28), 'Strings gesamt'.padStart(14), 'davon deutsch'.padStart(15), 'eindeutig'.padStart(10));
for (const z of zeilen) console.log(z[0].padEnd(28), String(z[1]).padStart(14), String(z[2]).padStart(15), String(z[3]).padStart(10));
console.log('---');
console.log('deutsche Bildschirm-Texte (Vorkommen):', gesamt);
const alle = new Set();
for (const f of files) { const s = stripComments(fs.readFileSync(f, 'utf8')); for (const x of stringsIn(s)) if (isUiText(x)) alle.add(x.trim()); }
console.log('eindeutig ueber alle Dateien:', alle.size);
