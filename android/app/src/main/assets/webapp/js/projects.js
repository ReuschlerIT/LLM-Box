'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   projects.js  –  Projekte (Version 1.0.84)

   Problem bis 1.0.83: Ein einziger Workspace-Ordner galt für ALLE Chats. Mehrere Projekte und alle von der KI angelegten Dateien lagen
   unsortiert nebeneinander, die Werkzeuge der KI sahen alles, und der Ordnerinhalt gelangte in jeden Auftrag. Das Modell verwechselte Projekte.

   Jetzt: Der Workspace-Ordner ist nur noch die WURZEL. Jeder Chat arbeitet in genau EINEM Projekt (Unterordner der Wurzel):
     - Die Werkzeuge der KI sehen und ändern nur diesen Ordner (Sandbox = Projektordner, siehe wsRoot).
     - Der Dateibaum rechts zeigt nur das Projekt.
     - Ohne gewähltes Projekt gibt es keine Dateiwerkzeuge und keinen Workspace-Hinweis im Prompt (spart Tokens, nichts kann durcheinandergeraten).
     - Optional liegt im Projektordner eine Datei PROJEKT.md mit Zielen und Regeln; die ersten 1500 Zeichen gehen als Projektanweisung an die KI.
   Alter Zustand: Einstellung „Projektmodus“ aus = ein gemeinsamer Ordner wie bisher; oder pro Chat „Ganzen Workspace verwenden“ (chat.project = '*').
   ══════════════════════════════════════════════════════════════════════════ */

const PROJ_ALL = '*';                 // chat.project: gesamter Workspace-Ordner (alter Zustand)
const PROJ_CACHE = {};                // Chat-ID -> { t, text } (Inhalt von PROJEKT.md, damit buildSystem synchron bleibt)
const PROJ_TEXT_MAX = 1500;

const projMode = () => !!(S.settings.workspace && S.settings.workspace.projectMode !== false);

/* Der Ordner, in dem die Werkzeuge dieses Chats arbeiten ('' = keiner). */
function wsRoot(chat) {
  const ws = S.settings.workspace;
  if (!ws || !ws.path) return '';
  const c = chat || S.chat;
  if (!projMode()) return ws.path;
  if (c && c.project === PROJ_ALL) return ws.path;
  if (c && c.project) return joinPath(ws.path, c.project);
  return '';
}

const projName = (chat) => {
  const c = chat || S.chat;
  if (!c || !c.project) return '';
  return c.project === PROJ_ALL ? T('(ganzer Workspace)') : c.project;
};

/* Der Chat will Dateizugriff, hat aber noch kein Projekt. */
function projNeeded(chat) {
  const c = chat || S.chat;
  const ws = S.settings.workspace;
  if (!c || !projMode() || !ws.path || c.project) return false;
  const wish = typeof c.tools === 'boolean' ? c.tools : ws.toolsEnabled;
  return !!wish;
}

const projTemplate = (name) => `# ${name}

## Ziel
(Was soll in diesem Projekt entstehen? Ein bis drei Sätze.)

## Regeln
- Arbeite nur in diesem Projektordner.
- Neue Dateien in passende Unterordner legen (z. B. src/, docs/, out/), nichts lose im Wurzelordner verstreuen.

## Stand
(Die KI trägt hier kurz ein, was erledigt ist und was als Nächstes kommt.)
`;

async function projList() {
  const ws = S.settings.workspace;
  if (!ws.path) return [];
  try {
    const items = await api.ws.list({ root: ws.path, rel: '', ignore: ignoreList() });
    return items.filter((i) => i.isDir && !/^[._]/.test(i.name)).map((i) => i.name);
  } catch { return []; }
}

async function projCreate(name) {
  const ws = S.settings.workspace;
  if (!api.ws || typeof api.ws.mkdir !== 'function') throw new Error('Projekte sind auf diesem Geraet nicht verfuegbar.');
  const r = await api.ws.mkdir({ root: ws.path, name, readme: projTemplate(String(name).trim()) });
  if (!r || !r.ok) throw new Error((r && r.error) || 'Ordner konnte nicht angelegt werden');
  return r.name;
}

function projSet(chat, name) {
  const c = chat || S.chat;
  if (!c) return;
  c.project = name || '';
  delete PROJ_CACHE[c.id];
  if (typeof saveChatSoon === 'function') saveChatSoon(c);
  if (typeof updateToolsBtn === 'function') updateToolsBtn();
  if (typeof renderFilePanel === 'function') renderFilePanel();
}

/* Auswahl-Dialog. Liefert true, wenn ein Projekt gewählt wurde. */
async function projPick(chat) {
  const c = chat || S.chat;
  const ws = S.settings.workspace;
  if (!ws.path) {
    toast('Wähle zuerst einen Workspace-Ordner.');
    openSettings('work');
    return false;
  }
  const names = await projList();
  return new Promise((resolve) => {
    let m = null;
    const choose = (n) => { projSet(c, n); if (m) m.close(true); };
    const list = el('div', { class: 'proj-list' });
    names.forEach((n) => list.append(el('button', { class: 'proj-item' + (c && c.project === n ? ' active' : ''), onclick: () => choose(n) }, el('span', { html: icon('folder', 15) }), el('span', { text: n }))));
    if (!names.length) list.append(el('div', { class: 'fhint', text: 'Noch kein Projekt im Workspace-Ordner. Lege unten das erste an.' }));
    const input = el('input', { type: 'text', placeholder: 'Name des neuen Projekts' });
    const create = async () => {
      const n = input.value.trim();
      if (!n) return;
      try { choose(await projCreate(n)); } catch (e) { toast('Projekt konnte nicht angelegt werden: ' + e.message, 6000); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    const body = el('div', {},
      el('div', { class: 'fhint', style: { paddingBottom: '8px' }, text: 'Die KI sieht und ändert nur den gewählten Projektordner. So bleiben Projekte getrennt und der Auftrag enthält nur, was dazugehört.' }),
      list,
      el('h3', { text: 'Neues Projekt' }),
      el('div', { class: 'proj-new' }, input, el('button', { class: 'btn primary', text: 'Anlegen', onclick: create })),
      el('div', { style: { marginTop: '14px' } }, el('button', { class: 'btn sm', text: 'Ganzen Workspace verwenden (nicht empfohlen)', title: 'Alle Projekte und Dateien des Workspace-Ordners sind für die KI sichtbar (alter Zustand).', onclick: () => choose(PROJ_ALL) })));
    m = openModal({ title: 'Projekt wählen', body, onClose: (r) => resolve(r === true) });
    setTimeout(() => input.focus(), 50);
  });
}

/* Projektanweisungen (PROJEKT.md) laden. Asynchron, das Ergebnis liegt im Cache und wird von projSystem() synchron gelesen. */
async function projLoad(chat) {
  const c = chat || S.chat;
  if (!c || !c.project || c.project === PROJ_ALL || !projMode()) return;
  if (S.settings.workspace.projectInstructions === false) { PROJ_CACHE[c.id] = { t: Date.now(), text: '' }; return; }
  const ent = PROJ_CACHE[c.id];
  if (ent && Date.now() - ent.t < 15000) return;
  let text = '';
  try {
    const r = await api.files.read([joinPath(wsRoot(c), 'PROJEKT.md')], { maxKB: 64, maxFiles: 1, maxTotalKB: 64, ignore: [] });
    const f = r && r.files && r.files[0];
    if (f && f.kind === 'text' && f.text) text = f.text;
  } catch { /* keine PROJEKT.md */ }
  PROJ_CACHE[c.id] = { t: Date.now(), text: text.trim().slice(0, PROJ_TEXT_MAX) };
}

const PROJ_TXT = {
  de: (n, t) => `\n\nPROJEKT: ${n}. Du arbeitest ausschließlich in diesem Projektordner. Lege neue Dateien in passenden Unterordnern ab und halte den Ordner aufgeräumt.${t ? `\nProjektanweisungen (PROJEKT.md):\n${t}` : ''}`,
  en: (n, t) => `\n\nPROJECT: ${n}. You work exclusively in this project folder. Put new files in suitable subfolders and keep the folder tidy.${t ? `\nProject instructions (PROJEKT.md):\n${t}` : ''}`,
  fr: (n, t) => `\n\nPROJET : ${n}. Vous travaillez exclusivement dans ce dossier de projet. Rangez les nouveaux fichiers dans des sous-dossiers adaptés et gardez le dossier ordonné.${t ? `\nInstructions du projet (PROJEKT.md) :\n${t}` : ''}`,
};
/* Text für den Systemprompt (nur wenn Werkzeuge an sind und ein Projekt gewählt ist). */
function projSystem(chat) {
  const c = chat || S.chat;
  if (!c || !projMode() || !c.project || c.project === PROJ_ALL) return '';
  const lang = (S.settings.uiLang || 'de');
  const ent = PROJ_CACHE[c.id];
  return (PROJ_TXT[lang] || PROJ_TXT.de)(c.project, ent ? ent.text : '');
}

/* Knopf „Projekt“ neben dem Dateizugriff-Knopf. */
function projUpdateChip() {
  const tb = document.querySelector('#btn-tools');
  if (!tb) return;
  let b = document.querySelector('#btn-proj');
  const ws = S.settings.workspace;
  const show = !!(ws.path && projMode());
  if (!show) { if (b) b.style.display = 'none'; return; }
  if (!b) {
    b = el('button', { id: 'btn-proj', class: 'chip-btn', onclick: () => projPick(S.chat) });
    tb.insertAdjacentElement('afterend', b);
  }
  b.style.display = '';
  const c = S.chat;
  const name = c && c.project ? projName(c) : '';
  const need = projNeeded(c);
  b.classList.toggle('on', !!name);
  b.classList.toggle('warn', need);
  b.title = T('Projekt dieses Chats: Die KI arbeitet nur in diesem Ordner. Klicken zum Wechseln oder Anlegen.');
  b.innerHTML = icon('folder', 15) + '<span>' + esc2(name ? T('Projekt: ') + name : (need ? T('Projekt wählen') : T('Kein Projekt'))) + '</span>';
}
const esc2 = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/* Dateibaum ohne Projekt: Projektliste statt Ordnerinhalt */
async function projPanelFill(tree) {
  tree.innerHTML = '';
  const names = await projList();
  const c = S.chat;
  tree.append(el('div', { class: 'fp-empty' }, c ? 'Dieser Chat hat noch kein Projekt. Wähle eines, damit die KI nur dort arbeitet.' : 'Öffne einen Chat und wähle ein Projekt.'));
  if (c) {
    const list = el('div', { class: 'proj-list', style: { padding: '0 12px' } });
    names.forEach((n) => list.append(el('button', { class: 'proj-item', onclick: () => projSet(c, n) }, el('span', { html: icon('folder', 15) }), el('span', { text: n }))));
    tree.append(list, el('div', { style: { padding: '10px 12px' } }, el('button', { class: 'btn sm primary', text: 'Projekt wählen oder anlegen …', onclick: () => projPick(c) })));
  }
}

/* Einstellungen: Abschnitt „Projekte“ */
function projSettingsSection() {
  const w = S.settings.workspace;
  return el('div', {},
    frow('Projektmodus', 'Der Workspace-Ordner ist die Wurzel, jeder Chat arbeitet in genau einem Projekt (Unterordner). Die KI sieht nur dieses Projekt, andere Projekte und lose Dateien bleiben außen vor. Aus: ein gemeinsamer Ordner für alle Chats wie bisher.', bindSwitch('workspace.projectMode')),
    frow('Projektanweisungen lesen', 'Liegt im Projektordner eine Datei PROJEKT.md, gehen ihre ersten 1500 Zeichen als Projektanweisung an die KI. Beim Anlegen eines Projekts wird eine Vorlage erzeugt.', bindSwitch('workspace.projectInstructions')),
    frow('Dateizugriff für neue Chats', 'Aus: Neue Chats starten ohne Dateizugriff und ohne Workspace-Hinweis im Prompt. Du schaltest ihn pro Chat ein (Knopf „Dateizugriff“) und wählst dann das Projekt. Das hält einfache Fragen schnell und frei von Projektinhalten.', bindSwitch('workspace.toolsEnabled')),
    w.path ? el('div', { class: 'row-gap', style: { padding: '8px 0' } }, el('button', { class: 'btn sm', text: 'Projekt dieses Chats wählen …', onclick: () => projPick(S.chat) })) : null
  );
}
