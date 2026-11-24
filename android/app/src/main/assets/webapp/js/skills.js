'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   skills.js  –  Skills (Version 1.0.84)

   Skills sind wiederverwendbare Arbeitsanleitungen (wie die „Skills“ der Claude-Desktop-App): ein Name, eine kurze Beschreibung und die
   ausführliche Anleitung. Damit das Modell nicht jedes Mal alles im Prompt bekommt, gilt „schrittweise Offenlegung“:
     - Im Systemprompt steht nur eine Liste (Name + eine Zeile Beschreibung, ca. 25 Tokens je Skill).
     - Passt ein Skill zur Aufgabe, ruft das Modell das Werkzeug use_skill auf und erhält erst dann die ganze Anleitung.
   Das spart Kontext und Zeit und lenkt das Modell, ohne den Prompt aufzublähen.
   Skills lassen sich anlegen, bearbeiten, ein- und ausschalten sowie als SKILL.md importieren und exportieren
   (Format: Kopfzeile --- name: …  description: … ---, danach die Anleitung).
   ══════════════════════════════════════════════════════════════════════════ */

const SKILL_BUILTINS = [
  { key: 'review',
    de: { name: 'code-pruefen', description: 'Code oder Änderungen gründlich prüfen: Fehler, Randfälle, Sicherheit, Lesbarkeit.', body: 'Ziel: Fehler finden, bevor sie wirken.\n1. Lies zuerst die betroffenen Dateien und Änderungen, nicht raten.\n2. Prüfe der Reihe nach: Logikfehler und Randfälle (leere Eingaben, Grenzwerte), Fehlerbehandlung, Sicherheit (Eingaben, Pfade, Geheimnisse), Namen und Lesbarkeit.\n3. Nenne jeden Fund mit Datei:Zeile, kurzer Begründung und einem konkreten Verbesserungsvorschlag.\n4. Sortiere nach Schwere (kritisch, wichtig, Kleinigkeit). Sage klar, was du NICHT geprüft hast.\n5. Ändere nichts, solange der Nutzer es nicht verlangt.' },
    en: { name: 'code-review', description: 'Review code or changes thoroughly: bugs, edge cases, security, readability.', body: 'Goal: find mistakes before they matter.\n1. First read the affected files and changes; do not guess.\n2. Check in order: logic errors and edge cases (empty input, limits), error handling, security (inputs, paths, secrets), naming and readability.\n3. Report every finding with file:line, a short reason and a concrete suggestion.\n4. Sort by severity (critical, important, minor). Say clearly what you did NOT check.\n5. Do not change anything unless the user asks.' },
    fr: { name: 'revue-de-code', description: 'Examiner le code ou les modifications à fond : bogues, cas limites, sécurité, lisibilité.', body: 'Objectif : trouver les erreurs avant qu’elles ne comptent.\n1. Lisez d’abord les fichiers et modifications concernés ; ne devinez pas.\n2. Vérifiez dans l’ordre : erreurs de logique et cas limites (entrées vides, bornes), gestion des erreurs, sécurité (entrées, chemins, secrets), noms et lisibilité.\n3. Indiquez chaque constat avec fichier:ligne, une brève raison et une proposition concrète.\n4. Classez par gravité (critique, important, mineur). Dites clairement ce que vous n’avez PAS vérifié.\n5. Ne modifiez rien sans demande de l’utilisateur.' } },
  { key: 'debug',
    de: { name: 'fehlersuche', description: 'Einen Fehler systematisch eingrenzen und beheben, statt Änderungen zu raten.', body: 'Ziel: Ursache finden, dann gezielt beheben.\n1. Fehlermeldung und erwartetes Verhalten wörtlich festhalten.\n2. Mit search_text und read_file die Stelle finden, an der der Fehler entsteht. Lies den Code, bevor du etwas änderst.\n3. Formuliere höchstens drei Hypothesen und prüfe sie einzeln, die wahrscheinlichste zuerst.\n4. Ändere genau eine Sache pro Versuch und prüfe das Ergebnis. Schlägt ein Ansatz zweimal fehl, wechsle den Ansatz oder frage nach.\n5. Schließe ab mit: Ursache, Änderung (Datei:Zeile), wie du es geprüft hast.' },
    en: { name: 'debugging', description: 'Narrow down and fix a bug systematically instead of guessing changes.', body: 'Goal: find the cause, then fix it precisely.\n1. Write down the error message and expected behaviour verbatim.\n2. Use search_text and read_file to find where the error arises. Read the code before changing anything.\n3. Form at most three hypotheses and test them one by one, most likely first.\n4. Change exactly one thing per attempt and check the result. If an approach fails twice, change the approach or ask.\n5. Finish with: cause, change (file:line), how you verified it.' },
    fr: { name: 'depannage', description: 'Cerner et corriger un bogue méthodiquement au lieu de deviner des modifications.', body: 'Objectif : trouver la cause, puis corriger précisément.\n1. Notez mot pour mot le message d’erreur et le comportement attendu.\n2. Avec search_text et read_file, trouvez l’endroit où l’erreur apparaît. Lisez le code avant de modifier quoi que ce soit.\n3. Formulez trois hypothèses au plus et testez-les une à une, la plus probable d’abord.\n4. Ne changez qu’une chose par essai et vérifiez le résultat. Si une approche échoue deux fois, changez d’approche ou demandez.\n5. Terminez par : cause, modification (fichier:ligne), comment vous l’avez vérifié.' } },
  { key: 'research',
    de: { name: 'recherche', description: 'Eine Frage mit Quellen recherchieren und belegt beantworten (braucht Websuche).', body: 'Ziel: belegte Antwort statt Vermutung.\n1. Zerlege die Frage in 2 bis 4 Suchanfragen und nutze web_search.\n2. Öffne nur die wichtigsten Treffer mit fetch_url und lies sie, bevor du sie zitierst.\n3. Gib jede Aussage mit Quelle (Adresse) an. Widersprüche zwischen Quellen nennst du offen.\n4. Trenne klar: gesichert, wahrscheinlich, unklar. Erfinde keine Zahlen, Zitate oder Adressen.\n5. Schließe mit einer kurzen Zusammenfassung und einer Liste der Quellen.' },
    en: { name: 'research', description: 'Research a question with sources and answer with evidence (needs web search).', body: 'Goal: an evidenced answer instead of a guess.\n1. Split the question into 2 to 4 search queries and use web_search.\n2. Open only the most important hits with fetch_url and read them before you cite them.\n3. Give every statement with its source (address). Name contradictions between sources openly.\n4. Separate clearly: established, likely, unclear. Do not invent numbers, quotes or addresses.\n5. Finish with a short summary and a list of sources.' },
    fr: { name: 'recherche', description: 'Rechercher une question avec des sources et répondre de façon étayée (nécessite la recherche web).', body: 'Objectif : une réponse étayée plutôt qu’une supposition.\n1. Découpez la question en 2 à 4 requêtes et utilisez web_search.\n2. N’ouvrez que les résultats les plus importants avec fetch_url et lisez-les avant de les citer.\n3. Donnez chaque affirmation avec sa source (adresse). Signalez ouvertement les contradictions entre sources.\n4. Séparez clairement : établi, probable, incertain. N’inventez ni chiffres, ni citations, ni adresses.\n5. Terminez par un bref résumé et la liste des sources.' } },
  { key: 'startproject',
    de: { name: 'projekt-aufsetzen', description: 'Ein neues Projekt sinnvoll strukturieren: Ordner, PROJEKT.md, erste Schritte.', body: 'Ziel: ein aufgeräumtes Projekt, in dem später nichts durcheinandergerät.\n1. Kläre mit ask_user knapp das Ziel, die Sprache oder das Werkzeug und das gewünschte Ergebnis, falls das nicht klar ist.\n2. Lege eine einfache Struktur an (z. B. src/, docs/, out/) und nur die Dateien, die wirklich gebraucht werden.\n3. Trage Ziel und Regeln in PROJEKT.md ein (kurz, höchstens 15 Zeilen).\n4. Nenne am Ende die Struktur als Liste und den ersten sinnvollen Schritt.\n5. Lege alle neuen Dateien in diesem Projektordner ab, nie darüber hinaus.' },
    en: { name: 'project-setup', description: 'Structure a new project sensibly: folders, PROJEKT.md, first steps.', body: 'Goal: a tidy project in which nothing gets mixed up later.\n1. If unclear, briefly clarify with ask_user the goal, the language or tool and the desired result.\n2. Create a simple structure (e.g. src/, docs/, out/) and only the files that are really needed.\n3. Write goal and rules into PROJEKT.md (short, at most 15 lines).\n4. At the end give the structure as a list and the first sensible step.\n5. Put all new files in this project folder, never beyond it.' },
    fr: { name: 'demarrage-projet', description: 'Structurer un nouveau projet de façon sensée : dossiers, PROJEKT.md, premières étapes.', body: 'Objectif : un projet ordonné où rien ne se mélange plus tard.\n1. Si ce n’est pas clair, clarifiez brièvement avec ask_user l’objectif, le langage ou l’outil et le résultat souhaité.\n2. Créez une structure simple (p. ex. src/, docs/, out/) et uniquement les fichiers vraiment nécessaires.\n3. Inscrivez l’objectif et les règles dans PROJEKT.md (court, 15 lignes au plus).\n4. À la fin, donnez la structure sous forme de liste et la première étape utile.\n5. Placez tous les nouveaux fichiers dans ce dossier de projet, jamais au-delà.' } },
];

const skillLang = () => (['de', 'en', 'fr'].includes(S.settings.uiLang) ? S.settings.uiLang : 'de');
const skillCfg = () => S.settings.skills || (S.settings.skills = { enabled: true, items: [] });

/* Anzeigewerte: Standard-Skills folgen der Sprache, solange sie nicht bearbeitet wurden. */
function skillView(it) {
  if (it.builtin && !it.edited) {
    const b = SKILL_BUILTINS.find((x) => x.key === it.builtin);
    if (b) return { ...it, ...(b[skillLang()] || b.de) };
  }
  return it;
}
const skillSlug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function skillSeed() {
  const c = skillCfg();
  const have = new Set(c.items.map((i) => i.builtin).filter(Boolean));
  for (const b of SKILL_BUILTINS) if (!have.has(b.key)) c.items.push({ id: uid(), builtin: b.key, enabled: true });
}
/* Welche Skills in diesem Chat gelten: nur mit Dateizugriff oder wenn „Skills auch im normalen Chat“ an ist.
   Grund: Skills brauchen das Werkzeug use_skill. Modelle ohne Werkzeug-Unterstützung würden im normalen Chat sonst Fehler melden. */
const skillsFor = (chat) => {
  const c = skillCfg();
  if (c.enabled === false) return [];
  if (!(c.plainChat === true || (typeof useTools === 'function' && useTools(chat)))) return [];
  return skillsActive();
};
const skillsActive = () => { const c = skillCfg(); return c.enabled !== false ? c.items.filter((i) => i.enabled !== false).map(skillView).filter((i) => i.name && i.body) : []; };

const SKILL_TOOL_DESC = {
  de: 'Lädt die ausführliche Anleitung (Skill) mit diesem Namen. Rufe es auf, bevor du eine Aufgabe beginnst, zu der ein Skill der Liste passt, und befolge die Anleitung.',
  en: 'Loads the detailed instructions (skill) with this name. Call it before you start a task for which a skill in the list fits, and follow the instructions.',
  fr: 'Charge les instructions détaillées (skill) portant ce nom. Appelez-le avant de commencer une tâche à laquelle correspond un skill de la liste, et suivez les instructions.',
};
const SKILL_ARG_DESC = { de: 'Name des Skills aus der Liste', en: 'Name of the skill from the list', fr: 'Nom du skill de la liste' };
const SKILL_HEAD = {
  de: 'SKILLS: Anleitungen für wiederkehrende Aufgaben. Passt einer zur Aufgabe, lade ihn zuerst mit use_skill und befolge ihn.',
  en: 'SKILLS: instructions for recurring tasks. If one fits the task, load it first with use_skill and follow it.',
  fr: 'SKILLS : instructions pour des tâches récurrentes. Si l’un convient à la tâche, chargez-le d’abord avec use_skill et suivez-le.',
};

function skillTools(base, chat) {
  if (!skillsFor(chat).length) return base;
  const l = skillLang();
  const t = { type: 'function', function: { name: 'use_skill', description: SKILL_TOOL_DESC[l], parameters: { type: 'object', properties: { name: { type: 'string', description: SKILL_ARG_DESC[l] } }, required: ['name'] } } };
  return [...(base || []), t];
}
/* Liste für den Systemprompt: nur Name und eine Zeile, höchstens 15 Skills. */
function skillSystem(chat) {
  const list = skillsFor(chat).slice(0, 15);
  if (!list.length) return '';
  return '\n\n' + SKILL_HEAD[skillLang()] + '\n' + list.map((s) => `- ${s.name}: ${String(s.description || '').replace(/\s+/g, ' ').slice(0, 140)}`).join('\n');
}
function skillRun(tc, base) {
  const want = String((tc.args && tc.args.name) || '').trim();
  const all = skillsActive();
  const hit = all.find((s) => s.name === want) || all.find((s) => skillSlug(s.name) === skillSlug(want));
  if (!hit) return { ...base, ok: false, content: `Skill „${want}“ gibt es nicht. Vorhanden: ${all.map((s) => s.name).join(', ') || '(keine)'}.` };
  return { ...base, ok: true, content: `# ${hit.name}\n\n${String(hit.body).slice(0, 6000)}` };
}

/* ───── SKILL.md lesen und schreiben ───── */
function skillParse(text, fallbackName) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(t);
  let name = '', description = '', body = t;
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      const kv = /^\s*([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
      if (!kv) continue;
      const v = kv[2].trim().replace(/^["']|["']$/g, '');
      if (kv[1].toLowerCase() === 'name') name = v;
      else if (kv[1].toLowerCase() === 'description') description = v;
    }
  }
  if (!name) name = skillSlug(fallbackName || 'skill') || 'skill';
  if (!description) description = String(body).trim().split('\n').find((l) => l.trim() && !l.startsWith('#')) || '';
  return { name, description: description.slice(0, 300), body: body.trim() };
}
const skillFile = (s) => `---\nname: ${s.name}\ndescription: ${String(s.description || '').replace(/\n/g, ' ')}\n---\n\n${s.body}\n`;

/* ───── Oberfläche ───── */
function skillEdit(it, done) {
  const v = skillView(it || { name: '', description: '', body: '' });
  const name = el('input', { type: 'text', value: v.name || '', placeholder: 'z. B. code-pruefen' });
  const desc = el('input', { type: 'text', value: v.description || '', placeholder: 'Wann soll das Modell diesen Skill laden? Eine Zeile.' });
  const body = el('textarea', { rows: 12 });
  body.value = v.body || '';
  const m = openModal({
    title: it ? 'Skill bearbeiten' : 'Neuer Skill', wide: true,
    body: el('div', {}, frow('Name', 'Kurz, ohne Leerzeichen (wird dem Modell als Kennung genannt).', name), frow('Beschreibung', 'Eine Zeile: Wann passt der Skill? Sie steht immer im Prompt, deshalb kurz halten.', desc), frow('Anleitung', 'Wird erst geladen, wenn das Modell den Skill aufruft. Schritt für Schritt, konkret, ohne Ausschweifung.', body, true)),
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', primary: true, onClick: (close) => {
      const n = skillSlug(name.value) || name.value.trim();
      if (!n || !body.value.trim()) { toast('Name und Anleitung dürfen nicht leer sein.'); return; }
      close({ name: n, description: desc.value.trim(), body: body.value.trim() });
    } }],
    onClose: (r) => { if (r) done(r); },
  });
  return m;
}

function skillsSection() {
  const wrap = el('div', {});
  const c = skillCfg();
  const redraw = () => { if (wrap.isConnected) wrap.replaceWith(skillsSection()); };
  const list = el('div', { class: 'skill-list' });
  c.items.forEach((it) => {
    const v = skillView(it);
    const sw = el('input', { type: 'checkbox' });
    sw.checked = it.enabled !== false;
    sw.addEventListener('change', () => { it.enabled = sw.checked; changed(); });
    list.append(el('div', { class: 'skill-row' },
      el('label', { class: 'switch' }, sw, el('span')),
      el('div', { class: 'skill-main' }, el('b', { text: v.name || '(ohne Name)' }), el('div', { class: 'fhint', text: v.description || '' })),
      el('button', { class: 'btn sm', text: 'Bearbeiten', onclick: () => skillEdit(it, (r) => { Object.assign(it, r, { edited: true }); changed(); redraw(); }) }),
      el('button', { class: 'btn sm', text: 'Exportieren', onclick: async () => { const p = await api.files.saveAs({ defaultName: 'SKILL.md', content: skillFile(v) }); if (p) toast(T('Gespeichert:') + ' ' + p, 4000); } }),
      el('button', { class: 'btn sm danger', text: 'Löschen', onclick: async () => { if (await confirmModal('Skill löschen', `„${v.name}“ wird entfernt.`, { okLabel: 'Löschen', danger: true })) { c.items.splice(c.items.indexOf(it), 1); changed(); redraw(); } } })));
  });
  if (!c.items.length) list.append(el('div', { class: 'fhint', text: 'Noch keine Skills. Lege einen an oder stelle die Standard-Skills wieder her.' }));
  wrap.append(
    frow('Skills verwenden', 'Im Prompt steht nur eine kurze Liste. Passt ein Skill zur Aufgabe, lädt das Modell seine Anleitung mit dem Werkzeug use_skill. Das spart Kontext gegenüber einem langen Prompt. Aus: keine Skills, kein zusätzliches Werkzeug.', bindSwitch('skills.enabled')),
    frow('Skills auch im normalen Chat', 'Standard: Skills gelten, wenn der Dateizugriff an ist. An: auch ohne Dateizugriff. Das Modell muss dann Werkzeuge (Tool Calling) unterstützen, sonst meldet der Server einen Fehler.', bindSwitch('skills.plainChat')),
    list,
    el('div', { class: 'row-gap', style: { padding: '10px 0', flexWrap: 'wrap' } },
      el('button', { class: 'btn sm primary', text: 'Neuer Skill …', onclick: () => skillEdit(null, (r) => { c.items.push({ id: uid(), enabled: true, ...r }); changed(); redraw(); }) }),
      el('button', { class: 'btn sm', text: 'SKILL.md importieren …', onclick: async () => {
        const r = await api.files.pick('files', fileLimits());
        if (!r || !r.files || !r.files.length) return;
        let n = 0;
        for (const f of r.files) { if (f.kind !== 'text' || !f.text) continue; const s = skillParse(f.text, String(f.name || '').replace(/\.[^.]+$/, '')); if (s.body) { c.items.push({ id: uid(), enabled: true, ...s }); n++; } }
        changed(); toast(n ? `${n} Skill(s) importiert.` : 'Keine lesbare SKILL.md gefunden.', 3500); redraw();
      } }),
      el('button', { class: 'btn sm', text: 'Standard-Skills wiederherstellen', onclick: () => { skillSeed(); changed(); redraw(); toast('Standard-Skills sind wieder vorhanden.', 3000); } })),
    el('div', { class: 'fhint', style: { paddingBottom: '6px' }, text: 'Format von SKILL.md: Kopfzeile mit name und description zwischen zwei Zeilen „---“, danach die Anleitung. So lassen sich auch Skills aus anderen Programmen übernehmen.' })
  );
  return wrap;
}
