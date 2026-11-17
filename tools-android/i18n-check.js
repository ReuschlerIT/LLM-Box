// Prueft, warum bestimmte deutsche Texte in der Uebersetzung haengen bleiben.
// Laedt nur die Woerterbuch-Dateien (I18N_LEX / I18N_PAT) – ohne DOM.
const fs = require('fs');
const path = require('path');
const DIR = process.argv[2] || 'D:/MeinProjekt/LLM-Box/llm-box/renderer/js';

global.I18N_LEX = {};
global.I18N_PAT = [];
global.I18N = { lang: 'en' };

const files = fs.readdirSync(DIR).filter((f) => /^i18n-lex.*\.js$/.test(f));
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  try { new Function('I18N_LEX', 'I18N_PAT', src)(global.I18N_LEX, global.I18N_PAT); }
  catch (e) { console.log('FEHLER in ' + f + ': ' + e.message); }
}
console.log('Lexikon-Eintraege: ' + Object.keys(global.I18N_LEX).length + ' | Muster: ' + global.I18N_PAT.length);

const tests = [
  'Farben (heller Modus)',
  'Farben (dunkler Modus)',
  'Listenpreis: 2 $ Eingabe / 10,67 $ Ausgabe je 1 Mio. Token, umgerechnet in €. Mittel aus GPT-6.1 Sol (2 $ / 10 $), Claude Sonnet 5.5 (2 $ / 10 $) und Gemini 3.1 Pro (2 $ / 12 $).',
  'Listenpreis: 2 $ Eingabe / 10,67 $ Ausgabe je 1 Mio. Token, umgerechnet in €.',
  'Windows-Freigabe im LAN, direkt gelesen und beschrieben.',
  'Pfad wahlweise als',
  'oder',
];
for (const t of tests) {
  const lex = global.I18N_LEX[t];
  const pat = global.I18N_PAT.map((p, i) => ({ i, hit: t.match(p[0]) })).filter((x) => x.hit);
  console.log('\nTEXT: ' + t);
  console.log('  Lexikon: ' + (lex ? JSON.stringify(lex[0]) : 'kein Treffer'));
  console.log('  Muster:  ' + (pat.length ? pat.map((x) => '#' + x.i + ' -> ' + JSON.stringify(x.hit[0])).join(' | ') : 'kein Treffer'));
}
