/* bruecken-check.js – prueft, ob die Android-Bruecke (android-adapter.js, native-main.js,
   node-shim.js) weiterhin an die Interna der neuen Desktop-Oberflaeche passt.

   Die Bruecke ruft interne Funktionen und Felder von app.js, llm.js, settings.js und
   server.js auf. Aendert die Desktop-Seite diese Namen, bleibt die Android-App still
   stehen oder bedient sich falsch, ohne dass der Build einen Fehler meldet.
   Der Diff 1.0.67 -> 1.0.70 hat z. B. in handoff.js vom globalen S.generating auf
   viewRun() umgestellt.

   Aufruf: node tools-android\bruecken-check.js
   Exit 0 = alle Referenzen gefunden, Exit 1 = mindestens eine Referenz fehlt. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const bruecke = {
  'android-adapter.js': read('tools-android/android-adapter.js'),
  'native-main.js': read('tools-android/native-main.js'),
  'node-shim.js': read('tools-android/node-shim.js')
};

const quelltexte = {
  'app.js': read('llm-box/renderer/js/app.js'),
  'llm.js': read('llm-box/renderer/js/llm.js'),
  'settings.js': read('llm-box/renderer/js/settings.js'),
  'server.js': read('llm-box/renderer/js/server.js'),
  'subagents.js': read('llm-box/renderer/js/subagents.js'),
  'livetools.js': read('llm-box/renderer/js/livetools.js'),
  'handoff.js': read('llm-box/renderer/js/handoff.js'),
  'transfer.js': read('llm-box/renderer/js/transfer.js'),
  'util.js': read('llm-box/renderer/js/util.js'),
  'i18n.js': read('llm-box/renderer/js/i18n.js')
};

/* Namen, die die Bruecke aus der Desktop-Seite erwartet. */
const erwartet = [
  'S.generating', 'viewRun', 'RUNS', 'discardAllRuns', 'currentModel', 'chatTotals',
  'chatCost', 'powerPrice', 'energyCost', 'chatEnergy', 'energyTip', 'updateCtxMeter',
  'renderChat', 'renderMessages', 'renderSettings', 'openSettings', 'applySettings',
  'buildSystemPrompt', 'sendChat', 'stopGeneration', 'execOn', 'panelOpen',
  'i18nApply', 't', 'tl', 'fmt', 'api.store', 'api.net', 'api.fs', 'api.smb',
  'svReadPower', 'svPowerPrice', 'enAdd', 'enClose', 'tlClear', 'thinkBlocks',
  'queued', 'inbox', 'steer', 'anthropic', 'anthropicBase', 'handleAnth'
];

/* DOM-Elemente und CSS-Klassen, auf die android.css / android-adapter.js zugreifen. */
const dom = ['#st-right', '#st-left', '#statusbar', '#filepanel', '#ctx-meter', '#titlebar',
  'st-line', 'collapsed', 'queued-now', 'steer-tag'];

let fehl = 0;
const alles = Object.values(quelltexte).join('\n');
const brueckenText = Object.values(bruecke).join('\n');

console.log('Referenzen der Bruecke auf die Desktop-Seite');
for (const name of erwartet) {
  const inBruecke = brueckenText.includes(name);
  const inQuelle = alles.includes(name);
  if (!inBruecke) continue;
  if (inQuelle) console.log('  OK    ' + name);
  else { fehl++; console.log('  FEHLT ' + name + '  – die Bruecke ruft es auf, die Quelle 1.0.70 kennt es nicht'); }
}

console.log('');
console.log('DOM-Elemente und Klassen (android.css / Adapter)');
const html = read('llm-box/renderer/index.html');
const css = read('llm-box/renderer/styles.css');
for (const name of dom) {
  const inBruecke = brueckenText.includes(name) || read('tools-android/android.css').includes(name);
  if (!inBruecke) continue;
  const sauber = name.replace(/^[#.]/, '');
  /* st-line entsteht erst durch den Statuszeilen-Patch in build-android.ps1,
     steht also absichtlich weder in index.html noch in styles.css. */
  const vomPatchErzeugt = name === 'st-line';
  const gefunden = html.includes(sauber) || css.includes(sauber) || vomPatchErzeugt;
  if (gefunden) console.log('  OK    ' + name + (vomPatchErzeugt ? '  (vom Statuszeilen-Patch erzeugt)' : ''));
  else { fehl++; console.log('  FEHLT ' + name + '  – in index.html und styles.css nicht mehr vorhanden'); }
}

console.log('');
console.log('fehlende Referenzen: ' + fehl);
process.exit(fehl ? 1 : 0);
