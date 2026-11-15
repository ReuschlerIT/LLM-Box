/* node-shim.js – kleine CommonJS-Laufzeit für die Android-WebView.
   docs.js wird UNVERÄNDERT aus der Desktop-Version übernommen und braucht require('fs/promises'),
   require('path'), require('jszip'), require('fast-xml-parser') und Buffer. */
'use strict';

(function () {
  const mods = new Map();

  // ── path (unterstützt '/' wie '\\' ; UNC \\host\share bleibt absolut) ─────
  // Wichtig für Netzwerkordner: die Desktop-Oberfläche und der Nutzer schreiben
  // Windows-Pfade wie \\192.0.2.10\daten\MeinProjekt . Würde man Backslashes
  // nicht als Trenner erkennen, wäre so ein Pfad "relativ" und würde an den
  // Android-Standardordner angehängt - der Zugriff schlägt dann fehl.
  function isUnc(s) { return s.startsWith('//'); }
  function norm(p) {
    let s = String(p).replace(/\\/g, '/');

    // UNC-Pfade: \\host\share\pfad -> /smb/host/share/pfad.
    // Die Oberfläche und der Nutzer schreiben Windows-Syntax; die native Brücke erkennt
    // Netzwerkordner am Präfix "/smb/". Beides muss zusammenpassen – sonst hängt Android
    // den Pfad an seinen Standardordner an und der Zugriff schlägt fehl.
    if (isUnc(s)) {
      const seg = s.split('/').filter((x) => x && x !== '.');
      return '/smb/' + seg.join('/');           // seg[0]=Rechner, seg[1]=Freigabe
    }

    const abs = s.startsWith('/');
    const out = [];
    for (const seg of s.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); }
      else out.push(seg);
    }
    return (abs ? '/' : '') + out.join('/');
  }
  const path = {
    sep: '/',
    join(...parts) { return norm(parts.filter((p) => p != null && p !== '').join('/')); },
    normalize(p) { return norm(p); },
    resolve(...parts) {
      const rest = parts.filter((p) => p != null && p !== '').map((p) => String(p).replace(/\\/g, '/'));
      if (!rest.length) return norm('/storage/emulated/0');
      // Beginnt das erste Stueck mit '/' (einschliesslich UNC '//host/share'), ist es bereits absolut.
      if (rest[0].startsWith('/')) return norm(rest.join('/'));
      return norm('/storage/emulated/0/' + rest.join('/'));
    },
    dirname(p) { const s = norm(p); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); },
    basename(p) { const s = String(p).replace(/[\\/]+$/, ''); return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1); },
    extname(p) {
      const b = path.basename(p);
      const i = b.lastIndexOf('.');
      return i > 0 ? b.slice(i) : '';
    },
    relative(from, to) {
      from = norm(path.resolve(from)).split('/').filter(Boolean);
      to = norm(path.resolve(to)).split('/').filter(Boolean);
      let i = 0;
      while (i < from.length && i < to.length && from[i] === to[i]) i++;
      const up = new Array(Math.max(0, from.length - i)).fill('..');
      return up.concat(to.slice(i)).join('/');
    },
    isAbsolute(p) { return String(p).startsWith('/') || String(p).startsWith('\\'); },
  };

  // ── fs / fs/promises über die native Brücke ────────────────────────
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesToB64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }
  globalThis.__bytesToB64 = bytesToB64;
  globalThis.__b64ToBytes = b64ToBytes;

  function nativeCall(fn, ...args) {
    if (!window.Native || typeof window.Native[fn] !== 'function') throw new Error('Native-Brücke nicht bereit');
    return JSON.parse(window.Native[fn](...args.map((a) => (a === undefined || a === null ? '' : String(a)))));
  }
  globalThis.__nativeCall = nativeCall;

  /* ── Datei-/Netzwerkzugriffe asynchron ───────────────────────────────
     Ein direkter Brückenaufruf (@JavascriptInterface) blockiert den Render-Thread der WebView,
     bis er zurückkehrt. Bei einem Workspace auf einer Windows-Freigabe konnte dadurch schon ein
     einziger langsamer Ordner-Lesevorgang die gesamte Oberfläche sekundenlang einfrieren lassen.
     Deshalb geht alles über fsJob: die Brücke bestätigt nur den Auftrag, das Ergebnis kommt per
     window.__fsResult(id, …) zurück. alterCode = true nutzt die frühere synchrone Brücke
     (nur für den Fall eines älteren APK-Stands). */
  const fsJobs = new Map();
  let jobSeq = 0;
  window.__fsResult = (id, r) => {
    const w = fsJobs.get(id);
    if (w) { fsJobs.delete(id); w(r == null ? { ok: false, error: 'Kein Ergebnis erhalten' } : r); }
  };
  const ASYNC_FS = !!(window.Native && typeof window.Native.fsJob === 'function');

  function fsJob(op, a, b, c) {
    if (!ASYNC_FS) return Promise.resolve(nativeCall(OP_SYNC[op], a, b, c));
    const id = 'j' + (++jobSeq);
    return new Promise((res) => {
      fsJobs.set(id, res);
      let ack;
      try { ack = nativeCall('fsJob', id, op, a == null ? '' : String(a), b == null ? '' : String(b), c == null ? '' : String(c)); }
      catch (e) { fsJobs.delete(id); res({ ok: false, error: e.message }); return; }
      if (!ack || !ack.ok) { fsJobs.delete(id); res(ack || { ok: false, error: 'Auftrag abgelehnt' }); return; }
      // Sicherheitsnetz: meldet die Brücke sich nicht, darf nichts dauerhaft abhängen.
      setTimeout(() => {
        if (fsJobs.has(id)) { fsJobs.delete(id); res({ ok: false, error: 'Dateizugriff dauerte zu lange (' + op + ')' }); }
      }, 30000);
    });
  }
  const OP_SYNC = {
    stat: 'fsStat', exists: 'fsExists', readB64: 'fsReadB64', write: 'fsWrite', list: 'fsList',
    mkdirs: 'fsMkdirs', remove: 'fsRemove', rename: 'fsRename', copy: 'fsCopy', smbTest: 'smbTest',
  };
  globalThis.__fsJob = fsJob;

  async function fsReadBytes(abs) {
    const r = await fsJob('readB64', abs);
    if (!r.ok) throw new Error(r.error || 'Datei nicht lesbar');
    return Buffer.from(b64ToBytes(r.b64));
  }
  async function fspStat(abs) {
    const r = await fsJob('stat', abs);
    if (!r.ok) { const e = new Error(r.error || 'nicht gefunden'); e.code = 'ENOENT'; throw e; }
    return { size: r.size, mtimeMs: r.mtimeMs, isDirectory: () => r.isDir, isFile: () => !r.isDir };
  }

  const fsp = {
    readFile(abs) { return fsReadBytes(abs); },
    stat(abs) { return fspStat(abs); },
    async readdir(dir) {
      const r = await fsJob('list', dir);
      if (!r.ok) { const e = new Error(r.error || 'Ordner nicht lesbar'); e.code = 'ENOENT'; throw e; }
      return (r.items || []).map((i) => i.name);
    },
    async readdirWithFileTypes(dir) {
      const r = await fsJob('list', dir);
      if (!r.ok) { const e = new Error(r.error || 'Ordner nicht lesbar'); e.code = 'ENOENT'; throw e; }
      return (r.items || []).map((i) => ({ name: i.name, isDirectory: () => i.isDir, isFile: () => !i.isDir }));
    },
    async writeFile(abs, data) {
      const b64 = Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(String(data), 'utf8').toString('base64');
      const r = await fsJob('write', abs, b64, true);
      if (!r.ok) throw new Error(r.error || 'Schreiben fehlgeschlagen');
    },
    async mkdir(p, opts) {
      const r = await fsJob('mkdirs', p);
      if (!r.ok && !(opts && opts.recursive)) throw new Error('Ordner nicht anlegbar');
    },
    async rm(p, opts) { await fsJob('remove', p, !!(opts && opts.recursive)); },
    async rename(from, to) {
      const r = await fsJob('rename', from, to);
      if (!r.ok) throw new Error((r.error || 'Umbenennen fehlgeschlagen') + ` (${from} -> ${to})`);
    },
    // Wird nur fuer das Kopieren lokaler Chats in einen gemeinsamen Ordner gebraucht (V44).
    async copyFile(from, to) {
      const r = await fsJob('copy', from, to);
      if (!r.ok) throw new Error(r.error || 'Kopieren fehlgeschlagen');
    },
  };

  const fs = Object.assign({}, fsp, { promises: fsp });

  // ── Modulregistry ──────────────────────────────────────────────────
  function defineModule(name, factory) { mods.set(name, { loaded: false, exports: {}, factory }); }
  // docs.js wird als normales Skript geladen (var module/exports im Prelude) und hier nachgereicht.
  function setExports(name, exp) { mods.set(name, { loaded: true, exports: exp, factory: null }); }
  globalThis.__defineModule = defineModule;
  globalThis.__setExports = setExports;

  function req(name) {
    if (mods.has(name)) {
      const m = mods.get(name);
      if (!m.loaded) {
        m.loaded = true;
        const mod = { exports: m.exports };
        m.factory(mod, mod.exports, req);
        m.exports = mod.exports;
      }
      return m.exports;
    }
    switch (name) {
      case 'path': return path;
      case 'fs': return fs;
      case 'fs/promises': return fsp;
      case 'jszip': return globalThis.JSZip;
      case 'fast-xml-parser': return globalThis.FXP;
      case 'pdfjs-dist/legacy/build/pdf.js': return globalThis.PDFJS;
      // pdf.js lädt ohne echten Web Worker (datei:// in der WebView) seinen Handler per require.
      // Der Handler kommt aus vendor/pdf.worker.min.js, das als eigenes Skript geladen wird.
      case './pdf.worker.js':
      case 'pdf.worker.js':
      case 'pdfjs-dist/legacy/build/pdf.worker.js': {
        if (!globalThis.pdfjsWorker) throw new Error('PDF-Worker-Skript fehlt (vendor/pdf.worker.min.js)');
        return globalThis.pdfjsWorker;
      }
      default: {
        const e = new Error("Cannot find module '" + name + "'");
        e.code = 'MODULE_NOT_FOUND';
        throw e;
      }
    }
  }
  globalThis.require = req;
  globalThis.__pathShim = path;
})();
