/* scan-schluessel.js – sucht in einer Kopie nach echten Schluesseln und Einstellungsdateien.

   Der andere Scan (scan-persoenlich.js) findet Pfade und IPs. Dieser hier prueft gezielt die
   Punkte, die der Nutzer ausdruecklich genannt hat: "keine Persoenlichen Zugangsdaten oder
   Einstellungen". Ein API-Key kann auch im Quelltext stehen (z. B. als Beispiel in einer
   Verbindung), eine Einstellungsdatei versehentlich mitkopiert sein.

   Gemeldet wird nur, nichts wird geaendert. Funde werden mit Kontext ausgegeben, damit entschieden
   werden kann, ob es ein echter Schluessel oder ein Demonstrationswert ist.

   Aufruf: node tools-android\scan-schluessel.js <pfad> [<pfad2> …]                        */
'use strict';
const fs = require('fs');
const path = require('path');

/* Echte Schluesselformen. Bewusst lang genug gewaehlt, damit das Wort "apiKey" allein nicht
   meldet – sonst zeigt jeder Hinweis-Text der Oberflaeche einen Treffer an. */
const MUSTER = [
  ['OpenAI-artiger Key', /sk-[A-Za-z0-9_-]{16,}/],
  ['Anthropic-Key', /sk-ant-[A-Za-z0-9_-]{16,}/],
  ['Google-AI-Key', /AIza[0-9A-Za-z_-]{30,}/],
  ['AWS-Zugangsschluessel', /AKIA[0-9A-Z]{16}/],
  ['Bearer-Token im Code', /Bearer\s+[A-Za-z0-9._-]{24,}/],
  ['Private-Key-Block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Passwort-Zuweisung mit Wert', /pass(?:word)?\s*[:=]\s*['"][^'"\s]{6,}['"]/i],
];

/* Dateinamen, die nie veroeffentlicht werden duerften: echte Einstellungen und Zugangsdaten. */
const VERDAECHTIGE_NAMEN = [/^settings\.json$/i, /^smb\.json$/i, /^sync\.json$/i, /^\.env$/, /id_rsa/, /\.pem$/i,
  /^chat.*\.json$/i, /^chats?\.json$/i, /^config\.(json|ini)$/i, /^credentials/i];

const ziele = process.argv.slice(2);
let dateien = 0, funde = 0;

function pruefe(datei) {
  let st; try { st = fs.statSync(datei); } catch { return; }
  if (!st.isFile()) return;
  dateien++;
  const name = path.basename(datei);
  for (const r of VERDAECHTIGE_NAMEN) {
    if (r.test(name)) { funde++; console.log('DATEI    ' + datei + '   (Einstellungs-/Schluesseldatei)'); }
  }
  if (st.size > 30 * 1024 * 1024) return;
  let buf; try { buf = fs.readFileSync(datei); } catch { return; }
  const text = buf.toString('latin1');
  for (const [label, re] of MUSTER) {
    const m = text.match(new RegExp(re.source, 'gmi'));
    if (!m || !m.length) continue;
    funde += m.length;
    console.log('SCHLUESSEL ' + name.padEnd(24) + ' ' + label.padEnd(26) + m.length + 'x  z.B. ' + String(m[0]).slice(0, 70));
  }
}

function laufe(p) {
  let st; try { st = fs.statSync(p); } catch (e) { console.log('nicht lesbar: ' + p); return; }
  if (st.isFile()) return pruefe(p);
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const voll = path.join(p, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') laufe(voll); }
    else pruefe(voll);
  }
}

for (const z of ziele) laufe(z);
console.log('\nGepruefte Dateien: ' + dateien + '   Funde: ' + funde);
process.exitCode = funde ? 2 : 0;
