/* test-fs-mock.js – ergänzt ein vorhandenes Native-Mock-Objekt um den asynchronen
   Dateiauftrag fsJob, so wie ihn MainActivity.java in der APK bereitstellt.

   Hintergrund: Die Bruecke fuehrt Datei-/SMB-Zugriffe nicht mehr synchron im
   JS-Thread aus (sonst gefriert die WebView-Oberflaeche bei langsamer Freigabe),
   sondern liefert nur eine Auftrags-ID und meldet das Ergebnis spaeter ueber
   window.__fsResult(id, ergbnis). Die Tests muessen genau dieses Verhalten
   nachbilden – sonst wartet der node-shim auf ein Ergebnis, das nie kommt.

   Aufruf in einem Test, nachdem dessen Native-Objekt definiert ist:
     require('./test-fs-mock')(Native, globalThis);      // bzw. (Native, win)  */
'use strict';

// Reihenfolge der Argumente je Vorgang – muss zu MainActivity.runFsOp() passen.
const OPS = {
  stat: ['fsStat'],
  exists: ['fsExists'],
  readB64: ['fsReadB64'],
  write: ['fsWrite'],
  list: ['fsList'],
  mkdirs: ['fsMkdirs'],
  remove: ['fsRemove'],
  rename: ['fsRename'],
  copy: ['fsCopy'],
  smbTest: ['smbTest'],
};

module.exports = function attachFsJob(Native, scope) {
  const g = scope || globalThis;
  Native.fsJob = (id, op, a, b, c) => {
    if (!OPS[op]) return JSON.stringify({ ok: false, error: 'Unbekannter Dateivorgang: ' + op });
    const fn = Native[OPS[op][0]];
    if (typeof fn !== 'function') return JSON.stringify({ ok: false, error: OPS[op][0] + ' fehlt im Mock' });
    let res;
    try { res = fn(a == null ? '' : a, b == null ? '' : b, c == null ? '' : c); }
    catch (e) { res = JSON.stringify({ ok: false, error: e.message }); }
    // Ergebnis bewusst verspaetet: die echte Bruecke antwortet ebenfalls erst spaeter.
    setTimeout(() => {
      if (typeof g.__fsResult === 'function') g.__fsResult(id, typeof res === 'string' ? JSON.parse(res) : res);
    }, 0);
    return JSON.stringify({ ok: true, started: true, id });
  };
  return Native;
};
