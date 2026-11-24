/* android-adapter.js – läuft zuletzt und macht die Desktop-Oberfläche auf dem Handy bedienbar.
   Er ergänzt Backdrops zum Schließen, blendet Android-fremde Funktionen aus und setzt das
   Standarddesign auf Hell. Die Zustände (Panel/Drawer) werden NICHT gegen app.js gesetzt,
   sondern aus den Klassen abgeleitet, die app.js selbst verwaltet – sonst lässt sich nichts schließen. */
'use strict';

(function () {
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  document.documentElement.classList.add('android');
  if (isTouch) document.documentElement.classList.add('touch');
  // Markierung fuer die Geratemessung: zeigt, dass dieses Skript wirklich lief.
  window.__androidAdapterLoaded = true;

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return [...(r || document).querySelectorAll(s)]; }
  const narrow = () => window.matchMedia('(max-width: 820px)').matches;

  /* Das Standarddesign Hell wird im Build gesetzt (settings.js-Defaults + index.html),
     damit es deterministisch vor app.js gilt und eine eigene Wahl nie überschlägt. */

  /* ══════════ Backdrops: Drawer und Panel zuverlässig schließen ══════════ */
  function ensureBackdrop(id) {
    let b = document.getElementById(id);
    if (b) return b;
    b = document.createElement('div');
    b.id = id;
    document.body.appendChild(b);
    return b;
  }

  /* ── Hamburger für die Chatliste (mobil als Drawer) ── */
  let burger = null;
  function ensureBurger() {
    if (burger && document.body.contains(burger)) return burger;
    const top = $('#topbar .selectors');
    if (!top) return null;
    burger = document.createElement('button');
    burger.id = 'btn-drawer';
    burger.className = 'icon-btn';
    burger.title = 'Chats anzeigen oder verbergen';
    burger.setAttribute('aria-label', 'Chatliste ein- oder ausblenden');
    burger.innerHTML = '&#9776;';
    top.insertBefore(burger, top.firstChild);
    burger.addEventListener('click', () => {
      const open = !document.body.classList.contains('drawer-open');
      document.body.classList.toggle('drawer-open', open);
      if (open) closePanel();
    });
    return burger;
  }

  function closeDrawer() { document.body.classList.remove('drawer-open'); }
  function openDrawer() { document.body.classList.add('drawer-open'); closePanel(); }

  /* ── Workspace-Panel: Zustand aus app.js lesen, nicht gegen sie arbeiten ── */
  // app.js schaltet S.panelOpen und setzt an #filepanel die Klasse "collapsed".
  // Wir spiegeln diesen Zustand nur in body.panel-open (für das Backdrop) und
  // schließen über denselben Knopf, den auch app.js benutzt.
  function panelCollapsed() {
    const f = $('#filepanel');
    return !f || f.classList.contains('collapsed');
  }
  function syncPanelClass() {
    document.body.classList.toggle('panel-open', narrow() && !panelCollapsed());
  }
  function closePanel() {
    if (document.body.classList.contains('panel-open')) $('#btn-panel') && $('#btn-panel').click();
  }

  function wirePanel() {
    const f = $('#filepanel');
    if (!f || f.__androidPanel) return;
    f.__androidPanel = true;
    // auf Klassenänderungen von app.js reagieren
    new MutationObserver(syncPanelClass).observe(f, { attributes: true, attributeFilter: ['class'] });
    syncPanelClass();

    const bd = ensureBackdrop('panel-backdrop');
    bd.addEventListener('click', closePanel);

    // Auf breiten Bildschirmen ist das Panel Teil des Rasters -> kein Overlay-Zustand.
    window.matchMedia('(max-width: 1100px)').addEventListener('change', syncPanelClass);
  }

  function wireDrawer() {
    const bd = ensureBackdrop('drawer-backdrop');
    bd.addEventListener('click', closeDrawer);

    // Chat ausgewaehlt oder Einstellungen geoeffnet -> Drawer zu
    const list = $('#chat-list');
    if (list && !list.__drawer) {
      list.__drawer = true;
      list.addEventListener('click', () => { if (narrow()) closeDrawer(); });
    }

    // Seitliche Navigationselemente schließen ebenfalls
    for (const sel of ['#btn-new', '#btn-settings']) {
      const b = $(sel);
      if (b && !b.__drawerClose) {
        b.__drawerClose = true;
        b.addEventListener('click', () => { if (narrow()) closeDrawer(); });
      }
    }
  }

  /* ══════════ Android-fremde Funktionen ausblenden ══════════ */
  const HIDE_TEXTS = [
    'Fenstermaterial (Windows 11)',
    'Grafikkarte für die Oberfläche nutzen',
    'Es werden nur auf deinem Windows installierte Schriften angezeigt.',
    'KI darf Programme ausführen',
    'Zeitlimit pro Programm (Sekunden)',
  ];
  function hideDesktopRows(root) {
    for (const row of $all('.frow', root || document)) {
      const txt = row.textContent || '';
      if (!HIDE_TEXTS.some((t) => txt.includes(t))) continue;
      row.style.display = 'none';
      row.classList.add('android-hidden');
    }
  }

  function fixWorkspaceHint(root) {
    for (const el of $all('.fhint, .hint', root || document)) {
      // Ausnahmen: die Statuszeilen der Freigabe-Pruefung und die Hinweise des
      // Chat-Sync-Bereichs enthalten bewusst Begriffe wie „Netzlaufwerk“ oder
      // „Laufwerk“ – sie duerfen nicht durch den Workspace-Hinweis ersetzt werden.
      if (el.classList.contains('smb-status')) continue;
      if (el.closest && el.closest('.sync-smb')) continue;
      if (/Netzlaufwerk/.test(el.textContent || '')) continue;
      if (/Laufwerk|C:\\\\|%APPDATA%|Windows-Ordner/i.test(el.textContent || '')) {
        el.textContent = 'Auf Android: Tippe „Ordner wählen“. Die LLM Box kopiert den Ordner in ihren App-Speicher; von dort liest und schreibt die KI.';
      }
    }
  }

  function fixServerNote(root) {
    for (const el of $all('.fhint', root || document)) {
      if (/Bei SSH wird jedes Argument streng geprüft/.test(el.textContent || '')) {
        el.textContent = 'Hinweis: Auf Android läuft alles über die HTTP-Schnittstelle des Servers. Modell starten/entladen, Monitor und Chat funktionieren; die Strata-CLI auf diesem Gerät gibt es auf Android nicht.';
      }
    }
  }

  /* Der Verbindungstest der Einstellungen empfiehlt wörtlich: "… oder klicke oben auf
     „Aktualisieren“ (Pfeile neben der Modellauswahl)" (settings.js:1134). Genau dieser Knopf
     ist auf Android ausgeblendet (android.css, Nutzerwunsch nach einheitlichem Bild unter dem
     Burger). Der Rat ins Leere wäre dieselbe Art Irreführung wie seinerzeit der QR-Hinweis auf
     eine "beliebige QR-App" – deshalb wird er hier auf den Weg umgeschrieben, der tatsächlich
     existiert: Modell- oder Verbindungsauswahl wechseln, oder die Einstellungen schliessen und
     neu öffnen (settings.js:943 ruft refreshModels()).
     Getroffen wird absichtlich NUR dieser eine Satz: er ist eindeutig genug, um keine der
     Statuszeilen der Freigabeprüfung zu erwischen. */
  function fixRefreshHint(root) {
    const treffer = /klicke oben auf .?Aktualisieren.?/;
    for (const el of $all('pre', root || document)) {
      if (!treffer.test(el.textContent || '')) continue;
      el.textContent = (el.textContent || '').replace(
        /Starte die App neu oder klicke oben auf .?Aktualisieren.? \(Pfeile neben der Modellauswahl\)\.?/,
        'Starte die App neu, wähle einmal eine andere Verbindung bzw. ein anderes Modell, oder schliesse diese Einstellungen und öffne sie erneut – jedes davon lädt die Modellliste neu.');
    }
  }

  function noteExecDisabled() {
    const b = $('#btn-tools');
    if (b) b.title = 'Dateizugriff der KI an/aus. Programme ausführen gibt es auf Android nicht.';
    const p = $('#btn-perm');
    if (p) p.title = 'Freigaben für diesen Chat';
    const t = $('#btn-think');
    if (t) t.title = 'Denkaufwand des Modells wählen';
  }

  /* Die Knöpfe der Strata-CLI rufen svRun → api.strata.run auf. Das gibt es auf Android nicht. */
  const CLI_BUTTONS = ['Plan anzeigen', 'Modell starten', 'Presets', 'Schlüssel anzeigen', 'Modelle auf dem Server', 'Verbindung testen'];
  window.__androidHideCli = hideCliButtons;   // für den automatischen Gegenprobe-Test
  function hideCliButtons(root) {
    for (const b of $all('button', root || document)) {
      const t = (b.textContent || '').trim();
      if (!t || !CLI_BUTTONS.some((x) => t.startsWith(x))) continue;
      // FEHLER VON 12.11.: der Reiter „Modell starten" im Server-Fenster heisst genauso wie
      // ein CLI-Knopf. Ihn zu verstecken nahm den Tab weg und der unten angehaengte
      // Hinweistext landete in der Tab-Leiste (svNav) - dort als schmaler Flex-Item
      // umgebrochen, 400 px hoch: die ganze Leiste war 426 px hoch und verdeckte den Inhalt.
      // Reiter sind echte Funktionen (laufen ueber HTTP), keine CLI-Befehle -> nie anfassen.
      if (b.closest('nav')) continue;
      if (!b.classList.contains('btn') && !b.classList.contains('icon-btn')) continue;
      b.style.display = 'none';
      const group = b.parentNode;
      if (group && group.tagName !== 'NAV' && !group.__cliNote) {
        group.__cliNote = true;
        const note = document.createElement('div');
        note.className = 'fhint';
        note.style.cssText = 'color:var(--text-faint);font-size:12.5px;line-height:1.55;padding:6px 0';
        note.textContent = 'Hinweis: Modell starten und entladen läuft auf Android über die HTTP-Schnittstelle des Servers (Knöpfe oben im Server-Fenster). Die Strata-Befehle der Desktop-Version gibt es hier nicht.';
        group.appendChild(note);
      }
    }
  }

  /* ══════════ Touch: lange auf Code tippen = Text markieren ══════════ */
  function wirePressToCopy() {
    const msgs = $('#messages');
    if (!msgs || msgs.__press) return;
    msgs.__press = true;
    let timer = null;
    msgs.addEventListener('touchstart', (e) => {
      const pre = e.target.closest('.msg pre, .code-block, pre');
      if (!pre) return;
      timer = setTimeout(() => {
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(r); }
      }, 450);
    }, { passive: true });
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    msgs.addEventListener('touchend', clear, { passive: true });
    msgs.addEventListener('touchmove', clear, { passive: true });
  }

  /* ══════════ Netzwerkordner (SMB) als Workspace ══════════ */
  // Die Desktop-Version kennt nur lokale Ordner. Auf Android wird zusaetzlich eine
  // Windows-Freigabe angeboten. Beide Schreibweisen werden akzeptiert:
  //   \\192.0.2.10\daten\MeinProjekt     (Windows-UNC, wie am PC ueblich)
  //   /smb/192.0.2.10/daten/MeinProjekt  (interne Form der App)
  // Die Zugangsdaten bleiben im privaten App-Speicher (files/data/smb.json); die
  // Web-Seite bekommt sie nie zurueck und sendet sie nur beim Speichern.
  /* Netzwerkordner in die interne Form /smb/rechner/freigabe/… bringen.
   Alle ueblichen Schreibweisen muessen ankommen, auch mit nur einem fuehrenden
   Backslash - sonst entsteht "/smb//host/share" und der Pfad wird verworfen. */
  function smbNorm(v) {
    let s = String(v || '').trim().replace(/\\/g, '/');
    if (!s) return '';
    s = s.replace(/^\/+/, '');                       // fuehrende Slashes (UNC wie \\host) abtrennen
    if (s.startsWith('smb/')) s = s.substring(4);     // interne Form erneut eingegeben: nicht verdoppeln
    return '/smb/' + s.replace(/\/{2,}/g, '/');
  }

  /* Anzeigetext fuer interne /smb/-Pfade (Windows-Syntax, wie am PC ueblich). */
  function prettySmbPath(p) {
    const m = /^\/smb\/([^/]+)\/([^/]+)(\/.*)?$/.exec(String(p || ''));
    if (!m) return p;
    let s = '\\' + '\\' + m[1] + '\\' + m[2];
    if (m[3]) s += m[3].replace(/\//g, '\\');
    return s;
  }
  function smbHostOf(p) { const g = /^\/smb\/([^/]+)/.exec(String(p || '')); return g ? g[1] : ''; }

  /* Verbindungstest ueber die asynchrone Dateischlange (fsJob): ein direkter, synchroner
     Brueckenaufruf wuerde die Oberflaeche blockieren, solange das Netzwerk antwortet. */
  async function probeSmb(p) {
    try { return await window.__fsJob('smbTest', p); } catch (e) { return { ok: false, error: e.message }; }
  }

  /* Beschreibung einer erreichbaren Freigabe in einen Satz fassen. */
  function smbDescribe(r, p) {
    const m = /^\/smb\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
    let head = `Verbunden: \\\\${m[1]}\\${m[2]}` + (m[3] ? m[3].replace(/\//g, '\\') : '');
    if (r.volume) head += `  (Laufwerk ${r.volume})`;
    const n = r.entries == null ? null : r.entries;
    let tail = n === null ? '' : (n === 0
      ? ' – Ordner ist leer'
      : ` – ${n} Einträge, z. B. ${r.sample}`);
    return head + tail;
  }

  /* Zugangsdaten eines Rechners aus dem privaten App-Speicher holen, damit die Felder beim
     erneuten Oeffnen vorbelegt sind. Ohne das wirkten sie "verloren": die Oberflaeche leert
     beim Schliessen des Dialogs ihre Eingabefelder, und ein erneutes Bestaetigen mit leerem
     Benutzernamen loeschte den gespeicherten Wert -> naechster Versuch lief anonym
     ("Anmeldung abgelehnt"). Das Passwort selbst kommt aus Datenschutzgruenden nie zurueck,
     es wird nur gemeldet, dass eines hinterlegt ist. */
  async function fillCreds(userIn, domIn, passIn, host) {
    if (!host || !window.Native || typeof Native.smbGetCreds !== 'function') return null;
    let r = null;
    try { r = JSON.parse(Native.smbGetCreds(host)); } catch { return null; }
    if (!r || !r.ok) return null;
    if (r.user && !userIn.value) userIn.value = r.user;
    if (r.domain && !domIn.value) domIn.value = r.domain;
    if (r.hasPass) {
      passIn.placeholder = 'Passwort gespeichert – leer lassen zum Beibehalten';
      passIn.title = 'Ein Passwort ist auf diesem Handy hinterlegt. Leer lassen behaelt es; nur zum Aendern neu tippen.';
    }
    return r;
  }

  function smbRow() {
    const cur = (S.settings.workspace && S.settings.workspace.path) || '';
    const m = /^\/smb\/([^/]+)\/([^/]+)(\/.*)?$/.exec(cur);

    const pathIn = document.createElement('input');
    pathIn.type = 'text';
    pathIn.placeholder = '\\192.0.2.10\\daten\\MeinProjekt';
    pathIn.value = cur.startsWith('/smb/') ? cur.replace(/^\/smb\//, '\\\\').replace(/\//g, '\\') : '';
    pathIn.style.cssText = 'width:100%;min-height:42px;font-size:15px';

    const userIn = document.createElement('input');
    userIn.type = 'text'; userIn.placeholder = 'Benutzername (Windows-Konto)';
    userIn.autocomplete = 'off'; userIn.spellcheck = false;
    userIn.style.cssText = 'width:100%;min-height:42px;font-size:15px';

    const domIn = document.createElement('input');
    domIn.type = 'text'; domIn.placeholder = 'Arbeitsgruppe/Domain (meist leer lassbar)';
    domIn.style.cssText = 'width:100%;min-height:42px;font-size:15px';

    const passIn = document.createElement('input');
    passIn.type = 'password'; passIn.placeholder = 'Passwort (leer lassen = gespeichertes behalten)';
    passIn.autocomplete = 'off';
    passIn.style.cssText = 'width:100%;min-height:42px;font-size:15px';

    const status = document.createElement('div');
    status.className = 'fhint smb-status';
    status.style.cssText = 'font-size:12.5px;line-height:1.5;padding:4px 0;color:var(--text-faint)';
    status.textContent = m
      ? `Gesetzt: Freigabe „${m[2]}“ auf ${m[1]}. Die LLM Box liest und schreibt dort direkt.`
      : 'Windows-Freigabe im LAN direkt als Workspace nutzen – es wird nichts auf das Handy kopiert. '
        + 'Die meisten Server erlauben keinen anonymen Zugriff: bitte Benutzername und Passwort eintragen.';

    const hostOf = smbHostOf;

    /* Die Desktop-Oberflaeche zeigt den gewaehlten Ordner in der Zeile darueber an.
       settings.js setzt dieses Label nur beim Aufbau des Tabs (settings.js:634) - wer den
       Pfad hier setzt, sieht dort weiterhin "Kein Ordner gewaehlt". Das Feld wird deshalb
       ueber die bekannte Struktur nachgezogen: erstes div im Steuerungsblock der Zeile. */
    function wsRow() {
      // 1.0.84: Auch der Projekte-Abschnitt nennt „Workspace-Ordner" im Hinweistext.
      // Getroffen wird nur die echte Zeile, deren Beschriftung mit „Workspace-Ordner"
      // beginnt – dieselbe Regel wie in injectSmbRow().
      for (const row of $all('.frow')) {
        if (row.classList.contains('smb-box') || row.classList.contains('sync-smb')) continue;
        const lab = row.querySelector('.flabel > div');
        if (/^Workspace-Ordner/.test(((lab && lab.textContent) || '').trim())) return row;
      }
      return null;
    }
    function syncWsLabel() {
      const row = wsRow();
      if (!row) return false;
      const label = row.querySelector('.fctrl > div');
      if (!label) return false;
      const p = (S.settings.workspace && S.settings.workspace.path) || '';
      label.textContent = p ? prettyWsPath(p) : 'Kein Ordner gewählt';
      label.title = p;
      label.style.color = p ? 'var(--text)' : 'var(--text-faint)';
      return true;
    }

    function prettyWsPath(p) { return prettySmbPath(p); }

    const describe = smbDescribe;

    const probe = probeSmb;

    async function apply() {
      const p = smbNorm(pathIn.value);
      if (!/^\/smb\/[^/]+\/[^/]+/.test(p)) {
        status.textContent = 'Bitte die Freigabe angeben, z. B. \\\\192.0.2.10\\daten oder /smb/192.0.2.10/daten';
        return;
      }
      pathIn.value = prettyWsPath(p);   // Windows-Syntax zurueckzeigen
      const host = hostOf(p);

      // Fehlende Eingaben aus dem Speicher ergaenzen, BEVOR gespeichert wird: sonst wuerde ein
      // leer gelassenes Feld (die Oberflaeche leert sie beim Schliessen des Dialogs) den
      // vorhandenen Benutzer loeschen und der naechste Versuch lief anonym.
      await fillCreds(userIn, domIn, passIn, host);

      // Zugangsdaten ZUERST speichern: auch wenn diese Freigabe gerade ablehnt, kann ein
      // spaeterer Versuch damit arbeiten, ohne dass alles neu eingetragen werden muss.
      try { Native.smbSaveCreds(host, userIn.value.trim(), domIn.value.trim(), passIn.value); } catch { /* egal */ }

      status.textContent = 'Verbindung wird geprüft …';
      const r = await probe(p);
      if (!r.ok) {
        status.textContent = 'Fehler: ' + (r.error || 'nicht erreichbar');
        toast('Freigabe nicht erreichbar – Details stehen über dem Feld', 6000);
        return;
      }
      S.settings.workspace.path = p;
      if (typeof saveSettings === 'function') saveSettings();
      syncWsLabel();
      passIn.value = '';
      status.textContent = describe(r, p) + ' – als Workspace übernommen.';
      toast('Netzwerkordner als Workspace gesetzt', 3500);
    }

    const testBtn = document.createElement('button');
    testBtn.className = 'btn sm'; testBtn.textContent = 'Verbinden & übernehmen';
    testBtn.style.minHeight = '40px';
    testBtn.addEventListener('click', apply);

    // Nur pruefen, ohne etwas zu aendern - damit laesst sich die Erreichbarkeit
    // unabhaengig davon testen, ob der Ordner gerade als Workspace aktiv ist.
    const probeBtn = document.createElement('button');
    probeBtn.className = 'btn sm'; probeBtn.textContent = 'Nur Verbindung testen';
    probeBtn.style.minHeight = '40px';
    probeBtn.addEventListener('click', async () => {
      const p = smbNorm(pathIn.value);
      if (!/^\/smb\/[^/]+\/[^/]+/.test(p)) { status.textContent = 'Bitte zuerst den Freigabe-Pfad angeben.'; return; }
      await fillCreds(userIn, domIn, passIn, hostOf(p));
      try { Native.smbSaveCreds(hostOf(p), userIn.value.trim(), domIn.value.trim(), passIn.value); } catch { /* egal */ }
      status.textContent = 'Prüfe Verbindung …';
      const r = await probe(p);
      if (!r.ok) { status.textContent = 'Fehler: ' + (r.error || 'nicht erreichbar'); return; }
      const active = (S.settings.workspace && S.settings.workspace.path) === p;
      status.textContent = describe(r, p) + (active ? '  ✓ ist als Workspace aktiv.' : '  (noch nicht als Workspace gesetzt)');
    });

    const forgetBtn = document.createElement('button');
    forgetBtn.className = 'btn sm'; forgetBtn.textContent = 'Netzwerk lösen';
    forgetBtn.style.minHeight = '40px';
    forgetBtn.addEventListener('click', () => {
      S.settings.workspace.path = '';
      if (typeof saveSettings === 'function') saveSettings();
      pathIn.value = '';
      status.textContent = 'Netzwerkordner entfernt. Nutze wieder „Wählen …“ für einen Ordner auf dem Handy.';
    });

    const box = document.createElement('div');
    // Klasse smb-box ist wichtig: ohne sie wuerde injectSmbRow() dieses eigene Feld erneut
    // als „Workspace-Ordner“-Zeile erkennen und ein zweites Feld hinein bauen.
    box.className = 'frow stack smb-box';
    box.style.borderTop = '1px solid var(--line)';
    const lab = document.createElement('div');
    lab.className = 'flabel';
    lab.innerHTML = '<b>Netzwerkordner (SMB)</b><div class="fhint">Windows-Freigabe im LAN, direkt gelesen und beschrieben. '
      + 'Pfad wahlweise als <code>\\\\192.0.2.10\\daten</code> oder <code>/smb/192.0.2.10/daten</code>.</div>';
    const ctrl = document.createElement('div');
    ctrl.className = 'fctrl';
    ctrl.style.flexDirection = 'column';
    ctrl.append(pathIn, userIn, domIn, passIn, testBtn, probeBtn, forgetBtn, status);
    box.append(lab, ctrl);

    // Vorbelegen, sobald ein Rechner bekannt ist – der Nutzer soll beim Oeffnen der
    // Einstellungen sofort sehen, dass Benutzername und Passwort noch vorhanden sind.
    async function prefill() {
      const g = /^\/smb\/([^/]+)/.exec(smbNorm(pathIn.value));
      if (!g) return;
      await fillCreds(userIn, domIn, passIn, g[1]);
    }
    pathIn.addEventListener('blur', () => { prefill(); });

    // Bereits gesetzter Pfad: sofort anzeigen und die Erreichbarkeit nachweisen, damit der
    // Nutzer gleich sieht, ob das Ziel erreichbar ist und als Workspace aktiv ist.
    if (m) setTimeout(async () => {
      await prefill();
      syncWsLabel();
      status.textContent = 'Prüfe gespeicherten Netzwerkordner …';
      const r = await probe(cur);
      status.textContent = r.ok ? describe(r, cur) + '  ✓ ist als Workspace aktiv.'
                                : 'Gespeicherter Ordner nicht erreichbar: ' + (r.error || 'unbekannter Fehler');
    }, 300);

    return box;
  }

  function injectSmbRow(root) {
    if (!window.Native || typeof Native.fsJob !== 'function') return;
    for (const row of $all('.frow', root || document)) {
      // Nur die echte Desktop-Zeile meinen. Eigene Bereiche des Adapters koennen denselben
      // Wortlaut enthalten (z. B. ein Knopf „… wie Workspace-Ordner“) und wuerden sonst
      // ein zweites Eingabefeld erzeugen. Verglichen wird deshalb nur das Beschriftungs-Feld.
      if (row.classList.contains('smb-box') || row.classList.contains('sync-smb')) continue;
      const lab = row.querySelector('.flabel > div');
      const label = ((lab && lab.textContent) || '').trim();
      if (!/^Workspace-Ordner/.test(label)) continue;
      if (row.__smbDone) return;
      row.__smbDone = true;
      const box = smbRow();
      if (row.nextSibling) row.parentNode.insertBefore(box, row.nextSibling);
      else row.parentNode.appendChild(box);
      return;
    }
  }

  /* ══════════ Chats auf mehreren Rechnern: Netzlaufwerk als Chat-Ordner ══════════
     Die Desktop-Version bietet hier nur „Ordner wählen …“ an. Auf Android fuehrt dieser
     Weg in die Ordnerauswahl des Systems, und die App kopiert den gewaehlten Ordner in
     ihren eigenen Speicher – es entsteht eine Momentaufnahme, mit der nichts mit einem
     anderen Geraet geteilt werden kann. Netzfreigaben tauchen in dieser Auswahl gar nicht
     auf. Deshalb gibt es zusaetzlich dieselbe Windows-Freigabe-Eingabe wie beim
     Workspace-Ordner: Pfad + Zugangsdaten, Verbindungstest, dann sync.setDir/migrate. */
  function injectSyncSmb(root) {
    if (!window.Native || typeof Native.fsJob !== 'function') return;
    for (const row of $all('.frow', root || document)) {
      if (row.classList.contains('sync-smb') || row.classList.contains('smb-box')) continue;
      if (!(row.textContent || '').includes('Chats auf mehreren Rechnern')) continue;
      if (row.__syncSmbDone) continue;
      row.__syncSmbDone = true;

      const ctrl = row.querySelector('.fctrl') || row;

      // Der Desktop-Knopf „Ordner wählen …“ fuehrt auf Android in die System-Ordnerauswahl,
      // und die App kopiert den Ordner dorthin in ihren eigenen Speicher. Das ist eine
      // Momentaufnahme auf diesem Handy – mit anderen Geraeten geteilt wird dabei nichts.
      // Der Knopf bleibt erhalten (er kann lokal sinnvoll sein), wird aber eindeutig beschriftet.
      for (const b of $all('button', ctrl)) {
        const t = (b.textContent || '').trim();
        if (/^Ordner wählen/.test(t)) {
          b.textContent = 'Ordner auf dem Handy …';
          b.title = 'Kopiert den gewaehlten Ordner in den App-Speicher dieses Handys. Nichts wird mit anderen Geraeten geteilt – dafuer unten die Windows-Freigabe nutzen.';
        }
      }

      const inp = (type, ph) => {
        const i = document.createElement('input');
        i.type = type; i.placeholder = ph;
        if (type === 'text') { i.autocomplete = 'off'; i.spellcheck = false; }
        if (type === 'password') i.autocomplete = 'off';
        i.style.cssText = 'width:100%;min-height:42px;font-size:15px;margin-top:6px';
        return i;
      };

      // Bereits gesetzter gemeinsamer Ordner? Dann zeigen (und nachpruefen).
      let curDir = '';
      try { curDir = (S.sync && S.sync.dir) || ''; } catch {}

      const pathIn = inp('text', '\\192.0.2.30\\daten oder /smb/192.0.2.30/daten');
      pathIn.value = curDir.startsWith('/smb/') ? prettySmbPath(curDir) : '';
      const userIn = inp('text', 'Benutzername (Windows-Konto)');
      const domIn = inp('text', 'Arbeitsgruppe/Domain (meist leer lassbar)');
      const passIn = inp('password', 'Passwort (leer lassen = gespeichertes behalten)');

      const status = document.createElement('div');
      status.className = 'fhint smb-status';
      status.style.cssText = 'font-size:12.5px;line-height:1.5;padding:6px 0 2px;color:var(--text-faint)';
      status.textContent = curDir
        ? `Aktiv: ${prettySmbPath(curDir)}\\LLM-Box-Chats`
        : 'Windows-Freigabe im LAN als gemeinsamer Chat-Ordner. Die App legt dort den Unterordner „LLM-Box-Chats“ an und liest/schreibt direkt – es wird nichts auf das Handy kopiert.';

      const box = document.createElement('div');
      box.className = 'frow stack sync-smb';
      box.style.cssText = 'border-top:1px solid var(--line);margin-top:10px;padding-top:8px';
      const lab = document.createElement('div');
      lab.className = 'flabel';
      lab.innerHTML = '<b>Netzlaufwerk (Windows-Freigabe) als Chat-Ordner</b>'
        + '<div class="fhint">Auf dem Handy gibt es keine Netzlaufwerke in der Ordnerauswahl – deshalb hier direkt eingeben. '
        + 'Pfad wahlweise <code>\\\\192.0.2.30\\daten</code> oder <code>/smb/192.0.2.30/daten</code>. '
        + 'Zugangsdaten bleiben im privaten App-Speicher, die Web-Seite sieht sie nie wieder.</div>';

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';

      const busy = (on) => { for (const b of $all('button', btnRow)) b.disabled = on; };

      async function reloadChats() {
        try {
          S.sync = await window.api.sync.get();
          S.chat = null;
          await loadChatList();
          if (S.chatList.length) await openChat(S.chatList[0].id); else newChat();
        } catch {}
      }

      // Nach dem Setzen muss die Desktop-Zeile neu gebaut werden, sonst stehen dort noch
      // ihre alten Knöpfe/Zustände. Der Reiter „Daten“ wird dafuer einfach neu angewaehlt.
      function refreshDatenTab() {
        for (const nav of $all('.settings nav')) {
          const b = [...nav.querySelectorAll('button')].find((x) => /^Daten/.test((x.textContent || '').trim()));
          if (b && nav.contains(b)) { b.click(); return true; }
        }
        return false;
      }

      // Vorbelegen, sobald ein Rechner bekannt ist: Benutzername und Domain aus dem
      // privaten App-Speicher. Das Passwort kommt bewusst nie zurueck - es wird nur
      // angezeigt, dass eines hinterlegt ist.
      async function prefill() {
        const g = /^\/smb\/([^/]+)/.exec(smbNorm(pathIn.value));
        if (!g) return;
        await fillCreds(userIn, domIn, passIn, g[1]);
      }
      pathIn.addEventListener('blur', () => { prefill(); });

      async function apply() {
        const p = smbNorm(pathIn.value);
        if (!/^\/smb\/[^/]+\/[^/]+/.test(p)) {
          status.textContent = 'Bitte die Freigabe angeben, z. B. \\\\192.0.2.30\\daten oder /smb/192.0.2.30/daten';
          return;
        }
        pathIn.value = prettySmbPath(p);
        // Zugangsdaten ZUERST speichern: auch wenn diese Freigabe gerade ablehnt, kann ein
        // spaeterer Versuch damit arbeiten, ohne dass alles neu eingetragen werden muss.
        try { Native.smbSaveCreds(smbHostOf(p), userIn.value.trim(), domIn.value.trim(), passIn.value); } catch {}

        busy(true);
        status.textContent = 'Verbindung wird geprüft …';
        const r = await probeSmb(p);
        if (!r.ok) {
          busy(false);
          status.textContent = 'Fehler: ' + (r.error || 'nicht erreichbar');
          toast('Freigabe nicht erreichbar – Details stehen über dem Feld', 6000);
          return;
        }

        status.textContent = 'Ordner wird angelegt und gesetzt …';
        let res = null;
        try { res = await window.api.sync.setDir(p); } catch (e) { res = { ok: false, error: e.message }; }
        busy(false);
        if (!res || !res.ok) {
          status.textContent = 'Freigabe erreichbar, aber nicht beschreibbar: ' + ((res && res.error) || 'unbekannter Fehler');
          return;
        }
        passIn.value = '';
        status.textContent = smbDescribe(r, p) + ' – Chats liegen jetzt dort.';
        toast('Gemeinsamer Chat-Ordner gesetzt', 3500);

        if (await confirmModal('Lokale Chats kopieren?',
          'Sollen die Chats, die bisher nur auf diesem Handy liegen, in den gemeinsamen Ordner kopiert werden? Vorhandene Chats werden nicht überschrieben.',
          { okLabel: 'Kopieren' })) {
          let m = null;
          try { m = await window.api.sync.migrate(); } catch (e) { m = { ok: false, error: e.message }; }
          toast(m && m.ok ? `${m.copied} Chat(s) kopiert${m.skipped ? `, ${m.skipped} waren schon vorhanden` : ''}.` : ((m && m.error) || 'Kopieren fehlgeschlagen'), 5000);
        }
        await reloadChats();
        refreshDatenTab();
      }

      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn sm'; applyBtn.textContent = 'Freigabe verbinden & übernehmen';
      applyBtn.style.minHeight = '40px';
      applyBtn.addEventListener('click', apply);

      const probeBtn = document.createElement('button');
      probeBtn.className = 'btn sm'; probeBtn.textContent = 'Nur Verbindung testen';
      probeBtn.style.minHeight = '40px';
      probeBtn.addEventListener('click', async () => {
        const p = smbNorm(pathIn.value);
        if (!/^\/smb\/[^/]+\/[^/]+/.test(p)) { status.textContent = 'Bitte zuerst den Freigabe-Pfad angeben.'; return; }
        try { Native.smbSaveCreds(smbHostOf(p), userIn.value.trim(), domIn.value.trim(), passIn.value); } catch {}
        busy(true);
        status.textContent = 'Prüfe Verbindung …';
        const r = await probeSmb(p);
        busy(false);
        if (!r.ok) { status.textContent = 'Fehler: ' + (r.error || 'nicht erreichbar'); return; }
        const active = curDir === p;
        status.textContent = smbDescribe(r, p) + (active ? '  ✓ ist als Chat-Ordner aktiv.' : '  (noch nicht als Chat-Ordner gesetzt)');
      });

      // Tipparbeit sparen: wer den Workspace schon auf einer Freigabe hat, kann dieselbe
      // Freigabe fuer die Chats uebernehmen.
      const wsPath = (S.settings.workspace && S.settings.workspace.path) || '';
      let takeBtn = null;
      if (/^\/smb\//.test(wsPath)) {
        takeBtn = document.createElement('button');
        takeBtn.className = 'btn sm'; takeBtn.textContent = 'Wie Workspace-Ordner';
        takeBtn.style.cssText = 'min-height:40px';
        takeBtn.title = prettySmbPath(wsPath);
        takeBtn.addEventListener('click', async () => {
          pathIn.value = prettySmbPath(wsPath);
          await prefill();   // gleich die gespeicherten Zugangsdaten dieses Rechners zeigen
          status.textContent = 'Pfad uebernommen – jetzt testen.';
        });
      }

      btnRow.append(applyBtn, probeBtn);
      if (takeBtn) btnRow.append(takeBtn);

      const ctrlBox = document.createElement('div');
      ctrlBox.className = 'fctrl';
      ctrlBox.style.cssText = 'display:flex;flex-direction:column;gap:0;width:100%';
      ctrlBox.append(pathIn, userIn, domIn, passIn, btnRow, status);
      box.append(lab, ctrlBox);

      const holder = document.createElement('div');
      holder.style.cssText = 'width:100%;flex-basis:100%';
      holder.append(box);
      ctrl.append(holder);

      // Gespeicherter Ordner: Erreichbarkeit sofort nachweisen, damit der Nutzer sieht,
      // ob die Freigabe gerade erreichbar ist. Zuerst die Zugangsdaten vorbelegen – der
      // Nutzer soll beim Oeffnen sofort sehen, dass Benutzername und Passwort noch da sind.
      if (curDir.startsWith('/smb/')) setTimeout(async () => {
        await prefill();
        status.textContent = 'Prüfe gespeicherten Chat-Ordner …';
        const r = await probeSmb(curDir);
        status.textContent = r.ok ? smbDescribe(r, curDir) + '  ✓ ist als Chat-Ordner aktiv.'
                                  : 'Gespeicherter Ordner nicht erreichbar: ' + (r.error || 'unbekannter Fehler');
      }, 400);
      return;
    }
  }

  /* ══════════ Beobachter für dynamisch erzeugte Dialoge ══════════ */
  /* ══════════ Beobachter für dynamisch erzeugte Dialoge ══════════ */
  let syncNeeded = false;
  let syncScheduled = false;
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        hideDesktopRows(n);
        fixWorkspaceHint(n);
        fixServerNote(n);
        hideCliButtons(n);
        injectSmbRow(n);
        /* Der Verbindungstest schreibt seinen Text in ein bereits vorhandenes <pre>
           (settings.js:252 diagOut, textContent = ...). Dabei meldet der Beobachter nur
           TEXT-Knoten als addedNodes (nodeType 3), nicht das Element selbst – eine
           Element-Suche auf die hinzugefuegten Knoten wuerde den Satz also NIE finden.
           Er wird deshalb unten ueber das ganze Dokument nachgelaufen. */
        if ((n.nodeType === 1 || n.nodeType === 3) && /Aktualisieren/.test(String(n.textContent || ''))) syncNeeded = true;
        syncNeeded = true;
      }
    }
    // Die Sync-Zeile entsteht erst NACH einem await (api.sync.get) und ist der
    // hinzugefuegte Knoten selbst – eine reine Nachkommen-Suche wuerde sie nie finden.
    // Deshalb einmal ueber das ganze Dokument schauen, gebuendelt pro Frame.
    if (syncNeeded && !syncScheduled) {
      syncScheduled = true;
      setTimeout(() => {
        syncScheduled = false;
        injectSyncSmb(document);
        fixRefreshHint(document);   // Text liegt in einem bestehenden <pre>, siehe oben
      }, 60);
    }
  });

  /* ══════════ Kontext-Füllstand in eine eigene Zeile setzen ══════════
     Desktop haelt den Fuellstand-Balken rechts neben den Funktionsknoepfen der Kopfzeile.
     Auf dem Handy ist diese Knopfreihe bereits voll (sechs Elemente auf 384 CSS-px), der
     Balken wurde dort gequetscht und war kaum ablesbar. Das Element wandert deshalb als
     letztes Kind direkt in #topbar - android.css macht daraus mit flex-basis:100% eine
     eigene Zeile unter den Knoepfen. */
  function moveCtxMeter() {
    const box = document.getElementById('ctx-meter');
    const top = $('#topbar');
    if (!box || !top) return;
    if (box.parentNode === top) return;      // bereits verschoben
    top.appendChild(box);
  }

  /* ══════════ Obere Leiste umbauen: Auswahlfelder nicht mehr bedrängen ══════════ */
  // Ursprung: .selectors enthaelt Verbindung, Modell UND die Knöpfe Unteragenten/Server/
  // Monitor. Auf 384 CSS-px blieben fur die beiden Auswahlfelder nur ~100 px - der Name
  // (z. B. "Ollama (lokal)") war abgeschnitten. Die Funktionsknopfe wandern deshalb in
  // die Knopfzeile darunter, die Auswahlfelder bekommen je eine halbe Zeile.
  function reorderTopbar() {
    const sel = $('#topbar .selectors');
    const right = $('#topbar .topbar-right');
    if (!sel || !right) return;
    for (const id of ['btn-agents', 'btn-server', 'btn-monitor']) {
      const b = document.getElementById(id);
      if (b && b.parentNode !== right) right.insertBefore(b, right.firstChild);
    }
    moveCtxMeter();   // Fuellstand-Balken in eine eigene Zeile (siehe oben)
    fitSelectors();
  }

  /* ══════════ Auswahlfelder so breit machen, dass der Name lesbar bleibt ══════════
     Am Gerat gemessen: Verbindung braucht ~103 px, der Modellname ~194 px. In einer Zeile
     stehen auf 384 CSS-px aber nur ~308 px zur Verfuegung (Hamburger und Abstaende abgezogen)
     – beide Felder waren abgeschnitten. Ein <select> kann seinen Text nicht umbrechen,
     deshalb wird der Bedarf gemessen und notfalls das Modellauswahlfeld in eine eigene
     Zeile gesetzt. Die Messung nutzt dieselbe Canvas-Berechnung wie selInfo(). */
  function selectNeed(sel) {
    try {
      const opt = sel.options ? (sel.options[sel.selectedIndex] || sel.options[0]) : null;
      if (!opt) return 90;
      const cs = getComputedStyle(sel);
      let need = 0;
      const cv = document.createElement('canvas');
      const c = cv.getContext && cv.getContext('2d');
      if (c) { c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; need = c.measureText(opt.textContent || '').width; }
      else need = (opt.textContent || '').length * parseFloat(cs.fontSize) * 0.62;
      // 34 px fuer Pfeil und Rand, plus 8 px Luft: die Messung ist rechnerisch (Canvas) und
      // liegt oft um ein paar Zehntel Pixel daneben. Am Gerat fuehrte genau das dazu, dass ein
      // Feld mit "Bedarf = Breite" knapp als abgeschnitten gemeldet wurde.
      return Math.round(need) + 42;
    } catch { return 130; }
  }

  function fitSelectors() {
    const conn = document.getElementById('sel-conn');
    const model = document.getElementById('sel-model');
    const box = $('#topbar .selectors');
    if (!conn || !model || !box) return;

    // Zustand zuruecksetzen, damit die Messung nicht von einer alten Einstellung abhaengt
    conn.style.flex = ''; conn.style.width = '';
    model.style.flex = ''; model.style.width = ''; model.style.flexBasis = '';

    const needC = selectNeed(conn);
    const needM = selectNeed(model);
    const burger = document.getElementById('btn-drawer');
    const refresh = document.getElementById('btn-refresh');
    /* Alles, was ausser den beiden Feldern in der Reihe steht: Hamburger, ggf. der Knopf
       "Modelle neu laden" und die Abstaende. Frueher wurde nur der Hamburger gerechnet,
       dadurch war die verfuegbare Breite zu gross eingeschaetzt und das Modelfeld rutschte
       trotzdem in eine zweite Zeile.

       Der Knopf wird auf Android ausgeblendet (android.css, eigene Regel ausserhalb der
       Media-Query: #topbar .selectors #btn-refresh { display:none !important }). Ein
       ausgeblendetes Element misst 0 px, es darf aber auch dann nicht gerechnet werden, wenn
       der Knoten weiter im DOM steckt – sonst gingen ~34 px Breitenbedarf fuer etwas ab, das
       der Nutzer nie sieht. Getrennt wird ueber die Klasse am Dokument (android-adapter.js:9
         setzt html.android), nicht ueber getComputedStyle: das ist unabhaengig davon, wann und
       ob die Stylesheets in einer Messumgebung schon ausgewertet wurden. */
    const refreshSichtbar = !!refresh && refresh.parentNode === box
      && !document.documentElement.classList.contains('android');
    const used = (burger ? burger.getBoundingClientRect().width + 6 : 0)
               + (refreshSichtbar ? refresh.getBoundingClientRect().width + 6 : 0)
               + 12;
    const avail = Math.round(box.getBoundingClientRect().width - used);

    if (needC + needM <= avail) {
      conn.style.flex = '0 0 auto'; conn.style.width = needC + 'px';
      model.style.flex = '1 1 auto'; model.style.minWidth = needM + 'px';
      window.__selLayout = 'eine Reihe, beide voll';
    } else if (avail - needM >= 74) {
      /* Gewuenschtes Verhalten des Nutzers: Verbindung, Modell und der Knopf "Modelle neu
         laden" in EINER Reihe. Reicht der Platz nicht fuer beide vollen Namen, bekommt das
         Modelfeld seinen vollen Bedarf (der Modellname ist der wichtige Wert) und das
         Verbindungsfeld den Rest - es zeigt dann nur einen gekuerzten Servernamen. Immer noch
         eine Zeile, kein Umbruch. */
      model.style.flex = '0 0 auto'; model.style.width = needM + 'px';
      conn.style.flex = '1 1 auto'; conn.style.minWidth = '74px';
      window.__selLayout = 'eine Reihe, Verbindung gekuerzt (' + (avail - needM) + 'px)';
    } else {
      // Wirklich zu wenig Platz (sehr schmaler Bildschirm): Modell in eine eigene Zeile.
      conn.style.flex = '0 0 auto'; conn.style.width = Math.min(needC, avail) + 'px';
      model.style.flex = '1 1 100%'; model.style.minWidth = needM + 'px';
      window.__selLayout = 'gestapelt (zu schmal: ' + avail + 'px)';
    }
    document.documentElement.classList.toggle('sel-stacked', !!window.__selLayout && window.__selLayout.startsWith('gestapelt'));
  }

  function wireSelectors() {
    for (const id of ['sel-conn', 'sel-model']) {
      const s = document.getElementById(id);
      if (!s || s.__fit) continue;
      s.__fit = true;
      // Nach Modell-/Verbindungswechsel aendert sich der needed-Text -> neu verteilen.
      s.addEventListener('change', () => setTimeout(fitSelectors, 30));
    }
    window.addEventListener('resize', () => fitSelectors());
  }

  /* ══════════ Selbstmessung für die Geräteprüfung (nur wenn die Brücke uiLog hat) ══════════ */
  // Meldet Layout-Kennzahlen bei jeder relevanten Änderung ins Logcat (Tag LLMBOX-UI).
  // Damit lässt sich per adb prüfen: Statusleisten-Abstand, Icon-Zeile ohne Umbruch,
  // Panel/Drawer offen oder zu.
  function measure(why) {
    if (!window.Native || typeof window.Native.uiLog !== 'function') return;
    try {
      const rect = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; };
      const ids = ['btn-attach', 'btn-attach-folder', 'btn-think', 'btn-tools', 'btn-perm', 'token-estimate', 'btn-send'];
      const ys = []; let wsum = 0;
      for (const id of ids) {
        const r = rect(id);
        if (!r || (r.width === 0 && r.height === 0)) continue;
        ys.push(Math.round(r.top + r.height / 2));
        wsum += Math.round(r.width);
      }
      const sameLine = ys.length ? ys.every((y) => Math.abs(y - ys[0]) <= 3) : null;
      const tb = rect('topbar'); const inp = rect('input'); const sr = rect('st-right');
      const fp = $('#filepanel');

      // FEHLER, der diese Messung jahrelang komplett verhinderte: getComputedStyle() bekam
      // hier ein DOMRect (rect('st-right')) statt des Elements. Chromium wirft einen
      // TypeError, das umschliessende catch hat ihn verschluckt - es kam nie eine Zeile an.
      const srEl = document.getElementById('st-right');
      const srLineH = srEl ? parseFloat(getComputedStyle(srEl).lineHeight) || 0 : 0;

      // Vollstaendig sichtbar oder abgeschnitten? scrollX/Y ist der zu grossen Inhaltmenge
      // gleich dem sichtbaren Teil – ist sie groesser, fehlt etwas (der Nutzer sah Tokens,
      // Kosten und Dauer nicht komplett).
      const clip = (e) => (!e ? null : {
        x: e.scrollWidth > e.clientWidth + 1, y: e.scrollHeight > e.clientHeight + 1,
        sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight,
      });

      // Kontext-Fuellstand: eigene Zeile? (Adapter verschiebt das Element direkt in #topbar)
      const ctx = document.getElementById('ctx-meter');
      const ctxInfo = !ctx ? null : {
        parent: ctx.parentNode ? (ctx.parentNode.id || ctx.parentNode.tagName.toLowerCase()) : '-',
        zeile: getComputedStyle(ctx).flexBasis,
        text: (ctx.textContent || '').trim().slice(0, 40),
      };

      // Chatliste: sind Umbenennen/Löschen sichtbar und touch-tauglich? (android.css)
      let chatActs = null;
      try {
        const item = document.querySelector('.chat-item');
        if (item) {
          const acts = item.querySelector('.acts');
          const mb = acts ? acts.querySelector('.mini-btn') : null;
          const cs = mb ? getComputedStyle(mb) : null;
          const r = mb ? mb.getBoundingClientRect() : null;
          chatActs = {
            acts: acts ? getComputedStyle(acts).display : 'fehlt',
            buttons: acts ? acts.querySelectorAll('.mini-btn').length : 0,
            size: cs ? Math.round(parseFloat(cs.minWidth)) + 'x' + Math.round(parseFloat(cs.minHeight)) : '-',
            drawn: r ? Math.round(r.width) + 'x' + Math.round(r.height) : '-',
          };
        }
      } catch { chatActs = null; }

      // Überlauf der oberen Leiste: ragen Elemente über den sichtbaren Rand hinaus?
      const over = [];
      for (const id of ['btn-agents', 'btn-server', 'btn-monitor', 'btn-handoff', 'btn-export', 'btn-panel']) {
        const r = rect(id);
        if (!r || (r.width === 0 && r.height === 0)) continue;
        if (r.right > window.innerWidth + 1) over.push(id + '@' + Math.round(r.right));
      }
      // Tab-Leiste im offenen Dialog (Einstellungen oder Server)
      const nav = $('.modal .settings nav');
      let navInfo = null;
      if (nav) {
        const kids = [...nav.querySelectorAll('button')];
        navInfo = {
          h: Math.round(nav.getBoundingClientRect().height),
          n: kids.length,
          w: kids.map((b) => Math.round(b.getBoundingClientRect().width)).join('/'),
          scrollX: nav.scrollWidth > nav.clientWidth + 1,
        };
      }

      // Auswahlfelder: passen Verbindung/Modell vollstaendig hinein?
      // select breitet seinen Text nicht aus - deshalb die Textbreite separat messen.
      const selInfo = (id) => {
        const e = document.getElementById(id);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        let need = 0;
        const opt = e.options ? (e.options[e.selectedIndex] || e.options[0]) : null;
        try {
          const cs = getComputedStyle(e);
          const cv = document.createElement('canvas');
          const c = cv.getContext && cv.getContext('2d');
          if (c && opt) {
            c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            need = c.measureText(opt.textContent || '').width + 34;   // 34 px fuer Pfeil+Rand
          } else if (opt) {
            need = (opt.textContent || '').length * parseFloat(cs.fontSize) * 0.62 + 34;
          }
        } catch { /* Messung darf nie stören */ }
        return { w: Math.round(r.width), need: Math.round(need), cut: need > r.width };
      };

      Native.uiLog(JSON.stringify({
        why: why || 'init',
        vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio,
        topbarTop: tb ? Math.round(tb.top) : null,
        inputBottom: inp ? Math.round(inp.bottom) : null,
        composerButtons: ys.length, composerSameLine: sameLine, composerWidth: wsum,
        stRightLines: (sr && srLineH) ? Math.round(sr.height / srLineH) : null,
        // Statuszeile: abgeschnitten? und Kontextbalken in eigener Zeile?
        stLeftClip: clip(document.getElementById('st-left')),
        stRightClip: clip(srEl),
        ctxMeter: ctxInfo,
        chatActs: chatActs,
        topbarOverflow: over.join(',') || 'none',
        selConn: selInfo('sel-conn'), selModel: selInfo('sel-model'),
        selScroll: (function () { const s = $('#topbar .selectors'); return s ? s.scrollWidth + '/' + s.clientWidth : null; })(),
        btnServer: (function () { const r = rect('btn-server'); return r ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null; })(),
        nav: navInfo,
        theme: document.documentElement.getAttribute('data-theme'),
        drawerOpen: document.body.classList.contains('drawer-open'),
        panelCollapsed: fp ? fp.classList.contains('collapsed') : null,
      }));
    } catch { /* Diagnose darf nie stören */ }
  }

  function wireSelfMeasure() {
    if (!window.Native || typeof window.Native.uiLog !== 'function') return;
    const f = $('#filepanel');
    if (f) new MutationObserver(() => measure('panel')).observe(f, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(() => measure('body')).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // Dialoge (Einstellungen, Server & Monitor) erscheinen im #modal-root
    const mr = $('#modal-root');
    if (mr) new MutationObserver(() => setTimeout(() => measure('modal'), 250)).observe(mr, { childList: true, subtree: true });
    window.addEventListener('resize', () => measure('resize'));
    setTimeout(() => measure('start'), 900);
  }

  function boot() {
    ensureBurger();
    wireDrawer();
    wirePanel();
    reorderTopbar();
    hideDesktopRows(document);
    hideCliButtons(document);
    noteExecDisabled();
    wirePressToCopy();
    wireSelfMeasure();
    wireSelectors();             // Auswahlfelder bedarfsgerecht breit machen
    injectSyncSmb(document);          // falls ein Dialog schon vor dem Beobachter offen war
    mo.observe(document.body, { childList: true, subtree: true });

    // Die Modelliste wird erst nach dem Laden fullstandig gefullt - danach neu verteilen.
    const mm = document.getElementById('sel-model');
    if (mm) new MutationObserver(() => setTimeout(fitSelectors, 40)).observe(mm, { childList: true, subtree: true });

    if (isTouch) document.documentElement.classList.add('softkeys');
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
})();
