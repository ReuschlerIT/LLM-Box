/* test-sync.js – prueft die neu portierten Funktionen der Versionen 1.0.44–1.0.50:
     - gemeinsamer Chat-Ordner (sync.get / sync.setDir / sync.migrate)
     - Dateipaar <id>.json + <id>.meta.json statt index.json, Revision und Gerat
     - Konfliktbehandlung: gleichzeitige Aenderung eines anderen Rechners -> Kopie
     - ws.abortAll bricht eine laufende Textsuche ab
     - api.spellSet / api.onChatsChanged vorhanden
   Aufruf: node tools-android\test-sync.js     (aus LLM-Box\)  */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const WEBAPP = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'webapp');
let pass = 0, fail = 0;
function ok(n, c, e) { if (c) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FEHLER  ' + n + (e ? ' -> ' + e : '')); } }

/* ── Dateiumgebung wie in der App (asynchrone Bruecke) ─────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmbox-sync-'));
const toReal = (p) => path.join(tmp, String(p).replace(/^\/+/, '').replace(/\//g, path.sep));

global.window = global;
window.matchMedia = () => ({ matches: false, addEventListener() {} });

const Native = {
  appInfo: () => JSON.stringify({ version: 'test', dataDir: '/data', workspaceRoot: '/ws', deviceName: 'Test-Handy' }),
  fsStat: (p) => { try { const s = fs.statSync(toReal(p)); return JSON.stringify({ ok: true, size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }); } catch { return '{"ok":false,"error":"nicht gefunden"}'; } },
  fsExists: (p) => JSON.stringify({ ok: true, exists: fs.existsSync(toReal(p)) }),
  // __blockMeta bildet eine gesperrte Datei nach (EPERM auf der Netzfreigabe): die App bekommt
  // eine Fehlermeldung, die NICHT "nicht gefunden" heisst. So war es am 14.11. real: 6 von
  // 15 Meta-Dateien waren im laufenden Betrieb gesperrt.
  __blockMeta: '',
  fsReadB64: (p) => {
    const base = String(p).replace(/\\/g, '/').split('/').pop();
    if (Native.__blockMeta && base === Native.__blockMeta) return JSON.stringify({ ok: false, error: 'open failed: EACCES (Permission denied)' });
    try { return JSON.stringify({ ok: true, b64: fs.readFileSync(toReal(p)).toString('base64') }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
  },
  fsWrite: (p, b64, m) => { try { const f = toReal(p); if (m === 'true') fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b64 || '', 'base64')); return JSON.stringify({ ok: true, size: 1 }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsList: (p) => { try { const items = fs.readdirSync(toReal(p), { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory(), size: 10 })); return JSON.stringify({ ok: true, items }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsMkdirs: (p) => { try { fs.mkdirSync(toReal(p), { recursive: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  fsRemove: (p, r) => { try { fs.rmSync(toReal(p), { recursive: r === 'true', force: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  // __failRename bildet das Verhalten einer Windows-Freigabe nach, auf der das Umbenennen
  // vom Server abgelehnt wurde (der alte Fehler hinter "0 Chats kopiert").
  fsRename: (a, b) => { if (Native.__failRename) return JSON.stringify({ ok: false, error: 'STATUS_INVALID_PARAMETER' }); try { fs.renameSync(toReal(a), toReal(b)); return '{"ok":true}'; } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsCopy: (a, b) => { try { const t = toReal(b); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(toReal(a), t); return '{"ok":true}'; } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  httpFetch: () => '{"ok":true}', httpStream: () => '{"ok":true}', abort: () => '{"ok":true}',
  openExternal: () => '', pickFiles: () => '', pickFolder: () => '', saveAs: () => '',
};
require('./test-fs-mock')(Native, global);
window.Native = Native;

function load(rel) { vm.runInThisContext(fs.readFileSync(path.join(WEBAPP, rel), 'utf8'), { filename: rel }); }

(async () => {
  await new Promise((r) => setTimeout(r, 50));
  load('vendor/webdeps.js');
  load('js/node-shim.js');
  load('js/docs.js');
  load('js/native-main.js');
  const api = window.api;

  console.log('\nNeue api-Funktionen vorhanden …');
  ok('api.sync mit get/setDir/migrate', !!(api.sync && api.sync.get && api.sync.setDir && api.sync.migrate));
  ok('api.chats ohne index.json-Liste (Meta-Basis)', typeof api.chats.list === 'function');
  ok('api.ws.abortAll vorhanden', typeof api.ws.abortAll === 'function');
  ok('api.spellSet vorhanden', typeof api.spellSet === 'function');
  ok('api.onChatsChanged vorhanden', typeof api.onChatsChanged === 'function');

  console.log('\nGemeinsamer Chat-Ordner …');
  const sy0 = await api.sync.get();
  ok('sync.get liefert deviceId + localDir', !!sy0.deviceId && /\/data\/chats$/.test(sy0.localDir.replace(/\\/g, '/')), JSON.stringify(sy0));
  ok('ohne Auswahl: Chats liegen lokal', sy0.dir === '' && sy0.folder.replace(/\\/g, '/') === '/data/chats');

  // Chat lokal anlegen (vor dem Umzug)
  const chat = { id: 'chat1', title: 'Testchat', created: 1, updated: Date.now(), model: 'm', messages: [{ role: 'user', content: 'hallo' }] };
  const meta = { id: 'chat1', title: 'Testchat', created: 1, updated: Date.now(), model: 'm', tokens: 3 };
  const r1 = await api.chats.save(chat, meta);
  ok('Speichern ohne Konflikt', r1 && r1.ok && !r1.conflict, JSON.stringify(r1));
  ok('Chat-Datei geschrieben', fs.existsSync(path.join(toReal('/data/chats'), 'chat1.json')));
  ok('Meta-Datei geschrieben (statt index.json)', fs.existsSync(path.join(toReal('/data/chats'), 'chat1.meta.json')));
  const metaJson = JSON.parse(fs.readFileSync(path.join(toReal('/data/chats'), 'chat1.meta.json'), 'utf8'));
  ok('Meta traegt Revision und Gerat', metaJson.rev === 1 && metaJson.dev === sy0.deviceId && metaJson.devName === 'Test-Handy', JSON.stringify(metaJson));

  const listed = await api.chats.list();
  ok('Liste kommt aus den Meta-Dateien', listed.length === 1 && listed[0].title === 'Testchat' && listed[0].rev === 1);

  console.log('\nUmzug in einen gemeinsamen Ordner …');
  const share = '/share/nas';
  const setRes = await api.sync.setDir(share);
  ok('setDir legt Unterordner LLM-Box-Chats an', setRes.ok && setRes.folder.replace(/\\/g, '/') === '/share/nas/LLM-Box-Chats', JSON.stringify(setRes));
  const sy1 = await api.sync.get();
  ok('sync.get zeigt den gewaehlten Ordner', sy1.dir === share);

  /* Wer den Unterordner schon mit eingibt (z. B. den Pfad aus der Statuszeile zurueckkopiert),
     bekam sonst "LLM-Box-Chats\LLM-Box-Chats" – zwei getrennte Sammlungen ohne Abgleich. */
  const doppelt = await api.sync.setDir(share + '/LLM-Box-Chats');
  ok('setDir haengt LLM-Box-Chats nicht zweimal an',
      doppelt.ok && doppelt.folder.replace(/\\/g, '/') === share + '/LLM-Box-Chats', JSON.stringify(doppelt));

  const mig = await api.sync.migrate();
  ok('migrate kopiert lokale Chats', mig.ok && mig.copied === 1, JSON.stringify(mig));
  ok('kopierte Chat-Datei vorhanden', fs.existsSync(path.join(toReal('/share/nas/LLM-Box-Chats'), 'chat1.json')));
  const again = await api.sync.migrate();
  ok('migrate ueberschreibt Vorhandenes nicht', again.ok && again.copied === 0 && again.skipped === 1, JSON.stringify(again));

  /* Regression zum gemeldeten "0 Chats kopiert": jeder Fehler im Migrationslauf lief frueher
     in ein leeres catch. Jetzt kommt die Ursache zurueck, und es bleibt keine .tmp-Datei liegen. */
  const failDir = '/share/nas2';
  await api.sync.setDir(failDir);
  Native.__failRename = true;                       // so wie auf der Windows-Freigabe: rename schlägt fehl
  const migFail = await api.sync.migrate();
  Native.__failRename = false;
  ok('migrate meldet fehlgeschlagene Kopien', !!migFail.ok && Array.isArray(migFail.fehlgeschlagen)
      && migFail.fehlgeschlagen.length === 1 && !!migFail.fehlgeschlagen[0].error, JSON.stringify(migFail));
  const tmpRest = fs.existsSync(toReal(failDir))
      ? fs.readdirSync(path.join(toReal(failDir), 'LLM-Box-Chats')).filter((f) => /\.tmp$/.test(f)) : [];
  ok('keine .tmp-Reste nach fehlgeschlagenem Speichern', tmpRest.length === 0, JSON.stringify(tmpRest));
  await api.sync.setDir(share);                     // zurueck zum funktionierenden Ziel

  console.log('\nKonflikt durch anderen Rechner …');
  // Chat zuerst normal lesen/speichern -> Revision dieses Gerets ist bekannt
  await api.chats.load('chat1');
  const metaPath = path.join(toReal('/share/nas/LLM-Box-Chats'), 'chat1.meta.json');
  const other = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  other.rev = (other.rev || 0) + 5;
  other.dev = 'anderer-rechner';
  fs.writeFileSync(metaPath, JSON.stringify(other));

  const r2 = await api.chats.save({ ...chat, title: 'Testchat', messages: [...chat.messages, { role: 'assistant', content: 'antwort' }] }, meta);
  ok('Konflikt erkannt und nichts ueberschrieben', !!(r2 && r2.ok && r2.conflict), JSON.stringify(r2));
  ok('Konfliktkopie mit neuem Titel', r2.conflict && /\(Konflikt Test-Handy\)$/.test(r2.conflict.title), r2.conflict && r2.conflict.title);
  const stillOther = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  ok('Fremde Fassung unveraendert geblieben', stillOther.rev === other.rev && stillOther.dev === 'anderer-rechner');

  console.log('\nAbgleich-Rhythmus: wählbar von Echtzeit bis 30 Minuten …');
  const syR = await api.sync.get();
  ok('sync.get liefert everyMs (Standard 2000 ms)', syR.everyMs === 2000, JSON.stringify(syR));

  /* Bereichspruefung: zu kurze und zu lange Abstaende muessen abgelehnt werden, sonst
     laeuft der Abgleich entweder mit Sekundentakten gegen die Netzfreigabe oder gar nicht. */
  for (const bad of [10, 31 * 60 * 1000, 0, -5000, 'quatsch']) {
    const r = await api.sync.setEvery(bad);
    ok(`setEvery(${bad}) abgelehnt`, r && !r.ok && /Sekunden|Minuten/.test(r.error || ''), JSON.stringify(r));
  }
  const nachAbweisung = await api.sync.get();
  ok('abgewiesener Wert aendert nichts', nachAbweisung.everyMs === 2000, JSON.stringify(nachAbweisung));

  for (const gut of [1000, 30 * 60 * 1000]) {
    const r = await api.sync.setEvery(gut);
    ok(`setEvery(${gut}) erlaubt`, !!(r && r.ok && r.everyMs === gut), JSON.stringify(r));
  }
  /* Fuer den Rest des Tests die kuerzeste erlaubte Stufe: der fruehere Test wartete starr
     6000 ms auf den alten, fest verdrahteten 5-Sekunden-Tick. Nach der Umstellung waere das
     nur noch Warten ohne Aussage. Mit 1 s Takt prueft er wirklich mehrere Laeufe. */
  const st = await api.sync.setEvery(1000);
  ok('setEvery(1000) uebernommen', !!(st && st.ok && st.everyMs === 1000), JSON.stringify(st));
  const syncJson = JSON.parse(fs.readFileSync(path.join(toReal('/data'), 'sync.json'), 'utf8'));
  ok('everyMs bleibt in sync.json gespeichert', syncJson.everyMs === 1000, JSON.stringify(syncJson));

  /* Warten bis: gibt true, sobald die Bedingung erfuellt ist, sonst nach der Frist.
     Der alte Test wartete starr und bestand ggf., ohne etwas geprueft zu haben. */
  const waitFor = async (cond, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
    return !!cond();
  };

  /* setEvery setzt den Sync-Zustand zurueck (bewusst so). Der erste Abgleich danach legt nur
     die Ausgangsposition fest und meldet absichtlich nichts - die muss existieren, bevor eine
     fremde Aenderung erkannt werden kann. Deshalb hier zwei Ticks abwarten. */
  await new Promise((r) => setTimeout(r, 2500));

  console.log('\nAenderungserkennung: dauerhafter Abgleich meldet fremde Aenderungen …');
  await api.chats.list();               // Ausgangsstand (baseline) festlegen
  let got = null;
  api.onChatsChanged((m) => { got = m; });
  const before = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const foreign = { ...before, rev: (before.rev || 0) + 1, dev: 'anderer-rechner' };
  fs.writeFileSync(metaPath, JSON.stringify(foreign));   // so, als haette ein anderer Rechner gespeichert

  /* Der Abgleich laeuft jetzt im gewaehlten Rhythmus (hier 1 s) und zusaetzlich sofort, wenn
     die App zurueckkehrt (MainActivity.onResume stoesst window.__syncNow an). */
  ok('window.__syncNow vorhanden (sofortiger Abgleich nach App-Wechsel)', typeof window.__syncNow === 'function');
  await window.__syncNow();
  ok('Aenderung eines anderen Geraets wird gemeldet',
     await waitFor(() => got && (got.metas || []).some((m) => m.id === 'chat1'), 3000), JSON.stringify(got));

  /* Der zeitliche Abgleich muss ohne Zutun des Nutzers weiterlaufen (Hintergrund-Sync).
     Vorher: starr 6000 ms warten, weil der Tick fest auf 5 s verdrahtet war. Jetzt wird im
     1-Sekunden-Takt abgewartet, bis die Meldung wirklich da ist - das prueft den Timer,
     nicht nur die Wartezeit. */
  got = null;
  const f2 = { ...foreign, rev: foreign.rev + 1, dev: 'anderer-rechner' };
  fs.writeFileSync(metaPath, JSON.stringify(f2));
  ok('Hintergrund-Abgleich meldet ohne Zutun (Stufe 1 s)',
     await waitFor(() => got && (got.metas || []).some((m) => m.id === 'chat1'), 5000), JSON.stringify(got));

  // Eigene Aenderungen duerfen nie als fremde Meldung zurueckkommen
  got = null;
  await api.chats.load('chat1');
  const r3 = await api.chats.save({ id: 'chat1', title: 'eigener Titel', created: 1, updated: Date.now(), messages: [{ role: 'user', content: 'neu' }] }, { id: 'chat1', title: 'eigener Titel', created: 1, updated: Date.now() });
  ok('eigene Speicherung ohne Konflikt', r3 && r3.ok && !r3.conflict, JSON.stringify(r3));
  // Mehrere Takte der gewaehlten Stufe (1 s) abwarten, sonst waere es nur Warten ohne Aussage.
  await new Promise((r) => setTimeout(r, 2500));
  ok('eigene Aenderung loest keine Meldung aus', got === null || !(got.metas || []).some((m) => m.dev === sy1.deviceId), JSON.stringify(got));

  console.log('\nTempo-Wechsel wirkt sofort (selbst nachplanender Timer statt setInterval) …');
  /* Langsamste Stufe einstellen und danach eine fremde Aenderung schreiben: weil der naechste
     Abgleich erst in 30 Minuten geplant wird, darf innerhalb weniger Sekunden NICHTS gemeldet
     werden. Beim alten setInterval waere laengst ein Tick gekommen - der Nachweis gilt also nur
     fuer die neue Timer-Schleife. */
  const langsam = await api.sync.setEvery(30 * 60 * 1000);
  ok('setEvery(30 Minuten) uebernommen', !!(langsam && langsam.ok), JSON.stringify(langsam));
  await new Promise((r) => setTimeout(r, 800));
  got = null;
  const f3 = { ...f2, rev: f2.rev + 1, dev: 'anderer-rechner' };
  fs.writeFileSync(metaPath, JSON.stringify(f3));
  await new Promise((r) => setTimeout(r, 2500));
  ok('auf 30 Minuten gestellt: kein Abgleich nach wenigen Sekunden', got === null, JSON.stringify(got));

  /* Und zurueck auf Echtzeit: der naechste Takt kommt sofort. Der erste Abgleich nach einem
     Tempo-Wechsel legt bewusst nur die Ausgangsposition fest (resetSyncState), deshalb wird
     erst die Aenderung danach erwartet. */
  const schnell = await api.sync.setEvery(1000);
  ok('setEvery(1 s) uebernommen', !!(schnell && schnell.ok), JSON.stringify(schnell));
  await new Promise((r) => setTimeout(r, 1500));   // Ausgangsposition neu festlegen lassen
  got = null;
  const f4 = { ...f3, rev: f3.rev + 1, dev: 'anderer-rechner' };
  fs.writeFileSync(metaPath, JSON.stringify(f4));
  ok('nach Wechsel auf Echtzeit kommt die Meldung prompt',
     await waitFor(() => got && (got.metas || []).some((m) => m.id === 'chat1'), 3000), JSON.stringify(got));

  /* Regression (Fund am Gerat, 14.11.): schedulePoll() war asynchron und wartete vor dem
     setTimeout auf das Lesen der Einstellung. Zwei Aufrufe hintereinander liessen dabei die
     alte Kette weiterlaufen - es gab mehrere parallele Abgleich-Schleifen, und die neue Stufe
     galt nur fuer den ersten Lauf. Geprueft wird ueber die Zahl der Laeufe: bei 30 Minuten darf
     sie in mehreren Sekunden nicht weiterwachsen, bei 1 Sekunde sehr wohl. */
  const slowFirst = JSON.parse(window.__syncTicks()).anzahl;
  await api.sync.setEvery(30 * 60 * 1000);
  await new Promise((r) => setTimeout(r, 4000));
  const slowLater = JSON.parse(window.__syncTicks());
  ok('lange Stufe: keine weiteren Abgleich-Laeufe (nur eine Timer-Kette)',
     slowLater.anzahl === slowFirst, `vorher ${slowFirst}, nachher ${slowLater.anzahl}`);

  await api.sync.setEvery(1000);
  /* Zaehler fuer dieses Zeitfenster leeren: nach einer bewusst langen Pause (30 Minuten) ist
     der erste Abstand naturgemass gross - er duerfte nicht als Fehler zaehlen. */
  window.__syncTicksReset();
  await new Promise((r) => setTimeout(r, 3500));
  const fast = JSON.parse(window.__syncTicks());
  ok('kurze Stufe: Laeufe laufen im gewaehlten Takt weiter',
     fast.anzahl >= 2 && fast.abstaende.length > 0
       && fast.abstaende.every((g) => g < 2000), JSON.stringify(fast));

  /* ── Gesperrte Meta-Datei darf einen Chat weder loeschen noch veraendern (Hauptursache der
     Windows-Bremse, gemessen 14.11.: 6 von 15 Meta-Dateien im laufenden Betrieb EPERM) ──
     Frueher fiel so ein Chat aus der Liste: pollChats() hielt ihn fuer geloescht, eine Runde
     spaeter galt er wieder als geaendert - die Oberflaeche baute Chatliste und Nachrichtenliste
     neu auf, mitten in der Tastatureingabe. */
  console.log('\nGesperrte Meta-Datei (Netzfreigabe/Virenscanner) …');
  await api.sync.setEvery(1000);
  const vorSperre = await api.chats.list();          // Ausgangsstand + Cache fuellen
  ok('Chat vor der Sperre in der Liste', vorSperre.some((m) => m.id === 'chat1'), JSON.stringify(vorSperre.map((m) => m.id)));

  Native.__blockMeta = 'chat1.meta.json';
  const mitSperre = await api.chats.list();
  ok('Chat bleibt in der Liste, obwohl die Meta-Datei gesperrt ist',
     mitSperre.some((m) => m.id === 'chat1'), JSON.stringify(mitSperre.map((m) => m.id)));

  // Abgleich mit Sperre: weder "geloescht" noch "geaendert" darf gemeldet werden
  got = null;
  await window.__syncNow();
  await new Promise((r) => setTimeout(r, 1200));
  ok('gesperrte Meta fuehrt zu keiner Meldung', got === null, JSON.stringify(got));

  // Nach der Sperre muss der Chat wieder normal als fremde Aenderung erkannt werden
  Native.__blockMeta = '';
  const metaNow = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  fs.writeFileSync(metaPath, JSON.stringify({ ...metaNow, rev: (metaNow.rev || 0) + 1, dev: 'anderer-rechner' }));
  got = null;
  await window.__syncNow();
  ok('nach der Sperre wird eine echte Aenderung wieder erkannt',
     await waitFor(() => got && (got.metas || []).some((m) => m.id === 'chat1'), 3000), JSON.stringify(got));


  console.log('\nRechtschreibpruefung am Eingabefeld …');
  // Kein echtes DOM in Node: ein minimales Eingabefeld bereitstellen.
  const inp = {};
  Object.defineProperty(inp, 'spellcheck', { set(v) { this.__sp = v; }, get() { return this.__sp; } });
  inp.setAttribute = function (k, v) { this['__' + k] = v; };
  global.document = { getElementById: (id) => (id === 'input' ? inp : null) };
  await api.spellSet({ enabled: false, lang: 'en' });
  ok('spellSet schaltet spellcheck aus', inp.spellcheck === false);
  ok('spellSet setzt Sprache en', inp.__lang === 'en');
  await api.spellSet({ enabled: true, lang: 'de-en' });
  ok('spellSet setzt Sprache de (de-en)', inp.spellcheck === true && inp.__lang === 'de');

  console.log('\nAbbruch laufender Werkzeuge (ws.abortAll) …');
  // Groerer Workspace, damit die Suche beschaeftigt ist
  const root = '/ws/gross';
  fs.mkdirSync(toReal('/ws/gross'), { recursive: true });
  for (let i = 0; i < 120; i++) fs.writeFileSync(path.join(toReal('/ws/gross'), 'datei' + i + '.txt'), 'zeile A\nzeile B\nund NIE ein Treffer hier ' + i);

  const laufend = api.ws.tool({ name: 'search_text', root, args: { query: 'unmoeglicher Suchbegriff XYZ' } });
  setTimeout(() => api.ws.abortAll(), 30);
  const res = await laufend;
  ok('Suche liefert Abbruch statt kompletter Liste', res.ok && /Abgebrochen/.test(res.result), (res.result || '').slice(0, 80));

  console.log('\nErgebnis: ' + pass + ' geprüft, ' + fail + ' Fehler');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Test lief nicht durch:', e); process.exit(1); });
