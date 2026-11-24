'use strict';
/* ═════════════ Chat-Menü: Teilen, Herunterladen, Umbenennen … ═════════════
   Ein Menü mit Untermenüs (wie in der Claude-Weboberfläche):
   - oben rechts über dem Chat (Knopf mit den drei Punkten) für den geöffneten Chat
   - Rechtsklick auf einen Chat in der Seitenleiste
   - Knopf „Teilen“ an jeder Nachricht (nur diese Nachricht)
   Herunterladen: JSON, Klartext (.txt), Markdown (.md), PDF. Teilen: Text oder Markdown kopieren, per E-Mail senden. */

(function addIcons() {
  const add = {
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    dots: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    brain: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2Z"/>',
  };
  for (const k of Object.keys(add)) if (!ICONS[k]) ICONS[k] = add[k];
})();

/* ───── Menü mit Untermenüs ───── */
let _tm = null;
function closeTreeMenu() {
  if (!_tm) return;
  for (const m of _tm.els) m.remove();
  document.removeEventListener('mousedown', _tm.outside, true);
  document.removeEventListener('keydown', _tm.esc, true);
  window.removeEventListener('blur', closeTreeMenu);
  window.removeEventListener('resize', closeTreeMenu);
  _tm = null;
}
const treeMenuOpenFor = (anchor) => !!(_tm && _tm.anchor === anchor);

/* anchor: Element (Menü erscheint darunter, rechtsbündig) oder { x, y } (Mausposition). */
function openTreeMenu(anchor, items) {
  closeTreeMenu();
  if (typeof closeMenu === 'function') closeMenu();
  const st = { els: [], subs: [], anchor };
  const isPoint = !anchor.nodeType;

  const place = (m, rect, side) => {
    const w = m.offsetWidth, h = m.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left, top;
    if (side === 'sub') {
      left = rect.right + 4;
      if (left + w > vw - 8) left = rect.left - w - 4;
      left = Math.max(8, left);
      top = Math.min(rect.top - 5, vh - h - 8);
    } else if (isPoint) {
      left = Math.min(anchor.x, vw - w - 8);
      top = Math.min(anchor.y, vh - h - 8);
    } else {
      left = Math.min(rect.right - w, vw - w - 8);
      top = rect.bottom + 6;
      if (top + h > vh - 8) top = Math.max(8, rect.top - h - 6);   // kein Platz unten: darüber öffnen
    }
    m.style.left = Math.max(8, left) + 'px';
    m.style.top = Math.max(8, top) + 'px';
  };

  const closeSubs = (depth) => {
    while (st.subs.length > depth) {
      const s = st.subs.pop();
      s.remove();
      st.els = st.els.filter((x) => x !== s);
    }
  };

  const build = (list, depth) => {
    const m = el('div', { class: 'menu tree-menu', role: 'menu' });
    for (const it of list) {
      if (!it) continue;
      if (it.sep) { m.append(el('div', { class: 'menu-sep', role: 'separator' })); continue; }
      if (it.header) { m.append(el('div', { class: 'menu-head', text: it.header })); continue; }
      const b = el('button', { class: 'menu-item tm-item' + (it.danger ? ' danger' : '') + (it.active ? ' active' : ''), role: 'menuitem', disabled: it.disabled ? true : null },
        el('span', { class: 'tm-ico', html: it.icon ? icon(it.icon, 16) : '' }),
        el('span', { class: 'tm-label', text: it.label }),
        it.active ? el('span', { class: 'mi-check', html: icon('check', 15) }) : null,
        it.sub ? el('span', { class: 'tm-arrow', html: icon('chevron', 14) }) : null);
      const openSub = () => {
        closeSubs(depth);
        if (!it.sub) return;
        const sm = build(it.sub, depth + 1);
        document.body.append(sm);
        st.els.push(sm);
        st.subs.push(sm);
        place(sm, b.getBoundingClientRect(), 'sub');
        b.classList.add('open');
      };
      b.addEventListener('mouseenter', () => {
        for (const x of m.querySelectorAll('.tm-item.open')) if (x !== b) x.classList.remove('open');
        if (it.sub) openSub(); else closeSubs(depth);
      });
      b.addEventListener('click', () => {
        if (it.sub) { if (st.subs.length <= depth) openSub(); return; }
        closeTreeMenu();
        if (it.onClick) it.onClick();
      });
      m.append(b);
    }
    return m;
  };

  const root = build(items, 0);
  document.body.append(root);
  st.els.push(root);
  place(root, isPoint ? null : anchor.getBoundingClientRect(), 'root');

  st.outside = (e) => {
    if (st.els.some((x) => x.contains(e.target))) return;
    if (!isPoint && anchor.contains(e.target)) return;   // der Knopf selbst schließt per Klick (siehe treeMenuOpenFor)
    closeTreeMenu();
  };
  st.esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeTreeMenu(); } };
  document.addEventListener('mousedown', st.outside, true);
  document.addEventListener('keydown', st.esc, true);
  window.addEventListener('blur', closeTreeMenu);
  window.addEventListener('resize', closeTreeMenu);
  _tm = st;
}

/* ───── Textfassungen ───── */
const cmSafeName = (s) => String(s || 'chat').replace(/[^\w\- äöüÄÖÜß]/g, '').trim().slice(0, 40) || 'chat';
const cmAnswer = (m) => LLM.splitThink(m.content || '').answer;
const cmEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cmDate = (t) => { try { return new Date(t).toLocaleString(locale()); } catch { return ''; } };

// Markdown → lesbarer Klartext (ohne Auszeichnungen, Code bleibt eingerückt erhalten)
function cmPlainMd(t) {
  return String(t || '')
    .replace(/^```.*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Anhänge: Dateien nur mit Namen, eingefügte Texte (Karte „Eingefügt“) mit vollem Inhalt, denn sie ersetzen getippten Text
const cmFileNames = (m) => (m.files || []).filter((f) => !f.pasted).map((f) => f.name);
const cmPasted = (m) => (m.files || []).filter((f) => f.pasted && f.text).map((f) => f.text);

function chatToPlain(c) {
  const out = [c.title || '', `${cmDate(c.created)}${c.model ? ' · ' + c.model : ''}`, ''];
  for (const m of c.messages || []) {
    if (m.role === 'user') {
      out.push(T('Du') + ':');
      const names = cmFileNames(m);
      if (names.length) out.push('[' + T('Anhang') + ': ' + names.join(', ') + ']');
      for (const p of cmPasted(m)) out.push(p);
      if (m.content) out.push(m.content);
      out.push('');
    } else if (m.role === 'assistant') {
      const a = cmAnswer(m);
      if (!a && !m.error) continue;
      out.push(T('Assistent') + (m.model ? ` (${m.model})` : '') + ':');
      out.push(a ? cmPlainMd(a) : T('Fehler') + ': ' + m.error);
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function cmMsgHtml(m) {
  if (m.role === 'user') {
    const names = cmFileNames(m);
    return `<section class="m u"><h2>${cmEsc(T('Du'))}</h2>`
      + (names.length ? `<p class="files">📎 ${cmEsc(names.join(', '))}</p>` : '')
      + cmPasted(m).map((p) => `<pre>${cmEsc(p)}</pre>`).join('')
      + (m.content ? `<div class="t">${cmEsc(m.content)}</div>` : '') + '</section>';
  }
  if (m.role === 'assistant') {
    const a = cmAnswer(m);
    if (!a && !m.error && !(m.images && m.images.length)) return '';
    let body = '';
    try { body = a ? DOMPurify.sanitize(marked.parse(a)) : ''; } catch { body = `<pre>${cmEsc(a)}</pre>`; }
    const imgs = (m.images || []).map((x) => (typeof x === 'string' ? x : x && (x.dataUrl || x.url)) || '').filter((u) => /^data:image\//.test(u)).map((u) => `<img src="${cmEsc(u)}">`).join('');
    return `<section class="m a"><h2>${cmEsc(T('Assistent') + (m.model ? ` (${m.model})` : ''))}</h2><div class="md">${body}</div>${imgs}`
      + (m.error ? `<p class="err">${cmEsc(m.error)}</p>` : '') + '</section>';
  }
  return '';
}

const CM_PDF_CSS = `
@page { size: A4; margin: 16mm 15mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1b1f2a; margin: 0; }
h1 { font-size: 17pt; margin: 0 0 2pt; }
.sub { color: #6b7280; font-size: 9pt; margin: 0 0 14pt; padding-bottom: 8pt; border-bottom: 1px solid #d8dce6; }
.m { margin: 0 0 12pt; padding: 8pt 11pt; border-radius: 6pt; border: 1px solid #e3e6ee; }
.m.u { background: #f3f5fa; }
.m h2 { font-size: 9pt; margin: 0 0 4pt; text-transform: uppercase; letter-spacing: .05em; color: #5b6478; }
.t { white-space: pre-wrap; word-wrap: break-word; }
.files { margin: 0 0 4pt; color: #5b6478; font-size: 9.5pt; }
pre { background: #f6f7fb; border: 1px solid #e3e6ee; border-radius: 4pt; padding: 7pt 9pt; white-space: pre-wrap; word-wrap: break-word; font-family: Consolas, "Cascadia Mono", monospace; font-size: 9pt; line-height: 1.45; }
code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 9.5pt; background: #f1f3f8; padding: 0 2pt; border-radius: 2pt; }
pre code { background: transparent; padding: 0; }
.md p { margin: 0 0 6pt; } .md ul, .md ol { margin: 0 0 6pt; padding-left: 18pt; }
.md table { border-collapse: collapse; margin: 4pt 0 8pt; } .md th, .md td { border: 1px solid #d8dce6; padding: 3pt 7pt; }
.md blockquote { margin: 4pt 0; padding-left: 9pt; border-left: 3px solid #d0d5e2; color: #4b5468; }
.md img, .m img { max-width: 100%; }
.err { color: #b42318; }
.m, pre, table, blockquote { page-break-inside: avoid; }
.m.a { page-break-inside: auto; }
`;
function cmHtmlDoc(title, sub, inner) {
  return `<!doctype html><html lang="${cmEsc((typeof I18N !== 'undefined' && I18N.lang) || 'de')}"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
    + `<title>${cmEsc(title)}</title><style>${CM_PDF_CSS}</style></head><body><h1>${cmEsc(title)}</h1><p class="sub">${cmEsc(sub)}</p>${inner}</body></html>`;
}

/* ───── Dokumente (Chat oder einzelne Nachricht) ───── */
function cmChatDoc(c) {
  return {
    name: cmSafeName(c.title), title: c.title || 'Chat',
    json: () => JSON.stringify(c, null, 2),
    plain: () => chatToPlain(c),
    md: () => chatToMarkdown(c),
    html: () => cmHtmlDoc(c.title || 'Chat', `${cmDate(c.created)}${c.model ? ' · ' + c.model : ''}`, (c.messages || []).map(cmMsgHtml).join('')),
  };
}
function cmMsgDoc(m, chat) {
  const text = m.role === 'assistant' ? cmAnswer(m) : [...cmPasted(m), m.content || ''].filter(Boolean).join('\n\n');
  const title = (chat && chat.title) || 'Chat';
  return {
    name: cmSafeName(title) + '-' + (m.role === 'assistant' ? 'antwort' : 'nachricht'), title,
    plain: () => (m.role === 'assistant' ? cmPlainMd(text) : text) + '\n',
    md: () => text + '\n',
    html: () => cmHtmlDoc(title, `${cmDate(m.ts)}${m.model ? ' · ' + m.model : ''}`, cmMsgHtml(m)),
  };
}

/* ───── Aktionen ───── */
async function cmSave(doc, kind) {
  try {
    let p = null;
    if (kind === 'pdf') {
      if (!(api.files && api.files.savePdf)) return toast('PDF-Export gibt es in dieser Fassung nicht.');
      const r = await api.files.savePdf({ defaultName: doc.name + '.pdf', html: doc.html() });
      if (r && r.error) return toast('PDF konnte nicht erstellt werden: ' + r.error, 6000);
      p = r && r.path;
    } else {
      const spec = {
        json: { ext: 'json', label: 'JSON', get: doc.json },
        txt: { ext: 'txt', label: 'Text', get: doc.plain },
        md: { ext: 'md', label: 'Markdown', get: doc.md },
      }[kind];
      p = await api.files.saveAs({ defaultName: doc.name + '.' + spec.ext, content: spec.get(), filters: [{ name: spec.label, extensions: [spec.ext] }] });
    }
    if (p) toast('Exportiert: ' + p);
  } catch (e) {
    toast('Export fehlgeschlagen: ' + e.message, 6000);
  }
}

async function cmMail(doc) {
  const full = doc.plain();
  const MAX = 1400;   // mailto-Adressen sind auf etwa 2000 Zeichen begrenzt
  let body = full;
  if (full.length > MAX) {
    body = full.slice(0, MAX).replace(/\s+\S*$/, '') + '\n\n' + T('[… gekürzt – der vollständige Text steht in der Zwischenablage (mit Strg+V einfügen)]');
    try { await navigator.clipboard.writeText(full); } catch {}
  }
  try {
    await api.openExternal('mailto:?subject=' + encodeURIComponent(doc.title) + '&body=' + encodeURIComponent(body));
    toast(full.length > MAX ? 'E-Mail geöffnet. Der vollständige Text liegt in der Zwischenablage.' : 'E-Mail geöffnet.', 4000);
  } catch (e) {
    toast('E-Mail konnte nicht geöffnet werden: ' + e.message, 5000);
  }
}

const cmShareItems = (doc) => [
  { label: 'Als Text kopieren', icon: 'copy', onClick: () => copyText(doc().plain()) },
  { label: 'Als Markdown kopieren', icon: 'file', onClick: () => copyText(doc().md()) },
  { label: 'Per E-Mail senden …', icon: 'mail', onClick: () => cmMail(doc()) },
];

const cmDownloadItems = (doc, withJson) => [
  withJson ? { label: 'Chat exportieren (.json)', onClick: () => cmSave(doc(), 'json') } : null,
  { label: 'Klartext (.txt)', onClick: () => cmSave(doc(), 'txt') },
  { label: 'Markdown (.md)', onClick: () => cmSave(doc(), 'md') },
  api.files && api.files.savePdf ? { label: 'PDF-Dokument (.pdf)', onClick: () => cmSave(doc(), 'pdf') } : null,
].filter(Boolean);

async function cmChatById(id) {
  if (S.chat && S.chat.id === id) return S.chat;
  const R = typeof runById === 'function' ? runById(id) : null;
  if (R) return R.chat;
  try { return await api.chats.load(id); } catch { return null; }
}

/* Chat-Menü für den Chat mit der Kennung id (anchor: Knopf oder Mausposition) */
async function openChatMenu(anchor, id) {
  if (!id) return;
  const chat = await cmChatById(id);
  if (!chat) return;
  const lazy = () => { if (!chat.messages || !chat.messages.length) { toast('Dieser Chat ist noch leer.'); return null; } return cmChatDoc(chat); };
  const getDoc = () => lazy();
  const shareSub = [
    { label: 'Als Text kopieren', icon: 'copy', onClick: () => { const d = getDoc(); if (d) copyText(d.plain()); } },
    { label: 'Als Markdown kopieren', icon: 'file', onClick: () => { const d = getDoc(); if (d) copyText(d.md()); } },
    { label: 'Per E-Mail senden …', icon: 'mail', onClick: () => { const d = getDoc(); if (d) cmMail(d); } },
  ];
  const dl = (kind) => () => { const d = getDoc(); if (d) cmSave(d, kind); };
  const downloadSub = [
    { label: 'Chat exportieren (.json)', onClick: dl('json') },
    { label: 'Klartext (.txt)', onClick: dl('txt') },
    { label: 'Markdown (.md)', onClick: dl('md') },
    api.files && api.files.savePdf ? { label: 'PDF-Dokument (.pdf)', onClick: dl('pdf') } : null,
  ].filter(Boolean);

  const items = [
    { label: 'Teilen', icon: 'share', sub: shareSub },
    { label: 'Herunterladen', icon: 'download', sub: downloadSub },
    { label: 'Umbenennen', icon: 'edit', onClick: () => renameChat(id) },
  ];
  const orgOn = typeof modOn === 'function' && modOn('organize') && typeof owOrg === 'function';
  if (orgOn) {
    const org = owOrg();
    items.push({ sep: true });
    items.push({ label: org.pins[id] ? 'Lösen' : 'Anheften', icon: 'pin', onClick: () => owuiTogglePin(id) });
    items.push({ label: 'Tags …', icon: 'tag', onClick: () => owuiEditTags(id) });
    items.push({ label: org.archived[id] ? 'Aus dem Archiv holen' : 'Archivieren', icon: 'archive', onClick: () => owuiToggleArchive(id) });
  }
  items.push({ sep: true });
  items.push({ label: 'Löschen', icon: 'trash', danger: true, onClick: () => deleteChat(id) });
  openTreeMenu(anchor, items);
}

/* Teilen-Menü einer einzelnen Nachricht */
function openMessageShare(anchor, m) {
  if (treeMenuOpenFor(anchor)) return closeTreeMenu();
  const doc = () => cmMsgDoc(m, S.chat);
  openTreeMenu(anchor, [
    ...cmShareItems(doc),
    { sep: true },
    { label: 'Herunterladen', icon: 'download', sub: cmDownloadItems(doc, false) },
  ]);
}
