/* perf-save.js – misst, was ein einzelner Speichervorgang des echten Chats kostet.
   Hintergrund: die App schreibt bei jedem Werkzeug-Ergebnis und alle 45 s den KOMPLETTEN
   Chat (13,9 MB). writeJsonAtomicNow (main.js:80) stringifyt synchron im Hauptprozess und
   schreibt dann .tmp + rename auf das Netzlaufwerk Y:. Der Renderer wartet auf die IPC-Antwort.

   Getrennt gemessen:
     1) JSON.stringify des ganzen Chat-Objekts   -> blockiert den Event-Loop (Main oder Renderer)
     2) atomares Schreiben auf Y:                 -> I/O, blockiert nicht
     3) Struktur-Klon (Structured Clone wie beim IPC) ueber structuredClone()

   Es wird nur in einen eigenen Testordner geschrieben; der echte Chat bleibt unveraendert.

   Aufruf: node tools-android\perf-save.js      (aus LLM-Box\)                     */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const CHAT_DIR = 'Y:\\MeinProjekt\\LLM-Box-Chats';
const TEST_DIR = 'Y:\\MeinProjekt\\tmp-save-test';
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);

async function atomic(file, data) {          // genau wie main.js:80-99
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, file);
}

(async () => {
  if (!fs.existsSync(CHAT_DIR)) { console.log('kein Chatordner:', CHAT_DIR); return; }
  const files = fs.readdirSync(CHAT_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
  const groessen = files.map((f) => ({ f, b: fs.statSync(path.join(CHAT_DIR, f)).size }))
    .sort((a, b) => b.b - a.b);

  await fsp.mkdir(TEST_DIR, { recursive: true });
  for (const g of groessen.slice(0, 3)) {
    let t = process.hrtime.bigint();
    const chat = JSON.parse(fs.readFileSync(path.join(CHAT_DIR, g.f), 'utf8'));
    const lesen = ms(t);
    const anzahl = (chat.messages || []).length;

    t = process.hrtime.bigint();
    const json = JSON.stringify(chat);
    const stringify = ms(t);

    t = process.hrtime.bigint();
    try { structuredClone(chat); } catch (e) { console.log('  Klon nicht moeglich:', e.message); }
    const klon = ms(t);

    t = process.hrtime.bigint();
    await atomic(path.join(TEST_DIR, 'probe.json'), json);
    const schreiben = ms(t);

    // Wie oft wurde dieser Chat beim letzten Lauf gespeichert? (Meta-Revision = Zahl der Saves)
    let rev = null;
    try { rev = JSON.parse(fs.readFileSync(path.join(CHAT_DIR, g.f.replace(/\.json$/, '.meta.json')), 'utf8')).rev; } catch {}

    console.log(`\n${g.f}  ${(g.b / 1048576).toFixed(1)} MB, ${anzahl} Nachrichten`);
    console.log(`   lesen        ${lesen} ms`);
    console.log(`   stringify    ${stringify} ms   <- blockiert den Event-Loop (Hauptprozess)`);
    console.log(`   StructuredClone ${klon} ms      <- Kosten des IPC-Wegs Renderer -> Main`);
    console.log(`   atomar auf Y: ${schreiben} ms  <- I/O, laeuft async`);
    console.log(`   Summe pro Speichervorgang ~ ${stringify + klon + schreiben} ms | Meta-Revision (bisherige Saves): ${rev}`);
  }

  await fsp.rm(TEST_DIR, { recursive: true, force: true });
  console.log('\nTestordner entfernt, echter Chat unveraendert.');
})().catch((e) => { console.error('fehlgeschlagen:', e.message); process.exit(1); });
