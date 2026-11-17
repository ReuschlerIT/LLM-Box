/* zeige-gitliste.js – wertet das Ergebnis von "git add -A --dry-run" aus: wie viele Dateien pro
   Oberordner ins Repository kamen, wie gross sie sind und ob etwas Unerwartetes dabei ist.
   Aufruf: node tools-android\zeige-gitliste.js <pfad-zur-dryrun-datei> [wurzelordner]         */
'use strict';
const fs = require('fs');
const path = require('path');

const datei = process.argv[2];
const wurzel = process.argv[3] || 'C:\\LLM-Box';
const zeilen = fs.readFileSync(datei, 'utf8').split(/\r?\n/).filter(Boolean)
  .map((z) => z.replace(/^add '/, '').replace(/'$/, ''));

const gruppen = new Map();
let gesamt = 0;
for (const rel of zeilen) {
  const top = rel.includes('/') ? rel.split('/')[0] : '(Wurzel)';
  let groesse = 0;
  try { groesse = fs.statSync(path.join(wurzel, rel)).size; } catch {}
  gesamt += groesse;
  const g = gruppen.get(top) || { anzahl: 0, byte: 0, beispiele: [] };
  g.anzahl++; g.byte += groesse;
  if (g.beispiele.length < 4) g.beispiele.push(rel);
  gruppen.set(top, g);
}

console.log('Dateien gesamt: ' + zeilen.length + '   Groesse: ' + Math.round(gesamt / 1024 / 1024) + ' MB\n');
for (const [name, g] of [...gruppen].sort((a, b) => b[1].byte - a[1].byte)) {
  console.log(String(g.anzahl).padStart(4) + ' Dateien  ' + String(Math.round(g.byte / 1024)).padStart(8) + ' KB  ' + name);
}

/* Warnungen: was NICHT ins Repo gehoert. Bewusst am Pfadanfang bzw. als Ordner-Segment, sonst
   treffen "android/build.gradle" und "llm-box/build/icon.png" (beide gewollt: Quelltext und
   Build-Symbole) als Fehlalarm. */
const VERBOTEN = ['node_modules', '.gradle/', 'app_build', '/dist/', '/out/', 'settings.json', 'smb.json', 'sync.json', '.env', '/chats/'];
const fehl = zeilen.filter((r) => VERBOTEN.some((v) => r.includes(v)));
console.log('\nUnerwuenschte Dateien in der Liste: ' + (fehl.length ? fehl.join(', ') : 'keine'));
