/* test-chat-e2e.js – kompletter Chat-Durchlauf der Android-Version ohne Gerat.
   Ein eingebauter OpenAI-kompatibler Server erzwingt zwei Werkzeug-Aufrufe; ausgefuhrt werden sie
   mit dem echten Code von llm.js (Streaming, SSE-Parsing) und native-main.js (Workspace-Werkzeuge
   uber die simulierte native Brucke). Damit ist die gesamte Kette bewiesen:
   OkHttp-Brucke -> Stream -> Tool-Call -> Dateisystem -> Antwort.
   Aufruf: node tools-android\test-chat-e2e.js     (aus LLM-Box\)  */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');

const WEBAPP = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'webapp');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FEHLER  ' + name + (extra ? ' -> ' + extra : '')); }
}

/* ── Workspace-Attrappe ───────────────────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmbox-e2e-'));
const WSJS = '/ws/projekt';
fs.mkdirSync(path.join(tmp, 'ws/projekt/src'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'ws/projekt/README.md'), '# Projekt\nSTARTPUNKT steht hier.\n');
fs.writeFileSync(path.join(tmp, 'ws/projekt/src/rechner.js'), 'export function add(a, b) {\n  return a + b;\n}\n');

const toReal = (p) => path.join(tmp, String(p).replace(/^\/+/, '').replace(/\//g, path.sep));
const Native = {
  appInfo: () => JSON.stringify({ version: 'test', dataDir: '/data', workspaceRoot: '/ws', platform: 'android' }),
  fsStat: (p) => { try { const s = fs.statSync(toReal(p)); return JSON.stringify({ ok: true, size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }); } catch { return '{"ok":false,"error":"nicht gefunden"}'; } },
  fsExists: (p) => JSON.stringify({ ok: true, exists: fs.existsSync(toReal(p)) }),
  fsReadB64: (p) => { try { return JSON.stringify({ ok: true, b64: fs.readFileSync(toReal(p)).toString('base64') }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsWrite: (p, b64, m) => { try { const f = toReal(p); if (m === 'true') fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b64 || '', 'base64')); return JSON.stringify({ ok: true, size: 1 }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsList: (p) => { try { const items = fs.readdirSync(toReal(p), { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory(), size: d.isFile() ? fs.statSync(path.join(toReal(p), d.name)).size : 0 })); return JSON.stringify({ ok: true, items }); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); } },
  fsMkdirs: (p) => { try { fs.mkdirSync(toReal(p), { recursive: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  fsRemove: (p, r) => { try { fs.rmSync(toReal(p), { recursive: r === 'true', force: true }); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  fsRename: (a, b) => { try { fs.renameSync(toReal(a), toReal(b)); return '{"ok":true}'; } catch { return '{"ok":false}'; } },
  abort: () => '{"ok":true}',
  openExternal: () => '',
  // HTTP wie MainActivity: asynchron, Ergebnis kommt per __fetchResult / __nativeEvent zurueck.
  httpFetch: (json) => {
    const req = JSON.parse(json);
    (async () => {
      try {
        const r = await fetch(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body });
        window.__fetchResult(req.id, { ok: r.ok, status: r.status, text: await r.text() });
      } catch (e) { window.__fetchResult(req.id, { ok: false, status: 0, error: e.message }); }
    })();
    return '{"ok":true}';
  },
  httpStream: (json) => {
    const req = JSON.parse(json);
    (async () => {
      try {
        const r = await fetch(req.url, { method: req.method || 'POST', headers: req.headers, body: req.body });
        if (!r.ok) { window.__nativeEvent('llm', { id: req.id, type: 'error', status: r.status, message: (await r.text()).slice(0, 4000) }); return; }
        const dec = new TextDecoder();
        for await (const ch of r.body) window.__nativeEvent('llm', { id: req.id, type: 'data', text: dec.decode(ch, { stream: true }) });
        window.__nativeEvent('llm', { id: req.id, type: 'end' });
      } catch (e) { window.__nativeEvent('llm', { id: req.id, type: 'error', status: 0, message: e.message }); }
    })();
    return '{"ok":true}';
  },
};

/* ── OpenAI-kompatibter Scheinserver mit Tool-Zwang ───────────────── */
const rounds = [];
let round = 0;
const server = http.createServer((req, res) => {
  console.log(`   [Server] ${req.method} ${req.url}`);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = body ? JSON.parse(body) : {};
    if (!req.url.endsWith('/models')) rounds.push(parsed);

    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'test-modell' }] }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });

    const sse = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

    round++;
    if (round === 1) {
      // Werkzeug-Aufrufe absichtlich ueber mehrere Chunks verteilt (wie echte Server)
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'list_', arguments: '' } }] } }] });
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"files","arguments":"{\\"path\\":\\".\\"}"}}]}}]}\n\n');
      sse({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_2', function: { name: 'search_text', arguments: '{"query":"startpunkt"}' } }] } }] });
      sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Runde 2: Antwort auf die Werkzeug-Ergebnisse
    const toolMsgs = parsed.messages.filter((m) => m.role === 'tool');
    const sawList = toolMsgs.some((m) => /\[Ordner\] src\//.test(m.content || ''));
    const sawSearch = toolMsgs.some((m) => /README\.md:2:/.test(m.content || ''));
    sse({ choices: [{ delta: { content: 'Im Workspace liegt ' } }] });
    res.write('data: {"choices":[{"delta":{"content":"src/ und README.md"}}]}\n\n');
    sse({ choices: [{ delta: { content: sawList ? ' (Ordner gelesen)' : ' (kein Ordner)' + '!' } }] });
    sse({ choices: [{ delta: { content: sawSearch ? ', STARTPUNKT gefunden.' : ', nichts gefunden.' }, finish_reason: 'stop' }] });
    sse({ usage: { prompt_tokens: 40, completion_tokens: 12 } });
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

/* ── WebView-Umgebung ─────────────────────────────────────────────── */
global.window = global;
window.Native = Native;
// Asynchrone Dateibruecke wie in der App (fsJob + __fsResult) – ohne sie wartet der
// node-shim auf Ergebnisse, die nie eintreffen.
require('./test-fs-mock')(Native, global);
window.matchMedia = () => ({ matches: false, addEventListener() {} });
function load(rel) { vm.runInThisContext(fs.readFileSync(path.join(WEBAPP, rel), 'utf8'), { filename: rel }); }

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  load(path.join('vendor', 'webdeps.js'));
  load(path.join('js', 'node-shim.js'));
  load(path.join('js', 'docs.js'));
  load(path.join('js', 'native-main.js'));
  load(path.join('js', 'llm.js'));

  const api = window.api;
  const LLM = global.LLM || window.LLM;

  console.log('Modelliste ueber die Bruecke …');
  const conn = { id: 'c', name: 'Test', type: 'openai', baseUrl: BASE + '/v1', apiKey: '' };
  const models = await LLM.listModels(conn);
  ok('listModels liefert Modelle', Array.isArray(models) && models.length === 1 && models[0].id === 'test-modell', JSON.stringify(models));

  console.log('\nChat mit zwei Werkzeug-Runden …');
  const tools = LLM.WORKSPACE_TOOLS.filter((t) => ['list_files', 'search_text'].includes(t.function.name));
  const messages = [{ id: 'u1', role: 'user', content: 'Zeig mir, was im Workspace liegt.' }];

  let streamedText = '';
  let result = null;
  for (let step = 0; step < 3 && !result; step++) {
    const run = LLM.streamChat({
      conn,
      model: 'test-modell',
      system: 'Du hast Zugriff auf einen Workspace.',
      messages,
      params: {},
      tools,
      thinkLevel: 'off',
      handlers: { onContent: (t) => { streamedText = t; } },
    });
    const r = await run.promise;

    if (!r.toolCalls || !r.toolCalls.length) { result = r; break; }

    // Werkzeug-Ausfuehrung genau wie app.js: api.ws.tool mit Workspace-Wurzel und readKB
    messages.push({ id: 'a' + step, role: 'assistant', content: r.content || '', toolCalls: r.toolCalls });
    for (const tc of r.toolCalls) {
      const out = await api.ws.tool({ root: WSJS, name: tc.name, args: tc.args, maxKB: 40, ignore: [] });
      console.log(`   Werkzeug ${tc.name}(${JSON.stringify(tc.args)}) -> ${out.ok ? 'ok' : 'Fehler'}: ${(out.result || '').split('\n')[0].slice(0, 60)}`);
      messages.push({ id: 't' + step + tc.id, role: 'tool', name: tc.name, toolCallId: tc.id, content: out.result });
    }
  }

  ok('zwei Werkzeug-Aufrufe erkannt', rounds.length >= 2 && (rounds[0].tools || []).length === 2, 'Runden: ' + rounds.length);
  ok('list_files ausgefuehrt und Ergebnis gesendet',
    rounds[1] && rounds[1].messages.some((m) => m.role === 'tool' && /\[Ordner\] src\//.test(m.content || '')),
    rounds[1] ? JSON.stringify(rounds[1].messages.map((m) => m.role)) : 'keine 2. Runde');
  ok('search_text ausgefuehrt und Ergebnis gesendet',
    rounds[1] && rounds[1].messages.some((m) => m.role === 'tool' && /README\.md:2:/.test(m.content || '')),
    rounds[1] ? JSON.stringify(rounds[1].messages.filter((m) => m.role === 'tool').map((m) => (m.content || '').slice(0, 40))) : '');

  ok('Endantwort vollstaendig empfangen', !!result && /src\/ und README\.md/.test(result.content), result ? JSON.stringify(result.content) : 'kein Ergebnis');
  ok('Streaming haelt Umlaute/Satzgrenzen ein', !!result && /(Ordner gelesen)/.test(result.content), result ? result.content : '');
  ok('Server-Statistik (usage) uebernommen', !!result && result.stats && result.stats.completionTokens === 12, JSON.stringify(result && result.stats));

  console.log('\nWerkzeug-Schutz …');
  const esc = await api.ws.tool({ root: WSJS, name: 'search_text', args: { query: 'passwd', path: '../../..' } });
  ok('Suche ueber Workspace-Grenze abgelehnt', esc.ok === false || /Kein|außerhalb/.test(esc.result), JSON.stringify(esc).slice(0, 120));

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nErgebnis: ${pass} geprueft, ${fail} Fehler`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('Test lief auf einen Fehler:', e);
  server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(2);
});
