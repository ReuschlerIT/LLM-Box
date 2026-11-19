/* test-ui-boot.js – laedt die komplette Oberflaeche (index.html + alle Skripte) in jsdom und
   prueft, ob sie ohne JavaScript-Fehler hochfaehrt und die Knopfe/Dialoge auf Android funktionieren.
   Aufruf: node tools-android\test-ui-boot.js     (aus LLM-Box\)  */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, '..', 'webdeps', 'node_modules', 'jsdom'));

const WEBAPP = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'webapp');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FEHLER  ' + name + (extra ? ' -> ' + extra : '')); }
}

/* Dateisystem-Attrappe wie in der App */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmbox-ui-'));
const toReal = (p) => path.join(tmp, String(p).replace(/^\/+/, '').replace(/\//g, path.sep));
const Native = {
  appInfo: () => JSON.stringify({ version: 'test', dataDir: '/data', workspaceRoot: '/ws', platform: 'android', osLabel: 'Android-test' }),
  fsStat: (p) => { try { const s = fs.statSync(toReal(p)); return JSON.stringify({ ok: true, size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }); } catch { return '{"ok":false,"error":"nicht gefunden"}'; } },
  fsExists: (p) => JSON.stringify({ ok: true, exists: fs.existsSync(toReal(p)) }),
  fsReadB64: (p) => { try { return JSON.stringify({ ok: true, b64: fs.readFileSync(toReal(p)).toString('base64') }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsWrite: (p, b64, m) => { try { const f = toReal(p); if (m === 'true') fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b64 || '', 'base64')); return JSON.stringify({ ok: true, size: 1 }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsList: (p) => { try { const items = fs.readdirSync(toReal(p), { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory(), size: 10 })); return JSON.stringify({ ok: true, items }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsMkdirs: (p) => { try { fs.mkdirSync(toReal(p), { recursive: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  fsRemove: (p, r) => { try { fs.rmSync(toReal(p), { recursive: r === 'true', force: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  fsRename: (a, b) => { try { fs.renameSync(toReal(a), toReal(b)); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  httpFetch: () => '{"ok":true}',
  httpStream: () => '{"ok":true}',
  abort: () => '{"ok":true}',
  openExternal: () => '',
  pickFiles: () => '', pickFolder: () => '', saveAs: () => '',
  // Netzwerkordner (SMB): ein Pfad auf "testhost" tut so, als waere er erreichbar,
  // alles andere meldet einen Fehler. So lassen sich both Wege pruefen.
  smbTest: (p) => (/testhost/.test(p)
    ? JSON.stringify({ ok: true, host: 'testhost', share: 'daten', volume: 'DATEN', entries: 342, sample: 'LLM-Box, docs.js, app.js' })
    : JSON.stringify({ ok: false, error: 'Anmeldung abgelehnt (Test)' })),
  smbSaveCreds: (host, user, domain, pass) => {
    // Verhalten der echten Bruecke nachbilden: leer gelassene Felder veraendern nichts.
    const prev = credStore[host] || {};
    credStore[host] = {
      user: (!user && prev.user) ? prev.user : (user || ''),
      domain: (!domain && prev.domain) ? prev.domain : (domain || ''),
      pass: pass ? pass : (prev.pass || ''),
    };
    return '{"ok":true}';
  },
  smbGetCreds: (host) => {
    const c = credStore[host] || {};
    return JSON.stringify({ ok: true, user: c.user || '', domain: c.domain || '', hasPass: !!c.pass });
  },
};
// Zugangsdaten-Attrappe: initial wie auf dem Gerat (Benutzer + Passwort hinterlegt).
// "testhost" ist der Rechner, den dieser Test spaeter als Workspace setzt.
const credStore = { '192.0.2.30': { user: 'Familie.Reuschler', domain: '', pass: 'beispiel-passwort' },
                    testhost: { user: 'Familie.Reuschler', domain: '', pass: 'beispiel-passwort' } };
// Die Adapter-Selbstmessung schreibt nur, wenn die Bruecke uiLog hat. Ohne dieses Feld
// waere der Messpfad im Test nie ausgefuehrt worden - ein TypeError darin fiel deshalb
// nie auf. Das Mock zaehlt jetzt mit und liefert den letzten Satz zurueck.
const uiLogs = [];
Native.uiLog = (m) => { uiLogs.push(m); return ''; };

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e && e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

const dom = new JSDOM(fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8'), {
  url: 'file:///' + WEBAPP.replace(/\\/g, '/') + '/index.html',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

const win = dom.window;
win.Native = Native;                       // vor den Skripten bereitstellen
// Die echte Bruecke arbeitet Dateizugriffe asynchron ab (fsJob + __fsResult). Genau das
// muss die Attrappe nachbilden, sonst wartet der node-shim auf ein Ergebnis, das nie kommt.
require('./test-fs-mock')(Native, win);
if (!win.matchMedia) win.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
// jsdom kann kein Canvas: der Adapter misst Textbreiten der Auswahlfelder mit
// getContext('2d'). Ohne Mock meldet jsdom bei jeder Messung einen "Not implemented"-Fehler,
// der dann als unbehandelter Fehler der Oberflaeche zaehlt. Auf dem Gerat (echte WebView)
// funktioniert das; hier liefert der Mock null, der Adapter faellt auf die Schaetzung zurueck.
win.HTMLCanvasElement.prototype.getContext = () => null;
win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

/* Skripte in der Reihenfolge von index.html nachladen.
   WICHTIG (seit 1.0.82): frueher wurde jede Datei einzeln mit win.eval() ausgefuehrt.
   Dabei ist ein `const`/`let` auf Top-Level einer Datei in der naechsten Datei NICHT
   sichtbar, weil eval() fuer jeden Aufruf ein eigenes Skript-Umfeld anlegt. Die neue
   Oberflaeche nutzt aber genau das: util.js deklariert `const ICONS` und `const debounce`,
   und server.js, owui.js, app.js greifen darauf zurueck. Einzeln evalt meldete der Test
   dann "ICONS is not defined" - ein Test-Artefakt, kein Fehler auf dem Gerat (eine echte
   WebView fuehrt alle Skript-Tags im selben globalen Lexical Environment aus).
   Deshalb werden alle Skripte jetzt zu EINEM Quelltext zusammengefuegt und einmal
   ausgewertet - das teilt das Top-Level-Umfeld wie im Browser. Die Fehlerzuordnung pro
   Datei bleibt erhalten: jeder Abschnitt ist in einem try/catch mit Dateiname. */
const scripts = [...fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

(async () => {
  await new Promise((r) => setTimeout(r, 400));   // auf Ressourcen-Laden warten

  let zusammen = '';
  for (const s of scripts) {
    const file = path.join(WEBAPP, s);
    if (!fs.existsSync(file)) { errors.push(`Skript ${s}: Datei fehlt`); continue; }
    // Kein try/catch pro Datei: das wuerde das gemeinsame Top-Level-Umfeld wieder zerschneiden.
    // Stattdessen laeuft alles in einem Durchlauf; schlaegt es fehl, zaehlt der Fehler unten.
    zusammen += `\n/* === ${s} === */\n` + fs.readFileSync(file, 'utf8') + `\n`;
  }
  try { win.eval(zusammen); }
  catch (e) {
    // Fundstelle in der Zusammensetzung finden, damit klar ist, welche Datei fehlerhaft ist.
    const fund = /\/\* === (.+?) === \*\//g;
    let letzte = '?';
    let m;
    while ((m = fund.exec(zusammen))) letzte = m[1];
    errors.push(`Skripte gemeinsam geladen (letzte: ${letzte}): ${e.message}`);
  }

  await new Promise((r) => setTimeout(r, 600));   // init() ablaufen lassen

  console.log('Oberflaeche starten …');
  ok('keine JavaScript-Fehler beim Start', errors.length === 0, errors.slice(0, 4).join(' | '));
  ok('window.api vorhanden', !!win.api);
  ok('IS_ANDROID gesetzt', win.IS_ANDROID === true);

  const d = win.document;
  ok('Chat-Liste gerendert', !!d.querySelector('#chat-list'));
  ok('Eingabefeld vorhanden', !!d.querySelector('#input'));
  ok('Modell-Auswahl gefüllt oder leer ohne Fehler', !!d.querySelector('#sel-model'));

  console.log('\nAndroid-Anpassungen …');
  ok('Mobil-CSS geladen', [...d.querySelectorAll('link[rel=stylesheet]')].some((l) => (l.getAttribute('href') || '').includes('android.css')));
  const burger = d.querySelector('#btn-drawer');
  ok('Hamburger-Knopf eingefuegt', !!burger);

  // Einstellungen oeffnen und sehen, ob Desktop-only-Schalter verschwinden
  const btnSettings = d.querySelector('#btn-settings');
  if (btnSettings) btnSettings.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  const bodyTxt = d.body.textContent || '';
  ok('Einstellungen geoeffnet', /Verbindung|Erscheinungsbild|Workspace/.test(bodyTxt), bodyTxt.slice(0, 80));

  // Workspace-Tab ansteuern (dort liegen die Befehls-Schalter). Die Einstellungen rendern
  // ihre Tabs als ".settings nav button" - fruehere Selektoren (.tab, [role=tab]) trafen
  // nichts, der Test war damit ein Schein-Erfolg.
  const tabs = [...d.querySelectorAll('.settings nav button')];
  ok('Einstellungen haben Tabs (Test prueft wirklich etwas)', tabs.length >= 5, 'Tabs: ' + tabs.map((t) => t.textContent.trim()).join(', '));
  const wsTab = tabs.find((t) => /Workspace/.test(t.textContent || ''));
  if (wsTab) wsTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  const hidden = [...d.querySelectorAll('.frow')].filter((r) => r.style.display === 'none');
  const execRowVisible = [...d.querySelectorAll('.frow')].some((r) => /KI darf Programme ausführen/.test(r.textContent || '') && r.style.display !== 'none');
  ok('Schalter „Programme ausführen“ nicht sichtbar', !execRowVisible, `versteckte Zeilen: ${hidden.length}`);

  console.log('\nNetzwerkordner (SMB) …');
  const wsRow = [...d.querySelectorAll('.frow')].find((r) => /Workspace-Ordner/.test(r.textContent || ''));
  ok('Workspace-Zeile gefunden', !!wsRow, 'Zeilen: ' + d.querySelectorAll('.frow').length);

  const smbBox = [...d.querySelectorAll('.frow')].find((r) => /Netzwerkordner \(SMB\)/.test(r.textContent || ''));
  ok('SMB-Feld wird unter dem Workspace-Ordner eingefuegt', !!smbBox, 'Adapter lief oder nicht?');

  if (smbBox) {
    const inputs = [...smbBox.querySelectorAll('input')];
    ok('SMB-Feld hat Pfad, Benutzer, Domain und Passwort', inputs.length === 4, 'Eingaben: ' + inputs.length);

    // Windows-Syntax eingeben und uebernehmen - die App muss sie in /smb/… uebersetzen
    const pathIn = inputs[0];
    pathIn.value = '\\192.0.2.10\\daten\\MeinProjekt';
    const applyBtn = [...smbBox.querySelectorAll('button')].find((b) => /Verbinden/.test(b.textContent || ''));
    ok('Knopf „Verbinden & übernehmen“ vorhanden', !!applyBtn, 'Knöpfe: ' + [...smbBox.querySelectorAll('button')].map((b) => b.textContent).join(', '));

    const statusEl = () => smbBox.querySelector('.smb-status');

    if (applyBtn) {
      // 1) Ablehnende Freigabe: Fehler muss sichtbar werden, Pfad darf nicht gesetzt bleiben
      pathIn.value = '\\192.0.2.10\\daten';
      applyBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      ok('Ablehnung wird als Fehler gemeldet', /Anmeldung abgelehnt/.test(statusEl() ? statusEl().textContent : ''), statusEl() ? statusEl().textContent.slice(0, 90) : 'kein Hinweis');

      // 2) Erreichbare Freigabe: Pfad setzen, Bestaetigung mit Eintragzahl, Label der Zeile darueber
      pathIn.value = '\\testhost\\daten\\MeinProjekt';
      applyBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      const st = statusEl() ? statusEl().textContent : '';
      ok('Erfolg gemeldet mit Eintragzahl und Beispielen', /342 Einträge/.test(st) && /LLM-Box/.test(st), st.slice(0, 120));

      // ueber die echte Persistenz pruefen (app.js deklariert S als const -> kein window.S)
      const stored = await win.api.store.get('settings');
      const saved = stored && stored.workspace ? stored.workspace.path : '';
      ok('Pfad ist persistiert (/smb/…)', saved === '/smb/testhost/daten/MeinProjekt', 'gespeichert: ' + saved);

      // Der entscheidende Nachweis fuer die Rueckmeldung des Nutzers: die Zeile DARUEBER
      // muss den Ordner anzeigen, nicht "Kein Ordner gewaehlt".
      const row = [...d.querySelectorAll('.frow')].find((r) => /Workspace-Ordner/.test(r.textContent || ''));
      const wsLabel = row ? row.querySelector('.fctrl > div') : null;
      ok('Workspace-Zeile zeigt den Netzwerkordner an', !!wsLabel && /\\\\testhost\\daten\\MeinProjekt/.test(wsLabel.textContent || ''), 'angezeigt: ' + (wsLabel ? wsLabel.textContent : 'kein Feld'));

      // 3) Nur-Test-Knopf bestaetigt Aktivstatus
      const probeBtn = [...smbBox.querySelectorAll('button')].find((b) => /Nur Verbindung/.test(b.textContent || ''));
      ok('Knopf „Nur Verbindung testen“ vorhanden', !!probeBtn, 'Knöpfe: ' + [...smbBox.querySelectorAll('button')].map((b) => b.textContent).join(', '));
      if (probeBtn) {
        probeBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        ok('Test meldet „als Workspace aktiv“', /ist als Workspace aktiv/.test(statusEl() ? statusEl().textContent : ''), (statusEl() || {}).textContent);
      }
    }
  }

  console.log('\nZugangsdaten bleiben erhalten (Nutzerbericht) …');
  // Der Nutzer berichtete, Benutzername/Passwort seien nach App-Neustart oder nach
  // Verlassen des Menues weg. In smb.json waren sie aber vorhanden – die Felder wurden nur
  // nie vorbelegt, und ein leer bestaetigtes Feld loeschte den gespeicherten Benutzer.
  if (smbBox) {
    const ins = [...smbBox.querySelectorAll('input')];
    const pathIn2 = ins[0], userIn2 = ins[1], passIn2 = ins[3];

    // 1) Beim Oeffnen vorbelegen: Pfad verlassen (blur) -> gespeicherter Benutzer erscheint
    userIn2.value = '';
    pathIn2.dispatchEvent(new win.Event('blur', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    ok('Benutzername wird beim Oeffnen vorbelegt', userIn2.value === 'Familie.Reuschler', 'Feld: "' + userIn2.value + '"');
    ok('Hinweis auf gespeichertes Passwort erscheint', /gespeichert/.test(passIn2.placeholder || ''), 'placeholder: ' + passIn2.placeholder);

    // 2) Leere Felder duerfen den gespeicherten Wert nicht loeschen
    const before = credStore.testhost.user;
    Native.smbSaveCreds('testhost', '', '', '');
    ok('leere Eingabe ueberschreibt keinen gespeicherten Benutzer', credStore.testhost.user === before, 'jetzt: "' + credStore.testhost.user + '"');
    ok('Passwort bleibt unveraendert', credStore.testhost.pass === 'beispiel-passwort', 'pass: ' + (credStore.testhost.pass || '(leer)'));

    // 3) Die Bruecke liefert nie das Passwort selbst, nur dass eines da ist
    const got = JSON.parse(Native.smbGetCreds('testhost'));
    ok('smbGetCreds liefert kein Passwort zurueck', !('pass' in got) && got.hasPass === true, JSON.stringify(got));
  }

  console.log('\nStatuszeile und Kontext-Füllstand …');
  // 1) "Modell:" entfällt, damit Tokens/Kosten/Dauer Platz haben
  const stL = d.getElementById('st-left');
  ok('Statuszeile links beginnt nicht mit „Modell:“', !/^Modell:/.test((stL.textContent || '').trim()), 'text: ' + (stL.textContent || '').slice(0, 40));

  // 2) Die Anzeige rechts darf nicht mehr abgeschnitten werden
  const stR = d.getElementById('st-right');
  const csR = win.getComputedStyle(stR);
  ok('Tokens/Kosten/Dauer duerfen umbrechen (kein Abschneiden)', csR.whiteSpace === 'normal' && csR.textOverflow !== 'ellipsis',
    `white-space:${csR.whiteSpace}, overflow:${csR.textOverflow}`);

  // 3) Kontext-Füllstand in eigener Zeile: Element haengt direkt an #topbar
  const ctxm = d.getElementById('ctx-meter');
  ok('Kontextbalken wurde in die Kopfzeile verschoben', !!ctxm && ctxm.parentNode && ctxm.parentNode.id === 'topbar',
    'Elter: ' + (ctxm ? (ctxm.parentNode.id || ctxm.parentNode.tagName) : 'fehlt'));

  console.log('\nChatliste: Umbenennen/Löschen dauerhaft sichtbar …');
  // Die Desktop-Oberflaeche zeigt diese Knopfe nur bei Maus-Hover (styles.css:
  // .chat-item .acts { display:none }). Auf dem Handy gibt es kein Hover, sie waren damit
  // unauffindbar. android.css muss sie dauerhaft einblenden.
  // Ein Chat muss vorhanden sein, damit eine Zeile gemessen werden kann.
  await win.api.chats.save(
    { id: 'liste1', title: 'Listentest', created: Date.now(), updated: Date.now(), messages: [{ role: 'user', content: 'hallo' }] },
    { id: 'liste1', title: 'Listentest', created: Date.now(), updated: Date.now() });
  await win.loadChatList();
  // Die Adapter-Messung laeuft bei Aenderungen der Chatliste: einmal anstossen und warten,
  // damit die unten gepruefte Messung den gerade angelegten Chat enthaelt.
  if (win.Native.uiLog) { const before = uiLogs.length; d.body.classList.add('measure-ping'); await new Promise((r) => setTimeout(r, 300)); d.body.classList.remove('measure-ping'); }

  const chatItems = [...d.querySelectorAll('.chat-item')];
  ok('Chatliste enthaelt Zeilen mit Aktionen', chatItems.length > 0 && !!chatItems[0].querySelector('.acts .mini-btn'), 'Zeilen: ' + chatItems.length);

  // Referenzmessung: zeigt, ob jsdom die eingebundenen Stylesheets ueberhaupt auswertet.
  // #titlebar wird in android.css auf display:none gesetzt – ohne Auswertung waere der
  // nachfolgende Test ein Schein-Erfolg.
  const tbDisp = win.getComputedStyle(d.getElementById('titlebar') || d.body).display;
  ok('CSS-Auswertung in der Attrappe wirksam (Titelleiste ausgeblendet)', tbDisp === 'none', 'gemessen: ' + tbDisp);

  /* ── Einheitliches Bild unter dem Burger (Nutzerwunsch 14.11.) ──
     Der Knopf "Modelle neu laden" stand in .selectors hinter der Modellauswahl und brach bei
     schmalem Bildschirm um – er landete links in der zweiten Zeile, direkt unter dem Hamburger.
     Gewuenschtes Verhalten: auf Android ausgeblendet, auf Windows weiterhin vorhanden.
     Geprueft wird per gerendertem display (nicht am Quelltext), weil ein Entfernen aus dem DOM
     app.js:219/2359 zum Absturz bringen wuerde – die Stelle muss also im Baum BLEIBEN. */
  const refresh = d.getElementById('btn-refresh');
  ok('Knopf "Modelle neu laden" bleibt im Dokument (app.js greift direkt darauf zu)', !!refresh);
  if (refresh) {
    const rDisp = win.getComputedStyle(refresh).display;
    ok('auf Android ausgeblendet (kein umgebrochener Knopf unter dem Burger)', rDisp === 'none', 'gemessen: ' + rDisp);
    /* app.js verknuepft ueber addEventListener (app.js:2359), .onclick bleibt deshalb undefined.
       Geprueft wird stattdessen, dass der Knopf unangetastet ist: Titel gesetzt und Icon gemalt
       (app.js:219) – beides passiert nur, wenn der Knoten beim Start gefunden wurde. */
    ok('Knopf bleibt unveraendert verdrahtet (Titel und Icon vorhanden)',
      /Modelle neu laden/.test(refresh.getAttribute('title') || '') && (refresh.innerHTML || '').length > 0,
      'titel=' + refresh.getAttribute('title') + ', innerHTML=' + String(refresh.innerHTML).slice(0, 30));
  }
  /* Die Auswahlfelder duerfen nicht mehr die Breite des ausgeblendeten Knopfes abrechnen. */
  const selBox = d.querySelector('#topbar .selectors');
  ok('Auswahlreihe vorhanden (Breitenberechnung laeuft weiter)', !!selBox);

  if (chatItems.length) {
    const acts = chatItems[0].querySelector('.acts');
    const disp = win.getComputedStyle(acts).display;
    ok('Aktionsknopfe sind dauerhaft sichtbar (kein Hover noetig)', disp !== 'none' && disp !== '', 'display: ' + disp);

    const btns = [...acts.querySelectorAll('.mini-btn')];
    // Seit 1.0.73 (Chats ordnen) kommen zu Umbenennen und Loeschen weitere Knopfe dazu:
    // Anheften, Tags, Archivieren. Der Test prueft deshalb nicht mehr "genau 2", sondern
    // dass die beiden bekannten (Stift = Umbenennen, Papierkorb = Loeschen) vorhanden sind.
    ok('Stift und Papierkorb vorhanden', btns.length >= 2, 'Knopfe: ' + btns.length);
    const titles = btns.map((b) => b.getAttribute('title'));
    ok('Knopfe sind beschriftet (Umbenennen/Löschen)', titles.some((t) => /Umbenennen/.test(t || '')) && titles.some((t) => /öschen/.test(t || '')), titles.join(', '));

    // Groesse: muss mit dem Finger sicher zu treffen sein
    const cs = btns.length ? win.getComputedStyle(btns[0]) : null;
    ok('Knopfe sind touch-tauglich groß (>= 36px)', !!cs && parseFloat(cs.minWidth) >= 36 && parseFloat(cs.minHeight) >= 36,
      cs ? `min ${cs.minWidth} x ${cs.minHeight}` : 'kein Stil');

    // Die Adapter-Selbstmessung muss wirklich ins Log schreiben: sie war durch einen
    // TypeError (getComputedStyle bekam ein DOMRect statt ein Element) komplett ausgefallen,
    // weil das umschliessende catch den Fehler verschluckte. Ohne uiLog-Mock im Test waere
    // dieser Pfad nie ausgefuehrt worden.
    const logged = uiLogs.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    ok('Adapter-Selbstmessung schreibt in die Bruecke', logged.length > 0, 'Logsaetze: ' + uiLogs.length);
    const withActs = logged.find((o) => o && o.chatActs);
    // buttons seit 1.0.73 nicht mehr genau 2 (Anheften, Tags, Archivieren kommen dazu).
    ok('Messung meldet die Aktionsknopfe der Chatliste', !!withActs && withActs.chatActs.acts !== 'none' && withActs.chatActs.buttons >= 2,
      JSON.stringify(withActs ? withActs.chatActs : null));
  }

  console.log('\nChats auf mehreren Rechnern: Netzlaufwerk als Chat-Ordner …');
  // Der Daten-Reiter enthaelt die Sync-Zeile. Auf Android gab es dort bisher nur die
  // System-Ordnerauswahl (kopiert in den App-Speicher) – Netzfreigaben waren nicht waehlbar.
  const dataTab = [...d.querySelectorAll('.settings nav button')].find((b) => /^Daten/.test((b.textContent || '').trim()));
  ok('Reiter „Daten“ gefunden', !!dataTab, 'Tabs: ' + [...d.querySelectorAll('.settings nav button')].map((t) => t.textContent.trim()).join(', '));
  if (dataTab) dataTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));   // syncRowHolder() baut nach api.sync.get() auf

  const syncRow = [...d.querySelectorAll('.frow')].find((r) => /Chats auf mehreren Rechnern/.test(r.textContent || ''));
  ok('Sync-Zeile der Desktop-Oberflaeche vorhanden', !!syncRow, 'Zeilen: ' + [...d.querySelectorAll('.frow')].map((r) => (r.textContent || '').trim().slice(0, 24)).join(' | ').slice(0, 600));

  const syncBox = [...d.querySelectorAll('.frow')].find((r) => /Netzlaufwerk \(Windows-Freigabe\) als Chat-Ordner/.test(r.textContent || ''));
  ok('Freigabe-Eingabe in der Sync-Zeile vorhanden', !!syncBox, 'Adapter lief oder nicht?');

  if (syncBox) {
    const sInputs = [...syncBox.querySelectorAll('input')];
    ok('Feld hat Pfad, Benutzer, Domain und Passwort', sInputs.length === 4, 'Eingaben: ' + sInputs.length);
    const sStatus = () => syncBox.querySelector('.smb-status');

    // Hinweis des Adapters darf nicht vom Workspace-Hinweis ueberschrieben werden
    const hint = [...syncBox.querySelectorAll('.fhint')].find((e) => /Netzlaufwerke in der Ordnerauswahl/.test(e.textContent || ''));
    ok('Hinweistext bleibt erhalten (nicht durch Workspace-Text ersetzt)', !!hint, hint ? '' : 'text ersetzt?');

    const sBtns = [...syncBox.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
    ok('Knopf „Freigabe verbinden & übernehmen“ vorhanden', sBtns.some((t) => /verbinden & übernehmen/.test(t)), 'Knöpfe: ' + sBtns.join(', '));

    // Ablehnende Freigabe: Fehler muss sichtbar werden
    sInputs[0].value = '\\192.0.2.10\\daten';
    [...syncBox.querySelectorAll('button')].find((b) => /verbinden & übernehmen/.test(b.textContent || '')).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    ok('Ablehnung wird auch hier gemeldet', /Anmeldung abgelehnt/.test(sStatus() ? sStatus().textContent : ''), sStatus() ? sStatus().textContent.slice(0, 90) : 'kein Hinweis');

    // Erreichbare Freigabe: setzen, dann die Rueckfrage nach dem Kopieren bestaetigen
    sInputs[0].value = '\\testhost\\daten';
    [...syncBox.querySelectorAll('button')].find((b) => /verbinden & übernehmen/.test(b.textContent || '')).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const copyBtn = [...d.querySelectorAll('#modal-root button')].find((b) => /^Kopieren$/.test((b.textContent || '').trim()));
    ok('Rueckfrage nach dem Kopieren erscheint', !!copyBtn, 'Knöpfe im Modal: ' + [...d.querySelectorAll('#modal-root button')].map((b) => b.textContent.trim()).join(', '));
    if (copyBtn) copyBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 900));

    const sy = await win.api.sync.get();
    ok('sync.setDir wurde ausgefuehrt (/smb/testhost/daten)', (sy.dir || '').replace(/\\/g, '/') === '/smb/testhost/daten', 'gespeichert: ' + sy.dir);
    ok('Chat-Ordner zeigt Unterordner LLM-Box-Chats', /LLM-Box-Chats/.test((sy.folder || '').replace(/\\/g, '/')), 'Ordner: ' + sy.folder);

    // Nach dem Neuaufbau des Reiters muss der aktive Ordner weiterhin angezeigt werden
    const syncBox2 = [...d.querySelectorAll('.frow')].find((r) => /Netzlaufwerk \(Windows-Freigabe\) als Chat-Ordner/.test(r.textContent || ''));
    ok('Bereich wird nach dem Neuaufbau erneut eingebaut', !!syncBox2);
    if (syncBox2) {
      await new Promise((r) => setTimeout(r, 900));   // automatischer Verbindungsnachweis
      const st2 = syncBox2.querySelector('.smb-status');
      ok('Aktiver Chat-Ordner wird bestaetigt', /als Chat-Ordner aktiv/.test(st2 ? st2.textContent : ''), st2 ? st2.textContent.slice(0, 120) : 'kein Hinweis');
    }

    // Der Android-irrefuehrende Desktop-Knopf ist eindeutig beschriftet
    const rowSync = [...d.querySelectorAll('.frow')].find((r) => /Chats auf mehreren Rechnern/.test(r.textContent || ''));
    const phoneBtn = rowSync ? [...rowSync.querySelectorAll('button')].find((b) => /Ordner auf dem Handy/.test(b.textContent || '')) : null;
    ok('Desktop-Knopf als „Ordner auf dem Handy …“ beschriftet', !!phoneBtn, 'Knöpfe: ' + (rowSync ? [...rowSync.querySelectorAll('button')].map((b) => b.textContent.trim()).join(', ') : 'keine Zeile'));

    /* ── Neue Rhythmus-Einstellung (Echtzeit bis 30 Minuten) ──
       Sie stammt aus der gemeinsamen Desktop-Oberflaeche und muss auf Android genauso
       erscheinen wie unter Windows - der Adapter darf sie nicht ausblenden. */
    const everyRow = [...d.querySelectorAll('.frow.sync-every')][0];
    ok('Rhythmus-Zeile „Chats abgleichen alle …“ sichtbar', !!everyRow && /Chats abgleichen alle/.test(everyRow.textContent || ''), 'Zeilen: ' + d.querySelectorAll('.frow').length);
    if (everyRow) {
      ok('Rhythmus-Zeile ist auf Android nicht ausgeblendet', everyRow.style.display !== 'none' && !everyRow.classList.contains('android-hidden'));
      const eSel = everyRow.querySelector('select');
      const eOpts = eSel ? [...eSel.options].map((o) => o.value) : [];
      ok('Rhythmus-Stufen 2s bis 30min vorhanden', !!eSel && eOpts.length === 8 && eOpts[0] === '2000' && eOpts[eOpts.length - 1] === '1800000', 'Stufen: ' + eOpts.join(','));
      const syBefore = await win.api.sync.get();
      ok('Auswahl zeigt den gespeicherten Wert', !!eSel && eSel.value === String(syBefore.everyMs), 'angezeigt: ' + (eSel ? eSel.value : '-') + ', gespeichert: ' + syBefore.everyMs);
      if (eSel) {
        eSel.value = '30000';
        eSel.dispatchEvent(new win.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        const syAfter = await win.api.sync.get();
        ok('Aenderung der Stufe wird gespeichert (30 s)', syAfter.everyMs === 30000, 'gespeichert: ' + syAfter.everyMs);
        eSel.value = '2000';
        eSel.dispatchEvent(new win.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        const syBack = await win.api.sync.get();
        ok('zurueck auf Echtzeit gestellt', syBack.everyMs === 2000, 'gespeichert: ' + syBack.everyMs);
      }
    }

    // Wieder lokal speichern, damit spaetere Pruefungen nicht auf der Freigabe hängen
    await win.api.sync.setDir('');
  }

  console.log('\nServer-Fenster (Strata) …');
  const btnServer = d.querySelector('#btn-server');
  if (btnServer) btnServer.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));

  // In den Server-Bereich wechseln und pruefen, dass keine CLI-Knöpfe bedienbar bleiben.
  // ACHTUNG (Fehler von 12.11., war auch hier falsch): der Reiter „Modell starten" heisst wie
  // ein CLI-Knopf, ist aber ein Tab in nav - er muss sichtbar bleiben. Frueher hat der Adapter
  // ihn versteckt und den Hinweistext in die Tab-Leiste gehaengt: Leiste 426 px hoch, Inhalt
  // verdeckt (Beschwerde des Nutzers). Der Test prueft deshalb beides getrennt.
  // Der richtige Dialog: in jsdom bleibt der Einstellungs-Dialog offen, es gibt dann zwei
  // ".settings nav". Erkennbar am Reiter "Zielrechner" (gibt es nur im Server-Fenster).
  const allNavs = [...d.querySelectorAll('.settings nav')];
  const nav = allNavs.find((n) => [...n.querySelectorAll('button')].some((b) => /Zielrechner/.test(b.textContent || '')));
  ok('Server-Dialog geoeffnet (eigener Tab-Satz)', !!nav, 'navs gesamt: ' + allNavs.length);
  const startTab = nav ? [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Modell starten') : null;
  if (startTab) startTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));

  const svButtons = [...d.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  ok('Server-Fenster enthält Knöpfe (Test prüft wirklich etwas)', svButtons.length > 5, 'Knöpfe gesamt: ' + svButtons.length);
  ok('Reiter „Modell starten" bleibt erhalten', !!startTab && startTab.style.display !== 'none');

  // Tab-Leiste darf nicht aufgeblaht werden (die alte Beschwerde): massiver Hinweis in nav = Fehler
  const navNote = nav ? [...nav.children].filter((c) => c.tagName === 'DIV') : [];
  ok('Kein Hinweistext in der Tab-Leiste', navNote.length === 0, 'DIVs in nav: ' + navNote.length);

  // Der Reiter fuehrt zur CLI-Karte - dort müssen die echten CLI-Knöpfe versteckt sein.
  const cliVisible = [...d.querySelectorAll('button')].filter((b) => {
    const t = (b.textContent || '').trim();
    if (!['Plan anzeigen', 'Presets', 'Schlüssel anzeigen', 'Modelle auf dem Server'].some((x) => t.startsWith(x))) return false;
    if (nav && nav.contains(b)) return false;           // Reiter, kein CLI-Befehl
    if (!b.classList.contains('btn') && !b.classList.contains('icon-btn')) return false;
    return b.style.display !== 'none';
  });
  ok('Keine Strata-CLI-Knöpfe aktiv', cliVisible.length === 0, 'sichtbar: ' + cliVisible.map((b) => b.textContent.trim()).join(', '));

  // Nachweis, dass der Adapter wirklich auf echte Knöpfe gewirkt hat: er fügt genau dort
  // einen Hinweistext ein. Ohne anwesende CLI-Knöpfe gäbe es diesen Hinweis nicht.
  const note = [...d.querySelectorAll('.fhint')].find((e) => /Modell starten und entladen läuft auf Android/.test(e.textContent || ''));
  ok('Adapter hat die CLI-Knopfgruppe erkannt und ersetzt', !!note, 'Hinweise gesamt: ' + d.querySelectorAll('.fhint').length);

  console.log('\nBedienungs-Grundfluss …');
  const input = d.querySelector('#input');
  const sendBtn = d.querySelector('#btn-send');
  if (input && sendBtn) {
    input.value = 'Testnachricht';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    sendBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    ok('Senden loest keine unbehandelten Fehler aus', errors.length === 0, errors.slice(0, 3).join(' | '));
  }

  const newBtn = d.querySelector('#btn-new');
  if (newBtn) newBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  ok('Neuer Chat ohne Fehler', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ── Fensterweise Darstellung vieler Nachrichten (gegen das Zogern in grossen Chats) ──
     Vorher baute renderMessages() bei ~3400 Nachrichten den kompletten Chat auf: gemessen
     2966 ms und 110.243 DOM-Knoten (tools-android\perf-messages.js). Jetzt werden nur die
     neuesten Nachrichten voll aufgebaut, weiter zurueck erscheint eine kompakte Zeile. */
  console.log('\nViele Nachrichten: fensterweiser Aufbau …');
  const viele = [];
  for (let i = 0; i < 900; i++) {
    viele.push(i % 3 === 0
      ? { role: 'user', content: 'Frage ' + i + ' ' + ('wort '.repeat(20)) }
      : i % 3 === 1
        ? { role: 'assistant', content: 'Antwort ' + i, model: 'm', id: 'a' + i }
        : { role: 'tool', name: 'read_file', args: { path: 'datei' + i + '.txt' }, result: 'inhalt ' + i });
  }
  win.eval(`S.chat = { id: 'gross', title: 'gross', created: 1, updated: Date.now(), model: 'm', messages: ${JSON.stringify(viele)} }; renderMessages();`);
  await new Promise((r) => setTimeout(r, 300));

  const inner = d.querySelector('#messages-inner');
  const knoten = inner.querySelectorAll('*').length;
  const voll = inner.querySelectorAll('.msg:not(.compact)').length;
  const kompakt = inner.querySelectorAll('.msg.compact').length;
  ok('nicht alle Nachrichten werden als volle Knoten aufgebaut', voll < 200, `volle: ${voll}, kompakte: ${kompakt}, gesamt: ${knoten}`);
  ok('aeltere Nachrichten erscheinen als kompakte Zeile', kompakt > 50, 'kompakte: ' + kompakt);
  ok('DOM-Knoten bleiben klein (vorher ~110.000 bei 3400 Nachrichten)', knoten < 8000, 'Knoten: ' + knoten);

  const steps = inner.querySelector('.msg-steps button');
  ok('Knopf „aeltere anzeigen“ vorhanden', !!steps, steps ? steps.textContent : 'keine Sammelzeile');

  // Aufklappen einer kompakten Zeile muss die echte Nachricht zeigen
  const erste = inner.querySelector('.msg.compact');
  if (erste) {
    erste.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const jetztVoll = d.querySelectorAll('#messages-inner .msg:not(.compact)').length;
    ok('aufgeklappte kompakte Zeile wird vollstaendig angezeigt', jetztVoll > voll, `vorher ${voll}, nachher ${jetztVoll}`);
  }

  // Mehr "aeltere anzeigen" vergroessert das Fenster, ohne alles aufzubauen
  if (steps) {
    for (let i = 0; i < 3; i++) { d.querySelector('.msg-steps button').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 120)); }
    const nachher = d.querySelectorAll('#messages-inner .msg:not(.compact)').length;
    ok('mehrere aeltere Stufen vergroessern das Fenster begrenzt', nachher > voll && nachher < 600, 'volle: ' + nachher);
  }

  // Chat-Inhalt darf durch die Anzeige nicht veraendert sein (Ausdruck des Nutzers)
  const anzahl = win.eval('S.chat.messages.length');
  ok('Chat-Inhalt bleibt unveraendert (nur Darstellung)', anzahl === viele.length, 'Nachrichten: ' + anzahl);

  // Neue Nachricht am Ende wandert mit und bleibt vollstaendig sichtbar
  win.eval(`S.chat.messages.push({ role: 'user', content: 'brandneu' }); renderMessages();`);
  await new Promise((r) => setTimeout(r, 200));
  const letzte = [...d.querySelectorAll('#messages-inner .msg')].pop();
  ok('neueste Nachricht wird vollstaendig angezeigt', !!letzte && !letzte.classList.contains('compact'), letzte ? letzte.className : 'keine');

  win.eval('S.chat = null; document.getElementById("messages-inner").innerHTML = "";');
  ok('fensterweiser Aufbau loest keine Fehler aus', errors.length === 0, errors.slice(0, 3).join(' | '));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nErgebnis: ${pass} geprueft, ${fail} Fehler`);
  if (errors.length) { console.log('\nFehler-Details:'); for (const e of errors.slice(0, 12)) console.log('  * ' + e); }
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => {
  console.error('Test lief auf einen Fehler:', e);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(2);
});
