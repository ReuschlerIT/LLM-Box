'use strict';
/* ═════════════ Kontext leeren / Neue Session mit Übergabe ═════════════
   - Bevorzugt (Einstellung „Bei vollem Kontext bevorzugen“, Standard): „Kontext leeren“. Der Chat bleibt derselbe, der alte Verlauf
     bleibt sichtbar (gedämpft), wird der KI aber nicht mehr gesendet (chat.ctxStart). Die Übergabe steht als erste Nachricht danach.
   - Fallback: neue Session (neuer Chat), wenn Leeren nicht möglich ist oder so eingestellt wurde.
   - Die KI kann „propose_new_session“ aufrufen: Im Chat erscheint eine Karte mit Schaltfläche.
   - Die App zeigt außerdem einen Hinweis, wenn der Kontext knapp wird oder die KI im Text eine neue Session empfiehlt.
   - Ein Klick öffnet einen neuen Chat und übergibt automatisch: Ziel, Stand, geänderte Dateien,
     Ergebnisse der Unteragenten, nächster Schritt. Die Zusammenfassung stammt von der KI. */

const HO_RE = /\b(neue[nr]?\s+(session|sitzung|chat)|(session|sitzung|chat)\s+(neu\s+)?(öffnen|starten))\b/i;
const HO_DISMISS = new Set();
let hoBusy = false;

const hoOn = () => S.settings.workspace.handoff !== false;
const hoMode = () => (S.settings.workspace.handoffMode === 'new' ? 'new' : 'clear');
// Leeren geht nicht, wenn auf einem anderen Rechner gearbeitet wird oder es nach der letzten Grenze nichts zu leeren gibt
const hoCanClear = (chat) => !!chat && !remoteBusy(chat) && chat.messages.length - ctxStart(chat) >= 2;
const hoPct = () => Math.min(95, Math.max(30, +S.settings.workspace.handoffPct || 70));

function hoRatio(chat) {
  const max = +S.settings.params.numCtx || 0;
  const last = chat.messages.slice(ctxStart(chat)).reverse().find((m) => m.role === 'assistant' && m.stats);
  if (!max || !last) return 0;
  return ((last.stats.promptTokens || 0) + (last.stats.completionTokens || 0)) / max;
}

/* Gründe für einen Hinweis über dem Eingabefeld */
function hoReason(chat) {
  if (!hoOn() || !chat || !chat.messages.length || chat.handoffTo) return null;
  const last = chat.messages[chat.messages.length - 1];
  if (last.role === 'tool' && last.name === 'propose_new_session') return null; // dafür gibt es die Karte
  if (HO_DISMISS.has(chat.id + ':' + last.id)) return null;
  if (last.role === 'assistant' && !(last.toolCalls || []).length && HO_RE.test(LLM.splitThink(last.content || '').answer)) return { kind: 'ai', msg: last };
  const r = hoRatio(chat);
  if (r * 100 >= hoPct()) return { kind: 'ctx', ratio: r, msg: last };
  return null;
}

/* Hinweis, den die App an das neueste Werkzeug-Ergebnis hängt, damit die KI selbst eine Übergabe vorschlägt (cache-schonend: nur am Ende) */
function hoModelHint(chat) {
  if (!hoOn()) return '';
  const r = hoRatio(chat);
  if (r * 100 < hoPct()) return '';
  const n = chat.messages.length;
  if (chat.hoHintAt && n - chat.hoHintAt < 10) return '';
  chat.hoHintAt = n;
  return `\n\n[Hinweis der App: Der Kontext ist zu ${Math.round(r * 100)} % gefüllt. Schließe den aktuellen Teilschritt ab und rufe dann propose_new_session auf, mit einer vollständigen Übergabe in summary und dem nächsten Schritt in next_steps (die App leert damit den Kontext oder öffnet eine neue Session). Arbeite nicht endlos weiter.]`;
}

function hoFiles(chat) {
  const map = new Map();
  for (const m of chat.messages) {
    if (m.role !== 'tool' || m.ok === false || !['edit_file', 'write_file'].includes(m.name) || !(m.args && m.args.path)) continue;
    const e = map.get(m.args.path) || { edit: 0, write: 0 };
    e[m.name === 'edit_file' ? 'edit' : 'write']++;
    map.set(m.args.path, e);
  }
  return [...map].map(([p, e]) => `- ${p} (${[e.edit && `${e.edit}× geändert`, e.write && `${e.write}× geschrieben`].filter(Boolean).join(', ')})`);
}

function hoCompose(chat, { summary, next, same }) {
  const cut = (t, n) => (t.length > n ? t.slice(0, n) + ' […]' : t);
  const firstUser = chat.messages.find((m) => m.role === 'user' && m.content);
  const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user' && m.content && !m.handoff);
  const subs = (chat.subagents || []).filter((r) => r.status === 'done' && r.result);
  const files = hoFiles(chat);
  const parts = [
    `# Übergabe aus der vorherigen Sitzung`,
    same
      ? `Der bisherige Verlauf dieses Chats wurde aus deinem Kontext entfernt, weil das Kontextfenster voll war. Du siehst ihn nicht mehr. Alles Wichtige steht hier. Lies Dateien nur gezielt nach (search_text, dann read_file mit start_line/end_line) und ändere sie mit edit_file.`
      : `Du setzt eine Arbeit fort, die in der Sitzung „${chat.title}“ begonnen wurde. Dort war der Kontext voll. Alles Wichtige steht hier. Lies Dateien nur gezielt nach (search_text, dann read_file mit start_line/end_line) und ändere sie mit edit_file.`,
    firstUser ? `## Ursprüngliches Ziel\n${cut(firstUser.content, 1500)}` : '',
    summary ? `## Stand laut vorheriger Sitzung\n${cut(summary, 7000)}` : '',
    files.length ? `## Geänderte Dateien (automatisch erfasst)\n${files.join('\n')}\nDiese Änderungen sind bereits umgesetzt, mache sie nicht doppelt.` : '',
    subs.length ? `## Ergebnisse von Unteragenten\n${subs.slice(-5).map((r) => `- „${r.label}“: ${cut(r.result.replace(/\s+/g, ' '), 900)}`).join('\n')}` : '',
    next ? `## Nächster Schritt\n${cut(next, 2000)}` : '',
    lastUser ? `## Letzte Anweisung des Nutzers\n${cut(lastUser.content, 600)}` : '',
    `## Arbeitsweise\nBestätige kurz in einem Satz, was du verstanden hast, und setze dann mit dem nächsten Schritt fort. Erfinde nichts, was hier nicht steht oder was du nicht gelesen hast.`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

/* Lässt das Modell die Übergabe schreiben (wenn die KI sie nicht schon geliefert hat) */
async function hoGenerate(chat) {
  const conn = activeConn();
  const model = currentModel();
  const msgs = chat.messages.slice(ctxStart(chat)).filter((m) => !m.error);
  while (msgs.length && msgs[msgs.length - 1].role === 'assistant' && (msgs[msgs.length - 1].toolCalls || []).length) msgs.pop(); // unvollständiger Werkzeugaufruf am Ende
  msgs.push({ role: 'user', content: 'Schreibe jetzt eine Übergabe für eine neue Sitzung, die ohne diesen Verlauf weiterarbeiten muss. Gliederung: Ziel · Erledigt (mit Dateipfaden und Funktionsnamen) · Wichtige Entscheidungen und Fakten · Offene Punkte · Nächster Schritt. Nur Dinge aus dem Verlauf, nichts erfinden, höchstens 500 Wörter. Keine Werkzeuge verwenden.' });
  const sys = buildSystem();
  const cmp = compactMessages(msgs, sys);
  const run = LLM.streamChat({ conn, model, system: sys, messages: cmp.messages, params: S.settings.params, tools: null, thinkLevel: S.settings.thinking, handlers: {} });
  const res = await run.promise;
  let text = LLM.splitThink(res.content || '').answer.trim();
  if (!text) throw new Error('Das Modell hat keine Übergabe geliefert.');
  return text;
}

/* Kontext leeren (gleicher Chat) oder neue Session (neuer Chat) mit Übergabe.
   mode: 'clear' | 'new' (ohne Angabe: Einstellung). srcMsg: Werkzeug-Nachricht der Karte (optional) */
async function hoStart({ summary, next, srcMsg, mode } = {}) {
  if (hoBusy) return;
  if (S.generating) return toast('Bitte erst die Antwort stoppen.');
  const old = S.chat;
  if (!old || !old.messages.length) return;
  if (!currentModel()) return toast('Bitte zuerst ein Modell wählen.');
  let how = mode || hoMode();
  if (how === 'clear' && !hoCanClear(old)) {
    if (mode === 'clear') toast('Kontext leeren ist hier nicht möglich (es gibt nichts zu leeren oder ein anderer Rechner arbeitet). Es wird eine neue Session geöffnet.', 5000);
    how = 'new';
  }
  hoBusy = true;
  hoRefresh();
  try {
    if (!summary) {
      const r = hoReason(old);
      if (r && r.kind === 'ai') summary = LLM.splitThink(r.msg.content || '').answer;
      else {
        toast('Übergabe wird erstellt …', 3000);
        summary = await hoGenerate(old);
      }
    }
    const text = hoCompose(old, { summary, next, same: how === 'clear' });
    let chat;
    if (how === 'clear') {
      // Gleicher Chat: Grenze setzen. Alles davor bleibt sichtbar, geht aber nicht mehr an die KI.
      chat = old;
      chat.ctxStart = chat.messages.length;
      chat.hoHintAt = 0;
      chat.pendingContinue = false;
      if (srcMsg) srcMsg.cleared = true;
      S.warnedOver = null;
      await saveChatNow();
    } else {
      chat = { id: uid(), title: 'Fortsetzung: ' + old.title.replace(/^Fortsetzung:\s*/, '').slice(0, 40), created: Date.now(), updated: Date.now(), connectionId: activeConn().id, model: S.settings.model, messages: [], handoffFrom: old.id, perm: old.perm ? JSON.parse(JSON.stringify(old.perm)) : undefined };
      old.handoffTo = chat.id;
      if (srcMsg) srcMsg.handoffTo = chat.id;
      await saveChatNow(); // speichert den alten Chat (S.chat ist noch der alte)
      S.chat = chat;
    }
    S.attachments = [];
    renderAll();
    const ta = $('#input');
    ta.value = text;
    autosize();
    if (S.settings.workspace.handoffAutoSend !== false) {
      chat.messages.push({ id: uid(), role: 'user', content: text, handoff: true, cleared: how === 'clear' || undefined, ts: Date.now() });
      ta.value = '';
      autosize();
      S.stick = true;
      renderMessages();
      updateCtxMeter();
      saveChatNow();
      await generate();
    } else {
      renderMessages();
      updateCtxMeter();
      toast('Übergabe eingefügt. Prüfe sie und sende mit Enter.', 5000);
      ta.focus();
    }
  } catch (e) {
    toast('Übergabe fehlgeschlagen: ' + e.message, 6000);
  } finally {
    hoBusy = false;
    hoRefresh();
  }
}

function hoRefresh() {
  const b = $('#btn-handoff');
  if (b) {
    const clear = hoMode() === 'clear';
    b.disabled = hoBusy;
    b.classList.toggle('hidden', !hoOn());
    b.innerHTML = icon(clear ? 'eraser' : 'handoff', 17);
    b.title = clear ? 'Kontext leeren: Übergabe wird erstellt, der Chat bleibt (Umschalt+Klick: neue Session)' : 'Neue Session mit Übergabe starten (Umschalt+Klick: Kontext leeren)';
  }
  $$('.handoff-go').forEach((x) => { x.disabled = hoBusy || S.generating; x.textContent = hoBusy ? 'Übergabe wird erstellt …' : x.dataset.label; });
}

/* Die zwei Wege als Schaltflächen: der bevorzugte zuerst (hervorgehoben) */
function hoButtons(chat, startOpts) {
  const clearOk = hoCanClear(chat);
  const order = hoMode() === 'clear' && clearOk ? ['clear', 'new'] : clearOk ? ['new', 'clear'] : ['new'];
  const label = { clear: 'Kontext leeren und weiterarbeiten', new: 'Neue Session mit Übergabe starten' };
  const alt = { clear: 'Stattdessen Kontext leeren', new: 'Stattdessen neue Session' };
  return order.map((m, i) => {
    const b = el('button', { class: 'btn sm handoff-go' + (i === 0 ? ' primary' : ''), text: i === 0 ? label[m] : alt[m], onclick: () => hoStart({ ...startOpts, mode: m }) });
    b.dataset.label = i === 0 ? label[m] : alt[m];
    b.title = m === 'clear' ? 'Gleicher Chat: Der alte Verlauf bleibt sichtbar, die KI sieht nur noch die Übergabe.' : 'Öffnet einen neuen Chat und übergibt Ziel, Stand und nächsten Schritt.';
    return b;
  });
}

/* Hinweis über dem Eingabefeld (am Ende der Nachrichtenliste) */
function hoNotice() {
  const r = hoReason(S.chat);
  if (!r) return null;
  const clearFirst = hoMode() === 'clear' && hoCanClear(S.chat);
  const txt = r.kind === 'ai'
    ? (clearFirst ? 'Die KI empfiehlt, mit leerem Kontext weiterzuarbeiten. Die Übergabe wird automatisch mitgegeben, der Chat bleibt derselbe.' : 'Die KI empfiehlt, in einer neuen Session weiterzuarbeiten. Die Übergabe wird automatisch mitgegeben.')
    : (clearFirst ? `Der Kontext ist zu ${Math.round(r.ratio * 100)} % voll. Leere ihn: Ziel, Stand und nächster Schritt bleiben als Übergabe erhalten, der Chat und sein Verlauf bleiben stehen.` : `Der Kontext ist zu ${Math.round(r.ratio * 100)} % voll. Eine neue Session mit Übergabe ist schneller und zuverlässiger.`);
  return el('div', { class: 'notice handoff-notice' }, el('span', { text: txt }),
    ...hoButtons(S.chat, {}),
    el('button', { class: 'btn sm', text: 'Später', onclick: (e) => { HO_DISMISS.add(S.chat.id + ':' + r.msg.id); e.target.closest('.notice').remove(); } }));
}

/* Karte für das Werkzeug propose_new_session */
function hoCard(m) {
  const a = m.args || {};
  const opened = m.handoffTo;
  const done = opened || m.cleared;
  const clearFirst = hoMode() === 'clear' && hoCanClear(S.chat);
  return el('div', { class: 'handoff-card' },
    el('div', { class: 'hc-head' }, el('span', { html: icon(clearFirst ? 'eraser' : 'handoff', 16) }), el('b', { text: clearFirst ? 'Kontext leeren empfohlen' : 'Neue Session empfohlen' })),
    a.reason ? el('div', { class: 'hc-reason', text: a.reason }) : null,
    el('details', {}, el('summary', { text: 'Übergabe ansehen' }), el('pre', { text: [a.summary, a.next_steps && 'Nächster Schritt:\n' + a.next_steps].filter(Boolean).join('\n\n') })),
    el('div', { class: 'hc-actions' },
      ...(done ? [] : hoButtons(S.chat, { summary: a.summary, next: a.next_steps, srcMsg: m })),
      opened ? el('button', { class: 'btn sm', text: 'Zur neuen Session', onclick: () => openChat(opened) }) : null,
      opened ? el('span', { class: 'hc-done', text: 'Bereits geöffnet' }) : null,
      m.cleared ? el('span', { class: 'hc-done', text: 'Kontext wurde geleert' }) : null));
}

function initHandoff() {
  const b = $('#btn-handoff');
  if (!b) return;
  b.addEventListener('click', (e) => hoStart({ mode: e.shiftKey ? (hoMode() === 'clear' ? 'new' : 'clear') : undefined }));
  hoRefresh();
}
