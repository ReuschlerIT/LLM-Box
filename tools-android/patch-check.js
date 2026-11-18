/* patch-check.js – prueft die Android-Patches aus build-android.ps1 gegen die aktuelle
   Desktop-Quelle (llm-box/renderer), OHNE zu bauen.

   Hintergrund: build-android.ps1 kopiert llm-box\renderer nach android\...\webapp und patcht
   dort mit exakten Suchtexten (Patch/PatchAny, Zeilen 18-45). Patch() bricht den Build ab,
   wenn der Suchtext fehlt oder mehrfach vorkommt. Patch() und PatchAny() schauen aber ZUERST,
   ob der neue Text schon im File steht - dann gilt der Patch als "bereits gepatcht" und der
   Build laeuft weiter. Genau diese Reihenfolge bildet dieses Skript nach, damit ein Bericht
   nicht meldet, ein Patch sei kaputt, obwohl die Quelle den Zielzustand schon enthaelt.

   Aufruf:  node tools-android\patch-check.js
   Exit 0 = Build wuerde durchlaufen, Exit 1 = mindestens ein Patch wuerfe eine Fehlermeldung. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, 'llm-box', p), 'utf8');

const dateien = {
  'index.html': read('renderer/index.html'),
  'app.js': read('renderer/js/app.js'),
  'settings.js': read('renderer/js/settings.js'),
  'styles.css': read('renderer/styles.css')
};

/* Mehrzeilige Suchtexte wie die Here-Strings im Build-Skript. */
const altStatus = [
  "  $('#st-right').innerHTML = `${tl}Chat: <b>${tilde}${fmt.tok(t.total)}</b> Tokens (↑ ${fmt.tok(t.prompt)} · ↓ ${fmt.tok(t.comp)})` +",
  "    ` · Ø <b>${avg ? tilde + fmt.tps(avg) : '–'}</b> Tokens/s` + (lv && liveTps ? ` (jetzt <b>~${fmt.tps(liveTps)}</b>)` : '') +",
  "    ` · Dauer: <b>${fmt.dur(dur)}</b>`;"
].join('\n');
const neuStatus = [
  "  $('#st-right').innerHTML = `<span class=\"st-line\">${tl}Chat: <b>${tilde}${fmt.tok(t.total)}</b> Tokens (↑ ${fmt.tok(t.prompt)} · ↓ ${fmt.tok(t.comp)})` +",
  "    ` Ø <b>${avg ? tilde + fmt.tps(avg) : '–'}</b> Tokens/s` + (lv && liveTps ? ` (jetzt <b>~${fmt.tps(liveTps)}</b>)` : '') + `</span>` +",
  "    `<span class=\"st-line\">Dauer: <b>${fmt.dur(dur)}</b></span>`;"
].join('\n');

const altEnter = "  if (stored && stored.workspace && stored.workspace.confirmWrites === false && !stored.workspace.approval) S.settings.workspace.approval = 'none';";
const neuEnter = altEnter + '\n  // Einmalig (Android): Enter war hier immer die Sendetaste.';

/* Paare wie in build-android.ps1: [Datei, [alt, neu, ...], Label].
   Ein Element mit mehreren alt/neu-Paaren entspricht PatchAny. */
const patches = [
  ['index.html', [
    '  <link id="hl-theme" rel="stylesheet" href="vendor/hl-dark.css" />',
    '  <link id="hl-theme" rel="stylesheet" href="vendor/hl-dark.css" />\n  <link rel="stylesheet" href="android.css" />',
    '  <link id="hl-theme" rel="stylesheet" href="vendor/hl-light.css" />',
    '  <link id="hl-theme" rel="stylesheet" href="vendor/hl-light.css" />\n  <link rel="stylesheet" href="android.css" />'
  ], 'Mobil-Layout einbinden'],
  ['index.html', ['  <script src="js/llm.js"></script>', '  <script src="vendor/webdeps.js"></script>'],
    'Shims, PDF-Worker, docs.js und portierten Hauptprozess laden'],
  ['index.html', ['  <script src="js/app.js"></script>', '  <script src="js/android-adapter.js"></script>'],
    'Android-Adapter zuletzt laden'],
  ['index.html', ['<html lang="de" data-theme="dark">', '<html lang="de" data-theme="light">'],
    'Starttheme Hell'],
  ['index.html', ['    <aside id="filepanel"></aside>', '    <aside id="filepanel" class="collapsed"></aside>'],
    'Workspace-Panel startet geschlossen (kein weisser Startblock)'],
  ['styles.css', ['@media (max-width: 1100px) { #filepanel { display: none; } }',
    '@media (max-width: 1100px) { /* Panel-Sichtbarkeit uebernimmt die collapsed-Klasse */ }'],
    'Panel-Ausblendregel durch collapsed-Steuerung ersetzt'],
  ['app.js', ['const execOn = () => S.settings.workspace.execEnabled !== false;',
    'const execOn = () => !window.IS_ANDROID && S.settings.workspace.execEnabled !== false;'],
    'Befehls-Werkzeuge auf Android abgeschaltet'],
  ['app.js', ['  panelOpen: true,', '  panelOpen: false,'], 'Workspace-Panel startet geschlossen'],
  ['app.js', ["currentModel() ? 'Modell: ' + currentModel()", "currentModel() ? ''",
    "currentModel() ? currentModel()", "currentModel() ? ''"], 'Statuszeile ohne Modellbezeichnung'],
  ['app.js', [altStatus, neuStatus], 'Statuszeile mit Zeilen fuer Chat und Dauer'],
  ['app.js', ["    $('#st-right').innerHTML += ` · Kosten ${c.est || lv ? '~' : '≈'} <b>${fmt.money(amount, 'EUR')}</b>`;",
    "    $('#st-right').innerHTML += `<span class=\"st-line\">Kosten ${c.est || lv ? '~' : '≈'} <b>${fmt.money(amount, 'EUR')}</b></span>`;"],
    'Statuszeile eigene Zeile fuer Kosten'],
  ['app.js', ["      $('#st-right').innerHTML += ` · Strom ${lv ? '~' : '≈'} <b>${has ? fmt.money(energyCost(e.wh + lw), 'EUR') : '–'}</b>`;",
    "      $('#st-right').innerHTML += `<span class=\"st-line\">Strom ${lv ? '~' : '≈'} <b>${has ? fmt.money(energyCost(e.wh + lw), 'EUR') : '–'}</b></span>`;"],
    'Statuszeile eigene Zeile fuer Strom (neu in 1.0.70)'],
  ['settings.js', ['fontSize: 15, showStats: true, enterToSend: true,', 'fontSize: 15, showStats: true, enterToSend: false,'],
    'Enter macht standardmaessig eine neue Zeile'],
  ['app.js', [altEnter, neuEnter], 'Enter macht auf Android einmalig eine neue Zeile'],
  ['settings.js', ["approval: 'write', execEnabled: true", "approval: 'write', execEnabled: false"],
    'Ausfuehren per Standard aus'],
  ['settings.js', ["    theme: 'dark', accent:", "    theme: 'light', accent:"], 'Standarddesign Hell']
];

let fehl = 0;
for (const [name, paare, label] of patches) {
  const inhalt = dateien[name];
  /* Schritt 1 wie im Build-Skript: neuer Text schon enthalten -> "bereits gepatcht" */
  const fertig = [];
  for (let i = 1; i < paare.length; i += 2) if (inhalt.includes(paare[i])) fertig.push(label);
  if (fertig.length) { console.log('.     ' + label + '   [' + name + '] bereits in der Quelle enthalten'); continue; }
  /* Schritt 2: Suchtext genau einmal? build-android.ps1 setzt seit dem Fix mehrzeilige
     Suchtexte auf CRLF um, wenn die Datei CRLF nutzt - hier ebenso nachgeprueft. */
  let ok = false;
  const treffer = [];
  for (let i = 0; i < paare.length; i += 2) {
    const alt = paare[i].includes('\n') && !inhalt.includes(paare[i])
      ? paare[i].replace(/\r?\n/g, '\r\n')
      : paare[i];
    const n = inhalt.split(alt).length - 1;
    treffer.push(n);
    if (n === 1) { ok = true; break; }
  }
  if (ok) console.log('OK    ' + label + '   [' + name + ']');
  else {
    fehl++;
    console.log('FEHLT ' + label + '   [' + name + ']  Vorkommen der Suchtexte: ' + treffer.join('/'));
    for (let i = 0; i < paare.length; i += 2) {
      const zeile = inhalt.split('\n').findIndex(l => l.includes(paare[i].split('\n')[0].trim().slice(0, 50)));
      console.log('        Suchtext: ' + JSON.stringify(paare[i].slice(0, 80)) + (zeile >= 0 ? '  (Zeile ' + (zeile + 1) + ')' : '  (nirgends)'));
    }
  }
}
console.log('');
console.log('gepruefte Patches: ' + patches.length + '   wuerden den Build abbrechen: ' + fehl);
process.exit(fehl ? 1 : 0);
