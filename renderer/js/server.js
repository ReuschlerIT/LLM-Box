'use strict';
/* ═════════════ Server & Monitor (Strata) ═════════════
   - Monitor, Laden/Entladen, Run-Config: HTTP gegen den Strata-Server (über den Hauptprozess, kein CORS).
   - Starten/Stoppen/Plan/Status: die Strata-CLI („strata launch …“), lokal oder per SSH.
   Die Strata-Engine selbst (GPU-Code) bleibt auf dem Server nötig; LLM Box ersetzt deren Oberfläche. */

const SV = {
  timer: null, busy: false, data: null, err: '', tab: 'monitor', modal: null,
  job: null, out: '', lines: [], cur: '', cr: false, ui: {}, cfg: null, cfgErr: '', tiles: [],
};
const svs = () => S.settings.server;

const SV_FAMILIES = [
  ['', 'Automatisch'], ['qwen', 'Qwen3.8-Flash-Next (ISTA-DASLab, empfohlen)'], ['coder', 'Qwen3.8-Flash-Next Coder'],
  ['unsloth', 'Qwen3.8-Flash-Next (Unsloth)'], ['gyro', 'Gyro (weniger Speicher, langsamer)'], ['swift', 'Swift 1.5'],
  ['qwen36', 'Qwen3.6-35B-A3B'], ['deepseek41', 'DeepSeek V4.1 Flash'], ['nvfp4', 'NVFP4'],
];
const SV_MODELS = ['q2_0', 'iq2_xs', 'iq3_xxs', 'iq3_s', 'IQ1_M', 'UD-IQ4_XS', 'UD-Q4_K_XL', 'UD-Q5_K_XL', 'UD-Q6_K_XL', 'Q8_0', 'Gyro-S', 'Gyro-M', 'ist-das-1.75bpw', 'ist-das-2.00bpw', 'ist-das-2.25bpw'];

/* ───── Verbindung zum Server (HTTP) ───── */
const svConn = () => S.settings.connections.find((c) => c.id === svs().connId) || activeConn();
const svRoot = (c) => String((c && c.baseUrl) || '').replace(/\/+$/, '').replace(/\/v1$/, '');

async function svReq(path, { method = 'GET', body, timeout = 8000, long = false } = {}) {
  const c = svConn();
  if (!c) return { ok: false, status: 0, error: 'Keine Verbindung gewählt.', json: null };
  const headers = { Accept: 'application/json' }; // sonst liefern manche Server die Weboberfläche (HTML) statt der Daten
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (c.apiKey) headers.Authorization = 'Bearer ' + c.apiKey;
  const r = await api.fetch({ url: svRoot(c) + path, method, headers, body: body === undefined ? undefined : JSON.stringify(body), timeout, long });
  let json = null;
  try { json = JSON.parse(r.text); } catch {}
  return { ...r, json };
}
const svErrText = (r) => (r.json && r.json.error && (r.json.error.message || r.json.error)) || r.error || `HTTP ${r.status}`;

/* ───── Monitor: Abfrage ───── */
const SV_METRIC_KEYS = ['engine', 'live', 'hardware', 'totals'];
const svLooksLikeMetrics = (j) => !!j && typeof j === 'object' && !Array.isArray(j) && SV_METRIC_KEYS.some((k) => k in j);
// Gateways und manche Versionen packen die Metrik in eine Hülle ({ data: … }, { metrics: … }): auspacken.
function svUnwrap(j) {
  if (!j || typeof j !== 'object') return null;
  if (svLooksLikeMetrics(j)) return j;
  for (const k of ['data', 'metrics', 'result', 'payload', 'stats', 'strata']) {
    const v = Array.isArray(j[k]) ? j[k][0] : j[k];
    if (svLooksLikeMetrics(v)) return v;
  }
  return null;
}
const svIsHtml = (r) => /^\s*(<!doctype html|<html)/i.test(String(r.text || ''));
// Was kam bei HTTP 200 stattdessen? Hilft, die Ursache zu erkennen (falscher Port, Proxy, anderes Format).
function svDescribe(r) {
  const t = String(r.text || '').trim();
  const snip = t.replace(/\s+/g, ' ').slice(0, 200) + (t.length > 200 ? ' …' : '');
  let kind;
  if (!t) kind = 'eine leere Antwort';
  else if (/^<!doctype html|^<html/i.test(t)) kind = 'eine Webseite (HTML). Die Adresse zeigt vermutlich auf eine Oberfläche oder einen Proxy statt auf die Strata-API';
  else if (/^#\s*(HELP|TYPE)\b/m.test(t)) kind = 'Prometheus-Text statt JSON';
  else if (r.json && r.json.error) kind = `eine Fehlermeldung: ${svErrText(r)}`;
  else if (r.json && typeof r.json === 'object') kind = `JSON ohne bekannte Felder (vorhanden: ${Object.keys(r.json).slice(0, 8).join(', ') || '–'})`;
  else kind = 'Text, der kein JSON ist';
  return `Antwort ${r.status}, aber kein Strata-Monitor-Format: Der Server lieferte ${kind}.${t ? ` Anfang der Antwort: „${snip}“` : ''}`;
}

/* Trifft die Verbindung nur die Oberfläche (HTML), nach der Strata-API auf diesem Rechner suchen.
   Es wird KEIN API-Schlüssel gesendet (fremde lokale Programme sollen ihn nicht bekommen). Nur Adressen auf diesem Rechner. */
const SV_PORT_GUESS = [8080, 8190, 8081, 8000];
async function svDiscover() {
  const c = svConn();
  let u;
  try { u = new URL(svRoot(c)); } catch { return null; }
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname)) return null;
  SV.scanned = SV.scanned || {};
  if (u.origin in SV.scanned) return SV.scanned[u.origin];
  let found = null;
  for (const p of SV_PORT_GUESS) {
    if (String(p) === (u.port || '80')) continue;
    try {
      const r = await api.fetch({ url: `http://127.0.0.1:${p}/v1/models`, method: 'GET', headers: { Accept: 'application/json' }, timeout: 1500 });
      let j = null;
      try { j = JSON.parse(r.text); } catch {}
      if (r.ok && j && Array.isArray(j.data)) { found = { url: `http://127.0.0.1:${p}/v1`, models: j.data.map((x) => x.id).filter(Boolean), auth: false }; break; }
      if ((r.status === 401 || r.status === 403) && j && j.error) { found = { url: `http://127.0.0.1:${p}/v1`, models: [], auth: true }; break; }
    } catch {}
  }
  SV.scanned[u.origin] = found;
  return found;
}
async function svUseFound() {
  const f = SV.found;
  const c = svConn();
  if (!f || !c) return;
  if (!(await confirmModal('Verbindung umstellen', `Auf ${f.url} antwortet eine Strata-API${f.models.length ? ' (Modell: ' + f.models[0] + ')' : ''}. Soll die Verbindung „${c.name}“ von ${c.baseUrl} auf diese Adresse umgestellt werden?${f.auth ? '\n\nDie API verlangt einen Schlüssel. Trage ihn danach unter Einstellungen → Verbindungen ein bzw. nutze „Schlüssel holen & verbinden“.' : ''}`, { okLabel: 'Umstellen' }))) return;
  c.baseUrl = f.url;
  changed();
  SV.found = null;
  toast('Verbindung umgestellt.');
  svPoll();
}

/* Strata-Desktop-App: Der App-Host (Port der App, z. B. 47831) bietet Chat-API und Oberfläche, aber KEIN /metrics.
   Seine Instanz-Daten liegen unter /api/native (Instanz mit status, port, metrics.engine …), der Monitor der App unter /api/monitor. */
async function svTryHost() {
  const n = await svReq('/api/native', { timeout: 5000 });
  if (n.status === 401 || n.status === 403) return { auth: true };
  const nj = n.ok ? n.json : null;
  const list = nj && (Array.isArray(nj.instances) ? nj.instances : Array.isArray(nj) ? nj : null);
  if (!list) return null;
  if (!list.length) {
    // App-Host ohne geladene Instanz: Laden ist möglich
    return { data: { engine: { model: '' }, live: { state: 'unloaded' }, requests: [], totals: {}, history: {}, hostMode: true, source: '/api/native (keine Instanz geladen)' } };
  }
  const inst = list.find((i) => i && i.status === 'ready' && i.phase !== 'unavailable') || list.find((i) => i && i.status === 'ready') || list[0];
  if (!inst || typeof inst !== 'object') return null;
  const src = '/api/native' + (inst.port ? ` (Instanz-Port ${inst.port})` : '');
  const mid = inst.modelId || inst.model || inst.name || '';
  if (mid) SV.lastModel = mid;
  // Meist liefert die Instanz dieselbe Metrik wie ein Modell-Server (engine, live, requests, hardware …)
  const m = svUnwrap(inst.metrics);
  if (m) {
    const data = { ...m };
    if (!data.engine) data.engine = {};
    if (!data.engine.model && (inst.modelId || inst.model)) data.engine.model = inst.modelId || inst.model;
    if (!data.live) data.live = { state: inst.phase === 'unavailable' ? 'unavailable' : 'idle' };
    data.hostMode = true;
    data.instanceId = inst.id;
    if (!data.hardware) {
      // Hardware-Werte der App (GPU, RAM …) aus dem Monitor der App, falls dort im gleichen Format vorhanden
      const mon = await svReq('/api/monitor', { timeout: 4000 });
      if (mon.ok && mon.json && svLooksLikeMetrics({ hardware: mon.json.hardware }) && mon.json.hardware) data.hardware = mon.json.hardware;
    }
    data.source = src;
    return { data };
  }
  // Keine Metrik an der Instanz: Zustand aus Instanz und App-Monitor zusammensetzen
  const mon = await svReq('/api/monitor', { timeout: 4000 });
  const mj = mon.ok && mon.json && typeof mon.json === 'object' ? mon.json : {};
  const state = inst.phase === 'unavailable' ? 'unavailable' : inst.status === 'ready' ? 'limited' : 'limited_unknown';
  const data = {
    engine: { model: inst.modelId || inst.model || inst.name || (mj.engine && mj.engine.modelId) || '', max_context: inst.context || (mj.context && mj.context.maxTokens) || undefined },
    live: { state }, requests: [], totals: {}, history: {}, hostMode: true, instanceId: inst.id, source: src,
    limited: `Strata-Desktop-App erkannt (${src}, Status „${inst.status || '?'}“${inst.phase ? ', Phase „' + inst.phase + '“' : ''}). Diese Quelle enthält keine Messwerte (Geschwindigkeit, GPU). Die volle Anzeige bietet die Oberfläche der App unter „#/monitor“.`,
  };
  if (mj.hardware && svLooksLikeMetrics({ hardware: mj.hardware })) data.hardware = mj.hardware;
  return { data };
}

async function svPoll() {
  if (SV.busy || !(SV.modal || svDockVisible())) return;
  // Nur das Dock (kein Fenster offen): nichts abfragen, wenn die App im Hintergrund ist oder die Verbindung kein lokaler Strata-Server ist
  if (!SV.modal && (document.hidden || !svDockEligible())) { svRenderDock(); return; }
  SV.busy = true;
  try {
    const r = await svReq('/metrics', { timeout: 6000 });
    const j = r.ok ? svUnwrap(r.json) : null;
    if (j) { SV.data = j; SV.err = ''; svPushHist(j); }
    else {
      SV.data = null;
      SV.found = null;
      SV.authErr = r.status === 401 || r.status === 403; // Server läuft, aber der Schlüssel stimmt nicht: Starten würde nichts ändern
      // /metrics fehlt oder hat ein unbekanntes Format: /v1/status und /health sagen, ob das Modell geladen ist.
      let fb = null;
      let hostDone = false;
      if (!SV.authErr && (svIsHtml(r) || r.status === 404)) {
        const h = await svTryHost();
        if (h && h.auth) { SV.authErr = true; hostDone = true; SV.err = 'Die Strata-Desktop-App verlangt für ihre Daten (/api/native) einen Schlüssel, und der in der Verbindung eingetragene wird nicht angenommen. Trage den API-Schlüssel der App unter Einstellungen → Verbindungen ein.'; }
        else if (h && h.data) { SV.data = h.data; SV.err = ''; hostDone = true; svPushHist(h.data); }
      }
      if (!SV.authErr && !hostDone) {
        for (const path of ['/v1/status', '/health']) {
          const x = await svReq(path, { timeout: 4000 });
          const xj = x.ok ? svUnwrap(x.json) || x.json : null;
          if (xj && typeof xj === 'object' && !xj.error) { fb = xj; break; }
        }
      }
      if (hostDone) { /* Daten stammen aus dem App-Host (siehe svTryHost) */ } else if (fb && fb.loaded === false) {
        SV.data = { engine: { model: fb.model || '' }, live: { state: 'unloaded' }, requests: [], totals: {}, history: {} };
        SV.err = '';
      } else if (fb && (fb.loaded === true || r.ok)) {
        // Server erreichbar, Modell geladen (oder zumindest erreichbar), aber kein auswertbares /metrics: eingeschränkter Monitor statt „Offline“
        const why = r.ok ? 'Die Adresse /metrics liefert kein bekanntes Format. ' + svDescribe(r).replace(/^Antwort \d+, aber kein Strata-Monitor-Format: /, '') : '„/metrics“ ist nicht verfügbar (Status ' + (r.status || '–') + ').';
        SV.data = { engine: { model: fb.model || (fb.engine && fb.engine.model) || '' }, live: { state: fb.loaded === true ? 'limited' : 'limited_unknown' }, requests: [], totals: {}, history: {}, limited: `Server online${fb.loaded === true ? ', Modell geladen' : ''}. Eingeschränkter Monitor: ${why}` };
        SV.err = '';
      } else if (r.ok && svIsHtml(r)) {
        // Webseite statt Daten: Ist das überhaupt die API? /v1/models entscheidet.
        const m = await svReq('/v1/models', { timeout: 4000 });
        const mj = m.ok && m.json;
        if (mj && (Array.isArray(mj.data) || Array.isArray(mj.models))) {
          const ids = (mj.data || mj.models).map((x) => x.id || x.name).filter(Boolean);
          SV.data = { engine: { model: ids[0] || '' }, live: { state: 'limited_unknown' }, requests: [], totals: {}, history: {}, limited: 'Die API antwortet (/v1/models), aber „/metrics“ liefert die Strata-Weboberfläche statt Daten. Ein falscher API-Schlüssel würde bei Strata mit 401 beantwortet, nicht mit einer Seite. Vermutlich nutzt diese Strata-Version für die Monitor-Daten einen anderen Pfad oder die Adresse ist die Oberfläche der App. Chat und Modellliste laufen über die API und sind davon nicht betroffen.' };
          SV.err = '';
        } else if (m.status === 401 || m.status === 403) {
          SV.authErr = true;
          SV.err = 'Der Server verlangt einen (anderen) API-Schlüssel. Klicke auf „Schlüssel holen & verbinden“.';
        } else {
          SV.found = await svDiscover();
          SV.err = `Diese Adresse (${svRoot(svConn())}) liefert nur die Strata-Weboberfläche (HTML), auch /v1/models ist keine API-Antwort. Hier lauscht nicht die Strata-API, sondern die Oberfläche der App. Trage in der Verbindung die Adresse des Modell-Servers ein (der Port steht bei „strata launch --status“ bzw. in der Ausgabe von „strata launch“; Standard ist 8080).`
            + (SV.found ? ` GEFUNDEN: Auf ${SV.found.url} antwortet eine Strata-API${SV.found.models.length ? ' (Modell: ' + SV.found.models[0] + ')' : ''}${SV.found.auth ? ', sie verlangt einen Schlüssel' : ''}.` : ' Auf den üblichen lokalen Ports (8080, 8190, 8081, 8000) wurde keine API gefunden.');
        }
      } else if (r.status === 401 || r.status === 403) SV.err = 'API-Schlüssel fehlt oder ist falsch. Trage ihn unter Einstellungen → Verbindungen ein.';
      else if (r.status === 404) SV.err = 'Dieser Server kennt „/metrics“ nicht. Ist es ein Strata-Server?';
      else if (r.ok) SV.err = svDescribe(r) + ` (abgefragt: ${svRoot(svConn())}/metrics)`;
      else SV.err = r.status ? `Antwort ${r.status}` : `Server nicht erreichbar${r.error ? ' (' + r.error + ')' : ''}. Läuft Strata auf dem Zielrechner? Mit „Strata starten & Modell laden“ (oben rechts) startet die App es im Hintergrund mit den Werten aus „Modell starten“.`;
    }
  } catch (e) {
    SV.data = null;
    SV.err = e.message;
  }
  SV.busy = false;
  svRenderMonitor();
  svRenderDock();
}
function svStartPoll() {
  svStopPoll();
  SV.scanned = {};
  const ms = Math.max(1, +svs().pollSec || 2) * 1000;
  SV.timer = setInterval(svPoll, ms);
  svPoll();
}
function svStopPoll() {
  if (SV.timer) clearInterval(SV.timer);
  SV.timer = null;
}

/* ───── Monitor-Dock: kompakte Anzeige unter dem Workspace-Panel (Button „Monitor“ in der Kopfleiste) ─────
   Nutzt dieselbe Abfrage und dieselben Daten wie das Fenster „Server & Monitor“ (SV.data), es gibt also nur eine Abfrage. */
ICONS.activity = '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>';
const SV_DOCK_MIN_W = 1100; // darunter blendet die Oberfläche das rechte Panel aus
const svDockVisible = () => !!(typeof S !== 'undefined' && S.settings && svs().dock && S.panelOpen && window.innerWidth > SV_DOCK_MIN_W);
const svIsLocalHost = (h) => /^(localhost|127\.|\[::1\]|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(h || '');
// Das Dock fragt nur lokale/private Server oder die ausdrücklich gewählte Strata-Verbindung ab, nie still eine Cloud-Verbindung (Schlüssel!)
function svDockEligible() {
  const c = svConn();
  if (!c) return false;
  if (svs().connId) return true;
  try { return svIsLocalHost(new URL(c.baseUrl).hostname); } catch { return false; }
}
const SV_DOCK_TILES = ['speed', 'gpu', 'vram', 'temp', 'power', 'ram'];

function svBuildDock() {
  const dk = { tileRefs: [] };
  dk.badge = el('span', { class: 'sv-badge', text: '…' });
  dk.model = el('div', { class: 'dk-model' });
  dk.ctxBar = el('i');
  dk.ctxTxt = el('span');
  dk.ctx = el('div', { class: 'sv-ctx dk-ctx hidden' }, el('div', { class: 'bar' }, dk.ctxBar), dk.ctxTxt);
  dk.note = el('div', { class: 'dk-note hidden' });
  dk.tiles = el('div', { class: 'dk-tiles hidden' });
  const bDetails = el('button', { class: 'icon-btn', title: 'Details: Server & Monitor (Laden, Entladen, Konfiguration)', html: icon('cpu', 15), onclick: () => openServer('monitor') });
  const bClose = el('button', { class: 'icon-btn', title: 'Monitor ausblenden', html: icon('x', 14), onclick: () => svSetDock(false) });
  dk.root = el('div', { class: 'fp-dock' },
    el('div', { class: 'dk-head' }, el('span', { class: 'ttl', html: icon('activity', 15) + '<span>Monitor</span>' }), dk.badge, el('span', { class: 'sv-spacer' }), bDetails, bClose),
    dk.model, dk.ctx, dk.note, dk.tiles);
  return dk;
}

function svDockTiles(defs) {
  const dk = SV.dock;
  if (dk.tileRefs.length === defs.length) return;
  dk.tiles.innerHTML = '';
  dk.tileRefs = defs.map((t) => {
    const r = { root: el('div', { class: 'sv-tile' }), label: el('div', { class: 'l', text: t.label }), val: el('div', { class: 'v' }), sub: el('div', { class: 's' }), bar: el('div', { class: 'tb' }, el('i')) };
    r.root.append(r.label, r.val, r.bar, r.sub);
    if (t.h) { // jede Kachel mit Messreihe bekommt einen Verlauf
      r.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      r.svg.setAttribute('viewBox', '0 0 100 28');
      r.svg.setAttribute('preserveAspectRatio', 'none');
      r.svg.setAttribute('class', 'sp');
      r.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      r.svg.append(r.path);
      r.root.append(r.svg);
    }
    dk.tiles.append(r.root);
    return r;
  });
}

function svRenderDock() {
  const dk = SV.dock;
  if (!dk || !dk.root.isConnected) return;
  const showNote = (txt, full) => { dk.note.textContent = txt; dk.note.title = full || txt; dk.note.classList.toggle('hidden', !txt); };
  const c = svConn();
  if (!svDockEligible()) {
    dk.badge.textContent = '–';
    dk.badge.className = 'sv-badge';
    dk.model.textContent = c ? c.name : '';
    dk.ctx.classList.add('hidden');
    dk.tiles.classList.add('hidden');
    showNote('Der Monitor ist für lokale Strata-Server gedacht. Die aktive Verbindung ist kein lokaler Server. Wähle unter „Server & Monitor → Zielrechner“ die Strata-Verbindung.');
    return;
  }
  const d = SV.data;
  if (!d) {
    dk.badge.textContent = 'Offline';
    dk.badge.className = 'sv-badge err';
    dk.model.textContent = c ? c.name : '';
    dk.ctx.classList.add('hidden');
    dk.tiles.classList.add('hidden');
    const e = String(SV.err || 'Keine Daten.');
    showNote(e.length > 230 ? e.slice(0, 230) + ' …' : e, e);
    return;
  }
  const live = d.live || {};
  const eng = d.engine || {};
  const [lab, cls] = STATE_LABEL[live.state] || [live.state || '–', 'ok'];
  dk.badge.textContent = lab + (live.queued ? ` · ${live.queued} wartend` : '');
  dk.badge.title = dk.badge.textContent;
  dk.badge.className = 'sv-badge ' + cls;
  dk.model.textContent = eng.model || (c ? c.name : '');
  dk.model.title = eng.model || '';

  const max = eng.max_context;
  const last = (d.requests || [])[0];
  const busy = live.state === 'reading' || live.state === 'generating';
  const used = busy ? (live.prompt_tokens || 0) + (live.generated || 0) : last ? (last.prompt_tokens || 0) + (last.output_tokens || 0) : 0;
  const frac = max ? Math.min(1, used / max) : 0;
  dk.ctx.classList.toggle('hidden', !max);
  dk.ctx.classList.toggle('warn', frac > 0.8);
  dk.ctxBar.style.width = (frac * 100).toFixed(1) + '%';
  dk.ctxTxt.textContent = max ? `${fmt.tok(used)} / ${fmt.tok(max)} · ${Math.round(frac * 100)} %` : '';

  const defs = svTilesDef(d).filter((t) => SV_DOCK_TILES.includes(t.id));
  const any = defs.some((t) => t.val !== '–');
  dk.tiles.classList.toggle('hidden', !any);
  if (any) {
    svDockTiles(defs);
    defs.forEach((t, i) => {
      const r = dk.tileRefs[i];
      r.val.innerHTML = '';
      r.val.append(document.createTextNode(String(t.val)), el('small', { text: t.unit ? ' ' + t.unit : '' }));
      r.sub.textContent = t.sub || '';
      r.root.classList.toggle('dim', t.val === '–');
      r.bar.style.display = t.bar === null || t.bar === undefined ? 'none' : '';
      if (t.bar !== null && t.bar !== undefined) r.bar.firstChild.style.width = Math.min(100, t.bar * 100).toFixed(1) + '%';
      if (r.path) r.path.setAttribute('d', spark(svSeries(d, t.h), t.max, t.min));
    });
  }
  if (busy) {
    const read = live.prompt_read, tot = live.prompt_total;
    showNote(live.state === 'reading'
      ? `Liest den Prompt${tot ? `: ${fmt.num(read || 0)} von ${fmt.num(tot)} Tokens` : ''}`
      : `Antwortet: ${fmt.num(live.generated || 0)} Tokens · ${fmt.tps(live.tok_s)} tok/s · ${fmt.dur(live.elapsed_s)}`);
  } else if (d.limited) showNote(d.limited.length > 230 ? d.limited.slice(0, 230) + ' …' : d.limited, d.limited);
  else if (d.source && !any) showNote('Datenquelle: ' + d.source + ' (keine Messwerte in dieser Quelle)');
  else showNote('');
}

// Dock anhängen (wird von renderFilePanel nach dem Neuaufbau des Panels aufgerufen) und Abfrage passend starten/stoppen
function svDockMount(panel) {
  if (!svs().dock) { svDockSync(); return; }
  if (!SV.dock) SV.dock = svBuildDock();
  panel.append(SV.dock.root);
  svRenderDock();
  svDockSync();
}
function svDockSync() {
  const want = svDockVisible();
  if (want && !SV.timer) svStartPoll();
  else if (!want && !SV.modal && SV.timer) svStopPoll();
  const b = document.getElementById('btn-monitor');
  if (b) b.classList.toggle('on', want);
}
function svSetDock(on) {
  svs().dock = !!on;
  if (on) S.panelOpen = true;
  changed();
  renderFilePanel();
  if (on) svPoll();
}
function svToggleDock() {
  if (window.innerWidth <= SV_DOCK_MIN_W) return openServer('monitor'); // Panel ist bei schmalem Fenster ausgeblendet: Fenster öffnen
  svSetDock(!svDockVisible());
}

/* ───── Monitor: Darstellung ───── */
const GB = 1073741824;
const nn = (v) => v !== null && v !== undefined && !Number.isNaN(v);
const gbOf = (b) => (nn(b) ? (b / GB).toFixed(1).replace('.', ',') : '–');
const pct = (v) => (nn(v) ? Math.round(v) : '–');

function spark(vals, max, min = 0) {
  const v = (vals || []).filter(nn);
  if (v.length < 2) return '';
  const hi = max || Math.max(1, ...v);
  const lo = Math.min(min || 0, hi - 1);
  const w = 100 / (v.length - 1);
  return v.map((y, i) => `${i ? 'L' : 'M'}${(i * w).toFixed(1)},${(28 - Math.max(0, Math.min(1, (y - lo) / (hi - lo))) * 26 - 1).toFixed(1)}`).join(' ');
}

/* Verlauf: nimmt den Verlauf des Servers, falls er welchen liefert. Fehlt er (z. B. für GPU-Auslastung und Temperatur),
   sammelt die LLM Box die Messwerte selbst bei jeder Abfrage (letzte 90 Werte). */
const SV_HIST = {};
const SV_HIST_MAX = 90;
function svPushHist(d) {
  const hw = d && d.hardware;
  if (!hw) return;
  const live = d.live || {};
  const add = (k, v) => { if (!nn(v)) return; const a = SV_HIST[k] || (SV_HIST[k] = []); a.push(v); if (a.length > SV_HIST_MAX) a.shift(); };
  for (const k of ['gpu_util', 'gpu_mem_used', 'gpu_temp', 'gpu_power', 'cpu', 'ram_used', 'disk_read_mb', 'gpu_pcie_rx_mb']) add(k, hw[k]);
  add('tok_s', nn(live.tok_s) ? live.tok_s : hw.tok_s);
}
function svSeries(d, key) {
  const s = (d && d.history || {})[key];
  return Array.isArray(s) && s.filter(nn).length >= 2 ? s : (SV_HIST[key] || []);
}

function svTilesDef(d) {
  const hw = d.hardware || {};
  const st = d.hardware_static || {};
  const live = d.live || {};
  const total = nn(hw.gpu_mem_total) ? hw.gpu_mem_total : nn(st.gpu_vram_total_mib) ? st.gpu_vram_total_mib * 1048576 : null;
  const speed = nn(live.tok_s) ? live.tok_s : hw.tok_s;
  const prefill = nn(live.prefill_tok_s_mean) ? live.prefill_tok_s_mean : hw.prefill_tok_s_mean;
  return [
    { id: 'speed', label: 'Geschwindigkeit', val: nn(speed) ? fmt.tps(speed) : '–', unit: 'tok/s', sub: `Ø ${fmt.tps(live.tok_s_mean ?? hw.tok_s_mean)} tok/s · Prompt ${fmt.tps(prefill)} tok/s`, h: 'tok_s' },
    { id: 'gpu', label: 'GPU-Auslastung', val: pct(hw.gpu_util), unit: nn(hw.gpu_util) ? '%' : '', sub: st.gpu_name || (st.gpu_note ? 'keine GPU-Werte lesbar' : ''), h: 'gpu_util', max: 100 },
    { id: 'vram', label: 'VRAM', val: gbOf(hw.gpu_mem_used), unit: nn(hw.gpu_mem_used) ? 'GB' : '', sub: nn(total) ? `von ${gbOf(total)} GB` : '', h: 'gpu_mem_used', bar: nn(hw.gpu_mem_used) && nn(total) ? hw.gpu_mem_used / total : null, max: total || null },
    { id: 'temp', label: 'GPU-Temperatur', val: pct(hw.gpu_temp), unit: nn(hw.gpu_temp) ? '°C' : '', sub: '', h: 'gpu_temp', min: 20, max: 100 },
    { id: 'power', label: 'GPU-Leistung', val: nn(hw.gpu_power) ? Math.round(hw.gpu_power) : '–', unit: nn(hw.gpu_power) ? 'W' : '', sub: nn(hw.gpu_power_limit) ? `Limit ${Math.round(hw.gpu_power_limit)} W` : '', h: 'gpu_power', max: nn(hw.gpu_power_limit) ? hw.gpu_power_limit : null },
    { id: 'cpu', label: 'CPU', val: pct(hw.cpu), unit: nn(hw.cpu) ? '%' : '', sub: [st.cpu_name, st.threads ? st.threads + ' Threads' : ''].filter(Boolean).join(' · '), h: 'cpu', max: 100 },
    { id: 'ram', label: 'Arbeitsspeicher', val: gbOf(hw.ram_used), unit: nn(hw.ram_used) ? 'GB' : '', sub: nn(hw.ram_total) ? `von ${gbOf(hw.ram_total)} GB` : '', h: 'ram_used', bar: nn(hw.ram_used) && nn(hw.ram_total) ? hw.ram_used / hw.ram_total : null, max: hw.ram_total || null },
    { id: 'disk', label: 'Datenträger', val: nn(hw.disk_read_mb) ? hw.disk_read_mb.toFixed(1).replace('.', ',') : '–', unit: nn(hw.disk_read_mb) ? 'MB/s lesen' : '', sub: nn(hw.disk_write_mb) ? `schreiben ${hw.disk_write_mb.toFixed(1).replace('.', ',')} MB/s` : '', h: 'disk_read_mb' },
    { id: 'pcie', label: 'PCIe (Empfang)', val: nn(hw.gpu_pcie_rx_mb) ? Math.round(hw.gpu_pcie_rx_mb) : '–', unit: nn(hw.gpu_pcie_rx_mb) ? 'MB/s' : '', sub: '', h: 'gpu_pcie_rx_mb' },
  ];
}

const STATE_LABEL = { idle: ['Bereit', 'ok'], reading: ['Liest den Prompt', 'run'], generating: ['Antwortet', 'run'], unloaded: ['Entladen', 'warn'], limited: ['Online · geladen', 'ok'], limited_unknown: ['Online', 'ok'], unavailable: ['Modell nicht verfügbar', 'err'] };

function svBuildMonitor() {
  const u = SV.ui;
  u.badge = el('span', { class: 'sv-badge', text: '…' });
  u.model = el('span', { class: 'sv-model' });
  u.ctx = el('div', { class: 'sv-ctx' }, el('div', { class: 'bar' }, (u.ctxBar = el('i'))), (u.ctxTxt = el('span')));
  u.err = el('div', { class: 'sv-err hidden' });
  u.msg = el('div', { class: 'sv-err hidden', style: { whiteSpace: 'pre-wrap' } });
  u.live = el('div', { class: 'sv-live hidden' });
  u.tiles = el('div', { class: 'sv-tiles' });
  u.gpus = el('div', { class: 'sv-gpus hidden' });
  u.slots = el('div', { class: 'sv-block hidden' });
  u.reqs = el('div', { class: 'sv-block' });
  u.totals = el('div', { class: 'sv-block' });
  u.cache = el('div', { class: 'sv-block hidden' });
  SV.tiles = [];

  const vram = el('input', { type: 'number', min: 0, step: 100, placeholder: 'MiB', style: { width: '90px' }, title: 'VRAM, die für andere Programme frei bleibt' });
  const bLoad = el('button', { class: 'btn sm', html: icon('zap', 14) + '<span>Modell laden</span>', onclick: svLoad });
  const bUnload = el('button', { class: 'btn sm', text: 'Entladen', title: 'Gibt den GPU-Speicher frei; der Server bleibt aktiv', onclick: svUnload });
  const bVram = el('button', { class: 'btn sm', text: 'VRAM-Reserve setzen', onclick: () => svVram(vram.value === '' ? undefined : +vram.value) });
  const bVramReset = el('button', { class: 'btn sm', text: 'Standard', onclick: () => svVram(null) });
  u.bLoad = bLoad;
  u.bUnload = bUnload;

  return el('div', { class: 'sv-monitor' },
    el('div', { class: 'sv-head' }, u.badge, u.model, u.ctx, el('span', { class: 'sv-spacer' }), bLoad, bUnload),
    u.err, u.msg, u.live, u.tiles, u.gpus, u.slots,
    el('div', { class: 'sv-h' }, 'Letzte Anfragen'), u.reqs,
    el('div', { class: 'sv-h' }, 'Summen seit Serverstart'), u.totals, u.cache,
    el('div', { class: 'sv-h' }, 'GPU-Speicher für andere Programme'),
    el('div', { class: 'row-gap', style: { alignItems: 'center' } }, vram, bVram, bVramReset,
      el('span', { class: 'fhint', style: { color: 'var(--text-faint)', fontSize: '12.5px' }, text: 'Reserve in MiB, die die Engine frei lässt (nur Strata).' }))
  );
}

function svEnsureTiles(defs) {
  if (SV.tiles.length === defs.length) return;
  SV.ui.tiles.innerHTML = '';
  SV.tiles = defs.map((t) => {
    const r = {
      root: el('div', { class: 'sv-tile' }),
      label: el('div', { class: 'l', text: t.label }),
      val: el('div', { class: 'v' }),
      sub: el('div', { class: 's' }),
      bar: el('div', { class: 'tb' }, el('i')),
    };
    r.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    r.svg.setAttribute('viewBox', '0 0 100 28');
    r.svg.setAttribute('preserveAspectRatio', 'none');
    r.svg.setAttribute('class', 'sp');
    r.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    r.svg.append(r.path);
    r.root.append(r.label, r.val, r.bar, r.sub, r.svg);
    SV.ui.tiles.append(r.root);
    return r;
  });
}

function svTable(head, rows) {
  const t = el('table', { class: 'sv-table' }, el('thead', {}, el('tr', {}, head.map((h) => el('th', { text: h })))));
  const tb = el('tbody');
  for (const r of rows) tb.append(el('tr', {}, r.map((c) => el('td', { text: c }))));
  t.append(tb);
  return el('div', { class: 'sv-scroll' }, t);
}

function svRenderMonitor() {
  const u = SV.ui;
  if (!u.badge || !u.badge.isConnected) return;
  const d = SV.data;
  u.err.classList.toggle('hidden', !!d);
  if (!d) {
    u.badge.textContent = 'Offline';
    u.badge.className = 'sv-badge err';
    u.model.textContent = svConn() ? svConn().name : '';
    u.err.textContent = SV.err || 'Keine Daten.';
    if (SV.found) u.err.append(' ', el('button', { class: 'btn sm', text: 'Verbindung auf ' + SV.found.url + ' umstellen', onclick: svUseFound }));
    if (/nicht erreichbar|Zeitüberschreitung|ECONN|ENOTFOUND|EHOST|ETIMEDOUT/i.test(SV.err || '')) u.err.append(' ', el('button', { class: 'btn sm', text: 'Zu „Modell starten“', onclick: () => svSwitch('launch') }));
    u.live.classList.add('hidden');
    // Server nicht erreichbar: „Modell laden“ startet Strata im Hintergrund mit den Werten aus „Modell starten“
    const lbl = u.bLoad.querySelector('span');
    if (SV.authErr) {
      // Server läuft, nimmt den Schlüssel aber nicht an: Schlüssel von Strata holen
      if (lbl) lbl.textContent = 'Schlüssel holen & verbinden';
      u.bLoad.title = 'Fragt Strata nach dem aktuellen API-Schlüssel (strata launch --show-key) und trägt ihn nach Rückfrage in der Verbindung ein';
    } else {
      if (lbl) lbl.textContent = 'Strata starten & Modell laden';
      u.bLoad.title = 'Startet Strata im Hintergrund mit den Werten aus dem Tab „Modell starten“ (strata launch --yes --no-tui) und lädt das Modell';
    }
    u.bLoad.disabled = !!(SV.loading || SV.job);
    u.bUnload.disabled = true;
    return;
  }
  SV.authErr = false;
  { const lbl = u.bLoad.querySelector('span'); if (lbl) lbl.textContent = 'Modell laden'; u.bLoad.title = ''; }
  const live = d.live || {};
  const eng = d.engine || {};
  const [lab, cls] = STATE_LABEL[live.state] || [live.state || '–', 'ok'];
  u.badge.textContent = lab + (live.queued ? ` · ${live.queued} wartend` : '');
  u.badge.title = u.badge.textContent;
  u.badge.className = 'sv-badge ' + cls;
  u.model.textContent = eng.model || '';
  u.bLoad.disabled = !(live.state === 'unloaded' || (!!d.hostMode && live.state === 'unavailable')) || !!SV.loading;
  u.bUnload.disabled = live.state === 'unloaded' || (!!d.hostMode && !d.instanceId); // App-Host: Entladen über die Instanz-ID

  /* Kontext */
  const max = eng.max_context;
  const last = (d.requests || [])[0];
  const used = live.state === 'reading' || live.state === 'generating'
    ? (live.prompt_tokens || 0) + (live.generated || 0)
    : last ? (last.prompt_tokens || 0) + (last.output_tokens || 0) : 0;
  const frac = max ? Math.min(1, used / max) : 0;
  u.ctxBar.style.width = (frac * 100).toFixed(1) + '%';
  u.ctx.classList.toggle('warn', frac > 0.8);
  u.ctxTxt.textContent = max ? `Kontext ${fmt.tok(used)} / ${fmt.tok(max)} (${Math.round(frac * 100)} %)` : '';

  /* Laufende Anfrage */
  const busy = live.state === 'reading' || live.state === 'generating';
  u.live.classList.toggle('hidden', !busy && !d.limited);
  if (!busy && d.limited) u.live.textContent = d.limited;
  else if (!busy && d.source) { u.live.classList.remove('hidden'); u.live.textContent = 'Datenquelle: ' + d.source + (d.hardware ? '' : ' · ohne Hardware-Werte (die App liefert sie hier nicht im Metrik-Format)'); }
  if (busy) {
    const read = live.prompt_read, tot = live.prompt_total;
    u.live.textContent = live.state === 'reading'
      ? `Liest den Prompt${tot ? `: ${fmt.num(read || 0)} von ${fmt.num(tot)} Tokens` : ''}`
      : `Antwortet: ${fmt.num(live.generated || 0)}${live.max_tokens ? ' / ' + fmt.num(live.max_tokens) : ''} Tokens · ${fmt.tps(live.tok_s)} tok/s · ${fmt.dur(live.elapsed_s)}`;
  }

  /* Kacheln */
  const defs = svTilesDef(d);
  svEnsureTiles(defs);
  defs.forEach((t, i) => {
    const r = SV.tiles[i];
    r.val.innerHTML = '';
    r.val.append(document.createTextNode(String(t.val)), el('small', { text: t.unit ? ' ' + t.unit : '' }));
    r.sub.textContent = t.sub || '';
    r.root.classList.toggle('dim', t.val === '–');
    r.bar.style.display = t.bar === null || t.bar === undefined ? 'none' : '';
    if (t.bar !== null && t.bar !== undefined) r.bar.firstChild.style.width = Math.min(100, t.bar * 100).toFixed(1) + '%';
    r.path.setAttribute('d', spark(svSeries(d, t.h), t.max, t.min));
  });
  const gp = (d.hardware || {}).gpus;
  u.gpus.classList.toggle('hidden', !(Array.isArray(gp) && gp.length > 1));
  if (Array.isArray(gp) && gp.length > 1) {
    u.gpus.innerHTML = '';
    for (const g of gp) u.gpus.append(el('div', { class: 'sv-gpu', text: `GPU ${g.index}: ${g.name || ''} · ${pct(g.util)} % · ${gbOf(g.mem_used)}/${gbOf(g.mem_total)} GB · ${pct(g.temp)} °C · ${nn(g.power) ? Math.round(g.power) : '–'} W` }));
  }

  /* Slots (parallele Anfragen) */
  const slots = Array.isArray(live.slots) ? live.slots : [];
  u.slots.classList.toggle('hidden', !slots.length);
  if (slots.length) {
    u.slots.innerHTML = '';
    u.slots.append(el('div', { class: 'sv-h', text: `Parallele Plätze (${live.running || 0} von ${live.parallel || slots.length} belegt)` }));
    const keys = [...new Set(slots.flatMap((s) => Object.keys(s)))].filter((k) => typeof (slots.find((s) => k in s) || {})[k] !== 'object').slice(0, 7);
    u.slots.append(svTable(keys, slots.map((s) => keys.map((k) => (s[k] === null || s[k] === undefined ? '–' : String(s[k]))))));
  }

  /* Anfragen */
  u.reqs.innerHTML = '';
  const rq = d.requests || [];
  if (!rq.length) u.reqs.append(el('div', { class: 'fhint', style: { color: 'var(--text-faint)' }, text: 'Noch keine Anfragen seit dem Start.' }));
  else u.reqs.append(svTable(['Zeit', 'Prompt', 'Wiederverwendet', 'Antwort', 'Dauer', 'tok/s', 'Ende'], rq.map((r) => [
    new Date((r.time || 0) * 1000).toLocaleTimeString('de-DE'), fmt.num(r.prompt_tokens), r.reused ? fmt.num(r.reused) : '–', fmt.num(r.output_tokens),
    nn(r.duration_s) ? fmt.dur(r.duration_s) : '–', fmt.tps(r.decode_tok_s), r.finish || '–',
  ])));

  /* Summen */
  const t = d.totals || {};
  const rate = t.decode_ms > 0 ? t.output_tokens / (t.decode_ms / 1000) : null;
  const prate = t.prompt_ms > 0 ? (t.prompt_tokens - (t.reused || 0)) / (t.prompt_ms / 1000) : null;
  const cells = [
    ['Anfragen', fmt.num(t.requests)], ['Prompt-Tokens', fmt.tok(t.prompt_tokens)],
    ['davon wiederverwendet', t.prompt_tokens ? Math.round(((t.reused || 0) / t.prompt_tokens) * 100) + ' %' : '–'],
    ['Antwort-Tokens', fmt.tok(t.output_tokens)], ['Ø Antwort-Tempo', rate ? fmt.tps(rate) + ' tok/s' : '–'], ['Ø Prompt-Tempo', prate ? fmt.tps(prate) + ' tok/s' : '–'],
  ];
  if (t.drafts_offered) cells.push(['Entwürfe angenommen', Math.round((t.drafts_accepted / t.drafts_offered) * 100) + ' %']);
  u.totals.innerHTML = '';
  u.totals.append(el('div', { class: 'sv-kv' }, cells.map(([k, v]) => el('div', {}, el('span', { text: k }), el('b', { text: v })))));

  /* Konversations-Cache */
  const cc = d.conversation_cache;
  u.cache.classList.toggle('hidden', !(cc && cc.enabled));
  if (cc && cc.enabled) {
    u.cache.innerHTML = '';
    u.cache.append(el('div', { class: 'sv-h', text: 'Gesprächs-Cache' }), el('div', { class: 'sv-kv' }, [
      ['Geparkt', fmt.num(cc.parked)], ['Größe', fmt.size(cc.bytes || 0)], ['Wiederhergestellt', fmt.num(cc.restores)], ['Verdrängt', fmt.num(cc.evictions)],
    ].map(([k, v]) => el('div', {}, el('span', { text: k }), el('b', { text: v })))));
  }
}

/* ───── Aktionen: Laden / Entladen / VRAM ───── */
function svMsg(text, kind) {
  const m = SV.ui && SV.ui.msg;
  if (!m || !m.isConnected) return;
  m.textContent = text || '';
  m.className = text ? (kind === 'ok' ? 'sv-live' : 'sv-err') : 'sv-err hidden';
  if (m.className === 'sv-live') m.style.whiteSpace = 'pre-wrap';
}
function svLoadErr(r) {
  const srv = svErrText(r);
  switch (r.status) {
    case 0: return `Keine Antwort vom Server (${r.error || 'Verbindung unterbrochen'}). Läuft der Server noch? Das Laden kann bei großen Modellen mehrere Minuten dauern.`;
    case 401: case 403: return `Abgelehnt (${r.status}): ${srv}\nPrüfe den API-Schlüssel unter Einstellungen → Verbindungen. Strata lässt Steuerbefehle (Laden/Entladen) nur mit gültigem Schlüssel und ohne fremden Browser-Origin zu.`;
    case 404: return 'Der Server kennt weder /v1/load noch /load. Laden per Fernsteuerung gibt es bei Strata erst ab Version 0.1.30.';
    case 409: return 'Der Server ist gerade beschäftigt (laufende oder wartende Anfrage). Bitte später erneut versuchen.';
    case 415: return 'Der Server verlangt Content-Type: application/json (415).';
    case 503: return `Der Server lädt das Modell nicht: ${srv}\nTypische Gründe: zu wenig freier Grafikspeicher (min_free_vram_mib) oder ein before_load-Befehl ist fehlgeschlagen.`;
    default: return `Laden fehlgeschlagen (${r.status}): ${srv}`;
  }
}
/* Adresse und Schlüssel aus der Ausgabe von „strata launch“ übernehmen ─ falls die Verbindung der App woanders hinzeigt */
const svClean = (t) => String(t || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
function svParseAddress(out) {
  const m = /This computer\s+(https?:\/\/[^\s]+)/i.exec(svClean(out));
  return m ? m[1].replace(/[),.;]+$/, '') : null;
}
const svOrigin = (u) => { try { return new URL(u).origin; } catch { return ''; } };
// Zeigt die Monitor-Verbindung nicht dorthin, wo Strata läuft: bestehende Verbindung mit dieser Adresse wählen oder eine neue anlegen
function svAdoptAddress(addr) {
  const want = svOrigin(addr);
  const cur = svConn();
  if (!want || (cur && svOrigin(cur.baseUrl) === want)) return false;
  let t = S.settings.connections.find((c) => c.type === 'openai' && svOrigin(c.baseUrl) === want);
  if (!t) {
    t = { id: uid(), name: 'Strata (' + new URL(addr).host + ')', type: 'openai', baseUrl: addr.replace(/\/+$/, ''), apiKey: cur && cur.type === 'openai' ? cur.apiKey || '' : '', extraParams: true, thinkMode: 'template' };
    S.settings.connections.push(t);
  }
  svs().connId = t.id;
  changed();
  toast(`Strata läuft unter ${addr}. Die Monitor-Verbindung zeigt jetzt dorthin („${t.name}“).`, 8000);
  return true;
}
// „strata launch --show-key“ ausführen und den Schlüssel aus der Ausgabe lesen
function svFetchKey() {
  return new Promise((resolve) => {
    if (SV.job) return resolve(null);
    svRun(['launch', '--show-key'], { timeout: 60, onEnd: (m, out) => {
      const toks = svClean(out).match(/[A-Za-z0-9_\-.]{16,}/g) || [];
      resolve(toks.length ? toks[toks.length - 1] : null);
    } });
  });
}

/* Ohne laufenden Server: Strata mit den Werten aus „Modell starten“ im Hintergrund starten, auf den Server warten und das Modell laden */
const svLaunchConfigured = () => {
  const f = svs().launch;
  return ['preset', 'family', 'model', 'modelPath'].some((k) => String(f[k] || '').trim());
};
async function svAutoStart() {
  if (SV.loading) return;
  if (SV.job) return svMsg('Es läuft bereits ein Strata-Befehl (Tab „Modell starten“, Ausgabe). Bitte warten oder dort abbrechen.', 'err');
  if (!svLaunchConfigured()) {
    svSwitch('launch');
    return toast('Trage zuerst unter „Modell starten“ Familie und Modell, einen Modell-Ordner oder ein Preset ein. Danach genügt „Modell laden“.', 8000);
  }
  // Vielleicht läuft der Server schon (die erste Abfrage war noch nicht fertig): dann normal laden statt neu zu starten
  const chk = await svReq('/metrics', { timeout: 4000 });
  if (chk.ok && chk.json) { await svPoll(); return svLoad(); }
  SV.loading = true;
  SV.ui.bLoad.disabled = true;
  const t0 = Date.now();
  const lastLine = () => (SV.cur || SV.lines[SV.lines.length - 1] || '').trim().slice(0, 160);
  const tick = setInterval(() => svMsg(`Strata wird im Hintergrund gestartet … ${fmt.dur((Date.now() - t0) / 1000)}\n${lastLine()}\n(Die vollständige Ausgabe steht im Tab „Modell starten“.)`, 'ok'), 1000);
  svMsg('Strata wird im Hintergrund gestartet …', 'ok');
  try {
    const res = await new Promise((resolve) => svRun(svLaunchArgs('start'), { timeout: 6 * 3600, onEnd: (m, out) => resolve({ m, out }) }));
    const { m, out } = res;
    const tail = String(out || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
    if (m.error) {
      svMsg(`Strata konnte nicht gestartet werden: ${m.error}\nIst Strata installiert? Prüfe unter „Zielrechner“, wo die Strata-CLI läuft und wie das Programm heißt (Standard: strata).`, 'err');
      return;
    }
    if (m.aborted) { svMsg('Start abgebrochen.', 'err'); return; }
    if (m.timedOut || (m.code !== 0 && m.code !== null && m.code !== undefined)) {
      let hint = '';
      if (/restart|already running|other settings|anderen Einstellungen|läuft schon/i.test(tail)) hint = '\nEin Modell läuft schon mit anderen Einstellungen: Schalte unter „Modell starten“ „Laufendes Modell ersetzen“ ein und versuche es erneut.';
      else if (/not found|nicht gefunden|unknown|unbekannt/i.test(tail)) hint = '\nPrüfe Familie, Modell und Preset unter „Modell starten“ („Plan anzeigen“ zeigt, was passieren würde).';
      svMsg(`Strata meldet ${m.timedOut ? 'eine Zeitüberschreitung' : 'Fehlercode ' + m.code}:\n${tail}${hint}`, 'err');
      return;
    }
    // Der Server läuft im Hintergrund weiter: Adresse aus der Strata-Ausgabe übernehmen (falls die Verbindung woanders hinzeigt) und warten
    const already = /already serving/i.test(out);
    const addr = svParseAddress(out);
    if (addr) svAdoptAddress(addr);
    svMsg(already ? 'Strata lief bereits mit diesen Einstellungen. Verbinde …' : 'Strata ist gestartet. Warte auf den Server …', 'ok');
    let up = null;
    let keyTried = false;
    for (let i = 0; i < 45 && SV.modal; i++) {
      const r = await svReq('/metrics', { timeout: 6000 });
      if (r.ok && r.json) { up = r.json; break; }
      if (r.status === 401 || r.status === 403) {
        // Der Server läuft, verlangt aber einen anderen Schlüssel: bei Strata über „--show-key“ holen und nach Rückfrage übernehmen
        if (!keyTried) {
          keyTried = true;
          svMsg('Strata läuft, lehnt aber den API-Schlüssel ab. Hole den aktuellen Schlüssel …', 'ok');
          const key = await svFetchKey();
          if (key && (await confirmModal('API-Schlüssel übernehmen', `Strata hat einen Schlüssel gemeldet (${key.slice(0, 4)}…${key.slice(-4)}). Soll er in der Verbindung „${svConn().name}“ eingetragen werden?`, { okLabel: 'Übernehmen' }))) {
            svConn().apiKey = key;
            changed();
            continue;
          }
        }
        svMsg('Strata läuft, aber der API-Schlüssel in der Verbindung stimmt nicht. Klicke unter „Modell starten“ auf „Schlüssel anzeigen“ und trage ihn unter Einstellungen → Verbindungen ein.', 'err');
        return;
      }
      await new Promise((res2) => setTimeout(res2, 2000));
    }
    if (!up) { svMsg('Strata wurde gestartet, der Server antwortet aber nicht unter der eingetragenen Adresse. Prüfe Adresse und Port unter Einstellungen → Verbindungen („Verbindung genau prüfen“).', 'err'); return; }
    svMsg('');
    toast(already ? 'Strata läuft bereits mit diesen Einstellungen.' : 'Strata läuft.');
  } finally {
    clearInterval(tick);
    SV.loading = false;
    await svPoll();
    // Läuft der Server, hat aber noch kein Modell geladen: jetzt laden
    if (SV.data && SV.data.live && SV.data.live.state === 'unloaded' && SV.modal) svLoad();
  }
}
/* Server läuft, lehnt den Schlüssel aber ab: aktuellen Schlüssel von Strata holen und nach Rückfrage übernehmen */
async function svFixKey() {
  if (SV.loading || SV.job) return;
  SV.loading = true;
  SV.ui.bLoad.disabled = true;
  svMsg('Hole den aktuellen API-Schlüssel von Strata …', 'ok');
  try {
    const key = await svFetchKey();
    if (!key) { svMsg('Strata hat keinen Schlüssel gemeldet. Prüfe im Tab „Modell starten“ mit „Schlüssel anzeigen“, ob die Strata-CLI erreichbar ist.', 'err'); return; }
    if (!(await confirmModal('API-Schlüssel übernehmen', `Strata hat einen Schlüssel gemeldet (${key.slice(0, 4)}…${key.slice(-4)}). Soll er in der Verbindung „${svConn().name}“ eingetragen werden?`, { okLabel: 'Übernehmen' }))) { svMsg(''); return; }
    svConn().apiKey = key;
    changed();
    svMsg('');
    toast('Schlüssel übernommen.');
  } finally {
    SV.loading = false;
    await svPoll();
    if (SV.data && SV.data.live && SV.data.live.state === 'unloaded' && SV.modal) svLoad();
  }
}
/* ───── Laden/Entladen bei der Strata-Desktop-App (App-Host) ─────
   Quellen: Strata-Tickets #4973 (POST /api/native/instances/<id>/unload, POST /api/native/operations {kind:'load'}) und
   PR #4651 (POST /api/native/resume = zuletzt geladenes Modell). Der Host nimmt JSON ohne Browser-Origin an. */
const svSleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function svHostInstance() {
  const n = await svReq('/api/native', { timeout: 6000 });
  const list = n.ok && n.json && Array.isArray(n.json.instances) ? n.json.instances : [];
  const inst = list.find((i) => i && i.status === 'ready' && i.phase !== 'unavailable') || list[0] || null;
  return { n, inst, installed: n.json && n.json.installed };
}
function svAskModel(ids) {
  return new Promise((resolve) => {
    const sel = el('select', {}, ids.map((id) => el('option', { value: id, text: id })));
    openModal({
      title: 'Modell laden',
      body: el('div', {}, el('div', { text: 'Welches installierte Modell soll die Strata-App laden?', style: { marginBottom: '8px', color: 'var(--text-dim)' } }), sel),
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'Laden', primary: true, onClick: (close) => close(sel.value) }],
      onClose: (r) => resolve(typeof r === 'string' ? r : null),
    });
  });
}
async function svHostPickModel(installed) {
  let models = installed && (Array.isArray(installed.models) ? installed.models : Array.isArray(installed) ? installed : []);
  const ids = (models || []).map((m) => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(Boolean);
  if (!ids.length) return { ids };
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SV.lastModel && ids.includes(SV.lastModel)) return { id: SV.lastModel, ids };
  const want = norm(svs().launch && svs().launch.model);
  const hit = want && ids.find((id) => norm(id).includes(want));
  if (hit) return { id: hit, ids };
  if (ids.length === 1) return { id: ids[0], ids };
  return { id: await svAskModel(ids), ids };
}
async function svHostLoad() {
  if (SV.loading) return;
  SV.loading = true;
  SV.ui.bLoad.disabled = true;
  const t0 = Date.now();
  svMsg('Modell wird über die Strata-App geladen …', 'ok');
  const tick = setInterval(() => svMsg(`Modell wird über die Strata-App geladen … ${fmt.dur((Date.now() - t0) / 1000)}\nBeim ersten Start kann das viele Minuten dauern.`, 'ok'), 1000);
  try {
    const cur = await svHostInstance();
    // Eine abgestürzte Instanz (phase „unavailable“) zuerst entfernen, wie es die App selbst tut
    if (cur.inst && cur.inst.phase === 'unavailable' && cur.inst.id) {
      await svReq(`/api/native/instances/${encodeURIComponent(cur.inst.id)}/unload`, { method: 'POST', body: {}, timeout: 60000 });
      await svSleep(1500);
    } else if (cur.inst && cur.inst.status === 'ready') { svMsg(''); toast('Ein Modell ist bereits geladen.'); return; }
    // 1) Zuletzt geladenes Modell wiederholen; 2) sonst ein installiertes Modell laden
    let r = await svReq('/api/native/resume', { method: 'POST', body: {}, timeout: 30000 });
    let how = 'resume';
    if (!r.ok) {
      const pick = await svHostPickModel(cur.installed);
      if (!pick.ids.length) { svMsg('Die Strata-App meldet kein installiertes Modell. Installiere oder lade eines in der App (Seite „Models“).', 'err'); return; }
      if (!pick.id) { svMsg(''); return; }
      how = pick.id;
      r = await svReq('/api/native/operations', { method: 'POST', body: { kind: 'load', args: { model: pick.id } }, timeout: 30000 });
    }
    if (!r.ok) { svMsg(`Die Strata-App hat das Laden abgelehnt (${how}): ${svErrText(r)}`, 'err'); return; }
    // Der Ladevorgang läuft in der App weiter: warten, bis die Instanz bereit ist
    let ready = false;
    let last = '';
    for (let i = 0; i < 600 && SV.modal; i++) {
      await svSleep(3000);
      const x = await svHostInstance();
      if (x.inst) {
        last = `${x.inst.status || '?'}${x.inst.phase ? ' / ' + x.inst.phase : ''}`;
        if (x.inst.status === 'ready' && x.inst.phase !== 'unavailable') { ready = true; break; }
        if (/fail|error/i.test(String(x.inst.status) + String(x.inst.phase))) { svMsg(`Laden fehlgeschlagen: Zustand „${last}“. Details stehen in den Logs der Strata-App.`, 'err'); return; }
      }
    }
    if (ready) { svMsg(''); toast('Modell geladen.'); }
    else svMsg(`Das Modell ist noch nicht bereit${last ? ' (Zustand: ' + last + ')' : ''}. Schau in der Strata-App nach, ob der Ladevorgang noch läuft.`, 'err');
  } catch (e) {
    svMsg('Laden fehlgeschlagen: ' + e.message, 'err');
  } finally {
    clearInterval(tick);
    SV.loading = false;
    svPoll();
  }
}
async function svHostUnload() {
  const id = SV.data && SV.data.instanceId;
  if (!id) return toast('Keine geladene Instanz gefunden.');
  if (!(await confirmModal('Modell entladen', 'Die Strata-App entlädt das Modell und gibt den GPU-Speicher frei. Die App selbst bleibt geöffnet.', { okLabel: 'Entladen', danger: true }))) return;
  const r = await svReq(`/api/native/instances/${encodeURIComponent(id)}/unload`, { method: 'POST', body: {}, timeout: 120000 });
  if (r.ok) toast('Modell entladen. GPU-Speicher ist frei.');
  else if (r.status === 409 || r.status === 503) toast('Es läuft gerade eine Anfrage. Bitte später erneut versuchen.', 6000);
  else toast('Entladen fehlgeschlagen: ' + svErrText(r), 7000);
  svPoll();
}

async function svLoad() {
  if (SV.data && SV.data.hostMode) return svHostLoad();
  if (!SV.data && SV.authErr) return svFixKey();
  if (!SV.data) return svAutoStart(); // Server nicht erreichbar: erst Strata starten
  if (SV.loading) return;
  SV.loading = true;
  SV.ui.bLoad.disabled = true;
  const t0 = Date.now();
  svMsg('Modell wird geladen … das kann mehrere Minuten dauern (der Server liest bis zu 55 GB ein). Dieses Fenster kann offen bleiben.', 'ok');
  const tick = setInterval(() => svMsg(`Modell wird geladen … ${fmt.dur((Date.now() - t0) / 1000)}`, 'ok'), 1000);
  try {
    let r = await svReq('/v1/load', { method: 'POST', body: {}, timeout: 3600000, long: true });
    if (r.status === 404) r = await svReq('/load', { method: 'POST', body: {}, timeout: 3600000, long: true });
    // Verbindung weg oder Zeitlimit: der Server lädt vielleicht trotzdem weiter. Zustand abfragen.
    if (r.status === 0) {
      for (let i = 0; i < 120 && SV.modal; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const m = await svReq('/metrics', { timeout: 6000 });
        const st = m.json && m.json.live && m.json.live.state;
        if (m.ok && st && st !== 'unloaded') { r = { ok: true, status: 200 }; break; }
      }
    }
    if (r.ok) { svMsg(''); toast('Modell geladen.'); }
    else svMsg(svLoadErr(r), 'err');
  } catch (e) {
    svMsg('Laden fehlgeschlagen: ' + e.message, 'err');
  } finally {
    clearInterval(tick);
    SV.loading = false;
    svPoll();
  }
}
async function svUnload() {
  if (SV.data && SV.data.hostMode) return svHostUnload();
  if (!(await confirmModal('Modell entladen', 'Das Modell wird aus dem GPU-Speicher entfernt. Der Server bleibt aktiv und lädt es bei der nächsten Anfrage automatisch neu (sofern „auto_load“ aktiv ist).', { okLabel: 'Entladen' }))) return;
  const r = await svReq('/v1/unload', { method: 'POST', body: {}, timeout: 60000 });
  if (r.ok) toast('Modell entladen. GPU-Speicher ist frei.');
  else if (r.status === 409 || r.status === 503) toast('Es läuft gerade eine Anfrage. Bitte später erneut versuchen.', 6000);
  else toast('Entladen fehlgeschlagen: ' + svErrText(r), 7000);
  svPoll();
}
async function svVram(mib) {
  if (mib === undefined || (mib !== null && (!Number.isInteger(mib) || mib < 0))) return toast('Bitte eine ganze Zahl (MiB) eingeben.');
  const r = await svReq('/v1/vram', { method: 'POST', body: { reserve_mib: mib }, timeout: 120000 });
  if (r.ok) toast(mib === null ? 'VRAM-Reserve: Standard.' : `VRAM-Reserve: ${mib} MiB.`);
  else toast('VRAM-Reserve fehlgeschlagen: ' + svErrText(r), 7000);
  svPoll();
}

/* ───── Konsole für CLI-Ausgaben ───── */
function svFeed(text) {
  SV.out = (SV.out + text).slice(-200000);
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  for (const ch of clean) {
    if (ch === '\n') { SV.lines.push(SV.cur); SV.cur = ''; SV.cr = false; }
    else if (ch === '\r') SV.cr = true;
    else { if (SV.cr) { SV.cur = ''; SV.cr = false; } SV.cur += ch; }
  }
  if (SV.lines.length > 3000) SV.lines.splice(0, SV.lines.length - 3000);
  svConsoleDraw();
}
function svLog(line) {
  if (SV.cur) { SV.lines.push(SV.cur); SV.cur = ''; }
  SV.lines.push(line);
  svConsoleDraw();
}
function svConsoleDraw() {
  const pre = SV.ui.console;
  if (!pre || !pre.isConnected) return;
  const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
  pre.textContent = SV.lines.concat(SV.cur ? [SV.cur] : []).join('\n');
  if (stick) pre.scrollTop = pre.scrollHeight;
}

function svTarget() {
  return { ...svs().target };
}
function svRun(args, { install = false, timeout = 600, onEnd } = {}) {
  if (SV.job) return toast('Es läuft bereits ein Befehl. Bitte warten oder abbrechen.');
  const id = uid();
  SV.job = { id };
  SV.out = '';
  svUpdateJobUi();
  api.strata.run({ id, target: svTarget(), args, install, timeout }, (m) => {
    if (m.type === 'start') svLog('› ' + m.display);
    else if (m.type === 'data') svFeed(m.text);
    else if (m.type === 'error') { svLog('Fehler: ' + m.message); SV.job = null; svUpdateJobUi(); if (onEnd) onEnd({ error: m.message }, SV.out); }
    else if (m.type === 'end') {
      if (SV.cur) { SV.lines.push(SV.cur); SV.cur = ''; }
      svLog(m.aborted ? '[abgebrochen]' : m.timedOut ? '[Zeitlimit erreicht]' : `[beendet, Code ${m.code}]`);
      SV.job = null;
      svUpdateJobUi();
      if (onEnd) onEnd(m, SV.out);
    }
  });
}
function svUpdateJobUi() {
  const u = SV.ui;
  if (u.jobBtns) u.jobBtns.forEach((b) => { b.disabled = !!SV.job; });
  if (u.stopJob) u.stopJob.disabled = !SV.job;
  if (u.running) u.running.classList.toggle('hidden', !SV.job);
}
const svPrettyJson = (out) => {
  const a = out.indexOf('{'), b = out.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.stringify(JSON.parse(out.slice(a, b + 1)), null, 2); } catch { return null; }
};

/* ───── Start-Formular (strata launch) ───── */
function svLaunchArgs(mode) {
  const f = svs().launch;
  const a = ['launch'];
  const add = (flag, v) => { const s = String(v ?? '').trim(); if (s) a.push(flag, s); };
  add('--preset', f.preset);
  add('--family', f.family);
  add('--model', f.model);
  add('--model-path', f.modelPath);
  add('--data-dir', f.dataDir);
  add('--context', f.context);
  add('--kv', f.kv);
  add('--vision', f.vision);
  add('--parallel', f.parallel);
  add('--mtp', f.mtp);
  add('--tune', f.tune);
  add('--gpu', f.gpu);
  add('--access', f.access);
  add('--port', f.port);
  if (f.noApiKey) a.push('--no-api-key'); else add('--api-key', f.apiKey);
  String(f.extra || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((l) => a.push('--set', l));
  add('--save-preset', f.savePreset);
  if (mode === 'plan') a.push('--plan', '--output', 'json');
  else { a.push('--yes', '--no-tui'); if (f.restart) a.push('--restart'); }
  return a;
}
const svCmdPreview = (mode) => 'strata ' + svLaunchArgs(mode).map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ');

function svSel(path, options) {
  return bindSelect(path, options.map(([value, label]) => ({ value, label })));
}
function svCombo(path, list, placeholder) {
  const id = 'dl-' + path.replace(/\W/g, '');
  const i = bindText(path, { placeholder });
  i.setAttribute('list', id);
  return [i, el('datalist', { id }, list.map((v) => el('option', { value: v })))];
}

function svBuildLaunch() {
  const u = SV.ui;
  const wrap = el('div');
  const preview = el('pre', { class: 'sv-preview' });
  const refresh = () => { preview.textContent = svCmdPreview('start'); };
  wrap.addEventListener('input', refresh);
  wrap.addEventListener('change', refresh);
  refresh();

  const btn = (label, onclick, cls = '') => { const b = el('button', { class: 'btn ' + cls, text: label, onclick }); (u.jobBtns = u.jobBtns || []).push(b); return b; };
  const stopJob = el('button', { class: 'btn danger sm', text: 'Abbrechen', disabled: true, onclick: () => SV.job && api.strata.abort(SV.job.id) });
  u.stopJob = stopJob;
  u.jobBtns = [];

  wrap.append(
    el('div', { class: 'fhint', style: { color: 'var(--text-faint)', fontSize: '12.5px', padding: '10px 0 0' }, text: 'Diese Eingaben werden zu einem „strata launch“-Befehl (Vorschau unten). Leere Felder bleiben Strata-Standard. Der Befehl läuft auf dem unter „Zielrechner“ gewählten Rechner.' }),
    el('h3', { text: 'Modell' }),
    frow('Preset', 'Gespeicherte Start-Einstellungen (strata launch --list-presets). Weitere Felder ändern es nur für diesen Start.', bindText('server.launch.preset', { placeholder: 'z. B. Office' })),
    frow('Modellfamilie', null, svSel('server.launch.family', SV_FAMILIES)),
    frow('Modell / Größe', 'z. B. q2_0, iq3_xxs, UD-Q4_K_XL. Eigene Eingabe möglich.', svCombo('server.launch.model', SV_MODELS, 'q2_0')),
    frow('Eigene Modelldateien', 'Ordner oder .gguf-Datei auf dem Server (statt Download).', bindText('server.launch.modelPath', { placeholder: '/data/models/IQ3_XXS' })),
    frow('Download-Ordner', 'Wohin neue Modelldateien geladen werden.', bindText('server.launch.dataDir', { placeholder: 'Standard von Strata' })),
    el('h3', { text: 'Leistung' }),
    frow('Kontextlänge', '8k bis 512k, je größer desto mehr Speicher.', svCombo('server.launch.context', ['8k', '32k', '64k', '128k', '256k', '512k'], '32k')),
    frow('Gesprächsspeicher (KV)', 'int8 (Standard), q4_0 (halber Speicher), k8v4, fp16.', svSel('server.launch.kv', [['', 'Standard'], ['int8', 'int8'], ['q4_0', 'q4_0'], ['k8v4', 'k8v4'], ['fp16', 'fp16']])),
    frow('Bilder lesen', 'Nur für Modelle mit Bild-Unterstützung.', svSel('server.launch.vision', [['', 'Standard (an, wenn möglich)'], ['on', 'An'], ['off', 'Aus'], ['gpu', 'Auf der Grafikkarte'], ['cpu', 'Auf der CPU']])),
    frow('Parallele Anfragen', '1 bis 8 (Standard: passend zur Grafikkarte).', bindText('server.launch.parallel', { placeholder: 'Standard' })),
    frow('Entwurfsschicht (MTP)', 'Aus spart etwa 1 GB Grafikspeicher, ist aber langsamer.', svSel('server.launch.mtp', [['', 'Standard'], ['on', 'An'], ['off', 'Aus']])),
    frow('Tuning', 'Findet die schnellsten Einstellungen (schnell ca. 20 Min., gründlich bis 2 Std.).', svSel('server.launch.tune', [['', 'Überspringen'], ['quick', 'Schnell'], ['thorough', 'Gründlich'], ['skip', 'Aus']])),
    frow('Grafikkarten', 'Nummern, z. B. 0 oder 0,1.', bindText('server.launch.gpu', { placeholder: 'Standard' })),
    el('h3', { text: 'Zugriff' }),
    frow('Erreichbar für', 'Nur dieser Rechner, dein Netzwerk, Cloudflare-Tunnel oder Tailscale.', svSel('server.launch.access', [['', 'Standard (nur dieser Rechner)'], ['local', 'Nur dieser Rechner'], ['lan', 'Dein Netzwerk'], ['cloudflare', 'Cloudflare-Tunnel'], ['tailscale', 'Tailscale']])),
    frow('Port', 'Standard 8080.', bindText('server.launch.port', { placeholder: '8080' })),
    frow('Ohne API-Schlüssel', 'Nicht empfohlen außerhalb dieses Rechners.', bindSwitch('server.launch.noApiKey')),
    frow('API-Schlüssel', 'Leer lassen: Strata erzeugt einen. Er erscheint danach per „Schlüssel anzeigen“.', bindText('server.launch.apiKey', { type: 'password', placeholder: 'automatisch' })),
    el('h3', { text: 'Erweitert' }),
    frow('Zusätzliche Engine-Einstellungen', 'Eine pro Zeile als SCHLÜSSEL=WERT (→ --set).', bindTextarea('server.launch.extra', 3), true),
    frow('Als Preset speichern', 'Name, unter dem diese Auswahl gespeichert wird.', bindText('server.launch.savePreset', { placeholder: 'optional' })),
    frow('Laufendes Modell ersetzen', 'Fügt --restart hinzu: stoppt das laufende Modell (Antworten brechen ab) und startet neu.', bindSwitch('server.launch.restart')),
    el('h3', { text: 'Befehl' }),
    preview,
    el('div', { class: 'row-gap', style: { margin: '10px 0' } },
      btn('Plan anzeigen', () => svRun(svLaunchArgs('plan'), { timeout: 120, onEnd: (m, out) => { const j = svPrettyJson(out); if (j) { svLog('— Plan (formatiert) —'); svLog(j); } } })),
      btn('Modell starten', () => svRun(svLaunchArgs('start'), { timeout: 6 * 3600, onEnd: (m) => { if (m.code === 0) { toast('Strata läuft.'); svPoll(); } } }), 'primary'),
      btn('Status', () => svRun(['launch', '--status'], { timeout: 60 })),
      btn('Stoppen …', async () => {
        if (!(await confirmModal('Modell stoppen', 'Strata wird beendet: Laufende Antworten brechen ab und der GPU-Speicher wird frei.', { okLabel: 'Stoppen', danger: true }))) return;
        svRun(['launch', '--stop'], { timeout: 120, onEnd: () => svPoll() });
      }, 'danger'),
      btn('Presets', () => svRun(['launch', '--list-presets'], { timeout: 60 })),
      btn('Schlüssel anzeigen', () => svRun(['launch', '--show-key'], { timeout: 60 })),
      btn('Modelle auf dem Server', () => svRun(['models', 'list'], { timeout: 60 }))
    ),
    el('div', { class: 'sv-conhead' }, el('span', { text: 'Ausgabe' }), el('span', { class: 'sv-run hidden', text: 'läuft …' }), el('span', { class: 'sv-spacer' }), stopJob,
      el('button', { class: 'btn sm', text: 'Leeren', onclick: () => { SV.lines = []; SV.cur = ''; svConsoleDraw(); } }),
      el('button', { class: 'btn sm', text: 'Kopieren', onclick: () => copyText(SV.lines.concat(SV.cur ? [SV.cur] : []).join('\n')) })),
    (u.console = el('pre', { class: 'sv-console' }))
  );
  u.running = wrap.querySelector('.sv-run');
  svConsoleDraw();
  svUpdateJobUi();
  return wrap;
}

/* ───── Konfiguration (Run-Config des Servers) ───── */
function svBuildConfig() {
  const wrap = el('div');
  const body = el('div');
  const note = el('div', { class: 'fhint', style: { color: 'var(--text-faint)', fontSize: '12.5px', padding: '10px 0' } });
  wrap.append(el('div', { class: 'row-gap', style: { padding: '10px 0' } }, el('button', { class: 'btn sm', text: 'Neu laden', onclick: load })), note, body);

  async function load() {
    body.innerHTML = '';
    note.textContent = 'Lade …';
    const r = await svReq('/config');
    if (r.ok && svIsHtml(r)) {
      // Strata-Desktop-App: ihr Host liefert unter /config die Oberfläche, nicht die Run-Konfiguration eines Modell-Servers
      note.textContent = '';
      body.append(
        el('div', { style: { padding: '8px 0', lineHeight: 1.55 } },
          el('p', { text: 'Diese Verbindung führt zur Strata-Desktop-App. Deren Host stellt die Run-Konfiguration nicht über HTTP bereit („/config“ liefert die App-Oberfläche), deshalb kann die LLM Box sie hier nicht anzeigen oder ändern.' }),
          el('p', { text: 'Einstellungen ändern: in der Strata-App (Oberfläche im Browser oder App-Fenster). Wichtig: Die Konfigurationsdatei enthält eigene Schlüssel der App (z. B. „user_args“); sie von Hand zu bearbeiten kann Einstellungen kosten.' }),
          el('p', { text: 'Wenn du in der LLM Box die richtige Kontextgröße brauchst: unter Einstellungen → Verbindungen die Datei „strata-….json“ wählen, daraus liest die App „--max-context“.' })),
        el('button', { class: 'btn sm', text: 'App-Oberfläche im Browser öffnen', onclick: () => api.openExternal(svRoot(svConn()) + '/v1#/monitor') }));
      return;
    }
    if (!r.ok || !r.json || !Array.isArray(r.json.keys)) {
      note.textContent = r.status === 404
        ? 'Dieser Server wurde ohne Run-Config gestartet. Starte ihn über „strata launch“ (Tab „Modell starten“), dann erscheinen die Einstellungen hier.'
        : 'Konfiguration nicht lesbar: ' + svErrText(r);
      return;
    }
    const cfg = r.json;
    note.textContent = `${cfg.file}: ${cfg.note || ''} Leer lassen = Standard.`;
    const edits = {};
    for (const k of cfg.keys) {
      let ctrl;
      if (k.kind === 'bool') {
        ctrl = el('select', {}, [['', 'Standard'], ['true', 'An'], ['false', 'Aus']].map(([v, l]) => el('option', { value: v, text: l })));
        ctrl.value = k.value === null || k.value === undefined ? '' : String(k.value);
        ctrl.addEventListener('change', () => { edits[k.key] = ctrl.value === '' ? null : ctrl.value === 'true'; save.disabled = false; });
      } else if (k.kind === 'enum') {
        ctrl = el('select', {}, [['', 'Standard'], ...(k.choices || []).map((c) => [c, c])].map(([v, l]) => el('option', { value: v, text: l })));
        ctrl.value = k.value ?? '';
        ctrl.addEventListener('change', () => { edits[k.key] = ctrl.value === '' ? null : ctrl.value; save.disabled = false; });
      } else {
        const isNum = k.kind === 'number';
        ctrl = el('input', { type: 'text', value: Array.isArray(k.value) ? k.value.join(', ') : (k.value ?? ''), placeholder: 'Standard' });
        ctrl.addEventListener('input', () => {
          const v = ctrl.value.trim();
          edits[k.key] = v === '' ? null : isNum ? Number(v) : v;
          save.disabled = false;
        });
      }
      body.append(frow(k.key, k.help, ctrl));
    }
    const save = el('button', { class: 'btn primary', text: 'Speichern', disabled: true, onclick: async () => {
      const r2 = await svReq('/config', { method: 'POST', body: { set: edits }, timeout: 15000 });
      if (r2.ok) { toast(r2.json && r2.json.changed && r2.json.changed.length ? 'Gespeichert (gilt ab dem nächsten Start): ' + r2.json.changed.join(', ') : 'Keine Änderung.', 5000); load(); }
      else toast('Nicht gespeichert: ' + svErrText(r2), 8000);
    } });
    body.append(el('div', { style: { padding: '14px 0' } }, save, el('span', { class: 'fhint', style: { marginLeft: '12px', color: 'var(--text-faint)', fontSize: '12.5px' }, text: 'Änderungen wirken nach einem Neustart des Modells (Tab „Modell starten“ → Modell ersetzen).' })));
  }
  load();
  return wrap;
}

/* ───── Zielrechner ───── */
function svBuildTarget() {
  const wrap = el('div');
  const draw = () => {
    wrap.innerHTML = '';
    const t = svs().target;
    const conns = S.settings.connections;
    const connSel = el('select', {}, [['', 'Aktive Verbindung'], ...conns.map((c) => [c.id, c.name])].map(([v, l]) => el('option', { value: v, text: l })));
    connSel.value = svs().connId || '';
    connSel.addEventListener('change', () => { svs().connId = connSel.value; changed(); SV.data = null; svPoll(); });
    const test = el('button', { class: 'btn sm', text: 'Verbindung testen (strata --version)', onclick: () => { svSwitch('launch'); setTimeout(() => svRun(['--version'], { timeout: 40 }), 50); } });
    wrap.append(
      el('h3', { text: 'Server (HTTP)' }),
      frow('Verbindung zum Strata-Server', 'Für Monitor, Laden/Entladen und Konfiguration. Adresse und API-Schlüssel stammen aus Einstellungen → Verbindungen.', [connSel,
        el('button', { class: 'btn sm', text: 'Neue Strata-Verbindung …', onclick: () => {
          const c = { id: uid(), name: 'Strata', type: 'openai', baseUrl: 'http://localhost:8080/v1', apiKey: '', extraParams: true, thinkMode: 'template' };
          S.settings.connections.push(c);
          svs().connId = c.id;
          changed();
          draw();
          openSettings('conn');
          toast('Verbindung „Strata“ angelegt. Passe Adresse und Schlüssel an.', 5000);
        } })]),
      frow('Abfrage-Intervall (Sekunden)', 'Wie oft der Monitor Daten holt.', bindNumber('server.pollSec', { min: 1, max: 30, placeholder: '2' })),
      el('h3', { text: 'Wo läuft die Strata-CLI?' }),
      frow('Rechner', 'Lokal: Strata ist auf diesem PC installiert. SSH: Strata läuft auf einem anderen Rechner (Windows 10/11 bringt „ssh“ mit).', (() => {
        const s = el('select', {}, [['local', 'Dieser Rechner'], ['ssh', 'Anderer Rechner per SSH']].map(([v, l]) => el('option', { value: v, text: l })));
        s.value = t.mode;
        s.addEventListener('change', () => { t.mode = s.value; changed(); draw(); });
        return s;
      })()),
      frow('Strata-Programm', 'Name oder voller Pfad der „strata“-Datei.', bindText('server.target.bin', { placeholder: 'strata' }))
    );
    if (t.mode === 'ssh') {
      wrap.append(
        frow('Host', 'Name oder IP des Servers.', bindText('server.target.host', { placeholder: 'gpu-server.local' })),
        frow('Benutzer', null, bindText('server.target.user', { placeholder: 'benutzer' })),
        frow('Port', null, bindNumber('server.target.port', { min: 1, max: 65535, placeholder: '22' })),
        frow('Schlüsseldatei', 'Anmeldung nur per Schlüssel (kein Passwort-Dialog). z. B. ~/.ssh/id_ed25519', bindText('server.target.key', { placeholder: '~/.ssh/id_ed25519' })),
        frow('Betriebssystem des Servers', null, svSel('server.target.remoteOs', [['linux', 'Linux / macOS'], ['windows', 'Windows']]))
      );
    }
    wrap.append(
      el('div', { class: 'row-gap', style: { padding: '14px 0' } }, test,
        el('button', { class: 'btn sm', text: 'Strata installieren …', onclick: async () => {
          const win = t.mode === 'ssh' ? t.remoteOs === 'windows' : /Win/i.test(navigator.platform);
          const cmd = win ? 'irm https://github.com/Niko1221/Strata/releases/latest/download/install.ps1 | iex' : 'curl -fsSL https://github.com/Niko1221/Strata/releases/latest/download/install.sh -o install.sh && sh install.sh';
          if (!(await confirmModal('Strata installieren', `Der offizielle Installer von Niko1221/Strata wird auf ${t.mode === 'ssh' ? t.host : 'diesem Rechner'} ausgeführt:\n\n${cmd}\n\nEr lädt Programmdateien aus dem Internet und installiert in dein Benutzerverzeichnis (ohne Administratorrechte). Die Engine und das Modell folgen beim ersten Start. Fortfahren?`, { okLabel: 'Installieren' }))) return;
          svSwitch('launch');
          setTimeout(() => svRun([], { install: true, timeout: 1800 }), 50);
        } })),
      el('div', { class: 'fhint', style: { color: 'var(--text-faint)', fontSize: '12.5px', lineHeight: 1.55 }, text: 'Hinweis: LLM Box ersetzt die Oberfläche von Strata (Start, Einstellungen, Monitor). Die Strata-Engine, die das Modell auf der Grafikkarte rechnet, muss auf dem Server installiert sein. Bei SSH wird jedes Argument streng geprüft; erlaubt sind nur die Strata-Befehle launch, models, update, doctor und connect.' })
    );
  };
  draw();
  return wrap;
}

/* ───── Fenster ───── */
const SV_TABS = [
  { id: 'monitor', label: 'Monitor', ic: 'cpu' },
  { id: 'launch', label: 'Modell starten', ic: 'zap' },
  { id: 'config', label: 'Konfiguration', ic: 'sliders' },
  { id: 'target', label: 'Zielrechner', ic: 'plug' },
];
let svNav, svPane;

function svSwitch(id) {
  SV.tab = id;
  if (!svNav) return;
  svNav.innerHTML = '';
  SV_TABS.forEach((t) => svNav.append(el('button', { class: t.id === id ? 'active' : '', html: icon(t.ic, 16) + '<span>' + t.label + '</span>', onclick: () => svSwitch(t.id) })));
  svPane.innerHTML = '';
  SV.ui = { console: null, jobBtns: [] };
  if (id === 'monitor') { svPane.append(svBuildMonitor()); svRenderMonitor(); }
  else if (id === 'launch') svPane.append(svBuildLaunch());
  else if (id === 'config') svPane.append(svBuildConfig());
  else svPane.append(svBuildTarget());
}

function openServer(tab = 'monitor') {
  if (SV.modal) return;
  svPane = el('div', { class: 'pane' });
  svNav = el('nav');
  if (!svDockVisible()) { SV.data = null; SV.err = ''; } // bei sichtbarem Dock die Daten behalten (kein Flackern)
  const m = openModal({
    title: 'Server & Monitor', wide: true, bare: true,
    body: el('div', { class: 'settings' }, svNav, svPane),
    onClose: () => { SV.modal = null; svNav = svPane = null; SV.ui = {}; if (!svDockVisible()) svStopPoll(); else svRenderDock(); },
  });
  SV.modal = m;
  svSwitch(tab);
  svStartPoll();
}
