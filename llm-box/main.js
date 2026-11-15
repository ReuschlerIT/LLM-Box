'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn, execFile } = require('child_process');
const http = require('http');
const https = require('https');
const DOCS = require('./docs');

let win = null;
const aborts = new Map();

// Läuft gerade ein Werkzeug (PowerShell/cmd über run_command, Installation, …), soll die Oberfläche und der
// Stopp-Button auch dann sofort reagieren, wenn das Fenster minimiert, verdeckt oder nicht fokussiert ist.
// Ohne diese Schalter drosselt Chromium Timer und Darstellung im Hintergrund stark (spart sonst Akku/CPU bei
// normalen Tabs/Fenstern), wodurch die App eingefroren wirkt, bis man wieder aktiv hineinklickt - der Prozess
// selbst lief die ganze Zeit im Hauptprozess weiter und produzierte Ausgaben, nur die Anzeige/Bedienung staute sich.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  } else if (app.isReady()) {
    createWindow();
  }
});

// Notausgang: Datei "disable-gpu.flag" im Datenordner (%APPDATA%\LLM Box) schaltet die GPU-Beschleunigung ab
try {
  if (fs.existsSync(path.join(app.getPath('userData'), 'disable-gpu.flag'))) app.disableHardwareAcceleration();
} catch {}

/* ───────────────────────── Speicher ───────────────────────── */

const dataDir = () => app.getPath('userData');
/* ───── Geräteübergreifende Chats ─────
   Jeder Rechner hat seine eigenen Einstellungen. Nur die Chats können in einen gemeinsamen Ordner (NAS, Netzlaufwerk, OneDrive …) gelegt werden.
   Pro Chat gibt es zwei Dateien: <id>.json (Inhalt) und <id>.meta.json (Titel, Zeit, Revision, Gerät, „arbeitet gerade“).
   Es gibt bewusst KEINE gemeinsame Index-Datei: Sie würde bei zwei Rechnern ständig kollidieren. Die Liste entsteht aus den kleinen Meta-Dateien. */
const os = require('os');
const crypto = require('crypto');
const syncFile = () => path.join(dataDir(), 'sync.json');
let syncCfg = null;
function loadSyncCfg() {
  if (syncCfg) return syncCfg;
  let c = null;
  try { c = JSON.parse(fs.readFileSync(syncFile(), 'utf8')); } catch {}
  if (!c || typeof c !== 'object') c = {};
  if (!c.deviceId) {
    c.deviceId = crypto.randomBytes(6).toString('hex');
    try { fs.writeFileSync(syncFile(), JSON.stringify(c)); } catch {}
  }
  syncCfg = c;
  return c;
}
const saveSyncCfg = () => { try { fs.writeFileSync(syncFile(), JSON.stringify(syncCfg)); } catch {} };
const localChatsDir = () => path.join(dataDir(), 'chats');
const chatsDir = () => { const c = loadSyncCfg(); return c.dir ? path.join(c.dir, 'LLM-Box-Chats') : localChatsDir(); };
const deviceName = () => os.hostname() || 'Gerät';

// Schreibvorgänge pro Datei strikt nacheinander (sonst überschreiben/entfernen sich parallele Saves gegenseitig die .tmp-Datei)
const writeQueues = new Map();
function writeJsonAtomic(file, data) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => writeJsonAtomicNow(file, data));
  const tail = run.catch(() => {});
  writeQueues.set(file, tail);
  tail.then(() => { if (writeQueues.get(file) === tail) writeQueues.delete(file); });
  return run;
}
async function writeJsonAtomicNow(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const json = JSON.stringify(data);
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      await fsp.writeFile(tmp, json, 'utf8');
      await fsp.rename(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      // Netzlaufwerk/Virenscanner/Sync-Client kann die Datei kurz sperren oder entfernen -> kurz warten und neu versuchen
      await new Promise(r => setTimeout(r, 80 * (i + 1)));
    }
  }
  // Letzter Ausweg: direkt in die Zieldatei schreiben
  try { await fsp.rm(tmp, { force: true }); } catch {}
  try { await fsp.writeFile(file, json, 'utf8'); return; } catch {}
  throw lastErr;
}
async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

ipcMain.handle('store:get', async (_e, name) => readJson(path.join(dataDir(), safeId(name) + '.json'), null));
ipcMain.handle('store:set', async (_e, name, data) => {
  await writeJsonAtomic(path.join(dataDir(), safeId(name) + '.json'), data);
  return true;
});

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');
const metaFileIn = (dir, id) => path.join(dir, safeId(id) + '.meta.json');
const chatFileIn = (dir, id) => path.join(dir, safeId(id) + '.json');
const known = new Map(); // id -> Revision, die DIESER Rechner zuletzt gelesen oder geschrieben hat
const seen = new Map(); // id -> Revision beim letzten Abgleich (Änderungserkennung)
let metaChecked = '';
let baseline = false; // Änderungserkennung hat den Ausgangsstand gesehen

// Alte Datenstände (index.json bzw. nur Chat-Dateien) einmalig um Meta-Dateien ergänzen
async function ensureMetas(dir) {
  if (metaChecked === dir) return;
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return; }
  const oldIdx = await readJson(path.join(dir, 'index.json'), []);
  const byId = new Map((Array.isArray(oldIdx) ? oldIdx : []).map((m) => [m.id, m]));
  for (const f of files) {
    if (!f.endsWith('.json') || f === 'index.json' || f.endsWith('.meta.json')) continue;
    const id = f.slice(0, -5);
    if (files.includes(id + '.meta.json')) continue;
    let m = byId.get(id);
    if (!m) {
      const c = await readJson(path.join(dir, f), null);
      if (!c || !c.id) continue;
      m = { id: c.id, title: c.title, created: c.created, updated: c.updated, model: c.model, tokens: 0, source: c.source, importKey: c.importKey };
    }
    await writeJsonAtomic(metaFileIn(dir, id), { ...m, rev: 1, dev: loadSyncCfg().deviceId, devName: deviceName() });
  }
  metaChecked = dir;
}
/* Liest alle Meta-Dateien. Rueckgabe: { metas, blockiert } oder null, wenn der Ordner selbst
   nicht lesbar ist (Netzlaufwerk getrennt) - dann darf NICHTS als gelöscht gelten.

   Der Zusatz "blockiert" ist wichtig: auf einer Netzfreigabe kann eine Meta-Datei in dem
   Moment gesperrt sein, in dem wir sie lesen (EPERM/EBUSY - gemessen 14.11.: 6 von 15 Dateien
   waehrend des laufenden Betriebs gesperrt). Frueher fiel so ein Chat einfach aus der Liste:
   der Abgleich hielt ihn fuer GELoSCHT, in der naechsten Runde galt er wieder als GEANDERT,
   und die Oberflaeche baute bei jedem dieser Blinker Chatliste und Nachrichtenliste neu auf -
   mitten in der Tastatureingabe. Das ist die Hauptursache fuer das gemeldete Zogern. */
const META_SUFFIX = '.meta.json';
/* Zuletzt erfolgreich gelesene Meta-Dateien. Ist eine Datei in diesem Moment gesperrt, wird der
   bekannte Stand weiterverwendet: der Chat bleibt in der Liste und sein Abgleich vergleicht mit
   dem richtigen Stand, statt ihn als geloescht/geaendert zu melden. */
const metaCache = new Map();   // "Ordner|Chat-ID" -> Meta. Nach Ordnerwechsel (lokal <-> Freigabe)
                               // duerfen keine Staende aus dem anderen Ordner verwendet werden.
async function listMetas(dir) {
  let files;
  try { files = await fsp.readdir(dir); } catch (e) { return e.code === 'ENOENT' && dir === localChatsDir() ? { metas: [], blockiert: [] } : null; }
  const names = files.filter((f) => f.endsWith(META_SUFFIX));
  const read = await Promise.all(names.map(async (f) => {
    try { return JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')); }
    catch (e) { return { __fehler: e.code || '' }; }
  }));
  const metas = [];
  const blockiert = [];
  names.forEach((f, i) => {
    const m = read[i];
    const key = dir + '|' + f.slice(0, -META_SUFFIX.length);
    if (m && m.id) { metaCache.set(key, m); metas.push(m); return; }
    // Verschwunden (ENOENT) ist echt weg; eine Sperre ist nur ein Moment und haelt den Chat offen.
    const id = f.slice(0, -META_SUFFIX.length);
    if (!m || m.__fehler === 'ENOENT') return;
    const alt = metaCache.get(key);
    if (alt) metas.push(alt); else blockiert.push(id);
  });
  return { metas, blockiert };
}
function resetSyncState() { known.clear(); seen.clear(); metaChecked = ''; baseline = false; }

ipcMain.handle('chats:list', async () => {
  const dir = chatsDir();
  await ensureMetas(dir);
  const fund = await listMetas(dir);
  if (!fund) return [];
  const metas = fund.metas;
  for (const m of metas) seen.set(m.id, m.rev || 0);
  baseline = true;
  return metas.sort((a, b) => (b.updated || 0) - (a.updated || 0));
});
ipcMain.handle('chats:load', async (_e, id) => {
  const dir = chatsDir();
  const c = await readJson(chatFileIn(dir, id), null);
  const m = await readJson(metaFileIn(dir, id), null);
  if (c) known.set(safeId(id), (m && m.rev) || 0);
  return c;
});
ipcMain.handle('chats:save', async (_e, chat, meta) => {
  const dir = chatsDir();
  const cfg = loadSyncCfg();
  let id = safeId(chat.id);
  const cur = await readJson(metaFileIn(dir, id), null);
  let conflict = null;
  // Hat ein anderer Rechner den Chat geändert, seit dieser ihn zuletzt gelesen/geschrieben hat: nichts überschreiben, sondern als Kopie sichern
  if (cur && known.has(id) && (cur.rev || 0) !== known.get(id) && cur.dev !== cfg.deviceId) {
    const nid = id + '-k' + Date.now().toString(36);
    const title = (chat.title || 'Chat') + ` (Konflikt ${deviceName()})`;
    chat = { ...chat, id: nid, title };
    meta = { ...meta, id: nid, title };
    conflict = { id: nid, title };
    id = nid;
  }
  const prev = conflict ? null : cur;
  const rev = (prev ? prev.rev || 0 : 0) + 1;
  await writeJsonAtomic(chatFileIn(dir, id), chat);
  await writeJsonAtomic(metaFileIn(dir, id), { ...meta, id, rev, dev: cfg.deviceId, devName: deviceName() });
  known.set(id, rev);
  seen.set(id, rev);
  return conflict ? { ok: true, conflict } : { ok: true };
});
ipcMain.handle('chats:delete', async (_e, id) => {
  const dir = chatsDir();
  known.delete(safeId(id));
  seen.delete(safeId(id));
  await fsp.rm(chatFileIn(dir, id), { force: true });
  await fsp.rm(metaFileIn(dir, id), { force: true });
  return true;
});
ipcMain.handle('chats:deleteAll', async () => {
  resetSyncState();
  await fsp.rm(chatsDir(), { recursive: true, force: true });
  return true;
});

/* ───── Abgleich-Rhythmus ─────
   Frueher fest verdrahtet (Windows alle 3 s, Android alle 5 s). Jetzt wählbar – von
   "Echtzeit" bis 30 Minuten – und liegt in sync.json, weil dort schon die übrige
   Sync-Konfiguration steht (Geräte-ID, Ordner). Die Oberfläche kennt nur api.sync.get()
   und api.sync.setEvery(), dadurch gilt dieselbe Einstellung in Windows- und Android-App. */
const SYNC_MIN_MS = 1000;                 // unter 1 s bringt nichts und belastet die Freigabe nur
const SYNC_MAX_MS = 30 * 60 * 1000;       // 30 Minuten, die langsamste Stufe
const SYNC_DEFAULT_MS = 2000;             // "Echtzeit": beide Geräte reagieren praktisch sofort
function syncEveryMs() {
  const v = +loadSyncCfg().everyMs;
  return (v >= SYNC_MIN_MS && v <= SYNC_MAX_MS) ? v : SYNC_DEFAULT_MS;
}

// Gemeinsamer Ordner: Einstellung, Umzug der lokalen Chats und Änderungserkennung
ipcMain.handle('sync:get', () => { const c = loadSyncCfg(); return { dir: c.dir || '', deviceId: c.deviceId, deviceName: deviceName(), localDir: localChatsDir(), folder: chatsDir(), everyMs: syncEveryMs() }; });
ipcMain.handle('sync:setEvery', (_e, ms) => {
  const v = Math.round(+ms);
  if (!(v >= SYNC_MIN_MS && v <= SYNC_MAX_MS)) return { ok: false, error: `Abstand zwischen ${SYNC_MIN_MS / 1000} Sekunden und ${SYNC_MAX_MS / 60000} Minuten erlaubt` };
  const c = loadSyncCfg();
  c.everyMs = v;
  saveSyncCfg();
  // Der Stand des anderen Rechners ist nach einer Tempo-Aenderung nicht neu bewertet worden:
  // Zustand zuruecksetzen, damit der naechste Abgleich erneut vergleicht statt Luecken zu sehen.
  resetSyncState();
  schedulePoll(v);       // neue Geschwindigkeit wirkt sofort, nicht erst beim naechsten Tick
  return { ok: true, everyMs: v };
});

ipcMain.handle('sync:setDir', async (_e, dir) => {
  const c = loadSyncCfg();
  if (dir) {
    try {
      await fsp.mkdir(path.join(dir, 'LLM-Box-Chats'), { recursive: true });
      const t = path.join(dir, 'LLM-Box-Chats', '.schreibtest-' + c.deviceId);
      await fsp.writeFile(t, 'x');
      await fsp.rm(t, { force: true });
    } catch (e) { return { ok: false, error: 'Der Ordner ist nicht beschreibbar: ' + e.message }; }
    c.dir = dir;
  } else delete c.dir;
  saveSyncCfg();
  resetSyncState();
  return { ok: true, folder: chatsDir() };
});
// Lokale Chats in den gemeinsamen Ordner kopieren (vorhandene Chats mit gleicher Kennung werden nicht überschrieben)
ipcMain.handle('sync:migrate', async () => {
  const c = loadSyncCfg();
  if (!c.dir) return { ok: false, error: 'Es ist kein gemeinsamer Ordner gewählt.' };
  const src = localChatsDir();
  const dst = chatsDir();
  await ensureMetas(src);
  let n = 0;
  let skipped = 0;
  const metas = ((await listMetas(src)) || {}).metas || [];
  for (const m of metas) {
    if (fs.existsSync(metaFileIn(dst, m.id))) { skipped++; continue; }
    try {
      await fsp.mkdir(dst, { recursive: true });
      await fsp.copyFile(chatFileIn(src, m.id), chatFileIn(dst, m.id));
      await writeJsonAtomic(metaFileIn(dst, m.id), { ...m, rev: 1, dev: c.deviceId, devName: deviceName() });
      n++;
    } catch {}
  }
  resetSyncState();
  return { ok: true, copied: n, skipped };
});
let pollBusy = false;
async function pollChats() {
  const c = loadSyncCfg();
  if (!c.dir || !win || win.isDestroyed() || pollBusy) return;
  pollBusy = true;
  try {
    const dir = chatsDir();
    const fund = await listMetas(dir);
    if (!fund) return; // Ordner nicht lesbar (z. B. Netzlaufwerk getrennt): nichts ableiten
    const metas = fund.metas;
    if (!baseline) { metas.forEach((m) => seen.set(m.id, m.rev || 0)); baseline = true; return; }
    const changed = [];
    const ids = new Set();
    for (const m of metas) {
      ids.add(m.id);
      if (seen.get(m.id) !== (m.rev || 0) && m.dev !== c.deviceId) changed.push(m);
      seen.set(m.id, m.rev || 0);
    }
    /* Gesperrte Meta-Dateien (EPERM/EBUSY auf der Freigabe) gelten NICHT als entfernt: ohne
       diese Ausnahme verschwand derselbe Chat im Sekundentakt aus der Liste und tauchte wieder
       auf - die Oberflaeche baute Chatliste und Nachrichtenliste neu auf, waehrend der Nutzer
       tippte. Ein Chat gilt erst dann als geloescht, wenn seine Meta-Datei wirklich weg ist. */
    const blockiert = new Set(fund.blockiert);
    const removed = [...seen.keys()].filter((id) => !ids.has(id) && !blockiert.has(id));
    removed.forEach((id) => { seen.delete(id); known.delete(id); });
    if (changed.length || removed.length) win.webContents.send('chats:changed', { metas: changed, removed });
  } catch {} finally { pollBusy = false; }
}

/* Ein nachlaufender Timer statt setInterval: bei langen Abständen (bis 30 Minuten) darf ein
   einziger Timer nicht weiterlaufen, nachdem der Nutzer das Tempo geändert hat – sonst galt
   die neue Einstellung erst nach Stunden. Der nächste Lauf wird immer neu geplant. */
let pollTimer = null;
/* Die Generationen-Marke (pollGen) verhindert eine zweite Abgleich-Kette: aendert der Nutzer das
   Tempo, waehrend ein Durchlauf gerade laeuft, darf genau dieser alte Durchlauf KEINEN weiteren
   Timer mehr setzen. Ohne diese Marke plant der ueberholte Lauf zusätzlich neu ein und die
   Abstaende stimmen nicht mehr (auf der Android-Seite am 14.11. im Test als Wechsel von ~0,5 s
   und ~5 s bei eingestellter Sekunde sichtbar). Dasselbe Muster wie in native-main.js:619. */
let pollGen = 0;
function schedulePoll(delayMs) {
  if (pollTimer) clearTimeout(pollTimer);
  const wait = Math.max(SYNC_MIN_MS, Math.round(+delayMs || syncEveryMs()));
  const gen = ++pollGen;
  /* Ein Fehler im Abgleich darf die Kette nicht beenden: ohne catch waere der naechste Lauf nie
     geplant worden und der Abgleich ware still stehen geblieben. */
  pollTimer = setTimeout(() => {
    Promise.resolve().then(pollChats).catch(() => {}).then(() => { if (gen === pollGen) schedulePoll(); });
  }, wait);
}

/* Sofortiger Abgleich beim Zurückkehren ins Fenster: ohne diesen Anstoss wartete die
   Oberflaeche bis zum naechsten Tick und wirkte veraltet. Bewusst KEIN resetSyncState() –
   das wuerde den gerade gesehenen Stand vergessen und genau die Aenderung verschlucken,
   die man sofort sehen will. */
function syncNow() { return pollChats(); }
schedulePoll();

ipcMain.on('sync:now', () => { syncNow(); });


/* ───── Windows-Freigabe (SMB) als Workspace ─────
   Bislang kannte nur die Android-App Netzwerkfreigaben mit Benutzer/Passwort (dort
   files/data/smb.json, MainActivity.java:1673/1690). Damit BEIDE Geraete dieselbe Freigabe
   nutzen koennen und die Zugangsdaten bei "Im WLAN anbieten" mitwandern, gibt es sie jetzt
   auch hier – in derselben Dateistruktur { "rechner": { user, domain, pass } }, damit beide
   Apps austauschbare Uebertragungsdateien erzeugen.

   Das Passwort liegt in %APPDATA%\LLM Box\smb.json (Nutzerprofil, nicht im Workspace) und wird
   von smb:getCreds bewusst NIE zurueckgegeben – die Oberflaeche erfahrt nur, dass eines
   hinterlegt ist (hasPass). Ein eigenes Export-Kommando (smb:credsForExport) holt es nur dann,
   wenn der Nutzer ausdruecklich eine Uebertragung startet; diese enthaelt ohnehin API-Keys im
   Klartext, vor denen die Oberflaeche warnt. */
const smbFile = () => path.join(dataDir(), 'smb.json');
function loadSmb() {
  try { const c = JSON.parse(fs.readFileSync(smbFile(), 'utf8')); return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {}; } catch { return {}; }
}
function saveSmb(obj) {
  try { fs.writeFileSync(smbFile(), JSON.stringify(obj)); return true; } catch { return false; }
}
/* Rechnername aus einer Windows-Freigabe-Adresse. Zugelassen sind die ueblichen Schreibweisen:
   \\rechner\freigabe\ordner , \\192.0.2.30\daten , //rechner/freigabe und die interne Form
   der Android-App /smb/rechner/freigabe/ordner. Ein gemapptes Laufwerk (Y:\...) hat keinen
   Rechner – dann gibt es auch keine Zugangsdaten zu uebertragen, was korrekt ist. */
function smbHostOf(p) {
  const roh = String(p || '').trim();
  /* Ein Laufwerksbuchstabe ist kein Rechner (siehe smbPartsAufgeloest unten). */
  if (/^[A-Za-z]:[\\/]/.test(roh)) return '';
  const s = roh.replace(/\\/g, '/');
  let m = /^\/+smb\/([^/]+)/i.exec(s); if (m) return m[1];
  m = /^\/{2}([^/]+)/.exec(s);        if (m) return m[1];   // UNC: //rechner/freigabe
  return '';
}
/* Rechner, Freigabe und Unterordner einer Freigabe-Adresse – fuer beide Schreibweisen. */
function smbPartsOf(p) {
  const roh = String(p || '').trim();
  /* FEHLERBEHEBUNG (durch Test belegt): die Fallback-Regel unten hielt "Y:" fuer einen Rechner –
     aus D:\MeinProjekt wurde host='Y:', share='MeinProjekt'. Ein Laufwerksbuchstabe ist aber
     NIE ein Rechnername. Ohne diese Weiche haette smbPartsAufgeloest() nie nachgeschaut und der
     Nutzerbericht "Laufwerk Y ist trotzdem eine SMB-Freigabe" waere weiter unbearbeitet geblieben. */
  if (/^[A-Za-z]:[\\/]/.test(roh)) return null;
  const s = roh.replace(/\\/g, '/').replace(/^\/+/, '');
  let m = /^smb\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(s); if (!m) m = /^([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(s);
  if (!m) return null;
  const sub = (m[3] || '').replace(/\/+$/, '');
  return { host: m[1], share: m[2], sub, unc: `\\\\${m[1]}\\${m[2]}` + (sub ? '\\' + sub.replace(/\//g, '\\') : '') };
}

/* ── Gemapptes Laufwerk aufloesen (der eigentliche Grund fuer "keine SMB-Uebergabe") ──
   Nutzerbefund 14.11.: Der Workspace des PCs ist D:\MeinProjekt. smbHostOf/smbPartsOf kennen nur
   die UNC-Schreibweise \\rechner\freigabe – ein Laufwerksbuchstabe liefert bisher '' bzw. null,
   collectSmb() fand damit keinen Rechner und es wanderte NICHTS mit (in der Uebertragung stand
   "smb (kein Netzwerkordner …)"). Tatsaechlich IST Y: eine SMB-Freigabe: net use zeigt
   Y: -> \\192.0.2.10\daten. Also wird der Buchstabe jetzt beim Windows-Handler aufgeloeset.

   Get-SmbMapping ist bewusst gewaehlt: Cmdlet- und Eigenschaftsnamen sind in jeder Windows-Sprache
   englisch, die Ausgabe von "net use" waere es nicht (hier: "Remotename"). Der Notfallpfad laesst
   deshalb nur den UNC-Anteil selbst aus der net-use-Ausgabe holen – dessen Form ist sprachunabhaengig. */
const laufwerkCache = new Map();
function uncOfLaufwerk(laufwerksbuchstabe) {
  const lit = String(laufwerksbuchstabe || '').toUpperCase();
  if (!/^[A-Z]$/.test(lit)) return Promise.resolve('');
  if (laufwerkCache.has(lit)) return Promise.resolve(laufwerkCache.get(lit));
  const execFile = require('child_process').execFile;
  const ps = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-SmbMapping -LocalPath '${lit}:').RemotePath`], { timeout: 8000, windowsHide: true },
    (err, stdout) => resolve(!err && stdout ? String(stdout).trim() : ''));
  });
  return ps.then((unc) => {
    if (/^\\\\[^\\]+\\[^\\\s]+/.test(unc)) { laufwerkCache.set(lit, unc); return unc; }
    /* Notfall: "net use Y:" – der UNC wird aus dem Text herausgesucht, nicht ueber eine
       (uebersetzte) Spaltenueberschrift. */
    return new Promise((resolve) => {
      execFile('net', ['use', `${lit}:`], { timeout: 8000, windowsHide: true }, (e2, out) => {
        const m = /\\\\[^\\]+\\[^\s\r\n"]+/.exec(String(out || ''));
        const fallback = !e2 && m ? m[0] : '';
        laufwerkCache.set(lit, fallback);
        resolve(fallback);
      });
    });
  });
}

/* Wandelt jeden Workspace-Pfad in Freigabe-Teile um: UNC direkt, Laufwerksbuchstabe nach
   Nachschlagen der Zuordnung. Gibt null zurueck, wenn wirklich keine Freigabe dahintersteckt
   (z. B. ein lokaler Ordner auf C:). */
async function smbPartsAufgeloest(p) {
  const direkt = smbPartsOf(p);
  if (direkt) return direkt;
  const s = String(p || '').trim();
  const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(s);
  if (!m) return null;
  const unc = await uncOfLaufwerk(m[1]);
  if (!unc) return null;
  const rest = (m[2] || '').replace(/[\\/]+$/, '');
  const u = /^\\\\([^\\]+)\\([^\\]+)(?:\\(.+))?$/.exec(unc);
  if (!u) return null;
  const share = u[2];
  /* Unterordner innerhalb der Freigabe. Zwei Stuecke, die beide dazugehoeren:
     - der Ast, AUF DEN das Laufwerk zeigt (aus der UNC-Zuordnung, z. B. \\host\share\daten -> "daten")
     - der Rest des Workspace-Pfads RELATIV ZUM LAUFWERKBUCHSTABEN (D:\MeinProjekt -> "MeinProjekt")
     Beispiel Nutzer-PC: Y: -> \\192.0.2.10\daten, Workspace D:\MeinProjekt
       -> host 192.0.2.10, share daten, sub "MeinProjekt", unc \\192.0.2.10\daten\MeinProjekt.
     Zeigt das Laufwerk tiefer (\\host\share\daten), ist der Ast nicht leer und es folgt
       sub = "daten/MeinProjekt" – genau der Pfad, den die Android-App als /smb/host/share/daten/... braucht. */
  const ast = (u[3] || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const relativ = rest.replace(/\\/g, '/').replace(/^\/+/g, '');
  const sub = [ast, relativ].filter(Boolean).join('/');
  return { host: u[1], share, sub, unc: `\\\\${u[1]}\\${share}` + (sub ? '\\' + sub.replace(/\//g, '\\') : ''), aufGelaufen: true };
}

/* Eigener Handler: die Oberflaeche braucht die Aufloesung, weil sie den Laufwerksbuchstaben
   selbst nicht kennen kann (dafuer ist net use/Get-SmbMapping noetig). */
ipcMain.handle('smb:resolve', async (_e, p) => {
  const teile = await smbPartsAufgeloest(p);
  if (!teile) return { ok: false, error: 'Hinter diesem Pfad steckt keine SMB-Freigabe' };
  return { ok: true, host: teile.host, share: teile.share, sub: teile.sub, unc: teile.unc, aufGelaufen: !!teile.aufGelaufen };
});

ipcMain.handle('smb:getCreds', (_e, host) => {
  const h = String(host || '').toLowerCase();
  if (!h) return { ok: false, error: 'Kein Rechner angegeben' };
  const c = loadSmb()[h];
  return { ok: true, user: (c && c.user) || '', domain: (c && c.domain) || '', hasPass: !!(c && c.pass) };
});

/* Speichert pro Rechner. Leere Felder ueberschreiben keinen gespeicherten Wert – sonst loescht
   ein erneutes Bestaetigen mit leerem Eingabefeld die Zugangsdaten (auf Android genauso geloest,
   MainActivity.java:1690; dort folgte der naechste Versuch anonym und scheiterte). */
ipcMain.handle('smb:saveCreds', (_e, o = {}) => {
  const h = String(o.host || '').toLowerCase();
  if (!h) return { ok: false, error: 'Kein Rechner angegeben' };
  const alle = loadSmb();
  const alt = alle[h] || {};
  const neu = {
    user: String(o.user ?? '') .trim() || alt.user || '',
    domain: (o.domain == null ? alt.domain : String(o.domain)).trim(),
    pass: (o.pass == null || o.pass === '') ? (alt.pass || '') : String(o.pass),
  };
  if (!neu.user && !neu.pass) { delete alle[h]; return saveSmb(alle) ? { ok: true, geleert: true } : { ok: false, error: 'smb.json konnte nicht geschrieben werden' }; }
  alle[h] = neu;
  return saveSmb(alle) ? { ok: true } : { ok: false, error: 'smb.json konnte nicht geschrieben werden' };
});

/* Nur fuer die ausdruecklich gestartete Uebertragung: liefert auch das Passwort. */
ipcMain.handle('smb:credsForExport', (_e, host) => {
  const h = String(host || '').toLowerCase();
  if (!h) return { ok: false, error: 'Kein Rechner angegeben' };
  const c = loadSmb()[h];
  if (!c) return { ok: true, user: '', domain: '', pass: '' };
  return { ok: true, user: c.user || '', domain: c.domain || '', pass: c.pass || '' };
});

/* Alle Rechner, fuer die auf diesem Geraet Zugangsdaten hinterlegt sind. Noetig, weil der
   Workspace hier oft ein gemapptes Laufwerk ist (Y:\…) – daraus laesst sich kein Rechner
   ablesen, die Freigabe desselben Rechners soll aber trotzdem mitwandern duerfen. */
ipcMain.handle('smb:listHosts', () => {
  const alle = loadSmb();
  return { ok: true, hosts: Object.keys(alle).filter((h) => alle[h] && (alle[h].user || alle[h].pass)) };
});

/* Verbindungstest einer Freigabe. Antwortet in derselben Form wie die Android-Seite
   (host/share/entries/sample), damit die Oberflaeche denselben Text bauen kann. */
ipcMain.handle('smb:test', async (_e, p) => {
  /* Aufgeloest statt nur smbPartsOf: der Workspace des PCs ist oft ein gemapptes Laufwerk
     (Y:\…). Wer dort "Pruefen" drueckt, erwartet eine Antwort auf die dahinterliegende Freigabe. */
  const parts = await smbPartsAufgeloest(p);
  if (!parts) return { ok: false, error: 'Das ist keine Freigabe-Adresse (erwartet \\\\rechner\\freigabe\\ordner oder ein gemapptes Laufwerk)' };
  const unc = parts.unc;
  try {
    const st = await fsp.stat(unc);
    if (!st.isDirectory()) return { ok: false, error: 'Der Pfad ist kein Ordner' };
    const names = await fsp.readdir(unc);
    return { ok: true, host: parts.host, share: parts.share, entries: names.length, sample: names.slice(0, 3).join(', ') };
  } catch (e) {
    const grund = e.code === 'EPERM' || e.code === 'EACCES' ? 'Zugriff verweigert – Benutzername und Passwort der Freigabe pruefen'
      : e.code === 'ENOENT' ? 'Freigabe oder Ordner nicht gefunden (Netzwerk und Schreibweise des Pfads pruefen)'
      : e.code === 'ENOTDIR' ? 'Ein Teil des Pfads ist keine Ordnerstruktur'
      : (e.message || 'Unbekannter Fehler');
    return { ok: false, error: `${grund} (${e.code || 'ohne Fehlercode'})`, host: parts.host, share: parts.share };
  }
});

/* ───────────────────────── Dateien ───────────────────────── */

const IMG_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const DEFAULT_IGNORE = ['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.idea', '.vscode', '$RECYCLE.BIN', 'System Volume Information'];

const ignoreSet = (arr) => new Set((arr && arr.length ? arr : DEFAULT_IGNORE).map((s) => String(s).trim()).filter(Boolean));

async function readAttachment(abs, displayName, maxKB) {
  const name = displayName || path.basename(abs);
  const st = await fsp.stat(abs);
  const ext = path.extname(abs).toLowerCase();
  const base = { name, path: abs, size: st.size };
  if (IMG_MIME[ext]) {
    if (st.size > 20 * 1024 * 1024) return { ...base, kind: 'skip', reason: 'Bild größer als 20 MB' };
    const buf = await fsp.readFile(abs);
    return { ...base, kind: 'image', dataUrl: `data:${IMG_MIME[ext]};base64,${buf.toString('base64')}` };
  }
  if (DOCS.isDoc(ext)) {
    // PDF, Word, Excel, PowerPoint, OpenDocument: Text wird lokal herausgelesen. Das Limit gilt für den Text, nicht für die Dateigröße.
    try {
      const r = await DOCS.extract(abs);
      const cap = maxKB * 1024;
      let text = r.text;
      let note = r.info;
      if (text.length > cap) {
        note += `, auf ${Math.round(cap / 1024)} KB gekürzt`;
        text = text.slice(0, cap) + `\n\n[… gekürzt: ${Math.round(r.text.length / 1024)} KB Text insgesamt. Mit aktivem Dateizugriff kann die KI den Rest gezielt lesen.]`;
      }
      return { ...base, size: st.size, kind: 'text', text, converted: note };
    } catch (e) {
      return { ...base, kind: 'skip', reason: e.message };
    }
  }
  if (DOCS.legacyHint(ext)) return { ...base, kind: 'skip', reason: DOCS.legacyHint(ext) };
  if (st.size > maxKB * 1024) return { ...base, kind: 'skip', reason: `zu groß (${Math.round(st.size / 1024)} KB, Limit ${maxKB} KB)` };
  const buf = await fsp.readFile(abs);
  const dec = DOCS.decodeText(buf);
  if (dec === null) return { ...base, kind: 'skip', reason: 'Binärdatei (nicht unterstützt)' };
  return { ...base, kind: 'text', text: dec };
}

async function collectFolder(absRoot, prefix, lim, acc) {
  const ignore = ignoreSet(lim.ignore);
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const en of entries) {
      if (acc.truncated) return;
      if (ignore.has(en.name)) continue;
      const abs = path.join(dir, en.name);
      const r = rel ? rel + '/' + en.name : en.name;
      if (en.isDirectory()) {
        await walk(abs, r);
      } else if (en.isFile()) {
        if (acc.files.length >= lim.maxFiles || acc.totalBytes >= lim.maxTotalKB * 1024) {
          acc.truncated = true;
          return;
        }
        try {
          const a = await readAttachment(abs, prefix ? prefix + '/' + r : r, lim.maxKB);
          if (a.kind === 'skip') acc.skipped.push({ name: a.name, reason: a.reason });
          else {
            acc.files.push(a);
            acc.totalBytes += a.size;
          }
        } catch (e) {
          acc.skipped.push({ name: r, reason: e.message });
        }
      }
    }
  }
  await walk(absRoot, '');
}

async function readPaths(paths, lim) {
  const acc = { files: [], skipped: [], truncated: false, totalBytes: 0 };
  for (const p of paths) {
    try {
      const st = await fsp.stat(p);
      if (st.isDirectory()) await collectFolder(p, path.basename(p), lim, acc);
      else {
        const a = await readAttachment(p, null, lim.maxKB);
        if (a.kind === 'skip') acc.skipped.push({ name: a.name, reason: a.reason });
        else acc.files.push(a);
      }
    } catch (e) {
      acc.skipped.push({ name: path.basename(p), reason: e.message });
    }
  }
  return acc;
}

ipcMain.handle('files:read', (_e, paths, lim) => readPaths(paths, lim));
ipcMain.handle('files:pick', async (_e, mode, lim) => {
  const r = await dialog.showOpenDialog(win, {
    title: mode === 'folder' ? 'Ordner anhängen' : 'Dateien anhängen',
    properties: mode === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return readPaths(r.filePaths, lim);
});
// Chat-Import: JSON-Dateien wählen und als Text liefern (Auswertung im Renderer)
ipcMain.handle('chats:importPick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Chat-Export wählen (JSON)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'JSON', extensions: ['json', 'txt'] }, { name: 'Alle Dateien', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  const out = [];
  for (const f of r.filePaths) {
    try {
      const st = await fsp.stat(f);
      if (st.size > 200 * 1024 * 1024) { out.push({ name: path.basename(f), error: 'Datei ist größer als 200 MB.' }); continue; }
      out.push({ name: path.basename(f), text: await fsp.readFile(f, 'utf8') });
    } catch (e) {
      out.push({ name: path.basename(f), error: e.message });
    }
  }
  return out;
});
ipcMain.handle('cfg:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Strata-Konfigdatei wählen (strata-….json)', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
// Liest --max-context aus der Strata-Konfiguration (Feld "args"), falls der Server die Größe nicht meldet.
ipcMain.handle('cfg:ctx', async (_e, file) => {
  try {
    const j = JSON.parse(await fsp.readFile(String(file), 'utf8'));
    const lists = [j.args, j.args_written].filter(Array.isArray);
    for (const a of lists) {
      const i = a.indexOf('--max-context');
      if (i >= 0 && +a[i + 1] > 0) return { ok: true, ctx: +a[i + 1], name: j.model_name || '' };
    }
    return { ok: false, error: 'In der Datei steht kein „--max-context“ unter „args“.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('folder:pick', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Ordner wählen', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('file:saveAs', async (_e, { defaultName, content, base64, defaultDir, filters }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultDir ? path.join(defaultDir, defaultName || 'datei.txt') : defaultName || 'datei.txt',
    filters: filters || [{ name: 'Alle Dateien', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePath) return null;
  if (base64) await fsp.writeFile(r.filePath, Buffer.from(base64, 'base64'));
  else await fsp.writeFile(r.filePath, content, 'utf8');
  return r.filePath;
});

/* ───────────────────────── Übertragung (QR-Code / JSON-Export) ─────────────────────────
   Format siehe docs/TRANSFER-FORMAT.md. Der Hauptprozess komprimiert (zlib), bildet die Prüfsumme und liest auf Wunsch Textdateien des Workspace. */
ipcMain.handle('transfer:info', () => ({ version: app.getVersion(), platform: process.platform, device: deviceName() }));

ipcMain.handle('transfer:pack', async (_e, json) => {
  const zlib = require('zlib');
  const raw = Buffer.from(String(json), 'utf8');
  const z = zlib.deflateSync(raw, { level: 9 }); // zlib-Format (RFC 1950), z. B. in Java mit java.util.zip.Inflater lesbar
  return { b64: z.toString('base64'), sha16: crypto.createHash('sha256').update(z).digest('hex').slice(0, 16), rawBytes: raw.length, zBytes: z.length };
});

/* ───────────── Übertragung im WLAN anbieten (Alternative zur QR-Bildfolge) ─────────────
   Statt vieler QR-Bilder die man abfotografieren muss: die Windows-App startet einen kleinen,
   nur kurz laufenden HTTP-Dienst im lokalen Netz und beantwortet ein UDP-Rufsignal im selben
   Netz. Die Android-App sucht daraufhin ("Im WLAN suchen"), holt die Datei über http und kann
   sie übernehmen. Kein Kamera-Decoder nötig, keine 6 bis 12 Codes, nichts wird ins Internet
   gesendet. Der Inhalt ist derselbe wie bei QR/JSON (docs/TRANSFER-FORMAT.md).

   Sicherheit: Token als Query-Parameter (muss in der Anfrage ankommen - ein URL-Fragment
   wird von HTTP nie uebertragen), Bindung an alle LAN-Interfaces, Ablauf nach Ablaufzeit und
   Abschalten nach dem ersten erfolgreichen Abruf. */
let transferServe = null;

/* Schliesst den Uebertragungs-Dienst vollstaendig: HTTP-Server, Ablauf-Timer UND das
   UDP-Rufsignal. Beides getrennt zu schliessen war der Fehler – ein Rechner meldete sich
   weiter im WLAN, obwohl die Adresse langsto abgelaufen war. */
function stopTransferServe(onlyForServer) {
  if (!transferServe) return;
  if (onlyForServer && transferServe.server !== onlyForServer) return;
  try { transferServe.server.close(); } catch {}
  try { clearTimeout(transferServe.timer); } catch {}
  try { transferServe.sock.close(); } catch {}
  transferServe = null;
}

ipcMain.handle('transfer:serveStart', async (_e, { json, ttlSeconds }) => {
  const http = require('http');
  const os = require('os');
  stopTransferServe();   // ein bereits laufendes Angebot sauber beenden (auch UDP)

  const token = crypto.randomBytes(9).toString('base64url');
  // Pruefsumme nur fuer die Anzeige; uebertragen wird der JSON-Text selbst (siehe Handler).
  const sha16 = crypto.createHash('sha256').update(Buffer.from(String(json || ''), 'utf8')).digest('hex').slice(0, 16);

  const server = http.createServer((req, res) => {
    // Bewusst ein Query-Parameter und kein URL-Fragment: Fragmente werden von HTTP gar nicht
    // uebertragen (bleiben im Browser), der Server haette den Token nie gesehen.
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.pathname !== '/llmbox-transfer') { res.writeHead(404); res.end(); return; }
    if (u.searchParams.get('t') !== token) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Token passt nicht'); return; }
    // Als Text ausgeliefert, nicht als komprimierte Bytes: die Android-Bridge liest HTTP-Antworten
    // als String (body.string()), dabei wuerden rohe deflate-Bytes zerstoert.
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(String(json || ''));
    // Nach dem Abruf ist die Übertragung erledigt: der Dienst geht sofort wieder zu.
    // Wichtig: AUCH das Rufsignal (UDP) abschalten. Wurde nur der HTTP-Server geschlossen,
    // antwortete der Rechner weiter auf "LLMBOX?" mit einer Adresse, die niemand mehr bedient –
    // die Android-App rief sie ab und bekam "HTTP 0" (Verbindung abgelehnt) statt einer Datei.
    setTimeout(() => stopTransferServe(server), 300);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  const port = server.address().port;

  // Alle gebrauchbaren IPv4-Adressen dieses Rechners (loopback weglassen).
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
  }

  const ttl = Math.max(30, +ttlSeconds || 600);
  const timer = setTimeout(() => stopTransferServe(server), ttl * 1000);

  // Rufsignal im LAN: die Android-App schickt "LLMBOX?" an einen Broadcast-Port und
  // bekommt hier URL + Token zurück. So muss auf dem Handy nichts abgetippt werden.
  const dgram = require('dgram');
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg, rinfo) => {
    if (!String(msg).startsWith('LLMBOX?')) return;
    const answer = Buffer.from(`LLMBOX|${port}|${token}|${sha16}`);
    try { sock.send(answer, rinfo.port, rinfo.address); } catch {}
  });
  try { sock.bind(45455, '0.0.0.0'); } catch {}

  transferServe = { server, timer, sock };
  // Die Adresse enthaelt den Token als Query-Parameter (?t=...), damit der Server ihn sieht.
  // Frueher stand hier "#token" - Fragmente werden von HTTP nicht uebertragen, der Abruf waere
  // mit "Token passt nicht" (403) abgelehnt worden.
  const mkUrl = (ip) => `http://${ip}:${port}/llmbox-transfer?t=${encodeURIComponent(token)}`;
  return { ok: true, port, token, sha16, ttl, ips, urls: ips.map(mkUrl), bytes: Buffer.byteLength(String(json || ''), 'utf8') };
});

ipcMain.handle('transfer:serveStop', () => {
  stopTransferServe();
  return { ok: true };
});

ipcMain.handle('transfer:wsFiles', async (_e, { root, ignore, maxFileKB, maxTotalKB, maxFiles }) => {
  const out = { files: [], skipped: 0, truncated: false, totalBytes: 0 };
  if (!root) return { ...out, error: 'Kein Workspace-Ordner gewählt' };
  const ig = ignoreSet(ignore);
  const perFile = (+maxFileKB || 512) * 1024;
  const cap = (+maxTotalKB || 5120) * 1024;
  const maxN = +maxFiles || 2000;
  const base = path.resolve(root);
  async function walk(dir) {
    if (out.truncated) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const en of entries) {
      if (out.truncated) return;
      if (ig.has(en.name)) continue;
      const abs = path.join(dir, en.name);
      if (en.isDirectory()) { await walk(abs); continue; }
      if (!en.isFile()) continue;
      try {
        const st = await fsp.stat(abs);
        if (st.size > perFile) { out.skipped++; continue; }
        const buf = await fsp.readFile(abs);
        if (buf.subarray(0, 4000).includes(0)) { out.skipped++; continue; } // Binärdatei
        if (out.files.length >= maxN || out.totalBytes + buf.length > cap) { out.truncated = true; return; }
        out.files.push({ path: path.relative(base, abs).replace(/\\/g, '/'), size: buf.length, text: buf.toString('utf8') });
        out.totalBytes += buf.length;
      } catch { out.skipped++; }
    }
  }
  await walk(base);
  return out;
});

/* ───────────────────────── Workspace (Werkzeuge für die KI) ───────────────────────── */

function safe(root, rel) {
  if (!root) throw new Error('Kein Workspace-Ordner gewählt');
  const abs = path.resolve(root, rel || '.');
  const r = path.relative(path.resolve(root), abs);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('Pfad liegt außerhalb des Workspace');
  return abs;
}
const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

async function listDir(root, rel, ignore) {
  const abs = safe(root, rel);
  const ig = ignoreSet(ignore);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const en of entries) {
    if (ig.has(en.name)) continue;
    let size = 0;
    if (en.isFile()) {
      try {
        size = (await fsp.stat(path.join(abs, en.name))).size;
      } catch {}
    }
    out.push({ name: en.name, isDir: en.isDirectory(), size });
  }
  out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

// Laufende Dateiwerkzeuge (Stopp-Knopf): ws:abort setzt cancelled, die Schleifen brechen dann sofort ab
const wsRuns = new Set();
async function searchText(root, query, rel, ignore, ctl) {
  const ig = ignoreSet(ignore);
  const start = safe(root, rel || '.');
  const q = String(query).toLowerCase();
  const hits = [];
  let scanned = 0;
  async function walk(dir) {
    if (ctl && ctl.cancelled) return;
    if (hits.length >= 60 || scanned > 3000) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const en of entries) {
      if (ctl && ctl.cancelled) return;
      if (hits.length >= 60 || scanned > 3000) return;
      if (ig.has(en.name)) continue;
      const abs = path.join(dir, en.name);
      if (en.isDirectory()) await walk(abs);
      else if (en.isFile()) {
        scanned++;
        try {
          const st = await fsp.stat(abs);
          if (st.size > 1024 * 1024) continue;
          const buf = await fsp.readFile(abs);
          if (buf.subarray(0, 4000).includes(0)) continue;
          const lines = buf.toString('utf8').split(/\r?\n/);
          for (let i = 0; i < lines.length && hits.length < 60; i++) {
            if (lines[i].toLowerCase().includes(q)) hits.push(`${path.relative(root, abs).replace(/\\/g, '/')}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          }
        } catch {}
      }
    }
  }
  await walk(start);
  if (ctl && ctl.cancelled) return 'Vom Nutzer abgebrochen.' + (hits.length ? '\nBis dahin gefunden:\n' + hits.join('\n') : '');
  return hits.length ? hits.join('\n') : 'Keine Treffer.';
}

ipcMain.handle('ws:list', async (_e, { root, rel, ignore }) => listDir(root, rel, ignore));

ipcMain.handle('ws:abort', () => {
  for (const c of wsRuns) c.cancelled = true;
  return true;
});

ipcMain.handle('ws:tool', async (_e, { root, name, args, maxKB, ignore }) => {
  const ctl = { cancelled: false };
  wsRuns.add(ctl);
  try {
    args = args || {};
    if (name === 'list_files') {
      const items = await listDir(root, args.path || '.', ignore);
      if (!items.length) return { ok: true, result: '(leer)' };
      return { ok: true, result: items.map((i) => (i.isDir ? `[Ordner] ${i.name}/` : `[Datei]  ${i.name} (${fmtSize(i.size)})`)).join('\n') };
    }
    if (name === 'read_file') {
      const abs = safe(root, args.path);
      const ext = path.extname(abs).toLowerCase();
      let content;
      let sizeInfo;
      let head = '';
      if (DOCS.isDoc(ext)) {
        const r = await DOCS.extract(abs); // PDF, Word, Excel, PowerPoint, OpenDocument
        content = r.text;
        head = `[${r.info}, als Text ausgelesen]\n`;
        sizeInfo = fmtSize(Buffer.byteLength(content)) + ' Text';
      } else {
        if (DOCS.legacyHint(ext)) return { ok: false, result: 'Dieses Format kann nicht gelesen werden: ' + DOCS.legacyHint(ext) };
        const buf = await fsp.readFile(abs);
        content = DOCS.decodeText(buf);
        if (content === null) return { ok: false, result: 'Binärdatei kann nicht gelesen werden.' };
        sizeInfo = fmtSize(buf.length);
      }
      const lines = content.split(/\r?\n/);
      const total = lines.length;
      const limit = (maxKB || 40) * 1024;
      const from = Math.max(1, parseInt(args.start_line, 10) || 1);
      const to = Math.min(total, parseInt(args.end_line, 10) || total);
      if (from > total) return { ok: false, result: `Die Datei hat nur ${total} Zeilen.` };
      const out = [];
      let bytes = 0;
      let last = from - 1;
      for (let i = from - 1; i < to; i++) {
        const l = `${i + 1}\t${lines[i]}`;
        bytes += Buffer.byteLength(l) + 1;
        if (bytes > limit && out.length) break;
        out.push(l);
        last = i + 1;
      }
      let text = head + out.join('\n');
      if (last < to) text += `\n\n[… gekürzt: Zeilen ${from}–${last} von ${total} (${sizeInfo} gesamt). Lies den Rest gezielt mit start_line=${last + 1}, oder suche mit search_text die richtige Stelle.]`;
      else if (from > 1 || to < total) text += `\n\n[Zeilen ${from}–${to} von ${total}]`;
      return { ok: true, result: text };
    }
    if (name === 'edit_file') {
      const abs = safe(root, args.path);
      const ext = path.extname(abs).toLowerCase();
      if (DOCS.isDoc(ext) || DOCS.legacyHint(ext)) return { ok: false, result: `${ext}-Dateien kann die App nicht ändern. Schreibe stattdessen eine neue Datei in einem Textformat (z. B. .csv, .md, .html) oder nutze ein Skript über run_command.` };
      const dec = DOCS.decodeTextEx(await fsp.readFile(abs));
      if (!dec) return { ok: false, result: 'Binärdatei kann nicht geändert werden.' };
      let text = dec.text;
      let oldT = String(args.old_text ?? '');
      let newT = String(args.new_text ?? '');
      if (!oldT) return { ok: false, result: 'old_text darf nicht leer sein.' };
      if (text.includes('\r\n') && !oldT.includes('\r')) {
        oldT = oldT.replace(/\n/g, '\r\n');
        newT = newT.replace(/\n/g, '\r\n');
      }
      const n = text.split(oldT).length - 1;
      if (n === 0) return { ok: false, result: 'old_text wurde nicht gefunden. Prüfe Schreibweise und Einrückung, indem du die Stelle mit read_file (start_line/end_line) erneut liest.' };
      if (n > 1 && !args.replace_all) return { ok: false, result: `old_text kommt ${n}-mal vor. Nimm mehr umgebenden Text hinzu, damit er eindeutig ist, oder setze replace_all.` };
      text = text.split(oldT).join(newT);
      await fsp.writeFile(abs, DOCS.encodeText(text, dec.enc)); // in der ursprünglichen Kodierung zurückschreiben
      return { ok: true, result: `Geändert: ${args.path} (${n} Ersetzung${n > 1 ? 'en' : ''})` };
    }
    if (name === 'write_file') {
      const abs = safe(root, args.path);
      const ext = path.extname(abs).toLowerCase();
      if (DOCS.isDoc(ext) || DOCS.legacyHint(ext)) return { ok: false, result: `${ext}-Dateien kann die App nicht erzeugen (Text würde eine ungültige Datei ergeben). Schreibe stattdessen .csv, .md oder .html, oder nutze ein Skript über run_command.` };
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const content = String(args.content ?? '');
      let enc = 'utf8';
      try { const ex = DOCS.decodeTextEx(await fsp.readFile(abs)); if (ex) enc = ex.enc; } catch {} // bestehende Datei: Kodierung beibehalten
      await fsp.writeFile(abs, DOCS.encodeText(content, enc));
      return { ok: true, result: `Geschrieben: ${args.path} (${fmtSize(Buffer.byteLength(content))})` };
    }
    if (name === 'search_text') {
      return { ok: true, result: await searchText(root, args.query, args.path, ignore, ctl) };
    }
    return { ok: false, result: 'Unbekanntes Werkzeug: ' + name };
  } catch (e) {
    return { ok: false, result: 'Fehler: ' + e.message };
  } finally {
    wsRuns.delete(ctl);
  }
});

/* ───────────────────────── Programme auf dem Client (Werkzeuge für die KI) ───────────────────────── */
/* Die Freigabe durch den Nutzer passiert im Renderer (Karte im Chat). Hier wird nur ausgeführt. */

const procs = new Map();
const IS_WIN = process.platform === 'win32';
const OUT_CAP = 40000;

function regPath(hive) {
  return new Promise((resolve) => {
    const key = hive === 'M' ? 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' : 'HKCU\\Environment';
    execFile('reg', ['query', key, '/v', 'Path'], { windowsHide: true }, (err, out) => {
      if (err) return resolve('');
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(String(out));
      resolve(m ? m[1].trim().replace(/%([^%]+)%/g, (_, n) => process.env[n] || '') : '');
    });
  });
}

// Frischer PATH: frisch installierte Programme werden sofort gefunden, ohne dass die App neu gestartet werden muss
async function execEnv() {
  const env = { ...process.env };
  if (IS_WIN) {
    const [m, u] = await Promise.all([regPath('M'), regPath('U')]);
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
    const parts = [...String(env[key] || '').split(';'), ...m.split(';'), ...u.split(';')].filter(Boolean);
    const seen = new Set();
    env[key] = parts.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join(';');
  }
  return env;
}

function trimOutput(t) {
  if (t.length <= OUT_CAP) return t;
  const head = t.slice(0, Math.floor(OUT_CAP * 0.35));
  const tail = t.slice(t.length - Math.floor(OUT_CAP * 0.65));
  return `${head}\n\n[… ${t.length - head.length - tail.length} Zeichen ausgelassen. Filtere die Ausgabe (z. B. mit findstr / Select-String / grep) oder leite sie in eine Datei im Workspace um und lies sie gezielt mit read_file …]\n\n${tail}`;
}

// Windows: taskkill /T verlässt sich auf seine eigene, nicht öffentlich dokumentierte Baum-Logik und kann
// Prozesse übersehen, die sich bewusst vom Elternprozess lösen (z. B. der Gradle-Daemon bei Android-Builds,
// der extra so gebaut ist, dass er spätere Builds beschleunigt, indem er über das Ende des aufrufenden
// Skripts hinaus weiterläuft). Deshalb zusätzlich: alle Nachkommen-Prozess-IDs selbst ermitteln (per
// ParentProcessId, auch mehrere Ebenen tief) und jeden einzeln beenden, statt uns nur auf /T zu verlassen.
function killDescendantsWin(pid) {
  const ps = `
$ErrorActionPreference='SilentlyContinue'
$all=@(${pid}); $queue=@(${pid})
while ($queue.Count -gt 0) {
  $p = $queue[0]; $queue = @($queue[1..($queue.Count-1)])
  $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" | Select-Object -ExpandProperty ProcessId
  foreach ($k in $kids) { if ($all -notcontains $k) { $all += $k; $queue += $k } }
}
foreach ($id in $all) { taskkill /PID $id /F 2>$null | Out-Null }
`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true }, () => {});
}

function killTree(child) {
  try {
    if (IS_WIN) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      killDescendantsWin(child.pid); // Nachzügler (z. B. ein abgekoppelter Gradle-Daemon) separat einfangen
    }
    else {
      try {
        process.kill(-child.pid, 'SIGKILL'); // ganze Prozessgruppe (Kindprozesse), siehe detached beim Start
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {}
}

async function runProc({ id, command, shellKind, cwd, timeoutSec, onData }) {
  const env = await execEnv();
  return new Promise((resolve) => {
    const opts = { cwd, env, windowsHide: true, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] };
    let child;
    try {
      if (IS_WIN && shellKind === 'powershell') {
        const ps = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference="SilentlyContinue"; ' + command;
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], opts);
      } else if (IS_WIN) {
        child = spawn('chcp 65001>nul & ' + command, { ...opts, shell: true });
      } else {
        child = spawn(command, { ...opts, shell: true });
      }
    } catch (e) {
      return resolve({ ok: false, result: 'Start fehlgeschlagen: ' + e.message });
    }
    let out = '';
    let timedOut = false;
    let aborted = false;
    let exitCode = null;
    // Live-Ausgabe an die Oberfläche (gebündelt, damit der Chat nicht mit Mini-Paketen überflutet wird)
    let pend = '';
    let flushT = null;
    const flush = () => {
      if (flushT) { clearTimeout(flushT); flushT = null; }
      if (pend && onData) { const t = pend; pend = ''; try { onData(t); } catch {} }
    };
    const dec = { o: new TextDecoder(), e: new TextDecoder() };
    const add = (k) => (b) => {
      const t = dec[k].decode(b, { stream: true });
      out += t;
      if (out.length > OUT_CAP * 6) out = out.slice(0, OUT_CAP * 2) + '\n[…]\n' + out.slice(out.length - OUT_CAP * 3);
      if (onData) { pend += t; if (!flushT) flushT = setTimeout(flush, 80); }
    };
    child.stdout.on('data', add('o'));
    child.stderr.on('data', add('e'));
    const limit = Math.max(5, Math.min(3600, +timeoutSec || 120)) * 1000;
    const timer = setTimeout(() => { timedOut = true; killTree(child); setTimeout(() => done(exitCode), 1200); }, limit);
    let finished = false;
    child.on('error', (e) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (id) procs.delete(id);
      resolve({ ok: false, result: 'Start fehlgeschlagen: ' + e.message });
    });
    // „close“ kommt erst, wenn ALLE Ausgabe-Leitungen zu sind. Startet das Programm einen Hintergrundprozess, der die
    // Leitungen erbt (z. B. der Gradle-Daemon bei Android-Builds), kommt „close“ nie: Der Befehl wirkt „hängend“ und
    // auch Stopp hilft nicht, weil nach dem Beenden nichts mehr ankommt. Deshalb zählt „exit“ plus eine kurze Frist
    // zum Auslesen der restlichen Ausgabe; nach Stopp/Zeitlimit wird noch schneller abgeschlossen.
    const done = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.stdout.destroy(); child.stderr.destroy(); } catch {}
      flush();
      if (id) procs.delete(id);
      const body = trimOutput(out.replace(/\r\n/g, '\n').trim());
      let head;
      if (aborted) head = 'Vom Nutzer abgebrochen.';
      else if (timedOut) head = `Abgebrochen nach ${Math.round(limit / 1000)} s (Zeitlimit). Das Programm lief zu lange oder wartet auf eine Eingabe. Starte es nicht-interaktiv oder mit Optionen, die keine Rückfrage brauchen.`;
      else head = `Exit-Code: ${code}`;
      resolve({ ok: !aborted && !timedOut && code === 0, result: head + (body ? '\n--- Ausgabe ---\n' + body : '\n(keine Ausgabe)') });
    };
    child.on('close', (code) => done(code));
    child.on('exit', (code) => { exitCode = code; setTimeout(() => done(code), 1500); });
    // Stopp / Zeitlimit: nicht auf „exit“/„close“ warten, falls ein Nachzügler die Leitungen offen hält
    const hardStop = () => setTimeout(() => done(exitCode), 1200);
    if (id) procs.set(id, () => { aborted = true; killTree(child); hardStop(); });
  });
}

function whichAll(name, env) {
  return new Promise((resolve) => {
    execFile(IS_WIN ? 'where' : 'which', IS_WIN ? [name] : ['-a', name], { env, windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) return resolve([]);
      resolve(String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@/+:=-]{0,120}$/;
const MANAGERS = IS_WIN ? ['winget', 'choco', 'scoop', 'pip', 'pipx', 'npm'] : ['apt', 'brew', 'pip', 'pipx', 'npm'];

function installCommand(manager, pkg) {
  if (!MANAGERS.includes(manager)) return { error: `Paketmanager „${manager}“ wird nicht unterstützt. Möglich: ${MANAGERS.join(', ')}.` };
  if (!NAME_RE.test(String(pkg || ''))) return { error: 'Ungültiger Paketname (erlaubt sind nur Buchstaben, Ziffern und . _ - / @ + : =).' };
  const c = {
    winget: `winget install --id ${pkg} -e --accept-source-agreements --accept-package-agreements --disable-interactivity`,
    choco: `choco install ${pkg} -y --no-progress`,
    scoop: `scoop install ${pkg}`,
    apt: `sudo -n apt-get install -y ${pkg}`,
    brew: `brew install ${pkg}`,
    pip: `python -m pip install --user ${pkg}`,
    pipx: `pipx install ${pkg}`,
    npm: `npm install -g ${pkg}`,
  }[manager];
  return { command: c };
}

function inWorkspace(root, cwd) {
  if (!root) throw new Error('Kein Workspace-Ordner gewählt');
  return cwd ? safe(root, cwd) : path.resolve(root);
}

// Live-Ausgabe eines laufenden Programms an das Fenster, das es gestartet hat
const liveSender = (e, id) => (id ? (text) => { if (!e.sender.isDestroyed()) e.sender.send('sys:event', { id, type: 'data', text }); } : null);

ipcMain.handle('sys:exec', async (e, { id, root, command, shell: sh, cwd, timeout }) => {
  try {
    if (!String(command || '').trim()) return { ok: false, result: 'command darf nicht leer sein.' };
    return await runProc({ id, command: String(command), shellKind: sh, cwd: inWorkspace(root, cwd), timeoutSec: timeout, onData: liveSender(e, id) });
  } catch (e) {
    return { ok: false, result: 'Fehler: ' + e.message };
  }
});

ipcMain.handle('sys:installCmd', (_e, { manager, pkg }) => installCommand(manager, pkg));

ipcMain.handle('sys:install', async (e, { id, root, manager, pkg, timeout }) => {
  try {
    const c = installCommand(manager, pkg);
    if (c.error) return { ok: false, result: c.error };
    const env = await execEnv();
    const bin = c.command.split(' ')[0] === 'sudo' ? 'sudo' : c.command.split(' ')[0];
    const probe = manager === 'pip' ? 'python' : bin;
    if (!(await whichAll(probe, env)).length) return { ok: false, result: `„${probe}“ ist auf diesem Rechner nicht installiert, daher geht ${manager} nicht. Verfügbare Paketmanager prüfst du mit check_tool.` };
    const r = await runProc({ id, command: c.command, shellKind: 'cmd', cwd: inWorkspace(root, ''), timeoutSec: timeout || 900, onData: liveSender(e, id) });
    r.result = `Befehl: ${c.command}\n` + r.result;
    return r;
  } catch (e) {
    return { ok: false, result: 'Fehler: ' + e.message };
  }
});

ipcMain.handle('sys:which', async (_e, { name }) => {
  try {
    const env = await execEnv();
    const n = String(name || '').trim();
    const mgrs = {};
    await Promise.all(['winget', 'choco', 'scoop', 'python', 'py', 'pip', 'pipx', 'npm', 'java', 'git', 'apt', 'brew'].map(async (m) => { if ((await whichAll(m, env)).length) mgrs[m] = true; }));
    const have = Object.keys(mgrs).join(', ') || '(keine)';
    if (!n) return { ok: true, result: `Verfügbare Programme/Paketmanager: ${have}` };
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,80}$/.test(n)) return { ok: false, result: 'Ungültiger Programmname.' };
    const found = await whichAll(n, env);
    if (found.length) return { ok: true, result: `Gefunden:\n${found.join('\n')}` };
    return { ok: true, result: `„${n}“ wurde im PATH nicht gefunden. Es kann trotzdem in einem Ordner liegen, der nicht im PATH ist (z. B. in Downloads oder Programme). Verfügbare Paketmanager: ${have}. Installieren nur mit install_tool und Freigabe des Nutzers.` };
  } catch (e) {
    return { ok: false, result: 'Fehler: ' + e.message };
  }
});

ipcMain.handle('sys:abort', (_e, id) => {
  const k = procs.get(id);
  if (k) k();
  return true;
});

/* ───────────────────────── Strata-Server verwalten (CLI lokal oder per SSH) ─────────────────────────
   Starten, Stoppen, Plan, Status: das macht die Strata-CLI („strata launch …“). Laden, Entladen,
   Konfiguration und Monitoring laufen im Renderer per HTTP gegen den Server (siehe renderer/js/server.js).
   Sicherheit: nur erlaubte Unterbefehle, jedes Argument aus einer engen Zeichenmenge (keine Shell-Sonderzeichen). */

const STRATA_SUBS = new Set(['launch', 'models', 'update', 'doctor', 'connect', '--version']);
const ARG_OK = /^[A-Za-z0-9_.:@/\\=+, -]{0,400}$/;
const BIN_OK = /^[A-Za-z0-9_.:@/\\ -]{1,260}$/;
const HOST_OK = /^[A-Za-z0-9._-]{1,253}$/;
const INSTALL_URL = 'https://github.com/Niko1221/Strata/releases/latest/download/';

function checkStrataArgs(args) {
  if (!Array.isArray(args) || !args.length) throw new Error('Keine Argumente.');
  if (!STRATA_SUBS.has(args[0])) throw new Error('Unterbefehl nicht erlaubt: ' + args[0]);
  for (const a of args) {
    if (typeof a !== 'string' || !ARG_OK.test(a) || /\\$/.test(a) || /^\s|\s$/.test(a)) throw new Error('Ungültiges Zeichen oder Format im Argument: ' + String(a).slice(0, 60));
  }
}
const quoteArg = (a) => (/[ ]/.test(a) ? '"' + a + '"' : a);

function sshBase(t) {
  if (!HOST_OK.test(t.host || '')) throw new Error('Ungültiger Host.');
  if (t.user && !HOST_OK.test(t.user)) throw new Error('Ungültiger Benutzername.');
  const port = parseInt(t.port, 10) || 22;
  const a = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'StrictHostKeyChecking=accept-new', '-p', String(port)];
  if (t.key) {
    const key = String(t.key).trim().replace(/^~(?=[\\/]|$)/, require('os').homedir());
    if (!key || key.length > 400 || /[\u0000-\u001f]/.test(key) || key.startsWith('-')) throw new Error('Ungültiger Pfad zur Schlüsseldatei.');
    a.push('-i', key);
  }
  a.push((t.user ? t.user + '@' : '') + t.host);
  return a;
}

// Liefert { file, args, shellCmd, display, env } für den lokalen Start oder den SSH-Aufruf
function buildStrataJob(req) {
  const t = req.target || {};
  const remote = t.mode === 'ssh';
  const bin = (t.bin || 'strata').trim();
  if (!BIN_OK.test(bin)) throw new Error('Ungültiger Programmname/Pfad für Strata.');
  const env = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', NO_COLOR: '1', TERM: 'dumb' };

  if (req.install) {
    const sh = `d=$(mktemp -d) && curl -fsSL ${INSTALL_URL}install.sh -o "$d/install.sh" && sh "$d/install.sh"`;
    const ps = `irm ${INSTALL_URL}install.ps1 | iex`;
    if (remote) {
      const win = t.remoteOs === 'windows';
      return { file: 'ssh', args: [...sshBase(t), win ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"` : sh], display: `ssh ${t.user ? t.user + '@' : ''}${t.host}: ${win ? ps : sh}`, env };
    }
    if (IS_WIN) return { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], display: 'powershell: ' + ps, env };
    return { file: 'sh', args: ['-c', sh], display: 'sh: ' + sh, env };
  }

  checkStrataArgs(req.args);
  const line = [quoteArg(bin), ...req.args.map(quoteArg)].join(' ');
  if (remote) {
    const prefix = t.remoteOs === 'windows' ? '' : 'export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; ';
    return { file: 'ssh', args: [...sshBase(t), prefix + line], display: `ssh ${t.user ? t.user + '@' : ''}${t.host}: ${line}`, env };
  }
  if (IS_WIN) return { shellCmd: 'chcp 65001>nul & ' + line, display: line, env };
  return { file: bin, args: req.args, display: line, env: { ...env, PATH: undefined } };
}

async function startStrataJob(e, req) {
  const send = (m) => {
    if (!e.sender.isDestroyed()) e.sender.send('strata:event', { id: req.id, ...m });
  };
  let job;
  try {
    job = buildStrataJob(req);
  } catch (err) {
    send({ type: 'error', message: err.message });
    return;
  }
  send({ type: 'start', display: job.display });
  const base = await execEnv();
  const env = { ...base, ...Object.fromEntries(Object.entries(job.env || {}).filter(([, v]) => v !== undefined)) };
  if (!IS_WIN) {
    const pk = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    env[pk] = `${path.join(app.getPath('home'), '.local', 'bin')}${path.delimiter}${env[pk] || ''}`;
  }
  let child;
  try {
    const opts = { env, windowsHide: true, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] };
    child = job.shellCmd ? spawn(job.shellCmd, { ...opts, shell: true }) : spawn(job.file, job.args, opts);
  } catch (err) {
    send({ type: 'error', message: 'Start fehlgeschlagen: ' + err.message });
    return;
  }
  let timedOut = false;
  let aborted = false;
  const limit = Math.max(10, Math.min(24 * 3600, +req.timeout || 600)) * 1000;
  const timer = setTimeout(() => { timedOut = true; killTree(child); }, limit);
  procs.set(req.id, () => { aborted = true; killTree(child); setTimeout(() => { if (!finished) { try { child.stdout.destroy(); child.stderr.destroy(); } catch {} finish(null); } }, 1200); });
  const dec = { out: new TextDecoder(), err: new TextDecoder() };
  child.stdout.on('data', (b) => send({ type: 'data', text: dec.out.decode(b, { stream: true }) }));
  child.stderr.on('data', (b) => send({ type: 'data', text: dec.err.decode(b, { stream: true }) }));
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    procs.delete(req.id);
    send({ type: 'end', code, timedOut, aborted });
  };
  child.on('error', (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    procs.delete(req.id);
    send({ type: 'error', message: (err.code === 'ENOENT' ? `Programm nicht gefunden (${job.file || 'strata'}). Ist Strata installiert und im PATH?` : err.message) });
  });
  child.on('close', (code) => finish(code));
  // „strata launch --no-tui“ startet den Server im Hintergrund und kehrt zurück. Der Server erbt dabei oft die Ausgabe-Leitungen:
  // „close“ kommt dann erst, wenn der Server endet, und der Auftrag hinge ewig (kein weiterer Start möglich). Deshalb zählt „exit“
  // plus eine kurze Frist zum Auslesen der restlichen Ausgabe.
  child.on('exit', (code) => {
    setTimeout(() => {
      if (finished) return;
      try { child.stdout.destroy(); child.stderr.destroy(); } catch {}
      finish(code);
    }, 1500);
  });
}

ipcMain.handle('strata:run', (e, req) => {
  startStrataJob(e, req || {}).catch((err) => {
    if (!e.sender.isDestroyed()) e.sender.send('strata:event', { id: (req || {}).id, type: 'error', message: err.message });
  });
  return true;
});

/* ───────────────────────── Netzwerk (umgeht CORS, streamt) ───────────────────────── */

// Node-fetch (undici) bricht nach 300 s ohne Antwort-Header ab. Das Laden eines großen Modells dauert oft länger.
// Für solche Aufrufe (req.long) nutzen wir http/https direkt: keine versteckten Timeouts, nur das eigene Zeitlimit.
function longRequest(req) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(req.url); } catch (e) { return resolve({ ok: false, status: 0, error: 'Ungültige Adresse' }); }
    const lib = u.protocol === 'https:' ? https : http;
    const body = req.body === undefined || req.body === null ? null : Buffer.from(String(req.body));
    const headers = { ...(req.headers || {}) };
    if (body) headers['Content-Length'] = body.length;
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const rq = lib.request(u, { method: req.method || 'GET', headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (e) => finish({ ok: false, status: 0, error: e.message }));
    });
    const timer = setTimeout(() => { rq.destroy(); finish({ ok: false, status: 0, error: 'Zeitüberschreitung' }); }, Math.min(req.timeout || 15000, 2147483000));
    rq.on('error', (e) => finish({ ok: false, status: 0, error: `${e.message}${e.code ? ' (' + e.code + ')' : ''}` }));
    if (body) rq.write(body);
    rq.end();
  });
}

ipcMain.handle('llm:fetch', async (_e, req) => {
  if (req.long) return longRequest(req);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), req.timeout || 15000);
  try {
    const res = await fetch(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body, signal: ac.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    const code = err.cause && (err.cause.code || err.cause.message);
    return { ok: false, status: 0, error: err.name === 'AbortError' ? 'Zeitüberschreitung' : `${err.message}${code ? ' (' + code + ')' : ''}` };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('llm:stream', (e, req) => {
  const ac = new AbortController();
  aborts.set(req.id, ac);
  const send = (m) => {
    if (!e.sender.isDestroyed()) e.sender.send('llm:event', { id: req.id, ...m });
  };
  (async () => {
    try {
      const res = await fetch(req.url, { method: req.method || 'POST', headers: req.headers, body: req.body, signal: ac.signal });
      if (!res.ok) {
        const t = await res.text();
        send({ type: 'error', status: res.status, message: t.slice(0, 4000) });
        return;
      }
      const dec = new TextDecoder();
      for await (const chunk of res.body) send({ type: 'data', text: dec.decode(chunk, { stream: true }) });
      send({ type: 'end' });
    } catch (err) {
      if (err.name === 'AbortError') send({ type: 'end', aborted: true });
      else {
        const code = err.cause && (err.cause.code || err.cause.message);
        send({ type: 'error', status: 0, message: `${err.message}${code ? ' (' + code + ')' : ''}` });
      }
    } finally {
      aborts.delete(req.id);
    }
  })();
  return true;
});
ipcMain.handle('llm:abort', (_e, id) => {
  const ac = aborts.get(id);
  if (ac) ac.abort();
  return true;
});

/* ───────────────────────── Fenster / System ───────────────────────── */

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});
ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));

/* ───────────────────────── Rechtschreibprüfung ─────────────────────────
   Falsch geschriebene Wörter werden in Eingabefeldern rot wellig unterstrichen. Rechtsklick auf das Wort zeigt Vorschläge.
   Unter Windows und Linux lädt Chromium die Wörterbücher beim ersten Mal selbst herunter (Internet nötig), danach sind sie lokal. */
const SPELL_LANGS = { de: ['de'], 'de-en': ['de', 'en-US'], en: ['en-US'] };
function applySpell({ enabled, lang }) {
  try {
    if (!win || win.isDestroyed()) return false;
    const ses = win.webContents.session;
    ses.setSpellCheckerEnabled(enabled !== false);
    const avail = ses.availableSpellCheckerLanguages || [];
    const want = (SPELL_LANGS[lang] || SPELL_LANGS['de-en']).map((l) => (avail.includes(l) ? l : avail.find((a) => a.toLowerCase().startsWith(l.slice(0, 2).toLowerCase())))).filter(Boolean);
    if (want.length) ses.setSpellCheckerLanguages([...new Set(want)]);
    return true;
  } catch (e) {
    console.error('Rechtschreibprüfung:', e && e.message);
    return false;
  }
}
ipcMain.handle('app:spellSet', (_e, o) => applySpell(o || {}));

// Kontextmenü (Rechtsklick): Rechtschreib-Vorschläge, Ausschneiden/Kopieren/Einfügen
function showContextMenu(w, params) {
  const items = [];
  const wc = w.webContents;
  if (params.isEditable && params.misspelledWord) {
    const sug = params.dictionarySuggestions || [];
    if (sug.length) sug.slice(0, 6).forEach((sg) => items.push({ label: sg, click: () => wc.replaceMisspelling(sg) }));
    else items.push({ label: 'Keine Vorschläge', enabled: false });
    items.push({ label: 'Zum Wörterbuch hinzufügen', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
    items.push({ type: 'separator' });
  }
  if (params.isEditable) {
    items.push({ label: 'Ausschneiden', role: 'cut', enabled: !!params.editFlags.canCut });
    items.push({ label: 'Kopieren', role: 'copy', enabled: !!params.editFlags.canCopy });
    items.push({ label: 'Einfügen', role: 'paste', enabled: !!params.editFlags.canPaste });
    items.push({ type: 'separator' });
    items.push({ label: 'Alles auswählen', role: 'selectAll' });
  } else if (params.selectionText && params.selectionText.trim()) {
    items.push({ label: 'Kopieren', role: 'copy' });
  }
  if (!items.length) return;
  Menu.buildFromTemplate(items).popup({ window: w });
}
// GPU-Beschleunigung der Oberfläche (Datei „disable-gpu.flag“ im Datenordner, wirkt nach Neustart)
const gpuFlagFile = () => path.join(app.getPath('userData'), 'disable-gpu.flag');
ipcMain.handle('app:gpuGet', () => !fs.existsSync(gpuFlagFile()));
ipcMain.handle('app:gpuSet', (_e, on) => {
  try {
    if (on) fs.rmSync(gpuFlagFile(), { force: true });
    else fs.writeFileSync(gpuFlagFile(), '1');
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: dataDir(), electron: process.versions.electron, platform: process.platform }));
let winMaterial = 'none';
let lastBgColor = '#f3f5fb';
ipcMain.handle('win:theme', (_e, { color, symbolColor, dark }) => {
  nativeTheme.themeSource = dark ? 'dark' : 'light';
  if (win && process.platform === 'win32') {
    lastBgColor = color;
    try {
      win.setTitleBarOverlay({ color, symbolColor, height: 38 });
      if (winMaterial === 'none') win.setBackgroundColor(color);
    } catch {}
  }
  return true;
});
// Windows 11 22H2+: Acrylic/Mica als Fensterhintergrund, damit transparente Farben den Desktop durchscheinen lassen
ipcMain.handle('win:material', (_e, m) => {
  if (!win || process.platform !== 'win32' || typeof win.setBackgroundMaterial !== 'function') return false;
  const mat = ['none', 'acrylic', 'mica', 'tabbed'].includes(m) ? m : 'none';
  try {
    win.setBackgroundMaterial(mat);
    winMaterial = mat;
    win.setBackgroundColor(mat === 'none' ? lastBgColor : '#00000000');
    return true;
  } catch {
    return false;
  }
});

const boundsFile = () => path.join(dataDir(), 'window.json');

async function createWindow() {
  const b = await readJson(boundsFile(), { width: 1320, height: 840 });
  // gespeicherte Position verwerfen, wenn sie auf keinem Bildschirm mehr liegt (z. B. nach Monitorwechsel)
  try {
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const w = d.workArea;
        return b.x >= w.x - 50 && b.y >= w.y - 50 && b.x < w.x + w.width - 100 && b.y < w.y + w.height - 100;
      });
      if (!visible) {
        delete b.x;
        delete b.y;
      }
    }
    if (!(b.width >= 860 && b.width <= 10000)) b.width = 1320;
    if (!(b.height >= 560 && b.height <= 10000)) b.height = 840;
  } catch {}
  win = new BrowserWindow({
    width: b.width || 1320,
    height: b.height || 840,
    x: b.x,
    y: b.y,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#ffffff',
    title: 'LLM Box – Reuschler-IT',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f3f5fb', symbolColor: '#4a5478', height: 38 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  applySpell({ enabled: true, lang: 'de-en' }); // Standard, bis die Oberfläche ihre gespeicherte Einstellung meldet
  win.webContents.on('context-menu', (_e, params) => showContextMenu(win, params));
  if (b.maximized) win.maximize();
  const showWin = () => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', showWin);
  setTimeout(showWin, 4000); // Fallback, falls ready-to-show nie eintrifft
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('Laden fehlgeschlagen:', code, desc, url);
    showWin();
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('Renderer beendet:', d && d.reason);
    showWin();
  });
  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    if (level >= 2) console.error(`[Renderer] ${msg} (${src}:${line})`);
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch((err) => {
    console.error('loadFile-Fehler:', err);
    showWin();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith('file://')) {
      ev.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (devtools) win.webContents.toggleDevTools();
    if (input.control && input.key.toLowerCase() === 'r') win.webContents.reload();
  });
  // Zurück ins Fenster -> Chats sofort abgleichen (statt bis zum naechsten Tick zu warten).
  win.on('focus', () => { syncNow(); });
  win.on('close', () => {
    try {
      const bb = win.getNormalBounds();
      fs.writeFileSync(boundsFile(), JSON.stringify({ ...bb, maximized: win.isMaximized() }));
    } catch {}
  });
  win.on('closed', () => {
    win = null;
  });
}

if (gotLock) app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
