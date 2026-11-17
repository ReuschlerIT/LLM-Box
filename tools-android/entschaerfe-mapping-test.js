/* entschaerfe-mapping-test.js – macht tools-android\test-uebernahme-fixes.js in der OEFFENTLICHEN
   Kopie maschinenunabhaengig.

   Warum noetig: Abschnitt B des Tests loest ein wirklich gemapptes Netzlaufwerk auf und vergleicht
   mit Windows. Auf dem Entwickler-PC existiert das Mapping, in einem frischen GitHub-Clone nicht.
   Dort waren drei Erwartungen trotzdem hart (host/share/sub/unc) -> der Test waererot, obwohl am
   Code nichts falsch ist. Die Erwartung an Windows wird bereits abgefragt ('erwartet'); ist sie leer,
   gab es kein Mapping -> die vier Vergleiche werden dann als uebersprungen gewertet.

   Vorgehen: eine einzige EXAKTE Zeichenkette ersetzen (keine Regex), damit nichts kaputt geht.
   Arbeitet nur im angegebenen Zielordner. --dry zeigt den Fund, schreibt nichts.

   Aufruf: node tools-android\entschaerfe-mapping-test.js <zielordner> [--dry]                */
'use strict';
const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
const dry = process.argv.includes('--dry');
if (!ziel || !fs.existsSync(ziel)) {
  console.log('usage: node tools-android\\entschaerfe-mapping-test.js <zielordner> [--dry]');
  process.exit(1);
}

const datei = path.join(ziel, 'tools-android', 'test-uebernahme-fixes.js');
if (!fs.existsSync(datei)) { console.log('NICHT GEFUNDEN: ' + datei); process.exit(1); }

/* Der Block steht so in der Kopie (vor der Y:-Neutralisierung). Die Einrueckung ist Teil des
   Musters – sie stammt aus dem Original und muss exakt passen. */
const ALT = [
  "      /* Und die vollstaendige Umrechnung des Nutzer-Falls. */",
  "      if (resolveFn) {",
].join('\n');

const NEU = [
  "      /* Und die vollstaendige Umrechnung des Nutzer-Falls. Nur pruefbar, wenn auf DIESEM",
  "         Rechner tatsaechlich ein Netzlaufwerk gemappt ist – sonst gibt es keine Freigabe,",
  "         deren Aufloesung man vergleichen koennte. Dann gilt der Abschnitt als uebersprungen,",
  "         nicht als Fehler (getestet wird die Weiche weiterhin in Abschnitt A). */",
  "      if (resolveFn && erwartet) {",
].join('\n');

const SKIP = [
  "      } else if (resolveFn) {",
  "        ok('kein Laufwerks-Mapping auf diesem Rechner – Aufloesungs-Vergleich uebersprungen', true);",
  "      }",
].join('\n');

let text = fs.readFileSync(datei, 'utf8');
if (!text.includes(ALT)) {
  console.log(text.includes('kein Laufwerks-Mapping auf diesem Rechner')
    ? 'Bereits entschärft – nichts zu tun.' : 'MUSTER NICHT GEFUNDEN – Block hat sich geändert, bitte pruefen.');
  process.exit(2);
}

/* Der else-Zweig muss direkt hinter dem Ende des if-Blocks eingefuegt werden. Der if-Block endet
   mit der Zeile zum lokalen Ordner C: – danach folgt im Original '    } catch (e) {'. */
const ENDE = [
  "        const lokal = await r('C:\\\\Users\\\\irgendwas');",
  "        ok('ein lokaler Ordner auf C: ergibt keine Freigabe', !lokal, JSON.stringify(lokal));",
  "      }",
].join('\n');

if (!text.includes(ENDE)) { console.log('ENDE-MUSTER NICHT GEFUNDEN – bitte pruefen.'); process.exit(2); }

text = text.split(ALT).join(NEU);
text = text.split(ENDE).join(ENDE + '\n' + SKIP);

console.log((dry ? 'Trockenlauf – nichts geschrieben.\n' : '') + 'Block angepasst: ' + path.relative(ziel, datei));
if (!dry) fs.writeFileSync(datei, text, 'utf8');
