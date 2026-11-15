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

async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fsp.rename(tmp, file);
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
// Liest alle Meta-Dateien. null = Ordner gerade nicht lesbar (Netzlaufwerk getrennt): dann NICHTS als gelöscht behandeln
async function listMetas(dir) {
  let files;
  try { files = await fsp.readdir(dir); } catch (e) { return e.code === 'ENOENT' && dir === localChatsDir() ? [] : null; }
  const out = await Promise.all(files.filter((f) => f.endsWith('.meta.json')).map((f) => readJson(path.join(dir, f), null)));
  return out.filter((m) => m && m.id);
}
function resetSyncState() { known.clear(); seen.clear(); metaChecked = ''; baseline = false; }

ipcMain.handle('chats:list', async () => {
  const dir = chatsDir();
  await ensureMetas(dir);
  const metas = await listMetas(dir);
  if (!metas) return [];
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

// Gemeinsamer Ordner: Einstellung, Umzug der lokalen Chats und Änderungserkennung (alle 3 s, nur wenn aktiv)
ipcMain.handle('sync:get', () => { const c = loadSyncCfg(); return { dir: c.dir || '', deviceId: c.deviceId, deviceName: deviceName(), localDir: localChatsDir(), folder: chatsDir() }; });
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
  const metas = (await listMetas(src)) || [];
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
setInterval(async () => {
  const c = loadSyncCfg();
  if (!c.dir || !win || win.isDestroyed() || pollBusy) return;
  pollBusy = true;
  try {
    const dir = chatsDir();
    const metas = await listMetas(dir);
    if (!metas) return; // Ordner nicht lesbar (z. B. Netzlaufwerk getrennt): nichts ableiten
    if (!baseline) { metas.forEach((m) => seen.set(m.id, m.rev || 0)); baseline = true; return; }
    const changed = [];
    const ids = new Set();
    for (const m of metas) {
      ids.add(m.id);
      if (seen.get(m.id) !== (m.rev || 0) && m.dev !== c.deviceId) changed.push(m);
      seen.set(m.id, m.rev || 0);
    }
    const removed = [...seen.keys()].filter((id) => !ids.has(id));
    removed.forEach((id) => { seen.delete(id); known.delete(id); });
    if (changed.length || removed.length) win.webContents.send('chats:changed', { metas: changed, removed });
  } catch {} finally { pollBusy = false; }
}, 3000);


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
