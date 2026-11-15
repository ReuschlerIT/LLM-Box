/* sync-flattern-praxis.js – prueft am ECHTEN Chatordner, ob das Flattern weg ist.
   Hintergrund: Auf Y: sind dauerhaft 6 von 15 Meta-Dateien gesperrt (Zugriff verweigert).
   In 1.0.57 warf readJson() den Fehler weg, listMetas() filterte das Ergebnis raus -> der Chat
   fehlte in dieser Runde, pollChats() hielt ihn fuer GELoSCHT, eine Runde spaeter galt er wieder
   als GEANDERT -> chats:changed -> die Oberflaeche lud die 12-MB-Chatdatei neu und baute alles um.

   Dieses Skript liest den echten Ordner mit derselben Logik wie main.js (readdir + paralleles
   readFile; Fehler, die nicht ENOENT sind, gelten als GESPERRT) und faehrt mehrere Runden im
   eingestellten Takt. Es schreibt nichts.

   Aufruf: node tools-android\sync-flattern-praxis.js [runden] [takt-ms]     (aus LLM-Box\)    */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const CHAT_DIR = 'Y:\\MeinProjekt\\LLM-Box-Chats';
const runden = +(process.argv[2] || 6);
const takt = +(process.argv[3] || 2000);
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);

/* Genau so arbeitet listMetas() in der installierten main.js. */
async function listMetas(dir) {
  let names;
  try { names = await fsp.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return { metas: [], blockiert: [] }; return null; }
  const ids = names.filter((n) => n.endsWith('.meta.json')).map((n) => n.slice(0, -'.meta.json'.length));
  const blockiert = [];
  const erg = await Promise.all(ids.map(async (id) => {
    try { return JSON.parse(await fsp.readFile(path.join(dir, id + '.meta.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') blockiert.push(id); return null; }
  }));
  return { metas: erg.filter(Boolean), blockiert };
}

(async () => {
  if (!fs.existsSync(CHAT_DIR)) { console.log('kein Chatordner:', CHAT_DIR); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'LLM Box', 'sync.json'), 'utf8'));
  console.log(`Ordner: ${CHAT_DIR}`);
  console.log(`Abgleich-Geraet: ${cfg.deviceId}   Takt wie eingestellt: ${(cfg.everyMs || 2000)} ms (hier ${takt} ms)`);

  const seen = new Map();
  let basis = false, meldungen = 0, geloeschMeldungen = 0;

  for (let r = 1; r <= runden; r++) {
    const t = process.hrtime.bigint();
    const fund = await listMetas(CHAT_DIR);
    const dauer = ms(t);
    if (!fund) { console.log(`Runde ${r}: Ordner nicht lesbar (Netzlaufwerk getrennt?)`); continue; }

    let geaendert = [], entfernt = [];
    if (!basis) { fund.metas.forEach((m) => seen.set(m.id, m.rev || 0)); basis = true; }
    else {
      const ids = new Set();
      for (const m of fund.metas) {
        ids.add(m.id);
        if (seen.get(m.id) !== (m.rev || 0) && m.dev !== cfg.deviceId) geaendert.push(m.id);
        seen.set(m.id, m.rev || 0);
      }
      const block = new Set(fund.blockiert);
      entfernt = [...seen.keys()].filter((id) => !ids.has(id) && !block.has(id));
    }
    meldungen += geaendert.length; geloeschMeldungen += entfernt.length;

    console.log(`Runde ${r}: ${fund.metas.length} Chats sichtbar | gesperrte Meta ${fund.blockiert.length}` +
      ` | als GEANDERT gemeldet ${geaendert.length} | als GELOESCHT gemeldet ${entfernt.length} | Abgleich ${dauer} ms`);
    if (r < runden) await new Promise((r2) => setTimeout(r2, takt));
  }

  console.log(`\nErgebnis ueber ${runden} Runden: ${meldungen} Aenderungs- und ${geloeschMeldungen} Loeschmeldungen.`);
  console.log(meldungen === 0 && geloeschMeldungen === 0
    ? 'OK – kein Flattern. Die gesperrten Meta-Dateien fuehren zu keiner Neubeladung der Oberflaeche.'
    : 'AUFFAELLIG – es werden Aenderungen/Loeschungen gemeldet, obwohl niemand etwas geaendert hat.');
})().catch((e) => { console.error('fehlgeschlagen:', e.message); process.exit(1); });
