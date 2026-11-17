/* Extrahiert alle deutschen Bildschirm-Texte mit Datei:Zeile fuer die Uebersetzungsdatenbank.
   Nur lesend. Aufruf: node tools-android\i18n-extrakt.js > tools-android\i18n-fundliste.txt */
const fs = require('fs');
const path = require('path');

const BASIS = path.join(__dirname, '..', 'llm-box', 'renderer');
const ANDROID = path.join(__dirname, '..');

const DE_WORTER = /\b(der|die|das|und|oder|mit|für|nicht|kein|keine|Chat|Chats|Ordner|Datei|Dateien|Einstellungen|Speichern|Abbrechen|Schließen|laden|wählen|setzen|prüfen|Prüfen|Test|Verbindung|Modell|Workspace|übernehmen|entfernen|hinzufügen|bearbeiten|umbenennen|kopieren|verschieben|größer|kleiner|Sekunden|Minuten|Token|Nachricht|Nachrichten|antworten|Sprache|Rechner|Netzwerk|Passwort|Benutzer|starten|stoppen|öffnen|fenster|anzeigen|verbergen|suchen|abrufen|anbieten|importieren|exportieren|gelöscht|gespeichert|fehler|fehlgeschlagen|erforderlich|maximal|minimal|Standard|aktiv|deaktiviert)\b/i;
const UMLAUTE = /[äöüÄÖÜß]/;

function stringsOf(line) {
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\)*)`|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  return out;
}

function isUi(s) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (/^[.#&>?[\](){}|\\/^*+\-\s:=,;%!$@<>~`]+$/.test(t)) return false;
  if (/\.(js|css|html|json|png|svg|ico|md|txt|exe|apk)$/i.test(t)) return false;
  if (/^(#[0-9a-fA-F]{3,8}|rgba?\(|var\(--|linear-gradient|url\()/.test(t)) return false;
  if (/^(https?:|data:|file:|\\\\|[A-Z]:\\|\.\.?[\\/])/.test(t)) return false;
  if (/^[a-z0-9_.:-]+$/i.test(t) && !DE_WORTER.test(t)) return false;
  if (/^[\x00-\x20]*$/.test(t)) return false;
  // CSS-Regeln, Selektoren, Befehle, Pfade, Regex-Reste aussortieren
  if (/[{};]/.test(t) && /(^|\)\s*)\{|\}$/.test(t)) return false;
  if (/^[\w.-]+\s*\(/.test(t) && !UMLAUTE.test(t)) return false;
  if (!UMLAUTE.test(t) && !DE_WORTER.test(t)) return false;
  // reiner Code-Bezeichner mit Punkt (z. B. settings.appearance)
  if (/^[a-zA-Z_][\w.]*$/.test(t)) return false;
  return true;
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); }
    else if (/\.(js|html)$/.test(e.name)) files.push(p);
  }
})(BASIS);
files.push(path.join(ANDROID, 'tools-android', 'android-adapter.js'));

const funde = new Map();   // text -> [{datei, zeile}]
for (const f of files) {
  const rel = path.relative(BASIS, f).replace(/\\/g, '/');
  let inBlockComment = false;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (inBlockComment) { if (trimmed.includes('*/')) inBlockComment = false; return; }
    if (trimmed.startsWith('/*')) { if (!trimmed.includes('*/')) inBlockComment = true; return; }
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) return;
    for (const s of stringsOf(line)) {
      if (!isUi(s)) continue;
      const key = s.replace(/\s+/g, ' ').trim();
      if (!funde.has(key)) funde.set(key, []);
      funde.get(key).push(rel + ':' + (i + 1));
    }
  });
}

// Ausgabe 1: menschenlesbare Liste, gruppiert nach Datei (Reihenfolge = Quelltext)
console.log('# Fundliste deutscher Bildschirmtexte  (' + funde.size + ' eindeutige Texte)');
const proDatei = new Map();
for (const [txt, orte] of funde) {
  const datei = orte[0].split(':')[0];
  if (!proDatei.has(datei)) proDatei.set(datei, []);
  proDatei.get(datei).push([txt, orte]);
}
for (const [datei, liste] of [...proDatei.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log('\n=== ' + datei + '  (' + liste.length + ') ===');
  for (const [txt, orte] of liste) {
    console.log(JSON.stringify(txt) + '   <<  ' + orte.slice(0, 2).join(', ') + (orte.length > 2 ? ' +' + (orte.length - 2) : ''));
  }
}

// Ausgabe 2: Maschinenlesbare Schluessel fuer die Abdeckungstests
const jsonPfad = path.join(__dirname, 'i18n-schluessel.json');
fs.writeFileSync(jsonPfad, JSON.stringify([...funde.keys()], null, 1), 'utf8');

// Ausgabe 3: je Datei eine reine Textliste (eine Zeile pro Schluessel) fuer die Uebersetzung
const ordner = path.join(__dirname, 'sprachen');
fs.mkdirSync(ordner, { recursive: true });
for (const [datei, liste] of proDatei) {
  const name = datei.replace(/\\/g, '_').replace(/\//g, '_') + '.txt';
  fs.writeFileSync(path.join(ordner, name), liste.map(([t]) => t).join('\n'), 'utf8');
}
console.log('\n# Schluessel geschrieben nach ' + jsonPfad + ' und ' + ordner);
