'use strict';

const S = {
  settings: null,
  chatList: [],
  chat: null,
  models: [],
  modelsErr: null,
  attachments: [],
  generating: false,
  run: null,
  stopRequested: false,
  panelOpen: true,
  search: '',
  stick: true,
  themeKey: '',
  pendingApproval: null,
};
const MAX_STEPS = 8;

const saveSettings = debounce(() => api.store.set('settings', S.settings), 400);
const saveChatSoon = debounce(() => saveChatNow(), 500);

const activeConn = () => S.settings.connections.find((c) => c.id === S.settings.activeConnection) || S.settings.connections[0];
const currentModel = () => (S.chat && S.chat.model) || S.settings.model || '';
const useTools = () => !!(S.settings.workspace.toolsEnabled && S.settings.workspace.path);
const EXEC_TOOLS = ['run_command', 'install_tool', 'check_tool'];
const execOn = () => S.settings.workspace.execEnabled !== false;

/* ═════════════ Start ═════════════ */
async function init() {
  const stored = await api.store.get('settings');
  S.settings = deepMerge(DEFAULTS, stored || {});
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
  if (!Array.isArray(S.settings.connections) || !S.settings.connections.length) S.settings.connections = JSON.parse(JSON.stringify(DEFAULTS.connections));
  if (!S.settings.connections.some((c) => c.id === S.settings.activeConnection)) S.settings.activeConnection = S.settings.connections[0].id;

  buildChrome();
  api.appInfo().then((i) => {
    const t = `Reuschler-IT - LLM Box v${i.version}`;
    $('#tb-title').textContent = t;
    document.title = t;
  });
  applyAppearance();
  wireEvents();
  await loadChatList();
  if (S.chatList.length) await openChat(S.chatList[0].id);
  else newChat();
  renderConnSelect();
  renderFilePanel();
  refreshModels();
}

const THINK_LEVELS = [
  { id: 'auto', label: 'Auto', hint: 'Standardverhalten des Modells' },
  { id: 'off', label: 'Aus', hint: 'Ohne Denkphase – am schnellsten' },
  { id: 'low', label: 'Schnell', hint: 'Kurzes Nachdenken' },
  { id: 'medium', label: 'Normal', hint: 'Ausgewogen' },
  { id: 'high', label: 'Hoch', hint: 'Gründlich – dauert länger' },
];
const thinkLevel = () => THINK_LEVELS.find((l) => l.id === S.settings.thinking) || THINK_LEVELS[0];

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
      S.settings.thinking = l.id;
      saveSettings();
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
  $('#btn-export').innerHTML = icon('download', 17);
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

const settingsChanged = debounce(() => {
  applyAppearance();
  renderConnSelect();
  updateToolsBtn();
  renderFilePanel();
  renderStatus();
  updateCtxMeter();
  if (S.chat && !S.generating) renderMessages();
}, 120);

/* ═════════════ Verbindung & Modelle ═════════════ */
function renderConnSelect() {
  const s = $('#sel-conn');
  s.innerHTML = '';
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
  ids.forEach((id) => s.append(el('option', { value: id, text: id })));
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

async function refreshModels() {
  const conn = activeConn();
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
    if (!cur || (conn.type === 'ollama' && !S.models.some((m) => m.id === cur))) setModel(S.models[0].id);
  }
  renderModelSelect();
  renderStatus();
  if (S.chat && !S.chat.messages.length) renderMessages();
  refreshModelInfo();
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
  const items = S.chatList.filter((c) => !q || (c.title || '').toLowerCase().includes(q));
  if (!items.length) {
    box.append(el('div', { class: 'group-title', text: q ? 'Keine Treffer' : 'Noch keine Chats' }));
    return;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groupOf = (t) => {
    const d = Math.floor((today - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
    return d <= 0 ? 'Heute' : d === 1 ? 'Gestern' : d <= 7 ? 'Letzte 7 Tage' : d <= 30 ? 'Letzte 30 Tage' : 'Älter';
  };
  let last = '';
  for (const c of items) {
    const g = groupOf(c.updated || c.created || 0);
    if (g !== last) {
      box.append(el('div', { class: 'group-title', text: g }));
      last = g;
    }
    const title = el('span', { class: 't' }, c.source === 'strata' ? el('span', { class: 'src-badge', text: 'Strata', title: 'Aus der Strata-Weboberfläche importiert' }) : null, c.title || 'Chat');
    const item = el('div', { class: 'chat-item' + (S.chat && S.chat.id === c.id ? ' active' : ''), title: `${c.title}\n${fmt.tok(c.tokens || 0)} Tokens`, onclick: () => openChat(c.id) },
      title,
      el('span', { class: 'acts' },
        el('button', { class: 'mini-btn', title: 'Umbenennen', html: icon('edit', 14), onclick: (e) => { e.stopPropagation(); renameChat(c.id); } }),
        el('button', { class: 'mini-btn', title: 'Löschen', html: icon('trash', 14), onclick: (e) => { e.stopPropagation(); deleteChat(c.id); } })
      )
    );
    item.addEventListener('dblclick', () => renameChat(c.id));
    box.append(item);
  }
}

function newChat() {
  if (S.generating) return toast('Bitte erst die Antwort stoppen.');
  if (S.chat && !S.chat.messages.length) {
    $('#input').focus();
    return;
  }
  S.chat = { id: uid(), title: 'Neuer Chat', created: Date.now(), updated: Date.now(), connectionId: activeConn().id, model: S.settings.model, messages: [] };
  S.attachments = [];
  renderAll();
  $('#input').focus();
}

async function openChat(id) {
  if (S.generating) return toast('Bitte erst die Antwort stoppen.');
  const c = await api.chats.load(id);
  if (!c) return;
  S.chat = c;
  S.attachments = [];
  if (c.connectionId && c.connectionId !== S.settings.activeConnection && S.settings.connections.some((x) => x.id === c.connectionId)) {
    S.settings.activeConnection = c.connectionId;
    saveSettings();
    renderConnSelect();
    refreshModels();
  }
  renderAll();
}

async function saveChatNow() {
  const c = S.chat;
  if (!c || !c.messages.length) return;
  c.updated = Date.now();
  const meta = { id: c.id, title: c.title, created: c.created, updated: c.updated, model: c.model, tokens: chatTotals(c).total, source: c.source, importKey: c.importKey };
  await api.chats.save(c, meta);
  const i = S.chatList.findIndex((x) => x.id === c.id);
  if (i >= 0) S.chatList[i] = meta;
  else S.chatList.push(meta);
  S.chatList.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  renderChatList();
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
  if (S.generating && S.chat && S.chat.id === id) return toast('Bitte erst die Antwort stoppen.');
  const meta = S.chatList.find((c) => c.id === id);
  if (!(await confirmModal('Chat löschen', `„${meta ? meta.title : 'Chat'}“ wird unwiderruflich gelöscht.`, { okLabel: 'Löschen', danger: true }))) return;
  await api.chats.delete(id);
  S.chatList = S.chatList.filter((c) => c.id !== id);
  if (S.chat && S.chat.id === id) {
    S.chat = null;
    newChat();
  }
  renderChatList();
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
  return ((s.promptTokens || 0) * pr.in + (s.completionTokens || 0) * pr.out) / 1e6;
}
function chatCost(chat) {
  const conn = connOf(chat);
  let amount = 0, est = false;
  for (const m of chat.messages) if (m.role === 'assistant' && m.stats) { amount += costOfStats(m.stats, conn); if (m.stats.estimated) est = true; }
  return { amount, est, pr: pricesFor(conn) };
}
const fmtNum = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
const moneyTip = (pr) => `Eingabe ${fmtNum(pr.in)} € und Ausgabe ${fmtNum(pr.out)} € je 1 Mio. Token`;

function chatTotals(c) {
  let prompt = 0, comp = 0, tpsSum = 0, tpsN = 0, last = null, duration = 0, runs = 0;
  for (const m of c.messages) {
    if (m.role === 'assistant' && m.stats) {
      prompt += m.stats.promptTokens || 0;
      comp += m.stats.completionTokens || 0;
      duration += m.stats.duration || 0;
      runs++;
      if (m.stats.tps) { tpsSum += m.stats.tps; tpsN++; }
      last = m.stats;
    }
  }
  return { prompt, comp, total: prompt + comp, avgTps: tpsN ? tpsSum / tpsN : null, last, duration, runs };
}

/* ═════════════ Rendering: Gesamt ═════════════ */
function renderAll() {
  renderChatList();
  renderModelSelect();
  renderMessages();
  renderAttachStrip();
  updateEstimate();
  renderStatus();
  updateCtxMeter();
  updateSendBtn();
  updatePermBtn();
}

function renderStatus() {
  const conn = activeConn();
  if (S.modelsErr) setConnStatus('err', `${conn.name}: nicht erreichbar`);
  else setConnStatus('ok', `${conn.name} · ${S.models.length} Modell${S.models.length === 1 ? '' : 'e'}`);
  $('#st-left').textContent = S.modelsErr ? S.modelsErr.split('\n')[0] : currentModel() ? 'Modell: ' + currentModel() : 'Kein Modell gewählt';
  const t = S.chat ? chatTotals(S.chat) : { total: 0, prompt: 0, comp: 0, avgTps: null };
  const lv = S.live; // laufende Anfrage: Werte in Echtzeit dazurechnen
  if (lv) { t.prompt += lv.prompt; t.comp += lv.comp; t.total += lv.prompt + lv.comp; }
  const tl = lv ? '<span class="live-dot" title="Läuft – Werte aktualisieren sich live"></span>' : '';
  $('#st-right').innerHTML = `${tl}Chat: <b>${lv ? '~' : ''}${fmt.tok(t.total)}</b> Tokens (↑ ${fmt.tok(t.prompt)} · ↓ ${fmt.tok(t.comp)})` + (t.avgTps ? ` · Ø <b>${fmt.tps(t.avgTps)}</b> Tokens/s` : '') + (t.runs ? ` · Dauer: <b>${fmt.dur(t.duration)}</b>` : '');
  let tip = `Exakt: ${fmt.num(t.total)} Tokens gesamt, ${fmt.num(t.prompt)} Prompt, ${fmt.num(t.comp)} Antwort`;
  if (t.runs) tip += `\nDauer: Summe der Verarbeitungszeit aller ${t.runs} Anfragen dieses Chats (inklusive Werkzeug-Schritte, ohne Wartezeit auf Freigaben und ohne deine Schreibzeit): ${fmt.dur(t.duration)}`;
  if (S.settings.pricing.enabled && S.chat) {
    const c = chatCost(S.chat);
    $('#st-right').innerHTML += ` · Kosten ${c.est ? '~' : '≈'} <b>${fmt.money(c.amount, 'EUR')}</b>`;
    tip += `\nKosten (Vergleichswert zu Listenpreisen): ${moneyTip(c.pr)}`;
  }
  $('#st-right').title = tip;
}

function updateCtxMeter() {
  const box = $('#ctx-meter');
  const max = +S.settings.params.numCtx || 0;
  const t = S.chat ? chatTotals(S.chat) : { last: null };
  const lv = S.live;
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
  const msgs = S.chat ? S.chat.messages : [];
  if (!msgs.length) {
    box.append(emptyState());
    return;
  }
  let lastAssistant = -1;
  msgs.forEach((m, i) => { if (m.role === 'assistant') lastAssistant = i; });
  msgs.forEach((m, i) => box.append(messageEl(m, i, i === lastAssistant)));
  if (!S.generating) {
    const lastMsg = msgs[msgs.length - 1];
    if (S.chat.pendingContinue) box.append(continueNotice());
    else if (lastMsg && lastMsg.role === 'tool' && lastMsg.name !== 'propose_new_session') box.append(continueNotice('Die KI hat nach dem Werkzeug-Ergebnis nicht weitergearbeitet.'));
    const hn = hoNotice();
    if (hn) box.append(hn);
  }
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

function fileChip(f, onRemove) {
  const tokens = f.kind === 'text' ? estimateTokens(f.text) : 0;
  return el('div', { class: 'chip', title: f.path || f.name, onclick: () => previewFile(f) },
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
  openModal({ title: f.name, body, wide: true });
}

function messageEl(m, i, isLast) {
  if (m.role === 'user') return userEl(m, i);
  if (m.role === 'assistant') return assistantEl(m, i, isLast);
  return toolEl(m);
}

function userEl(m, i) {
  const node = el('div', { class: 'msg user' });
  if (m.files && m.files.length) node.append(el('div', { class: 'chips' }, m.files.map((f) => fileChip(f))));
  if (m.content && m.handoff) node.append(el('details', { class: 'bubble handoff-msg' }, el('summary', { text: `Übergabe aus der vorherigen Sitzung (${fmt.num(m.content.length)} Zeichen)` }), el('pre', { text: m.content })));
  else if (m.content) node.append(el('div', { class: 'bubble', text: m.content }));
  node.append(el('div', { class: 'msg-actions' }, actionBtn('copy', 'Kopieren', () => copyText(m.content || '')), actionBtn('edit', 'Bearbeiten und neu senden', () => editMessage(i))));
  return node;
}

function assistantEl(m, i, isLast) {
  const node = el('div', { class: 'msg assistant' });
  const r = {
    who: el('div', { class: 'who' }, el('span', { html: icon('zap', 13) }), el('b', { text: m.model || 'Assistent' })),
    think: el('div'),
    body: el('div', { class: 'md' }),
    err: el('div', { class: 'err-box hidden' }),
    note: el('div', { class: 'note hidden' }),
    stats: el('div', { class: 'stats' }),
    thinkEl: null,
    thinkInner: null,
  };
  node._r = r;
  node.append(r.who, r.think, r.body, r.err, r.note, r.stats);
  const acts = el('div', { class: 'msg-actions' }, actionBtn('copy', 'Antwort kopieren', () => copyText(LLM.splitThink(m.content || '').answer)));
  if (isLast) acts.append(actionBtn('refresh', 'Neu generieren', regenerate, 'Neu generieren'));
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
      r.think.append(r.thinkEl);
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
  }

  if (answer) renderMd(r.body, answer, !live);
  else r.body.innerHTML = '';
  r.body.classList.toggle('cursor-blink', live);
  r.body.classList.toggle('hidden', !answer && !live);

  if (m.error) {
    r.err.classList.remove('hidden');
    r.err.textContent = m.error;
  } else r.err.classList.add('hidden');

  const cut = !live && !m.error && m.finish === 'length';
  r.note.classList.toggle('hidden', !cut);
  if (cut) r.note.textContent = 'Die Antwort wurde abgeschnitten, weil ein Längenlimit erreicht wurde. Erhöhe „Max. Antwortlänge“ oder die Kontextlänge unter Einstellungen → Modell & Parameter.';

  if (!live) r.stats.innerHTML = statsHtml(m);
}

function stat(cls, tip, value, label) {
  return `<span class="st ${cls}" title="${tip}"><b>${value}</b> ${label}</span>`;
}
function statsHtml(m) {
  const s = m.stats;
  if (!s) return m.aborted ? '<span class="st">Abgebrochen</span>' : '';
  const t = s.estimated ? '~' : '';
  const out = [
    stat('speed', 'Generierungsgeschwindigkeit' + (s.estimated ? ' (geschätzt – der Server liefert keine Token-Zahlen)' : ''), t + fmt.tps(s.tps), 'Tokens/s'),
    stat('', 'Tokens im Prompt (System, Verlauf, Anhänge)' + (s.promptTps ? `\nVerarbeitung: ${fmt.tps(s.promptTps)} Tokens/s` : ''), t + fmt.tok(s.promptTokens), 'Prompt'),
    stat('', 'Erzeugte Tokens', t + fmt.tok(s.completionTokens), 'Antwort'),
    stat('', 'Prompt + Antwort', t + fmt.tok(s.totalTokens), 'Gesamt'),
  ];
  if (S.settings.pricing.enabled && S.chat) {
    const conn = connOf(S.chat);
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
  const argRaw = m.args && (m.args.path || m.args.query || m.args.label || m.args.command || m.args.package || m.args.name);
  const arg = argRaw ? ' · ' + String(argRaw).replace(/\s+/g, ' ').slice(0, 90) : '';
  const res = String(m.content || '');
  const argText = Object.entries(m.args || {}).map(([k, v]) => `${k}:\n${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n\n');
  const cut = (t, n) => (t.length > n ? t.slice(0, n) + `\n[… gekürzt, ${fmt.num(t.length)} Zeichen]` : t);
  const inner = `Argumente\n${cut(argText, 6000)}\n\nErgebnis\n${cut(res, 4000)}`;
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
  b.classList.toggle('stop', S.generating);
  b.innerHTML = icon(S.generating ? 'stop' : 'send', S.generating ? 18 : 18, 2.2);
  b.title = S.generating ? 'Stoppen' : 'Senden';
  b.disabled = false;
  if (typeof hoRefresh === 'function') hoRefresh();
}

async function send() {
  if (S.generating) return stopGeneration();
  const ta = $('#input');
  const text = ta.value.trim();
  if (!text && !S.attachments.length) return;
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
  S.attachments = [];
  ta.value = '';
  autosize();
  renderAttachStrip();
  updateEstimate();
  S.stick = true;
  renderMessages();
  await Promise.race([refreshModelInfo(), new Promise((r) => setTimeout(r, 1500))]);
  await generate();
}

function stopGeneration() {
  S.stopRequested = true;
  if (S.pendingApproval) S.pendingApproval.resolve('deny');
  if (S.run) S.run.abort();
  if (S.execId) api.sys.abort(S.execId);
  abortSubagents();
}

function buildSystem() {
  let s = S.settings.systemPrompt || '';
  if (S.settings.appearance.thinkInGerman) s += (s ? '\n\n' : '') + 'Denke und überlege auf Deutsch (auch im Gedankengang).';
  if (useTools()) {
    s += `\n\nDu hast über Werkzeuge Zugriff auf einen Workspace-Ordner (${S.settings.workspace.path}). Verfügbar: list_files, search_text, read_file, edit_file, write_file${subOn() ? ', delegate_task' : ''}. Alle Pfade sind relativ zum Workspace. Der Kontext ist begrenzt: Lies große Dateien nie komplett, sondern finde die Stelle mit search_text und lies dann gezielt mit start_line/end_line. Lies eine Datei nicht erneut, wenn sie sich nicht geändert hat. Ändere vorhandene Dateien mit edit_file (kleine Ersetzungen) statt sie mit write_file komplett neu zu schreiben. Lies Dateien, bevor du Aussagen über ihren Inhalt machst. Schreibe oder ändere Dateien nur, wenn der Nutzer das wünscht. Erfinde keine Funktionen, Dateien oder Zeilen: Was du nicht gelesen hast, kennst du nicht.${hoOn() ? ' Wird die Arbeit sehr lang oder weist dich die App auf einen vollen Kontext hin, rufe propose_new_session auf (mit vollständiger Übergabe in summary und next_steps) und beende dann deine Antwort. Schreibe das nicht nur als Text.' : ''}${subOn() ? ' Für umfangreiche Erkundung oder getrennte Teilfragen nutze delegate_task: Der Unteragent arbeitet mit eigenem Kontext, darf nur lesen und liefert dir eine Zusammenfassung. Mehrere Unteragenten kannst du in einer Antwort gleichzeitig starten.' : ''}`;
    if (execOn()) {
      const win = /Win/i.test(navigator.platform || navigator.userAgent);
      s += `\n\nDu kannst außerdem Programme auf dem Rechner des Nutzers (${win ? 'Windows' : 'Desktop'}) nutzen: check_tool (Programm vorhanden?), run_command (Befehl ausführen${win ? ', Standard cmd, optional shell="powershell"' : ''}), install_tool (fehlendes Programm nach Rückfrage installieren). Das sind echte Werkzeuge: Du kannst sie selbst aufrufen und darfst nie behaupten, du hättest keinen Zugriff auf Programme. Vorgehen: 1) Mit check_tool prüfen, ob das Programm da ist (auch Namen wie apktool, jadx, java, python). 2) Fehlt es und wird es gebraucht, rufe install_tool auf: Der Nutzer bekommt eine Rückfrage mit dem genauen Befehl. Installiere nie ungefragt und nie etwas, das die Aufgabe nicht braucht. 3) Mit run_command ausführen. Befehle müssen nicht-interaktiv laufen. Lange Ausgaben werden gekürzt: filtere sie oder schreibe sie in eine Datei im Workspace und lies sie gezielt. Lege Ergebnisse (z. B. entpackte APKs) in einem Unterordner des Workspace ab, damit du sie mit read_file und search_text untersuchen kannst. Führe keine zerstörerischen Befehle aus (Löschen, Formatieren, Systemeinstellungen), außer der Nutzer verlangt es ausdrücklich. Du bist für Analyse und Entwicklung zuständig. Lies Ausgaben genau und berichte ehrlich, wenn ein Befehl fehlschlägt.`;
    }
  }
  return s.trim();
}


/* ═════════════ Kontext-Verwaltung ═════════════ */
/* Schätzt die Prompt-Größe (Zeichen / 3,3, bewusst vorsichtig für Code). */
function estimateWire(messages, system) {
  let n = (system || '').length + 1500; // Werkzeug-Definitionen
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
      return { ...m, content: `[Ausgabe von ${m.name}${what} (${fmt.num(m.content.length)} Zeichen) wurde entfernt, um Kontext zu sparen. Lies die Stelle bei Bedarf gezielt erneut.]` };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.some(bigArg)) {
      return { ...m, toolCalls: m.toolCalls.map((t) => {
        const args = { ...(t.args || {}) };
        for (const k of ['content', 'old_text', 'new_text']) if (typeof args[k] === 'string' && args[k].length > DROP_MIN) args[k] = `[… ${fmt.num(args[k].length)} Zeichen gekürzt]`;
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
  const ctx = +S.settings.params.numCtx || 0;
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

const TOOL_LABEL = { delegate_task: 'Unteragent starten', list_files: 'Ordner auflisten', read_file: 'Datei lesen', write_file: 'Datei schreiben', edit_file: 'Datei ändern', search_text: 'Text suchen', run_command: 'Programm ausführen', install_tool: 'Tool installieren', check_tool: 'Tool suchen' };
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
const approvalMode = () => permOf().mode || approvalDefault();
const permHas = (key) => permOf().keys.includes(key);
function permAdd(key) {
  const p = permOf();
  if (!p.keys.includes(key)) p.keys.push(key);
  permChanged();
}
function permChanged() {
  saveChatSoon();
  updatePermBtn();
}

const PERM_MODES = [
  { id: 'all', label: 'Alles bestätigen', hint: 'Jedes Werkzeug und jeder Befehl fragt nach' },
  { id: 'write', label: 'Nur Schreiben und Befehle bestätigen', hint: 'Lesen läuft automatisch' },
  { id: 'none', label: 'Nichts bestätigen', hint: 'Datei-Werkzeuge und Befehle laufen ohne Rückfrage' },
];
const permIsAuto = () => approvalMode() === 'none' || permOf().runAll;

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
function resolvePendingIfAuto() {
  const pa = S.pendingApproval;
  if (!pa) return;
  const p = permOf();
  if (pa.kind === 'install' ? p.installs : pa.kind === 'run' ? permIsAuto() : approvalMode() === 'none') pa.resolve('allow');
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
      el('button', { class: 'btn primary sm', text: 'Weitermachen', onclick: () => { if (!S.generating) { S.chat.pendingContinue = false; renderMessages(); generate(); } } }),
      text ? null : el('button', { class: 'btn sm', text: 'Schließen', onclick: () => { S.chat.pendingContinue = false; renderMessages(); saveChatSoon(); } })
    )
  );
}

function retryLast() {
  if (S.generating || !S.chat) return;
  const msgs = S.chat.messages;
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant' && last.error) msgs.pop();
  S.stick = true;
  renderMessages();
  generate();
}

function requestApproval(tc, opt = {}) {
  return new Promise((resolve) => {
    const a = tc.args || {};
    const target = opt.target || a.path || a.query || '';
    const content = String(a.content || '');
    const done = (d) => {
      S.pendingApproval = null;
      card.remove();
      resolve(d);
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
    S.pendingApproval = { resolve: done, kind: opt.kind || 'tool' };
    $('#messages-inner').append(card);
    if (S.stick) scrollBottom();
    else $('#scroll-down').classList.add('attn'); // Nutzer liest weiter oben: nicht wegscrollen, nur auffällig markieren
    allow.focus({ preventScroll: true });
    if (!document.hasFocus()) {
      try { new Notification('LLM Box – Freigabe nötig', { body: `${TOOL_LABEL[tc.name] || tc.name}: ${target}` }); } catch {}
    }
  });
}

/* Echtzeit: fragt während einer Anfrage den Server (/slots) nach echter Prompt-Größe und Fenster */
let livePoll = null;
function startLivePoll(conn) {
  if (livePoll) return;
  let busyFails = 0;
  const tick = async () => {
    if (!S.live) return;
    let r = null;
    try { r = await LLM.slotInfo(conn); } catch { r = null; }
    if (!r) { if (++busyFails >= 3) stopLivePoll(); return; } // Server kann es nicht: bei der Schätzung bleiben
    busyFails = 0;
    if (r.nCtx && S.settings.params.autoCtx !== false && conn.type !== 'ollama' && +S.settings.params.numCtx !== r.nCtx) {
      S.settings.params.numCtx = r.nCtx;
      saveSettings();
    }
    if (S.live && r.nPrompt > 0 && (r.busy === true || S.live.comp > 0) && r.nPrompt !== S.live.stale) {
      S.live.prompt = r.nPrompt;
      S.live.real = true;
    }
    updateCtxMeter();
    renderStatus();
  };
  livePoll = setInterval(tick, 1000);
}
function stopLivePoll() {
  if (livePoll) clearInterval(livePoll);
  livePoll = null;
}

async function generate() {
  trAbortAll(); // laufende Übersetzungen nicht mit dem Agenten konkurrieren lassen
  const chat = S.chat;
  const conn = activeConn();
  const model = currentModel();
  const maxSteps = Math.max(1, +S.settings.workspace.maxSteps || 25);
  S.generating = true;
  S.stopRequested = false;
  chat.pendingContinue = false;
  $$('.notice', $('#messages-inner')).forEach((n) => n.remove());
  updateSendBtn();
  let ticker = null;
  let finished = false;
  let nudged = false;
  let nudgeNext = false;

  try {
    for (let step = 0; step < maxSteps; step++) {
      const am = { id: uid(), role: 'assistant', content: '', thinking: '', model, ts: Date.now(), toolCalls: [] };
      chat.messages.push(am);
      const box = $('#messages-inner');
      box.querySelectorAll('.empty').forEach((n) => n.remove());
      const node = assistantEl(am, chat.messages.length - 1, false);
      renderAssistantParts(node, am, 'live');
      box.append(node);
      if (S.stick) scrollBottom();

      const live = { n: 0, t0: performance.now(), tFirst: 0 };
      const paint = () => {
        const now = performance.now();
        const el0 = live.tFirst ? (now - live.tFirst) / 1000 : 0;
        const tps = el0 > 0.4 ? live.n / el0 : null;
        node._r.stats.innerHTML =
          `<span class="st live" title="Live-Schätzung (1 Chunk ≈ 1 Token)"><b>${tps ? '~' + fmt.tps(tps) : '…'}</b> Tokens/s</span>` +
          `<span class="st live"><b>${fmt.num(live.n)}</b> Tokens</span><span class="st live"><b>${fmt.sec((now - live.t0) / 1000)}</b></span>`;
        if (S.live) { S.live.comp = live.n; updateCtxMeter(); renderStatus(); }
      };
      paint();
      ticker = setInterval(paint, 250);

      const schedule = () => {
        if (node._raf) return;
        node._raf = requestAnimationFrame(() => {
          node._raf = 0;
          renderAssistantParts(node, am, 'live');
          if (S.stick) scrollBottom();
        });
      };
      const tick = (n) => {
        live.n = n;
        if (!live.tFirst) live.tFirst = performance.now();
      };

      const nudgeNow = nudgeNext;
      nudgeNext = false;
      const sysText = buildSystem();
      const rawMsgs = nudgeNow ? [...chat.messages.slice(0, -1), { role: 'user', content: 'Fahre mit der Aufgabe fort. Nutze bei Bedarf weitere Werkzeuge oder fasse das Ergebnis für mich zusammen.' }] : chat.messages.slice(0, -1);
      const cmp = compactMessages(rawMsgs, sysText);
      if (cmp.info.newly) { am.compacted = { n: cmp.info.newly, before: cmp.info.before, after: cmp.info.after }; saveChatSoon(); }
      if (cmp.info.over && S.warnedOver !== chat.id) {
        S.warnedOver = chat.id;
        toast('Achtung: Der Kontext ist trotz Verschlankung fast voll. Starte besser einen neuen Chat mit einer Zusammenfassung.', 8000);
      }
      const lastStats = [...chat.messages].reverse().find((m) => m.role === 'assistant' && m.stats);
      S.live = { prompt: cmp.info.after, comp: 0, real: false, stale: lastStats ? lastStats.stats.promptTokens : 0 };
      updateCtxMeter();
      renderStatus();
      startLivePoll(conn);
      S.run = LLM.streamChat({
        conn,
        model,
        system: sysText,
        messages: cmp.messages,
        params: S.settings.params,
        tools: useTools() ? LLM.WORKSPACE_TOOLS.filter((t) => (subOn() || t.function.name !== 'delegate_task') && (hoOn() || t.function.name !== 'propose_new_session') && (execOn() || !EXEC_TOOLS.includes(t.function.name))) : null,
        thinkLevel: S.settings.thinking,
        handlers: {
          onContent: (full, n) => { am.content = full; tick(n); schedule(); },
          onThinking: (t, n) => { am.thinking = t; tick(n); schedule(); },
        },
      });

      let res = null;
      try {
        res = await S.run.promise;
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
      clearInterval(ticker);
      ticker = null;
      if (!res) S.live = null;
      if (node._raf) cancelAnimationFrame(node._raf);
      node._raf = 0;

      if (res) {
        am.content = res.content;
        am.thinking = res.thinking;
        am.toolCalls = res.toolCalls;
        am.stats = res.stats;
        am.finish = res.finishReason || '';
        S.live = null;
        updateCtxMeter();
        renderStatus();
        if (res.aborted) am.aborted = true;
        const sp = LLM.splitThink(am.content);
        if (sp.think) {
          am.thinking = [am.thinking, sp.think].filter(Boolean).join('\n');
          am.content = sp.answer;
        }
        const empty = !am.content && !am.toolCalls.length && !am.aborted;
        const afterTool = chat.messages.length >= 2 && chat.messages[chat.messages.length - 2].role === 'tool';
        if (empty && afterTool && !nudged && !S.stopRequested) {
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

      if (am.error || am.aborted || S.stopRequested || !am.toolCalls.length) {
        finished = true;
        break;
      }

      // Unteragenten starten sofort und laufen gleichzeitig; die übrigen Werkzeuge laufen der Reihe nach
      // Für jeden Werkzeugaufruf sofort eine Live-Karte (Status + Ausgabe), damit man sieht, worauf die KI gerade wartet
      for (const tc of am.toolCalls) tlStart(tc);
      const early = new Map();
      for (const tc of am.toolCalls) if (tc.name === 'delegate_task') early.set(tc.id, runTool(tc));
      for (const tc of am.toolCalls) {
        const tm = early.has(tc.id) ? await early.get(tc.id) : await runTool(tc);
        if (tm.name !== 'propose_new_session' && typeof tm.content === 'string') tm.content += hoModelHint(chat); // bei vollem Kontext: KI bitten, eine Übergabe vorzuschlagen
        chat.messages.push(tm);
        tlFinish(tc.id, tm);
        if (S.stopRequested) break;
      }
      if (S.stopRequested || am.toolCalls.some((t) => t.name === 'propose_new_session')) {
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
    tlClear();
    S.live = null;
    stopLivePoll();
    S.generating = false;
    S.run = null;
    S.pendingApproval = null;
    updateSendBtn();
    renderMessages();
    renderStatus();
    updateCtxMeter();
    saveChatNow();
    trAuto(chat); // Gedankengänge im Hintergrund ins Deutsche übersetzen
  }
}

async function runTool(tc) {
  const ws = S.settings.workspace;
  const base = { id: uid(), role: 'tool', name: tc.name, toolCallId: tc.id, args: tc.args, ts: Date.now() };
  tlState(tc.id, 'running');
  if (tc.name === 'delegate_task') return runSubagent(tc, base); // nur lesend: keine Freigabe nötig
  if (EXEC_TOOLS.includes(tc.name)) return runExecTool(tc, base);
  if (tc.name === 'propose_new_session') return { ...base, ok: true, content: 'Der Vorschlag wurde dem Nutzer mit einer Schaltfläche angezeigt. Beende deine Antwort jetzt (höchstens ein Satz) und rufe keine weiteren Werkzeuge auf.' };
  try {
    const mode = approvalMode();
    const needs = mode === 'all' || (mode === 'write' && (tc.name === 'write_file' || tc.name === 'edit_file'));
    const key = tc.name;
    if (needs && !permHas(key)) {
      tlState(tc.id, 'approval');
      const d = await requestApproval(tc);
      tlState(tc.id, 'running');
      if (d === 'always') permAdd(key);
      if (d === 'deny') return { ...base, ok: false, content: 'Der Benutzer hat die Ausführung abgelehnt. Frage nach, wie du stattdessen vorgehen sollst.' };
    }
    const r = await api.ws.tool({ root: ws.path, name: tc.name, args: tc.args, maxKB: +ws.readKB || 40, ignore: ignoreList() });
    if ((tc.name === 'write_file' || tc.name === 'edit_file') && r.ok) renderFilePanel();
    return { ...base, ok: r.ok, content: r.result };
  } catch (e) {
    return { ...base, ok: false, content: 'Fehler: ' + e.message };
  }
}

/* ═════════════ Programme auf dem Client ═════════════ */
async function runExecTool(tc, base) {
  const ws = S.settings.workspace;
  const a = tc.args || {};
  if (!execOn()) return { ...base, ok: false, content: 'Das Ausführen von Programmen ist in den Einstellungen ausgeschaltet. Sage dem Nutzer, dass er es unter Einstellungen → Workspace & Dateien aktivieren kann.' };
  const timeout = Math.max(5, +ws.execTimeout || 120);
  try {
    if (tc.name === 'check_tool') {
      const r = await api.sys.which({ name: a.name || '' });
      return { ...base, ok: r.ok, content: r.result };
    }
    if (tc.name === 'run_command') {
      const command = String(a.command || '').trim();
      if (!command) return { ...base, ok: false, content: 'Der Parameter command fehlt.' };
      const shellKind = a.shell === 'powershell' ? 'powershell' : 'cmd';
      const heads = cmdHeads(command);
      const prog = heads ? heads[0] : ((command.match(/^\s*(?:"([^"]+)"|(\S+))/) || [])[1] || (command.match(/^\s*(\S+)/) || [])[1] || '').toLowerCase();
      const keyOf = (h) => 'run:' + shellKind + ':' + h;
      const progAllowed = !!heads && heads.every((h) => !INTERPRETERS.has(h) && permHas(keyOf(h)));
      // Ohne Nachfrage: Modus „Nichts bestätigen“, „Alle Befehle erlaubt“ oder alle beteiligten Programme freigegeben.
      tlHead(tc.id, (shellKind === 'powershell' ? 'PS> ' : '> ') + command);
      if (!(permIsAuto() || progAllowed)) {
        tlState(tc.id, 'approval');
        const canProg = !!heads && heads.length === 1 && !INTERPRETERS.has(heads[0]) && !!prog;
        const d = await requestApproval(tc, {
          kind: 'run',
          target: command,
          note: `Läuft auf deinem Rechner (${shellKind === 'powershell' ? 'PowerShell' : 'cmd'}) mit deinen Benutzerrechten, Arbeitsordner: ${a.cwd ? ws.path + ' / ' + a.cwd : ws.path}. Prüfe den Befehl, bevor du genehmigst.`,
          noAlways: !canProg,
          alwaysLabel: `„${prog}“ immer erlauben (beliebige Argumente)`,
          alwaysTitle: 'Dieses Programm darf in diesem Chat mit beliebigen Argumenten laufen. Verkettete Befehle, Umleitungen (>) und Unterbefehle fragen weiterhin nach, außer alle beteiligten Programme sind freigegeben.',
          allCmds: true,
        });
        tlState(tc.id, 'running');
        if (d === 'deny') return { ...base, ok: false, content: 'Der Benutzer hat die Ausführung abgelehnt. Frage nach, wie du stattdessen vorgehen sollst.' };
        if (d === 'always' && canProg) permAdd(keyOf(heads[0]));
        if (d === 'all') { permOf().runAll = true; permChanged(); }
      }
      S.execId = uid();
      const tmo = +a.timeout > 0 ? Math.min(+a.timeout, 3600) : timeout;
      tlExec(tc.id, S.execId, tmo);
      const r = await api.sys.exec({ id: S.execId, root: ws.path, command, shell: shellKind, cwd: a.cwd || '', timeout: tmo }, (m) => tlAppend(tc.id, m.text));
      S.execId = null;
      renderFilePanel();
      return { ...base, ok: r.ok, content: r.result };
    }
    if (tc.name === 'install_tool') {
      const manager = String(a.manager || '');
      const pkg = String(a.package || '');
      const c = await api.sys.installCmd({ manager, pkg });
      if (c.error) return { ...base, ok: false, content: c.error };
      tlHead(tc.id, '> ' + c.command);
      if (!permOf().installs) tlState(tc.id, 'approval');
      const d = permOf().installs ? 'allow' : await requestApproval(tc, {
        kind: 'install',
        target: c.command,
        note: `${a.reason ? 'Grund: ' + a.reason + '. ' : ''}Die Installation ändert deinen Rechner. Je nach Paketmanager kann Windows eine Administrator-Abfrage (UAC) zeigen. Genehmige nur, wenn du dem Paket „${pkg}“ vertraust.`,
        noAlways: true,
        allowLabel: 'Installieren',
      });
      if (d !== 'allow') return { ...base, ok: false, content: 'Der Benutzer hat die Installation abgelehnt. Installiere nichts und frage, wie du ohne dieses Tool weitermachen sollst.' };
      tlState(tc.id, 'running');
      S.execId = uid();
      tlExec(tc.id, S.execId, 900);
      const r = await api.sys.install({ id: S.execId, root: ws.path, manager, pkg, timeout: 900 }, (m) => tlAppend(tc.id, m.text));
      S.execId = null;
      return { ...base, ok: r.ok, content: r.result + (r.ok ? '\nHinweis: Prüfe mit check_tool, ob das Programm jetzt gefunden wird. Manche Programme liegen nach der Installation nicht im PATH.' : '') };
    }
  } catch (e) {
    S.execId = null;
    return { ...base, ok: false, content: 'Fehler: ' + e.message };
  }
  return { ...base, ok: false, content: 'Unbekanntes Werkzeug: ' + tc.name };
}

function regenerate() {
  if (S.generating || !S.chat) return;
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
  if (S.generating) return toast('Bitte erst die Antwort stoppen.');
  const m = S.chat.messages[i];
  $('#input').value = m.content || '';
  S.attachments = (m.files || []).slice();
  S.chat.messages.length = i;
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
function renderAttachStrip() {
  const s = $('#attach-strip');
  s.innerHTML = '';
  S.attachments.forEach((f, i) => s.append(fileChip(f, () => { S.attachments.splice(i, 1); renderAttachStrip(); updateEstimate(); })));
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
  const tokens = attachTokens();
  const max = +S.settings.params.numCtx || 0;
  if (max && tokens > max * 0.8) toast(`Achtung: Anhänge ≈ ${fmt.num(tokens)} Tokens, Kontextlänge ist ${fmt.num(max)}. Erhöhe num_ctx oder hänge weniger an.`, 7000);
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

function autosize() {
  const ta = $('#input');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
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
}

function toggleTools() {
  const ws = S.settings.workspace;
  if (!ws.path) {
    toast('Wähle zuerst einen Workspace-Ordner.');
    openSettings('ws');
    return;
  }
  ws.toolsEnabled = !ws.toolsEnabled;
  saveSettings();
  updateToolsBtn();
  renderFilePanel();
  toast(ws.toolsEnabled ? 'KI darf den Workspace lesen und schreiben.' : 'KI-Dateizugriff ausgeschaltet.');
}

async function chooseWorkspace() {
  const p = await api.files.pickFolder('Workspace-Ordner wählen');
  if (!p) return;
  S.settings.workspace.path = p;
  saveSettings();
  renderFilePanel();
}

function renderFilePanel() {
  const p = $('#filepanel');
  p.classList.toggle('collapsed', !S.panelOpen);
  $('#btn-panel').classList.toggle('on', S.panelOpen);
  if (!S.panelOpen) return;
  p.innerHTML = '';
  const ws = S.settings.workspace;
  const name = ws.path ? ws.path.split(/[\\/]/).filter(Boolean).pop() : '';
  p.append(
    el('div', { class: 'fp-head' },
      el('div', { class: 'ttl' }, name || 'Workspace', ws.path ? el('span', { class: 'sub', text: ws.path, title: ws.path }) : null),
      el('button', { class: 'icon-btn', title: 'Ordner wählen', html: icon('folder', 16), onclick: chooseWorkspace }),
      ws.path ? el('button', { class: 'icon-btn', title: 'Aktualisieren', html: icon('refresh', 15), onclick: renderFilePanel }) : null
    )
  );
  const tree = el('div', { class: 'fp-tree' });
  p.append(tree);
  if (!ws.path) {
    tree.append(el('div', { class: 'fp-empty' }, 'Wähle einen Projektordner. Klicke Dateien an, um sie an die Nachricht zu hängen, oder erlaube der KI den Zugriff.', el('br'), el('button', { class: 'btn primary', text: 'Ordner wählen', onclick: chooseWorkspace })));
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
}

async function loadTree(container, rel, depth) {
  const ws = S.settings.workspace;
  let items;
  try {
    items = await api.ws.list({ root: ws.path, rel, ignore: ignoreList() });
  } catch (e) {
    container.append(el('div', { class: 'fp-empty', text: 'Ordner nicht lesbar: ' + e.message }));
    return;
  }
  if (!items.length && depth === 0) container.append(el('div', { class: 'fp-empty', text: 'Der Ordner ist leer.' }));
  for (const it of items) {
    const r = rel ? rel + '/' + it.name : it.name;
    const row = el('div', { class: 'tr', style: { paddingLeft: 6 + depth * 14 + 'px' }, title: it.isDir ? r : `${r} (${fmt.size(it.size)}) – klicken zum Anhängen` });
    row.append(el('span', { class: 'chev', html: it.isDir ? icon('chevron', 12) : '' }), el('span', { html: icon(it.isDir ? 'folder' : 'file', 14) }), el('span', { class: 'nm', text: it.name }));
    row.append(el('button', { class: 'mini-btn add', title: it.isDir ? 'Ganzen Ordner anhängen' : 'Anhängen', html: icon('plus', 13), onclick: async (e) => { e.stopPropagation(); addAttachments(await api.files.read([joinPath(ws.path, r)], fileLimits())); } }));
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
      row.addEventListener('click', async () => addAttachments(await api.files.read([joinPath(ws.path, r)], fileLimits())));
    }
  }
}

/* ═════════════ Export ═════════════ */
function chatToMarkdown(c) {
  const lines = [`# ${c.title}`, '', `_${new Date(c.created).toLocaleString('de-DE')} · ${c.model || ''}_`, ''];
  for (const m of c.messages) {
    if (m.role === 'user') {
      lines.push('## Du', '', ...(m.files || []).map((f) => `- 📎 ${f.name}`), m.content || '', '');
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
    lines.push('---', `Gesamt: ${fmt.num(t.total)} Tokens (Prompt ${fmt.num(t.prompt)}, Antwort ${fmt.num(t.comp)}) · Dauer ${fmt.dur(t.duration)} · Kosten ca. ${fmt.money(chatCost(c).amount, 'EUR')} (Vergleichswert)`);
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
  ta.addEventListener('input', () => { autosize(); updateEstimate(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const enterSends = S.settings.appearance.enterToSend;
    if ((enterSends && !e.shiftKey && !e.ctrlKey) || (!enterSends && e.ctrlKey)) {
      e.preventDefault();
      // Enter darf eine laufende Arbeit NICHT stoppen – dafür gibt es den Stopp-Knopf
      if (S.generating) return toast('Die KI arbeitet noch. Zum Abbrechen den Stopp-Knopf nutzen.');
      send();
    }
  });
  ta.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const imgs = await Promise.all(files.map(readImageFile));
    addAttachments({ files: imgs, skipped: [] });
  });

  $('#btn-send').addEventListener('click', send);
  $('#btn-new').addEventListener('click', newChat);
  $('#btn-settings').addEventListener('click', () => openSettings('conn'));
  $('#btn-server').innerHTML = icon('cpu', 16) + '<span>Server</span>';
  $('#btn-server').addEventListener('click', () => openServer('monitor'));
  $('#btn-refresh').addEventListener('click', refreshModels);
  $('#btn-export').addEventListener('click', exportChat);
  $('#btn-panel').addEventListener('click', () => { S.panelOpen = !S.panelOpen; renderFilePanel(); });
  $('#btn-attach').addEventListener('click', () => attachFromDialog('files'));
  $('#btn-attach-folder').addEventListener('click', () => attachFromDialog('folder'));
  $('#btn-tools').addEventListener('click', toggleTools);
  $('#btn-perm').addEventListener('click', openPermMenu);
  $('#btn-think').addEventListener('click', openThinkMenu);
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
    setModel(e.target.value);
    renderStatus();
    refreshModelInfo();
  });

  const msgs = $('#messages');
  // Mitscrollen: nur echtes Hochscrollen durch den Nutzer hält die Ansicht an. Wachsender Inhalt (Streaming, neue Karten)
  // verändert scrollTop nicht und darf das Mitlaufen daher nie stoppen.
  let lastTop = 0;
  msgs.addEventListener('scroll', () => {
    const top = msgs.scrollTop;
    const gap = msgs.scrollHeight - top - msgs.clientHeight;
    if (gap <= 32) {
      S.stick = true;
      $('#scroll-down').classList.remove('attn');
    } else if (top < lastTop - 1) S.stick = false; // Position hat sich nach oben verschoben
    lastTop = top;
    $('#scroll-down').classList.toggle('hidden', gap < 240);
  }, { passive: true });
  msgs.addEventListener('wheel', (e) => {
    if (e.deltaY >= 0 || msgs.scrollHeight <= msgs.clientHeight) return;
    // Mausrad in einem inneren Feld (Gedankengang, Programm-Ausgabe), das selbst scrollen kann: betrifft nur dieses Feld
    for (let n = e.target; n && n !== msgs; n = n.parentNode) if (n._fol && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return;
    S.stick = false;
  }, { passive: true });
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
    else if (e.key === ',') { e.preventDefault(); openSettings('conn'); }
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.appearance.theme === 'system') applyAppearance(); });
}

window.addEventListener('DOMContentLoaded', init);
