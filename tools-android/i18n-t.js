// Fuehrt die echte T()-Funktion aus i18n.js aus (ohne Browser) und prueft Texte.
// Aufruf: node i18n-t.js <js-Ordner> [Text ...]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DIR = process.argv[2] || 'D:/MeinProjekt/LLM-Box/llm-box/renderer/js';

const stub = {
  document: { documentElement: { setAttribute() {}, getAttribute() { return null; } }, body: null,
    createTextNode() { return {}; },
    createTreeWalker() { return { nextNode() { return null; } }; },
    addEventListener() {}, querySelectorAll() { return []; } },
  MutationObserver: class { observe() {} disconnect() {} },
  console,
};
const ctx = vm.createContext(stub);
const order = ['i18n.js', 'i18n-prompts.js', 'i18n-lex.js', 'i18n-lex-settings.js', 'i18n-lex-extra.js',
  'i18n-lex-android.js', 'i18n-lex-hints.js', 'i18n-lex-ctx.js', 'i18n-lex-full.js'];
for (const f of order) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) { console.log('fehlt: ' + f); continue; }
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { console.log('FEHLER in ' + f + ': ' + e.message); }
}
vm.runInContext("I18N.lang='en'", ctx);
const T = ctx.T;
const tests = process.argv.slice(3);
if (!tests.length) {
  tests.push(
    'Farben (heller Modus)',
    'Listenpreis: 2 $ Eingabe / 10,67 $ Ausgabe je 1 Mio. Token, umgerechnet in €. Mittel aus GPT-6.1 Sol (2 $ / 10 $), Claude Sonnet 5.5 (2 $ / 10 $) und Gemini 3.1 Pro (2 $ / 12 $).',
    'Listenpreis: 2 $ Eingabe / 10,67 $ Ausgabe je 1 Mio. Token, umgerechnet in €.',
    'Windows-Freigabe im LAN, direkt gelesen und beschrieben. Pfad wahlweise als',
    'oder'
  );
}
for (const t of tests) {
  console.log('\nEINGANG : ' + t);
  console.log('AUSGANG : ' + T(t));
}
