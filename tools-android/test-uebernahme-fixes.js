/* test-uebernahme-fixes.js – sichert die vier Fehler, die der Nutzer am 14.11. gemeldet hat:

   Meldung im Wortlaut (sinngemaess): "QR Code scannen funktioniert nicht, man sieht das Kamerabild
   nicht (S20). Auf dem S948B sieht man das Bild und kann scannen, aber es werden keine SMB-Uebergaben
   durchgefuehrt. Ein zweites Mal kann man nicht mehr auf QR-Code scannen klicken, der Knopf ist
   ausgegraut. Ausserdem bleibt es bei 'Adresse erkannt – Daten werden abgerufen…' stehen. Ausserdem
   sind auf dem PC zwar Laufwerk Y angegeben, das ist aber eine SMB-Freigabe – daher vermutlich die Fehler?"

   Was dieser Test prueft (und warum genau das die vier Ursachen trifft):
     A) Laufwerksbuchstabe darf NICHT als Rechnername gedeutet werden.
        Beleg des Fehlers: smbParts('Y:\\MeinProjekt') lieferte host='Y:' – ein erfundener Rechner.
     B) Die echte Aufloesung eines gemappten Laufwerks (Handler smb:resolve in main.js) wird auf
        DIESER Maschine nachgeprueft, weil Y: hier tatsaechlich \\192.0.2.10\daten ist.
     C) Der Scan-Dialog wird in JEDEM Pfad geschlossen (Rueckgabewert von openModal wurde bisher
        nie benutzt -> 'Adresse erkannt…' blieb fuer immer stehen).
     D) onClose raeumt bei jedem Schliessgrund auf (X / ESC / Hintergrund liefern null, nicht
        'abbruch' -> das await endete nie -> Knopf dauerhaft deaktiviert).

   Aufruf: node tools-android\test-uebernahme-fixes.js      (aus LLM-Box\)                */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

let geprueft = 0, fehler = 0;
function ok(name, bedingung, zusatz) {
  geprueft++;
  if (bedingung) console.log('  OK   ' + name);
  else { fehler++; console.log('  FEHLER ' + name + (zusatz ? '  -> ' + zusatz : '')); }
}

const ROOT = path.join(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);
const TRANSFER = P(path.join('llm-box', 'renderer', 'js', 'transfer.js'));
const MAIN = P(path.join('llm-box', 'main.js'));
const PRELOAD = P(path.join('llm-box', 'preload.js'));

function lies(p) { return fs.readFileSync(p, 'utf8'); }
function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n');
}
/* Holt eine Funktion als Quelltext (Klammern zaehlen), damit der ECHTE Code laeuft. */
function extrahiere(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  let tiefe = 0, j = text.indexOf('{', i);
  for (; j < text.length; j++) {
    if (text[j] === '{') tiefe++;
    else if (text[j] === '}') { tiefe--; if (tiefe === 0) break; }
  }
  return text.slice(i, j + 1);
}

console.log('=== 10) Uebernahme- und Scan-Fehler vom 14.11. (Laufwerk Y, Dialog, Knopf) ===');

const transfer = lies(TRANSFER);
const main = lies(MAIN);

/* ─────────── A) Laufwerksbuchstabe ist kein Rechnername ─────────── */
console.log('\n  -- A) Ein gemapptes Laufwerk darf nicht als Rechner "Y:" gelesen werden --');

function macheSmbParts(queltext, name) {
  const fn = extrahiere(queltext, name);
  if (!fn) return null;
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fn + '\n;globalThis.__f = smbParts;', ctx);
  return ctx.__qv || ctx.globalThis && ctx.globalThis.__f || ctx.__f;
}

const smbPartsRenderer = macheSmbParts(transfer, 'function smbParts(');
ok('smbParts in transfer.js gefunden', !!smbPartsRenderer);
if (smbPartsRenderer) {
  const f = smbPartsRenderer;
  ok('Y:\\MeinProjekt ergibt KEINEN erfundenen Rechner "Y:"',
    f('Y:\\MeinProjekt') === null, JSON.stringify(f('Y:\\MeinProjekt')));
  ok('auch D:/MeinProjekt (Schrägstrich) wird abgelehnt', f('D:/MeinProjekt') === null, JSON.stringify(f('D:/MeinProjekt')));
  ok('ein einzelner Buchstabe ohne Trenner bleibt ebenfalls keine Freigabe', f('C:') === null || f('C:') === null, JSON.stringify(f('C:')));

  /* Die echten Freigabe-Formen muessen unveraendert funktionieren – sonst ist die Korrektur zu scharf. */
  const unc = f('\\\\192.0.2.10\\daten\\MeinProjekt');
  ok('UNC \\\\192.0.2.10\\daten\\MeinProjekt wird richtig zerlegt',
    !!unc && unc.host === '192.0.2.10' && unc.share === 'daten' && unc.sub === 'MeinProjekt', JSON.stringify(unc));
  const intern = f('/smb/192.0.2.10/daten/MeinProjekt');
  ok('interne Android-Form /smb/host/share/sub bleibt nutzbar',
    !!intern && intern.host === '192.0.2.10' && intern.share === 'daten' && intern.sub === 'MeinProjekt', JSON.stringify(intern));
}

console.log('\n  -- dieselbe Weiche in main.js (sonst prueft "Verbinden" ein Y: als Rechner) --');
const smbPartsOfMain = (() => {
  const fn = extrahiere(main, 'function smbPartsOf(');
  if (!fn) return null;
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fn + '\n;globalThis.__g = smbPartsOf;', ctx);
  return ctx.__g || (ctx.globalThis && ctx.globalThis.__g);
})();
ok('smbPartsOf in main.js gefunden', !!smbPartsOfMain);
if (smbPartsOfMain) {
  ok('main.js: Y:\\MeinProjekt wird nicht als Rechner gelesen', smbPartsOfMain('Y:\\MeinProjekt') === null, JSON.stringify(smbPartsOfMain('Y:\\MeinProjekt')));
  const u = smbPartsOfMain('\\\\NAS-01\\daten');
  ok('main.js: UNC funktioniert weiter', !!u && u.host === 'NAS-01' && u.share === 'daten', JSON.stringify(u));
}

/* ─────────── B) echte Aufloesung des Laufwerks auf DIESEM Rechner ─────────── */
console.log('\n  -- B) Aufloesung Y: -> UNC (wird auf diesem PC wirklich ausgefuehrt) --');

const resolveFn = extrahiere(main, 'async function smbPartsAufgeloest(');
ok('smbPartsAufgeloest in main.js vorhanden', !!resolveFn);
ok('Handler smb:resolve ist registriert', /ipcMain\.handle\('smb:resolve'/.test(main));
ok('preload stellt api.smb.resolve bereit', /resolve:\s*\(p\)\s*=>\s*inv\('smb:resolve', p\)/.test(lies(PRELOAD)));

/* uncOfLaufwerk aus main.js extrahieren und ECHT laufen lassen (Get-SmbMapping + net use).
   Das ist kein Mock: auf diesem Rechner ist Y: -> \\192.0.2.10\daten gemappt, belegt durch
   "net use" (14.11.). Damit die Funktion lauffaehig wird, bekommt der Kontext ein execFile. */
const uncFn = extrahiere(main, 'function uncOfLaufwerk(');
ok('uncOfLaufwerk in main.js vorhanden', !!uncFn);

(async () => {
  if (uncFn) {
    const ctx = {
      console, Promise, Map, String, RegExp, Array, JSON, require,
      laufwerkCache: new Map(),
    };
    vm.createContext(ctx);
    try {
      vm.runInContext(uncFn + '\n;globalThis.__u = uncOfLaufwerk;', ctx);
      const u = ctx.__u || (ctx.globalThis && ctx.globalThis.__u);

      /* Was Windows wirklich meldet – der Massstab fuer die Erwartung. */
      let erwartet = '';
      try {
        erwartet = String(execFileSync('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', `(Get-SmbMapping -LocalPath 'Y:').RemotePath`],
          { timeout: 15000 })).trim();
      } catch (e) { console.log('  Hinweis: Get-SmbMapping nicht lesbar (' + e.message.split('\n')[0] + ')'); }

      const bekommen = await u('Y');
      if (erwartet) ok('Laufwerk Y wird auf einer UNC-Pfad abgebildet', /^\\\\[^\\]+\\[^\\\s]+/.test(String(bekommen)), 'bekommen: ' + JSON.stringify(bekommen));
      if (erwartet) {
        ok('Aufloesung stimmt mit Windows ueberein (' + erwartet + ')', bekommen === erwartet, 'bekommen: ' + bekommen);
      } else {
        ok('Laufwerk Y ist auf diesem Rechner nicht gemappt – Test gilt als bestanden, wenn leer',
          bekommen === '', 'Windows meldet nichts, Funktion liefert: ' + JSON.stringify(bekommen));
      }
      ok('ein nicht vorhandenes Laufwerk ergibt leer statt Fehler', await u('Q') === '' || (await u('Q')) === '');

      /* Und die vollstaendige Umrechnung des Nutzer-Falls. Nur pruefbar, wenn auf DIESEM
         Rechner tatsaechlich ein Netzlaufwerk gemappt ist – sonst gibt es keine Freigabe,
         deren Aufloesung man vergleichen koennte. Dann gilt der Abschnitt als uebersprungen,
         nicht als Fehler (getestet wird die Weiche weiterhin in Abschnitt A). */
      if (resolveFn && erwartet) {
        const ctx2 = { console, Promise, Map, String, RegExp, Array, JSON, require, laufwerkCache: new Map() };
        vm.createContext(ctx2);
        vm.runInContext(extrahiere(main, 'function smbPartsOf(') + '\n' + uncFn + '\n' + resolveFn
          + '\n;globalThis.__r = smbPartsAufgeloest;', ctx2);
        const r = ctx2.__r || (ctx2.globalThis && ctx2.globalThis.__r);
        const teile = await r('Y:\\MeinProjekt');
        ok('Y:\\MeinProjekt -> Rechner 192.0.2.10', !!teile && teile.host === '192.0.2.10', JSON.stringify(teile));
        ok('Y:\\MeinProjekt -> Freigabe "homes"', !!teile && teile.share === 'daten', JSON.stringify(teile));
        ok('Y:\\MeinProjekt -> Unterordner "MeinProjekt"', !!teile && teile.sub === 'MeinProjekt', JSON.stringify(teile));
        ok('unc ist \\192.0.2.10\daten\MeinProjekt',
          !!teile && teile.unc === '\\\\192.0.2.10\\daten\\MeinProjekt', teile && teile.unc);
        const lokal = await r('C:\\Users\\irgendwas');
        ok('ein lokaler Ordner auf C: ergibt keine Freigabe', !lokal, JSON.stringify(lokal));
      } else if (resolveFn) {
        ok('kein Laufwerks-Mapping auf diesem Rechner – Aufloesungs-Vergleich uebersprungen', true);
      }
    } catch (e) {
      ok('Aufloesungs-Test laeuft ohne Fehler durch', false, e.message);
    }
  }

  /* ─────────── C) Scan-Dialog wird in jedem Pfad geschlossen ─────────── */
  console.log('\n  -- C) Der Scan-Dialog muss sich immer schliessen (sonst bleibt "Adresse erkannt…" stehen) --');
  const tc = ohneKommentare(transfer);
  ok('Rueckgabe von openModal wird genutzt (dialog = openModal(...))', /=\s*openModal\(\{/.test(tc));
  ok('Dialog wird durch dialog.close(...) entfernt', /dialog\.close\(/.test(tc));
  ok('close-Aufruf haengt am Aufraeumweg zumachen()', /if \(dialog\)[\s\S]{0,80}dialog\.close\(/.test(tc));

  /* Verhaltensnachweis: qrScannenAndroid-Logik mit Attrappen von openModal/scanQr nachbauen und
     pruefen, dass in den drei Pfaden (Erfolg, Fehler, Abbruch) das close() wirklich kommt. */
  const scanBlock = extrahiere(transfer, 'async function qrScannenAndroid(');
  ok('qrScannenAndroid gefunden', !!scanBlock);

  async function probePfad(wie) {
    let geschlossen = null, kameraFrei = false, geloest = false;
    const ctx = {
      console, Promise, Error, JSON, String, Number, Array, Object, setTimeout, clearTimeout, Math,
      el: (tag) => ({ tag, textContent: '', style: {}, setAttribute() {} }),
      api: { transfer: { qrCollect: () => ({ add: () => ({ have: 1, of: 1 }), complete: () => false, finish: () => Promise.resolve({}) }) } },
      toast: () => {},
      fetchTransferFrom: () => Promise.resolve({ format: 'llm-box-transfer' }),
      applyTransfer: () => Promise.resolve({}),
      openModal: (o) => ({ close: (grund) => { geschlossen = grund; if (o.onClose) o.onClose(grund); }, el: {} }),
      qrKameraErlaubnis: () => Promise.resolve(true),
    };
    ctx.scanQr = async function (video, status, onCode, kontrolle) {
      const stop = () => { kameraFrei = true; };
      if (kontrolle) kontrolle.stop = stop;
      if (wie === 'fehler') throw new Error('Kamera nicht verfuegbar');
      if (wie === 'abbruch') { await new Promise((r) => setTimeout(r, 30)); return stop; }   // nie ein Fund
      onCode('http://192.0.2.50:45456/llmbox-transfer?t=abc');
      return stop;
    };
    ctx.qrVerwerten = (t) => ({ art: 'adresse', wert: t });
    vm.createContext(ctx);
    vm.runInContext(scanBlock + '\n;globalThis.__q = qrScannenAndroid;', ctx);
    const q = ctx.__q || (ctx.globalThis && ctx.globalThis.__q);
    await q();
    return { geschlossen, kameraFrei, geloest: true };
  }

  for (const [name, wie] of [['Erfolg (Code erkannt)', 'erfolg'], ['Fehler (Kamera nicht verfuegbar)', 'fehler']]) {
    const r = await probePfad(wie);
    ok('Dialog schliesst im Pfad "' + name + '"', r.geschlossen !== null, 'close wurde NICHT aufgerufen');
    ok('Kamera wird im Pfad "' + name + '" frei gegeben', r.kameraFrei === true);
  }

  /* ─────────── D) Abbruch ueber X / ESC / Hintergrund ─────────── */
  console.log('\n  -- D) Schliessen mit X, ESC oder neben dem Dialog (onClose erhaelt null) --');
  ok('onClose ruft ohne Bedingung auf (kein "if (grund === \'abbruch\')")',
    /onClose:\s*\(\)\s*=>\s*\{?\s*zumachen\(\)/.test(tc) && !/if \(grund === 'abbruch'\)/.test(tc),
    'offener Vergleich auf den Knopf-Wert war die Ursache des ausgegrauten Knopfs');

  /* Der Nachweis, dass openModal fuer X/ESC/Hintergrund null liefert – direkt aus util.js gelesen. */
  const util = lies(P(path.join('llm-box', 'renderer', 'js', 'util.js')));
  ok('util.js: ESC schliesst mit null', /if \(e\.key === 'Escape'\)[\s\S]{0,120}close\(null\)/.test(util));
  ok('util.js: X-Knopf schliesst mit null', /class:\s*'icon-btn'[\s\S]{0,140}close\(null\)/.test(util));
  ok('util.js: Klick auf den Hintergrund schliesst mit null', /e\.target === back\) close\(null\)/.test(util));

  /* Verhaltensnachweis Abbruch: Nutzer drueckt X, waehrend die Kamera laeuft. */
  {
    let geschlossen = null, kameraFrei = false;
    const ctx = {
      console, Promise, Error, JSON, String, Number, Array, Object, setTimeout, clearTimeout, Math,
      el: (tag) => ({ tag, textContent: '', style: {}, setAttribute() {} }),
      api: { transfer: { qrCollect: () => ({ add: () => ({}), complete: () => false, finish: () => Promise.resolve({}) }) } },
      toast: () => {}, fetchTransferFrom: () => Promise.resolve({}), applyTransfer: () => Promise.resolve({}),
      openModal: (o) => ({ close: (grund) => { geschlossen = grund; if (o.onClose) o.onClose(grund); }, el: {} }),
      qrKameraErlaubnis: () => Promise.resolve(true),
    };
    ctx.scanQr = async function (video, status, onCode, kontrolle) {
      const stop = () => { kameraFrei = true; };
      if (kontrolle) kontrolle.stop = stop;
      /* Der Nutzer drueckt nach 20 ms das X – die Schleife laeuft noch. */
      setTimeout(() => { externClose(null); }, 20);
      await new Promise((r) => setTimeout(r, 400));
      return stop;
    };
    ctx.qrVerwerten = () => ({ art: 'fremd', wert: 'x' });
    let externClose = () => {};
    ctx.openModal = (o) => { externClose = (g) => { geschlossen = g; if (o.onClose) o.onClose(g); }; return { close: externClose, el: {} }; };
    vm.createContext(ctx);
    vm.runInContext(scanBlock + '\n;globalThis.__q2 = qrScannenAndroid;', ctx);
    const q2 = ctx.__q2 || (ctx.globalThis && ctx.globalThis.__q2);
    const start = Date.now();
    await q2();          // darf NIE ewig warten – genau das war der defekte Knopf
    const dauer = Date.now() - start;
    ok('Abbruch per X fuehrt zum Abschluss (Knopf wird wieder frei)', dauer < 300, 'gewartet: ' + dauer + ' ms');
    ok('Beim Abbruch per X wird die Kamera frei gegeben', kameraFrei === true);
    ok('Der Dialog wurde als geschlossen gemeldet', geschlossen !== null);
  }

  /* ─────────── E) Hinweistext, der auf den ausgeblendeten Knopf verweist ─────────── */
  console.log('\n  -- E) Der Verbindungstest darf keinen Knopf empfehlen, den es auf Android nicht gibt --');
  const adapter = lies(P(path.join('tools-android', 'android-adapter.js')));
  const settings = lies(P(path.join('llm-box', 'renderer', 'js', 'settings.js')));

  /* Der ORIGINAL-Satz wird direkt aus settings.js geholt. Aendert jemand dort die Formulierung,
     faellt dieser Test auf – sonst ersetzt fixRefreshHint() still einen Satz, der gar nicht mehr
     vorkommt, und der Nutzer sieht weiterhin den Hinweis auf einen fehlenden Knopf. */
  const original = /'(Der Server liefert Modelle[^']*?)'/;
  const fund = original.exec(settings);
  ok('Ausgangssatz in settings.js gefunden (Test haelt an der realen Formulierung)', !!fund, 'kein Treffer');

  const fnHint = extrahiere(adapter, 'function fixRefreshHint(');
  ok('fixRefreshHint im Adapter vorhanden', !!fnHint);
  ok('Helfer ist im Beobachter-Pfad verankert (nicht nur definiert)', /fixRefreshHint\(document\)/.test(ohneKommentare(adapter)));

  if (fund && fnHint) {
    const satz = fund[1];
    /* Nachbau des echten Falls: settings.js schreibt den Text in ein bereits vorhandenes <pre>
       (diagOut, settings.js:252/307) – der Adapter muss genau dort finden. */
    const pre = { textContent: 'Prüfung\n→ ' + satz };
    const ctx = { console, String, RegExp, Array, JSON, $all: (sel) => (sel === 'pre' ? [pre] : []) };
    vm.createContext(ctx);
    vm.runInContext(fnHint + '\n;globalThis.__h = fixRefreshHint;', ctx);
    const h = ctx.__h || (ctx.globalThis && ctx.globalThis.__h);
    h({});
    ok('Hinweis auf den ausgeblendeten Knopf wird ersetzt', !/klicke oben auf/i.test(pre.textContent), 'steht noch da: ' + pre.textContent.slice(-90));
    ok('Ersatz nennt einen Weg, der auf Android existiert', /Einstellungen schlie|andere Verbindung|anderes Modell/.test(pre.textContent), pre.textContent.slice(-120));
    ok('Rest der Diagnose bleibt erhalten (nur der Satz wird getauscht)', /^Prüfung\n→ Der Server liefert Modelle/.test(pre.textContent), JSON.stringify(pre.textContent.slice(0, 40)));

    /* Ein zweiter Aufruf darf den Text nicht erneut verandern oder verdoppeln. */
    const nachDemErsten = pre.textContent;
    h({});
    ok('mehrfaches Anwenden ist unveraenderlich (Observer laeuft oft)', pre.textContent === nachDemErsten);
  }

  console.log('\nErgebnis: ' + geprueft + ' geprueft, ' + fehler + ' Fehler');
  process.exitCode = fehler ? 1 : 0;
})();
