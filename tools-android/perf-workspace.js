/* perf-workspace.js – misst, was der Workspace-Ordner der Windows-App kostet. Der Nutzer hat dort
   D:\MeinProjekt als Workspace gewaehlt; das ist ein Netzlaufwerk (net use: Y: =
   \\192.0.2.10\daten). Jedes Datei-Werkzeug der KI und jeder Aufbau des Workspace-Panels
   (renderFilePanel, app.js:2141) liest dort Verzeichnisse ueber SMB - das ist ein ganz anderer
   Kostenrahmen als ein lokaler Ordner.

   Reines Lesen, es wird nichts veraendert.

   Aufruf: node tools-android\perf-workspace.js [ordner]      (aus LLM-Box\)  */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const root = process.argv[2] || 'Y:\\MeinProjekt';
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);
const IGNORE = ['node_modules', '.git', '.venv', '__pycache__', 'dist', 'build', '.next', '.idea', '.vscode'];

(async () => {
  console.log('Workspace:', root);

  let t = process.hrtime.bigint();
  const top = await fsp.readdir(root, { withFileTypes: true });
  console.log(`Top-Verzeichnis lesen      : ${ms(t)} ms   (${top.length} Eintraege)`);

  /* Genau das tut renderFilePanel(): ein Verzeichnis fuellen und nach Unterordnern fragen. */
  t = process.hrtime.bigint();
  const stats = await Promise.all(top.map((d) => fsp.stat(path.join(root, d.name)).catch(() => null)));
  console.log(`+ Stat fuer alle Eintraege : ${ms(t)} ms`);

  /* Wie teuer ist ein rekursives Suchen (ws.tool search_text / list_files mit maxFiles=1000)? */
  let count = 0, dirs = 0, skipped = 0;
  t = process.hrtime.bigint();
  const walk = async (dir, tiefe) => {
    if (count > 4000 || tiefe > 4) return;
    let items;
    try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (IGNORE.includes(it.name)) { skipped++; continue; }
      if (it.isDirectory()) { dirs++; await walk(path.join(dir, it.name), tiefe + 1); }
      else count++;
    }
  };
  await walk(root, 0);
  const walkMs = ms(t);
  console.log(`rekursiv (Tiefe 4)         : ${walkMs} ms   (${count} Dateien, ${dirs} Ordner, ${skipped} ignoriert)`);

  /* Zum Vergleich: derselbe Vorgang lokal. */
  const lokal = path.join(__dirname, '..', 'llm-box', 'renderer');
  t = process.hrtime.bigint();
  let lc = 0;
  const walkLokal = async (dir) => {
    let items; try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) { if (it.isDirectory()) await walkLokal(path.join(dir, it.name)); else lc++; }
  };
  await walkLokal(lokal);
  console.log(`Vergleich lokal (${path.relative(process.cwd(), lokal)}): ${ms(t)} ms   (${lc} Dateien)`);

  /* Einzelner Ordner: so teuer ist EIN Klick im Workspace-Panel. */
  const sub = top.find((d) => d.isDirectory() && !IGNORE.includes(d.name));
  if (sub) {
    t = process.hrtime.bigint();
    const inner = await fsp.readdir(path.join(root, sub.name), { withFileTypes: true });
    console.log(`ein Unterordner oeffnen    : ${ms(t)} ms   (${inner.length} Eintraege, z. B. ${sub.name})`);
  }

  /* Der Chat-Ordner liegt im selben Laufwerk: wie teuer ist das Verzeichnis-Zaehlen dort pro
     Abgleich-Lauf (Stufe "Echtzeit" = alle 2 s)? */
  t = process.hrtime.bigint();
  await fsp.readdir(path.join(root, 'LLM-Box-Chats'));
  console.log(`Chat-Ordner readdir        : ${ms(t)} ms`);

  /* Wie viele Ordner-Durchlaeufe pro Stunde bei den Stufen? */
  for (const step of [2000, 5000, 30000]) {
    console.log(`   Stufe ${step / 1000}s: ${Math.round(3600000 / step)} Ordner-Durchlaeufe pro Stunde`);
  }
})().catch((e) => { console.error('fehlgeschlagen:', e.message); process.exit(1); });
