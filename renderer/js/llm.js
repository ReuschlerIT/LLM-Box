/* LLM-Schicht: Ollama (/api/chat) und OpenAI-kompatibel (/chat/completions).
   Streaming, Token-Metriken (tok/s, Prompt, Antwort, Gesamt, TTFT) und Workspace-Werkzeuge. */
(function (root) {
  'use strict';
  const api = () => root.api;
  const now = () => (root.performance ? root.performance.now() : Date.now());
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const joinUrl = (base, p) => String(base || '').replace(/\/+$/, '') + p;

  function headersFor(conn) {
    const h = { 'Content-Type': 'application/json' };
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
    else if (/think|reasoning/i.test(msg)) hint = ' – Dieses Modell unterstützt die Denk-Einstellung nicht. Stelle „Denken“ im Eingabefeld auf Auto.';
    else if (/tool/i.test(msg)) hint = ' – Dieses Modell unterstützt keine Werkzeuge. Schalte den KI-Dateizugriff aus oder wähle ein anderes Modell.';
    return `HTTP ${status}: ${msg}${hint}`;
  }

  /* ───── Modelle ───── */
  async function listModels(conn) {
    const url = conn.type === 'ollama' ? joinUrl(conn.baseUrl, '/api/tags') : joinUrl(conn.baseUrl, '/models');
    const res = await api().fetch({ url, method: 'GET', headers: headersFor(conn) });
    if (!res.ok) throw new Error(res.error || errorText(res.status, res.text));
    const j = JSON.parse(res.text);
    if (conn.type === 'ollama') return (j.models || []).map((m) => ({ id: m.name, size: m.size, details: m.details }));
    return (j.data || j.models || []).map((m) => ({ id: m.id || m.name, raw: m })).filter((m) => m.id);
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
      const res = await api().fetch({ url, method: method || 'GET', headers: headersFor(conn), body });
      if (!res.ok) return null;
      return JSON.parse(res.text);
    } catch {
      return null;
    }
  }

  async function modelInfo(conn, modelId, models) {
    const info = { ctx: null, ctxKey: '', ctxSource: '', runtime: false, answered: [], candidates: [], entryKeys: [] };
    const cands = [];
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
    if (conn.type === 'ollama') return null;
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
  const fileBlock = (f) => `<file name="${f.name}">\n${f.text}\n</file>`;
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
        if (!m.content && !calls.length) continue;
        const o = { role: 'assistant', content: m.content || '' };
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

  function buildOptions(conn, p) {
    const has = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(v);
    const stop = String(p.stop || '')
      .split('|')
      .map((s) => s.replace(/\\n/g, '\n'))
      .filter((s) => s.length);
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
  const thinkModeOf = (conn) => conn.thinkMode || (conn.extraParams ? 'template' : 'effort');
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

  function streamChat({ conn, model, system, messages, params, tools, thinkLevel, handlers }) {
    const id = uid();
    const ollama = conn.type === 'ollama';
    const h = handlers || {};
    const wire = toWire(conn, system, messages);
    const opts = buildOptions(conn, params || {});
    let body;
    if (ollama) {
      body = { model, messages: wire, stream: true, options: opts };
      if (params && params.keepAlive) body.keep_alive = params.keepAlive;
    } else {
      body = { model, messages: wire, stream: true, stream_options: { include_usage: true }, ...opts };
    }
    if (tools && tools.length) body.tools = tools;
    applyThinking(conn, body, thinkLevel, model);
    const url = joinUrl(conn.baseUrl, ollama ? '/api/chat' : '/chat/completions');

    let content = '';
    let thinking = '';
    let n = 0;
    const toolCalls = [];
    const oaiTools = {};
    let usage = null;
    let timings = null;
    let finalObj = null;
    let finishReason = '';
    const t0 = now();
    let tFirst = null;
    const mark = () => {
      if (tFirst === null) tFirst = now();
    };

    function handleObj(o) {
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
        if (d.content) {
          mark();
          n++;
          content += d.content;
          if (h.onContent) h.onContent(content, n);
        }
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
          } else if (usage) {
            stats.promptTokens = usage.prompt_tokens || 0;
            stats.completionTokens = usage.completion_tokens || 0;
            stats.tps = timings && timings.predicted_per_second ? timings.predicted_per_second : genSec && stats.completionTokens ? stats.completionTokens / genSec : null;
            stats.promptTps = timings && timings.prompt_per_second ? timings.prompt_per_second : null;
          } else {
            // Server liefert keine Zahlen → Schätzung (1 Stream-Chunk ≈ 1 Token, Prompt ≈ Zeichen/4)
            stats.estimated = true;
            stats.completionTokens = n;
            stats.promptTokens = Math.ceil(JSON.stringify(wire).length / 4);
            stats.tps = genSec && n ? n / genSec : null;
          }
          stats.totalTokens = (stats.promptTokens || 0) + (stats.completionTokens || 0);
          resolve({ content, thinking, toolCalls, stats, aborted, finishReason });
        },
        (err) => reject(err)
      );
    });

    return { id, promise, abort: () => api().abort(id) };
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
      'Liest eine Textdatei im Workspace mit vorangestellten Zeilennummern (Nummer, Tab, Zeile; die Nummern sind nicht Teil der Datei). Große Dateien werden abschnittsweise geliefert: nutze start_line und end_line, nachdem du mit search_text die richtige Stelle gefunden hast. Lies nie eine ganze große Datei, wenn du nur einen Teil brauchst.',
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
      'Schlägt dem Nutzer eine neue Session vor und zeigt ihm dafür eine Schaltfläche. Rufe das auf, wenn der Kontext knapp wird (die App weist dich darauf hin), die Arbeit sehr lang geworden ist oder ein Abschnitt abgeschlossen ist. Die App öffnet dann einen neuen Chat und übergibt automatisch deine Übergabe. Schreibe die Übergabe so, dass jemand ohne den bisherigen Verlauf nahtlos weiterarbeiten kann.',
      {
        reason: { type: 'string', description: 'Ein Satz: warum jetzt eine neue Session sinnvoll ist' },
        summary: { type: 'string', description: 'Vollständige Übergabe: Ziel, Erledigt (mit Dateipfaden und Funktionsnamen), wichtige Entscheidungen und Fakten, offene Punkte' },
        next_steps: { type: 'string', description: 'Der konkrete nächste Schritt für die neue Session' },
      },
      ['reason', 'summary', 'next_steps']
    ),
  ];

  const LLM = { thinkModeOf, listModels, modelInfo, slotInfo, streamChat, pullModel, splitThink, WORKSPACE_TOOLS, uid, joinUrl };
  root.LLM = LLM;
  if (typeof module !== 'undefined' && module.exports) module.exports = LLM;
})(typeof window !== 'undefined' ? window : globalThis);
