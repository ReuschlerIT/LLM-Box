'use strict';
/* ═════════════ Module: alles frei ein- und ausschaltbar ═════════════
   Jede Funktion und jedes Bedienelement steht hier einmal. Ausgeschaltet wird es ausgeblendet (Oberfläche) bzw. nicht mehr benutzt (Funktion).
   Die Einstellungen bleiben erhalten, nichts wird gelöscht. Profile („Schlicht“, „Standard“, „Alles“) setzen viele Schalter auf einmal. */

const MODULE_GROUPS = [
  { id: 'top', label: 'Obere Leiste' },
  { id: 'composer', label: 'Eingabefeld' },
  { id: 'side', label: 'Seitenleisten und Anzeigen' },
  { id: 'ext', label: 'Erweiterungen' },
];
// sel: Elemente, die bei „aus“ verschwinden. fx: reine Funktion (kein Element). def: Voreinstellung.
const MODULES = [
  { id: 'agents', g: 'top', label: 'Unteragenten', desc: 'Knopf „Unteragenten“: wer arbeitet woran.', sel: ['#btn-agents'] },
  { id: 'server', g: 'top', label: 'Server & Monitor', desc: 'Knopf „Server“ zum Starten, Laden und Überwachen des Modell-Servers (Strata).', sel: ['#btn-server'] },
  { id: 'monitor', g: 'top', label: 'Monitor-Dock', desc: 'Knopf und Anzeige „Monitor“ unter dem Workspace-Panel.', sel: ['#btn-monitor', '.fp-dock'] },
  { id: 'handoff', g: 'top', label: 'Kontext leeren / Übergabe', desc: 'Knopf oben rechts, der den Kontext leert und eine Übergabe mitnimmt.', sel: ['#btn-handoff'] },
  { id: 'export', g: 'top', label: 'Chat exportieren', desc: 'Knopf zum Speichern als JSON oder Markdown.', sel: ['#btn-export'] },
  { id: 'panel', g: 'top', label: 'Workspace-Panel', desc: 'Dateibaum rechts (blendet auch das Monitor-Dock aus).', sel: ['#btn-panel', '#filepanel'] },
  { id: 'ctxmeter', g: 'top', label: 'Kontextanzeige', desc: 'Balken „Kontextfenster“ oben rechts.', sel: ['#ctx-meter'] },
  { id: 'refresh', g: 'top', label: 'Modelle neu laden', desc: 'Knopf neben der Modellauswahl.', sel: ['#btn-refresh'] },

  { id: 'attach', g: 'composer', label: 'Dateien und Ordner anhängen', desc: 'Büroklammer und Ordner-Knopf.', sel: ['#btn-attach', '#btn-attach-folder'] },
  { id: 'think', g: 'composer', label: 'Denkaufwand', desc: 'Auswahl, wie lange das Modell nachdenken soll.', sel: ['#btn-think'] },
  { id: 'tools', g: 'composer', label: 'KI-Dateizugriff und Freigaben', desc: 'Schalter für Datei-Werkzeuge und die Freigaben pro Chat.', sel: ['#btn-tools', '#btn-perm'] },
  { id: 'tokens', g: 'composer', label: 'Token-Schätzung', desc: 'Zahl neben dem Senden-Knopf.', sel: ['#token-estimate'] },

  { id: 'search', g: 'side', label: 'Chat-Suche', desc: 'Suchfeld über der Chatliste.', sel: ['#sidebar .search'] },
  { id: 'import', g: 'side', label: 'Chats importieren', desc: 'Knopf unten in der Seitenleiste (z. B. aus der Strata-Weboberfläche).', sel: ['#btn-import'] },
  { id: 'connstatus', g: 'side', label: 'Verbindungsstatus', desc: 'Punkt und Text unten in der Seitenleiste.', sel: ['#conn-status'] },
  { id: 'brand', g: 'side', label: 'Markenzeile', desc: 'Copyright-Zeile unten in der Seitenleiste.', sel: ['.brand-foot'] },
  { id: 'statusbar', g: 'side', label: 'Statusleiste', desc: 'Zeile ganz unten mit Modell und Zustand.', sel: ['#statusbar'] },
  { id: 'live', g: 'side', label: 'Live-Kasten', desc: 'Chats eines anderen Geräts in der Seitenleiste (nur sichtbar, wenn verbunden).', sel: ['#live-box'] },

  { id: 'auto', g: 'ext', label: 'Autonomer Modus', desc: 'Die KI arbeitet vollständig selbstständig (auch über Nacht): keine Rückfragen, Kontext wird selbst geleert. Knopf „Autonom“ im Eingabefeld.', sel: ['#btn-auto', '#auto-strip'] },
  { id: 'prompts', g: 'ext', label: 'Prompt-Bibliothek', desc: 'Eigene Vorlagen, die du mit „/“ im Eingabefeld einfügst.', fx: true },
  { id: 'personas', g: 'ext', label: 'Assistenten', desc: 'Eigene Rollen mit Systemprompt, Modell und Parametern (wie „Modelle“ bei Open WebUI).', sel: ['#btn-persona'] },
  { id: 'memory', g: 'ext', label: 'Gedächtnis', desc: 'Merksätze, die die KI in jedem Chat kennt.', fx: true },
  { id: 'knowledge', g: 'ext', label: 'Wissenssammlungen', desc: 'Eigene Dokumente, aus denen die KI beim Antworten passende Stellen bekommt (lokale Suche, ohne Cloud).', sel: ['#btn-know'] },
  { id: 'websearch', g: 'ext', label: 'Websuche', desc: 'Die KI darf im Internet suchen und Seiten lesen (direkt von diesem Rechner, z. B. über DuckDuckGo; Anbieter einstellbar).', fx: true, def: false },
  { id: 'tts', g: 'ext', label: 'Vorlesen', desc: 'Knopf unter jeder Antwort, der sie vorliest.', fx: true },
  { id: 'organize', g: 'ext', label: 'Chats ordnen', desc: 'Anheften, Archivieren und Markieren (Tags) in der Chatliste.', fx: true },
  { id: 'remote', g: 'ext', label: 'Fernsteuerung in der Live-Ansicht', desc: 'Auf der Live-Quelle: Empfänger dürfen Nachrichten senden und die KI stoppen.', fx: true, def: false },
];
const MODULE_DEF = Object.fromEntries(MODULES.map((m) => [m.id, m.def !== false]));
const modOn = (id) => { const m = S && S.settings && S.settings.modules; return !(m && m[id] === false) && (m && id in m ? !!m[id] : MODULE_DEF[id] !== false); };

// Profile: welche Module sind an?
const MODULE_PROFILES = {
  simple: { label: 'Schlicht', desc: 'Nur Chat: Modellauswahl, Eingabefeld, Chatliste.', on: ['attach', 'search', 'connstatus'] },
  standard: { label: 'Standard', desc: 'Alle bisherigen Bedienelemente, Erweiterungen mit Vorgabe.', on: null },
  all: { label: 'Alles', desc: 'Jedes Modul an.', on: 'all' },
};
function applyModuleProfile(id) {
  const p = MODULE_PROFILES[id];
  if (!p) return;
  const m = (S.settings.modules = {});
  for (const mod of MODULES) m[mod.id] = p.on === 'all' ? true : Array.isArray(p.on) ? p.on.includes(mod.id) : MODULE_DEF[mod.id] !== false;
  saveSettings();
  applyModules();
}

function applyModules() {
  let st = document.getElementById('module-style');
  if (!st) { st = document.createElement('style'); st.id = 'module-style'; document.head.appendChild(st); }
  const css = [];
  for (const m of MODULES) {
    const off = !modOn(m.id);
    document.body.classList.toggle('mod-off-' + m.id, off);
    if (off && m.sel) css.push(m.sel.map((s) => s).join(',') + '{display:none !important}');
  }
  st.textContent = css.join('\n');
  // Workspace-Panel aus: Zustand zurücksetzen, damit beim Wiedereinschalten nichts Halbes steht
  if (!modOn('panel') && S.panelOpen) { S.panelOpen = false; if (typeof renderFilePanel === 'function') renderFilePanel(); }
}

function tabModules() {
  const wrap = el('div');
  function render() {
    wrap.innerHTML = '';
    wrap.append(
      el('div', { class: 'fhint', text: 'Hier schaltest du jede Funktion und jedes Bedienelement der Oberfläche ein oder aus. Ausgeschaltetes wird ausgeblendet; deine Einstellungen dazu bleiben erhalten.' }),
      el('h3', { text: 'Profile' }),
      el('div', { class: 'prof-row' }, Object.entries(MODULE_PROFILES).map(([id, p]) => el('button', { class: 'btn', title: p.desc, text: p.label, onclick: () => { applyModuleProfile(id); render(); } })))
    );
    for (const g of MODULE_GROUPS) {
      wrap.append(el('h3', { text: g.label }));
      for (const m of MODULES.filter((x) => x.g === g.id)) {
        const i = el('input', { type: 'checkbox' });
        i.checked = modOn(m.id);
        i.addEventListener('change', () => {
          S.settings.modules = S.settings.modules || {};
          S.settings.modules[m.id] = i.checked;
          saveSettings();
          applyModules();
          if (typeof settingsChanged === 'function') settingsChanged();
        });
        wrap.append(frow(m.label, m.desc, el('label', { class: 'switch' }, i, el('span'))));
      }
    }
  }
  render();
  return wrap;
}
