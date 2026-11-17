/* pruefe-readme-links.js – prueft, ob alle in einer README genannten Dateien und Bilder im Repo
   wirklich vorhanden sind. Anlass: die Haupt-README verweist auf "docs/screenshots/…", diese Ordner
   liegen aber eine Ebene tiefer in llm-box\docs\ – ohne Korrektur waeren auf GitHub samtliche
   Screenshots und der Handbuch-Link ins Leere gelaufen.

   Aufruf: node tools-android\pruefe-readme-links.js <readme-datei> [basisordner]              */
'use strict';
const fs = require('fs');
const path = require('path');

const readme = process.argv[2];
const basis = process.argv[3] || path.dirname(path.resolve(readme));
if (!readme || !fs.existsSync(readme)) { console.log('usage: <readme-datei> [basisordner]'); process.exit(1); }

const text = fs.readFileSync(readme, 'utf8');
const basisAbs = path.resolve(basis);
const funde = new Set();

/* Bilder in HTML-Tags und Markdown-Links. */
for (const m of text.matchAll(/<img[^>]+src="([^"]+)"/g)) funde.add(m[1]);
for (const m of text.matchAll(/\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g)) funde.add(m[2]);

let ok = 0, kaputt = [];
for (const rel of [...funde].sort()) {
  if (/^https?:/.test(rel) || rel.startsWith('#')) continue;
  const p = path.resolve(basisAbs, rel.split('#')[0]);
  if (fs.existsSync(p)) { ok++; console.log('  OK      ' + rel); }
  else kaputt.push(rel);
}
console.log('\nexistieren: ' + ok + '   kaputt: ' + kaputt.length);
for (const k of kaputt) console.log('  KAPUTT  ' + k + '   (erwartet unter ' + path.relative(basisAbs, path.resolve(basisAbs, k)) + ')');

/* Code-Rueckfragen wie `download/…` oder `build-android.ps1`: nur melden, wenn sie eindeutig wie
   ein Pfad aussehen und nirgends im Repo liegen. */
const pfade = new Set();
for (const m of text.matchAll(/`([A-Za-z0-9_.\-\/]+\.(?:ps1|bat|md|js|json|exe|apk))`/g)) pfade.add(m[1]);
let fehlt = [];
function hat(rel) { try { fs.statSync(path.resolve(basisAbs, rel)); return true; } catch { return false; } }
for (const p of pfade) if (!hat(p)) fehlt.push(p);
console.log('genannte Dateien, die hier nicht liegen: ' + (fehlt.length ? fehlt.join(', ') : 'keine'));

process.exitCode = kaputt.length ? 2 : 0;
