/* scan-git-historie.js – durchsucht ALLE Commits eines Git-Repositories nach persoenlichen Werten,
   auch nach solchen, die in einer Aelteren Version veroeffentlicht und spaeter geaendert wurden.

   Warum noetig: Ein normaler Datei-Scan sieht nur den aktuellen Arbeitsstand. In einem Git-Repo
   stecken aber alle frueheren Staende mit – komprimiert in .git/objects, also fuer einen
   Buffer-Scan unsichtbar. Genau das war zu pruefen, bevor neues hochgeladen wird: enthaelt die
   bereits OEFFENTLICHE Historie personengebundene Werte (Pfade, IPs, Freigabenamen)?

   Vorgehen: pro Commit wird "git grep -F" ueber den Stand dieses Commits laufen lassen. Fixed-String
   statt Regex, damit Punkte in IPs keine Joker sind.

   Aufruf: node tools-android\scan-git-historie.js <repo-ordner> [begriff …]                   */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const repo = process.argv[2];
if (!repo) { console.log('usage: node tools-android\\scan-git-historie.js <repo-ordner> [begriff …]'); process.exit(1); }

const BEGRIFFE = process.argv.slice(3).length ? process.argv.slice(3) : [
  'MeinProjekt', 'Y:\\', '192.0.2.', '\\daten', 'C:\\Users\\Administrator', 'beispiel-passwort',
];

function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', '-C', path.resolve(repo), ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const commits = git(['rev-list', '--all']).split(/\r?\n/).filter(Boolean);
console.log('Commits in der Historie: ' + commits.length);
console.log('Suchbegriffe: ' + BEGRIFFE.join(', ') + '\n');

let funde = 0;
for (const c of commits) {
  const kurz = git(['rev-parse', '--short', c]).trim();
  const datum = git(['log', '-1', '--format=%ad', '--date=short', c]).trim();
  for (const begriff of BEGRIFFE) {
    let treffer = '';
    try {
      treffer = git(['grep', '-l', '-F', '-e', begriff, c, '--']);
    } catch (e) {
      /* git grep liefert Exit 1, wenn nichts gefunden wurde – das ist der Regelfall. */
      if (e.status !== 1 && e.status !== undefined) console.log('  Hinweis: git grep Exit ' + e.status + ' bei ' + kurz);
      continue;
    }
    const dateien = treffer.split(/\r?\n/).filter(Boolean);
    if (!dateien.length) continue;
    funde++;
    console.log('FUND  ' + kurz + ' (' + datum + ')  "' + begriff + '" in ' + dateien.length + ' Datei(en):');
    for (const d of dateien.slice(0, 6)) {
      let zeilen = [];
      try { zeilen = git(['grep', '-n', '-F', '-e', begriff, c, '--', d]).split(/\r?\n/).filter(Boolean); } catch {}
      console.log('    ' + d.replace(c + ':', '') + (zeilen.length ? '  z. B.: ' + zeilen[0].slice(0, 120) : ''));
    }
  }
}

console.log('\nFundstellen gesamt: ' + funde);
process.exitCode = funde ? 2 : 0;
