'use strict';
/* Plattform-Klasse am <html>-Element, damit styles.css die Oberflaeche anpassen kann.
   Linux-Desktop: das Fenster hat die normale Titelleiste des Systems, die eigene Leiste (#titlebar) entfaellt.
   Android (WebView meldet ebenfalls "Linux") wird ausdruecklich ausgenommen. */
(function () {
  const ua = navigator.userAgent || '';
  const p = navigator.platform || '';
  if (/Android/i.test(ua)) { document.documentElement.classList.add('plat-android'); return; }
  if (/Linux|X11/i.test(p + ' ' + ua) && !/Win|Mac/i.test(p)) document.documentElement.classList.add('plat-linux');
  else if (/Mac/i.test(p)) document.documentElement.classList.add('plat-mac');
  else if (/Win/i.test(p)) document.documentElement.classList.add('plat-win');
})();
