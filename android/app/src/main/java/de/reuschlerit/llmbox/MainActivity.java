package de.reuschlerit.llmbox;

import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CoderResult;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * LLM Box für Android.
 *
 * Die komplette Anwendungslogik (Chat, Werkzeuge, Workspace, Monitor …) läuft unverändert als
 * JavaScript in der WebView. Diese Activity liefert ausschließlich die Dienste, die ein normaler
 * Browser nicht darf:
 *   - echtes Dateisystem (list_files / read_file / edit_file / write_file / search_text)
 *   - HTTP ohne CORS-Grenze (lokale Server im LAN, Cloud-APIs) inkl. Streaming und Abbruch
 *   - Ordner/Dateien auswählen (Storage Access Framework), Speichern unter, Links öffnen
 * Absichtlich nicht vorhanden, weil es Android so nicht gibt: lokale Befehle ausführen,
 * Programme installieren, SSH. Diese Kanäle liefern eine klare Rückmeldung an die Web-App.
 */
public class MainActivity extends AppCompatActivity {

    static final String START_URL = "file:///android_asset/webapp/index.html";

    private WebView web;
    private File dataDir;          // Chats, Einstellungen, Anhänge
    private File workspaceRoot;    // Standard-Workspace für die KI-Werkzeuge

    private ActivityResultLauncher<Intent> folderLauncher;
    private ActivityResultLauncher<Intent> filesLauncher;
    private ActivityResultLauncher<Intent> saveLauncher;

    /* Laufzeit-Erlaubnis fuer die Kamera (QR-Scan). Wird erst beim ersten Scan angefragt, nicht
       bei jedem Start. Nach der Antwort meldet sich die Web-Seite zurueck und startet die
       Vorschau neu – so bleibt der Knopf im Dialog erhalten, statt dass der Nutzer ihn zweimal
       druecken muss. */
    private ActivityResultLauncher<String> cameraLauncher;

    private byte[] pendingSaveBytes;

    /**
     * Messsonde nur auf ausdruecklichen Wunsch: die Sonde oeffnet im Bildschirm sichtbar
     * Einstellungs- und Server-Fenster und misst sie. Wuerde das bei jedem Start laufen,
     * wirkte die App fehlerhaft ("startet von selbst mit Dialogen"). Anfordern mit
     *   adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez probe true
     */
    private boolean uiProbeRequested = false;

    /**
     * Echte Chat-Nachrichten verschickt die Sonde nur mit einem zweiten, ausdruecklichen
     * Schalter:  adb shell am start -n de.reuschlerit.llmbox/.MainActivity \
     *              --ez probe true --ez probechat true
     * Ohne diesen Schalter bleiben die Chats des Nutzers unangetastet.
     */
    private boolean chatProbeRequested = false;

    /** True, sobald die Web-Oberflaeche geladen ist (danach darf JS angestossen werden). */
    private volatile boolean pageLoaded = false;

    /** Streaming-fähiger HTTP-Client: keine Read-/Call-Timeouts, sonst bricht Laden großer Modelle ab. */
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false)
            .build();

    private final Map<String, Call> activeCalls = new ConcurrentHashMap<>();

    /**
     * Datei- und Netzwerkzugriffe (SMB) laufen in diesem Pool und nicht im Brücken-Thread.
     * Grund: Ein @JavascriptInterface-Aufruf blockiert den Render-Thread der WebView, bis er
     * zurückkehrt. Bei einem Workspace auf einer Windows-Freigabe konnte dadurch schon ein
     * einziger langsamer Liste-Lesevorgang die ganze Oberfläche sekundenlang einfrieren lassen
     * ("App friert mitten im Chat ein"). Die Brücke liefert deshalb nur noch eine Auftrags-ID,
     * das Ergebnis kommt per window.__fsResult(id, json) zurück.
     */
    private final ExecutorService fsPool = Executors.newFixedThreadPool(4);

    /** Zeitgrenze für einen Dateiauftrag: danach meldet die Web-App einen Fehler statt zu warten. */
    static final long FS_JOB_TIMEOUT_MS = 25_000;

    /** Dateizugriff auf Windows-Freigaben (smb://… wird in /smb/host/share/… uebersetzt). */
    private final SmbStore smb = new SmbStore();

    /* ────────────────────────── Start ────────────────────────── */

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        uiProbeRequested = getIntent() != null && getIntent().getBooleanExtra("probe", false);
        chatProbeRequested = getIntent() != null && getIntent().getBooleanExtra("probechat", false);

        dataDir = new File(getFilesDir(), "data");
        if (!dataDir.exists() && !dataDir.mkdirs()) dataDir = getFilesDir();

        // SMB-Zugangsdaten werden pro Rechner aus dem privaten App-Speicher geholt.
        smb.setCredsLookup(this::loadCreds);

        File ext = getExternalFilesDir(null);
        workspaceRoot = new File(ext == null ? getFilesDir() : ext, "workspace");
        if (!workspaceRoot.exists() && !workspaceRoot.mkdirs()) workspaceRoot = getFilesDir();

        web = new WebView(this);
        // Die WebView bekommt das System-Padding selbst nicht zuverlässig an ihren HTML-Inhalt weiter
        // (sie zeichnet bei y=0). Deshalb sitzt sie in einem Container, der den Abstand erhält.
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.addView(web, new android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Ab Android 15 (targetSdk 35) läuft jede App randlos ("edge-to-edge"): die WebView würde
        // bei y=0 beginnen und ihr oberer Rand läge unter der Statusleiste – unbedienbar.
        // Deshalb werden die System-Abstände (Statusleiste, Notch, Navigationsleiste) als
        // Innenabstand gesetzt; die Web-Oberfläche sieht dadurch wieder ihre eigene, freie Fläche.
        applyEdgeToEdge(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowContentAccess(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        /* QR-Scan: getUserMedia liefert der WebView nur Bilder, wenn play() erlaubt ist. Steht die
           Forderung auf "Benutzergeste", wird video.play() ohne echten Nutzertipp abgelehnt und die
           Vorschau bleibt SCHWARZ (Nutzerbericht S20: Kamerabild nicht sichtbar). Der Scan beginnt
           hier ausdruecklich durch einen Knopfdruck, ein Mikrofon wird zusaetzlich nie angefordert. */
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setBackgroundColor(0xFF101418);

        folderLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            if (r.getResultCode() == RESULT_OK && r.getData() != null) onFolderPicked(r.getData());
            else js("__pickResult", "null");
        });
        filesLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            if (r.getResultCode() == RESULT_OK && r.getData() != null) onFilesPicked(r.getData());
            else js("__pickResult", "null");
        });
        saveLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            Uri target = (r.getResultCode() == RESULT_OK && r.getData() != null) ? r.getData().getData() : null;
            if (target != null) onSaveTarget(target);
            else js("__saveResult", "null");
        });
        cameraLauncher = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            /* Ergebnis der Nachfrage. Bei Ablehnung sagt die Web-Seite, dass Suchen auch ohne
               Kamera funktioniert – die Uebertragung haengt nicht an der Kamera. */
            js("__qrPermission", granted ? "true" : "false");
        });

        /* QR-Scan: die Web-Seite öffnet eine Kamera-Vorschau mit getUserMedia. Damit die WebView
           das darf, muss hier die Anfrage beantwortet werden – ohne diesen Override lehnt sie jede
           Kamera-Anfrage still ab und die Scanner-Seite bleibt schwarz. Die eigentliche
           Laufzeit-Erlaubnis holt qrScanStart() vorher ein (cameraLauncher). */
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebChromeClient(new WebChromeClient() {
            /* Die Ressourcen von PermissionRequest sind STRINGS (RESOURCE_VIDEO_CAPTURE ist eine
               String-Konstante). Ein Typ wie PermissionRequest.Resource existiert nicht und war der
               Grund fuer drei Compile-Fehler in dieser Datei. */
            @Override
            public void onPermissionRequest(android.webkit.PermissionRequest request) {
                java.util.List<String> erlaubt = new java.util.ArrayList<>();
                for (String r : request.getResources()) {
                    if (android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) erlaubt.add(r);
                }
                /* Protokoll: ohne diese Zeile laesst sich nicht entscheiden, ob die WebView die
                   Kamera-Anfrage ueberhaupt stellt oder ob sie still durchgeht. Der Nutzer berichtete
                   auf dem S20 eine schwarze Vorschau – das kann drei Ursachen haben (Anfrage kommt
                   nie, Anfrage wird abgelehnt, oder play() wird wegen der Wiedergabe-Regel blockiert).
                   Nur mit dieser Messung ist die Ursache zu trennen. */
                if (BuildConfig.DEBUG) {
                    Log.i("LLMBOX-CAM", "onPermissionRequest angefragt=" + java.util.Arrays.toString(request.getResources())
                            + " erlaubt=" + erlaubt + " origin=" + request.getOrigin());
                }

                /* Nur Kamera durchlassen, alles andere ablehnen: Mikrofon braucht die App nicht und
                   wuerde dem Nutzer ohne Anlass aufgenommen werden. */
                runOnUiThread(() -> {
                    if (erlaubt.isEmpty()) request.deny();
                    else request.grant(erlaubt.toArray(new String[0]));
                });
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String u = request.getUrl().toString();
                if (u.startsWith("file:///android_asset/")) return false;
                openExternal(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                // Die Web-Oberfläche meldet ihre eigenen Messwerte (android-adapter.js -> Native.uiLog).
                // Die Sonde klickt im Bildschirm sichtbar Dialoge an - das soll der Nutzer nicht
                // sehen. Deshalb nur anfordern mit:
                //   adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez probe true
                if (BuildConfig.DEBUG && uiProbeRequested) probeUiAfterLoad();
                // Reiner Nachweis fuer den eingebauten QR-Decoder, ohne die Oberflaeche anzufassen:
                //   adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez qrprobe true
                if (BuildConfig.DEBUG && getIntent() != null && getIntent().getBooleanExtra("qrprobe", false)) probeQrAfterLoad();
                // Misst die Kamera-Kette der WebView (getUserMedia, play(), Bildgroesse):
                //   adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez camprobe true
                if (BuildConfig.DEBUG && getIntent() != null && getIntent().getBooleanExtra("camprobe", false)) probeCamAfterLoad();
                /* Prueft eine Freigabe LESend, ohne irgendetwas zu schreiben:
                     adb shell am start -n de.reuschlerit.llmbox/.MainActivity --ez smblesen true \
                          --es pfad "/smb/192.0.2.10/daten/MeinProjekt"
                   Bewusst eine eigene Sonde und nicht das bestehende "--ez smbprobe": das sitzt in
                   probeUiAfterLoad() und wuerde zusaetzlich Chat-Dateien in die Freigabe des Nutzers
                   kopieren (migrateProbe) – fuer eine reine Verbindungsklaerung unvertretbar. */
                if (BuildConfig.DEBUG && getIntent() != null && getIntent().getBooleanExtra("smblesen", false)) {
                    final String ziel = (getIntent().getStringExtra("pfad") == null)
                            ? "/smb/192.0.2.10/daten" : getIntent().getStringExtra("pfad").trim();
                    Log.i("LLMBOX-SMB", "smb_lesen_start pfad=" + ziel);
                    fsPool.execute(() -> {
                        try {
                            /* smb.test statt smbTest(): der private Helfer gehoert zur inneren
                               Bridge-Klasse und ist von hier nicht erreichbar. */
                            JSONObject o = new JSONObject(smb.test(ziel));
                            Log.i("LLMBOX-SMB", "smb_lesen ok=" + o.optBoolean("ok")
                                    + (o.has("error") ? (" grund=" + shortText(o.optString("error")))
                                                      : (" eintraege=" + o.optInt("entries") + " beispiel=" + shortText(o.optString("sample")))));
                        } catch (Throwable e) {
                            Log.i("LLMBOX-SMB", "smb_lesen FEHLER " + shortText(String.valueOf(e)));
                        }
                    });
                }
            }
        });

        web.loadUrl(START_URL);
    }

    /**
     * Weist am Gerat nach, dass der EINGEBAUTE QR-Decoder wirklich funktioniert – und zwar mit
     * dem Bild, das dieselbe App selbst erzeugt. Der Nutzer hatte zu Recht gefragt, wieso ihm ein
     * QR-Code angezeigt wird, den die App selbst nicht lesen kann.
     *
     * Vorgehen (alles in der echten WebView, keine Nachbildung):
     *   1) vendor/qrcode.js (der Encoder der Windows-Oberflaeche) baut einen Code fuer eine
     *      typische LAN-Adresse und fuer ein LBX1-Stueck.
     *   2) Die dunklen Module werden in ein Canvas gemalt, so wie die Kamera es spaeter liefert.
     *   3) jsQR aus vendor/webdeps.js muss denselben Text exakt zurueckgeben.
     * Damit sind Encoder und Decoder zusammen belegt, nicht nur "die Datei ist vorhanden".
     */
    private void probeQrAfterLoad() {
        final String qrProbe = "(function(){try{"
                + "var adr='http://192.0.2.50:45456/llmbox-transfer?t=3f9a1c77e0b2d4aa';"
                + "var stueck='LBX1|ab12cd34|1|2|9f86d081884c7d65|'+new Array(401).join('A');"
                + "function malen(text,vergroesserung){"
                + "  var q=qrcode(0,'M');q.addData(text,'Byte');q.make();"
                + "  var mc=q.getModuleCount(),rand=4*vergroesserung,seite=mc*vergroesserung+2*rand;"
                + "  var c=document.createElement('canvas');c.width=seite;c.height=seite;"
                + "  var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,seite,seite);"
                + "  x.fillStyle='#000';"
                + "  for(var r=0;r<mc;r++)for(var k=0;k<mc;k++){if(q.isDark(r,k))x.fillRect(rand+k*vergroesserung,rand+r*vergroesserung,vergroesserung,vergroesserung);}"
                + "  return {c:c,seite:seite};"
                + "}"
                + "function lesen(text,v){var b=malen(text,v);"
                + "  var d=b.c.getContext('2d').getImageData(0,0,b.seite,b.seite).data;"
                + "  var f=(window.jsQR&&jsQR(d,b.seite,b.seite))||null;"
                + "  return {seite:b.seite,erkannt:f?f.data:null,gleich:!!(f&&f.data===text)};}"
                + "return JSON.stringify({"
                + " encoder:typeof qrcode==='function', decoder:typeof window.jsQR,"
                + " adresse:lesen(adr,3), stueck:lesen(stueck,2)"
                + "});}catch(e){return 'Fehler: '+e.message}})()";

        web.postDelayed(() -> web.evaluateJavascript(qrProbe, (v) -> Log.i("LLMBOX-QR", "qr_probe=" + v)), 1500);
    }

    /**
     * Misst am Gerat, warum eine Kamera-Vorschau schwarz bleiben kann (Nutzerbericht S20).
     * Fragt in der echten WebView nacheinander ab:
     *   - gibt es navigator.mediaDevices.getUserMedia ueberhaupt?
     *   - liefert getUserMedia einen Stream (und wie viele Video-Spuren)?
     *   - erlaubt die WebView video.play() (mediaPlaybackRequiresUserGesture)?
     *   - meldet das <video> schliesslich eine Bildgroesse (videoWidth > 0 heisst: Bilder laufen)?
     * Die Kamera wird danach sofort wieder frei gegeben.
     */
    private void probeCamAfterLoad() {
        /* WICHTIG (erster Messversuch 14.11., cam_probe={}): web.evaluateJavascript wartet NICHT auf
           ein Promise – es serialisiert den Wert sofort, und ein noch laufendes Promise ergibt "{}".
           Die Sonde meldet ihr Ergebnis deshalb selbst, ueber Native.uiLog ins Logcat (Tag LLMBOX-CAM). */
        final String camProbe = "(function(){try{"
                + "var sagen=function(o){ try{Native.uiLog('CAM ' + JSON.stringify(o));}catch(e){} };"
                + "var out={ mediaDevices:!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia) };"
                + "if(!out.mediaDevices){ sagen(out); return; }"
                + "navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false}).then(function(st){"
                + "  out.stream=true; out.spuren=st.getTracks().map(function(t){return t.kind+':'+t.label;});"
                + "  var v=document.createElement('video');"
                + "  v.playsinline=true; v.muted=true; v.setAttribute('playsinline',''); v.setAttribute('muted','');"
                + "  document.body.appendChild(v);"
                + "  v.srcObject=st;"
                + "  v.addEventListener('loadedmetadata',function(){ out.metadaten=v.videoWidth+'x'+v.videoHeight; });"
                + "  return v.play().then(function(){"
                + "    return new Promise(function(los){var t=0;"
                + "      var tick=function(){t++;"
                + "        if(v.videoWidth>0||t>30){ los({play:'ok',videoWidth:v.videoWidth,videoHeight:v.videoHeight,durchgaenge:t}); }"
                + "        else requestAnimationFrame(tick);};tick();});"
                + "  }).catch(function(e){ return {play:'abgelehnt', grund:(e&&e.name||'')+': '+(e&&e.message||'')}; })"
                + "    .then(function(r){ out.play=r; st.getTracks().forEach(function(t){t.stop();});"
                + "      if(v.parentNode)v.parentNode.removeChild(v); sagen(out); });"
                + "}).catch(function(e){ sagen({ stream:false, grund:(e&&e.name||'')+': '+(e&&e.message||'') }); });"
                + "}catch(e){ try{Native.uiLog('CAM FEHLER '+e.message);}catch(e2){} }})()";

        web.postDelayed(() -> web.evaluateJavascript(camProbe, (v) -> Log.i("LLMBOX-CAM", "cam_probe_gestartet=" + v)), 1500);
    }

    /**
     * Fahert die Oberflaeche im Debug-Bau selbst an und misst die echten Groessen:
     * ob der Adapter ueberhaupt laeuft, wie breit die Auswahlfelder sind und wie hoch
     * die Tab-Leiste sowie die erste Inhaltszeile im Einstellungs-Dialog ist.
     * So werden Beschwerden wie "Knöpfe zu groß" mit Zahlen statt Vermutungen geklaert.
     */
    private void probeUiAfterLoad() {
        final String openSettings = "(function(){try{var b=document.getElementById('btn-settings');"
                + "if(b)b.click();return JSON.stringify({adapter:!!window.__androidAdapterLoaded,"
                + "burger:!!document.getElementById('btn-drawer'),settings:!!document.querySelector('.settings nav')});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        // Wichtig: getComputedStyle().flexDirection liefert auch bei display:block "row",
        // deshalb wird zusaetzlich display und der Inline-Style-Attributwert gemessen.
        final String measure = "(function(){try{"
                + "var navs=[...document.querySelectorAll('.settings nav')];"
                + "if(!navs.length)return JSON.stringify({nav:'fehlt'});"
                + "var out=navs.map(function(nav){var cs=getComputedStyle(nav);var r=nav.getBoundingClientRect();"
                + "var b0=nav.querySelector('button');var c0=b0?getComputedStyle(b0):null;var q0=b0?b0.getBoundingClientRect():null;"
                + "var btns=[...nav.querySelectorAll('button')].map(function(b){var q=b.getBoundingClientRect();"
                + "return (b.textContent||'').trim().slice(0,10)+'='+Math.round(q.height)+'x'+Math.round(q.width);});"
                + "var wrap=nav.closest('.modal');var wcls=wrap?wrap.className:'-';"
                + "var host=nav.parentNode;var hcs=getComputedStyle(host);"
                + "return {tabs:btns,navH:Math.round(r.height),navW:Math.round(r.width),"
                + "display:cs.display,dir:cs.flexDirection,alignItems:cs.alignItems,"
                + "cssWidth:cs.width,inlineStyle:nav.getAttribute('style')||'-',"
                + "hostCls:host.className,hostDisplay:hcs.display,hostDir:hcs.flexDirection,hostW:Math.round(host.getBoundingClientRect().width),"
                + "paneVisible:(function(){var p=nav.parentNode.querySelector('.pane');if(!p)return '-';"
                + "return Math.round(p.clientHeight)+'/'+p.scrollHeight;})(),"
                + "modalH:(function(){var m=nav.closest('.modal');return m?Math.round(m.getBoundingClientRect().height):0;})(),"
                + "modalCls:wcls,"
                + "btn0:{display:c0?c0.display:'-',w:c0?c0.width:'-',minW:c0?c0.minWidth:'-',h:q0?Math.round(q0.height):0},"
                + "navRules:(function(){var hits=[];try{[].forEach.call(document.styleSheets,function(sh){"
                + "var rl=null;try{rl=sh.cssRules}catch(e2){hits.push('GESPERRT:'+(sh.href||'inline'));return}if(!rl)return;"
                + "[].forEach.call(rl,function(rule){"
                + "if(rule.selectorText&&/\\.settings\\s+nav/.test(rule.selectorText))"
                + "hits.push(((sh.href||'inline').split('/').pop())+' {'+(rule.style.cssText||'')+'}');"
                + "if(rule.cssRules)[].forEach.call(rule.cssRules,function(r2){"
                + "if(r2.selectorText&&/\\.settings\\s+nav/.test(r2.selectorText))"
                + "hits.push('@'+(sh.href||'inline').split('/').pop()+' {'+(r2.style.cssText||'')+'}');});});});}catch(e3){hits.push('Fehler '+e3.message)}"
                + "return hits.slice(0,8)})()};"
                + "});"
                + "var links=[...document.querySelectorAll('link[rel=stylesheet]')].map(function(l){return (l.href||'').split('/').pop();});"
                + "return JSON.stringify({modalCount:document.querySelectorAll('.modal-back').length,"
                + "openTitles:[...document.querySelectorAll('.modal-head')].map(function(h){return (h.textContent||'').trim().slice(0,24);}),css:links,navs:out});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        // Was ist direkt nach dem Laden offen? (Hinweis auf automatisch geoeffneten Dialog)
        final String probeStart = "(function(){try{return JSON.stringify({"
                + "modals:document.querySelectorAll('.modal-back').length,"
                + "titles:[...document.querySelectorAll('.modal-head')].map(function(h){return (h.textContent||'').trim().slice(0,24);}),"
                + "w:window.innerWidth});}catch(e){return e.message}})()";

        // Zeitplan: erst pruefen was beim Start offen ist (und warum die Tab-Leiste dort
        // gestapelt ist), dann Einstellungen, dann Server-Fenster explizit geoeffnet.
        final String closeModals = "(function(){try{var n=0;document.querySelectorAll('.modal-back .icon-btn').forEach(function(b){b.click();n++;});"
                + "return JSON.stringify({closed:n,modals:document.querySelectorAll('.modal-back').length});}catch(e){return e.message}})()";
        final String openServer = "(function(){try{var s=document.getElementById('btn-server');if(s)s.click();"
                + "return JSON.stringify({server:!!document.querySelector('.settings nav')});}catch(e){return e.message}})()";

        web.postDelayed(() -> web.evaluateJavascript(probeStart, (v) -> Log.i("LLMBOX-UI", "probe_start=" + v)), 900);
        web.postDelayed(() -> web.evaluateJavascript(measure, (v) -> Log.i("LLMBOX-UI", "probe_beimstart=" + v)), 1600);
        web.postDelayed(() -> web.evaluateJavascript(closeModals, (v) -> Log.i("LLMBOX-UI", "probe_close1=" + v)), 2400);
        web.postDelayed(() -> web.evaluateJavascript(openSettings, (v) -> Log.i("LLMBOX-UI", "probe1=" + v)), 2800);
        web.postDelayed(() -> web.evaluateJavascript(measure, (v) -> Log.i("LLMBOX-UI", "probe_settings=" + v)), 3600);
        web.postDelayed(() -> web.evaluateJavascript(closeModals, (v) -> Log.i("LLMBOX-UI", "probe_close2=" + v)), 4400);
        web.postDelayed(() -> web.evaluateJavascript(openServer, (v) -> Log.i("LLMBOX-UI", "probe3=" + v)), 4800);
        web.postDelayed(() -> web.evaluateJavascript(measure, (v) -> Log.i("LLMBOX-UI", "probe_server=" + v)), 5800);
        // Jeder Reiter wird einzeln durchgemessen: nur so zeigt sich, ob unterhalb der
        // Tab-Leiste noch Inhalt verdeckt ist (die Beschwerde des Nutzers).
        web.postDelayed(() -> web.evaluateJavascript(openTabJs("Konfiguration"), (v) -> Log.i("LLMBOX-UI", "probe_tab1=" + v)), 6400);
        web.postDelayed(() -> web.evaluateJavascript(measure, (v) -> Log.i("LLMBOX-UI", "probe_server_konfig=" + v)), 7300);
        web.postDelayed(() -> web.evaluateJavascript(openTabJs("Zielrechner"), (v) -> Log.i("LLMBOX-UI", "probe_tab2=" + v)), 7900);
        web.postDelayed(() -> web.evaluateJavascript(measure, (v) -> Log.i("LLMBOX-UI", "probe_server_ziel=" + v)), 8800);
        web.postDelayed(() -> web.evaluateJavascript(openTabJs("Modell starten"), (v) -> Log.i("LLMBOX-UI", "probe_tab3=" + v)), 9400);
        web.postDelayed(() -> web.evaluateJavascript(measure, (v) -> Log.i("LLMBOX-UI", "probe_server_start=" + v)), 10300);
        // Wichtig: die Sonde hat Einstellungs- und Server-Fenster selbst geoeffnet. Wuerden sie
        // offen bleiben, hielte der Nutzer das fuer einen Fehler der App ("startet mit Dialog").
        web.postDelayed(() -> web.evaluateJavascript(closeModals, (v) -> Log.i("LLMBOX-UI", "probe_close_end=" + v)), 11000);

        // ── Chatliste und der gemeinsame Chat-Ordner ──
        // Beides war Nutzer-Rueckmeldung: die Aktionsknopfe einer Chatzeile waren nur bei
        // Maus-Hover sichtbar (auf dem Handy nie), und im Reiter "Daten" gab es keinen Weg,
        // eine Windows-Freigabe als Chat-Ordner zu setzen. Die Sonde weist beide objektiv nach.
        final String chatRowProbe = "(function(){try{"
                + "var it=document.querySelector('.chat-item');if(!it)return JSON.stringify({zeile:'keine (evtl. keine Chats)'});"
                + "var a=it.querySelector('.acts');var b=a?[...a.querySelectorAll('.mini-btn')]:[];"
                + "var r=b.length?b[0].getBoundingClientRect():null;var cs=b.length?getComputedStyle(b[0]):null;"
                + "return JSON.stringify({acts:a?getComputedStyle(a).display:'fehlt',knoepfe:b.length,"
                + "titel:b.map(function(x){return x.getAttribute('title');}),"
                + "gezeichnet:r?Math.round(r.width)+'x'+Math.round(r.height):'-',"
                + "min:cs?cs.minWidth+' x '+cs.minHeight:'-',zeilenH:Math.round(it.getBoundingClientRect().height)});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        final String openDaten = "(function(){try{var b=document.getElementById('btn-settings');if(b)b.click();"
                + "return JSON.stringify({settings:!!document.querySelector('.settings nav')});}catch(e){return e.message}})()";
        final String datenTab = "(function(){try{"
                + "for(var n of document.querySelectorAll('.settings nav')){"
                + " for(var b of n.querySelectorAll('button')){if((b.textContent||'').trim().indexOf('Daten')===0){b.click();return 'Daten geoeffnet'}}}"
                + "return 'Tab Daten nicht gefunden';}catch(e){return 'Fehler: '+e.message}})()";

        // Prueft den vom Adapter ergaenzten Freigabe-Bereich in der Sync-Zeile.
        final String syncProbe = "(function(){try{"
                + "var row=[...document.querySelectorAll('.frow')].find(function(r){return (r.textContent||'').indexOf('Chats auf mehreren Rechnern')>=0;});"
                + "if(!row)return JSON.stringify({syncZeile:'fehlt'});"
                + "var box=row.querySelector('.sync-smb');"
                + "var kn=[...row.querySelectorAll('button')].map(function(b){return (b.textContent||'').trim();});"
                + "return JSON.stringify({freigabeBlock:!!box,eingaben:box?box.querySelectorAll('input').length:0,"
                + "knoepfe:kn,status:(box?(box.querySelector('.smb-status')||{}).textContent:'').slice(0,120)});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        web.postDelayed(() -> web.evaluateJavascript(openDrawerForChatProbe(), (v) -> Log.i("LLMBOX-UI", "probe_drawer=" + v)), 11600);
        web.postDelayed(() -> web.evaluateJavascript(chatRowProbe, (v) -> Log.i("LLMBOX-UI", "probe_chatliste=" + v)), 12400);
        /* Prueft einen Einstellungs-Reiter namentlich und listet seine Zeilen/Knoepfe auf.
           Damit laesst sich am Gerat belegen, ob eine Option wirklich sichtbar ist oder vom
           Adapter ausgeblendet wurde (frueherer Fehler: Reiter verschwanden still). */

        /* Sichtbare und ausgeblendete Zeilen des offenen Dialogs. Als Wurzel dient .modal –
           dieser Selektor ist durch probe_settings belegt (modalCls:"modal wide"). */
        final String zeilenProbe = "(function(){try{"
                + "var pane=document.querySelector('.modal');"
                + "if(!pane)return JSON.stringify({dialog:'fehlt'});"
                + "var rows=[...pane.querySelectorAll('.frow')].filter(function(r){"
                + "  var l=r.querySelector('.flabel');return l&&(l.textContent||'').trim();});"
                + "var sichtbar=[],versteckt=[];"
                + "rows.forEach(function(r){var t=(r.querySelector('.flabel').textContent||'').trim().split('\\n')[0].slice(0,42);"
                + "  (getComputedStyle(r).display==='none'?versteckt:sichtbar).push(t);});"
                + "var kn=[...pane.querySelectorAll('button')].map(function(b){return (b.textContent||'').trim();}).filter(Boolean).slice(0,14);"
                + "return JSON.stringify({sichtbarAnzahl:sichtbar.length,verstecktAnzahl:versteckt.length,"
                + "knoepfe:kn,sichten:sichtbar.slice(0,26),versteckte:versteckt});}catch(e){return 'Fehler: '+e.message}})()";

        /** Reiter im Einstellungsdialog nach Namen antippen. */
        final String tabJs = "(function(){try{for(var n of document.querySelectorAll('.settings nav')){"
                + " for(var b of n.querySelectorAll('button')){"
                + "  if((b.textContent||'').trim().indexOf('%LABEL%')===0){b.click();return 'geoeffnet: %LABEL%';}}}"
                + "return 'Tab nicht gefunden';}catch(e){return 'Fehler: '+e.message}})()";

        web.postDelayed(() -> web.evaluateJavascript(openDaten, (v) -> Log.i("LLMBOX-UI", "probe_open_daten=" + v)), 13200);
        web.postDelayed(() -> web.evaluateJavascript(datenTab, (v) -> Log.i("LLMBOX-UI", "probe_daten_tab=" + v)), 14000);

        /* Nachweis fuer die Nutzerfrage "Es fehlen Einstellungsoptionen": der Reiter
           Workspace & Dateien enthaelt die Werkzeug-Grenzen (u. a. "Max. Werkzeug-Schritte
           am Stueck", Standard 25). Frueher fehlten sie, weil die Android-Assets von einer
           alten Quellversion stammten - jetzt messbar am Gerat statt im Quelltext. */
        web.postDelayed(() -> web.evaluateJavascript(tabJs.replace("%LABEL%", "Workspace"), (v) -> Log.i("LLMBOX-UI", "probe_tab_ws=" + v)), 16200);
        web.postDelayed(() -> web.evaluateJavascript(zeilenProbe, (v) -> Log.i("LLMBOX-UI", "probe_zeilen_workspace=" + v)), 17000);
        // Reiter "Uebertragung": Zugang zu WLAN-Uebernahme, JSON-Import/-Export (Punkte 5 und 6).
        web.postDelayed(() -> web.evaluateJavascript(tabJs.replace("%LABEL%", "Übertragun"), (v) -> Log.i("LLMBOX-UI", "probe_tab_transfer=" + v)), 17800);
        web.postDelayed(() -> web.evaluateJavascript(zeilenProbe, (v) -> Log.i("LLMBOX-UI", "probe_zeilen_uebertragung=" + v)), 18600);

        /* ── WLAN-Uebertragung wirklich durchspielen (--ez lanprobe true) ──
           Sucht im Netz wie die Schaltflaeche, ruft die gefundene Adresse ab und zeigt, was
           die Uebertragung enthalten wuerde. Es wird NICHTS uebernommen – die Einstellungen
           des Gerats bleiben unveraendert. */
        if (getIntent() != null && getIntent().getBooleanExtra("lanprobe", false)) {
            final String lanProbe = "(function(){try{"
                    + "window.__lanReport='suche …';"
                    + "var anzahl=0;"
                    + "window.api.transfer.lanSearch({waitMs:3000}).then(function(r){"
                    + "  if(!r||!r.ok){window.__lanReport='keine Antwort: '+((r&&r.error)||'');return;}"
                    + "  anzahl=(r.urls||[]).length;"
                    + "  window.__lanUrls=r.urls;"
                    + "  return window.api.fetch({url:r.urls[0],method:'GET',timeout:15000});"
                    + "}).then(function(f){"
                    + "  if(!f)return;"
                    // Fehlergrund mit ausgeben: ohne error war nicht unterscheidbar, ob das
                    // Netz, die Bruecke oder ein Tippfehler in der Sonde schuld war.
                    + "  if(!f.ok){window.__lanReport='HTTP '+f.status+' – '+((f.error)||'keine Fehlermeldung');return;}"
                    + "  var d=JSON.parse(f.text);"
                    + "  window.__lanReport=JSON.stringify({urls:anzahl,format:d.format,version:d.version,"
                    + "  contains:d.contains,verbindungen:((d.settings||{}).connections||[]).length});"
                    + "}).catch(function(e){window.__lanReport='Fehler: '+e.message;});"
                    + "return 'Netzsuche gestartet';}catch(e){return e.message}})()";
            final String lanResultProbe = "(function(){try{return window.__lanReport||'kein Ergebnis';}catch(e){return e.message}})()";
            web.postDelayed(() -> web.evaluateJavascript(lanProbe, (v) -> Log.i("LLMBOX-UI", "probe_lan_start=" + v)), 19400);
            web.postDelayed(() -> web.evaluateJavascript(lanResultProbe, (v) -> Log.i("LLMBOX-UI", "probe_lan=" + v)), 26000);

            /* Uebernahme wirklich durchfuehren (--ez lanapply true). Ohne diesen Schalter
               bleibt alles lesbar und nichts wird geaendert. Mit ihm werden Einstellungen und
               Verbindungen uebernommen – der Nachweis, dass die Uebertragung endet nicht beim
               Abruf. Vorher die Einstellungen des Gerats sichern (run-as cat files/data/settings.json). */
            if (getIntent().getBooleanExtra("lanapply", false)) {
                /* Alle gefundenen Adressen der Reihe nach probieren, nicht nur die erste.
                   Grund: ein Rechner kann auf das Rufsignal antworten, obwohl sein HTTP-Dienst
                   schon beendet ist (frueherer Fehler in main.js). Die echte App macht es in
                   transfer.js lanSearchAndApply() genauso - die Sonde muss dasselbe Verhalten
                   pruefen, sonst meldet sie einen Fehler, den es in der App gar nicht gibt. */
                final String applyProbe = "(function(){try{"
                        + "window.__applyReport='laeuft …';"
                        + "var anzahl=0, versuche=[];"
                        + "window.api.transfer.lanSearch({waitMs:3000}).then(function(r){"
                        + "  if(!r||!r.ok)throw new Error((r&&r.error)||'nichts gefunden');"
                        + "  anzahl=(r.urls||[]).length;"
                        + "  return (r.urls||[]).reduce(function(kette,u){"
                        + "    return kette.then(function(v){ if(v)return v;"
                        + "      return window.api.fetch({url:u,method:'GET',timeout:15000}).then(function(f){"
                        + "        versuche.push(u+' -> HTTP '+f.status);"
                        + "        if(!f.ok)return null;"
                        + "        return window.api.transfer.apply(JSON.parse(f.text));"
                        + "      });});"
                        + "  },Promise.resolve(null)).then(function(res){"
                        + "    if(!res)throw new Error('keine der '+anzahl+' Adressen lieferte Daten ('+versuche.join('; ')+')');"
                        + "    window.__applyReport=JSON.stringify({urls:anzahl,ok:res&&res.ok,report:res&&res.report});"
                        + "    return window.api.store.get('settings');"
                        + "  }).then(function(s){"
                        + "    window.__applyNach='verbindungen='+(((s||{}).connections)||[]).length"
                        + "      +' modell='+((s||{}).model||'-')+' maxSteps='+(((s||{}).workspace||{}).maxSteps);"
                        + "  });"
                        + "}).catch(function(e){window.__applyReport='Fehler: '+e.message;});"
                        + "return 'Uebernahme gestartet';}catch(e){return e.message}})()";
                final String applyResultProbe = "(function(){try{return JSON.stringify({ergebnis:window.__applyReport||'kein Ergebnis',nachher:window.__applyNach||'-'});}catch(e){return e.message}})()";

                /* WIRKUNG der Uebernahme in der laufenden Oberflaeche. Genau hier lag der
                   gemeldete Fehler: die Datei war geschrieben, aber Verbindung, Modell und
                   Werkzeuge blieben bis zum Neustart unveraendert ("nicht die richtigen
                   Einstellungen uebertragen"). applyIncomingSettings() (app.js) laedt sie jetzt
                   neu; danach muessen Verbindungsname, Modelliste und Statuszeile stimmen. */
                final String wirkProbe = "(function(){try{"
                        + "window.__wirkReport='laeuft …';"
                        + "if(typeof window.applyIncomingSettings!=='function'){window.__wirkReport='applyIncomingSettings fehlt';return 'fehlt';}"
                        + "window.applyIncomingSettings().then(function(w){window.__wirkReport=JSON.stringify(w);})"
                        + " .catch(function(e){window.__wirkReport='Fehler: '+e.message;});"
                        + "return 'Neuladen gestartet';}catch(e){return e.message}})()";
                final String wirkErgebnisProbe = "(function(){try{"
                        + "var st=document.getElementById('conn-status');"
                        + "return JSON.stringify({uebernahme:window.__wirkReport||'kein Ergebnis',"
                        + "verbindungsfeld:(document.getElementById('sel-conn')||{options:[]}).options.length,"
                        + "ausgewaehltVerbindung:(document.getElementById('sel-conn')||{}).value||'-',"
                        + "modellfeld:(document.getElementById('sel-model')||{}).value||'-',"
                        + "statusText:(st?(st.textContent||'').trim():'fehlt'),statusKlasse:(st?st.className:'-'),"
                        + "linksText:((document.getElementById('st-left')||{}).textContent||'').trim().slice(0,60)});"
                        + "}catch(e){return 'Fehler: '+e.message}})()";

                /* Beweis "aktive Verbindung hergestellt": kurze echte Anfrage an den Server.
                   Ohne Antwort gilt die Verbindung nicht als hergestellt. */
                final String lanChatProbe = "(function(){try{"
                        + "var i=document.getElementById('input'),b=document.getElementById('btn-send');"
                        + "if(!i||!b)return JSON.stringify({fehler:'Eingabe/Senden nicht gefunden'});"
                        + "window.__lanChatVor=(document.querySelector('#messages-inner')||{}).textContent||'';"
                        + "i.value='Antworte mit genau einem Wort: VERBUNDEN';"
                        + "i.dispatchEvent(new Event('input',{bubbles:true}));b.click();"
                        + "return JSON.stringify({gesendet:true,modell:(document.getElementById('sel-model')||{}).value});"
                        + "}catch(e){return 'Fehler: '+e.message}})()";
                final String lanChatErgebnisProbe = "(function(){try{"
                        + "var txt=(document.querySelector('#messages-inner')||{}).textContent||'';"
                        + "var vor=window.__lanChatVor||'';"
                        + "return JSON.stringify({neuerText:txt.length-vor.length,"
                        + "antwort:txt.slice(vor.length).trim().slice(0,80),"
                        + "fehlerMeldung:(document.getElementById('toast-root')||{}).textContent.trim().slice(0,120)});"
                        + "}catch(e){return 'Fehler: '+e.message}})()";

                /* Zeitfenster: applyIncomingSettings() hoelt Modelliste, Chats und Status neu -
                   das dauert am Gerat mehrere Sekunden. Ein Auslesen nach 12 s traf bisher nur
                   den laufenden Vorgang ("laeuft ...") und war damit kein Beweis. */
                web.postDelayed(() -> web.evaluateJavascript(applyProbe, (v) -> Log.i("LLMBOX-UI", "probe_apply_start=" + v)), 28000);
                web.postDelayed(() -> web.evaluateJavascript(applyResultProbe, (v) -> Log.i("LLMBOX-UI", "probe_apply=" + v)), 36000);
                web.postDelayed(() -> web.evaluateJavascript(wirkProbe, (v) -> Log.i("LLMBOX-UI", "probe_wirkung_start=" + v)), 40000);
                web.postDelayed(() -> web.evaluateJavascript(wirkErgebnisProbe, (v) -> Log.i("LLMBOX-UI", "probe_wirkung=" + v)), 68000);
                web.postDelayed(() -> web.evaluateJavascript(lanChatProbe, (v) -> Log.i("LLMBOX-UI", "probe_lan_chat_send=" + v)), 74000);
                web.postDelayed(() -> web.evaluateJavascript(lanChatErgebnisProbe, (v) -> Log.i("LLMBOX-UI", "probe_lan_chat=" + v)), 104000);
            }
        }
        // syncRowHolder() der Desktop-Version baut seine Zeile erst nach api.sync.get() auf -
        // ohne diese Pause waere der Adapter-Bereich noch gar nicht vorhanden.
        web.postDelayed(() -> web.evaluateJavascript(syncProbe, (v) -> Log.i("LLMBOX-UI", "probe_sync=" + v)), 15600);
        /* ── Nachweis, dass Datei-/SMB-Zugriffe die Oberfläche nicht mehr blockieren ──
           Der Nutzer berichtete: "Freezt die App wenn ich mitten im Chat bin". Ursache war,
           dass jeder Dateizugriff als synchroner @JavascriptInterface-Aufruf den Render-Thread
           der WebView festhielt. Die Sonde startet deshalb einen Zugriff auf eine Freigabe,
           die nicht antwortet, und zaehlt waehrenddessen die JS-Timer-Ticks:
             - frueher (synchron):  Ticks stehen still, Luecke = so lang wie der Zugriff
             - jetzt (fsJob-Pool):  Ticks laufen weiter, die Oberflaeche bleibt bedienbar
           Es wird nur gelesen (smbTest) - an den Einstellungen des Nutzers aendert das nichts. */
        final String freezeProbe = "(function(){"
                + "var ticks=0,maxGap=0,last=performance.now();"
                + "var iv=setInterval(function(){var n=performance.now();"
                + "if(n-last>maxGap)maxGap=Math.round(n-last);last=n;ticks++;},50);"
                + "window.__fsJob('smbTest','/smb/192.0.2.99.99/freigabe').then(function(r){"
                + "  window.__freezeResult={fehler:(r&&r.error||'').slice(0,70),ticks:ticks,maxGap:maxGap};"
                + "}).catch(function(e){window.__freezeResult={fehler:String(e.message).slice(0,70),ticks:ticks,maxGap:maxGap};});"
                + "setTimeout(function(){clearInterval(iv);},14000);"
                + "return 'smbTest auf nicht erreichbare Freigabe gestartet';})()";

        web.postDelayed(() -> web.evaluateJavascript(freezeProbe, (v) -> Log.i("LLMBOX-UI", "probe_freeze_start=" + v)), 17200);
        // Der Zugriff braucht bis zu den SMB-Timeouts (8 s Verbindungsaufbau). Danach steht
        // das Ergebnis inklusive der Timer-Luecke bereit.
        web.postDelayed(() -> web.evaluateJavascript(
                "(function(){try{return JSON.stringify(window.__freezeResult||{hinweis:'noch kein Ergebnis'});}catch(e){return e.message}})()",
                (v) -> Log.i("LLMBOX-UI", "probe_freeze=" + v)), 31000);

        /* ── Statuszeile, Kontextbalken und gespeicherte SMB-Zugangsdaten ── */
        final String statusProbe = "(function(){try{"
                + "var l=document.getElementById('st-left'),r=document.getElementById('st-right');"
                + "var c=function(e){return e?{abgeschnitten:(e.scrollWidth>e.clientWidth+1)||(e.scrollHeight>e.clientHeight+1),"
                + "zeilen:Math.round(e.getBoundingClientRect().height/(parseFloat(getComputedStyle(e).lineHeight)||1))}:'fehlt'};"
                + "var m=document.getElementById('ctx-meter');"
                + "return JSON.stringify({links:c(l),rechts:c(r),linksText:(l?l.textContent:'').slice(0,40),"
                + "balken:{parent:m&&m.parentNode?(m.parentNode.id||m.parentNode.tagName):'-',basis:m?getComputedStyle(m).flexBasis:'-'}});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        // Die Zugangsdaten muessen beim Oeffnen der Einstellungen in den Feldern stehen,
        // sonst wirken sie "verloren" und ein leer bestaetigtes Feld loescht den Benutzer.
        final String credsProbe = "(function(){try{"
                + "var box=[...document.querySelectorAll('.frow')].find(function(r){return (r.textContent||'').indexOf('Netzwerkordner (SMB)')>=0;});"
                + "if(!box)return JSON.stringify({feld:'kein SMB-Bereich'});"
                + "var i=[...box.querySelectorAll('input')];"
                + "return JSON.stringify({pfad:(i[0]||{}).value||'',benutzer:(i[1]||{}).value||'LEER',"
                + "domain:(i[2]||{}).value||'',passwortFeld:(i[3]||{}).value?'GEFUELLT':'leer (vorgesehen)',"
                + "hinweis:((i[3]||{}).placeholder||'').slice(0,45)});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        web.postDelayed(() -> web.evaluateJavascript(statusProbe, (v) -> Log.i("LLMBOX-UI", "probe_status=" + v)), 31600);
        web.postDelayed(() -> web.evaluateJavascript(openDaten, (v) -> Log.i("LLMBOX-UI", "probe_open2=" + v)), 32400);
        // Workspace-Reiter wahlen (dort liegt die SMB-Zeile), dann Felder lesen.
        web.postDelayed(() -> web.evaluateJavascript(
                "(function(){try{for(var n of document.querySelectorAll('.settings nav')){"
              + " for(var b of n.querySelectorAll('button')){if((b.textContent||'').trim().indexOf('Workspace')===0){b.click();return 'Workspace geoeffnet'}}}"
              + "return 'Tab nicht gefunden';}catch(e){return e.message}})()",
                (v) -> Log.i("LLMBOX-UI", "probe_ws_tab=" + v)), 33200);
        web.postDelayed(() -> web.evaluateJavascript(credsProbe, (v) -> Log.i("LLMBOX-UI", "probe_creds=" + v)), 34600);

        /* ── Echter Chatlauf: der gemeldete Freeze unter alltagsnahen Bedingungen ──
           Der Workspace des Nutzers liegt auf einer Windows-Freigabe. Genau dabei trat der
           Freeze auf. Diese Sonde schreibt eine kurze Nachricht in das echte Eingabefeld,
           lost dieselbe Sendetaste aus wie von Hand und zaehlt waehrend der Antwort die
           JS-Timer: bleiben sie stehen, haelt etwas die Oberflaeche fest.
           NUR mit --ez probechat true, weil dabei ein echter Chat geschrieben wird. */
        if (chatProbeRequested) {
        final String chatSendProbe = "(function(){try{"
                + "var i=document.getElementById('input'),b=document.getElementById('btn-send');"
                + "if(!i||!b)return JSON.stringify({fehler:'Eingabe/Senden nicht gefunden'});"
                + "window.__chatTicks=0;window.__chatMaxGap=0;var last=performance.now();"
                + "if(window.__chatIv)clearInterval(window.__chatIv);"
                + "window.__chatIv=setInterval(function(){var n=performance.now();"
                + "if(n-last>window.__chatMaxGap)window.__chatMaxGap=Math.round(n-last);last=n;window.__chatTicks++;},50);"
                // Etwas laengere Antwort, damit der Pause-Knopf wirklich testbar ist.
                + "i.value='Antworte nur mit den Zahlen 1 bis 40, jede in einer eigenen Zeile.';"
                + "i.dispatchEvent(new Event('input',{bubbles:true}));"
                + "var r=b.getBoundingClientRect();"
                + "b.click();"
                + "return JSON.stringify({gesendet:true,sendenKnopf:[Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)],"
                // app.js deklariert S als const im Skript - es hangt NICHT an window.
                // Die Zahl der Verbindungen wird deshalb am Auswahlfeld abgelesen.
                + "verbindungen:(document.getElementById('sel-conn')||{options:[]}).options.length});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        final String chatResultProbe = "(function(){try{"
                + "if(window.__chatIv)clearInterval(window.__chatIv);"
                + "var msgs=document.querySelectorAll('#messages-inner .msg').length;"
                + "var txt=(document.querySelector('#messages-inner')||{}).textContent||'';"
                + "return JSON.stringify({ticks:window.__chatTicks,maxGapMs:window.__chatMaxGap,"
                + "nachrichten:msgs,laeuft:(document.getElementById('btn-pause')||{}).className||'-',"
                + "letzteZeile:txt.trim().split('\\n').slice(-1)[0].slice(0,60)});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        web.postDelayed(() -> web.evaluateJavascript(chatSendProbe, (v) -> Log.i("LLMBOX-UI", "probe_chat_send=" + v)), 35400);

        /* V48 Pause/Fortsetzen: der Knopf ist nur sichtbar, waehrend die KI schreibt.
           Er wird hier mitten in der Antwort angetippt; erwartet wird der Strip
           "#pause-strip" mit einem "Fortsetzen"-Knopf. */
        final String pauseProbe = "(function(){try{"
                + "var b=document.getElementById('btn-pause');"
                + "if(!b)return JSON.stringify({knopf:'fehlt'});"
                + "var sichtbar=!b.classList.contains('hidden');"
                + "if(sichtbar)b.click();"
                + "return JSON.stringify({sichtbar:sichtbar,klasse:b.className});}catch(e){return 'Fehler: '+e.message}})()";
        final String pauseStripProbe = "(function(){try{"
                + "var s=document.getElementById('pause-strip');"
                + "if(!s)return JSON.stringify({strip:'fehlt'});"
                + "var btn=[...s.querySelectorAll('button')].map(function(x){return (x.textContent||'').trim();});"
                + "return JSON.stringify({sichtbar:!s.classList.contains('hidden'),text:(s.textContent||'').trim().slice(0,70),knoepfe:btn});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        // Zeitpunkte knapp nach dem Senden: am Gerat war die Antwort schon nach ~5 s fertig,
        // ein Test bei 41 s traf den Knopf nicht mehr (er ist nur waehrend des Schreibens sichtbar).
        web.postDelayed(() -> web.evaluateJavascript(pauseProbe, (v) -> Log.i("LLMBOX-UI", "probe_pause=" + v)), 37000);
        web.postDelayed(() -> web.evaluateJavascript(pauseStripProbe, (v) -> Log.i("LLMBOX-UI", "probe_pause_strip=" + v)), 38200);

        /* Fortsetzen: der "Fortsetzen"-Knopf im Strip wird angetippt. Danach muss der Strip
           verschwinden und die Antwort weiterschreiben (sichtbar an wachsendem Text). */
        final String resumeProbe = "(function(){try{"
                + "var s=document.getElementById('pause-strip');"
                + "if(!s)return JSON.stringify({strip:'fehlt'});"
                + "var b=[...s.querySelectorAll('button')].find(function(x){return (x.textContent||'').trim()==='Fortsetzen';});"
                + "if(!b)return JSON.stringify({knoepfe:'kein Fortsetzen-Knopf'});"
                + "var vor=(document.querySelector('#messages-inner')||{}).textContent||'';"
                + "window.__resumeVor=vor.length;"
                + "b.click();"
                + "return JSON.stringify({geklickt:true,stripZu:s.classList.contains('hidden'),"
                + "pauseKnopf:(document.getElementById('btn-pause')||{}).className});}catch(e){return 'Fehler: '+e.message}})()";
        final String resumeWirkungProbe = "(function(){try{"
                + "var s=document.getElementById('pause-strip');"
                + "var txt=(document.querySelector('#messages-inner')||{}).textContent||'';"
                + "return JSON.stringify({stripZu:s?s.classList.contains('hidden'):'fehlt',"
                + "textGewachsen:txt.length-(window.__resumeVor||0),laeuft:(document.getElementById('btn-pause')||{}).className});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        web.postDelayed(() -> web.evaluateJavascript(resumeProbe, (v) -> Log.i("LLMBOX-UI", "probe_resume=" + v)), 40000);
        web.postDelayed(() -> web.evaluateJavascript(resumeWirkungProbe, (v) -> Log.i("LLMBOX-UI", "probe_resume_wirkung=" + v)), 45000);

        // Antwort abwarten (lokale Modelle brauchen einige Sekunden), dann auswerten.
        web.postDelayed(() -> web.evaluateJavascript(chatResultProbe, (v) -> Log.i("LLMBOX-UI", "probe_chat_ergebnis=" + v)), 62000);

        /* ── V48 "Kontext leeren" (#btn-handoff) ──
           Der Knopf erzeugt eine Uebergabe und setzt chat.ctxStart; der alte Verlauf bleibt
           sichtbar, wird aber nicht mehr an die KI gesendet. Sichtbarer Beleg ist die
           Nachricht mit der Zusammenfassung "Uebergabe nach Kontext leeren".
           Die Sonde wartet, bis die KI fertig geschrieben hat (hoStart bricht sonst mit
           "Bitte erst die Antwort stoppen." ab) und klickt hochstens zweimal. */
        final String handoffProbe = "(function(){try{"
                + "var p=document.getElementById('btn-pause');"
                + "if(p && !p.classList.contains('hidden'))return JSON.stringify({uebersprungen:'KI schreibt noch'});"
                + "var b=document.getElementById('btn-handoff');"
                + "if(!b)return JSON.stringify({knopf:'fehlt'});"
                + "if(b.classList.contains('hidden'))return JSON.stringify({knopf:'verborgen (handoff aus?)'});"
                + "window.__hoVor=(document.querySelectorAll('#messages-inner .msg').length);"
                + "b.click();"
                + "return JSON.stringify({geklickt:true,meldung:((document.getElementById('toast-root')||{}).textContent||'').trim().slice(0,60)});"
                + "}catch(e){return 'Fehler: '+e.message}})()";
        final String handoffWirkungProbe = "(function(){try{"
                + "var h=[...document.querySelectorAll('#messages-inner .handoff-msg summary')].map(function(s){return (s.textContent||'').trim().slice(0,50);});"
                + "return JSON.stringify({nachrichten:document.querySelectorAll('#messages-inner .msg').length,"
                + "vorher:window.__hoVor||0,uebergaben:h});}catch(e){return 'Fehler: '+e.message}})()";

        web.postDelayed(() -> web.evaluateJavascript(handoffProbe, (v) -> Log.i("LLMBOX-UI", "probe_handoff=" + v)), 64000);
        web.postDelayed(() -> web.evaluateJavascript(handoffProbe, (v) -> Log.i("LLMBOX-UI", "probe_handoff2=" + v)), 74000);
        web.postDelayed(() -> web.evaluateJavascript(handoffWirkungProbe, (v) -> Log.i("LLMBOX-UI", "probe_handoff_wirkung=" + v)), 95000);

        /* ── Chat-Sync ueber die echte Windows-Freigabe ──
           Gemeldet wurde: "synchronisiert, aber 0 Chats kopiert". Ursache war das Umbenennen
           auf der Freigabe (siehe SmbStore.rename). Diese Sonde prueft den echten Zustand und
           hoelt die lokalen Chats nach - schreibt also in die Chat-Freigabe des Nutzers,
           deshalb nur mit --ez probechat true. */
        // Merkt sich jede Meldung des Hintergrundabgleichs, damit der Nachweis nicht von
        // einem zufaelligen Zeitpunkt abhaengt.
        final String wireRemoteProbe = "(function(){try{"
                + "window.__remoteHits=window.__remoteHits||[];"
                + "if(!window.__remoteWired){window.__remoteWired=true;"
                + " window.api.onChatsChanged(function(m){window.__remoteHits.push("
                + "  JSON.stringify({metas:(m.metas||[]).map(function(x){return x.id+'@'+x.rev}),removed:m.removed||[]}));});}"
                + "return 'gelauscht';}catch(e){return e.message}})()";

        // evaluateJavascript wartet ein Promise NICHT ab - der Stand wird deshalb in
        // window.__syncReport geschrieben und in einem spaeteren Schritt ausgelesen.
        final String syncStatusWrap = "(function(){try{"
                + "window.api.sync.get().then(function(s){window.__syncDir=s.dir;window.__syncDev=s.deviceId;"
                + " return window.api.chats.list();}).then(function(l){"
                + "  window.__syncReport=JSON.stringify({dir:window.__syncDir||'(lokal)',geraete:window.__syncDev,"
                + "  chats:(l||[]).length,aeltesterTitel:((l||[])[0]||{}).title});"
                + " }).catch(function(e){window.__syncReport='Fehler: '+e.message;});"
                + "return 'Sync-Stand wird gelesen';}catch(e){return e.message}})()";
        final String syncReportProbe = "(function(){try{return window.__syncReport||'noch kein Ergebnis';}"
                + "}catch(e){return e.message}})()";

        final String migrateProbe = "(function(){try{"
                + "window.__mig=window.api.sync.migrate().then(function(r){window.__migDone=r;});"
                + "return 'migrate gestartet';}catch(e){return 'Fehler: '+e.message}})()";
        final String migrateResultProbe = "(function(){try{var r=window.__migDone;"
                + "if(!r)return 'laeuft noch';"
                + "return JSON.stringify({copied:r.copied,skipped:r.skipped,fehlgeschlagen:(r.fehlgeschlagen||[]).map(function(x){return x.error}).slice(0,3)});"
                + "}catch(e){return 'Fehler: '+e.message}})()";

        /* ── Einmalige Korrektur des doppelten Unterordners (--ez fixsync true) ──
           Der Nutzer hatte \\host\share\MeinProjekt\LLM-Box-Chats eingetragen; die App haengt
           den Unterordner aber selbst an -> "…\LLM-Box-Chats\LLM-Box-Chats". Die Handy-Chats
           lagen dort getrennt vom PC-Ordner, deshalb wirkte der Sync leer.
           Dieser Schritt setzt den Ordner auf die Freigabe zurueck und fuehrt die lokalen Chats
           in den gemeinsamen Ordner ueber (Kopie, nichts wird geloescht). */
        if (getIntent() != null && getIntent().getBooleanExtra("fixsync", false)) {
            final String fixProbe = "(function(){try{"
                    + "window.__fixReport='laeuft';"
                    + "window.api.sync.get().then(function(s){"
                    + "  window.__fixVor=s.dir;"
                    + "  return window.api.sync.setDir(s.dir);}).then(function(r){"
                    + "  if(!r||!r.ok)throw new Error((r&&r.error)||'setDir abgelehnt');"
                    + "  return window.api.sync.migrate();}).then(function(m){"
                    + "  window.__fixMig=m;"
                    + "  return window.api.chats.list();}).then(function(l){"
                    + "  window.__fixReport=JSON.stringify({vor:window.__fixVor,neu:l.length+' Chats im gemeinsamen Ordner'});"
                    + " }).catch(function(e){window.__fixReport='Fehler: '+e.message;});"
                    + "return 'Korrektur gestartet';}catch(e){return e.message}})()";
            final String fixResultProbe = "(function(){try{return window.__fixReport||'kein Ergebnis';}catch(e){return e.message}})()";
            web.postDelayed(() -> web.evaluateJavascript(fixProbe, (v) -> Log.i("LLMBOX-UI", "probe_fixsync_start=" + v)), 90000);
            web.postDelayed(() -> web.evaluateJavascript(
                    "(function(){try{var r=window.__migDone;return r?JSON.stringify({copied:r.copied,skipped:r.skipped,fehler:(r.fehlgeschlagen||[]).length}):'laeuft noch';}catch(e){return e.message}})()",
                    (v) -> Log.i("LLMBOX-UI", "probe_fixsync_migrate=" + v)), 150000);
            web.postDelayed(() -> web.evaluateJavascript(fixResultProbe, (v) -> Log.i("LLMBOX-UI", "probe_fixsync=" + v)), 152000);
        }

        final boolean fixSync = getIntent() != null && getIntent().getBooleanExtra("fixsync", false);
        web.postDelayed(() -> web.evaluateJavascript(wireRemoteProbe, (v) -> Log.i("LLMBOX-UI", "probe_remote_wire=" + v)), 96000);
        web.postDelayed(() -> web.evaluateJavascript(syncStatusWrap, (v) -> Log.i("LLMBOX-UI", "probe_sync_vor=" + v)), 97000);
        web.postDelayed(() -> web.evaluateJavascript(syncReportProbe, (v) -> Log.i("LLMBOX-UI", "probe_sync_vor_stand=" + v)), 99500);
        // Mit fixsync uebernimmt der Korrekturschritt die Migration - nicht doppelt starten.
        if (!fixSync) {
            web.postDelayed(() -> web.evaluateJavascript(migrateProbe, (v) -> Log.i("LLMBOX-UI", "probe_migrate_start=" + v)), 100500);
            // Die Chats des Nutzers sind mehrere MB gross; das Kopieren ueber die Freigabe dauert.
            web.postDelayed(() -> web.evaluateJavascript(migrateResultProbe, (v) -> Log.i("LLMBOX-UI", "probe_migrate=" + v)), 145000);
        }
        web.postDelayed(() -> web.evaluateJavascript(syncStatusWrap, (v) -> Log.i("LLMBOX-UI", "probe_sync_nach=" + v)), 147000);
        web.postDelayed(() -> web.evaluateJavascript(syncReportProbe, (v) -> Log.i("LLMBOX-UI", "probe_sync_nach_stand=" + v)), 150000);
        // Der Hintergrundabgleich (5 s) soll eine fremde Aenderung von selbst melden.
        web.postDelayed(() -> web.evaluateJavascript(
                "(function(){try{return JSON.stringify({hits:(window.__remoteHits||[]).slice(-3),syncNow:typeof window.__syncNow});}catch(e){return e.message}})()",
                (v) -> Log.i("LLMBOX-UI", "probe_remote_hits=" + v)), 156000);
        }

        /* ── Rohe Netzpruefung von der App aus (--ez smbprobe true) ──
           Der Sync scheitert am Gerat mit "failed to connect to /192.0.2.10 (port 445) …
           after 5000ms", waehrend dieselbe Verbindung vom Rechner klappt und toybox-nc auf dem
           Handy erfolgreich wirkt. Um zu unterscheiden, ob (a) Android/Samsung dem APP-Prozess
           SMB-Port 445 sperrt, (b) nur dieser eine Server blockt oder (c) die SMB-Bibliothek
           selbst scheitert, prueft diese Sonde rein nativ - ohne WebView und ohne JS:
             1. TCP 445 zum Freigabeserver
             2. TCP 445 zum Windows-PC (derselbe Port, anderer Rechner)
             3. TCP 5357 (Synology-Freigabeport) zum selben Server
             4. SMB-Aufruf selbst (test) mit Fehlergrund
           Laeuft im fsPool, damit die Oberflaeche nicht wartet. */
        if (getIntent() != null && getIntent().getBooleanExtra("smbprobe", false)) {
            final String nas = "192.0.2.10";
            final String pc = getIntent().getStringExtra("pcip") == null ? "192.0.2.50" : getIntent().getStringExtra("pcip").trim();
            // Jeder Schritt loggt sofort fuer sich: die fruehere Variante sammelte alles und
            // gab es erst am Ende aus - blieb ein Schritt haengen, fehlte die gesamte Zeile.
            Log.i("LLMBOX-UI", "probe_smb_native=gestartet (Ziel " + nas + ", PC " + pc + ")");
            fsPool.execute(() -> {
                /* Port 8080 ist bekanntermaessen erreichbar (darueber laeuft der Chat). Wenn die
                   App also gar kein LAN duerfte, muesste auch dieser fehlschlagen. Port 5357 ist
                   der alternative SMB-Port eines Synology: klappt er, kann die App die Freigabe
                   ueber diesen Port statt 445 benutzen. */
                for (String[] t : new String[][] {
                        { "192.0.2.30", "8080", "LLM-Server(bekannt OK)" },
                        { nas, "5357", "Synology-SMB-Alternative" },
                        { nas, "445", "Freigabe-SMB" },
                        { pc, "445", "Windows-PC-SMB" } }) {
                    long ms = System.currentTimeMillis();
                    try (java.net.Socket s = new java.net.Socket()) {
                        s.connect(new java.net.InetSocketAddress(t[0], Integer.parseInt(t[1])), 6000);
                        Log.i("LLMBOX-UI", "probe_smb_tcp=" + t[2] + " " + t[0] + ":" + t[1]
                                + " VERBUNDEN nach " + (System.currentTimeMillis() - ms) + " ms");
                    } catch (Throwable e) {
                        Log.i("LLMBOX-UI", "probe_smb_tcp=" + t[2] + " " + t[0] + ":" + t[1]
                                + " FEHLER nach " + (System.currentTimeMillis() - ms) + " ms: " + shortText(e.getMessage()));
                    }
                }
                try {
                    JSONObject o = new JSONObject(smb.test("/smb/" + nas + "/daten"));
                    Log.i("LLMBOX-UI", "probe_smb_call=homes ok=" + o.optBoolean("ok")
                            + (o.has("error") ? (" grund=" + shortText(o.optString("error"))) : (" eintraege=" + o.optInt("entries"))));
                } catch (Throwable e) {
                    Log.i("LLMBOX-UI", "probe_smb_call=FEHLER " + shortText(String.valueOf(e)));
                }
            });
        }

        /* ── Gemeinsamen Chat-Ordner einrichten (--ez setsync true) ──
           Auf dem Gerat war Sync nie aktiv: files/data/sync.json enthaelt nur eine Geraete-ID,
           und die Freigabe-Zugangsdaten (files/data/smb.json) fehlen vollstaendig
           (probe_creds meldete "benutzer: LEER"). fixsync allein reicht deshalb nicht - es
           setzt nur einen bereits vorhandenen Ordner neu.
           Die Zugangsdaten kommen als Intent-Angaben und stehen damit NICHT im Quelltext:
             --es smbhost 192.0.2.10 --es smbuser BENUTZER --es smbpass PASSWORT
                                       [--es smbdomain DOMAENE] [--es smbshare homes/MeinProjekt]
           Alles laeuft ueber die echten App-Funktionen (Native.smbSaveCreds, api.sync.setDir,
           api.sync.migrate) - derselbe Weg, den der Knopf "Freigabe verbinden & uebernehmen"
           in Einstellungen -> Daten geht. */
        if (getIntent() != null && getIntent().getBooleanExtra("setsync", false)) {
            final String cHost = jsQuote(getIntent().getStringExtra("smbhost") == null ? "" : getIntent().getStringExtra("smbhost").trim());
            final String cUser = jsQuote(getIntent().getStringExtra("smbuser") == null ? "" : getIntent().getStringExtra("smbuser").trim());
            final String cDom = jsQuote(getIntent().getStringExtra("smbdomain") == null ? "" : getIntent().getStringExtra("smbdomain").trim());
            final String cPass = jsQuote(getIntent().getStringExtra("smbpass") == null ? "" : getIntent().getStringExtra("smbpass"));
            final String shareRaw = (getIntent().getStringExtra("smbsyncdir") == null || getIntent().getStringExtra("smbsyncdir").trim().isEmpty())
                    ? "/smb/192.0.2.10/daten/MeinProjekt" : getIntent().getStringExtra("smbsyncdir").trim();
            final String cDir = jsQuote(shareRaw);

            /* Ausfuehrung als Protokoll: jeder Schritt schreibt sein Ergebnis (inklusive des
               echten Fehlergrundes) in window.__syncLog. Der fruehere Ablauf gab Promises direkt
               an evaluateJavascript - die wartet aber kein Promise ab, und weil der Logpuffer des
               Gerats nur 5 MiB hat, waren die Zeilen ausserdem weg, bevor sie ausgelesen wurden.
               Jetzt: ein Schritt pro Aufruf, Ergebnis in einer Variable, Auslesen am Ende. */
            final String syncSteps = "(function(){"
                    + "window.__syncLog=window.__syncLog||[];"
                    + "var L=function(s){window.__syncLog.push(s);};"
                    + "L('schritt='+(window.__syncStep=(window.__syncStep||0)+1));"
                    + "if(window.__syncStep===1){"
                    + "  if(typeof Native==='undefined'||typeof Native.smbSaveCreds!=='function'){L('FEHLT:Native.smbSaveCreds');return;}"
                    + "  try{L('creds gespeichert: '+String(Native.smbSaveCreds('%HOST%','%USER%','%DOM%','%PASS%')).slice(0,40));}"
                    + "  catch(e){L('FEHLER smbSaveCreds: '+e.message);}"
                    + "  window.__fsJob('smbTest','%DIR%').then(function(r){"
                    + "    L('smbTest ok='+(r&&r.ok)+(r&&r.error?(' grund='+String(r.error).slice(0,140)):'')+(r&&r.entries!==undefined?(' eintraege='+r.entries):''));"
                    + "  }).catch(function(e){L('FEHLER smbTest: '+e.message);});"
                    + "}else if(window.__syncStep===2){"
                    + "  window.api.sync.setDir('%DIR%').then(function(r){"
                    + "    L('setDir ok='+(r&&r.ok)+(r&&r.error?(' grund='+String(r.error).slice(0,160)):'')+(r&&r.folder?(' ordner='+r.folder):''));"
                    + "  }).catch(function(e){L('FEHLER setDir: '+e.message);});"
                    + "}else if(window.__syncStep===3){"
                    + "  window.api.sync.migrate().then(function(m){"
                    + "    L('migrate ok='+(m&&m.ok)+' kopiert='+(m&&m.copied)+' unveraendert='+(m&&m.skipped)"
                    + "      +(m&&m.error?(' grund='+String(m.error).slice(0,140)):'')"
                    + "      +(m&&m.fehlgeschlagen&&m.fehlgeschlagen.length?(' fehlgeschlagen='+JSON.stringify(m.fehlgeschlagen.slice(0,2)).slice(0,200)):''));"
                    + "  }).catch(function(e){L('FEHLER migrate: '+e.message);});"
                    + "}else if(window.__syncStep===4){"
                    + "  Promise.all([window.api.sync.get(),window.api.chats.list()]).then(function(a){"
                    + "    L('stand dir='+(a[0].dir||'(nur lokal)')+' geraet='+a[0].deviceId+' chats='+(a[1]||[]).length"
                    + "      +' aeltester='+(((a[1]||[])[0]||{}).title||'-').slice(0,40));"
                    + "  }).catch(function(e){L('FEHLER stand: '+e.message);});"
                    + "}else{L('fertig');}"
                    + "})();";

            final String syncProtokoll = "(function(){try{return JSON.stringify(window.__syncLog||[]);}catch(e){return e.message}})()";
            final String stepsJs = syncSteps.replace("%HOST%", cHost).replace("%USER%", cUser)
                    .replace("%DOM%", cDom).replace("%PASS%", cPass).replace("%DIR%", cDir);

            // Vier Schritte nacheinander; jeder darf bis zu ~20 s brauchen (SMB-Timeouts 8/15 s).
            web.postDelayed(() -> web.evaluateJavascript(stepsJs, (v) -> Log.i("LLMBOX-UI", "probe_setsync_1=" + v)), 90000);
            web.postDelayed(() -> web.evaluateJavascript(syncProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_setsync_nach1=" + v)), 116000);
            web.postDelayed(() -> web.evaluateJavascript(stepsJs, (v) -> Log.i("LLMBOX-UI", "probe_setsync_2=" + v)), 120000);
            web.postDelayed(() -> web.evaluateJavascript(syncProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_setsync_nach2=" + v)), 150000);
            web.postDelayed(() -> web.evaluateJavascript(stepsJs, (v) -> Log.i("LLMBOX-UI", "probe_setsync_3=" + v)), 154000);
            web.postDelayed(() -> web.evaluateJavascript(syncProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_setsync_nach3=" + v)), 200000);
            web.postDelayed(() -> web.evaluateJavascript(stepsJs, (v) -> Log.i("LLMBOX-UI", "probe_setsync_4=" + v)), 204000);
            web.postDelayed(() -> web.evaluateJavascript(syncProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_setsync_ende=" + v)), 216000);
        }

        /* ── Abgleich-Rhythmus nachmessen (--ez probe true --ez syncrate true) ──
           Der Nutzer kann seit dieser Version selbst waehlen, wie oft abgeglichen wird
           (Echtzeit = 2 s bis 30 Minuten). Am Gerat soll bewiesen werden, dass die gewaehlte
           Stufe wirklich eingehalten wird - und zwar ueber die echten App-Funktionen.
           native-main.js zaehlt jeden Abgleich-Lauf mit (window.__syncTicks), daraus werden
           die echten Abstaende in Millisekunden gemeldet.
           Ablauf: Grundtempo messen -> auf 1 Minute stellen -> messen (es darf fast nichts
           passieren) -> zurueck auf Echtzeit -> messen. */
        if (getIntent() != null && getIntent().getBooleanExtra("syncrate", false)) {
            final String rateSteps = "(function(){"
                    + "window.__rateLog=window.__rateLog||[];"
                    + "var L=function(s){window.__rateLog.push(s);};"
                    + "L('schritt='+(window.__rateStep=(window.__rateStep||0)+1));"
                    + "if(window.__rateStep===1){"
                    // Gegenprobe: eine eigene, unabhaengige setTimeout-Kette mit festem 2-s-Takt.
                    // Laeuft sie, ist die WebView allgemein nicht gedrosselt - dann liegt ein
                    // Fehler an der Abgleich-Schleife selbst. Bleibt sie bei 0, drosselt Android.
                    + "  if(!window.__ctlFired){window.__ctlFired=0;(function loop(){setTimeout(function(){window.__ctlFired++;loop();},2000);})();}"
                    + "  window.api.sync.get().then(function(r){L('vorher everyMs='+r.everyMs+' dir='+(r.dir||'(nur lokal)')+' ticks='+window.__syncTicks()+' gegenprobe='+window.__ctlFired+' sichtbar='+(typeof document!=='undefined'?document.visibilityState:'?'));})"
                    + "   .catch(function(e){L('FEHLER get: '+e.message);});"
                    + "}else if(window.__rateStep===2){"
                    // Bewusst KEIN Zuruecksetzen des Zaehlers: die Zahl der Laeufe seit dem
                    // App-Start ist gerade der Beweis dafuer, ob der Timer ueberhaupt laeuft.
                    // Vorher wurde hier auf 0 gestellt - dadurch war "anzahl:0" nicht von
                    // "Timer laeuft nicht" zu unterscheiden.
                    + "  L('takt_standard='+window.__syncTicks());"
                    + "}else if(window.__rateStep===3){"
                    + "  window.api.sync.setEvery(60000).then(function(r){L('setEvery(60000) ok='+(r&&r.ok)+' wert='+(r&&r.everyMs)+(r&&r.error?(' grund='+r.error):''));})"
                    + "   .catch(function(e){L('FEHLER setEvery: '+e.message);});"
                    + "}else if(window.__rateStep===4){"
                    + "  window.api.sync.get().then(function(r){L('gemessen_1min='+window.__syncTicks()+' everyMs='+r.everyMs+' gegenprobe='+window.__ctlFired);})"
                    + "   .catch(function(e){L('FEHLER messen: '+e.message);});"
                    + "}else if(window.__rateStep===5){"
                    + "  window.api.sync.setEvery(2000).then(function(r){L('setEvery(2000) ok='+(r&&r.ok)+' wert='+(r&&r.everyMs));})"
                    + "   .catch(function(e){L('FEHLER setEvery: '+e.message);});"
                    + "}else if(window.__rateStep===6){"
                    + "  window.api.sync.get().then(function(r){L('takt_echtzeit='+window.__syncTicks()+' everyMs='+r.everyMs+' gegenprobe='+window.__ctlFired);})"
                    + "   .catch(function(e){L('FEHLER messen: '+e.message);});"
                    + "}else{L('fertig');}"
                    + "})();";
            final String rateProtokoll = "(function(){try{return JSON.stringify(window.__rateLog||[]);}catch(e){return e.message}})()";

            // Nach 75 s ist die Basis-Sonde durch; bis dahin laeuft der Abgleich bereits.
            web.postDelayed(() -> web.evaluateJavascript(rateSteps, (v) -> Log.i("LLMBOX-UI", "probe_rate_1=" + v)), 76000);
            web.postDelayed(() -> web.evaluateJavascript(rateProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_rate_standard=" + v)), 92000);
            web.postDelayed(() -> web.evaluateJavascript(rateSteps, null), 94000);      // auf 1 Minute stellen
            web.postDelayed(() -> web.evaluateJavascript(rateProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_rate_gesetzt=" + v)), 97000);
            web.postDelayed(() -> web.evaluateJavascript(rateSteps, null), 124000);     // nach 30 s messen
            web.postDelayed(() -> web.evaluateJavascript(rateProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_rate_langsam=" + v)), 127000);
            web.postDelayed(() -> web.evaluateJavascript(rateSteps, null), 130000);     // zurueck auf Echtzeit
            web.postDelayed(() -> web.evaluateJavascript(rateProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_rate_zurueck=" + v)), 133000);
            web.postDelayed(() -> web.evaluateJavascript(rateSteps, null), 163000);     // nach 30 s messen
            web.postDelayed(() -> web.evaluateJavascript(rateProtokoll, (v) -> Log.i("LLMBOX-UI", "probe_rate_echtzeit=" + v)), 166000);
        }

        // Alles wieder in den Ausgangszustand: die Sonde darf keine offenen Dialoge oder
        // einen offenen Drawer hinterlassen - das wirkte sonst wie ein Fehler der App.
        // Bewusst ZULETZT (70 s): die spaeteren Sonden oeffnen selbst Einstellungen und
        // den Drawer, ein frueheres Schließen (16 s) haette nichts gebracht.
        web.postDelayed(() -> web.evaluateJavascript(
                "(function(){try{var n=0;document.querySelectorAll('.modal-back .icon-btn').forEach(function(b){b.click();n++;});"
              + "document.body.classList.remove('drawer-open');"
              + "var i=document.getElementById('input');if(i){i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));}"
              + "return JSON.stringify({closed:n,drawer:false,eingabeGeleert:true});}catch(e){return e.message}})()",
                (v) -> Log.i("LLMBOX-UI", "probe_close_end2=" + v)), 70000);
    }

    /** Sonde: Drawer der Chatliste oeffnen, damit eine Chatzeile gemessen werden kann. */
    private String openDrawerForChatProbe() {
        return "(function(){try{var b=document.getElementById('btn-drawer');"
                + "if(b && !document.body.classList.contains('drawer-open'))b.click();"   // nicht toggeln: sonst zugeklappt
                + "return JSON.stringify({drawer:document.body.classList.contains('drawer-open'),"
                + "chats:document.querySelectorAll('.chat-item').length});}catch(e){return e.message}})()";
    }

    /** JS-Schnipsel: den Server-Reiter mit diesem Text antippen (nur im Server-Dialog). */
    private String openTabJs(String label) {
        return "(function(){try{"
                + "var navs=[...document.querySelectorAll('.settings nav')];"
                + "var nav=navs.find(function(n){return [...n.querySelectorAll('button')].some(function(b){return /Zielrechner/.test(b.textContent||'');});});"
                + "if(!nav)return 'kein Server-nav';"
                + "for(var b of nav.querySelectorAll('button')){if((b.textContent||'').trim().indexOf('" + label + "')===0){b.click();return 'geoeffnet: " + label + "'}}"
                + "return 'Tab nicht gefunden';}catch(e){return 'Fehler: '+e.message}})()";
    }

    /* ────────────────────────── SMB-Zugangsdaten ────────────────────────── */

    /** Ließt {host:{user,domain,pass}} aus files/data/smb.json (App-eigener, privater Speicher). */
    private SmbStore.Creds loadCreds(String host) {
        try {
            File f = new File(dataDir, "smb.json");
            if (!f.exists()) return new SmbStore.Creds("", "", "");
            String txt;
            try (InputStream in = new java.io.FileInputStream(f)) { txt = new String(readAll(in), StandardCharsets.UTF_8); }
            JSONObject all = new JSONObject(txt);
            JSONObject c = all.optJSONObject(host);
            if (c == null) return new SmbStore.Creds("", "", "");
            return new SmbStore.Creds(c.optString("user", ""), c.optString("domain", ""), c.optString("pass", ""));
        } catch (Exception e) {
            return new SmbStore.Creds("", "", "");
        }
    }

    /** Messwert der Web-Seite ins Logcat (nur Debug-Bau). Tag: LLMBOX-UI */
    private void uiLog(String msg) {
        if (BuildConfig.DEBUG) Log.i("LLMBOX-UI", msg);
    }

    /** Randlose Darstellung korrekt behandeln: Systemabstände als Innenabstand des Containers. */
    private void applyEdgeToEdge(View root) {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            // Statusleiste, Notch/Auschnitt und Navigations-/Gestenfalte.
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.statusBars()
                            | WindowInsetsCompat.Type.displayCutout()
                            | WindowInsetsCompat.Type.navigationBars());
            // Tastatur: Bei randlosem Fenster greift windowSoftInputMode="adjustResize" nicht mehr,
            // die App bekommt die Höhe nur als ime-Inset. Unten gilt der größere der beiden Werte,
            // damit das Eingabefeld über der Tastatur sichtbar bleibt und nicht doppelt rückt.
            int bottom = Math.max(bars.bottom, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
            v.setPadding(bars.left, bars.top, bars.right, bottom);
            Log.i("LLMBOX-UI", "insets top=" + bars.top + " bottom=" + bars.bottom
                    + " ime=" + insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                    + " nav=" + bars.bottom);
            dumpLayoutForDiagnostics();   // Web-Ansicht direkt nachmessen lassen
            return insets;
        });
    }

    /**
     * Schreibt die tatsächliche Layout-Geometrie der Web-Oberfläche ins Logcat.
     * Damit lassen sich Statusleisten-/Tastatur-Abstände auf echten Geräten messen:
     *   adb logcat -s LLMBOX-UI
     */
    private void dumpLayoutForDiagnostics() {
        if (web == null) return;
        final String js = "(function(){try{var t=document.querySelector('#topbar');"
                + "var c=document.querySelector('#composer-wrap');"
                + "var s=document.querySelector('#statusbar');"
                + "var ri=document.getElementById('input');"
                + "var rt=t?t.getBoundingClientRect():null;"
                + "var rc=c?c.getBoundingClientRect():null;"
                + "var rs=s?s.getBoundingClientRect():null;"
                // Composer-Knöpfe: gleiche y-Mitte => alles in einer Zeile, kein Umbruch
                + "var ids=['btn-attach','btn-attach-folder','btn-think','btn-tools','btn-perm','token-estimate','btn-send'];"
                + "var ys=[];var widths=0;"
                + "ids.forEach(function(i){var e=document.getElementById(i);if(!e)return;"
                + "var r=e.getBoundingClientRect();if(r.width>0||r.height>0){ys.push(Math.round(r.top+r.height/2));widths+=Math.round(r.width);}});"
                + "var sameLine=ys.length?ys.every(function(y){return Math.abs(y-ys[0])<=3;}):null;"
                // Statuszeile: ein Textknoten, dessen Höhe nur eine Zeile belegt => kein Umbruch
                + "var sr=document.getElementById('st-right');var sl=document.getElementById('st-left');"
                + "var srH=sr?Math.round(sr.getBoundingClientRect().height):null;"
                + "var lineH=sr?parseFloat(getComputedStyle(sr).lineHeight)||0:0;"
                + "return JSON.stringify({vw:window.innerWidth,vh:window.innerHeight,dpr:window.devicePixelRatio,"
                + "topbarTop:rt?Math.round(rt.top):null,topbarH:rt?Math.round(rt.height):null,"
                + "composerBottom:rc?Math.round(rc.bottom):null,statusBottom:rs?Math.round(rs.bottom):null,"
                + "inputTop:ri?Math.round(ri.getBoundingClientRect().top):null,"
                + "inputBottom:ri?Math.round(ri.getBoundingClientRect().bottom):null,"
                + "composerButtons:ys.length,composerSameLine:sameLine,composerWidth:widths,"
                + "stRightH:srH,stRightLines:(srH&&lineH)?Math.round(srH/lineH):null,"
                + "stLeftW:sl?Math.round(sl.getBoundingClientRect().width):null,"
                // Position der SchlieSS-Knöpfe, damit per adb gezielt getippt werden kann
                + "btnPanel:(function(){var e=document.getElementById('btn-panel');if(!e)return null;"
                + "var r=e.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)];})(),"
                + "btnDrawer:(function(){var e=document.getElementById('btn-drawer');if(!e)return null;"
                + "var r=e.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)];})(),"
                + "theme:document.documentElement.getAttribute('data-theme'),"
                + "drawerOpen:document.body.classList.contains('drawer-open'),"
                + "panelCollapsed:(function(){var f=document.querySelector('#filepanel');return f?f.classList.contains('collapsed'):null})()});"
                + "}catch(e){return 'Fehler: '+e.message}})()";
        web.evaluateJavascript(js, (value) -> Log.i("LLMBOX-UI", "layout=" + value));
    }

    @Override
    protected void onDestroy() {
        for (Call c : activeCalls.values()) {
            try { c.cancel(); } catch (Exception ignored) { }
        }
        fsPool.shutdownNow();
        smb.closeAll();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /**
     * Die Desktop-Version verhindert, dass Chromium eine nicht sichtbare oder verdeckte App
     * ausbremst (V38). Ohne diese Abschaltung drosselt Android die Timer und das Zeichnen der
     * WebView, sobald ein anderer Bildschirm vorne ist – laufende Antworten und sogar die
     * Stopp-Knöpfe reagierten dann minutenlang nicht. Wir halten die App im Vordergrund:
     * Teil des Fensters zu sein kostet hier weniger als eine scheinbar eingefrorene App.
     */
    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        keepAwake(true);
        /* Gemeinsamer Chat-Ordner: nach dem Zurueckkehren sofort abgleichen.
           Android drosselt die Timer der WebView im Hintergrund, ohne diesen Anstoss
           waere die Chatliste nach dem Wechsel zwischen Handy und PC erst Sekunden
           spaeter aktuell. */
        if (web != null && pageLoaded) {
            web.postDelayed(() -> js("__syncNow", ""), 400);
        }
    }

    @Override
    protected void onPause() {
        // Bewusst KEIN web.onPause(): die Antwort soll weiterlaufen, wenn der Nutzer kurz
        // wegschaltet. Nur der Bildschirm-Sperre wird entgegengewirkt.
        super.onPause();
        keepAwake(false);
    }

    private void keepAwake(boolean on) {
        try {
            android.view.Window w = getWindow();
            if (w == null || w.getDecorView() == null) return;
            int flags = w.getAttributes().flags;
            boolean was = (flags & android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0;
            if (on && !was) w.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (!on && was) w.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Exception ignored) { }
    }

    /** Zurück wie bei einer Desktop-App: App in den Hintergrund, nicht den Chat verlassen. */
    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    /* ────────────────────────── JS-Kommunikation ────────────────────────── */

    private void js(String fn, String arg) {
        final String code = "window." + fn + "&&window." + fn + "(" + arg + ");";
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(code, null);
        });
    }

    private void emit(String channel, JSONObject obj) {
        js("__nativeEvent", "\"" + channel + "\"," + obj.toString());
    }

    /* ────────────────────────── Pfade / Dateien ────────────────────────── */

    /** Erlaubt sind nur Workspace und App-Datenordner – wie das safe() der Desktop-Version. */
    private File resolve(String p) throws Exception {
        if (p == null || p.isEmpty()) throw new Exception("Kein Pfad angegeben");
        File f = new File(p);
        if (!f.isAbsolute()) f = new File(workspaceRoot, p);
        String canon = f.getCanonicalPath();
        String ws = workspaceRoot.getCanonicalPath();
        String dd = dataDir.getCanonicalPath();
        boolean ok = canon.equals(ws) || canon.startsWith(ws + File.separator)
                || canon.equals(dd) || canon.startsWith(dd + File.separator);
        if (!ok) throw new Exception("Pfad liegt außerhalb des Workspace");
        return f;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) {
                    String n = c.getString(i);
                    if (n != null && !n.isEmpty()) return n;
                }
            }
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return (last == null || last.isEmpty()) ? "datei.txt" : last;
    }

    private void onFolderPicked(Intent data) {
        Uri tree = data == null ? null : data.getData();
        if (tree == null) { js("__pickResult", "null"); return; }

        // Die Auswahl wird in den App-Speicher kopiert. Das kann bei groessen Ordnern
        // mehrere Sekunden dauern und darf den UI-Thread nicht blockieren - sonst wirkt
        // die App abhangen und die Rueckmeldung an die Web-Ansicht kommt verspaetet.
        new Thread(() -> {
            try {
                try {
                    getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) { }

                String name = tree.getLastPathSegment();
                if (name != null) {
                    int i = name.indexOf(':');
                    if (i >= 0) name = name.substring(i + 1);
                }
                if (name == null || name.isEmpty()) name = "workspace";
                name = name.replaceAll("[^A-Za-z0-9._ -]", "_");

                File target = new File(workspaceRoot, name);
                int copied = copyTree(tree, target, 0);

                JSONObject o = new JSONObject();
                o.put("root", target.getCanonicalPath());
                o.put("name", name);
                o.put("files", copied);
                JSONArray arr = new JSONArray();
                arr.put(o);
                Log.i("LLMBOX-UI", "Ordner uebernommen: " + target.getCanonicalPath() + " (" + copied + " Dateien)");
                js("__pickResult", arr.toString());
            } catch (Exception e) {
                Log.e("LLMBOX-UI", "Ordner-Kopie fehlgeschlagen", e);
                // Als Fehlerobjekt (nicht als null) zurueckgeben, damit die Oberflaeche
                // die Ursache zeigen kann statt still nichts zu uebernehmen.
                js("__pickResult", errJson(e.getMessage()));
            }
        }, "llmbox-folder-import").start();
    }

    private int copyTree(Uri treeUri, File target, int depth) throws Exception {
        if (depth > 12) return 0;
        DocumentFile dir = DocumentFile.fromTreeUri(this, treeUri);
        if (dir == null) return 0;
        if (!target.exists() && !target.mkdirs()) throw new Exception("Zielordner nicht anlegbar");
        int count = 0;
        DocumentFile[] kids = dir.listFiles();
        if (kids != null) {
            for (DocumentFile ch : kids) {
                if (count > 4000) break;
                String n = ch.getName() == null ? "datei" : ch.getName();
                if (ch.isDirectory()) {
                    count += copyTree(ch.getUri(), new File(target, n), depth + 1);
                } else {
                    try (InputStream in = getContentResolver().openInputStream(ch.getUri());
                         OutputStream fo = new FileOutputStream(new File(target, n))) {
                        if (in == null) continue;
                        fo.write(readAll(in));
                        count++;
                    } catch (Exception ignored) { }
                }
            }
        }
        return count;
    }

    private void onFilesPicked(Intent data) {
        try {
            List<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    uris.add(data.getClipData().getItemAt(i).getUri());
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
            File tmp = new File(dataDir, "attachments");
            if (!tmp.exists()) tmp.mkdirs();

            JSONArray out = new JSONArray();
            for (Uri u : uris) {
                String n = displayName(u);
                File f = new File(tmp, System.currentTimeMillis() + "_" + n.replaceAll("[^A-Za-z0-9._ -]", "_"));
                try (InputStream in = getContentResolver().openInputStream(u); OutputStream fo = new FileOutputStream(f)) {
                    if (in == null) continue;
                    fo.write(readAll(in));
                } catch (Exception e) {
                    JSONObject o = new JSONObject();
                    o.put("name", n);
                    o.put("error", e.getMessage());
                    out.put(o);
                    continue;
                }
                JSONObject o = new JSONObject();
                o.put("path", f.getCanonicalPath());
                o.put("name", n);
                out.put(o);
            }
            js("__pickResult", out.toString());
        } catch (Exception e) {
            js("__pickResult", errJson(e.getMessage()));
        }
    }

    private void onSaveTarget(Uri uri) {
        try (OutputStream os = getContentResolver().openOutputStream(uri)) {
            if (os == null) throw new Exception("Zieldatei nicht beschreibbar");
            if (pendingSaveBytes != null) os.write(pendingSaveBytes);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("path", uri.toString());
            js("__saveResult", o.toString());
        } catch (Exception e) {
            js("__saveResult", errJson(e.getMessage()));
        } finally {
            pendingSaveBytes = null;
        }
    }

    private void openExternal(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
    }

    /** Fehlermeldungen einzeilig und kurz halten (Logcat-Zeilen sind begrenzt). */
    private static String shortText(String s) {
        String t = String.valueOf(s == null ? "" : s).replace('\n', ' ').trim();
        return t.length() <= 140 ? t : t.substring(0, 140);
    }

    /* Wandelt beliebigen Text in einen sicher einbettbaren Inhalt eines einfach
       quotierten JS-Strings um. Noetig fuer Sonden, die Angaben aus dem Intent
       (Freigabe-Pfad, Benutzername) in evaluateJavascript-Quelltext einsetzen - ohne
       Escaping wuerde schon ein Schraegstrich im Pfad den Code ungueltig machen. */
    private static String jsQuote(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {
            switch (c) {
                case '\\': b.append("\\\\"); break;
                case '\'': b.append("\\'"); break;
                case '"': b.append("\\\""); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                default: b.append(c);
            }
        }
        return b.toString();
    }

    private static String errJson(String msg) {
        try {
            return new JSONObject().put("ok", false).put("error", msg == null ? "unbekannter Fehler" : msg).toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"Fehler\"}";
        }
    }

    /* ────────────────────────── Brücke für die Web-App ────────────────────────── */

    private class Bridge {

        @JavascriptInterface
        public String appInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("version", "1.0.50-android");
                o.put("dataDir", dataDir.getCanonicalPath());
                o.put("workspaceRoot", workspaceRoot.getCanonicalPath());
                // Name des Geräts, damit Chats auf mehreren Rechnern unterscheidbar sind (V44).
                String model = android.os.Build.MODEL == null ? "" : android.os.Build.MODEL.trim();
                String mfr = android.os.Build.MANUFACTURER == null ? "" : android.os.Build.MANUFACTURER.trim();
                o.put("deviceName", model.isEmpty() ? "Android-Gerät"
                        : (mfr.isEmpty() || model.toLowerCase(Locale.ROOT).contains(mfr.toLowerCase(Locale.ROOT))
                           ? model : mfr + " " + model));
                String wv = "?";
                try {
                    Object pi = android.webkit.WebView.class.getMethod("getCurrentWebViewPackage").invoke(null);
                    if (pi != null) {
                        Object vn = pi.getClass().getField("versionName").get(pi);
                        if (vn != null) wv = String.valueOf(vn);
                    }
                } catch (Exception ignored) { }
                o.put("electron", "Android WebView " + wv);
                o.put("platform", "android");
                o.put("osLabel", "Android " + android.os.Build.VERSION.RELEASE);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /** Messwerte der Web-Oberfläche ins Logcat (nur Debug-Bau). Tag: LLMBOX-UI */
        @JavascriptInterface
        public void uiLog(String msg) {
            if (BuildConfig.DEBUG && msg != null) Log.i("LLMBOX-UI", msg);
        }

        /**
         * Einziger Eingang für Datei- und Netzwerkzugriffe. Führt die Arbeit im Hintergrundpool
         * aus und schickt das Ergebnis als window.__fsResult(id, …) zurück. Siehe fsPool:
         * ein synchroner Brückenaufruf würde den Render-Thread der WebView blockieren und bei
         * einem Workspace auf einer Windows-Freigabe die ganze Oberfläche einfrieren lassen.
         */
        @JavascriptInterface
        public String fsJob(String id, String op, String a, String b, String c) {
            try {
                if (id == null || id.isEmpty()) return errJson("Keine Auftrags-ID");
                final String jid = id;
                fsPool.execute(() -> {
                    String res;
                    long t0 = System.currentTimeMillis();
                    try {
                        res = runFsOp(op, a, b, c);
                    } catch (Exception e) {
                        res = errJson(e.getMessage());
                    }
                    long ms = System.currentTimeMillis() - t0;
                    if (ms > 1500) Log.i("LLMBOX-UI", "fsJob " + op + " dauerte " + ms + " ms");
                    js("__fsResult", "\"" + jid + "\"," + jsonSafe(res));
                });
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("started", true);
                o.put("id", id);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /** Führt einen Dateiauftrag im Hintergrund aus. */
        private String runFsOp(String op, String a, String b, String c) throws Exception {
            if (op == null) return errJson("Kein Vorgang angegeben");
            switch (op) {
                case "stat":     return fsStat(a);
                case "exists":   return fsExists(a);
                case "readB64":  return fsReadB64(a);
                case "write":    return fsWrite(a, b, !"false".equals(c));
                case "list":     return fsList(a);
                case "mkdirs":   return fsMkdirs(a);
                case "remove":   return fsRemove(a, !"false".equals(b));
                case "rename":   return fsRename(a, b);
                case "copy":     return fsCopy(a, b);
                case "smbTest":  return smbTest(a);
                case "packFile":  return transferPack(a);
                case "lanSearch": return lanSearch(a);
                default:         return errJson("Unbekannter Dateivorgang: " + op);
            }
        }

        /** JSON so in die JS-Aufrufkette einbetten, dass auch Sonderzeichen nicht zerstören. */
        private static String jsonSafe(String json) {
            if (json == null || json.isEmpty()) return "{}";
            // Zeilentrenner innerhalb von JSON-Zeichenketten waren in JS-Literalen lange verboten.
            return json.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        }

        private String fsStat(String path) {
            try {
                if (SmbStore.isSmb(path)) {
                    JSONObject s = smb.stat(path);
                    JSONObject o = new JSONObject();
                    o.put("ok", true);
                    // org.json kennt kein putAll - Schluessel einzeln uebernehmen.
                    for (java.util.Iterator<String> it = s.keys(); it.hasNext(); ) {
                        String k = it.next();
                        o.put(k, s.get(k));
                    }
                    return o.toString();
                }
                File f = resolve(path);
                if (!f.exists()) return "{\"ok\":false,\"error\":\"nicht gefunden\"}";
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("size", f.length());
                o.put("mtimeMs", f.lastModified());
                o.put("isDir", f.isDirectory());
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        private String fsExists(String path) {
            try {
                JSONObject o = new JSONObject();
                o.put("ok", true);
                if (SmbStore.isSmb(path)) o.put("exists", smb.exists(path));
                else o.put("exists", resolve(path).exists());
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        private String fsReadB64(String path) {
            try {
                JSONObject o = new JSONObject();
                if (SmbStore.isSmb(path)) {
                    o.put("ok", true);
                    o.put("b64", Base64.getEncoder().encodeToString(smb.readBytes(path)));
                    return o.toString();
                }
                File f = resolve(path);
                if (!f.isFile()) return "{\"ok\":false,\"error\":\"keine Datei\"}";
                try (InputStream in = new java.io.FileInputStream(f)) {
                    o.put("ok", true);
                    o.put("b64", Base64.getEncoder().encodeToString(readAll(in)));
                    return o.toString();
                }
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /** Schreibt Text/Bytes; contentB64 hat Vorrang. mkdirs erzeugt Elternordner. */
        private String fsWrite(String path, String contentB64, boolean mkdirs) {
            try {
                byte[] data = Base64.getDecoder().decode(contentB64 == null ? "" : contentB64);
                JSONObject o = new JSONObject();
                if (SmbStore.isSmb(path)) {
                    smb.write(path, data, mkdirs);
                    o.put("ok", true);
                    o.put("size", data.length);
                    return o.toString();
                }
                File f = resolve(path);
                if (mkdirs && f.getParentFile() != null) f.getParentFile().mkdirs();
                try (OutputStream os = new FileOutputStream(f)) {
                    os.write(data);
                }
                o.put("ok", true);
                o.put("size", data.length);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        private String fsList(String path) {
            try {
                JSONObject r = new JSONObject();
                r.put("ok", true);
                if (SmbStore.isSmb(path)) r.put("items", smb.list(path));
                else {
                    File f = resolve(path);
                    File[] kids = f.listFiles();
                    JSONArray arr = new JSONArray();
                    if (kids != null) {
                        for (File k : kids) {
                            JSONObject o = new JSONObject();
                            o.put("name", k.getName());
                            o.put("isDir", k.isDirectory());
                            o.put("size", k.isFile() ? k.length() : 0);
                            arr.put(o);
                        }
                    }
                    r.put("items", arr);
                }
                return r.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        private String fsMkdirs(String path) {
            try {
                JSONObject o = new JSONObject();
                if (SmbStore.isSmb(path)) { smb.mkdirs(path); o.put("ok", true); return o.toString(); }
                File f = resolve(path);
                o.put("ok", f.exists() || f.mkdirs());
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        private String fsRemove(String path, boolean recursive) {
            try {
                JSONObject o = new JSONObject();
                if (SmbStore.isSmb(path)) { smb.remove(path, recursive); o.put("ok", true); return o.toString(); }
                File f = resolve(path);
                o.put("ok", deleteRec(f, recursive));
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        private boolean deleteRec(File f, boolean recursive) {
            if (!f.exists()) return true;
            if (f.isDirectory() && recursive) {
                File[] kids = f.listFiles();
                if (kids != null) for (File k : kids) deleteRec(k, true);
            }
            return f.delete();
        }

        private String fsRename(String from, String to) {
            try {
                JSONObject o = new JSONObject();
                if (SmbStore.isSmb(from) || SmbStore.isSmb(to)) {
                    // renameSafe: klappt das Umbenennen auf dem Server nicht, wird kopiert +
                    // geloescht. Ohne diese Sicherung blieb beim Chat-Sync nur die .tmp-Datei
                    // zurueck und der Chat war in der Liste unsichtbar ("0 Chats kopiert").
                    smb.renameSafe(from, to);
                    o.put("ok", true);
                    return o.toString();
                }
                File a = resolve(from);
                File b = resolve(to);
                boolean moved = a.renameTo(b);
                if (!moved) {
                    // Wie bei SMB: Umbenennen kann fehlschlagen (andere Partition, Sperre).
                    // Kopieren + Loeschen ist dann der sichere Weg, damit nichts als .tmp bleibt.
                    byte[] data = readAll(new java.io.FileInputStream(a));
                    if (b.getParentFile() != null) b.getParentFile().mkdirs();
                    try (OutputStream os = new FileOutputStream(b)) { os.write(data); }
                    a.delete();
                    moved = true;
                }
                o.put("ok", moved);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /** Datei kopieren – für „Lokale Chats in den gemeinsamen Ordner übernehmen" (V44). */
        private String fsCopy(String from, String to) {
            try {
                byte[] data = SmbStore.isSmb(from) ? smb.readBytes(from) : readAll(new java.io.FileInputStream(resolve(from)));
                if (SmbStore.isSmb(to)) {
                    smb.write(to, data, true);
                } else {
                    File b = resolve(to);
                    if (b.getParentFile() != null) b.getParentFile().mkdirs();
                    try (OutputStream os = new FileOutputStream(b)) { os.write(data); }
                }
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("size", data.length);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /* ───────────────────────── Übertragung (V52-Format, docs/TRANSFER-FORMAT.md) ─────────────────────────
           Die Windows-Seite komprimiert mit Node zlib (RFC 1950) und haengt Stuecke von 600
           Base64-Zeichen in QR-Codes. Damit dieselben Codes auf dem Handy funktionieren, muss
           hier dasselbe Format entstehen: zlib-Kompression (mit Header, nicht "raw"), Standard-
           Base64 mit Padding und SHA-256 ueber den komprimierten Bytes. Beides liefert die
           Java-Standardbibliothek, es wird keine zusaetzliche Abhaengigkeit benoetigt. */

        /** JSON-Text komprimieren, base64-codieren und Pruefsumme bilden (entspricht transfer:pack). */
        private String transferPack(String json) {
            try {
                byte[] raw = String.valueOf(json == null ? "" : json).getBytes(StandardCharsets.UTF_8);

                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                try (java.util.zip.DeflaterOutputStream dz =
                             new java.util.zip.DeflaterOutputStream(bo, new java.util.zip.Deflater(9))) {
                    dz.write(raw);
                }
                byte[] z = bo.toByteArray();

                java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
                byte[] hash = md.digest(z);
                StringBuilder hex = new StringBuilder();
                for (byte b : hash) hex.append(String.format("%02x", b));

                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("b64", Base64.getEncoder().encodeToString(z));
                o.put("sha16", hex.substring(0, 16));
                o.put("rawBytes", raw.length);
                o.put("zBytes", z.length);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /**
         * Sucht im WLAN nach einer angebotenen Uebertragung (Gegenseite: main.js,
         * transfer:serveStart). Laeuft im Executor-Pool, damit die Oberflaeche waehrend des
         * Wartens bedienbar bleibt. Kurzes Signal auf 255.255.255.255 und auf der
         * Subnetz-Broadcast-Adresse, Antworten werden gesammelt.
         */
        private String lanSearch(String jsonOpts) {
            java.net.DatagramSocket sock = null;
            try {
                int waitMs = 1800;
                try {
                    JSONObject o = new JSONObject(jsonOpts == null || jsonOpts.isEmpty() ? "{}" : jsonOpts);
                    waitMs = Math.max(400, Math.min(6000, o.optInt("waitMs", 1800)));
                } catch (Exception ignored) { }

                sock = new java.net.DatagramSocket();
                sock.setSoTimeout(waitMs);
                byte[] probe = "LLMBOX?".getBytes(StandardCharsets.UTF_8);
                for (String target : new String[] { "255.255.255.255" }) {
                    try {
                        sock.send(new java.net.DatagramPacket(probe, probe.length,
                                java.net.InetAddress.getByName(target), 45455));
                    } catch (Exception ignored) { }
                }

                java.util.List<String> urls = new ArrayList<>();
                java.util.Set<String> seenHosts = new java.util.HashSet<>();
                long until = System.currentTimeMillis() + waitMs;
                byte[] buf = new byte[512];
                while (System.currentTimeMillis() < until) {
                    java.net.DatagramPacket p = new java.net.DatagramPacket(buf, buf.length);
                    try { sock.receive(p); } catch (java.net.SocketTimeoutException e) { break; }
                    String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                    String[] f = msg.split("\\|");
                    if (f.length < 4 || !f[0].equals("LLMBOX")) continue;
                    String host = p.getAddress().getHostAddress();
                    if (!seenHosts.add(host)) continue;
                    urls.add("http://" + host + ":" + f[1] + "/llmbox-transfer?t=" + f[2]);
                }

                JSONObject out = new JSONObject();
                out.put("ok", !urls.isEmpty());
                out.put("urls", new JSONArray(urls));
                if (urls.isEmpty()) out.put("error", "Keine antwortende LLM-Box im WLAN. Laeuft der Dienst in den Einstellungen der Windows-App? Beide Geraete im selben Netz?");
                return out.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            } finally {
                if (sock != null) try { sock.close(); } catch (Exception ignored) { }
            }
        }

        /* transfer:wsFiles ist bewusst NICHT hier implementiert, sondern in native-main.js:
           ueber die asynchrone Dateibruecke laufen dort lokale Ordner und Netzwerkfreigaben
           mit denselben Grenzen, ohne dass zusaetzlicher nativer Code gepflegt werden muss. */

        /**
         * QR-Scan vorbereiten: holt die Kamera-Erlaubnis, falls sie noch nicht vorliegt.
         * Die Web-Seite wartet auf das Ergebnis (window.__qrPermission) und baut erst dann die
         * Vorschau auf. Angefragt wird ausschliesslich beim ersten Scan - ein Start der App mit
         * Erlaubnisabfrage wuerde wie ein Fehler wirken. Vollqualifizierte Namen, weil dafuer
         * keine neuen Imports noetig sind.
         */
        @JavascriptInterface
        public String qrScanStart() {
            try {
                JSONObject o = new JSONObject();
                o.put("ok", true);
                if (checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    o.put("bereitsErlaubt", true);
                    runOnUiThread(() -> js("__qrPermission", "true"));
                    return o.toString();
                }
                o.put("angefragt", true);
                cameraLauncher.launch(android.Manifest.permission.CAMERA);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /* ── Netzwerkordner (SMB) ── */
        private String smbTest(String path) {
            try { return smb.test(path); } catch (Exception e) { return errJson(e.getMessage()); }
        }

        /**
         * Liefert die gespeicherten Zugangsdaten eines Rechners, damit die Eingabefelder
         * beim erneuten Oeffnen der Einstellungen vorbelegt werden koennen. Das Passwort
         * selbst wird bewusst NICHT zurueckgegeben (die Web-Seite soll es nie sehen) - nur
         * die Information, dass eines hinterlegt ist.
         */
        @JavascriptInterface
        public String smbGetCreds(String host) {
            try {
                SmbStore.Creds c = loadCreds(host == null ? "" : host.trim());
                boolean hasPass = c.pass != null && !c.pass.isEmpty();
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("user", c.user == null ? "" : c.user);
                o.put("domain", c.domain == null ? "" : c.domain);
                o.put("hasPass", hasPass);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /** Merkt Zugangsdaten pro Rechner im privaten App-Speicher (files/data/smb.json). */
        @JavascriptInterface
        public String smbSaveCreds(String host, String user, String domain, String pass) {
            try {
                File dir = dataDir;
                if (!dir.exists() && !dir.mkdirs()) return errJson("Speicherordner nicht anlegbar");
                File f = new File(dir, "smb.json");
                JSONObject all = new JSONObject();
                if (f.exists()) {
                    try (InputStream in = new java.io.FileInputStream(f)) {
                        all = new JSONObject(new String(readAll(in), StandardCharsets.UTF_8));
                    }
                }
                JSONObject c = new JSONObject();
                // Leer gelassener Benutzer/Domain bedeutet unveraendert lassen - sonst wuerde ein
                // erneutes Bestaetigen mit leeren Feldern (die Oberflaeche leert sie beim
                // Schliessen des Dialogs) den gespeicherten Benutzer loeschen und der naechste
                // Versuch laeuft anonym -> "Anmeldung abgelehnt". Genau das sah der Nutzer als
                // "Zugangsdaten weg nach App-Neustart".
                JSONObject old = all.optJSONObject(host);
                String keepUser = (user == null || user.trim().isEmpty()) && old != null ? old.optString("user", "") : (user == null ? "" : user.trim());
                String keepDom = (domain == null || domain.trim().isEmpty()) && old != null ? old.optString("domain", "") : (domain == null ? "" : domain.trim());
                c.put("user", keepUser);
                c.put("domain", keepDom);
                // Leer gelassenes Passwort bedeutet: unveraendert lassen (das Feld zeigt es nie an).
                if (pass != null && !pass.isEmpty()) c.put("pass", pass);
                else if (all.optJSONObject(host) != null) c.put("pass", all.getJSONObject(host).optString("pass", ""));
                all.put(host, c);
                try (OutputStream os = new FileOutputStream(f)) {
                    os.write(all.toString(2).getBytes(StandardCharsets.UTF_8));
                }
                JSONObject o = new JSONObject();
                o.put("ok", true);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        /* ── Ordner-/Dateiauswahl ── */

        @JavascriptInterface
        public void pickFolder() {
            Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            // ActivityResultLauncher darf nur vom UI-Thread gestartet werden. Aus dem
            // Brücken-Thread (Binder) würde der Aufruf fehlschlagen und die Auswahl
            // käme nie zurück - deshalb ausdruecklich auf den UI-Thread wechseln.
            runOnUiThread(() -> {
                try { folderLauncher.launch(it); }
                catch (Exception e) { Log.e("LLMBOX-UI", "pickFolder launch fehlgeschlagen", e); js("__pickResult", errJson(e.getMessage())); }
            });
        }

        @JavascriptInterface
        public void pickFiles() {
            Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            it.addCategory(Intent.CATEGORY_OPENABLE);
            it.setType("*/*");
            it.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            runOnUiThread(() -> {
                try { filesLauncher.launch(it); }
                catch (Exception e) { Log.e("LLMBOX-UI", "pickFiles launch fehlgeschlagen", e); js("__pickResult", errJson(e.getMessage())); }
            });
        }

        @JavascriptInterface
        public void saveAs(String defaultName, String contentB64) {
            pendingSaveBytes = Base64.getDecoder().decode(contentB64 == null ? "" : contentB64);
            Intent it = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            it.addCategory(Intent.CATEGORY_OPENABLE);
            it.setType("*/*");
            it.putExtra(Intent.EXTRA_TITLE, defaultName == null || defaultName.isEmpty() ? "datei.txt" : defaultName);
            try { saveLauncher.launch(it); } catch (Exception e) { js("__saveResult", errJson(e.getMessage())); }
        }

        @JavascriptInterface
        public void openExternal(String url) {
            if (url != null && url.matches("(?i)^https?://.*")) MainActivity.this.openExternal(url);
        }

        /* ── HTTP: fetch und Streaming, ohne CORS-Beschränkung ── */

        @JavascriptInterface
        public String httpFetch(String reqJson) {
            return httpRequest(reqJson, false);
        }

        @JavascriptInterface
        public String httpStream(String reqJson) {
            return httpRequest(reqJson, true);
        }

        private String httpRequest(String reqJson, boolean stream) {
            try {
                JSONObject o = new JSONObject(reqJson);
                final String id = o.optString("id", "");
                String url = o.getString("url");
                String method = o.optString("method", "GET").toUpperCase(Locale.US);

                RequestBody rb = null;
                if (o.has("body") && !o.isNull("body")) {
                    byte[] bodyBytes = o.getString("body").getBytes(StandardCharsets.UTF_8);
                    MediaType mt = MediaType.parse(o.optString("contentType", "application/json"));
                    rb = RequestBody.create(bodyBytes, mt);
                } else if (!"GET".equals(method) && !"HEAD".equals(method)) {
                    rb = RequestBody.create(new byte[0], null);
                }

                Request.Builder b = new Request.Builder().url(url).method(method, rb);
                JSONObject h = o.optJSONObject("headers");
                if (h != null) {
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                        String k = it.next();
                        if ("content-length".equalsIgnoreCase(k)) continue;
                        b.header(k, h.getString(k));
                    }
                }

                int timeoutMs = o.optInt("timeout", 0);
                OkHttpClient use = timeoutMs > 0
                        ? client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build()
                        : client;

                Call call = use.newCall(b.build());
                if (!id.isEmpty()) activeCalls.put(id, call);

                final boolean doStream = stream;
                call.enqueue(new Callback() {
                    @Override
                    public void onFailure(Call c, java.io.IOException e) {
                        finish(id, doStream, errEvent(id, describe(e)));
                    }

                    @Override
                    public void onResponse(Call c, Response response) {
                        try (ResponseBody body = response.body()) {
                            int status = response.code();
                            if (!doStream) {
                                String text = body == null ? "" : body.string();
                                JSONObject r = new JSONObject();
                                r.put("ok", status >= 200 && status < 300);
                                r.put("status", status);
                                r.put("text", text);
                                js("__fetchResult", "\"" + id + "\"," + r.toString());
                            } else {
                                if (status < 200 || status >= 300) {
                                    String t = body == null ? "" : body.string();
                                    JSONObject ev = new JSONObject();
                                    ev.put("id", id);
                                    ev.put("type", "error");
                                    ev.put("status", status);
                                    ev.put("message", t.length() > 4000 ? t.substring(0, 4000) : t);
                                    emit("llm", ev);
                                } else {
                                    Utf8 utf8 = new Utf8();
                                    java.io.InputStream in = body == null ? null : body.byteStream();
                                    if (in != null) {
                                        byte[] buf = new byte[8192];
                                        int n;
                                        while ((n = in.read(buf)) > 0) {
                                            String chunk = utf8.decode(buf, n, false);
                                            if (!chunk.isEmpty()) {
                                                JSONObject ev = new JSONObject();
                                                ev.put("id", id);
                                                ev.put("type", "data");
                                                ev.put("text", chunk);
                                                emit("llm", ev);
                                            }
                                        }
                                    }
                                    String tail = utf8.decode(new byte[0], 0, true);
                                    if (!tail.isEmpty()) {
                                        JSONObject ev = new JSONObject();
                                        ev.put("id", id);
                                        ev.put("type", "data");
                                        ev.put("text", tail);
                                        emit("llm", ev);
                                    }
                                    JSONObject ev = new JSONObject();
                                    ev.put("id", id);
                                    ev.put("type", "end");
                                    emit("llm", ev);
                                }
                            }
                        } catch (Exception e) {
                            finish(id, doStream, errEvent(id, describe(e)));
                        } finally {
                            activeCalls.remove(id);
                        }
                    }
                });

                JSONObject r = new JSONObject();
                r.put("ok", true);
                r.put("id", id);
                return r.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }

        private void finish(String id, boolean stream, JSONObject ev) {
            if (stream) emit("llm", ev);
            else js("__fetchResult", "\"" + id + "\"," + ev.toString());
            activeCalls.remove(id);
        }

        private JSONObject errEvent(String id, String msg) {
            try {
                return new JSONObject().put("id", id).put("type", "error").put("status", 0).put("message", msg);
            } catch (Exception e) {
                return new JSONObject();
            }
        }

        private String describe(Throwable e) {
            String m = e.getMessage();
            if (m == null || m.isEmpty()) m = e.getClass().getSimpleName();
            return m;
        }

        @JavascriptInterface
        public String abort(String id) {
            Call c = activeCalls.remove(id);
            if (c != null) c.cancel();
            return "{\"ok\":true}";
        }

        /** Lokale Befehle/SSH gibt es auf Android nicht – die Web-App zeigt diese Meldung an. */
        @JavascriptInterface
        public String desktopOnly(String what) {            try {
                JSONObject o = new JSONObject();
                o.put("ok", false);
                o.put("result", "Auf Android gibt es keine lokale Befehlsausführung und kein SSH. "
                        + "Was funktioniert: alles über die HTTP-Schnittstelle des Servers (Modell starten/laden/entladen, Monitor, Chat).");
                o.put("unsupported", true);
                return o.toString();
            } catch (Exception e) {
                return errJson(e.getMessage());
            }
        }
    }

    /** UTF-8-Stromdekodierer: hält unvollständige Folgen über Chunk-Grenzen hinweg zusammen. */
    private static final class Utf8 {
        private java.nio.charset.CharsetDecoder dec = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .onUnmappableCharacter(CodingErrorAction.REPLACE);
        private byte[] pending = new byte[0];

        String decode(byte[] chunk, int len, boolean flush) {
            byte[] combined = new byte[pending.length + len];
            System.arraycopy(pending, 0, combined, 0, pending.length);
            System.arraycopy(chunk, 0, combined, pending.length, len);
            ByteBuffer in = ByteBuffer.wrap(combined);
            StringBuilder sb = new StringBuilder();
            CharBuffer out = CharBuffer.allocate(Math.max(1024, combined.length + 8));

            while (true) {
                CoderResult r = dec.decode(in, out, flush);
                if (r.isOverflow()) {
                    out.flip();
                    sb.append(out);
                    out.clear();
                    continue;
                }
                if (r.isUnderflow()) break;
                try {
                    r.throwException();
                } catch (CharacterCodingException e) {
                    break;
                }
            }
            out.flip();
            sb.append(out);
            out.clear();

            if (flush) {
                dec.flush(out);
                out.flip();
                sb.append(out);
                dec.reset();
                pending = new byte[0];
            } else {
                int rest = in.remaining();
                pending = new byte[rest];
                in.get(pending);
            }
            return sb.toString();
        }
    }
}
