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
  const t0 = await buildTransfer(opt, true);
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
    el('div', { class: 'fhint', text: `Inhalt: ${t0.contains.map((c) => ({ settings: 'Einstellungen & API-Keys', chats: `${(t0.chats || []).length} Chat(s)` }[c] || c)).join(', ')}. ${fmtBytes(r.zBytes)} komprimiert, Prüfsumme ${r.sha16}.` }),
    el('div', { class: 'fhint', text: 'Der QR-Code enthält nur die Adresse – deshalb reicht EIN Code (früher waren es mehrere Bilder hintereinander).' }));

  // openModal gibt kein Promise zurueck, sondern { close, el } – das Ergebnis kommt ueber
  // onClose. Wer hier .then() schreibt, bekommt einen Laufzeitfehler.
  openModal({
    title: 'Übertragung im WLAN anbieten', body, wide: true,
    buttons: [{ label: 'Dienst beenden', value: 'stop' }, { label: 'Fertig', primary: true, value: null }],
    onClose: (v) => { if (v === 'stop') api.transfer.serveStop(); },   // Fertig/ESC laesst den Dienst bis zum Ablauf laufen
  });
}

/* ───── Android-Seite: Daten von der Windows-App holen ─────
   Dieselben Daten, anderer Weg: die Windows-App bietet sie im WLAN an (siehe oben), hier
   werden sie abgeholt. Ein QR-Code wird auf dem Handy nicht dekodiert - es gibt keinen
   eingebauten Kamera-Decoder. Stattdessen: Netzsuche oder Adresse eintragen. */

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
  const what = (data.contains || []).map((c) => ({ settings: 'Einstellungen & API-Keys', chats: `${(data.chats || []).length} Chat(s)`, workspaceFiles: 'Workspace-Dateien' }[c] || c)).join(', ');
  const go = await confirmModal('Uebernahme bestaetigen',
    `${whence}: ${what || 'nur Einstellungen'}.\n\n` +
    'Deine bisherigen Einstellungen auf diesem Geraet werden ersetzt. Chats mit gleicher Kennung werden nicht ueberschrieben, sondern ergaenzt oder als Kopie angelegt.\n' +
    'Windows-spezifische Angaben (Laufwerk-Pfad, Fenstermaterial, SSH-Schluessel) werden absichtlich ignoriert.',
    { okLabel: 'Uebernehmen' });
  if (!go) return;
  const r = await api.transfer.apply(data);
  if (!r || !r.ok) { toast('Uebernahme fehlgeschlagen: ' + ((r && r.error) || 'unbekannt'), 6000); return; }
  const rep = r.report || {};
  toast(`Uebernommen: ${rep.connections || 0} Verbindung(en), ${rep.chats || 0} Chat(s)` +
    (rep.chatCopies ? `, ${rep.chatCopies} als Kopie` : '') +
    (rep.skippedChats ? `, ${rep.skippedChats} unveraendert gelassen` : ''), 7000);
  await loadChatList();
  if (S.chatList.length) await openChat(S.chatList[0].id); else newChat();
  applyAppearance();
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
  const btnJson = el('button', { class: 'btn sm', text: 'Aus JSON-Datei importieren …' });
  const btnOut = el('button', { class: 'btn sm', text: 'Als JSON exportieren …' });

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
    frow('Von der Windows-App übernehmen', 'Die Windows-App muss zuvor „Im WLAN anbieten“ gedrueckt haben. Dann hier suchen lassen; alles wird in einem Schritt uebernommen.', btnLan),
    frow('Adresse manuell eingeben', 'Falls die Netzsuche nichts findet, die Adresse aus dem Fenster der Windows-App hier eintragen (oder deren QR-Code mit einer beliebigen QR-App lesen).', el('div', { class: 'fctrl' }, urlIn, btnUrl)),
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
  const opt = { chats: 'none', ws: false };
  const busy = (b, on) => { b.disabled = on; };
  const chatSel = el('select', { onchange: (e) => { opt.chats = e.target.value; } }, CHAT_MODES.map((m) => el('option', { value: m.value, text: m.label })));
  const wsChk = el('input', { type: 'checkbox', onchange: (e) => { opt.ws = e.target.checked; } });
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
    frow('Workspace-Textdateien (nur JSON)', 'Legt Textdateien des Workspace-Ordners mit in die JSON-Datei (je Datei und gesamt begrenzt, Ordner aus „Ignorieren“ und Binärdateien bleiben draußen, max. 5 MB insgesamt). Passt nicht in einen QR-Code.', wsChk),
    frow('Im WLAN anbieten (empfohlen)', 'Die Windows-App bietet dieselben Daten für einige Minuten im lokalen Netz an. Die Android-App wählt „Einstellungen → Übertragung → Im WLAN suchen“ und übernimmt alles in einem Schritt – ohne Kamera, ohne Bildfolge.', btnQr),
    frow('QR-Bildfolge (viele Codes)', 'Wie bisher: eine Folge von QR-Bildern, die die Android-App nacheinander einliest. Nur nötig, wenn beide Geräte nicht im selben Netz sind.', btnMany),
    frow('JSON exportieren (Fallback)', 'Gleicher Inhalt wie oben als Datei – auch für die Android-App über „Aus JSON-Datei importieren“. Damit lässt sich eine Übertragung auch aufbewahren oder an einem dritten Gerät einspielen.', btnJson),
    el('div', { class: 'fhint', style: { marginTop: '14px' }, text: 'Nicht übertragen werden gerätebezogene Dinge: Fensterposition, Rechner-ID und der gemeinsame Chat-Ordner (Netzlaufwerk). Das Format ist in docs/TRANSFER-FORMAT.md beschrieben.' })
  );
  return wrap;
}
