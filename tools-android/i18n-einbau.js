/* Baut die Sprachschicht in app.js ein: neue buildSystem() (Sprache des Systemprompts)
   und applyLanguage()-Aufruf beim Start. CRLF-sicher, bricht ab wenn ein Anker fehlt.
   Aufruf: node tools-android\i18n-einbau.js            (prueft nur)
           node tools-android\i18n-einbau.js --schreiben */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'llm-box', 'renderer', 'js', 'app.js');
const SCHREIBEN = process.argv.includes('--schreiben');

let src = fs.readFileSync(APP, 'utf8');
const warCRLF = src.includes('\r\n');
src = src.replace(/\r\n/g, '\n');

/* ── 1) buildSystem() ersetzen (inkl. alter ASK_HINT-Konstante direkt danach) ── */
const anfang = 'function buildSystem() {';
const ende = "const ASK_HINT =";
const i0 = src.indexOf(anfang);
const i1 = src.indexOf(ende, i0);
if (i0 < 0 || i1 < 0) { console.error('ABBRUCH: Anker fuer buildSystem() nicht gefunden'); process.exit(1); }
if (src.slice(i0, i1).includes("part('toolsHint'")) { console.log('buildSystem() ist bereits umgebaut.'); }
else {
  const neu = `/* Sprachschicht anwenden: Oberflaeche, Spracheingabe des Eingabefelds und
   damit auch die Rechtschreibpruefung. Laeuft beim Start und nach jeder Aenderung
   der Sprachauswahl in den Einstellungen. */
function applyLanguage(lang) {
  const l = (typeof LANGS !== 'undefined' && LANGS.some((x) => x.value === lang)) ? lang : 'de';
  setLang(l);                                   // uebersetzt Oberflaeche und Werkzeugtexte
  document.documentElement.setAttribute('lang', l);
  applySpell();                                 // Wortbuecher folgen der Sprache
}

function buildSystem() {
  const lang = S.settings.uiLang || 'de';
  let s = S.settings.systemPrompt || '';
  /* Sprachregel fuer die KI: Steht noch der unveraenderte Standardprompt drin, wird er
     durch seine englische bzw. franzoesische Fassung ersetzt. Hat der Nutzer seinen
     Prompt selbst bearbeitet, bleibt er erhalten und bekommt nur die Sprachregel. */
  if (lang !== 'de' && SYSTEM_PROMPTS[lang] && s.trim() === DEFAULTS.systemPrompt.trim()) {
    s = SYSTEM_PROMPTS[lang];
  } else if (lang !== 'de') {
    s += (s ? '\\n\\n' : '') + LANG_RULE[lang];
  }
  if (S.settings.appearance.thinkInGerman) s += (s ? '\\n\\n' : '') + T('Denke und überlege auf Deutsch (auch im Gedankengang).');
  if (useTools()) {
    const list = \`list_files, search_text, read_file, edit_file, write_file\${subOn() ? ', delegate_task' : ''}\`;
    s += part('toolsHint', lang, S.settings.workspace.path, list) + (askOn() ? part('askHint', lang) : '') + (hoOn() ? part('handoffHint', lang) : '') + (subOn() ? part('subHint', lang) : '');
    if (execOn()) s += part('execHint', lang, /Win/i.test(navigator.platform || navigator.userAgent));
  } else if (askAlone()) s += \`\\n\\n\${part('askHint', lang).trim()}\`;
  return s.trim();
}

`;
  src = src.slice(0, i0) + neu + src.slice(i1);
  console.log('buildSystem() ersetzt.');
}

/* ── 2) applyLanguage() beim Start aufrufen (nach applyAppearance()) ── */
const alt = '  applyAppearance();\n  applySpell();';
if (src.includes('  applyLanguage(S.settings.uiLang);')) {
  console.log('applyLanguage() wird bereits beim Start aufgerufen.');
} else if (!src.includes(alt)) {
  console.error('ABBRUCH: Aufrufkette applyAppearance()/applySpell() nicht gefunden');
  process.exit(1);
} else {
  src = src.replace(alt, '  applyAppearance();\n  applyLanguage(S.settings.uiLang);\n  applySpell();');
  console.log('applyLanguage()-Aufruf beim Start ergaenzt.');
}

/* ── 3) Nach dem Sprachwechsel die dynamisch gebauten Stuecke neu malen ──
   Chatliste (Knopf-Title), Statuszeile und Kontextbalken werden per innerHTML/Template
   erzeugt; der MutationObserver uebersetzt zwar neu eingefuegten Text, aber die
   Deutsch-Faelle in den Vorlagen bleiben sonst stehen. */
const sc = 'function renderStatus() {';
if (src.includes('function refreshLanguageUi()')) {
  console.log('refreshLanguageUi() existiert bereits.');
} else if (!src.includes(sc)) {
  console.error('ABBRUCH: renderStatus() nicht gefunden');
  process.exit(1);
} else {
  src = src.replace(sc, `/* Nach dem Sprachwechsel neu aufbauen, was aus Vorlagen entsteht. */
function refreshLanguageUi() {
  try { renderChatList(); } catch {}
  try { renderStatus(); } catch {}
  try { updateCtxMeter(); } catch {}
  try { updateToolsBtn(); } catch {}
  try { updateThinkBtn(); } catch {}
  try { updatePermBtn(); } catch {}
}

` + sc);
  console.log('refreshLanguageUi() ergaenzt.');
}

if (SCHREIBEN) {
  fs.writeFileSync(APP, warCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  console.log('Geschrieben: llm-box\\renderer\\js\\app.js');
} else {
  console.log('(Trockenlauf – nichts geschrieben)');
}
