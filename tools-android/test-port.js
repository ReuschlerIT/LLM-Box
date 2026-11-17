/* test-port.js – prüft die portierte JavaScript-Schicht der Android-Version ohne Gerät.
   Dazu wird die native Brücke (MainActivity.Bridge) in Node nachgebaut und node-shim.js,
   docs.js und native-main.js werden genau so ausgeführt wie später in der WebView.
   Aufruf:  node tools-android\test-port.js            (aus LLM-Box\)             */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');

const WEBAPP = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'webapp');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FEHLER  ' + name + (extra ? ' -> ' + extra : '')); }
}

/* ── temporäre Verzeichnis-Attrappe für die Brücke ─────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmbox-test-'));
// JS-seitige Pfade sind "/data/..." bzw. "/ws/..."; die Brücke bildet sie auf tmp ab.
function toReal(p) { return path.join(tmp, p.replace(/^\/+/, '').replace(/\//g, path.sep)); }

const Native = {};
Native.appInfo = () => JSON.stringify({ version: 'test', dataDir: '/data', workspaceRoot: '/ws', platform: 'android', osLabel: 'Android-test' });
Native.fsStat = (p) => {
  try { const st = fs.statSync(toReal(p)); return JSON.stringify({ ok: true, size: st.size, mtimeMs: st.mtimeMs, isDir: st.isDirectory() }); }
  catch { return JSON.stringify({ ok: false, error: 'nicht gefunden' }); }
};
Native.fsExists = (p) => JSON.stringify({ ok: true, exists: fs.existsSync(toReal(p)) });
Native.fsReadB64 = (p) => {
  try { return JSON.stringify({ ok: true, b64: fs.readFileSync(toReal(p)).toString('base64') }); }
  catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
};
Native.fsWrite = (p, b64, mkdirs) => {
  try {
    const f = toReal(p);
    if (mkdirs === 'true') fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(b64 || '', 'base64'));
    return JSON.stringify({ ok: true, size: fs.statSync(f).size });
  } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
};
Native.fsList = (p) => {
  try {
    const items = fs.readdirSync(toReal(p), { withFileTypes: true })
      .map((d) => ({ name: d.name, isDir: d.isDirectory(), size: d.isFile() ? fs.statSync(path.join(toReal(p), d.name)).size : 0 }));
    return JSON.stringify({ ok: true, items });
  } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
};
Native.fsMkdirs = (p) => { try { fs.mkdirSync(toReal(p), { recursive: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } };
Native.fsRemove = (p, rec) => { try { fs.rmSync(toReal(p), { recursive: rec === 'true', force: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } };
Native.fsRename = (a, b) => { try { fs.renameSync(toReal(a), toReal(b)); return '{"ok":true}'; } catch { return '{"ok":false}'; } };
Native.openExternal = () => '';

/* ── HTTP über die Brücke: fetch + stream, wie OkHttp in der App ───── */
const server = http.createServer((req, res) => {
  if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5:7b' }] })); return; }
  if (req.url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('spaet'); }, 400); return; }
  if (req.url === '/stream') {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    // Bewusst mitten in einer Zeile und mitten in einem UTF-8-Zeichen geschnitten.
    const parts = ['{"content":"Hal', 'lo Wör', 'ld"}\n{"content":"! zwe', 'ite Zeile"}\n'];
    for (const p of parts) res.write(Buffer.from(p, 'utf8'));
    res.end();
    return;
  }
  if (req.url === '/err') { res.writeHead(404); res.end('Modell nicht gefunden'); return; }
  res.writeHead(200); res.end('ok');
});

Native.httpFetch = (json) => {
  const req = JSON.parse(json);
  (async () => {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), req.timeout || 15000);
      const r = await fetch(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body, signal: ac.signal });
      clearTimeout(t);
      // Wie MainActivity: __fetchResult bekommt ein Objekt (evaluateJavascript liefert ein Objektliteral).
      window.__fetchResult(req.id, { ok: r.ok, status: r.status, text: await r.text() });
    } catch (e) {
      window.__fetchResult(req.id, { ok: false, status: 0, error: e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message });
    }
  })();
  return '{"ok":true}';
};

Native.httpStream = (json) => {
  const req = JSON.parse(json);
  (async () => {
    try {
      const r = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
      if (!r.ok) { window.__nativeEvent('llm', { id: req.id, type: 'error', status: r.status, message: (await r.text()).slice(0, 4000) }); return; }
      const dec = new TextDecoder();
      for await (const ch of r.body) window.__nativeEvent('llm', { id: req.id, type: 'data', text: dec.decode(ch, { stream: true }) });
      window.__nativeEvent('llm', { id: req.id, type: 'end' });
    } catch (e) {
      window.__nativeEvent('llm', { id: req.id, type: 'error', status: 0, message: e.message });
    }
  })();
  return '{"ok":true}';
};

/* ── WebView-Umgebung nachbauen ────────────────────────────────────── */
global.window = global;
window.Native = Native;
// Asynchrone Dateibruecke (fsJob + __fsResult) wie in der App nachbilden.
require('./test-fs-mock')(Native, global);
window.matchMedia = () => ({ matches: false, addEventListener() {} });

function load(rel) {
  const file = path.join(WEBAPP, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  console.log('Shims und portierter Hauptprozess laden …');
  // webdeps.js stellt Buffer, JSZip, FXP und PDFJS bereit – wie in der APK.
  load(path.join('vendor', 'webdeps.js'));
  ok('Buffer verfügbar', typeof globalThis.Buffer === 'function' && typeof globalThis.Buffer.from === 'function');
  ok('JSZip verfügbar', typeof globalThis.JSZip === 'function');
  ok('fast-xml-parser verfügbar', !!(globalThis.FXP && globalThis.FXP.XMLParser));

  load(path.join('js', 'node-shim.js'));
  load(path.join('js', 'docs.js'));
  ok('docs.js geladen (DOCS)', !!(globalThis.DOCS && typeof globalThis.DOCS.extract === 'function'));
  load(path.join('js', 'native-main.js'));
  ok('window.api vorhanden', !!window.api);

  const api = window.api;

  /* ── Persistenz: Einstellungen und Chats ───────────────────────── */
  console.log('\nSpeicher …');
  await api.store.set('settings', { appearance: { theme: 'dark' }, workspace: { path: '/ws/projekt' } });
  const st = await api.store.get('settings');
  ok('store:set/get rund', !!st && st.workspace.path === '/ws/projekt');

  /* Regression 1.0.67 (Android): Beim allerersten Start schreibt init() viermal
     unabgewartet in settings.json (Design-Standard, Prompt-, Verbindungs- und
     Profil-Migration). Waehlt der Nutzer in diesem Moment die Sprache im Startdialog,
     liefen diese Schreibvorgaenge ungeordnet gegeneinander an und eine spaet fertig
     werdende Migration ueberschrieb die Wahl (uiLang + langChosen fehlten).
     main.js der Desktop-Version serialisiert Schreibungen pro Datei (Queue);
     native-main.js musste nachziehen. */
  const natSrc = fs.readFileSync(path.join(WEBAPP, 'js', 'native-main.js'), 'utf8');
  ok('native-main.js: Schreib-Queue pro Datei (writeQueues)', /const writeQueues = new Map\(\)/.test(natSrc) && /writeQueues\.set\(file, tail\)/.test(natSrc));
  ok('native-main.js: writeJsonAtomic reiht sich ein (kein Direktaufruf der Schreibfunktion)',
     /function writeJsonAtomic\(file, data\) \{[\s\S]{0,400}?prev\.catch\(\(\) => \{\}\)\.then\(\(\) => writeJsonAtomicNow\(file, data\)\)/.test(natSrc));
  const pOld = api.store.set('settings', { appearance: { theme: 'dark' }, workspace: { path: '/ws/projekt' }, marker: 'migration' });
  const pNew = api.store.set('settings', { appearance: { theme: 'dark' }, workspace: { path: '/ws/projekt' }, marker: 'sprache', langChosen: true });
  await Promise.all([pOld, pNew]);
  const stQ = await api.store.get('settings');
  ok('store:set: letzte Schreibung gewinnt, Sprachwahl bleibt', !!stQ && stQ.marker === 'sprache' && stQ.langChosen === true, JSON.stringify(stQ));
  const leftovers = fs.readdirSync(toReal('/data')).filter((f) => /\.tmp$/.test(f));
  ok('store:set: keine .tmp-Reste nach parallelen Schreibungen', leftovers.length === 0, leftovers.join(', '));

  const chat = { id: 'c1', title: 'Test', created: 1, updated: 2, connectionId: 'x', model: 'm', messages: [{ role: 'user', content: 'hallo' }] };
  await api.chats.save(chat, { id: 'c1', title: 'Test', created: 1, updated: 2, model: 'm', tokens: 5 });
  const list = await api.chats.list();
  ok('chats:list nach save', Array.isArray(list) && list.length === 1 && list[0].id === 'c1');
  const back = await api.chats.load('c1');
  ok('chats:load liefert Nachrichten', !!back && back.messages[0].content === 'hallo');

  /* ── Workspace-Werkzeuge (list/read/edit/write/search) ─────────── */
  console.log('\nWorkspace-Werkzeuge …');
  const root = '/ws/projekt';
  await api.ws.tool({ root, name: 'write_file', args: { path: 'src/a.txt', content: 'Zeile eins\nZeile zwei\nZeile drei' } });
  const w2 = await api.ws.tool({ root, name: 'write_file', args: { path: 'b.md', content: '# Titel\nINHALT' } });
  ok('write_file', /Geschrieben: b\.md/.test(w2.result), w2.result);

  const ls = await api.ws.tool({ root, name: 'list_files', args: { path: '.' } });
  ok('list_files zeigt Ordner zuerst', /\[Ordner\] src\//.test(ls.result) && /b\.md/.test(ls.result), ls.result);

  const rd = await api.ws.tool({ root, name: 'read_file', args: { path: 'src/a.txt' } });
  ok('read_file mit Zeilennummern', /^1\tZeile eins/m.test(rd.result), JSON.stringify(rd.result.slice(0, 60)));

  const rd2 = await api.ws.tool({ root, name: 'read_file', args: { path: 'src/a.txt', start_line: 2, end_line: 3 } });
  ok('read_file Abschnitt + Hinweis', /2\tZeile zwei/.test(rd2.result) && !/1\tZeile eins/.test(rd2.result) && /\[Zeilen 2–3 von 3\]/.test(rd2.result), rd2.result.slice(-40));

  const ed = await api.ws.tool({ root, name: 'edit_file', args: { path: 'src/a.txt', old_text: 'Zeile zwei', new_text: 'ZEILE ZWEI' } });
  ok('edit_file', /Geändert/.test(ed.result), ed.result);
  const rd3 = await api.ws.tool({ root, name: 'read_file', args: { path: 'src/a.txt' } });
  ok('edit_file nachprüfbar', rd3.result.includes('ZEILE ZWEI'));

  const ed2 = await api.ws.tool({ root, name: 'edit_file', args: { path: 'src/a.txt', old_text: 'gibt es nicht', new_text: 'x' } });
  ok('edit_file Fehlermeldung', ed2.ok === false && /nicht gefunden/.test(ed2.result), ed2.result);

  const se = await api.ws.tool({ root, name: 'search_text', args: { query: 'inhalt' } });
  ok('search_text (Groß-/Kleinschreibung egal)', /b\.md:2: INHALT/.test(se.result), se.result);

  const esc = await api.ws.tool({ root, name: 'read_file', args: { path: '../../etc/passwd' } });
  ok('Pfadschutz: außerhalb Workspace abgelehnt', esc.ok === false && /außerhalb/.test(esc.result), esc.result);

  /* ── Kodierung erhalten (Windows-1252 / BOM) ───────────────────── */
  console.log('\nKodierung …');
  // "Prüfung Umlaute" in Windows-1252 (ü = 0xFC) – absichtlich kein gültiges UTF-8
  const cp = Buffer.from([0x50, 0x72, 0xfc, 0x66, 0x75, 0x6e, 0x67, 0x20, 0x55, 0x6d, 0x6c, 0x61, 0x75, 0x74, 0x65]);
  Native.fsWrite('/ws/projekt/alt.ini', cp.toString('base64'), 'true');
  const erwartet = 'Pr' + String.fromCharCode(0xfc) + 'fung Umlaute';   // ü als Codepunkt, encoding-sicher
  const rdCp = await api.ws.tool({ root, name: 'read_file', args: { path: 'alt.ini' } });
  ok('Windows-1252 korrekt gelesen', rdCp.result.includes(erwartet), JSON.stringify([...rdCp.result].map((c) => c.codePointAt(0).toString(16))).slice(0, 90));
  await api.ws.tool({ root, name: 'edit_file', args: { path: 'alt.ini', old_text: 'Umlaute', new_text: 'Umlaute!' } });
  const raw = fs.readFileSync(toReal('/ws/projekt/alt.ini'));
  ok('Windows-1252 bleibt beim Schreiben erhalten', raw.includes(0xfc) && !raw.includes(0xc3), [...raw].slice(0, 12).join(','));

  /* ── Office-Dokumente (docs.js unverändert in der WebView) ─────── */
  console.log('\nDokument-Auslese …');
  const JSZip = globalThis.JSZip;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml',
    '<?xml version="1.0"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>Erster Absatz</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Zweiter </w:t></w:r><w:r><w:t>Absatz</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '</w:body></w:document>');
  const docxBuf = await zip.generateAsync({ type: 'nodebuffer' });
  Native.fsWrite('/ws/projekt/test.docx', docxBuf.toString('base64'), 'true');

  const rdDocx = await api.ws.tool({ root, name: 'read_file', args: { path: 'test.docx' } });
  ok('.docx wird als Text gelesen', rdDocx.ok && /Erster Absatz/.test(rdDocx.result) && /Zweiter Absatz/.test(rdDocx.result), JSON.stringify(rdDocx.result.slice(0, 120)));
  ok('Word-Tabelle als Markdown', /\| A \| B \|/.test(rdDocx.result), rdDocx.result.replace(/\n/g, ' | ').slice(0, 160));

  const att = await api.files.read(['/ws/projekt/test.docx'], { maxKB: 512, maxFiles: 60, maxTotalKB: 1024, ignore: [] });
  ok('Datei-Anhang .docx konvertiert', att.files.length === 1 && att.files[0].kind === 'text' && /Erster Absatz/.test(att.files[0].text), JSON.stringify(att.skipped));

  const wr = await api.ws.tool({ root, name: 'write_file', args: { path: 'x.docx', content: 'text' } });
  ok('Office-Dateien werden nicht als Text geschrieben', wr.ok === false && /nicht erzeugen/.test(wr.result), wr.result);

  /* ── Netzwerk: fetch und Streaming (CORS-frei über Brücke) ─────── */
  console.log('\nNetzwerk …');
  const tags = await api.fetch({ url: BASE + '/api/tags', method: 'GET', headers: {} });
  ok('fetch Modelliste', tags.ok && JSON.parse(tags.text).models.length === 2, JSON.stringify(tags));

  const e404 = await api.fetch({ url: BASE + '/err', method: 'GET', headers: {} });
  ok('fetch Fehlerstatus', e404.ok === false && e404.status === 404);

  const to = await api.fetch({ url: BASE + '/slow', method: 'GET', headers: {}, timeout: 120 });
  ok('fetch Zeitüberschreitung', to.ok === false && /Zeit/.test(to.error || ''), JSON.stringify(to));

  let streamed = '';
  let ended = false;
  await new Promise((res) => {
    api.stream({ id: 's1', url: BASE + '/stream', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, (ev) => {
      if (ev.type === 'data') streamed += ev.text;
      else { ended = true; res(); }
    });
    setTimeout(res, 4000);
  });
  ok('Streaming komplett empfangen', ended && streamed.includes('Hallo Wörld'), JSON.stringify(streamed));
  ok('Umlaute über Chunk-Grenze heil', streamed.includes('Wörld'), JSON.stringify(streamed));

  let errStatus = 0;
  await new Promise((res) => {
    api.stream({ id: 's2', url: BASE + '/err', method: 'POST', headers: {}, body: '{}' }, (ev) => { if (ev.type === 'error') { errStatus = ev.status; res(); } });
    setTimeout(res, 3000);
  });
  ok('Streaming-Fehler wird gemeldet', errStatus === 404, String(errStatus));

  /* ── Android-spezifisch: Befehle/SSH abgelehnt, aber nicht abgestürzt ── */
  console.log('\nDeaktivierte Desktop-Funktionen …');
  ok('IS_ANDROID gesetzt', window.IS_ANDROID === true);
  const ex = await api.sys.exec({ id: 'e1', root, command: 'dir' });
  ok('sys.exec meldet Android-Hinweis', ex.ok === false && /Android/.test(ex.result), JSON.stringify(ex));
  const strataErr = await new Promise((res) => { api.strata.run({ id: 'j1', target: {}, args: ['--version'] }, (ev) => res(ev)); setTimeout(() => res(null), 2000); });
  ok('strata.run meldet klaren Fehler statt zu hängen', !!strataErr && strataErr.type === 'error' && /Android/.test(strataErr.message || ''), JSON.stringify(strataErr));

  /* ── Chat löschen ─────────────────────────────────────────────── */
  await api.chats.delete('c1');
  const list2 = await api.chats.list();
  ok('chats:delete', list2.length === 0);

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\nErgebnis: ${pass} geprüft, ${fail} Fehler`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('Test lief auf einen Fehler:', e);
  server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(2);
});
