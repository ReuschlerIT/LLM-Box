/* Debug: zeigt, in welche Saetze splitSentences den Hilfetext zerlegt. */
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || 'D:/MeinProjekt/LLM-Box/llm-box/renderer/js';
const src = fs.readFileSync(path.join(dir, 'i18n.js'), 'utf8');
const start = src.indexOf('const ABBREV_RE');
const end = src.indexOf('/* ───────── Uebersetzung eines einzelnen Textes');
const code = src.slice(start, end);
const splitSentences = new Function(code + '\nreturn splitSentences;')();

const tests = [
  'Listenpreis: 2 $ Eingabe / 10,67 $ Ausgabe je 1 Mio. Token, umgerechnet in €. Mittel aus GPT-6.1 Sol (2 $ / 10 $), Claude Sonnet 5.5 (2 $ / 10 $) und Gemini 3.1 Pro (2 $ / 12 $).',
  'Listenpreis: 2 $ Eingabe / 10,67 $ Ausgabe je 1 Mio. Token, umgerechnet in €.',
  'Preis pro Mio. des Modells (Eingabe / Ausgabe). 1 Mio. = 1.000.000 Zeichen ≈ 750.000 Tokens. Der Wert ist der Listenpreis des Modellanbieters, umgerechnet in €.',
  'Windows-Freigabe im LAN, direkt gelesen und beschrieben. Pfad wahlweise als',
  'z. B. zu lang. Weiter geht es.',
];
for (const t of tests) {
  console.log('TEXT : ' + t.slice(0, 60) + '…');
  splitSentences(t).forEach((s, i) => console.log('  [' + i + '] ' + s));
  console.log('');
}
