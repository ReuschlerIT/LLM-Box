/* Prueft die Sprachschicht:
   1) jeder Woerterbuch-Schluessel muss wirklich im Quelltext vorkommen (keine Erfundenen)
   2) T() liefert fuer en und fr eine Uebersetzung (nicht den deutschen Text zurueck)
   3) Muster fuellen Werte korrekt ein
   4) Sprachwechsel uebersetzt die Oberflaeche und stellt Deutsch wieder her
   Aufruf: node tools-android\test-i18n.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'llm-box', 'renderer', 'js');

let bestanden = 0, fehler = 0;
function ok(name, bedingung, extra) {
  if (bedingung) { bestanden++; console.log('  OK   ' + name); }
  else { fehler++; console.log('  FEHLER ' + name + (extra ? '  -> ' + extra : '')); }
}

/* ── Woerterbuch laden ──
   i18n.js deklariert alles mit const/function - die liegen im vm-Kontext, aber NICHT als
   Eigenschaften von ctx. Deshalb laeuft jeder Zugriff ueber expr(). */
const ctx = {
  console,
  document: { addEventListener() {}, documentElement: { setAttribute() {} }, body: null },
};
vm.createContext(ctx);
for (const f of ['i18n.js', 'i18n-lex.js', 'i18n-lex-settings.js', 'i18n-lex-extra.js', 'i18n-lex-android.js', 'i18n-lex-hints.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f }); }
  catch (e) { console.log('FEHLER beim Laden von ' + f + ': ' + e.message); process.exit(1); }
}
const expr = (code) => vm.runInContext(code, ctx);
const setL = (l) => expr('I18N.lang = ' + JSON.stringify(l));
const LEX = expr('I18N_LEX');

/* ── 1) Schluessel muessen im Quelltext stehen ── */
console.log('\n1) Schluessel decken den echten Quelltext ab?');
const QUELL = ['index.html', 'js/app.js', 'js/settings.js', 'js/server.js', 'js/transfer.js',
  'js/handoff.js', 'js/subagents.js', 'js/livetools.js', 'js/thinktr.js', 'js/util.js',
  'js/strataimport.js', 'js/llm.js'].map((f) => path.join(ROOT, 'llm-box', 'renderer', f));
QUELL.push(path.join(ROOT, 'tools-android', 'android-adapter.js'), path.join(ROOT, 'tools-android', 'native-main.js'));
const quellText = QUELL.map((p) => fs.readFileSync(p, 'utf8')).join('\n');

const fremd = [];
for (const k of Object.keys(LEX)) {
  if (quellText.includes(k)) continue;
  // Kurzfassung pruefen: lange Texte stehen im Code verteilt oder mit Escape-Zeichen.
  const probe = k.length > 24 ? k.slice(0, 24) : k;
  if (!quellText.includes(probe)) fremd.push(k);
}
ok('keine erfundenen Schluessel (' + Object.keys(LEX).length + ' Eintraege)', fremd.length === 0,
  fremd.slice(0, 12).map((s) => JSON.stringify(s)).join(' | '));

/* ── 2) Uebersetzung liefert en und fr ── */
console.log('\n2) Jede Sprache liefert einen anderen Text?');
const leer = [];
for (const [k, v] of Object.entries(LEX)) {
  if (!Array.isArray(v) || v.length !== 2) { leer.push(k + ' (Wert kein Paar)'); continue; }
  for (let i = 0; i < 2; i++) {
    if (!v[i] || !String(v[i]).trim()) leer.push(k + ' (' + (i ? 'fr' : 'en') + ' leer)');
    else if (String(v[i]).trim() === k.trim() && /[äöüß]/.test(k)) leer.push(k + ' (' + (i ? 'fr' : 'en') + ' = deutsch)');
  }
}
ok('alle Eintraege haben en und fr', leer.length === 0, leer.slice(0, 10).join(' | '));

/* ── 3) T() in einer Sprache ── */
console.log('\n3) T() arbeitet in der gewaehlten Sprache');
setL('en');
const T = (s) => expr('T(' + JSON.stringify(s) + ')');
ok('deutscher Text wird englisch', T('Neuer Chat') === 'New chat', JSON.stringify(T('Neuer Chat')));
ok('unbekannter Text bleibt unveraendert', T('MeinProjekt') === 'MeinProjekt');
setL('fr');
ok('deutscher Text wird franzoesisch', T('Neuer Chat') === 'Nouvelle discussion', JSON.stringify(T('Neuer Chat')));
setL('de');
ok('Deutsch liefert den Originaltext', T('Neuer Chat') === 'Neuer Chat');

/* ── 4) Muster mit Werten ── */
console.log('\n4) Texte mit eingebetteten Werten');
setL('en');
ok('Datei(en)-Muster', T('12 Datei(en)') === '12 file(s)', JSON.stringify(T('12 Datei(en)')));
ok('aeltere anzeigen', /show 100 older/.test(T('‹ 100 ältere anzeigen')), JSON.stringify(T('‹ 100 ältere anzeigen')));
setL('fr');
ok('Datei(en)-Muster franzoesisch', T('12 Datei(en)') === '12 fichier(s)', JSON.stringify(T('12 Datei(en)')));

/* ── 5) Sprachregeln und Prompte ── */
console.log('\n5) Systemprompt folgt der Sprache');
const psrc = fs.readFileSync(path.join(JS, 'i18n-prompts.js'), 'utf8');
const pctx = { console };
vm.createContext(pctx);
vm.runInContext(psrc, pctx, { filename: 'i18n-prompts.js' });
const pe = (code) => vm.runInContext(code, pctx);
ok('Sprachregel Englisch vorhanden', /exclusively in English/.test(pe('LANG_RULE.en')));
ok('Sprachregel Franzoesisch vorhanden', /exclusivement en français/.test(pe('LANG_RULE.fr')));
ok('englischer Standardprompt vorhanden', /autonomous analysis and development agent/.test(pe('SYSTEM_PROMPTS.en')));
ok('franzoesischer Standardprompt vorhanden', /agent autonome d’analyse/.test(pe('SYSTEM_PROMPTS.fr')));
ok('deutscher Standardprompt unveraendert gelassen (Android-Patch abhaengt davon ab)', !pe('Object.keys(SYSTEM_PROMPTS)').includes('de'), pe('Object.keys(SYSTEM_PROMPTS)'));
ok('Werkzeug-Baustein englisch mit Pfad', pe(`part('toolsHint','en','C:\\\\Proj','list_files')`).includes('C:\\Proj'));
ok('Ausfuehrungs-Baustein franzoesisch', pe(`part('execHint','fr',true)`).includes('run_command'));

/* ── 6) Abdeckung: wie viel ist noch deutsch? ── */
console.log('\n6) Abdeckung (Informationsstand, kein Fehler)');
const extrakt = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-schluessel.json'), 'utf8'));
const gefehlt = extrakt.filter((k) => !(k in LEX));
console.log('  Quelltext-Schluessel gesamt: ' + extrakt.length);
console.log('  im Woerterbuch:              ' + (extrakt.length - gefehlt.length));
console.log('  noch ohne Uebersetzung:      ' + gefehlt.length);

/* ── 7) Saetze mit Abkuerzungen (1.0.67): 'Mio.' darf kein Satzende sein ──
   Ohne splitSentences()-Regel zerlegte T() Hilfetexte wie den Preisvorlagen-Hinweis
   mitten im Satz; die Teile fanden kein Woerterbuch und blieben deutsch stehen.
   Hier laeuft der volle Ladeplan der App (index.html) inkl. i18n-lex-full.js. */
console.log('\n7) Abkuerzungen trennen keine Saetze (Fix 1.0.67)');
const ctx2 = {
  console,
  document: { addEventListener() {}, documentElement: { setAttribute() {} }, body: null },
};
vm.createContext(ctx2);
for (const f of ['i18n.js', 'i18n-lex.js', 'i18n-lex-settings.js', 'i18n-lex-extra.js', 'i18n-lex-android.js',
  'i18n-lex-hints.js', 'i18n-lex-ctx.js', 'i18n-lex-full.js', 'i18n-prompts.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx2, { filename: f }); }
  catch (e) { console.log('FEHLER beim Laden von ' + f + ': ' + e.message); process.exit(1); }
}
const e2 = (code) => vm.runInContext(code, ctx2);
const T2 = (s) => e2('T(' + JSON.stringify(s) + ')');
const preis = 'Listenpreis: 2 $ Eingabe / 10,67 $ Ausgabe je 1 Mio. Token, umgerechnet in €. Mittel aus GPT-6.1 Sol (2 $ / 10 $), Claude Sonnet 5.5 (2 $ / 10 $) und Gemini 3.1 Pro (2 $ / 12 $).';
e2('I18N.lang = "en"');
const pEn = T2(preis);
ok('Preisvorlage englisch (Mio. trennt nicht)', !/Listenpreis|umgerechnet|und/.test(pEn), JSON.stringify(pEn));
ok('Farben (heller Modus) englisch', T2('Farben (heller Modus)') === 'Colors (light mode)', JSON.stringify(T2('Farben (heller Modus)')));
ok('Farben (dunkler Modus) englisch', T2('Farben (dunkler Modus)') === 'Colors (dark mode)', JSON.stringify(T2('Farben (dunkler Modus)')));
ok('SMB-Hinweis Teil 1 englisch', T2('Windows-Freigabe im LAN, direkt gelesen und beschrieben') === 'Use a Windows share on the LAN, read from and written to directly', JSON.stringify(T2('Windows-Freigabe im LAN, direkt gelesen und beschrieben')));
ok('SMB-Hinweis Teil 2 englisch', T2('Pfad wahlweise als') === 'Path either as', JSON.stringify(T2('Pfad wahlweise als')));
e2('I18N.lang = "fr"');
ok('Farben (heller Modus) franzoesisch', T2('Farben (heller Modus)') === 'Couleurs (mode clair)', JSON.stringify(T2('Farben (heller Modus)')));
ok('Preisvorlage franzoesisch', !/Listenpreis|umgerechnet/.test(T2(preis)), JSON.stringify(T2(preis)));
e2('I18N.lang = "de"');
ok('Deutsch bleibt unveraendert', T2(preis) === preis);

console.log('\nErgebnis: ' + bestanden + ' bestanden, ' + fehler + ' Fehler');
process.exit(fehler ? 1 : 0);
