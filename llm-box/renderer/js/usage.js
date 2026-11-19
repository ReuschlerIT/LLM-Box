'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   usage.js  –  Gesamtverbrauch aller Chats (Seitenleiste unten, über „Reuschler-IT“)

   Die Summen liegen in der eigenen Datei usage.json im Datenordner und wachsen mit jeder fertigen
   Antwort. Chats loeschen aendert sie NICHT. Beim allerersten Start werden die dann vorhandenen
   Chats einmalig eingerechnet (nur Antworten bis zu diesem Zeitpunkt), damit die Zahl nicht bei 0 beginnt.
   Nicht erfasst: Hintergrund-Aufrufe ohne Chat-Antwort (Unteragenten, Uebergabe, Verbindungstest).
   ══════════════════════════════════════════════════════════════════════════ */

const USAGE_KEY = 'usage';
const USAGE = { v: 1, since: 0, imported: false, runs: 0, prompt: 0, comp: 0, duration: 0, tokSum: 0, secSum: 0, cost: 0, energyWh: 0, energyCost: 0, open: true };
let _usageSave = null;

function usageAddStats(s, conn) {
  if (!s) return;
  const ct = fin(s.completionTokens);
  USAGE.runs++;
  USAGE.prompt += fin(s.promptTokens);
  USAGE.comp += ct;
  USAGE.duration += fin(s.duration);
  const tps = fin(s.tps);
  if (tps > 0 && ct > 0) { USAGE.tokSum += ct; USAGE.secSum += ct / tps; }   // wie chatTotals: nach Tokens gewichteter Durchschnitt
  try { USAGE.cost += costOfStats(s, conn); } catch {}
  const wh = fin(s.energyWh);
  if (wh > 0) { USAGE.energyWh += wh; try { USAGE.energyCost += (wh / 1000) * powerPrice(); } catch {} }
}

/* Nach jeder fertigen Antwort aufrufen (app.js, direkt nach dem Messen des Stroms). */
function usageRecord(stats, conn) {
  if (!stats || stats._counted) return;
  stats._counted = true;
  usageAddStats(stats, conn);
  usageSaveSoon();
  usageRender();
}

function usageSaveSoon() {
  clearTimeout(_usageSave);
  _usageSave = setTimeout(() => { try { api.store.set(USAGE_KEY, USAGE); } catch {} }, 800);
}

async function usageImportExisting() {
  const cutoff = USAGE.since;
  for (const meta of [...S.chatList]) {
    let c = null;
    try { c = await api.chats.load(meta.id); } catch {}
    if (!c || !Array.isArray(c.messages)) continue;
    const conn = connOf(c);
    for (const m of c.messages) {
      if (m.role !== 'assistant' || !m.stats || m.stats._counted) continue;
      if (m.stats.ts && m.stats.ts > cutoff) continue;   // spaeter entstanden: wurde schon live gezaehlt
      usageAddStats(m.stats, conn);
    }
    await new Promise((r) => setTimeout(r, 0));          // Oberflaeche nicht blockieren
  }
  USAGE.imported = true;
  usageSaveSoon();
  usageRender();
}

async function usageInit() {
  let u = null;
  try { u = await api.store.get(USAGE_KEY); } catch {}
  if (u && typeof u === 'object') Object.assign(USAGE, u);
  else { USAGE.since = Date.now(); usageSaveSoon(); }
  if (!USAGE.since) USAGE.since = Date.now();
  usageRender();
  if (!USAGE.imported) usageImportExisting();
}

function usageReset() {
  if (!confirm(T('Gesamtverbrauch auf 0 zurücksetzen? Die Chats bleiben unverändert.'))) return;
  Object.assign(USAGE, { since: Date.now(), imported: true, runs: 0, prompt: 0, comp: 0, duration: 0, tokSum: 0, secSum: 0, cost: 0, energyWh: 0, energyCost: 0 });
  usageSaveSoon();
  usageRender();
}

function usageRender() {
  const box = document.getElementById('usage-foot');
  if (!box) return;
  box.innerHTML = '';
  const total = USAGE.prompt + USAGE.comp;
  const avg = USAGE.secSum > 0 ? USAGE.tokSum / USAGE.secSum : null;
  const priced = S.settings.pricing && S.settings.pricing.enabled;
  const power = USAGE.energyWh > 0;
  const row = (k, v, tip) => el('div', { class: 'u-row', title: tip || '' }, el('span', { class: 'u-k', text: k }), el('span', { class: 'u-v', text: v }));
  const head = el('button', { class: 'u-head', title: T('Gesamtverbrauch aller Chats seit') + ' ' + new Date(USAGE.since).toLocaleDateString(locale()) + '. ' + T('Bleibt erhalten, auch wenn Chats gelöscht werden.'), onclick: () => { USAGE.open = !USAGE.open; usageSaveSoon(); usageRender(); } },
    el('span', { text: (USAGE.open ? '▾ ' : '▸ ') + T('Gesamtverbrauch') }),
    el('span', { class: 'u-sum', text: fmt.tok(total) + ' ' + T('Tokens') }));
  box.append(head);
  if (!USAGE.open) return;
  box.append(
    row(T('Tokens gesamt'), fmt.num(total), T('Eingabe') + ' ' + fmt.num(USAGE.prompt) + ' · ' + T('Ausgabe') + ' ' + fmt.num(USAGE.comp)),
    row(T('Eingabe / Ausgabe'), fmt.tok(USAGE.prompt) + ' / ' + fmt.tok(USAGE.comp)),
    row(T('Ø Tempo'), avg ? fmt.tps(avg) + ' ' + T('Tokens/s') : '–', T('Nach Tokens gewichteter Durchschnitt aller Antworten')),
    row(T('Antworten'), fmt.num(USAGE.runs)),
    row(T('Rechenzeit'), fmt.dur(USAGE.duration))
  );
  if (priced) box.append(row(T('Kosten'), '≈ ' + fmt.money(USAGE.cost, 'EUR'), T('Vergleichswert nach den eingestellten Preisen je 1 Mio. Token')));
  // Strom immer anzeigen (auch ohne Messwerte), damit die Zeile nicht fehlt
  box.append(row(T('Strom'), power ? (powerPrice() > 0 ? fmt.money(USAGE.energyCost, 'EUR') + ' · ' : '') + fmtEnergy(USAGE.energyWh) : '–',
    power ? T('Gemessener GPU-Verbrauch des überwachten Servers') : T('Noch keine Messung: Der Server-Monitor muss GPU-Leistung liefern, und der Strompreis steht unter Einstellungen → Kosten.')));
  box.append(el('button', { class: 'u-reset', text: T('Zurücksetzen'), onclick: usageReset }));
}
