/* perf-messages.js – misst das echte Nachrichten-Rendering mit den echten Chats des Nutzers.
   Der groesste Chat hat 13 MB, ~3370 Nachrichten und ~1750 Werkzeug-Aufrufe. renderMessages()
   (app.js:736) baut dafuer die ganze Liste neu auf - im Renderer-Thread, also genau dort, wo auch
   Tastatureingaben verarbeitet werden. Laeuft in jsdom mit demselben Aufbau wie test-ui-boot.js.

   Aufruf: node tools-android\perf-messages.js      (aus LLM-Box\)  */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, '..', 'webdeps', 'node_modules', 'jsdom'));

/* Standardmaessig die Android-Fassung. Mit --webapp <ordner> laesst sich jede beliebige
   Oberflaeche messen - z. B. die aus der INSTALLIERTEN Windows-app.asar entpackte, um zu
   beweisen, dass die ausgelieferte Fassung den Fix wirklich enthaelt. */
const argOut = process.argv.indexOf('--webapp');
const WEBAPP = argOut >= 0 ? path.resolve(process.argv[argOut + 1])
  : path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'webapp');
const CHATDIR = 'Y:\\MeinProjekt\\LLM-Box-Chats';
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);

/* Dateisystem-Attrappe, identisch zu test-ui-boot.js */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmbox-perf-'));
const toReal = (p) => path.join(tmp, String(p).replace(/^\/+/, '').replace(/\//g, path.sep));
const Native = {
  appInfo: () => JSON.stringify({ version: 'perf', dataDir: '/data', workspaceRoot: '/ws', platform: 'android', osLabel: 'perf' }),
  fsStat: (p) => { try { const s = fs.statSync(toReal(p)); return JSON.stringify({ ok: true, size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }); } catch { return '{"ok":false,"error":"nicht gefunden"}'; } },
  fsExists: (p) => JSON.stringify({ ok: true, exists: fs.existsSync(toReal(p)) }),
  fsReadB64: (p) => { try { return JSON.stringify({ ok: true, b64: fs.readFileSync(toReal(p)).toString('base64') }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsWrite: (p, b64, m) => { try { const f = toReal(p); if (m === 'true') fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b64 || '', 'base64')); return JSON.stringify({ ok: true, size: 1 }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsList: (p) => { try { const items = fs.readdirSync(toReal(p), { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory(), size: 10 })); return JSON.stringify({ ok: true, items }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsMkdirs: (p) => { try { fs.mkdirSync(toReal(p), { recursive: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  fsRemove: (p, r) => { try { fs.rmSync(toReal(p), { recursive: r === 'true', force: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  fsRename: (a, b) => { try { fs.renameSync(toReal(a), toReal(b)); return '{"ok":true}'; } catch { return '{"ok":false,"error":"nein"}'; } },
  httpFetch: () => '{"ok":true}', httpStream: () => '{"ok":true}', abort: () => '{"ok":true}',
  openExternal: () => '', pickFiles: () => '', pickFolder: () => '', saveAs: () => '',
  smbTest: (p) => JSON.stringify({ ok: false, error: 'perf-test' }), smbSaveCreds: () => '{"ok":true}', smbGetCreds: () => '{"ok":true,"user":"","domain":"","hasPass":false}',
  uiLog: () => '',
};

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e && e.message)));
  const dom = new JSDOM(fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8'), {
    url: 'file:///' + WEBAPP.replace(/\\/g, '/') + '/index.html',
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.Native = Native;
      win.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
      if (!win.Element.prototype.getContext) win.Element.prototype.getContext = () => null;
      // jsdom kennt keinen ResizeObserver (app.js:2349 nutzt ihn ohne Absicherung).
      win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 2500));   // Oberflaeche hochfahren lassen

  const hatS = (() => { try { return win.eval('typeof S') === 'object'; } catch { return false; } })();
  console.log('UI geladen: S vorhanden =', hatS, '| JS-Fehler:', errors.length);
  if (!hatS) { console.log('Fehler:', errors.slice(0, 3)); dom.window.close(); return; }

  const files = fs.readdirSync(CHATDIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
  const chats = files.map((f) => ({ f, size: fs.statSync(path.join(CHATDIR, f)).size })).sort((a, b) => b.size - a.size);

  for (const { f, size } of chats.slice(0, 2)) {
    const chat = JSON.parse(fs.readFileSync(path.join(CHATDIR, f), 'utf8'));
    if (!chat.messages || !chat.messages.length) continue;
    win.eval('S.chat = { id: "perf", title: "perf", created: 1, updated: Date.now(), model: "m", messages: [] };');

    console.log(`\n${f} (${(size / 1048576).toFixed(1)} MB, ${chat.messages.length} Nachrichten)`);
    let bisher = 0;
    for (const ziel of [50, 200, 500, 1000, chat.messages.length]) {
      if (ziel <= bisher) continue;
      win.eval(`S.chat.messages.push(...${JSON.stringify(chat.messages.slice(bisher, ziel))});`);
      bisher = ziel;

      let t = process.hrtime.bigint();
      win.eval('renderMessages()');
      const einmal = ms(t);

      t = process.hrtime.bigint();
      win.eval('renderChatList()');
      const liste = ms(t);

      const knoten = win.document.querySelectorAll('#messages-inner *').length;
      console.log(`  ${String(bisher).padStart(5)} Nachrichten: renderMessages ${String(einmal).padStart(6)} ms | DOM-Knoten ${knoten}`);
    }

    /* Tastendruck bei vollem Chat: der Handler selbst (app.js:2254) macht autosize + updateEstimate. */
    const ta = win.document.getElementById('input');
    if (ta) {
      ta.value = '';
      let t = process.hrtime.bigint();
      for (let i = 0; i < 100; i++) { ta.value += 'wort'; ta.dispatchEvent(new win.Event('input', { bubbles: true })); }
      console.log(`  100 Tastenanschlaege bei ${bisher} Nachrichten im Chat: ${ms(t)} ms`);
    }
    win.eval('S.chat = null; var m=document.getElementById("messages-inner"); if(m) m.innerHTML="";');
  }

  /* Kontext-Anzeige: laeuft sie pro Tastendruck und wie teuer ist sie bei grossem Chat? */
  try {
    let t = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) win.eval('updateCtxMeter()');
    console.log(`\n20x updateCtxMeter(): ${ms(t)} ms`);
  } catch (e) { console.log('\nupdateCtxMeter nicht messbar:', e.message); }

  dom.window.close();
})().catch((e) => { console.error('fehlgeschlagen:', (e && e.stack) || e); process.exit(1); });
