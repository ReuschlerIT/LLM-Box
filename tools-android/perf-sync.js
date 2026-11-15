/* perf-sync.js – misst, was der Chat-Abgleich und ein Chat-Speichern auf dem gemeinsamen
   Ordner wirklich kosten. Der gemeinsame Ordner der Windows-App liegt auf Y: (=Netzlaufwerk
   \\192.0.2.10\daten), deshalb ist das hier kein lokaler Test, sondern die echte Last,
   unter der die Oberflaeche laut Nutzerbericht zogerlich wirkt.

   Aufruf: node tools-android\perf-sync.js [ordner]     (aus LLM-Box\)  */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const dir = process.argv[2] || 'Y:\\MeinProjekt\\LLM-Box-Chats';
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);

(async () => {
  console.log('Ordner:', dir);
  if (!fs.existsSync(dir)) { console.log('Ordner nicht erreichbar'); return; }

  const names = await fsp.readdir(dir);
  const metas = names.filter((f) => f.endsWith('.meta.json'));
  const chats = names.filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
  console.log(`Dateien: ${metas.length} Meta, ${chats.length} Chats`);

  /* 1) So arbeitet der Abgleich heute: Verzeichnis lesen + JEDE Meta-Datei oeffnen und lesen.
     Einzelne Dateien koennen gesperrt sein (EPERM), wenn die App gerade schreibt - das darf
     die Messung nicht abbrechen, sonst ist gar kein Wert zu bekommen (passierte 14.11.). */
  const safeRead = async (p) => { try { return await fsp.readFile(p, 'utf8'); } catch (e) { return 'ERR:' + e.code; } };
  let t = process.hrtime.bigint();
  const files = await fsp.readdir(dir);
  const all = await Promise.all(files.filter((f) => f.endsWith('.meta.json')).map((f) => safeRead(path.join(dir, f))));
  const blocked = all.filter((x) => typeof x === 'string' && x.startsWith('ERR:'));
  console.log(`Abgleich heute (readdir + ${metas.length} Meta lesen): ${ms(t)} ms` + (blocked.length ? `  (${blocked.length} Meta gesperrt: ${[...new Set(blocked)].join(',')})` : ''));

  /* 2) Gleicher Abgleich, aber nur mit Stat: merkt Aenderungen ohne Dateiinhalt zu lesen */
  const safeStat = async (p) => { try { return await fsp.stat(p); } catch { return null; } };
  t = process.hrtime.bigint();
  const list = await fsp.readdir(dir, { withFileTypes: true });
  await Promise.all(list.filter((d) => d.name.endsWith('.meta.json')).map((d) => safeStat(path.join(dir, d.name))));
  console.log(`Abgleich mit Stat nur  (readdir + ${metas.length} Stat):   ${ms(t)} ms`);

  /* 3) Groester Chat: so teuer ist ein Laden und ein Speichern dieses Chats */
  let biggest = '', bigSize = 0;
  for (const c of chats) { try { const s = fs.statSync(path.join(dir, c)).size; if (s > bigSize) { bigSize = s; biggest = c; } } catch {} }
  console.log(`groester Chat: ${biggest} (${(bigSize / 1048576).toFixed(2)} MB)`);

  t = process.hrtime.bigint();
  const data = await safeRead(path.join(dir, biggest));
  console.log(`Chat lesen (${((data || '').length / 1048576).toFixed(1)} MB):            ${ms(t)} ms` + (typeof data === 'string' && data.startsWith('ERR:') ? '  (gesperrt: ' + data + ')' : ''));

  /* Speichern so wie writeJsonAtomic: erst in eine .tmp schreiben, dann umbenennen.
     Bewusst NICHT in den Chat-Ordner geschrieben (die App wuerde es als Chat halten),
     sondern in einen Testordner im eigenen Projektbereich - derselbe Netzlaufwerk-Pfad. */
  const probe = path.join(__dirname, 'tmp-perf');
  await fsp.mkdir(probe, { recursive: true });
  for (const size of [bigSize, 200 * 1024]) {
    const buf = Buffer.alloc(size, 97);
    t = process.hrtime.bigint();
    const tmp = path.join(probe, 'probe.tmp');
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, path.join(probe, 'probe.json'));
    const atomic = ms(t);
    t = process.hrtime.bigint();
    await fsp.writeFile(path.join(probe, 'direkt.json'), buf);
    console.log(`Speichern ${(size / 1048576).toFixed(1)} MB: atomar (tmp+rename) ${atomic} ms, direkt ${ms(t)} ms`);
  }
  await fsp.rm(probe, { recursive: true, force: true });

  /* 4) Wie oft laeuft der Abgleich bei den Stufen? (reine Rechnung, keine Messung) */
  for (const step of [2000, 5000, 30000, 60000]) {
    console.log(`Stufe ${step / 1000}s: ${Math.round(3600000 / step)} Ordner-Durchlaeufe pro Stunde`);
  }
})().catch((e) => { console.error('Messung fehlgeschlagen:', e.message); process.exit(1); });
