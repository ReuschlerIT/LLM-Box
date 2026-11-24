'use strict';

const S = {
  settings: null,
  chatList: [],
  chat: null,
  models: [],
  modelsErr: null,
  attachments: [],
  panelOpen: true,
  search: '',
  stick: true,
  themeKey: '',
  sync: { dir: '', deviceId: 'lokal', deviceName: 'Dieser Rechner' },
  unread: new Set(), // Chats, in denen im Hintergrund eine Antwort fertig wurde
};
const MAX_STEPS = 8;
// „S.generating“ = irgendein Chat arbeitet gerade (für den Chat der Ansicht: viewRun())
Object.defineProperty(S, 'generating', { get: () => RUNS.size > 0, enumerable: false, configurable: true });

/* Kontext-Grenze: Nach „Kontext leeren“ sieht die KI nur noch Nachrichten ab chat.ctxStart (die älteren bleiben sichtbar, werden aber nicht mehr gesendet) */
const ctxStart = (chat) => Math.max(0, Math.min(+(chat && chat.ctxStart) || 0, chat ? chat.messages.length : 0));

const saveSettings = debounce(() => api.store.set('settings', S.settings), 400);
const _soonSet = new Set();
const _soonRun = debounce(() => { const l = [..._soonSet]; _soonSet.clear(); l.forEach((c) => c && saveChatNow(c)); }, 500);
const saveChatSoon = (chat) => { _soonSet.add(chat || S.chat); _soonRun(); };

/* ───── Läufe: pro Chat ein eigener Lauf-Zustand („Run“) ─────
   Mehrere Chats können gleichzeitig arbeiten. Jeder Lauf hat seinen eigenen Zustand: Stopp, Pause, laufende Anfrage,
   offene Freigaben, Live-Karten und den Posteingang für Hinweise an die laufende KI (inbox). Zeigt der Nutzer gerade
   einen anderen Chat, landen die Live-Elemente eines Laufs in seinem unsichtbaren Container (ghost) und werden beim
   Zurückwechseln wieder angezeigt. */
const RUNS = new Set();
const DELETED = new WeakSet(); // gelöschte Chats: laufende Läufe dürfen sie nicht wieder speichern
const UNSENT = new WeakMap(); // Hinweise, die beim Ende eines Laufs nicht mehr zugestellt wurden: kommen ins Eingabefeld zurück
function newRun(chat) {
  return {
    chat, run: null, live: null, stopRequested: false, paused: false, pauseWaiters: [], pauseAborted: false, streaming: false,
    execId: null, pendingApproval: null, runNode: null, runAm: null, hardStop: null, stopResolve: null,
    inbox: [], steerAbort: false, powerOk: false, livePoll: null, ghost: document.createElement('div'),
  };
}
const runOf = (chat) => { if (chat) for (const r of RUNS) if (r.chat === chat) return r; return null; };
const runById = (id) => { for (const r of RUNS) if (r.chat.id === id) return r; return null; };
const viewRun = () => runOf(S.chat); // Lauf des gerade angezeigten Chats (oder null)
const isViewed = (R) => !!R && S.chat === R.chat;
const liveHost = (R) => (!R || isViewed(R) ? document.querySelector('#messages-inner') : R.ghost);
function followBottom(R) { if (S.stick && (!R || isViewed(R))) scrollBottom(); }
function parkLive() {
  const R = viewRun();
  if (!R) return;
  if (R.runNode) R.ghost.append(R.runNode);
  if (typeof TL !== 'undefined') for (const c of TL.cards.values()) if (c.run === R) R.ghost.append(c.node);
  if (R.pendingApproval && R.pendingApproval.card) R.ghost.append(R.pendingApproval.card);
}

// Ohne angelegte Verbindung liefert activeConn() einen Platzhalter (none: true), damit nirgends ein Fehler entsteht
const NO_CONN = { id: '', name: 'Keine Verbindung', type: 'openai', baseUrl: '', apiKey: '', extraParams: false, none: true };
const activeConn = () => S.settings.connections.find((c) => c.id === S.settings.activeConnection) || S.settings.connections[0] || NO_CONN;
const currentModel = () => (S.chat && S.chat.model) || S.settings.model || '';
/* Dateizugriff pro Chat: chat.tools (true/false) gilt nur fuer diesen Chat. Fehlt der Wert, gilt der Standard aus den Einstellungen.
   Der Workspace-Ordner selbst bleibt global. */
const useTools = (chat) => {
  const c = chat || S.chat;
  const on = c && typeof c.tools === 'boolean' ? c.tools : S.settings.workspace.toolsEnabled;
  return !!(on && (typeof wsRoot === 'function' ? wsRoot(c) : S.settings.workspace.path));   // V84: Projektordner des Chats
};
const EXEC_TOOLS = ['run_command', 'install_tool', 'check_tool'];
const askOn = () => S.settings.workspace.askUser !== false;
const askAlone = (chat) => !useTools(chat) && askOn() && S.settings.workspace.askUserAlways === true;
// Welche Werkzeuge dem Modell angeboten werden
function toolsFor(chat) {
  let t = toolsForBase(chat);
  if (chat && typeof autoOn === 'function' && autoOn(chat)) t = autoTools(t); // autonom: keine Rückfragen, dafür finish_task (auto.js)
  t = typeof owuiTools === 'function' ? owuiTools(t) : t; // Websuche-Werkzeuge ergänzen (owui.js)
  t = typeof skillTools === 'function' ? skillTools(t, chat) : t; // use_skill (skills.js)
  return typeof mcpTools === 'function' ? mcpTools(t) : t; // MCP-Server (mcp.js)
}
function toolsForBase(chat) {
  if (useTools(chat)) return LLM.WORKSPACE_TOOLS.filter((t) => (subOn() || t.function.name !== 'delegate_task') && (hoOn() || t.function.name !== 'propose_new_session') && (execOn() || !EXEC_TOOLS.includes(t.function.name)) && (askOn() || t.function.name !== 'ask_user'));
  if (askAlone(chat)) return LLM.WORKSPACE_TOOLS.filter((t) => t.function.name === 'ask_user');
  return null;
}
const execOn = () => S.settings.workspace.execEnabled !== false;

/* ═════════════ Start ═════════════ */
async function init() {
  const stored = await api.store.get('settings');
  const firstRun = !stored || (typeof stored === 'object' && !Object.keys(stored).length);   // allererster Start: noch nie Einstellungen gespeichert
  S.settings = deepMerge(DEFAULTS, stored || {});
  // Einmalig (V43): Standard-Design ist Hell. Ein früher gespeichertes „Dunkel“ würde den neuen Standard sonst überschreiben.
  if (!S.settings.appearance.lightDefaultApplied) {
    S.settings.appearance.theme = 'light';
    S.settings.appearance.lightDefaultApplied = true;
    api.store.set('settings', S.settings);
  }
  // Migration: Preise waren früher in USD gespeichert, jetzt direkt in €
  if (stored && stored.pricing && !stored.pricing.eur) {
    const pr = S.settings.pricing;
    const rate = +pr.usdToEur || 0.9;
    const x = PRICE_PRESETS.find((y) => y.id === pr.preset);
    if (x && x.in !== null) { const e = presetEur(x, rate); pr.priceIn = e.in; pr.priceOut = e.out; }
    else { pr.priceIn = Math.round((+stored.pricing.priceIn || 0) * rate * 1000) / 1000; pr.priceOut = Math.round((+stored.pricing.priceOut || 0) * rate * 1000) / 1000; }
    pr.eur = true;
    delete pr.currency;
    S.settings.connections.forEach((c) => {
      if (c.priceIn !== null && c.priceIn !== undefined && c.priceIn !== '') c.priceIn = Math.round(c.priceIn * rate * 1000) / 1000;
      if (c.priceOut !== null && c.priceOut !== undefined && c.priceOut !== '') c.priceOut = Math.round(c.priceOut * rate * 1000) / 1000;
    });
    saveSettings();
  }
  if (stored && stored.workspace && stored.workspace.confirmWrites === false && !stored.workspace.approval) S.settings.workspace.approval = 'none';
  if (!Array.isArray(S.settings.connections)) S.settings.connections = [];
  // Einmalig (V47): Steht noch der alte Mini-Standard-Prompt drin, wird er durch den neuen Standard ersetzt. Eigene Prompts bleiben.
  if (!S.settings.promptDefaultV47) {
    S.settings.promptDefaultV47 = true;
    if (!S.settings.systemPrompt || S.settings.systemPrompt.trim() === 'Du bist ein hilfreicher, präziser Assistent. Antworte in der Sprache des Nutzers.') S.settings.systemPrompt = DEFAULTS.systemPrompt;
    api.store.set('settings', S.settings);
  }
  // Einmalig (V46): Die alten Vorgaben „Ollama (lokal)“ und „LM Studio“ entfernen (nur wenn unverändert) und „Strata_API“ als Standard sicherstellen.
  if (!S.settings.connDefaultsV46) {
    S.settings.connDefaultsV46 = true;
    const untouched = (c) => (c.id === 'ollama' && c.name === 'Ollama (lokal)' && c.baseUrl === 'http://localhost:11434' && !c.apiKey)
      || (c.id === 'lmstudio' && c.name === 'LM Studio' && c.baseUrl === 'http://localhost:1234/v1' && !c.apiKey);
    S.settings.connections = S.settings.connections.filter((c) => !untouched(c));
    if (!S.settings.connections.some((c) => c.name === 'Strata_API')) S.settings.connections.unshift(JSON.parse(JSON.stringify(DEFAULTS.connections[0])));
    if (!S.settings.connections.some((c) => c.id === S.settings.activeConnection)) S.settings.activeConnection = S.settings.connections[0].id;
    api.store.set('settings', S.settings);
  }
  if (!S.settings.connections.some((c) => c.id === S.settings.activeConnection)) S.settings.activeConnection = S.settings.connections[0] ? S.settings.connections[0].id : '';

  applyProfileOnce(firstRun);
  if (typeof migrateV84 === 'function') migrateV84(firstRun);
  if (typeof mcpSync === 'function') mcpSync();   // V86: MCP-Server verbinden (wartet nicht)   // V84: Standard-Skills, Dateizugriff fuer neue Chats aus
  buildChrome();
  api.appInfo().then((i) => {
    const t = `Reuschler-IT - LLM Box v${i.version}`;
    $('#tb-title').textContent = t;
    document.title = t;
  });
  applyAppearance();
  applyLanguage(S.settings.uiLang);
  if (syncDefaultPrompt()) saveSettings();   // unveraenderter Standard-Prompt immer in Sprache/Profil-Laenge (auch wenn die Sprache schon gespeichert war)
  if (firstRun) showLanguageChooser();       // allererster Start: Sprache waehlen lassen (nicht blockierend)
  applySpell();
  wireEvents();
  try { S.sync = await api.sync.get(); } catch { S.sync = { dir: '', deviceId: 'lokal', deviceName: 'Dieser Rechner' }; }
  api.onChatsChanged((m) => onRemoteChats(m));
  setInterval(updateBusyNotice, 20000); // abgelaufene „arbeitet gerade“-Markierungen (Rechner abgestürzt) ausblenden
  await loadChatList();
  if (typeof usageInit === 'function') usageInit();   // Gesamtverbrauch laden
  if (typeof owSearxAutostart === 'function') owSearxAutostart();   // SearXNG im Hintergrund starten, falls so eingestellt
  if (S.chatList.length) await openChat(S.chatList[0].id);
  if (!S.settings.connections.length) setTimeout(() => { toast('Lege zuerst eine Verbindung zu deinem KI-Server an.', 6000); openSettings('conn'); }, 400);
  else newChat();
  renderConnSelect();
  renderFilePanel();
  refreshModels();
}

/* ═════════════ Uebernahme: Einstellungen neu in die Oberflaeche laden ═════════════
   Eine Uebertragung (WLAN oder JSON-Datei) schreibt die Einstellungen nur in den
   Datenspeicher. Die hier schon laufende Oberflaeche arbeitet jedoch mit dem S.settings
   vom Programmstart - ohne erneutes Laden bleiben Verbindung, Modell, Parameter und
   Workspace auf dem alten Stand, bis die App neu gestartet wird. Genau das wurde als
   "nicht die richtigen Einstellungen uebertragen" gemeldet.
   Schlimmer noch: der Debounce saveSettings() (app.js:36) schrieb kurz danach den alten
   Speicherstand zurueck und ueberschrieb damit die gerade uebernommene Datei - u. a.
   weil refreshModelInfo() bei fremdem Modell numCtx uebernimmt und speichert.
   Diese Funktion wartet offene Schreiblaeufe ab, liest neu, fuehrt dieselben
   Einmal-Korrekturen wie init() aus und holt dann Modelle und Chats neu. */
async function applyIncomingSettings() {
  await new Promise((r) => setTimeout(r, 700));            // laufenden saveSettings()-Debounce abwarten
  const stored = await api.store.get('settings');
  S.settings = deepMerge(DEFAULTS, stored || {});
  if (!Array.isArray(S.settings.connections)) S.settings.connections = [];

  // Dieselben Einmal-Korrekturen wie beim Start (init), damit eine uebernommene Datei nicht
  // auf halber Migration stehen bleibt. Die V46-Bereinigung (alte Standard-Verbindungen
  // loeschen) wird bewusst NICHT angewendet: sie wuerde frisch uebertragene Verbindungen
  // mit denselben Standard-Adressen loeschen, obwohl der Nutzer sie gerade erst gewaehlt hat.
  if (!S.settings.appearance.lightDefaultApplied) { S.settings.appearance.theme = 'light'; S.settings.appearance.lightDefaultApplied = true; }
  if (stored && stored.pricing && !stored.pricing.eur) S.settings.pricing.eur = true;
  // Bewusst anders formuliert als in init(): der Android-Build patcht die Zeile aus init()
  // und verlangt dort einen eindeutigen Suchtext.
  const wsIn = stored ? stored.workspace : null;
  if (wsIn && wsIn.confirmWrites === false && !wsIn.approval) S.settings.workspace.approval = 'none';
  if (!S.settings.promptDefaultV47) S.settings.promptDefaultV47 = true;
  S.settings.connDefaultsV46 = true;
  if (!S.settings.connections.some((c) => c.id === S.settings.activeConnection)) {
    S.settings.activeConnection = S.settings.connections[0] ? S.settings.connections[0].id : '';
  }

  applyAppearance();
  applySpell();
  renderConnSelect();
  updateToolsBtn();
  renderFilePanel();
  await refreshModels();          // Verbindungstest + Modelliste + Statuszeile
  await loadChatList();
  if (S.chatList.length) await openChat(S.chatList[0].id); else newChat();
  renderStatus();
  updateCtxMeter();

  const c = activeConn();
  return { verbindungen: S.settings.connections.length, verbindung: c.name, erreichbar: !S.modelsErr, modelle: S.models.length, modell: currentModel(), fehler: S.modelsErr || '' };
}

const THINK_LEVELS = [
  { id: 'auto', label: 'Auto', hint: 'Standardverhalten des Modells' },
  { id: 'off', label: 'Aus', hint: 'Ohne Denkphase – am schnellsten' },
  { id: 'low', label: 'Schnell', hint: 'Kurzes Nachdenken' },
  { id: 'medium', label: 'Normal', hint: 'Ausgewogen' },
  { id: 'high', label: 'Hoch', hint: 'Gründlich – dauert länger' },
];
/* Denkaufwand pro Chat: chat.thinking gilt nur fuer diesen Chat, ohne Wert der Standard aus den Einstellungen. */
const thinkId = (chat) => { const c = chat || S.chat; return c && c.thinking && THINK_LEVELS.some((l) => l.id === c.thinking) ? c.thinking : S.settings.thinking; };
const thinkLevel = (chat) => THINK_LEVELS.find((l) => l.id === thinkId(chat)) || THINK_LEVELS[0];

/* Eingabeleiste zeigt nur Symbole: Beschriftung samt Zustand (z. B. „Denken: Auto“) kommt als Tooltip. Die Chips bauen ihren Inhalt bei jeder Änderung neu auf, daher beobachten wir sie. */
function composerTips() {
  const bar = $('.composer-bar .left');
  if (!bar) return;
  const apply = () => {
    for (const b of bar.querySelectorAll('.chip-btn, .icon-btn')) {
      const sp = b.querySelector(':scope > span');
      const lab = sp ? sp.textContent.trim() : '';
      let base = b.dataset.base;
      if (base === undefined || (b.title && !b.title.startsWith(lab + ' – ') && b.title !== b.dataset.tipFull)) base = b.dataset.base = b.title || '';
      const full = lab && base ? lab + ' – ' + base : (lab || base);
      b.dataset.tipFull = full;
      b.dataset.tip = full;
      if (b.title) b.title = ''; // natives Tooltip aus, damit nicht doppelt (nur bei Bedarf setzen, sonst löst der Beobachter sich selbst aus)
    }
  };
  new MutationObserver(apply).observe(bar, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'class'] });
  apply();
}

function updateThinkBtn() {
  const b = $('#btn-think');
  const l = thinkLevel();
  b.classList.toggle('on', l.id !== 'auto');
  b.innerHTML = icon('sparkle', 15) + `<span>Denken: ${l.label}</span>`;
  b.title = 'Denkaufwand: ' + l.hint;
}

function openThinkMenu() {
  openMenu($('#btn-think'), THINK_LEVELS.map((l) => ({
    label: l.label,
    hint: l.hint,
    active: l.id === thinkLevel().id,
    onClick: () => {
      if (S.chat) { S.chat.thinking = l.id; saveChatSoon(S.chat); }   // nur dieser Chat
      else { S.settings.thinking = l.id; saveSettings(); }
      updateThinkBtn();
    },
  })));
}

function buildChrome() {
  $('#tb-logo').innerHTML = brandMark();
  $('#btn-new').innerHTML = icon('plus') + '<span>Neuer Chat</span><kbd>Strg+N</kbd>';
  $('#ico-search').innerHTML = icon('search', 15);
  $('#btn-settings').innerHTML = icon('sliders');
  $('#btn-refresh').innerHTML = icon('refresh', 16);
  initSubagents();
  initHandoff();
  initStrataImport();
  if (typeof owuiInit === 'function') owuiInit();
  if (typeof autoInit === 'function') autoInit();
  if (typeof liveInit === 'function') liveInit();
  if (typeof applyModules === 'function') applyModules();
  $('#btn-export').innerHTML = icon('dots', 17);
  $('#btn-panel').innerHTML = icon('panel', 17);
  $('#btn-attach').innerHTML = icon('paperclip');
  $('#btn-attach-folder').innerHTML = icon('folder');
  $('#scroll-down').innerHTML = icon('down', 16);
  updateToolsBtn();
  updatePermBtn();
  updateThinkBtn();
  updateSendBtn();
}

const COLOR_VARS = { bg: '--bg', side: '--bg-side', raised: '--bg-raised', input: '--bg-input', line: '--line', text: '--text', textDim: '--text-dim', codeBg: '--code-bg', userBubble: '--user-bubble', assistantBg: '--assistant-bg' };

function resolvedTheme() {
  const t = S.settings.appearance.theme;
  return t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function applyAppearance() {
  const a = S.settings.appearance;
  const th = resolvedTheme();
  const dark = th === 'dark';
  const root = document.documentElement;
  const rs = root.style;
  root.dataset.theme = th;

  // Alte Überschreibungen entfernen, dann neu setzen
  [...Object.values(COLOR_VARS), '--bg-hover', '--text-faint', '--font-ui', '--font-code', '--bg-img'].forEach((v) => rs.removeProperty(v));
  const tok = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const c = (a.custom && a.custom[th]) || {};
  // Transparenz pro Farbe (a.alpha[Modus][Schlüssel] = Deckkraft in %, fehlt = 100)
  const al = (a.alpha && a.alpha[th]) || {};
  const pctOf = (k) => (al[k] == null ? 100 : Math.min(100, Math.max(0, +al[k])));
  const rgba = (hex, pct) => (pct >= 100 ? hex : `rgba(${hexToRgb(hex).join(',')}, ${(pct / 100).toFixed(2)})`);
  const eff = {}; // Basisfarben als Hex (auch für Farben, bei denen nur die Transparenz geändert wurde)
  for (const k of Object.keys(COLOR_VARS)) {
    let base = c[k];
    if (!base && pctOf(k) < 100 && k !== 'assistantBg') base = defaultColor(k, th, a.accent, c);
    if (!base) continue;
    eff[k] = base;
    rs.setProperty(COLOR_VARS[k], rgba(base, pctOf(k)));
  }
  const bgEff = eff.bg || tok('--bg');
  if (eff.raised) rs.setProperty('--bg-hover', rgba(mixHex(eff.raised, eff.text || (dark ? '#ffffff' : '#000000'), 0.14), pctOf('raised')));
  if (eff.textDim) rs.setProperty('--text-faint', rgba(mixHex(eff.textDim, bgEff, 0.35), pctOf('textDim')));
  else if (eff.text) {
    rs.setProperty('--text-dim', rgba(mixHex(eff.text, bgEff, 0.38), pctOf('text')));
    rs.setProperty('--text-faint', rgba(mixHex(eff.text, bgEff, 0.6), pctOf('text')));
  }

  rs.setProperty('--accent', rgba(a.accent, a.accentAlpha == null ? 100 : Math.min(100, Math.max(0, +a.accentAlpha))));
  // Fenstermaterial (Windows 11): macht Transparenz zu echtem Durchscheinen des Desktops
  const mat = a.winMaterial || 'none';
  if (S._mat !== mat && api.setWindowMaterial) {
    S._mat = mat;
    api.setWindowMaterial(mat).then((ok) => { if (!ok && mat !== 'none') toast('Fenstermaterial wird von diesem System nicht unterstützt (Windows 11 22H2 oder neuer nötig).', 6000); }).catch(() => {});
  }
  rs.setProperty('--fs', (a.fontSize || 15) + 'px');
  rs.setProperty('--lh', a.lineHeight || 1.65);
  rs.setProperty('--msg-width', (a.messageWidth || 820) + 'px');
  rs.setProperty('--radius', (a.radius ?? 10) + 'px');
  rs.setProperty('--sidebar-w', (a.sidebarWidth || 268) + 'px');

  const ui = a.fontFamily === 'custom' ? (a.fontFamilyCustom ? `"${a.fontFamilyCustom}", "Segoe UI", sans-serif` : '') : (FONT_UI[a.fontFamily] || {}).stack;
  if (ui) rs.setProperty('--font-ui', ui);
  const code = a.codeFont === 'custom' ? (a.codeFontCustom ? `"${a.codeFontCustom}", Consolas, monospace` : '') : (FONT_CODE[a.codeFont] || {}).stack;
  if (code) rs.setProperty('--font-code', code);

  // Hintergrundbild
  let img = '';
  if (a.bgMode === 'brand' && dark) img = new URL('assets/bg.jpg', document.baseURI).href;
  else if (a.bgMode === 'custom' && a.bgImage) img = a.bgImage;
  if (img) rs.setProperty('--bg-img', `url("${img}")`);
  rs.setProperty('--bg-opacity', String((a.bgOpacity ?? 75) / 100));
  rs.setProperty('--bg-blur', (a.bgBlur || 0) + 'px');
  rs.setProperty('--bg-filter', a.bgBlur > 0 ? `blur(${a.bgBlur}px)` : 'none');
  document.body.classList.toggle('has-bg', !!img);
  document.body.classList.toggle('has-assistant-bg', !!c.assistantBg);

  $('#hl-theme').setAttribute('href', dark ? 'vendor/hl-dark.css' : 'vendor/hl-light.css');
  document.body.classList.toggle('nostats', !a.showStats);
  const color = tok('--bg-side');
  const symbolColor = tok('--text-dim');
  const key = color + symbolColor + dark;
  if (key !== S.themeKey) {
    S.themeKey = key;
    api.setWindowTheme({ color, symbolColor, dark });
  }
}

// Rechtschreibprüfung an den Hauptprozess melden (Ein/Aus und Sprachen)
function applySpell() {
  const sp = (S.settings && S.settings.spell) || {};
  try { if (typeof api.spellSet === 'function') api.spellSet({ enabled: sp.enabled !== false, lang: sp.lang || 'de-en' }); } catch {}
}

const settingsChanged = debounce(() => {
  applyAppearance();
  if (typeof applyModules === 'function') applyModules();
  applySpell();
  renderConnSelect();
  updateToolsBtn();
  renderFilePanel();
  renderStatus();
  updateCtxMeter();
  if (S.chat && !viewRun()) renderMessages();
}, 120);

/* ═════════════ Verbindung & Modelle ═════════════ */
function renderConnSelect() {
  const s = $('#sel-conn');
  s.innerHTML = '';
  if (!S.settings.connections.length) s.append(el('option', { value: '', text: 'Keine Verbindung' }));
  S.settings.connections.forEach((c) => s.append(el('option', { value: c.id, text: c.name })));
  s.value = activeConn().id;
}

function renderModelSelect() {
  const s = $('#sel-model');
  s.innerHTML = '';
  const cur = currentModel();
  const ids = S.models.map((m) => m.id);
  if (cur && !ids.includes(cur)) ids.unshift(cur);
  if (!ids.length) s.append(el('option', { value: '', text: S.modelsErr ? 'Keine Verbindung' : 'Keine Modelle gefunden' }));
  ids.forEach((id) => { const m = S.models.find((x) => x.id === id); s.append(el('option', { value: id, text: m && m.installedOnly ? id + '  (installiert, nicht geladen)' : id })); });
  s.append(el('option', { value: '__manual', text: 'Modell manuell eingeben …' }));
  s.value = cur || ids[0] || '';
}

function setModel(id) {
  S.settings.model = id;
  if (S.chat) S.chat.model = id;
  saveSettings();
  if (S.chat && S.chat.messages.length) saveChatSoon();
}

/* Liest Kontextgröße u. a. vom Server und übernimmt sie (nur OpenAI-kompatible Server) */
async function refreshModelInfo() {
  const conn = activeConn();
  const model = currentModel();
  if (S.modelsErr || !model) { S.modelInfo = null; return; }
  const token = (S._infoToken = (S._infoToken || 0) + 1);
  let inf = null;
  try { inf = await LLM.modelInfo(conn, model, S.models); } catch { inf = null; }
  if (token !== S._infoToken) return; // veraltete Antwort
  S.modelInfo = inf;
  if (inf && inf.ctx && conn.type !== 'ollama' && S.settings.params.autoCtx !== false && +S.settings.params.numCtx !== inf.ctx) {
    S.settings.params.numCtx = inf.ctx;
    saveSettings();
    toast(`Kontextlänge vom Server übernommen: ${fmt.num(inf.ctx)} Tokens${inf.runtime ? '' : ' (Trainings-Maximum, nicht unbedingt geladen)'}.`, 5000);
  }
  updateCtxMeter();
}

// Fragt bei Strata-artigen Servern, ob das Modell geladen ist (/v1/status, /health). null = unbekannt.
async function probeServerState(conn) {
  if (!conn || conn.type === 'ollama' || conn.type === 'anthropic') return null;
  const root = String(conn.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
  const headers = conn.apiKey ? { Authorization: 'Bearer ' + conn.apiKey } : {};
  for (const path of ['/v1/status', '/health']) {
    try {
      const r = await api.fetch({ url: root + path, method: 'GET', headers, timeout: 4000 });
      if (!r.ok) continue;
      let j = null;
      try { j = JSON.parse(r.text); } catch {}
      if (j && typeof j.loaded === 'boolean') return j.loaded ? 'Modell geladen' : 'Modell entladen';
    } catch {}
  }
  return null;
}

async function refreshModels() {
  const conn = activeConn();
  S.srvState = null;
  if (conn.none) {
    S.models = [];
    S.modelsErr = 'Keine Verbindung eingerichtet';
    setConnStatus('err', 'Keine Verbindung');
    renderModelSelect();
    renderStatus();
    return;
  }
  setConnStatus('pending', 'Verbinde …');
  try {
    S.models = await LLM.listModels(conn);
    S.modelsErr = null;
  } catch (e) {
    S.models = [];
    S.modelsErr = e.message;
  }
  if (!S.modelsErr && S.models.length) {
    const cur = currentModel();
    if (!cur || (conn.type === 'ollama' && !S.models.some((m) => m.id === cur))) setModel((S.models.find((m) => !m.installedOnly) || S.models[0]).id);
  }
  renderModelSelect();
  renderStatus();
  if (S.chat && !S.chat.messages.length) renderMessages();
  refreshModelInfo();
  probeServerState(conn).then((st) => { if (activeConn().id === conn.id && st !== S.srvState) { S.srvState = st; renderStatus(); } });
}

function setConnStatus(state, text) {
  const n = $('#conn-status');
  n.className = 'conn-status ' + (state === 'ok' ? 'ok' : state === 'err' ? 'err' : '');
  $('.txt', n).textContent = text;
  n.title = text;
}

/* ═════════════ Chats ═════════════ */
async function loadChatList() {
  S.chatList = await api.chats.list();
  renderChatList();
}

function renderChatList() {
  const box = $('#chat-list');
  box.innerHTML = '';
  const q = S.search.toLowerCase();
  const orgOn = typeof modOn === 'function' && modOn('organize') && typeof owOrg === 'function';
  const org = orgOn ? owOrg() : { pins: {}, archived: {}, tags: {} };
  const tagQ = orgOn && q.startsWith('#') ? q.slice(1) : '';
  let items = S.chatList.filter((c) => (tagQ ? (org.tags[c.id] || []).some((t) => t.toLowerCase().includes(tagQ)) : !q || (c.title || '').toLowerCase().includes(q)));
  const archived = orgOn ? items.filter((c) => org.archived[c.id]) : [];
  if (orgOn) items = [...items.filter((c) => org.pins[c.id] && !org.archived[c.id]), ...items.filter((c) => !org.pins[c.id] && !org.archived[c.id])]; // Angeheftete zuerst
  if (!items.length && !archived.length) {
    box.append(el('div', { class: 'group-title', text: q ? 'Keine Treffer' : 'Noch keine Chats' }));
    return;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groupOf = (t) => {
    const d = Math.floor((today - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
    return d <= 0 ? 'Heute' : d === 1 ? 'Gestern' : d <= 7 ? 'Letzte 7 Tage' : d <= 30 ? 'Letzte 30 Tage' : 'Älter';
  };
  const addItem = (c, isArchived) => {
    const title = el('span', { class: 't' }, c.source === 'strata' ? el('span', { class: 'src-badge', text: 'Strata', title: 'Aus der Strata-Weboberfläche importiert' }) : null, c.title || 'Chat');
    const rr = runById(c.id);
    const isRun = !!rr;
    const dot = isRun ? el('span', { class: 'chat-dot ' + (rr.pendingApproval ? 'attn' : 'run'), title: rr.pendingApproval ? 'Wartet auf deine Antwort oder Freigabe' : 'Die KI arbeitet hier gerade' })
      : S.unread.has(c.id) ? el('span', { class: 'chat-dot unread', title: 'Neue Antwort' }) : null;
    const tags = orgOn ? org.tags[c.id] || [] : [];
    const acts = el('span', { class: 'acts' });
    if (orgOn) {
      acts.append(
        el('button', { class: 'mini-btn', title: org.pins[c.id] ? 'Lösen' : 'Anheften', html: icon('pin', 14), onclick: (e) => { e.stopPropagation(); owuiTogglePin(c.id); } }),
        el('button', { class: 'mini-btn', title: 'Tags', html: icon('tag', 14), onclick: (e) => { e.stopPropagation(); owuiEditTags(c.id); } }),
        el('button', { class: 'mini-btn', title: isArchived ? 'Aus dem Archiv holen' : 'Archivieren', html: icon('archive', 14), onclick: (e) => { e.stopPropagation(); owuiToggleArchive(c.id); } })
      );
    }
    acts.append(
      el('button', { class: 'mini-btn', title: 'Umbenennen', html: icon('edit', 14), onclick: (e) => { e.stopPropagation(); renameChat(c.id); } }),
      el('button', { class: 'mini-btn', title: 'Löschen', html: icon('trash', 14), onclick: (e) => { e.stopPropagation(); deleteChat(c.id); } })
    );
    const item = el('div', { class: 'chat-item' + (S.chat && S.chat.id === c.id ? ' active' : '') + (orgOn && org.pins[c.id] ? ' pinned' : ''), title: `${c.title}\n${fmt.tok(c.tokens || 0)} Tokens`, onclick: () => openChat(c.id) },
      dot,
      orgOn && org.pins[c.id] ? el('span', { class: 'pin-mark', html: icon('pin', 12) }) : null,
      title,
      tags.length ? el('span', { class: 'chat-tags' }, tags.map((t) => el('span', { class: 'tag', text: t, title: 'Nach diesem Tag filtern', onclick: (e) => { e.stopPropagation(); S.search = '#' + t; const si = $('#chat-search'); if (si) si.value = '#' + t; renderChatList(); } }))) : null,
      acts
    );
    item.addEventListener('dblclick', () => renameChat(c.id));
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); openChatMenu({ x: e.clientX, y: e.clientY }, c.id); });
    box.append(item);
  };
  let last = '';
  for (const c of items) {
    const g = orgOn && org.pins[c.id] ? 'Angeheftet' : groupOf(c.created || c.updated || 0);
    if (g !== last) {
      box.append(el('div', { class: 'group-title', text: g }));
      last = g;
    }
    addItem(c, false);
  }
  if (archived.length) {
    box.append(el('button', { class: 'group-title archive-toggle', text: (S.showArchive ? '▾ ' : '▸ ') + 'Archiv (' + archived.length + ')', onclick: () => { S.showArchive = !S.showArchive; renderChatList(); } }));
    if (S.showArchive) for (const c of archived) addItem(c, true);
  }
}

function newChat() {
  const wasLive = typeof liveLeave === 'function' && liveLeave();
  if (S.chat && !S.chat.messages.length) {
    if (wasLive) renderAll();
    $('#input').focus();
    return;
  }
  parkLive();
  S.stick = true;
  S.chat = { id: uid(), title: 'Neuer Chat', created: Date.now(), updated: Date.now(), connectionId: activeConn().id, model: S.settings.model, messages: [] };
  S.attachments = [];
  renderAll();
  $('#input').focus();
}

async function openChat(id) {
  if (typeof liveLeave === 'function') liveLeave(); // Live-Ansicht verlassen, falls aktiv
  if (S.chat && S.chat.id === id && runOf(S.chat)) return;
  // Läuft in diesem Chat gerade die KI, gilt das Objekt im Speicher (die Datei auf der Platte ist veraltet)
  const R = runById(id);
  const c = R ? R.chat : await api.chats.load(id);
  if (!c) return;
  parkLive();
  S.chat = c;
  if (typeof autoRegister === 'function') autoRegister(c);
  S.attachments = [];
  S.stick = true;
  S.unread.delete(id);
  if (!R && c.connectionId && c.connectionId !== S.settings.activeConnection && S.settings.connections.some((x) => x.id === c.connectionId)) {
    S.settings.activeConnection = c.connectionId; // laufende Chats behalten ihre eigene Verbindung
    saveSettings();
    renderConnSelect();
    refreshModels();
  }
  renderAll();
  restoreUnsent(c);
  const bg = [...RUNS].filter((r) => r !== R);
  if (bg.length) toast(bg.length === 1 ? `Die Antwort in „${bg[0].chat.title}“ läuft im Hintergrund weiter.` : `${bg.length} Antworten laufen im Hintergrund weiter.`, 3500);
}

async function saveChatNow(chat) {
  const c = chat || S.chat;
  if (!c || c._live || !c.messages.length || DELETED.has(c)) return; // gelöschte Chats nicht wieder anlegen, Live-Ansicht (fremder Chat) nie speichern
  c.updated = Date.now();
  // „arbeitet gerade“: Andere Rechner sehen, dass hier eine Antwort läuft, und schreiben nicht dazwischen
  const busy = runOf(c) ? { dev: S.sync.deviceId, name: S.sync.deviceName, ts: Date.now() } : null;
  const meta = { id: c.id, title: c.title, created: c.created, updated: c.updated, model: c.model, tokens: chatTotals(c).total, source: c.source, importKey: c.importKey, busy };
  let r = null;
  try { r = await api.chats.save(c, meta); } catch (e) { toast('Chat konnte nicht gespeichert werden: ' + e.message, 6000); return; }
  if (r && r.conflict) {
    // Ein anderer Rechner hat diesen Chat gleichzeitig geändert: Nichts überschrieben, die eigene Fassung liegt als Kopie vor
    c.id = r.conflict.id;
    c.title = r.conflict.title;
    toast(`Der Chat wurde auf einem anderen Rechner gleichzeitig geändert. Deine Fassung wurde als Kopie „${c.title}“ gespeichert.`, 10000);
    await loadChatList();
    return;
  }
  const i = S.chatList.findIndex((x) => x.id === c.id);
  if (i >= 0) S.chatList[i] = meta;
  else S.chatList.push(meta);
  S.chatList.sort((a, b) => (b.created || b.updated || 0) - (a.created || a.updated || 0));   // feste Reihenfolge nach Erstellung
  renderChatList();
}

/* ───── Geräteübergreifend: Änderungen von anderen Rechnern ───── */
const chatSig = (c) => { const l = c && c.messages && c.messages[c.messages.length - 1]; return (c ? c.messages.length : 0) + ':' + (l ? String(l.content || '').length + ':' + (l.toolCalls || []).length + ':' + (l.error ? 1 : 0) : 0); };
function remoteBusy(chat) {
  const m = chat && S.chatList.find((x) => x.id === chat.id);
  const b = m && m.busy;
  return b && b.dev !== S.sync.deviceId && Date.now() - (b.ts || 0) < 180000 ? b : null; // 3 min ohne Lebenszeichen = abgestürzt
}
function updateBusyNotice() {
  const s = $('#busy-strip');
  if (!s) return;
  const b = remoteBusy(S.chat);
  s.classList.toggle('hidden', !b);
  s.innerHTML = '';
  if (b) s.append(el('span', { class: 'queued-icon', html: icon('zap', 13, 2) }), el('span', { class: 'queued-hint', text: `Auf „${b.name || 'einem anderen Rechner'}“ arbeitet die KI gerade in diesem Chat. Senden ist erst danach möglich.` }));
}
let remoteWarned = '';
async function onRemoteChats(m) {
  if (!m) return;
  try { S.chatList = await api.chats.list(); } catch { return; }
  renderChatList();
  const cur = S.chat;
  if (cur) {
    if ((m.removed || []).includes(cur.id)) toast('Dieser Chat wurde auf einem anderen Rechner gelöscht. Er wird beim nächsten Speichern neu angelegt.', 6000);
    else if ((m.metas || []).some((x) => x.id === cur.id)) {
      if (runOf(cur)) {
        if (remoteWarned !== cur.id) { remoteWarned = cur.id; toast('Dieser Chat wurde auf einem anderen Rechner geändert. Beim Speichern entsteht eine Konfliktkopie.', 8000); }
      } else {
        const c = await api.chats.load(cur.id);
        if (c && S.chat === cur) {
          const changed = chatSig(c) !== chatSig(cur);
          cur.title = c.title;
          if (changed) {
            S.chat = c;
            renderMessages();
            renderStatus();
            updateCtxMeter();
            renderChatList();
            toast('Chat wurde auf einem anderen Rechner aktualisiert.', 2500);
          }
        }
      }
    }
  }
  updateBusyNotice();
  updateSendBtn();
}

async function renameChat(id) {
  const meta = S.chatList.find((c) => c.id === id);
  const t = await promptModal('Chat umbenennen', 'Neuer Titel', meta ? meta.title : '');
  if (!t) return;
  if (S.chat && S.chat.id === id) {
    S.chat.title = t;
    await saveChatNow();
  } else {
    const c = await api.chats.load(id);
    if (!c) return;
    c.title = t;
    await api.chats.save(c, { ...meta, title: t });
    meta.title = t;
    renderChatList();
  }
}

async function deleteChat(id) {
  const meta = S.chatList.find((c) => c.id === id);
  const working = !!runById(id);
  if (!(await confirmModal('Chat löschen', `„${meta ? meta.title : 'Chat'}“ wird unwiderruflich gelöscht.` + (working ? ' Die KI arbeitet hier gerade, ihre Antwort wird abgebrochen.' : ''), { okLabel: 'Löschen', danger: true }))) return;
  // Läuft hier (inzwischen) die KI: Chat vormerken, damit der Lauf ihn nicht wieder speichert, dann den Lauf beenden
  const R = runById(id);
  if (R) { DELETED.add(R.chat); stopGeneration(R); }
  await api.chats.delete(id);
  S.chatList = S.chatList.filter((c) => c.id !== id);
  S.unread.delete(id);
  if (S.chat && S.chat.id === id) {
    S.chat = null;
    newChat();
  }
  renderChatList();
}
// „Alle Chats löschen“: alle laufenden Läufe beenden, ohne dass sie ihre Chats wieder speichern
function discardAllRuns() {
  for (const R of [...RUNS]) { DELETED.add(R.chat); stopGeneration(R); }
}

/* ───── Kosten ───── */
function connOf(chat) {
  return S.settings.connections.find((c) => c.id === (chat && chat.connectionId)) || activeConn();
}
function pricesFor(conn) {
  const p = S.settings.pricing;
  const has = (v) => v !== null && v !== undefined && v !== '';
  return { in: has(conn && conn.priceIn) ? +conn.priceIn : +p.priceIn || 0, out: has(conn && conn.priceOut) ? +conn.priceOut : +p.priceOut || 0 };
}
function costOfStats(s, conn) {
  const pr = pricesFor(conn);
  return (fin(s.promptTokens) * pr.in + fin(s.completionTokens) * pr.out) / 1e6;
}
function chatCost(chat) {
  const conn = connOf(chat);
  let amount = 0, est = false;
  for (const m of chat.messages) if (m.role === 'assistant' && m.stats) { amount += costOfStats(m.stats, conn); if (m.stats.estimated) est = true; }
  return { amount, est, pr: pricesFor(conn) };
}
const fmtNum = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
/* Stromkosten: Energie aus der GPU-Leistung des Monitors (siehe server.js, enAdd), Preis in € je kWh aus Einstellungen → Kosten */
const powerPrice = () => svPowerPrice();
function chatEnergy(chat) { // Wattstunden aller Antworten dieses Chats, die gemessen wurden
  let wh = 0, any = false;
  for (const m of chat.messages) if (m.role === 'assistant' && m.stats && fin(m.stats.energyWh) > 0) { wh += +m.stats.energyWh; any = true; }
  return { wh, any };
}
const energyCost = (wh) => (wh / 1000) * powerPrice();
const fmtEnergy = (wh) => (wh >= 1000 ? (wh / 1000).toFixed(2) + ' kWh' : wh >= 10 ? wh.toFixed(1) + ' Wh' : wh.toFixed(2) + ' Wh').replace('.', ',');
const energyTip = (wh) => `${fmtEnergy(wh)} × ${fmtNum(powerPrice())} € je kWh\nBerechnet aus der GPU-Leistung (Monitor), über die Zeit der Anfragen aufsummiert. Nur die GPU des überwachten Servers, ohne CPU und den übrigen Rechner.`;
const moneyTip = (pr) => `Eingabe ${fmtNum(pr.in)} € und Ausgabe ${fmtNum(pr.out)} € je 1 Mio. Token`;

const fin = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);
function chatTotals(c) {
  let prompt = 0, comp = 0, tokSum = 0, secSum = 0, last = null, duration = 0, runs = 0;
  const cs0 = ctxStart(c);
  for (let mi = 0; mi < c.messages.length; mi++) {
    const m = c.messages[mi];
    if (m.role === 'assistant' && m.stats) {
      const ct = fin(m.stats.completionTokens);
      prompt += fin(m.stats.promptTokens);
      comp += ct;
      duration += fin(m.stats.duration);
      runs++;
      // Durchschnitt nach Tokens gewichtet (Σ Tokens / Σ Zeit): kurze Antworten verfälschen ihn nicht, ein ungültiger Wert macht ihn nicht unsichtbar
      const tps = fin(m.stats.tps);
      if (tps > 0 && ct > 0) { tokSum += ct; secSum += ct / tps; }
      if (mi >= cs0) last = m.stats; // Füllstand zählt nur den Kontext, den die KI noch sieht
    }
  }
  return { prompt, comp, total: prompt + comp, avgTps: secSum > 0 ? tokSum / secSum : null, tokSum, secSum, last, duration, runs };
}

/* ═════════════ Rendering: Gesamt ═════════════ */
function renderAll() {
  renderChatList();
  if (typeof owuiRefresh === 'function') owuiRefresh();
  if (typeof autoRefresh === 'function') autoRefresh();
  renderModelSelect();
  tdApplyLayout();
  renderMessages();
  renderAttachStrip();
  renderQueuedStrip();
  updateBusyNotice();
  updateEstimate();
  renderStatus();
  updateCtxMeter();
  updateSendBtn();
  updatePermBtn();
  try { updateThinkBtn(); updateToolsBtn(); } catch {}   // Denken und Dateizugriff gelten pro Chat
}

/* Nach dem Sprachwechsel neu aufbauen, was aus Vorlagen entsteht. */
function refreshLanguageUi() {
  try { renderChatList(); } catch {}
  try { renderStatus(); } catch {}
  try { updateCtxMeter(); } catch {}
  try { updateToolsBtn(); } catch {}
  try { updateThinkBtn(); } catch {}
  try { updatePermBtn(); } catch {}
}

function renderStatus() {
  const conn = activeConn();
  if (S.modelsErr) setConnStatus('err', `${conn.name}: nicht erreichbar`);
  else setConnStatus('ok', `${conn.name} · ${S.models.length} Modell${S.models.length === 1 ? '' : 'e'}${S.srvState ? ' · ' + S.srvState : ''}`);
  const trBusy = typeof TR !== 'undefined' && TR.busy.size ? ' · Gedankengang wird im Hintergrund übersetzt (belegt den Server)' : '';
  $('#st-left').textContent = (S.modelsErr ? S.modelsErr.split('\n')[0] : currentModel() ? 'Modell: ' + currentModel() : 'Kein Modell gewählt') + trBusy;
  const t = S.chat ? chatTotals(S.chat) : { total: 0, prompt: 0, comp: 0, avgTps: null, tokSum: 0, secSum: 0, duration: 0, runs: 0 };
  const lv = (viewRun() || {}).live || null; // laufende Anfrage: Werte in Echtzeit dazurechnen
  let tokSum = t.tokSum;
  let secSum = t.secSum;
  let dur = t.duration;
  let liveTps = null;
  if (lv) {
    t.prompt += lv.prompt;
    t.comp += lv.comp;
    t.total += lv.prompt + lv.comp;
    const r = lv.run;
    if (r) {
      const now = performance.now();
      const sec = r.tFirst ? (now - r.tFirst) / 1000 : 0;
      if (sec > 0.4 && r.n > 0) {
        tokSum += r.n;
        secSum += sec;
        liveTps = r.n / sec;
      }
      dur += (now - r.t0) / 1000;
    }
  }
  const avg = secSum > 0 ? tokSum / secSum : null;
  const tl = lv ? '<span class="live-dot" title="Läuft – Werte aktualisieren sich live"></span>' : '';
  const tilde = lv ? '~' : '';
  // Alle Werte stehen immer da (in einem neuen Chat zunächst 0 bzw. –) und laufen während einer Antwort live mit
  $('#st-right').innerHTML = `${tl}Chat: <b>${tilde}${fmt.tok(t.total)}</b> Tokens (↑ ${fmt.tok(t.prompt)} · ↓ ${fmt.tok(t.comp)})` +
    ` · Ø <b>${avg ? tilde + fmt.tps(avg) : '–'}</b> Tokens/s` + (lv && liveTps ? ` (jetzt <b>~${fmt.tps(liveTps)}</b>)` : '') +
    ` · Dauer: <b>${fmt.dur(dur)}</b>`;
  let tip = `Exakt: ${fmt.num(t.total)} Tokens gesamt, ${fmt.num(t.prompt)} Prompt, ${fmt.num(t.comp)} Antwort`;
  tip += `\nØ Tokens/s: Antwort-Tokens geteilt durch Generierungszeit über alle Anfragen dieses Chats${lv ? ', die laufende Anfrage ist live eingerechnet (1 Chunk ≈ 1 Token)' : ''}`;
  tip += `\nDauer: Summe der Verarbeitungszeit aller ${t.runs}${lv ? ' + 1 laufenden' : ''} Anfragen dieses Chats (inklusive Werkzeug-Schritte, ohne Wartezeit auf Freigaben und ohne deine Schreibzeit): ${fmt.dur(dur)}`;
  if (S.settings.pricing.enabled && S.chat) {
    if (powerPrice() > 0) {
      const e = chatEnergy(S.chat);
      const lw = lv && lv.en ? lv.en.ws / 3600 : 0; // laufende Anfrage live einrechnen
      const has = e.any || (lv && lv.en && lv.en.n > 0);
      $('#st-right').innerHTML += ` · Strom ${lv ? '~' : '≈'} <b>${has ? fmt.money(energyCost(e.wh + lw), 'EUR') : '–'}</b>`;
      tip += has ? `\nStromkosten: ${energyTip(e.wh + lw)}` : '\nStromkosten: noch keine GPU-Leistungswerte gemessen (der Server-Monitor muss erreichbar sein und gpu_power liefern; gemessen wird nur auf dem Server, den der Monitor überwacht).';
    }
    const c = chatCost(S.chat);
    let amount = c.amount;
    if (lv) amount += (lv.prompt * c.pr.in + lv.comp * c.pr.out) / 1e6; // laufende Anfrage live einrechnen
    $('#st-right').innerHTML += ` · Kosten ${c.est || lv ? '~' : '≈'} <b>${fmt.money(amount, 'EUR')}</b>`;
    tip += `\nKosten (Vergleichswert zu Listenpreisen): ${moneyTip(c.pr)}`;
  }
  $('#st-right').title = tip;
}

function updateCtxMeter() {
  const box = $('#ctx-meter');
  const max = +S.settings.params.numCtx || 0;
  const t = S.chat ? chatTotals(S.chat) : { last: null };
  const lv = (viewRun() || {}).live || null;
  const used = lv ? lv.prompt + lv.comp : t.last ? (t.last.promptTokens || 0) + (t.last.completionTokens || 0) : 0;
  box.classList.toggle('live', !!lv);
  const pct = max ? Math.min(100, (used / max) * 100) : 0;
  $('i', box).style.width = pct + '%';
  box.classList.toggle('warn', pct >= 75 && pct < 95);
  box.classList.toggle('full', pct >= 95);
  const approx = lv && !lv.real ? '~' : '';
  $('span', box).textContent = max ? `${approx}${fmt.tok(used)} / ${fmt.tok(max)}` : approx + fmt.tok(used);
  box.title = (lv
    ? `Kontextfenster live: ${approx}${fmt.num(used)} von ${max ? fmt.num(max) : '?'} Tokens (Prompt ${fmt.num(lv.prompt)}${lv.real ? ' laut Server' : ' geschätzt'} + Antwort bisher ≈ ${fmt.num(lv.comp)})`
    : `Kontextfenster: ${fmt.num(used)} von ${max ? fmt.num(max) : '?'} Tokens belegt (letzte Anfrage inkl. Antwort)`) + (S.modelInfo && S.modelInfo.ctx ? `\nServer meldet: ${fmt.num(S.modelInfo.ctx)} (${S.modelInfo.ctxKey})` : '\nServer meldet keine Kontextgröße: Wert von Hand eintragen.');
}

/* ═════════════ Rendering: Nachrichten ═════════════ */
function renderMessages() {
  subRefresh();
  const box = $('#messages-inner');
  box.innerHTML = '';
  tdReset();
  const msgs = S.chat ? S.chat.messages : [];
  if (!msgs.length) {
    box.append(emptyState());
    tdRefresh();
    return;
  }
  let lastAssistant = -1;
  msgs.forEach((m, i) => { if (m.role === 'assistant') lastAssistant = i; });
  const vr = viewRun();
  const atRun = !!vr;
  const cs = ctxStart(S.chat);

  /* Fenster berechnen. Chat-Wechsel oder neu eingehende/entfernte Nachrichten setzen das Fenster
     neu; sonst bleibt die vom Nutzer gewaehlte Ausdehnung erhalten. */
  const key = (S.chat && S.chat.id) || '';
  if (key !== vollKey) { vollKey = key; resetMsgFenster(); }
  else if (vollAb >= msgs.length) resetMsgFenster();   // Nachrichten entfernt -> Fenster neu setzen
  /* Waehrend die KI antwortet, kommen laufend Nachrichten dazu. Wanderndes Fenster: bleibt das
     volle Fenster zu gross, rutscht seine Unterkante nach. Sonst waere nach einer langen Antwort
     wieder der ganze Chat voll aufgebaut - genau der Fall, der beim Uebergeben an die KI hakte. */
  else if (msgs.length - vollAb > MSG_VOLL + MSG_SCHRITT) vollAb = msgs.length - MSG_VOLL;
  vollBis = msgs.length;
  const von = Math.max(0, vollAb - MSG_KOMPAKT);     // darunter nur noch eine Sammelzeile
  for (const i of [...aufgefaltet]) if (i < von || i >= msgs.length) aufgefaltet.delete(i);

  if (von > 0) {
    box.append(el('div', { class: 'msg-steps' },
      el('button', { class: 'hint-btn', text: `‹ ${MSG_SCHRITT} ältere anzeigen`, onclick: () => { vollAb = Math.max(0, vollAb - MSG_SCHRITT); renderMessages(); } }),
      el('span', { class: 'msg-steps-info', text: `${von} ältere Nachrichten sind ausgeblendet.` })));
  }

  tdSetOlder(msgs, von);   // Gedankengänge vor dem Anzeigebereich: im Dropdown erst auf Wunsch
  for (let i = von; i < msgs.length; i++) {
    const m = msgs[i];
    if (cs && i === cs) box.append(el('div', { class: 'ctx-divider' }, el('span', { html: icon('eraser', 14) + '<span>Kontext geleert – ab hier sieht die KI nur die Übergabe und was danach kommt</span>' })));
    if (atRun && vr.runNode && vr.runAm === m) { box.append(vr.runNode); tdSync(vr.runNode, m); } // gerade streamende Antwort: derselbe Knoten läuft weiter
    else if (i < vollAb && !aufgefaltet.has(i)) {
      const n = compactEl(m, i);                       // weiter zurueck: nur eine kompakte Zeile
      if (m.role === 'assistant') tdStub(m, i);
      if (cs && i < cs) n.classList.add('ctx-old');
      box.append(n);
    } else {
      const n = messageEl(m, i, i === lastAssistant);
      if (cs && i < cs && n.classList) n.classList.add('ctx-old');
      box.append(n);
    }
  }
  if (atRun) {
    if (typeof TL !== 'undefined') for (const c of TL.cards.values()) if (c.run === vr) box.append(c.node); // noch laufende Programme
    if (vr.pendingApproval && vr.pendingApproval.card) box.append(vr.pendingApproval.card); // offene Rückfrage / Freigabe
  }
  if (!atRun) {
    const lastMsg = msgs[msgs.length - 1];
    if (S.chat.pendingContinue) box.append(continueNotice());
    else if (lastMsg && lastMsg.role === 'tool' && lastMsg.name !== 'propose_new_session' && lastMsg.name !== 'finish_task') box.append(continueNotice('Die KI hat nach dem Werkzeug-Ergebnis nicht weitergearbeitet.'));
    const hn = hoNotice();
    if (hn) box.append(hn);
  }
  tdRefresh();
  if (S.stick) scrollBottom();
}

const brandMark = (cls = '') => `<img class="logo-dark ${cls}" src="assets/mark-dark.png" alt="Reuschler-IT"><img class="logo-light ${cls}" src="assets/mark-light.png" alt="">`;
const brandWord = (cls = '') => `<img class="logo-dark ${cls}" src="assets/wordmark-dark.png" alt="Reuschler-IT"><img class="logo-light ${cls}" src="assets/wordmark-light.png" alt="">`;

function emptyState() {
  const conn = activeConn();
  const wrap = el('div', { class: 'empty' },
    el('div', { html: brandMark('brand-mark') + brandWord('brand-word') }),
    el('h1', { text: 'Womit kann ich helfen?' })
  );
  if (S.modelsErr) {
    wrap.append(
      el('p', { text: `Keine Verbindung zu „${conn.name}“.\n${S.modelsErr.split('\n')[0]}`, style: { whiteSpace: 'pre-wrap' } }),
      el('div', { class: 'hints' }, el('button', { class: 'hint-btn', text: 'Verbindung einrichten', onclick: () => openSettings('conn') }), el('button', { class: 'hint-btn', text: 'Erneut versuchen', onclick: refreshModels }))
    );
  } else {
    wrap.append(
      el('p', { text: 'Schreib eine Nachricht, ziehe Dateien oder Ordner ins Fenster oder gib der KI Zugriff auf deinen Workspace.' }),
      el('div', { class: 'hints' },
        el('button', { class: 'hint-btn', text: 'Ordner anhängen', onclick: () => attachFromDialog('folder') }),
        el('button', { class: 'hint-btn', text: 'Workspace wählen', onclick: () => openSettings('ws') }),
        el('button', { class: 'hint-btn', text: 'Parameter', onclick: () => openSettings('model') })
      )
    );
  }
  return wrap;
}

function actionBtn(ic, title, fn, label) {
  return el('button', { class: 'mini-btn', title, html: icon(ic, 14) + (label ? `<span>${label}</span>` : ''), onclick: fn });
}

function fileChip(f, onRemove, onEdit) {
  if (f.pasted) return pasteCard(f, onRemove, onEdit);
  const tokens = f.kind === 'text' ? estimateTokens(f.text) : 0;
  return el('div', { class: 'chip', title: (f.path || f.name) + (f.converted ? `\n${f.converted}: als Text ausgelesen` : ''), onclick: () => previewFile(f) },
    el('span', { html: icon(f.kind === 'image' ? 'image' : 'file', 14) }),
    el('span', { class: 'n', text: f.name }),
    el('span', { class: 's', text: f.kind === 'text' ? '~' + fmt.tok(tokens) + ' T' : fmt.size(f.size || 0) }),
    onRemove ? el('button', { class: 'x', title: 'Entfernen', html: icon('x', 13), onclick: (e) => { e.stopPropagation(); onRemove(); } }) : null
  );
}

function previewFile(f) {
  let body;
  if (f.kind === 'image') body = el('img', { class: 'preview', src: f.dataUrl });
  else {
    const t = f.text || '';
    body = el('pre', { class: 'preview', text: t.length > 200000 ? t.slice(0, 200000) + '\n\n[… gekürzt]' : t });
  }
  openModal({ title: f.pasted ? 'Eingefügter Text' : f.name, body, wide: true });
}

/* ───── Fensterweise Darstellung alter Nachrichten ─────
   Ein grosser Chat kostet sonst alles: gemessen 2966 ms und 110.243 DOM-Knoten fuer 3402
   Nachrichten (tools-android\perf-messages.js, 14.11.). Der Grund ist renderMessages(): es wirft
   die ganze Liste weg (#messages-inner.innerHTML = '') und baut jede Nachricht einzeln wieder auf.
   Deshalb werden weiter zurueck liegende Nachrichten nur als kompakte Zeile aufgebaut - der Inhalt
   bleibt unveraendert gespeichert, es wird lediglich nichts angezeigt, bis der Nutzer ausklappt.
   Voll aufgebaut wird ein Fenster um das Ende der Unterhaltung; neu eingehende Nachrichten sind
   immer voll. Der Zustand haengt an der Chat-ID und betrifft ausschliesslich die Anzeige. */
const MSG_VOLL = 60;          // so viele neueste Nachrichten stehen voll da
const MSG_KOMPAKT = 200;      // darunter noch so viele als kompakte Zeile, dann eine Sammelzeile
const MSG_SCHRITT = 100;      // pro "aeltere anzeigen" kommen diese dazu
let vollKey = '';             // Chat, fuer den der Zustand gilt
let vollAb = 0;               // ab diesem Index wird voll aufgebaut
let vollBis = 0;              // Laenge des Chats beim letzten Aufbau (erkennt Anhaengen/Entfernen)
const aufgefaltet = new Set();   // einzeln aufgeklappte Indizes

function resetMsgFenster() {
  const n = S.chat && S.chat.messages ? S.chat.messages.length : 0;
  vollAb = Math.max(0, n - MSG_VOLL);
  vollBis = n;
  aufgefaltet.clear();
}

/* Kurzfassung fuer die kompakte Zeile: erste Zeile des Texts bzw. Werkzeugname. */
function compactHint(m) {
  let t = String(m.content || '').replace(/\s+/g, ' ').trim();
  if (!t && m.role === 'tool') t = (m.name || '') + (m.args ? ' ' + JSON.stringify(m.args) : '');
  if (!t) t = m.role === 'assistant' ? '(Antwort)' : m.role === 'tool' ? '(Werkzeug)' : '(leer)';
  return t.length > 150 ? t.slice(0, 150) + '…' : t;
}

function compactEl(m, i) {
  const rolle = m.role === 'user' ? 'Du' : m.role === 'tool' ? (m.name || 'Werkzeug') : (m.model || 'Assistent');
  const node = el('div', { class: 'msg compact', role: 'button', tabindex: '0' },
    el('span', { class: 'compact-role', text: rolle }),
    el('span', { class: 'compact-hint', text: compactHint(m) }),
    el('span', { class: 'compact-open', text: 'ausklappen' }));
  /* Position halten: styles.css setzt overflow-anchor:none am Chat-Container, der Browser halt
     die Position also nicht selbst. Ohne diesen Ausgleich wuerde das Aufklappen den Viewport um
     die neue Hohe nach oben springen - der Nutzer faende sich woanders wieder. */
  const auf = () => {
    const sc = $('#messages');
    const vomEnde = sc ? sc.scrollHeight - sc.scrollTop : 0;
    aufgefaltet.add(i);
    renderMessages();
    if (sc && !S.stick) sc.scrollTop = Math.max(0, sc.scrollHeight - vomEnde);
  };
  node.addEventListener('click', auf);
  node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); auf(); } });
  return node;
}

function messageEl(m, i, isLast) {
  if (m.role === 'user') return userEl(m, i);
  if (m.role === 'assistant') return assistantEl(m, i, isLast);
  return toolEl(m);
}

function userEl(m, i) {
  const node = el('div', { class: 'msg user' });
  if (m.files && m.files.length) node.append(el('div', { class: 'chips' }, m.files.map((f) => fileChip(f))));
  if (m.steer) node.append(el('div', { class: 'steer-tag', text: 'Hinweis während der Arbeit' }));
  if (m.auto && !m.handoff) node.append(el('div', { class: 'steer-tag', text: 'Automatisch (autonomer Modus)' }));
  if (m.content && m.handoff) node.append(el('details', { class: 'bubble handoff-msg' }, el('summary', { text: `${m.cleared ? 'Übergabe nach „Kontext leeren“' : 'Übergabe aus der vorherigen Sitzung'} (${fmt.num(m.content.length)} Zeichen)` }), el('pre', { text: m.content })));
  else if (m.content) node.append(el('div', { class: 'bubble', text: m.content }));
  node.append(el('div', { class: 'msg-actions' }, actionBtn('copy', 'Kopieren', () => copyText(m.content || '')), actionBtn('share', 'Teilen', (e) => openMessageShare(e.currentTarget, m)), actionBtn('edit', 'Bearbeiten und neu senden', () => editMessage(i))));
  return node;
}

function assistantEl(m, i, isLast) {
  const node = el('div', { class: 'msg assistant', 'data-mid': m.id || '' });
  const r = {
    who: el('div', { class: 'who' }, el('span', { html: icon('zap', 13) }), el('b', { text: m.model || 'Assistent' })),
    think: el('div'),
    body: el('div', { class: 'md' }),
    imgs: el('div', { class: 'gen-imgs hidden' }),
    err: el('div', { class: 'err-box hidden' }),
    note: el('div', { class: 'note hidden' }),
    stats: el('div', { class: 'stats' }),
    thinkEl: null,
    thinkInner: null,
  };
  node._r = r;
  node.append(r.who, r.think, r.body, r.imgs, r.err, r.note, r.stats);
  const acts = el('div', { class: 'msg-actions' }, actionBtn('copy', 'Antwort kopieren', () => copyText(LLM.splitThink(m.content || '').answer)));
  if (typeof owuiActions === 'function') owuiActions(acts, m); // Vorlesen
  acts.append(actionBtn('share', 'Teilen', (e) => openMessageShare(e.currentTarget, m)));
  if (isLast) acts.append(actionBtn('refresh', 'Neu generieren', regenerate, 'Neu generieren'));
  if (m.request) acts.append(actionBtn('sliders', 'Zeigt, was an den Server gesendet wurde (Parameter, Anzahl Nachrichten und Werkzeuge)', () => showRequest(m), 'Anfrage'));
  node._acts = acts;
  node.append(acts);
  if (m.error && isLast) node.append(el('div', { class: 'row-gap' }, el('button', { class: 'btn sm', text: 'Erneut versuchen', onclick: retryLast })));
  renderAssistantParts(node, m, 'final');
  return node;
}

function renderAssistantParts(node, m, mode) {
  const r = node._r;
  const live = mode === 'live';
  const { think, answer } = LLM.splitThink(m.content || '');
  const thinkText = [m.thinking, think].filter(Boolean).join('\n').trim();

  if (thinkText) {
    if (!r.thinkEl) {
      r.thinkInner = el('div', { class: 'inner' });
      r.thinkEl = el('details', { class: 'think' }, el('summary', {}, el('span', { class: 'chev', html: icon('chevron', 14) }), el('span', {}, 'Gedankengang', el('span', { class: 'think-dots', 'aria-hidden': 'true' }))), r.thinkInner);
      if (live && S.settings.appearance.thinkOpen) r.thinkEl.open = true;
      r.thinkEl.addEventListener('toggle', () => followApply(r.thinkInner));
      tdMountNew(node, r, m, live);   // im Chat oder im Gedankengänge-Dropdown (thinkdock.js)
    }
    node._m = m;
    const ti = r.thinkInner;
    const tt = trApply(node, m, live);
    followAttach(ti);
    if (!live && ti._txt === undefined) { ti._follow = false; ti._top = 0; } // fertiger Gedankengang: oben beginnen
    else if (!live && ti._follow) { ti._follow = false; ti._top = ti.scrollTop; } // Lauf beendet: Stelle halten
    followSet(ti, tt);
    // aktiv = es wird noch gedacht (Antworttext hat noch nicht begonnen)
    r.thinkEl.classList.toggle('active', live && !answer);
    tdRefresh();
  }

  if (answer) renderMd(r.body, answer, !live);
  else r.body.innerHTML = '';
  r.body.classList.toggle('cursor-blink', live);
  r.body.classList.toggle('hidden', !answer && !live);

  renderGenImages(r.imgs, m.images || []);

  if (m.error) {
    r.err.classList.remove('hidden');
    r.err.textContent = m.error;
  } else r.err.classList.add('hidden');

  const cut = !live && !m.error && m.finish === 'length';
  const auto = !live && !m.error && !cut && !!m.autoContinued;
  r.note.classList.toggle('hidden', !(cut || auto));
  if (cut) r.note.textContent = 'Die Antwort wurde abgeschnitten, weil ein Längenlimit erreicht wurde. Erhöhe „Max. Antwortlänge“ oder die Kontextlänge unter Einstellungen → Modell & Parameter.';
  else if (auto) r.note.textContent = 'Die KI hat einen nächsten Schritt angekündigt, aber nichts ausgeführt. Die LLM Box hat sie automatisch zum Weitermachen aufgefordert.';

  if (!live) r.stats.innerHTML = statsHtml(m);
}

/* ───── Gesendete Anfrage ───── */
function showRequest(m) {
  const q = m.request || {};
  const txt = [
    `POST ${q.url}`,
    '',
    JSON.stringify(q.body || {}, null, 2),
    '',
    `Nachrichten: ${q.messageCount ?? '?'} · Werkzeuge: ${q.toolCount ?? 0}`,
    '',
    'Antwort des Servers (Verbrauch und Zeiten, soweit er sie liefert):',
    q.response ? JSON.stringify(q.response, null, 2) : '(nicht gespeichert, nur bei neuen Antworten)',
    '',
    'Vergleiche diese Werte mit denen der Weboberfläche des Servers. Abweichende Sampling-Werte (temperature, top_p, top_k, repeat_penalty) oder Werkzeug-Definitionen können Geschwindigkeit und Antworten verändern. Einstellungen → Verbindungen → „Sampling-Parameter“ → „Dem Server überlassen“ sendet sie nicht mehr.',
  ].join('\n');
  openModal({ title: 'Gesendete Anfrage', body: el('pre', { class: 'preview', text: txt }), wide: true });
}

/* ───── Vom Modell erzeugte Bilder ───── */
const dataBase64 = (u) => String(u || '').split(',')[1] || '';
const imgExt = (u) => (/^data:image\/(\w+)/.exec(u || '') || [])[1] === 'jpeg' ? 'jpg' : (/^data:image\/(\w+)/.exec(u || '') || [, 'png'])[1];
function renderGenImages(box, imgs) {
  box.classList.toggle('hidden', !imgs.length);
  if (box._n === imgs.length) return; // nichts Neues: vorhandene Bilder nicht neu laden
  box._n = imgs.length;
  box.replaceChildren(...imgs.map((im, i) => {
    const ext = imgExt(im.dataUrl);
    const name = `bild-${i + 1}.${ext}`;
    const isData = im.dataUrl.startsWith('data:');
    return el('figure', { class: 'gen-img' },
      el('img', { src: im.dataUrl, alt: 'Vom Modell erzeugtes Bild', title: 'Klicken zum Vergrößern', onclick: () => openModal({ title: name, body: el('img', { class: 'preview', src: im.dataUrl }), wide: true }) }),
      el('figcaption', {},
        isData ? el('button', { class: 'mini-btn', html: icon('download', 13) + '<span>Speichern</span>', title: 'Bild als Datei speichern', onclick: async () => {
          const p = await api.files.saveAs({ defaultName: name, base64: dataBase64(im.dataUrl), defaultDir: S.settings.workspace.path || undefined, filters: [{ name: 'Bild', extensions: [ext] }] });
          if (p) toast('Gespeichert: ' + p);
        } }) : null,
        isData ? el('button', { class: 'mini-btn', html: icon('paperclip', 13) + '<span>Weiterbearbeiten</span>', title: 'Als Anhang an die nächste Nachricht hängen', onclick: () => {
          addAttachments({ files: [{ name, kind: 'image', size: Math.round(dataBase64(im.dataUrl).length * 0.75), dataUrl: im.dataUrl }] });
          $('#input').focus();
        } }) : null));
  }));
}

function stat(cls, tip, value, label) {
  return `<span class="st ${cls}" title="${tip}"><b>${value}</b> ${label}</span>`;
}
function statsHtml(m) {
  const s = m.stats;
  if (!s) return m.aborted ? '<span class="st">Abgebrochen</span>' : '';
  const t = s.estimated ? '~' : '';
  const out = [
    stat('speed', 'Generierungsgeschwindigkeit' + (s.estimated ? ' (geschätzt – der Server liefert keine Token-Zahlen)' : '') + '\nGemessen in der App vom ersten Token bis zum Ende der Antwort.', t + fmt.tps(s.tps), 'Tokens/s'),
    s.serverTps ? stat('', 'Vom Server selbst gemessene Geschwindigkeit dieser Antwort (/metrics), ohne Netzwerk und Oberfläche. Das ist die Zahl, die auch die Server-Weboberfläche zeigt.', fmt.tps(s.serverTps), 'Tokens/s Server') : '',
    stat('', 'Tokens im Prompt (System, Verlauf, Anhänge)' + (s.promptTps ? `\nVerarbeitung: ${fmt.tps(s.promptTps)} Tokens/s` : ''), t + fmt.tok(s.promptTokens), 'Prompt'),
    stat('', 'Erzeugte Tokens', t + fmt.tok(s.completionTokens), 'Antwort'),
    stat('', 'Prompt + Antwort', t + fmt.tok(s.totalTokens), 'Gesamt'),
  ];
  if (S.settings.pricing.enabled && S.chat) {
    const conn = connOf(S.chat);
    if (powerPrice() > 0 && fin(s.energyWh) > 0) out.push(stat('', 'Stromkosten dieser Antwort\n' + energyTip(s.energyWh) + (s.avgPowerW ? `\nDurchschnitt ${Math.round(s.avgPowerW)} W während der Anfrage` : ''), fmt.money(energyCost(s.energyWh), 'EUR'), 'Strom'));
    out.push(stat('', 'Kosten dieser Antwort (Vergleichswert zu Listenpreisen)\n' + moneyTip(pricesFor(conn)), t + fmt.money(costOfStats(s, conn), 'EUR'), 'Kosten'));
  }
  if (s.ttft !== null && s.ttft !== undefined) out.push(stat('', 'Zeit bis zum ersten Token' + (s.loadSec > 0.05 ? `\nModell laden: ${fmt.sec(s.loadSec)}` : ''), fmt.sec(s.ttft), 'bis erstes Token'));
  out.push(stat('', 'Gesamtdauer der Anfrage', fmt.sec(s.duration), 'Dauer'));
  if (m.compacted) out.push(`<span class="st" title="Alte Werkzeug-Inhalte wurden aus dem gesendeten Verlauf entfernt (${fmt.num(m.compacted.n)} Stück). Im Chat bleibt alles sichtbar. Geschätzt ${fmt.num(m.compacted.before)} → ${fmt.num(m.compacted.after)} Tokens."><b>⤓</b> Kontext verschlankt</span>`);
  if (m.aborted) out.push('<span class="st">abgebrochen</span>');
  return out.join('');
}

function toolEl(m) {
  if (m.name === 'propose_new_session') return hoCard(m);
  const askQ = m.name === 'ask_user' ? (normalizeQuestions(m.args)[0] || {}).question : '';
  const argRaw = askQ || m.args && (m.args.path || m.args.query || m.args.label || m.args.command || m.args.package || m.args.name);
  const arg = argRaw ? ' · ' + String(argRaw).replace(/\s+/g, ' ').slice(0, 90) : '';
  const res = String(m.content || '');
  const argText = Object.entries(m.args || {}).map(([k, v]) => `${k}:\n${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n\n');
  const cut = (t, n) => (t.length > n ? t.slice(0, n) + `\n[… gekürzt, ${fmt.num(t.length)} Zeichen]` : t);
  const inner = m.name === 'ask_user' ? res : `Argumente\n${cut(argText, 6000)}\n\nErgebnis\n${cut(res, 4000)}`;
  return el('details', { class: 'tool' + (m.ok === false ? ' fail' : '') },
    el('summary', {}, el('span', { class: 'chev', html: icon('chevron', 14) }), el('span', { html: icon('wrench', 14) }), el('span', { text: `${m.name}${arg}` }), el('span', { text: m.ok === false ? 'fehlgeschlagen' : 'ok', style: { marginLeft: 'auto', fontSize: '12px' } })),
    el('div', { class: 'inner', text: inner })
  );
}

/* Markdown */
if (window.marked) window.marked.setOptions({ gfm: true, breaks: true });
const EXT = { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', html: 'html', css: 'css', json: 'json', bash: 'sh', sh: 'sh', shell: 'sh', powershell: 'ps1', ps1: 'ps1', csharp: 'cs', cs: 'cs', java: 'java', cpp: 'cpp', c: 'c', go: 'go', rust: 'rs', sql: 'sql', yaml: 'yml', yml: 'yml', markdown: 'md', md: 'md', xml: 'xml', bat: 'bat', php: 'php', ruby: 'rb', kotlin: 'kt' };

function renderMd(container, text, final) {
  let html;
  try {
    html = DOMPurify.sanitize(marked.parse(text));
  } catch {
    html = '';
    container.textContent = text;
    return;
  }
  container.innerHTML = html;
  container.querySelectorAll('pre').forEach((pre) => decorateCode(pre, final));
}

function decorateCode(pre, final) {
  const code = pre.querySelector('code');
  const lang = (/language-([\w+#-]+)/.exec((code && code.className) || '') || [])[1] || '';
  if (final && code && window.hljs) {
    try {
      window.hljs.highlightElement(code);
    } catch {}
  }
  const raw = code ? code.textContent : pre.textContent;
  const head = el('div', { class: 'ch' },
    el('span', { text: lang || 'Text' }),
    el('span', { class: 'btns' },
      el('button', { class: 'mini-btn', title: 'Kopieren', html: icon('copy', 13) + '<span>Kopieren</span>', onclick: () => copyText(raw) }),
      el('button', { class: 'mini-btn', title: 'Als Datei speichern', html: icon('download', 13) + '<span>Speichern</span>', onclick: async () => {
        const p = await api.files.saveAs({ defaultName: 'code.' + (EXT[lang.toLowerCase()] || 'txt'), content: raw, defaultDir: S.settings.workspace.path || undefined });
        if (p) toast('Gespeichert: ' + p);
      } })
    )
  );
  const wrap = el('div', { class: 'codeblock' }, head);
  pre.replaceWith(wrap);
  wrap.append(pre);
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: 0 } });
    ta.value = t;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Kopiert');
}

/* Scrollen */
function scrollBottom() {
  const m = $('#messages');
  m.scrollTop = m.scrollHeight;
}

/* ═════════════ Senden & Generieren ═════════════ */
function updateSendBtn() {
  const b = $('#btn-send');
  const hasInput = !!($('#input').value.trim() || S.attachments.length);
  const R = viewRun(); // arbeitet die KI im angezeigten Chat? (andere Chats laufen unabhängig weiter)
  const willStop = !!R && !hasInput;
  b.classList.toggle('stop', willStop);
  b.innerHTML = icon(willStop ? 'stop' : 'send', 18, 2.2);
  b.title = R ? (willStop ? 'Stoppen' : 'Nachricht an die laufende KI senden – sie wird nach dem aktuellen Schritt zugestellt') : 'Senden';
  b.disabled = false;
  document.body.classList.toggle('gen', RUNS.size > 0 && S.settings.appearance.calmDuringGen !== false); // Sparmodus: keine Animationen/Unschärfe beim Antworten
  updatePauseUI();
  if (typeof hoRefresh === 'function') hoRefresh();
}

/* ═════════════ Pause / Fortsetzen ═════════════
   - Während die KI Text erzeugt: Die Antwort wird angehalten, der Teil bleibt bis zum Fortsetzen stehen. Beim Fortsetzen
     fragt die App diesen Schritt mit demselben Verlauf neu an (der Server nutzt dafür meist seinen Prompt-Cache).
   - Während ein Programm oder Unteragent läuft: Es wird nicht zerstört. Die Pause greift, sobald dieser Schritt fertig ist.
   - Offene Rückfragen und Freigaben bleiben offen.
   - „Stopp“ beendet den Auftrag auch aus der Pause heraus. */
function pauseGate(R) {
  if (!R.paused || R.stopRequested) return Promise.resolve();
  return new Promise((resolve) => { R.pauseWaiters.push(resolve); updatePauseUI(); });
}
function releasePause(R) {
  R = R || viewRun();
  if (!R) return;
  R.paused = false;
  const w = R.pauseWaiters.splice(0);
  w.forEach((f) => f());
  updatePauseUI();
}
function togglePause() {
  const R = viewRun();
  if (!R) return;
  if (R.paused) return releasePause(R);
  R.paused = true;
  if (R.streaming && R.run) { R.pauseAborted = true; R.run.abort(); }
  updatePauseUI();
}
function updatePauseUI() {
  const b = $('#btn-pause');
  const strip = $('#pause-strip');
  if (!b || !strip) return;
  const R = viewRun();
  const show = !!R;
  b.classList.toggle('hidden', !show);
  b.classList.toggle('paused', show && R.paused);
  b.innerHTML = icon(show && R.paused ? 'play' : 'pause', 16, 2);
  b.title = show && R.paused ? 'Fortsetzen: die KI macht an derselben Stelle weiter' : 'Pausieren: die KI hält an und wartet';
  strip.innerHTML = '';
  if (!(show && R.paused)) { strip.classList.add('hidden'); return; }
  const waiting = R.pauseWaiters.length > 0;
  strip.append(
    el('span', { class: 'queued-icon', html: icon('pause', 13, 2) }),
    el('span', { class: 'queued-hint', text: waiting ? 'Pausiert. Mit „Fortsetzen“ macht die KI an derselben Stelle weiter.' : 'Pause wird wirksam, sobald der laufende Schritt (Programm oder Unteragent) fertig ist …' }),
    el('button', { class: 'btn primary sm', text: 'Fortsetzen', onclick: () => releasePause(R) })
  );
  strip.classList.remove('hidden');
}

async function send() {
  if (S.chat && S.chat._live) { if (typeof liveSendHook === 'function' && liveSendHook()) return; return toast('Live-Ansicht: Hier kann nur gelesen werden. Wechsle zu „Eigener Chat“, um zu schreiben.', 4000); }
  const R = viewRun();
  if (R) { // die KI arbeitet in diesem Chat: Text = Hinweis an die laufende KI, leeres Feld = Stopp
    const text = $('#input').value.trim();
    if (!text && !S.attachments.length) return stopGeneration(R);
    return sendToRun(R, text, S.attachments);
  }
  const ta = $('#input');
  const text = ta.value.trim();
  if (typeof owuiSendHook === 'function' && owuiSendHook(text)) return; // „/merke …“
  if (!text && !S.attachments.length) return;
  const rb = remoteBusy(S.chat);
  if (rb) return toast(`In diesem Chat arbeitet gerade die KI auf „${rb.name || 'einem anderen Rechner'}“. Bitte warten, bis sie fertig ist.`, 5000);
  if (!currentModel()) {
    toast('Bitte zuerst ein Modell wählen.');
    if (S.modelsErr) openSettings('conn');
    return;
  }
  const chat = S.chat;
  chat.messages.push({ id: uid(), role: 'user', content: text, files: S.attachments, ts: Date.now() });
  if (chat.title === 'Neuer Chat') chat.title = (text || S.attachments[0].name).split('\n')[0].slice(0, 48);
  chat.connectionId = activeConn().id;
  chat.model = currentModel();
  chat.pendingContinue = false;
  if (typeof autoOnUserSend === 'function') autoOnUserSend(chat);
  S.attachments = [];
  ta.value = '';
  autosize();
  renderAttachStrip();
  updateEstimate();
  S.stick = true;
  renderMessages();
  await Promise.race([refreshModelInfo(), new Promise((r) => setTimeout(r, 1500))]);
  await generate(chat); // ausdrücklich dieser Chat: in der Wartezeit kann der Nutzer woanders hingewechselt haben
}

/* Stopp = harter Abbruch: Alles, worauf die Schleife gerade wartet, wird sofort beendet oder übergangen
   (Modell-Stream, Programme, Dateiwerkzeuge, Unteragenten, offene Rückfragen/Freigaben, Pause). */
function stopGeneration(R) {
  R = R || viewRun();
  if (!R) return;
  if (R.chat.auto && R.chat.auto.on && !R.autoStopping) R.chat.auto.halted = true; // Stopp durch den Nutzer beendet auch den autonomen Lauf
  R.stopRequested = true;
  if (R.paused) releasePause(R); // aus der Pause heraus beenden
  if (R.pendingApproval) R.pendingApproval.resolve('deny');
  try { if (R.run) R.run.abort(); } catch {}
  if (R.execId) api.sys.abort(R.execId);
  try { api.ws.abortAll(R.chat.id); } catch {} // nur die Dateiwerkzeuge dieses Chats
  abortSubagents(R.chat);
  if (R.stopResolve) R.stopResolve(); // die Schleife wartet nicht mehr auf ein hängendes Werkzeug
}

/* Sprachschicht anwenden: Oberflaeche, Spracheingabe des Eingabefelds und
   damit auch die Rechtschreibpruefung. Laeuft beim Start und nach jeder Aenderung
   der Sprachauswahl in den Einstellungen. */
function applyLanguage(lang) {
  const l = (typeof LANGS !== 'undefined' && LANGS.some((x) => x.value === lang)) ? lang : 'de';
  setLang(l);                                   // uebersetzt Oberflaeche und Werkzeugtexte
  document.documentElement.setAttribute('lang', l);
  applySpell();                                 // Wortbuecher folgen der Sprache
  refreshLanguageUi();                          // Vorlagen (Statuszeile, Listen) neu aufbauen
}

function buildSystem(chat, kctx) {
  const lang = S.settings.uiLang || 'de';
  const persona = typeof owuiPersona === 'function' ? owuiPersona(chat) : null; // Assistent mit eigenem Systemprompt (owui.js)
  let s = persona && persona.system ? persona.system : S.settings.systemPrompt || '';
  /* Sprachregel fuer die KI: Steht noch der unveraenderte Standardprompt drin, wird er
     durch seine englische bzw. franzoesische Fassung ersetzt. Hat der Nutzer seinen
     Prompt selbst bearbeitet, bleibt er erhalten und bekommt nur die Sprachregel. */
  if (!(persona && persona.system) && isDefaultPrompt(s)) {
    s = defaultPromptFor(lang, promptCompact());   // unveraendertes Standardprompt: Fassung fuer Sprache und Profil (kurz oder ausfuehrlich)
  } else if (lang !== 'de') {
    s += (s ? '\n\n' : '') + LANG_RULE[lang];
  }
  if (S.settings.appearance.thinkInGerman) s += (s ? '\n\n' : '') + T('Denke und überlege auf Deutsch (auch im Gedankengang).');
  if (useTools(chat)) {
    const list = `list_files, search_text, read_file, edit_file, write_file${subOn() ? ', delegate_task' : ''}`;
    s += part('toolsHint', lang, wsRoot(chat), list) + (typeof projSystem === 'function' ? projSystem(chat) : '') + part('actHint', lang) + (askOn() && !(typeof autoOn === 'function' && autoOn(chat)) ? part('askHint', lang) : '') + (hoOn() ? part('handoffHint', lang) : '') + (subOn() ? part('subHint', lang) : '');
    if (execOn()) s += part('execHint', lang, /Win/i.test(navigator.platform || navigator.userAgent));
  } else if (askAlone() && !(typeof autoOn === 'function' && autoOn(chat))) s += `\n\n${part('askHint', lang).trim()}`;
  if (typeof autoSystem === 'function') s += autoSystem(chat); // autonomer Modus
  if (typeof owuiSystem === 'function') s += owuiSystem(chat, kctx); // Gedächtnis, Wissens-Auszüge, Websuche-Hinweis
  if (typeof mcpSystem === 'function') s += mcpSystem(); // Hinweis zu MCP-Werkzeugen (mcp.js)
  if (typeof skillSystem === 'function') s += skillSystem(chat); // Skill-Liste (skills.js), bewusst ganz am Ende: der vordere Teil bleibt stabil für den Prompt-Cache des Servers
  return s.trim();
}

const ASK_HINT = ' Wenn dir Angaben fehlen, die Aufgabe mehrdeutig ist oder es mehrere sinnvolle Wege gibt, stelle dem Nutzer mit ask_user eine Rückfrage mit 2 bis 5 konkreten Antwortvorschlägen, statt zu raten, und warte auf die Antwort.';


/* ═════════════ Kontext-Verwaltung ═════════════ */
/* Schätzt die Prompt-Größe (Zeichen / 3,3, bewusst vorsichtig für Code). */
function estimateWire(messages, system) {
  let n = (system || '').length + 1500 + (typeof mcpToolChars === 'function' ? mcpToolChars() : 0); // Werkzeug-Definitionen (plus MCP)
  for (const m of messages) {
    n += (m.content || '').length + 20;
    if (m.role === 'user') for (const f of m.files || []) n += f.kind === 'text' ? f.text.length + 40 : f.kind === 'image' ? 2400 : 0;
    if (m.toolCalls && m.toolCalls.length) n += JSON.stringify(m.toolCalls.map((t) => t.args || {})).length + 40 * m.toolCalls.length;
  }
  return Math.ceil(n / 3.3);
}

/* Verschlankt den Verlauf, wenn das Fenster knapp wird.
   - Arbeitet nur auf Kopien: der Chat bleibt in der Anzeige vollständig.
   - Markiert alte Inhalte dauerhaft (m.dropped), damit der gesendete Verlauf stabil bleibt
     und der Server seinen Prompt-Cache weiter nutzen kann (kein ständiges Neu-Berechnen).
   - Räumt auf einen Zielwert (55 % des Budgets) auf, nicht nur knapp unter das Limit:
     so wird erst nach vielen weiteren Schritten wieder verschlankt. */
const DROP_MIN = 300;
const bigArg = (t) => ['content', 'old_text', 'new_text'].some((k) => typeof (t.args || {})[k] === 'string' && t.args[k].length > DROP_MIN);
function applyDrops(messages) {
  return messages.map((m) => {
    if (!m.dropped) return m;
    if (m.role === 'tool' && (m.content || '').length > DROP_MIN) {
      const what = m.args && (m.args.path || m.args.query) ? ' ' + (m.args.path || m.args.query) : '';
      return { ...m, content: T(`[Ausgabe von ${m.name}${what} (${fmt.num(m.content.length)} Zeichen) wurde entfernt, um Kontext zu sparen. Lies die Stelle bei Bedarf gezielt erneut.]`) };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.some(bigArg)) {
      return { ...m, toolCalls: m.toolCalls.map((t) => {
        const args = { ...(t.args || {}) };
        for (const k of ['content', 'old_text', 'new_text']) if (typeof args[k] === 'string' && args[k].length > DROP_MIN) args[k] = T(`[… ${fmt.num(args[k].length)} Zeichen gekürzt]`);
        return { ...t, args };
      }) };
    }
    if (m.role === 'user' && m.files) {
      return { ...m, files: m.files.map((f) => (f.kind === 'text' && f.text.length > 2000 ? { ...f, text: f.text.slice(0, 1000) + '\n[… gekürzt, um Kontext zu sparen]' } : f)) };
    }
    return m;
  });
}

function compactMessages(messages, system) {
  const ws = S.settings.workspace;
  const ctx = effCtx();
  const info = { newly: 0, before: 0, after: 0, limit: 0, over: false };
  let out = applyDrops(messages);
  info.before = info.after = estimateWire(out, system);
  if (ws.autoCompact === false || !ctx) return { messages: out, info };
  const reserve = Math.max(+S.settings.params.maxTokens || 0, 12000);
  const limit = Math.floor((ctx * (+ws.ctxBudgetPct || 80)) / 100) - reserve;
  info.limit = limit;
  if (limit < 4000 || info.after <= limit) return { messages: out, info }; // Fenster zu klein eingetragen oder alles passt
  const target = Math.floor(limit * 0.55);
  const keep = Math.max(1, +ws.keepToolResults || 3);
  const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  const protectFrom = toolIdx.length >= keep ? toolIdx[toolIdx.length - keep] - 1 : 0; // neueste Ergebnisse samt zugehörigem Aufruf bleiben
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  for (let i = 0; i < messages.length && info.after > target; i++) {
    const m = messages[i];
    if (m.dropped || i >= protectFrom) continue;
    const droppable = (m.role === 'tool' && (m.content || '').length > DROP_MIN) || (m.role === 'assistant' && (m.toolCalls || []).some(bigArg)) || (m.role === 'user' && i !== lastUser && (m.files || []).some((f) => f.kind === 'text' && f.text.length > 2000));
    if (!droppable) continue;
    m.dropped = true;
    info.newly++;
    out = applyDrops(messages);
    info.after = estimateWire(out, system);
  }
  info.over = info.after > limit;
  return { messages: out, info };
}

const TOOL_LABEL = { ask_user: 'Rückfrage', delegate_task: 'Unteragent starten', list_files: 'Ordner auflisten', read_file: 'Datei lesen', write_file: 'Datei schreiben', edit_file: 'Datei ändern', search_text: 'Text suchen', run_command: 'Programm ausführen', install_tool: 'Tool installieren', check_tool: 'Tool suchen' };
const approvalDefault = () => S.settings.workspace.approval || 'write';

/* ═════════════ Freigaben pro Chat (live umstellbar) ═════════════
   chat.perm = { mode: null | 'all' | 'write' | 'none',   // null = Standard aus den Einstellungen
                 runAll: bool,        // alle Befehle (run_command) in diesem Chat ohne Nachfrage
                 installs: bool,      // auch Installationen ohne Nachfrage
                 keys: [string] }     // „Immer erlauben“-Einträge (Werkzeug bzw. Programm)            */
function permOf(chat) {
  const c = chat || S.chat;
  if (!c) return { mode: null, runAll: false, installs: false, keys: [] };
  if (!c.perm || typeof c.perm !== 'object') c.perm = {};
  const p = c.perm;
  if (!Array.isArray(p.keys)) p.keys = [];
  if (!['all', 'write', 'none'].includes(p.mode)) p.mode = null;
  p.runAll = !!p.runAll;
  p.installs = !!p.installs;
  return p;
}
const approvalMode = (chat) => (typeof autoOn === 'function' && autoOn(chat) ? 'none' : permOf(chat).mode || approvalDefault()); // autonomer Modus: nie nachfragen
const permHas = (key, chat) => permOf(chat).keys.includes(key);
function permAdd(key, chat) {
  const p = permOf(chat);
  if (!p.keys.includes(key)) p.keys.push(key);
  permChanged(chat);
}
function permChanged(chat) {
  saveChatSoon(chat);
  updatePermBtn();
}

const PERM_MODES = [
  { id: 'all', label: 'Alles bestätigen', hint: 'Jedes Werkzeug und jeder Befehl fragt nach' },
  { id: 'write', label: 'Nur Schreiben und Befehle bestätigen', hint: 'Lesen läuft automatisch' },
  { id: 'none', label: 'Nichts bestätigen', hint: 'Datei-Werkzeuge und Befehle laufen ohne Rückfrage' },
];
const permIsAuto = (chat) => approvalMode(chat) === 'none' || permOf(chat).runAll;

function updatePermBtn() {
  const b = $('#btn-perm');
  if (!b) return;
  const mode = approvalMode();
  const p = permOf();
  const label = p.runAll ? 'Alles erlaubt' : mode === 'none' ? 'Ohne Nachfrage' : mode === 'all' ? 'Alles fragen' : 'Nachfragen';
  b.classList.toggle('on', p.runAll || mode === 'none');
  b.classList.toggle('warn', p.runAll || mode === 'none');
  b.innerHTML = icon('shield', 15) + `<span>Freigabe: ${label}</span>`;
  b.title = 'Wann die KI in diesem Chat nachfragen muss. Hier live umstellbar.';
  b.style.display = useTools() ? '' : 'none';
}

function openPermMenu() {
  const p = permOf();
  const stdLabel = { all: 'Alles bestätigen', write: 'Nur Schreiben bestätigen', none: 'Nichts bestätigen' }[approvalDefault()];
  const items = [{ header: 'Freigabe in diesem Chat' }];
  items.push({ label: 'Standard aus Einstellungen', hint: stdLabel, active: !p.mode, onClick: () => setPermMode(null), keep: true });
  for (const m of PERM_MODES) items.push({ label: m.label, hint: m.hint, active: p.mode === m.id, onClick: () => setPermMode(m.id), keep: true });
  items.push({ header: 'Befehle und Programme' });
  items.push({
    label: 'Alle Befehle in diesem Chat erlauben',
    hint: 'Auch verkettete Befehle, PowerShell, alles. Gilt nur für diesen Chat.',
    active: p.runAll,
    onClick: () => { p.runAll = !p.runAll; permChanged(); resolvePendingIfAuto(); },
    keep: true,
  });
  items.push({
    label: 'Installationen ohne Nachfrage',
    hint: 'winget, pip, npm … werden ohne Rückfrage ausgeführt',
    active: p.installs,
    onClick: () => { p.installs = !p.installs; permChanged(); resolvePendingIfAuto(); },
    keep: true,
  });
  const keys = p.keys.map((k) => ({ k, label: permKeyLabel(k) }));
  if (keys.length) {
    items.push({ header: 'Immer erlaubt (zum Entfernen anklicken)' });
    for (const x of keys) items.push({ label: x.label, hint: 'Entfernen', onClick: () => { p.keys = p.keys.filter((y) => y !== x.k); permChanged(); }, keep: true });
    items.push({ label: 'Alle Freigaben dieses Chats zurücksetzen', onClick: () => { p.keys = []; p.runAll = false; p.installs = false; p.mode = null; permChanged(); }, keep: true });
  }
  openMenu($('#btn-perm'), items, { reopen: openPermMenu });
}
function setPermMode(m) {
  permOf().mode = m;
  permChanged();
  resolvePendingIfAuto();
}
function permKeyLabel(k) {
  if (k.startsWith('run:')) {
    const [, shell, ...rest] = k.split(':');
    return `Programm „${rest.join(':')}“ (${shell === 'powershell' ? 'PowerShell' : 'cmd'})`;
  }
  return `Werkzeug „${TOOL_LABEL[k] || k}“`;
}
// Wurde live auf „ohne Nachfrage“ umgestellt, während eine Karte offen ist: Karte sofort genehmigen.
function resolvePendingIfAuto(chat) {
  const rc = chat || S.chat;
  const R = runOf(rc);
  const pa = R && R.pendingApproval;
  if (!pa || pa.kind === 'ask') return;
  const p = permOf(rc);
  if (pa.kind === 'install' ? p.installs : pa.kind === 'run' ? permIsAuto(rc) : approvalMode(rc) === 'none') pa.resolve('allow');
}

/* Befehlsanalyse für „Programm immer erlauben“ */
const INTERPRETERS = new Set(['cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'wsl', 'wsl.exe', 'bash', 'bash.exe', 'sh', 'mshta', 'wscript', 'cscript', 'rundll32']);
// Zerlegt eine Befehlszeile in ihre Teilbefehle. Liefert null, wenn etwas Undurchsichtiges drinsteckt
// (Umleitung, Unterbefehle, Backticks, Variablen als Programm …): dann gibt es keine Programm-Freigabe.
function cmdHeads(command) {
  if (/[`<>^%\r]|\$\(|\$\{|@\(/.test(command)) return null;
  const heads = [];
  for (let seg of String(command).split(/&&|\|\||[|;&\n]/)) {
    seg = seg.trim();
    if (!seg) continue;
    if (/^[$(){}@.&]/.test(seg)) return null;
    const m = seg.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
    const head = ((m && (m[1] || m[2] || m[3])) || '').replace(/^.*[\\/]/, '').toLowerCase();
    if (!head) return null;
    heads.push(head);
  }
  return heads.length ? heads : null;
}

function continueNotice(text) {
  const ws = S.settings.workspace;
  return el('div', { class: 'notice' },
    el('span', { text: text || `Die KI hat das Limit von ${+ws.maxSteps || 25} Werkzeug-Schritten erreicht und wurde angehalten. Sie ist noch nicht fertig.` }),
    el('span', { class: 'row-gap' },
      el('button', { class: 'btn primary sm', text: 'Weitermachen', onclick: () => { if (!viewRun()) { S.chat.pendingContinue = false; renderMessages(); generate(); } } }),
      text ? null : el('button', { class: 'btn sm', text: 'Schließen', onclick: () => { S.chat.pendingContinue = false; renderMessages(); saveChatSoon(); } })
    )
  );
}

function retryLast() {
  if (viewRun() || !S.chat) return;
  const msgs = S.chat.messages;
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant' && last.error) msgs.pop();
  S.stick = true;
  renderMessages();
  generate();
}

/* ═════════════ Rückfragen mit Antwortvorschlägen (ask_user) ═════════════ */
// Modelle liefern die Fragen in leicht verschiedenen Formen: Liste, JSON-Text oder eine einzelne Frage. Alles wird vereinheitlicht.
function normalizeQuestions(args) {
  let list = args && args.questions;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
  if (!Array.isArray(list)) list = args && (args.question || args.text) ? [args] : [];
  const str = (v) => String(v && typeof v === 'object' ? (v.label || v.text || v.title || v.value || '') : v ?? '').trim().slice(0, 200);
  return list.slice(0, 4).map((q) => {
    if (typeof q === 'string') q = { question: q, options: [] };
    let opts = q.options || q.choices || q.answers || q.suggestions || [];
    if (typeof opts === 'string') opts = opts.split(/\s*\|\s*|\s*;\s*|\n/);
    return { question: str(q.question || q.text || q.title || q.q), options: (Array.isArray(opts) ? opts : []).map(str).filter(Boolean).slice(0, 6), multiple: q.multiple === true || q.multi === true || q.multiselect === true };
  }).filter((q) => q.question);
}

async function runAskUser(tc, base, R) {
  const qs = normalizeQuestions(tc.args);
  if (!qs.length) return { ...base, ok: false, content: 'ask_user braucht "questions": eine Liste mit Objekten {question, options}. Stelle die Frage im Chat oder rufe das Werkzeug korrekt auf.' };
  tlState(tc.id, 'answer');
  const ans = await requestAnswers(tc, qs, R);
  tlState(tc.id, 'running');
  if (!ans) return { ...base, ok: true, content: 'Der Nutzer hat die Rückfragen übersprungen. Triff vernünftige Annahmen, nenne sie kurz und arbeite weiter.' };
  const lines = qs.map((q, i) => `${i + 1}. ${q.question}\n   Antwort: ${ans[i] && ans[i].length ? ans[i].join('; ') : '(keine Angabe)'}`);
  return { ...base, ok: true, content: 'Antworten des Nutzers:\n' + lines.join('\n') };
}

function requestAnswers(tc, qs, R) {
  return new Promise((resolve) => {
    const state = qs.map(() => ({ sel: [], own: '' }));
    const answerOf = (i) => {
      const s = state[i];
      return qs[i].multiple ? [...s.sel, ...(s.own ? [s.own] : [])] : s.own ? [s.own] : s.sel.slice(0, 1);
    };
    const complete = () => qs.every((_, i) => answerOf(i).length);
    const done = (v) => { R.pendingApproval = null; card.remove(); resolve(v); renderChatList(); };
    const send = el('button', { class: 'btn primary', text: 'Antworten', disabled: true, onclick: () => done(qs.map((_, i) => answerOf(i))) });
    const refresh = () => { send.disabled = !complete(); };
    const blocks = qs.map((q, i) => {
      const st = state[i];
      const btns = q.options.map((o) => {
        const b = el('button', { class: 'opt', type: 'button', text: o, onclick: () => {
          const k = st.sel.indexOf(o);
          if (k >= 0) st.sel.splice(k, 1);
          else if (q.multiple) st.sel.push(o);
          else { st.sel = [o]; st.own = ''; own.value = ''; }
          btns.forEach((x) => x.classList.toggle('sel', st.sel.includes(x.textContent)));
          refresh();
          // Einzelauswahl bei genau einer Frage: sofort abschicken
          if (!q.multiple && qs.length === 1 && st.sel.length) send.click();
        } });
        return b;
      });
      const own = el('input', { class: 'q-own', type: 'text', placeholder: q.options.length ? 'Oder eigene Antwort eintippen …' : 'Antwort eintippen …' });
      own.addEventListener('input', () => {
        st.own = own.value.trim();
        if (!q.multiple && st.own) { st.sel = []; btns.forEach((x) => x.classList.remove('sel')); }
        refresh();
      });
      own.addEventListener('keydown', (e) => { if (e.key === 'Enter' && complete()) { e.preventDefault(); send.click(); } });
      return el('div', { class: 'q-block' },
        el('div', { class: 'q-text', text: (qs.length > 1 ? `${i + 1}. ` : '') + q.question + (q.multiple ? ' (Mehrfachauswahl)' : '') }),
        btns.length ? el('div', { class: 'q-opts' }, btns) : null,
        own);
    });
    const card = el('div', { class: 'approval ask', role: 'dialog', 'aria-label': 'Rückfrage der KI' },
      el('div', { class: 'ap-head', html: icon('sparkle', 16) + '<span>Die KI hat ' + (qs.length > 1 ? 'Rückfragen' : 'eine Rückfrage') + '</span>' }),
      blocks,
      el('div', { class: 'ap-actions' }, send, el('button', { class: 'btn', text: 'Überspringen', title: 'Die KI trifft dann eigene Annahmen', onclick: () => done(null) }))
    );
    // „Stopp“ und Freigabe-Umstellungen: Stopp überspringt, Umstellungen lassen die Karte stehen (kind „ask“)
    R.pendingApproval = { resolve: (d) => done(Array.isArray(d) ? d : null), kind: 'ask', card };
    showLiveCard(card, R);
    if (!document.hasFocus()) { try { new Notification('LLM Box – Rückfrage', { body: qs[0].question }); } catch {} }
  });
}

/* Karte (Freigabe/Rückfrage) anzeigen: im laufenden Chat sichtbar, sonst vorgemerkt und in der Seitenleiste markiert */
function showLiveCard(card, R) {
  liveHost(R).append(card);
  if (R && !isViewed(R)) {
    renderChatList();
    toast(`In „${R.chat.title}“ wartet die KI auf dich.`, 6000);
  } else if (S.stick) scrollBottom();
  else $('#scroll-down').classList.add('attn');
}

function requestApproval(tc, opt, R) {
  opt = opt || {};
  return new Promise((resolve) => {
    const a = tc.args || {};
    const target = opt.target || a.path || a.query || '';
    const content = String(a.content || '');
    const done = (d) => {
      R.pendingApproval = null;
      card.remove();
      resolve(d);
      renderChatList();
    };
    const allow = el('button', { class: 'btn primary', text: opt.allowLabel || 'Genehmigen', onclick: () => done('allow') });
    const card = el('div', { class: 'approval', role: 'alertdialog', 'aria-label': 'Freigabe erforderlich' },
      el('div', { class: 'ap-head', html: icon('wrench', 16) + '<span>Die KI möchte ein Werkzeug nutzen</span>' }),
      el('div', { class: 'ap-desc' }, el('b', { text: (TOOL_LABEL[tc.name] || tc.name) + ': ' }), el('code', { text: target || JSON.stringify(a) })),
      opt.note ? el('div', { class: 'ap-note', text: opt.note }) : null,
      tc.name === 'edit_file'
        ? el('details', {}, el('summary', { text: 'Änderung ansehen' }), el('pre', { class: 'ap-pre', text: '− ' + String(a.old_text || '').slice(0, 4000) + '\n+ ' + String(a.new_text || '').slice(0, 4000) }))
        : null,
      tc.name === 'write_file'
        ? el('details', {}, el('summary', { text: `Inhalt ansehen (${fmt.num(content.length)} Zeichen) – vorhandene Datei wird überschrieben` }), el('pre', { class: 'ap-pre', text: content.length > 8000 ? content.slice(0, 8000) + '\n[… gekürzt]' : content }))
        : null,
      el('div', { class: 'ap-actions' },
        allow,
        opt.noAlways ? null : el('button', { class: 'btn', text: opt.alwaysLabel || 'Immer in diesem Chat erlauben', title: opt.alwaysTitle || `„${TOOL_LABEL[tc.name] || tc.name}“ nicht mehr nachfragen`, onclick: () => done('always') }),
        opt.allCmds ? el('button', { class: 'btn', text: 'Alle Befehle in diesem Chat erlauben', title: 'Schaltet für diesen Chat auf „Alles erlaubt“. Jederzeit unter „Freigabe“ im Eingabefeld änderbar.', onclick: () => done('all') }) : null,
        el('button', { class: 'btn danger', text: 'Ablehnen', onclick: () => done('deny') })
      )
    );
    R.pendingApproval = { resolve: done, kind: opt.kind || 'tool', card };
    showLiveCard(card, R); // Nutzer liest weiter oben: nicht wegscrollen, nur auffällig markieren
    allow.focus({ preventScroll: true });
    if (!document.hasFocus()) {
      try { new Notification('LLM Box – Freigabe nötig', { body: `${TOOL_LABEL[tc.name] || tc.name}: ${target}` }); } catch {}
    }
  });
}

/* Echtzeit: fragt während einer Anfrage den Server (/slots) nach echter Prompt-Größe und Fenster (pro Lauf) */
function startLivePoll(R, conn) {
  if (R.livePoll) return;
  let busyFails = 0;
  const tick = async () => {
    if (!R.live) return;
    let r = null;
    try { r = await LLM.slotInfo(conn); } catch { r = null; }
    if (!r) { if (++busyFails >= 3) stopLivePoll(R); return; } // Server kann es nicht: bei der Schätzung bleiben
    busyFails = 0;
    if (r.nCtx && S.settings.params.autoCtx !== false && conn.type !== 'ollama' && +S.settings.params.numCtx !== r.nCtx) {
      S.settings.params.numCtx = r.nCtx;
      saveSettings();
    }
    // Arbeiten mehrere Chats gleichzeitig, lässt sich ein Server-Slot keinem Chat zuordnen: dann bleibt es bei der Schätzung
    if (RUNS.size <= 1 && R.live && r.nPrompt > 0 && (r.busy === true || R.live.comp > 0) && r.nPrompt !== R.live.stale) {
      R.live.prompt = r.nPrompt;
      R.live.real = true;
    }
    if (isViewed(R)) { updateCtxMeter(); renderStatus(); }
  };
  R.livePoll = setInterval(tick, 2000);
}
function stopLivePoll(R) {
  if (R.livePoll) clearInterval(R.livePoll);
  R.livePoll = null;
}
/* Strom-Messung: jede Sekunde die GPU-Leistung (Watt) des Servers lesen (nur mit eingetragenem Strompreis). Arbeiten
   mehrere Chats gleichzeitig, wird die gemessene Leistung gleichmäßig auf sie verteilt, damit nichts doppelt zählt. */
let powerPoll = null;
function startPowerPoll(R, conn) {
  R.powerOk = !!powerPrice() && svPowerEligible(conn);
  if (!R.powerOk || powerPoll) return;
  let busy = false, fails = 0;
  powerPoll = setInterval(async () => {
    const targets = [...RUNS].filter((r) => r.powerOk && r.live && r.live.en);
    if (!targets.length || busy) return;
    busy = true;
    try {
      const w = await svReadPower();
      if (w !== null) {
        const now = performance.now();
        const share = w / targets.length;
        for (const r of targets) if (r.live && r.live.en) enAdd(r.live.en, share, now);
      }
      fails = w === null ? fails + 1 : 0;
    } catch { fails++; }
    busy = false;
    if (fails >= 5) stopPowerPoll(); // Server liefert keine Leistungswerte: nicht weiter fragen
  }, 1000);
}
function stopPowerPoll() {
  if (powerPoll) clearInterval(powerPoll);
  powerPoll = null;
}

// Endet die Antwort ohne Werkzeugaufruf mit einer Ankündigung („Jetzt der Korrekturlauf am Gerät:“), hat das Modell den nächsten Schritt nur angekündigt
function looksUnfinished(text) {
  const s = LLM.splitThink(text || '').answer.trim();
  if (!s) return false;
  const last = s.split('\n').filter((l) => l.trim()).pop().trim();
  if (/(:|…|\.\.\.)$/.test(last)) return true; // klassische Ankündigung („Jetzt der Korrekturlauf:“)
  // Ankündigung mit Punkt am Ende („Ich baue jetzt den Test.“): Das war in der Praxis der häufigste Abbruch lokaler Modelle.
  if (s.length > 700 || /\?\s*$/.test(last)) return false; // lange Antworten und Rückfragen an den Nutzer sind keine Ankündigung
  const body = last.replace(/[*_`]/g, '').replace(/[.!\s]+$/, '');
  const sentences = body.split(/(?<=[.!?])\s+/);
  const lastSentence = (sentences[sentences.length - 1] || '').trim();
  const DONE = /\b(habe|hab|haben|bin|wurde|wurden|fertig|erledigt|abgeschlossen|have|has|had|done|finished|completed|ready|j['’]ai|ai\s+terminé|suis|terminé|fini|achevé)\b/i;
  const START = /^(ich|jetzt|nun|als\s+n[äa]chstes|zuerst|zun[äa]chst|dann|danach|lass\s+mich|i['’]ll|i\s+will|i\s+am|i['’]m|i\s+(?:now|first|then|check|build|write|read|fix|replace|add|create|search|run|start|look|test)|let\s+me|now|next|first|then|je\s|j['’]|maintenant|ensuite|d['’]abord|puis|voyons)/i;
  return START.test(lastSentence) && !DONE.test(lastSentence);
}

// Textbausteine für die automatische Aufforderung, in der Sprache der Oberfläche (sie gehen an die KI)
const NUDGE_TEXT = {
  de: 'Du hast einen nächsten Schritt angekündigt, aber keinen Werkzeugaufruf ausgeführt. Rufe jetzt in DIESER Antwort das passende Werkzeug auf. Schreibe nur dann Text ohne Werkzeugaufruf, wenn die Aufgabe vollständig erledigt ist (dann mit abschließender Zusammenfassung).',
  en: 'You announced a next step but did not make a tool call. Call the appropriate tool now, in THIS reply. Only write text without a tool call if the task is completely finished (then with a final summary).',
  fr: 'Vous avez annoncé une prochaine étape sans appeler d’outil. Appelez maintenant l’outil approprié, dans CETTE réponse. N’écrivez du texte sans appel d’outil que si la tâche est entièrement terminée (avec une synthèse finale).',
};

/* Wirksames Kontextfenster: Viele lokale Modelle (besonders stark quantisierte) werden weit unter dem Server-Fenster unzuverlässig:
   Werkzeugaufrufe fehlen, Schlüssel werden erfunden, Antworten enden nach einer Ankündigung. Deshalb gelten Komprimierung und
   Übergabe-Hinweis für min(Server-Fenster, Obergrenze). Standard 64.000 Tokens; 0 = nur das Server-Fenster. */
function effCtx() {
  const max = +S.settings.params.numCtx || 0;
  const raw = S.settings.workspace.ctxSoftCap;
  const cap = raw === undefined || raw === null || raw === '' ? 64000 : +raw;
  return cap > 0 && max ? Math.min(max, cap) : max;
}

async function generate(chatArg) {
  const chat = chatArg || S.chat;
  if (chat && chat._live) return; // Live-Ansicht ist schreibgeschützt
  if (runOf(chat)) return; // in diesem Chat arbeitet die KI schon
  // V84: Dateizugriff gewuenscht, aber noch kein Projekt: erst waehlen lassen (ohne Projekt gibt es keine Dateiwerkzeuge)
  if (typeof projNeeded === 'function' && projNeeded(chat)) {
    if (!(await projPick(chat))) toast(T('Ohne Projekt gibt es keine Dateiwerkzeuge in diesem Chat.'), 4500);
  }
  trAbortAll(); // laufende Übersetzungen nicht mit dem Agenten konkurrieren lassen
  const conn = activeConn();
  const model = currentModel();
  const maxSteps = Math.max(1, +S.settings.workspace.maxSteps || 25);
  const R = newRun(chat); // eigener Lauf-Zustand dieses Chats (andere Chats laufen unabhängig)
  RUNS.add(R);
  R.hardStop = new Promise((r) => { R.stopResolve = r; });
  const hardStop = R.hardStop;
  const STOPPED = Symbol('stopped');
  const orStop = (p) => Promise.race([p, hardStop.then(() => STOPPED)]); // wartet höchstens bis zum Stopp
  chat.pendingContinue = false;
  $$('.notice', $('#messages-inner')).forEach((n) => n.remove());
  updateSendBtn();
  saveChatNow(chat); // damit der Chat in der Seitenleiste steht und man beim Wechseln zurückfindet
  renderChatList();
  let ticker = null;
  let finished = false;
  let nudged = false;
  let nudgeNext = false;
  let nudgeText = '';
  let autoNudges = 0; // automatische Aufforderungen in Folge (nach einem Werkzeugaufruf wieder 0)
  // Hinweise des Nutzers, die während der Arbeit eintrafen: als normale Nutzer-Nachricht in den Verlauf, die KI sieht sie im nächsten Schritt
  const takeInbox = () => {
    if (!R.inbox.length) return;
    for (const q of R.inbox.splice(0)) {
      const um = { id: uid(), role: 'user', content: q.text, files: q.attachments || [], ts: Date.now(), steer: true };
      chat.messages.push(um);
      liveHost(R).append(messageEl(um, chat.messages.length - 1, false));
    }
    if (isViewed(R)) renderQueuedStrip();
    saveChatSoon(chat);
    followBottom(R);
  };
  const heartbeat = setInterval(() => saveChatNow(chat), 45000); // Lebenszeichen für andere Rechner (und Zwischenstand)

  try {
    for (let step = 0; step < maxSteps; step++) {
      await pauseGate(R); // Pause aus dem vorigen Schritt (z. B. während ein Programm lief)
      if (R.stopRequested) { finished = true; break; }
      if (typeof autoLimit === 'function' && autoOn(chat) && autoLimit(chat)) { finished = true; break; } // autonom: Grenze erreicht, Aufsicht meldet das Ende
      if (typeof autoShouldClear === 'function' && autoShouldClear(chat)) { chat.autoClearPending = true; finished = true; break; } // autonom: Kontext voll, Aufsicht leert ihn
      takeInbox();
      const am = { id: uid(), role: 'assistant', content: '', thinking: '', model, ts: Date.now(), toolCalls: [] };
      chat.messages.push(am);
      const box = liveHost(R);
      box.querySelectorAll('.empty').forEach((n) => n.remove());
      const node = assistantEl(am, chat.messages.length - 1, false);
      renderAssistantParts(node, am, 'live');
      box.append(node);
      R.runAm = am;
      R.runNode = node;
      followBottom(R);

      const live = { n: 0, t0: performance.now(), tFirst: 0 };
      const paint = () => {
        const now = performance.now();
        const el0 = live.tFirst ? (now - live.tFirst) / 1000 : 0;
        const tps = el0 > 0.4 ? live.n / el0 : null;
        node._r.stats.innerHTML =
          `<span class="st live" title="Live-Schätzung (1 Chunk ≈ 1 Token)"><b>${tps ? '~' + fmt.tps(tps) : '…'}</b> Tokens/s</span>` +
          `<span class="st live"><b>${fmt.num(live.n)}</b> Tokens</span><span class="st live"><b>${fmt.sec((now - live.t0) / 1000)}</b></span>`;
        if (R.live) { R.live.comp = live.n; if (isViewed(R)) { updateCtxMeter(); renderStatus(); } }
      };
      paint();
      ticker = setInterval(paint, 250);

      // Die Anzeige wird höchstens etwa 10-mal pro Sekunde neu aufgebaut (Markdown + Bereinigung der ganzen Antwort kosten sonst bei langen Antworten viel Rechenzeit)
      const schedule = () => {
        if (node._raf || node._to) return;
        const wait = Math.max(0, 100 - (performance.now() - (node._last || 0)));
        node._to = setTimeout(() => {
          node._to = 0;
          node._raf = requestAnimationFrame(() => {
            node._raf = 0;
            node._last = performance.now();
            renderAssistantParts(node, am, 'live');
            followBottom(R);
          });
        }, wait);
      };
      const tick = (n) => {
        live.n = n;
        if (!live.tFirst) live.tFirst = performance.now();
      };

      const nudgeNow = nudgeNext;
      const nudgeMsg = nudgeText || T('Fahre mit der Aufgabe fort. Nutze bei Bedarf weitere Werkzeuge oder fasse das Ergebnis für mich zusammen.');
      nudgeNext = false;
      nudgeText = '';
      let kctx = '';
      try { kctx = typeof owuiKnowledge === 'function' ? await owuiKnowledge(chat) : ''; } catch { kctx = ''; } // passende Abschnitte aus den Wissenssammlungen
      try { if (typeof projLoad === 'function') await projLoad(chat); } catch { /* PROJEKT.md optional */ }
      try { if (typeof mcpRefresh === 'function') await mcpRefresh(); } catch { /* MCP optional */ }
      const sysText = buildSystem(chat, kctx);
      const cs = ctxStart(chat);
      const rawMsgs = nudgeNow ? [...chat.messages.slice(cs, -1), { role: 'user', content: nudgeMsg }] : chat.messages.slice(cs, -1);
      const cmp = compactMessages(rawMsgs, sysText);
      if (cmp.info.newly) { am.compacted = { n: cmp.info.newly, before: cmp.info.before, after: cmp.info.after }; saveChatSoon(chat); }
      if (cmp.info.over && S.warnedOver !== chat.id) {
        S.warnedOver = chat.id;
        toast('Achtung: Der Kontext ist trotz Verschlankung fast voll. Leere besser den Kontext (Knopf oben rechts), die Übergabe bleibt erhalten.', 8000);
      }
      const lastStats = chat.messages.slice(cs).reverse().find((m) => m.role === 'assistant' && m.stats);
      const en = { ws: 0, w: null, t: performance.now(), n: 0 }; // Energie dieser Anfrage (Wattsekunden aus der GPU-Leistung)
      R.live = { prompt: cmp.info.after, comp: 0, real: false, stale: lastStats ? lastStats.stats.promptTokens : 0, run: live, en }; // run: Zähler der laufenden Anfrage (Start, erstes Token, Anzahl) für die Statuszeile
      updateCtxMeter();
      renderStatus();
      startLivePoll(R, conn);
      startPowerPoll(R, conn);
      R.run = LLM.streamChat({
        conn,
        model,
        system: sysText,
        messages: cmp.messages,
        params: (typeof qualityParams === 'function' ? qualityParams : (c, p) => p)(chat, typeof owuiParams === 'function' ? owuiParams(chat) : S.settings.params),
        tools: toolsFor(chat),
        thinkLevel: thinkId(chat),
        handlers: {
          onContent: (full, n) => { am.content = full; tick(n); schedule(); },
          onThinking: (t, n) => { am.thinking = t; tick(n); schedule(); },
          onImages: (imgs, n) => { am.images = imgs; tick(n); schedule(); },
        },
      });

      let res = null;
      R.streaming = true;
      try {
        const r0 = await orStop(R.run.promise);
        if (r0 === STOPPED) {
          R.run.promise.catch(() => {}); // späte Fehler des abgebrochenen Streams ignorieren
          res = { content: am.content || '', thinking: am.thinking || '', toolCalls: [], images: am.images || [], stats: null, aborted: true, finishReason: 'abort' };
        } else res = r0;
      } catch (err) {
        am.error = err.message;
        const cm = /in the context \((\d{3,})\)/i.exec(err.message) || /context (?:length|window|size)[^\d]{0,40}(\d{4,})/i.exec(err.message);
        if (cm && +cm[1] !== +S.settings.params.numCtx) {
          S.settings.params.numCtx = +cm[1];
          saveSettings();
          updateCtxMeter();
          am.error += `\n\nDie Kontextlänge in der LLM Box wurde auf ${fmt.num(+cm[1])} gesetzt (Wert des Servers). Klicke „Erneut versuchen“: Alte Werkzeug-Ausgaben werden jetzt automatisch entfernt.`;
        }
      }
      R.streaming = false;
      clearInterval(ticker);
      ticker = null;
      const tEndEn = performance.now();
      enClose(en, tEndEn);
      const steered = R.steerAbort; // Antwort wurde unterbrochen, um einen Hinweis sofort zuzustellen
      R.steerAbort = false;
      if (!res) R.live = null;
      if (node._raf) cancelAnimationFrame(node._raf);
      if (node._to) clearTimeout(node._to);
      node._raf = 0;
      node._to = 0;

      // Pause während des Schreibens: Der bisherige Text bleibt sichtbar, bis es weitergeht. Nach „Fortsetzen“ wird derselbe Schritt neu angefragt.
      if (R.pauseAborted) {
        R.pauseAborted = false;
        if (!R.stopRequested && (!res || res.aborted)) {
          if (res) { am.content = res.content; am.thinking = res.thinking; }
          am.paused = true;
          renderAssistantParts(node, am, 'live');
          R.live = null;
          updateCtxMeter();
          renderStatus();
          await pauseGate(R);
          if (R.stopRequested) { // aus der Pause heraus gestoppt: Teilantwort als abgebrochen behalten
            am.paused = false;
            am.aborted = true;
            renderAssistantParts(node, am, 'final');
            saveChatSoon(chat);
            finished = true;
            break;
          }
          chat.messages.splice(chat.messages.indexOf(am), 1);
          node.remove();
          R.runNode = null;
          R.runAm = null;
          saveChatSoon(chat);
          step--;
          continue; // derselbe Schritt noch einmal
        }
      }

      if (res) {
        am.content = res.content;
        am.thinking = res.thinking;
        am.toolCalls = steered ? [] : res.toolCalls; // unvollständige Werkzeugaufrufe einer unterbrochenen Antwort verwerfen
        am.thinkBlocks = res.thinkBlocks || null; // Claude: Denk-Blöcke samt Signatur, werden im Werkzeug-Ablauf zurückgegeben
        am.stats = res.stats;
        if (am.stats && en.n > 0 && en.ws > 0) { // gemessener Stromverbrauch dieser Anfrage
          am.stats.energyWh = en.ws / 3600;
          am.stats.avgPowerW = en.ws / Math.max(0.5, (tEndEn - live.t0) / 1000);
        }
        if (am.stats && typeof usageRecord === 'function') usageRecord(am.stats, conn);   // Gesamtverbrauch (bleibt auch nach dem Loeschen von Chats)
        if (R.run && R.run.request) am.request = R.run.request;
        // (c) Vom Server gemessene Geschwindigkeit nachladen (z. B. Strata), ohne den Ablauf aufzuhalten
        if (conn.type !== 'ollama' && res.stats && res.stats.completionTokens > 20) {
          const st = res.stats;
          LLM.serverDecodeStats(conn, st.completionTokens).then((sv) => {
            if (!sv) return;
            st.serverTps = sv.tps;
            const live = document.querySelector(`.msg.assistant[data-mid="${am.id}"]`); // der Knoten kann inzwischen neu aufgebaut worden sein
            if (live && live._r) live._r.stats.innerHTML = statsHtml(am);
            saveChatSoon(chat);
          }).catch(() => {});
        }
        if (res.images && res.images.length) am.images = res.images;
        am.finish = res.finishReason || '';
        R.live = null;
        updateCtxMeter();
        renderStatus();
        if (res.aborted) am.aborted = true;
        const sp = LLM.splitThink(am.content);
        if (sp.think) {
          am.thinking = [am.thinking, sp.think].filter(Boolean).join('\n');
          am.content = sp.answer;
        }
        const empty = !am.content && !am.toolCalls.length && !am.aborted && !(am.images && am.images.length);
        const afterTool = chat.messages.length >= 2 && chat.messages[chat.messages.length - 2].role === 'tool';
        if (empty && afterTool && !nudged && !R.stopRequested) {
          // Manche lokalen Modelle antworten nach einem Werkzeug-Ergebnis leer: einmal automatisch nachfassen
          nudged = true;
          nudgeNext = true;
          chat.messages.pop();
          node.remove();
          continue;
        }
        if (empty) am.error = am.thinking ? 'Das Modell hat nur nachgedacht, aber keine Antwort und keinen Werkzeugaufruf geliefert.' : 'Das Modell hat keine Antwort geliefert.';
      }
      renderAssistantParts(node, am, 'final');
      saveChatSoon(chat); // andere Rechner sehen jeden Schritt

      // Es liegt ein Hinweis des Nutzers vor: nicht beenden, sondern im nächsten Schritt darauf eingehen (Werkzeugaufrufe laufen vorher zu Ende)
      if (R.inbox.length && !R.stopRequested && !am.error && (steered || (!am.aborted && !am.toolCalls.length))) {
        if (steered && !am.content && !am.thinking && !(am.images && am.images.length)) { chat.messages.splice(chat.messages.indexOf(am), 1); node.remove(); }
        continue;
      }

      // Nur angekündigt, nichts ausgeführt: höchstens dreimal in Folge automatisch zum Weitermachen auffordern, statt still zu enden
      if (!am.error && !am.aborted && !R.stopRequested && !am.toolCalls.length && useTools(chat) && autoNudges < 3 && am.finish !== 'length' && looksUnfinished(am.content)) {
        autoNudges++;
        nudgeNext = true;
        nudgeText = NUDGE_TEXT[S.settings.uiLang] || NUDGE_TEXT.de;
        am.autoContinued = true;
        renderAssistantParts(node, am, 'final');
        saveChatSoon(chat);
        continue;
      }
      if (am.error || am.aborted || R.stopRequested || !am.toolCalls.length) {
        finished = true;
        break;
      }
      autoNudges = 0;

      // Unteragenten starten sofort und laufen gleichzeitig; die übrigen Werkzeuge laufen der Reihe nach
      // Für jeden Werkzeugaufruf sofort eine Live-Karte (Status + Ausgabe), damit man sieht, worauf die KI gerade wartet
      for (const tc of am.toolCalls) tlStart(tc, R);
      const stoppedTool = (tc) => ({ id: uid(), role: 'tool', name: tc.name, toolCallId: tc.id, args: tc.args, ts: Date.now(), ok: false, content: T('Vom Nutzer abgebrochen. Dieser Werkzeugaufruf wurde nicht (zu Ende) ausgeführt.') });
      const early = new Map();
      for (const tc of am.toolCalls) if (tc.name === 'delegate_task') early.set(tc.id, runTool(tc, chat));
      for (const tc of am.toolCalls) {
        let tm;
        if (R.stopRequested) tm = stoppedTool(tc); // alle noch offenen Aufrufe bekommen ein Ergebnis, damit der Verlauf gültig bleibt
        else {
          const job = early.has(tc.id) ? early.get(tc.id) : runTool(tc, chat);
          const r = await orStop(job);
          if (r === STOPPED) { job.catch(() => {}); tm = stoppedTool(tc); } else tm = r;
        }
        if (tm.name !== 'propose_new_session' && typeof tm.content === 'string' && !R.stopRequested) tm.content += hoModelHint(chat); // bei vollem Kontext: KI bitten, eine Übergabe vorzuschlagen
        chat.messages.push(tm);
        saveChatSoon(chat);
        tlFinish(tc.id, tm);
        if (!R.stopRequested) await pauseGate(R);
      }
      if (R.stopRequested || am.toolCalls.some((t) => t.name === 'propose_new_session' || (t.name === 'finish_task' && chat.auto && chat.auto.finished)) || (chat.auto && chat.auto.stopNow)) {
        finished = true;
        break;
      }
    }
    // Schritt-Limit erreicht: nicht still enden, sondern sichtbar anhalten
    if (!finished) chat.pendingContinue = true;
  } catch (e) {
    console.error(e);
    chat.messages.push({ id: uid(), role: 'assistant', content: '', thinking: '', model, ts: Date.now(), toolCalls: [], error: 'Unerwarteter Fehler: ' + e.message });
  } finally {
    if (ticker) clearInterval(ticker);
    clearInterval(heartbeat);
    tlClear(R);
    R.live = null;
    stopLivePoll(R);
    if (!RUNS.size) stopPowerPoll();
    RUNS.delete(R);
    const left = R.inbox.splice(0); // nicht mehr zugestellte Hinweise: kommen ins Eingabefeld zurück
    if (left.length && !DELETED.has(chat)) UNSENT.set(chat, left);
    R.run = null;
    R.hardStop = null;
    R.stopResolve = null;
    R.execId = null;
    R.streaming = false;
    R.paused = false;
    R.pauseAborted = false;
    R.pauseWaiters.splice(0).forEach((f) => f());
    R.pendingApproval = null;
    const wasViewing = S.chat === chat;
    R.runNode = null;
    R.runAm = null;
    R.ghost.innerHTML = '';
    updateSendBtn();
    if (typeof autoAfterRun === 'function') setTimeout(() => autoAfterRun(chat), 60); // autonomer Modus: entscheidet, wie es weitergeht
    if (DELETED.has(chat)) { /* Chat wurde gelöscht: nichts mehr anzeigen oder speichern */ }
    else if (wasViewing) { renderMessages(); restoreUnsent(chat); }
    else {
      S.unread.add(chat.id);
      toast(`Antwort in „${chat.title}“ ist fertig.`, 5000);
    }
    renderChatList();
    renderStatus();
    updateCtxMeter();
    saveChatNow(chat);
    renderQueuedStrip();
    if (!DELETED.has(chat)) trAuto(chat); // Gedankengänge im Hintergrund ins Deutsche übersetzen
  }
}

async function runTool(tc, chat) {
  const rc = chat || S.chat;
  const R = runOf(rc) || newRun(rc); // Lauf dieses Chats (Freigaben, Programm-ID)
  const ws = S.settings.workspace;
  const base = { id: uid(), role: 'tool', name: tc.name, toolCallId: tc.id, args: tc.args, ts: Date.now() };
  tlState(tc.id, 'running');
  if (tc.name === 'ask_user') return runAskUser(tc, base, R);
  if (tc.name === 'use_skill' && typeof skillRun === 'function') return skillRun(tc, base); // Skill laden (skills.js)
  if (String(tc.name).startsWith('mcp__') && typeof mcpRun === 'function') return mcpRun(tc, base, rc, R); // MCP-Werkzeug (mcp.js)
  if (tc.name === 'delegate_task') return runSubagent(tc, base, rc); // nur lesend: keine Freigabe nötig
  if (typeof autoRunTool === 'function') { const ar = autoRunTool(tc, base, rc); if (ar) return ar; } // autonomer Modus: Zähler, Schleifen, finish_task (auto.js)
  if (typeof OWUI_TOOLS !== 'undefined' && OWUI_TOOLS.has(tc.name)) return owuiRunTool(tc, base, rc, R); // Websuche (owui.js)
  if (EXEC_TOOLS.includes(tc.name)) return runExecTool(tc, base, rc);
  if (tc.name === 'propose_new_session') return { ...base, ok: true, content: T('Der Vorschlag wurde dem Nutzer mit einer Schaltfläche angezeigt. Beende deine Antwort jetzt (höchstens ein Satz) und rufe keine weiteren Werkzeuge auf.') };
  try {
    const mode = approvalMode(rc);
    const needs = mode === 'all' || (mode === 'write' && (tc.name === 'write_file' || tc.name === 'edit_file'));
    const key = tc.name;
    if (needs && !permHas(key, rc)) {
      tlState(tc.id, 'approval');
      const d = await requestApproval(tc, undefined, R);
      tlState(tc.id, 'running');
      if (d === 'always') permAdd(key, rc);
      if (d === 'deny') return { ...base, ok: false, content: T('Der Benutzer hat die Ausführung abgelehnt. Frage nach, wie du stattdessen vorgehen sollst.') };
    }
    const root = wsRoot(rc);
    if (!root) return { ...base, ok: false, content: T('Kein Projekt gewählt. Bitte den Nutzer, im Chat über den Knopf „Projekt“ ein Projekt zu wählen.') };
    const r = await api.ws.tool({ root, name: tc.name, args: tc.args, maxKB: +ws.readKB || 40, ignore: ignoreList(), owner: rc.id });
    if ((tc.name === 'write_file' || tc.name === 'edit_file') && r.ok) renderFilePanel();
    let content = r.result;
    if (!r.ok && typeof qualityPathHelp === 'function') content = await qualityPathHelp(tc, r, root, ws, rc.id);   // vorhandene Dateien an „nicht gefunden“ anhaengen
    return { ...base, ok: r.ok, content };
  } catch (e) {
    return { ...base, ok: false, content: 'Fehler: ' + e.message };
  }
}

/* ═════════════ Programme auf dem Client ═════════════ */
async function runExecTool(tc, base, rc) {
  rc = rc || S.chat;
  const R = runOf(rc) || newRun(rc);
  const ask = (o) => requestApproval(tc, o, R);
  const ws = S.settings.workspace;
  const a = tc.args || {};
  if (!execOn()) return { ...base, ok: false, content: T('Das Ausführen von Programmen ist in den Einstellungen ausgeschaltet. Sage dem Nutzer, dass er es unter Einstellungen → Workspace & Dateien aktivieren kann.') };
  const timeout = Math.max(5, +ws.execTimeout || 120);
  try {
    if (tc.name === 'check_tool') {
      const r = await api.sys.which({ name: a.name || '' });
      return { ...base, ok: r.ok, content: r.result };
    }
    if (tc.name === 'run_command') {
      const command = String(a.command || '').trim();
      if (!command) return { ...base, ok: false, content: 'Der Parameter command fehlt.' };
      const danger = typeof autoCheckCommand === 'function' ? autoCheckCommand(rc, command) : '';
      if (danger) return { ...base, ok: false, content: danger };
      const shellKind = a.shell === 'powershell' ? 'powershell' : 'cmd';
      const heads = cmdHeads(command);
      const prog = heads ? heads[0] : ((command.match(/^\s*(?:"([^"]+)"|(\S+))/) || [])[1] || (command.match(/^\s*(\S+)/) || [])[1] || '').toLowerCase();
      const keyOf = (h) => 'run:' + shellKind + ':' + h;
      const progAllowed = !!heads && heads.every((h) => !INTERPRETERS.has(h) && permHas(keyOf(h), rc));
      // Ohne Nachfrage: Modus „Nichts bestätigen“, „Alle Befehle erlaubt“ oder alle beteiligten Programme freigegeben.
      tlHead(tc.id, (shellKind === 'powershell' ? 'PS> ' : '> ') + command);
      if (!(permIsAuto(rc) || progAllowed)) {
        tlState(tc.id, 'approval');
        const canProg = !!heads && heads.length === 1 && !INTERPRETERS.has(heads[0]) && !!prog;
        const d = await ask({
          kind: 'run',
          target: command,
          note: `Läuft auf deinem Rechner (${shellKind === 'powershell' ? 'PowerShell' : (/Win/i.test(navigator.platform || '') ? 'cmd' : 'sh')}) mit deinen Benutzerrechten, Arbeitsordner: ${a.cwd ? wsRoot(rc) + ' / ' + a.cwd : wsRoot(rc)}. Prüfe den Befehl, bevor du genehmigst.`,
          noAlways: !canProg,
          alwaysLabel: `„${prog}“ immer erlauben (beliebige Argumente)`,
          alwaysTitle: 'Dieses Programm darf in diesem Chat mit beliebigen Argumenten laufen. Verkettete Befehle, Umleitungen (>) und Unterbefehle fragen weiterhin nach, außer alle beteiligten Programme sind freigegeben.',
          allCmds: true,
        });
        tlState(tc.id, 'running');
        if (d === 'deny') return { ...base, ok: false, content: T('Der Benutzer hat die Ausführung abgelehnt. Frage nach, wie du stattdessen vorgehen sollst.') };
        if (d === 'always' && canProg) permAdd(keyOf(heads[0]), rc);
        if (d === 'all') { permOf(rc).runAll = true; permChanged(rc); }
      }
      R.execId = uid();
      const tmo = +a.timeout > 0 ? Math.min(+a.timeout, 3600) : timeout;
      tlExec(tc.id, R.execId, tmo);
      const r = await api.sys.exec({ id: R.execId, root: wsRoot(rc), command, shell: shellKind, cwd: a.cwd || '', timeout: tmo }, (m) => tlAppend(tc.id, m.text));
      R.execId = null;
      renderFilePanel();
      return { ...base, ok: r.ok, content: r.result };
    }
    if (tc.name === 'install_tool') {
      const manager = String(a.manager || '');
      const pkg = String(a.package || '');
      const c = await api.sys.installCmd({ manager, pkg });
      if (c.error) return { ...base, ok: false, content: c.error };
      tlHead(tc.id, '> ' + c.command);
      const noInst = typeof autoInstallDenied === 'function' ? autoInstallDenied(rc) : '';
      if (noInst) return { ...base, ok: false, content: noInst };
      const instOk = permOf(rc).installs || (typeof autoInstallOk === 'function' && autoInstallOk(rc));
      if (!instOk) tlState(tc.id, 'approval');
      const d = instOk ? 'allow' : await ask({
        kind: 'install',
        target: c.command,
        note: `${a.reason ? 'Grund: ' + a.reason + '. ' : ''}Die Installation ändert deinen Rechner. Je nach Paketmanager kann Windows eine Administrator-Abfrage (UAC) zeigen. Genehmige nur, wenn du dem Paket „${pkg}“ vertraust.`,
        noAlways: true,
        allowLabel: 'Installieren',
      });
      if (d !== 'allow') return { ...base, ok: false, content: T('Der Benutzer hat die Installation abgelehnt. Installiere nichts und frage, wie du ohne dieses Tool weitermachen sollst.') };
      tlState(tc.id, 'running');
      R.execId = uid();
      tlExec(tc.id, R.execId, 900);
      const r = await api.sys.install({ id: R.execId, root: wsRoot(rc), manager, pkg, timeout: 900 }, (m) => tlAppend(tc.id, m.text));
      R.execId = null;
      return { ...base, ok: r.ok, content: r.result + (r.ok ? '\n' + T('Hinweis: Prüfe mit check_tool, ob das Programm jetzt gefunden wird. Manche Programme liegen nach der Installation nicht im PATH.') : '') };
    }
  } catch (e) {
    R.execId = null;
    return { ...base, ok: false, content: 'Fehler: ' + e.message };
  }
  return { ...base, ok: false, content: 'Unbekanntes Werkzeug: ' + tc.name };
}

function regenerate() {
  if (viewRun() || !S.chat) return;
  const msgs = S.chat.messages;
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i].role !== 'user') i--;
  if (i < 0) return;
  msgs.length = i + 1;
  S.stick = true;
  renderMessages();
  generate();
}

function editMessage(i) {
  if (viewRun()) return toast('Bitte erst die Antwort stoppen.');
  const m = S.chat.messages[i];
  $('#input').value = m.content || '';
  S.attachments = (m.files || []).slice();
  S.chat.messages.length = i;
  if (ctxStart(S.chat) > i || (S.chat.ctxStart || 0) > i) S.chat.ctxStart = 0; // Kontext-Grenze lag hinter der bearbeiteten Stelle
  renderMessages();
  renderAttachStrip();
  autosize();
  updateEstimate();
  renderStatus();
  updateCtxMeter();
  saveChatNow();
  $('#input').focus();
}

/* ═════════════ Anhänge ═════════════ */
/* ═════════════ Vorgemerkte Nachricht (während die KI noch arbeitet) ═════════════ */
// Nachricht an die laufende KI: kommt in den Posteingang des Laufs und wird nach dem aktuellen Schritt als normale
// Nutzer-Nachricht zugestellt (die KI sieht sie vor ihrem nächsten Schritt). Der Chat blockiert dabei nie.
function sendToRun(R, text, attachments) {
  R.inbox.push({ id: uid(), text, attachments: (attachments || []).slice(), ts: Date.now() });
  S.attachments = [];
  const ta = $('#input');
  ta.value = '';
  autosize();
  renderAttachStrip();
  updateEstimate();
  renderQueuedStrip();
  updateSendBtn();
}

// Hinweis zurück ins Eingabefeld holen (noch nicht zugestellt)
function cancelInboxItem(R, id) {
  const k = R.inbox.findIndex((q) => q.id === id);
  if (k < 0) return;
  const [q] = R.inbox.splice(k, 1);
  const ta = $('#input');
  ta.value = [ta.value.trim(), q.text].filter(Boolean).join('\n\n');
  S.attachments = [...S.attachments, ...(q.attachments || [])];
  autosize();
  renderAttachStrip();
  updateEstimate();
  renderQueuedStrip();
  updateSendBtn();
  ta.focus();
}

// Sofort zustellen: unterbricht die gerade laufende Antwort (der bisherige Text bleibt stehen) und die KI geht auf den Hinweis ein
function steerNow(R) {
  if (!R.inbox.length) return;
  if (R.streaming && R.run) {
    R.steerAbort = true;
    try { R.run.abort(); } catch {}
  } else toast('Die KI führt gerade ein Werkzeug aus oder wartet. Dein Hinweis kommt direkt danach.', 3500);
}

// Hinweise, die beim Ende des Laufs nicht mehr zugestellt wurden (Stopp, Fehler, Schritt-Limit): zurück ins Eingabefeld
function restoreUnsent(chat) {
  const left = UNSENT.get(chat);
  if (!left || !left.length || S.chat !== chat) return;
  UNSENT.delete(chat);
  const ta = $('#input');
  ta.value = [ta.value.trim(), ...left.map((q) => q.text)].filter(Boolean).join('\n\n');
  for (const q of left) S.attachments.push(...(q.attachments || []));
  autosize();
  renderAttachStrip();
  updateEstimate();
  updateSendBtn();
  toast('Dein Hinweis wurde nicht mehr zugestellt und steht wieder im Eingabefeld.', 5000);
}

function renderQueuedStrip() {
  const s = $('#queued-strip');
  s.innerHTML = '';
  const R = viewRun();
  const items = R ? R.inbox : [];
  s.classList.toggle('hidden', !items.length);
  for (const q of items) {
    const n = (q.attachments || []).length;
    const label = q.text || (n ? `${n} Datei(en)` : '');
    s.append(el('div', { class: 'queued-row' },
      el('span', { class: 'queued-icon', html: icon('send', 13, 2) }),
      el('span', { class: 'queued-text', text: label, title: label }),
      el('span', { class: 'queued-hint', text: 'wird nach dem aktuellen Schritt zugestellt' }),
      el('button', { class: 'queued-now', text: 'Jetzt', title: 'Unterbricht die laufende Antwort und stellt den Hinweis sofort zu', onclick: () => steerNow(R) }),
      el('button', { class: 'queued-cancel', title: 'Zurück ins Eingabefeld holen', html: icon('x', 13), onclick: () => cancelInboxItem(R, q.id) })
    ));
  }
}

function renderAttachStrip() {
  const s = $('#attach-strip');
  s.innerHTML = '';
  S.attachments.forEach((f, i) => s.append(fileChip(f, () => { S.attachments.splice(i, 1); renderAttachStrip(); updateEstimate(); if (viewRun()) updateSendBtn(); }, f.pasted ? () => editPasted(f) : null)));
}

function addAttachments(res) {
  if (!res) return;
  for (const f of res.files) {
    if (!S.attachments.some((a) => a.name === f.name && a.size === f.size)) S.attachments.push(f);
  }
  if (res.skipped && res.skipped.length) {
    const show = res.skipped.slice(0, 3).map((s) => `${s.name}: ${s.reason}`).join('\n');
    toast(`${res.skipped.length} Datei(en) übersprungen:\n${show}`, 6000);
  }
  if (res.truncated) toast('Limit erreicht – nicht alle Dateien wurden angehängt (siehe Einstellungen → Workspace & Dateien).', 6000);
  renderAttachStrip();
  updateEstimate();
  if (viewRun()) updateSendBtn();
  const tokens = attachTokens();
  const max = +S.settings.params.numCtx || 0;
  if (max && tokens > max * 0.8) toast(`Achtung: Anhänge ≈ ${fmt.num(tokens)} Tokens, Kontextlänge ist ${fmt.num(max)}. Erhöhe num_ctx oder hänge weniger an.`, 7000);
}

/* ───── Langer Text per Strg+V → Karte „Eingefügt“ ─────
   Ab einer einstellbaren Länge (Einstellungen → Darstellung → „Lange Texte als Karte einfügen“) landet der Text nicht im
   Eingabefeld, sondern als Anhang vom Typ „text“ mit dem Merkmal pasted. Für die KI ist das ein ganz normaler Textanhang
   (<file name="pasted-text-1.txt">), nur die Darstellung ist anders. Der Stift öffnet den Text zum Bearbeiten. */
function pasteCfg() {
  const p = (S.settings && S.settings.paste) || {};
  return { on: p.enabled !== false, min: Math.max(200, +p.minChars || 1500) };
}
function isLongPaste(txt) {
  const c = pasteCfg();
  return !!txt && c.on && txt.length >= c.min;
}
function addPastedText(txt) {
  let n = 1;
  while (S.attachments.some((a) => a.name === `pasted-text-${n}.txt`)) n++;
  const text = txt.replace(/\r\n/g, '\n');
  S.attachments.push({ name: `pasted-text-${n}.txt`, kind: 'text', text, size: new Blob([text]).size, pasted: true });
  renderAttachStrip();
  updateEstimate();
  if (viewRun()) updateSendBtn();
  const tokens = attachTokens();
  const max = +S.settings.params.numCtx || 0;
  if (max && tokens > max * 0.8) toast(`Achtung: Anhänge ≈ ${fmt.num(tokens)} Tokens, Kontextlänge ist ${fmt.num(max)}. Erhöhe num_ctx oder hänge weniger an.`, 7000);
}

function pasteCard(f, onRemove, onEdit) {
  const tokens = estimateTokens(f.text || '');
  const preview = (f.text || '').trim().slice(0, 240);
  return el('div', { class: 'pastecard', title: 'Eingefügter Text – Klick zeigt den ganzen Text', onclick: () => previewFile(f) },
    el('div', { class: 'pv', text: preview }),
    el('div', { class: 'pt', text: '~' + fmt.tok(tokens) + ' T' }),
    el('div', { class: 'pf' },
      el('span', { class: 'badge', text: 'Eingefügt' }),
      onEdit ? el('button', { class: 'pe', title: 'Bearbeiten', html: icon('edit', 14), onclick: (e) => { e.stopPropagation(); onEdit(); } }) : null
    ),
    onRemove ? el('button', { class: 'x', title: 'Entfernen', html: icon('x', 13), onclick: (e) => { e.stopPropagation(); onRemove(); } }) : null
  );
}

function editPasted(f) {
  const ta = el('textarea', { class: 'paste-edit', spellcheck: 'false' });
  ta.value = f.text || '';
  const m = openModal({
    title: 'Eingefügten Text bearbeiten',
    body: ta,
    wide: true,
    buttons: [
      { label: 'Abbrechen', value: null },
      { label: 'Ins Eingabefeld', onClick: (close) => {
        const i = S.attachments.indexOf(f);
        if (i >= 0) S.attachments.splice(i, 1);
        const inp = $('#input');
        inp.value = inp.value + (inp.value && !inp.value.endsWith('\n') ? '\n' : '') + ta.value;
        close();
        autosize(); renderAttachStrip(); updateEstimate(); if (viewRun()) updateSendBtn();
        inp.focus();
        toast('Der Text steht jetzt im Eingabefeld.');
      } },
      { label: 'Speichern', primary: true, onClick: (close) => {
        const v = ta.value;
        const i = S.attachments.indexOf(f);
        if (!v.trim()) { if (i >= 0) S.attachments.splice(i, 1); }
        else { f.text = v; f.size = new Blob([v]).size; }
        close();
        renderAttachStrip(); updateEstimate(); if (viewRun()) updateSendBtn();
      } },
    ],
  });
  setTimeout(() => ta.focus(), 0);
  return m;
}

const attachTokens = () => S.attachments.reduce((n, f) => n + (f.kind === 'text' ? estimateTokens(f.text) : f.kind === 'image' ? 600 : 0), 0);

function updateEstimate() {
  const t = estimateTokens($('#input').value) + attachTokens();
  $('#token-estimate').textContent = t ? `≈ ${fmt.num(t)} Tokens` : '';
}

async function attachFromDialog(mode) {
  const res = await api.files.pick(mode, fileLimits());
  addAttachments(res);
}

function readImageFile(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name || 'Bild.png', kind: 'image', size: file.size, dataUrl: r.result });
    r.readAsDataURL(file);
  });
}

// Höhe des Eingabefelds über ein unsichtbares Spiegel-Feld messen. Das echte Feld wird NICHT kurz auf "auto" zusammengeklappt:
// Sonst schrumpft/wächst der Nachrichtenbereich bei jedem Zeichen, der Browser klemmt scrollTop und die Antwort springt hoch und runter.
let _asMirror = null;
function autosize() {
  const ta = $('#input');
  if (!_asMirror) {
    _asMirror = document.createElement('textarea');
    _asMirror.setAttribute('aria-hidden', 'true');
    _asMirror.tabIndex = -1;
    document.body.appendChild(_asMirror);
  }
  const cs = getComputedStyle(ta);
  const m = _asMirror;
  m.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;height:0;min-height:0;max-height:none;overflow:hidden;resize:none;' +
    ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize',
      'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'boxSizing']
      .map((k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + ':' + cs[k]).join(';') + ';width:' + ta.clientWidth + 'px;' +
    'border-left-width:0;border-right-width:0;border-style:solid';
  m.value = ta.value || ' ';
  const h = Math.min(m.scrollHeight, 240);
  m.value = '';
  if (ta.style.height === h + 'px') return;
  const msgs = $('#messages');
  const top = msgs ? msgs.scrollTop : 0;
  ta.style.height = h + 'px';
  if (msgs && Math.abs(msgs.scrollTop - top) > 1 && !S.stick) msgs.scrollTop = top; // Leseposition halten, wenn der Nutzer nicht am Ende klebt
}

/* ═════════════ Workspace-Panel ═════════════ */
const joinPath = (root, rel) => root.replace(/[\\/]+$/, '') + (rel ? '/' + rel : '');

function updateToolsBtn() {
  const b = $('#btn-tools');
  const on = useTools();
  b.classList.toggle('on', on);
  b.innerHTML = icon('wrench', 15) + `<span>Dateizugriff: ${on ? 'an' : 'aus'}</span>`;
  $('#btn-panel').classList.toggle('on', S.panelOpen);
  updatePermBtn();
  if (typeof projUpdateChip === 'function') projUpdateChip();   // V84: Knopf „Projekt“
}

function toggleTools() {
  const ws = S.settings.workspace;
  if (!ws.path) {
    toast('Wähle zuerst einen Workspace-Ordner.');
    openSettings('ws');
    return;
  }
  let on;
  if (S.chat) {
    const wish = typeof S.chat.tools === 'boolean' ? S.chat.tools : ws.toolsEnabled;   // V84: der Wunsch zaehlt, nicht der wirksame Zustand (ohne Projekt ist useTools falsch)
    on = !wish; S.chat.tools = on; saveChatSoon(S.chat);   // nur dieser Chat
    if (on && typeof projNeeded === 'function' && projNeeded(S.chat)) projPick(S.chat);   // Projekt waehlen
  }
  else { ws.toolsEnabled = !ws.toolsEnabled; on = ws.toolsEnabled; saveSettings(); }
  updateToolsBtn();
  renderFilePanel();
  toast(on ? 'KI darf den Workspace lesen und schreiben.' : 'KI-Dateizugriff ausgeschaltet.');
}

async function chooseWorkspace() {
  const p = await api.files.pickFolder('Workspace-Ordner wählen');
  if (!p) return;
  S.settings.workspace.path = p;
  saveSettings();
  renderFilePanel();
  if (typeof projUpdateChip === 'function') projUpdateChip();
}

function renderFilePanel() {
  const p = $('#filepanel');
  p.classList.toggle('collapsed', !S.panelOpen);
  $('#btn-panel').classList.toggle('on', S.panelOpen);
  if (!S.panelOpen) { if (typeof svDockSync === 'function') svDockSync(); return; }
  p.innerHTML = '';
  const ws = S.settings.workspace;
  const root = typeof wsRoot === 'function' ? wsRoot() : ws.path;         // V84: Projektordner des Chats
  const needProj = !!(ws.path && typeof projMode === 'function' && projMode() && !root);
  const name = root ? root.split(/[\\/]/).filter(Boolean).pop() : (ws.path ? ws.path.split(/[\\/]/).filter(Boolean).pop() : '');
  p.append(
    el('div', { class: 'fp-head' },
      el('div', { class: 'ttl' }, (needProj ? 'Projekte' : name) || 'Workspace', root || ws.path ? el('span', { class: 'sub', text: root || ws.path, title: root || ws.path }) : null),
      ws.path && typeof projMode === 'function' && projMode() ? el('button', { class: 'icon-btn', title: 'Projekt wählen oder anlegen', html: icon('plus', 15), onclick: () => projPick(S.chat) }) : null,
      el('button', { class: 'icon-btn', title: 'Ordner wählen', html: icon('folder', 16), onclick: chooseWorkspace }),
      ws.path ? el('button', { class: 'icon-btn', title: 'Aktualisieren', html: icon('refresh', 15), onclick: renderFilePanel }) : null
    )
  );
  const tree = el('div', { class: 'fp-tree' });
  p.append(tree);
  if (!ws.path) {
    tree.append(el('div', { class: 'fp-empty' }, 'Wähle einen Projektordner. Dateien öffnest oder hängst du per Klick an (einstellbar unter Einstellungen → Workspace & Dateien), oder du erlaubst der KI den Zugriff.', el('br'), el('button', { class: 'btn primary', text: 'Ordner wählen', onclick: chooseWorkspace })));
  } else if (needProj) {
    projPanelFill(tree);
  } else {
    loadTree(tree, '', 0);
  }
  const sw = el('label', { class: 'switch' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = useTools();
  cb.addEventListener('change', () => { cb.checked = !cb.checked; toggleTools(); });
  sw.append(cb, el('span'));
  const appr = el('select', { title: 'Wann die KI vor einem Werkzeug nachfragen muss' }, [['all', 'Alles bestätigen'], ['write', 'Nur Schreiben und Befehle bestätigen'], ['none', 'Nichts bestätigen']].map(([v, l]) => el('option', { value: v, text: l })));
  appr.value = ws.approval || 'write';
  appr.addEventListener('change', () => { ws.approval = appr.value; saveSettings(); updatePermBtn(); });
  p.append(el('div', { class: 'fp-foot' },
    el('div', { class: 'fctrl', style: { justifyContent: 'space-between' } }, el('span', { text: 'KI-Dateizugriff' }), sw),
    el('div', { class: 'fctrl', style: { marginTop: '8px' } }, appr)
  ));
  if (typeof svDockMount === 'function') svDockMount(p); // Monitor-Dock unter dem Workspace
}

/* Klick auf eine Datei im Workspace-Panel: öffnen, anhängen, nachfragen oder im Explorer zeigen (Einstellung workspace.fileClick) */
const FILE_CLICK_HINTS = { open: 'klicken zum Öffnen', attach: 'klicken zum Anhängen', ask: 'klicken für Optionen', reveal: 'klicken zum Anzeigen im Ordner' };
const fileClickMode = () => { const m = S.settings.workspace.fileClick; return FILE_CLICK_HINTS[m] ? m : 'open'; };
const fileClickHint = () => FILE_CLICK_HINTS[fileClickMode()];
const RISKY_EXT = /\.(exe|bat|cmd|com|scr|msi|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|reg|lnk|pif|cpl|dll)$/i;

async function wsAttachFile(rel) {
  const ws = S.settings.workspace;
  addAttachments(await api.files.read([joinPath(wsRoot() || ws.path, rel)], fileLimits()));
}
async function wsOpenFile(rel) {
  const full = joinPath(wsRoot() || S.settings.workspace.path, rel);
  if (typeof api.openPath !== 'function') { toast('Öffnen ist auf diesem Gerät nicht verfügbar. Die Datei wird stattdessen angehängt.'); return wsAttachFile(rel); }
  // Programme und Skripte nicht einfach per Klick starten
  if (RISKY_EXT.test(rel) && !(await confirmModal('Datei ausführen?', `„${rel}“ ist ein ausführbarer Dateityp. Das Öffnen startet sie auf diesem Rechner.`, { okLabel: 'Öffnen', danger: true }))) return;
  const err = await api.openPath(full);
  if (err) toast('Datei konnte nicht geöffnet werden: ' + err, 6000);
}
async function wsRevealFile(rel) {
  const full = joinPath(wsRoot() || S.settings.workspace.path, rel);
  if (typeof api.showItem !== 'function') return wsOpenFile(rel);
  const err = await api.showItem(full.replace(/\//g, '\\'));
  if (err) toast('Konnte nicht im Ordner angezeigt werden: ' + err, 6000);
}
function wsFileClick(rel) {
  const mode = fileClickMode();
  if (mode === 'attach') return wsAttachFile(rel);
  if (mode === 'reveal') return wsRevealFile(rel);
  if (mode === 'open') return wsOpenFile(rel);
  openModal({
    title: rel.split('/').pop(),
    body: el('div', { text: 'Was soll mit der Datei geschehen?' }),
    buttons: [
      { label: 'Abbrechen', value: null },
      { label: 'Im Ordner zeigen', onClick: (close) => { close(); wsRevealFile(rel); } },
      { label: 'Anhängen', onClick: (close) => { close(); wsAttachFile(rel); } },
      { label: 'Öffnen', primary: true, onClick: (close) => { close(); wsOpenFile(rel); } },
    ],
  });
}

async function loadTree(container, rel, depth) {
  const ws = S.settings.workspace;
  let items;
  try {
    items = await api.ws.list({ root: wsRoot() || ws.path, rel, ignore: ignoreList() });
  } catch (e) {
    container.append(el('div', { class: 'fp-empty', text: 'Ordner nicht lesbar: ' + e.message }));
    return;
  }
  if (!items.length && depth === 0) container.append(el('div', { class: 'fp-empty', text: 'Der Ordner ist leer.' }));
  for (const it of items) {
    const r = rel ? rel + '/' + it.name : it.name;
    const row = el('div', { class: 'tr', style: { paddingLeft: 6 + depth * 14 + 'px' }, title: it.isDir ? r : `${r} (${fmt.size(it.size)}) – ${fileClickHint()}` });
    row.append(el('span', { class: 'chev', html: it.isDir ? icon('chevron', 12) : '' }), el('span', { html: icon(it.isDir ? 'folder' : 'file', 14) }), el('span', { class: 'nm', text: it.name }));
    row.append(el('button', { class: 'mini-btn add', title: it.isDir ? 'Ganzen Ordner anhängen' : 'Anhängen', html: icon('plus', 13), onclick: async (e) => { e.stopPropagation(); addAttachments(await api.files.read([joinPath(wsRoot() || ws.path, r)], fileLimits())); } }));
    container.append(row);
    if (it.isDir) {
      let child = null;
      row.addEventListener('click', async () => {
        if (child) {
          child.remove();
          child = null;
          row.classList.remove('open');
          return;
        }
        row.classList.add('open');
        child = el('div');
        row.after(child);
        await loadTree(child, r, depth + 1);
      });
    } else {
      row.addEventListener('click', () => wsFileClick(r));
    }
  }
}

/* ═════════════ Export ═════════════ */
function chatToMarkdown(c) {
  const lines = [`# ${c.title}`, '', `_${new Date(c.created).toLocaleString('de-DE')} · ${c.model || ''}_`, ''];
  for (const m of c.messages) {
    if (m.role === 'user') {
      lines.push('## Du', '', ...(m.files || []).filter((f) => !f.pasted).map((f) => `- 📎 ${f.name}`), ...(m.files || []).filter((f) => f.pasted && f.text).flatMap((f) => ['```', f.text, '```', '']), m.content || '', '');
    } else if (m.role === 'assistant') {
      lines.push(`## Assistent (${m.model || ''})`, '', m.content || (m.error ? `**Fehler:** ${m.error}` : ''), '');
      if (m.stats) {
        const s = m.stats;
        lines.push(`> ${fmt.tps(s.tps)} Tokens/s · Prompt ${fmt.num(s.promptTokens)} · Antwort ${fmt.num(s.completionTokens)} · Gesamt ${fmt.num(s.totalTokens)} · Dauer ${fmt.sec(s.duration)}`, '');
      }
    } else if (m.role === 'tool') {
      lines.push(`> 🔧 ${m.name} ${JSON.stringify(m.args || {})} → ${m.ok === false ? 'fehlgeschlagen' : 'ok'}`, '');
    }
  }
  if (S.settings.pricing.enabled) {
    const t = chatTotals(c);
    lines.push('---', `Gesamt: ${fmt.num(t.total)} Tokens (Prompt ${fmt.num(t.prompt)}, Antwort ${fmt.num(t.comp)}) · Dauer ${fmt.dur(t.duration)} ${powerPrice() > 0 && chatEnergy(c).any ? ` · Strom ca. ${fmt.money(energyCost(chatEnergy(c).wh), 'EUR')} (${fmtEnergy(chatEnergy(c).wh)})` : ''} · Kosten ca. ${fmt.money(chatCost(c).amount, 'EUR')} (Vergleichswert)`);
  }
  return lines.join('\n');
}

function exportChat() {
  if (!S.chat || !S.chat.messages.length) return toast('Dieser Chat ist noch leer.');
  const safe = (S.chat.title || 'chat').replace(/[^\w\- äöüÄÖÜß]/g, '').trim().slice(0, 40) || 'chat';
  openModal({
    title: 'Chat exportieren',
    body: el('div', { text: 'In welchem Format soll der Chat gespeichert werden?' }),
    buttons: [
      { label: 'Abbrechen', value: null },
      { label: 'JSON', onClick: async (close) => { close(); const p = await api.files.saveAs({ defaultName: safe + '.json', content: JSON.stringify(S.chat, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] }); if (p) toast('Exportiert: ' + p); } },
      { label: 'Markdown', primary: true, onClick: async (close) => { close(); const p = await api.files.saveAs({ defaultName: safe + '.md', content: chatToMarkdown(S.chat), filters: [{ name: 'Markdown', extensions: ['md'] }] }); if (p) toast('Exportiert: ' + p); } },
    ],
  });
}

/* ═════════════ Events ═════════════ */
function wireEvents() {
  const ta = $('#input');
  ta.addEventListener('input', () => { autosize(); updateEstimate(); if (viewRun()) updateSendBtn(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const enterSends = S.settings.appearance.enterToSend;
    if ((enterSends && !e.shiftKey && !e.ctrlKey) || (!enterSends && e.ctrlKey)) {
      e.preventDefault();
      // Arbeitet die KI noch und steht Text/ein Anhang im Feld, geht es als Hinweis an die laufende KI (siehe sendToRun);
      // ist das Feld leer, stoppt es die laufende Arbeit wie gewohnt.
      send();
    }
  });
  ta.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) {
      // Sehr langer Text: nicht ins Eingabefeld kippen, sondern als Karte (wie die Zwischenablage bei Claude) anhängen
      const txt = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (isLongPaste(txt)) {
        e.preventDefault();
        addPastedText(txt);
      }
      return;
    }
    e.preventDefault();
    const imgs = await Promise.all(files.map(readImageFile));
    addAttachments({ files: imgs, skipped: [] });
  });

  $('#btn-send').addEventListener('click', send);
  $('#btn-pause').addEventListener('click', togglePause);
  updatePauseUI();
  $('#btn-new').addEventListener('click', newChat);
  $('#btn-settings').addEventListener('click', () => openSettings());   // ohne Ziel: zuletzt geöffnete Seite
  $('#btn-server').innerHTML = icon('cpu', 16) + '<span>Server</span>';
  $('#btn-server').addEventListener('click', () => openServer('monitor'));
  $('#btn-monitor').innerHTML = icon('activity', 16) + '<span>Monitor</span>';
  $('#btn-monitor').addEventListener('click', svToggleDock);
  $('#btn-refresh').addEventListener('click', refreshModels);
  $('#btn-export').addEventListener('click', (e) => {   // Chat-Menü: Teilen, Herunterladen, Umbenennen … (chatmenu.js)
    const b = e.currentTarget;
    if (treeMenuOpenFor(b)) return closeTreeMenu();
    if (S.chat) openChatMenu(b, S.chat.id);
  });
  $('#btn-panel').addEventListener('click', () => { S.panelOpen = !S.panelOpen; renderFilePanel(); });
  $('#btn-attach').addEventListener('click', () => attachFromDialog('files'));
  $('#btn-attach-folder').addEventListener('click', () => attachFromDialog('folder'));
  $('#btn-tools').addEventListener('click', toggleTools);
  $('#btn-perm').addEventListener('click', openPermMenu);
  $('#btn-think').addEventListener('click', openThinkMenu);
  composerTips();
  $('#chat-search').addEventListener('input', (e) => { S.search = e.target.value; renderChatList(); });

  $('#sel-conn').addEventListener('change', (e) => {
    S.settings.activeConnection = e.target.value;
    S.settings.model = '';
    if (S.chat) { S.chat.model = ''; S.chat.connectionId = e.target.value; }
    saveSettings();
    refreshModels();
  });
  $('#sel-model').addEventListener('change', async (e) => {
    if (e.target.value === '__manual') {
      const name = await promptModal('Modell eingeben', 'Modellname, z. B. gpt-4o-mini oder llama3.2:3b', '');
      if (name) {
        if (!S.models.some((m) => m.id === name)) S.models.push({ id: name });
        setModel(name);
      }
      renderModelSelect();
      renderStatus();
      return;
    }
    const picked = S.models.find((m) => m.id === e.target.value);
    if (picked && picked.installedOnly) {
      // Installiert, aber nicht geladen: auf Wunsch über die Strata-App laden (das aktuelle Modell wird dafür entladen)
      const go = await confirmModal('Modell laden', `„${picked.id}“ ist installiert, aber nicht geladen. Soll die Strata-App es jetzt laden? Ein aktuell geladenes Modell wird dafür entladen.`, { okLabel: 'Laden' });
      if (!go) { renderModelSelect(); return; }
      setModel(picked.id);
      renderStatus();
      const ok = await svHostSwitchModel(picked.id);
      await refreshModels();
      if (ok) setModel(picked.id), renderModelSelect();
      return;
    }
    setModel(e.target.value);
    renderStatus();
    refreshModelInfo();
  });

  const msgs = $('#messages');
  // Mitscrollen: nur echtes Hochscrollen durch den Nutzer hält die Ansicht an. Wachsender Inhalt (Streaming, neue Karten)
  // verändert scrollTop nicht und darf das Mitlaufen daher nie stoppen.
  // Nur eine ECHTE Nutzer-Bewegung (Mausrad, Scrollleiste ziehen, Touch, Tasten) hält die Ansicht an. Schrumpft oder wächst der Inhalt
  // (Karte klappt zu, Live-Karte wird ersetzt, Programm startet), verschiebt der Browser scrollTop von selbst: Das ist KEINE Nutzer-Bewegung.
  let lastTop = 0;
  let dragging = false;
  let userAt = 0;
  const userMove = () => { userAt = performance.now(); };
  msgs.addEventListener('pointerdown', (e) => { if (e.target === msgs) { dragging = true; userMove(); } }, { passive: true }); // Klick auf die Scrollleiste
  window.addEventListener('pointerup', () => { dragging = false; }, { passive: true });
  msgs.addEventListener('touchmove', userMove, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (['PageUp', 'Home', 'ArrowUp'].includes(e.key) && !(e.target.closest && e.target.closest('textarea,input,select,[contenteditable]'))) userMove();
  });
  msgs.addEventListener('scroll', () => {
    const top = msgs.scrollTop;
    const gap = msgs.scrollHeight - top - msgs.clientHeight;
    if (gap <= 32) {
      S.stick = true;
      $('#scroll-down').classList.remove('attn');
    } else if (top < lastTop - 1 && (dragging || performance.now() - userAt < 700)) S.stick = false; // Nutzer hat nach oben gescrollt
    lastTop = top;
    $('#scroll-down').classList.toggle('hidden', gap < 240);
  }, { passive: true });
  msgs.addEventListener('wheel', (e) => {
    userMove();
    if (e.deltaY >= 0 || msgs.scrollHeight <= msgs.clientHeight) return;
    // Mausrad in einem inneren Feld (Gedankengang, Programm-Ausgabe), das selbst scrollen kann: betrifft nur dieses Feld
    for (let n = e.target; n && n !== msgs; n = n.parentNode) if (n._fol && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return;
    S.stick = false;
  }, { passive: true });
  // Wächst der Inhalt aus irgendeinem Grund (Programm-Ausgabe, Karte öffnet sich, Bild lädt), bleibt die Ansicht unten, solange der Nutzer nicht hochgescrollt hat
  let rz = 0;
  new ResizeObserver(() => {
    if (rz) return;
    rz = requestAnimationFrame(() => { rz = 0; followBottom(); });
  }).observe($('#messages-inner'));
  $('#scroll-down').addEventListener('click', () => { S.stick = true; scrollBottom(); });
  msgs.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a) {
      e.preventDefault();
      api.openExternal(a.getAttribute('href'));
    }
  });

  // Drag & Drop (Dateien und Ordner)
  let depth = 0;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (isFiles(e)) { depth++; $('#drop-overlay').classList.remove('hidden'); } });
  window.addEventListener('dragleave', (e) => { if (isFiles(e) && --depth <= 0) { depth = 0; $('#drop-overlay').classList.add('hidden'); } });
  window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('#drop-overlay').classList.add('hidden');
    const files = [...e.dataTransfer.files];
    const paths = files.map((f) => api.files.pathOf(f)).filter(Boolean);
    if (paths.length) addAttachments(await api.files.read(paths, fileLimits()));
    else {
      const imgs = await Promise.all(files.filter((f) => f.type.startsWith('image/')).map(readImageFile));
      addAttachments({ files: imgs, skipped: [] });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); }
    else if (e.key === ',') { e.preventDefault(); openSettings(); }
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.appearance.theme === 'system') applyAppearance(); });
}

window.addEventListener('DOMContentLoaded', init);
