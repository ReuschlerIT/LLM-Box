'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   quality.js  –  Zuverlässigkeit und Tempo (Version 1.0.84)

   Zwei kleine, nachvollziehbare Maßnahmen gegen Erfindungen und Fehlgriffe. Sie ersetzen keine Prüfung durch den Nutzer.
   1. Genaueres Sampling bei Werkzeug-Aufgaben: Bei Dateiarbeit (Code, Pfade, JSON) streut hohe Temperatur Namen und Argumente.
      Ist der Dateizugriff an, wird die Temperatur auf höchstens „Werkzeug-Temperatur“ (Standard 0,6, die Qwen-Empfehlung für präzise Aufgaben) begrenzt.
      Im normalen Chat bleibt die eingestellte Temperatur.
   2. Pfad-Hilfe: Meldet ein Werkzeug „Datei nicht gefunden“, hängt die App die tatsächlich vorhandenen Einträge des Ordners an die Fehlermeldung an
      und weist darauf hin, nur diese Namen zu verwenden. So rät das Modell keine erfundenen Dateinamen weiter.
   ══════════════════════════════════════════════════════════════════════════ */

function qualityParams(chat, p) {
  const q = S.settings.quality || {};
  if (!q.toolSampling || !useTools(chat)) return p;
  const t = +q.toolTemp;
  if (!(t >= 0) || p.temperature === null || p.temperature === undefined || p.temperature === '') return p;
  return +p.temperature > t ? { ...p, temperature: t } : p;
}

const QUALITY_MISSING = /nicht gefunden|not found|ENOENT|existiert nicht|no such|introuvable/i;
async function qualityPathHelp(tc, r, root, ws, owner) {
  const msg = String((r && r.result) || '');
  const q = S.settings.quality || {};
  if (!q.pathHelp || (r && r.ok) || !QUALITY_MISSING.test(msg)) return msg;
  const p = tc.args && (tc.args.path || tc.args.file);
  if (!p) return msg;
  const dir = String(p).replace(/\\/g, '/').split('/').slice(0, -1).join('/') || '.';
  try {
    const l = await api.ws.tool({ root, name: 'list_files', args: { path: dir }, maxKB: +ws.readKB || 40, ignore: ignoreList(), owner });
    if (l && l.ok) return msg + '\n\n' + T('Vorhanden in') + ' ' + dir + ':\n' + String(l.result).split('\n').slice(0, 40).join('\n') + '\n' + T('Verwende nur Namen aus dieser Liste.');
  } catch { /* Ordner selbst fehlt: Originalmeldung genügt */ }
  return msg;
}

/* Voreinstellungen für Genauigkeit / Ausgewogen / Kreativ (Knöpfe in den Einstellungen) */
const QUALITY_PRESETS = {
  precise: { label: 'Genau (Code, Dateien, Fakten)', params: { temperature: 0.6, topP: 0.95, topK: 20, minP: 0, repeatPenalty: 1.0, presencePenalty: 0 } },
  balanced: { label: 'Ausgewogen (Qwen-Empfehlung)', params: { temperature: 1.0, topP: 0.95, topK: 20, minP: 0, repeatPenalty: 1.0, presencePenalty: 0 } },
  creative: { label: 'Kreativ (Texte, Ideen)', params: { temperature: 1.0, topP: 0.95, topK: 40, minP: 0, repeatPenalty: 1.0, presencePenalty: 1.0 } },
};

function qualitySettingsSection() {
  const wrap = el('div', {});
  const redraw = () => { if (wrap.isConnected) wrap.replaceWith(qualitySettingsSection()); };
  const btns = el('div', { class: 'row-gap', style: { flexWrap: 'wrap' } }, Object.entries(QUALITY_PRESETS).map(([k, v]) => el('button', { class: 'btn sm', text: v.label, onclick: () => {
    Object.assign(S.settings.params, v.params);
    saveSettings();
    toast(T('Sampling gesetzt: ') + T(v.label), 3500);
    redraw();
  } })));
  wrap.append(
    frow('Schnellwahl Sampling', 'Setzt Temperatur, Top-P, Top-K, Min-P und Strafen auf erprobte Werte. „Genau“ eignet sich für Code und Fakten, „Ausgewogen“ ist die Qwen-Empfehlung für den Denkmodus, „Kreativ“ für Texte und Ideen.', btns, true),
    frow('Genaueres Sampling bei Dateiarbeit', 'Ist der Dateizugriff an, wird die Temperatur auf die Werkzeug-Temperatur begrenzt. Das verringert erfundene Dateinamen und fehlerhafte Argumente. Im normalen Chat gilt deine Temperatur.', bindSwitch('quality.toolSampling')),
    frow('Werkzeug-Temperatur', 'Obergrenze bei Dateiarbeit. Qwen empfiehlt 0,6 für präzise Aufgaben.', bindNumber('quality.toolTemp', { min: 0, max: 2, step: 0.05 })),
    frow('Hilfe bei falschen Dateinamen', 'Meldet ein Werkzeug „Datei nicht gefunden“, hängt die App die vorhandenen Dateien des Ordners an die Fehlermeldung an. Das Modell sieht dann die echten Namen, statt weiter zu raten.', bindSwitch('quality.pathHelp'))
  );
  return wrap;
}
