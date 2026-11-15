/* perf-chat.js – misst, was ein einzelner Chat in der Oberflaeche kostet: Lesen vom Netzlaufwerk,
   JSON.parse (blockiert den Renderer-Thread), Groesse und Anzahl der Nachrichten. Der Nutzer
   berichtet Zogern beim Texteingeben und beim Uebergeben an die KI; die Chats liegen auf Y:
   (Netzfreigabe) und einer ist 12,7 MB gross - das prueft hier, ob genau daran alles haengt.

   Aufruf: node tools-android\perf-chat.js [ordner]      (aus LLM-Box\)   */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const dir = process.argv[2] || 'Y:\\MeinProjekt\\LLM-Box-Chats';
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);

(async () => {
  const names = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
  console.log('Ordner:', dir, '| Chats:', names.length);
  const rows = [];
  for (const n of names) {
    const p = path.join(dir, n);
    let t = process.hrtime.bigint();
    const buf = await fsp.readFile(p);
    const lesMs = ms(t);
    t = process.hrtime.bigint();
    let c = null;
    try { c = JSON.parse(buf.toString('utf8')); } catch {}
    const parseMs = ms(t);
    const msgs = (c && c.messages) || [];
    rows.push({ n, mb: +(buf.length / 1048576).toFixed(2), lesMs, parseMs, msgs: msgs.length });
  }
  rows.sort((a, b) => b.mb - a.mb);
  console.log('\nChat                          MB   lesen(ms)  parse(ms)  Nachrichten');
  for (const r of rows.slice(0, 12)) {
    console.log(`${r.n.padEnd(28)} ${String(r.mb).padStart(5)}  ${String(r.lesMs).padStart(8)}  ${String(r.parseMs).padStart(9)}  ${String(r.msgs).padStart(11)}`);
  }

  /* Was die Oberflaeche pro Speichervorgang zurueck in den Renderer schickt: chats:list holt
     alle Meta-Dateien, und bei jeder Sync-Meldung laeuft das erneut. */
  let t = process.hrtime.bigint();
  const metas = (await fsp.readdir(dir)).filter((f) => f.endsWith('.meta.json'));
  const all = await Promise.all(metas.map((f) => fsp.readFile(path.join(dir, f), 'utf8').catch(() => '')));
  console.log(`\nchats:list (alle Meta lesen): ${ms(t)} ms, Antwort ${Math.round(all.reduce((s, x) => s + x.length, 0) / 1024)} kB`);

  /* So teuer ist das Speichern genau dieses Chats - passiert beim Tippen entprellt (500 ms)
     und bei jedem KI-Schritt. */
  const probe = path.join(__dirname, 'tmp-perf2');
  await fsp.mkdir(probe, { recursive: true });
  for (const r of rows.slice(0, 3)) {
    const buf = await fsp.readFile(path.join(dir, r.n));
    t = process.hrtime.bigint();
    await fsp.writeFile(path.join(probe, 'a.tmp'), buf);
    await fsp.rename(path.join(probe, 'a.tmp'), path.join(probe, 'a.json'));
    console.log(`Speichern ${r.n} (${r.mb} MB): atomar ${ms(t)} ms`);
  }
  await fsp.rm(probe, { recursive: true, force: true });
})().catch((e) => { console.error('fehlgeschlagen:', e.message); process.exit(1); });
