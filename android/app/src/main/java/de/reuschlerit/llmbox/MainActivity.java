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


    /**
     * Echte Chat-Nachrichten verschickt die Sonde nur mit einem zweiten, ausdruecklichen
     * Schalter:  adb shell am start -n de.reuschlerit.llmbox/.MainActivity \
     *              --ez probe true --ez probechat true
     * Ohne diesen Schalter bleiben die Chats des Nutzers unangetastet.
     */


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










            }
        });

        web.loadUrl(START_URL);
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
