'use strict';
/* ═════════════ Open-WebUI-Funktionen ═════════════
   Prompt-Bibliothek mit „/“-Befehlen, Assistenten (eigene Rollen), Gedächtnis, Wissenssammlungen (lokale Suche),
   Websuche (SearXNG), Vorlesen, Chats ordnen (anheften, archivieren, Tags).
   Alles ist über „Module“ (modules.js) einzeln abschaltbar. Die Daten liegen lokal; nichts geht an Dritte. */

Object.assign(ICONS, {
  sound: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
});
const OW = { know: null, speak: null, kq: '' };
const owId = () => Math.random().toString(36).slice(2, 10);
const owList = (k) => (Array.isArray(S.settings[k]) ? S.settings[k] : (S.settings[k] = []));

/* ───── Prompt-Bibliothek („/“-Befehle) ───── */
function owExpand(t) {
  const d = new Date();
  return String(t || '')
    .replace(/\{\{\s*datum\s*\}\}/gi, d.toLocaleDateString('de-DE'))
    .replace(/\{\{\s*uhrzeit\s*\}\}/gi, d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{\{\s*wochentag\s*\}\}/gi, d.toLocaleDateString('de-DE', { weekday: 'long' }));
}
const SLASH = { el: null, items: [], sel: 0 };
function slashHide() { if (SLASH.el) SLASH.el.classList.add('hidden'); SLASH.items = []; }
function slashItems(q) {
  const out = [];
  if (modOn('prompts')) for (const p of owList('prompts')) if (p.cmd && p.cmd.toLowerCase().startsWith(q)) out.push({ cmd: p.cmd, desc: p.name || '', text: owExpand(p.text) });
  if (modOn('memory') && 'merke'.startsWith(q)) out.push({ cmd: 'merke', desc: 'Text im Gedächtnis speichern', text: '/merke ' });
  return out;
}
function slashRender() {
  if (!SLASH.el) return;
  SLASH.el.innerHTML = '';
  SLASH.items.forEach((it, i) => SLASH.el.append(el('button', { class: 'slash-item' + (i === SLASH.sel ? ' sel' : ''), onmousedown: (e) => { e.preventDefault(); slashPick(i); } }, el('b', { text: '/' + it.cmd }), el('span', { text: it.desc }))));
  SLASH.el.classList.toggle('hidden', !SLASH.items.length);
}
function slashPick(i) {
  const it = SLASH.items[i];
  if (!it) return;
  const ta = $('#input');
  ta.value = it.text;
  if (typeof autosize === 'function') autosize();
  if (typeof updateEstimate === 'function') updateEstimate();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  slashHide();
}
function slashInput() {
  const ta = $('#input');
  const m = /^\/([^\s]*)$/.exec(ta.value);
  if (!m) return slashHide();
  SLASH.items = slashItems(m[1].toLowerCase());
  SLASH.sel = 0;
  slashRender();
}
function slashKey(e) {
  if (!SLASH.items.length || (SLASH.el && SLASH.el.classList.contains('hidden'))) return;
  if (e.key === 'ArrowDown') { SLASH.sel = (SLASH.sel + 1) % SLASH.items.length; slashRender(); }
  else if (e.key === 'ArrowUp') { SLASH.sel = (SLASH.sel - 1 + SLASH.items.length) % SLASH.items.length; slashRender(); }
  else if (e.key === 'Enter' || e.key === 'Tab') { slashPick(SLASH.sel); }
  else if (e.key === 'Escape') { slashHide(); }
  else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}
// Eingabe „/merke …“ ins Gedächtnis; true = behandelt (nicht an die KI senden)
function owuiSendHook(text) {
  const m = modOn('memory') && /^\/merke\s+([\s\S]+)$/i.exec(String(text || '').trim());
  if (!m) return false;
  owList('memory').push({ id: owId(), text: m[1].trim(), ts: Date.now() });
  saveSettings();
  const ta = $('#input');
  ta.value = '';
  if (typeof autosize === 'function') autosize();
  slashHide();
  toast('Im Gedächtnis gespeichert.', 2500);
  return true;
}

/* ───── Assistenten ───── */
function owuiPersona(chat) {
  if (!modOn('personas') || !chat || !chat.persona) return null;
  return owList('personas').find((p) => p.id === chat.persona) || null;
}
function owuiParams(chat) {
  const P = owuiPersona(chat);
  if (P && P.temperature !== undefined && P.temperature !== null && P.temperature !== '' && !isNaN(+P.temperature)) return { ...S.settings.params, temperature: +P.temperature };
  return S.settings.params;
}
function owUpdateChips() {
  const pb = $('#btn-persona');
  if (pb) {
    const P = owuiPersona(S.chat);
    pb.innerHTML = icon('persona', 14) + '<span>' + (P ? P.name : 'Assistent') + '</span>';
    pb.classList.toggle('on', !!P);
  }
  const kb = $('#btn-know');
  if (kb) {
    const n = owActiveCollections(S.chat).length;
    kb.innerHTML = icon('book', 14) + '<span>' + (n ? 'Wissen · ' + n : 'Wissen') + '</span>';
    kb.classList.toggle('on', n > 0);
  }
}
function owPersonaMenu() {
  const cur = S.chat && S.chat.persona;
  const items = [{ label: 'Kein Assistent', hint: 'Standard-Systemprompt aus den Einstellungen', active: !cur, onClick: () => owSetPersona('') }];
  for (const p of owList('personas')) items.push({ label: p.name, hint: (p.system || '').replace(/\s+/g, ' ').slice(0, 70), active: cur === p.id, onClick: () => owSetPersona(p.id) });
  items.push({ label: 'Assistenten verwalten …', onClick: () => openSettings('prompts') });
  openMenu($('#btn-persona'), items);
}
function owSetPersona(id) {
  if (!S.chat || S.chat._live) return;
  S.chat.persona = id || '';
  const P = owuiPersona(S.chat);
  if (P && P.model && typeof setModel === 'function') { setModel(P.model); renderModelSelect(); renderStatus(); }
  if (S.chat.messages.length) saveChatSoon(S.chat);
  owUpdateChips();
}

/* ───── Gedächtnis und Systemprompt-Zusätze ───── */
function owuiSystem(chat, kctx) {
  let s = '';
  if (modOn('memory')) {
    const mem = owList('memory');
    if (mem.length) s += '\n\nDas weißt du über den Nutzer (Gedächtnis, nutze es unaufdringlich):\n' + mem.map((m) => '- ' + m.text).join('\n');
  }
  if (kctx) s += '\n\n' + kctx;
  if (owWebReady()) s += '\n\nDu kannst im Internet suchen (web_search) und Webseiten lesen (fetch_url). Nutze das bei aktuellen oder unsicheren Fragen und nenne die Quellen-Adressen.';
  return s;
}

/* ───── Wissenssammlungen (lokale Suche, BM25) ───── */
async function owKnowLoad() {
  if (OW.know) return OW.know;
  let k = null;
  try { k = await api.store.get('knowledge'); } catch {}
  OW.know = k && Array.isArray(k.collections) ? k : { collections: [] };
  return OW.know;
}
const owKnowSave = () => api.store.set('knowledge', OW.know);
function owChunk(text) {
  const paras = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (let p of paras) {
    while (p.length > 1100) { flush(); out.push(p.slice(0, 1000)); p = p.slice(850); }
    if ((cur + '\n\n' + p).length > 900) flush();
    cur += (cur ? '\n\n' : '') + p;
  }
  flush();
  return out;
}
const owTok = (t) => (String(t || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).map((w) => w.slice(0, 6)); // grobes Stemming: erste 6 Zeichen
function owBm25(query, docs) {
  const q = [...new Set(owTok(query))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => owTok(d.text));
  const N = docs.length;
  const avg = toks.reduce((n, t) => n + t.length, 0) / N || 1;
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const k1 = 1.4, b = 0.75;
  return docs.map((d, i) => {
    const tf = new Map();
    for (const w of toks[i]) tf.set(w, (tf.get(w) || 0) + 1);
    let sc = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const n = df.get(w) || 0;
      sc += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks[i].length) / avg)));
    }
    return { ...d, score: sc };
  }).filter((x) => x.score > 0).sort((a, b2) => b2.score - a.score);
}
function owActiveCollections(chat) {
  if (!modOn('knowledge') || !OW.know) return [];
  const ids = new Set((chat && chat.knowledge) || []);
  return OW.know.collections.filter((c) => c.auto || ids.has(c.id));
}
async function owuiKnowledge(chat) {
  if (!modOn('knowledge')) return '';
  await owKnowLoad();
  const cols = owActiveCollections(chat);
  if (!cols.length || !chat) return '';
  const users = chat.messages.filter((m) => m.role === 'user' && !m.handoff).slice(-2).map((m) => m.content || '');
  const query = users.join(' ');
  const docs = [];
  for (const c of cols) for (const d of c.docs) for (const t of d.chunks) docs.push({ text: t, src: d.name });
  const top = owBm25(query, docs).slice(0, 5);
  if (!top.length) return '';
  return 'Auszüge aus den Wissenssammlungen des Nutzers. Nutze sie, wenn sie zur Frage passen, und nenne die Quelle in Klammern:\n' + top.map((t) => `[Quelle: ${t.src}]\n${t.text.slice(0, 1000)}`).join('\n\n');
}
function owKnowMenu() {
  owKnowLoad().then((k) => {
    const sel = new Set((S.chat && S.chat.knowledge) || []);
    const items = k.collections.map((c) => ({ label: c.name, hint: c.auto ? 'immer aktiv' : c.docs.length + ' Dokument(e)', active: c.auto || sel.has(c.id), onClick: () => { if (c.auto || !S.chat || S.chat._live) return; sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); S.chat.knowledge = [...sel]; if (S.chat.messages.length) saveChatSoon(S.chat); owUpdateChips(); } }));
    if (!items.length) items.push({ header: 'Noch keine Sammlung angelegt' });
    items.push({ label: 'Sammlungen verwalten …', onClick: () => openSettings('know') });
    openMenu($('#btn-know'), items);
  });
}

/* ───── Websuche (SearXNG) ───── */
const OWUI_TOOLS = new Set(['web_search', 'fetch_url']);
/* Suchanbieter. Alle laufen direkt von diesem Rechner (Hauptprozess der App), ein eigener Server ist nur bei SearXNG nötig.
   Mit Schlüssel (key): Tavily, Brave, Serper, Exa. Ohne Schlüssel: DuckDuckGo, Wikipedia. */
const OW_PROVIDERS = [
  { id: 'tavily', label: 'Tavily (für KI gebaut, API-Schlüssel)', key: 'Tavily', url: 'https://app.tavily.com' },
  { id: 'brave', label: 'Brave Search (eigener Index, API-Schlüssel)', key: 'Brave', url: 'https://brave.com/search/api/' },
  { id: 'serper', label: 'Serper (Google-Ergebnisse, API-Schlüssel)', key: 'Serper', url: 'https://serper.dev' },
  { id: 'exa', label: 'Exa (semantische Suche, API-Schlüssel)', key: 'Exa', url: 'https://exa.ai' },
  { id: 'ddg', label: 'DuckDuckGo (eingebaut, ohne Konto)' },
  { id: 'wikipedia', label: 'Wikipedia (eingebaut, nur Wikipedia)' },
  { id: 'searxng', label: 'SearXNG (eigener Server)' },
];
const owProv = (id) => OW_PROVIDERS.find((p) => p.id === id);
const owWeb = () => {
  const w = ensureObj(S.settings, 'web', { provider: '', url: '', results: 5, lang: 'de' }); // dasselbe Objekt behalten (siehe ensureObj in live.js)
  ensureObj(w, 'keys', {});
  if (w.braveKey && !w.keys.brave) w.keys.brave = w.braveKey; // frühere Einstellung übernehmen
  if (!w.provider) w.provider = w.url ? 'searxng' : 'ddg';   // frühere Einstellung mit SearXNG-Adresse bleibt erhalten
  return w;
};
function owWebMissing() {
  const w = owWeb();
  if (w.provider === 'searxng' && !w.url) return 'Bei SearXNG fehlt die Adresse (z. B. http://192.0.2.1.20:8888).';
  const p = owProv(w.provider);
  if (p && p.key && !w.keys[w.provider]) return 'Bei ' + p.key + ' fehlt der API-Schlüssel.';
  return '';
}
const owWebReady = () => modOn('websearch') && !owWebMissing();
const OW_WEB_TOOLS = [
  { type: 'function', function: { name: 'web_search', description: 'Sucht im Internet und liefert Titel, Adresse und Ausschnitt der besten Treffer.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Suchbegriffe' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'fetch_url', description: 'Lädt eine Webseite und liefert ihren Text (gekürzt). Der Nutzer muss das Abrufen bestätigen.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Vollständige Adresse (https://…)' } }, required: ['url'] } } },
];
function owuiTools(base) {
  if (!owWebReady()) return base;
  return [...(base || []), ...OW_WEB_TOOLS];
}
const OW_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const OW_KL = { de: 'de-de', en: 'us-en', fr: 'fr-fr', all: 'wt-wt' };
const owN = () => Math.max(1, Math.min(10, +owWeb().results || 5));
async function owGet(url, headers, timeout) {
  const r = await api.fetch({ url, method: 'GET', headers: { 'User-Agent': OW_UA, 'Accept-Language': 'de,en;q=0.8', ...(headers || {}) }, timeout: timeout || 20000 });
  if (!r || !r.ok) { const e = new Error((r && (r.error || 'HTTP ' + r.status)) || 'nicht erreichbar'); e.status = r && r.status; e.body = r && r.text; throw e; }
  return r.text || '';
}
async function owPost(url, headers, body, timeout) {
  const r = await api.fetch({ url, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(headers || {}) }, body: JSON.stringify(body), timeout: timeout || 25000 });
  if (!r || !r.ok) { const e = new Error((r && (r.error || 'HTTP ' + r.status)) || 'nicht erreichbar'); e.status = r && r.status; e.body = r && r.text; throw e; }
  return r.text || '';
}
// Einheitliche, verständliche Fehler für Dienste mit Schlüssel
function owKeyError(name, e) {
  const b = String(e.body || '');
  if (e.status === 401 || e.status === 403) return new Error(name + ' lehnt den API-Schlüssel ab (HTTP ' + e.status + ').');
  if (e.status === 402 || e.status === 432 || e.status === 433 || /credit|quota|limit exceeded|insufficient/i.test(b)) return new Error(name + ': Guthaben oder Kontingent aufgebraucht (HTTP ' + e.status + ').');
  if (e.status === 429) return new Error(name + ': Anfragelimit erreicht. Kurz warten und erneut versuchen.');
  return e;
}
// DuckDuckGo: HTML-Ergebnisseite auswerten (kein Konto, kein Schlüssel). Link steckt im Parameter „uddg“.
function owParseDdg(html) {
  if (/anomaly|bots use DuckDuckGo|unusual traffic/i.test(html) && !/result__a/.test(html)) throw new Error('DuckDuckGo hat die Anfrage als automatisch erkannt. Später erneut versuchen oder Brave Search bzw. SearXNG wählen.');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const r of doc.querySelectorAll('.result')) {
    if (r.classList.contains('result--ad')) continue;
    const a = r.querySelector('a.result__a');
    if (!a) continue;
    let href = a.getAttribute('href') || '';
    const m = /[?&]uddg=([^&]+)/.exec(href);
    if (m) { try { href = decodeURIComponent(m[1]); } catch { href = m[1]; } }
    else if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:\/\//i.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    const sn = r.querySelector('.result__snippet');
    out.push({ title: a.textContent.replace(/\s+/g, ' ').trim(), url: href, content: sn ? sn.textContent.replace(/\s+/g, ' ').trim() : '' });
  }
  return out;
}
async function owSearchDdg(q) {
  const w = owWeb();
  const html = await owGet('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kl=' + (OW_KL[w.lang] || 'wt-wt'), { Accept: 'text/html' });
  return owParseDdg(html).slice(0, owN());
}
async function owSearchBrave(q) {
  const w = owWeb();
  let t;
  try { t = await owGet('https://api.search.brave.com/res/v1/web/search?count=' + owN() + '&q=' + encodeURIComponent(q) + (w.lang && w.lang !== 'all' ? '&search_lang=' + encodeURIComponent(w.lang) : ''), { Accept: 'application/json', 'X-Subscription-Token': w.keys.brave }); }
  catch (e) { throw owKeyError('Brave Search', e.status === 422 ? Object.assign(e, { status: 401 }) : e); }
  const j = JSON.parse(t);
  return ((j.web && j.web.results) || []).slice(0, owN()).map((x) => ({ title: x.title || '', url: x.url || '', content: String(x.description || '').replace(/<[^>]+>/g, '') }));
}
// Tavily: für KI-Anwendungen gebaut, liefert aus der Seite gezogene, zur Frage passende Textstellen (länger als ein Snippet)
async function owSearchTavily(q) {
  const w = owWeb();
  let t;
  try { t = await owPost('https://api.tavily.com/search', { Authorization: 'Bearer ' + w.keys.tavily }, { query: q, max_results: owN(), search_depth: 'basic', topic: 'general', include_answer: false }); }
  catch (e) { throw owKeyError('Tavily', e); }
  return (JSON.parse(t).results || []).slice(0, owN()).map((x) => ({ title: x.title || '', url: x.url || '', content: String(x.content || ''), max: 800 }));
}
// Serper: Google-Ergebnisse als JSON
async function owSearchSerper(q) {
  const w = owWeb();
  const gl = { de: 'de', en: 'us', fr: 'fr' }[w.lang];
  let t;
  try { t = await owPost('https://google.serper.dev/search', { 'X-API-KEY': w.keys.serper }, { q, num: owN(), ...(gl ? { gl } : {}), ...(/^[a-z]{2}$/.test(w.lang) ? { hl: w.lang } : {}) }); }
  catch (e) { throw owKeyError('Serper', e); }
  const j = JSON.parse(t);
  const ab = j.answerBox ? [{ title: j.answerBox.title || 'Direkte Antwort', url: j.answerBox.link || '', content: String(j.answerBox.answer || j.answerBox.snippet || ''), max: 400 }].filter((x) => x.content) : [];
  return [...ab, ...(j.organic || []).map((x) => ({ title: x.title || '', url: x.link || '', content: x.snippet || '' }))].slice(0, owN());
}
// Exa: semantische Suche mit Textauszügen
async function owSearchExa(q) {
  const w = owWeb();
  let t;
  try { t = await owPost('https://api.exa.ai/search', { 'x-api-key': w.keys.exa }, { query: q, numResults: owN(), type: 'auto', contents: { text: { maxCharacters: 800 } } }); }
  catch (e) { throw owKeyError('Exa', e); }
  return (JSON.parse(t).results || []).slice(0, owN()).map((x) => ({ title: x.title || '', url: x.url || '', content: String(x.text || '').replace(/\s+/g, ' ').trim(), max: 800 }));
}
async function owSearchWikipedia(q) {
  const lang = /^[a-z]{2,3}$/.test(owWeb().lang) ? owWeb().lang : 'de';
  const t = await owGet('https://' + lang + '.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=' + owN() + '&srsearch=' + encodeURIComponent(q), { Accept: 'application/json' });
  const j = JSON.parse(t);
  return ((j.query && j.query.search) || []).map((x) => ({ title: x.title, url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(String(x.title).replace(/ /g, '_')), content: String(x.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&') }));
}
async function owSearx(query) {
  const w = owWeb();
  const url = w.url.replace(/\/+$/, '') + '/search?format=json&q=' + encodeURIComponent(query) + '&language=' + encodeURIComponent(w.lang || 'de');
  const r = await api.fetch({ url, method: 'GET', headers: { Accept: 'application/json' }, timeout: 20000 });
  if (!r || !r.ok) {
    if (r && r.status === 403) throw new Error('SearXNG verweigert das JSON-Format. In settings.yml unter „search: formats“ muss „json“ stehen.');
    if (r && /ECONNREFUSED/.test(r.error || '')) throw new Error('Verbindung abgelehnt. Prüfe Adresse und Port (SearXNG lauscht meist auf 8888 oder 8080) und ob der Server läuft.');
    throw new Error((r && (r.error || 'HTTP ' + r.status)) || 'nicht erreichbar');
  }
  let j;
  try { j = JSON.parse(r.text); } catch { throw new Error('Die Antwort ist kein JSON. Prüfe die Adresse und ob SearXNG das JSON-Format erlaubt.'); }
  return (j.results || []).slice(0, owN());
}
// Sucht mit dem gewählten Anbieter. Fällt DuckDuckGo aus, antwortet ersatzweise Wikipedia (mit Hinweis), damit die KI nicht ohne Ergebnis dasteht.
async function owSearch(q) {
  const w = owWeb();
  const miss = owWebMissing();
  if (miss) throw new Error(miss);
  if (w.provider === 'tavily') return { results: await owSearchTavily(q), via: 'Tavily' };
  if (w.provider === 'brave') return { results: await owSearchBrave(q), via: 'Brave Search' };
  if (w.provider === 'serper') return { results: await owSearchSerper(q), via: 'Serper (Google)' };
  if (w.provider === 'exa') return { results: await owSearchExa(q), via: 'Exa' };
  if (w.provider === 'wikipedia') return { results: await owSearchWikipedia(q), via: 'Wikipedia' };
  if (w.provider === 'searxng') return { results: await owSearx(q), via: 'SearXNG' };
  try { return { results: await owSearchDdg(q), via: 'DuckDuckGo' }; }
  catch (e) {
    try { const r = await owSearchWikipedia(q); return { results: r, via: 'Wikipedia', note: 'DuckDuckGo war nicht verfügbar (' + e.message + '). Die Treffer stammen ersatzweise aus Wikipedia.' }; }
    catch { throw e; }
  }
}
function owHtmlText(html) {
  try {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script,style,noscript,svg,nav,footer,header,form').forEach((n) => n.remove());
    return (d.body ? d.body.textContent : '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  } catch { return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
}
async function owuiRunTool(tc, base, rc, R) {
  try {
    if (!owWebReady()) return { ...base, ok: false, content: 'Die Websuche ist in den Einstellungen ausgeschaltet oder nicht fertig eingerichtet' + (owWebMissing() ? ': ' + owWebMissing() : '.') };
    if (tc.name === 'web_search') {
      const q = String((tc.args && tc.args.query) || '').trim();
      if (!q) return { ...base, ok: false, content: 'query fehlt.' };
      const sr = await owSearch(q);
      const res = sr.results;
      if (!res.length) return { ...base, ok: true, content: 'Keine Treffer (' + sr.via + ').' };
      return { ...base, ok: true, content: (sr.note ? sr.note + '\n\n' : '') + res.map((x, i) => `${i + 1}. ${x.title || ''}\n${x.url || ''}\n${(x.content || '').replace(/\s+/g, ' ').slice(0, x.max || 300)}`).join('\n\n') };
    }
    if (tc.name === 'fetch_url') {
      const u = String((tc.args && tc.args.url) || '').trim();
      if (!/^https?:\/\//i.test(u)) return { ...base, ok: false, content: 'Nur http(s)-Adressen sind erlaubt.' };
      // Eine vom Modell gewählte Adresse darf Daten nach außen tragen: immer bestätigen lassen, außer „Nichts bestätigen“ oder „Immer erlauben“
      if (approvalMode(rc) !== 'none' && !permHas('fetch_url', rc)) {
        tlState(tc.id, 'approval');
        const d = await requestApproval(tc, undefined, R);
        tlState(tc.id, 'running');
        if (d === 'always') permAdd('fetch_url', rc);
        if (d === 'deny') return { ...base, ok: false, content: 'Der Benutzer hat das Abrufen abgelehnt.' };
      }
      const r = await api.fetch({ url: u, method: 'GET', headers: { Accept: 'text/html,text/plain,*/*' }, timeout: 20000 });
      if (!r || !r.ok) return { ...base, ok: false, content: 'Abruf fehlgeschlagen: ' + ((r && (r.error || 'HTTP ' + r.status)) || 'nicht erreichbar') };
      const text = /<html|<body|<!doctype/i.test(r.text || '') ? owHtmlText(r.text) : String(r.text || '');
      return { ...base, ok: true, content: text.length > 10000 ? text.slice(0, 10000) + '\n[… gekürzt, ' + text.length + ' Zeichen]' : text };
    }
  } catch (e) { return { ...base, ok: false, content: 'Fehler: ' + e.message }; }
  return { ...base, ok: false, content: 'Unbekanntes Werkzeug.' };
}

/* ───── Vorlesen ───── */
const OW_LANG = { de: 'de-DE', en: 'en-US', fr: 'fr-FR' };
function owPlain(t) {
  return String(t || '').replace(/```[\s\S]*?```/g, ' (Codeblock) ').replace(/`([^`]+)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' Link ').replace(/[#*_>|~]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function owSpeakToggle(m, btn) {
  const ss = window.speechSynthesis;
  if (!ss) return toast('Vorlesen wird auf diesem Gerät nicht unterstützt.', 4000);
  if (OW.speak && OW.speak.m === m) { ss.cancel(); return; }
  ss.cancel();
  const text = owPlain(LLM.splitThink(m.content || '').answer);
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  const lang = OW_LANG[S.settings.uiLang] || 'de-DE';
  u.lang = lang;
  u.rate = Math.max(0.5, Math.min(2, +((S.settings.tts || {}).rate) || 1));
  const v = (ss.getVoices() || []).find((x) => x.lang === lang) || (ss.getVoices() || []).find((x) => x.lang && x.lang.startsWith(lang.slice(0, 2)));
  if (v) u.voice = v;
  const done = () => { if (OW.speak && OW.speak.m === m) OW.speak = null; btn.classList.remove('on'); };
  u.onend = done; u.onerror = done;
  OW.speak = { m };
  btn.classList.add('on');
  ss.speak(u);
}
function owuiActions(acts, m) {
  if (!modOn('tts') || !window.speechSynthesis || !m || m.role !== 'assistant') return;
  const b = actionBtn('sound', 'Antwort vorlesen (nochmal klicken: Stopp)', () => owSpeakToggle(m, b));
  acts.append(b);
}

/* ───── Chats ordnen ───── */
const owOrg = () => { const o = (S.settings.org = S.settings.org || {}); o.pins = o.pins || {}; o.archived = o.archived || {}; o.tags = o.tags || {}; return o; };
function owuiTogglePin(id) { const o = owOrg(); if (o.pins[id]) delete o.pins[id]; else o.pins[id] = 1; saveSettings(); renderChatList(); }
function owuiToggleArchive(id) { const o = owOrg(); if (o.archived[id]) delete o.archived[id]; else { o.archived[id] = 1; delete o.pins[id]; } saveSettings(); renderChatList(); }
async function owuiEditTags(id) {
  const o = owOrg();
  const v = await promptModal('Tags', 'Tags, durch Komma getrennt (leer = alle entfernen)', (o.tags[id] || []).join(', '));
  if (v === null && !(o.tags[id] || []).length) return;
  const list = String(v || '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 6);
  if (list.length) o.tags[id] = list; else delete o.tags[id];
  saveSettings();
  renderChatList();
}

/* ───── Einbinden in die Oberfläche ───── */
function owuiInit() {
  if (typeof TOOL_LABEL !== 'undefined') Object.assign(TOOL_LABEL, { web_search: 'Websuche', fetch_url: 'Webseite abrufen' });
  const think = $('#btn-think');
  if (think && !$('#btn-persona')) {
    const pb = el('button', { id: 'btn-persona', class: 'chip-btn', title: 'Assistent (Rolle mit eigenem Systemprompt) für diesen Chat', onclick: owPersonaMenu });
    const kb = el('button', { id: 'btn-know', class: 'chip-btn', title: 'Wissenssammlungen für diesen Chat', onclick: owKnowMenu });
    think.after(pb, kb);
  }
  const comp = $('#composer');
  if (comp && !SLASH.el) {
    SLASH.el = el('div', { id: 'slash-pop', class: 'slash-pop hidden', role: 'listbox' });
    comp.prepend(SLASH.el);
    const ta = $('#input');
    ta.addEventListener('input', slashInput);
    ta.addEventListener('keydown', slashKey, true);
    ta.addEventListener('blur', () => setTimeout(slashHide, 150));
  }
  owKnowLoad().then(owUpdateChips);
  owUpdateChips();
}
function owuiRefresh() { owUpdateChips(); }

/* ═════════════ Einstellungen ═════════════ */
function owForm(title, fields, onSave, initial) {
  const vals = Object.assign({}, initial || {});
  const inputs = {};
  const body = el('div', { class: 'ow-form' });
  for (const f of fields) {
    const inp = f.area ? el('textarea', { rows: f.rows || 6, placeholder: f.ph || '' }) : el('input', { type: f.type || 'text', placeholder: f.ph || '' });
    inp.value = vals[f.k] ?? '';
    inputs[f.k] = inp;
    body.append(el('label', { class: 'ow-field' }, el('span', { text: f.label }), inp, f.hint ? el('small', { text: f.hint }) : null));
  }
  openModal({
    title, wide: true, body,
    buttons: [
      { label: 'Abbrechen', value: null },
      { label: 'Speichern', primary: true, onClick: (close) => {
        const o = {};
        for (const f of fields) o[f.k] = inputs[f.k].value.trim();
        const err = onSave(o);
        if (err) return toast(err, 4000);
        close(true);
      } },
    ],
  });
}
function owRows(items, label, sub, onEdit, onDel) {
  const box = el('div', { class: 'ow-rows' });
  if (!items.length) box.append(el('div', { class: 'fhint', text: 'Noch nichts angelegt.' }));
  for (const it of items) box.append(el('div', { class: 'ow-row' }, el('div', { class: 'ow-main' }, el('b', { text: label(it) }), el('span', { text: sub(it) })), onEdit ? el('button', { class: 'btn sm', text: 'Bearbeiten', onclick: () => onEdit(it) }) : null, el('button', { class: 'btn sm danger', text: 'Löschen', onclick: () => onDel(it) })));
  return box;
}
function tabPrompts() {
  const wrap = el('div');
  function render() {
    wrap.innerHTML = '';
    const prompts = owList('prompts'), pers = owList('personas');
    wrap.append(
      el('h3', { text: 'Prompt-Bibliothek' }),
      el('div', { class: 'fhint', text: 'Vorlagen, die du im Eingabefeld mit „/“ und dem Befehl einfügst (z. B. „/zusammenfassen“). Platzhalter: {{datum}}, {{uhrzeit}}, {{wochentag}}.' + (modOn('prompts') ? '' : ' Das Modul ist ausgeschaltet (Einstellungen → Funktionen & Ansicht).') }),
      owRows(prompts, (p) => '/' + p.cmd, (p) => (p.name || '') + ' · ' + String(p.text || '').replace(/\s+/g, ' ').slice(0, 70), (p) => editPrompt(p), (p) => { S.settings.prompts = prompts.filter((x) => x !== p); saveSettings(); render(); }),
      el('div', { class: 'row-gap' }, el('button', { class: 'btn sm primary', text: 'Neue Vorlage', onclick: () => editPrompt(null) })),
      el('h3', { text: 'Assistenten' }),
      el('div', { class: 'fhint', text: 'Eigene Rollen mit Systemprompt, optional festem Modell und eigener Temperatur. Auswahl über den Knopf „Assistent“ im Eingabefeld, pro Chat.' + (modOn('personas') ? '' : ' Das Modul ist ausgeschaltet.') }),
      owRows(pers, (p) => p.name, (p) => (p.model ? 'Modell: ' + p.model + ' · ' : '') + String(p.system || '').replace(/\s+/g, ' ').slice(0, 80), (p) => editPersona(p), (p) => { S.settings.personas = pers.filter((x) => x !== p); saveSettings(); render(); }),
      el('div', { class: 'row-gap' }, el('button', { class: 'btn sm primary', text: 'Neuer Assistent', onclick: () => editPersona(null) }))
    );
  }
  function editPrompt(p) {
    owForm(p ? 'Vorlage bearbeiten' : 'Neue Vorlage', [
      { k: 'cmd', label: 'Befehl (ohne „/“, ohne Leerzeichen)', ph: 'zusammenfassen' },
      { k: 'name', label: 'Beschreibung', ph: 'Text kurz zusammenfassen' },
      { k: 'text', label: 'Text der Vorlage', area: true, rows: 8, ph: 'Fasse den folgenden Text in fünf Stichpunkten zusammen:\n\n' },
    ], (o) => {
      o.cmd = o.cmd.replace(/^\/+/, '').replace(/\s+/g, '');
      if (!o.cmd || !o.text) return 'Befehl und Text sind nötig.';
      if (owList('prompts').some((x) => x !== p && x.cmd.toLowerCase() === o.cmd.toLowerCase())) return 'Diesen Befehl gibt es schon.';
      if (p) Object.assign(p, o); else owList('prompts').push({ id: owId(), ...o });
      saveSettings(); render();
    }, p);
  }
  function editPersona(p) {
    owForm(p ? 'Assistent bearbeiten' : 'Neuer Assistent', [
      { k: 'name', label: 'Name', ph: 'Übersetzer' },
      { k: 'system', label: 'Systemprompt', area: true, rows: 9, ph: 'Du bist ein präziser Übersetzer …', hint: 'Ersetzt den allgemeinen Systemprompt aus „Modell & Parameter“ für Chats mit diesem Assistenten.' },
      { k: 'model', label: 'Modell (optional)', ph: 'leer = aktuelles Modell', hint: 'Wird beim Auswählen des Assistenten gewählt.' },
      { k: 'temperature', label: 'Temperatur (optional)', type: 'number', ph: 'leer = Standard' },
    ], (o) => {
      if (!o.name || !o.system) return 'Name und Systemprompt sind nötig.';
      if (p) Object.assign(p, o); else owList('personas').push({ id: owId(), ...o });
      saveSettings(); render();
    }, p);
  }
  render();
  return wrap;
}

function tabKnowledge() {
  const wrap = el('div');
  async function render() {
    const k = await owKnowLoad();
    wrap.innerHTML = '';
    const mem = owList('memory');
    const memIn = el('input', { type: 'text', placeholder: 'z. B. Ich heiße Max und programmiere am liebsten in Python.', style: { width: '100%' } });
    const addMem = () => { const t = memIn.value.trim(); if (!t) return; mem.push({ id: owId(), text: t, ts: Date.now() }); saveSettings(); render(); };
    memIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMem(); });
    wrap.append(
      el('h3', { text: 'Gedächtnis' }),
      el('div', { class: 'fhint', text: 'Kurze Sätze, die die KI in jedem Chat kennt. Im Chat geht es auch mit „/merke Text“.' + (modOn('memory') ? '' : ' Das Modul ist ausgeschaltet.') }),
      owRows(mem, (m) => m.text, (m) => new Date(m.ts || Date.now()).toLocaleDateString('de-DE'), null, (m) => { S.settings.memory = mem.filter((x) => x !== m); saveSettings(); render(); }),
      el('div', { class: 'row-gap' }, memIn, el('button', { class: 'btn sm primary', text: 'Hinzufügen', onclick: addMem })),
      el('h3', { text: 'Wissenssammlungen' }),
      el('div', { class: 'fhint', text: 'Lege Dokumente (Text, PDF, Word, Excel, Code …) in Sammlungen ab. Beim Antworten sucht die App lokal die passendsten Abschnitte und gibt sie der KI mit. Nichts verlässt deinen Rechner, außer was im Chat an dein Modell geht. Auswahl pro Chat über den Knopf „Wissen“.' + (modOn('knowledge') ? '' : ' Das Modul ist ausgeschaltet.') }),
    );
    for (const c of k.collections) {
      const chunks = c.docs.reduce((n, d) => n + d.chunks.length, 0);
      const auto = el('input', { type: 'checkbox' });
      auto.checked = !!c.auto;
      auto.addEventListener('change', async () => { c.auto = auto.checked; await owKnowSave(); owUpdateChips(); });
      const docs = el('div', { class: 'ow-rows' });
      if (!c.docs.length) docs.append(el('div', { class: 'fhint', text: 'Noch keine Dokumente.' }));
      for (const d of c.docs) docs.append(el('div', { class: 'ow-row' }, el('div', { class: 'ow-main' }, el('b', { text: d.name }), el('span', { text: d.chunks.length + ' Abschnitte' })), el('button', { class: 'btn sm danger', text: 'Entfernen', onclick: async () => { c.docs = c.docs.filter((x) => x !== d); await owKnowSave(); render(); } })));
      const add = async (mode) => {
        let res = null;
        try { res = await api.files.pick(mode, fileLimits()); } catch (e) { return toast('Auswahl fehlgeschlagen: ' + e.message, 5000); }
        if (!res || !res.files) return;
        let n = 0;
        for (const f of res.files) {
          if (f.kind !== 'text' || !f.text) continue;
          const ch = owChunk(f.text);
          if (!ch.length) continue;
          c.docs = c.docs.filter((x) => x.name !== f.name);
          c.docs.push({ id: owId(), name: f.name, chunks: ch });
          n++;
        }
        await owKnowSave();
        toast(n + ' Dokument(e) hinzugefügt' + (res.skipped && res.skipped.length ? ', ' + res.skipped.length + ' übersprungen' : '') + '.', 4000);
        render();
      };
      wrap.append(el('div', { class: 'ow-col' },
        el('div', { class: 'ow-col-head' }, el('b', { text: c.name }), el('span', { class: 'fhint', text: `${c.docs.length} Dokument(e), ${chunks} Abschnitte` }),
          el('label', { class: 'ow-auto', title: 'Wird in jedem Chat verwendet' }, auto, el('span', { text: 'immer aktiv' })),
          el('button', { class: 'btn sm', text: 'Dateien …', onclick: () => add('files') }),
          el('button', { class: 'btn sm', text: 'Ordner …', onclick: () => add('folder') }),
          el('button', { class: 'btn sm danger', text: 'Sammlung löschen', onclick: async () => { if (await confirmModal('Sammlung löschen', `„${c.name}“ mit allen Dokumenten löschen?`, { okLabel: 'Löschen', danger: true })) { k.collections = k.collections.filter((x) => x !== c); await owKnowSave(); render(); } } })),
        docs));
    }
    wrap.append(el('div', { class: 'row-gap' }, el('button', { class: 'btn sm primary', text: 'Neue Sammlung', onclick: async () => { const n = await promptModal('Neue Sammlung', 'Name der Sammlung', ''); if (!n) return; k.collections.push({ id: owId(), name: n, auto: false, docs: [] }); await owKnowSave(); render(); } })));
  }
  render();
  return wrap;
}

/* ───── SearXNG als Hintergrunddienst (Hauptprozess: main.js, searx:*) ───── */
const owSearxCfg = () => {
  const w = owWeb();
  const s = ensureObj(w, 'searx', { auto: false, mode: 'docker', port: 8888, command: '', stopOnQuit: true });
  if (s.mode !== 'command') s.mode = 'docker';
  if (!(s.port >= 1024 && s.port <= 65535)) s.port = 8888;
  return s;
};
const owSearxOpts = () => { const s = owSearxCfg(); return { mode: s.mode, port: s.port, command: s.command, stopOnQuit: s.stopOnQuit !== false }; };
/* Startet den Dienst und stellt die Websuche auf diese lokale Adresse. silent: beim Programmstart keine Erfolgsmeldung. */
async function owSearxStart(silent) {
  const w = owWeb(), s = owSearxCfg();
  w.provider = 'searxng';
  w.url = 'http://127.0.0.1:' + s.port;
  saveSettings();
  if (!silent) toast('SearXNG wird gestartet … (beim ersten Mal lädt Docker das Image, das kann einige Minuten dauern)', 6000);
  let r;
  try { r = await api.searx.start(owSearxOpts()); } catch (e) { r = { ok: false, error: e.message }; }
  if (r.ok) { if (!silent) toast('SearXNG läuft auf ' + w.url + '.', 4000); }
  else toast('SearXNG konnte nicht gestartet werden: ' + (r.error || 'unbekannter Fehler'), 9000);
  return r;
}
/* Beim Programmstart im Hintergrund, ohne den Start der App zu blockieren. */
function owSearxAutostart() {
  try {
    if (!modOn('websearch')) return;
    const w = owWeb(), s = owSearxCfg();
    if (w.provider !== 'searxng' || !s.auto) return;
    owSearxStart(true);
  } catch {}
}

function tabWebSearch() {
  const wrap = el('div');
  const out = el('div', { class: 'fhint' });
  function render() {
    const w = owWeb();
    wrap.innerHTML = '';
    const sel = el('select', {}, OW_PROVIDERS.map((p) => el('option', { value: p.id, text: p.label })));
    sel.value = w.provider;
    sel.addEventListener('change', () => { w.provider = sel.value; saveSettings(); out.textContent = ''; render(); });
    const test = el('button', { class: 'btn sm', text: 'Testen', onclick: async () => {
      out.textContent = 'Teste …';
      try { const r = await owSearch('Wetter Berlin'); out.textContent = 'Funktioniert (' + r.via + '): ' + r.results.length + ' Treffer' + (r.note ? '. ' + r.note : '.'); }
      catch (e) { out.textContent = 'Fehler: ' + e.message; }
    } });
    wrap.append(
      el('h3', { text: 'Websuche' }),
      el('div', { class: 'fhint', text: 'Die KI darf im Internet suchen (web_search) und einzelne Seiten lesen (fetch_url). Die Anfragen gehen direkt von diesem Rechner aus. Das Modul „Websuche“ muss eingeschaltet sein (Einstellungen → Funktionen & Ansicht).' }),
      frow('Suchanbieter', 'Für beste Ergebnisse: Tavily (liefert längere, zur Frage passende Textstellen, speziell für KI gebaut), Serper (Google-Ergebnisse), Brave (unabhängiger Index) oder Exa (semantische Suche). Alle haben ein kostenloses Startkontingent, danach zahlst du beim Anbieter; Umfang und Preise legt der Anbieter fest und ändern sich. DuckDuckGo und Wikipedia gehen ohne Konto, sind aber schwächer.', sel)
    );
    const p = owProv(w.provider);
    if (p && p.key) wrap.append(frow(p.key + ' API-Schlüssel', 'Zu holen auf ' + p.url + '. Der Schlüssel wird wie die anderen Schlüssel dieser App lokal gespeichert.', bindText('web.keys.' + p.id, { type: 'password', placeholder: 'API-Schlüssel' })));
    if (w.provider === 'searxng') wrap.append(frow('SearXNG-Adresse', 'Mit Port, z. B. http://192.0.2.1.20:8888. In der settings.yml des Servers muss unter „search: formats“ auch „json“ stehen.', bindText('web.url', { placeholder: 'http://localhost:8888' })));
    if (w.provider === 'searxng') {
      const sx = owSearxCfg();
      const st = el('div', { class: 'fhint' });
      const showStatus = async () => {
        st.textContent = 'Prüfe …';
        let r;
        try { r = await api.searx.status(owSearxOpts()); } catch (e) { st.textContent = 'Status nicht lesbar: ' + e.message; return; }
        const parts = [];
        if (r.mode === 'docker') parts.push(!r.docker ? (r.why === 'missing' ? 'Docker ist nicht installiert' : 'Docker läuft nicht') : r.container === 'running' ? 'Container läuft' : r.container === 'stopped' ? 'Container gestoppt' : 'Container noch nicht angelegt');
        else parts.push(r.child ? 'Startbefehl läuft' : 'Startbefehl läuft nicht');
        parts.push(r.json ? 'Antwortet mit JSON (bereit)' : r.reachable ? 'Antwortet, aber ohne JSON-Format' : 'Keine Antwort auf Port ' + r.port);
        st.textContent = parts.join(' · ');
      };
      wrap.append(
        frow('SearXNG mit der App starten', 'Startet SearXNG beim Programmstart im Hintergrund und beendet es mit der App. SearXNG wird nicht mitgeliefert, sondern als eigener Dienst gestartet (Docker oder eigener Befehl). Es ist nur auf diesem Rechner erreichbar.', (() => {
          const i = el('input', { type: 'checkbox' });
          i.checked = !!sx.auto;
          i.addEventListener('change', async () => { sx.auto = i.checked; saveSettings(); if (sx.auto) { await owSearxStart(false); render(); } });
          return el('label', { class: 'switch' }, i, el('span'));
        })()),
        frow('Art des Dienstes', 'Docker: nutzt das Image searxng/searxng, Docker (Desktop) muss installiert sein. Eigener Befehl: für eine vorhandene SearXNG-Installation.', (() => {
          const s2 = el('select', {}, [{ value: 'docker', label: 'Docker (empfohlen)' }, { value: 'command', label: 'Eigener Startbefehl' }].map((x) => el('option', { value: x.value, text: x.label })));
          s2.value = sx.mode;
          s2.addEventListener('change', () => { sx.mode = s2.value; saveSettings(); render(); });
          return s2;
        })()),
        frow('Port', 'Nur auf 127.0.0.1. Standard 8888.', bindNumber('web.searx.port', { min: 1024, max: 65535, placeholder: '8888' }))
      );
      if (sx.mode === 'command') wrap.append(frow('Startbefehl', 'Wird in der Shell ausgeführt. Der Port steht in der Umgebungsvariable SEARXNG_PORT. Beispiel: python -m searx.webapp', bindText('web.searx.command', { placeholder: 'python -m searx.webapp' })));
      wrap.append(
        frow('Mit der App beenden', 'Aus: Der Dienst läuft nach dem Schließen der App weiter.', bindSwitch('web.searx.stopOnQuit')),
        frow('Dienst', null, el('div', { class: 'row-gap' },
          el('button', { class: 'btn sm', text: 'Starten', onclick: async () => { await owSearxStart(false); showStatus(); } }),
          el('button', { class: 'btn sm', text: 'Stoppen', onclick: async () => { try { await api.searx.stop(); } catch {} showStatus(); } }),
          el('button', { class: 'btn sm', text: 'Status prüfen', onclick: showStatus }))),
        st
      );
      showStatus();
    }
    wrap.append(
      frow('Anzahl Treffer', null, bindNumber('web.results', { min: 1, max: 10, placeholder: '5' })),
      frow('Suchsprache und Region', 'Kürzel wie de, en, fr oder all', bindText('web.lang', { placeholder: 'de' })),
      frow('Verbindung prüfen', null, test),
      out,
      el('div', { class: 'tr-warn', text: 'Datenschutz: Der Suchtext, den die KI wählt, geht an den gewählten Anbieter, samt Schlüssel-Konto und IP-Adresse dieses Rechners. Das Abrufen einzelner Seiten (fetch_url) fragt immer nach, außer du wählst „Nichts bestätigen“.' }),
      el('h3', { text: 'Vorlesen' }),
      frow('Sprechgeschwindigkeit', 'Gilt für den Knopf „Vorlesen“ unter den Antworten (Stimme des Systems).', bindSlider('tts.rate', 0.6, 1.8, 0.1))
    );
  }
  ensureObj(S.settings, 'tts', { rate: 1 });
  render();
  return wrap;
}
