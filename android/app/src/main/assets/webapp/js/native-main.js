/* native-main.js – portierter Hauptprozess aus main.js der Desktop-Version.
   Läuft in der WebView und stellt window.api bereit (gleiche Signaturen wie preload.js).
   Dateisystem, HTTP und Dialoge laufen über die native Brücke (MainActivity.Bridge). */
'use strict';

(function () {
  const path = require('path');
  const fsp = require('fs/promises');
  const DOCS = globalThis.DOCS;
  const Buffer = globalThis.Buffer;

  // Kennzeichnung für die Desktop-Oberfläche: Android hat keine Befehlsausführung und kein SSH.
  window.IS_ANDROID = true;

  let INFO = { version: '1.0.50-android', dataDir: '', workspaceRoot: '', electron: '', platform: 'android', osLabel: 'Android', deviceName: '' };
  try {
    const r = __nativeCall('appInfo');
    if (r && !r.error) INFO = Object.assign(INFO, r);
  } catch {}

  const dataDir = () => INFO.dataDir || '/data';
  const localChatsDir = () => path.join(dataDir(), 'chats');
  const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  const deviceName = () => INFO.deviceName || 'Android-Gerät';

  /* ───────────────────────── Speicher ───────────────────────── */

  async function writeJsonAtomic(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    // Eigener Name pro Vorgang: beim automatischen Speichern laufen mehrere Schreibvorgaenge
    // fuer dieselbe Datei parallel. Wuerden sie sich eine .tmp-Datei teilen, wuerde der zweite
    // Umbenennen-Vorgang eine bereits verschobene Datei vorfinden und fehlschlagen.
    const tmp = `${file}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data));
    try {
      await fsp.rename(tmp, file);
    } catch (e) {
      // Schlaegt das Umbenennen fehl (z. B. auf einer Windows-Freigabe), darf keine
      // .tmp-Datei zurueckbleiben: die Chat-Liste entsteht aus den fertigen Meta-Dateien,
      // ein Rest darin wirkt wie ein halbfertiger Chat und muellt die Freigabe voll.
      try { await fsp.rm(tmp, { force: true }); } catch {}
      throw e;
    }
  }

  async function readJson(file, fallback) {
    try {
      return JSON.parse(Buffer.from(await fsp.readFile(file)).toString('utf8'));
    } catch {
      return fallback;
    }
  }

  /* ───── Geräteübergreifende Chats (V44) ─────
     Einstellungen bleiben je Gerät getrennt, nur die Chats können in einem gemeinsamen
     Ordner liegen (NAS / Windows-Freigabe). Pro Chat zwei Dateien: <id>.json und
     <id>.meta.json. Bewusst KEINE gemeinsame Index-Datei – die würde zwischen zwei
     Rechnern ständig kollidieren; die Liste entsteht aus den kleinen Meta-Dateien. */
  const syncFile = () => path.join(dataDir(), 'sync.json');
  let syncCfg = null;
  function rndHex(n) {
    let s = '';
    while (s.length < n) s += Math.random().toString(16).slice(2);
    return s.slice(0, n);
  }
  async function getSyncCfg() {
    if (syncCfg) return syncCfg;
    let c = await readJson(syncFile(), null);
    if (!c || typeof c !== 'object') c = {};
    if (!c.deviceId) {
      c.deviceId = rndHex(12);
      try { await writeJsonAtomic(syncFile(), c); } catch {}
    }
    syncCfg = c;
    return c;
  }
  const saveSyncCfg = async () => { try { await writeJsonAtomic(syncFile(), syncCfg); } catch {} };
  async function chatsDir() { const c = await getSyncCfg(); return c.dir ? path.join(c.dir, 'LLM-Box-Chats') : localChatsDir(); }

  /* ───── Abgleich-Rhythmus ─────
     Frueher fest verdrahtet (Android alle 5 s). Jetzt wählbar von "Echtzeit" bis 30 Minuten,
     genau wie in der Windows-App. Der Wert liegt in sync.json – dort stehen auch Geräte-ID
     und gemeinsamer Ordner –, dadurch braucht die Oberfläche nur api.sync.get() und
     api.sync.setEvery() und dieselbe Einstellung gilt in beiden Apps. */
  const SYNC_MIN_MS = 1000;                 // unter 1 s bringt nichts und belastet die Freigabe nur
  const SYNC_MAX_MS = 30 * 60 * 1000;       // 30 Minuten, die langsamste Stufe
  const SYNC_DEFAULT_MS = 2000;             // "Echtzeit": beide Geräte reagieren praktisch sofort
  /* Tempo-Cache: der nachlaufende Timer darf NICHT davon abhaengen, ob das Lesen der
     Einstellung fertig ist. Frueher wartete schedulePoll() auf getSyncCfg(); wurde diese
     Anfrage langsam oder hing sie, kam gar kein setTimeout zustande und der Abgleich blieb
     komplett stehen (am Gerat sichtbar als "0 Abgleiche"). Jetzt startet die Kette sofort mit
     dem Standardwert und korrigiert sich, sobald sync.json gelesen ist. */
  let everyMsCached = 0;
  function validEvery(v) { const x = Math.round(+v); return (x >= SYNC_MIN_MS && x <= SYNC_MAX_MS) ? x : 0; }
  function currentEvery() { return everyMsCached || SYNC_DEFAULT_MS; }
  async function syncEveryMs() {
    // Ein Fehler beim Lesen der Einstellung darf den Abgleich nicht dauerhaft stoppen:
    // ohne Fallback wurde sonst der naechste Timer gar nicht mehr geplant.
    let v = 0;
    try { v = validEvery((await getSyncCfg()).everyMs); } catch {}
    if (v) everyMsCached = v;
    return currentEvery();
  }

  const metaFileIn = (dir, id) => path.join(dir, safeId(id) + '.meta.json');
  const chatFileIn = (dir, id) => path.join(dir, safeId(id) + '.json');
  const known = new Map();   // id -> Revision, die DIESES Gerät zuletzt gelesen oder geschrieben hat
  const seen = new Map();    // id -> Revision beim letzten Abgleich (Änderungserkennung)
  let metaChecked = '';
  let baseline = false;

  function resetSyncState() { known.clear(); seen.clear(); metaChecked = ''; baseline = false; }

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
      const cfg = await getSyncCfg();
      await writeJsonAtomic(metaFileIn(dir, id), { ...m, rev: 1, dev: cfg.deviceId, devName: deviceName() });
    }
    metaChecked = dir;
  }

  /* Liest alle Meta-Dateien. Rueckgabe { metas, blockiert } oder null, wenn der Ordner selbst
     nicht lesbar ist (Freigabe getrennt) - dann darf NICHTS als gelöscht gelten.

     "blockiert" ist der wichtige Teil: eine Meta-Datei kann in dem Moment gesperrt sein, in dem
     wir sie lesen (Netzfreigabe/Virenscanner). readJson() wirft so einen Fehler weg und liefert
     null - der Chat fehlt dann in dieser Runde, der Abgleich hält ihn für GELÖSCHT, in der
     nächsten Runde gilt er wieder als GEÄNDERT, und die Oberfläche baut Chatliste und
     Nachrichtenliste neu auf, während der Nutzer tippt. Gemessen 14.11. unter Windows: 6 von
     15 Meta-Dateien waren im laufenden Betrieb gesperrt (EPERM). Dieselbe Falle gilt hier. */
  const META_SUFFIX = '.meta.json';
  /* Zuletzt erfolgreich gelesene Meta-Dateien. Ist eine Datei in diesem Moment gesperrt, wird der
     bekannte Stand weiterverwendet: der Chat bleibt in der Liste und der Abgleich vergleicht mit
     dem richtigen Stand, statt ihn als geloescht/geaendert zu melden. */
  const metaCache = new Map();   // "Ordner|Chat-ID" -> Meta. Nach Ordnerwechsel (lokal <-> Freigabe)
                                 // duerfen keine Staende aus dem anderen Ordner verwendet werden.
  async function listMetas(dir) {
    let files;
    try { files = await fsp.readdir(dir); } catch (e) { return e && e.code === 'ENOENT' && dir === localChatsDir() ? { metas: [], blockiert: [] } : null; }
    const metas = [];
    const blockiert = [];
    for (const f of files.filter((x) => x.endsWith(META_SUFFIX))) {
      let m = null, fehler = '';
      try { m = JSON.parse(Buffer.from(await fsp.readFile(path.join(dir, f))).toString('utf8')); }
      catch (e) { fehler = (e && (e.code || e.message)) || ''; }
      const id = f.slice(0, -META_SUFFIX.length);
      const key = dir + '|' + id;
      if (m && m.id) { metaCache.set(key, m); metas.push(m); continue; }
      // Wirklich verschwunden ist echt weg; eine Sperre ist nur ein Moment und hält den Chat offen.
      if (/ENOENT|nicht gefunden/i.test(fehler)) continue;
      const alt = metaCache.get(key);
      if (alt) metas.push(alt); else blockiert.push(id);
    }
    return { metas, blockiert };
  }

  const store = {
    async get(name) { return readJson(path.join(dataDir(), safeId(name) + '.json'), null); },
    async set(name, data) { await writeJsonAtomic(path.join(dataDir(), safeId(name) + '.json'), data); return true; },
  };

  const chats = {
    async list() {
      const dir = await chatsDir();
      await ensureMetas(dir);
      const fund = await listMetas(dir);
      if (!fund) return [];
      const metas = fund.metas;
      for (const m of metas) seen.set(m.id, m.rev || 0);
      baseline = true;
      return metas.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    },
    async load(id) {
      const dir = await chatsDir();
      const c = await readJson(chatFileIn(dir, id), null);
      const m = await readJson(metaFileIn(dir, id), null);
      if (c) known.set(safeId(id), (m && m.rev) || 0);
      return c;
    },
    async save(chat, meta) {
      const dir = await chatsDir();
      const cfg = await getSyncCfg();
      let id = safeId(chat.id);
      const cur = await readJson(metaFileIn(dir, id), null);
      let conflict = null;
      // Hat ein anderer Rechner geändert, seit dieses Gerät zuletzt gelesen/geschrieben hat:
      // nichts überschreiben, sondern die eigene Fassung als Kopie sichern.
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
    },
    async delete(id) {
      const dir = await chatsDir();
      known.delete(safeId(id));
      seen.delete(safeId(id));
      await fsp.rm(chatFileIn(dir, id), { force: true });
      await fsp.rm(metaFileIn(dir, id), { force: true });
      return true;
    },
    async deleteAll() {
      resetSyncState();
      await fsp.rm(await chatsDir(), { recursive: true, force: true });
      return true;
    },
    async importPick() {
      const picked = await pickFilesDialog();
      if (!picked) return null;
      const out = [];
      for (const f of picked) {
        try {
          if (f.error) { out.push({ name: f.name, error: f.error }); continue; }
          const st = await fsp.stat(f.path);
          if (st.size > 200 * 1024 * 1024) { out.push({ name: f.name, error: 'Datei ist größer als 200 MB.' }); continue; }
          out.push({ name: f.name, text: Buffer.from(await fsp.readFile(f.path)).toString('utf8') });
        } catch (e) {
          out.push({ name: f.name, error: e.message });
        }
      }
      return out;
    },
  };

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
      const buf = Buffer.from(await fsp.readFile(abs));
      return { ...base, kind: 'image', dataUrl: `data:${IMG_MIME[ext]};base64,${buf.toString('base64')}` };
    }
    if (DOCS.isDoc(ext)) {
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
    const buf = Buffer.from(await fsp.readFile(abs));
    const dec = DOCS.decodeText(buf);
    if (dec === null) return { ...base, kind: 'skip', reason: 'Binärdatei (nicht unterstützt)' };
    return { ...base, kind: 'text', text: dec };
  }

  async function collectFolder(absRoot, prefix, lim, acc) {
    const ignore = ignoreSet(lim.ignore);
    async function walk(dir, rel) {
      let entries;
      try {
        entries = await fsp.readdirWithFileTypes(dir);
      } catch {
        return;
      }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const en of entries) {
        if (acc.truncated) return;
        if (ignore.has(en.name)) continue;
        const abs = path.join(dir, en.name);
        const r = rel ? rel + '/' + en.name : en.name;
        if (en.isDirectory()) await walk(abs, r);
        else if (en.isFile()) {
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

  async function readPaths(paths_, lim) {
    const acc = { files: [], skipped: [], truncated: false, totalBytes: 0 };
    for (const p of paths_) {
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

  /* ── Auswahldialoge über die native Brücke ── */

  let pickWaiter = null;
  window.__pickResult = (r) => { const w = pickWaiter; pickWaiter = null; if (w) w(r); };
  function waitPick() {
    return new Promise((res) => {
      pickWaiter = res;
      setTimeout(() => { if (pickWaiter === res) { pickWaiter = null; res(null); } }, 300000);
    });
  }
  async function pickFilesDialog() {
    __nativeCall('pickFiles');
    const r = await waitPick();
    return Array.isArray(r) ? r : null;
  }

  async function pickFolderDialog(lim) {
    __nativeCall('pickFolder');
    const r = await waitPick();
    if (!r || !Array.isArray(r) || !r.length) {
      // Ein Fehlerobjekt der Brücke darf nicht kommentarlos als "abgebrochen" enden –
      // sonst wirkt es, als wäre die Auswahl einfach ignoriert worden.
      if (r && typeof r === 'object' && r.error && typeof window.toast === 'function') {
        toast('Ordner konnte nicht übernommen werden: ' + r.error, 6000);
      }
      return null;
    }
    const root = r[0].root;
    if (!lim) {
      if (typeof window.toast === 'function' && r[0].files != null) toast(`${r[0].files} Dateien in den App-Speicher kopiert`, 3500);
      return r[0];
    }
    const acc = { files: [], skipped: [], truncated: false, totalBytes: 0 };
    await collectFolder(root, r[0].name || path.basename(root), lim, acc);
    return acc;
  }

  let saveWaiter = null;
  window.__saveResult = (r) => { const w = saveWaiter; saveWaiter = null; if (w) w(r); };
  async function saveAsDialog(o) {
    o = o || {};
    const b64 = o.base64 != null ? String(o.base64) : globalThis.__bytesToB64(new TextEncoder().encode(String(o.content == null ? '' : o.content)));
    return new Promise((res) => {
      saveWaiter = (r) => res(r && r.ok ? (r.path || true) : null);
      try { __nativeCall('saveAs', String(o.defaultName || 'datei.txt'), b64); }
      catch (e) { const w = saveWaiter; saveWaiter = null; if (w) w(null); }
      setTimeout(() => { if (saveWaiter) { saveWaiter = null; res(null); } }, 300000);
    });
  }

  const files = {
    async pick(mode, lim) {
      if (mode === 'folder') return pickFolderDialog(lim);
      const picked = await pickFilesDialog();
      if (!picked || !picked.length) return null;
      return readPaths(picked.filter((p) => p.path).map((p) => p.path), lim);
    },
    async read(paths_, lim) { return readPaths(Array.isArray(paths_) ? paths_ : [paths_], lim); },
    async pickFolder() { const r = await pickFolderDialog(null); return r && r.root ? r.root : null; },
    saveAs(o) { return saveAsDialog(o); },
    pathOf(file) {
      // Auf Android gibt es keinen Dateipfad aus einem Drag&Drop-Objekt.
      try { if (file && typeof file === 'object' && file.__path) return file.__path; } catch {}
      return '';
    },
  };

  const cfg = {
    async pick() {
      const picked = await pickFilesDialog();
      return picked && picked.length ? picked[0].path || null : null;
    },

    async ctx(file) {
      try {
        const j = JSON.parse(Buffer.from(await fsp.readFile(String(file))).toString('utf8'));
        const lists = [j.args, j.args_written].filter(Array.isArray);
        for (const a of lists) {
          const i = a.indexOf('--max-context');
          if (i >= 0 && +a[i + 1] > 0) return { ok: true, ctx: +a[i + 1], name: j.model_name || '' };
        }
        return { ok: false, error: 'In der Datei steht kein „--max-context“ unter „args“.' };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };

  /* ───── Gemeinsamer Chat-Ordner: Einstellung, Umzug, Änderungserkennung (V44) ───── */

  const sync = {
    async get() {
      const c = await getSyncCfg();
      return { dir: c.dir || '', deviceId: c.deviceId, deviceName: deviceName(), localDir: localChatsDir(), folder: await chatsDir(), everyMs: await syncEveryMs() };
    },
    /* Rhythmus umstellen. Bereichsprüfung wie in der Windows-App, damit ein falsch gesetzter
       Wert (Vertippen, importierte Einstellungen) den Abgleich nicht lahmlegt oder die
       Freigabe mit Sekundentakten zumüllt. */
    async setEvery(ms) {
      const v = Math.round(+ms);
      if (!(v >= SYNC_MIN_MS && v <= SYNC_MAX_MS)) return { ok: false, error: `Abstand zwischen ${SYNC_MIN_MS / 1000} Sekunden und ${SYNC_MAX_MS / 60000} Minuten erlaubt` };
      const c = await getSyncCfg();
      c.everyMs = v;
      // Der Cache muss sofort mitgezogen werden: schedulePoll(v) plant nur DENEN einen Lauf
      // mit dem neuen Wert, jeder weitere nimmt currentEvery(). Ohne diese Zeile galt die neue
      // Stufe am Gerat genau einmal und fiel dann auf das alte Tempo zurueck (gemessen 14.11.).
      everyMsCached = v;
      await saveSyncCfg();
      // Der Stand des anderen Geräts wurde nach einer Tempo-Aenderung nicht neu bewertet:
      // Zustand zuruecksetzen, damit der naechste Abgleich erneut vergleicht statt Luecken zu sehen.
      resetSyncState();
      schedulePoll(v);   // neue Geschwindigkeit wirkt sofort, nicht erst beim naechsten Tick
      return { ok: true, everyMs: v };
    },
    async setDir(dir) {
      const c = await getSyncCfg();
      if (dir) {
        // Der Unterordner wird immer selbst angehaengt. Wer ihn bereits mit eingibt
        // (z. B. den Pfad aus der Statuszeile zurueckkopiert), bekaeme sonst
        // "LLM-Box-Chats\LLM-Box-Chats" - zwei getrennte Chat-Sammlungen, die sich
        // nie abgleichen. Deshalb einmal sauber abschneiden.
        dir = String(dir).replace(/[\\/]+$/, '').replace(/[\\/]+LLM-Box-Chats$/i, '');
        try {
          await fsp.mkdir(path.join(dir, 'LLM-Box-Chats'), { recursive: true });
          const t = path.join(dir, 'LLM-Box-Chats', '.schreibtest-' + c.deviceId);
          await fsp.writeFile(t, 'x');
          await fsp.rm(t, { force: true });
        } catch (e) { return { ok: false, error: 'Der Ordner ist nicht beschreibbar: ' + e.message }; }
        c.dir = dir;
      } else delete c.dir;
      await saveSyncCfg();
      resetSyncState();
      return { ok: true, folder: await chatsDir() };
    },
    // Lokale Chats in den gemeinsamen Ordner kopieren (vorhandene werden nicht überschrieben)
    async migrate() {
      const c = await getSyncCfg();
      if (!c.dir) return { ok: false, error: 'Es ist kein gemeinsamer Ordner gewählt.' };
      const src = localChatsDir();
      const dst = await chatsDir();
      await ensureMetas(src);
      let n = 0;
      let skipped = 0;
      // Fehler werden gesammelt zurueckgegeben. Frueher verswand jeder Fehler in einem leeren
      // catch: die App meldete "0 Chats kopiert", obwohl ein Teil der Dateien laengst in der
      // Freigabe lag (und umgekehrt war nicht erkennbar, warum nichts ankam).
      const fehlgeschlagen = [];
      const metas = ((await listMetas(src)) || {}).metas || [];
      for (const m of metas) {
        if (await fileExists(metaFileIn(dst, m.id))) { skipped++; continue; }
        try {
          await fsp.mkdir(dst, { recursive: true });
          await fsp.writeFile(chatFileIn(dst, m.id), Buffer.from(await fsp.readFile(chatFileIn(src, m.id))));
          await writeJsonAtomic(metaFileIn(dst, m.id), { ...m, rev: 1, dev: c.deviceId, devName: deviceName() });
          n++;
        } catch (e) {
          fehlgeschlagen.push({ id: m.id, title: m.title || '', error: (e && e.message) || String(e) });
        }
      }
      resetSyncState();
      return { ok: true, copied: n, skipped, fehlgeschlagen };
    },
  };

  async function fileExists(p) {
    try { await fsp.stat(p); return true; } catch { return false; }
  }

  /* Aufräumen: .tmp-Reste fehlgeschlagener Speichervorgänge.
     Blieben sie früher ungelesen in der Freigabe liegen, weil das Umbenennen (und damit das
     atomare Speichern) fehlschlug. Gelöscht wird nur, was nachweisbar alt ist und dessen
     Zeitstempel lesbar ist – eine gerade auf einem anderen Rechner geschriebene Datei bleibt
     so in Ruhe. */
  let tmpCleaned = '';
  async function cleanupTmp(dir) {
    if (tmpCleaned === dir) return;
    tmpCleaned = dir;
    let files = [];
    try { files = await fsp.readdir(dir); } catch { return; }
    for (const f of files.filter((x) => /\.json\.[a-z0-9]+\.tmp$/i.test(x))) {
      try {
        const st = await fsp.stat(path.join(dir, f));
        if (st && st.mtimeMs > 0 && Date.now() - st.mtimeMs > 10 * 60 * 1000) {
          await fsp.rm(path.join(dir, f), { force: true });
        }
      } catch {}
    }
  }

  /* Änderungserkennung: dauerhafter Abgleich im Hintergrund im gewählten Rhythmus, sobald ein
     gemeinsamer Ordner aktiv ist. Laeuft still – ohne Rueckmeldung an den Nutzer, weil
     das sonst bei jedem Chat auf zwei Geraeten staendig poppt. */
  let pollBusy = false;
  /* Wie oft wurde dieses Skript in dieser WebView ausgefuehrt? Jede Ausfuehrung bringt ihre
     eigenen Variablen und ihren eigenen Timer mit. Zwei Ausfuehrungen (z. B. weil die Seite
     neu geladen wurde) wuerden zwei unabhaengige Abgleich-Ketten erzeugen, die sich gegenseitig
     das Tempo "kaputt" melden - genau das sah am Gerat seltsam aus. */
  window.__nativeInstances = (window.__nativeInstances || 0) + 1;
  const INSTANCE_ID = window.__nativeInstances;
  /* Messgroesse fuer den Rhythmus: jeder Abgleich-Lauf merkt sich seinen Zeitstempel.
     So laesst sich am Gerat nachweisen, dass die gewaehlte Stufe wirklich eingehalten wird
     (testweise auch in tools-android\test-sync.js). Die Zahl bleibt klein, sie kostet keinen
     Speicher und veraendert am Abgleich selbst nichts. */
  const tickTimes = [];
  function noteTick() {
    tickTimes.push(Date.now());
    while (tickTimes.length > 40) tickTimes.shift();
  }
  /* Diagnose fuer den Timer selbst: wurde geplant, und ist der geplante Lauf wirklich
     angekommen? Ohne diese Zahlen war am Gerat nicht unterscheidbar, ob gar nicht geplant
     wurde oder Android den Timeout verworfen hat (beides sieht nach "0 Abgleichen" aus). */
  let schedCount = 0, runCount = 0, lastWait = null, timerStart = Date.now();
  const schedBy = [];
  window.__syncTicks = () => {
    const gaps = [];
    for (let i = 1; i < tickTimes.length; i++) gaps.push(tickTimes[i] - tickTimes[i - 1]);
    /* anzahl ist nach oben begrenzt (tickTimes) - die aussagekraeftigen Werte sind deshalb
      "gelaufen" (alle Abgleich-Laeufe seit dem Start) und "abstaende". */
    return JSON.stringify({ anzahl: tickTimes.length, abstaende: gaps.slice(-12), geplant: schedCount, gelaufen: runCount, letzteWartezeit: lastWait, seitMs: Date.now() - timerStart, instanz: INSTANCE_ID, cacherhythmus: currentEvery(), werPlante: schedBy.slice(-3) });
  };
  window.__syncTicksReset = () => { tickTimes.length = 0; return 'zurueckgesetzt'; };

  async function pollChats() {
    noteTick();                       // jeder Abgleich-Lauf, egal ob vom Timer oder von Hand angestossen
    const c = await getSyncCfg();
    /* Nebenbei den Tempo-Cache aus sync.json auffrischen: so wirkt eine von aussen geaenderte
       Einstellung (z. B. importierte sync.json) spaetestens nach einem Lauf, ohne dass der
       Timer fuer das Lesen warten muss. */
    const ev = validEvery(c.everyMs);
    if (ev) everyMsCached = ev;
    if (!c.dir || pollBusy) return;
    pollBusy = true;
    try {
      const dir = await chatsDir();
      cleanupTmp(dir);                          // nebenbei, blockiert den Abgleich nicht
      const fund = await listMetas(dir);
      if (!fund) return;                        // Ordner nicht lesbar (Freigabe getrennt): nichts ableiten
      const metas = fund.metas;
      if (!baseline) { metas.forEach((m) => seen.set(m.id, m.rev || 0)); baseline = true; return; }
      const changed = [];
      const ids = new Set();
      for (const m of metas) {
        ids.add(m.id);
        if (seen.get(m.id) !== (m.rev || 0) && m.dev !== c.deviceId) changed.push(m);
        seen.set(m.id, m.rev || 0);
      }
      /* Gesperrte Meta-Dateien gelten NICHT als entfernt - sonst verschwindet derselbe Chat im
           Sekundentakt aus der Liste und taucht wieder auf (Flattern, Neuaufbau der Oberflaeche). */
      const blockiert = new Set(fund.blockiert);
      const removed = [...seen.keys()].filter((id) => !ids.has(id) && !blockiert.has(id));
      removed.forEach((id) => { seen.delete(id); known.delete(id); });
      if (changed.length || removed.length) notifyChatsChanged({ metas: changed, removed, silent: true });
    } catch {} finally { pollBusy = false; }
  }
  /* Ein nachlaufender Timer statt setInterval: bei langen Abständen (bis 30 Minuten) darf ein
     einmal gestellter Timer nicht weiterlaufen, nachdem der Nutzer das Tempo geändert hat –
     sonst galt die neue Einstellung erst nach Stunden. Jeder Lauf plant den nächsten neu ein. */
  let pollTimer = null;
  /* Ein nachlaufender Timer statt setInterval: bei langen Abständen (bis 30 Minuten) darf ein
     einmal gestellter Timer nicht weiterlaufen, nachdem der Nutzer das Tempo geändert hat –
     sonst galt die neue Einstellung erst nach Stunden. Jeder Lauf plant den nächsten neu ein.

     Die Generationen-Marke (pollGen) ist wichtig: waehrend ein Abgleich laeuft, kann der
     Nutzer das Tempo aendern. Der alte, gerade laufende Lauf darf dann KEINEN weiteren Timer
     mehr setzen - sonst liefen zwei Ketten parallel und die Abstaende stimmten nicht (im Test
     am 14.11. sichtbar als Wechsel von ~0,5 s und ~5 s bei eingestellter Sekunde). */
  let pollGen = 0;
  function schedulePoll(delayMs) {
    if (pollTimer) clearTimeout(pollTimer);
    const wait = validEvery(delayMs) || currentEvery();
    schedCount++; lastWait = wait;
    /* Diagnose: wer plant neu ein? Ohne diese Information war am Gerat nicht zu erklaeren,
       warum die Kette nach setEvery(60000) im Sekunden-Takt weiterlief. */
    try { schedBy.push((new Error().stack || '').split('\n').slice(2, 4).join(' | ').replace(/\s+/g, ' ').slice(0, 150)); } catch {}
    while (schedBy.length > 6) schedBy.shift();
    const gen = ++pollGen;
    // Ein Fehler im Abgleich darf die Kette nicht beenden: ohne catch waere der naechste
    // Lauf nie geplant worden und der Sync ware still stehen geblieben.
    pollTimer = setTimeout(() => {
      runCount++;
      Promise.resolve().then(pollChats).catch(() => {}).then(() => { if (gen === pollGen) schedulePoll(); });
    }, wait);
  }

  /* Sofortiger Abgleich beim Zurückkehren in die App: ohne diesen Anstoss wartete die
     Oberflaeche bis zum naechsten Tick und wirkte veraltet. Bewusst KEIN resetSyncState() –
     das wuerde den gerade gesehenen Stand vergessen und genau die Aenderung verschlucken,
     die man sofort sehen will. */
  window.__syncNow = () => { pollChats(); };
  schedulePoll();

  const chatListeners = [];
  function notifyChatsChanged(m) { for (const cb of chatListeners) { try { cb(m); } catch {} } }

  /* ───────────────────────── Workspace (Werkzeuge für die KI) ───────────────────────── */

  // Obergrenze fuer Dateien, die zum Lesen oder Aendern komplett in den Speicher geholt werden.
  // Auf dem Handy ist der Speicher einer WebView klein; eine halbe Gigabyte große Log-Datei
  // wuerde die App sonst scheinen lassen als wäre sie eingefroren (oder ganz beenden).
  const MAX_TEXT_BYTES = 20 * 1024 * 1024;
  async function readCapped(abs) {
    try {
      const st = await fsp.stat(abs);
      if (st.size > MAX_TEXT_BYTES) throw new Error(`Datei ist zu groß zum vollständig Lesen (${(st.size / 1048576).toFixed(1)} MB, Grenze ${MAX_TEXT_BYTES / 1048576} MB). Bitte mit start_line/end_line in Abschnitten lesen oder mit search_text gezielt suchen.`);
    } catch (e) {
      if (/zu groß/.test(e.message)) throw e;
    }
    return Buffer.from(await fsp.readFile(abs));
  }

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
    const entries = await fsp.readdirWithFileTypes(abs);
    const out = [];
    for (const en of entries) {
      if (ig.has(en.name)) continue;
      let size = 0;
      if (en.isFile()) {
        try { size = (await fsp.stat(path.join(abs, en.name))).size; } catch {}
      }
      out.push({ name: en.name, isDir: en.isDirectory(), size });
    }
    out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return out;
  }

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
      try { entries = await fsp.readdirWithFileTypes(dir); } catch { return; }
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
            const buf = Buffer.from(await fsp.readFile(abs));
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
    if (ctl && ctl.cancelled) return 'Abgebrochen: Die Suche wurde beendet (' + scanned + ' Dateien geprüft).';
    return hits.length ? hits.join('\n') : 'Keine Treffer.';
  }

  // Laufende Workspace-Werkzeuge, damit "Stopp" sie tatsächlich beendet (V49).
  const wsRuns = new Set();

  const ws = {
    async list(o) { return listDir(o.root, o.rel, o.ignore); },
    abortAll() { for (const c of wsRuns) c.cancelled = true; return true; },

    async tool(o) {
      const ctl = { cancelled: false };
      wsRuns.add(ctl);
      try {
        const root = o.root;
        const args = o.args || {};
        const name = o.name;
        const maxKB = o.maxKB;
        const ignore = o.ignore;

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
            const r = await DOCS.extract(abs);
            content = r.text;
            head = `[${r.info}, als Text ausgelesen]\n`;
            sizeInfo = fmtSize(Buffer.byteLength(content)) + ' Text';
          } else {
            if (DOCS.legacyHint(ext)) return { ok: false, result: 'Dieses Format kann nicht gelesen werden: ' + DOCS.legacyHint(ext) };
            let buf;
            try { buf = await readCapped(abs); } catch (e) { return { ok: false, result: e.message }; }
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
          if (DOCS.isDoc(ext) || DOCS.legacyHint(ext)) return { ok: false, result: `${ext}-Dateien kann die App nicht ändern. Schreibe stattdessen eine neue Datei in einem Textformat (z. B. .csv, .md, .html).` };
          let dec = null;
          try { dec = DOCS.decodeTextEx(await readCapped(abs)); } catch (e) {
            if (/zu groß/.test(e.message)) return { ok: false, result: e.message + ' Zum Ändern bitte abschnittsweise mit old_text in gelesenen Zeilen arbeiten.' };
          }
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
          await fsp.writeFile(abs, DOCS.encodeText(text, dec.enc));
          return { ok: true, result: `Geändert: ${args.path} (${n} Ersetzung${n > 1 ? 'en' : ''})` };
        }
        if (name === 'write_file') {
          const abs = safe(root, args.path);
          const ext = path.extname(abs).toLowerCase();
          if (DOCS.isDoc(ext) || DOCS.legacyHint(ext)) return { ok: false, result: `${ext}-Dateien kann die App nicht erzeugen (Text würde eine ungültige Datei ergeben). Schreibe stattdessen .csv, .md oder .html.` };
          await fsp.mkdir(path.dirname(abs), { recursive: true });
          const content = String(args.content ?? '');
          let enc = 'utf8';
          try { const ex = DOCS.decodeTextEx(await readCapped(abs)); if (ex) enc = ex.enc; } catch {}
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
    },
  };

  /* ───────────────────────── Netzwerk (CORS-frei, streamt) ───────────────────────── */

  const streams = new Map();     // id -> callback
  const pendingFetch = new Map();

  window.__fetchResult = (id, r) => {
    const w = pendingFetch.get(id);
    if (w) { pendingFetch.delete(id); w(r); }
  };

  function http(req) {
    return new Promise((res) => {
      const id = req.id || ('f' + Date.now() + Math.random().toString(36).slice(2, 8));
      pendingFetch.set(id, res);
      let r;
      // __nativeCall liefert bereits ein Objekt (JSON der Brücke) – nicht noch einmal parsen.
      try { r = __nativeCall('httpFetch', JSON.stringify({ ...req, id })); }
      catch (e) { r = { ok: false, status: 0, error: e.message }; }
      if (!r.ok) { pendingFetch.delete(id); res(r); return; }
      const wait = Math.max(15000, (req.timeout || 15000) + 5000);
      setTimeout(() => {
        const w = pendingFetch.get(id);
        if (w) { pendingFetch.delete(id); w({ ok: false, status: 0, error: 'Zeitüberschreitung' }); }
      }, wait);
    });
  }

  /* ───────────────────────── Desktop-only-Funktionen ───────────────────────── */

  const DESKTOP_MSG = 'Auf Android gibt es keine lokale Befehlsausführung und kein SSH. Was funktioniert: alles über die HTTP-Schnittstelle des Servers (Modell starten/laden/entladen, Monitor, Chat).';
  function desktopOnly() { return Promise.resolve({ ok: false, result: DESKTOP_MSG, unsupported: true }); }

  /* ───── Windows-Freigabe (SMB) ─────
     Die Zugangsdaten liegen auf Android im privaten App-Speicher files/data/smb.json und werden
     von Java verwaltet (MainActivity.java: smbGetCreds 1673, smbSaveCreds 1690). Diese Sektion
     macht dieselben vier Funktionen wie die Windows-Seite (api.smb in preload.js), damit der
     gemeinsame Uebertragungs-Code in transfer.js in beiden Apps gleich laeuft.
     Das Passwort gibt Java bewusst nie zurueck – smb:getCreds meldet nur hasPass. */
  const smb = {
    getCreds(host) {
      const h = String(host || '').toLowerCase();
      if (!h) return Promise.resolve({ ok: false, error: 'Kein Rechner angegeben' });
      try {
        const r = JSON.parse(Native.smbGetCreds(h));
        return Promise.resolve(r && r.ok ? { ok: true, user: r.user || '', domain: r.domain || '', hasPass: !!r.hasPass } : { ok: false, error: (r && r.error) || 'nicht lesbar' });
      } catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
    },
    /* Leere Felder loeschen keinen gespeicherten Wert – Java uebernimmt den alten Stand
       (MainActivity.java:1690). Ein Bestaetigen mit leerem Feld darf die Zugangsdaten nicht
       tilgen; der naechste Zugriff lief sonst anonym und wurde abgelehnt. */
    saveCreds(o = {}) {
      const h = String(o.host || '').toLowerCase();
      if (!h) return Promise.resolve({ ok: false, error: 'Kein Rechner angegeben' });
      try {
        const r = JSON.parse(Native.smbSaveCreds(h, String(o.user ?? ''), String(o.domain ?? ''), o.pass == null ? '' : String(o.pass)));
        return Promise.resolve(r && r.ok ? { ok: true } : { ok: false, error: (r && r.error) || 'Speichern fehlgeschlagen' });
      } catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
    },
    /* Verbindungstest laeuft ueber die asynchrone Auftragsliste: ein direkter Aufruf wuerde die
       Oberflaeche blockieren, solange das Netzwerk antwortet (gemessen ~10 s bei unerreichbarer
       Freigabe, Logcat "fsJob smbTest dauerte 10112 ms"). */
    async test(p) {
      try { return await globalThis.__fsJob('smbTest', String(p || '')); } catch (e) { return { ok: false, error: e.message }; }
    },
    /* Rechner mit hinterlegten Zugangsdaten. Auf Android stammt der Rechner aus dem internen
       Freigabe-Pfad des Workspace (/smb/rechner/freigabe/…) – so braucht es keinen neuen
       Java-Zugriff auf smb.json, und es verlassen nie Rechnernamen oder gar Passwoerter den
       privaten App-Speicher. Ohne Freigabe als Workspace gibt es hier nichts anzubieten. */
    async listHosts() {
      try {
        const s = await store.get('settings');
        const p = String((s && s.workspace && s.workspace.path) || '');
        const m = /^\/smb\/([^/]+)/i.exec(p);
        return { ok: true, hosts: m ? [m[1].toLowerCase()] : [] };
      } catch { return { ok: true, hosts: [] }; }
    },
    /* Nur fuer eine ausdruecklich gestartete Uebertragung. Auf Android ist das Passwort in Java
       gespeichert und wird von dort nicht herausgegeben – ein Export waere nur mit einem neuen
       Java-Zugriff moeglich, der das Klartext-Passwort an die Web-Seite liefert. Bewusst nicht
       getan: die Windows-Seite braucht es zum Mitschicken, umgekehrt nicht. */
    async credsForExport(host) {
      const r = await smb.getCreds(host);
      return r.ok ? { ok: true, user: r.user, domain: r.domain, pass: '', hinweis: 'Das Passwort bleibt auf dem Handy in Java gespeichert und wird nicht zurueckgegeben.' } : r;
    },
    /* Gegenstueck zum Windows-Handler smb:resolve (main.js). Die Uebertragungsseite fragt ihn fuer
       JEDES Geraet, weil sie den Workspace-Pfad nicht selbst deuten kann. Auf Android gibt es keine
       Laufwerksbuchstaben – noetig ist hier nur die Zerlegung des internen Freigabe-Pfads
       /smb/rechner/freigabe/unterordner. Ein Windows-Pfad (Y:\…) wird abgelehnt, weil das Handy damit
       nichts anfangen kann; ein Laufwerk aufzuloesen waere eine Windows-Aufgabe. */
    async resolve(p) {
      const s = String(p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (/^[A-Za-z]:(\/|$)/.test(s)) return { ok: false, error: 'Ein Windows-Laufwerk kann das Handy nicht aufloesen – bitte die Freigabe \\rechner\\freigabe angeben' };
      const m = /^smb\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(s);
      if (!m) return { ok: false, error: 'Erwartet /smb/rechner/freigabe/unterordner' };
      const sub = (m[3] || '').replace(/\/+$/, '');
      return { ok: true, host: m[1], share: m[2], sub, unc: `\\\\${m[1]}\\${m[2]}` + (sub ? '\\' + sub.replace(/\//g, '\\') : '') };
    },
  };

  const api = {
    store,
    chats,
    sync,
    smb,
    files,
    cfg,
    ws,
    strata: {
      run(req, cb) { setTimeout(() => cb && cb({ id: req.id, type: 'error', message: DESKTOP_MSG }), 0); return Promise.resolve(true); },
      abort: () => true,
    },
    sys: { exec: desktopOnly, install: desktopOnly, installCmd: () => ({ error: DESKTOP_MSG }), which: desktopOnly, abort: () => true },
    fetch: (req) => http(req),
    stream(req, cb) {
      streams.set(req.id, cb);
      let r;
      try { r = __nativeCall('httpStream', JSON.stringify(req)); } catch (e) { r = { ok: false, error: e.message }; }
      if (!r.ok) {
        setTimeout(() => {
          const c = streams.get(req.id);
          if (c) { streams.delete(req.id); c({ type: 'error', status: 0, message: r.error || 'Netzwerkfehler' }); }
        }, 0);
      }
      return Promise.resolve(true);
    },
    abort(id) { try { __nativeCall('abort', String(id)); } catch {} return true; },
    openExternal(u) { try { if (/^https?:\/\//i.test(String(u))) __nativeCall('openExternal', String(u)); } catch {} },
    openPath: () => Promise.resolve(''),
    appInfo: () => Promise.resolve(INFO),
    gpuGet: () => Promise.resolve(true),
    gpuSet: () => Promise.resolve(false),
    // Die Titelleiste des Desktop-Fensters gibt es auf Android nicht; die Farbinfo wird hier
    // verworfen. Wichtig ist nur, dass der Aufruf nichts wirft und nichts blockiert.
    setWindowTheme: () => Promise.resolve(false),
    setWindowMaterial: () => Promise.resolve(false),

    /* Rechtschreibprüfung (V50): Der Desktop setzt damit die Chromium-Wörterbücher des
       Hauptprozesses. In der WebView gibt es diese Steuerung nicht, wirksam ist hier das
       spellcheck-/lang-Attribut des Eingabefeldes – und genau das wird gesetzt. */
    spellSet(o) {
      try {
        const inp = document.getElementById('input');
        if (inp) {
          inp.spellcheck = !o || o.enabled !== false;
          const lang = String((o && o.lang) || 'de-en');
          inp.setAttribute('lang', lang === 'en' ? 'en' : 'de');
        }
      } catch {}
      return Promise.resolve(true);
    },

    /* Änderungen aus dem gemeinsamen Chat-Ordner (V44) */
    onChatsChanged(cb) { if (typeof cb === 'function') chatListeners.push(cb); return true; },

    /* ───── Übertragung Windows <-> Android (V52-Format, docs/TRANSFER-FORMAT.md) ─────
       Die Windows-Seite komprimiert mit Node zlib (RFC 1950), codiert Base64 und bildet
       SHA-256 ueber den komprimierten Bytes. Genau das leisten CompressionStream('deflate')
       und crypto.subtle auch in der WebView - dasselbe Format, ohne zusaetzlichen nativen
       Code. Schlaegt etwas davon fehl (aeltere WebView), uebernimmt die native Bruecke. */
    transfer: {
      async info() {
        return { version: INFO.version.replace('-android', ''), platform: 'android', device: deviceName() };
      },

      async pack(json) {
        const raw = new TextEncoder().encode(String(json == null ? '' : json));
        try {
          const cs = new CompressionStream('deflate');   // 'deflate' = zlib-Format (RFC 1950)
          const buf = await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer();
          const z = new Uint8Array(buf);
          const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', z));
          let hex = '';
          for (const b of hash) hex += b.toString(16).padStart(2, '0');
          // Die Base64-Helfer liefert node-shim.js (dort fuer die Bruecke definiert).
          return { b64: globalThis.__bytesToB64(z), sha16: hex.slice(0, 16), rawBytes: raw.length, zBytes: z.length };
        } catch (e) {
          // Fallback ueber die Bruecke (Java: Deflater + MessageDigest).
          // Die Auftragsfunktion liefert node-shim.js als globalThis.__fsJob – sie ist hier
          // nicht lokal sichtbar, ein nacktes fsJob() waere ein Laufzeitfehler.
          const r = await globalThis.__fsJob('packFile', String(json == null ? '' : json));
          if (!r || !r.ok) throw new Error((r && r.error) || 'Komprimierung fehlgeschlagen');
          return { b64: r.b64, sha16: r.sha16, rawBytes: r.rawBytes, zBytes: r.zBytes };
        }
      },

      /* Textdateien des Workspace-Ordners sammeln – dieselben Grenzen wie die Windows-Seite,
         damit beide Apps identische JSON-Dateien erzeugen. Bewusst hier in JS und nicht nativ:
         ueber fsp laufen bereits lokale Ordner UND Netzwerkfreigaben, inkl. Timeout-Schutz. */
      async wsFiles(o = {}) {
        const out = { files: [], skipped: 0, truncated: false, totalBytes: 0 };
        const root = String(o.root || '');
        if (!root) return { ...out, error: 'Kein Workspace-Ordner gewählt' };
        const ig = ignoreSet(o.ignore && o.ignore.length ? o.ignore : DEFAULT_IGNORE);
        const perFile = (+o.maxFileKB || 512) * 1024;
        const cap = (+o.maxTotalKB || 5120) * 1024;
        const maxN = +o.maxFiles || 2000;

        async function walk(dir, relPrefix) {
          if (out.truncated) return;
          let entries;
          try { entries = await fsp.readdirWithFileTypes(dir); } catch { return; }
          entries.sort((a, b) => a.name.localeCompare(b.name));
          for (const en of entries) {
            if (out.truncated) return;
            if (!en.name || ig.has(en.name)) continue;
            const abs = path.join(dir, en.name);
            const rel = relPrefix ? `${relPrefix}/${en.name}` : en.name;
            if (en.isDirectory()) { await walk(abs, rel); continue; }
            if (!en.isFile()) continue;
            let size = 0;
            try { size = (await fsp.stat(abs)).size; } catch { out.skipped++; continue; }
            if (size > perFile) { out.skipped++; continue; }
            if (out.files.length >= maxN || out.totalBytes + size > cap) { out.truncated = true; return; }
            try {
              const buf = await fsp.readFile(abs);
              // Nur Textdateien: ein Nullbyte in den ersten Bytes bedeutet Binaerinhalt.
              let binary = false;
              const probe = Math.min(buf.length, 4000);
              for (let k = 0; k < probe; k++) if (buf[k] === 0) { binary = true; break; }
              if (binary) { out.skipped++; continue; }
              out.files.push({ path: rel, size: buf.length, text: Buffer.from(buf).toString('utf8') });
              out.totalBytes += buf.length;
            } catch { out.skipped++; }
          }
        }
        await walk(root, '');
        return out;
      },

      /* Uebertragungsdatei/QR-Inhalt in diese App uebernehmen.
         Windows-spezifische Felder bleiben draussen (Doku Abschnitt 1), Chats mit gleicher
         ID werden nicht ueberschrieben, sondern als Kopie angelegt. */
      async apply(data, opts = {}) {
        if (!data || data.format !== 'llm-box-transfer') throw new Error('Das ist keine LLM-Box-Uebertragungsdatei.');
        if (+data.version > 1) throw new Error('Diese Uebertragung stammt von einer neueren App-Version (' + data.version + ').');
        const report = { connections: 0, chats: 0, chatCopies: 0, skippedChats: 0, ignored: [], settingsApplied: false };

        if (data.settings && typeof data.settings === 'object') {
          const s = JSON.parse(JSON.stringify(data.settings));
          // Geraetebezogenes der Windows-App nicht uebernehmen (Pfad, Fenstermaterial, SSH-Ziel,
          // gemeinsamer Chat-Ordner): auf dem Handy sonst ungueltig oder gefaehrlich.
          if (s.workspace) { delete s.workspace.path; delete s.workspace.execEnabled; }
          if (s.appearance) delete s.appearance.winMaterial;
          if (s.server && s.server.target) delete s.server.target.key;
          const cur = await store.get('settings');
          /* Tief zusammenfuehren statt Object.assign: die flache Variante ersetzte ganze
          	 Abschnitte und liess dabei Geraeteeigene Schluessel wegfallen (z. B.
          	 appearance.enterMigrated, workspace-Angaben der Android-Freigabe). Das aeusserte
          	 sich als "falsche Einstellungen uebernommen". deepMerge (settings.js) ueberschreibt
          	 nur die Werte, die die Windows-App wirklich mitschickt. */
          const merged = deepMerge(cur || {}, s);
          /* Enter-Verhalten: auf dem Handy ist "Enter = Umbruch" die Vorgabe und der Nutzer
             stellt es am Geraet selbst um. Eine Windows-Uebertragung durfte das bisher auf
             "Enter = senden" zurueckdrehen (Windows-Standard), weil dort enterToSend gesetzt
             ist. Jetzt bleibt der Wert erhalten, den das Geraet bereits hat. */
          if (merged.appearance) {
            const amGerat = cur && cur.appearance ? cur.appearance.enterToSend : undefined;
            merged.appearance = Object.assign({}, merged.appearance, {
              enterToSend: amGerat !== undefined ? !!amGerat : false,
            });
          }
          await store.set('settings', merged);
          report.settingsApplied = true;
          report.connections = (s.connections || []).length;
          // Welche Verbindungen wirklich ankamen - ohne diese Liste war nicht nachvollziehbar,
          // ob die Uebertragung falsche/adresse Inhalte brachte oder nur die Oberflaeche sie
          // nicht neu lud (der eigentliche Fehler, siehe applyIncomingSettings in app.js).
          report.verbindungen = (s.connections || []).map((c) => `${c.name} (${c.type}, ${c.baseUrl}${c.apiKey ? ', Key gesetzt' : ', ohne Key'})`);
          report.aktiveVerbindung = s.activeConnection || '';
          report.modell = s.model || '';
          if (data.settings.workspace && data.settings.workspace.path) {
            report.ignored.push('workspace.path ("' + data.settings.workspace.path + '" – auf dem Handy nicht nutzbar, bitte Netzwerkordner neu wählen)');
          }
        }

        if (Array.isArray(data.chats) && data.chats.length) {
          const existing = new Map(((await chats.list()) || []).map((m) => [m.id, m]));
          for (const c of data.chats) {
            if (!c || !c.id || !Array.isArray(c.messages)) { report.skippedChats++; continue; }
            const mine = existing.get(c.id);
            let target = c;
            if (mine) {
              // Gleiche ID: den neueren Stand behalten (updated), sonst Kopie anlegen.
              if ((+c.updated || 0) <= (+mine.updated || 0)) { report.skippedChats++; continue; }
              target = { ...c, id: c.id + '-imp' + Date.now().toString(36).slice(-5) };
              report.chatCopies++;
            }
            try {
              await chats.save(target, {
                id: target.id, title: target.title || 'Chat', created: target.created || Date.now(),
                updated: target.updated || Date.now(), model: target.model || '', tokens: 0,
              });
              report.chats++;
            } catch (e) { report.skippedChats++; }
          }
        }

        if (data.workspace && Array.isArray(data.workspace.files) && data.workspace.files.length) {
          // Ein Workspace-Import auf dem Handy wuerde Dateien in den App-Speicher schreiben.
          // Bewusst nicht automatisch getan: der Nutzer soll den Zielordner selbst waehlen.
          report.ignored.push('workspaceFiles (' + data.workspace.files.length + ' Dateien – manuell importieren)');
        }

        /* Netzwerkordner (SMB) uebernehmen – die Windows-App schickt Rechner, Freigabe,
           Unterordner und ihre Zugangsdaten. Damit zeigt das Handy danach auf dieselbe Freigabe,
           ohne dass alles erneut eingetippt werden muss.
           Reihenfolge ist wichtig: erst die Zugangsdaten speichern (sonst scheitert der Test
           anonym), dann pruefen, und den Pfad nur bei funktionierender Verbindung setzen. */
        if (data.smb && typeof data.smb === 'object' && data.smb.host) {
          const host = String(data.smb.host).toLowerCase();
          const share = String(data.smb.share || '');
          const sub = String(data.smb.sub || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
          if (data.smb.user || data.smb.pass) {
            try { Native.smbSaveCreds(host, String(data.smb.user || ''), String(data.smb.domain || ''), String(data.smb.pass || '')); report.smbCreds = host; }
            catch (e) { report.ignored.push('smb-Zugangsdaten (' + e.message + ')'); }
          } else {
            // Kein Passwort mitgeschickt: die bereits auf dem Handy hinterlegten Werte behalten.
            report.smbCreds = host + ' (eigene Zugangsdaten beibehalten)';
          }
          if (share) {
            const intern = '/smb/' + host + '/' + share + (sub ? '/' + sub : '');
            try {
              const t = await globalThis.__fsJob('smbTest', intern);
              if (t && t.ok) {
                const s2 = await store.get('settings');
                const m2 = deepMerge(s2 || {}, { workspace: { path: intern } });
                await store.set('settings', m2);
                report.smbPath = intern;
              } else {
                report.ignored.push('workspace.path (Freigabe \\\\' + host + '\\' + share + ' nicht erreichbar: ' + ((t && t.error) || 'unbekannt') + ')');
              }
            } catch (e) { report.ignored.push('workspace.path (Freigabetest fehlgeschlagen: ' + e.message + ')'); }
          }
        }

        if (Array.isArray(data.omitted)) report.ignored.push(...data.omitted);
        return { ok: true, report };
      },

      /* Die Android-App empfaengt nur; ein eigenes Angebot im WLAN (wie die Windows-Seite)
         gibt es hier bewusst nicht. Die Stubs halten die Bridge vollstaendig, damit kein
         Aufruf ins Leere laeuft, und erklaeren den Grund. */
      serveStart: () => Promise.resolve({ ok: false, error: 'Ein Angebot im WLAN macht nur die Windows-App. Hier bitte „Im WLAN suchen“ verwenden.' }),
      serveStop: () => Promise.resolve({ ok: true }),

      /* Windows-App im WLAN finden: sendet ein kurzes Signal und sammelt die Antworten.
         Laeuft in der asynchronen Auftragsliste, damit die Oberflaeche beim Warten bedienbar
         bleibt (ein direkter Brueckenaufruf wuerde den Render-Thread blockieren). */
      async lanSearch(o = {}) {
        const r = await globalThis.__fsJob('lanSearch', JSON.stringify({ waitMs: +o.waitMs || 1800 }));
        if (!r) return { ok: false, error: 'Netzsuche nicht moeglich' };
        return r;
      },

      /* LBX1-Stuecke aus QR-Codes sammeln und pruefen (Doku Abschnitt 2). */
      qrCollect() {
        const parts = new Map();
        let session = '', total = 0, sha16 = '';
        return {
          add(line) {
            const f = String(line || '').split('|');
            if (f.length < 6 || f[0] !== 'LBX1') return { ok: false, error: 'Fremder Code (kein LLM-Box-Code)' };
            if (session && f[1] !== session) return { ok: false, error: 'Code gehoert zu einer anderen Uebertragung' };
            session = f[1]; total = +f[3] || 0; sha16 = f[4];
            parts.set(+f[2], f.slice(5).join('|'));   // Basis64 kann kein '|' enthalten, sicherheitshalber
            return { ok: true, have: parts.size, of: total };
          },
          complete() { return total > 0 && parts.size >= total; },
          async finish() {
            let b64 = '';
            for (let i = 1; i <= total; i++) { const v = parts.get(i); if (!v) throw new Error('Teil ' + i + ' fehlt'); b64 += v; }
            const z = globalThis.__b64ToBytes(b64);
            const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', z));
            let hex = '';
            for (const b of hash) hex += b.toString(16).padStart(2, '0');
            if (hex.slice(0, 16) !== sha16) throw new Error('Pruefsumme stimmt nicht – bitte neu scannen.');
            const ds = new DecompressionStream('deflate');
            const buf = await new Response(new Blob([z]).stream().pipeThrough(ds)).arrayBuffer();
            return JSON.parse(new TextDecoder().decode(buf));
          },
        };
      },
    },
  };

  window.__nativeEvent = (channel, msg) => {
    if (channel === 'llm') {
      const cb = streams.get(msg.id);
      if (!cb) return;
      if (msg.type === 'end' || msg.type === 'error') streams.delete(msg.id);
      cb(msg);
    }
  };

  window.api = api;
})();
