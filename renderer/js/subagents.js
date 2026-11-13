'use strict';
/* ═════════════ Unteragenten ═════════════
   Das Hauptmodell kann mit dem Werkzeug „delegate_task“ Teilaufgaben an Unteragenten geben.
   Jeder Unteragent hat einen eigenen, frischen Kontext (spart Platz im Hauptchat), darf nur lesen und suchen
   und liefert eine kompakte Zusammenfassung zurück. Mehrere Aufrufe in einer Antwort laufen gleichzeitig.
   Die Ansicht oben („Unteragenten“) zeigt, wie viele arbeiten, woran, wie lange und mit welchem Status. */

const SUB = { runs: new Map(), open: false, timer: null, raf: 0, expanded: new Set(), feeds: new Map(), views: new Map() };
const SUB_TOOLS = ['list_files', 'search_text', 'read_file'];
const SUB_STATUS = { running: 'läuft', done: 'abgeschlossen', error: 'fehlgeschlagen', aborted: 'abgebrochen' };

const subOn = () => S.settings.workspace.subagents !== false;
const subRecs = () => (S.chat && S.chat.subagents) || [];
// Ein gespeicherter „läuft“-Eintrag ohne laufenden Prozess stammt aus einer beendeten Sitzung
const subStatus = (r) => (r.status === 'running' && !SUB.runs.has(r.id) ? 'aborted' : r.status);

function subSystem() {
  return `Du bist ein Unteragent. Ein Hauptagent hat dir eine abgegrenzte Teilaufgabe übergeben. Arbeite sie selbstständig ab.
Du hast nur lesende Werkzeuge (list_files, search_text, read_file) im Workspace (${S.settings.workspace.path}). Pfade sind relativ zum Workspace.
Dein Kontext ist begrenzt: Lies nie ganze große Dateien, sondern finde die Stelle mit search_text und lies gezielt mit start_line/end_line.
Erfinde nichts: Nenne nur, was du tatsächlich gelesen hast, und gib Fundstellen als Datei:Zeile an.
Schließe mit einer kompakten Zusammenfassung (höchstens ca. 400 Wörter) ab, die der Hauptagent ohne weiteres Nachlesen verwenden kann. Wenn etwas nicht auffindbar ist, sage das ausdrücklich.`;
}

function subToolLabel(t) {
  const a = t.args || {};
  const target = a.path || a.query || '';
  const name = { list_files: 'Listet', search_text: 'Sucht', read_file: 'Liest' }[t.name] || t.name;
  return `${name}${target ? ' ' + target : ''}`;
}

/* Live-Verlauf eines Unteragenten: Gedanken, Antwort und Werkzeuge je Schritt */
const SUB_FEED_CAP = 40000;
function subFeedText(steps) {
  const out = [];
  for (const st of steps) {
    const p = [`── Schritt ${st.n} ──`];
    if (st.think) p.push('Gedanken:\n' + st.think);
    if (st.text) p.push('Antwort:\n' + st.text);
    for (const t of st.tools) p.push('Werkzeug: ' + t);
    out.push(p.join('\n'));
  }
  const t = out.join('\n\n');
  return t.length > SUB_FEED_CAP ? '[… früherer Teil ausgeblendet]\n' + t.slice(t.length - SUB_FEED_CAP) : t;
}

/* Wird von runTool() aufgerufen */
async function runSubagent(tc, base) {
  const chat = S.runChat || S.chat;
  const a = tc.args || {};
  const task = String(a.task || '').trim();
  if (!task) return { ...base, ok: false, content: 'Fehler: Für den Unteragenten fehlt „task“.' };
  const ws = S.settings.workspace;
  const rec = {
    id: uid(), label: String(a.label || task).replace(/\s+/g, ' ').slice(0, 70), task,
    status: 'running', startedAt: Date.now(), endedAt: null, steps: 0, activity: 'Startet …', prompt: 0, comp: 0, result: '', error: '',
  };
  (chat.subagents || (chat.subagents = [])).push(rec);
  const ctl = { cancel: false, run: null };
  SUB.runs.set(rec.id, ctl);
  subRefresh();

  const conn = activeConn();
  const model = currentModel();
  const maxSteps = Math.min(40, Math.max(2, +ws.subagentSteps || 12));
  const messages = [{ role: 'user', content: task }];
  let nudged = false;
  const steps = [];
  let curStep = null;
  let feedT = null;
  const feedNow = () => {
    feedT = null;
    const txt = subFeedText(steps);
    SUB.feeds.set(rec.id, txt);
    tlSetText(tc.id, txt); // Live-Karte im Chat
    subRefresh(); // Ansicht „Unteragenten“
  };
  const feedSoon = () => { if (!feedT) feedT = setTimeout(feedNow, 150); };
  const feedSync = () => { if (feedT) clearTimeout(feedT); feedNow(); };
  try {
    for (let step = 0; step <= maxSteps; step++) {
      if (ctl.cancel) break;
      const final = step === maxSteps;
      if (final) messages.push({ role: 'user', content: 'Schritt-Limit erreicht. Fasse jetzt ausschließlich anhand des bereits Gelesenen zusammen und nenne, was noch offen ist.' });
      rec.activity = 'Denkt nach …';
      tlAct(tc.id, rec.activity);
      curStep = { n: step + 1, thinkRaw: '', think: '', text: '', tools: [] };
      steps.push(curStep);
      subRefresh();
      const sys = subSystem();
      const cmp = compactMessages(messages, sys);
      let lastPaint = 0;
      const mark = (txt) => { if (Date.now() - lastPaint > 400) { lastPaint = Date.now(); rec.activity = txt; tlAct(tc.id, txt); subRefresh(); } };
      const st = curStep;
      const run = LLM.streamChat({
        conn, model, system: sys, messages: cmp.messages, params: S.settings.params,
        tools: final ? null : LLM.WORKSPACE_TOOLS.filter((t) => SUB_TOOLS.includes(t.function ? t.function.name : t.name)),
        thinkLevel: S.settings.thinking,
        handlers: {
          onContent: (full) => { const sp = LLM.splitThink(full || ''); st.text = sp.answer; st.think = [st.thinkRaw, sp.think].filter(Boolean).join('\n'); mark(sp.answer ? 'Schreibt Antwort …' : 'Denkt nach …'); feedSoon(); },
          onThinking: (t) => { st.thinkRaw = t || ''; st.think = st.thinkRaw; mark('Denkt nach …'); feedSoon(); },
        },
      });
      ctl.run = run;
      let res;
      try { res = await run.promise; } finally { ctl.run = null; feedSync(); }
      if (res && res.stats) { rec.prompt += res.stats.promptTokens || 0; rec.comp += res.stats.completionTokens || 0; }
      rec.steps++;
      if (!res || res.aborted || ctl.cancel) { rec.status = 'aborted'; break; }
      let content = res.content || '';
      const sp = LLM.splitThink(content);
      if (sp.think) content = sp.answer;
      const calls = res.toolCalls || [];
      if (!calls.length || final) {
        if (!content.trim() && !nudged && !final) { // leere Antwort nach Werkzeug-Ergebnis: einmal nachfassen
          nudged = true;
          messages.push({ role: 'user', content: 'Fasse jetzt dein Ergebnis zusammen.' });
          continue;
        }
        if (!content.trim()) throw new Error('Der Unteragent hat keine Antwort geliefert.');
        rec.result = content.trim();
        rec.status = 'done';
        break;
      }
      messages.push({ role: 'assistant', content, toolCalls: calls });
      for (const t of calls) {
        if (ctl.cancel) break;
        rec.activity = subToolLabel(t);
        tlAct(tc.id, rec.activity);
        subRefresh();
        const tline = { label: subToolLabel(t) };
        curStep.tools.push(tline.label + ' …');
        feedSync();
        let out;
        if (!SUB_TOOLS.includes(t.name)) out = { ok: false, result: 'Dieses Werkzeug ist für Unteragenten nicht erlaubt (nur list_files, search_text, read_file).' };
        else {
          try { out = await api.ws.tool({ root: ws.path, name: t.name, args: t.args, maxKB: +ws.readKB || 40, ignore: ignoreList() }); }
          catch (e) { out = { ok: false, result: 'Fehler: ' + e.message }; }
        }
        curStep.tools[curStep.tools.length - 1] = `${tline.label} → ${out.ok ? 'ok' : 'Fehler'} (${fmt.num(String(out.result || '').length)} Zeichen)`;
        feedSync();
        messages.push({ role: 'tool', name: t.name, toolCallId: t.id, args: t.args, content: out.result, ok: out.ok });
      }
    }
    if (rec.status === 'running') rec.status = ctl.cancel ? 'aborted' : 'error';
    if (rec.status === 'error' && !rec.error) rec.error = 'Ohne Ergebnis beendet.';
  } catch (e) {
    rec.status = ctl.cancel ? 'aborted' : 'error';
    rec.error = e.message;
  } finally {
    feedSync();
    rec.feed = (SUB.feeds.get(rec.id) || '').slice(-12000); // Verlauf bleibt im Chat einsehbar
    rec.endedAt = Date.now();
    rec.activity = '';
    SUB.runs.delete(rec.id);
    subRefresh();
    saveChatSoon(S.runChat || S.chat);
  }
  const secs = (rec.endedAt - rec.startedAt) / 1000;
  const head = `Unteragent „${rec.label}“ ${SUB_STATUS[rec.status]} (${rec.steps} Schritte, ${fmt.dur(secs)})`;
  if (rec.status === 'done') return { ...base, ok: true, content: head + '\n\n' + (rec.result.length > 8000 ? rec.result.slice(0, 8000) + '\n[… gekürzt]' : rec.result) };
  return { ...base, ok: false, content: head + (rec.error ? '\nGrund: ' + rec.error : '') };
}

function abortSubagents() {
  for (const ctl of SUB.runs.values()) {
    ctl.cancel = true;
    if (ctl.run) ctl.run.abort();
  }
}

/* ───── Ansicht ───── */
function subRefresh() {
  if (SUB.raf) return;
  SUB.raf = requestAnimationFrame(() => {
    SUB.raf = 0;
    subRender();
  });
}

function subDur(r) {
  return fmt.dur(((r.endedAt || Date.now()) - r.startedAt) / 1000);
}

function subRender() {
  const btn = $('#btn-agents');
  if (!btn) return;
  const recs = subRecs();
  const running = recs.filter((r) => subStatus(r) === 'running').length;
  btn.classList.toggle('busy', running > 0);
  btn.classList.toggle('hidden', !subOn() && !recs.length);
  btn.innerHTML = icon('agents', 16) + '<span>Unteragenten</span>' + (recs.length ? `<span class="ag-count${running ? ' run' : ''}">${running ? running + ' läuft' : recs.length}</span>` : '') + `<span class="ag-chev${SUB.open ? ' up' : ''}">${icon('chevron', 13)}</span>`;
  if (running && !SUB.timer) SUB.timer = setInterval(() => (SUB.open ? subRender() : null), 1000);
  if (!running && SUB.timer) { clearInterval(SUB.timer); SUB.timer = null; }

  const pop = $('#agents-pop');
  if (!pop) return;
  pop.classList.toggle('hidden', !SUB.open);
  if (!SUB.open) return;
  const by = { running: 0, done: 0, error: 0, aborted: 0 };
  recs.forEach((r) => by[subStatus(r)]++);
  const sum = recs.length
    ? [by.running && `${by.running} arbeiten`, by.done && `${by.done} abgeschlossen`, by.error && `${by.error} fehlgeschlagen`, by.aborted && `${by.aborted} abgebrochen`].filter(Boolean).join(' · ')
    : '';
  const list = el('div', { class: 'ag-list' });
  if (!recs.length) {
    list.append(el('div', { class: 'ag-empty', text: 'Keine Unteragenten aufgezeichnet' }, ));
    if (!subOn()) list.append(el('div', { class: 'ag-hint', text: 'Unteragenten sind in den Einstellungen (Workspace & Dateien) ausgeschaltet.' }));
    else if (!useTools()) list.append(el('div', { class: 'ag-hint', text: 'Schalte „Dateizugriff“ unter dem Eingabefeld ein: Nur dann kann die KI Unteragenten starten.' }));
  }
  for (const r of [...recs].reverse()) {
    const st = subStatus(r);
    const open = SUB.expanded.has(r.id);
    const ico = st === 'running' ? '<span class="ag-spin"></span>' : icon(st === 'done' ? 'check' : st === 'error' ? 'x' : 'stop', 14, 2.2);
    const card = el('div', { class: 'ag-card ' + st + (open ? ' open' : '') },
      el('div', { class: 'ag-row1' },
        el('span', { class: 'ag-ico', html: ico }),
        el('b', { class: 'ag-label', text: r.label }),
        el('span', { class: 'ag-state', text: SUB_STATUS[st] }),
        st === 'running' ? el('button', { class: 'ag-cancel', text: 'Stopp', title: 'Diesen Unteragenten abbrechen', onclick: (e) => { e.stopPropagation(); const c = SUB.runs.get(r.id); if (c) { c.cancel = true; if (c.run) c.run.abort(); } } }) : null),
      el('div', { class: 'ag-task', text: r.task }),
      st === 'running' && r.activity ? el('div', { class: 'ag-act', text: r.activity }) : null,
      el('div', { class: 'ag-meta' },
        el('span', { text: `${r.steps} Schritt${r.steps === 1 ? '' : 'e'}` }),
        el('span', { text: `↑ ${fmt.tok(r.prompt)} · ↓ ${fmt.tok(r.comp)}`, title: 'Verbrauchte Tokens (Prompt · Antwort), summiert über alle Schritte' }),
        el('span', { text: subDur(r), title: st === 'running' ? 'Bisherige Laufzeit' : 'Gesamtdauer' })),
      open ? el('div', { class: 'ag-detail' },
        el('div', { class: 'ag-dl', text: 'Aufgabe' }), el('pre', { text: r.task }),
        subFeedView(r) ? el('div', { class: 'ag-dl', text: st === 'running' ? 'Live-Verlauf (Gedanken, Antwort, Werkzeuge)' : 'Verlauf' }) : null, subFeedView(r),
        r.result ? el('div', { class: 'ag-dl', text: 'Ergebnis' }) : null, r.result ? el('pre', { text: r.result }) : null,
        r.error ? el('div', { class: 'ag-dl', text: 'Fehler' }) : null, r.error ? el('pre', { text: r.error }) : null) : null);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ag-detail')) return; // Klicks im Detail (Markieren, Scrollen) klappen die Karte nicht zu
      SUB.expanded.has(r.id) ? SUB.expanded.delete(r.id) : SUB.expanded.add(r.id);
      subRender();
    });
    list.append(card);
  }
  const oldList = $('.ag-list', pop);
  const keepTop = oldList ? oldList.scrollTop : 0;
  pop.replaceChildren(
    el('div', { class: 'ag-head' }, el('b', { text: 'Unteragenten' }), el('span', { class: 'ag-sum', text: sum }), el('button', { class: 'icon-btn', html: icon('x', 15), title: 'Schließen', onclick: () => { SUB.open = false; subRender(); } })),
    list);
  list.scrollTop = keepTop;
  for (const v of SUB.views.values()) followApply(v); // Verlaufsfelder: unten bleiben oder Nutzer-Position halten
}

/* Verlaufsfeld eines Unteragenten. Das Element bleibt erhalten, damit Scroll-Zustand nicht verloren geht. */
function subFeedView(r) {
  const txt = SUB.feeds.get(r.id) || r.feed || '';
  if (!txt) return null;
  let v = SUB.views.get(r.id);
  if (!v) {
    v = el('pre', { class: 'ag-feed' });
    followAttach(v);
    if (subStatus(r) !== 'running') { v._follow = false; v._top = 0; } // abgeschlossene Läufe von oben lesen
    SUB.views.set(r.id, v);
  }
  if (subStatus(r) !== 'running' && v._follow && v._txt !== undefined && v._txt !== txt) { v._follow = false; v._top = v.scrollTop; }
  followSet(v, txt);
  return v;
}

function initSubagents() {
  const btn = $('#btn-agents');
  if (!btn) return;
  const pop = el('div', { id: 'agents-pop', class: 'agents-pop hidden' });
  document.body.append(pop);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    SUB.open = !SUB.open;
    if (SUB.open) {
      const r = btn.getBoundingClientRect();
      pop.style.left = Math.max(8, r.left) + 'px';
      pop.style.top = r.bottom + 8 + 'px';
    }
    subRender();
  });
  document.addEventListener('click', (e) => { if (SUB.open && !pop.contains(e.target) && !btn.contains(e.target)) { SUB.open = false; subRender(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && SUB.open) { SUB.open = false; subRender(); } });
  subRender();
}
