'use strict';
/* ═════════════ Gedankengänge als eigenes Dropdown ═════════════
   Einstellung „Gedankengänge anzeigen“: Im Chat (wie bisher, ein Gedankengang je Antwort) oder gesammelt in einem eigenen
   Dropdown. Das Dropdown liegt über dem Eingabefeld, oben im Chatfenster, links, rechts oder frei schwebend (verschiebbar
   und in der Größe änderbar). Es enthält alle Gedankengänge des Chats in der Reihenfolge der Antworten.

   Technik: Die vorhandenen <details class="think">-Elemente (mit Übersetzung, Mitscrollen, Live-Anzeige) werden nur
   umgehängt, nicht neu gebaut. app.js ruft dafür tdMountNew (neuer Gedankengang), tdSync (Antwort läuft weiter),
   tdStub (alte, nur kompakt angezeigte Nachrichten), tdReset und tdRefresh auf.
   Einstellungen: S.settings.thinkDock = { mode: 'inline' | 'dock', pos, open, w, float: { x, y, w, h } }. */

const TD = { el: null, list: null, body: null, older: null, olderIdx: [], olderN: 0, count: 0, numbered: -1, dragged: false, ro: null, saveT: 0 };
const TD_POS = ['composer', 'top', 'left', 'right', 'float'];

function tdCfg() {
  const s = S.settings;
  if (!s.thinkDock || typeof s.thinkDock !== 'object') s.thinkDock = { mode: 'inline', pos: 'composer', open: false };
  return s.thinkDock;
}
const tdMode = () => !!(S && S.settings && tdCfg().mode === 'dock');

function tdEff() {
  const c = tdCfg();
  let pos = TD_POS.includes(c.pos) ? c.pos : 'composer';
  const main = $('#main');
  if ((pos === 'left' || pos === 'right') && main && main.clientWidth < 760) pos = 'composer';   // schmales Fenster: Seitenleiste passt nicht
  return pos;
}

function tdBuild() {
  const d = el('div', { id: 'think-dock', class: 'think-dock hidden' });
  const count = el('span', { class: 'td-count', text: '0' });
  const live = el('span', { class: 'td-live', 'aria-hidden': 'true' });
  const posBtn = el('button', { class: 'mini-btn td-btn', title: 'Position ändern', html: icon('sliders', 14), onclick: (e) => { e.stopPropagation(); tdPosMenu(posBtn); } });
  const offBtn = el('button', { class: 'mini-btn td-btn', title: 'Gedankengänge wieder im Chat anzeigen', html: icon('x', 14), onclick: (e) => { e.stopPropagation(); tdSetMode('inline'); } });
  const head = el('div', { class: 'td-head', role: 'button', tabindex: '0', title: 'Gedankengänge ein- oder ausklappen' },
    el('span', { class: 'td-ico', html: icon('brain', 15) }),
    el('span', { class: 'td-title', text: 'Gedankengänge' }),
    count, live,
    el('span', { class: 'td-sp' }),
    posBtn, offBtn,
    el('span', { class: 'td-chev', html: icon('chevron', 14) }));
  const older = el('div', { class: 'td-older hidden' },
    el('button', { class: 'hint-btn', text: 'Ältere Gedankengänge laden', onclick: tdLoadOlder }),
    el('span', { class: 'td-older-n' }));
  const list = el('div', { class: 'td-list' });
  const body = el('div', { class: 'td-body' }, older, list);
  d.append(el('div', { class: 'td-box' }, head, body));
  TD.el = d; TD.list = list; TD.body = body; TD.older = older; TD.count_ = count;

  head.addEventListener('click', (e) => {
    if (TD.dragged || e.target.closest('button')) return;
    tdSetOpen(!tdCfg().open);
  });
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tdSetOpen(!tdCfg().open); }
  });

  // Frei schwebend: an der Kopfzeile verschieben
  head.addEventListener('pointerdown', (e) => {
    if (tdEff() !== 'float' || e.button !== 0 || e.target.closest('button')) return;
    const main = $('#main');
    const mr = main.getBoundingClientRect();
    const r = d.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, ox = r.left - mr.left, oy = r.top - mr.top;
    let moved = false;
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      TD.dragged = true;
      d.classList.add('dragging');
      d.style.left = Math.max(0, Math.min(ox + dx, mr.width - 90)) + 'px';
      d.style.top = Math.max(0, Math.min(oy + dy, mr.height - 40)) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      d.classList.remove('dragging');
      if (moved) {
        const c = tdCfg();
        c.float = { ...(c.float || {}), x: parseFloat(d.style.left), y: parseFloat(d.style.top) };
        saveSettings();
        setTimeout(() => { TD.dragged = false; }, 0);
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  });

  // Größe des schwebenden Fensters merken
  if (typeof ResizeObserver === 'function') {
    TD.ro = new ResizeObserver(() => {
      if (tdEff() !== 'float' || !tdCfg().open || !d.offsetWidth) return;
      clearTimeout(TD.saveT);
      TD.saveT = setTimeout(() => {
        const c = tdCfg();
        const w = d.offsetWidth, h = d.offsetHeight;
        if (!c.float || Math.abs((c.float.w || 0) - w) > 1 || Math.abs((c.float.h || 0) - h) > 1) { c.float = { ...(c.float || {}), w, h }; saveSettings(); }
      }, 400);
    });
    TD.ro.observe(d);
  }
  window.addEventListener('resize', () => { if (tdMode()) tdApplyLayout(); });
  return d;
}
const tdEl = () => TD.el || tdBuild();

/* ───── Lage und Zustand ───── */
function tdApplyLayout() {
  const main = $('#main');
  if (!main || !S || !S.settings) return;
  const d = tdEl();
  main.classList.remove('td-left-open', 'td-right-open');
  if (!tdMode()) { d.classList.add('hidden'); d.remove(); return; }
  const c = tdCfg();
  const pos = tdEff();
  if (pos === 'top') { const m = $('#messages'); if (d.nextSibling !== m || d.parentNode !== m.parentNode) m.before(d); }
  else if (pos === 'composer') { const w = $('#composer-wrap'); if (d.nextSibling !== w || d.parentNode !== w.parentNode) w.before(d); }
  else if (d.parentNode !== main) main.append(d);
  for (const p of TD_POS) d.classList.toggle('pos-' + p, p === pos);
  d.classList.toggle('open', !!c.open);

  const tb = $('#topbar'), sb = $('#statusbar');
  const w = Math.max(240, Math.min(560, +c.w || 360));
  main.style.setProperty('--td-top', (tb ? tb.offsetHeight : 52) + 'px');
  main.style.setProperty('--td-bottom', (sb ? sb.offsetHeight : 30) + 'px');
  main.style.setProperty('--td-w', w + 'px');
  if (c.open && pos === 'left') main.classList.add('td-left-open');
  if (c.open && pos === 'right') main.classList.add('td-right-open');

  if (pos === 'float') {
    const f = c.float || {};
    const mr = main.getBoundingClientRect();
    const fw = Math.max(260, Math.min(+f.w || 380, mr.width - 20));
    const fh = Math.max(150, Math.min(+f.h || 320, mr.height - 20));
    const x = Math.max(0, Math.min(f.x ?? (mr.width - fw - 24), mr.width - 90));
    const y = Math.max(0, Math.min(f.y ?? 70, mr.height - 40));
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.width = c.open ? fw + 'px' : '';
    d.style.height = c.open ? fh + 'px' : '';
  } else {
    d.style.left = d.style.top = d.style.width = d.style.height = '';
  }
  tdRefresh();
}

function tdSetOpen(open, persist = true) {
  const c = tdCfg();
  c.open = !!open;
  if (persist) saveSettings();
  tdApplyLayout();
  if (open && TD.body) TD.body.scrollTop = TD.body.scrollHeight;
}

function tdSetMode(mode) {
  tdCfg().mode = mode;
  saveSettings();
  tdModeChanged();
}
function tdSetPos(pos) {
  const c = tdCfg();
  c.pos = pos;
  c.mode = 'dock';
  saveSettings();
  tdModeChanged();
}
// Nach Änderung von Modus oder Position (auch aus den Einstellungen): Lage setzen und Nachrichten neu aufbauen
function tdModeChanged() {
  tdApplyLayout();
  if (S.chat && typeof renderMessages === 'function') renderMessages();
}

function tdPosMenu(anchor) {
  if (treeMenuOpenFor(anchor)) return closeTreeMenu();
  const cur = tdCfg().pos;
  const item = (pos, label) => ({ label, active: cur === pos, onClick: () => tdSetPos(pos) });
  openTreeMenu(anchor, [
    { header: 'Position der Gedankengänge' },
    item('composer', 'Über dem Eingabefeld'),
    item('top', 'Oben im Chatfenster'),
    item('left', 'Links'),
    item('right', 'Rechts'),
    item('float', 'Frei schwebend'),
    { sep: true },
    { label: 'Im Chat anzeigen (wie bisher)', onClick: () => tdSetMode('inline') },
  ]);
}

/* ───── Einträge ───── */
const tdThinkOf = (m) => [m.thinking, LLM.splitThink(m.content || '').think].filter(Boolean).join('\n').trim();
const tdMeta = (m) => {
  let t = '';
  try { t = m.ts ? new Date(m.ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : ''; } catch {}
  return [m.model, t].filter(Boolean).join(' · ');
};

function tdItem(head, content) {
  return el('div', { class: 'td-item' }, head, content);
}

function tdJump(node) {
  if (!node || !node.isConnected) return;
  if (S) S.stick = false;
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.classList.add('td-flash');
  setTimeout(() => node.classList.remove('td-flash'), 1400);
}

// Neuer Gedankengang einer Antwort (aus renderAssistantParts)
function tdMountNew(node, r, m, live) {
  if (!tdMode()) { r.think.append(r.thinkEl); return; }
  tdAttach(node, m);
  if (live && S.settings.appearance.thinkOpen && !tdCfg().open) tdSetOpen(true, false);
}

function tdAttach(node, m) {
  const r = node._r;
  if (!r || !r.thinkEl) return;
  let w = node._tdItem;
  if (!w) {
    const h = el('div', { class: 'td-item-h', title: 'Zur Nachricht springen', onclick: () => tdJump(node) },
      el('span', { class: 'td-n' }), el('span', { class: 'td-meta', text: tdMeta(m) }));
    w = tdItem(h, r.thinkEl);
    node._tdItem = w;
  } else if (w.lastChild !== r.thinkEl) w.append(r.thinkEl);
  tdEl();
  TD.list.append(w);
  tdRefresh();
}

// Antwort, die über einen Neuaufbau hinweg weiterläuft: an die Stelle setzen, die zum Modus passt
function tdSync(node, m) {
  const r = node && node._r;
  if (!r || !r.thinkEl) return;
  if (tdMode()) tdAttach(node, m);
  else if (r.thinkEl.parentNode !== r.think) r.think.append(r.thinkEl);
}

// Ältere Nachricht (nur kompakte Zeile): Eintrag mit schreibgeschütztem Text, der erst beim Aufklappen entsteht
function tdStubEl(m, i) {
  const txt = (m.thinkingDe || '').trim() || tdThinkOf(m);
  const inner = el('div', { class: 'inner' });
  const det = el('details', { class: 'think' },
    el('summary', {}, el('span', { class: 'chev', html: icon('chevron', 14) }), el('span', { text: 'Gedankengang' })), inner);
  det.addEventListener('toggle', () => { if (det.open && !inner.firstChild) inner.textContent = txt.length > 60000 ? txt.slice(0, 60000) + '\n\n[… gekürzt]' : txt; });
  const showMsg = () => {
    vollAb = Math.min(vollAb, i + MSG_KOMPAKT);   // Nachricht in den Anzeigebereich holen
    if (i < vollAb) aufgefaltet.add(i);
    renderMessages();
  };
  const h = el('div', { class: 'td-item-h', title: 'Nachricht anzeigen', onclick: showMsg },
    el('span', { class: 'td-n' }), el('span', { class: 'td-meta', text: tdMeta(m) }));
  return tdItem(h, det);
}
function tdStub(m, i) {
  if (!tdMode() || !tdThinkOf(m)) return;
  tdEl();
  TD.list.append(tdStubEl(m, i));
}

// Ältere Gedankengänge (vor dem Anzeigebereich) erst auf Wunsch aufbauen
function tdSetOlder(msgs, von) {
  TD.olderIdx = [];
  if (tdMode()) for (let i = 0; i < von; i++) if (msgs[i].role === 'assistant' && tdThinkOf(msgs[i])) TD.olderIdx.push(i);
  TD.olderN = TD.olderIdx.length;
}
function tdLoadOlder() {
  const msgs = S.chat ? S.chat.messages : [];
  const frag = document.createDocumentFragment();
  for (const i of TD.olderIdx) if (msgs[i]) frag.append(tdStubEl(msgs[i], i));
  TD.olderIdx = [];
  TD.olderN = 0;
  TD.list.prepend(frag);
  tdRefresh();
}

function tdReset() {
  if (!TD.el && !tdMode()) return;
  tdEl();
  TD.list.replaceChildren();
  TD.olderIdx = [];
  TD.olderN = 0;
  TD.numbered = -1;
}

// Zähler, Nummern und Anzeige der Kopfzeile aktualisieren (wird bei jedem Textstück einer laufenden Antwort aufgerufen, daher billig halten)
function tdRefresh() {
  const d = TD.el;
  if (!d) return;
  const mode = tdMode();
  const n = TD.list.children.length;
  const total = n + TD.olderN;
  d.classList.toggle('hidden', !mode || total === 0);
  if (!mode) return;
  if (TD.numbered !== total) {
    TD.numbered = total;
    TD.count_.textContent = String(total);
    let k = TD.olderN;
    for (const x of TD.list.querySelectorAll('.td-n')) x.textContent = '#' + (++k);
    TD.older.classList.toggle('hidden', !TD.olderN);
    TD.older.querySelector('.td-older-n').textContent = TD.olderN ? `(${TD.olderN})` : '';
  }
  d.classList.toggle('busy', !!TD.list.querySelector('details.think.active'));
}
