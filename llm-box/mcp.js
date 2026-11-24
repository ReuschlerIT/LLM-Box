'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   mcp.js  –  MCP-Client für die LLM Box (Version 1.0.86), läuft im Hauptprozess

   MCP (Model Context Protocol) verbindet ein Sprachmodell mit externen Werkzeugen. Dieser Client unterstützt:
     - stdio: Die Box startet ein lokales Programm (z. B. „rea mcp“, „npx -y <paket>“) und spricht JSON-RPC 2.0 über dessen Standard-Ein-/Ausgabe
       (eine JSON-Nachricht pro Zeile).
     - Streamable HTTP: JSON-RPC per POST an eine Adresse; die Antwort ist JSON oder ein SSE-Strom; Sitzungskennung im Header Mcp-Session-Id.
   Mehrere Server laufen gleichzeitig (McpManager). Genutzt werden nur Werkzeuge (tools/list, tools/call). Fähigkeiten, die die Box nicht
   anbietet (sampling, roots, elicitation), werden gar nicht erst angekündigt; ping wird beantwortet.
   Dieses Modul hängt nicht von Electron ab und lässt sich allein mit Node testen.
   ══════════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const EventEmitter = require('events');

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'llm-box', version: '1.0.86' };
const MAX_STDERR = 8000;          // letzte Zeichen der Fehlerausgabe, die für die Anzeige behalten werden
const MAX_LINE = 64 * 1024 * 1024; // Schutz vor endlosen Zeilen

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Windows: .cmd-Dateien (npx, npm) brauchen eine Shell; dann müssen Argumente selbst angeführt werden */
const winQuote = (s) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(s) ? s : '"' + String(s).replace(/"/g, '\\"') + '"');

/* ───────────────────────── stdio ───────────────────────── */
class StdioTransport {
  constructor(cfg, handlers) {
    this.cfg = cfg;
    this.h = handlers;             // { message, close, stderr }
    this.proc = null;
    this.buf = '';
    this.closed = false;
  }
  start() {
    const c = this.cfg;
    if (!c.command || !String(c.command).trim()) throw new Error('Kein Programm eingetragen.');
    const win = process.platform === 'win32';
    const env = { ...process.env, ...(c.env || {}) };
    const args = Array.isArray(c.args) ? c.args.map(String) : [];
    const opts = { cwd: c.cwd || undefined, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
    let proc;
    if (win) proc = spawn([c.command, ...args].map(winQuote).join(' '), [], { ...opts, shell: true });
    else proc = spawn(c.command, args, opts);
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => this._data(d));
    proc.stderr.on('data', (d) => this.h.stderr && this.h.stderr(d));
    proc.on('error', (e) => this._end(e.code === 'ENOENT' ? new Error(`Programm „${c.command}“ nicht gefunden. Ist es installiert und im PATH?`) : e));
    proc.on('exit', (code, sig) => this._end(new Error(`Server beendet (${sig ? 'Signal ' + sig : 'Code ' + code}).`)));
    proc.stdin.on('error', () => { /* Server hat die Pipe geschlossen: exit meldet das */ });
  }
  _data(d) {
    this.buf += d;
    if (this.buf.length > MAX_LINE) { this.buf = ''; return; }
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { if (this.h.stderr) this.h.stderr('[stdout, kein JSON] ' + line.slice(0, 300) + '\n'); continue; }
      this.h.message(m);
    }
  }
  async send(msg) {
    if (this.closed || !this.proc || !this.proc.stdin.writable) throw new Error('Server ist nicht mehr erreichbar.');
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }
  _end(err) {
    if (this.closed) return;
    this.closed = true;
    this.h.close(err);
  }
  close() {
    if (!this.proc) return;
    const p = this.proc;
    this.closed = true;
    try { p.stdin.end(); } catch { /* ignorieren */ }
    const kill = () => { try { if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); else p.kill('SIGTERM'); } catch { /* ignorieren */ } };
    setTimeout(kill, 300);
    setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignorieren */ } }, 3000).unref();
  }
}

/* ───────────────────────── Streamable HTTP ───────────────────────── */
class HttpTransport {
  constructor(cfg, handlers) {
    this.cfg = cfg;
    this.h = handlers;
    this.sessionId = '';
    this.protocol = PROTOCOL_VERSION;
    this.closed = false;
    this.aborts = new Set();
  }
  start() {
    let u;
    try { u = new URL(this.cfg.url); } catch { throw new Error('Ungültige Adresse.'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Die Adresse muss mit http:// oder https:// beginnen.');
  }
  setProtocol(v) { if (v) this.protocol = v; }
  async send(msg) {
    if (this.closed) throw new Error('Verbindung ist geschlossen.');
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.cfg.headers || {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (msg.method !== 'initialize') headers['MCP-Protocol-Version'] = this.protocol;
    const ac = new AbortController();
    this.aborts.add(ac);
    try {
      let res;
      try { res = await fetch(this.cfg.url, { method: 'POST', headers, body: JSON.stringify(msg), signal: ac.signal }); } catch (e) {
        const code = e && e.cause && (e.cause.code || e.cause.message);
        throw new Error(`Adresse nicht erreichbar${code ? ' (' + code + ')' : ''}: ${this.cfg.url}`);
      }
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (res.status === 202 || res.status === 204) { try { await res.arrayBuffer(); } catch { /* leer */ } return; }
      if (!res.ok) {
        let t = '';
        try { t = (await res.text()).slice(0, 300); } catch { /* ignorieren */ }
        const e = new Error(`HTTP ${res.status}${t ? ': ' + t : ''}`);
        e.status = res.status;
        throw e;
      }
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (type.includes('text/event-stream')) await this._sse(res);
      else {
        const txt = await res.text();
        if (!txt.trim()) return;
        const j = JSON.parse(txt);
        for (const m of Array.isArray(j) ? j : [j]) this.h.message(m);
      }
    } finally {
      this.aborts.delete(ac);
    }
  }
  async _sse(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let data = [];
    const flush = () => {
      if (!data.length) return;
      const s = data.join('\n');
      data = [];
      try { this.h.message(JSON.parse(s)); } catch { /* kein JSON: ignorieren */ }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
        if (line === '') flush();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    flush();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const a of this.aborts) { try { a.abort(); } catch { /* ignorieren */ } }
    if (this.sessionId) {
      const headers = { 'Mcp-Session-Id': this.sessionId, ...(this.cfg.headers || {}) };
      fetch(this.cfg.url, { method: 'DELETE', headers }).catch(() => {});
    }
  }
}

/* ───────────────────────── Client (ein Server) ───────────────────────── */
class McpClient extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.id = cfg.id;
    this.name = cfg.name || cfg.id;
    this.status = 'idle';       // idle | starting | ready | error | stopped
    this.error = '';
    this.tools = [];
    this.serverInfo = null;
    this.capabilities = null;
    this.protocolVersion = '';
    this.instructions = '';
    this.stderr = '';
    this.pending = new Map();
    this.nextId = 1;
    this.transport = null;
    this.stopping = false;
    this.startedAt = 0;
  }

  _set(status, error) {
    this.status = status;
    this.error = error || '';
    this.emit('status', this.snapshot());
  }

  snapshot() {
    return {
      id: this.id, name: this.name, status: this.status, error: this.error,
      tools: this.tools, serverInfo: this.serverInfo, protocolVersion: this.protocolVersion,
      instructions: this.instructions, stderr: this.stderr.slice(-2000), startedAt: this.startedAt,
    };
  }

  _handlers() {
    return {
      message: (m) => this._onMessage(m),
      stderr: (d) => { this.stderr = (this.stderr + d).slice(-MAX_STDERR); },
      close: (err) => this._onClose(err),
    };
  }

  _onClose(err) {
    const e = err || new Error('Verbindung beendet.');
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(e); }
    this.pending.clear();
    if (this.stopping) { this._set('stopped', ''); return; }
    if (this.status === 'ready' || this.status === 'starting') this._set('error', e.message + (this.stderr ? '\n' + this.stderr.trim().split('\n').slice(-3).join('\n') : ''));
  }

  _onMessage(m) {
    if (!m || typeof m !== 'object') return;
    // Antwort auf eine Anfrage des Clients
    if (m.id !== undefined && m.id !== null && (m.result !== undefined || m.error !== undefined) && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) { const e = new Error(m.error.message || 'MCP-Fehler'); e.code = m.error.code; e.data = m.error.data; p.reject(e); } else p.resolve(m.result);
      return;
    }
    // Anfrage oder Hinweis des Servers
    if (m.method) {
      if (m.id !== undefined && m.id !== null) {
        const reply = (r) => this._send(r).catch(() => {});
        if (m.method === 'ping') reply({ jsonrpc: '2.0', id: m.id, result: {} });
        else reply({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Methode wird von der LLM Box nicht unterstützt: ' + m.method } });
      } else if (m.method === 'notifications/tools/list_changed') {
        this.refreshTools().catch(() => {});
      }
    }
  }

  _send(msg) { return this.transport.send(msg); }

  request(method, params, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.transport) return reject(new Error('Nicht verbunden.'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this._send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } }).catch(() => {});
        reject(new Error(`Zeitüberschreitung nach ${timeoutMs < 10000 ? (timeoutMs / 1000).toFixed(1).replace('.', ',') : Math.round(timeoutMs / 1000)} s (${method}).`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method, params }).catch((e) => {
        if (this.pending.has(id)) { this.pending.delete(id); clearTimeout(timer); reject(e); }
      });
    });
  }

  notify(method, params) { return this._send({ jsonrpc: '2.0', method, params }); }

  async connect() {
    if (this.status === 'starting' || this.status === 'ready') return this.snapshot();
    this.stopping = false;
    this.error = '';
    this.stderr = '';
    this.tools = [];
    this._set('starting');
    this.startedAt = Date.now();
    const c = this.cfg;
    try {
      this.transport = c.type === 'http' ? new HttpTransport(c, this._handlers()) : new StdioTransport(c, this._handlers());
      this.transport.start();
      const init = await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, (+c.startTimeoutSec || 90) * 1000);
      this.serverInfo = init.serverInfo || null;
      this.capabilities = init.capabilities || {};
      this.protocolVersion = init.protocolVersion || PROTOCOL_VERSION;
      this.instructions = String(init.instructions || '').slice(0, 4000);
      if (this.transport.setProtocol) this.transport.setProtocol(this.protocolVersion);
      await this.notify('notifications/initialized');
      await this.refreshTools();
      this._set('ready');
    } catch (e) {
      const msg = e.message + (this.stderr ? '\n' + this.stderr.trim().split('\n').slice(-3).join('\n') : '');
      this._teardown();
      this._set('error', msg);
    }
    return this.snapshot();
  }

  async refreshTools() {
    const out = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, 30000);
      for (const t of r.tools || []) if (t && t.name) out.push({ name: String(t.name), title: t.title || '', description: String(t.description || ''), inputSchema: t.inputSchema || { type: 'object', properties: {} }, annotations: t.annotations || {} });
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    this.tools = out;
    this.emit('status', this.snapshot());
    return out;
  }

  async callTool(name, args, timeoutMs = 120000) {
    if (this.status !== 'ready') throw new Error(this.status === 'starting' ? 'Der Server startet noch.' : 'Der Server ist nicht verbunden' + (this.error ? ': ' + this.error.split('\n')[0] : '.'));
    const r = await this.request('tools/call', { name, arguments: args || {} }, timeoutMs);
    return normalizeResult(r);
  }

  _teardown() {
    const t = this.transport;
    this.transport = null;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Verbindung beendet.')); }
    this.pending.clear();
    if (t) { this.stopping = true; try { t.close(); } catch { /* ignorieren */ } }
  }

  stop() {
    this._teardown();
    this._set('stopped');
  }
}

/* Ergebnis eines Werkzeugaufrufs in Text umwandeln (Bilder und Audio nur als Hinweis) */
function normalizeResult(r) {
  r = r || {};
  const parts = [];
  const media = [];
  for (const c of Array.isArray(r.content) ? r.content : []) {
    if (!c) continue;
    if (c.type === 'text') parts.push(String(c.text ?? ''));
    else if (c.type === 'image' || c.type === 'audio') { const n = c.data ? Math.floor((String(c.data).length * 3) / 4) : 0; media.push({ type: c.type, mime: c.mimeType || '', bytes: n }); parts.push(`[${c.type === 'image' ? 'Bild' : 'Audio'}: ${c.mimeType || 'unbekannt'}, ${n} Bytes – von der LLM Box nicht angezeigt]`); }
    else if (c.type === 'resource' && c.resource) parts.push(c.resource.text !== undefined ? `[Ressource ${c.resource.uri || ''}]\n${c.resource.text}` : `[Ressource ${c.resource.uri || ''}: ${c.resource.mimeType || 'Binärdaten'}]`);
    else if (c.type === 'resource_link') parts.push(`[Link: ${c.uri || ''}${c.name ? ' (' + c.name + ')' : ''}]`);
    else parts.push(JSON.stringify(c));
  }
  let text = parts.join('\n');
  if (!text.trim() && r.structuredContent !== undefined) text = JSON.stringify(r.structuredContent, null, 2);
  return { ok: true, isError: !!r.isError, text, media };
}

/* ───────────────────────── Manager (mehrere Server) ───────────────────────── */
const sigOf = (c) => JSON.stringify([c.type || 'stdio', c.command || '', c.args || [], c.env || {}, c.cwd || '', c.url || '', c.headers || {}, c.startTimeoutSec || 0]);

class McpManager extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();   // id -> { client, sig }
  }

  /* Gewünschte Server abgleichen: neue starten, geänderte neu starten, entfernte oder abgeschaltete stoppen.
     Wartet nicht auf den Verbindungsaufbau (npx kann beim ersten Mal lange laden); der Stand steht in list(). */
  sync(configs) {
    const want = new Map();
    for (const c of configs || []) if (c && c.id && c.enabled !== false) want.set(c.id, c);
    for (const [id, e] of [...this.clients]) {
      const c = want.get(id);
      if (!c || sigOf(c) !== e.sig) { e.client.stop(); this.clients.delete(id); }
    }
    for (const [id, c] of want) {
      if (this.clients.has(id)) { this.clients.get(id).client.name = c.name || id; continue; }
      const client = new McpClient(c);
      client.on('status', (s) => this.emit('status', s));
      this.clients.set(id, { client, sig: sigOf(c) });
      if (c.autoStart !== false) client.connect();
    }
    return this.list();
  }

  list() {
    return [...this.clients.values()].map((e) => e.client.snapshot());
  }

  get(id) {
    const e = this.clients.get(id);
    if (!e) throw new Error('Unbekannter oder abgeschalteter Server.');
    return e.client;
  }

  async connect(id) { return this.get(id).connect(); }
  async restart(id) {
    const c = this.get(id);
    c.stop();
    await sleep(200);
    return c.connect();
  }
  stopOne(id) { const e = this.clients.get(id); if (e) e.client.stop(); return this.list(); }

  /* Verbindung testen, ohne den Server in der Liste zu behalten (Test im Bearbeiten-Dialog) */
  async probe(cfg) {
    const c = new McpClient({ ...cfg, id: cfg.id || 'probe', startTimeoutSec: cfg.startTimeoutSec || 60 });
    try { await c.connect(); return c.snapshot(); } finally { c.stop(); }
  }

  async call(id, name, args, timeoutMs) { return this.get(id).callTool(name, args, timeoutMs); }
  async refreshTools(id) { await this.get(id).refreshTools(); return this.get(id).snapshot(); }

  stopAll() { for (const [, e] of this.clients) e.client.stop(); this.clients.clear(); }
}

module.exports = { McpManager, McpClient, StdioTransport, HttpTransport, normalizeResult, PROTOCOL_VERSION };
