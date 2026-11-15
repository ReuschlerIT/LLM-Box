/* flattern-nachweis.js – beweist die Hauptursache der Windows-Bremse und den Fix.

   Der Chat-Abgleich liest in jedem Durchlauf alle .meta.json des gemeinsamen Ordners. Auf einer
   Netzfreigabe koennen Dateien in dem Moment gesperrt sein, in dem wir lesen (EPERM). Die alte
   Logik warf so einen Fehler weg: der Chat fehlte in dieser Runde, galt als GELoSCHT und in der
   naechsten Runde wieder als GEANDERT. Jede dieser Meldungen baut in der Oberflaeche Chatliste
   und Nachrichtenliste neu auf - mitten in der Tastatureingabe.

   Dieses Skript laeuft NUR LESEND (schreibt nichts in den Chat-Ordner) und zaehlt fuer beide
   Logiken, wie oft ein Chat als geloescht/geaendert gelten wuerde.

   Aufruf: node tools-android\flattern-nachweis.js [ordner] [durchlaeufe]     (aus LLM-Box\)  */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const dir = process.argv[2] || 'Y:\\MeinProjekt\\LLM-Box-Chats';
const RUNDEN = +(process.argv[3] || 40);
const SUFFIX = '.meta.json';

(async () => {
  console.log('Ordner:', dir);
  if (!fs.existsSync(dir)) { console.log('nicht erreichbar'); return; }

  const cache = new Map();          // neue Logik: zuletzt erfolgreich gelesene Meta
  /* Beide Varianten brauchen IHREN EIGENEN Zustand. Ein gemeinsames seen (so war es zuerst)
   haette den Vergleich wertlos gemacht: die erste Variante haette den Stand der zweiten
   verdeckt und umgekehrt. */
  const seenAlt = new Map();
  const seenNeu = new Map();
  let baseline = false;
  const alt = { geloescht: 0, geaendert: 0, meldungen: 0 };
  const neu = { geloescht: 0, geaendert: 0, meldungen: 0, gesperrt: 0 };

  for (let r = 1; r <= RUNDEN; r++) {
    let files;
    try { files = await fsp.readdir(dir); } catch (e) { console.log('Ordner nicht lesbar:', e.code); break; }
    const names = files.filter((f) => f.endsWith(SUFFIX));

    /* Lesen und Fehler einzeln zaehlen - das ist der Unterschied zur alten Fassung, die jeden
       Fehler stillschweigend zu "fehlt" machte. */
    const gelesen = await Promise.all(names.map(async (f) => {
      try { return JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')); }
      catch (e) { return { __fehler: e.code || '' }; }
    }));

    const metasAlt = [];            // alte Logik: Fehler -> Datei gilt als nicht vorhanden
    const metasNeu = [];
    const blockiert = new Set();
    names.forEach((f, i) => {
      const m = gelesen[i];
      const id = f.slice(0, -SUFFIX.length);
      if (m && m.id) { cache.set(id, m); metasAlt.push(m); metasNeu.push(m); return; }
      if (!m || m.__fehler === 'ENOENT') return;         // echt weg
      neu.gesperrt++;
      blockiert.add(id);
      const altM = cache.get(id);
      if (altM) metasNeu.push(altM);                     // neue Logik: bekannter Stand bleibt nutzbar
    });

    for (const [name, z, metas, seen] of [['ALT', alt, metasAlt, seenAlt], ['NEU', neu, metasNeu, seenNeu]]) {
      const ids = new Set();
      let changed = 0, removed = 0;
      if (!baseline) {
        metas.forEach((m) => seen.set(m.id, m.rev || 0));
      } else {
        for (const m of metas) {
          ids.add(m.id);
          // Fremdgeraet wird hier bewusst immer angenommen: so zeigt sich der guenstigste Fall
          // fuer die alte Logik - jede Sperre loest dann eine Meldung aus.
          if (seen.get(m.id) !== (m.rev || 0)) changed++;
          seen.set(m.id, m.rev || 0);
        }
        const removedIds = [...seen.keys()].filter((id) => !ids.has(id));
        z.geloescht += removedIds.length;
        z.geaendert += changed;
        if (changed || removedIds.length) z.meldungen++;
        removedIds.forEach((id) => seen.delete(id));
      }
    }
    baseline = true;
    await new Promise((r2) => setTimeout(r2, 1000));   // echter Rhythmus der Echtzeit-Stufe
  }

  console.log(`\n${RUNDEN} Durchlaeufe im 1-Sekunden-Takt (wie die Stufe "Echtzeit")`);
  console.log('gesperrte Meta-Leseversuche :', neu.gesperrt);
  console.log('ALTE Logik : als geloescht', alt.geloescht, '| als geaendert', alt.geaendert, '| Oberflaeche neu aufgebaut', alt.meldungen, 'x');
  console.log('NEUE Logik : als geloescht', neu.geloescht, '| als geaendert', neu.geaendert, '| Oberflaeche neu aufgebaut', neu.meldungen, 'x');
})().catch((e) => { console.error('fehlgeschlagen:', e.message); process.exit(1); });
