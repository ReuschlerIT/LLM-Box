/* lan-server-test.js – baut den Windows-Dienst aus llm-box\main.js (transfer:serveStart)
   eigenstaendig nach, damit der WLAN-Weg zwischen PC und Handy getestet werden kann, ohne
   die Desktop-App zu starten. Erzeugt Uebertragungsdaten im Format docs/TRANSFER-FORMAT.md.

   Aufruf: node tools-android\lan-server-test.js [dauerSekunden]
   Danach auf dem Handy: Einstellungen -> Übertragung -> Im WLAN suchen
   (oder automatisiert: adb shell am start … --ez probe true --ez lanprobe true)  */
'use strict';

const http = require('http');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const ttl = +(process.argv[3] || process.argv[2] || 180);
/* --real: die ECHTEN Einstellungen der installierten Windows-App anbieten
   (%APPDATA%\LLM Box\settings.json), genau wie buildTransfer() es tut. Nur damit laesst sich
   am Handy nachweisen, dass danach eine wirklich funktionierende Verbindung aktiv ist -
   mit den Testwerten unten waere jede Verbindung ins Leere gezeigt worden.
   Aufruf: node tools-android\lan-server-test.js --real [dauerSekunden] */
const real = process.argv.slice(2).includes('--real');

function echteEinstellungen() {
  const p = process.env.APPDATA + '\\LLM Box\\settings.json';
  if (!fs.existsSync(p)) throw new Error('Windows-Einstellungen nicht gefunden: ' + p);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* --- Uebertragungsobjekt, wie buildTransfer() es erzeugt (Umfang bewusst klein gehalten) --- */
const payload = {
  format: 'llm-box-transfer',
  version: 1,
  created: new Date().toISOString(),
  source: { app: 'LLM Box', version: '1.0.53-test', platform: 'win32', device: os.hostname() },
  contains: ['settings'],
  omitted: [],
  settings: {
    connections: [
      { id: 'strata_api', name: 'Strata_API', type: 'openai', baseUrl: 'http://192.0.2.10:8080/v1', apiKey: 'TESTKEY-nur-fuer-diesen-Test', extraParams: true, thinkMode: 'template' },
    ],
    activeConnection: 'strata_api',
    model: 'qwen-testmodell',
    params: { temperature: 0.7, numCtx: 8192 },
    workspace: { toolsEnabled: true, maxSteps: 25, path: 'Y:\\Projekt' },
    appearance: { theme: 'light', enterToSend: false },
  },
};

if (real) {
  try {
    const s = echteEinstellungen();
    payload.settings = s;
    payload.source.version = 'installed-windows-app';
    payload.contains = ['settings'];
    console.log('Angeboten werden die ECHTEN Windows-Einstellungen:');
    for (const c of s.connections || []) {
      console.log(`  Verbindung "${c.name}" (${c.type}) -> ${c.baseUrl}` + (c.apiKey ? `  [Schlüssel gesetzt, ${String(c.apiKey).length} Zeichen]` : '  [ohne Schlüssel]'));
    }
    console.log(`  aktiv: ${s.activeConnection || '-'}   Modell: ${s.model || '-'}`);
  } catch (e) { console.log('FEHLER --real: ' + e.message); process.exit(1); }
}
/* Erst jetzt serialisieren: im --real-Zweig wurden payload.settings gerade erst ersetzt. */
const json = JSON.stringify(payload);

/* --- Handler wie in main.js: Token als Query-Parameter, Antwort als Text --- */
const token = crypto.randomBytes(9).toString('base64url');
const sha16 = crypto.createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex').slice(0, 16);

let requests = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  console.log(`  Anfrage: ${req.method} ${u.pathname}`);
  if (u.pathname !== '/llmbox-transfer') { res.writeHead(404); res.end(); return; }
  if (u.searchParams.get('t') !== token) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Token passt nicht'); return; }
  requests++;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
  console.log('  -> Uebertragung gesendet.');
  /* Dasselbe Verhalten wie die Windows-App (main.js stopTransferServe): nach dem Abruf HTTP
     UND Rufsignal abschalten. Bleibt das UDP-Signal gebunden, meldet sich der Rechner weiter
     im WLAN mit einer toten Adresse - die Android-App erhaelt "HTTP 0". */
  setTimeout(() => {
    try { server.close(); } catch {}
    try { sock.close(); } catch {}
    console.log('  Dienst beendet (HTTP + Rufsignal).');
    setTimeout(() => process.exit(0), 500);
  }, 300);
});

server.listen(0, '0.0.0.0', () => {
  const port = server.address().port;
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
  }

  // UDP-Rufsignal wie in main.js: Handy schickt "LLMBOX?", Antwort liefert Port + Token.
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let probes = 0;
  sock.on('message', (msg, rinfo) => {
    if (!String(msg).startsWith('LLMBOX?')) return;
    probes++;
    console.log(`  Rufsignal von ${rinfo.address}`);
    try { sock.send(Buffer.from(`LLMBOX|${port}|${token}|${sha16}`), rinfo.port, rinfo.address); } catch (e) { console.log('  Antwort fehlgeschlagen: ' + e.message); }
  });
  sock.on('error', (e) => console.log('  UDP-Fehler: ' + e.message));
  try { sock.bind(45455, '0.0.0.0'); } catch (e) { console.log('  UDP-Bind fehlgeschlagen: ' + e.message); }

  console.log('\nLLM-Box-Uebertragung wird angeboten:');
  for (const ip of ips) console.log(`  http://${ip}:${port}/llmbox-transfer?t=${token}`);
  console.log(`Token=${token} Pruefsumme=${sha16} Groesse=${Buffer.byteLength(json)} Bytes`);
  console.log(`Laeuft ${ttl}s. (Abbruch mit Strg+C)\n`);

  setTimeout(() => {
    console.log(`\nFertig: ${requests} Abruf(e), ${probes} Rufsignal(e) beantwortet.`);
    try { server.close(); sock.close(); } catch {}
    process.exit(0);
  }, ttl * 1000);
});

server.on('error', (e) => { console.log('HTTP-Fehler: ' + e.message); process.exit(1); });
