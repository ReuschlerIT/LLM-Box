#!/usr/bin/env node
'use strict';
/* ═════════════ LLM Box Hub ═════════════
   Läuft ohne Oberfläche auf Linux oder Windows (Node.js 18 oder neuer, keine weiteren Pakete).
   Der Hub speichert die Chats, ruft die Modelle auf (lokal, z. B. Strata auf demselben Rechner, oder Cloud mit Schlüsseln,
   die nur hier liegen) und verteilt jede Änderung in Echtzeit an alle verbundenen Geräte (Windows, Android).
   Die Antwort läuft auf dem Hub weiter, auch wenn Handy oder PC ausgehen.
   Protokoll = das der Live-Ansicht (docs/LIVE-ANSICHT.md) plus /models, /delete, /rename. Start:  node hub.js   */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

if (typeof fetch !== 'function') { console.error('Node.js 18 oder neuer wird benötigt (eingebautes fetch).'); process.exit(1); }

/* ───── Gegenstück zur Schnittstelle der Desktop-App (api.fetch / api.stream / api.abort), damit llm.js unverändert läuft ───── */
const aborts = new Map();
globalThis.api = {
  async fetch(req) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), req.timeout || 15000);
    try {
      const res = await fetch(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body, signal: ac.signal });
      return { ok: res.ok, status: res.status, text: await res.text() };
    } catch (err) {
      const code = err.cause && (err.cause.code || err.cause.message);
      return { ok: false, status: 0, error: err.name === 'AbortError' ? 'Zeitüberschreitung' : `${err.message}${code ? ' (' + code + ')' : ''}` };
    } finally { clearTimeout(timer); }
  },
  async stream(req, cb) {
    const ac = new AbortController();
    aborts.set(req.id, ac);
    (async () => {
      try {
        const res = await fetch(req.url, { method: req.method || 'POST', headers: req.headers, body: req.body, signal: ac.signal });
        if (!res.ok) { cb({ type: 'error', status: res.status, message: (await res.text()).slice(0, 4000) }); return; }
        const dec = new TextDecoder();
        for await (const chunk of res.body) cb({ type: 'data', text: dec.decode(chunk, { stream: true }) });
        cb({ type: 'end' });
      } catch (err) {
        if (err.name === 'AbortError') cb({ type: 'end', aborted: true });
        else { const code = err.cause && (err.cause.code || err.cause.message); cb({ type: 'error', status: 0, message: `${err.message}${code ? ' (' + code + ')' : ''}` }); }
      } finally { aborts.delete(req.id); }
    })();
    return true;
  },
  abort(id) { const ac = aborts.get(id); if (ac) ac.abort(); return true; },
};
let LLM;
for (const p of ['../renderer/js/llm.js', './llm.js']) { try { LLM = require(p); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } }
if (!LLM) { console.error('llm.js nicht gefunden. Der Hub braucht renderer/js/llm.js (oder eine Kopie neben hub.js).'); process.exit(1); }

/* ───── Einstellungen ───── */
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const DATA = path.resolve(arg('--data') || process.env.LLMBOX_HUB_DATA || path.join(os.homedir(), '.llm-box-hub'));
const CHATS = path.join(DATA, 'chats');
const CFG_FILE = path.join(DATA, 'config.json');
fs.mkdirSync(CHATS, { recursive: true });
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const DEFAULT_CFG = () => ({
  token: crypto.randomBytes(18).toString('base64url'),
  host: '0.0.0.0',
  port: 45470,
  device: os.hostname() || 'LLM-Box-Hub',
  connections: [{ id: 'strata_api', name: 'Strata_API', type: 'openai', baseUrl: 'http://localhost:8080/v1', apiKey: '', extraParams: true, thinkMode: 'template' }],
  defaultConnection: 'strata_api',
  defaultModel: '',
  systemPrompt: 'Du bist ein hilfreicher, präziser Assistent. Antworte auf Deutsch, außer der Nutzer schreibt in einer anderen Sprache.',
  thinking: 'auto',
  params: { temperature: 0.7, topP: 0.95, maxTokens: 0 },
});
function loadCfg() {
  let c = null;
  try { c = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch {}
  const d = DEFAULT_CFG();
  if (!c) { c = d; saveCfg(c); console.log('Neue Konfiguration angelegt: ' + CFG_FILE); }
  for (const k of Object.keys(d)) if (c[k] === undefined) c[k] = d[k];
  return c;
}
function saveCfg(c) { fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 }); }
const cfg = loadCfg();
try { fs.chmodSync(CFG_FILE, 0o600); } catch {}

/* ───── Befehlszeilen-Hilfen ───── */
if (process.argv.includes('--add-connection')) {
  // node hub.js --add-connection <Name> <openai|ollama|anthropic> <Adresse> [Schlüssel]
  const i = process.argv.indexOf('--add-connection');
  const [name, type, baseUrl, apiKey] = process.argv.slice(i + 1);
  if (!name || !type || !baseUrl) { console.error('Aufruf: node hub.js --add-connection <Name> <openai|ollama|anthropic> <Adresse> [Schlüssel]'); process.exit(1); }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  cfg.connections = cfg.connections.filter((c) => c.id !== id);
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test((() => { try { return new URL(baseUrl).hostname; } catch { return ''; } })());
  // Lokale Server (Strata, llama.cpp …) bekommen die Parameter der App, Cloud-Dienste entscheiden selbst (viele lehnen Temperatur/Top-K bei neuen Modellen ab)
  const conn = { id, name, type, baseUrl, apiKey: apiKey || '', extraParams: type === 'openai' && local, thinkMode: type === 'anthropic' ? 'adaptive' : 'template' };
  if (!local) conn.samplingMode = 'server';
  cfg.connections.push(conn);
  saveCfg(cfg);
  console.log('Verbindung gespeichert: ' + name);
  process.exit(0);
}
if (process.argv.includes('--set-default')) {
  // node hub.js --set-default <Verbindungs-ID> [Modell]
  const i = process.argv.indexOf('--set-default');
  const [cid, model] = process.argv.slice(i + 1);
  if (!cfg.connections.some((c) => c.id === cid)) { console.error('Unbekannte Verbindung. Vorhanden: ' + cfg.connections.map((c) => c.id).join(', ')); process.exit(1); }
  cfg.defaultConnection = cid; if (model) cfg.defaultModel = model;
  saveCfg(cfg);
  console.log('Standard gesetzt: ' + cid + (model ? ' / ' + model : ''));
  process.exit(0);
}
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${cfg.port}/llmbox-live?t=${cfg.token}`);
  return out.length ? out : [`http://localhost:${cfg.port}/llmbox-live?t=${cfg.token}`];
}
if (process.argv.includes('--show')) { console.log('Adresse für die App (Einstellungen → Live-Ansicht):\n' + lanUrls().join('\n')); process.exit(0); }

/* ───── Chat-Speicher ───── */
const safeId = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
const chatFile = (id) => path.join(CHATS, safeId(id) + '.json');
const chats = new Map(); // id -> Chat-Objekt im Speicher
async function loadAll() {
  for (const f of await fsp.readdir(CHATS)) {
    if (!f.endsWith('.json')) continue;
    try { const c = JSON.parse(await fsp.readFile(path.join(CHATS, f), 'utf8')); if (c && c.id && Array.isArray(c.messages)) chats.set(c.id, c); } catch {}
  }
}
const pendingSave = new Map();
function saveChat(c, now) {
  const write = async () => {
    pendingSave.delete(c.id);
    const tmp = chatFile(c.id) + '.tmp';
    try { await fsp.writeFile(tmp, JSON.stringify(c)); await fsp.rename(tmp, chatFile(c.id)); } catch (e) { console.error('Speichern fehlgeschlagen:', e.message); }
  };
  if (now) { clearTimeout(pendingSave.get(c.id)); return write(); }
  if (!pendingSave.has(c.id)) pendingSave.set(c.id, setTimeout(write, 1500));
}
const listOf = () => [...chats.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 300).map((c) => ({ id: c.id, title: c.title, updated: c.updated, model: c.model, running: RUNS.has(c.id) }));
const latestId = () => (listOf()[0] || {}).id || '';

/* ───── Ereignisse: Strom (SSE) und Long-Polling ───── */
const live = { clients: new Set(), seq: 0, log: [], waiters: new Set(), pollers: new Map() };
const sseSend = (res, type, data, id) => { try { res.write(`${id ? 'id: ' + id + '\n' : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
function emit(type, data) {
  live.seq++;
  live.log.push({ seq: live.seq, type, data: { type, ...data } });
  if (live.log.length > 800) live.log.splice(0, live.log.length - 800);
  for (const res of live.clients) sseSend(res, type, { type, ...data }, live.seq);
  for (const w of [...live.waiters]) {
    const ev = live.log.filter((e) => e.seq > w.since);
    if (!ev.length) continue;
    clearTimeout(w.timer); live.waiters.delete(w);
    try { w.res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); w.res.end(JSON.stringify({ seq: live.seq, events: ev })); } catch {}
  }
}
const emitList = () => emit('list', { list: listOf() });
const helloData = () => ({ app: 'LLM Box Hub', hub: true, version: '1', device: cfg.device, active: latestId(), remote: true, seq: live.seq });
const sanitizeMsg = (m) => m; // Der Hub schickt Chats vollständig (er ist die Quelle der Wahrheit)

/* ───── Modelle und Antworten ───── */
const RUNS = new Map(); // chatId -> { stream, stopped }
const connById = (id) => cfg.connections.find((c) => c.id === id) || cfg.connections.find((c) => c.id === cfg.defaultConnection) || cfg.connections[0];
const modelCache = new Map();
async function modelsOf(conn) {
  const hit = modelCache.get(conn.id);
  if (hit && Date.now() - hit.t < 30000) return hit.list;
  const list = await LLM.listModels(conn);
  modelCache.set(conn.id, { t: Date.now(), list });
  return list;
}
function ctxMessages(chat, upto) {
  const start = Math.max(0, +chat.ctxStart || 0);
  return chat.messages.slice(start, upto).filter((m) => m.role === 'user' || m.role === 'assistant');
}
async function runChat(chat, { model, connId } = {}) {
  if (RUNS.has(chat.id)) return;
  const conn = connById(connId || chat.connectionId);
  const run = { stream: null, stopped: false };
  RUNS.set(chat.id, run);
  emit('busy', { id: chat.id, running: true });
  emitList();
  let am = null;
  try {
    let useModel = model || chat.model || cfg.defaultModel;
    if (!useModel) { const l = await modelsOf(conn); useModel = l[0] && l[0].id; }
    if (!useModel) throw new Error('Kein Modell gewählt und keines gefunden. Prüfe die Verbindung „' + conn.name + '“ (Adresse und Schlüssel).');
    chat.model = useModel; chat.connectionId = conn.id;
    am = { id: uid(), role: 'assistant', content: '', thinking: '', model: useModel, ts: Date.now(), toolCalls: [] };
    chat.messages.push(am);
    const idx = chat.messages.length - 1;
    emit('msg', { id: chat.id, index: idx, message: am, title: chat.title });
    let sentC = 0, sentT = 0, timer = null;
    const flush = () => {
      timer = null;
      const d = { id: chat.id, index: idx };
      const c = String(am.content || ''), t = String(am.thinking || '');
      if (c.length < sentC || t.length < sentT) { emit('msg', { id: chat.id, index: idx, message: am, title: chat.title }); sentC = c.length; sentT = t.length; return; }
      if (c.length > sentC) { d.cFrom = sentC; d.c = c.slice(sentC); sentC = c.length; }
      if (t.length > sentT) { d.tFrom = sentT; d.t = t.slice(sentT); sentT = t.length; }
      if (d.c !== undefined || d.t !== undefined) emit('delta', d);
    };
    const schedule = () => { if (!timer) timer = setTimeout(flush, 70); };
    const system = (cfg.systemPrompt || '').trim();
    const s = LLM.streamChat({
      conn, model: useModel, system, messages: ctxMessages(chat, idx), params: cfg.params || {}, tools: null, thinkLevel: cfg.thinking || 'auto',
      handlers: { onContent: (full) => { am.content = full; schedule(); }, onThinking: (t) => { am.thinking = t; schedule(); }, onImages: (imgs) => { am.images = imgs; schedule(); } },
    });
    run.stream = s;
    let res = null;
    try { res = await s.promise; } catch (e) { am.error = e && e.message ? e.message : String(e); }
    if (timer) { clearTimeout(timer); timer = null; }
    if (res) {
      am.content = res.content; am.thinking = res.thinking; am.stats = res.stats; am.finish = res.finishReason;
      if (res.images && res.images.length) am.images = res.images;
      if (res.aborted || run.stopped) am.aborted = true;
      const sp = LLM.splitThink(am.content);
      if (sp.think) { am.thinking = [am.thinking, sp.think].filter(Boolean).join('\n'); am.content = sp.answer; }
      if (!am.content && !am.aborted && !(am.images && am.images.length)) am.error = am.thinking ? 'Das Modell hat nur nachgedacht, aber keine Antwort geliefert.' : 'Das Modell hat keine Antwort geliefert.';
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (am) am.error = msg; else { chat.messages.push({ id: uid(), role: 'assistant', content: '', thinking: '', model: model || '', ts: Date.now(), toolCalls: [], error: msg }); am = chat.messages[chat.messages.length - 1]; }
  } finally {
    chat.updated = Date.now();
    RUNS.delete(chat.id);
    if (am) emit('msg', { id: chat.id, index: chat.messages.indexOf(am), message: am, title: chat.title });
    emit('busy', { id: chat.id, running: false });
    emitList();
    saveChat(chat, true);
  }
}
function titleOf(text) { return String(text || '').split('\n')[0].trim().slice(0, 48) || 'Neuer Chat'; }
async function handleSend({ id, text, create, model, conn }) {
  id = safeId(id);
  let chat = chats.get(id);
  if (!chat) {
    if (!create) throw Object.assign(new Error('Chat nicht gefunden'), { code: 404 });
    chat = { id, title: titleOf(text), created: Date.now(), updated: Date.now(), model: '', connectionId: '', messages: [] };
    chats.set(id, chat);
  }
  if (RUNS.has(id)) throw Object.assign(new Error('Die KI arbeitet in diesem Chat gerade. Bitte warten oder stoppen.'), { code: 409 });
  const um = { id: uid(), role: 'user', content: String(text), files: [], ts: Date.now() };
  chat.messages.push(um);
  chat.updated = Date.now();
  if (chat.messages.length === 1) chat.title = titleOf(text);
  if (create) emit('chat', { chat });
  else emit('msg', { id, index: chat.messages.length - 1, message: um, title: chat.title });
  saveChat(chat, true);
  runChat(chat, { model, connId: conn }).catch((e) => console.error('Lauf fehlgeschlagen:', e));
}

/* ───── HTTP ───── */
const fails = new Map(); // IP -> { n, until }
function blocked(ip) { const f = fails.get(ip); return f && f.until > Date.now(); }
function noteFail(ip) { const f = fails.get(ip) || { n: 0, until: 0 }; f.n++; if (f.n >= 20) { f.until = Date.now() + 600000; f.n = 0; } fails.set(ip, f); }
const tokOk = (given) => { const a = Buffer.from(String(given || '')), b = Buffer.from(cfg.token); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const PATH = '/llmbox-live';
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  const u = new URL(req.url || '/', 'http://localhost');
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (!u.pathname.startsWith(PATH)) { res.writeHead(404); res.end(); return; }
  if (blocked(ip)) return json(429, { error: 'Zu viele Fehlversuche. Bitte später erneut.' });
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  const given = u.searchParams.get('t') || (bearer && bearer[1]) || '';
  if (!tokOk(given)) { noteFail(ip); res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Token passt nicht'); return; }
  const sub = u.pathname.slice(PATH.length) || '/';
  try {
    if (sub === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': ok\n\n');
      live.clients.add(res);
      req.on('close', () => live.clients.delete(res));
      sseSend(res, 'hello', helloData(), live.seq);
      return;
    }
    if (sub === '/poll') {
      const since = parseInt(u.searchParams.get('since') || '-1', 10);
      live.pollers.set(given.slice(0, 4) + ip, Date.now());
      if (since < 0 || (live.log.length && since < live.log[0].seq - 1) || since > live.seq) return json(200, { seq: live.seq, reset: true, events: [{ seq: live.seq, type: 'hello', data: helloData() }] });
      const ev = live.log.filter((e) => e.seq > since);
      if (ev.length) return json(200, { seq: live.seq, events: ev });
      const w = { res, since, timer: null };
      w.timer = setTimeout(() => { live.waiters.delete(w); try { json(200, { seq: live.seq, events: [] }); } catch {} }, 20000);
      live.waiters.add(w);
      req.on('close', () => { clearTimeout(w.timer); live.waiters.delete(w); });
      return;
    }
    if (sub === '/chats') return json(200, { device: cfg.device, hub: true, active: latestId(), remote: true, list: listOf() });
    if (sub === '/chat') { const c = chats.get(safeId(u.searchParams.get('id'))); return c ? json(200, c) : json(404, { error: 'Chat nicht gefunden' }); }
    if (sub === '/models') {
      const conn = connById(u.searchParams.get('conn') || '');
      let models = [], error = '';
      try { models = (await modelsOf(conn)).map((m) => ({ id: m.id })); } catch (e) { error = e.message; }
      return json(200, { connections: cfg.connections.map((c) => ({ id: c.id, name: c.name, type: c.type })), connection: conn.id, defaultModel: cfg.defaultModel || '', models, error });
    }
    if (sub === '/' || sub === '') return json(200, { app: 'LLM Box Hub', device: cfg.device });
    if (['/send', '/stop', '/delete', '/rename'].includes(sub)) {
      if (req.method !== 'POST') return json(405, { error: 'POST erwartet' });
      let body = '';
      for await (const ch of req) { body += ch; if (body.length > 400000) return json(413, { error: 'Zu groß' }); }
      let o = {};
      try { o = JSON.parse(body || '{}'); } catch { return json(400, { error: 'Kein JSON' }); }
      const id = safeId(o.id);
      if (!id) return json(400, { error: 'id fehlt' });
      if (sub === '/send') {
        if (!String(o.text || '').trim()) return json(400, { error: 'text fehlt' });
        await handleSend({ id, text: o.text, create: !!o.create, model: o.model ? String(o.model) : '', conn: o.conn ? String(o.conn) : '' });
        return json(200, { ok: true });
      }
      if (sub === '/stop') { const r = RUNS.get(id); if (r) { r.stopped = true; try { r.stream && r.stream.abort(); } catch {} } return json(200, { ok: true }); }
      if (sub === '/delete') {
        const r = RUNS.get(id); if (r) { r.stopped = true; try { r.stream && r.stream.abort(); } catch {} }
        chats.delete(id); try { await fsp.unlink(chatFile(id)); } catch {}
        emitList();
        return json(200, { ok: true });
      }
      if (sub === '/rename') {
        const c = chats.get(id); if (!c) return json(404, { error: 'Chat nicht gefunden' });
        c.title = String(o.title || '').trim().slice(0, 120) || c.title; saveChat(c, true); emitList();
        return json(200, { ok: true });
      }
    }
    res.writeHead(404); res.end();
  } catch (e) { try { json(e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: String((e && e.message) || e) }); } catch {} }
});
setInterval(() => { for (const res of live.clients) { try { res.write(': hb\n\n'); } catch {} } }, 15000).unref();

(async () => {
  await loadAll();
  server.listen(cfg.port, cfg.host, () => {
    console.log(`LLM Box Hub läuft: ${chats.size} Chats, Daten in ${DATA}`);
    console.log('Adresse für die App (Einstellungen → Live-Ansicht → Adresse der Quelle):\n  ' + lanUrls().join('\n  '));
    console.log('Verbindungen: ' + cfg.connections.map((c) => c.name + ' (' + c.type + ')').join(', ') + ' · Standard: ' + cfg.defaultConnection);
  });
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${cfg.port} ist belegt. Ändere "port" in ${CFG_FILE}.` : e.message); process.exit(1); });
  const stop = async () => { for (const c of chats.values()) await saveChat(c, true); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})();
