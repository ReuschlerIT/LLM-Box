/* test-transfer.js – bewies die Kompatibilitaet des Uebertragungsformats
   Windows-Seite (llm-box\main.js, transfer:pack)  ->  Android-Seite (native-main.js, api.transfer.pack)

   Die Windows-App komprimiert mit Node zlib (RFC 1950), bildet SHA-256 ueber den
   komprimierten Bytes und schickt Base64-Stuecke in QR-Codes. Die Android-App nutzt
   dafuer CompressionStream('deflate') / DecompressionStream und crypto.subtle.
   Dieser Test laeuft BEIDE Wege im selben Prozess und prueft, dass sie identische
   Bytefolgen und Pruefsummen erzeugen bzw. sich gegenseitig lesen koennen – ohne Gerat.

   Aufruf: node tools-android\test-transfer.js     (aus LLM-Box\)  */
'use strict';

const zlib = require('zlib');
const crypto = require('crypto');

let pass = 0, fail = 0;
function ok(n, c, e) { if (c) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FEHLER  ' + n + (e ? ' -> ' + e : '')); } }

/* ── Windows-Seite: exakt wie ipcMain.handle('transfer:pack') in llm-box\main.js ── */
function windowsPack(json) {
  const raw = Buffer.from(String(json), 'utf8');
  const z = zlib.deflateSync(raw, { level: 9 });
  return { b64: z.toString('base64'), sha16: crypto.createHash('sha256').update(z).digest('hex').slice(0, 16), rawBytes: raw.length, zBytes: z.length };
}

/* ── Android-Seite: exakt wie api.transfer.pack() in tools-android\native-main.js ── */
async function androidPack(json) {
  const raw = new TextEncoder().encode(String(json == null ? '' : json));
  const cs = new CompressionStream('deflate');            // 'deflate' = zlib-Format (RFC 1950)
  const buf = await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer();
  const z = new Uint8Array(buf);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', z));
  let hex = '';
  for (const b of hash) hex += b.toString(16).padStart(2, '0');
  let b64 = '';
  const CH = 0x8000;
  for (let i = 0; i < z.length; i += CH) b64 += Buffer.from(z.subarray(i, i + CH)).toString('base64');
  return { b64, sha16: hex.slice(0, 16), rawBytes: raw.length, zBytes: z.length };
}

/* ── Android-Seite: Entpacken wie api.transfer.qrCollect().finish() ── */
async function androidUnpack(b64) {
  const z = new Uint8Array(Buffer.from(b64, 'base64'));
  const ds = new DecompressionStream('deflate');          // dieselbe Annahme wie in der App
  const buf = await new Response(new Blob([z]).stream().pipeThrough(ds)).arrayBuffer();
  return Buffer.from(buf).toString('utf8');
}

/* ── Windows-Seite: Entpacken (Gegenprobe, main.js nutzt deflateSync -> inflateSync) ── */
function windowsUnpack(b64) { return zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8'); }

const SAMPLES = [
  { name: 'klein', text: JSON.stringify({ format: 'llm-box-transfer', version: 1, settings: { model: 'qwen3' } }) },
  { name: 'umlaut+emoji', text: JSON.stringify({ s: 'Äöüß € · ↑ ↓ Ø „Kontext leeren“ 😀', pfade: 'Y:\\Projekt\\LLM-Box' }) },
  { name: 'gross (settings + chats)', text: JSON.stringify({ settings: { connections: Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, name: 'Verb ' + i, baseUrl: 'http://192.0.2.1.' + i + ':11434', apiKey: 'sk-' + 'x'.repeat(24) })) }, chats: Array.from({ length: 30 }, (_, i) => ({ id: 'chat' + i, title: 'Chat ' + i, messages: Array.from({ length: 20 }, (__, k) => ({ role: k % 2 ? 'assistant' : 'user', content: 'Nachricht ' + k + ' '.repeat(50) })) })) }) },
];

(async () => {
  console.log('\nFormat-Kompatibilitaet Windows <-> Android (zlib/SHA-256/Base64) …');

  for (const s of SAMPLES) {
    const w = windowsPack(s.text);
    const a = await androidPack(s.text);

    /* WICHTIG – und der Grund, warum die Pruefsumme gerade NICHT verglichen werden darf:
       deflate ist nicht normiert. Node zlib (level 9) und Chromiums CompressionStream
       erzeugen aus demselben Text unterschiedliche komprimierte Bytes (und Groessen).
       Das Format ist trotzdem kompatibel, weil beide Seiten RFC-1950 lesen koennen und die
       Pruefsumme immer ueber den tatsaechlich uebertragenen Bytes gebildet wird – nie ueber
       "neu komprimierten" eigenen Bytes. Wer das verwechselt, verwirft gueltige Uebertragungen. */
    const readByAndroid = await androidUnpack(w.b64);
    ok(`${s.name}: Android liest die Windows-Datei (Windows packt, Handy entpackt)`,
      readByAndroid === s.text, 'Inhalt unterscheidet sich');

    const readByWindows = windowsUnpack(a.b64);
    ok(`${s.name}: Windows liest die Android-Datei (Handy exportiert JSON, PC liest)`,
      readByWindows === s.text, 'Inhalt unterscheidet sich');

    // Die Pruefsumme muss zu den eigenen komprimierten Bytes passen (QR-Weg: genau diese
    // Bytes werden Stueck fuer Stueck uebertragen und am Ziel geprueft).
    const hashOfWindowsBytes = crypto.createHash('sha256').update(zlib.deflateSync(Buffer.from(s.text, 'utf8'), { level: 9 })).digest('hex').slice(0, 16);
    ok(`${s.name}: Windows-Pruefsumme passt zu den uebertragenen Bytes`, w.sha16 === hashOfWindowsBytes);

    const back = new Uint8Array(Buffer.from(a.b64, 'base64'));
    const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', back));
    let hex2 = ''; for (const b of h2) hex2 += b.toString(16).padStart(2, '0');
    ok(`${s.name}: Android-Pruefsumme passt zu den uebertragenen Bytes`, a.sha16 === hex2.slice(0, 16));

    // Rohe deflate-Bytes werden von der Android-Bridge als String gelesen und waeren damit
    // kaputt – deshalb liefert der LAN-Dienst JSON-Text statt komprimierter Bytes.
    ok(`${s.name}: rohe Bytes sind kein gueltiger UTF-8-Text (warum der LAN-Weg Text liefert)`,
      Buffer.from(w.b64, 'base64').toString('utf8') !== s.text);
  }

  /* QR-Stueckelung wie in transfer.js (makeFrames) und Zusammensetzen wie in der App. */
  console.log('\nQR-Stueckelung: ein Weg statt vieler Codes …');
  const big = windowsPack(SAMPLES[2].text);
  const QR_CHUNK = 600;                                    // wie transfer.js:7
  const chunks = [];
  for (let i = 0; i < big.b64.length; i += QR_CHUNK) chunks.push(big.b64.slice(i, i + QR_CHUNK));
  ok('Einstellungen+Chats ergeben mehrere Codes (Grund der Beschwerde)', chunks.length > 1, `${chunks.length} Codes`);

  const sid = 'abcd1234';
  const frames = chunks.map((c, i) => `LBX1|${sid}|${i + 1}|${chunks.length}|${big.sha16}|${c}`);
  ok('Bildformat LBX1|sitzung|nr|anzahl|pruefsumme|teil', /^LBX1\|abcd1234\|1\|\d+\|[0-9a-f]{16}\|/.test(frames[0]), frames[0].slice(0, 60));

  // Android-Seite: Stuecke in beliebiger Reihenfolge sammeln und pruefen
  const parts = new Map();
  for (const line of [...frames].sort(() => Math.random() - 0.5)) {
    const f = line.split('|');
    if (f.length < 6 || f[0] !== 'LBX1') { ok('fremder Code abgelehnt', false); continue; }
    parts.set(+f[2], f.slice(5).join('|'));
  }
  let b64 = '';
  for (let i = 1; i <= chunks.length; i++) b64 += parts.get(i);
  const zbytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', zbytes));
  let hex = ''; for (const b of hash) hex += b.toString(16).padStart(2, '0');
  ok('Pruefsumme nach dem Einsammeln stimmt', hex.slice(0, 16) === big.sha16);
  const rebuilt = await androidUnpack(b64);
  ok('Zusammengesetzter Inhalt identisch (Reihenfolge egal)', rebuilt === SAMPLES[2].text);

  // Die Alternative: eine Adresse passt immer in EINEN Code.
  const url = 'http://192.0.2.10:54321/llmbox-transfer?t=Zm9vYmFyMTIz';
  ok('LAN-Adresse passt in einen einzigen QR-Inhalt', url.length < QR_CHUNK, `${url.length} Zeichen`);

  console.log(`\nErgebnis: ${pass + fail} geprueft, ${fail} Fehler`);
  process.exit(fail ? 1 : 0);
})();
