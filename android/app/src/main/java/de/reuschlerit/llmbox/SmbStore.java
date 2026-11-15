package de.reuschlerit.llmbox;

import com.hierynomus.msdtyp.AccessMask;
import com.hierynomus.msfscc.FileAttributes;
import com.hierynomus.msfscc.fileinformation.FileIdBothDirectoryInformation;
import com.hierynomus.mssmb2.SMB2CreateDisposition;
import com.hierynomus.mssmb2.SMB2ShareAccess;
import com.hierynomus.smbj.SMBClient;
import com.hierynomus.smbj.SmbConfig;
import com.hierynomus.smbj.auth.AuthenticationContext;
import com.hierynomus.smbj.connection.Connection;
import com.hierynomus.smbj.session.Session;
import com.hierynomus.smbj.share.DiskShare;
import com.hierynomus.smbj.share.File;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Dateizugriff ueber SMB/CIFS (Windows-Freigaben).
 *
 * In der Web-Oberfläche bekommt ein SMB-Pfad das Praefix "/smb/", z. B.
 *   /smb/192.0.2.1.31/daten/MeinProjekt/LLM-Box
 * Uebersetzt wird das in \\192.0.2.1.31\daten\MeinProjekt\LLM-Box.
 * So koennen Workspace-Werkzeuge (list_files, read_file, edit_file ...) direkt
 * auf der Freigabe arbeiten, ohne dass etwas in den App-Speicher kopiert wird.
 */
final class SmbStore {

    static final String PREFIX = "/smb/";

    /**
     * Netzwerkordner werden in zwei Schreibweisen akzeptiert:
     *   /smb/192.0.2.10/daten/MeinProjekt        (intern, von der Oberfläche)
     *   \\192.0.2.10\daten\MeinProjekt           (Windows-UNC, wie man es gewohnt ist)
     */
    static boolean isSmb(String p) {
        if (p == null) return false;
        return p.startsWith(PREFIX) || p.startsWith("\\\\") || p.startsWith("//");
    }

    /** Wandelt jede erlaubte Schreibweise in /smb/rechner/freigabe/… um. */
    static String canonical(String p) {
        if (p == null) return "";
        String s = p.replace('\\', '/');
        if (s.startsWith(PREFIX)) return s;
        while (s.startsWith("//")) s = s.substring(1);          // UNC-Fuehrungsstriche
        return PREFIX + s;
    }

    /** Zerlegt einen Netzwerkpfad in {host, share, innerer Pfad}. share-Pfad bleibt leer, wenn nur host/share gegeben ist. */
    static String[] split(String p) {
        String rest = canonical(p).substring(PREFIX.length());
        String[] parts = rest.split("/");
        List<String> seg = new ArrayList<>();
        for (String s : parts) if (!s.isEmpty()) seg.add(s);
        if (seg.size() < 2) return null;
        String host = seg.get(0);
        String share = seg.get(1);
        StringBuilder inner = new StringBuilder();
        for (int i = 2; i < seg.size(); i++) {
            if (inner.length() > 0) inner.append('\\');
            inner.append(seg.get(i));
        }
        return new String[] { host, share, inner.toString() };
    }

    /** Share-interner Pfad in SMB-Schreibweise ('\\'), '.' und leer bedeuten Wurzel. */
    static String smbPath(String inner) {
        if (inner == null || inner.isEmpty() || inner.equals(".")) return "";
        String s = inner.replace('/', '\\');
        while (s.startsWith("\\")) s = s.substring(1);
        return s;
    }

    private static final EnumSet<AccessMask> READ = EnumSet.of(
            AccessMask.GENERIC_READ, AccessMask.FILE_READ_ATTRIBUTES, AccessMask.SYNCHRONIZE);
    private static final EnumSet<AccessMask> WRITE = EnumSet.of(
            AccessMask.GENERIC_WRITE, AccessMask.FILE_WRITE_DATA, AccessMask.FILE_APPEND_DATA,
            AccessMask.FILE_WRITE_ATTRIBUTES, AccessMask.SYNCHRONIZE);

    /** Eine offene Verbindung zu einem Rechner (wiederverwendet, damit nicht jeder Zugriff neu verbindet). */
    private static final class Conn {
        final String host, user, domain;
        SMBClient client;
        Connection connection;
        Session session;
        DiskShare share;
        String shareName;

        Conn(String host, String user, String domain) {
            this.host = host; this.user = user; this.domain = domain;
        }

        void close() {
            try { if (share != null) share.close(); } catch (Exception ignored) { }
            try { if (session != null) session.close(); } catch (Exception ignored) { }
            try { if (connection != null) connection.close(); } catch (Exception ignored) { }
            try { if (client != null) client.close(); } catch (Exception ignored) { }
            share = null; session = null; connection = null; client = null; shareName = null;
        }

        /* Wichtig: nicht nur die Verbindung pruefen, sondern auch den geoeffneten Share.
           Ein Synology/Windows schliesst einen freigegebenen Ordner nach kurzer Zeit, obwohl
           der TCP-Kanal stehen bleibt. Ohne diese Pruefung gab shareFor ein langes, aber
           bereits geschlossenes DiskShare zurueck - jeder Schreibzugriff endete dann mit
           "DiskShare has already been closed" und der Chat-Sync blieb stehen, obwohl das Netz
           in Ordnung war (gemessen am Gerat: setDir ok=false mit genau diesem Fehler). */
        boolean alive() {
            try {
                // Share fragt seinen eigenen Zustand ab (smbj 0.15: Share.isConnected()), die
                // Session ueber ihre Verbindung - ein eigenes isOpen() gibt es dort nicht.
                return connection != null && connection.isConnected()
                        && share != null && share.isConnected()
                        && session != null && session.getConnection() != null
                        && session.getConnection().isConnected();
            } catch (Exception e) { return false; }
        }

        synchronized DiskShare open(String shareWanted, String pass) throws Exception {
            if (alive() && shareName != null && shareName.equals(shareWanted)) return share;
            close();

            SmbConfig cfg = SmbConfig.builder()
                    // Die Zugriffe laufen inzwischen in einem eigenen Thread-Pool, die Oberfläche
                    // friert dadurch nicht mehr ein. Lange Timeouts wären trotzdem schlecht: sie
                    // halten einen Pool-Thread fest und der Nutzer wartet unnötig. Deshalb kurz
                    // gehalten – eine nicht erreichbare Freigabe meldet nach wenigen Sekunden Fehler.
                    .withTimeout(8, TimeUnit.SECONDS)
                    .withSoTimeout(15, TimeUnit.SECONDS)
                    .build();
            client = new SMBClient(cfg);
            connection = client.connect(host);

            AuthenticationContext ac;
            if (user == null || user.isEmpty()) ac = AuthenticationContext.anonymous();
            else ac = new AuthenticationContext(user, pass == null ? new char[0] : pass.toCharArray(), domain);

            session = connection.authenticate(ac);
            Object sh = session.connectShare(shareWanted);
            if (!(sh instanceof DiskShare)) throw new Exception("Freigabe '" + shareWanted + "' ist kein Ordner-Laufwerk");
            share = (DiskShare) sh;
            shareName = shareWanted;
            return share;
        }
    }

    private final java.util.Map<String, Conn> conns = new java.util.concurrent.ConcurrentHashMap<>();

    /** Zugangsdaten je Rechner. Kommen aus der App-Konfiguration (smb.json), nicht aus der Web-Seite. */
    static final class Creds {
        final String user, domain, pass;
        Creds(String user, String domain, String pass) {
            this.user = user == null ? "" : user;
            this.domain = domain == null ? "" : domain;
            this.pass = pass == null ? "" : pass;
        }
    }

    /** Liefert die Zugangsdaten fuer einen Rechner (leer = anonym). */
    private Creds credsFor(String host) { return credsLookup == null ? new Creds("", "", "") : credsLookup.get(host); }

    interface CredsLookup { Creds get(String host); }
    private CredsLookup credsLookup;

    void setCredsLookup(CredsLookup l) { this.credsLookup = l; }

    private DiskShare shareFor(String[] sp, boolean write) throws Exception {
        String host = sp[0], shareName = sp[1];
        String key = host + "|" + (credsFor(host).user) + "|" + credsFor(host).domain;
        Conn c = conns.get(key);
        if (c == null) {
            c = new Conn(host, credsFor(host).user, credsFor(host).domain);
            conns.put(key, c);
        }
        try {
            return c.open(shareName, credsFor(host).pass);
        } catch (Exception e) {
            // Einmal neu verbinden - haengende oder vom Server geschlossene Verbindungen sind der Regelfall.
            c.close();
            return c.open(shareName, credsFor(host).pass);
        }
    }

    void closeAll() {
        for (Conn c : conns.values()) c.close();
        conns.clear();
    }

    /** Verbindungstest: Host + Freigabe + Zugangsdaten prüfen und den Ordnerinhalt zählen. */
    public String test(String smbPath) {
        try {
            String[] sp = split(smbPath);
            if (sp == null) return "{\"ok\":false,\"error\":\"Pfadform \\\\Rechner\\Freigabe\\… erwartet\"}";
            DiskShare sh = shareFor(sp, false);

            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("host", sp[0]);
            o.put("share", sp[1]);
            try { o.put("volume", sh.getVolumeInfo().getVolumeLabel()); } catch (Exception ignored) { }

            // Der eigentliche Nachweis: der gewaehlte Unterordner ist lesbar und hat Inhalt.
            String inner = smbPath(sp[2]);
            if (!inner.isEmpty() && !sh.folderExists(inner)) {
                o.put("ok", false);
                o.put("error", "Freigabe erreichbar, aber der Ordner existiert nicht: " + sp[2].replace('\\', '/'));
                return o.toString();
            }
            JSONArray items = list(smbCanonical(sp));
            o.put("entries", items.length());
            StringBuilder sample = new StringBuilder();
            for (int i = 0; i < Math.min(items.length(), 5); i++) {
                if (i > 0) sample.append(", ");
                sample.append(items.getJSONObject(i).getString("name"));
            }
            o.put("sample", sample.toString());
            return o.toString();
        } catch (Exception e) {
            return err(e);
        }
    }

    private static String smbCanonical(String[] sp) {
        StringBuilder sb = new StringBuilder(PREFIX).append(sp[0]).append('/').append(sp[1]);
        if (!sp[2].isEmpty()) sb.append('/').append(sp[2].replace('\\', '/'));
        return sb.toString();
    }

    public JSONObject stat(String p) throws Exception {
        String[] sp = split(p);
        if (sp == null) throw new Exception("Pfadform /smb/Rechner/Freigabe/… erwartet");
        DiskShare sh = shareFor(sp, false);
        String inner = smbPath(sp[2]);

        JSONObject o = new JSONObject();
        if (inner.isEmpty()) {                       // Freigabe-Wurzel ist immer ein Ordner
            o.put("size", 0); o.put("mtimeMs", 0L); o.put("isDir", true);
            return o;
        }
        if (sh.folderExists(inner)) {
            o.put("size", 0); o.put("isDir", true);
            o.put("mtimeMs", timeOf(sh, inner));
            return o;
        }
        if (!sh.fileExists(inner)) throw new Exception("nicht gefunden: " + p);
        o.put("size", sh.getFileInformation(inner).getStandardInformation().getEndOfFile());
        o.put("isDir", false);
        o.put("mtimeMs", timeOf(sh, inner));
        return o;
    }

    private static long timeOf(DiskShare sh, String inner) {
        try {
            return sh.getFileInformation(inner, com.hierynomus.msfscc.fileinformation.FileBasicInformation.class)
                    .getLastWriteTime().toEpochMillis();
        } catch (Exception e) {
            return 0L;   // Zeit ist nur Statistik - ein Fehler hier darf den Lesezugriff nicht blockieren
        }
    }

    private static String parentOf(String inner) {
        int i = inner.lastIndexOf('\\');
        return i < 0 ? "" : inner.substring(0, i);
    }
    private static String nameOf(String inner) {
        int i = inner.lastIndexOf('\\');
        return i < 0 ? inner : inner.substring(i + 1);
    }

    public boolean exists(String p) throws Exception {
        try { stat(p); return true; } catch (Exception e) { return false; }
    }

    public byte[] readBytes(String p) throws Exception {
        String[] sp = split(p);
        DiskShare sh = shareFor(sp, false);
        String inner = smbPath(sp[2]);
        if (inner.isEmpty()) throw new Exception("keine Datei");
        try (File f = sh.openFile(inner, READ, EnumSet.noneOf(FileAttributes.class),
                SMB2ShareAccess.ALL, SMB2CreateDisposition.FILE_OPEN, null);
             InputStream in = f.getInputStream()) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        }
    }

    public void write(String p, byte[] data, boolean mkdirs) throws Exception {
        String[] sp = split(p);
        DiskShare sh = shareFor(sp, true);
        String inner = smbPath(sp[2]);
        if (inner.isEmpty()) throw new Exception("Zielpfad fehlt");

        if (mkdirs) {
            String parent = parentOf(inner);
            if (!parent.isEmpty() && !sh.folderExists(parent)) mkdirs(sh, parent);
        }
        try (File f = sh.openFile(inner, WRITE, EnumSet.noneOf(FileAttributes.class),
                SMB2ShareAccess.ALL, SMB2CreateDisposition.FILE_OVERWRITE_IF, null)) {
            long off = 0;
            int chunk = 1 << 20;
            for (int i = 0; i < data.length; i += chunk) {
                int len = Math.min(chunk, data.length - i);
                f.write(data, off, i, len);
                off += len;
            }
        }
    }

    private static void mkdirs(DiskShare sh, String inner) throws Exception {
        if (inner.isEmpty() || sh.folderExists(inner)) return;
        int i = inner.lastIndexOf('\\');
        if (i > 0) mkdirs(sh, inner.substring(0, i));
        try { sh.mkdir(inner); } catch (Exception e) { if (!sh.folderExists(inner)) throw e; }
    }

    public JSONArray list(String p) throws Exception {
        String[] sp = split(p);
        DiskShare sh = shareFor(sp, false);
        String inner = smbPath(sp[2]);
        List<FileIdBothDirectoryInformation> items = sh.list(inner.isEmpty() ? "" : inner, "*");

        JSONArray arr = new JSONArray();
        Set<String> seen = new HashSet<>();
        for (FileIdBothDirectoryInformation it : items) {
            String n = it.getFileName();
            if (n == null || n.equals(".") || n.equals("..")) continue;
            if (!seen.add(n.toLowerCase())) continue;      // doppelte Eintraege zusammenfassen
            boolean dir = (it.getFileAttributes() & FileAttributes.FILE_ATTRIBUTE_DIRECTORY.getValue()) != 0;
            JSONObject o = new JSONObject();
            o.put("name", n);
            o.put("isDir", dir);
            o.put("size", dir ? 0 : it.getEndOfFile());
            arr.put(o);
        }
        return arr;
    }

    public void mkdirs(String p) throws Exception {
        String[] sp = split(p);
        DiskShare sh = shareFor(sp, true);
        mkdirs(sh, smbPath(sp[2]));
    }

    public void remove(String p, boolean recursive) throws Exception {
        String[] sp = split(p);
        DiskShare sh = shareFor(sp, true);
        String inner = smbPath(sp[2]);
        if (inner.isEmpty()) throw new Exception("Wurzel der Freigabe darf nicht geloescht werden");
        if (sh.folderExists(inner)) {
            sh.rmdir(inner, recursive);
        } else {
            sh.rm(inner);
        }
    }

    /**
     * Datei umbenennen.
     *
     * Wichtig: smbj erwartet den Zielnamen share-relativ ("Ordner\Datei"), nicht als UNC-Pfad.
     * Mit "\\host\share\…" antwortet Windows je nach Server mit STATUS_INVALID_PARAMETER bzw.
     * STATUS_OBJECT_PATH_INVALID. Das war die Ursache dafuer, dass der Chat-Sync "0 Chats
     * kopiert" meldete: die Chat-Dateien kamen an, aber das Umbenennen der Meta-Datei
     * (schreiben als .tmp, dann umbenennen) schlug fehl - es blieben nur .tmp-Reste liegen.
     * Der share-relative Name ist hier durch die Java-Probe in thirdparty\SmbRenameProbe.java belegt.
     */
    public void rename(String from, String to) throws Exception {
        String[] a = split(from), b = split(to);
        if (!a[0].equals(b[0]) || !a[1].equals(b[1])) throw new Exception("Umbenennen nur innerhalb derselben Freigabe");
        DiskShare sh = shareFor(a, true);
        String src = smbPath(a[2]), dst = smbPath(b[2]);
        if (src.isEmpty() || dst.isEmpty()) throw new Exception("Quelle oder Ziel ist kein Dateipfad");

        EnumSet<AccessMask> del = EnumSet.of(
                AccessMask.DELETE, AccessMask.FILE_READ_ATTRIBUTES, AccessMask.SYNCHRONIZE);
        try (File f = sh.openFile(src, del, EnumSet.noneOf(FileAttributes.class),
                SMB2ShareAccess.ALL, SMB2CreateDisposition.FILE_OPEN, null)) {
            f.rename(dst, true);
        }
    }

    /**
     * Umbenennen mit Sicherung: klappt das Umbenennen nicht (aeltere Server, Sonderfaelle),
     * wird kopiert und die Quelle geloescht. Ein Fehlschlag darf nie eine .tmp-Datei hinterlassen,
     * weil die Chat-Sync-Oberflaeche diese Datei sonst nie zu Gesicht bekommt.
     */
    public void renameSafe(String from, String to) throws Exception {
        try {
            rename(from, to);
            return;
        } catch (Exception first) {
            try {
                byte[] data = readBytes(from);
                write(to, data, true);
                try { remove(from, false); } catch (Exception ignored) { }
                return;
            } catch (Exception second) {
                throw new Exception(first.getClass().getSimpleName() + ": " + first.getMessage());
            }
        }
    }

    /** Macht SMB-Fehlermeldungen lesbar; der Originalcode bleibt zur Fehlersuche erhalten. */
    private static String err(Exception e) {
        String m = e.getMessage();
        if (m == null || m.isEmpty()) m = e.getClass().getSimpleName();

        String hint;
        if (m.contains("STATUS_LOGON_FAILURE")) {
            hint = "Anmeldung abgelehnt. Diese Freigabe erlaubt keinen anonymen Zugriff – bitte "
                    + "Benutzernamen und Passwort des PCs/Servers eintragen.";
        } else if (m.contains("STATUS_ACCOUNT_DISABLED")) {
            hint = "Das Konto ist deaktiviert.";
        } else if (m.contains("STATUS_ACCESS_DENIED")) {
            hint = "Angemeldet, aber kein Recht auf diese Freigabe oder diesen Ordner.";
        } else if (m.contains("STATUS_BAD_NETWORK_NAME") || m.contains("STATUS_OBJECT_NAME_NOT_FOUND")) {
            hint = "Freigabe oder Ordner existiert nicht – Name in /smb/Rechner/FREIGABE/… prüfen.";
        } else if (m.contains("SocketTimeout") || m.contains("connect timed out") || m.contains("ETIMEDOUT")) {
            hint = "Zeitüberschreitung. Läuft der Rechner, und ist er im selben Netz wie das Handy?";
        } else if (m.contains("ECONNREFUSED") || m.contains("Connection refused")) {
            hint = "Verbindung abgelehnt – SMB (Port 445) ist auf dem Rechner deaktiviert.";
        } else if (m.contains("UnknownHost")) {
            hint = "Rechner nicht gefunden. Bitte IP-Adresse verwenden, z. B. /smb/192.0.2.10/daten";
        } else {
            hint = "";
        }

        String text = hint.isEmpty() ? m : hint + "  (" + m + ")";
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", text);
            return o.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"SMB-Fehler\"}";
        }
    }
}
