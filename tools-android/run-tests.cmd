@echo off
rem Fuhrt alle Pruefungen der Android-Portierung aus (ohne Gerat noetig).
cd /d "%~dp0\.."
echo === 1) Bridge-Vollstaendigkeit: deckt window.api alle api-Aufrufe der Oberflaeche ab? ===
node tools-android\check-api.js || exit /b 1
echo.
echo === 2) Portierte Kernschicht (Dateisystem, Werkzeuge, Kodierung, Dokumente, Netzwerk) ===
node tools-android\test-port.js || exit /b 1
echo.
echo === 3) Oberflaeche startet fehlerfrei in der WebView-Attrappe ===
node tools-android\test-ui-boot.js || exit /b 1
echo.
echo === 4) Kompletter Chat inkl. KI-Werkzeugen ueber die native Bruecke ===
node tools-android\test-chat-e2e.js || exit /b 1
echo.
echo === 5) PDF-Auslese (pdf.js ohne Worker-Datei, wie in der WebView) ===
node tools-android\test-pdf.js || exit /b 1
echo.
echo === 6) Neue Funktionen 1.0.44-1.0.50: gemeinsamer Chat-Ordner, Konflikte, Abbruch ===
node tools-android\test-sync.js || exit /b 1
echo.
echo === 7) Uebertragungsformat Windows &lt;-&gt; Android (zlib, SHA-256, QR-Stuecke, LAN-Weg) ===
node tools-android\test-transfer.js || exit /b 1
echo.
echo === 8) Abgleich-Timer: eine Kette, eingestellter Abstand (Windows und Android) ===
node tools-android\test-poll-schedule.js || exit /b 1
echo.
echo === 9) QR-Code mit der Handy-Kamera scannen (Decoder, Berechtigung, Scan-Schleife) ===
node tools-android\test-qr-scan.js || exit /b 1
echo.
echo === 10) Uebernahme- und Scan-Fehler vom 14.11. (Laufwerk Y, offener Dialog, ausgegrauter Knopf) ===
node tools-android\test-uebernahme-fixes.js || exit /b 1
echo.
echo === 11) Uebersetzung: Woerterbuch-Schluessel, Abdeckung und die 1.0.67-Fixes ===
node tools-android\test-i18n.js || exit /b 1
echo.
echo Alle Pruefungen bestanden.
