'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   settingsgroups.js  –  Einstellungen neu geordnet (Version 1.0.84)

   Vorher: 14 Reiter in 5 Gruppen. Was die KI beeinflusst (Prompt, Denken, Sampling, Gedächtnis, Websuche, Assistenten, Werkzeuge,
   Autonomer Modus) lag in sieben verschiedenen Reitern. Jetzt: 8 Reiter nach Zweck, jeder mit aufklappbaren Abschnitten,
   plus eine Suche über ALLE Einstellungen.

     Verbindung   Verbindungen · Strata-Server
     KI           KI-Verhalten (Modell, Prompt, Denken, Genauigkeit, Autonom) · Fähigkeiten (Skills, Assistenten, Gedächtnis, Websuche)
     Arbeit       Projekte & Dateien (Projekte, Dateizugriff, Freigaben, Unteragenten, Kontext)
     App          Darstellung (+ Funktionen) · Daten & Geräte · Kosten & Info

   Die Inhalte der alten Reiter bleiben unverändert (dieselben Funktionen), sie stehen nur als Abschnitt unter dem passenden Reiter.
   ══════════════════════════════════════════════════════════════════════════ */

/* Abschnitt: Titel + Kurzhinweis, Inhalt wird beim ersten Aufklappen gebaut (build) */
function setSec(id, title, hint, build, openDefault) {
  const store = S.settings.settingsSec || (S.settings.settingsSec = {});
  const d = el('details', { class: 'set-sec', 'data-sec': id });
  d.open = store[id] !== undefined ? !!store[id] : !!openDefault;
  const body = el('div', { class: 'ss-body' });
  d.append(el('summary', {}, el('span', { class: 'ss-title', text: title }), hint ? el('span', { class: 'ss-hint', text: hint }) : null), body);
  d.__build = () => {
    if (d.__done) return;
    d.__done = true;
    try { const n = build(); if (n) body.append(n); } catch (e) { body.append(el('div', { class: 'fhint', text: 'Dieser Abschnitt konnte nicht geladen werden: ' + e.message })); }
  };
  d.addEventListener('toggle', () => { if (d.open) d.__build(); if (store[id] !== d.open) { store[id] = d.open; saveSettings(); } });
  if (d.open) d.__build();
  return d;
}

const thinkEffortRow = () => {
  const sel = el('select', {}, THINK_LEVELS.map((l) => el('option', { value: l.id, text: T(l.label) + ' – ' + T(l.hint) })));
  sel.value = S.settings.thinking || 'auto';
  sel.addEventListener('change', () => { S.settings.thinking = sel.value; changed(); });
  return frow('Denkaufwand für neue Chats', 'Wie lange das Modell nachdenkt, bevor es antwortet. „Schnell“ hält den Gedankengang kurz und spart Zeit; für schwierige Aufgaben im Chat darunter (Knopf „Denken“) pro Chat erhöhen.', sel);
};
const thinkGermanRow = () => frow('Modell bitten, auf Deutsch zu denken', 'Fügt dem Systemprompt eine Anweisung hinzu. Qwen hält sich nicht immer daran, und das Denken auf Englisch ist oft genauer. Übersetzen (Einstellungen → Darstellung) ist meist die bessere Wahl.', bindSwitch('appearance.thinkInGerman'));

/* ───── KI-Verhalten ───── */
function tabAI() {
  return el('div', { class: 'set-tab' },
    setSec('ai-model', 'Modell, Anweisungen & Sampling', 'Profil, System-Prompt, Temperatur, Kontext, Antwortlänge', () => tabModel(), true),
    setSec('ai-think', 'Denken', 'Denkaufwand und Denksprache', () => el('div', {}, thinkEffortRow(), thinkGermanRow())),
    setSec('ai-quality', 'Genauigkeit & Zuverlässigkeit', 'Weniger erfinden: Schnellwahl, Werkzeug-Temperatur, Pfad-Hilfe', () => qualitySettingsSection()),
    setSec('ai-auto', 'Autonomer Modus', 'Selbstständig arbeiten, Grenzen und Notbremse', () => (typeof tabAuto === 'function' ? tabAuto() : null))
  );
}

/* ───── Fähigkeiten ───── */
function tabAbilities() {
  return el('div', { class: 'set-tab' },
    setSec('ab-skills', 'Skills', 'Wiederverwendbare Arbeitsanleitungen, die das Modell bei Bedarf lädt', () => skillsSection(), true),
    setSec('ab-mcp', 'MCP-Server', 'Externe Werkzeuge anbinden, mehrere Server gleichzeitig', () => mcpSection()),
    setSec('ab-prompts', 'Assistenten & Prompt-Bibliothek', 'Eigene Rollen und Vorlagen', () => (typeof tabPrompts === 'function' ? tabPrompts() : null)),
    setSec('ab-know', 'Gedächtnis & Wissen', 'Merksätze und eigene Dokumente', () => (typeof tabKnowledge === 'function' ? tabKnowledge() : null)),
    setSec('ab-web', 'Websuche & Sprache', 'Internetsuche, Vorlesen', () => (typeof tabWebSearch === 'function' ? tabWebSearch() : null))
  );
}

/* ───── Projekte & Dateien ───── */
function tabWork() {
  return el('div', { class: 'set-tab' },
    setSec('wk-proj', 'Projekte', 'Ein Ordner je Projekt, die KI sieht nur ihr Projekt', () => projSettingsSection(), true),
    setSec('wk-files', 'Workspace, Dateizugriff & Freigaben', 'Wurzelordner, Werkzeuge, Programme, Unteragenten, Kontext', () => tabWorkspace())
  );
}

/* ───── Strata-Server ───── */
function tabStrataSrv() {
  const L = () => S.settings.server.launch;
  const open = (tab) => () => { if (typeof openServer === 'function') openServer(tab); else toast('Der Server-Bereich ist nicht verfügbar.'); };
  const preview = el('pre', { class: 'sv-preview' });
  const refresh = () => { preview.textContent = typeof svCmdPreview === 'function' ? svCmdPreview('start') : ''; };
  refresh();
  const card = el('div', {},
    el('div', { class: 'fhint', style: { padding: '10px 0' }, text: 'Hier startest und verwaltest du dein Modell auf dem Strata-Server direkt aus der LLM Box. Alle Startoptionen (Modell, Kontext, Drafter, Engine-Werte, Zugriff) stehen im Fenster „Server & Monitor“ unter „Modell starten“. Die Box übergibt sie als „strata launch“ an den Server, lokal oder per SSH.' }),
    el('div', { class: 'row-gap', style: { flexWrap: 'wrap', padding: '4px 0 12px' } },
      el('button', { class: 'btn primary', text: 'Modell starten & verwalten …', onclick: open('launch') }),
      el('button', { class: 'btn', text: 'Monitor', onclick: open('monitor') }),
      el('button', { class: 'btn', text: 'Konfiguration des Servers', onclick: open('config') }),
      el('button', { class: 'btn', text: 'Zielrechner (lokal oder SSH)', onclick: open('target') })),
    el('h3', { text: 'Aktueller Startbefehl' }), preview
  );
  return el('div', { class: 'set-tab' },
    setSec('sv-launch', 'Modell starten & verwalten', 'Startwerte, Profile, Start, Stopp, Status', () => card, true)
  );
}

/* ───── Darstellung (+ Funktionen) ───── */
function tabLook() {
  return el('div', { class: 'set-tab' },
    setSec('lk-look', 'Darstellung', 'Farben, Schrift, Layout, Gedankengänge', () => tabAppearance(), true),
    setSec('lk-mod', 'Funktionen & Ansicht', 'Bedienelemente ein- und ausblenden', () => (typeof tabModules === 'function' ? tabModules() : null))
  );
}

/* ───── Daten & Geräte ───── */
function tabDevices() {
  return el('div', { class: 'set-tab' },
    setSec('dv-data', 'Daten', 'Speicherort, Export, Zurücksetzen', () => tabData(), true),
    setSec('dv-live', 'Live-Ansicht', 'Chats auf anderen Geräten ansehen', () => (typeof tabLive === 'function' ? tabLive() : null)),
    setSec('dv-tr', 'Übertragung', 'Einstellungen und Chats auf ein anderes Gerät', () => (typeof tabTransfer === 'function' ? tabTransfer() : null))
  );
}

/* ───── Kosten & Info ───── */
function tabCostInfo() {
  return el('div', { class: 'set-tab' },
    setSec('ci-cost', 'Kosten', 'Vergleichswerte und Strom', () => tabCosts(), true),
    setSec('ci-about', 'Über LLM Box', 'Version und Lizenz', () => tabAbout())
  );
}

/* Alte Reiter-Kennungen → neuer Reiter + Abschnitt (damit bestehende Aufrufe wie openSettings('ws') weiter funktionieren) */
const SETTINGS_ALIAS = {
  conn: ['conn', null], model: ['ai', 'ai-model'], auto: ['ai', 'ai-auto'],
  look: ['look', 'lk-look'], modules: ['look', 'lk-mod'],
  ws: ['work', 'wk-files'], prompts: ['abilities', 'ab-prompts'], know: ['abilities', 'ab-know'], web: ['abilities', 'ab-web'],
  live: ['data', 'dv-live'], transfer: ['data', 'dv-tr'], data: ['data', 'dv-data'], cost: ['cost', 'ci-cost'], about: ['cost', 'ci-about'],
  server: ['strata', 'sv-launch'], mcp: ['abilities', 'ab-mcp'], strata: ['strata', 'sv-launch'], project: ['work', 'wk-proj'], skills: ['abilities', 'ab-skills'],
};

/* Suche über alle Einstellungen: baut jeden Abschnitt einmal, filtert die Zeilen (.frow) nach Text und zeigt Treffer samt ihrer echten Bedienelemente. */
function settingsSearch(tabs, q, pane) {
  const needle = q.trim().toLowerCase();
  pane.innerHTML = '';
  const out = el('div', { class: 'set-tab set-found' });
  let total = 0;
  for (const t of tabs) {
    let probe;
    try { probe = t.fn(); } catch { continue; }
    const secs = probe.querySelectorAll ? [...probe.querySelectorAll('details.set-sec')] : [];
    const groups = secs.length ? secs : [probe];
    for (const g of groups) {
      if (g.__build) g.__build();
      const rows = [...g.querySelectorAll('.frow')].filter((r) => r.textContent.toLowerCase().includes(needle));
      if (!rows.length) continue;
      const title = secs.length ? g.querySelector('.ss-title').textContent : '';
      out.append(el('div', { class: 'found-head', text: T(t.label) + (title && title !== T(t.label) ? ' › ' + title : '') }));
      rows.forEach((r) => out.append(r));
      total += rows.length;
    }
  }
  if (!total) out.append(el('div', { class: 'fhint', style: { padding: '16px 0' }, text: 'Keine Einstellung gefunden.' }));
  pane.append(out);
}

/* Zeilen eines Reiters „Gefunden“ liegen im Suchergebnis; Rückkehr: Suchfeld leeren */
