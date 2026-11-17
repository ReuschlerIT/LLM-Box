'use strict';
/* Woerterbuch Teil 6: Einstellung "Arbeitskontext-Obergrenze" (V64). */

Object.assign(I18N_LEX, {
  'Arbeitskontext-Obergrenze (Tokens)': ['Working context limit (tokens)', 'Limite de contexte de travail (jetons)'],
  'Obergrenze für Komprimierung und Übergabe-Hinweis, unabhängig vom Server-Fenster. Lokale Modelle, besonders stark quantisierte (z. B. IQ3), werden schon weit unter ihrem Fenster unzuverlässig: Sie kündigen Schritte an, ohne Werkzeuge aufzurufen, und erfinden Details. Standard 64000. 0 = nur das Server-Fenster zählt.': [
    'Upper limit for compaction and the handover hint, independent of the server window. Local models, especially heavily quantized ones (e.g. IQ3), become unreliable far below their window: they announce steps without calling tools and invent details. Default 64000. 0 = only the server window counts.',
    'Limite pour la compression et l’indication de passation, indépendamment de la fenêtre du serveur. Les modèles locaux, surtout très quantifiés (p. ex. IQ3), deviennent peu fiables bien en dessous de leur fenêtre : ils annoncent des étapes sans appeler d’outils et inventent des détails. Par défaut 64000. 0 = seule la fenêtre du serveur compte.'
  ],
});
