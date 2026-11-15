/* png-sample.js – liest ein PNG (adb screencap) aus und meldet Helligkeit/Farben.
   Noetig, weil Screenshots nicht direkt angesehen werden koennen und GDI (System.Drawing)
   auf diesem Rechner mit "Nicht genuegend Arbeitsspeicher" scheitert (png-hell.ps1).
   Dekodiert reiner Node: PNG-Header, IDAT, inflateSync, Undo der Filter.

   Aufruf: node tools-android\png-sample.js datei.png [x,y ...]     (Koordinaten in %)      */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
if (!file) { console.log('usage: node tools-android\\png-sample.js datei.png [x,y ...]'); process.exit(1); }
const buf = fs.readFileSync(file);
if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') { console.log('kein PNG:', file); process.exit(1); }

let p = 8, w = 0, h = 0, depth = 0, ctype = 0; const idat = [];
while (p < buf.length) {
  const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
  const data = buf.slice(p + 8, p + 8 + len);
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
  else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  p += 12 + len;
}
if (depth !== 8) { console.log(`PNG ${w}x${h}, Tiefe ${depth} wird nicht unterstuetzt`); process.exit(1); }
const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : 0;
if (!ch) { console.log('unkannter Farbtyp', ctype); process.exit(1); }

const raw = zlib.inflateSync(Buffer.concat(idat));
const bpp = ch, stride = w * bpp;
const img = Buffer.alloc(h * stride);
for (let y = 0; y < h; y++) {
  const ft = raw[y * (stride + 1)];
  const src = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  const cur = img.slice(y * stride, (y + 1) * stride);
  const up = y ? img.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0, b = up[x], c = x >= bpp ? up[x - bpp] : 0;
    let v = src[x];
    if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
    else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
    cur[x] = v & 255;
  }
}

const px = (x, y) => { const i = y * stride + x * bpp; return [img[i], img[i + 1], img[i + 2]]; };
console.log(`${file}  ${w}x${h}`);

// Helligkeitsprofil: wie viele Pixel sind hell (>200)? Aufgeteilt in 10 horizontale Streifen.
for (let s = 0; s < 10; s++) {
  const y0 = Math.floor(h * s / 10), y1 = Math.floor(h * (s + 1) / 10);
  let hell = 0, ges = 0, sumR = 0, sumG = 0, sumB = 0;
  for (let y = y0; y < y1; y += 2) for (let x = 0; x < w; x += 2) {
    const [r, g, b] = px(x, y); ges++; sumR += r; sumG += g; sumB += b;
    if (r > 200 && g > 200 && b > 200) hell++;
  }
  console.log(`  Streifen ${s * 10}-${(s + 1) * 10}% y : hell ${Math.round(hell / ges * 100)}% | Mittel RGB ${Math.round(sumR / ges)},${Math.round(sumG / ges)},${Math.round(sumB / ges)}`);
}

// Rechteck-Abfrage: weisse Flaeche rechts (wo das Panel 280 px bzw. Overlay liegen wuerde)
const panel = { x0: Math.floor(w * 0.75), x1: w - 1 };
let hell = 0, ges = 0;
for (let y = Math.floor(h * 0.15); y < h * 0.9; y += 2) for (let x = panel.x0; x < panel.x1; x += 2) {
  const [r, g, b] = px(x, y); ges++; if (r > 200 && g > 200 && b > 200) hell++;
}
console.log(`  rechtes Viertel (Panel-Bereich): hell ${Math.round(hell / ges * 100)}%`);

for (const arg of process.argv.slice(3)) {
  const [px_, py_] = arg.split(',').map(Number);
  if (!isFinite(px_) || !isFinite(py_)) continue;
  const x = Math.floor(w * px_ / 100), y = Math.floor(h * py_ / 100);
  console.log(`  Pixel ${px_}%,${py_}% (${x},${y}) = RGB ${px(x, y).join(',')}`);
}
