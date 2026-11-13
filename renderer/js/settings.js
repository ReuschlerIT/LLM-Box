'use strict';

const DEFAULTS = {
  connections: [
    { id: 'strata_api', name: 'Strata_API', type: 'openai', baseUrl: 'http://localhost:8080/v1', apiKey: '', extraParams: true, thinkMode: 'template' },
  ],
  activeConnection: 'strata_api',
  spell: { enabled: true, lang: 'de-en' },
  model: '',
  thinking: 'auto',
  systemPrompt: `Du bist ein autonomer Analyse- und Entwicklungs-Agent.

SPRACHE
Antworte und denke ausschließlich auf Deutsch (außer bei Code-Syntax).

WERKZEUGE
Nutze alle verfügbaren Werkzeuge frei. Prüfe zuerst, ob im Workspace bereits ein passendes
vorbereitetes Skript (.ps1, .py, .jar, .cmd) existiert, bevor du etwas neu baust oder nachinstallierst.
Fehlt ein Werkzeug ganz, installiere oder baue es selbständig.

AUTONOMIE
Installiere, führe aus, ändere und lösche ohne Rückfrage, solange es dem Projektziel im
Workspace dient. Nur bei systemweiten, fremden oder produktiven Eingriffen außerhalb des
Projekts erst nachfragen. Bei Mehrdeutigkeit: sinnvolle Annahme treffen, kurz nennen, weitermachen.

UNTERAGENTEN
Teile größere Aufgaben in Teilaufgaben auf und bearbeite sie mit mehreren parallelen
Unteragenten (z. B. nach Modul, Analyse-Kategorie oder Pipeline-Schritt), statt alles seriell
abzuarbeiten. Jeder Unteragent bekommt ein klares Teilziel und einen eigenen Ausgabebereich.
Führe die Ergebnisse am Ende zu einer zusammenhängenden Antwort zusammen.

ÄNDERUNGEN.MD (Pflicht bei jedem Teilschritt)
Führe im Projekt-Wurzelverzeichnis eine Datei Änderungen.md, in der nach jedem Teilschritt
(auch von Unteragenten) ein kurzer, chronologischer Eintrag ergänzt wird:
- Was wurde gemacht (Aktion, betroffene Datei/Skript)
- Warum (Ziel/Annahme, falls eine getroffen wurde)
- Ergebnis/Fundstelle (z. B. Ausgabedatei, Auffälligkeit)
- Offene Punkte / nächster sinnvoller Schritt
Schreibe immer nur an (nichts Bestehendes löschen oder umschreiben), kurz und stichpunktartig,
keine Rohdaten-Dumps. Die Datei muss so verständlich sein, dass eine KI in einem neuen Chat
allein anhand von Änderungen.md nahtlos weiterarbeiten kann, ohne den bisherigen Chatverlauf zu kennen.
Lies zu Beginn jeder Sitzung zuerst Änderungen.md, falls vorhanden, bevor du weitermachst.

ARBEITSWEISE
Lege Zwischenergebnisse strukturiert ab (Namensschema 01-…, 02-… üblich).
Fasse Ergebnisse am Ende klar zusammen, nicht nur als Rohdaten-Dump.
Gefundene sensible Werte (Keys, Tokens, Auth-Header) sind Analyseergebnis zur Dokumentation,
kein Mittel für Zugriff auf fremde, nicht dir gehörende Konten/Server.`,
  params: { temperature: 0.7, topP: 0.9, topK: 40, repeatPenalty: 1.1, maxTokens: null, numCtx: 8192, autoCtx: true, minP: null, presencePenalty: null, seed: null, stop: '', keepAlive: '5m' },
  appearance: {
    theme: 'light', accent: '#0b5cff', fontSize: 15, showStats: true, enterToSend: true, thinkOpen: false, calmDuringGen: true, thinkLang: 'auto', thinkInGerman: false, winMaterial: 'none', accentAlpha: null, alpha: { dark: {}, light: {} },
    fontFamily: 'default', fontFamilyCustom: '', codeFont: 'default', codeFontCustom: '',
    lineHeight: 1.65, messageWidth: 820, radius: 10, sidebarWidth: 268,
    bgMode: 'brand', bgImage: '', bgOpacity: 75, bgBlur: 0,
    custom: { dark: {}, light: {} },
  },
  server: {
    connId: '', pollSec: 2, dock: false,
    target: { mode: 'local', bin: 'strata', host: '', user: '', port: 22, key: '', remoteOs: 'linux' },
    launch: { preset: '', family: '', model: '', modelPath: '', dataDir: '', context: '', kv: '', vision: '', parallel: '', mtp: '', tune: '', gpu: '', access: '', port: '', apiKey: '', noApiKey: false, extra: '', savePreset: '', restart: false },
  },
  pricing: { enabled: true, eur: true, preset: 'avg', priceIn: 1.8, priceOut: 9.6, usdToEur: 0.9 },
  workspace: { path: '', toolsEnabled: false, askUser: true, askUserAlways: false, subagents: true, subagentSteps: 12, handoff: true, handoffMode: 'clear', handoffPct: 70, handoffAutoSend: true, approval: 'write', execEnabled: true, execTimeout: 120, maxSteps: 25, readKB: 40, autoCompact: true, ctxBudgetPct: 80, keepToolResults: 3, maxFileKB: 512, maxFiles: 60, maxTotalKB: 1024, ignore: 'node_modules,.git,.venv,__pycache__,dist,build,.next,.idea,.vscode' },
};

const PRESETS = [
  { name: 'Ollama', type: 'ollama', baseUrl: 'http://localhost:11434' },
  { name: 'LM Studio', type: 'openai', baseUrl: 'http://localhost:1234/v1', extraParams: true },
  { name: 'Strata', type: 'openai', baseUrl: 'http://localhost:8080/v1', extraParams: true, thinkMode: 'template' },
  { name: 'llama.cpp / llamafile', type: 'openai', baseUrl: 'http://localhost:8080/v1', extraParams: true, thinkMode: 'template' },
  { name: 'vLLM', type: 'openai', baseUrl: 'http://localhost:8000/v1', extraParams: true, thinkMode: 'template' },
  { name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', thinkMode: 'openrouter' },
  { name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  { name: 'Eigene (OpenAI-kompatibel)', type: 'openai', baseUrl: 'http://localhost:5000/v1' },
];

/* US-Listenpreise (USD je 1 Mio. Token, Standard-Tarif, Stand Oktober/November 2026). Die App rechnet sie mit dem Wechselkurs in € um und arbeitet danach nur noch mit Euro. Preise ändern sich – bitte gelegentlich prüfen. */
const PRICE_PRESETS = [
  { id: 'avg', label: 'Mittelwert großer Anbieter (Standard)', in: 2.0, out: 10.67, note: 'Mittel aus GPT-6.1 Sol (2 $ / 10 $), Claude Sonnet 5.5 (2 $ / 10 $) und Gemini 3.1 Pro (2 $ / 12 $).' },
  { id: 'gpt6astra', label: 'OpenAI GPT-6 Astra (Flaggschiff)', in: 10, out: 50 },
  { id: 'gpt61sol', label: 'OpenAI GPT-6.1 Sol', in: 2, out: 10 },
  { id: 'fable51', label: 'Claude Fable 5.1 (Flaggschiff)', in: 10, out: 50 },
  { id: 'opus55', label: 'Claude Opus 5.5', in: 4, out: 20 },
  { id: 'sonnet55', label: 'Claude Sonnet 5.5', in: 2, out: 10 },
  { id: 'haiku55', label: 'Claude Haiku 5.5 (günstig)', in: 0.1, out: 0.5 },
  { id: 'gemini31pro', label: 'Google Gemini 3.1 Pro', in: 2, out: 12 },
  { id: 'gemini38flash', label: 'Google Gemini 3.8 Flash (günstig)', in: 0.75, out: 3.75 },
  { id: 'free', label: 'Kostenlos (lokal, nur Tokens zählen)', in: 0, out: 0 },
  { id: 'custom', label: 'Eigene Werte (in €)', in: null, out: null },
];

const presetEur = (x, rate) => ({ in: Math.round(x.in * rate * 1000) / 1000, out: Math.round(x.out * rate * 1000) / 1000 });

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
function setPath(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] = a[k] || {}), o);
  t[last] = v;
}
const ignoreList = () => String(S.settings.workspace.ignore || '').split(',').map((s) => s.trim()).filter(Boolean);
const fileLimits = () => {
  const w = S.settings.workspace;
  return { maxKB: +w.maxFileKB || 512, maxFiles: +w.maxFiles || 60, maxTotalKB: +w.maxTotalKB || 1024, ignore: ignoreList() };
};

/* ───── Eingabe-Helfer ───── */
function frow(label, hint, ctrl, stack) {
  return el('div', { class: 'frow' + (stack ? ' stack' : '') }, el('div', { class: 'flabel' }, el('div', { text: label }), hint ? el('div', { class: 'fhint', text: hint }) : null), el('div', { class: 'fctrl' }, ctrl));
}
function bindText(path, { type = 'text', placeholder = '' } = {}) {
  const i = el('input', { type, value: getPath(S.settings, path) ?? '', placeholder });
  i.addEventListener('input', () => {
    setPath(S.settings, path, i.value);
    changed();
  });
  return i;
}
function bindNumber(path, { min, max, step = 1, placeholder = 'Standard' } = {}) {
  const v = getPath(S.settings, path);
  const i = el('input', { type: 'number', value: v ?? '', min, max, step, placeholder });
  i.addEventListener('input', () => {
    setPath(S.settings, path, i.value === '' ? null : +i.value);
    changed();
  });
  return i;
}
function bindSlider(path, min, max, step) {
  const val = getPath(S.settings, path);
  const r = el('input', { type: 'range', min, max, step, value: val ?? min });
  const n = el('input', { type: 'number', min, max, step, value: val ?? '' });
  r.addEventListener('input', () => {
    n.value = r.value;
    setPath(S.settings, path, +r.value);
    changed();
  });
  n.addEventListener('input', () => {
    if (n.value !== '') r.value = n.value;
    setPath(S.settings, path, n.value === '' ? null : +n.value);
    changed();
  });
  return [r, n];
}
function bindSwitch(path) {
  const i = el('input', { type: 'checkbox' });
  i.checked = !!getPath(S.settings, path);
  i.addEventListener('change', () => {
    setPath(S.settings, path, i.checked);
    changed();
  });
  return el('label', { class: 'switch' }, i, el('span'));
}
function bindSelect(path, options) {
  const s = el('select', {}, options.map((o) => el('option', { value: o.value, text: o.label })));
  s.value = getPath(S.settings, path);
  s.addEventListener('change', () => {
    setPath(S.settings, path, s.value);
    changed();
  });
  return s;
}
function bindTextarea(path, rows = 5) {
  const t = el('textarea', { rows });
  t.value = getPath(S.settings, path) || '';
  t.addEventListener('input', () => {
    setPath(S.settings, path, t.value);
    changed();
  });
  return t;
}
const changed = () => {
  saveSettings();
  if (typeof settingsChanged === 'function') settingsChanged();
};

/* ───── Tabs ───── */
function tabConnections() {
  const wrap = el('div');
  let sel = S.settings.activeConnection;
  let pullRun = null;

  function render() {
    wrap.innerHTML = '';
    const conns = S.settings.connections;
    if (!conns.find((c) => c.id === sel)) sel = conns[0] && conns[0].id;
    const conn = conns.find((c) => c.id === sel);

    const list = el('div', { class: 'conn-list' },
      conns.map((c) => el('button', { class: c.id === sel ? 'active' : '', text: c.name, onclick: () => { sel = c.id; render(); } })),
      el('div', { style: { marginTop: '10px' } }, (() => {
        const s = el('select', { style: { width: '100%' } }, el('option', { value: '', text: '+ Verbindung hinzufügen …' }), PRESETS.map((p, i) => el('option', { value: i, text: p.name })));
        s.addEventListener('change', () => {
          if (s.value === '') return;
          const p = PRESETS[+s.value];
          const c = { id: uid(), name: p.name, type: p.type, baseUrl: p.baseUrl, apiKey: '', extraParams: !!p.extraParams, thinkMode: p.thinkMode || 'effort' };
          conns.push(c);
          if (!S.settings.activeConnection) S.settings.activeConnection = c.id; // erste Verbindung wird automatisch die aktive
          sel = c.id;
          changed();
          render();
        });
        return s;
      })())
    );

    const editor = el('div');
    if (conn) {
      const nameIn = el('input', { type: 'text', value: conn.name });
      nameIn.addEventListener('input', () => { conn.name = nameIn.value; changed(); });
      const typeSel = el('select', {}, el('option', { value: 'ollama', text: 'Ollama (native API)' }), el('option', { value: 'openai', text: 'OpenAI-kompatibel' }));
      typeSel.value = conn.type;
      typeSel.addEventListener('change', () => { conn.type = typeSel.value; changed(); render(); });
      const urlIn = el('input', { type: 'text', value: conn.baseUrl, placeholder: 'http://localhost:11434' });
      urlIn.addEventListener('input', () => { conn.baseUrl = urlIn.value.trim(); changed(); });
      const keyIn = el('input', { type: 'password', value: conn.apiKey || '', placeholder: 'optional bei lokalen Servern' });
      keyIn.addEventListener('input', () => { conn.apiKey = keyIn.value.trim(); changed(); });
      const extra = el('input', { type: 'checkbox' });
      extra.checked = !!conn.extraParams;
      extra.addEventListener('change', () => { conn.extraParams = extra.checked; changed(); });

      const thinkSel = el('select', {}, [['effort', 'reasoning_effort (OpenAI, LM Studio, vLLM)'], ['template', 'Chat-Template (llama.cpp, vLLM, Qwen3)'], ['openrouter', 'reasoning (OpenRouter)'], ['none', 'Nicht senden']].map(([v, l]) => el('option', { value: v, text: l })));
      thinkSel.value = LLM.thinkModeOf(conn);
      thinkSel.addEventListener('change', () => { conn.thinkMode = thinkSel.value; changed(); });

      const imgSel = el('select', {}, [['auto', 'Automatisch (nach Modellname, z. B. „…-image“)'], ['on', 'Immer anfordern'], ['off', 'Nie anfordern']].map(([v, l]) => el('option', { value: v, text: l })));
      imgSel.value = conn.imageOutput || 'auto';
      imgSel.addEventListener('change', () => { conn.imageOutput = imgSel.value; changed(); });

      const sampSel = el('select', {}, [['app', 'Von der App senden (Temperatur, Top-P, Top-K, Penalty … aus „Modell & Parameter“)'], ['server', 'Dem Server überlassen (nichts davon senden)']].map(([v, l]) => el('option', { value: v, text: l })));
      sampSel.value = conn.samplingMode || 'app';
      sampSel.addEventListener('change', () => { conn.samplingMode = sampSel.value; changed(); });

      const pIn = el('input', { type: 'number', min: 0, step: 0.01, value: conn.priceIn ?? '', placeholder: 'global' });
      const pOut = el('input', { type: 'number', min: 0, step: 0.01, value: conn.priceOut ?? '', placeholder: 'global' });
      pIn.addEventListener('input', () => { conn.priceIn = pIn.value === '' ? null : +pIn.value; changed(); });
      pOut.addEventListener('input', () => { conn.priceOut = pOut.value === '' ? null : +pOut.value; changed(); });

      const speedOut = el('pre', { class: 'speed-result hidden' });
      const speedBtn = el('button', { class: 'btn', text: 'Geschwindigkeit testen', title: 'Sendet mehrere kurze Testanfragen und vergleicht die Geschwindigkeit je nach Anfrage-Art', onclick: async () => {
        speedBtn.disabled = true;
        speedOut.classList.remove('hidden');
        try { await runSpeedTest(conn, (t) => { speedOut.textContent = t; }); } catch (e) { speedOut.textContent = 'Test fehlgeschlagen: ' + e.message; }
        speedBtn.disabled = false;
      } });
      const diagOut = el('pre', { class: 'speed-result hidden' });
      const diagBtn = el('button', { class: 'btn', text: 'Verbindung genau prüfen', title: 'Fragt die wichtigen Adressen einzeln ab und zeigt Statuscode, Fehler und mögliche Ursache', onclick: async () => {
        diagBtn.disabled = true;
        diagOut.classList.remove('hidden');
        diagOut.textContent = 'Prüfe …';
        try { await diagnoseConnection(conn, (t) => { diagOut.textContent = t; }); } catch (e) { diagOut.textContent = 'Prüfung fehlgeschlagen: ' + e.message; }
        diagBtn.disabled = false;
      } });
      const result = el('div', { class: 'test-result' });
      const testBtn = el('button', { class: 'btn', text: 'Verbindung testen', onclick: async () => {
        result.className = 'test-result';
        result.textContent = 'Teste …';
        try {
          const models = await LLM.listModels(conn);
          result.className = 'test-result ok';
          result.textContent = `Verbunden – ${models.length} Modell${models.length === 1 ? '' : 'e'} gefunden.`;
          const mid = (conn.id === S.settings.activeConnection && S.settings.model && models.some((m) => m.id === S.settings.model)) ? S.settings.model : (models[0] && models[0].id);
          if (mid) {
            const inf = await LLM.modelInfo(conn, mid, models);
            result.textContent += inf.ctx
              ? `\nKontext laut Server: ${fmt.num(inf.ctx)} Tokens (${inf.ctxKey} aus ${inf.ctxSource}${inf.runtime ? '' : ', Trainings-Maximum'}).`
              : `\nKeine Kontextgröße gefunden. Antwortende Endpunkte: ${inf.answered.join(', ') || 'keine'}. Felder von /models: ${inf.entryKeys.join(', ') || '–'}. Trage die Kontextlänge dann unter „Modell & Parameter“ von Hand ein oder wähle die Strata-Konfigdatei.${inf.cfgError ? ' Konfigdatei: ' + inf.cfgError : ''}`;
          }
        } catch (e) {
          result.className = 'test-result err';
          result.textContent = e.message + (conn.type === 'ollama' ? '\nLäuft Ollama? Starte es mit „ollama serve“.' : '') + '\n\nTipp: „Verbindung genau prüfen“ zeigt, woran es liegt.';
        }
      } });
      const delBtn = el('button', { class: 'btn danger', text: 'Entfernen', onclick: async () => {
        if (!(await confirmModal('Verbindung entfernen', `„${conn.name}“ wirklich entfernen?`, { okLabel: 'Entfernen', danger: true }))) return;
        S.settings.connections = conns.filter((c) => c.id !== conn.id);
        if (S.settings.activeConnection === conn.id) S.settings.activeConnection = S.settings.connections[0] ? S.settings.connections[0].id : '';
        changed();
        render();
        refreshModels();
      } });

      editor.append(
        frow('Name', null, nameIn),
        frow('Typ', 'Ollama nutzt /api/chat. Alles andere (LM Studio, llama.cpp, vLLM, OpenAI …) nutzt /chat/completions.', typeSel),
        frow('Basis-Adresse', conn.type === 'ollama' ? 'Ohne /api am Ende.' : 'Inklusive /v1.', urlIn),
        frow('API-Schlüssel', 'Wird lokal im Datenordner gespeichert.', keyIn),
        conn.type === 'openai' ? frow('Erweiterte Parameter senden', 'top_k und repeat_penalty mitschicken. Für llama.cpp, LM Studio, vLLM. Bei OpenAI ausschalten.', el('label', { class: 'switch' }, extra, el('span'))) : null,
        frow('Eigener Preis (€ je 1 Mio. Token)', 'Optional. Leer = globale Preise aus dem Tab „Kosten“. Links Eingabe, rechts Ausgabe.', [pIn, pOut]),
        frow('Sampling-Parameter', 'Die App sendet standardmäßig Temperatur, Top-P, Top-K und Wiederholungs-Strafe mit. Die Weboberfläche eines Servers (z. B. Strata) schickt meist weniger oder andere Werte. Abweichende Werte können Qualität und Geschwindigkeit verändern, besonders bei spekulativem Decodieren (MTP). Mit „Dem Server überlassen“ gelten seine Standardwerte. Unter jeder Antwort zeigt „Anfrage“ genau, was gesendet wurde.', sampSel),
        conn.type === 'openai' ? frow('Bildausgabe', 'Damit ein Modell Bilder erzeugen darf, muss die Anfrage das ausdrücklich verlangen (modalities: image, text). Ohne das antwortet auch ein bildfähiges Modell nur mit Text und sagt, es könne keine Bilder erzeugen. „Immer anfordern“ nur für Modelle, die Bilder ausgeben können, sonst lehnt der Server die Anfrage ab.', imgSel) : null,
        conn.type === 'openai' ? frow('Denkaufwand senden als', 'Bestimmt, wie die Auswahl „Denken“ im Eingabefeld an den Server geht. Bei llama.cpp mit Qwen3 und ähnlichen Modellen: Chat-Template.', thinkSel) : null,
        conn.type === 'openai' ? frow('Strata-Konfigdatei (optional)', 'Falls der Server die Kontextgröße nicht meldet (Strata tut das bei der „native“-Instanz nicht): Datei „strata-….json“ wählen. Die App liest daraus „--max-context“. Beispiel: die Datei, die du mir gezeigt hast.', (() => {
          const inp = el('input', { type: 'text', value: conn.configPath || '', placeholder: 'C:\\…\\strata-iq3_s.json' });
          inp.addEventListener('input', () => { conn.configPath = inp.value.trim(); changed(); });
          const pick = el('button', { class: 'btn sm', text: 'Datei wählen …', onclick: async () => { const p = await api.cfg.pick(); if (p) { inp.value = p; conn.configPath = p; changed(); } } });
          return el('div', { class: 'row-gap' }, inp, pick);
        })()) : null,
        el('div', { class: 'row-gap', style: { marginTop: '14px' } }, testBtn, diagBtn, speedBtn, delBtn),
        result,
        diagOut,
        speedOut
      );

      if (conn.type === 'ollama') {
        const nameP = el('input', { type: 'text', placeholder: 'z. B. llama3.2:3b oder qwen2.5-coder:7b' });
        const bar = el('div', { class: 'progress hidden' }, el('i'));
        const status = el('div', { class: 'test-result' });
        const pullBtn = el('button', { class: 'btn primary', text: 'Laden' });
        const run = async () => {
          if (pullRun) { pullRun.abort(); return; }
          const name = nameP.value.trim();
          if (!name) return;
          bar.classList.remove('hidden');
          pullBtn.textContent = 'Abbrechen';
          status.className = 'test-result';
          pullRun = LLM.pullModel(conn, name, (o) => {
            status.textContent = o.status || '';
            if (o.total && o.completed) {
              bar.firstChild.style.width = Math.round((o.completed / o.total) * 100) + '%';
              status.textContent = `${o.status} – ${fmt.gb(o.completed)} / ${fmt.gb(o.total)}`;
            }
          });
          try {
            await pullRun.promise;
            status.className = 'test-result ok';
            status.textContent = `„${name}“ ist installiert.`;
            refreshModels();
          } catch (e) {
            status.className = 'test-result err';
            status.textContent = e.message;
          }
          pullRun = null;
          pullBtn.textContent = 'Laden';
          bar.classList.add('hidden');
        };
        pullBtn.addEventListener('click', run);
        nameP.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
        editor.append(el('h3', { text: 'Modell von Ollama herunterladen' }), el('div', { class: 'fctrl' }, nameP, pullBtn), bar, status);
      }
    }
    if (!conn) editor.append(el('div', { class: 'fhint', style: { padding: '8px 4px', lineHeight: 1.6 }, text: 'Noch keine Verbindung angelegt. Wähle links unter „+ Verbindung hinzufügen …“ eine Vorlage (z. B. Ollama, LM Studio, Strata, llama.cpp, OpenAI) und passe Name und Adresse an.' }));
    wrap.append(el('div', { class: 'conn-layout' }, list, editor));
  }
  render();
  return wrap;
}

function tabModel() {
  const p = 'params.';
  const [tr, tn] = bindSlider(p + 'temperature', 0, 2, 0.05);
  const [pr, pn] = bindSlider(p + 'topP', 0, 1, 0.05);
  const [rr, rn] = bindSlider(p + 'repeatPenalty', 0.5, 2, 0.05);
  return el('div', {},
    frow('System-Prompt', 'Wird jeder Unterhaltung vorangestellt.', bindTextarea('systemPrompt', 6), true),
    frow('Temperatur', 'Niedrig = sachlich und stabil, hoch = kreativ.', [tr, tn]),
    frow('Top-P', 'Nucleus-Sampling.', [pr, pn]),
    frow('Top-K', 'Nur Ollama und „Erweiterte Parameter“.', bindNumber(p + 'topK', { min: 0, max: 500 })),
    frow('Wiederholungsstrafe', 'Nur Ollama und „Erweiterte Parameter“.', [rr, rn]),
    frow('Min-P', 'Schneidet unwahrscheinliche Token ab (Qwen: 0). Nur Ollama-fremde Server mit „Erweiterte Parameter“.', bindNumber(p + 'minP', { min: 0, max: 1, step: 0.01 })),
    frow('Presence-Penalty', 'Gegen Wiederholungsschleifen (0 bis 1,5). Nur mit „Erweiterte Parameter“.', bindNumber(p + 'presencePenalty', { min: 0, max: 2, step: 0.1 })),
    frow('Kontextlänge vom Server übernehmen', 'Beim Verbinden und Modellwechsel liest die App die Kontextgröße vom Server (llama.cpp, LM Studio, vLLM u. a.) und trägt sie unten ein. Bei Ollama nur Anzeige, dort zählt dein Wert.', bindSwitch(p + 'autoCtx')),
    frow('Kontextlänge (num_ctx)', 'Fenstergröße in Tokens. Ollama nutzt den Wert direkt, bei anderen Servern (z. B. Strata, llama.cpp) wird er NICHT gesendet: Trage hier die echte Fenstergröße des Servers ein (z. B. 262144). Sie steuert die Anzeige und die automatische Kontext-Verwaltung.', bindNumber(p + 'numCtx', { min: 256, step: 256 })),
    frow('Max. Antwortlänge', 'Leer = unbegrenzt.', bindNumber(p + 'maxTokens', { min: 1, placeholder: 'unbegrenzt' })),
    frow('Seed', 'Leer = zufällig. Gleicher Seed liefert reproduzierbare Antworten.', bindNumber(p + 'seed', { placeholder: 'zufällig' })),
    frow('Stop-Sequenzen', 'Mehrere mit | trennen. Zeilenumbruch als \\n.', bindText(p + 'stop')),
    frow('Modell im Speicher halten', 'Nur Ollama, z. B. 5m, 1h oder -1 für dauerhaft.', bindText(p + 'keepAlive'))
  );
}

/* Vorgaben müssen mit den Tokens in styles.css übereinstimmen */
const DEFAULT_COLORS = {
  dark: { bg: '#070a1f', side: '#04061a', raised: '#0d1230', input: '#0a0e28', line: '#1b2255', text: '#e9ecf8', textDim: '#98a2c8', codeBg: '#050718' },
  light: { bg: '#ffffff', side: '#f3f5fb', raised: '#eef1f9', input: '#ffffff', line: '#dbe0ee', text: '#0a0f2e', textDim: '#4a5478', codeBg: '#f5f7fc' },
};
const THEME_PRESETS = [
  { name: 'Reuschler-IT', theme: 'dark', accent: '#0b5cff', colors: {} },
  { name: 'Graphit', theme: 'dark', accent: '#5b9dff', colors: { bg: '#17191e', side: '#111317', raised: '#1f2229', input: '#1a1d23', line: '#2b2f38', text: '#e8eaee', textDim: '#9aa0ab', codeBg: '#0f1114' } },
  { name: 'OLED-Schwarz', theme: 'dark', accent: '#0b5cff', colors: { bg: '#000000', side: '#000000', raised: '#0e0e12', input: '#08080b', line: '#1c1c22', text: '#f0f0f4', textDim: '#9a9aa6', codeBg: '#050507' } },
  { name: 'Wald', theme: 'dark', accent: '#3ecf8e', colors: { bg: '#0c1512', side: '#08100d', raised: '#13211c', input: '#0f1b17', line: '#1d3129', text: '#e6f1ec', textDim: '#8fb0a2', codeBg: '#07100c' } },
  { name: 'Violett', theme: 'dark', accent: '#9b7bff', colors: { bg: '#12101f', side: '#0d0b19', raised: '#1b1830', input: '#161328', line: '#2a2548', text: '#ece9fa', textDim: '#a39dc8', codeBg: '#0a0814' } },
  { name: 'Hell', theme: 'light', accent: '#0b5cff', colors: {} },
  { name: 'Warmgrau', theme: 'light', accent: '#c2692b', colors: { bg: '#faf8f5', side: '#f1ede7', raised: '#ece6de', input: '#ffffff', line: '#ddd5c9', text: '#2a2620', textDim: '#6b6358', codeBg: '#f4efe8' } },
  { name: 'Blaugrau', theme: 'light', accent: '#2b6cb0', colors: { bg: '#f6f8fb', side: '#e9eef5', raised: '#e1e8f1', input: '#ffffff', line: '#cfd9e6', text: '#18222f', textDim: '#4d5f75', codeBg: '#eef2f8' } },
];
const FONT_UI = {
  default: { label: 'Standard (Segoe UI Variable)', stack: '' },
  segoe: { label: 'Segoe UI', stack: '"Segoe UI", system-ui, sans-serif' },
  inter: { label: 'Inter (falls installiert)', stack: '"Inter", "Segoe UI", system-ui, sans-serif' },
  calibri: { label: 'Calibri', stack: 'Calibri, "Segoe UI", sans-serif' },
  arial: { label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  verdana: { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  tahoma: { label: 'Tahoma', stack: 'Tahoma, "Segoe UI", sans-serif' },
  georgia: { label: 'Georgia (Serif)', stack: 'Georgia, "Times New Roman", serif' },
  cambria: { label: 'Cambria (Serif)', stack: 'Cambria, Georgia, serif' },
  custom: { label: 'Eigene Schriftart …', stack: null },
};
const FONT_CODE = {
  default: { label: 'Standard (Cascadia Code)', stack: '' },
  consolas: { label: 'Consolas', stack: 'Consolas, "Cascadia Mono", monospace' },
  jetbrains: { label: 'JetBrains Mono (falls installiert)', stack: '"JetBrains Mono", Consolas, monospace' },
  fira: { label: 'Fira Code (falls installiert)', stack: '"Fira Code", Consolas, monospace' },
  courier: { label: 'Courier New', stack: '"Courier New", monospace' },
  custom: { label: 'Eigene Schriftart …', stack: null },
};
const COLOR_FIELDS = [
  ['bg', 'Chat-Hintergrund', 'Fläche hinter den Nachrichten.'],
  ['side', 'Seitenleisten & Titelleiste', null],
  ['raised', 'Karten, Schaltflächen, Auswahlfelder', null],
  ['input', 'Eingabefeld', null],
  ['userBubble', 'Deine Nachrichten (Blase)', null],
  ['assistantBg', 'Antworten der KI (Blase)', 'Standard: ohne Hintergrund. Eine Farbe setzt Antworten in eine Karte.'],
  ['text', 'Textfarbe', null],
  ['textDim', 'Zweite Textfarbe', 'Für Hinweise, Beschriftungen und Statistik.'],
  ['line', 'Rahmen & Trennlinien', null],
  ['codeBg', 'Codeblöcke', null],
];

function defaultColor(key, th, accent, cust) {
  const d = DEFAULT_COLORS[th];
  if (key === 'userBubble') return mixHex(cust.raised || d.raised, accent, 0.14);
  if (key === 'assistantBg') return cust.raised || d.raised;
  return d[key];
}

function tabAppearance() {
  const wrap = el('div');
  const commit = () => {
    saveSettings();
    applyAppearance();
    settingsChanged();
  };
  function render() {
    wrap.innerHTML = '';
    const a = S.settings.appearance;
    const th = resolvedTheme();
    a.custom = a.custom || { dark: {}, light: {} };
    const cust = (a.custom[th] = a.custom[th] || {});

    /* Farbschemata */
    wrap.append(
      el('h3', { text: 'Farbschema' }),
      el('div', { class: 'preset-grid' }, THEME_PRESETS.map((p) => {
        const d = DEFAULT_COLORS[p.theme];
        return el('button', { class: 'preset', title: p.name + (p.theme === 'dark' ? ' (dunkel)' : ' (hell)'), onclick: () => {
          a.theme = p.theme;
          a.accent = p.accent;
          a.custom[p.theme] = { ...p.colors };
          if (p.name === 'Reuschler-IT') a.bgMode = 'brand';
          else if (a.bgMode === 'brand' && Object.keys(p.colors).length) a.bgMode = 'none';
          commit();
          render();
        } },
          el('span', { class: 'sw', style: { background: p.colors.bg || d.bg } }, el('i', { style: { background: p.colors.raised || d.raised } }), el('i', { style: { background: p.accent } }), el('i', { style: { background: p.colors.text || d.text } })),
          el('span', { text: p.name })
        );
      })),
      frow('Modus', 'Die Farben unten gelten jeweils für den aktiven Modus.', (() => {
        const s = el('select', {}, [['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'Wie Windows']].map(([v, l]) => el('option', { value: v, text: l })));
        s.value = a.theme;
        s.addEventListener('change', () => { a.theme = s.value; commit(); render(); });
        return s;
      })())
    );

    /* Farben */
    a.alpha = a.alpha || { dark: {}, light: {} };
    a.alpha[th] = a.alpha[th] || {};
    const alphaCtl = (get, set) => {
      const cur = get();
      const r = el('input', { type: 'range', min: 0, max: 100, step: 5, value: cur, title: 'Deckkraft: 100 % = undurchsichtig, 0 % = unsichtbar', style: { width: '110px' } });
      const n = el('span', { class: 'hex', text: cur + ' %', style: { minWidth: '44px' } });
      r.addEventListener('input', () => { n.textContent = r.value + ' %'; set(+r.value); commit(); });
      return [r, n];
    };
    const accent = el('input', { type: 'color', value: a.accent });
    accent.addEventListener('input', () => { a.accent = accent.value; commit(); });
    const accentAlpha = alphaCtl(() => (a.accentAlpha == null ? 100 : a.accentAlpha), (v) => { a.accentAlpha = v >= 100 ? null : v; });
    const swatches = ['#0b5cff', '#4cc3a0', '#e08a5b', '#d672b5', '#e0b84c', '#9b7bff'].map((c) =>
      el('button', { class: 'icon-btn', style: { background: c, width: '22px', height: '22px', borderRadius: '50%' }, title: c, onclick: () => { a.accent = c; commit(); render(); } })
    );
    wrap.append(el('h3', { text: `Farben (${th === 'dark' ? 'dunkler' : 'heller'} Modus)` }), frow('Akzentfarbe', 'Buttons, Markierungen, Links. Erste Farbe = Reuschler-IT-Blau. Der Regler stellt die Deckkraft ein.', [accent, ...accentAlpha, ...swatches]));
    for (const [key, label, hint] of COLOR_FIELDS) {
      const inp = el('input', { type: 'color', value: cust[key] || defaultColor(key, th, a.accent, cust) });
      const hex = el('span', { class: 'hex', text: cust[key] || 'Standard' });
      const alp = a.alpha[th];
      const reset = el('button', { class: 'btn sm', text: 'Standard', disabled: !cust[key] && alp[key] == null, onclick: () => { delete cust[key]; delete alp[key]; commit(); render(); } });
      inp.addEventListener('input', () => { cust[key] = inp.value; hex.textContent = inp.value; reset.disabled = false; commit(); });
      const ctl = alphaCtl(() => (alp[key] == null ? 100 : alp[key]), (v) => { if (v >= 100) delete alp[key]; else alp[key] = v; reset.disabled = false; });
      wrap.append(frow(label, hint, [inp, hex, ...ctl, reset]));
    }
    wrap.append(el('div', { class: 'row-gap', style: { padding: '12px 0' } },
      el('button', { class: 'btn sm', text: 'Farben dieses Modus zurücksetzen', onclick: () => { a.custom[th] = {}; a.alpha[th] = {}; commit(); render(); } })
    ));
    wrap.append(frow('Fenstermaterial (Windows 11)', 'Damit Transparenz den Desktop durchscheinen lässt: „Acrylic“ (unscharf) oder „Mica“. Senke dann die Deckkraft von „Chat-Hintergrund“ und „Seitenleisten“. Ohne Material scheint nur das Hintergrundbild bzw. die Fensterfarbe durch. Benötigt Windows 11 22H2 oder neuer.', bindSelect('appearance.winMaterial', [{ value: 'none', label: 'Aus' }, { value: 'acrylic', label: 'Acrylic (unscharf)' }, { value: 'mica', label: 'Mica' }, { value: 'tabbed', label: 'Mica (getönt)' }])));

    wrap.append(frow('Rechtschreibprüfung', 'Falsch geschriebene Wörter im Eingabefeld werden rot wellig unterstrichen. Rechtsklick auf das Wort zeigt Vorschläge und „Zum Wörterbuch hinzufügen“. Beim ersten Mal lädt die App die Wörterbücher selbst herunter (Internet nötig).', bindSwitch('spell.enabled')));
    wrap.append(frow('Sprachen der Rechtschreibprüfung', '„Deutsch und Englisch“ markiert ein Wort nur, wenn es in keiner der beiden Sprachen vorkommt. Das vermeidet falsche Markierungen bei englischen Fachwörtern.', bindSelect('spell.lang', [{ value: 'de-en', label: 'Deutsch und Englisch' }, { value: 'de', label: 'Deutsch' }, { value: 'en', label: 'Englisch' }])));
    wrap.append(frow('Sparmodus beim Antworten', 'Während die KI antwortet, schaltet die Oberfläche Animationen und Unschärfe-Effekte ab. Das schont die Grafikkarte, die gerade das Modell rechnet (besonders wenn Modell und LLM Box auf demselben Rechner laufen).', bindSwitch('appearance.calmDuringGen')));
    {
      const gi = el('input', { type: 'checkbox' });
      gi.checked = true;
      api.gpuGet().then((v) => { gi.checked = !!v; }).catch(() => {});
      gi.addEventListener('change', async () => {
        const ok = await api.gpuSet(gi.checked);
        toast(ok ? 'Wird nach einem Neustart der LLM Box wirksam.' : 'Konnte die Einstellung nicht speichern.', 5000);
      });
      wrap.append(frow('Grafikkarte für die Oberfläche nutzen', 'Aus = die Oberfläche wird ohne Grafikkarte gezeichnet (CPU). Das nimmt der Grafikkarte jede Last durch die LLM Box, kann aber Scrollen und Effekte etwas träger machen. Wirkt nach einem Neustart. Probiere es aus, wenn die Tokens pro Sekunde in der LLM Box niedriger sind als in der Server-Weboberfläche.', el('label', { class: 'switch' }, gi, el('span'))));
    }

    /* Schrift */
    const fontSel = (key, customKey, table) => {
      const s = el('select', {}, Object.entries(table).map(([v, o]) => el('option', { value: v, text: o.label })));
      s.value = a[key];
      s.addEventListener('change', () => { a[key] = s.value; commit(); render(); });
      const box = [s];
      if (a[key] === 'custom') {
        const t = el('input', { type: 'text', value: a[customKey] || '', placeholder: 'z. B. Bahnschrift' });
        t.addEventListener('input', () => { a[customKey] = t.value; commit(); });
        box.push(t);
      }
      return box;
    };
    const [fr, fn] = bindSlider('appearance.fontSize', 12, 20, 1);
    const [lr, ln] = bindSlider('appearance.lineHeight', 1.3, 2, 0.05);
    wrap.append(
      el('h3', { text: 'Schrift' }),
      frow('Schriftart', 'Es werden nur auf deinem Windows installierte Schriften angezeigt.', fontSel('fontFamily', 'fontFamilyCustom', FONT_UI)),
      frow('Code-Schriftart', null, fontSel('codeFont', 'codeFontCustom', FONT_CODE)),
      frow('Schriftgröße', null, [fr, fn]),
      frow('Zeilenabstand in Antworten', null, [lr, ln]),
      el('div', { class: 'font-sample', text: 'Beispiel: Franz jagt im komplett verwahrlosten Taxi quer durch Bayern. 0123456789 – Tokens/s' })
    );

    /* Layout */
    const [wr_, wn] = bindSlider('appearance.messageWidth', 560, 1200, 20);
    const [rr, rn] = bindSlider('appearance.radius', 2, 20, 1);
    const [sr, sn] = bindSlider('appearance.sidebarWidth', 200, 380, 4);
    wrap.append(
      el('h3', { text: 'Layout' }),
      frow('Breite des Chatfensters (px)', 'Maximale Breite von Nachrichten und Eingabefeld.', [wr_, wn]),
      frow('Rundung der Ecken (px)', null, [rr, rn]),
      frow('Breite der Seitenleiste (px)', null, [sr, sn]),
      frow('Statistik unter Antworten', 'Tokens pro Sekunde, Prompt-, Antwort- und Gesamt-Tokens, Startzeit und Dauer.', bindSwitch('appearance.showStats')),
      frow('Gedankengang beim Denken aufklappen', 'Aus: eingeklappt, dabei pulsieren drei Punkte, solange die KI denkt.', bindSwitch('appearance.thinkOpen')),
      frow('Gedankengang auf Deutsch anzeigen', 'Denkt das Modell auf Englisch, übersetzt die App den Gedankengang mit demselben Modell. „Automatisch“: im Hintergrund nach Abschluss der Antwort. „Beim Aufklappen“: erst wenn du ihn öffnest. „Aus“: nur per Knopf.', bindSelect('appearance.thinkLang', [{ value: 'auto', label: 'Automatisch' }, { value: 'click', label: 'Beim Aufklappen' }, { value: 'orig', label: 'Aus (Original)' }])),
      frow('Modell bitten, auf Deutsch zu denken', 'Fügt dem Systemprompt eine Anweisung hinzu. Qwen hält sich nicht immer daran, und das Denken auf Englisch ist oft genauer. Übersetzen (oben) ist meist die bessere Wahl.', bindSwitch('appearance.thinkInGerman')),
      frow('Mit Enter senden', 'Aus: Strg+Enter sendet, Enter macht einen Zeilenumbruch.', bindSwitch('appearance.enterToSend'))
    );

    /* Hintergrund */
    const mode = el('select', {}, [['brand', 'Reuschler-IT Wallpaper (nur dunkel)'], ['custom', 'Eigenes Bild'], ['none', 'Einfarbig']].map(([v, l]) => el('option', { value: v, text: l })));
    mode.value = a.bgMode;
    mode.addEventListener('change', () => { a.bgMode = mode.value; commit(); render(); });
    const [or, on] = bindSlider('appearance.bgOpacity', 0, 100, 5);
    const [br, bn] = bindSlider('appearance.bgBlur', 0, 24, 1);
    wrap.append(
      el('h3', { text: 'Hintergrund' }),
      frow('Hintergrund', null, mode)
    );
    if (a.bgMode === 'custom') {
      const pick = el('button', { class: 'btn sm', text: a.bgImage ? 'Anderes Bild wählen …' : 'Bild wählen …', onclick: async () => {
        const res = await api.files.pick('files', { maxKB: 1, maxFiles: 1, maxTotalKB: 1, ignore: [] });
        const f = res && res.files.find((x) => x.kind === 'image');
        if (!f) return toast('Bitte ein Bild wählen (PNG, JPG, WebP).');
        a.bgImage = await downscaleImage(f.dataUrl, 2560);
        commit();
        render();
      } });
      const clear = a.bgImage ? el('button', { class: 'btn sm', text: 'Entfernen', onclick: () => { a.bgImage = ''; commit(); render(); } }) : null;
      wrap.append(frow('Bilddatei', a.bgImage ? 'Wird verkleinert gespeichert.' : 'Noch kein Bild gewählt.', [pick, clear]));
    }
    if (a.bgMode !== 'none') {
      wrap.append(frow('Bildintensität (%)', '0 = unsichtbar, 100 = volle Deckkraft.', [or, on]), frow('Weichzeichner (px)', null, [br, bn]));
    }

    wrap.append(el('div', { class: 'row-gap', style: { padding: '18px 0 4px' } },
      el('button', { class: 'btn sm danger', text: 'Gesamtes Erscheinungsbild zurücksetzen', onclick: async () => {
        if (!(await confirmModal('Erscheinungsbild zurücksetzen', 'Alle Farben, Schriften und Layout-Einstellungen werden auf das Reuschler-IT-Design zurückgesetzt.', { okLabel: 'Zurücksetzen', danger: true }))) return;
        S.settings.appearance = JSON.parse(JSON.stringify(DEFAULTS.appearance));
        commit();
        render();
      } })
    ));
  }
  render();
  return wrap;
}

function downscaleImage(dataUrl, maxW) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function tabCosts() {
  const wrap = el('div');
  const commit = () => { changed(); };
  function applyPreset() {
    const p = S.settings.pricing;
    const x = PRICE_PRESETS.find((y) => y.id === p.preset);
    if (x && x.in !== null) {
      const e = presetEur(x, +p.usdToEur || 0.9);
      p.priceIn = e.in;
      p.priceOut = e.out;
    }
  }
  function render() {
    wrap.innerHTML = '';
    const p = S.settings.pricing;
    const preset = PRICE_PRESETS.find((x) => x.id === p.preset) || PRICE_PRESETS[0];
    const sel = el('select', {}, PRICE_PRESETS.map((x) => el('option', { value: x.id, text: x.label })));
    sel.value = preset.id;
    sel.addEventListener('change', () => {
      p.preset = sel.value;
      applyPreset();
      commit();
      render();
    });
    const num = (key) => {
      const i = el('input', { type: 'number', min: 0, step: 0.01, value: p[key] ?? '', placeholder: '0' });
      i.addEventListener('input', () => { p[key] = i.value === '' ? 0 : +i.value; p.preset = 'custom'; sel.value = 'custom'; commit(); example(); });
      return i;
    };
    const rate = el('input', { type: 'number', min: 0.01, step: 0.01, value: p.usdToEur });
    rate.addEventListener('input', () => {
      p.usdToEur = +rate.value || 0.9;
      if (p.preset !== 'custom') { applyPreset(); commit(); render(); rate.focus(); } else commit();
    });

    const exampleBox = el('div', { class: 'font-sample' });
    function example() {
      const v = (25000 * (+p.priceIn || 0) + 1000 * (+p.priceOut || 0)) / 1e6;
      exampleBox.textContent = `Beispiel: 25.000 Tokens Eingabe + 1.000 Tokens Ausgabe ≈ ${fmt.money(v, 'EUR')}`;
    }
    const usdNote = preset.in === null ? 'Eigene Preise in Euro je 1 Mio. Token.' : `Listenpreis: ${String(preset.in).replace('.', ',')} $ Eingabe / ${String(preset.out).replace('.', ',')} $ Ausgabe je 1 Mio. Token, umgerechnet in €.` + (preset.note ? ' ' + preset.note : '');

    wrap.append(
      frow('Kosten anzeigen', 'Unter dem Eingabefeld (Summe des Chats) und unter jeder Antwort.', bindSwitch('pricing.enabled')),
      frow('Preisvorlage', usdNote, sel),
      frow('Preis Eingabe (€ je 1 Mio. Token)', 'Prompt: System-Prompt, Verlauf, Anhänge.', num('priceIn')),
      frow('Preis Ausgabe (€ je 1 Mio. Token)', 'Von der KI erzeugte Tokens, inklusive Gedankengang.', num('priceOut')),
      frow('Wechselkurs für Vorlagen (1 USD in €)', 'Die Vorlagen sind US-Listenpreise und werden mit diesem Kurs in € umgerechnet. Ungefährer Wert, bitte bei Bedarf anpassen.', rate),
      exampleBox,
      el('div', { class: 'fhint', style: { marginTop: '14px', color: 'var(--text-faint)', fontSize: '12.5px', lineHeight: 1.55 }, text: 'Das ist ein Vergleichswert: Er zeigt, was dieselbe Nutzung bei einem Cloud-Anbieter zu Listenpreisen kosten würde. Lokale Modelle verursachen keine API-Kosten. Zwischengespeicherte Tokens (Cache), Rabatte und Steuern sind nicht berücksichtigt, die Anzeige ist eine Schätzung. Für einzelne Verbindungen kannst du unter „Verbindungen“ eigene Preise in € eintragen.' })
    );
    example();
  }
  render();
  return wrap;
}

function tabWorkspace() {
  const wrap = el('div');
  function render() {
    wrap.innerHTML = '';
    const w = S.settings.workspace;
    const pathLabel = el('div', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: w.path ? 'var(--text)' : 'var(--text-faint)' }, text: w.path || 'Kein Ordner gewählt', title: w.path });
    wrap.append(
      frow('Workspace-Ordner', 'Projektordner, den du im Panel rechts siehst und der KI freigeben kannst.', [
        pathLabel,
        el('button', { class: 'btn sm', text: 'Wählen …', onclick: async () => { const p = await api.files.pickFolder('Workspace-Ordner wählen'); if (p) { w.path = p; changed(); render(); } } }),
        w.path ? el('button', { class: 'btn sm', text: 'Entfernen', onclick: () => { w.path = ''; w.toolsEnabled = false; changed(); render(); } }) : null,
      ]),
      frow('KI-Dateizugriff', 'Die KI darf Dateien im Workspace auflisten, lesen, durchsuchen und schreiben. Das Modell muss Werkzeuge (Tool Calling) unterstützen.', bindSwitch('workspace.toolsEnabled')),
      frow('Freigabe für KI-Werkzeuge', 'Standard für neue Chats. Gilt für Datei-Werkzeuge und für Befehle (run_command). „Nichts bestätigen“ lässt auch Befehle ohne Rückfrage laufen; Installationen fragen weiterhin nach. Im Chat lässt sich das live pro Chat über „Freigabe“ unter dem Eingabefeld ändern.', (() => {
        const s = el('select', {}, [['all', 'Alles bestätigen (Lesen und Schreiben)'], ['write', 'Nur Schreiben und Befehle bestätigen (empfohlen)'], ['none', 'Nichts bestätigen']].map(([v, l]) => el('option', { value: v, text: l })));
        s.value = w.approval || 'write';
        s.addEventListener('change', () => { w.approval = s.value; changed(); });
        return s;
      })()),
      frow('KI darf Programme ausführen', 'Die KI kann Programme auf diesem Rechner starten (z. B. apktool, jadx, git, python), prüfen, ob ein Tool vorhanden ist, und fehlende Tools installieren. Je nach Freigabe-Einstellung erscheint vor jedem Programmstart eine Karte mit dem genauen Befehl; Installationen fragen immer nach, außer du erlaubst sie im Chat ausdrücklich. Läuft mit deinen Benutzerrechten, Arbeitsordner ist der Workspace.', bindSwitch('workspace.execEnabled')),
      frow('Zeitlimit pro Programm (Sekunden)', 'Danach wird das Programm beendet. Installationen dürfen bis zu 15 Minuten dauern.', bindNumber('workspace.execTimeout', { min: 5, max: 3600, placeholder: '120' })),
      frow('Max. Werkzeug-Schritte am Stück', 'Danach hält die KI an und du kannst mit „Weitermachen“ fortfahren.', bindNumber('workspace.maxSteps', { min: 1, max: 200, placeholder: '25' })),
      el('h3', { text: 'Kontext-Verwaltung für KI-Werkzeuge' }),
      frow('Alte Werkzeug-Ausgaben automatisch entfernen', 'Wird der Kontext knapp, ersetzt die App alte Datei-Inhalte im Verlauf durch eine Kurznotiz. Der Chat selbst bleibt unverändert.', bindSwitch('workspace.autoCompact')),
      frow('Kontext-Budget (%)', 'Ab diesem Anteil des Fensters (abzüglich Platz für die Antwort) wird verschlankt.', bindNumber('workspace.ctxBudgetPct', { min: 30, max: 95, placeholder: '80' })),
      frow('Letzte Werkzeug-Ergebnisse behalten', 'So viele der neuesten Ergebnisse bleiben immer vollständig erhalten.', bindNumber('workspace.keepToolResults', { min: 0, max: 20, placeholder: '3' })),
      frow('Max. Größe pro Datei-Lesen (KB)', 'Größere Dateien liefert die KI nur abschnittsweise (start_line/end_line). 40 KB ≈ 10.000 Tokens.', bindNumber('workspace.readKB', { min: 4, placeholder: '40' })),
      frow('Rückfragen mit Antwortvorschlägen', 'Die KI kann dir Rückfragen mit Antworten zum Anklicken stellen (Werkzeug „ask_user“), wenn Angaben fehlen oder es mehrere Wege gibt. Du kannst auch eine eigene Antwort tippen oder überspringen.', bindSwitch('workspace.askUser')),
      frow('Rückfragen auch ohne Dateizugriff', 'Bietet der KI dieses eine Werkzeug auch an, wenn „KI-Dateizugriff“ aus ist. Das Modell muss Werkzeuge (Tool Calling) unterstützen, sonst meldet der Server einen Fehler.', bindSwitch('workspace.askUserAlways')),
      frow('Unteragenten erlauben', 'Die KI kann Teilaufgaben an Unteragenten mit eigenem Kontext übergeben (nur lesen und suchen). Das hält den Hauptchat klein. Sichtbar unter „Unteragenten“ oben.', bindSwitch('workspace.subagents')),
      frow('Max. Schritte pro Unteragent', 'Danach muss der Unteragent zusammenfassen.', bindNumber('workspace.subagentSteps', { min: 2, max: 40, placeholder: '12' })),
      frow('Kontext leeren / neue Session mit Übergabe anbieten', 'Die KI kann das Leeren des Kontexts bzw. eine neue Session vorschlagen, und die App zeigt einen Hinweis, wenn der Kontext knapp wird. Die Übergabe enthält Ziel, Stand, geänderte Dateien und den nächsten Schritt.', bindSwitch('workspace.handoff')),
      frow('Bei vollem Kontext bevorzugen', '„Kontext leeren“: Der Chat bleibt derselbe, der alte Verlauf bleibt sichtbar, die KI bekommt nur die Übergabe (Ziel, Stand, geänderte Dateien, nächster Schritt). „Neue Session“: öffnet einen neuen Chat. Ist Leeren nicht möglich, wird automatisch eine neue Session geöffnet. Die andere Möglichkeit bleibt als Schaltfläche erhalten.', bindSelect('workspace.handoffMode', [{ value: 'clear', label: 'Kontext leeren (im selben Chat)' }, { value: 'new', label: 'Neue Session (neuer Chat)' }])),
      frow('Hinweis ab Kontext-Füllstand (%)', 'Ab diesem Anteil weist die App darauf hin und bittet die KI, eine Übergabe vorzuschlagen.', bindNumber('workspace.handoffPct', { min: 30, max: 95, placeholder: '70' })),
      frow('Übergabe sofort senden', 'Aus: Die Übergabe wird nur in das Eingabefeld eingefügt, damit du sie vorher prüfen kannst (gilt für Leeren und neue Session).', bindSwitch('workspace.handoffAutoSend')),
      el('h3', { text: 'Grenzen beim Anhängen' }),
      frow('Max. Dateigröße (KB)', 'Größere Textdateien werden übersprungen. Bei PDF, Word, Excel usw. gilt das Limit für den ausgelesenen Text, der dann gekürzt wird.', bindNumber('workspace.maxFileKB', { min: 1, placeholder: '512' })),
      frow('Max. Dateien pro Ordner', null, bindNumber('workspace.maxFiles', { min: 1, placeholder: '60' })),
      frow('Max. Gesamtgröße (KB)', 'Pro Anhängen-Vorgang. Grob: 4 KB ≈ 1000 Tokens.', bindNumber('workspace.maxTotalKB', { min: 1, placeholder: '1024' })),
      frow('Ignorieren', 'Ordner- und Dateinamen, durch Komma getrennt.', bindText('workspace.ignore'))
    );
  }
  render();
  return wrap;
}

/* Chats auf mehreren Rechnern: gemeinsamer Ordner (NAS, Netzlaufwerk, OneDrive …) */
function syncRowHolder() {
  const holder = el('div');
  const build = async () => {
    const sy = await api.sync.get();
    S.sync = { dir: sy.dir, deviceId: sy.deviceId, deviceName: sy.deviceName };
    const reload = async () => {
      S.sync = await api.sync.get();
      S.chat = null;
      await loadChatList();
      if (S.chatList.length) await openChat(S.chatList[0].id);
      else newChat();
      build();
    };
    const btns = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    btns.append(el('button', { class: 'btn sm', text: 'Ordner wählen …', onclick: async () => {
      if (S.generating) return toast('Bitte erst warten, bis die Antwort fertig ist.');
      const dir = await api.files.pickFolder('Gemeinsamen Ordner für Chats wählen');
      if (!dir) return;
      if (!(await confirmModal('Chats gemeinsam speichern', `Chats werden ab jetzt in „${dir}“ (Unterordner LLM-Box-Chats) gespeichert. Chats, die dort schon liegen, erscheinen sofort. Deine bisherigen lokalen Chats bleiben auf diesem Rechner erhalten.`, { okLabel: 'Übernehmen' }))) return;
      const r = await api.sync.setDir(dir);
      if (!r.ok) return toast(r.error, 7000);
      if (await confirmModal('Lokale Chats kopieren?', 'Sollen die Chats, die bisher nur auf diesem Rechner liegen, in den gemeinsamen Ordner kopiert werden? Vorhandene Chats werden nicht überschrieben.', { okLabel: 'Kopieren' })) {
        const m = await api.sync.migrate();
        toast(m.ok ? `${m.copied} Chat(s) kopiert${m.skipped ? `, ${m.skipped} waren schon vorhanden` : ''}.` : m.error, 5000);
      }
      await reload();
    } }));
    if (sy.dir) {
      btns.append(el('button', { class: 'btn sm', text: 'Lokale Chats kopieren', onclick: async () => { const m = await api.sync.migrate(); toast(m.ok ? `${m.copied} Chat(s) kopiert${m.skipped ? `, ${m.skipped} waren schon vorhanden` : ''}.` : m.error, 5000); await reload(); } }));
      btns.append(el('button', { class: 'btn sm danger', text: 'Wieder nur lokal', onclick: async () => {
        if (S.generating) return toast('Bitte erst warten, bis die Antwort fertig ist.');
        await api.sync.setDir('');
        toast('Chats werden wieder nur auf diesem Rechner gespeichert. Der gemeinsame Ordner bleibt unverändert.', 5000);
        await reload();
      } }));
    }
    const row = frow('Chats auf mehreren Rechnern', (sy.dir ? `Aktiv: ${sy.folder}` : 'Aus: Chats liegen nur auf diesem Rechner.') + ` Wähle einen Ordner, den alle Rechner erreichen (NAS, Netzlaufwerk, OneDrive …). Einstellungen und Verbindungen bleiben je Rechner getrennt. Änderungen von anderen Rechnern erscheinen nach wenigen Sekunden. Dieser Rechner: ${sy.deviceName}.`, btns);
    holder.innerHTML = '';
    holder.append(row);
  };
  build();
  return holder;
}

function tabData() {
  const wrap = el('div');
  api.appInfo().then((info) => {
    wrap.append(
      frow('Datenordner', info.dataDir, el('button', { class: 'btn sm', text: 'Öffnen', onclick: () => api.openPath(info.dataDir) })),
      syncRowHolder(),
      frow('Alle Chats exportieren', 'Als eine JSON-Datei.', el('button', { class: 'btn sm', text: 'Exportieren …', onclick: async () => {
        const list = await api.chats.list();
        const all = [];
        for (const m of list) { const c = await api.chats.load(m.id); if (c) all.push(c); }
        const p = await api.files.saveAs({ defaultName: 'llm-box-chats.json', content: JSON.stringify(all, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (p) toast('Exportiert: ' + p);
      } })),
      frow('Alle Chats löschen', 'Unwiderruflich.', el('button', { class: 'btn sm danger', text: 'Löschen …', onclick: async () => {
        if (!(await confirmModal('Alle Chats löschen', 'Alle gespeicherten Unterhaltungen werden unwiderruflich gelöscht.', { okLabel: 'Alles löschen', danger: true }))) return;
        await api.chats.deleteAll();
        await loadChatList();
        newChat();
        toast('Alle Chats gelöscht.');
      } })),
      frow('Einstellungen zurücksetzen', 'Chats bleiben erhalten.', el('button', { class: 'btn sm danger', text: 'Zurücksetzen …', onclick: async () => {
        if (!(await confirmModal('Einstellungen zurücksetzen', 'Alle Einstellungen und Verbindungen werden auf den Standard gesetzt.', { okLabel: 'Zurücksetzen', danger: true }))) return;
        S.settings = deepMerge(DEFAULTS, {});
        S.settings.connections = JSON.parse(JSON.stringify(DEFAULTS.connections));
        changed();
        refreshModels();
        toast('Zurückgesetzt. Öffne die Einstellungen erneut.');
      } })),
      el('div', { class: 'fhint', style: { marginTop: '18px', color: 'var(--text-faint)', fontSize: '12.5px' }, text: `LLM Box ${info.version} · Electron ${info.electron}` })
    );
  });
  return wrap;
}

function tabAbout() {
  const wrap = el('div', { class: 'about' });
  wrap.innerHTML = brandMark('brand-mark') + '<br>' + brandWord('brand-word') + '<h2>LLM Box</h2><p>Lokaler KI-Chat für Ollama, LM Studio, llama.cpp und OpenAI-kompatible Server.</p><p class="ver"></p><p class="copy">© 2026 Reuschler-IT. Alle Rechte vorbehalten.</p>';
  api.appInfo().then((i) => { wrap.querySelector('.ver').textContent = `Version ${i.version} · Electron ${i.electron}`; });
  return wrap;
}

function openSettings(tab = 'conn') {
  const tabs = [
    { id: 'conn', label: 'Verbindungen', ic: 'plug', fn: tabConnections },
    { id: 'model', label: 'Modell & Parameter', ic: 'cpu', fn: tabModel },
    { id: 'look', label: 'Darstellung', ic: 'palette', fn: tabAppearance },
    { id: 'cost', label: 'Kosten', ic: 'euro', fn: tabCosts },
    { id: 'ws', label: 'Workspace & Dateien', ic: 'folder', fn: tabWorkspace },
    { id: 'data', label: 'Daten', ic: 'db', fn: tabData },
    { id: 'about', label: 'Über', ic: 'box', fn: tabAbout },
  ];
  const pane = el('div', { class: 'pane' });
  const nav = el('nav');
  function show(id) {
    nav.innerHTML = '';
    tabs.forEach((t) => nav.append(el('button', { class: t.id === id ? 'active' : '', html: icon(t.ic, 16) + '<span>' + t.label + '</span>', onclick: () => show(t.id) })));
    pane.innerHTML = '';
    pane.append(tabs.find((t) => t.id === id).fn());
  }
  show(tab);
  openModal({ title: 'Einstellungen', wide: true, bare: true, body: el('div', { class: 'settings' }, nav, pane), onClose: () => { refreshModels(); } });
}


/* ═════════════ Geschwindigkeitstest ═════════════
   Sendet dieselbe kurze Aufgabe in mehreren Anfrage-Arten und vergleicht Tokens/s. Einzelne Läufe schwanken auch auf demselben Server
   um 10 % und mehr (GPU-Takt, Wärme, Cache). Deshalb: ein Aufwärmlauf, dann mehrere Durchgänge in wechselnder Reihenfolge und der Median. */
async function runSpeedTest(conn, show) {
  const PROMPT = 'Schreibe einen zusammenhängenden Text von etwa 200 Wörtern über das Wetter im Herbst. Nur der Text, keine Überschrift.';
  const MAXTOK = 256;
  const ROUNDS = 3;
  let model = conn.id === S.settings.activeConnection ? currentModel() : '';
  if (!model) {
    const ms = await LLM.listModels(conn);
    model = ms[0] && ms[0].id;
  }
  if (!model) throw new Error('Kein Modell gefunden.');
  const base = { ...S.settings.params, maxTokens: MAXTOK, seed: null };
  const sys = S.settings.systemPrompt || '';
  const minConn = { ...conn, samplingMode: 'server', thinkMode: 'none' };
  const variants = [
    { key: 'min', name: 'Minimal (nur Nachricht, Sampling dem Server überlassen)', conn: minConn, params: { maxTokens: MAXTOK }, system: '', tools: null },
    { key: 'app', name: 'Wie die App sendet (Sampling aus „Modell & Parameter“)', conn, params: base, system: sys, tools: null },
    { key: 'poll', name: 'Minimal + Füllstand-Abfrage alle 2 s (/slots)', conn: minConn, params: { maxTokens: MAXTOK }, system: '', tools: null, poll: true },
    { key: 'tools', name: 'Wie die App sendet + Werkzeug-Definitionen (Dateizugriff)', conn, params: base, system: sys, tools: LLM.WORKSPACE_TOOLS },
  ];
  variants.forEach((v) => { v.vals = []; v.srvSeen = false; v.tokens = null; });
  const timeline = []; // alle gewerteten Läufe in zeitlicher Reihenfolge
  const median = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : null; };
  const f = (v) => (v === null || v === undefined ? '–' : fmt.tps(v));
  const render = (note, hints) => {
    const w = Math.max(...variants.map((v) => v.name.length));
    const lines = [`Modell: ${model} · je ${MAXTOK} Tokens max. · ${ROUNDS} Durchgänge (Median)`, '', 'Variante'.padEnd(w) + '   Median t/s   Streuung t/s   Läufe'];
    for (const v of variants) lines.push(v.name.padEnd(w) + '   ' + String(f(median(v.vals))).padStart(10) + '   ' + String(v.vals.length ? `${f(Math.min(...v.vals))}–${f(Math.max(...v.vals))}` : '–').padStart(12) + '   ' + String(v.vals.length).padStart(5));
    if (note) lines.push('', note);
    if (hints) lines.push('', ...hints);
    show(lines.join('\n'));
  };
  const one = async (v, maxTok) => {
    let poll = null;
    if (v.poll) poll = setInterval(() => { LLM.slotInfo(conn).catch(() => {}); }, 2000);
    try {
      const run = LLM.streamChat({ conn: v.conn, model, system: v.system, messages: [{ role: 'user', content: PROMPT }], params: { ...v.params, maxTokens: maxTok }, tools: v.tools, thinkLevel: 'auto', handlers: {} });
      const res = await run.promise;
      const ct = res.stats.completionTokens;
      const sv = ct > 20 ? (await LLM.serverDecodeStats(conn, ct)) || {} : {};
      const srv = sv.tps ?? null;
      if (srv !== null) v.srvSeen = true;
      return { tps: srv ?? res.stats.tps, tokens: ct, viaServer: srv !== null, temp: sv.temp ?? null, power: sv.power ?? null };
    } finally {
      if (poll) clearInterval(poll);
    }
  };
  document.body.classList.add('gen'); // Oberfläche ruhig stellen wie beim Antworten
  try {
  render('Aufwärmlauf (wird nicht gewertet) …');
  await one(variants[0], 64);
  await new Promise((r) => setTimeout(r, 500));
  const total = ROUNDS * variants.length;
  let n = 0;
  for (let r = 0; r < ROUNDS; r++) {
    // Reihenfolge je Durchgang verschieben, damit keine Variante immer zuerst (kalt) oder zuletzt läuft
    for (let k = 0; k < variants.length; k++) {
      const v = variants[(k + r) % variants.length];
      render(`Läuft: ${v.name} … (${++n} von ${total})`);
      const res = await one(v, MAXTOK);
      if (res.tps) { v.vals.push(res.tps); timeline.push({ key: v.key, tps: res.tps, temp: res.temp, power: res.power }); }
      v.tokens = res.tokens;
      await new Promise((x) => setTimeout(x, 500));
    }
  }
  } finally {
    document.body.classList.remove('gen');
  }
  // Auswertung
  const [min, app, poll, tools] = variants;
  const mm = (v) => median(v.vals);
  const spread = (v) => (v.vals.length > 1 ? (Math.max(...v.vals) - Math.min(...v.vals)) / mm(v) : 0);
  const noise = Math.max(...variants.map(spread));
  // Ein Unterschied zählt nur, wenn er größer als 8 % und größer als die Streuung der beiden Varianten ist
  const slower = (x, y) => mm(x) && mm(y) && mm(y) < mm(x) * 0.92 && (mm(x) - mm(y)) / mm(x) > Math.max(spread(x), spread(y)) * 0.6;
  const hints = [];
  if (slower(min, app)) hints.push(`• Die Sampling-Werte der App bremsen: ${f(mm(app))} statt ${f(mm(min))} t/s. Stelle „Sampling-Parameter“ dieser Verbindung auf „Dem Server überlassen“ oder gleiche Temperatur, Top-P, Top-K und Wiederholungs-Strafe mit der Server-Weboberfläche ab.`);
  if (slower(min, poll)) hints.push(`• Die Füllstand-Abfrage (/slots) bremst den Server: ${f(mm(poll))} statt ${f(mm(min))} t/s.`);
  if (slower(app, tools)) hints.push(`• Die Werkzeug-Definitionen kosten Geschwindigkeit (${f(mm(tools))} statt ${f(mm(app))} t/s). Mit ausgeschaltetem Dateizugriff ist der Prompt kleiner.`);
  // Verlauf: sinkt die Geschwindigkeit über die Zeit (unabhängig von der Variante), liegt es am Server bzw. an der Grafikkarte
  const label = { min: 'Minimal', app: 'App', poll: '+/slots', tools: '+Werkzeuge' };
  const tlLines = timeline.map((r, i) => `  ${String(i + 1).padStart(2)}. ${label[r.key].padEnd(11)} ${String(f(r.tps)).padStart(6)} t/s` + (r.temp !== null ? `   GPU ${Math.round(r.temp)} °C` : '') + (r.power !== null ? `, ${Math.round(r.power)} W` : ''));
  if (timeline.length >= 6) {
    const k = Math.floor(timeline.length / 3);
    const avgOf = (a) => a.reduce((x, r) => x + r.tps, 0) / a.length;
    const early = avgOf(timeline.slice(0, k));
    const late = avgOf(timeline.slice(-k));
    const t1 = timeline.slice(0, k).map((r) => r.temp).filter((x) => x !== null);
    const t2 = timeline.slice(-k).map((r) => r.temp).filter((x) => x !== null);
    if (late < early * 0.88) {
      const hot = t1.length && t2.length ? t2.reduce((a, b) => a + b, 0) / t2.length - t1.reduce((a, b) => a + b, 0) / t1.length : null;
      hints.push(`• Die Geschwindigkeit sinkt im Verlauf des Tests von ${f(early)} auf ${f(late)} t/s, unabhängig von der Variante.` + (hot !== null && hot >= 3 ? ` Die GPU wird dabei ${Math.round(hot)} °C wärmer: wahrscheinlich Wärme-Drosselung (Kühlung, Lüfterkurve, Power-Limit prüfen).` : ' Das spricht für Wärme-Drosselung oder andere Programme, die die Grafikkarte nutzen.'));
    }
  }
  if (!hints.length) hints.push('• Kein belastbarer Unterschied zwischen den Anfrage-Arten: Was die LLM Box sendet, bremst nicht.');
  if (noise > 0.1) hints.push(`• Die Läufe schwanken selbst um bis zu ${Math.round(noise * 100)} %. Das liegt am Server (GPU-Takt, Wärme, Cache, Textart), nicht an der Anfrage. Ein Vergleich mit der Server-Weboberfläche ist nur mit mehreren Läufen und gleichem Text aussagekräftig.`);
  if (!variants.some((v) => v.srvSeen)) hints.push('• Dieser Server liefert keine eigene Geschwindigkeit (/metrics). Die Zahlen sind in der App gemessen.');
  else hints.push('• Die Zahlen stammen vom Server selbst. Die Messung der App ist damit nicht die Ursache.');
  hints.push('Verlauf der Läufe:', ...tlLines);
  hints.push('• Vergleich mit der Server-Weboberfläche: Sende denselben Prompt dort und in der LLM Box und sieh im Fenster „Server“ → Monitor unter „Letzte Anfragen“ nach: Dort stehen beide Anfragen mit Prompt-Größe, wiederverwendetem Cache und tok/s, vom Server selbst gemessen.');
  render(null, hints);
}


/* ═════════════ Verbindung genau prüfen ═════════════
   Fragt die wichtigen Adressen einzeln ab und erklärt Statuscode und Fehler. Hilft, wenn „Verbindung testen“ scheitert oder die App
   ein geladenes Modell nicht sieht (falsche Adresse, fehlender oder veralteter API-Schlüssel, Firewall, anderer Port). */
async function diagnoseConnection(conn, show) {
  const lines = [];
  const out = (t = '') => { lines.push(t); show(lines.join('\n')); };
  const base = String(conn.baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return out('Die Basis-Adresse muss mit http:// oder https:// beginnen, z. B. http://localhost:8080/v1');
  const hasKey = !!conn.apiKey;
  const mk = (withKey) => ({ 'Content-Type': 'application/json', Accept: 'application/json', ...(withKey && hasKey ? { Authorization: 'Bearer ' + conn.apiKey } : {}) });
  const get = async (url, withKey = true) => {
    const t0 = performance.now();
    let r;
    try { r = await api.fetch({ url, method: 'GET', headers: mk(withKey), timeout: 8000 }); } catch (e) { r = { ok: false, status: 0, error: e.message }; }
    let json = null;
    try { json = JSON.parse(r.text); } catch {}
    return { ...r, json, ms: Math.round(performance.now() - t0) };
  };
  const rootOf = (b) => b.replace(/\/v1$/, '');
  const root = rootOf(base);
  const isOllama = conn.type === 'ollama';
  out(`Adresse: ${base}`);
  out(`Typ: ${isOllama ? 'Ollama' : 'OpenAI-kompatibel'} · API-Schlüssel: ${hasKey ? 'eingetragen und wird gesendet' : 'keiner eingetragen'}`);
  out();
  const modelsUrl = isOllama ? base + '/api/tags' : base + '/models';
  const m = await get(modelsUrl);
  const names = m.json ? (m.json.models || m.json.data || []).map((x) => x.id || x.name).filter(Boolean) : [];
  out(`1) Modellliste  GET ${modelsUrl.replace(base, '…')}  →  ${m.status || 'keine Antwort'} (${m.ms} ms)${m.error ? '  Fehler: ' + m.error : ''}`);
  if (m.ok) out(`   ${names.length} Modell${names.length === 1 ? '' : 'e'}: ${names.slice(0, 5).join(', ') || '–'}`);
  let verdict = '';
  if (!m.ok) {
    if (m.status === 401 || m.status === 403) {
      const nk = hasKey ? await get(modelsUrl, false) : null;
      verdict = hasKey
        ? 'Der Server lehnt den API-Schlüssel ab. Bei Strata erzeugt „strata launch“ ohne festen Schlüssel einen neuen: Trage den aktuellen unter Einstellungen → Verbindungen ein (in Strata: „Schlüssel anzeigen“) oder starte mit einem festen Schlüssel.' + (nk && nk.ok ? ' (Ohne Schlüssel würde es gehen.)' : '')
        : 'Der Server verlangt einen API-Schlüssel, in der Verbindung ist keiner eingetragen.';
    } else if (m.status === 404) {
      const alt = base.endsWith('/v1') ? await get(root + '/models') : await get(base + '/v1/models');
      verdict = alt.ok
        ? `Die Adresse stimmt nicht ganz: Unter ${base.endsWith('/v1') ? root : base + '/v1'} antwortet der Server. Trage ${base.endsWith('/v1') ? root : base + '/v1'} ein.`
        : 'Der Server antwortet, kennt diese Adresse aber nicht. Stimmt der Port? Ist es wirklich ein Server mit OpenAI-Schnittstelle?';
    } else if (m.status === 0) {
      const code = String(m.error || '');
      let host = '';
      try { host = new URL(base).hostname; } catch {}
      let alt = '';
      if (/^localhost$/i.test(host) && /ECONNREFUSED|ETIMEDOUT|ECONNRESET|fetch failed/i.test(code)) {
        for (const h of ['127.0.0.1', '[::1]']) {
          const u = base.replace(/\/\/localhost/i, '//' + h);
          const t = await get(isOllama ? u + '/api/tags' : u + '/models');
          out(`   Gegenprobe mit ${h}: ${t.ok ? 'ANTWORTET' : t.status || 'keine Antwort'}`);
          if (t.ok && !alt) alt = h;
        }
      }
      if (alt) verdict = `„localhost“ führt zu einer Adresse, an der der Server nicht lauscht. Trage stattdessen ${alt} ein (Basis-Adresse: ${base.replace(/\/\/localhost/i, '//' + alt)}).`;
      else if (/ECONNREFUSED/i.test(code)) verdict = 'Nichts nimmt Verbindungen auf dieser Adresse und diesem Port an: Der Server läuft nicht oder lauscht auf einem anderen Port bzw. nur auf einer anderen Adresse (z. B. „--access“ in Strata: lokal, LAN …). Prüfe mit „strata launch --status“.';
      else if (/ETIMEDOUT|Zeit/i.test(code)) verdict = 'Keine Antwort innerhalb von 8 Sekunden: falsche IP-Adresse, Firewall oder der Rechner ist nicht erreichbar.';
      else if (/ENOTFOUND|EAI_AGAIN/i.test(code)) verdict = 'Der Rechnername ist unbekannt. Prüfe die Schreibweise oder nimm die IP-Adresse.';
      else verdict = 'Keine Verbindung. Läuft der Server, und stimmen Adresse und Port?';
    } else verdict = `Der Server antwortet mit Status ${m.status}: ${String(m.text || '').slice(0, 160)}`;
  } else if (/^\s*(<!doctype html|<html)/i.test(String(m.text || ''))) {
    const nk = hasKey ? await get(modelsUrl, false) : null;
    verdict = 'Der Server liefert eine Webseite (HTML) statt der API. Die Adresse zeigt vermutlich auf die Oberfläche der Strata-App statt auf den Modell-Server (ein falscher API-Schlüssel würde bei Strata mit 401 beantwortet, nicht mit einer Seite). Trage den Port des Modell-Servers ein (meist 8080; siehe „strata launch --status“).' + (nk ? (/^\s*(<!doctype html|<html)/i.test(String(nk.text || '')) ? ' Ohne Schlüssel kommt dieselbe Webseite.' : ` Ohne Schlüssel antwortet der Server anders (Status ${nk.status}).`) : '');
  } else if (!names.length && !isOllama) {
    verdict = 'Der Server antwortet, meldet aber kein Modell. Ist in Strata ein Modell geladen? („Modell laden“ im Fenster „Server“.)';
  }
  if (!isOllama) {
    const st = await get(base + '/status');
    const st2 = st.status === 404 ? await get(root + '/v1/status') : st;
    out(`2) Zustand      GET /v1/status  →  ${st2.status || 'keine Antwort'} (${st2.ms} ms)${st2.error ? '  Fehler: ' + st2.error : ''}`);
    if (st2.ok && !st2.json) out(`   ACHTUNG: Antwort ist kein JSON. Anfang: „${String(st2.text || '').replace(/\s+/g, ' ').trim().slice(0, 120)}“`);
    if (st2.ok && st2.json) out(`   Modell geladen: ${st2.json.loaded === false ? 'NEIN' : st2.json.loaded === true ? 'ja' : '(unbekannt)'}${st2.json.model ? ' · ' + st2.json.model : ''}`);
    const mt = await get(root + '/metrics');
    out(`3) Monitor      GET /metrics  →  ${mt.status || 'keine Antwort'} (${mt.ms} ms)${mt.error ? '  Fehler: ' + mt.error : ''}`);
    if (mt.ok && mt.json) out(`   Zustand: ${(mt.json.live && mt.json.live.state) || '–'} · Engine-Modell: ${(mt.json.engine && mt.json.engine.model) || '–'}`);
    if (mt.ok && !(mt.json && ['engine', 'live', 'hardware', 'totals'].some((k) => k in mt.json))) {
      const head = String(mt.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      out(`   ACHTUNG: Antwort 200, aber kein Strata-Monitor-Format. Anfang der Antwort: „${head || '(leer)'}“`);
      out('   → Der Monitor läuft dann im eingeschränkten Modus, sofern /v1/status meldet, dass das Modell geladen ist.');
    }
    else if (mt.status === 404) out('   (kein Strata-Server: /metrics fehlt)');
    if (m.ok && names.length && !(S.models || []).length) verdict = verdict || 'Der Server liefert Modelle, die App zeigt aber keine: Starte die App neu oder klicke oben auf „Aktualisieren“ (Pfeile neben der Modellauswahl).';
  }
  if (!isOllama) {
    out();
    out('4) Strata-Desktop-App (App-Host)');
    for (const path of ['/api/native', '/api/monitor', '/api/health']) {
      const x = await get(root + path);
      const keys = x.json && typeof x.json === 'object' ? Object.keys(x.json).slice(0, 12).join(', ') : '';
      out(`   GET ${path}  →  ${x.status || 'keine Antwort'} (${x.ms} ms)${x.json ? '  Felder: ' + (keys || '–') : x.ok ? '  (kein JSON: ' + String(x.text || '').replace(/\s+/g, ' ').slice(0, 60) + ')' : ''}`);
      if (path === '/api/native' && x.json) {
        const inst = (Array.isArray(x.json.instances) ? x.json.instances : [])[0];
        if (inst) out(`      Instanz: ${Object.keys(inst).slice(0, 12).join(', ')}  |  status=${inst.status} phase=${inst.phase || '–'} port=${inst.port || '–'}  |  metrics-Felder: ${inst.metrics && typeof inst.metrics === 'object' ? Object.keys(inst.metrics).slice(0, 12).join(', ') : 'keine'}`);
      }
    }
  }
  out();
  out(verdict ? '→ ' + verdict : '→ Alles in Ordnung: Der Server antwortet und liefert Modelle.');
}
