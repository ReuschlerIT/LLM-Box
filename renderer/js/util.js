'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

const ICONS = {
  handoff: '<circle cx="12" cy="12" r="9"/><path d="m10 8 4 4-4 4"/><path d="M7.5 12H14"/>',
  agents: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
  play: '<path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5Z" fill="currentColor"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  euro: '<path d="M4 10h12"/><path d="M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
};
function icon(name, size = 18, sw = 1.8) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* Formatierung */
const fmt = {
  num: (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Math.round(n).toLocaleString('de-DE')),
  tok: (n) => {
    if (n === null || n === undefined || Number.isNaN(n)) return '–';
    const a = Math.abs(n);
    if (a < 10000) return Math.round(n).toLocaleString('de-DE');
    // [Schwelle, Teiler, Einheit] – Schwelle knapp unter dem Teiler, damit 999.999 nicht als „1000k“ erscheint
    for (const [min, div, unit] of [[9.995e11, 1e12, 'T'], [9.995e8, 1e9, 'B'], [9.995e5, 1e6, 'M'], [1e4, 1e3, 'k']]) {
      if (a >= min) {
        const v = n / div;
        return v.toFixed(1).replace('.', ',').replace(/,0$/, '') + unit;
      }
    }
    return String(n);
  },
  sec: (s) => (s === null || s === undefined ? '–' : s < 10 ? s.toFixed(2).replace('.', ',') + ' s' : s < 100 ? s.toFixed(1).replace('.', ',') + ' s' : Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s'),
  tps: (v) => (v === null || v === undefined || !isFinite(v) ? '–' : v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace('.', ',')),
  size: (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1).replace('.', ',') + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB'),
  dur: (s) => {
    if (s === null || s === undefined || Number.isNaN(s)) return '–';
    if (s < 60) return s.toFixed(s < 10 ? 2 : 1).replace('.', ',') + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min ' + String(Math.round(s % 60)).padStart(2, '0') + ' s';
    return Math.floor(s / 3600) + ' h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ' min';
  },
  money: (v, cur) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '–';
    const d = v >= 1 ? 2 : v >= 0.01 ? 3 : v === 0 ? 2 : 4;
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur === 'USD' ? 'USD' : 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  },
  gb: (b) => (b / 1073741824).toFixed(1).replace('.', ',') + ' GB',
};
const estimateTokens = (s) => Math.ceil((s || '').length / 3.8);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const debounce = (f, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => f(...a), ms);
  };
};

/* Toast */
function toast(msg, ms = 2800) {
  const t = el('div', { class: 'toast', text: msg });
  $('#toast-root').append(t);
  setTimeout(() => t.remove(), ms);
}

/* Modal */
function openModal({ title, body, buttons, wide, onClose, bare }) {
  const root = $('#modal-root');
  const back = el('div', { class: 'modal-back' });
  const close = (result) => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(null);
    }
  };
  document.addEventListener('keydown', onKey, true);
  const head = el('div', { class: 'modal-head' }, el('span', { text: title }), el('button', { class: 'icon-btn', html: icon('x'), onclick: () => close(null), title: 'Schließen' }));
  const foot = buttons && buttons.length
    ? el('div', { class: 'modal-foot' }, buttons.map((b) => el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), text: b.label, onclick: () => b.onClick ? b.onClick(close) : close(b.value) })))
    : null;
  const modal = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, head, bare ? body : el('div', { class: 'modal-body' }, body), foot);
  back.append(modal);
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) close(null);
  });
  root.append(back);
  const first = modal.querySelector('input, textarea');
  if (first && !wide) first.focus();
  return { close, el: modal };
}

function confirmModal(title, message, { okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: el('div', { style: { whiteSpace: 'pre-wrap' }, text: message }),
      buttons: [
        { label: 'Abbrechen', value: false },
        { label: okLabel, primary: !danger, danger, value: true },
      ],
      onClose: (r) => resolve(r === true),
    });
  });
}

function promptModal(title, label, value = '') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'text', value });
    const m = openModal({
      title,
      body: el('div', {}, el('div', { text: label, style: { marginBottom: '8px', color: 'var(--text-dim)' } }), input),
      buttons: [
        { label: 'Abbrechen', value: null },
        { label: 'OK', primary: true, onClick: (close) => close(input.value.trim() || null) },
      ],
      onClose: (r) => resolve(r),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') m.close(input.value.trim() || null);
    });
    input.select();
  });
}

/* Farben */
function hexToRgb(h) {
  h = String(h || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return Number.isNaN(n) || h.length !== 6 ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join('');
}

/* Popup-Menü (z. B. Denkaufwand) */
let _menu = null;
function closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.outside, true);
  document.removeEventListener('keydown', _menu.esc, true);
  _menu = null;
}
function openMenu(anchor, items, opt = {}) {
  closeMenu();
  const m = el('div', { class: 'menu', role: 'menu' }, items.map((it) =>
    it.header
      ? el('div', { class: 'menu-head', text: it.header })
      : el('button', { class: 'menu-item' + (it.active ? ' active' : ''), role: 'menuitem', onclick: () => { closeMenu(); it.onClick(); if (it.keep && opt.reopen) opt.reopen(); } },
          el('span', { class: 'mi-main' }, el('b', { text: it.label }), it.hint ? el('span', { class: 'mi-hint', text: it.hint }) : null),
          it.active ? el('span', { class: 'mi-check', html: icon('check', 15) }) : null)
  ));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.bottom = window.innerHeight - r.top + 6 + 'px';
  const outside = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', esc, true);
  _menu = { el: m, outside, esc };
}
