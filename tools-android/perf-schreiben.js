/* perf-schreiben.js – prueft, ob Speichern auf dem Netzlaufwerk Y: zu den teuren
   Wiederholungs-Schleifen fuehrt. writeJsonAtomicNow (main.js) versucht das atomare Speichern
   bis zu 5 Mal und wartet dabei 80/160/240/320/400 ms - zusammen bis 1,2 s pro Vorgang. Wenn die
   Freigabe Dateien sperrt, stauen sich alle Speichervorgaenge (Schreib-Warteschlange pro Datei),
   und die Oberflaeche wartet auf die IPC-Antwort: genau das Gefuehl "Eingaben dauern".

   Schreibt nur in einen eigenen Testordner im Workspace und loescht ihn wieder.

   Aufruf: node tools-android\perf-schreiben.js [zielordner]      (aus LLM-Box\)  */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ziel = process.argv[2] || 'Y:\\MeinProjekt\\tmp-schreibtest';
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);

/* Genau so arbeitet die App: erst .tmp schreiben, dann umbenennen. */
async function atomic(file, data) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  const versuche = [];
  for (let i = 0; i < 5; i++) {
    const t = process.hrtime.bigint();
    try {
      await fsp.writeFile(tmp, data, 'utf8');
      await fsp.rename(tmp, file);
      versuche.push(`versuch ${i + 1}: ok in ${ms(t)} ms`);
      return { ok: true, versuche };
    } catch (e) {
      versuche.push(`versuch ${i + 1}: ${e.code || e.message} nach ${ms(t)} ms`);
      await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
  }
  return { ok: false, versuche };
}

(async () => {
  console.log('Ziel:', ziel);
  let t = process.hrtime.bigint();
  await fsp.mkdir(ziel, { recursive: true });
  console.log(`mkdir ${ms(t)} ms`);

  for (const kb of [2, 500, 13000]) {
    const data = 'x'.repeat(kb * 1024);
    t = process.hrtime.bigint();
    const r = await atomic(path.join(ziel, 'probe.json'), data);
    const gesamt = ms(t);
    console.log(`\n${kb} kB atomar: ${r.ok ? 'ok' : 'fehlgeschlagen'} - insgesamt ${gesamt} ms`);
    r.versuche.forEach((v) => console.log('   ' + v));
  }

  /* Und zur Kontrolle: derselbe Vorgang lokal im Projektordner. */
  const lokal = path.join(__dirname, 'tmp-schreibtest-lokal');
  await fsp.mkdir(lokal, { recursive: true });
  for (const kb of [500, 13000]) {
    const data = 'x'.repeat(kb * 1024);
    t = process.hrtime.bigint();
    const r = await atomic(path.join(lokal, 'probe.json'), data);
    console.log(`lokal ${kb} kB atomar: ${r.ok ? 'ok' : 'FEHLER'} - insgesamt ${ms(t)} ms`);
  }

  await fsp.rm(ziel, { recursive: true, force: true });
  await fsp.rm(lokal, { recursive: true, force: true });
  console.log('\nTestordner entfernt.');
})().catch((e) => { console.error('fehlgeschlagen:', e.message); process.exit(1); });
