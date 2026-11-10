'use strict';
/* Dokumente für die KI lesbar machen (läuft im Hauptprozess, alles lokal):
   PDF, Word (.docx), Excel (.xlsx/.xlsm), PowerPoint (.pptx), OpenDocument (.odt/.ods/.odp).
   Dazu eine robuste Textdekodierung für Konfigurationsdateien (UTF-8, UTF-16, Windows-Umlaute). */
const fsp = require('fs/promises');
const path = require('path');

const DOC_EXT = new Set(['.pdf', '.docx', '.docm', '.xlsx', '.xlsm', '.pptx', '.pptm', '.odt', '.ods', '.odp']);
const LEGACY_HINT = {
  '.doc': 'altes Word-Format. In Word als .docx speichern.',
  '.xls': 'altes Excel-Format. In Excel als .xlsx speichern.',
  '.ppt': 'altes PowerPoint-Format. In PowerPoint als .pptx speichern.',
};
const MAX_DOC_BYTES = 60 * 1024 * 1024;

const isDoc = (ext) => DOC_EXT.has(ext);
const legacyHint = (ext) => LEGACY_HINT[ext] || '';

/* ───── Text dekodieren und wieder kodieren ─────
   decodeTextEx liefert {text, enc} oder null bei echten Binärdateien. Erkennt BOMs, UTF-16 ohne BOM und fällt bei ungültigem
   UTF-8 auf Windows-1252 zurück (typisch für alte .ini/.cfg/.csv mit Umlauten). encodeText schreibt in derselben Kodierung
   zurück, damit das Ändern einer Konfigurationsdatei ihre Kodierung nicht zerstört. */
function decodeTextEx(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), enc: 'utf16le-bom' };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { text: Buffer.from(buf.subarray(2)).swap16().toString('utf16le'), enc: 'utf16be-bom' };
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), enc: 'utf8-bom' };
  const n = Math.min(buf.length, 4000);
  if (n >= 4) {
    let even = 0;
    let odd = 0;
    for (let i = 0; i < n; i++) if (buf[i] === 0) (i % 2 ? odd++ : even++);
    const half = n / 2;
    if (even === 0 && odd / half > 0.2) return { text: buf.toString('utf16le'), enc: 'utf16le' };
    if (odd === 0 && even / half > 0.2) return { text: Buffer.from(buf).swap16().toString('utf16le'), enc: 'utf16be' };
  }
  if (buf.subarray(0, 8000).includes(0)) return null;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), enc: 'cp1252' };
  }
}
const decodeText = (buf) => {
  const r = decodeTextEx(buf);
  return r ? r.text : null;
};

const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const CP1252_REV = new Map(Object.entries(CP1252).map(([b, c]) => [c, +b]));
function encodeText(text, enc) {
  if (enc === 'utf16le-bom') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  if (enc === 'utf16le') return Buffer.from(text, 'utf16le');
  if (enc === 'utf16be-bom') return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
  if (enc === 'utf16be') return Buffer.from(text, 'utf16le').swap16();
  if (enc === 'utf8-bom') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  if (enc === 'cp1252') {
    const out = Buffer.alloc(text.length);
    let i = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out[i++] = c;
      else if (CP1252_REV.has(ch)) out[i++] = CP1252_REV.get(ch);
      else throw new Error(`Das Zeichen „${ch}“ lässt sich in dieser Datei (Windows-1252) nicht speichern.`);
    }
    return out.subarray(0, i);
  }
  return Buffer.from(text, 'utf8');
}

/* ───── XML-Hilfen ───── */
let parserLib = null;
function xmlParser() {
  if (!parserLib) {
    const { XMLParser } = require('fast-xml-parser');
    parserLib = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: false, parseTagValue: false, parseAttributeValue: false, processEntities: true });
  }
  return parserLib;
}
const parseXml = (s) => xmlParser().parse(s);
const key = (n) => Object.keys(n).find((k) => k !== ':@');
const kids = (n) => {
  const k = key(n);
  return k && Array.isArray(n[k]) ? n[k] : [];
};
const attr = (n, a) => (n[':@'] ? n[':@']['@_' + a] : undefined);
const textNode = (n) => (n && n['#text'] !== undefined ? String(n['#text']) : null);

/* Sammelt alle Elemente mit einem der Namen (beliebig tief) */
function findAll(nodes, names, out = []) {
  for (const n of nodes || []) {
    const k = key(n);
    if (!k || k === '#text') continue;
    if (names.includes(k)) out.push(n);
    findAll(kids(n), names, out);
  }
  return out;
}
const findFirst = (nodes, names) => findAll(nodes, names)[0] || null;
/* Reiner Text aller Elemente eines Namens (z. B. a:t) */
const allText = (nodes, names) => findAll(nodes, names).map((n) => kids(n).map(textNode).filter((t) => t !== null).join('')).join('');

async function zipRead(zip, name) {
  const f = zip.file(name);
  return f ? f.async('string') : null;
}
async function loadZip(buf) {
  const JSZip = require('jszip');
  return JSZip.loadAsync(buf);
}

const mdRow = (cells) => '| ' + cells.map((c) => String(c).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')).join(' | ') + ' |';
function mdTable(rows) {
  rows = rows.filter((r) => r.length);
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const pad = (r) => r.concat(Array(w - r.length).fill(''));
  const out = [mdRow(pad(rows[0])), mdRow(Array(w).fill('---'))];
  for (const r of rows.slice(1)) out.push(mdRow(pad(r)));
  return out.join('\n');
}

/* ───── PDF ───── */
let pdfjsLib = null;
function loadPdfjs() {
  if (!pdfjsLib) {
    // pdf.js meldet beim Laden fehlende Zeichen-Module (canvas). Für reine Textauslese irrelevant, daher still laden.
    const w = console.warn;
    const l = console.log;
    console.warn = () => {};
    console.log = () => {};
    try {
      pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    } finally {
      console.warn = w;
      console.log = l;
    }
  }
  return pdfjsLib;
}
async function readPdf(buf) {
  const pdfjs = loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('PDF ist passwortgeschützt.');
    throw new Error('PDF konnte nicht gelesen werden (' + (e && e.message ? e.message : e) + ').');
  }
  const total = doc.numPages;
  const pages = [];
  let chars = 0;
  for (let p = 1; p <= total; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = '';
    let lastY = null;
    const lines = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const y = it.transform ? it.transform[5] : 0;
      if (lastY !== null && Math.abs(y - lastY) > 2.5 && line) {
        lines.push(line);
        line = '';
      }
      line += it.str;
      if (it.hasEOL) {
        lines.push(line);
        line = '';
      }
      lastY = y;
    }
    if (line) lines.push(line);
    const txt = lines.map((l) => l.replace(/[ \t]+$/g, '')).join('\n').trim();
    pages.push(txt);
    chars += txt.length;
    page.cleanup();
    if (chars > 4_000_000) break; // Schutz vor riesigen Dokumenten
  }
  await doc.destroy();
  if (!pages.some((t) => t)) throw new Error('Kein Text im PDF gefunden (vermutlich ein Scan, Texterkennung/OCR wird nicht unterstützt).');
  const text = pages.map((t, i) => `--- Seite ${i + 1} von ${total} ---\n${t || '(kein Text)'}`).join('\n\n');
  return { text, info: `PDF, ${total} Seite${total === 1 ? '' : 'n'}` };
}

/* ───── Word (.docx) ───── */
function docxInline(nodes) {
  let t = '';
  for (const n of nodes) {
    const k = key(n);
    if (k === 'w:r') {
      for (const c of kids(n)) {
        const ck = key(c);
        if (ck === 'w:t') t += kids(c).map(textNode).filter((x) => x !== null).join('');
        else if (ck === 'w:tab') t += '\t';
        else if (ck === 'w:br' || ck === 'w:cr') t += '\n';
        else if (ck === 'w:noBreakHyphen') t += '-';
      }
    } else if (['w:hyperlink', 'w:ins', 'w:smartTag', 'w:fldSimple', 'w:sdtContent', 'w:customXml'].includes(k)) t += docxInline(kids(n));
    else if (k === 'w:sdt') t += docxInline(kids(n));
  }
  return t;
}

function docxPara(n) {
  let style = '';
  let listed = false;
  let level = 0;
  for (const c of kids(n)) {
    if (key(c) === 'w:pPr') {
      for (const pc of kids(c)) {
        const pk = key(pc);
        if (pk === 'w:pStyle') style = attr(pc, 'w:val') || '';
        if (pk === 'w:numPr') {
          listed = true;
          const il = findFirst(kids(pc), ['w:ilvl']);
          level = il ? parseInt(attr(il, 'w:val'), 10) || 0 : 0;
        }
      }
    }
  }
  const text = docxInline(kids(n)).replace(/\u00a0/g, ' ');
  if (!text.trim()) return '';
  const h = /^(?:heading|berschrift|überschrift|titre|encabezado)\s*(\d)/i.exec(style);
  if (h) return '#'.repeat(Math.min(6, +h[1])) + ' ' + text.trim();
  if (/^(title|titel)$/i.test(style)) return '# ' + text.trim();
  if (listed || /^(list|liste|aufz)/i.test(style)) return '  '.repeat(level) + '- ' + text.trim();
  return text;
}

function docxBlocks(nodes, out) {
  for (const n of nodes) {
    const k = key(n);
    if (k === 'w:p') {
      const t = docxPara(n);
      if (t) out.push(t);
    } else if (k === 'w:tbl') {
      const rows = [];
      for (const tr of kids(n).filter((x) => key(x) === 'w:tr')) {
        const cells = [];
        for (const tc of kids(tr).filter((x) => key(x) === 'w:tc')) {
          const parts = [];
          docxBlocks(kids(tc), parts);
          cells.push(parts.join(' ').replace(/^#+\s*/, ''));
        }
        rows.push(cells);
      }
      const md = mdTable(rows);
      if (md) out.push(md);
    } else if (k === 'w:sdt' || k === 'w:sdtContent') docxBlocks(kids(n), out);
  }
}

async function readDocx(buf) {
  const zip = await loadZip(buf);
  const xml = await zipRead(zip, 'word/document.xml');
  if (!xml) throw new Error('Keine Word-Datei (word/document.xml fehlt).');
  const body = findFirst(parseXml(xml), ['w:body']);
  const out = [];
  if (body) docxBlocks(kids(body), out);
  // Fußnoten und Kommentare sind oft inhaltlich wichtig
  for (const [file, title] of [['word/footnotes.xml', 'Fußnoten'], ['word/comments.xml', 'Kommentare']]) {
    const x = await zipRead(zip, file);
    if (!x) continue;
    const items = [];
    for (const f of findAll(parseXml(x), ['w:footnote', 'w:comment'])) {
      const id = attr(f, 'w:id');
      if (id !== undefined && Number(id) < 1 && file.includes('footnotes')) continue; // Trenner
      const t = [];
      docxBlocks(kids(f), t);
      if (t.join('').trim()) items.push(`[${id}] ${t.join(' ')}`);
    }
    if (items.length) out.push(`\n## ${title}\n` + items.join('\n'));
  }
  if (!out.length) throw new Error('Das Word-Dokument enthält keinen Text.');
  return { text: out.join('\n\n'), info: 'Word-Dokument' };
}

/* ───── Excel (.xlsx) ───── */
const colIndex = (ref) => {
  const m = /^([A-Z]+)/.exec(ref || '');
  let n = 0;
  for (const c of m ? m[1] : 'A') n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};
const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function isDateFormat(code) {
  const c = String(code || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(c) && !/^(general|0|#)/i.test(c.trim());
}
function excelDate(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}
const tidyNumber = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return String(v);
  return /\d{15,}/.test(String(v)) ? String(parseFloat(x.toPrecision(15))) : String(v);
};

const SHEET_ROW_CAP = 5000;
const SHEET_COL_CAP = 80;
const FORMULA_CAP = 150;

async function readXlsx(buf) {
  const zip = await loadZip(buf);
  const wbXml = await zipRead(zip, 'xl/workbook.xml');
  if (!wbXml) throw new Error('Keine Excel-Datei (xl/workbook.xml fehlt).');
  const wb = parseXml(wbXml);
  const relsXml = await zipRead(zip, 'xl/_rels/workbook.xml.rels');
  const rels = {};
  if (relsXml) for (const r of findAll(parseXml(relsXml), ['Relationship'])) rels[attr(r, 'Id')] = attr(r, 'Target');

  // Zeichenketten
  const shared = [];
  const ssXml = await zipRead(zip, 'xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of findAll(parseXml(ssXml), ['si'])) {
      const parts = [];
      for (const c of kids(si)) {
        const k = key(c);
        if (k === 't') parts.push(kids(c).map(textNode).filter((x) => x !== null).join(''));
        else if (k === 'r') for (const rc of kids(c)) if (key(rc) === 't') parts.push(kids(rc).map(textNode).filter((x) => x !== null).join(''));
      }
      shared.push(parts.join(''));
    }
  }
  // Formate (Datumsspalten erkennen)
  const dateXf = new Set();
  const stXml = await zipRead(zip, 'xl/styles.xml');
  if (stXml) {
    const st = parseXml(stXml);
    const custom = {};
    for (const nf of findAll(st, ['numFmt'])) custom[attr(nf, 'numFmtId')] = attr(nf, 'formatCode');
    const xfs = findFirst(st, ['cellXfs']);
    if (xfs) kids(xfs).filter((x) => key(x) === 'xf').forEach((xf, i) => {
      const id = parseInt(attr(xf, 'numFmtId'), 10);
      if (BUILTIN_DATE.has(id) || (custom[id] && isDateFormat(custom[id]))) dateXf.add(i);
    });
  }

  const sheets = findAll(wb, ['sheet']);
  const out = [];
  let used = 0;
  for (const sh of sheets) {
    const name = attr(sh, 'name') || 'Blatt';
    const hidden = attr(sh, 'state') === 'hidden' || attr(sh, 'state') === 'veryHidden';
    const target = rels[attr(sh, 'r:id')];
    if (!target) continue;
    const file = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.?\//, '');
    const xml = await zipRead(zip, file);
    if (!xml) continue;
    const sd = findFirst(parseXml(xml), ['sheetData']);
    const rows = [];
    const formulas = [];
    let maxCol = 0;
    let rowCount = 0;
    for (const row of sd ? kids(sd).filter((x) => key(x) === 'row') : []) {
      if (++rowCount > SHEET_ROW_CAP) break;
      const cells = [];
      for (const c of kids(row).filter((x) => key(x) === 'c')) {
        const ref = attr(c, 'r') || '';
        const idx = colIndex(ref);
        if (idx >= SHEET_COL_CAP) continue;
        const t = attr(c, 't');
        const s = parseInt(attr(c, 's'), 10);
        let v = null;
        let f = null;
        let inline = null;
        for (const cc of kids(c)) {
          const ck = key(cc);
          if (ck === 'v') v = kids(cc).map(textNode).filter((x) => x !== null).join('');
          else if (ck === 'f') f = kids(cc).map(textNode).filter((x) => x !== null).join('');
          else if (ck === 'is') inline = allText(kids(cc), ['t']);
        }
        let val = '';
        if (t === 's') val = v !== null ? shared[parseInt(v, 10)] ?? '' : '';
        else if (t === 'inlineStr') val = inline ?? '';
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str' || t === 'e' || t === 'd') val = v ?? '';
        else if (v !== null && v !== '') val = dateXf.has(s) && Number.isFinite(Number(v)) ? excelDate(Number(v)) : tidyNumber(v);
        if (f && !val) val = '=' + f; // kein zwischengespeicherter Wert: wenigstens die Formel zeigen
        if (f && formulas.length < FORMULA_CAP) formulas.push(`${ref}: =${f}`);
        if (val !== '' || idx < cells.length) {
          while (cells.length < idx) cells.push('');
          cells[idx] = val;
          maxCol = Math.max(maxCol, idx + 1);
        }
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      rows.push({ n: parseInt(attr(row, 'r'), 10) || rows.length + 1, cells });
    }
    const nonEmpty = rows.filter((r) => r.cells.length);
    used += nonEmpty.length;
    let block = `## Blatt „${name}“${hidden ? ' (ausgeblendet)' : ''}: ${nonEmpty.length} Zeilen, ${maxCol} Spalten`;
    if (!nonEmpty.length) block += '\n(leer)';
    else {
      block += `\nSpalten: ${colName(0)}–${colName(Math.max(0, maxCol - 1))}. Erste Zeile = Kopfzeile, die Zeilennummer steht in der ersten Spalte.\n`;
      const w = maxCol;
      const head = ['#'].concat(Array.from({ length: w }, (_, i) => colName(i)));
      const lines = [mdRow(head), mdRow(Array(w + 1).fill('---'))];
      for (const r of nonEmpty) lines.push(mdRow([r.n].concat(r.cells.concat(Array(Math.max(0, w - r.cells.length)).fill('')))));
      block += lines.join('\n');
      if (rowCount > SHEET_ROW_CAP) block += `\n[… nur die ersten ${SHEET_ROW_CAP} Zeilen gelesen]`;
    }
    if (formulas.length) block += `\n\nFormeln (${formulas.length >= FORMULA_CAP ? 'erste ' : ''}${formulas.length}):\n` + formulas.join('\n');
    out.push(block);
  }
  if (!out.length) throw new Error('Die Excel-Datei enthält keine lesbaren Blätter.');
  return { text: out.join('\n\n'), info: `Excel, ${sheets.length} ${sheets.length === 1 ? 'Blatt' : 'Blätter'}, ${used} Zeilen mit Inhalt` };
}

/* ───── PowerPoint (.pptx) ───── */
function pptxShapes(nodes, out) {
  for (const n of nodes) {
    const k = key(n);
    if (k === 'a:tbl') {
      const rows = [];
      for (const tr of kids(n).filter((x) => key(x) === 'a:tr')) {
        rows.push(kids(tr).filter((x) => key(x) === 'a:tc').map((tc) => findAll(kids(tc), ['a:p']).map((p) => allText(kids(p), ['a:t'])).filter(Boolean).join(' ')));
      }
      const md = mdTable(rows);
      if (md) out.push(md);
    } else if (k === 'p:txBody') {
      for (const p of kids(n).filter((x) => key(x) === 'a:p')) {
        const t = allText(kids(p), ['a:t']).trim();
        if (t) out.push(t);
      }
    } else if (k && k !== '#text') pptxShapes(kids(n), out);
  }
}

async function readPptx(buf) {
  const zip = await loadZip(buf);
  const names = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1], 10) - parseInt(b.match(/(\d+)\.xml/)[1], 10));
  if (!names.length) throw new Error('Keine PowerPoint-Datei (keine Folien gefunden).');
  const out = [];
  let i = 0;
  for (const f of names) {
    i++;
    const xml = await zipRead(zip, f);
    const parts = [];
    pptxShapes(parseXml(xml), parts);
    const block = [`## Folie ${i}`, parts.join('\n')];
    const relXml = await zipRead(zip, f.replace('slides/', 'slides/_rels/') + '.rels');
    if (relXml) {
      const rel = findAll(parseXml(relXml), ['Relationship']).find((r) => /notesSlide$/.test(attr(r, 'Type') || ''));
      if (rel) {
        const nf = 'ppt/' + String(attr(rel, 'Target')).replace(/^\.\.\//, '');
        const nx = await zipRead(zip, nf);
        if (nx) {
          const np = [];
          pptxShapes(parseXml(nx), np);
          const note = np.filter((t) => !/^\d+$/.test(t.trim())).join('\n').trim();
          if (note) block.push('Notizen: ' + note);
        }
      }
    }
    out.push(block.join('\n'));
  }
  return { text: out.join('\n\n'), info: `PowerPoint, ${names.length} Folie${names.length === 1 ? '' : 'n'}` };
}

/* ───── OpenDocument (.odt, .ods, .odp) ───── */
function odfText(nodes) {
  let t = '';
  for (const n of nodes) {
    const tx = textNode(n);
    if (tx !== null) {
      t += tx;
      continue;
    }
    const k = key(n);
    if (k === 'text:s') t += ' '.repeat(parseInt(attr(n, 'text:c'), 10) || 1);
    else if (k === 'text:tab') t += '\t';
    else if (k === 'text:line-break') t += '\n';
    else if (k === 'text:span' || k === 'text:a' || k === 'text:meta') t += odfText(kids(n));
  }
  return t;
}
function odfBlocks(nodes, out) {
  for (const n of nodes) {
    const k = key(n);
    if (k === 'text:h') {
      const t = odfText(kids(n)).trim();
      if (t) out.push('#'.repeat(Math.min(6, parseInt(attr(n, 'text:outline-level'), 10) || 1)) + ' ' + t);
    } else if (k === 'text:p') {
      const t = odfText(kids(n)).trim();
      if (t) out.push(t);
    } else if (k === 'text:list-item' || k === 'text:list') {
      const sub = [];
      odfBlocks(kids(n), sub);
      for (const s of sub) out.push(k === 'text:list-item' && !/^\s*[-#]/.test(s) ? '- ' + s : s);
    } else if (k === 'table:table') {
      const rows = [];
      for (const tr of findAll(kids(n), ['table:table-row'])) {
        const rep = Math.min(parseInt(attr(tr, 'table:number-rows-repeated'), 10) || 1, 50);
        const cells = [];
        for (const tc of kids(tr).filter((x) => ['table:table-cell', 'table:covered-table-cell'].includes(key(x)))) {
          const parts = [];
          odfBlocks(kids(tc), parts);
          const crep = Math.min(parseInt(attr(tc, 'table:number-columns-repeated'), 10) || 1, 30);
          for (let i = 0; i < crep; i++) cells.push(parts.join(' '));
        }
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        if (cells.length) for (let i = 0; i < rep && rows.length < SHEET_ROW_CAP; i++) rows.push(cells);
      }
      const md = mdTable(rows);
      if (md) out.push(`Tabelle „${attr(n, 'table:name') || ''}“:\n${md}`);
    } else if (k === 'draw:page') {
      out.push(`## Folie ${attr(n, 'draw:name') || ''}`);
      odfBlocks(kids(n), out);
    } else if (k && k !== '#text') odfBlocks(kids(n), out);
  }
}
async function readOdf(buf, ext) {
  const zip = await loadZip(buf);
  const xml = await zipRead(zip, 'content.xml');
  if (!xml) throw new Error('Keine OpenDocument-Datei (content.xml fehlt).');
  const body = findFirst(parseXml(xml), ['office:body']);
  const out = [];
  if (body) odfBlocks(kids(body), out);
  if (!out.length) throw new Error('Das Dokument enthält keinen Text.');
  return { text: out.join('\n\n'), info: ext === '.ods' ? 'OpenDocument-Tabelle' : ext === '.odp' ? 'OpenDocument-Präsentation' : 'OpenDocument-Text' };
}

/* ───── Einstieg ───── */
const cache = new Map(); // Pfad+Änderung → Ergebnis (die KI liest dieselbe Datei oft mehrfach)
async function extract(abs) {
  const ext = path.extname(abs).toLowerCase();
  const st = await fsp.stat(abs);
  if (st.size > MAX_DOC_BYTES) throw new Error(`Datei zu groß (${Math.round(st.size / 1048576)} MB, Limit ${MAX_DOC_BYTES / 1048576} MB)`);
  const ck = `${abs}|${st.size}|${st.mtimeMs}`;
  if (cache.has(ck)) return cache.get(ck);
  const buf = await fsp.readFile(abs);
  let r;
  try {
    if (ext === '.pdf') r = await readPdf(buf);
    else if (ext === '.docx' || ext === '.docm') r = await readDocx(buf);
    else if (ext === '.xlsx' || ext === '.xlsm') r = await readXlsx(buf);
    else if (ext === '.pptx' || ext === '.pptm') r = await readPptx(buf);
    else r = await readOdf(buf, ext);
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') throw new Error('Für dieses Format fehlt ein Programmteil. Bitte im Programmordner „npm install“ ausführen und die App neu starten.');
    if (/Corrupted zip|end of central directory|not a valid zip/i.test(String(e && e.message))) throw new Error('Datei ist beschädigt oder passwortgeschützt.');
    throw e;
  }
  r.kind = ext.slice(1);
  cache.set(ck, r);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return r;
}

module.exports = { isDoc, legacyHint, extract, decodeText, decodeTextEx, encodeText, DOC_EXT };
