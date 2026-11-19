'use strict';
/* ═════════════ Autonomer Modus ═════════════
   Die KI arbeitet vollständig selbstständig, auch über Nacht:
   - keine Rückfragen und keine Freigaben (Datei-Werkzeuge, Befehle), dafür Schutzgrenzen (siehe unten),
   - der Kontext wird selbst geleert, wenn er voll wird (Übergabe durch die KI, notfalls durch die App),
   - das Schritt-Limit hält sie nicht an, die App lässt sie weitermachen,
   - Fehler (Netz, Server) werden mit Wartezeit wiederholt,
   - Ende bei: finish_task der KI, Stopp durch den Nutzer, Zeit-, Schritt- oder Leerungs-Limit, erkannter Schleife.
   Der Rechner wird währenddessen wach gehalten (nur Windows-App), am Ende kommt eine Benachrichtigung.
   Zustand pro Chat in chat.auto. Einschalten: Knopf „Autonom“ im Eingabefeld oder Einstellungen → Autonomer Modus. */

const AUTO_DEF = { maxHours: 8, maxSteps: 3000, maxResets: 40, forcePct: 85, retries: 6, keepAwake: true, notify: true, blockDanger: true, allowInstalls: false, useLog: true, verifyFinish: true };
const autoCfg = () => ensureObj(S.settings, 'auto', AUTO_DEF);
/* Wirksame Grenze: Wert für diesen Chat (chat.auto.limits), sonst die Einstellung. Leer oder 0 = keine Grenze. */
function autoLim(chat, key) {
  const o = chat && chat.auto && chat.auto.limits;
  const v = o && o[key] !== undefined && o[key] !== null && o[key] !== '' ? o[key] : autoCfg()[key];
  return +v > 0 ? +v : 0;
}
const autoOn = (chat) => !!(chat && chat.auto && chat.auto.on && typeof modOn === 'function' && modOn('auto'));
function autoState(chat) {
  const A = (chat.auto = chat.auto && typeof chat.auto === 'object' ? chat.auto : {});
  if (typeof A.steps !== 'number') Object.assign(A, { on: false, startedAt: 0, steps: 0, resets: 0, errors: 0, nudges: 0, loopHits: 0, sigs: [], halted: false, finished: null, report: null, retryAt: 0 });
  return A;
}
const AUTO_FINISH_TOOL = { type: 'function', function: { name: 'finish_task', description: 'Beendet den autonomen Lauf. Nur aufrufen, wenn die Aufgabe vollständig erledigt ist und nichts mehr zu tun bleibt.', parameters: { type: 'object', properties: { summary: { type: 'string', description: 'Kurze Zusammenfassung: was wurde erreicht, was ist offen oder nicht gelungen' } }, required: ['summary'] } } };
const AUTO_CONTINUE = 'Weiter (autonomer Modus): Setze die Arbeit mit dem nächsten Schritt fort. Ist alles erledigt, rufe finish_task auf.';
const AUTO_NUDGE = 'Du arbeitest autonom, niemand antwortet auf Rückfragen. Mache mit dem nächsten Schritt weiter (Werkzeug aufrufen). Ist die Aufgabe vollständig erledigt, rufe finish_task mit einer Zusammenfassung auf.';

/* ───── Einbindung in Werkzeuge und Systemprompt ───── */
/* Uebersetzte Fassung des finish_task-Werkzeugs (die Beschreibung geht an das Modell). */
function autoFinishTool() {
  const f = AUTO_FINISH_TOOL.function, props = (f.parameters && f.parameters.properties) || {};
  const tp = {};
  for (const [k, v] of Object.entries(props)) tp[k] = { ...v, description: v.description ? T(v.description) : v.description };
  return { type: 'function', function: { ...f, description: T(f.description), parameters: { ...f.parameters, properties: tp } } };
}
function autoTools(base) {
  return [...(base || []).filter((t) => t.function.name !== 'ask_user'), autoFinishTool()]; // keine Rückfragen
}
function autoSystem(chat) { return TLines(autoSystemDe(chat)); }   // Anweisung an die KI in der eingestellten Sprache (T() uebersetzt zeilenweise)
function autoSystemDe(chat) {
  if (!autoOn(chat)) return '';
  const cfg = autoCfg();
  return '\n\n# Autonomer Modus\n'
    + 'Du arbeitest vollständig selbstständig, vielleicht über Stunden und ohne dass jemand zusieht. Niemand beantwortet Rückfragen.\n'
    + '- Stelle keine Rückfragen. Fehlt eine Angabe, triff die naheliegendste Annahme und halte sie kurz fest.\n'
    + '- Zerlege die Aufgabe in Schritte, arbeite sie nacheinander ab und prüfe Ergebnisse (Programm ausführen, Tests, Dateien lesen), bevor du weitergehst.\n'
    + (cfg.useLog ? '- Führe im Workspace die Datei AUTONOM-LOG.md: Ziel, erledigte Schritte, offene Punkte, getroffene Annahmen, jeweils kurz und aktuell. Nach dem Leeren des Kontexts ist sie dein Gedächtnis; lies sie dann zuerst.\n' : '')
    + '- Wird der Kontext voll, wirst du gebeten, propose_new_session mit einer vollständigen Übergabe aufzurufen. Danach arbeitest du mit leerem Kontext weiter.\n'
    + '- Wiederhole keine fehlgeschlagene Aktion unverändert. Ändere den Ansatz. Ist ein Teil nicht lösbar, dokumentiere es und mache mit dem nächsten Teil weiter.\n'
    + '- Bleibe im Workspace. Keine Befehle, die das System, andere Programme oder fremde Daten verändern oder löschen, kein Veröffentlichen (git push).\n'
    + '- Du kannst Befehle selbst ausführen (auch PowerShell) und Dateien lesen. Teste dein Ergebnis deshalb selbst, so gut es geht (Testdaten, Simulation, Syntaxprüfung). Die Bitte an den Nutzer, etwas selbst auszuführen oder zu prüfen, ist kein Abschluss: Beende den Lauf nicht mit „bitte führe das aus“, sondern arbeite weiter, bis alles Machbare erledigt und geprüft ist.\n'
    + '- Ist die Aufgabe vollständig erledigt, rufe finish_task mit einer kurzen Zusammenfassung auf. Ohne diesen Aufruf wirst du immer wieder zum Weitermachen aufgefordert.';
}

/* ───── Schutz: gefährliche Befehle, Schleifen, Installationen ───── */
const AUTO_DANGER = [
  [/\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(-[a-z]+\s+)*(\/|~|\$HOME|\*)(\s|$)/i, 'rekursives Löschen von Wurzel, Benutzerordner oder allem (rm -rf)'],
  [/\b(del|erase)\b[^\n]*\s\/[sq][^\n]*\b[a-z]:\\\s*($|\s)/i, 'Löschen eines ganzen Laufwerks (del /s)'],
  [/\b(rd|rmdir)\s+\/s\b[^\n]*\b[a-z]:\\\s*($|\s)/i, 'Löschen eines ganzen Laufwerks (rd /s)'],
  [/Remove-Item\b[^\n]*-Recurse[^\n]*\b[A-Za-z]:\\(\s|$|['"])/i, 'rekursives Löschen eines Laufwerks (Remove-Item)'],
  [/\bformat(\.com)?\s+[a-z]:/i, 'Formatieren eines Laufwerks'],
  [/\b(mkfs(\.\w+)?|diskpart|fdisk|parted|wipefs)\b/i, 'Datenträger-Verwaltung'],
  [/\bdd\s+[^\n]*\bof=\/dev\//i, 'direktes Schreiben auf einen Datenträger (dd)'],
  [/\b(shutdown|reboot|poweroff)\b|Restart-Computer|Stop-Computer/i, 'Herunterfahren oder Neustarten'],
  [/:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, 'Fork-Bombe'],
  [/\breg(\.exe)?\s+(add|delete|import)\b|\bbcdedit\b|\bnet\s+(user|localgroup)\b|\bschtasks(\.exe)?\s+\/create\b|\bsc(\.exe)?\s+(create|delete|config)\b|\bnetsh\s+advfirewall\b|Set-ExecutionPolicy|Disable-NetFirewallRule|(Set|Add)-MpPreference/i, 'Änderung von Systemeinstellungen (Registry, Dienste, Firewall, Konten)'],
  [/\bgit\s+push\b/i, 'Veröffentlichen mit git push'],
  [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|powershell|iex)\b|(iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n]*\|\s*(iex|Invoke-Expression)\b/i, 'Herunterladen und sofort Ausführen von Code aus dem Netz'],
];
function autoCheckCommand(chat, command) {
  if (!autoOn(chat) || !autoCfg().blockDanger) return '';
  for (const [re, label] of AUTO_DANGER) if (re.test(command)) return T(`Blockiert im autonomen Modus (Schutz): ${label}. Wähle einen sichereren Weg. Ist dieser Schritt wirklich nötig, notiere ihn als „manuell erforderlich“ und mache mit etwas anderem weiter.`);
  return '';
}
// Bei jedem Werkzeugaufruf: zählen, Schleifen erkennen, Sonderwerkzeuge. Rückgabe = fertiges Ergebnis (sonst läuft das Werkzeug normal).
function autoRunTool(tc, base, rc) {
  if (!autoOn(rc)) return null;
  const A = autoState(rc);
  A.steps++;
  A.nudges = 0;
  if (tc.name === 'ask_user') return { ...base, ok: true, content: T('Du arbeitest autonom: Es gibt keine Rückfragen. Triff eine vernünftige Annahme, halte sie kurz fest und mache weiter.') };
  if (tc.name === 'finish_task') {
    // Erster Abschluss-Versuch pro Lauf: nicht beenden, sondern selbst prüfen lassen (verhindert „bitte teste du das“-Abschlüsse)
    if (autoCfg().verifyFinish && !A.finishAsked) {
      A.finishAsked = true;
      return { ...base, ok: false, content: T('Der Lauf wurde noch NICHT beendet. Prüfe zuerst ehrlich: (1) Ist jede Anforderung der Aufgabe erfüllt? (2) Hast du das Ergebnis selbst ausgeführt oder getestet, soweit es auf diesem Rechner möglich ist (Befehl ausführen, Ausgabe und Dateien lesen, Testdaten oder Simulation)? (3) Steht etwas in deiner Zusammenfassung wie „bitte führe aus“ oder „konnte nicht testen“? Dann versuche es mit eigenen Mitteln, ändere den Ansatz oder baue eine Alternative. Fehlt nichts mehr, rufe finish_task erneut auf, mit einer Zusammenfassung, die offene Punkte klar nennt.') };
    }
    A.finished = { summary: String((tc.args && tc.args.summary) || '').trim() || '(ohne Zusammenfassung)', ts: Date.now() };
    return { ...base, ok: true, content: T('Der autonome Lauf wird beendet.') };
  }
  const sig = tc.name + ':' + JSON.stringify(tc.args || {}).slice(0, 400);
  A.sigs.push(sig);
  if (A.sigs.length > 14) A.sigs.shift();
  if (A.sigs.filter((s) => s === sig).length >= 5) {
    A.loopHits++;
    if (A.loopHits >= 3) A.stopNow = 'Schleife erkannt: Die KI wiederholt denselben Aufruf (' + tc.name + ') ohne Fortschritt.';
    return { ...base, ok: false, content: T('Du wiederholst denselben Werkzeugaufruf (' + tc.name + ') zum wiederholten Mal. Das führt zu nichts. Ändere deinen Ansatz grundlegend oder gehe zum nächsten Teil der Aufgabe über.') };
  }
  return null;
}
const autoInstallOk = (chat) => autoOn(chat) && autoCfg().allowInstalls;
function autoInstallDenied(chat) {
  return autoOn(chat) && !autoCfg().allowInstalls ? T('Im autonomen Modus sind Installationen nicht erlaubt (Einstellungen → Autonomer Modus). Arbeite mit dem, was schon da ist, oder notiere, was manuell installiert werden müsste.') : '';
}

/* ───── Kontext leeren ohne Nachfrage ───── */
function autoShouldClear(chat) {
  if (!autoOn(chat) || chat.messages.length - ctxStart(chat) < 4) return false;
  return hoRatio(chat) * 100 >= Math.min(95, Math.max(50, autoLim(chat, 'forcePct') || 85));
}
async function autoHandoffText(chat) {
  const conn = connOf(chat);
  const model = chat.model || currentModel();
  const msgs = chat.messages.slice(ctxStart(chat)).filter((m) => !m.error);
  while (msgs.length && msgs[msgs.length - 1].role === 'assistant' && (msgs[msgs.length - 1].toolCalls || []).length) msgs.pop();
  msgs.push({ role: 'user', content: T('Schreibe jetzt eine Übergabe für eine neue Sitzung, die ohne diesen Verlauf weiterarbeiten muss. Gliederung: Ziel · Erledigt (mit Dateipfaden und Funktionsnamen) · Wichtige Entscheidungen und Fakten · Offene Punkte · Nächster Schritt. Nur Dinge aus dem Verlauf, nichts erfinden, höchstens 500 Wörter. Keine Werkzeuge verwenden.') });
  const sys = buildSystem(chat);
  const cmp = compactMessages(msgs, sys);
  const run = LLM.streamChat({ conn, model, system: sys, messages: cmp.messages, params: S.settings.params, tools: null, thinkLevel: thinkId(chat), handlers: {} });
  const res = await run.promise;
  return LLM.splitThink(res.content || '').answer.trim();
}
async function autoClear(chat, opt) {
  const A = autoState(chat);
  let summary = opt.summary;
  if (!summary) { try { summary = await autoHandoffText(chat); } catch (e) { summary = ''; } } // ohne Zusammenfassung bleiben Ziel, Dateiliste und Nächster Schritt
  const text = hoCompose(chat, { summary, next: opt.next, same: true }) + TLines('\n\n## Autonomer Modus\nDu arbeitest weiter autonom und ohne Rückfragen.') + (autoCfg().useLog ? T(' Lies zuerst AUTONOM-LOG.md im Workspace, falls vorhanden.') : '') + T(' Ist alles erledigt, rufe finish_task auf.');
  chat.ctxStart = chat.messages.length;
  chat.hoHintAt = 0;
  chat.pendingContinue = false;
  chat.autoClearPending = false;
  if (opt.srcMsg) opt.srcMsg.cleared = true;
  A.resets++;
  A.nudges = 0;
  chat.messages.push({ id: uid(), role: 'user', content: text, handoff: true, cleared: true, auto: true, ts: Date.now() });
  await saveChatNow(chat);
  if (S.chat === chat) { S.stick = true; renderMessages(); updateCtxMeter(); }
  autoRefresh();
  generate(chat);
}

/* ───── Aufsicht: nach jedem Lauf entscheiden, wie es weitergeht ───── */
function autoLimit(chat) {
  const A = autoState(chat);
  const hours = (Date.now() - (A.startedAt || Date.now())) / 3600000;
  const mh = autoLim(chat, 'maxHours'), ms = autoLim(chat, 'maxSteps'), mr = autoLim(chat, 'maxResets');
  if (mh > 0 && hours >= mh) return `Zeitlimit von ${mh} Stunden erreicht.`;
  if (ms > 0 && A.steps >= ms) return `Schrittlimit von ${ms} Werkzeugaufrufen erreicht.`;
  if (mr > 0 && A.resets >= mr) return `Limit von ${mr} Kontext-Leerungen erreicht.`;
  return '';
}
function autoStop(chat, kind, text) {
  const A = autoState(chat);
  A.on = false;
  A.report = { kind, text, ts: Date.now(), steps: A.steps, resets: A.resets, hours: +(((Date.now() - (A.startedAt || Date.now())) / 3600000).toFixed(2)) };
  A.stopNow = '';
  saveChatSoon(chat);
  autoNotify(kind === 'done' ? 'Autonomer Lauf erledigt' : 'Autonomer Lauf angehalten', `${chat.title}: ${String(text).slice(0, 180)}`);
  autoPower();
  autoRefresh();
  if (typeof renderChatList === 'function') renderChatList();
}
function autoNotify(title, body) {
  if (!autoCfg().notify) return;
  try { new Notification('LLM Box – ' + title, { body }); } catch {}
}
function autoPower() {
  const any = [...(S.autoChats || [])].some((c) => autoOn(c));
  try { if (typeof api !== 'undefined' && api.power && api.power.keepAwake) api.power.keepAwake(!!any && autoCfg().keepAwake); } catch {}
}
const AUTO_BACKOFF = [20, 60, 120, 300, 600, 900];
function autoAfterRun(chat) {
  try {
    if (!autoOn(chat) || DELETED.has(chat) || runOf(chat)) return;
    const A = autoState(chat);
    if (A.supervising) return;
    A.supervising = true;
    setTimeout(() => { A.supervising = false; }, 0);
    if (A.halted) return autoStop(chat, 'halt', 'Vom Nutzer angehalten.');
    if (A.stopNow) return autoStop(chat, 'loop', A.stopNow);
    if (A.finished) return autoStop(chat, 'done', A.finished.summary);
    const lim = autoLimit(chat);
    if (lim) return autoStop(chat, 'limit', lim);
    const last = chat.messages[chat.messages.length - 1];
    if (!last) return;
    if (last.role === 'tool' && last.name === 'propose_new_session') {
      if (chat.messages.length - ctxStart(chat) < 2) return autoStop(chat, 'error', 'Kontext voll, aber nichts zu leeren.');
      A.errors = 0;
      return void autoClear(chat, { summary: (last.args || {}).summary, next: (last.args || {}).next_steps, srcMsg: last });
    }
    if (chat.autoClearPending) {
      if (chat.messages.length - ctxStart(chat) < 4) { chat.autoClearPending = false; return autoStop(chat, 'error', 'Der Kontext ist voll, lässt sich aber nicht weiter leeren.'); }
      return void autoClear(chat, {});
    }
    if (last.role === 'assistant' && last.error) {
      // Kontext zu groß: leeren statt wiederholen
      if (/context|n_ctx|too long|maximum.*(length|tokens)|exceed/i.test(last.error) && chat.messages.length - ctxStart(chat) >= 4) { chat.messages.pop(); return void autoClear(chat, {}); }
      A.errors = (A.errors || 0) + 1;
      if (A.errors > (autoCfg().retries || 6)) return autoStop(chat, 'error', 'Wiederholter Fehler: ' + String(last.error).slice(0, 200));
      const wait = AUTO_BACKOFF[Math.min(A.errors - 1, AUTO_BACKOFF.length - 1)];
      A.retryAt = Date.now() + wait * 1000;
      autoRefresh();
      setTimeout(() => {
        if (!autoOn(chat) || A.halted || runOf(chat) || DELETED.has(chat)) return;
        const l = chat.messages[chat.messages.length - 1];
        if (l && l.role === 'assistant' && l.error) chat.messages.pop();
        A.retryAt = 0;
        generate(chat);
      }, wait * 1000);
      return;
    }
    A.errors = 0;
    if (chat.pendingContinue) { // Schritt-Limit pro Lauf: weitermachen
      chat.pendingContinue = false;
      chat.messages.push({ id: uid(), role: 'user', content: T(AUTO_CONTINUE), auto: true, ts: Date.now() });
      if (S.chat === chat) renderMessages();
      return void generate(chat);
    }
    if (last.role === 'assistant' && !(last.toolCalls || []).length) { // Text ohne Werkzeug und ohne finish_task
      A.nudges = (A.nudges || 0) + 1;
      if (A.nudges > 3) return autoStop(chat, 'stuck', 'Die KI macht ohne Werkzeugaufruf und ohne finish_task nicht weiter (3 Aufforderungen ohne Fortschritt).');
      chat.messages.push({ id: uid(), role: 'user', content: T(AUTO_NUDGE), auto: true, ts: Date.now() });
      if (S.chat === chat) renderMessages();
      return void generate(chat);
    }
    return void generate(chat); // Lauf endete nach einem Werkzeug: einfach weitermachen
  } catch (e) { console.error('Autonomer Modus:', e); }
}
// Nutzer schreibt selbst in den Chat: Anhalten und Zähler zurücksetzen, der Modus bleibt an
function autoOnUserSend(chat) {
  if (!chat || !chat.auto || !chat.auto.on) return;
  const A = autoState(chat);
  A.halted = false; A.errors = 0; A.nudges = 0; A.finished = null; A.finishAsked = false; A.stopNow = ''; A.loopHits = 0; A.report = null;
  if (!A.startedAt) A.startedAt = Date.now();
}

/* ───── Ein- und Ausschalten, Oberfläche ───── */
function autoSet(chat, on) {
  if (!chat || chat._live) return;
  const A = autoState(chat);
  if (on) {
    Object.assign(A, { on: true, startedAt: Date.now(), steps: 0, resets: 0, errors: 0, nudges: 0, loopHits: 0, sigs: [], halted: false, finished: null, finishAsked: false, report: null, stopNow: '', limits: null }); // neuer Lauf: Werte aus den Einstellungen
    S.autoChats.add(chat);
    toast('Autonomer Modus an: Die KI arbeitet ohne Rückfragen und ohne Freigaben, bis die Aufgabe erledigt ist oder eine Grenze erreicht wird.', 6000);
  } else {
    A.on = false;
    S.autoChats.delete(chat);
    const R = runOf(chat);
    if (R) { R.autoStopping = true; stopGeneration(R); }
  }
  saveChatSoon(chat);
  autoPower();
  autoRefresh();
  if (typeof updatePermBtn === 'function') updatePermBtn();
}
function autoResume(chat) { // z. B. nach Neustart der App oder nach einem Limit
  if (!autoOn(chat) || runOf(chat)) return;
  const A = autoState(chat);
  A.halted = false; A.errors = 0; A.nudges = 0; A.finished = null; A.finishAsked = false; A.stopNow = ''; A.report = null;
  chat.messages.push({ id: uid(), role: 'user', content: T(AUTO_CONTINUE), auto: true, ts: Date.now() });
  S.autoChats.add(chat);
  if (S.chat === chat) renderMessages();
  autoPower();
  generate(chat);
}
const autoFmtDur = (ms) => { const m = Math.floor(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.max(0, m) + ' min'; };
function autoRefresh() {
  const chip = $('#btn-auto');
  const chat = S.chat && !S.chat._live ? S.chat : null;
  const A = chat && chat.auto;
  const on = autoOn(chat);
  if (chip) {
    chip.classList.toggle('on', on);
    chip.classList.toggle('warn', on);
    chip.innerHTML = icon('zap', 14) + '<span>' + (on ? 'Autonom: an' : 'Autonom') + '</span>';
    chip.title = on ? 'Autonomer Modus ist an: keine Rückfragen, keine Freigaben, Kontext wird selbst geleert. Klick: ausschalten.' : 'Autonomer Modus: Die KI arbeitet selbstständig bis zum Ende, auch über Nacht (Klick: einschalten).';
    chip.disabled = !chat;
  }
  let strip = $('#auto-strip');
  const showReport = A && A.report && !on;
  if (!chat || (!on && !showReport)) { if (strip) strip.remove(); return; }
  if (!strip) { strip = el('div', { id: 'auto-strip', class: 'auto-strip' }); const msgs = $('#messages'); if (msgs && msgs.parentNode) msgs.parentNode.insertBefore(strip, msgs); }
  strip.innerHTML = '';
  strip.classList.toggle('done', !!showReport);
  const R = runOf(chat);
  if (on) {
    const cfg = autoCfg();
    const lim = (k, unit) => { const v = autoLim(chat, k); return (v ? v : '∞') + T(unit); };
    const t = A.retryAt && A.retryAt > Date.now() ? ` · wiederholt nach Fehler in ${Math.ceil((A.retryAt - Date.now()) / 1000)} s` : '';
    strip.append(
      el('div', { class: 'auto-main' },
        el('span', { class: 'live-dot' + (R ? ' run' : '') }),
        el('b', { text: 'Autonom' }),
        el('span', { class: 'auto-stat', text: `${autoFmtDur(Date.now() - (A.startedAt || Date.now()))} · ${A.steps} Schritte · ${A.resets}× Kontext geleert${t}` }),
        el('span', { class: 'row-gap' },
          chat.messages.length && !R ? el('button', { class: 'btn sm', text: 'Jetzt weitermachen', onclick: () => autoResume(chat) }) : null,
          R ? el('button', { class: 'btn sm danger', text: 'Stopp', onclick: () => autoStopUser(chat) }) : null,
          el('button', { class: 'btn sm', title: 'Grenzen für diesen Lauf ändern oder verlängern', text: 'Grenzen', onclick: () => autoLimitsDialog(chat) }),
          el('button', { class: 'btn sm', text: 'Aus', onclick: () => autoSet(chat, false) }),
          el('button', { class: 'mini-btn', title: 'Einstellungen', html: icon('sliders', 14), onclick: () => openSettings('auto') }))),
      el('div', { class: 'auto-warn', text: T('Sicherheit: Die KI ändert Dateien im Workspace und führt Befehle ohne Rückfrage aus') + (cfg.allowInstalls ? T(', auch Installationen') : '') + T('. Gefährliche Befehle werden blockiert (kein vollständiger Schutz). Grenzen:') + ` ${lim('maxHours', ' h')} · ${lim('maxSteps', ' Schritte')} · ${lim('maxResets', ' Leerungen')}. ` + T('Der Rechner bleibt wach.') })
    );
    if (!chat.messages.length) strip.append(el('div', { class: 'auto-hint', text: 'Beschreibe die Aufgabe und sende. Die KI arbeitet dann ohne Rückfragen bis zum Ende.' }));
  } else {
    const r = A.report;
    strip.append(el('div', { class: 'auto-main' },
      el('b', { text: r.kind === 'done' ? 'Autonomer Lauf erledigt' : 'Autonomer Lauf angehalten' }),
      el('span', { class: 'auto-stat', text: `${r.hours} h · ${r.steps} Schritte · ${r.resets}× Kontext geleert` }),
      el('span', { class: 'row-gap' },
        r.kind !== 'done' ? el('button', { class: 'btn sm', text: 'Fortsetzen', onclick: () => { autoSet(chat, true); autoResume(chat); } }) : null,
        el('button', { class: 'btn sm', text: 'Schließen', onclick: () => { chat.auto.report = null; saveChatSoon(chat); autoRefresh(); } }))),
      el('div', { class: 'auto-report', text: r.text })
    );
  }
  strip.querySelectorAll('.auto-warn').forEach((w) => { w.title = w.textContent; }); // einzeilig gekürzt, voller Text als Tooltip
}
function autoStopUser(chat) {
  const A = autoState(chat);
  A.halted = true;
  const R = runOf(chat);
  if (R) stopGeneration(R); else autoStop(chat, 'halt', 'Vom Nutzer angehalten.');
}
/* Grenzen nur für diesen Chat ändern (z. B. einen laufenden Lauf verlängern). Leer oder 0 = keine Grenze. */
function autoLimitsDialog(chat) {
  const A = autoState(chat);
  const F = [
    ['maxHours', 'Höchstdauer (Stunden)', 'Seit dem Start dieses Laufs gerechnet. Beispiel: Lief er schon 8 h, setze 12 für 4 weitere Stunden.'],
    ['maxSteps', 'Höchstzahl Werkzeugaufrufe', 'Bisher in diesem Lauf: ' + A.steps],
    ['maxResets', 'Höchstzahl Kontext-Leerungen', 'Bisher in diesem Lauf: ' + A.resets],
    ['forcePct', 'Zwangs-Leeren ab Füllstand (%)', '50 bis 95'],
  ];
  const inputs = {};
  const body = el('div', { class: 'ow-form auto-limits-form' }, el('div', { class: 'fhint', text: 'Gilt nur für diesen Chat und sofort, auch während der Lauf arbeitet. Leer oder 0 = keine Grenze.' }));
  const grid = el('div', { class: 'auto-limits-grid' });
  body.append(grid);
  for (const [k, label, hint] of F) {
    const inp = el('input', { type: 'number', min: 0, step: k === 'maxHours' ? 0.5 : 1 });
    inp.value = autoLim(chat, k) || (k === 'forcePct' ? 85 : '');
    inputs[k] = inp;
    grid.append(el('label', { class: 'ow-field' }, el('span', { text: label }), inp, el('small', { text: hint })));
  }
  const dlg = openModal({
    title: 'Grenzen für diesen Lauf',
    body,
    buttons: [
      { label: 'Abbrechen', value: null },
      { label: 'Auf Standard zurücksetzen', onClick: (close) => { delete A.limits; saveChatSoon(chat); autoRefresh(); close(true); } },
      { label: 'Speichern', primary: true, onClick: (close) => {
        const o = {};
        for (const [k] of F) { const v = inputs[k].value.trim(); o[k] = v === '' ? 0 : Math.max(0, +v || 0); }
        if (o.forcePct) o.forcePct = Math.min(95, Math.max(50, o.forcePct));
        A.limits = o;
        saveChatSoon(chat);
        autoRefresh();
        close(true);
      } },
    ],
  });
  if (dlg && dlg.el) dlg.el.classList.add('auto-limits'); // eigene Breite, kein Scrollen (siehe styles.css)
}
function autoInit() {
  S.autoChats = S.autoChats || new Set(); // Chats mit eingeschaltetem autonomem Modus (für „Rechner wach halten“)
  if (typeof TOOL_LABEL !== 'undefined') Object.assign(TOOL_LABEL, { finish_task: 'Aufgabe abschließen' });
  const anchor = $('#btn-perm') || $('#btn-tools');
  if (anchor && !$('#btn-auto')) {
    const b = el('button', { id: 'btn-auto', class: 'chip-btn', onclick: () => { if (S.chat && !S.chat._live) autoSet(S.chat, !autoOn(S.chat)); } });
    anchor.after(b);
  }
  autoRefresh();
  setInterval(() => { if ($('#auto-strip') && autoOn(S.chat)) autoRefresh(); }, 5000);
}
// Chats mit laufendem autonomen Modus beim Start wieder anmelden (für „wach halten“)
function autoRegister(chat) { if (autoOn(chat)) S.autoChats.add(chat); }

/* ───── Einstellungen ───── */
function tabAuto() {
  const wrap = el('div');
  const c = autoCfg();
  const sw = (key, label, hint) => frow(label, hint, bindSwitch('auto.' + key));
  wrap.append(
    el('div', { class: 'fhint', text: 'Im autonomen Modus arbeitet die KI vollständig selbstständig, auch über Nacht: ohne Rückfragen, ohne Freigaben, mit automatischem Leeren des Kontexts. Einschalten pro Chat über den Knopf „Autonom“ im Eingabefeld, dann die Aufgabe beschreiben und senden.' }),
    el('div', { class: 'tr-warn', text: 'Sicherheit: Im autonomen Modus führt die KI Datei-Änderungen und Befehle ohne Rückfrage mit deinen Benutzerrechten aus. Nutze ihn nur für einen Workspace-Ordner, dessen Inhalt gesichert ist (z. B. Git oder Backup). Gefährliche Befehle werden blockiert, das ist ein Sicherheitsnetz und kein vollständiger Schutz. Prüfe das Ergebnis am Morgen.' }),
    el('h3', { text: 'Grenzen (Notbremse)' }),
    el('div', { class: 'fhint', text: 'Das sind die Standardwerte für alle autonomen Läufe. Änderungen gelten sofort, auch für einen laufenden Lauf. Pro Chat lassen sie sich über „Grenzen“ in der Autonom-Leiste oben im Chat überschreiben.' }),
    frow('Höchstdauer (Stunden)', 'Danach hält der Lauf an. Leer oder 0 = keine Grenze. Für einen einzelnen Lauf änderbar über „Grenzen“ in der Autonom-Leiste oben im Chat.', bindNumber('auto.maxHours', { min: 0, max: 72, placeholder: '8' })),
    frow('Höchstzahl Werkzeugaufrufe', 'Danach hält der Lauf an. Leer oder 0 = keine Grenze.', bindNumber('auto.maxSteps', { min: 0, placeholder: '3000' })),
    frow('Höchstzahl Kontext-Leerungen', 'Schutz gegen Endlosläufe ohne Fortschritt. Leer oder 0 = keine Grenze.', bindNumber('auto.maxResets', { min: 0, placeholder: '40' })),
    frow('Fehler-Wiederholungen', 'Bei Netz- oder Serverfehlern wartet die App (20 s, 1, 2, 5, 10, 15 min) und versucht es erneut, so oft wie hier eingestellt.', bindNumber('auto.retries', { min: 0, max: 20, placeholder: '6' })),
    el('h3', { text: 'Kontext leeren' }),
    frow('Zwangs-Leeren ab Füllstand (%)', 'Ab ca. 70 % (Einstellung „Hinweis ab Kontext-Füllstand“) bittet die App die KI um eine Übergabe, die sie dann ohne Klick übernimmt. Erreicht der Kontext diesen Wert ohne Übergabe der KI, schreibt die App die Übergabe selbst und leert den Kontext.', bindNumber('auto.forcePct', { min: 50, max: 95, placeholder: '85' })),
    sw('useLog', 'KI führt AUTONOM-LOG.md im Workspace', 'Kurzes Protokoll (Ziel, erledigt, offen, Annahmen). Nach dem Leeren des Kontexts ist es das Gedächtnis der KI. Schreibt eine Datei in deinen Workspace.'),
    el('h3', { text: 'Schutz und Betrieb' }),
    sw('blockDanger', 'Gefährliche Befehle blockieren', 'Sperrt z. B. rm -rf /, Laufwerke löschen oder formatieren, Herunterfahren, Registry- und Firewall-Änderungen, git push, „Code aus dem Netz sofort ausführen“. Kein vollständiger Schutz.'),
    sw('allowInstalls', 'Installationen erlauben (winget, pip, npm …)', 'Aus: Die KI darf nichts installieren und arbeitet mit dem Vorhandenen. Ein: Installationen laufen ohne Rückfrage und verändern deinen Rechner.'),
    sw('keepAwake', 'Rechner wach halten', 'Verhindert den Ruhezustand, solange ein autonomer Lauf aktiv ist (Windows-App). Der Bildschirm darf ausgehen.'),
    sw('verifyFinish', 'Abschluss einmal prüfen lassen', 'Ruft die KI finish_task zum ersten Mal auf, beendet die App den Lauf noch nicht, sondern bittet sie, ihr Ergebnis selbst zu prüfen und zu testen. Verhindert, dass sie mit „bitte führe das selbst aus“ aufgibt.'),
    sw('notify', 'Benachrichtigung am Ende', 'Windows-Meldung, wenn der Lauf fertig ist oder angehalten wurde.'),
    el('div', { class: 'fhint', text: 'Das Ende erkennt die App an: finish_task der KI, „Aus“/„Stopp“ durch dich, einer der Grenzen oben, einer erkannten Schleife (derselbe Aufruf mehrfach ohne Fortschritt) oder wiederholten Fehlern. Das Ergebnis steht danach in der Leiste oben im Chat.' })
  );
  return wrap;
}
