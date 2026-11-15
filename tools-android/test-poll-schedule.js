/* test-poll-schedule.js – sichert den Schutz gegen eine nachlaufende Abgleich-Kette.

   Anlass (14.11.): In Aenderungen.md Punkt 93 war die Generationen-Marke `pollGen` fuer BEIDE
   Seiten dokumentiert, in llm-box\main.js fehlte sie aber tatsaechlich – dort stand noch
   `setTimeout(async () => { await pollChats(); schedulePoll(); }, wait)`. Nachgewiesen durch
   Suchlauf: pollGen kam nur in native-main.js vor, nicht in main.js.

   Was ohne die Marke passiert (der ehrliche Mechanismus, keine erfundene Variante):
     1. Ein Abgleich laeuft (auf dem Netzlaufwerk kann das Sekunden dauern).
     2. Der Nutzer stellt waehrenddessen den Rhythmus um -> schedulePoll(neuerWert) setzt einen
       frischen Timer.
     3. Der ueberholte, gerade beendete Lauf plant anschliessend NOCH EINMAL neu ein und
       UEBERSCHREIBT damit den frischen Timer. Der naechste Abgleich rueckt nach hinten; der
       eingestellte Abstand stimmt nicht mehr. Auf der Android-Seite war das am 14.11. im Test als
       Wechsel von ~0,5 s und ~5 s bei eingestellter Sekunde sichtbar (native-main.js:619).

   Der Test prueft zwei Dinge:
     A) statisch: beide Dateien enthalten die Marke und kein naives "await pollChats(); schedulePoll();"
     B) verhaltensmaessig: eine nachgebildete Kette zeigt den Effekt ohne Marke und seinen Wegfall
        mit Marke. Die Nachbildung nutzt clearTimeout + setTimeout genau wie der echte Code.

   Aufruf: node tools-android\test-poll-schedule.js      (aus LLM-Box\)                    */
'use strict';
const fs = require('fs');
const path = require('path');

let geprueft = 0, fehler = 0;
function ok(name, bedingung, zusatz) {
  geprueft++;
  if (bedingung) console.log('  OK   ' + name);
  else { fehler++; console.log('  FEHLER ' + name + (zusatz ? '  -> ' + zusatz : '')); }
}

const MAIN = path.join(__dirname, '..', 'llm-box', 'main.js');
const NATIVE = path.join(__dirname, '..', 'tools-android', 'native-main.js');

function planungsBlock(datei) {
  const text = fs.readFileSync(datei, 'utf8');
  const i = text.indexOf('function schedulePoll');
  if (i < 0) return null;
  const ende = text.indexOf('\n/*', i);
  return text.slice(i, ende > i ? ende : i + 1200);
}

console.log('=== 8) Abgleich-Timer: eine Kette, eingestellter Abstand (Windows und Android) ===');

for (const [label, datei] of [['Windows main.js', MAIN], ['Android native-main.js', NATIVE]]) {
  const b = planungsBlock(datei);
  ok(`${label}: schedulePoll gefunden`, !!b);
  if (!b) continue;
  ok(`${label}: Generationen-Marke pollGen vorhanden`, /pollGen/.test(b));
  ok(`${label}: jeder Lauf erhoeht die Marke`, /\+\+pollGen/.test(b));
  ok(`${label}: nachplaenen nur bei unveraenderter Marke`, /if\s*\(\s*gen === pollGen\s*\)\s*schedulePoll\(\)/.test(b));
  ok(`${label}: kein naives await + sofortiges Nachplanen`, !/await pollChats\(\);\s*schedulePoll\(\)/.test(b),
    'genau das erlaubte dem ueberholten Lauf, den frischen Timer zu ersetzen');
  ok(`${label}: Fehler im Abgleich beendet die Kette nicht`, /\.catch\(\(\)\s*=>\s*\{\}\)/.test(b));
  ok(`${label}: eingeplanter Abstand wird als Timer-Verzoegerung benutzt`,
    /setTimeout\([\s\S]{0,400},\s*wait\)/.test(b) && /const wait\s*=/.test(b));
}

/* ── B) Verhaltens-Nachbildung ───────────────────────────────────────────────
   Nachgestellt wird genau die Struktur des echten Codes: ein Timer, in dessen Rueckruf erst der
   Abgleich laeuft und danach neu geplant wird. mitMarke=false entspricht dem alten Stand. */
function modell(pollDauerMs, startTaktMs, wechselNachMs, neuerTaktMs, beobachteBisMs, mitMarke) {
  let timer = null, gen = 0, laeuft = 0;
  const zeitPunkte = [];
  let every = startTaktMs, wechselZeit = 0;

  function schedulePoll(wait) {
    if (timer) clearTimeout(timer);
    const g = ++gen;
    timer = setTimeout(() => {
      laeuft++; zeitPunkte.push(Date.now());
      Promise.resolve()
        .then(async () => { await new Promise((r) => setTimeout(r, pollDauerMs)); })   // Abgleich auf Y:
        .catch(() => {})
        .then(() => { if (mitMarke ? g === gen : true) schedulePoll(every); });
    }, wait);
  }

  return new Promise((resolve) => {
    schedulePoll(every);
    setTimeout(() => {                                   // Nutzer aendert den Rhythmus
      wechselZeit = Date.now(); every = neuerTaktMs; schedulePoll(neuerTaktMs);
    }, wechselNachMs);
    setTimeout(() => { if (timer) clearTimeout(timer); resolve({ laeuft, zeitPunkte, wechselZeit }); }, beobachteBisMs);
  });
}

(async () => {
  /* Zeitplan: schneller Starttakt (200 ms), ein Abgleich dauert 4000 ms. Der Wechsel auf 4000 ms
     erfolgt bei 2100 ms, also mitten in einem laufenden Abgleich (lief von ~200 bis ~4200 ms). */
  const DAUER = 4000, START = 200, WECHSEL = 2100, TAKT = 4000, BEOB = 9500;

  const alt = await modell(DAUER, START, WECHSEL, TAKT, BEOB, false);
  const altStarts = alt.zeitPunkte.map((t) => t - alt.wechselZeit).filter((d) => d > 0);
  const altAbstand = altStarts.length ? Math.min(...altStarts) : -1;

  const neu = await modell(DAUER, START, WECHSEL, TAKT, BEOB, true);
  const neuStarts = neu.zeitPunkte.map((t) => t - neu.wechselZeit).filter((d) => d > 0);
  const neuAbstand = neuStarts.length ? Math.min(...neuStarts) : -1;

  ok('Nachbildung laeuft in beiden Faellen', alt.laeuft >= 2 && neu.laeuft >= 2,
    `ohne Marke ${alt.laeuft} Laeufe, mit Marke ${neu.laeuft} Laeufe`);

  ok('mit Marke: naechster Abgleich sitzt auf dem eingestellten Abstand',
    neuAbstand >= TAKT * 0.9 && neuAbstand <= TAKT * 1.2,
    `${neuAbstand} ms nach dem Wechsel (Soll ${TAKT} ms)`);

  ok('ohne Marke: der ueberholte Lauf verschiebt den naechsten Abgleich nach hinten',
    altAbstand > TAKT * 1.3,
    `${altAbstand} ms nach dem Wechsel (Soll ${TAKT} ms) – genau die zu lange Luecke`);

  console.log(`\nErgebnis: ${geprueft} geprueft, ${fehler} Fehler`);
  process.exit(fehler ? 1 : 0);
})();
