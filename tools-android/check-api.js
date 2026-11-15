/* check-api.js – prueft, dass die portierte Bridge jede api-Funktion der Oberflaeche liefert.
   Dazu werden alle api-Zugriffe in den Renderer-Dateien eingesammelt und mit dem verglichen,
   was native-main.js tatsaechlich in window.api schreibt (per Laufzeit-Inspektion).
   Aufruf: node tools-android\check-api.js     (aus LLM-Box\)  */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEBAPP = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'webapp');

/* 1) Alle api-Zugriffe in der Oberflaeche finden */
const used = new Map();          // "chats.save" -> [Fundstellen]
const jsDir = path.join(WEBAPP, 'js');
for (const f of fs.readdirSync(jsDir)) {
  if (!f.endsWith('.js') || f === 'native-main.js' || f === 'node-shim.js' || f === 'docs.js') continue;
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8').split('\n');
  src.forEach((line, i) => {
    // api.<pfad> oder api().<pfad> (llm.js nutzt eine api()-Hilfsfunktion)
    // api.<...> oder api().<...>, aber nicht foo.api.<...> und nicht URL-Reste wie api.openai.com
    for (const m of line.matchAll(/(?<![.\w$/])api(?:\(\))?\s*\.([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)/g)) {
      const key = m[1];
      if (!used.has(key)) used.set(key, []);
      used.get(key).push(`${f}:${i + 1}`);
    }
  });
}

/* 2) Bridge laden und liefern lassen */
global.window = global;
window.matchMedia = () => ({ matches: false, addEventListener() {} });
const noop = (name) => () => { throw new Error('Brueckenaufruf im Test nicht erlaubt: ' + name); };
window.Native = {
  appInfo: () => JSON.stringify({ dataDir: '/data', workspaceRoot: '/ws' }),
  fsStat: noop('fsStat'), fsReadB64: noop('fsReadB64'), fsWrite: noop('fsWrite'),
  fsList: noop('fsList'), fsMkdirs: noop('fsMkdirs'), fsRemove: noop('fsRemove'),
  fsRename: noop('fsRename'), httpFetch: () => '{"ok":true}', httpStream: () => '{"ok":true}',
  abort: () => '{}', openExternal: () => '', pickFiles: () => '', pickFolder: () => '',
  saveAs: () => '', desktopOnly: noop('desktopOnly'), fsExists: noop('fsExists'),
};

function load(rel) { vm.runInThisContext(fs.readFileSync(path.join(WEBAPP, rel), 'utf8'), { filename: rel }); }
load(path.join('vendor', 'webdeps.js'));
load(path.join('js', 'node-shim.js'));
load(path.join('js', 'docs.js'));
load(path.join('js', 'native-main.js'));

const api = window.api;

/* 3) Vergleichen */
function lookup(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (cur == null || !(part in cur)) return { ok: false, missingAt: part };
    cur = cur[part];
  }
  return { ok: true, value: cur };
}

let missing = [];
let extra = [];
for (const [key, where] of [...used.entries()].sort()) {
  const r = lookup(api, key);
  if (!r.ok) missing.push(`${key}  (benutzt in ${where.slice(0, 3).join(', ')})  fehlt ab: ${r.missingAt}`);
}

// Umgekehrt: was bietet die Bridge, das die Oberflaeche nie anfasst?
const provided = new Set();
(function walk(obj, prefix) {
  for (const k of Object.keys(obj)) {
    const p = prefix ? prefix + '.' + k : k;
    if (typeof obj[k] === 'function') provided.add(p);
    else if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) walk(obj[k], p);
  }
})(api, '');

for (const p of [...provided].sort()) if (!used.has(p)) extra.push(p);

console.log('Benutzte api-Aufrufe in der Oberflaeche: ' + used.size);
console.log('Gelieferte api-Funktionen der Bridge   : ' + provided.size);
if (missing.length) {
  console.log('\nFEHLENDE FUNKTIONEN (' + missing.length + '):');
  for (const m of missing) console.log('  - ' + m);
} else {
  console.log('\nAlle benutzten api-Aufrufe sind implementiert.');
}
if (extra.length) {
  console.log('\nvon der Bridge angeboten, aber nie benutzt (' + extra.length + '):');
  for (const e of extra) console.log('  . ' + e);
}
process.exit(missing.length ? 1 : 0);
