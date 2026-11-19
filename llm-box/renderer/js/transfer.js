'use strict';
/* Übertragung auf die Android-App: QR-Code (Bildfolge) und JSON-Export.
   Beide nutzen dieselbe Funktion buildTransfer(). Format und Ablauf für die Android-Seite: docs/TRANSFER-FORMAT.md */

const TRANSFER_FORMAT = 'llm-box-transfer';
const TRANSFER_VERSION = 1;
const QR_CHUNK = 600; // Zeichen Nutzdaten je QR-Bild (Base64). Klein genug für sicheres Scannen vom Bildschirm.
const QR_MAX_FRAMES = 400; // Darüber ist ein Scan unpraktisch: dann die JSON-Datei verwenden.

const CHAT_MODES = [
  { value: 'none', label: 'Keine Chats', n: 0 },
  { value: '3', label: 'Die letzten 3 Chats', n: 3 },
  { value: '10', label: 'Die letzten 10 Chats', n: 10 },
  { value: 'all', label: 'Alle Chats', n: Infinity },
];

/* Baut das Übertragungsobjekt. forQr = true: Dinge weglassen, die nicht in einen QR-Code passen (großes Hintergrundbild). */
async function buildTransfer(opt, forQr) {
  const info = await api.transfer.info();
  const settings = JSON.parse(JSON.stringify(S.settings));
  const omitted = [];
  if (forQr && settings.appearance && typeof settings.appearance.bgImage === 'string' && settings.appearance.bgImage.length > 2000) {
    settings.appearance.bgImage = '';
    if (settings.appearance.bgMode === 'custom') settings.appearance.bgMode = 'brand';
    omitted.push('appearance.bgImage');
  }
  const out = {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    created: new Date().toISOString(),
    source: { app: 'LLM Box', version: info.version, platform: info.platform, device: info.device },
    contains: ['settings'],
    omitted,
    settings,
  };
  const mode = CHAT_MODES.find((m) => m.value === opt.chats) || CHAT_MODES[0];
  if (mode.n > 0) {
    const list = await api.chats.list(); // neueste zuerst
    const chats = [];
    for (const m of list.slice(0, mode.n)) {
      const c = await api.chats.load(m.id);
      if (c) chats.push(c);
    }
    out.chats = chats;
    out.contains.push('chats');
  }
  if (opt.ws && !forQr) {
    const lim = fileLimits();
    const r = await api.transfer.wsFiles({ root: S.settings.workspace.path, ignore: lim.ignore, maxFileKB: lim.maxKB, maxTotalKB: 5120, maxFiles: 2000 });
    out.workspace = {
      path: S.settings.workspace.path || '',
      files: r.files || [],
      skippedFiles: r.skipped || 0,
      truncated: !!r.truncated,
      note: r.error || '',
    };
    out.contains.push('workspaceFiles');
  }

  /* Netzwerkordner (SMB) mitnehmen: Pfad der Freigabe plus – falls auf diesem Geraet hinterlegt –
     Benutzername, Domain und Passwort. Damit zeigen beide Geraete auf dieselbe Freigabe, ohne dass
     auf dem Handy alles erneut eingetippt werden muss.
     Ohne gespeicherte Zugangsdaten bleiben die Felder leer (ausdruecklicher Nutzerwunsch); der
     Emfaenger behaelt in dem Fall seine eigenen, bereits hinterlegten Werte. */
  if (opt.smb) {
    const s = await collectSmb();
    if (s) { out.smb = s; out.contains.push('smb'); }
    else omitted.push('smb (kein Netzwerkordner und keine Zugangsdaten auf diesem Geraet)');
  }
  return out;
}

/* Zerlegt eine Freigabe-Adresse in Rechner, Freigabe und Unterordner. Akzeptiert die Windows-Schreibweise
   \\rechner\freigabe\ordner und die interne Form der Android-App /smb/rechner/freigabe/ordner.
   Ein gemapptes Laufwerk (Y:\...) hat keinen Rechner – dann gibt es nichts zu uebertragen. */
function smbParts(p) {
  const roh = String(p || '').trim();

  /* FEHLERBEHEBUNG (14.11., durch Test belegt): die untere Fallback-Regel hat einen Laufwerks-
     buchstaben fuer einen Rechnernamen gehalten. Aus "D:\MeinProjekt" wurde
     host='Y:', share='MeinProjekt' – also ein frei erfundener Rechner namens "Y:". Die Folge:
     es wanderte ein smb-Feld mit Unsinn mit, die Pruefung auf dem Handy scheiterte zwangslaeufig,
     und der Netzwerkordner wurde nie gesetzt. Ein einzelner Buchstabe gefolgt von ':' ist immer
     ein Laufwerk, NIE ein Rechner – hier wird deshalb bewusst null geliefert, damit der Aufrufer
     die echte Zuordnung des Laufwerks abfragen kann (api.smb.resolve). */
  if (/^[A-Za-z]:[\\/]/.test(roh)) return null;

  const s = roh.replace(/\\/g, '/').replace(/^\/+/, '');
  let m = /^smb\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(s);
  if (!m) m = /^([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(s);
  if (!m) return null;
  const sub = (m[3] || '').replace(/\/+$/, '');
  return { host: m[1], share: m[2], sub, unc: `\\\\${m[1]}\\${m[2]}` + (sub ? '\\' + sub.replace(/\//g, '\\') : '') };
}

/* Holt die Zugangsdaten des Workspace-Rechners. Liefert null, wenn weder eine Freigabe gesetzt
   ist noch Zugangsdaten existieren – dann wandert nichts mit. */
async function collectSmb() {
  const pfad = S.settings.workspace && S.settings.workspace.path;

  /* FEHLERBEHEBUNG (Nutzerbericht: "auf dem PC ist zwar Laufwerk Y angegeben, das ist aber eine
     SMB-Freigabe – daher vermutlich die Fehler?"). Genau das war der Grund. smbParts() kennt nur
     \\rechner\freigabe; ein gemapptes Laufwerk wie D:\MeinProjekt ergab keinen Rechner, also
     wanderte das smb-Feld gar nicht mit (in der Uebertragung stand "kein Netzwerkordner").
     Auf dem genutzten PC ist Y: aber eine SMB-Freigabe – net use zeigt Y: -> \\192.0.2.10\daten.
     Die Windows-Seite fragt die Zuordnung jetzt beim Main-Prozess ab (Handler smb:resolve in
     main.js, ueber Get-SmbMapping mit "net use" als Notfall). */
  let parts = smbParts(pfad);
  if (!parts && pfad) {
    try {
      const r = await api.smb.resolve(pfad);
      if (r && r.ok) parts = { host: r.host, share: r.share, sub: r.sub, unc: r.unc };
    } catch {}
  }

  let host = parts ? parts.host : '';
  if (!host) {
    // Auch ohne Freigabe als Workspace: vorhandene Zugangsdaten des zuletzt genutzten Rechners mitnehmen.
    try {
      const alle = await api.smb.listHosts();
      if (alle && Array.isArray(alle.hosts) && alle.hosts.length) host = alle.hosts[0];
    } catch {}
  }
  if (!host) return null;
  let c = { user: '', domain: '', pass: '' };
  try { const r = await api.smb.credsForExport(host); if (r && r.ok) c = r; } catch {}
  const out = { host, user: c.user || '', domain: c.domain || '', pass: c.pass || '' };
  if (parts) { out.share = parts.share; out.sub = parts.sub; out.unc = parts.unc; out.path = pfad; }
  return out;
}

const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

/* ───── JSON-Datei ───── */
async function exportTransferJson(opt) {
  const data = await buildTransfer(opt, false);
  const stamp = new Date().toISOString().slice(0, 10);
  const p = await api.files.saveAs({
    defaultName: `llm-box-uebertragung-${stamp}.json`,
    content: JSON.stringify(data, null, 2),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (p) toast('Exportiert: ' + p, 5000);
  return p;
}

/* ───── QR-Code ───── */
function makeFrames(packed) {
  const sid = uid().slice(0, 8);
  const chunks = [];
  for (let i = 0; i < packed.b64.length; i += QR_CHUNK) chunks.push(packed.b64.slice(i, i + QR_CHUNK));
  const n = chunks.length;
  // Bildformat: LBX1|<Sitzung>|<Nr ab 1>|<Anzahl>|<SHA-256 (16 Hex) der komprimierten Daten>|<Base64-Teil>
  return chunks.map((c, i) => `LBX1|${sid}|${i + 1}|${n}|${packed.sha16}|${c}`);
}

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

async function showQr(opt) {
  const t0 = await buildTransfer(opt, true);
  const json = JSON.stringify(t0);
  const packed = await api.transfer.pack(json);
  const frames = makeFrames(packed);
  const n = frames.length;
  if (n > QR_MAX_FRAMES) {
    openModal({
      title: 'Zu viele Daten für einen QR-Code',
      body: el('div', { class: 'tr-note' },
        el('p', { text: `Die gewählten Daten ergeben ${n} QR-Bilder (${fmtBytes(packed.zBytes)} komprimiert). Das ist zum Scannen zu viel.` }),
        el('p', { text: 'Wähle weniger oder keine Chats, oder nutze „JSON exportieren“ und kopiere die Datei auf das Android-Gerät.' })),
      buttons: [{ label: 'Schließen', primary: true, value: null }],
    });
    return;
  }

  let idx = 0;
  let playing = n > 1;
  let fps = 2;
  let timer = null;
  const box = el('div', { class: 'tr-qr' });
  const label = el('div', { class: 'tr-qr-label' });
  const draw = () => {
    box.innerHTML = qrSvg(frames[idx]);
    label.textContent = n > 1 ? `Code ${idx + 1} von ${n}` : 'Code 1 von 1';
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  const start = () => {
    stop();
    if (playing && n > 1) timer = setInterval(() => { idx = (idx + 1) % n; draw(); }, Math.round(1000 / fps));
  };
  const btnPlay = el('button', { class: 'btn sm', text: playing ? 'Pause' : 'Weiter', onclick: () => { playing = !playing; btnPlay.textContent = playing ? 'Pause' : 'Weiter'; start(); } });
  const step = (d) => { playing = false; btnPlay.textContent = 'Weiter'; stop(); idx = (idx + d + n) % n; draw(); };
  const sel = el('select', { onchange: (e) => { fps = +e.target.value; start(); } },
    [1, 2, 3, 4].map((v) => el('option', { value: String(v), text: `${v} Bild${v > 1 ? 'er' : ''}/s`, selected: v === fps })));
  const controls = n > 1
    ? el('div', { class: 'tr-qr-ctl' }, el('button', { class: 'btn sm', text: '◀', onclick: () => step(-1) }), btnPlay, el('button', { class: 'btn sm', text: '▶', onclick: () => step(1) }), sel)
    : null;
  const what = t0.contains.map((c) => ({ settings: 'Einstellungen & API-Keys', chats: `${(t0.chats || []).length} Chat(s)` }[c] || c)).join(', ');
  const body = el('div', { class: 'tr-modal' },
    el('div', { class: 'tr-warn', text: 'Der Code enthält deine API-Keys im Klartext. Nur am eigenen Bildschirm scannen, nicht fotografieren oder weitergeben.' }),
    box, label, controls,
    el('div', { class: 'fhint tr-qr-info', text: `Inhalt: ${what}. ${n} QR-Bild${n > 1 ? 'er' : ''}, ${fmtBytes(packed.zBytes)} komprimiert (Prüfsumme ${packed.sha16}).${t0.omitted.length ? ' Weggelassen (zu groß): Hintergrundbild.' : ''}` }),
    el('div', { class: 'fhint', text: n > 1 ? 'In der Android-App „Von LLM Box übernehmen“ öffnen und die Kamera auf den Code halten. Die Bilder wechseln automatisch und laufen im Kreis; die Reihenfolge ist egal. Die App meldet, wenn alle Teile da sind.' : 'In der Android-App „Von LLM Box übernehmen“ öffnen und die Kamera auf den Code halten.' }));
  openModal({ title: 'QR-Code für die Android-App', body, buttons: [{ label: 'Schließen', primary: true, value: null }], onClose: stop });
  draw();
  start();
}

/* ───── Übertragung im WLAN (eine Verbindung statt vieler QR-Bilder) ─────
   Der Nutzer berichtete: sechs QR-Codes nacheinander zu scannen ist unpraktisch. Dieselben
   Daten passen in EINE kurze Adresse. Die Windows-App bietet sie für einige Minuten im
   lokalen Netz an, die Android-App holt sie per HTTP – ohne Kamera, ohne Bildfolge. */

async function serveLan(opt) {
  /* forQr = false: im WLAN gilt kein QR-Groessenlimit. Bisher stand hier true, dadurch fielen
     die Workspace-Dateien bei "Im WLAN anbieten" komplett weg (buildTransfer prueft opt.ws &&
     !forQr) – obwohl der WLAN-Weg beliebig viele Daten transportiert. Genau das war der Grund,
     warum der Workspace nie mitkam. */
  const t0 = await buildTransfer(opt, false);
  const r = await api.transfer.serveStart({ json: JSON.stringify(t0), ttlSeconds: 600 });
  if (!r || !r.ok) { toast('Angebot im WLAN fehlgeschlagen: ' + ((r && r.error) || 'unbekannter Fehler'), 6000); return; }

  const url = r.urls[0] || '';
  // Ein einziger QR-Code mit der Adresse: scannen und fertig. Die Daten selbst kommen über
  // das lokale Netz, deshalb ist der Code winzig und in einem Bruchteil einer Sekunde erfasst.
  const box = el('div', { class: 'tr-qr' });
  try { box.innerHTML = qrSvg(url); } catch { box.textContent = '(QR nicht möglich)'; }

  const copy = (t) => { try { navigator.clipboard.writeText(t); toast('In die Zwischenablage kopiert', 2500); } catch {} };
  const body = el('div', { class: 'tr-modal' },
    el('div', { class: 'tr-warn', text: 'Der Inhalt (inklusive API-Keys) liegt für ' + Math.round(r.ttl / 60) + ' Minuten im lokalen Netz bereit. Danach oder nach dem Abruf schaltet sich der Dienst ab.' }),
    box,
    el('div', { class: 'tr-qr-label', text: 'In der Android-App: „Im WLAN suchen“ – oder diesen einen Code scannen' }),
    frow('Adresse auf dem Handy eingeben', 'Falls kein Scannen möglich ist, diese Adresse in der Android-App eintragen.',
      el('div', { class: 'fctrl' }, el('code', { text: url, style: { wordBreak: 'break-all' } }),
        el('button', { class: 'btn sm', text: 'Kopieren', onclick: () => copy(url) }))),
    r.urls.length > 1 ? frow('Weitere Adressen dieses Rechners', 'Mehrere Netzwerkkarten – die Android-App probiert alle durch.',
      el('div', { class: 'fhint', text: r.urls.join('\n'), style: { whiteSpace: 'pre-line' } })) : null,
    el('div', { class: 'fhint', text: `Inhalt: ${t0.contains.map((c) => ({ settings: 'Einstellungen & API-Keys', chats: `${(t0.chats || []).length} Chat(s)` }[c] || c)).join(', ')}. ${fmtBytes(r.bytes)} als Text (unkomprimiert – die Android-App liest HTTP-Antworten als Text, deshalb wird hier nicht komprimiert), Prüfsumme ${r.sha16}.` }),
    el('div', { class: 'fhint', text: 'Der QR-Code enthält nur die Adresse – deshalb reicht EIN Code (früher waren es mehrere Bilder hintereinander).' }));

  // openModal gibt kein Promise zurueck, sondern { close, el } – das Ergebnis kommt ueber
  // onClose. Wer hier .then() schreibt, bekommt einen Laufzeitfehler.
  openModal({
    title: 'Übertragung im WLAN anbieten', body, wide: true,
    buttons: [{ label: 'Dienst beenden', value: 'stop' }, { label: 'Fertig', primary: true, value: null }],
    onClose: (v) => { if (v === 'stop') api.transfer.serveStop(); },   // Fertig/ESC laesst den Dienst bis zum Ablauf laufen
  });
}

/* ───── QR-Code mit der Kamera lesen (nur Android) ─────
   Die App zeigte bisher QR-Codes an, konnte sie aber selbst nicht einlesen – deshalb stand in
   der Hilfe, man solle den Code "mit einer beliebigen QR-App" lesen. Das ist hier anders:
   die WebView liefert die Bildpunkte (getUserMedia), jsQR erkennt den Code im Bild.

   Zwei Dinge sind dafuer noetig und werden hier eingeholt:
     1) Die Kamera-Erlaubnis. Geholt wird sie von der nativen Seite (Native.qrScanStart ->
        MainActivity.java cameraLauncher); die WebView antwortet sonst nicht auf ihre eigene
        getUserMedia-Anfrage, wenn die App die Berechtigung gar nicht besitzt. Ergebnis kommt
        ueber window.__qrPermission zurueck.
     2) WebChromeClient.onPermissionRequest in MainActivity.java – ohne diesen Override lehnt
        die WebView jede Kamera-Anfrage still ab und die Vorschau bleibt schwarz. */

window.__qrPermission = (erlaubt) => {
  const cb = window.__qrPermCb;
  window.__qrPermCb = null;
  if (cb) cb(!!erlaubt);
};

async function qrKameraErlaubnis() {
  if (!window.Native || typeof Native.qrScanStart !== 'function') return false;
  return new Promise((resolve) => {
    let done = false;
    const schluss = (v) => { if (!done) { done = true; window.__qrPermCb = null; resolve(v); } };
    window.__qrPermCb = schluss;
    try { Native.qrScanStart(); } catch { schluss(false); return; }
    /* Sicherung: kommt die Antwort der nativen Seite nicht (aelterer Build ohne qrScanStart),
       darf der Dialog nicht fuer immer warten. */
    setTimeout(() => schluss(true), 25000);
  });
}

/* Liest so lange Bilder aus der Kamera, bis ein Code erkannt wird oder abgebrochen wird.
   Das video-Element kommt von AUSSSEN und muss bereits im Dialog stehen: ein Video ohne
   Eingliederung ins Dokument zeigt in der WebView keine Vorschau, und ein nachtraegliches
   Einhaengen nach play() laeuft auf manchen Geraeten ins Leere.

   Das vierte Argument (kontrolle) ist kein Fehler am Rand, sondern noetig: wuerde die
   Freigabe nur als Rueckgabewert von scanQr durchgereicht, koennte der Abbrechen-Knopf die
   Kamera erst freigeben, NACHDEM die Schleife beendet ist. Die Schleife laeuft aber weiter,
   solange kein Code gefunden wird – ein Abbruch mitten im Scan liesse Kamera und
   Frame-Schleife (und damit den Akku) laufen. Deshalb traegt scanQr stop() sofort in
   kontrolle.stop ein, bevor ueberhaupt die Kamera angefasst wird. */
async function scanQr(video, status, onCode, kontrolle) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Diese WebView stellt keine Kamera bereit.');
  }
  let stream = null, lauf = true, rafId = 0, frei = false;

  /* Die Kamera muss ZUVOR frei gegeben werden, nicht erst wenn der Frame-Lauf endet: sonst
     bleibt sie nach Abbrechen oder Dialog-ESC an und das Handy meldet eine belegte Kamera. */
  const stop = () => {
    if (frei) return;              // mehrfaches Aufrufen (Abbruch + finally) ist ungefaehrlich
    frei = true;
    lauf = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    try { video.srcObject = null; } catch {}
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  /* Vor der ersten Kamera-Anfrage eintragen: bricht der Nutzer ab, während die Kamera noch
     hochgefahren wird, ist stop() bereits erreichbar. */
  if (kontrolle) kontrolle.stop = stop;

  try {
    /* Nur Video, kein Ton: die App braucht kein Mikrofon, und onPermissionRequest in
       MainActivity.java lehnt alles ausser RESOURCE_VIDEO_CAPTURE ausdruecklich ab. */
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    await video.play();
    status.textContent = 'Kamera auf den QR-Code der Windows-App richten – Abstand ca. 20–40 cm.';
  } catch (e) {
    stop();
    throw new Error('Kamera nicht verfuegbar: ' + ((e && e.message) || e));
  }

  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  try {
    await new Promise((resolve, reject) => {
      function frame() {
        if (!lauf) return resolve();
        try {
          if (video.videoWidth > 0) {
            /* Klein halten: jsQR arbeitet Pixel fuer Pixel. 480 px Breite reichen zum Erkennen
               und halten die Rechenzeit auf dem Handy im Rahmen – eine volle Kameraaufnahme mit
               mehreren Megapixeln wuerde den Bildaufbau spuerbar ausbremsen. */
            const w = Math.min(480, video.videoWidth);
            const h = Math.round(video.videoHeight * (w / video.videoWidth));
            cv.width = w; cv.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const fund = window.jsQR && jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
            if (fund && fund.data) { stop(); return resolve(onCode(String(fund.data))); }
          }
        } catch (e) { stop(); return reject(e); }
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);
    });
  } finally {
    stop();
  }
  return stop;
}

/* Ein QR der Windows-App ist entweder die Adresse ("http://…/llmbox-transfer?t=…") oder ein
   LBX1-Stueck einer Bildfolge. Beides wird hier erkannt und weitergereicht. */
function qrVerwerten(text, sammler) {
  const t = String(text || '').trim();
  if (/^https?:\/\//i.test(t)) return { art: 'adresse', wert: t };
  if (t.startsWith('LBX1|')) {
    const r = sammler.add(t);
    return { art: 'stueck', info: r, fertig: sammler.complete() };
  }
  return { art: 'fremd', wert: t.slice(0, 80) };
}

async function qrScannenAndroid() {
  const erlaubt = await qrKameraErlaubnis();
  if (!erlaubt) {
    toast('Keine Kamera-Erlaubnis. Die Uebertragung funktioniert auch ohne: „Im WLAN suchen“ findet den Rechner von selbst.', 8000);
    return;
  }

  /* Ein Sammler pro Scan-Sitzung: eine QR-Bildfolge der Windows-App wird Stueck fuer Stueck
     erfasst (api.transfer.qrCollect, native-main.js) und am Stueck gezaehlt. */
  const sammler = api.transfer.qrCollect();

  return new Promise((fertig) => {
    /* video MUSS vor dem Start im Dialog stehen, sonst gibt es keine Vorschau. */
    const video = el('video', { playsinline: true, muted: true, autoplay: true, style: { width: '100%', maxHeight: '56vh', background: '#000', borderRadius: '10px' } });
    const status = el('div', { class: 'fhint', text: 'Kamera wird gestartet …' });
    let offen = true;
    const kontrolle = { stop: null };   // wird von scanQr gefuellt, sobald stop() existiert
    const stopScan = () => { if (kontrolle.stop) { try { kontrolle.stop(); } catch {} } };
    let dialog = null;                  // openModal liefert { close, el } – zum Schliessen gebraucht

    /* FEHLERBEHEBUNG (Nutzerbericht): der Dialog wurde im Erfolgsfall NIE geschlossen. Es blieb
       "Adresse erkannt – Daten werden abgerufen …" auf dem Bildschirm stehen und nichts geschah –
       obwohl die Daten laengst da waren: zumachen() gab nur die Kamera frei und loeste das Promise
       auf, entfernte aber nie den Scan-Dialog. Der danach geoeffnete Bestaetigungsdialog lag damit
       hinter der Scanner-Seite, fuer den Nutzer also unsichtbar. close() feuert seinerseits
       onClose -> zumachen(), was durch 'offen' gaeschuetzt ist (kein Endloskreislauf). */
    const zumachen = () => {
      if (!offen) return;
      offen = false;
      /* stop steht schon, WAHREND die Kamera laeuft (scanQr traegt sie in kontrolle ein) –
         nur so gibt "Abbrechen" die Kamera wirklich frei und die Schleife hoert auf. */
      /* FEHLERBEHEBUNG (vom eigenen Test test-uebernahme-fixes.js gefunden): hier stand
         "stopScan = null". stopScan ist aber ein const – die Zuweisung warf einen TypeError,
         zumachen() brach genau in dieser Zeile ab, und deshalb liefen dialog.close() und
         fertig() nie mehr: der Scan-Dialog blieb offen und der Knopf dauerhaft deaktiviert.
         Die Zuweisung ist wirkungslos (die Funktion wird einfach weiter aufgerufen), also weg. */
      try { stopScan(); } catch {}   // Kamera sofort frei geben
      if (dialog) { try { dialog.close('erledigt'); } catch {} dialog = null; }
      fertig();
    };

    dialog = openModal({
      title: 'QR-Code der Windows-App scannen',
      body: el('div', {}, video, status),
      buttons: [{ label: 'Abbrechen', value: 'abbruch' }],
      /* FEHLERBEHEBUNG (Nutzerbericht S20/S948B): vorher stand hier "if (grund === 'abbruch')".
         openModal ruft onClose aber in DREI Faellen mit null auf – Knopf oben rechts (X),
         ESC-Taste und Klick neben den Dialog (util.js:124, 128, 135). Wer so schloss,liess
         zumachen() aus: das Promise von qrScannenAndroid() wurde nie erfuellt, das await im
         Knopf-Handler lief nie aus, und damit erreichte auch das finally mit
         busy(btnScan,false) den Knopf nie mehr -> "QR-Code scannen" war dauerhaft ausgegraut.
         Deshalb wird jetzt bei JEDEM Schliessgrund aufgeraeumt. Abbruch ist nur noch ein Grund
         unter mehreren; der Erfolgspfad ruft zumachen() selbst, das durch 'offen' gesichert ist. */
      onClose: () => { zumachen(); },
    });

    scanQr(video, status, (text) => {
      const r = qrVerwerten(text, sammler);
      if (r.art === 'adresse' && /\/llmbox-live\?/.test(r.wert)) {
        // Adresse einer Live-Quelle: als Empfänger-Adresse speichern und verbinden
        liveCfg().client.url = r.wert; liveCfg().client.enabled = true; saveSettings();
        status.textContent = 'Live-Quelle erkannt – verbinde …';
        liveConnect();
        zumachen();
        return;
      }
      if (r.art === 'adresse') {
        status.textContent = 'Adresse erkannt – Daten werden abgerufen …';
        fetchTransferFrom(r.wert)
          .then((data) => applyTransfer(data, 'vom QR-Code gescannt'))
          .catch((e) => toast('Abruf fehlgeschlagen: ' + e.message, 8000))
          .finally(zumachen);
        return;
      }
      if (r.art === 'stueck') {
        status.textContent = r.fertig
          ? `Alle ${r.info.of} Teile erfasst – werde zusammengebaut …`
          : `Teil ${r.info.have}/${r.info.of} erfasst. Naechsten Code zeigen.`;
        /* Ein erkanntes Stueck nicht erneut anzeigen: der naechste Frame koennte denselben Code
           noch einmal liefern, sonst zaehlt das Sammler-Objekt doppelt. */
        if (r.fertig) {
          sammler.finish()
            .then((data) => applyTransfer(data, 'aus der QR-Bildfolge'))
            .catch((e) => toast('QR-Folge unvollstaendig: ' + e.message, 8000))
            .finally(zumachen);
        }
        return;
      }
      status.textContent = `Fremder Code ignoriert: ${r.wert}`;
    }, kontrolle).then((stop) => {
      if (!kontrolle.stop) kontrolle.stop = stop;
      if (!offen && stop) stop();   // Dialog schon vorher geschlossen -> Kamera nachtraeglich frei geben
    }).catch((e) => {
      status.textContent = 'Fehler: ' + e.message;
      toast('Scannen fehlgeschlagen: ' + e.message, 8000);
      zumachen();
    });
  });
}

/* ───── Android-Seite: Daten von der Windows-App holen ─────
   Dieselben Daten, anderer Weg: die Windows-App bietet sie im WLAN an (siehe oben), hier
   werden sie abgeholt. Seit 1.0.62 kann die App den QR-Code auch selbst mit der Kamera lesen
   (jsQR im Bundle + Native.qrScanStart); frueher gab es keinen eingebauten Decoder, deshalb
   half nur Netzsuche oder Adresse eintragen. */

async function fetchTransferFrom(url) {
  const r = await api.fetch({ url: String(url).trim(), method: 'GET', timeout: 15000 });
  if (!r || !r.ok) throw new Error((r && (r.error || r.status)) ? `Server antwortete nicht (${r.error || r.status})` : 'Keine Antwort');
  // Die Windows-App schickt die komprimierten Bytes. Im Browser/der WebView liegt der Text
  // in r.text bereits dekodiert vor, wenn Content-Type text war; wir akzeptieren beides.
  let data = null;
  if (typeof r.json === 'object' && r.json) data = r.json;
  else if (typeof r.text === 'string') {
    const t = r.text.trim();
    if (t.startsWith('{')) data = JSON.parse(t);
  }
  if (!data) throw new Error('Antwort enthält keine Uebertragungsdatei.');
  return data;
}

async function lanSearchAndApply() {
  const found = await api.transfer.lanSearch();
  if (!found || !found.ok) throw new Error((found && found.error) || 'Im WLAN wurde nichts gefunden');
  if (!(found.urls || []).length) throw new Error('Keine antwortende LLM-Box im WLAN gefunden.');
  let lastErr = null;
  for (const u of found.urls) {
    try {
      const data = await fetchTransferFrom(u);
      return await applyTransfer(data, `von ${found.device || 'der Windows-App'}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Abruf fehlgeschlagen');
}

/* Uebernahme mit sichtbarer Rueckmeldung, was genau aendert wird. */
async function applyTransfer(data, whence) {
  if (!data || data.format !== 'llm-box-transfer') { toast('Das ist keine LLM-Box-Uebertragungsdatei.', 5000); return; }
  const what = (data.contains || []).map((c) => ({ settings: 'Einstellungen & API-Keys', chats: `${(data.chats || []).length} Chat(s)`, workspaceFiles: 'Workspace-Dateien', smb: `Netzwerkordner \\\\${(data.smb && data.smb.host) || '?'}\\${(data.smb && data.smb.share) || '?'}` + ((data.smb && data.smb.user) ? ` als ${data.smb.user}` : ' ohne Zugangsdaten') }[c] || c)).join(', ');
  const go = await confirmModal('Uebernahme bestaetigen',
    `${whence}: ${what || 'nur Einstellungen'}.\n\n` +
    'Deine bisherigen Einstellungen auf diesem Geraet werden ersetzt. Chats mit gleicher Kennung werden nicht ueberschrieben, sondern ergaenzt oder als Kopie angelegt.\n' +
    (data.smb && data.smb.host
      ? `Der Netzwerkordner wird gesetzt, wenn die Freigabe \\${data.smb.host}\\${data.smb.share || '?'} von diesem Geraet aus erreichbar ist; sonst bleibt dein bisheriger Ordner erhalten.\n`
      : '') +
    'Windows-spezifische Angaben (Laufwerk-Pfad, Fenstermaterial, SSH-Schluessel) werden absichtlich ignoriert.',
    { okLabel: 'Uebernehmen' });
  if (!go) return;
  const r = await api.transfer.apply(data);
  if (!r || !r.ok) { toast('Uebernahme fehlgeschlagen: ' + ((r && r.error) || 'unbekannt'), 6000); return; }
  const rep = r.report || {};
  /* Der wichtige Teil fehlt frueher: die Einstellungen standen zwar in der Datei, aber die
     schon laufende Oberflaeche wusste nichts davon (Verbindung/Modell/Werkzeuge blieben alt).
     applyIncomingSettings() (app.js) liest sie jetzt neu und holt Modelle und Chats ab. */
  let wirkung = null;
  try { wirkung = await applyIncomingSettings(); } catch (e) { toast('Oberflaeche konnte die neuen Einstellungen nicht neu laden: ' + e.message, 7000); }
  const verb = wirkung ? `${wirkung.verbindungen} Verbindung(en), ${rep.chats || 0} Chat(s)` : `${rep.connections || 0} Verbindung(en), ${rep.chats || 0} Chat(s)`;
  toast(`Uebernommen: ${verb}` +
    (rep.chatCopies ? `, ${rep.chatCopies} als Kopie` : '') +
    (rep.skippedChats ? `, ${rep.skippedChats} unveraendert gelassen` : '') +
    /* Netzwerkordner: nur melden, was wirklich gesetzt wurde. Ein ignoriertes smb-Pfad-Argument
       erklaert dem Nutzer den Grund (Freigabe vom Handy aus nicht erreichbar). */
    (rep.smbPath ? ` · Netzwerkordner ${rep.smbPath}` : '') +
    (rep.smbCreds && !rep.smbPath ? ` · Zugangsdaten für ${rep.smbCreds} gespeichert` : ''), 7000);
  if (wirkung) {
    const zustand = wirkung.erreichbar
      ? `Aktive Verbindung: ${wirkung.verbindung} – ${wirkung.modelle} Modell(e), gewaehlt: ${wirkung.modell || 'kein Modell'}`
      : `Verbindung ${wirkung.verbindung} ist NICHT erreichbar: ${wirkung.fehler}`;
    toast(zustand, 9000);
  }
  return wirkung;
}

async function importTransferJson() {
  // Die Dateiauswahl liefert { files: [{ name, text, … }], skipped: [...] } – kein flaches Array.
  const r = await api.files.pick('file', { maxKB: 20480, ignore: [] });
  const f = r && Array.isArray(r.files) ? r.files[0] : null;
  if (!f || !f.text) {
    const why = r && r.skipped && r.skipped.length ? r.skipped[0].reason : 'keine Datei gewaehlt';
    toast('Datei konnte nicht gelesen werden: ' + why, 6000);
    return;
  }
  try { await applyTransfer(JSON.parse(f.text), 'aus der JSON-Datei'); }
  catch (e) { toast('Diese Datei ist keine gueltige Uebertragung: ' + e.message, 7000); }
}

/* Die Android-Seite: suchen, abrufen, uebernehmen – plus eigener JSON-Export als Gegenstueck. */
function tabTransferAndroid() {
  const wrap = el('div');
  const busy = (b, on) => { b.disabled = on; };

  const btnLan = el('button', { class: 'btn sm primary', text: 'Im WLAN suchen …' });
  const btnScan = el('button', { class: 'btn sm', text: 'QR-Code scannen …' });
  const btnJson = el('button', { class: 'btn sm', text: 'Aus JSON-Datei importieren …' });
  const btnOut = el('button', { class: 'btn sm', text: 'Als JSON exportieren …' });

  btnScan.addEventListener('click', async () => {
    busy(btnScan, true); status.textContent = 'Kamera wird geoeffnet …';
    try { await qrScannenAndroid(); status.textContent = 'Fertig.'; }
    catch (e) { status.textContent = 'Scannen fehlgeschlagen: ' + e.message; }
    finally { busy(btnScan, false); }
  });

  const status = el('div', { class: 'fhint', text: 'Voraussetzung: Windows-App oeffnen → Einstellungen → Übertragung → „Im WLAN anbieten“. Beide Geraete im selben WLAN.' });

  btnLan.addEventListener('click', async () => {
    busy(btnLan, true); status.textContent = 'Suche im WLAN …';
    try { await lanSearchAndApply(); status.textContent = 'Fertig – Einstellungen und Chats wurden uebernommen.'; }
    catch (e) { status.textContent = 'Fehler: ' + e.message; toast('Nichts gefunden: ' + e.message, 7000); }
    finally { busy(btnLan, false); }
  });

  btnJson.addEventListener('click', async () => {
    busy(btnJson, true);
    try { await importTransferJson(); } catch (e) { toast('Import fehlgeschlagen: ' + e.message, 7000); }
    finally { busy(btnJson, false); }
  });

  btnOut.addEventListener('click', async () => {
    busy(btnOut, true);
    try { await exportTransferJson({ chats: 'all', ws: false }); } catch (e) { toast('Export fehlgeschlagen: ' + e.message, 7000); }
    finally { busy(btnOut, false); }
  });

  const urlIn = el('input', { type: 'text', placeholder: 'http://192.0.2.10:54321/llmbox-transfer?t=…', style: { width: '100%', minHeight: '42px' } });
  const btnUrl = el('button', { class: 'btn sm', text: 'Abrufen' });
  btnUrl.addEventListener('click', async () => {
    busy(btnUrl, true); status.textContent = 'Rufe die Adresse ab …';
    try { await applyTransfer(await fetchTransferFrom(urlIn.value), 'über die eingegebene Adresse'); status.textContent = 'Fertig.'; }
    catch (e) { status.textContent = 'Fehler: ' + e.message; }
    finally { busy(btnUrl, false); }
  });

  wrap.append(
    el('div', { class: 'tr-warn', text: 'Die Übertragung enthält API-Keys im Klartext – nur im eigenen WLAN nutzen.' }),
    frow('Von der Windows-App übernehmen', 'Die Windows-App muss zuvor „Im WLAN anbieten“ gedrueckt haben. Dann hier suchen lassen; alles wird in einem Schritt uebernommen – ohne Kamera.', btnLan),
    frow('QR-Code scannen', 'Liest den Code der Windows-App direkt mit der Handy-Kamera. Braucht beim ersten Mal die Kamera-Erlaubnis; „Im WLAN suchen“ geht auch ohne Kamera und findet den Rechner von selbst.', btnScan),
    frow('Adresse manuell eingeben', 'Falls die Netzsuche nichts findet, die Adresse aus dem Fenster der Windows-App hier eintragen – oder den QR-Code dort oben mit „QR-Code scannen“ lesen.', el('div', { class: 'fctrl' }, urlIn, btnUrl)),
    frow('Aus JSON-Datei importieren', 'Fallback ohne Netz: die exportierte Datei auf das Handy kopieren und hier auswaehlen.', btnJson),
    frow('Als JSON exportieren', 'Gleicher Format wie die Windows-App – damit lassen sich Einstellungen auch zurueck zum PC oder auf ein zweites Handy bringen.', btnOut),
    status);
  return wrap;
}

/* ───── Einstellungsseite ───── */
function tabTransfer() {
  /* Android ist die empfangende Seite: hier wird gesucht und uebernommen, nicht angeboten. */
  if (window.IS_ANDROID) return tabTransferAndroid();

  const wrap = el('div');
  const opt = { chats: 'none', ws: false, smb: true };
  const busy = (b, on) => { b.disabled = on; };
  const chatSel = el('select', { onchange: (e) => { opt.chats = e.target.value; } }, CHAT_MODES.map((m) => el('option', { value: m.value, text: m.label })));
  const wsChk = el('input', { type: 'checkbox', onchange: (e) => { opt.ws = e.target.checked; } });
  const smbChk = el('input', { type: 'checkbox', checked: true, onchange: (e) => { opt.smb = e.target.checked; } });
  const btnQr = el('button', { class: 'btn sm primary', text: 'Im WLAN anbieten (ein Code) …' });
  const btnMany = el('button', { class: 'btn sm', text: 'QR-Bildfolge (viele Codes) …' });
  const btnJson = el('button', { class: 'btn sm', text: 'JSON exportieren …' });
  btnQr.addEventListener('click', async () => {
    busy(btnQr, true);
    try { await serveLan(opt); } catch (e) { toast('Angebot fehlgeschlagen: ' + (e && e.message ? e.message : e), 7000); } finally { busy(btnQr, false); }
  });
  btnMany.addEventListener('click', async () => {
    busy(btnMany, true);
    try { await showQr(opt); } catch (e) { toast('QR-Code konnte nicht erzeugt werden: ' + (e && e.message ? e.message : e), 7000); } finally { busy(btnMany, false); }
  });
  btnJson.addEventListener('click', async () => {
    busy(btnJson, true);
    try { await exportTransferJson(opt); } catch (e) { toast('Export fehlgeschlagen: ' + (e && e.message ? e.message : e), 7000); } finally { busy(btnJson, false); }
  });
  wrap.append(
    el('div', { class: 'tr-warn', text: 'Achtung: Die Übertragung enthält deine API-Keys und Zugangsdaten im Klartext. Die JSON-Datei danach sicher aufbewahren oder löschen.' }),
    frow('Einstellungen, Verbindungen und API-Keys', 'Immer enthalten: alle Einstellungen dieser App, alle Verbindungen mit ihren Keys, Modell, Parameter, System-Prompt, Kosten, Workspace-Einstellungen (Pfad, Werkzeuge, Grenzen). Der SSH-Schlüssel selbst wird nicht übertragen, nur sein Dateipfad.', el('span', { class: 'fhint', text: 'Immer dabei' })),
    frow('Chats', 'Mehr Chats bedeuten mehr QR-Bilder. Für viele Chats ist die JSON-Datei besser geeignet.', chatSel),
    frow('Workspace-Textdateien (nur JSON)', 'Legt Textdateien des Workspace-Ordners mit in die JSON-Datei (je Datei und gesamt begrenzt, Ordner aus „Ignorieren“ und Binärdateien bleiben draußen, max. 5 MB insgesamt). Im WLAN-Weg passen sie ebenfalls mit hinein – dort gibt es kein Größenlimit wie bei QR-Bildern.', wsChk),
    frow('Netzwerkordner (SMB) samt Zugangsdaten', 'Überträgt den Freigabe-Pfad (Rechner, Freigabe, Unterordner) und – falls auf diesem Rechner hinterlegt – Benutzername, Domain und Passwort. Danach zeigen beide Geräte auf dieselbe Freigabe. Ohne gespeicherte Zugangsdaten bleiben die Felder leer und das Handy behält seine eigenen.', smbChk),
    frow('Im WLAN anbieten (empfohlen)', 'Die Windows-App bietet dieselben Daten für einige Minuten im lokalen Netz an. Die Android-App wählt „Einstellungen → Übertragung → Im WLAN suchen“ und übernimmt alles in einem Schritt – ohne Kamera, ohne Bildfolge.', btnQr),
    frow('QR-Bildfolge (viele Codes)', 'Wie bisher: eine Folge von QR-Bildern, die die Android-App nacheinander einliest. Nur nötig, wenn beide Geräte nicht im selben Netz sind.', btnMany),
    frow('JSON exportieren (Fallback)', 'Gleicher Inhalt wie oben als Datei – auch für die Android-App über „Aus JSON-Datei importieren“. Damit lässt sich eine Übertragung auch aufbewahren oder an einem dritten Gerät einspielen.', btnJson),
    el('div', { class: 'fhint', style: { marginTop: '14px' }, text: 'Nicht übertragen werden gerätebezogene Dinge: Fensterposition, Rechner-ID und der gemeinsame Chat-Ordner (Netzlaufwerk). Das Format ist in docs/TRANSFER-FORMAT.md beschrieben.' })
  );
  return wrap;
}
