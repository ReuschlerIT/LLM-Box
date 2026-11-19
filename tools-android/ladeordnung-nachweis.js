/* ladeordnung-nachweis.js – beweist, ob die neue Oberflaeche (1.0.82) in einer echten
   WebView-Semantik fehlerfrei laedt.

   Hintergrund: test-ui-boot.js fuehrt jede Datei einzeln mit win.eval() aus. Dabei ist ein
   `const` auf Top-Level einer Datei (z. B. ICONS und debounce in util.js) in der naechsten
   Datei NICHT sichtbar – eval() bekommt ein eigenes Skript-Environment. Eine echte WebView
   und ein gemeinsamer vm-Kontext fuehren alle Skripte dagegen im selben globalen Lexical
   Environment aus, genau wie der Browser. Dieses Skript laedt alle Skripte in DERSELBEN
   Reihenfolge wie index.html in EINEM vm-Kontext und meldet, ob die neuen Module
   (server.js, owui.js, app.js) ICONS und debounce dann wirklich sehen.

   Aufruf: node tools-android\ladeordnung-nachweis.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEBAPP = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'webapp');
const html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8');
const skripte = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  document: { addEventListener() {}, documentElement: { setAttribute() {}, style: {} }, body: null,
    querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, append() {} }) },
  window: {}, navigator: { userAgent: 'test' }, location: { href: 'file:///x' },
  setTimeout, clearTimeout, setInterval, clearInterval,
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

const fehler = [];
for (const s of skripte) {
  const datei = path.join(WEBAPP, s);
  if (!fs.existsSync(datei)) { fehler.push(`${s}: Datei fehlt`); continue; }
  try {
    vm.runInContext(fs.readFileSync(datei, 'utf8'), ctx, { filename: s });
  } catch (e) {
    // Reine Browser-API-Fehler (fehlendes DOM/Canvas) sind hier erwartet und zaehlen nicht.
    if (/is not defined/.test(e.message) && !/document|window\.|navigator|matchMedia|ResizeObserver|IntersectionObserver|Canvas|Path2D/.test(e.message)) {
      fehler.push(`${s}: ${e.message}`);
    }
  }
}

/* Sichtbarkeit der neuen Top-Level-Konstanten im gemeinsamen Kontext pruefen. */
const probe = (name) => { try { return vm.runInContext(`typeof ${name}`, ctx); } catch { return 'FEHLER'; } };
console.log('ICONS    im gemeinsamen Kontext: ' + probe('ICONS'));
console.log('debounce im gemeinsamen Kontext: ' + probe('debounce'));
console.log('Skripte geladen: ' + skripte.length);
console.log('echte Referenzfehler (not defined): ' + fehler.length);
fehler.forEach((f) => console.log('  FEHLT  ' + f));
process.exit(fehler.length ? 1 : 0);
