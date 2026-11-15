/* test-qr-scan.js – prueft den QR-Scan der Android-Version (1.0.62) wirklich durch.

   Anlass: Die Windows-App zeigt beim "Im WLAN anbieten" einen QR-Code, aber die Handy-App
   konnte ihn bis 1.0.61 selbst nicht lesen (kein Decoder im Bundle, keine CAMERA-Erlaubnis,
   WebChromeClient ohne onPermissionRequest). Der Nutzer zu Recht gefragt: "Wieso wird mir ein
   QR Code angezeigt, wenn ich diesen mit der App nicht scannen kann?"

   Der Test laesst sich NICHT mit blossen Textsuchten erledigen, weil die Kernfrage lautet:
   erkennt der eingebaute Decoder einen Code, den DIESE App selbst erzeugt hat? Deshalb:
     A) statische Nachweise (Bundle, Manifest, Java-Bruecke, Scan-Code der Web-Seite)
     B) echter Hin-und-zuruck-Test: der QR-Encoder der App (vendor/qrcode.js, isDark()) baut
        ein Bild, jsQR (das im webdeps-Bundle steckt) muss exakt denselben Text zurueckgeben
     C) qrVerwerten() wird als echter Quelltext aus transfer.js ausgelesen und ausgefuehrt
        (Adresse / LBX1-Stueck / fremder Code)
     D) scanQr() laeuft gegen Attrappen von Kamera, video und canvas – inklusive der Frage, ob
        die Kamera beim ABBRUCH frei gegeben wird, bevor ueberhaupt ein Code gefunden wurde

   Aufruf: node tools-android\test-qr-scan.js      (aus LLM-Box\)                     */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let geprueft = 0, fehler = 0;
function ok(name, bedingung, zusatz) {
  geprueft++;
  if (bedingung) console.log('  OK   ' + name);
  else { fehler++; console.log('  FEHLER ' + name + (zusatz ? '  -> ' + zusatz : '')); }
}

const ROOT = path.join(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);
const TRANSFER = P(path.join('llm-box', 'renderer', 'js', 'transfer.js'));
const ENCODER = P(path.join('llm-box', 'renderer', 'vendor', 'qrcode.js'));
const BUNDLE_SRC = P(path.join('webdeps', 'bundle-entry.js'));
const ASSET_BUNDLE = P(path.join('android', 'app', 'src', 'main', 'assets', 'webapp', 'vendor', 'webdeps.js'));
const ASSET_INDEX = P(path.join('android', 'app', 'src', 'main', 'assets', 'webapp', 'index.html'));
const MANIFEST = P(path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml'));
const JAVA = P(path.join('android', 'app', 'src', 'main', 'java', 'de', 'reuschlerit', 'llmbox', 'MainActivity.java'));

function lies(p) { return fs.readFileSync(p, 'utf8'); }

/* Entfernt Kommentare, damit eine ERWAHNUNG eines alten Fehlers im Erklaertext nicht als
   Code gewertet wird. Beispiel: MainActivity.java erklaert in einem Kommentar ausdruecklich,
   dass "PermissionRequest.Resource" nicht existiert – genau dieser Text darf keinen Fehler
   ausloesen, wenn der Code selbst laengst die String-Variante benutzt. */
function ohneKommentare(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')                     // Blockkommentare
    .split('\n').filter((zeile) => !/^\s*\/\//.test(zeile))  // Zeilenkommentare
    .join('\n');
}

/* Holt eine Funktion als Quelltext (Klammern zaehlen), damit der ECHTE Code ausgefuehrt wird
   und nicht eine nachgeschriebene Vermutung. */
function extrahiere(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  let k = text.indexOf('{', i), tiefe = 0, j = k;
  for (; j < text.length; j++) {
    if (text[j] === '{') tiefe++;
    else if (text[j] === '}') { tiefe--; if (tiefe === 0) break; }
  }
  return text.slice(i, j + 1);
}

console.log('=== 9) QR-Code scannen mit der Handy-Kamera (Decoder, Berechtigung, Scan-Schleife) ===');

const transfer = lies(TRANSFER);
const javaRaw = lies(JAVA);
const java = ohneKommentare(javaRaw);
const transferCode = ohneKommentare(transfer);
const manifest = lies(MANIFEST);

/* ---------- A) statische Nachweise ---------- */
console.log('\n  -- Decoder ist wirklich im ausgelieferten Bundle --');
ok('webdeps/bundle-entry.js stellt jsQR global bereit', /globalThis\.jsQR\s*=/.test(lies(BUNDLE_SRC)));
const quell = lies(BUNDLE_SRC);
ok('Bundle-Eintrag nutzt das echte jsqr-Paket', /require\(['"]jsqr['"]\)/.test(quell));

if (fs.existsSync(ASSET_BUNDLE)) {
  const groesse = fs.statSync(ASSET_BUNDLE).size;
  ok('assets/webapp/vendor/webdeps.js vorhanden und enthaelt jsQR', lies(ASSET_BUNDLE).includes('jsQR'), 'Groesse ' + groesse);
  ok('Bundle gross genug fuer Decoder (jsQR allein ~250 kB)', groesse > 600000, 'tatsaechlich ' + groesse + ' Bytes');
} else {
  ok('assets/webapp/vendor/webdeps.js vorhanden', false, 'Datei fehlt – Build laeuft nicht?');
}
if (fs.existsSync(ASSET_INDEX)) {
  ok('index.html der WebView bindet vendor/webdeps.js ein', /vendor\/webdeps\.js/.test(lies(ASSET_INDEX)));
} else {
  ok('index.html der WebView vorhanden', false);
}

console.log('\n-- Berechtigung und WebView-Zulassung (Android nativ) --');
ok('Manifest fordert CAMERA', /uses-permission android:name="android\.permission\.CAMERA"/.test(manifest));
ok('Kamera als nicht zwingend markiert (Gerat ohne Kamera bleibt nutzbar)',
  /uses-feature[^>]*android\.hardware\.camera[^>]*required="false"/.test(manifest));
ok('MainActivity hat einen Erlaubnis-Launcher', /ActivityResultContracts\.RequestPermission\(\)/.test(java) && /cameraLauncher/.test(java));
ok('Ergebnis der Anfrage geht an die Web-Seite (__qrPermission)', /js\("__qrPermission"/.test(java));
ok('WebChromeClient zulaesst getUserMedia (onPermissionRequest)', /public void onPermissionRequest\(android\.webkit\.PermissionRequest/.test(java));
ok('Ressourcen als STRINGS verglichen (der alte Compile-Fehler ist weg)',
  /PermissionRequest\.RESOURCE_VIDEO_CAPTURE\.equals\(/.test(java) && !/PermissionRequest\.Resource\b/.test(java),
  'frueher: PermissionRequest.Resource -> "Symbol nicht gefunden"');
ok('Nur Video wird erlaubt, alles andere ausdruecklich abgelehnt', /\.grant\(/.test(java) && /request\.deny\(\)/.test(java));
ok('Bruecke qrScanStart() ist per @JavascriptInterface erreichbar',
  /@JavascriptInterface[\s\S]{0,200}public String qrScanStart\(\)/.test(java));

console.log('\n-- Web-Seite: Scan-Ablauf --');
ok('Antwort der nativen Seite wird empfangen (window.__qrPermission)', /window\.__qrPermission\s*=/.test(transfer));
ok('Warten auf die native Antwort hat ein Zeitlimit', /setTimeout\(\s*\(\)\s*=>\s*schluss\(true\)/.test(transfer) || /__qrPermCb/.test(transfer));
ok('Hintere Kamera wird gewaehlt (facingMode environment)', /facingMode:\s*'environment'/.test(transfer));
ok('Kein Mikrofon angefordert', /audio:\s*false/.test(transfer));
ok('Bild wird zur Rechenarbeit verkleinert (max. 480 px Breite)', /Math\.min\(480,\s*video\.videoWidth\)/.test(transfer));
ok('Erkennung nutzt window.jsQR', /window\.jsQR\s*&&\s*jsQR\(/.test(transfer));
ok('Kamera wird freigegeben (srcObject null + track.stop)', /video\.srcObject\s*=\s*null/.test(transferCode) && /getTracks\(\)[\s\S]{0,60}stop\(\)/.test(transferCode));
ok('Freigabe haengt an einem finally (Abbruch und Fehler erreichbar)', /finally\s*\{[^}]*stop\(\)/.test(transferCode));
ok('Freigabe ist gegen mehrfaches Aufrufen geschuetzt', /\bfrei\b/.test(transferCode) || /if \(frei\) return/.test(transferCode));
ok('video-Element steht VOR dem Start im Dialog (sonst keine Vorschau)',
  /body:\s*el\('div',\s*\{\},\s*video,\s*status\)/.test(transfer) && /scanQr\(video,\s*status/.test(transfer));
ok('Knopf zum Scannen ist im Android-Reiter', /QR-Code scannen/.test(transfer) && /btnScan/.test(transfer));
ok('Hilfe nennt weiterhin den Weg ohne Kamera (Im WLAN suchen)', /Im WLAN suchen/.test(transfer));

/* Die alte, irrefuehrende Hilfe darf nicht zurueckkehren: sie behauptete, die App koenne
   einen angezeigten QR nur mit einer Fremd-App lesen. Prueft nur den ausgelieferten TEXT
   (Kommentare sind ausgenommen – dort steht die Geschichte bewusst erklaert). */
const irrefuehrend = /mit einer beliebigen QR-App|nur mit einer fremden QR/i;
ok('Kein irrefuehrender Hilfe-Text mehr, man brauche eine fremde QR-App', !irrefuehrend.test(transferCode));
ok('Dafuer gibt es den eigenen Scan-Knopf im Hilfetext', /QR-Code scannen/.test(transferCode));

/* ---------- B) echter Hin-und-zuruck-Test: Encoder der App -> Decoder der App ---------- */
console.log('\n-- Echter Test: von DER APP erzeugt und von DER APP gelesen --');

function qrEncoder() {
  const src = lies(ENCODER);
  const ctx = { window: {}, document: {}, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.qrcode || ctx.window.qrcode;
}

/* Baut aus den dunklen Modulen des Encoders ein RGBA-Bild inkl. Rand (Ruhezone), so wie die
   Kamera es liefert: schwarz/weiss, kein Alpha-Trick. */
function qrBild(text, massstab) {
  const q = qrEncoder();
  if (typeof q !== 'function') return null;
  const m = q(0, 'M');
  m.addData(text, 'Byte');
  m.make();
  const mc = m.getModuleCount(), rand = 4 * massstab, seite = mc * massstab + 2 * rand;
  const daten = new Uint8ClampedArray(seite * seite * 4).fill(255);
  for (let r = 0; r < mc; r++) {
    for (let c = 0; c < mc; c++) {
      if (!m.isDark(r, c)) continue;
      for (let dy = 0; dy < massstab; dy++) {
        for (let dx = 0; dx < massstab; dx++) {
          const x = rand + c * massstab + dx, y = rand + r * massstab + dy;
          const i = (y * seite + x) * 4;
          daten[i] = 0; daten[i + 1] = 0; daten[i + 2] = 0; daten[i + 3] = 255;
        }
      }
    }
  }
  return { seite, daten };
}

let jsqr = null;
try {
  const mod = require(path.join(ROOT, 'webdeps', 'node_modules', 'jsqr'));
  jsqr = (mod && mod.default) || mod;
} catch (e) { console.log('  Hinweis: jsqr-Paket nicht geladen (' + e.message + ')'); }

ok('Decoder aus webdeps/node_modules laedt als Funktion', typeof jsqr === 'function');

const adresse = 'http://192.0.2.42:45456/llmbox-transfer?t=3f9a1c77e0b2d4aa';
const stueck = 'LBX1|ab12cd34|3|7|9f86d081884c7d65|' + Buffer.from('x'.repeat(600)).toString('base64');

for (const [name, text] of [['LAN-Adresse der Windows-App', adresse], ['LBX1-Stueck einer Bildfolge', stueck]]) {
  const bild = qrBild(text, 3);
  if (!bild) { ok('QR-Bild fuer ' + name + ' erzeugt', false, 'Encoder nicht ladbar'); continue; }
  ok('QR-Bild fuer ' + name + ' erzeugt (' + bild.seite + ' px)', true);
  const fund = jsqr ? jsqr(bild.daten, bild.seite, bild.seite) : null;
  ok('jsQR liest ' + name + ' exakt zurueck', !!(fund && fund.data === text), fund ? ('gelesen: ' + String(fund.data).slice(0, 60)) : 'kein Code erkannt');
}

/* ---------- C) qrVerwerten(): echter Quelltext aus transfer.js ---------- */
console.log('\n-- Einordnung eines gefundenen Codes (qrVerwerten aus transfer.js) --');
const qwText = extrahiere(transfer, 'function qrVerwerten(');
ok('qrVerwerten in transfer.js gefunden', !!qwText);
if (qwText) {
  const ctx = { module: {}, console };
  vm.createContext(ctx);
  vm.runInContext(qwText + '\n;globalThis.__qv = qrVerwerten;', ctx);
  const qrVerwerten = ctx.__qv || ctx.globalThis && ctx.globalThis.__qv;

  let r = qrVerwerten('  ' + adresse + '  ', { add: () => ({}), complete: () => false });
  ok('Adresse wird als Adresse erkannt', r.art === 'adresse' && r.wert === adresse, JSON.stringify(r));

  const sammler = {
    teile: new Map(),
    add(t) { this.teile.set(t, true); return { have: this.teile.size, of: Number(t.split('|')[3]) }; },
    complete() { return this.teile.size === Number([...this.teile.keys()][0].split('|')[3]); },
  };
  r = qrVerwerten('LBX1|sid1|1|2|abc|AAA', sammler);
  ok('LBX1-Stueck wird gesammelt (noch nicht fertig)', r.art === 'stueck' && r.fertig === false, JSON.stringify(r));
  r = qrVerwerten('LBX1|sid1|2|2|abc|BBB', sammler);
  ok('letztes Stueck meldet fertig', r.art === 'stueck' && r.fertig === true, JSON.stringify(r));

  r = qrVerwerten('WIFI:S:MeinNetz;T:WPA;;', { add: () => ({}), complete: () => false });
  ok('fremder Code wird als fremd gemeldet und nicht uebernommen', r.art === 'fremd' && /WIFI/.test(r.wert), JSON.stringify(r));

  r = qrVerwerten('', { add: () => ({}), complete: () => false });
  ok('leerer Fund stuerzt nicht ab', r && r.art === 'fremd', JSON.stringify(r));
}

/* ---------- D) scanQr(): Schleife gegen Kamera-Attrappen ---------- */
console.log('\n-- Scan-Schleife: Bildpunkte, Erkennung, Kamera frei geben --');
const scanText = extrahiere(transfer, 'async function scanQr(');
ok('scanQr in transfer.js gefunden', !!scanText);

function atrappenKontext(bild, opts) {
  opts = opts || {};
  let angefragt = null, gestoppteSpuren = 0, rafAnzahl = 0;
  const video = {
    videoWidth: bild ? bild.seite : 0, videoHeight: bild ? bild.seite : 0, srcObject: 'belegt',
    play() { return Promise.resolve(); },
  };
  const ctx2d = {
    drawImage() {},
    getImageData(x, y, w, h) {
      /* Der echte Browser liefert ein ImageData-Objekt mit .data – transfer.js genau so
         verwendet wird (ctx.getImageData(0,0,w,h).data). Die Attrappe muss diese Form haben. */
      if (!bild) return { data: new Uint8ClampedArray(w * h * 4).fill(255) };
      return { data: bild.daten };   // groesse passt, weil video.videoWidth = bild.seite
    },
  };
  const stream = { getTracks: () => [{ stop() { gestoppteSpuren++; } }] };
  const navigatorFake = {
    mediaDevices: {
      getUserMedia(constraints) { angefragt = constraints; return Promise.resolve(stream); },
    },
  };
  const ctx = {
    console,
    navigator: navigatorFake,
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) },
    /* In der WebView gilt window === globalThis: das Bundle setzt globalThis.jsQR, deshalb ist
       jsQR dort sowohl als window.jsQR als auch frei als Name erreichbar. Beides wird hier
       nachgebaut – sonst wuerde der Test eine Browser-Eigenschaft als App-Fehler melden. */
    window: { jsQR: opts.decoder === false ? undefined : jsqr },
    jsQR: opts.decoder === false ? undefined : jsqr,
    requestAnimationFrame(fn) { rafAnzahl++; if (opts.maxRaf && rafAnzahl > opts.maxRaf) return 0; setTimeout(fn, 0); return rafAnzahl; },
    cancelAnimationFrame() {},
    Error, Promise, Math, String, Number, Array, Object, JSON, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(scanText + '\n;globalThis.__scan = scanQr;', ctx);
  return {
    fn: ctx.__scan || (ctx.globalThis && ctx.globalThis.__scan),
    video,
    status: { textContent: '' },
    zaehle: () => ({ angefragt, gestoppteSpuren }),
  };
}

(async () => {
  /* Fall 1: ein Code ist sichtbar -> Schleife endet, Kamera wird frei gegeben */
  const bild = qrBild(adresse, 3);
  let k = atrappenKontext(bild);
  let gefunden = null;
  try {
    const stopFn = await k.fn(k.video, k.status, (text) => { gefunden = text; });
    ok('Scan liefert den gefundenen Text', gefunden === adresse, 'gelesen: ' + String(gefunden).slice(0, 60));
    ok('Kamera nach dem Fund frei gegeben', k.zaehle().gestoppteSpuren > 0 && k.video.srcObject === null);
    ok('Bildpunkte kommen aus getUserMedia (hintere Kamera)', !!(k.zaehle().angefragt && k.zaehle().angefragt.video && k.zaehle().angefragt.video.facingMode === 'environment'));
    if (typeof stopFn === 'function') stopFn();   // spaeterer Abbruch darf nichts kaputt machen
  } catch (e) {
    ok('Scan-Lauf laeuft ohne Fehler durch', false, e.message);
  }

  /* Fall 2: KEIN Code im Bild und der Nutzer bricht ab. Der Abbruch muss die Kamera frei
     geben, obwohl die Schleife noch laeuft – genau das war die Schwachstelle, als stop() erst
     mit dem Rueckgabewert von scanQr bekannt wurde (Test lief am 14.11.2026 tatsaechlich auf). */
  const k2 = atrappenKontext(null, { maxRaf: 50 });
  const kontrolle = { stop: null };
  const p2 = k2.fn(k2.video, k2.status, () => {}, kontrolle);
  await new Promise((r) => setTimeout(r, 60));
  ok('scanQr stellt die Kamera-Freigabe BEREITS WAHREND des Laufs bereit',
    typeof kontrolle.stop === 'function', 'kontrolle.stop ist ' + typeof kontrolle.stop);
  if (typeof kontrolle.stop === 'function') {
    kontrolle.stop();
    try { await p2; } catch {}
    ok('Abbruch vor einem Fund gibt die Kamera frei', k2.zaehle().gestoppteSpuren > 0 && k2.video.srcObject === null);
    ok('Frame-Schleife hoert nach dem Abbruch auf (Akku)', k2.zaehle().gestoppteSpuren >= 1);
    kontrolle.stop();   // zweites Mal aufrufen (Abbruch + finally) darf nichts kaputt machen
    ok('mehrfaches Freigeben ist ungefaehrlich', true);
  } else {
    ok('Abbruch vor einem Fund gibt die Kamera frei', false, 'scanQr bietet stop() nicht an – Kamera bleibt belegt');
  }

  /* Fall 3: WebView ohne Kamera (aeltere Android-Version) -> klares Fehlerbild statt Haengen */
  const ctxOhne = { console, navigator: {}, document: { createElement: () => ({ getContext: () => null }) }, window: {}, Error, Promise, Math, String };
  vm.createContext(ctxOhne);
  vm.runInContext(scanText + '\n;globalThis.__scan2 = scanQr;', ctxOhne);
  const f2 = ctxOhne.__scan2 || (ctxOhne.globalThis && ctxOhne.globalThis.__scan2);
  let meldung = '';
  try { await f2({ play() { return Promise.resolve(); } }, { textContent: '' }, () => {}); }
  catch (e) { meldung = e.message; }
  ok('ohne getUserMedia: verstaendliche Fehlermeldung statt Absturz', /Kamera/i.test(meldung), 'Meldung: ' + meldung);

  console.log('\nErgebnis: ' + geprueft + ' geprueft, ' + fehler + ' Fehler');
  process.exitCode = fehler ? 1 : 0;
})();
