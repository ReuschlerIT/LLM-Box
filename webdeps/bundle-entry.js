// Browser-Bundle für die Android-WebView: stellt die Node-Bibliotheken bereit,
// die docs.js (und die portierte main.js-Logik) über require() erwartet.
globalThis.Buffer = require('buffer').Buffer;
globalThis.JSZip = require('jszip');
const fxp = require('fast-xml-parser');
globalThis.FXP = { XMLParser: fxp.XMLParser, XMLValidator: fxp.XMLValidator };
globalThis.PDFJS = require('pdfjs-dist/legacy/build/pdf.js');

/* QR-Decoder fuer die Android-App: die App zeigt selbst QR-Codes an, konnte sie aber nie
   einlesen (kein eingebauter Decoder, Kommentar in transfer.js). jsQR liefert eine Bild-
   Erkennung ohne native Kamera-Bibliothek – die WebView liefert die Pixel per getUserMedia. */
globalThis.jsQR = require('jsqr').default || require('jsqr');
