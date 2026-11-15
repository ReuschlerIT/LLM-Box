/* test-pdf.js – prueft die PDF-Auslese genau so, wie sie in der Android-WebView ablaeuft:
   docs.js -> pdfjs-dist/legacy/build/pdf.js (Bundle webdeps.js), ohne Worker-Datei.
   Aufruf: node tools-android\test-pdf.js     (aus LLM-Box\)  */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const WEBAPP = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'webapp');
let pass = 0, fail = 0;
function ok(n, c, e) { if (c) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FEHLER  ' + n + (e ? ' -> ' + e : '')); } }

/* Minimales PDF mit echtem Text (erzeugt wie von Hand: 1 Seite, Tj-Operator) */
function makePdf(lines) {
  const content = lines.map((l) => `BT /F1 12 Tf 40 ${720 - lines.indexOf(l) * 20} Td (${l}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

global.window = global;
window.matchMedia = () => ({ matches: false, addEventListener() {} });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmbox-pdf-'));
const toReal = (p) => path.join(tmp, String(p).replace(/^\/+/, '').replace(/\//g, path.sep));
window.Native = {
  appInfo: () => JSON.stringify({ dataDir: '/data', workspaceRoot: '/ws' }),
  fsStat: (p) => { try { const s = fs.statSync(toReal(p)); return JSON.stringify({ ok: true, size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }); } catch { return '{"ok":false,"error":"nicht gefunden"}'; } },
  fsReadB64: (p) => { try { return JSON.stringify({ ok: true, b64: fs.readFileSync(toReal(p)).toString('base64') }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsWrite: (p, b64, m) => { try { const f = toReal(p); if (m === 'true') fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b64 || '', 'base64')); return JSON.stringify({ ok: true, size: 1 }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsList: () => '{"ok":true,"items":[]}', fsMkdirs: () => '{"ok":true}', fsRemove: () => '{"ok":true}', fsRename: () => '{"ok":true}', fsExists: () => '{"ok":true,"exists":false}',
};
// Asynchrone Dateibruecke (fsJob + __fsResult) wie in der App nachbilden.
require('./test-fs-mock')(window.Native, global);

global.window = global;
window.matchMedia = () => ({ matches: false, addEventListener() {} });
function load(rel) { vm.runInThisContext(fs.readFileSync(path.join(WEBAPP, rel), 'utf8'), { filename: rel }); }

(async () => {
  load(path.join('vendor', 'webdeps.js'));
  load(path.join('vendor', 'pdf.worker.min.js'));   // wie in index.html vor node-shim.js
  ok('PDF-Worker stellt pdfjsWorker bereit', typeof globalThis.pdfjsWorker === 'function' || typeof globalThis.pdfjsWorker === 'object', typeof globalThis.pdfjsWorker);
  load(path.join('js', 'node-shim.js'));
  load(path.join('js', 'docs.js'));
  load(path.join('js', 'native-main.js'));

  fs.mkdirSync(toReal('/ws/projekt'), { recursive: true });
  const pdf = makePdf(['Erste Zeile des Dokuments', 'Zweite Zeile mit Inhalt']);
  fs.writeFileSync(toReal('/ws/projekt/test.pdf'), pdf);

  const r = await window.api.ws.tool({ root: '/ws/projekt', name: 'read_file', args: { path: 'test.pdf' } });  ok('PDF wird als Text gelesen', r.ok && /Erste Zeile des Dokuments/.test(r.result), JSON.stringify((r.result || '').slice(0, 160)));
  ok('PDF-Seitenzahl im Hinweistext', /PDF, 1 Seite/.test(r.result), (r.result || '').slice(0, 80));

  const att = await window.api.files.read(['/ws/projekt/test.pdf'], { maxKB: 512, maxFiles: 60, maxTotalKB: 1024, ignore: [] });
  ok('PDF als Datei-Anhang konvertiert', att.files.length === 1 && /Zweite Zeile/.test(att.files[0].text || ''), JSON.stringify(att.skipped));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nErgebnis: ${pass} geprueft, ${fail} Fehler`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('Fehler:', e && e.message);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(2);
});
