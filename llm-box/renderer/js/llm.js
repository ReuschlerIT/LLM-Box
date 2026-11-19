/* LLM-Schicht: Ollama (/api/chat), OpenAI-kompatibel (/chat/completions) und Anthropic (Claude, /v1/messages).
   Streaming, Token-Metriken (tok/s, Prompt, Antwort, Gesamt, TTFT) und Workspace-Werkzeuge. */
(function (root) {
  'use strict';
  const api = () => root.api;
  const now = () => (root.performance ? root.performance.now() : Date.now());
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const joinUrl = (base, p) => String(base || '').replace(/\/+$/, '') + p;

  /* Anthropic (Claude): eigene Kopfzeilen (x-api-key statt Bearer) und Basis-Adresse mit /v1 */
  const ANTH_VERSION = '2023-06-01';
  const isAnth = (conn) => !!conn && conn.type === 'anthropic';
  function anthropicBase(conn) {
    let b = String((conn && conn.baseUrl) || '').trim().replace(/\/+$/, '');
    if (!b) b = 'https://api.anthropic.com';
    return /\/v\d+$/.test(b) ? b : b + '/v1';
  }

  function headersFor(conn) {
    const h = { 'Content-Type': 'application/json' };
    if (isAnth(conn)) {
      h['anthropic-version'] = ANTH_VERSION;
      if (conn.apiKey) h['x-api-key'] = conn.apiKey;
      return h;
    }
    if (conn.apiKey) h.Authorization = 'Bearer ' + conn.apiKey;
    return h;
  }

  function errorText(status, raw) {
    let msg = String(raw || '').trim();
    try {
      const j = JSON.parse(msg);
      msg = (j.error && (j.error.message || j.error)) || j.message || msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch {}
    if (!status) return msg || 'Keine Verbindung';
    let hint = '';
    if (status === 401 || status === 403) hint = ' – API-Schlüssel prüfen.';
    else if (status === 404) hint = ' – Modell oder Adresse nicht gefunden.';
    else if (status === 429) hint = ' – Anfragelimit erreicht. Kurz warten und erneut versuchen.';
    else if (status === 529) hint = ' – Der Anbieter ist gerade überlastet. Später erneut versuchen.';
    else if (/credit balance|billing/i.test(msg)) hint = ' – Guthaben beim Anbieter aufgebraucht oder keine Zahlungsart hinterlegt (Anthropic: console.anthropic.com → Plans & Billing).';
    else if (/temperature|top_p|top_k/i.test(msg) && /deprecated|not supported|not allowed|cannot|may only|invalid/i.test(msg)) hint = ' – Dieses Modell nimmt keine eigenen Sampling-Werte an. Stelle in der Verbindung „Sampling-Parameter“ auf „Dem Server überlassen“.';
    else if (/budget_tokens|adaptive/i.test(msg)) hint = ' – Diese Denk-Variante passt nicht zum Modell. Ändere in der Verbindung „Denkaufwand senden als“ (Adaptiv für neuere Modelle, Festes Budget für ältere).';
    else if (/think|reasoning/i.test(msg)) hint = ' – Dieses Modell unterstützt die Denk-Einstellung nicht. Stelle „Denken“ im Eingabefeld auf Auto.';
    else if (/tool/i.test(msg)) hint = ' – Dieses Modell unterstützt keine Werkzeuge. Schalte den KI-Dateizugriff aus oder wähle ein anderes Modell.';
    return `HTTP ${status}: ${msg}${hint}`;
  }

  /* ───── Modelle ───── */
  async function listAnthropicModels(conn) {
    const base = anthropicBase(conn);
    const out = [];
    let after = '';
    for (let page = 0; page < 5; page++) {
      const url = joinUrl(base, '/models?limit=1000' + (after ? '&after_id=' + encodeURIComponent(after) : ''));
      const res = await api().fetch({ url, method: 'GET', headers: { ...headersFor(conn), Accept: 'application/json' } });
      if (!res.ok) throw new Error(res.error || errorText(res.status, res.text));
      let j;
      try { j = JSON.parse(res.text); } catch { throw new Error(`Die Antwort von ${url} ist kein JSON: ${String(res.text || '').replace(/\s+/g, ' ').slice(0, 120)}`); }
      for (const m of j.data || []) if (m && m.id) out.push({ id: m.id, name: m.display_name || m.id, raw: m });
      if (!j.has_more || !j.last_id) break;
      after = j.last_id;
    }
    return out;
  }

  async function listModels(conn) {
    if (isAnth(conn)) return listAnthropicModels(conn);
    const url = conn.type === 'ollama' ? joinUrl(conn.baseUrl, '/api/tags') : joinUrl(conn.baseUrl, '/models');
    const res = await api().fetch({ url, method: 'GET', headers: { ...headersFor(conn), Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.error || errorText(res.status, res.text));
    if (/^\s*(<!doctype html|<html)/i.test(res.text || '')) throw new Error(`Die Adresse ${url} liefert eine Webseite statt der API. Das ist vermutlich die Strata-Oberfläche, nicht der Modell-Server: Prüfe Adresse und Port der Verbindung (Strata-API: meist http://localhost:8080/v1) und den API-Schlüssel.`);
    let j;
    try { j = JSON.parse(res.text); } catch { throw new Error(`Die Antwort von ${url} ist kein JSON: ${String(res.text || '').replace(/\s+/g, ' ').slice(0, 120)}`); }
    if (conn.type === 'ollama') return (j.models || []).map((m) => ({ id: m.name, size: m.size, details: m.details }));
    const loaded = (j.data || j.models || []).map((m) => ({ id: m.id || m.name, raw: m })).filter((m) => m.id);
    // Strata (und ähnliche Server) melden unter /v1/models nur das GELADENE Modell. Die übrigen installierten Modelle
    // stehen im Host der Strata-App (/api/native → installed) und werden hier zusätzlich eingeblendet.
    let extra = [];
    try { extra = await listStrataInstalled(conn); } catch { extra = []; }
    if (!extra.length) return loaded;
    const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const out = loaded.map((m) => ({ ...m, loaded: true }));
    for (const x of extra) {
      const nx = norm(x.id);
      if (out.some((m) => m.id === x.id || (nx && norm(m.id) === nx) || (nx.length > 5 && m.loaded && (norm(m.id).includes(nx) || nx.includes(norm(m.id)))))) continue;
      out.push({ id: x.id, installedOnly: true, raw: x.raw });
    }
    return out;
  }

  /* Installierte Modelle der Strata-Desktop-App (GET <Host>/api/native → installed). Leere Liste, wenn der Server das nicht kennt. */
  async function listStrataInstalled(conn) {
    if (!conn || conn.type === 'ollama' || isAnth(conn)) return [];
    let host = '';
    try { host = new URL(conn.baseUrl).hostname; } catch { return []; }
    // Keine fremden Cloud-Server abfragen: nur lokale/private Adressen oder Verbindungen, die ausdrücklich „Strata“ heißen
    if (!/^(localhost|127\.|\[::1\]|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host) && !/strata/i.test(conn.name || '')) return [];
    const root = String(conn.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
    const res = await api().fetch({ url: root + '/api/native', method: 'GET', headers: { ...headersFor(conn), Accept: 'application/json' }, timeout: 4000 });
    if (!res || !res.ok) return [];
    let j;
    try { j = JSON.parse(res.text); } catch { return []; }
    const inst = j && j.installed;
    let list = !inst ? [] : Array.isArray(inst) ? inst : Array.isArray(inst.models) ? inst.models : Array.isArray(inst.items) ? inst.items : Array.isArray(inst.data) ? inst.data : [];
    const seen = new Set();
    const out = [];
    for (const m of list) {
      const id = typeof m === 'string' ? m : m && (m.id || m.modelId || m.name || m.model);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id: String(id), raw: m });
    }
    return out;
  }


  /* ───── Modell-Infos vom Server (Kontextgröße u. a.) ───── */
  // Sucht in beliebigem JSON nach Zahlen, die wie eine Kontextgröße heißen.
  function scanCtx(obj, label, out, depth) {
    if (!obj || typeof obj !== 'object' || depth > 5) return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && v >= 512 && /ctx|context|max_model_len|max_position|window/i.test(k) && !/output|completion|max_tokens|sliding|n_ctx_slot_used/i.test(k)) out.push({ key: k, value: v, source: label });
      else if (v && typeof v === 'object') scanCtx(v, label, out, depth + 1);
    }
  }
  // Laufzeitwerte (wirklich geladen) schlagen Trainings-Maximum.
  const CTX_RANK = [/^loaded_context_length$/, /(^|\.)n_ctx$/, /^max_model_len$/, /^engine_max_context$/, /^context_window$/, /^context_length$/, /^max_context_length$/, /^--max-context$/, /n_ctx_train$|max_position_embeddings$/, /./];
  const TRAIN_RANK = CTX_RANK.findIndex((r) => r.test('n_ctx_train'));
  const rankOf = (c) => CTX_RANK.findIndex((r) => r.test(c.key));

  async function getJson(conn, url, method, body) {
    try {
      const res = await api().fetch({ url, method: method || 'GET', headers: { ...headersFor(conn), Accept: 'application/json' }, body });
      if (!res.ok) return null;
      return JSON.parse(res.text);
    } catch {
      return null;
    }
  }

  async function modelInfo(conn, modelId, models) {
    const info = { ctx: null, ctxKey: '', ctxSource: '', runtime: false, answered: [], candidates: [], entryKeys: [] };
    const cands = [];
    if (isAnth(conn)) {
      // Claude: Die Modellliste nennt das Eingabe-Limit (max_input_tokens) selbst, weitere Abfragen sind nicht nötig.
      const entry = (models || []).find((m) => m.id === modelId);
      const raw = (entry && entry.raw) || {};
      info.entryKeys = Object.keys(raw);
      if (entry) info.answered.push('/models');
      if (+raw.max_input_tokens > 0) {
        info.ctx = +raw.max_input_tokens;
        info.ctxKey = 'max_input_tokens';
        info.ctxSource = '/models';
        info.runtime = true;
        info.candidates = [{ key: 'max_input_tokens', value: info.ctx, source: '/models' }];
      }
      return info;
    }
    if (conn.type === 'ollama') {
      const j = await getJson(conn, joinUrl(conn.baseUrl, '/api/show'), 'POST', JSON.stringify({ model: modelId }));
      if (j) {
        info.answered.push('/api/show');
        const m = /num_ctx\s+(\d+)/.exec(j.parameters || '');
        if (m) cands.push({ key: 'num_ctx', value: +m[1], source: '/api/show (Modelfile)' });
        scanCtx(j.model_info || {}, '/api/show', cands, 0);
      }
    } else {
      const root = String(conn.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
      const entry = (models || []).find((m) => m.id === modelId);
      if (entry && entry.raw) {
        info.answered.push('/models');
        info.entryKeys = Object.keys(entry.raw);
        scanCtx(entry.raw, '/models', cands, 0);
      }
      const probes = [
        ['/props', joinUrl(root, '/props')],
        ['/api/v0/models/' + modelId, joinUrl(root, '/api/v0/models/' + encodeURIComponent(modelId))],
        ['/models/' + modelId, joinUrl(conn.baseUrl, '/models/' + encodeURIComponent(modelId))],
        ['/info', joinUrl(root, '/info')],
        ['/v1/info', joinUrl(root, '/v1/info')],
        ['/api/info', joinUrl(root, '/api/info')],
        ['/slots', joinUrl(root, '/slots')],
        ['/status', joinUrl(root, '/status')],
        ['/v1/status', joinUrl(root, '/v1/status')],
        ['/metrics', joinUrl(root, '/metrics')],
      ];
      const results = await Promise.all(probes.map(([, u]) => getJson(conn, u)));
      results.forEach((j, i) => {
        if (!j) return;
        info.answered.push(probes[i][0]);
        scanCtx(j, probes[i][0], cands, 0);
      });
    }
    if (conn.configPath && api().cfg) {
      try {
        const c = await api().cfg.ctx(conn.configPath);
        if (c && c.ok) { info.answered.push('Strata-Konfigdatei'); cands.push({ key: '--max-context', value: c.ctx, source: 'Strata-Konfigdatei' }); }
        else if (c) info.cfgError = c.error;
      } catch {}
    }
    cands.sort((a, b) => rankOf(a) - rankOf(b));
    info.candidates = cands;
    if (cands.length) {
      const best = cands[0];
      info.ctx = best.value;
      info.ctxKey = best.key;
      info.ctxSource = best.source;
      info.runtime = rankOf(best) < TRAIN_RANK;
    }
    return info;
  }

  /* Echtzeit-Füllstand: llama.cpp-kompatibles /slots (Strata: n_ctx, n_prompt_tokens). Liefert null, wenn der Server es nicht kann. */
  async function slotInfo(conn) {
    if (conn.type === 'ollama' || isAnth(conn)) return null;
    const root = String(conn.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
    const j = await getJson(conn, joinUrl(root, '/slots'));
    if (!j) return null;
    const list = Array.isArray(j) ? j : Array.isArray(j.slots) ? j.slots : [j];
    let best = null;
    for (const s of list) {
      if (!s || typeof s !== 'object') continue;
      const n = +s.n_prompt_tokens || +s.n_past || 0;
      if (!best || n > best.nPrompt) {
        const flag = s.is_processing ?? s.busy ?? (typeof s.state === 'string' ? /busy|process|run/i.test(s.state) : undefined);
        best = { nCtx: +s.n_ctx || 0, nPrompt: n, busy: typeof flag === 'boolean' ? flag : undefined };
      }
    }
    return best;
  }

  /* ───── Streaming-Grundlage ───── */
  function openStream(req, onLine, onEnd, onError) {
    let buf = '';
    api().stream(req, (ev) => {
      try {
        if (ev.type === 'data') {
          buf += ev.text;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) onLine(line);
          }
        } else if (ev.type === 'end') {
          if (buf.trim()) onLine(buf.trim());
          buf = '';
          onEnd(!!ev.aborted);
        } else if (ev.type === 'error') {
          onError(Object.assign(new Error(errorText(ev.status, ev.message)), { status: ev.status }));
        }
      } catch (e) {
        onError(e);
        api().abort(req.id);
      }
    });
  }

  /* ───── Nachrichten → Wire-Format ───── */
  const fileBlock = (f) => `<file name="${f.name}"${f.converted ? ` format="${f.converted}, als Text ausgelesen"` : ''}>\n${f.text}\n</file>`;
  function userText(m) {
    const tf = (m.files || []).filter((f) => f.kind === 'text');
    const t = m.content || '';
    return tf.length ? tf.map(fileBlock).join('\n\n') + (t ? '\n\n' + t : '') : t;
  }

  function toWire(conn, system, messages) {
    const out = [];
    const ollama = conn.type === 'ollama';
    if (system) out.push({ role: 'system', content: system });
    for (const m of messages) {
      if (m.role === 'user') {
        const text = userText(m);
        const imgs = (m.files || []).filter((f) => f.kind === 'image');
        if (ollama) {
          const o = { role: 'user', content: text };
          if (imgs.length) o.images = imgs.map((i) => i.dataUrl.split(',')[1]);
          out.push(o);
        } else if (imgs.length) {
          out.push({ role: 'user', content: [{ type: 'text', text }, ...imgs.map((i) => ({ type: 'image_url', image_url: { url: i.dataUrl } }))] });
        } else out.push({ role: 'user', content: text });
      } else if (m.role === 'assistant') {
        const calls = m.toolCalls || [];
        if (m.error && !m.content && !calls.length) continue;
        const hasImg = !!(m.images && m.images.length);
        if (!m.content && !calls.length && !hasImg) continue;
        const o = { role: 'assistant', content: m.content || (hasImg ? '[Bild erzeugt]' : '') };
        if (calls.length) {
          o.tool_calls = calls.map((tc) =>
            ollama
              ? { function: { name: tc.name, arguments: tc.args || {} } }
              : { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }
          );
        }
        out.push(o);
      } else if (m.role === 'tool') {
        out.push(ollama ? { role: 'tool', tool_name: m.name, content: m.content } : { role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      }
    }
    return out;
  }

  /* Nachrichten → Anthropic-Format (Messages API).
     - System-Prompt steht getrennt (system), Bilder als base64-Blöcke, Werkzeug-Ergebnisse als tool_result im nächsten user-Turn.
     - Aufeinanderfolgende Nachrichten gleicher Rolle werden zusammengelegt, fehlende/überzählige Werkzeug-Ergebnisse repariert.
     - Denk-Blöcke (mit Signatur) werden nur zurückgegeben, wenn Denken aktiv ist und dasselbe Modell sie erzeugt hat. */
  const tid = (id) => String(id || uid()).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const ANTH_IMG = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/gif': 'image/gif', 'image/webp': 'image/webp' };
  function anthImage(f) {
    const url = f.dataUrl || '';
    const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(url);
    if (m) {
      const mt = ANTH_IMG[m[1].toLowerCase()];
      return mt ? { type: 'image', source: { type: 'base64', media_type: mt, data: m[2] } } : { type: 'text', text: `[Bild im Format ${m[1]} wird von der Claude-API nicht unterstützt]` };
    }
    if (/^https?:/i.test(url)) return { type: 'image', source: { type: 'url', url } };
    return null;
  }

  function toWireAnthropic(conn, system, messages, model, withThinking) {
    const out = [];
    const push = (role, blocks) => {
      if (!blocks.length) return;
      const last = out[out.length - 1];
      if (last && last.role === role) last.content.push(...blocks);
      else out.push({ role, content: blocks.slice() });
    };
    for (const m of messages) {
      if (m.role === 'user') {
        const blocks = [];
        const imgs = (m.files || []).filter((f) => f.kind === 'image');
        for (const im of imgs) { const b = anthImage(im); if (b) blocks.push(b); }
        const text = userText(m);
        blocks.push({ type: 'text', text: text && text.trim() ? text : imgs.length ? '(Bild)' : '(leer)' });
        push('user', blocks);
      } else if (m.role === 'assistant') {
        const calls = m.toolCalls || [];
        if (m.error && !m.content && !calls.length) continue;
        const hasImg = !!(m.images && m.images.length);
        if (!m.content && !calls.length && !hasImg) continue;
        const blocks = [];
        if (withThinking && m.thinkBlocks && m.thinkBlocks.length && m.model === model) blocks.push(...m.thinkBlocks);
        if (m.content && m.content.trim()) blocks.push({ type: 'text', text: m.content });
        else if (hasImg && !calls.length) blocks.push({ type: 'text', text: '[Bild erzeugt]' });
        for (const tc of calls) blocks.push({ type: 'tool_use', id: tid(tc.id), name: tc.name, input: tc.args && typeof tc.args === 'object' ? tc.args : {} });
        push('assistant', blocks);
      } else if (m.role === 'tool') {
        push('user', [{ type: 'tool_result', tool_use_id: tid(m.toolCallId), content: String(m.content || '').trim() ? String(m.content) : '(leer)' }]);
      }
    }
    // Reparatur: jedes tool_use braucht sein tool_result direkt danach, und ein tool_result braucht sein tool_use direkt davor
    for (let i = 0; i < out.length; i++) {
      const m = out[i];
      if (m.role === 'assistant') {
        const ids = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
        if (!ids.length) continue;
        let nxt = out[i + 1];
        if (!nxt || nxt.role !== 'user') { nxt = { role: 'user', content: [] }; out.splice(i + 1, 0, nxt); }
        const have = new Set(nxt.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id));
        const missing = ids.filter((id) => !have.has(id)).map((id) => ({ type: 'tool_result', tool_use_id: id, content: '(Kein Ergebnis: der Aufruf wurde nicht ausgeführt.)', is_error: true }));
        const results = nxt.content.filter((b) => b.type === 'tool_result');
        const rest = nxt.content.filter((b) => b.type !== 'tool_result');
        nxt.content = [...missing, ...results, ...rest]; // tool_result-Blöcke müssen vor anderem Inhalt stehen
      } else {
        const prev = out[i - 1];
        const ids = new Set(prev && prev.role === 'assistant' ? prev.content.filter((b) => b.type === 'tool_use').map((b) => b.id) : []);
        m.content = m.content.filter((b) => b.type !== 'tool_result' || ids.has(b.tool_use_id));
        if (!m.content.length) { out.splice(i, 1); i--; }
      }
    }
    if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(Fortsetzung des Gesprächs)' }] });
    if (out.length && out[out.length - 1].role === 'assistant') out.push({ role: 'user', content: [{ type: 'text', text: 'Fahre fort.' }] }); // neuere Modelle erlauben keinen vorgegebenen Antwortanfang
    const cache = conn.promptCache !== false;
    if (cache && out.length) {
      const lm = out[out.length - 1];
      const lb = lm.content[lm.content.length - 1];
      if (lb) lb.cache_control = { type: 'ephemeral' };
    }
    const sys = system ? (cache ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system) : undefined;
    return { system: sys, messages: out };
  }

  const toAnthTool = (t) => {
    const f = (t && t.function) || t || {};
    return { name: f.name, description: f.description || '', input_schema: f.parameters || f.input_schema || { type: 'object', properties: {} } };
  };

  function buildOptions(conn, p) {
    const has = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(v);
    // „Dem Server überlassen“: keine Sampling-Werte senden, der Server nimmt seine eigenen Standards (wie seine Weboberfläche)
    if (conn.samplingMode === 'server') p = { ...p, temperature: null, topP: null, topK: null, repeatPenalty: null, minP: null, presencePenalty: null, seed: null };
    const stop = String(p.stop || '')
      .split('|')
      .map((s) => s.replace(/\\n/g, '\n'))
      .filter((s) => s.length);
    if (isAnth(conn)) {
      // Claude: nur Temperatur (0 bis 1), optional Top-K und Stop-Sequenzen. Top-P wird nie mitgeschickt, weil neuere Modelle beides zusammen ablehnen.
      const o = {};
      if (has(p.temperature)) o.temperature = Math.min(1, Math.max(0, +p.temperature));
      if (conn.extraParams && has(p.topK) && +p.topK > 0) o.top_k = +p.topK;
      if (stop.length) o.stop_sequences = stop;
      return o;
    }
    if (conn.type === 'ollama') {
      const o = {};
      if (has(p.temperature)) o.temperature = +p.temperature;
      if (has(p.topP)) o.top_p = +p.topP;
      if (has(p.topK)) o.top_k = +p.topK;
      if (has(p.repeatPenalty)) o.repeat_penalty = +p.repeatPenalty;
      if (has(p.minP)) o.min_p = +p.minP;
      if (has(p.presencePenalty)) o.presence_penalty = +p.presencePenalty;
      if (has(p.numCtx) && +p.numCtx > 0) o.num_ctx = +p.numCtx;
      if (has(p.maxTokens) && +p.maxTokens > 0) o.num_predict = +p.maxTokens;
      if (has(p.seed)) o.seed = +p.seed;
      if (stop.length) o.stop = stop;
      return o;
    }
    const o = {};
    if (has(p.temperature)) o.temperature = +p.temperature;
    if (has(p.topP)) o.top_p = +p.topP;
    if (has(p.maxTokens) && +p.maxTokens > 0) o.max_tokens = +p.maxTokens;
    if (has(p.seed)) o.seed = +p.seed;
    if (stop.length) o.stop = stop;
    if (conn.extraParams) {
      if (has(p.topK)) o.top_k = +p.topK;
      if (has(p.repeatPenalty)) o.repeat_penalty = +p.repeatPenalty;
      if (has(p.minP)) o.min_p = +p.minP;
      if (has(p.presencePenalty)) o.presence_penalty = +p.presencePenalty;
    }
    return o;
  }

  function splitThink(text) {
    const m = /<think>([\s\S]*?)(<\/think>|$)/.exec(text || '');
    if (!m) return { think: '', answer: text || '' };
    return { think: m[1].trim(), answer: ((text || '').slice(0, m.index) + (text || '').slice(m.index + m[0].length)).trim() };
  }

  /* ───── Chat ───── */
  /* Denkaufwand: 'auto' | 'off' | 'low' | 'medium' | 'high' */
  const thinkModeOf = (conn) => (isAnth(conn) ? (['adaptive', 'budget', 'none'].includes(conn.thinkMode) ? conn.thinkMode : 'adaptive') : conn.thinkMode || (conn.extraParams ? 'template' : 'effort'));
  /* Claude: „Auto“ sendet nichts, „Aus“ schaltet Denken ab. Sonst entweder adaptiv + effort (Opus/Sonnet 4.6 und neuer; Claude 4.7+ lehnt das feste Budget ab)
     oder festes Budget (ältere Modelle, 4.5 und früher). Mit Denken sind Temperatur und Top-K nicht erlaubt. */
  const BUDGETS = { low: 2048, medium: 8192, high: 16384 };
  function applyThinkingAnthropic(conn, body, level, canThink) {
    if (!level || level === 'auto') return;
    if (level === 'off') { body.thinking = { type: 'disabled' }; return; }
    const mode = thinkModeOf(conn);
    if (mode === 'none' || !canThink) return;
    if (mode === 'budget') {
      const budget = BUDGETS[level] || BUDGETS.medium;
      body.thinking = { type: 'enabled', budget_tokens: budget };
      if (!(body.max_tokens > budget)) body.max_tokens = budget + 4096;
    } else {
      body.thinking = { type: 'adaptive', display: 'summarized' };
      body.output_config = { effort: level };
    }
    delete body.temperature;
    delete body.top_k;
  }
  function applyThinking(conn, body, level, model) {
    if (!level || level === 'auto') return;
    if (conn.type === 'ollama') {
      if (/gpt-oss/i.test(model)) body.think = level === 'off' ? 'low' : level; // gpt-oss kennt nur Stufen
      else body.think = level !== 'off';
      return;
    }
    const mode = thinkModeOf(conn);
    if (mode === 'none') return;
    if (mode === 'effort') body.reasoning_effort = level === 'off' ? 'minimal' : level;
    else if (mode === 'template') {
      body.chat_template_kwargs = { enable_thinking: level !== 'off' };
      if (level !== 'off') {
        body.chat_template_kwargs.reasoning_effort = level;
        body.reasoning_effort = level;
      }
    } else if (mode === 'openrouter') body.reasoning = level === 'off' ? { enabled: false } : { effort: level };
  }

  /* Bildausgabe (OpenRouter u. a.): Der Server liefert Bilder nur, wenn die Anfrage "modalities" enthält.
     Ohne diesen Parameter antwortet auch ein bildfähiges Modell nur mit Text und behauptet, es könne keine Bilder erzeugen.
     conn.imageOutput: 'auto' (nach Modellname), 'on' (immer) oder 'off'. */
  const IMG_ANY = /image|dall-?e|nano[-_ ]?banana|flux|riverflow|seedream|sdxl|stable[-_ ]?diffusion/i;
  const IMG_ONLY = /flux|riverflow|seedream|sdxl|stable[-_ ]?diffusion/i; // reine Bildmodelle liefern keinen Text
  function imageModalities(conn, model) {
    if (conn.type === 'ollama' || isAnth(conn)) return null;
    const mode = conn.imageOutput || 'auto';
    if (mode === 'off') return null;
    if (mode === 'auto' && !IMG_ANY.test(model || '')) return null;
    return mode === 'auto' && IMG_ONLY.test(model || '') ? ['image'] : ['image', 'text'];
  }

  /* Bild aus einer Antwort lesen: image_url-Objekt, direkte URL oder base64 */
  function imageOf(x) {
    if (!x) return null;
    if (typeof x === 'string') return /^(data:image\/|https?:)/.test(x) ? { dataUrl: x } : null;
    const u = (x.image_url && (x.image_url.url || x.image_url)) || x.url || (x.b64_json ? 'data:image/png;base64,' + x.b64_json : '') || (x.data && x.mime_type ? `data:${x.mime_type};base64,${x.data}` : '');
    return typeof u === 'string' && u ? { dataUrl: u } : null;
  }

  const numOr0 = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);

  function streamChat({ conn, model, system, messages, params, tools, thinkLevel, handlers }) {
    const id = uid();
    const ollama = conn.type === 'ollama';
    const anth = isAnth(conn);
    const h = handlers || {};
    let wire = anth ? null : toWire(conn, system, messages);
    const opts = buildOptions(conn, params || {});
    let body;
    if (anth) {
      const pm = +(params && params.maxTokens);
      body = { model, max_tokens: pm > 0 ? pm : 16384, stream: true, ...opts };
      // Mit festem Budget verlangt die API im laufenden Werkzeug-Ablauf den Denk-Block des letzten Schritts. Fehlt er, wird Denken für diese Anfrage ausgelassen.
      const lastMsg = messages[messages.length - 1];
      const lastAsst = [...messages].reverse().find((m) => m.role === 'assistant');
      const canThink = !(thinkModeOf(conn) === 'budget' && lastMsg && lastMsg.role === 'tool' && !(lastAsst && lastAsst.thinkBlocks && lastAsst.thinkBlocks.length));
      applyThinkingAnthropic(conn, body, thinkLevel, canThink);
      const withThinking = !!(body.thinking && body.thinking.type !== 'disabled');
      const aw = toWireAnthropic(conn, system, messages, model, withThinking);
      wire = aw.messages;
      if (aw.system) body.system = aw.system;
      body.messages = wire;
    } else if (ollama) {
      body = { model, messages: wire, stream: true, options: opts };
      if (params && params.keepAlive) body.keep_alive = params.keepAlive;
    } else {
      body = { model, messages: wire, stream: true, stream_options: { include_usage: true }, ...opts };
    }
    if (tools && tools.length) body.tools = anth ? tools.map(toAnthTool) : tools;
    if (!anth) applyThinking(conn, body, thinkLevel, model);
    const mods = imageModalities(conn, model);
    if (mods) body.modalities = mods;
    const url = anth ? joinUrl(anthropicBase(conn), '/messages') : joinUrl(conn.baseUrl, ollama ? '/api/chat' : '/chat/completions');

    let content = '';
    let thinking = '';
    const images = [];
    const addImages = (list) => {
      let added = false;
      for (const x of list || []) {
        const im = imageOf(x);
        if (im && !images.some((y) => y.dataUrl === im.dataUrl)) { images.push(im); added = true; }
      }
      if (added) { mark(); n++; if (h.onImages) h.onImages(images.slice(), n); }
    };
    let n = 0;
    const toolCalls = [];
    const oaiTools = {};
    let usage = null;
    let timings = null;
    let finalObj = null;
    let finishReason = '';
    // Anthropic: Blöcke je Index, Nutzungszahlen, Denk-Blöcke samt Signatur (für Werkzeug-Abläufe mit Denken)
    const aBlocks = {};
    const thinkBlocks = [];
    let usageA = null;
    const STOP_MAP = { end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length', model_context_window_exceeded: 'length', tool_use: 'tool_calls' };
    const t0 = now();
    let tFirst = null;
    const mark = () => {
      if (tFirst === null) tFirst = now();
    };

    function handleAnth(o) {
      switch (o.type) {
        case 'message_start':
          usageA = { ...(usageA || {}), ...((o.message && o.message.usage) || {}) };
          break;
        case 'content_block_start': {
          const b = o.content_block || {};
          aBlocks[o.index] = { type: b.type, text: b.text || '', thinking: b.thinking || '', signature: b.signature || '', id: b.id, name: b.name, json: '', data: b.data };
          if (b.type === 'tool_use') mark();
          if (b.type === 'thinking' && thinking) thinking += '\n\n';
          if (b.type === 'text' && b.text) { mark(); n++; content += b.text; if (h.onContent) h.onContent(content, n); }
          break;
        }
        case 'content_block_delta': {
          const d = o.delta || {};
          const e = aBlocks[o.index] || (aBlocks[o.index] = { type: 'text', text: '', thinking: '', signature: '', json: '' });
          if (d.type === 'text_delta' && d.text) {
            mark(); n++;
            e.text += d.text; content += d.text;
            if (h.onContent) h.onContent(content, n);
          } else if (d.type === 'thinking_delta' && d.thinking) {
            mark(); n++;
            e.thinking += d.thinking; thinking += d.thinking;
            if (h.onThinking) h.onThinking(thinking, n);
          } else if (d.type === 'signature_delta') e.signature = d.signature || e.signature;
          else if (d.type === 'input_json_delta') e.json += d.partial_json || '';
          break;
        }
        case 'content_block_stop': {
          const e = aBlocks[o.index];
          if (!e) break;
          if (e.type === 'tool_use') {
            let args = {};
            try { args = e.json ? JSON.parse(e.json) : {}; } catch {}
            toolCalls.push({ id: e.id || uid(), name: e.name, args });
          } else if (e.type === 'thinking') thinkBlocks.push({ type: 'thinking', thinking: e.thinking, signature: e.signature });
          else if (e.type === 'redacted_thinking') thinkBlocks.push({ type: 'redacted_thinking', data: e.data });
          break;
        }
        case 'message_delta':
          if (o.delta && o.delta.stop_reason) finishReason = STOP_MAP[o.delta.stop_reason] || o.delta.stop_reason;
          if (o.usage) usageA = { ...(usageA || {}), ...o.usage };
          break;
        case 'error':
          throw new Error((o.error && o.error.message) || JSON.stringify(o.error || o));
        default:
          break;
      }
    }

    function handleObj(o) {
      if (anth) return handleAnth(o);
      if (ollama) {
        if (o.error) throw new Error(typeof o.error === 'string' ? o.error : JSON.stringify(o.error));
        const m = o.message || {};
        if (m.thinking) {
          mark();
          n++;
          thinking += m.thinking;
          if (h.onThinking) h.onThinking(thinking, n);
        }
        if (m.content) {
          mark();
          n++;
          content += m.content;
          if (h.onContent) h.onContent(content, n);
        }
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            let args = (tc.function && tc.function.arguments) || {};
            if (typeof args === 'string') {
              try {
                args = JSON.parse(args);
              } catch {
                args = {};
              }
            }
            toolCalls.push({ id: uid(), name: tc.function.name, args });
          }
        }
        if (o.done) {
          finalObj = o;
          finishReason = o.done_reason || '';
        }
      } else {
        if (o.error) throw new Error(o.error.message || JSON.stringify(o.error));
        const c = o.choices && o.choices[0];
        const d = (c && c.delta) || {};
        const think = d.reasoning_content || d.reasoning;
        if (think) {
          mark();
          n++;
          thinking += think;
          if (h.onThinking) h.onThinking(thinking, n);
        }
        if (Array.isArray(d.content)) {
          // Manche Server liefern den Inhalt als Teile-Liste (Text und Bilder gemischt)
          const txt = d.content.filter((p) => p && p.type === 'text' && p.text).map((p) => p.text).join('');
          if (txt) { mark(); n++; content += txt; if (h.onContent) h.onContent(content, n); }
          addImages(d.content.filter((p) => p && p.type !== 'text'));
        } else if (d.content) {
          mark();
          n++;
          content += d.content;
          if (h.onContent) h.onContent(content, n);
        }
        if (d.images) addImages(d.images);
        if (c && c.message && c.message.images) addImages(c.message.images);
        if (d.tool_calls) {
          mark();
          for (const t of d.tool_calls) {
            const i = t.index ?? 0;
            const e = oaiTools[i] || (oaiTools[i] = { id: t.id || uid(), name: '', args: '' });
            if (t.id) e.id = t.id;
            if (t.function && t.function.name) e.name += t.function.name;
            if (t.function && t.function.arguments) e.args += t.function.arguments;
          }
        }
        if (c && c.finish_reason) finishReason = c.finish_reason;
        if (o.usage) usage = o.usage;
        if (o.timings) timings = o.timings;
      }
    }

    // Was tatsächlich gesendet wurde (ohne Nachrichtentexte), damit sich Abweichungen zur Weboberfläche eines Servers finden lassen
    const { messages: _m, tools: _t, ...bodyInfo } = body;
    const request = { url, body: bodyInfo, messageCount: wire.length, toolCount: (body.tools || []).length };
    const promise = new Promise((resolve, reject) => {
      openStream(
        { id, url, method: 'POST', headers: headersFor(conn), body: JSON.stringify(body) },
        (line) => {
          if (ollama) {
            let o;
            try {
              o = JSON.parse(line);
            } catch {
              return;
            }
            handleObj(o);
          } else {
            if (!line.startsWith('data:')) return;
            const d = line.slice(5).trim();
            if (!d || d === '[DONE]') return;
            let o;
            try {
              o = JSON.parse(d);
            } catch {
              return;
            }
            handleObj(o);
          }
        },
        (aborted) => {
          const tEnd = now();
          for (const k of Object.keys(oaiTools)) {
            const e = oaiTools[k];
            let args = {};
            try {
              args = e.args ? JSON.parse(e.args) : {};
            } catch {}
            if (e.name) toolCalls.push({ id: e.id, name: e.name, args });
          }
          const stats = { model, ts: Date.now(), estimated: false };
          stats.duration = (tEnd - t0) / 1000;
          stats.ttft = tFirst === null ? null : (tFirst - t0) / 1000;
          const genSec = tFirst === null ? 0 : (tEnd - tFirst) / 1000;
          if (ollama && finalObj && finalObj.eval_count) {
            stats.promptTokens = finalObj.prompt_eval_count || 0;
            stats.completionTokens = finalObj.eval_count;
            stats.tps = finalObj.eval_duration ? finalObj.eval_count / (finalObj.eval_duration / 1e9) : genSec ? finalObj.eval_count / genSec : null;
            stats.promptTps = finalObj.prompt_eval_duration && finalObj.prompt_eval_count ? finalObj.prompt_eval_count / (finalObj.prompt_eval_duration / 1e9) : null;
            stats.loadSec = finalObj.load_duration ? finalObj.load_duration / 1e9 : 0;
            if (finalObj.total_duration) stats.duration = finalObj.total_duration / 1e9;
          } else if (anth && usageA && (numOr0(usageA.output_tokens) > 0 || numOr0(usageA.input_tokens) > 0)) {
            // Claude: input_tokens zählt nur den nicht zwischengespeicherten Teil, der Rest steht in cache_read/cache_creation
            const cRead = numOr0(usageA.cache_read_input_tokens);
            const cWrite = numOr0(usageA.cache_creation_input_tokens);
            stats.promptTokens = numOr0(usageA.input_tokens) + cRead + cWrite;
            stats.completionTokens = numOr0(usageA.output_tokens) || n;
            stats.tps = genSec >= 0.25 && stats.completionTokens ? stats.completionTokens / genSec : null;
            if (cRead) stats.cachedTokens = cRead;
            if (cWrite) stats.cacheWriteTokens = cWrite;
          } else if (usage && (+usage.completion_tokens > 0 || +usage.prompt_tokens > 0)) {
            // Server-Angaben immer als Zahlen lesen (manche liefern Text oder 0 als Platzhalter)
            stats.promptTokens = numOr0(usage.prompt_tokens);
            stats.completionTokens = numOr0(usage.completion_tokens) || n;
            const srvTps = timings ? numOr0(timings.predicted_per_second) : 0;
            stats.tps = srvTps > 0 ? srvTps : genSec >= 0.25 && stats.completionTokens ? stats.completionTokens / genSec : null; // sehr kurze Stöße ergeben keine brauchbare Geschwindigkeit
            const srvPp = timings ? numOr0(timings.prompt_per_second) : 0;
            stats.promptTps = srvPp > 0 ? srvPp : null;
          } else {
            // Server liefert keine Zahlen → Schätzung (1 Stream-Chunk ≈ 1 Token, Prompt ≈ Zeichen/4)
            stats.estimated = true;
            stats.completionTokens = n;
            stats.promptTokens = Math.ceil(JSON.stringify(wire).length / 4);
            stats.tps = genSec >= 0.25 && n ? n / genSec : null;
          }
          stats.totalTokens = (stats.promptTokens || 0) + (stats.completionTokens || 0);
          request.response = { usage: usage || usageA || null, timings: timings || null, finish: finishReason || null }; // zur Fehlersuche unter „Anfrage“
          resolve({ content, thinking, images, toolCalls, stats, aborted, finishReason, thinkBlocks: thinkBlocks.length ? thinkBlocks : null });
        },
        (err) => reject(err)
      );
    });

    return { id, promise, abort: () => api().abort(id), request };
  }

  /* Vom Server selbst gemessene Geschwindigkeit der letzten Anfrage (Strata: /metrics). null, wenn der Server das nicht liefert. */
  async function serverDecodeStats(conn, tokens) {
    if (conn.type === 'ollama' || isAnth(conn)) return null;
    const root = String(conn.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise((r) => setTimeout(r, attempt ? 1500 : 400));
      const j = await getJson(conn, joinUrl(root, '/metrics'));
      const r0 = j && Array.isArray(j.requests) ? j.requests[0] : null;
      if (!r0 || !(+r0.decode_tok_s > 0)) return null;
      const hw = j.hardware || {}; // GPU-Zustand kurz nach der Antwort (für den Geschwindigkeitstest)
      if (!tokens || !r0.output_tokens || Math.abs(r0.output_tokens - tokens) <= Math.max(3, tokens * 0.03)) return { tps: +r0.decode_tok_s, temp: Number.isFinite(+hw.gpu_temp) ? +hw.gpu_temp : null, power: Number.isFinite(+hw.gpu_power) ? +hw.gpu_power : null };
    }
    return null; // Zahl passt nicht zu dieser Antwort (z. B. parallele Anfrage): lieber nichts anzeigen als falsch zuordnen
  }

  /* ───── Modelle laden (Ollama) ───── */
  function pullModel(conn, name, onProgress) {
    const id = uid();
    const promise = new Promise((resolve, reject) => {
      openStream(
        { id, url: joinUrl(conn.baseUrl, '/api/pull'), method: 'POST', headers: headersFor(conn), body: JSON.stringify({ model: name, stream: true }) },
        (line) => {
          let o;
          try {
            o = JSON.parse(line);
          } catch {
            return;
          }
          if (o.error) throw new Error(o.error);
          onProgress(o);
        },
        () => resolve(),
        reject
      );
    });
    return { promise, abort: () => api().abort(id) };
  }

  /* ───── Workspace-Werkzeuge ───── */
  const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
  const WORKSPACE_TOOLS = [
    fn('list_files', 'Listet Dateien und Ordner eines Verzeichnisses im Workspace auf.', { path: { type: 'string', description: 'Relativer Pfad, "." für den Workspace-Stamm' } }, ['path']),
    fn(
      'read_file',
      'Liest eine Datei im Workspace mit vorangestellten Zeilennummern. Unterstützt Textdateien (auch Konfigurationsdateien wie .ini, .json, .yaml, .env, .reg) sowie PDF, Word (.docx), Excel (.xlsx, Blätter als Tabellen mit Formeln), PowerPoint (.pptx) und OpenDocument (.odt, .ods, .odp), deren Text ausgelesen wird. Zeilennummern (Nummer, Tab, Zeile; die Nummern sind nicht Teil der Datei). Große Dateien werden abschnittsweise geliefert: nutze start_line und end_line, nachdem du mit search_text die richtige Stelle gefunden hast. Lies nie eine ganze große Datei, wenn du nur einen Teil brauchst.',
      { path: { type: 'string', description: 'Relativer Dateipfad' }, start_line: { type: 'integer', description: 'Erste Zeile (ab 1), optional' }, end_line: { type: 'integer', description: 'Letzte Zeile, optional' } },
      ['path']
    ),
    fn(
      'edit_file',
      'Ändert eine vorhandene Datei gezielt: ersetzt old_text durch new_text. old_text muss exakt (inkl. Einrückung) und eindeutig in der Datei vorkommen. Bevorzuge dieses Werkzeug gegenüber write_file, damit nicht die ganze Datei neu gesendet werden muss.',
      { path: { type: 'string', description: 'Relativer Dateipfad' }, old_text: { type: 'string', description: 'Exakter zu ersetzender Text' }, new_text: { type: 'string', description: 'Neuer Text' }, replace_all: { type: 'boolean', description: 'Alle Vorkommen ersetzen (Standard: nur ein eindeutiges)' } },
      ['path', 'old_text', 'new_text']
    ),
    fn(
      'write_file',
      'Schreibt eine NEUE Datei im Workspace oder überschreibt eine kleine Datei komplett. Für Änderungen an vorhandenen Dateien nutze edit_file. Fehlende Ordner werden angelegt.',
      { path: { type: 'string', description: 'Relativer Dateipfad' }, content: { type: 'string', description: 'Vollständiger neuer Dateiinhalt' } },
      ['path', 'content']
    ),
    fn(
      'ask_user',
      'Stellt dem Nutzer Rückfragen mit Antwortvorschlägen zum Anklicken. Nutze das, wenn dir Angaben fehlen, die Aufgabe mehrdeutig ist oder es mehrere sinnvolle Wege gibt, statt zu raten. Gib pro Frage 2 bis 5 kurze, konkrete Vorschläge (der Nutzer kann auch selbst etwas eintippen). Stelle höchstens 4 Fragen auf einmal. Danach kommt die Antwort des Nutzers zurück: Warte darauf, statt weiterzumachen.',
      {
        questions: {
          type: 'array',
          description: 'Liste von Fragen',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Die Frage' },
              options: { type: 'array', items: { type: 'string' }, description: 'Antwortvorschläge, kurz und konkret' },
              multiple: { type: 'boolean', description: 'true, wenn mehrere Vorschläge gleichzeitig gewählt werden dürfen' },
            },
            required: ['question', 'options'],
          },
        },
      },
      ['questions']
    ),
    fn('search_text', 'Sucht Text (ohne Beachtung der Groß-/Kleinschreibung) in allen Dateien des Workspace und liefert Datei:Zeile. Damit findest du die Stelle, die du danach mit read_file (start_line/end_line) liest.', { query: { type: 'string' }, path: { type: 'string', description: 'Optionaler Unterordner' } }, ['query']),
    fn(
      'check_tool',
      'Prüft, ob ein Programm auf dem Rechner des Nutzers installiert und im PATH auffindbar ist (z. B. java, python, apktool, jadx). Ohne name: listet vorhandene Paketmanager und Laufzeiten. Rufe das auf, BEVOR du ein Programm benutzt oder dessen Installation vorschlägst. Braucht keine Freigabe.',
      { name: { type: 'string', description: 'Programmname ohne Endung, z. B. \"apktool\". Leer lassen für eine Übersicht.' } },
      []
    ),
    fn(
      'run_command',
      'Führt einen Befehl auf dem Rechner des Nutzers aus (Windows: cmd.exe, oder PowerShell mit shell=\"powershell\") und liefert Exit-Code und Ausgabe. Der Nutzer muss jeden Aufruf freigeben. Die Befehle müssen nicht-interaktiv sein (keine Rückfragen, kein Warten auf Eingabe). Arbeitsordner ist der Workspace. Lange Ausgaben werden gekürzt: filtere sie oder leite sie in eine Datei im Workspace um. Nutze es für vorhandene Programme wie apktool, jadx, git, python, java usw.',
      { command: { type: 'string', description: 'Der vollständige Befehl' }, shell: { type: 'string', enum: ['cmd', 'powershell'], description: 'Standard: cmd' }, cwd: { type: 'string', description: 'Unterordner im Workspace als Arbeitsordner, optional' }, timeout: { type: 'integer', description: 'Zeitlimit in Sekunden, optional' } },
      ['command']
    ),
    fn(
      'install_tool',
      'Bittet den Nutzer, ein fehlendes Programm zu installieren, und führt die Installation nach seiner ausdrücklichen Freigabe über einen Paketmanager aus. Nur nach check_tool aufrufen, wenn das Programm wirklich fehlt und die Aufgabe es braucht. Unter Windows bevorzugt winget (package = Paket-ID, z. B. \"Oracle.JDK.21\"), sonst choco, scoop, pip, pipx oder npm. Frage nicht selbst im Text, sondern rufe dieses Werkzeug auf: die App zeigt dem Nutzer eine Rückfrage mit dem genauen Befehl.',
      { manager: { type: 'string', enum: ['winget', 'choco', 'scoop', 'pip', 'pipx', 'npm', 'apt', 'brew'], description: 'Paketmanager' }, package: { type: 'string', description: 'Paketname bzw. Paket-ID' }, reason: { type: 'string', description: 'Ein Satz: wofür das Programm gebraucht wird' } },
      ['manager', 'package', 'reason']
    ),
    fn(
      'delegate_task',
      'Übergibt eine abgegrenzte Teilaufgabe an einen Unteragenten mit eigenem, frischem Kontext. Der Unteragent darf Dateien nur lesen und suchen und liefert eine kompakte Zusammenfassung mit Fundstellen. Nutze das für umfangreiche Erkundung (z. B. „finde alle Stellen, die X auslösen, und beschreibe den Ablauf“), damit dein eigener Kontext klein bleibt. Die Aufgabe muss in sich verständlich sein, der Unteragent kennt das Gespräch nicht. Mehrere delegate_task-Aufrufe in einer Antwort laufen gleichzeitig.',
      { label: { type: 'string', description: 'Kurzer Titel (wenige Wörter)' }, task: { type: 'string', description: 'Vollständige, eigenständige Aufgabenbeschreibung inklusive gewünschter Ausgabe' } },
      ['label', 'task']
    ),
    fn(
      'propose_new_session',
      'Schlägt dem Nutzer vor, den Kontext zu leeren (oder eine neue Session zu öffnen) und zeigt ihm dafür eine Schaltfläche. Rufe das auf, wenn der Kontext knapp wird (die App weist dich darauf hin), die Arbeit sehr lang geworden ist oder ein Abschnitt abgeschlossen ist. Die App leert dann den Kontext im selben Chat (bzw. öffnet einen neuen Chat) und übergibt automatisch deine Übergabe. Schreibe die Übergabe so, dass jemand ohne den bisherigen Verlauf nahtlos weiterarbeiten kann.',
      {
        reason: { type: 'string', description: 'Ein Satz: warum jetzt eine neue Session sinnvoll ist' },
        summary: { type: 'string', description: 'Vollständige Übergabe: Ziel, Erledigt (mit Dateipfaden und Funktionsnamen), wichtige Entscheidungen und Fakten, offene Punkte' },
        next_steps: { type: 'string', description: 'Der konkrete nächste Schritt für die neue Session' },
      },
      ['reason', 'summary', 'next_steps']
    ),
  ];

  const LLM = { anthropicBase, serverDecodeStats, imageModalities, thinkModeOf, listModels, modelInfo, slotInfo, streamChat, pullModel, splitThink, WORKSPACE_TOOLS, uid, joinUrl };
  root.LLM = LLM;
  if (typeof module !== 'undefined' && module.exports) module.exports = LLM;
})(typeof window !== 'undefined' ? window : globalThis);
