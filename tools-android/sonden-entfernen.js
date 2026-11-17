/* sonden-entfernen.js – entfernt die Geraete-Sonden aus der Kopie.

   Auftrag des Nutzers: "Sollen die Geraete-Sonden (Debug-Befehle mit deinen LAN-Adressen) im
   oeffentlichen Quelltext bleiben? Komplett entfernen (Code wird kleiner und nichts Persoenliches
   bleibt)."

   Warum ein Klammerzaehler auf Zeichen-Ebene und kein naiver Zeilenzaehler: die Sonden bauen
   JavaScript als Java-String zusammen ("+ \"(function(){try{…}\""). Ein Zaehler, der diese Klammern
   mitzaehlt, wuerde den Block viel zu frueh oder viel zu spaet beenden und den Build zerstoeren.
   Der Zaehler hier ueberspringt String-Literale (mit Escapes), Zeichen-Literale sowie Zeilen- und
   Blockkommentare. (Ein Kommentar wie dieser darf in dieser Datei natuerlich keine
   Kommentar-Schlussfolge enthalten – genau das war der erste Syntaxfehler dieses Skripts.)

   Enfert werden:
     - die drei Methoden probeQrAfterLoad(), probeCamAfterLoad(), probeUiAfterLoad()
       (probeUiAfterLoad enthaelt saemtlichen --ez-Sondenblock: lanprobe, lanapply, probechat,
        fixsync, smbprobe, setsync, syncrate – alle liegen in dieser einen Methode)
     - die Aufrufe davon und die zugehoerigen Felder/Zuweisungen (per exakter Zeichenkette)

   Der Workspace wird nicht angefasst; das Skript arbeitet nur im angegebenen Zielordner.
   Vorherige Sicherung: <datei>.mit-sonden  (in derselben Datei, damit ein Fehler rueckgaengig ist).

   Aufruf: node tools-android\sonden-entfernen.js <MainActivity.java> [--dry]              */
'use strict';
const fs = require('fs');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) { console.log('usage: node tools-android\\sonden-entfernen.js <MainActivity.java> [--dry]'); process.exit(1); }

let text = fs.readFileSync(ziel, 'utf8');

/* Zeigt fuer jede Position den Zustand des Java-Tokens. Rueckgabe: Array boolescher Werte,
   true = Zeichen gehoert zu echtem Code (also Klammern zaehlen duerfen). */
function codeMaske(s) {
  const maske = new Array(s.length);
  let zustand = 'code';   // code | string | char | zeilenkommentar | blockkommentar
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (zustand === 'code') {
      maske[i] = true;
      if (c === '"') zustand = 'string';
      else if (c === "'") zustand = 'char';
      else if (c === '/' && n === '/') { zustand = 'zeilenkommentar'; maske[i + 1] = false; i++; }
      else if (c === '/' && n === '*') { zustand = 'blockkommentar'; maske[i + 1] = false; i++; }
    } else if (zustand === 'string') {
      maske[i] = false;
      if (c === '\\') { if (i + 1 < s.length) { maske[i + 1] = false; i++; } }
      else if (c === '"') zustand = 'code';
    } else if (zustand === 'char') {
      maske[i] = false;
      if (c === '\\') { if (i + 1 < s.length) { maske[i + 1] = false; i++; } }
      else if (c === "'") zustand = 'code';
    } else if (zustand === 'zeilenkommentar') {
      maske[i] = false;
      if (c === '\n') { zustand = 'code'; maske[i] = true; }
    } else {   // blockkommentar
      maske[i] = false;
      if (c === '*' && n === '/') { maske[i + 1] = false; zustand = 'code'; i++; }
    }
  }
  return maske;
}

/* Findet das Ende eines Blocks: ab der Position von offenes '{' bis der Zaehler wieder 0 ist. */
function blockEnde(s, maske, vonZeichen) {
  let tiefe = 0;
  for (let i = vonZeichen; i < s.length; i++) {
    if (!maske[i]) continue;
    if (s[i] === '{') { tiefe++; continue; }
    if (s[i] === '}') { tiefe--; if (tiefe === 0) return i; }
  }
  return -1;
}

function zeilenanfangVon(s, idx) { const k = s.lastIndexOf('\n', idx); return k < 0 ? 0 : k + 1; }
function zeilenendeNach(s, idx) { const k = s.indexOf('\n', idx); return k < 0 ? s.length - 1 : k - 1; }

/* Entfernt einen Bereich [von..bis] inklusive der Zeile(n), wenn die ganze Zeile leer wird. */
const brocken = [];
function markiere(von, bis, grund) { brocken.push({ von, bis, grund }); }

/* ── 1) Methoden: probeQrAfterLoad / probeCamAfterLoad / probeUiAfterLoad ──
   FEHLER der ersten Fassung (am Ergebnis gemerkt): dieser Schritt hat die Fundstellen nur in
   brocken protokolliert, den Text aber nie veraendert. Entfernt wurden dadurch lediglich die
   Einzelzeilen und ein Block – die drei Methoden blieben stehen (2133 statt erwarteter ~1400
   Zeilen). Jetzt wird jede Methode tatsaechlich herausgeschnitten; nach jeder Entfernung wird neu
   gesucht, weil sich alle folgenden Positionen verschieben. */
for (const name of ['probeQrAfterLoad', 'probeCamAfterLoad', 'probeUiAfterLoad']) {
  const signatur = 'private void ' + name + '() {';
  let i;
  while ((i = text.indexOf(signatur)) >= 0) {
  const maske = codeMaske(text);
  const offnung = i + signatur.length - 1;      // das '{'
  const ende = blockEnde(text, maske, offnung);
  if (ende < 0) { console.log('BLOCKENDE NICHT BESTIMMBAR: ' + name); break; }
  // Vorgaengigen javadoc-Kommentar mitnehmen, damit kein Erklaertext ohne Code bleibt.
  let start = zeilenanfangVon(text, i);
  const davor = text.slice(0, start).replace(/[ \t]+$/, '');
  const docEnde = davor.lastIndexOf('*/');
  if (docEnde > 0) {
    const zeileDocEnde = zeilenendeNach(davor, docEnde);
    const such = davor.slice(0, zeileDocEnde + 1);
    const docAnfang = such.lastIndexOf('/**');
    const letzteZeileVorDoc = zeilenanfangVon(such, docAnfang);
    if (docAnfang >= 0 && davor.length - letzteZeileVorDoc < 4000) start = letzteZeileVorDoc;
  }
  const endeZeile = zeilenendeNach(text, ende);
  const zeileVon = text.slice(0, start).split('\n').length;
  const zeileBis = text.slice(0, endeZeile + 1).split('\n').length;
  markiere(start, endeZeile + 1, 'Methode ' + name + '  (Zeilen ' + zeileVon + '-' + zeileBis + ')');
  /* Hier und nicht erst am Ende herausschneiden: alle nachfolgenden Positionen verschieben sich,
     deshalb wird nach jeder Entfernung neu gesucht. */
  text = text.slice(0, start) + text.slice(endeZeile + 1);
  }
}

/* ── 2) Einzelne Zeilen mit exakter Zeichenkette ── */
const EINZELZEILEN = [
  'if (BuildConfig.DEBUG && uiProbeRequested) probeUiAfterLoad();',
  'uiProbeRequested = getIntent() != null && getIntent().getBooleanExtra("probe", false);',
  'chatProbeRequested = getIntent() != null && getIntent().getBooleanExtra("probechat", false);',
  'private boolean uiProbeRequested = false;',
  'private boolean chatProbeRequested = false;',
  /* Die drei Aufruf-Zeilen in onPageFinished: Einzeiler OHNE Blockklammer, deshalb hier und nicht
     ueber die Block-Suche unten. Der Trockenlauf hat das gezeigt ("Keine Blockklammer fuer qrprobe").
     Ohne diese Zeilen blieben Verweise auf die entfernten Methoden stehen -> Compile-Fehler. */
  'if (BuildConfig.DEBUG && getIntent() != null && getIntent().getBooleanExtra("qrprobe", false)) probeQrAfterLoad();',
  'if (BuildConfig.DEBUG && getIntent() != null && getIntent().getBooleanExtra("camprobe", false)) probeCamAfterLoad();',
];

/* Die erklaerenden adb-Zeilen direkt ueber den Aufrufen mit entfernen, sonst bleiben
   Befehls-Tipps fuer Sonden stehen, die es nicht mehr gibt. */
const KOMMENTARZEILEN = [
  '// sehen. Deshalb nur anfordern mit:',
  '//   adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez probe true',
  '// Reiner Nachweis fuer den eingebauten QR-Decoder, ohne die Oberflaeche anzufassen:',
  '//   adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez qrprobe true',
  '// Misst die Kamera-Kette der WebView (getUserMedia, play(), Bildgroesse):',
  '//   adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez camprobe true',
];
for (const zeile of EINZELZEILEN) {
  let suchIndex;
  while ((suchIndex = text.indexOf(zeile)) >= 0) {
    const anfang = zeilenanfangVon(text, suchIndex);
    const ende = zeilenendeNach(text, suchIndex);
    markiere(anfang, ende + 1, 'Zeile: ' + zeile.slice(0, 48));
    text = text.slice(0, anfang) + text.slice(ende + 1);
  }
}

/* Kommentarzeilen ebenfalls als exakte Zeile entfernen (nach den Aufrufen, damit die
   zugehoerigen Code-Zeilen zuerst wegfallen). */
for (const zeile of KOMMENTARZEILEN) {
  let suchIndex;
  while ((suchIndex = text.indexOf(zeile)) >= 0) {
    const anfang = zeilenanfangVon(text, suchIndex);
    const ende = zeilenendeNach(text, suchIndex);
    markiere(anfang, ende + 1, 'Kommentar: ' + zeile.slice(0, 46));
    text = text.slice(0, anfang) + text.slice(ende + 1);
  }
}

/* ── 3) if-Blaecke der Intent-Sonden, die NICHT in den Methoden oben liegen ── */
const SONDEN_FLAG = ['smblesen'];
{
  const maske = codeMaske(text);
  for (const flag of SONDEN_FLAG) {
    const marker = 'getBooleanExtra("' + flag + '", false))';
    let i;
    while ((i = text.indexOf(marker)) >= 0) {
      if (!maske[i]) break;                       // nur echten Code betrachten
      const anfang = zeilenanfangVon(text, i);
      const klammer = text.indexOf('{', i + marker.length);
      if (klammer < 0 || klammer - i > 400) { console.log('Keine Blockklammer fuer ' + flag); break; }
      const ende = blockEnde(text, maske, klammer);
      if (ende < 0) { console.log('Blockende unbestimmt fuer ' + flag); break; }
      // zugehoerigen javadoc/Kommentar davor mitnehmen
      let start = anfang;
      const davor = text.slice(0, start).replace(/[ \t]*\n[ \t]*$/, '\n');
      const docEnde = davor.lastIndexOf('*/');
      if (docEnde > 0 && zeilenanfangVon(davor, docEnde) > start - 4000) {
        const such = davor.slice(0, zeilenendeNach(davor, docEnde) + 1);
        const docAnfang = Math.max(such.lastIndexOf('/*'), such.lastIndexOf('// '));
        if (docAnfang >= 0) start = zeilenanfangVon(such, docAnfang);
      }
      const endeZeile = zeilenendeNach(text, ende);
      text = text.slice(0, start) + text.slice(endeZeile + 1);
      brocken.push({ von: start, bis: endeZeile, grund: 'Sondenblock --ez ' + flag });
    }
  }
}

/* ── Ergebnis ── */
console.log('Entfernte Bloecke: ' + brocken.length);
for (const b of brocken) console.log('  - ' + b.grund);
if (dry) { console.log('\nTrockenlauf – nichts geschrieben.'); process.exit(0); }

fs.writeFileSync(ziel + '.mit-sonden', fs.readFileSync(ziel, 'utf8'), 'utf8');   // Ruecksicherung
fs.writeFileSync(ziel, text, 'utf8');
console.log('\nGeschrieben: ' + ziel + '\nRuecksicherung: ' + ziel + '.mit-sonden');
