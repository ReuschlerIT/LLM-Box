/* perf-render.js – misst, was ein einzelner Chat im RENDERER kostet: JSON.stringify (serialisiert
   den Chat fuer IPC zurueck in den Hauptprozess) und das Anlegen der Nachrichten-Struktur.
   Der groesste Chat hat 13 MB und 3356 Nachrichten; gespeichert wird entprellt nach jeder Aenderung,
   bei jedem KI-Schritt und alle 45 s (app.js:38, app.js:1577). Diese Arbeiten laufen im
   Renderer-Thread - also genau dort, wo auch die Tastatureingabe verarbeitet wird.

   Aufruf: node tools-android\perf-render.js [ordner]      (aus LLM-Box\)  */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const dir = process.argv[2] || 'Y:\\MeinProjekt\\LLM-Box-Chats';
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);

(async () => {
  const names = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
  const sizes = names.map((n) => ({ n, s: fs.statSync(path.join(dir, n)).size })).sort((a, b) => b.s - a.s);

  for (const { n, s } of sizes.slice(0, 4)) {
    const txt = await fsp.readFile(path.join(dir, n), 'utf8');
    let t = process.hrtime.bigint();
    const chat = JSON.parse(txt);
    const parseMs = ms(t);

    /* So teuer ist das Zurueckschicken durch IPC: Electron serialisiert die Objekte. */
    t = process.hrtime.bigint();
    const back = JSON.stringify(chat);
    const stringifyMs = ms(t);

    /* chatSig() (app.js:535) laeuft pro Sync-Meldung und prueft nur die letzte Nachricht - leicht. */
    t = process.hrtime.bigint();
    const l = chat.messages[chat.messages.length - 1];
    void ((chat.messages.length) + ':' + String(l && l.content || '').length);
    const sigMs = ms(t);

    /* So viele DOM-Knoten muesste renderMessages() anlegen (grob: pro Nachricht ein Container
       plus mehrere Kinder). */
    let toolCalls = 0, attach = 0;
    for (const m of chat.messages) { toolCalls += (m.toolCalls || []).length; attach += (m.attachments || []).length; }

    console.log(`${n} (${(s / 1048576).toFixed(2)} MB)`);
    console.log(`   parse        ${String(parseMs).padStart(5)} ms`);
    console.log(`   stringify    ${String(stringifyMs).padStart(5)} ms   <- blockiert den Renderer-Thread bei jedem Speichern`);
    console.log(`   chatSig      ${String(sigMs).padStart(5)} ms`);
    console.log(`   Nachrichten  ${chat.messages.length}, Werkzeug-Aufrufe ${toolCalls}, Anh\u00e4nge ${attach}`);

    /* Wie teuer waere es, den Chat bei JEDEM Tastendruck zu serialisieren (falls ein Handler das
       tut)? Zeigt die Groessenordnung, warum Tippen sich zae anfuehlen kann. */
    t = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) JSON.stringify(chat);
    console.log(`   5x stringify ${String(ms(t)).padStart(5)} ms\n`);
  }
})().catch((e) => { console.error('fehlgeschlagen:', e.message); process.exit(1); });
