/* bereinige-kopie.js – macht eine Kopie des Projekts oeffentlich-tauglich.

   Auftrag (14.11.): Nach dem Kopieren nach C:\LLM-Box soll dort nichts Persoenliches stehen:
   keine Einstellungen, keine Zugangsdaten, keine Pfade, keine Passwoerter. Der Workspace
   (D:\MeinProjekt\LLM-Box) wird von diesem Skript NICHT veraendert – es arbeitet ausschliesslich
   im angegebenen Zielordner.

   Warum ueberhaupt etwas zu finden war: Die personengebundenen Werte stecken nicht in einer
   Einstellungsdatei, sondern im QUELLTEXT selbst – als Beispiel-IPs in Kommentaren, als
   Platzhalter im Eingabefeld der Freigabe-Zeile und als Standardwerte der Geraete-Sonden. Genau
   deshalb waren sie auch schon in der fertigen APK und in app.asar enthalten (gemessen: 103
   Fundstellen in den Programmdateien).

   Vorgehen: NUR Textdateien werden angefasst, und zwar zeilenweise mit exakter Zeichenkette.
   Reguljaere Ausdruecke waeren gefaehrlich (Punkte in IPs sind Joker). Umlaute bleiben erhalten,
   weil als UTF-8 gelesen und geschrieben.

   Aufruf: node tools-android\bereinige-kopie.js <zielordner> [--dry]                     */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) { console.log('usage: node tools-android\\bereinige-kopie.js <ordner> [--dry]'); process.exit(1); }

/* Reihenfolge ist wichtig: laengere Muster ZUERST, sonst bleibt ein Stueck stehen
   (z. B. erst "D:\MeinProjekt", dann "MeinProjekt"). */
const ERSETZUNGEN = [
  // Geraete-Sonden und Kommentare: konkrete LAN-Adressen des Nutzers.
  ['192.0.2.10', '192.0.2.10'],        // RFC 5737 (TEST-NET-1): reserviert, nicht routbar
  ['192.0.2.50', '192.0.2.50'],
  ['192.0.2.30', '192.0.2.30'],
  ['192.0.2.117', '192.0.2.117'],
  ['192.0.2.42', '192.0.2.42'],
  ['192.0.2.42', '192.0.2.42'],
  /* Catch-all fuer alle noch uebrigen Adressen aus dem privaten Bereich (gemessen: 192.0.2.1.31 in
     einem SmbStore-Kommentar, 192.0.2.1.20 im Android-Handbuch, 192.0.2.10.201 als Geraet-Ziel in
     zwei Mess-Skripten). Jede einzelne war eine Adresse aus dem Netz des Nutzers. RFC 5737
     (192.0.2.x) ist die dafuer vorgesehene Dokumentations-Adresse: strukturell gleich, aber nicht
     routbar. node_modules wird uebersprungen, dort bleiben Beispiel-IPs der Fremd-Bibliotheken. */
  ['192.0.2.', '192.0.2.'],
  // Eigenes Projekt und gemapptes Laufwerk des Nutzers.
  ['Y:\\MeinProjekt', 'D:\\MeinProjekt'],
  ['D:/MeinProjekt', 'D:/MeinProjekt'],
  ['MeinProjekt', 'MeinProjekt'],
  ['\\\\192.0.2.10\\daten', '\\\\192.0.2.10\\daten'],   // nach der IP-Umsetzung
  ['/192.0.2.10/daten', '/192.0.2.10/daten'],
  ['\\daten\\', '\\daten\\'],
  ['/daten/', '/daten/'],
  ["'daten'", "'daten'"],
  /* "homes" war der reale Freigabename des Nutzers (gemessen: net use Y: -> \\192.0.2.10\daten).
     Die IP war schon neutralisiert, der Name blieb in Beispiel-Platzhaltern stehen – deshalb jetzt
     auch die Formen mit umschlossenen Anfuehrungszeichen und am Zeilenende. Bewusst KEIN pauschales
     "homes", weil das Wort in englischen Woertern vorkaeme; die vier Formen unten decken genau die
     Platzhalter ab, die der Scan in der fertigen APK gezeigt hat. */
  ['\\daten"', '\\daten"'],
  ["'daten'", "'daten'"],
  ['\\daten ', '\\daten '],
  ['/daten', '/daten'],
  /* Die im Scan der fertigen APK gezeigten Restformen: Platzhalter enden dort auf
     "\daten</code>" bzw. "\daten)" – von den Mustern oben nicht erfasst. Backslash + "homes" ist
     eindeutig ein Pfad, ein pauschales "homes" waere gefaehrlich (kommt in englischen Woertern vor). */
  ['\\daten<', '\\daten<'],
  ['\\daten)', '\\daten)'],
  ['\\daten,', '\\daten,'],
  /* Drei Restformen in einem Erklaerkommentar der Laufwerksaufloesung ("z. B. \\host\share\daten",
     "share daten,", 'sub = "daten/…"'). Kein persoenlicher Wert mehr, aber der Name stammte aus der
     echten Freigabe – fuer ein oeffentliches Repo durchgaengig "daten" verwenden. */
  ['\\daten"', '\\daten"'],
  ['share daten,', 'share daten,'],
  ['"daten/', '"daten/'],
  ['-> "daten")', '-> "daten")'],
  /* Restformen in der Test-Attrappe: dort stehen die Platzhalter als JS-Literal mit doppeltem
     Backslash, z. B. value = '\\192.0.2.10\\daten'. Die Muster oben (ein Backslash) treffen das
     nicht – gemessen an drei Fundstellen in test-ui-boot.js. */
  ["\\\\daten'", "\\\\daten'"],
  /* Testwert der WebView-Attrappe (test-ui-boot.js): kein echtes Passwort, aber ein Wert an einer
     Stelle, die nach "Passwort" aussieht – fuer eine oeffentliche Veroeffentlichung neutral benannt. */
  ['beispiel-passwort', 'beispiel-passwort'],

  /* Letzter Lauf (nach dem Build): der Buchstabe Y: war das gemappte Netzlaufwerk des Nutzers
     ("net use Y: -> \\host\share"). Einzelne Kommentare, Doku-Beispiele und Tests nannten genau
     diesen Buchstaben – der Endscan meldete 46 Fundstellen im eigenen Quelltext. Ein
     Laufwerksbuchstabe ist fuer sich nicht geheim, aber gehoert zu den Pfaden, die der Auftrag
     nicht haben wollte. Grosses Z + Doppelpunkt ist eindeutig: deutsche Woerter enden auf "z:"
     klein (Instanz:, Satz:), deshalb passiert dort nichts. Die App selbst prueft allgemein
     [A-Za-z]:, ist also gegen den Buchstaben austauschbar – belegt durch die Regex-Stellen in
     main.js (smbHostOf/smbPartsOf/smbPartsAufgeloest) und transfer.js (smbParts). */
  ['Y:', 'Y:'],
  /* Nach der obigen Regel blieben Formen OHNE Doppelpunkt stehen: im Test die Funktion u('Y')
     (sie loest das Beispiel-Laufwerk auf – muss zum neuen Buchstaben passen) und der erzaehlende
     Text "Laufwerk Y". Beides eindeutig, kein Wort in anderen Sprachen endet auf "Z ". */
  ["u('Y')", "u('Y')"],
  ['Laufwerk Y', 'Laufwerk Y'],

  // Windows-Benutzerprofil des Nutzers.
  ['C:\\Users\\Administrator', 'C:\\Users\\<Benutzer>'],
  ['C:/Users/<Benutzer>', 'C:/Users/<Benutzer>'],
  /* Bewusst KEINE Regel fuer "%APPDATA%\LLM Box": das ist der App-eigene, allgemeine Ordner und
     enthaelt nichts Persoenliches. Eine Ersetzung durch sich selbst zaehlt im Protokoll als
     Aenderung mit und hatte README.md und HANDBUCH.md grundlos neu geschrieben. */
];

/* Dateien, die nie angefasst werden: Fremdcode und Binaries.
   "vendor" neu aufgenommen: enthalt minifizierte Dritt-Bibliotheken (marked, highlight, purify …).
   Deren Zufallsfolgen wie "Y:" oder "Y:" in komprimiertem Code sind kein persoenlicher Wert, und
   eine Aenderung wuerde die Bibliothek veraendern ohne Grund. */
const UEBERSPRUNGENE_ORDNER = new Set(['node_modules', '.git', 'app_build', 'build', 'dist', 'out', 'vendor']);
const TEXT_ENDUNGEN = new Set(['.js', '.json', '.md', '.txt', '.java', '.xml', '.gradle', '.css', '.html',
  '.ps1', '.cmd', '.bat', '.properties', '.yml', '.yaml', '.ts', '.svg', '.ini', '.editorconfig']);

let geaenderteDateien = 0, ersetzungen = 0,prueft = 0;
const protokoll = [];

function bearbeite(datei) {
  const end = path.extname(datei).toLowerCase();
  if (!TEXT_ENDUNGEN.has(end)) return;
  let text;
  try { text = fs.readFileSync(datei, 'utf8'); } catch { return; }
  prueft++;
  let anzahlHier = 0;
  for (const [alt, neu] of ERSETZUNGEN) {
    if (!text.includes(alt)) continue;
    const teile = text.split(alt);
    anzahlHier += teile.length - 1;
    text = teile.join(neu);
  }
  if (!anzahlHier) return;
  ersetzungen += anzahlHier;
  geaenderteDateien++;
  protokoll.push(path.relative(ziel, datei) + '  (' + anzahlHier + ')');
  if (!dry) fs.writeFileSync(datei, text, 'utf8');
}

function laufe(ordner) {
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    const voll = path.join(ordner, e.name);
    if (e.isDirectory()) { if (!UEBERSPRUNGENE_ORDNER.has(e.name)) laufe(voll); }
    else bearbeite(voll);
  }
}

laufe(ziel);
console.log((dry ? 'Trockenlauf – nichts geschrieben.\n' : '') + 'Textdateien geprueft: ' + prueft + '   geaendert: ' + geaenderteDateien + '   Ersetzungen: ' + ersetzungen);
for (const p of protokoll) console.log('  ' + p);
