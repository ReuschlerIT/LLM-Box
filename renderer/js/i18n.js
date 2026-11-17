'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   i18n.js  –  Sprache der gesamten Oberflaeche (Deutsch / English / Francais)

   Warum so und nicht jeder Text mit einem Schluessel im Code:
   Die Desktop-Quelle wird vom Android-Build (build-android.ps1) mit exakten
   Suchtexten gepatcht, z. B. "Chat: <b>" in der Statuszeile oder
   "theme: 'dark'" in den Vorgaben. Wuerden diese Texte zu Schluesseln umgebaut,
   faende jeder Patch nichts mehr und die APK baute mit altem Verhalten.
   Deshalb bleibt der Quelltext deutsch; uebersetzt wird zur Laufzeit:

     1. Woerterbuch I18N_LEX  : exakter deutscher Text -> [englisch, franzoesisch]
     2. Muster    I18N_PAT    : fuer Texte mit eingebetteten Werten ("12 Dateien")
     3. T(text)               : wandelt einen einzelnen String um
     4. el()/toast()/openModal: rufen T() direkt fuer text, title, placeholder, aria-label
     5. MutationObserver      : erwischt zusaetzlich alles, was per innerHTML oder
                                von android-adapter.js / native-main.js eingefuegt wird

   Chat-Nachrichten werden bewusst NICHT uebersetzt (data-i18n-off am
   Nachrichtenbereich): der Verlauf bleibt so stehen, wie er geschrieben wurde.
   ══════════════════════════════════════════════════════════════════════════ */

const LANGS = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
];

const I18N = {
  lang: 'de',
  busy: false,          // verhindert Rueckkopplung des MutationObservers
};

/* Die Woerterbuecher liegen in i18n-lex*.js und fuellen diese beiden Sammlungen.
   Getrennte Dateien, weil zusammen ueber 800 Eintraege sonst unueberschaubar waeren:
     i18n-lex.js         Grundflaeche, Chatfenster, Dialoge (index.html, app.js, util.js)
     i18n-lex-settings.js  Einstellungen und Server-Fenster
     i18n-lex-extra.js     Uebertragung, Unteragenten, Werkzeuge, Android-Hinweise */
const I18N_LEX = {};
const I18N_PAT = [];

/* Sprache holen/setzen. Wird von app.js nach dem Laden der Einstellungen gesetzt. */
function currentLang() {
  return I18N.lang;
}

/* Uebersetzte Knoten merken ihren deutschen Ursprungstext (Eigenschaft __de).
   Ohne das wuerde ein Wechsel zurueck auf Deutsch den englischen Text stehen lassen,
   weil alle Texte im Quelltext deutsch geschrieben sind und nie neu aufgebaut werden. */
function restoreTree(root) {
  I18N.busy = true;
  try {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      if (n.nodeType === 3) {
        if (typeof n.__de === 'string') { n.__tr = n.__de; n.nodeValue = n.__de; n.__de = null; }
      } else if (n.__deAttrs) {
        n.__trAttrs = n.__trAttrs || {};
        for (const [a, v] of Object.entries(n.__deAttrs)) { n.__trAttrs[a] = v; n.setAttribute(a, v); }
        n.__deAttrs = null;
      }
    }
  } finally {
    I18N.busy = false;
  }
}

function setLang(lang) {
  const want = LANGS.some((l) => l.value === lang) ? lang : 'de';
  const changedLang = want !== I18N.lang;
  // Erst den deutschen Ursprung zurueckholen, dann in die neue Sprache uebertragen.
  if (document.body) restoreTree(document.body);
  I18N.lang = want;
  document.documentElement.setAttribute('lang', want);
  if (document.body) translateTree(document.body);
  applyToolLanguage();
  return changedLang;
}

/* ───────── Werkzeugbeschreibungen fuer das Modell ─────────
   Die Werkzeuge (list_files, read_file …) werden dem Modell auf Deutsch
   beschrieben. Damit die KI in Englisch/Franzoesisch ebenfalls passende
   Beschreibungen bekommt, werden description und Parameter-Beschreibungen
   beim Sprachwechsel in der gemeinsamen Liste ueberschrieben.
   llm.js liefert sie erst nach i18n.js, deshalb laeuft das hier verspaetet. */
const TOOL_ORIG = new WeakMap();

function applyToolLanguage() {
  const tools = (typeof LLM !== 'undefined' && LLM && LLM.WORKSPACE_TOOLS) || null;
  if (!Array.isArray(tools)) return;
  for (const t of tools) {
    const fn = t && t.function;
    if (!fn) continue;
    if (!TOOL_ORIG.has(fn)) TOOL_ORIG.set(fn, { description: fn.description, params: collectParamTexts(fn) });
    const orig = TOOL_ORIG.get(fn);
    const sh = (typeof promptCompact === 'function' && promptCompact() && typeof TOOL_SHORT !== 'undefined') ? TOOL_SHORT[fn.name] : null;
    fn.description = sh ? (sh[I18N.lang] || sh.de) : T(orig.description);   // Kurzfassung (Profil iq3) oder uebersetzte Normalfassung
    const props = fn.parameters && fn.parameters.properties;
    if (props) for (const [key, saved] of Object.entries(orig.params)) if (props[key]) props[key].description = T(saved);
  }
}

function collectParamTexts(fn) {
  const out = {};
  const props = fn.parameters && fn.parameters.properties;
  if (props) for (const [k, v] of Object.entries(props)) if (v && typeof v.description === 'string') out[k] = v.description;
  return out;
}

/* Zahlen und Waehrung an die Sprache anpassen (util.js nutzt diese Helfer). */
function numLocale() {
  return I18N.lang === 'en' ? 'en-US' : I18N.lang === 'fr' ? 'fr-FR' : 'de-DE';
}
/* Deutsches Dezimalkomma in Strings ("0,7" aus Einstellungen) in die Sprache bringen. */
function decSep(s) {
  if (I18N.lang === 'de') return s;
  return String(s).replace(/(\d),(\d)/g, '$1.$2');
}

/* ───────── Saetze trennen ─────────
   Ein Punkt ist nicht immer ein Satzende: 'Preis pro Mio. des Modells', 'z. B.', 'Abb. 3'.
   Ohne diese Regel zerlegt die Satz-Trennung solche Hilfetexte mitten im Satz – die Teile
   finden dann kein Woerterbuch und bleiben deutsch stehen. */
const ABBREV_RE = /(?:^|[\s(\[])(?:z\.?\s?B\.|u\.?\s?a\.|etc\.?|usw\.?|ca\.|bzw\.|d\.?\s?h\.|Nr\.|No\.|Abb\.|Bsp\.|Mio\.|Mrd\.|Std\.|Min\.|Sek\.|[A-Za-z]\.)\s*$/;

function splitSentences(s) {
  const parts = [];
  let last = 0;
  const re = /([.!?…])\s+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const end = m.index + m[1].length;
    if (m[1] === '.' && ABBREV_RE.test(s.slice(0, end))) continue;   // Abkuerzung -> kein Satzende
    const piece = s.slice(last, end).trim();
    if (piece) parts.push(piece);
    last = end + m[0].length - m[1].length;
  }
  const rest = s.slice(last).trim();
  if (rest) parts.push(rest);
  return parts;
}

/* ───────── Uebersetzung eines einzelnen Textes ───────── */
function T(text) {
  if (I18N.lang === 'de' || text === null || text === undefined) return String(text ?? '');
  const raw = String(text);
  const table = I18N_LEX;
  // Fuehrende/schliessende Leerzeichen bleiben erhalten ("Chat: " -> "Conversation : ")
  const lead = raw.match(/^\s*/)[0];
  const tail = raw.match(/\s*$/)[0];
  const core = raw.slice(lead.length, raw.length - tail.length);
  if (!core) return raw;

  let out = tableLookup(table, core);
  if (out === undefined) out = patternLookup(core);
  if (out === undefined) {
    // Mehrfach-Leerzeichen und Zeilenumbrueche im Text vereinheitlichen (Schluessel sind einzeilig)
    const flat = core.replace(/\s+/g, ' ');
    if (flat !== core) {
      out = tableLookup(table, flat);
      if (out === undefined) out = patternLookup(flat);
    }
  }
  if (out === undefined && core.includes('\n')) {      // mehrzeilige Tooltips: jede Zeile fuer sich (Zeilen enthalten oft Zahlen)
    const lines = core.split('\n');
    const tl = lines.map((l) => T(l));
    if (tl.some((x, i) => x !== lines[i])) out = tl.join('\n');
  }
  if (out === undefined) {                                // mehrere Saetze: jeder Satz fuer sich (Hilfetexte werden im Quelltext aus Teilen zusammengesetzt)
    const sents = splitSentences(core);
    if (sents.length > 1) {
      const ts = sents.map((x) => T(x));
      if (ts.some((x, i) => x !== sents[i])) out = ts.join(' ');
    }
  }
  if (out === undefined) out = segmentLookup(core);   // zusammengesetzte Saetze: bekannte Bruchstuecke ersetzen
  if (out === undefined) return raw;
  return lead + out + tail;
}

/* Bruchstuecke: Viele Meldungen setzt der Quelltext aus mehreren Teilen zusammen ('Server nicht erreichbar' + ': ' + Fehler).
   Findet T() fuer den ganzen Text nichts, werden darin bekannte Woerterbuch-Saetze (mind. 12 Zeichen mit Leerzeichen)
   einzeln ersetzt. Ergebnis wird je Sprache gemerkt. Nutzertexte (Chat-Titel, Dateinamen) enthalten solche Saetze praktisch nie. */
const SEG = { re: null, size: -1, cache: new Map() };

function segmentLookup(core) {
  if (core.length < 12 || core.length > 1500) return undefined;
  const keys = Object.keys(I18N_LEX);
  if (SEG.size !== keys.length) {
    const useful = keys.filter((k) => k.length >= 12 && k.includes(' ')).sort((a, b) => b.length - a.length);
    SEG.re = useful.length ? new RegExp(useful.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
    SEG.size = keys.length;
    SEG.cache.clear();
  }
  if (!SEG.re) return undefined;
  const ck = I18N.lang + '\u0001' + core;
  if (SEG.cache.has(ck)) return SEG.cache.get(ck);
  let hit = false;
  const out = core.replace(SEG.re, (m) => {
    const v = tableLookup(I18N_LEX, m);
    if (v === undefined) return m;
    hit = true;
    return v;
  });
  const res = hit ? out : undefined;
  if (SEG.cache.size > 4000) SEG.cache.clear();
  SEG.cache.set(ck, res);
  return res;
}

function tableLookup(table, core) {
  const hit = table[core];
  if (hit === undefined) return undefined;
  return I18N.lang === 'en' ? hit[0] : hit[1];
}

/* Texte mit Werten: Muster aus I18N_PAT. Jede Zeile = [Regex, englisch, franzoesisch].
   $1..$9 im Zieltext werden durch die erfassten Gruppen ersetzt. */
function patternLookup(core) {
  for (const p of I18N_PAT) {
    const m = core.match(p[0]);
    if (!m) continue;
    const tmpl = I18N.lang === 'en' ? p[1] : p[2];
    return tmpl.replace(/\$(\d)/g, (_, g) => T(m[+g] ?? '')); // eingebettete Teile (z. B. Fehlertexte) ebenfalls uebersetzen
  }
  return undefined;
}

/* ───────── DOM-Übersetzung ───────── */
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

/* Was NIEMALS uebersetzt wird: Chat-Inhalt, Quellcode und Dateivorschau.
   Die Knoepfe und Hinweiskaelte DAZWISCHEN (Kopieren, Freigabe-Karten, Fehler-
   meldung, Statistik) werden sehr wohl uebersetzt - sie sind Oberflaeche. */
const SKIP_CLASSES = ['bubble', 'md', 'inner', 'preview', 'raw'];

function skipThis(node) {
  if (node.closest && node.closest('[data-i18n-off]')) return true;
  const t = node.tagName;
  if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'CODE' || t === 'PRE') return true;
  if (node.closest && node.closest('.' + SKIP_CLASSES.join(', .'))) return true;
  return false;
}

function translateNode(node) {
  if (!node || I18N.lang === 'de') return;
  if (node.nodeType === 3) {                 // Textknoten
    if (!node.parentElement || skipThis(node.parentElement)) return;   // losgeloeste Textknoten ueberspringen (vorher TypeError im Observer)
    const old = typeof node.__de === 'string' ? node.__de : node.nodeValue;   // null/undefined = kein Merker
    const next = T(old);
    if (next !== old) {
      I18N.busy = true;
      node.__de = old;                        // Original merken -> Rueckkehr auf Deutsch
      node.__tr = next;                       // eigener Schreibvorgang: der Observer ignoriert dessen Rueckmeldung
      node.nodeValue = next;
      I18N.busy = false;
    }
    return;
  }
  if (node.nodeType !== 1) return;
  // Eingabefelder (textarea) werden nie inhaltlich uebersetzt, ihr Platzhalter/Tooltip aber sehr wohl
  const isArea = node.tagName === 'TEXTAREA';
  if (isArea ? (node.closest && node.closest('[data-i18n-off]')) : skipThis(node)) return;
  for (const a of ATTRS) {
    const v = node.getAttribute(a);
    if (!v) continue;
    const next = T(v);
    if (next !== v) {
      I18N.busy = true;
      (node.__deAttrs || (node.__deAttrs = {}))[a] = v;
      (node.__trAttrs || (node.__trAttrs = {}))[a] = next;
      node.setAttribute(a, next);
      I18N.busy = false;
    }
  }
  // select-Optionen und Buttons: nur eigene direkte Textkinder, nicht tiefer suchen
  if (!isArea) for (const kid of node.childNodes) if (kid.nodeType === 3) translateNode(kid);
}

function translateTree(root) {
  if (!root || I18N.lang === 'de') return;
  I18N.busy = true;
  try {
    translateNode(root);
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) translateNode(n);
  } finally {
    I18N.busy = false;
  }
}

/* Laeuft automatisch mit, wenn Texte spaeter eingefuegt oder geaendert werden. */
function startI18nObserver() {
  const mo = new MutationObserver((records) => {
    if (I18N.busy || I18N.lang === 'de') return;
    for (const r of records) {
      if (r.type === 'attributes') {
        const own = r.target.__trAttrs && r.target.__trAttrs[r.attributeName];
        if (own !== undefined && r.target.getAttribute(r.attributeName) === own) continue;   // eigene Aenderung
        translateNode(r.target);
        continue;
      }
      if (r.type === 'characterData') {
        if (r.target.__tr !== undefined && r.target.nodeValue === r.target.__tr) continue;   // eigene Aenderung
        // Der Code hat den Textknoten neu gesetzt -> der alte Merker gilt nicht mehr.
        r.target.__de = null;
        translateNode(r.target);
        continue;
      }
      for (const added of r.addedNodes) translateTree(added);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

document.addEventListener('DOMContentLoaded', startI18nObserver);
