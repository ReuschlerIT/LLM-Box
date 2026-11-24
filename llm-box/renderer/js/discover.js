'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   discover.js  –  Strata-Server anhand einer IP-Adresse erkennen und in die LLM-Box uebernehmen
   Einstieg: Einstellungen -> Verbindungen -> „Server per IP-Adresse erkennen …“ (openDiscover()).
   Der Hauptprozess (main.js, discover:scan) prueft ueberliche Ports; hier werden die Ergebnisse gezeigt und
   die gewaehlte Schnittstelle als Verbindung eingetragen. Alles, was die App aus dem Server auslesen konnte
   (Modell, Kontext, parallele Plaetze, Instanz-Port), landet in „Modell starten“, aber nur in leere Felder.
   ══════════════════════════════════════════════════════════════════════════ */

function discoverKind(f) {
  const k = [];
  if (f.strataHost) k.push('Strata-App (Desktop)');
  if (f.strataServer) k.push('Strata-Modellserver');
  if (f.openai) k.push('OpenAI-kompatibel');
  if (f.ollama) k.push('Ollama');
  if (!k.length && f.needsKey) k.push('Antwortet, verlangt aber einen Schlüssel');
  return k.join(' + ');
}

/* Was in die Einstellungen eingetragen wird (nur Anzeige und Berechnung, schreibt nichts) */
function discoverPlan(host, f, others) {
  const plan = { port: f.port, baseUrl: `http://${host}:${f.port}/v1`, notes: [], launch: {} };
  if (!f.openai && !f.ollama) plan.notes.push('Auf diesem Port gibt es keine Chat-Schnittstelle (/v1/models). Chatten wird so nicht gehen, wähle dafür einen anderen Treffer.');
  if (f.ollama && !f.openai) { plan.baseUrl = `http://${host}:${f.port}`; plan.type = 'ollama'; }
  const inst = f.instances.find((i) => i.status === 'ready') || f.instances[0];
  const eng = f.engine || ((others || []).find((o) => o.strataServer && (!inst || o.port === +inst.port)) || {}).engine || null;
  const model = (eng && eng.model) || (inst && inst.model) || '';
  if (model) plan.launch.model = model;
  if (eng && eng.maxContext) plan.launch.context = String(eng.maxContext);
  if (eng && eng.parallel) plan.launch.parallel = String(eng.parallel);
  if (inst && inst.port) plan.launch.port = String(inst.port);
  if (f.strataServer && !f.strataHost) plan.notes.push('Das ist der Modellserver selbst. „Modell laden“ per Fernsteuerung klappt am sichersten über die Strata-App (Treffer „Strata-App“), falls vorhanden.');
  return plan;
}

function discoverApply(host, f, others, { apiKey, makeActive }) {
  const plan = discoverPlan(host, f, others);
  const conns = S.settings.connections;
  const same = conns.find((c) => { try { return new URL(c.baseUrl).hostname === host; } catch { return false; } });
  let c = same;
  if (!c) {
    c = { id: uid(), name: `Strata (${host})`, type: plan.type || 'openai', baseUrl: plan.baseUrl, apiKey: apiKey || '', extraParams: true, thinkMode: 'template' };
    conns.push(c);
  } else {
    c.baseUrl = plan.baseUrl;
    if (plan.type) c.type = plan.type;
    if (apiKey) c.apiKey = apiKey;
  }
  const sv = ensureObj(S.settings, 'server', {});
  sv.connId = c.id;
  const target = ensureObj(sv, 'target', {});
  if (!target.host) target.host = host;
  const launch = ensureObj(sv, 'launch', {});
  const filled = [];
  for (const [k, v] of Object.entries(plan.launch)) if (!launch[k]) { launch[k] = v; filled.push(k); }
  if (makeActive) S.settings.activeConnection = c.id;
  changed();
  return { conn: c, plan, filled, created: !same };
}

function openDiscover(onDone) {
  const host = el('input', { type: 'text', placeholder: '192.0.2.1.50', style: { width: '100%' } });
  const ports = el('input', { type: 'text', placeholder: T('Weitere Ports (optional), z. B. 9001, 47000'), style: { width: '100%' } });
  const key = el('input', { type: 'password', placeholder: T('API-Schlüssel (nur falls der Server einen verlangt)'), style: { width: '100%' } });
  const msg = el('div', { class: 'fhint', style: { margin: '8px 0' } });
  const out = el('div');
  let close = null, busy = false;
  const scan = async () => {
    if (busy) return;
    busy = true;
    out.innerHTML = '';
    msg.textContent = T('Suche läuft … (prüft übliche Ports, das dauert ein paar Sekunden)');
    let r;
    try { r = await api.discover.scan({ host: host.value, ports: ports.value, apiKey: key.value }); } catch (e) { r = { ok: false, error: e.message }; }
    busy = false;
    if (!r.ok) { msg.textContent = T(r.error || 'Fehler'); return; }
    if (!r.found.length) { msg.textContent = `${T('Auf')} ${r.host} ${T('wurde nichts gefunden')} (${r.scanned} ${T('Ports geprüft')}). ${T('Läuft der Server, ist er im Netzwerk erreichbar (nicht nur auf localhost) und lässt die Firewall den Port durch? Den genauen Port kannst du oben unter „Weitere Ports“ angeben.')}`; return; }
    msg.textContent = `${r.found.length} ${T('Treffer auf')} ${r.host}. ${T('Wähle die Schnittstelle, über die du chatten und Modelle laden willst (meist die Strata-App).')}`;
    let pick = Math.max(0, r.found.findIndex((f) => f.strataHost && f.openai));
    if (pick === 0 && !(r.found[0].strataHost && r.found[0].openai)) pick = Math.max(0, r.found.findIndex((f) => f.openai));
    const active = el('input', { type: 'checkbox' });
    active.checked = true;
    const cards = r.found.map((f, i) => {
      const radio = el('input', { type: 'radio', name: 'disc-pick' });
      radio.checked = i === pick;
      radio.addEventListener('change', () => { pick = i; });
      const lines = [];
      if (f.strataHost) lines.push(`${T('Instanzen')}: ${f.instances.length ? f.instances.map((x) => `${x.model || x.id || '?'} (${x.status || '?'}${x.port ? ', Port ' + x.port : ''})`).join('; ') : T('keine geladen')}`);
      if (f.installed.length) lines.push(`${T('Installierte Modelle')}: ${f.installed.slice(0, 8).join(', ')}${f.installed.length > 8 ? ' …' : ''}`);
      if (f.engine) lines.push(`${T('Modell')}: ${f.engine.model || '–'}${f.engine.maxContext ? ' · ' + T('Kontext') + ' ' + f.engine.maxContext : ''}${f.engine.parallel ? ' · ' + f.engine.parallel + ' ' + T('parallele Plätze') : ''}${f.engine.gpu ? ' · ' + f.engine.gpu : ''}`);
      if (f.models.length && !f.installed.length) lines.push(`${T('Modelle')}: ${f.models.slice(0, 8).join(', ')}${f.models.length > 8 ? ' …' : ''}`);
      if (f.needsKey) lines.push(T('Dieser Port verlangt einen API-Schlüssel (oben eintragen und erneut suchen).'));
      return el('label', { style: { display: 'block', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '8px', margin: '6px 0', cursor: 'pointer' } },
        el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: '600' } }, radio, el('span', { text: `Port ${f.port} · ${T(discoverKind(f))}` })),
        ...lines.map((t) => el('div', { class: 'fhint', style: { marginLeft: '24px' }, text: t })));
    });
    const apply = el('button', { class: 'btn primary', text: T('Übernehmen'), onclick: () => {
      const f = r.found[pick];
      const res = discoverApply(r.host, f, r.found, { apiKey: key.value.trim(), makeActive: active.checked });
      const parts = [`${T('Verbindung')} „${res.conn.name}“ ${res.created ? T('angelegt') : T('aktualisiert')} (${res.conn.baseUrl}).`];
      if (res.filled.length) parts.push(`${T('In „Modell starten“ eingetragen')}: ${res.filled.join(', ')}.`);
      res.plan.notes.forEach((n) => parts.push(T(n)));
      toast(parts.join(' '), 10000);
      if (close) close();
      try { refreshModels(); } catch {}
      if (onDone) onDone();
    } });
    out.append(...cards, el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '8px 0' } }, active, el('span', { text: T('Als aktive Verbindung verwenden') })), apply);
  };
  const go = el('button', { class: 'btn primary', text: T('Suchen'), onclick: scan });
  host.addEventListener('keydown', (e) => { if (e.key === 'Enter') scan(); });
  const dlg = openModal({
    title: T('Server per IP-Adresse erkennen'),
    body: el('div', {},
      el('div', { class: 'fhint', text: T('Gib die Adresse des Rechners ein, auf dem Strata läuft. Die LLM-Box sucht dort die Strata-App, den Modellserver und die Chat-Schnittstelle und trägt Verbindung und Einstellungen für dich ein, damit „Modell laden“ direkt funktioniert. Es werden nur lesende Anfragen gesendet.') }),
      el('div', { style: { display: 'grid', gap: '8px', margin: '10px 0' } }, host, ports, key, el('div', {}, go)),
      msg, out),
    buttons: [{ label: T('Schließen'), value: null }],
    onClose: () => {},
    wide: true,
  });
  setTimeout(() => host.focus(), 50);
  close = () => dlg.close(null);
}
