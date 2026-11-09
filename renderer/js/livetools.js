'use strict';
/* ═════════════ Live-Werkzeuge & Mitscrollen ═════════════
   1) Mitscrollen: Felder mit wachsendem Text (Gedankengang, Programm-Ausgabe, Unteragent) laufen automatisch
      nach unten. Scrollt der Nutzer nach oben, bleibt die Ansicht stehen. Ist er wieder ganz unten, läuft sie weiter mit.
   2) Live-Karten: Sobald die KI ein Werkzeug startet (PowerShell, Befehle, Installation, Unteragent, …), erscheint im Chat
      sofort eine Karte mit Status („wartet auf Freigabe“, „läuft seit 12 s“, „wartet auf Ausgabe“) und der Live-Ausgabe.
      Nach dem Ende wird sie durch die normale, zugeklappte Werkzeug-Karte ersetzt. */

/* ───── Mitscrollen ───── */
const FOLLOW_GAP = 24; // so nah am Ende gilt „ganz unten“

function followAttach(box) {
  if (box._fol) return box;
  box._fol = true;
  box._follow = true;
  box._top = 0;
  box.addEventListener('scroll', () => {
    if (box.clientHeight <= 0) return; // zugeklappt oder ausgeblendet: Zustand nicht verändern
    box._follow = box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_GAP;
    box._top = box.scrollTop;
  }, { passive: true });
  // Mausrad nach oben = der Nutzer will lesen, sofort nicht mehr mitscrollen
  box.addEventListener('wheel', (e) => {
    if (e.deltaY < 0 && box.scrollHeight > box.clientHeight) box._follow = false;
  }, { passive: true });
  return box;
}

/* Stellt die Position wieder her: unten bleiben oder die vom Nutzer gewählte Stelle halten */
function followApply(box) {
  if (!box._fol || box.clientHeight <= 0) return;
  if (box._follow) box.scrollTop = box.scrollHeight;
  else if (Math.abs(box.scrollTop - box._top) > 1) box.scrollTop = box._top;
}

/* Text setzen und dabei die Scroll-Regel einhalten */
function followSet(box, text) {
  followAttach(box);
  if (box._txt !== text) {
    box._txt = text;
    box.textContent = text;
  }
  followApply(box);
}

/* ───── Live-Karten im Chat ───── */
const TL = { cards: new Map(), timer: null };
const TL_CAP = 60000; // so viel Ausgabe bleibt in der Live-Ansicht (der Rest wird vorn abgeschnitten)
const TL_IDLE = 5; // Sekunden ohne neue Ausgabe, ab denen „wartet auf Ausgabe“ angezeigt wird

function tlDur(s) {
  s = Math.max(0, Math.floor(s));
  return s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
}

/* Fügt Programm-Ausgabe an. Ein einzelnes \r (Fortschrittsbalken) überschreibt die aktuelle Zeile. */
function tlJoin(buf, chunk) {
  chunk = String(chunk).replace(/\r\n/g, '\n');
  if (chunk.indexOf('\r') < 0) return buf + chunk;
  for (const c of chunk) {
    if (c === '\r') buf = buf.slice(0, buf.lastIndexOf('\n') + 1);
    else buf += c;
  }
  return buf;
}

function tlStart(tc) {
  if (!tc || tc.name === 'propose_new_session' || TL.cards.has(tc.id)) return null;
  const a = tc.args || {};
  const raw = a.path || a.query || a.label || a.command || a.package || a.name || a.task;
  const arg = raw ? ' · ' + String(raw).replace(/\s+/g, ' ').slice(0, 90) : '';
  const kind = tc.name === 'run_command' || tc.name === 'install_tool' ? 'exec' : tc.name === 'delegate_task' ? 'agent' : 'plain';
  const c = { tc, kind, state: 'queued', t0: 0, tOut: 0, buf: '', cut: false, execId: null, timeout: 0, act: '' };
  c.status = el('span', { class: 'tl-status' });
  c.head = el('div', { class: 'tl-head hidden' });
  c.out = el('pre', { class: 'tl-out' });
  c.empty = el('div', { class: 'tl-empty', text: '' });
  c.inner = el('div', { class: 'inner tl-inner' }, c.head, c.out, c.empty);
  followAttach(c.inner);
  if (kind === 'exec') {
    c.stop = el('button', { class: 'tl-stop', text: 'Stopp', title: 'Dieses Programm beenden', onclick: (e) => { e.preventDefault(); e.stopPropagation(); if (c.execId) api.sys.abort(c.execId); } });
  }
  c.node = el('details', { class: 'tool running tl-live tl-' + kind },
    el('summary', {}, el('span', { class: 'chev', html: icon('chevron', 14) }), el('span', { class: 'ag-spin tl-spin' }), el('span', { class: 'tl-name', text: (TOOL_LABEL[tc.name] || tc.name) + arg }), el('span', { class: 'tl-right' }, c.status, c.stop || null)),
    c.inner);
  c.node.open = kind !== 'plain'; // Programme und Unteragenten sofort offen, damit man zusehen kann
  c.node.addEventListener('toggle', () => followApply(c.inner));
  TL.cards.set(tc.id, c);
  $('#messages-inner').append(c.node);
  if (S.stick) scrollBottom();
  tlPaint(c);
  if (!TL.timer) TL.timer = setInterval(tlTick, 500);
  return c;
}

function tlTick() {
  if (!TL.cards.size) { clearInterval(TL.timer); TL.timer = null; return; }
  for (const c of TL.cards.values()) tlPaint(c);
}

function tlPaint(c) {
  const now = Date.now();
  let txt = '';
  let idle = false;
  if (c.state === 'queued') txt = 'in der Warteschlange';
  else if (c.state === 'approval') txt = 'wartet auf deine Freigabe';
  else {
    const run = (now - c.t0) / 1000;
    if (c.kind === 'exec') {
      const quiet = c.tOut ? (now - c.tOut) / 1000 : run;
      idle = quiet >= TL_IDLE;
      txt = `läuft seit ${tlDur(run)}`;
      txt += !c.tOut ? (idle ? ' · wartet auf erste Ausgabe' : ' · noch keine Ausgabe') : idle ? ` · wartet auf Ausgabe (seit ${tlDur(quiet)} nichts Neues)` : ' · Ausgabe läuft';
      if (c.timeout) txt += ` · Zeitlimit in ${tlDur(Math.max(0, c.timeout - run))}`;
    } else if (c.kind === 'agent') txt = `arbeitet seit ${tlDur(run)}` + (c.act ? ' · ' + c.act : '');
    else txt = `läuft seit ${tlDur(run)}`;
  }
  if (c.status.textContent !== txt) c.status.textContent = txt;
  c.node.classList.toggle('idle', idle);
  c.node.classList.toggle('waiting', c.state === 'approval' || c.state === 'queued');
  const hint = c.state === 'running' && !c.buf && c.kind === 'exec' ? 'Noch keine Ausgabe vom Programm.' : '';
  if (c.empty.textContent !== hint) c.empty.textContent = hint;
  c.empty.classList.toggle('hidden', !hint);
}

function tlState(id, state) {
  const c = TL.cards.get(id);
  if (!c) return;
  const prev = c.state;
  c.state = state;
  if (state === 'running' && (!c.t0 || prev === 'approval')) c.t0 = Date.now(); // Wartezeit auf die Freigabe zählt nicht zur Laufzeit
  tlPaint(c);
}

/* Zeile mit dem Befehl, die über der Ausgabe steht */
function tlHead(id, text) {
  const c = TL.cards.get(id);
  if (!c) return;
  c.head.textContent = text;
  c.head.classList.toggle('hidden', !text);
}

function tlExec(id, execId, timeout) {
  const c = TL.cards.get(id);
  if (c) { c.execId = execId; c.timeout = timeout || 0; c.tOut = 0; tlPaint(c); }
}

function tlAct(id, text) {
  const c = TL.cards.get(id);
  if (c && c.act !== text) c.act = text;
}

function tlShow(c) {
  c.out.classList.toggle('hidden', !c.buf);
  const t = c.cut ? '[… früherer Teil ausgeblendet]\n' + c.buf : c.buf;
  if (c.out._txt !== t) { c.out._txt = t; c.out.textContent = t; }
  // Das Feld, das tatsächlich scrollt, ist .inner (max-height): dort gilt die Mitscroll-Regel
  followApply(c.inner);
  tlPaint(c);
  if (S.stick) scrollBottom();
}

/* Programm-Ausgabe (stdout und stderr) anhängen */
function tlAppend(id, chunk) {
  const c = TL.cards.get(id);
  if (!c || !chunk) return;
  c.buf = tlJoin(c.buf, chunk);
  if (c.buf.length > TL_CAP) { c.buf = c.buf.slice(c.buf.length - Math.floor(TL_CAP * 0.8)); c.cut = true; }
  c.tOut = Date.now();
  tlShow(c);
}

/* Gesamten Text ersetzen (Unteragent) */
function tlSetText(id, text) {
  const c = TL.cards.get(id);
  if (!c) return;
  c.buf = text.length > TL_CAP ? text.slice(text.length - Math.floor(TL_CAP * 0.8)) : text;
  c.cut = text.length > TL_CAP;
  c.tOut = Date.now();
  tlShow(c);
}

/* Fertig: Live-Karte durch die normale Werkzeug-Karte ersetzen (bzw. diese anhängen) */
function tlFinish(id, tm) {
  const c = TL.cards.get(id);
  TL.cards.delete(id);
  const done = toolEl(tm);
  if (c && c.node.isConnected) c.node.replaceWith(done);
  else $('#messages-inner').append(done);
  if (S.stick) scrollBottom();
}

/* Aufräumen, falls ein Lauf abbricht */
function tlClear() {
  for (const c of TL.cards.values()) c.node.remove();
  TL.cards.clear();
}
