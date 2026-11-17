/* zeige-restformen.js – listet Zeilen mit grossem Laufwerksbuchstaben Z in Textdateien auf,
   damit die exakten Ersetzungsformen bestimmt werden koennen (ohne PowerShell-Escaping-Probleme).
   Aufruf: node tools-android\zeige-restformen.js <ordner> [suchbegriff]                    */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const begriff = process.argv[3] || 'Z';
const UEBER = new Set(['node_modules', '.git', 'app_build', 'build', 'dist', 'out', 'vendor', 'download']);
const END = new Set(['.js', '.json', '.md', '.txt', '.java', '.xml', '.gradle', '.css', '.html', '.ps1',
  '.cmd', '.bat', '.properties', '.yml', '.yaml', '.ts', '.svg', '.ini']);

let n = 0;
function lauf(ordner) {
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    const voll = path.join(ordner, e.name);
    if (e.isDirectory()) { if (!UEBER.has(e.name)) lauf(voll); continue; }
    if (!END.has(path.extname(e.name).toLowerCase())) continue;
    let text; try { text = fs.readFileSync(voll, 'utf8'); } catch { continue; }
    text.split(/\r?\n/).forEach((zeile, i) => {
      if (!zeile.includes(begriff)) return;
      n++;
      console.log(path.relative(ziel, voll) + ':' + (i + 1) + ' | ' + zeile.trim().slice(0, 130));
    });
  }
}
lauf(ziel);
console.log('--- Treffer: ' + n);
