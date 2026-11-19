'use strict';
/* ═════════════ Live-Ansicht ═════════════
   Zeigt Chats geräteübergreifend in Echtzeit, Wort für Wort (SSE).
   - Quelle (nur Windows): meldet Änderungen der Chats an den Live-Dienst im Hauptprozess (main.js, 'live:*').
   - Empfänger (Windows und Android): verbindet sich mit der Quelle, listet deren Chats und zeigt den gewählten Chat schreibgeschützt,
     während er entsteht. Der Empfänger nutzt nur api.fetch und api.stream, die es auf beiden Plattformen gibt.
   Die Chats des Empfängers werden dabei nie verändert oder gespeichert. */

const LIVE_DEF = { host: { enabled: false, port: 45460 }, client: { enabled: false, url: '', follow: true, autoOpen: false } };
/* Fehlende Vorgaben im vorhandenen Einstellungsobjekt ergänzen. WICHTIG: das Objekt bleibt dasselbe (kein Ersetzen durch eine Kopie),
   sonst schreiben Eingabefelder, die das Objekt beim Aufbau der Seite gemerkt haben, später in ein veraltetes Objekt und die Wahl geht verloren. */
function ensureObj(parent, key, defaults) {
  const cur = parent[key];
  const o = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : (parent[key] = {});
  for (const k of Object.keys(defaults)) if (o[k] === undefined) o[k] = defaults[k];
  return o;
}
const liveCfg = () => { const l = ensureObj(S.settings, 'live', {}); ensureObj(l, 'host', LIVE_DEF.host); ensureObj(l, 'client', LIVE_DEF.client); return l; };
const liveCanHost = () => !!(typeof api !== 'undefined' && api.live && !window.IS_ANDROID);

/* ───── Gemeinsames ───── */
const LIVE_MAXSTR = 150000; // größere Texte (z. B. Bilddaten) nicht live mitschicken
function liveMsg(m) {
  const o = {};
  for (const k of Object.keys(m)) { if (k === 'request' || k === 'thinkBlocks') continue; o[k] = m[k]; }
  if (Array.isArray(o.files)) o.files = o.files.map((f) => { const g = {}; for (const [k, v] of Object.entries(f || {})) g[k] = typeof v === 'string' && v.length > LIVE_MAXSTR ? '' : v; return g; });
  if (Array.isArray(o.images)) o.images = o.images.map((im) => { const g = {}; for (const [k, v] of Object.entries(im || {})) g[k] = typeof v === 'string' && v.length > 600000 ? '' : v; return g; });
  if (o.role === 'tool' && typeof o.content === 'string' && o.content.length > 6000) o.content = o.content.slice(0, 6000) + '\n… (gekürzt)';
  return o;
}
const liveChatLite = (c) => ({ id: c.id, title: c.title, created: c.created, updated: c.updated, model: c.model, ctxStart: c.ctxStart, messages: c.messages.map(liveMsg) });

/* ───── Quelle: Änderungen melden ───── */
const LIVEP = { on: false, timer: null, chats: new Map(), listSig: '', active: '', running: new Set() };
const livePush = (e) => { try { api.live.push(e); } catch {} };
function livePubReset() { LIVEP.chats.clear(); LIVEP.listSig = ''; LIVEP.active = ''; LIVEP.running.clear(); }
function livePubStart() {
  if (LIVEP.on || !liveCanHost()) return;
  LIVEP.on = true;
  livePubReset();
  LIVEP.timer = setInterval(livePubTick, 150);
}
function livePubStop() { LIVEP.on = false; if (LIVEP.timer) clearInterval(LIVEP.timer); LIVEP.timer = null; }
const liveSigOf = (c, m) => JSON.stringify([c.title, (m.toolCalls || []).length, m.error || '', m.finish || '', !!m.aborted, m.stats ? m.stats.totalTokens : 0, m.model || '', (m.images || []).length, m.role]);
function livePubTick() {
  try {
    if (!S.chat) return;
    const own = S.chat._live ? null : S.chat;
    const aid = own ? own.id : '';
    if (aid !== LIVEP.active) { LIVEP.active = aid; livePush({ type: 'active', id: aid }); }
    const runIds = new Set([...RUNS].map((r) => r.chat.id));
    const ls = S.chatList.map((c) => c.id + ':' + c.updated + ':' + c.title).join('|') + '#' + [...runIds].join(',');
    if (ls !== LIVEP.listSig) {
      LIVEP.listSig = ls;
      livePush({ type: 'list', list: S.chatList.slice(0, 200).map((c) => ({ id: c.id, title: c.title, updated: c.updated, model: c.model, running: runIds.has(c.id) })) });
    }
    const chats = new Set();
    if (own) chats.add(own);
    for (const R of RUNS) chats.add(R.chat);
    for (const c of chats) {
      if (!c.messages.length) continue;
      const n = c.messages.length;
      const last = c.messages[n - 1];
      const cl = String(last.content || '').length;
      const tl = String(last.thinking || '').length;
      let st = LIVEP.chats.get(c.id);
      if (!st || n < st.n || (n === st.n && (last.id || '') !== st.lastId)) {
        livePush({ type: 'chat', chat: liveChatLite(c) });
      } else if (n > st.n) {
        for (let i = Math.max(0, st.n - 1); i < n; i++) livePush({ type: 'msg', id: c.id, index: i, message: liveMsg(c.messages[i]), title: c.title });
      } else {
        const sg = liveSigOf(c, last);
        if (sg !== st.sig || cl < st.cl || tl < st.tl) livePush({ type: 'msg', id: c.id, index: n - 1, message: liveMsg(last), title: c.title });
        else if (cl > st.cl || tl > st.tl) {
          const d = { type: 'delta', id: c.id, index: n - 1 };
          if (cl > st.cl) { d.cFrom = st.cl; d.c = String(last.content).slice(st.cl); }
          if (tl > st.tl) { d.tFrom = st.tl; d.t = String(last.thinking).slice(st.tl); }
          livePush(d);
        }
      }
      LIVEP.chats.set(c.id, { n, lastId: last.id || '', cl, tl, sig: liveSigOf(c, last) });
    }
    for (const id of runIds) if (!LIVEP.running.has(id)) { LIVEP.running.add(id); livePush({ type: 'busy', id, running: true }); }
    for (const id of [...LIVEP.running]) if (!runIds.has(id)) { LIVEP.running.delete(id); livePush({ type: 'busy', id, running: false }); }
  } catch (e) { /* die Live-Anzeige darf die App nie stören */ }
}
async function liveHostApply() {
  if (!liveCanHost()) return null;
  const h = liveCfg().host;
  if (h.enabled) {
    livePubStart();
    return api.live.start({ port: h.port, remote: !!h.remote });
  }
  livePubStop();
  return api.live.stop();
}

/* ───── Empfänger ───── */
const LC = { hub: false, models: null, pick: { conn: '', model: '' }, mode: 'sse', remote: false, helloT: 0, pollGen: 0, pollSeq: -1, status: 'off', msg: '', device: '', list: [], chats: new Map(), activeId: '', viewing: false, viewId: '', prev: null, gen: 0, streamId: '', buf: '', retry: 0, retryT: 0, lastData: 0, wd: 0, base: '', token: '', rt: 0, renderT: 0 };
function liveParseUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    const token = x.searchParams.get('t') || '';
    if (!/^https?:$/.test(x.protocol) || !token) return null;
    return { base: x.origin + '/llmbox-live', token };
  } catch { return null; }
}
const liveUrl = (path) => LC.base + path + (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(LC.token);
async function liveReq(path) {
  const r = await api.fetch({ url: liveUrl(path), method: 'GET', headers: { Accept: 'application/json' }, timeout: 10000 });
  if (!r || !r.ok) throw new Error((r && (r.error || (r.status === 403 ? 'Token passt nicht' : r.status ? 'HTTP ' + r.status : ''))) || 'nicht erreichbar');
  try { return JSON.parse(r.text); } catch { throw new Error('Antwort ist kein JSON'); }
}
function liveSetStatus(st, msg) {
  LC.status = st; LC.msg = msg || '';
  liveRenderBox();
  if (typeof LIVE_TAB_REFRESH === 'function' && LIVE_TAB_REFRESH.fn) LIVE_TAB_REFRESH.fn();
}
const LIVE_TAB_REFRESH = { fn: null };
function liveDisconnect(silent) {
  LC.gen++;
  if (LC.streamId) { try { api.abort(LC.streamId); } catch {} LC.streamId = ''; }
  clearTimeout(LC.retryT); clearInterval(LC.wd); clearTimeout(LC.helloT); LC.pollGen++;
  if (!silent) { liveSetStatus('off'); LC.list = []; LC.chats.clear(); liveLeaveView(true); liveRenderBox(); }
}
function liveConnect() {
  const cfg = liveCfg().client;
  const p = liveParseUrl(cfg.url);
  liveDisconnect(true);
  if (!p) { liveSetStatus('error', 'Adresse ungültig. Sie muss mit http:// beginnen und ?t=… enthalten (Einstellungen → Live-Ansicht der Quelle).'); return; }
  LC.base = p.base; LC.token = p.token; LC.buf = '';
  const gen = ++LC.gen;
  liveSetStatus('connecting');
  // Kommt über den Strom (SSE) nichts an (z. B. weil die Brücke des Geräts Teilantworten zurückhält), wechselt die Anzeige auf Long-Polling
  LC.mode = 'sse';
  clearTimeout(LC.helloT);
  LC.helloT = setTimeout(() => { if (gen === LC.gen && LC.status !== 'on') livePollStart(gen); }, 7000);
  const id = 'live_' + uid();
  LC.streamId = id;
  LC.lastData = Date.now();
  api.stream({ id, url: LC.base + '/events?t=' + encodeURIComponent(LC.token), method: 'GET', headers: { Accept: 'text/event-stream' } }, (m) => {
    if (gen !== LC.gen || LC.mode === 'poll') return;
    if (m.type === 'data') { LC.lastData = Date.now(); liveFeed(m.text); }
    else if (m.type === 'error') {
      if (m.status === 403) { liveSetStatus('error', 'Token passt nicht. Adresse in den Einstellungen der Quelle neu kopieren.'); return; }
      liveSetStatus('retry', m.message || 'Verbindung verloren'); liveRetry(gen);
    } else if (m.type === 'end' && !m.aborted) { liveSetStatus('retry', 'Verbindung beendet'); liveRetry(gen); }
  });
  clearInterval(LC.wd);
  LC.wd = setInterval(() => { if (gen === LC.gen && LC.mode === 'sse' && LC.status === 'on' && Date.now() - LC.lastData > 45000) { liveSetStatus('retry', 'Keine Daten mehr'); liveConnect(); } }, 10000);
}
function liveRetry(gen) {
  clearTimeout(LC.retryT);
  const wait = Math.min(15000, 1500 * Math.pow(1.6, LC.retry++));
  LC.retryT = setTimeout(() => { if (gen === LC.gen) liveConnect(); }, wait);
}
/* Long-Polling: Ersatz für den Strom. Holt Neues per normaler Anfrage (api.fetch), die der Hub bis zu 20 s offen hält. */
async function livePollStart(gen) {
  if (gen !== LC.gen || LC.mode === 'poll') return;
  LC.mode = 'poll';
  if (LC.streamId) { try { api.abort(LC.streamId); } catch {} LC.streamId = ''; }
  const pg = ++LC.pollGen;
  LC.pollSeq = -1;
  let fails = 0;
  while (pg === LC.pollGen && gen === LC.gen) {
    try {
      const r = await liveReqLong('/poll?since=' + LC.pollSeq);
      if (pg !== LC.pollGen || gen !== LC.gen) return;
      fails = 0;
      if (r.reset) LC.pollSeq = -1;
      for (const ev of r.events || []) { LC.lastData = Date.now(); try { await liveEvent(ev.type, ev.data); } catch (e) { console.error(e); } }
      if (typeof r.seq === 'number') LC.pollSeq = r.seq;
      if (LC.status !== 'on' && (r.events || []).length === 0) liveSetStatus('on');
    } catch (e) {
      if (pg !== LC.pollGen || gen !== LC.gen) return;
      if (/Token passt nicht/.test(e.message)) { liveSetStatus('error', 'Token passt nicht. Adresse in den Einstellungen der Quelle neu kopieren.'); return; }
      fails++;
      liveSetStatus('retry', e.message);
      await new Promise((res) => setTimeout(res, Math.min(15000, 1500 * fails)));
    }
  }
}
async function liveReqLong(path) {
  const r = await api.fetch({ url: liveUrl(path), method: 'GET', headers: { Accept: 'application/json' }, timeout: 35000 });
  if (!r || !r.ok) throw new Error((r && (r.error || (r.status === 403 ? 'Token passt nicht' : r.status ? 'HTTP ' + r.status : ''))) || 'nicht erreichbar');
  try { return JSON.parse(r.text); } catch { throw new Error('Antwort ist kein JSON'); }
}

/* Hub (Server ohne Oberfläche): Modellwahl, Umbenennen, Löschen */
async function liveLoadModels() {
  try {
    const r = await liveReq('/models' + (LC.pick.conn ? '?conn=' + encodeURIComponent(LC.pick.conn) : ''));
    LC.models = r;
    if (!LC.pick.conn) LC.pick.conn = r.connection;
    const ids = (r.models || []).map((m) => m.id);
    if (!LC.pick.model || !ids.includes(LC.pick.model)) LC.pick.model = ids.includes(r.defaultModel) ? r.defaultModel : ids[0] || '';
    liveRenderBox();
  } catch (e) { /* Modellliste ist optional */ }
}
const livePickBody = () => (LC.hub ? { model: LC.pick.model || undefined, conn: LC.pick.conn || undefined } : {});
function liveModelPicker() {
  const r = LC.models;
  const wrap = el('div', { class: 'live-pick' });
  if ((r.connections || []).length > 1) {
    const cs = el('select', { title: 'Verbindung auf dem Hub' }, r.connections.map((c) => el('option', { value: c.id, text: c.name })));
    cs.value = LC.pick.conn;
    cs.addEventListener('change', () => { LC.pick.conn = cs.value; LC.pick.model = ''; liveLoadModels(); });
    wrap.append(cs);
  }
  const ms = el('select', { title: 'Modell für neue Nachrichten' }, (r.models || []).length ? r.models.map((m) => el('option', { value: m.id, text: m.id })) : [el('option', { value: '', text: r.error ? 'Keine Modelle (Verbindung prüfen)' : 'Keine Modelle' })]);
  ms.value = LC.pick.model;
  ms.addEventListener('change', () => { LC.pick.model = ms.value; });
  wrap.append(ms);
  return wrap;
}
async function liveRename(c) {
  const t = await promptModal('Chat umbenennen', 'Neuer Titel', c.title || '');
  if (t) livePost('/rename', { id: c.id, title: t }).catch((e) => toast('Umbenennen fehlgeschlagen: ' + e.message, 5000));
}
async function liveDelete(c) {
  if (!(await confirmModal('Chat löschen', `„${c.title || 'Chat'}“ vom Hub löschen? Das lässt sich nicht rückgängig machen.`, { okLabel: 'Löschen', danger: true }))) return;
  if (LC.viewId === c.id) liveLeaveView(true);
  livePost('/delete', { id: c.id }).catch((e) => toast('Löschen fehlgeschlagen: ' + e.message, 5000));
}

/* Fernsteuerung (nur wenn die Quelle sie erlaubt): Nachricht senden, stoppen, neuen Chat auf der Quelle beginnen */
async function livePost(path, body) {
  const r = await api.fetch({ url: liveUrl(path), method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), timeout: 15000 });
  if (!r || !r.ok) {
    let msg = r && r.error;
    try { msg = (JSON.parse(r.text) || {}).error || msg; } catch {}
    throw new Error(msg || (r && r.status ? 'HTTP ' + r.status : 'nicht erreichbar'));
  }
}
// Wird von send() aufgerufen, wenn die Live-Ansicht aktiv ist. true = behandelt.
function liveSendHook() {
  if (!(S.chat && S.chat._live)) return false;
  if (!LC.remote) { toast('Live-Ansicht: nur lesen. Die Quelle hat die Fernsteuerung nicht erlaubt (Einstellungen → Live-Ansicht auf dem anderen Gerät).', 5000); return true; }
  const ta = $('#input');
  const text = (ta.value || '').trim();
  if (!text) return true;
  ta.value = '';
  if (typeof autosize === 'function') autosize();
  livePost('/send', { id: S.chat.id, text, ...livePickBody() }).catch((e) => { ta.value = text; toast('Senden fehlgeschlagen: ' + e.message, 6000); });
  return true;
}
function liveRemoteStop() {
  if (!LC.viewing) return;
  livePost('/stop', { id: LC.viewId }).catch((e) => toast('Stopp fehlgeschlagen: ' + e.message, 5000));
}
function liveRemoteNew() {
  if (!LC.remote) return toast('Die Quelle hat die Fernsteuerung nicht erlaubt.', 4000);
  promptModal('Neuer Chat auf „' + (LC.device || 'dem anderen Gerät') + '“', 'Erste Nachricht:', '').then((t) => {
    if (!t || !t.trim()) return;
    const id = uid();
    livePost('/send', { id, text: t.trim(), create: true, ...livePickBody() })
      .then(() => { liveCfg().client.follow = true; setTimeout(() => liveOpen(id, true), 700); })
      .catch((e) => toast('Fehlgeschlagen: ' + e.message, 6000));
  });
}
/* Quelle: Befehle der Empfänger ausführen */
async function liveRunCmd(m) {
  try {
    if (!liveCfg().host.remote) return;
    const id = m.id;
    if (m.cmd === 'stop') { const R = runById(id); if (R) stopGeneration(R); return; }
    if (m.cmd !== 'send') return;
    let chat = (S.chat && S.chat.id === id && S.chat) || (runById(id) && runById(id).chat) || null;
    if (!chat) { try { chat = await api.chats.load(id); } catch { chat = null; } }
    if (!chat && m.create) chat = { id, title: m.text.split('\n')[0].slice(0, 48) || 'Neuer Chat', created: Date.now(), updated: Date.now(), connectionId: activeConn().id, model: currentModel(), messages: [] };
    if (!chat) return;
    toast('Nachricht von einem Live-Gerät: ' + m.text.slice(0, 60), 3500);
    const R = runOf(chat);
    if (R) return sendToRun(R, m.text, []); // KI arbeitet schon: Text wird als Hinweis zugestellt
    chat.messages.push({ id: uid(), role: 'user', content: m.text, files: [], ts: Date.now(), remote: true });
    chat.connectionId = chat.connectionId || activeConn().id;
    chat.model = chat.model || currentModel();
    chat.pendingContinue = false;
    if (S.chat && S.chat.id === chat.id) { S.stick = true; renderMessages(); }
    await generate(chat);
  } catch (e) { console.error('Live-Befehl:', e); toast('Live-Befehl fehlgeschlagen: ' + e.message, 5000); }
}

function liveFeed(text) {
  LC.buf += String(text).replace(/\r\n/g, '\n');
  let i;
  while ((i = LC.buf.indexOf('\n\n')) >= 0) {
    const frame = LC.buf.slice(0, i);
    LC.buf = LC.buf.slice(i + 2);
    let type = 'message', data = '';
    for (const ln of frame.split('\n')) {
      if (ln.startsWith('event:')) type = ln.slice(6).trim();
      else if (ln.startsWith('data:')) data += ln.slice(5).replace(/^ /, '');
    }
    if (!data) continue;
    let d = null;
    try { d = JSON.parse(data); } catch { continue; }
    try { liveEvent(type, d); } catch (e) { console.error('Live-Ereignis:', e); }
  }
}
function liveViewing(id) { return LC.viewing && LC.viewId === id; }
async function liveEvent(type, d) {
  if (type === 'hello') {
    LC.retry = 0; LC.device = d.device || ''; LC.remote = !!d.remote; LC.hub = !!d.hub;
    clearTimeout(LC.helloT);
    liveSetStatus('on');
    if (LC.viewing) liveUiMode(true);
    try {
      const r = await liveReq('/chats');
      LC.list = r.list || []; LC.activeId = r.active || d.active || ''; LC.remote = !!r.remote; LC.hub = !!r.hub || LC.hub;
      if (LC.hub) liveLoadModels();
    } catch (e) { liveSetStatus('retry', e.message); return; }
    liveRenderBox();
    const cfg = liveCfg().client;
    if (LC.viewing && LC.viewId) { LC.chats.delete(LC.viewId); liveOpen(LC.viewId, true); }
    else if (cfg.autoOpen && LC.activeId) liveOpen(LC.activeId, true);
  } else if (type === 'list') {
    LC.list = d.list || []; liveRenderBox();
  } else if (type === 'active') {
    LC.activeId = d.id || '';
    liveRenderBox();
    if (liveCfg().client.follow && LC.viewing && LC.activeId && LC.activeId !== LC.viewId) liveOpen(LC.activeId, true);
  } else if (type === 'busy') {
    const it = LC.list.find((x) => x.id === d.id);
    if (it) { it.running = !!d.running; liveRenderBox(); }
    if (liveViewing(d.id)) liveBanner();
  } else if (type === 'chat' && d.chat) {
    const ch = d.chat; ch._live = true;
    LC.chats.set(ch.id, ch);
    if (liveViewing(ch.id)) { S.chat = ch; liveScheduleRender(); }
  } else if (type === 'msg') {
    const ch = LC.chats.get(d.id);
    if (!ch) return;
    if (d.index >= 0 && d.index <= ch.messages.length) ch.messages[d.index] = d.message;
    if (d.title) ch.title = d.title;
    if (liveViewing(d.id)) liveScheduleRender();
    const it = LC.list.find((x) => x.id === d.id);
    if (it && d.title && it.title !== d.title) { it.title = d.title; liveRenderBox(); }
  } else if (type === 'delta') {
    const ch = LC.chats.get(d.id);
    const m = ch && ch.messages[d.index];
    if (!m) return;
    if (typeof d.c === 'string') m.content = String(m.content || '').slice(0, d.cFrom || 0) + d.c;
    if (typeof d.t === 'string') m.thinking = String(m.thinking || '').slice(0, d.tFrom || 0) + d.t;
    if (liveViewing(d.id)) liveScheduleDelta(m);
  }
}
// Ganze Liste neu aufbauen (selten: neue Nachricht, Chat-Wechsel)
function liveScheduleRender() {
  clearTimeout(LC.renderT);
  LC.renderT = setTimeout(() => { if (!LC.viewing) return; renderMessages(); renderStatus(); updateCtxMeter(); liveBanner(); }, 60);
}
// Einzelne wachsende Antwort: nur diesen Knoten aktualisieren
function liveScheduleDelta(m) {
  if (LC.rt) return;
  LC.rt = setTimeout(() => {
    LC.rt = 0;
    if (!LC.viewing) return;
    const node = m.id ? document.querySelector('#messages-inner .msg.assistant[data-mid="' + String(m.id).replace(/"/g, '') + '"]') : null;
    if (node && node._r) { renderAssistantParts(node, m, 'live'); if (S.stick) scrollBottom(); }
    else liveScheduleRender();
  }, 70);
}
async function liveOpen(id, auto) {
  if (!id) return;
  let ch = LC.chats.get(id);
  if (!ch) {
    try { ch = await liveReq('/chat?id=' + encodeURIComponent(id)); } catch (e) { if (!auto) toast('Live-Chat konnte nicht geladen werden: ' + e.message, 6000); return; }
    ch._live = true;
    LC.chats.set(id, ch);
  }
  if (!LC.viewing) { LC.prev = S.chat; parkLive(); }
  LC.viewing = true; LC.viewId = id;
  S.chat = ch; S.attachments = []; S.stick = true;
  renderAll();
  liveUiMode(true);
  liveRenderBox();
}
// Live-Ansicht verlassen. back = true: zum vorherigen eigenen Chat zurück
function liveLeaveView(back) {
  if (!LC.viewing) return false;
  LC.viewing = false; LC.viewId = '';
  liveUiMode(false);
  const prev = LC.prev && !LC.prev._live ? LC.prev : null;
  LC.prev = null;
  if (back) {
    if (prev) { S.chat = prev; renderAll(); }
    else if (typeof newChat === 'function') { S.chat = null; newChat(); }
  } else S.chat = prev; // der Aufrufer (openChat/newChat) setzt S.chat gleich neu
  liveRenderBox();
  return true;
}
const liveLeave = () => liveLeaveView(false);

/* ───── Oberfläche ───── */
function liveUiMode(on) {
  const ta = $('#input');
  const ro = !!on && !LC.remote;
  if (ta) { ta.disabled = ro; if (on && !ta.dataset.ph) ta.dataset.ph = ta.placeholder; if (on) ta.placeholder = LC.remote ? 'An das andere Gerät senden …' : 'Live-Ansicht: nur lesen'; else if (ta.dataset.ph) { ta.placeholder = ta.dataset.ph; delete ta.dataset.ph; } }
  const ms = $('#messages');
  if (ms) ms.classList.toggle('live-view', !!on);
  const cw = $('#composer-wrap');
  if (cw) cw.classList.toggle('live-ro', ro);
  liveBanner();
}
function liveBanner() {
  let b = $('#live-banner');
  if (!LC.viewing) { if (b) b.remove(); return; }
  if (!b) { b = el('div', { id: 'live-banner', class: 'live-banner' }); const c = $('#composer'); if (c) c.prepend(b); }
  const it = LC.list.find((x) => x.id === LC.viewId);
  b.innerHTML = '';
  b.append(
    el('span', { class: 'live-dot' + (it && it.running ? ' run' : '') }),
    el('span', { class: 'live-txt', text: `${LC.hub ? 'Hub' : 'Live von'} „${LC.device || 'anderem Gerät'}“${it && it.running ? ' · KI arbeitet gerade' : ''} · ${LC.hub ? 'Antwort läuft auf dem Server' : LC.remote ? 'Fernsteuerung aktiv' : 'nur lesen'}` }),
    LC.remote && it && it.running ? el('button', { class: 'btn sm danger', text: 'Stopp', onclick: liveRemoteStop }) : null,
    el('button', { class: 'btn sm', text: 'Eigener Chat', onclick: () => liveLeaveView(true) })
  );
}
function liveRenderBox() {
  const box = $('#live-box');
  if (!box) return;
  const cfg = liveCfg().client;
  const show = !!(cfg.url && (cfg.enabled || LC.status !== 'off'));
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const label = { off: 'Getrennt', connecting: 'Verbinde …', on: 'Verbunden', retry: 'Verbindung wird erneuert …', error: 'Fehler' }[LC.status] || '';
  box.innerHTML = '';
  box.append(el('div', { class: 'live-head', title: LC.msg || '' },
    el('span', { class: 'live-dot st-' + LC.status }),
    el('b', { text: (LC.hub ? 'Hub' : 'Live') + (LC.device ? ' · ' + LC.device : '') }),
    el('span', { class: 'live-st', text: label }),
    LC.status === 'on' ? null : el('button', { class: 'mini-btn', title: 'Neu verbinden', html: icon('refresh', 13), onclick: () => liveConnect() })));
  if (LC.status === 'error' && LC.msg) box.append(el('div', { class: 'live-err', text: LC.msg }));
  if (LC.status === 'on') {
    if (LC.hub && LC.models) box.append(liveModelPicker());
    const list = el('div', { class: 'live-list' });
    if (!LC.list.length) list.append(el('div', { class: 'live-empty', text: 'Auf dem anderen Gerät gibt es noch keine Chats.' }));
    for (const c of LC.list.slice(0, 30)) {
      list.append(el('div', { class: 'live-item' + (LC.viewId === c.id && LC.viewing ? ' active' : '') + (c.id === LC.activeId ? ' current' : ''), role: 'button', tabindex: '0', title: c.id === LC.activeId ? 'Dort gerade geöffnet' : '', onclick: () => liveOpen(c.id) },
        el('span', { class: 'live-dot' + (c.running ? ' run' : '') }), el('span', { class: 't', text: c.title || 'Chat' }),
        LC.hub ? el('span', { class: 'acts' },
          el('button', { class: 'mini-btn', title: 'Umbenennen', html: icon('edit', 13), onclick: (e) => { e.stopPropagation(); liveRename(c); } }),
          el('button', { class: 'mini-btn', title: 'Löschen', html: icon('trash', 13), onclick: (e) => { e.stopPropagation(); liveDelete(c); } })) : null));
    }
    box.append(list);
    if (LC.remote) box.append(el('button', { class: 'hint-btn live-new', text: '+ Neuer Chat auf ' + (LC.device || 'dem Gerät'), onclick: liveRemoteNew }));
  }
}
function liveInit() {
  const list = $('#chat-list');
  if (list && !$('#live-box')) { const b = el('div', { id: 'live-box', class: 'live-box hidden' }); list.before(b); }
  if (liveCanHost()) {
    api.live.onResync(() => livePubReset());
    if (api.live.onCmd) api.live.onCmd((m) => liveRunCmd(m));
    if (liveCfg().host.enabled) liveHostApply().catch((e) => toast('Live-Quelle konnte nicht starten: ' + (e && e.message || e), 7000));
  }
  const c = liveCfg().client;
  if (c.enabled && c.url) liveConnect();
  window.addEventListener('beforeunload', () => liveDisconnect(true));
}

/* ───── Einstellungen ───── */
function liveSwitch(get, set) {
  const i = el('input', { type: 'checkbox' });
  i.checked = !!get();
  i.addEventListener('change', () => set(i.checked));
  return el('label', { class: 'switch' }, i, el('span'));
}
function tabLive() {
  const wrap = el('div');
  const cfg = liveCfg();
  const stLine = el('div', { class: 'fhint' });
  const hostBox = el('div');
  async function renderHost() {
    hostBox.innerHTML = '';
    if (!liveCanHost()) return;
    const h = cfg.host;
    let s = null;
    try { s = await api.live.status(); } catch {}
    hostBox.append(
      el('h3', { text: 'Dieses Gerät als Live-Quelle' }),
      frow('Live-Quelle anbieten', 'Andere Geräte im selben WLAN (Handy, zweiter PC) können die Chats dieses Rechners in Echtzeit mitlesen, auch während die KI schreibt. Standard: aus.', liveSwitch(() => h.enabled, async (v) => {
        h.enabled = v; changed();
        try { await liveHostApply(); } catch (e) { toast('Fehlgeschlagen: ' + (e && e.message || e), 7000); }
        renderHost();
      })),
      frow('Fernsteuerung erlauben', 'Empfänger dürfen Nachrichten an die KI dieses Rechners senden, neue Chats beginnen und die KI stoppen. Achtung: Die KI arbeitet dann mit deinen Workspace-Rechten. Ist „Nichts bestätigen“ gewählt, laufen Datei-Aktionen und Befehle ohne Rückfrage. Standard: aus.', liveSwitch(() => h.remote, async (v) => {
        h.remote = !!v; changed();
        try { await api.live.config({ remote: h.remote }); } catch {}
        renderHost();
      })),
      frow('Port', 'Wird der Port belegt, nimmt die App automatisch einen freien. Die Windows-Firewall fragt beim ersten Start nach der Freigabe für private Netzwerke.', bindNumber('live.host.port', { min: 1024, max: 65535, placeholder: '45460' }))
    );
    if (s && s.running) {
      const urls = s.urls || [];
      const first = urls[0];
      hostBox.append(el('div', { class: 'fhint', text: `Läuft auf Port ${s.port} · ${s.clients} Gerät${s.clients === 1 ? '' : 'e'} verbunden.` }));
      if (first) {
        const q = el('div', { class: 'tr-qr' });
        try { q.innerHTML = qrSvg(first); } catch { q.textContent = '(QR nicht möglich)'; }
        hostBox.append(q, el('div', { class: 'tr-qr-label', text: 'In der Android-App: Einstellungen → Live-Ansicht → QR-Code scannen' }));
      }
      for (const u of urls) hostBox.append(el('div', { class: 'tr-url' }, el('code', { text: u }), el('button', { class: 'btn sm', text: 'Kopieren', onclick: () => { copyText(u); toast('Adresse kopiert.'); } })));
      hostBox.append(
        el('div', { class: 'tr-warn', text: 'Die Adresse enthält einen geheimen Schlüssel. Wer sie hat, kann deine Chats mitlesen (inklusive Datei-Inhalten). Nur im eigenen Netz verwenden.' }),
        el('div', { class: 'frow' }, el('button', { class: 'btn sm', text: 'Neuen Schlüssel erzeugen', onclick: async () => { if (await confirmModal('Neuen Schlüssel erzeugen', 'Bereits verbundene Geräte werden getrennt und brauchen die neue Adresse.', { okLabel: 'Erzeugen' })) { await api.live.start({ port: h.port, regenToken: true }); renderHost(); } } }), el('button', { class: 'btn sm', text: 'Aktualisieren', onclick: renderHost }))
      );
    }
  }
  const urlIn = el('input', { type: 'text', value: cfg.client.url || '', placeholder: 'http://192.0.2.1.20:45460/llmbox-live?t=…', style: { width: '100%' } });
  urlIn.addEventListener('input', () => { cfg.client.url = urlIn.value.trim(); changed(); });
  const btnConn = el('button', { class: 'btn sm primary', text: 'Verbinden' });
  const btnDis = el('button', { class: 'btn sm', text: 'Trennen' });
  btnConn.addEventListener('click', () => { cfg.client.enabled = true; changed(); liveConnect(); });
  btnDis.addEventListener('click', () => { cfg.client.enabled = false; changed(); liveDisconnect(false); });
  const btnScan = window.IS_ANDROID && typeof qrScannenAndroid === 'function' ? el('button', { class: 'btn sm', text: 'QR-Code scannen …', onclick: async () => { try { await qrScannenAndroid(); urlIn.value = cfg.client.url || ''; } catch (e) { toast('Scannen fehlgeschlagen: ' + e.message, 6000); } } }) : null;
  const refresh = () => {
    const t = { off: 'Nicht verbunden.', connecting: 'Verbinde …', on: `Verbunden mit „${LC.device || '?'}“.`, retry: 'Verbindung verloren, neuer Versuch …' + (LC.msg ? ' (' + LC.msg + ')' : ''), error: LC.msg || 'Fehler.' }[LC.status];
    stLine.textContent = t;
  };
  LIVE_TAB_REFRESH.fn = () => { if (!wrap.isConnected) { LIVE_TAB_REFRESH.fn = null; return; } refresh(); };
  refresh();
  wrap.append(
    el('div', { class: 'fhint', text: 'Zeigt Chats eines anderen Geräts in Echtzeit, ähnlich wie Open WebUI denselben Chat in mehreren Fenstern. Die Quelle (Windows) bietet ihre Chats an, der Empfänger (Windows oder Android) zeigt sie schreibgeschützt an.' }),
    el('h3', { text: 'Live-Ansicht empfangen' }),
    frow('Adresse der Quelle', 'Auf dem Quell-Rechner unter Einstellungen → Live-Ansicht kopieren' + (window.IS_ANDROID ? ' oder den QR-Code scannen.' : '.'), el('div', { class: 'row-gap', style: { flex: 1 } }, urlIn, btnScan, btnConn, btnDis), true),
    frow('Status', null, stLine),
    frow('Beim Start automatisch verbinden', null, liveSwitch(() => cfg.client.enabled, (v) => { cfg.client.enabled = v; changed(); })),
    frow('Aktiven Chat automatisch anzeigen', 'Wechselt die Quelle den Chat, folgt die Anzeige. Gilt, solange du in der Live-Ansicht bist.', liveSwitch(() => cfg.client.follow, (v) => { cfg.client.follow = v; changed(); })),
    frow('Beim Verbinden gleich den aktiven Chat öffnen', 'Praktisch für das Handy als zweiter Bildschirm.', liveSwitch(() => cfg.client.autoOpen, (v) => { cfg.client.autoOpen = v; changed(); })),
    hostBox
  );
  renderHost();
  return wrap;
}
