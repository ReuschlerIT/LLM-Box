'use strict';
/* ═════════════ Strata-Chats importieren ═════════════
   Die Strata-Weboberfläche speichert ihre Chats nur im Browser (IndexedDB / localStorage), nicht auf dem Server.
   LLM Box kann sie deshalb nicht direkt vom Server abrufen. Ablauf:
   1. Ein kleines Skript in der Browser-Konsole der Strata-Seite exportiert die Chats als strata-chats.json.
   2. LLM Box liest die Datei, erkennt die Unterhaltungen (ohne feste Annahme über das Datenformat) und legt sie als Chats an.
   Mehrfaches Importieren ist ungefährlich: bereits übernommene Chats werden erkannt und übersprungen. */

const STRATA_EXPORT_SNIPPET = `(async () => {
  const out = { localStorage: {}, indexedDB: {} };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!/strata/i.test(k)) continue;
    try { out.localStorage[k] = JSON.parse(localStorage.getItem(k)); } catch { out.localStorage[k] = localStorage.getItem(k); }
  }
  const dbs = indexedDB.databases ? await indexedDB.databases() : [];
  for (const info of dbs) {
    await new Promise((done) => {
      const rq = indexedDB.open(info.name);
      rq.onerror = () => done();
      rq.onsuccess = () => {
        const db = rq.result, names = [...db.objectStoreNames];
        out.indexedDB[info.name] = {};
        if (!names.length) { db.close(); return done(); }
        let left = names.length;
        const fin = () => { if (--left === 0) { db.close(); done(); } };
        const tx = db.transaction(names, 'readonly');
        tx.onerror = () => done();
        for (const n of names) {
          const g = tx.objectStore(n).getAll();
          g.onsuccess = () => { out.indexedDB[info.name][n] = g.result; fin(); };
          g.onerror = fin;
        }
      };
    });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = 'strata-chats.json';
  a.click();
})();`;

/* ───── Auswertung ───── */
const ST_ROLE = { user: 'user', human: 'user', assistant: 'assistant', ai: 'assistant', bot: 'assistant', model: 'assistant' };

function stText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p && (p.type === 'text' || p.text) ? String(p.text || '') : '')).filter(Boolean).join('\n');
  if (c && typeof c === 'object') return String(c.text || c.content || '');
  return '';
}
function stNames(m) {
  const out = [];
  for (const k of ['images', 'files', 'attachments', 'pictures']) {
    if (!Array.isArray(m[k])) continue;
    for (const x of m[k]) {
      const n = typeof x === 'string' ? (x.startsWith('data:') ? '' : x) : x && (x.name || x.filename || x.fileName);
      if (n) out.push(String(n));
    }
  }
  return out;
}
const stIsMsg = (m) => m && typeof m === 'object' && !Array.isArray(m) && ST_ROLE[String(m.role || '').toLowerCase()] && (m.content !== undefined || m.text !== undefined);
const stIsMsgArray = (a) => Array.isArray(a) && a.length > 0 && a.filter(stIsMsg).length >= Math.max(1, Math.ceil(a.length * 0.6));

function stTime(v) {
  const n = typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? +v : v;
  if (typeof n === 'number' && isFinite(n) && n > 0) return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
  if (typeof n === 'string') { const t = Date.parse(n); if (!isNaN(t)) return t; }
  return 0;
}

function stConvert(msgs, baseTime) {
  const out = [];
  let t = baseTime;
  for (const m of msgs) {
    if (!stIsMsg(m)) continue;
    const role = ST_ROLE[String(m.role).toLowerCase()];
    let content = stText(m.content !== undefined ? m.content : m.text);
    let thinking = '';
    for (const k of ['reasoning_content', 'reasoning', 'thinking', 'think']) if (typeof m[k] === 'string' && m[k].trim()) { thinking = m[k]; break; }
    content = content.replace(/<think>([\s\S]*?)<\/think>\s*/gi, (_x, g) => { thinking += (thinking ? '\n' : '') + g.trim(); return ''; });
    const names = stNames(m);
    if (names.length) content += (content ? '\n\n' : '') + names.map((n) => `[Anhang: ${n}]`).join('\n');
    if (!content.trim() && !thinking.trim()) continue;
    const ts = stTime(m.time || m.ts || m.timestamp || m.created || m.createdAt) || (t += 1000);
    const msg = { id: uid(), role, content: content.trim(), ts };
    if (role === 'assistant') { msg.thinking = thinking.trim(); msg.toolCalls = []; msg.model = 'Strata'; }
    out.push(msg);
  }
  return out;
}

// Findet alle Unterhaltungen beliebig tief im JSON.
function stFindChats(root) {
  const metas = new Map();
  const found = [];
  const seen = new Set();
  const parseStr = (v) => {
    if (typeof v !== 'string' || v.length < 4 || v.length > 50e6) return v;
    const c = v.trimStart()[0];
    if (c !== '[' && c !== '{') return v;
    try { return JSON.parse(v); } catch { return v; }
  };
  // 1. Durchgang: Titel und Zeiten aus Listen wie strata.chats [{id,title,time}]
  const metaWalk = (n, d) => {
    n = parseStr(n);
    if (!n || typeof n !== 'object' || d > 8 || seen.has(n)) return;
    seen.add(n);
    if (!Array.isArray(n) && n.id !== undefined && typeof n.title === 'string' && !Array.isArray(n.messages) && !n.role) metas.set(String(n.id), n);
    for (const v of Array.isArray(n) ? n : Object.values(n)) metaWalk(v, d + 1);
  };
  metaWalk(root, 0);
  seen.clear();
  // 2. Durchgang: Nachrichten-Listen
  const walk = (n, key, d) => {
    n = parseStr(n);
    if (!n || typeof n !== 'object' || d > 9 || seen.has(n)) return;
    seen.add(n);
    if (stIsMsgArray(n)) {
      const m = /([^.:/\\]+)$/.exec(String(key || ''));
      found.push({ messages: n, id: m ? m[1] : '', keyHint: String(key || '') });
      return;
    }
    if (!Array.isArray(n) && stIsMsgArray(parseStr(n.messages))) {
      found.push({ messages: parseStr(n.messages), id: n.id !== undefined ? String(n.id) : '', meta: n, keyHint: String(key || '') });
      return;
    }
    if (Array.isArray(n)) n.forEach((v, i) => walk(v, key, d + 1));
    else for (const [k, v] of Object.entries(n)) walk(v, k, d + 1);
  };
  walk(root, '', 0);

  const res = [];
  const keys = new Set();
  for (const f of found) {
    const meta = f.meta || metas.get(f.id) || null;
    const msgs = f.messages;
    const firstUser = msgs.find((m) => stIsMsg(m) && ST_ROLE[String(m.role).toLowerCase()] === 'user');
    const fallbackTitle = firstUser ? stText(firstUser.content !== undefined ? firstUser.content : firstUser.text).replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    const title = (meta && meta.title) || fallbackTitle || 'Strata-Chat';
    const created = stTime(meta && (meta.created || meta.time || meta.updated)) || stTime(msgs[0] && (msgs[0].time || msgs[0].ts || msgs[0].timestamp)) || Date.now();
    const converted = stConvert(msgs, created);
    if (!converted.length) continue;
    const sig = converted.slice(0, 3).map((m) => m.role[0] + ':' + m.content.slice(0, 200)).join('|') + '#' + converted.length;
    let h = 5381;
    for (let i = 0; i < sig.length; i++) h = ((h * 33) ^ sig.charCodeAt(i)) >>> 0;
    const importKey = 'strata:' + h.toString(36);
    if (keys.has(importKey)) continue; // dieselbe Unterhaltung mehrfach in der Datei (z. B. localStorage + IndexedDB)
    keys.add(importKey);
    res.push({ title, created, updated: converted[converted.length - 1].ts || created, messages: converted, importKey });
  }
  return res.sort((a, b) => b.updated - a.updated);
}

/* ───── Oberfläche ───── */
function initStrataImport() {
  const b = $('#btn-import');
  if (!b) return;
  b.innerHTML = icon('upload', 17);
  b.addEventListener('click', openStrataImport);
}

function openStrataImport() {
  const status = el('div', { class: 'fhint', style: { marginTop: '8px' } });
  const list = el('div', { class: 'imp-list' });
  let candidates = [];
  const code = el('textarea', { class: 'imp-code', readonly: 'readonly', spellcheck: 'false' });
  code.value = STRATA_EXPORT_SNIPPET;
  const copy = el('button', { class: 'btn sm', text: 'Skript kopieren', onclick: async () => {
    try { await navigator.clipboard.writeText(STRATA_EXPORT_SNIPPET); toast('Skript kopiert.'); } catch { code.select(); document.execCommand('copy'); toast('Skript kopiert.'); }
  } });

  const body = el('div', {},
    el('div', { class: 'fhint', style: { marginBottom: '10px' }, text: 'Die Strata-Weboberfläche speichert ihre Chats nur im Browser, nicht auf dem Server. Deshalb braucht es einmalig diesen Export:' }),
    el('ol', { class: 'imp-steps' },
      el('li', { text: 'Strata-Seite im Browser öffnen (dort, wo du die Chats geführt hast, z. B. http://127.0.0.1:8080).' }),
      el('li', { text: 'F12 drücken, Reiter „Konsole“ öffnen, das Skript unten einfügen und Enter drücken. (Chrome/Edge verlangen davor, einmal „allow pasting“ zu tippen.)' }),
      el('li', { text: 'Es wird die Datei strata-chats.json heruntergeladen. Hier „Datei wählen“ und die Datei auswählen.' })
    ),
    code,
    el('div', { class: 'row-gap', style: { marginTop: '8px' } }, copy),
    status,
    list
  );

  let dlg;
  const renderList = () => {
    list.innerHTML = '';
    for (const c of candidates) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !c.dup;
      cb.disabled = c.dup;
      c.cb = cb;
      list.append(el('label', {}, cb, el('span', { text: c.title }), el('small', { text: (c.dup ? 'bereits importiert · ' : '') + `${c.messages.length} Nachr. · ${new Date(c.updated).toLocaleDateString('de-DE')}` })));
    }
  };
  const pick = async () => {
    const files = await api.chats.importPick();
    if (!files) return;
    const found = [];
    const errs = [];
    for (const f of files) {
      if (f.error) { errs.push(`${f.name}: ${f.error}`); continue; }
      try { found.push(...stFindChats(JSON.parse(f.text))); } catch (e) { errs.push(`${f.name}: keine gültige JSON-Datei`); }
    }
    const seenKeys = new Set();
    candidates = found.filter((c) => (seenKeys.has(c.importKey) ? false : seenKeys.add(c.importKey)));
    for (const c of candidates) c.dup = S.chatList.some((x) => x.importKey === c.importKey);
    renderList();
    status.textContent = candidates.length
      ? `${candidates.length} Unterhaltung(en) gefunden. Haken entfernen, was nicht übernommen werden soll.` + (errs.length ? ' Probleme: ' + errs.join('; ') : '')
      : 'Keine Unterhaltungen gefunden.' + (errs.length ? ' ' + errs.join('; ') : ' Prüfe, ob das Skript auf der Seite mit den Chats ausgeführt wurde. Die Strata-Weboberfläche muss „Chat-Verlauf“ aktiv haben, sonst gibt es nur den zuletzt geführten Chat.');
    importBtn.disabled = !candidates.some((c) => !c.dup);
  };
  const doImport = async () => {
    const chosen = candidates.filter((c) => c.cb && c.cb.checked && !c.dup);
    if (!chosen.length) return;
    const conn = activeConn();
    for (const c of chosen) {
      const chat = { id: uid(), title: c.title, created: c.created, updated: c.updated, connectionId: conn.id, model: S.settings.model, messages: c.messages, source: 'strata', importKey: c.importKey };
      const meta = { id: chat.id, title: chat.title, created: chat.created, updated: chat.updated, model: chat.model, tokens: 0, source: 'strata', importKey: c.importKey };
      await api.chats.save(chat, meta);
    }
    await loadChatList();
    toast(`${chosen.length} Chat(s) importiert.`);
    dlg.close();
  };
  const importBtn = el('button', { class: 'btn primary', text: 'Auswahl importieren', onclick: doImport });
  importBtn.disabled = true;
  dlg = openModal({
    title: 'Strata-Chats importieren',
    body,
    wide: true,
    buttons: [{ label: 'Schließen', value: null }, { label: 'Datei wählen …', onClick: () => { pick(); } }],
  });
  const foot = dlg.el.querySelector('.modal-foot');
  if (foot) foot.append(importBtn);
}
