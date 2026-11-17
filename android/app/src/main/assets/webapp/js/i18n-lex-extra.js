'use strict';
/* Woerterbuch Teil 3: Uebertragung (transfer.js), Android-Adapter, Uebergabe
   (handoff.js), Unteragenten (subagents.js) und die Werkzeugbeschreibungen (llm.js). */

Object.assign(I18N_LEX, {

  /* ── transfer.js: Windows-Seite ── */
  'Keine Chats': ['No chats', 'Aucune discussion'],
  'Die letzten 3 Chats': ['The last 3 chats', 'Les 3 dernières discussions'],
  'Die letzten 10 Chats': ['The last 10 chats', 'Les 10 dernières discussions'],
  'Alle Chats': ['All chats', 'Toutes les discussions'],
  'Zu viele Daten für einen QR-Code': ['Too much data for a QR code', 'Trop de données pour un code QR'],
  'Einstellungen & API-Keys': ['Settings & API keys', 'Réglages et clés API'],
  'QR-Code für die Android-App': ['QR code for the Android app', 'Code QR pour l’application Android'],
  '(QR nicht möglich)': ['(QR not possible)', '(QR impossible)'],
  'In die Zwischenablage kopiert': ['Copied to the clipboard', 'Copié dans le presse-papiers'],
  'Übertragung im WLAN anbieten': ['Offer transfer over Wi-Fi', 'Proposer le transfert par Wi-Fi'],
  'Im WLAN anbieten (ein Code) …': ['Offer over Wi-Fi (one code) …', 'Proposer par Wi-Fi (un code) …'],
  'Im WLAN anbieten (empfohlen)': ['Offer over Wi-Fi (recommended)', 'Proposer par Wi-Fi (recommandé)'],
  'JSON exportieren …': ['Export JSON …', 'Exporter en JSON …'],
  'JSON exportieren (Fallback)': ['Export JSON (fallback)', 'Exporter en JSON (solution de repli)'],
  'Angebot fehlgeschlagen:': ['Offer failed:', 'Échec de l’offre :'],
  'Angebot im WLAN fehlgeschlagen:': ['Wi-Fi offer failed:', 'Échec de l’offre Wi-Fi :'],
  'QR-Code konnte nicht erzeugt werden:': ['The QR code could not be created:', 'Le code QR n’a pas pu être créé :'],

  /* ── transfer.js: Android-Seite ── */
  'Von der Windows-App übernehmen': ['Take over from the Windows app', 'Reprendre depuis l’application Windows'],
  'QR-Code der Windows-App scannen': ['Scan the QR code of the Windows app', 'Scanner le code QR de l’application Windows'],
  'Im WLAN suchen …': ['Search over Wi-Fi …', 'Rechercher par Wi-Fi …'],
  'Aus JSON-Datei importieren …': ['Import from JSON file …', 'Importer depuis un fichier JSON …'],
  'Als JSON exportieren …': ['Export as JSON …', 'Exporter en JSON …'],
  'Aus JSON-Datei importieren': ['Import from JSON file', 'Importer depuis un fichier JSON'],
  'Als JSON exportieren': ['Export as JSON', 'Exporter en JSON'],
  'Diese WebView stellt keine Kamera bereit.': ['This web view provides no camera.', 'Cette vue web ne fournit pas de caméra.'],
  'Kamera nicht verfuegbar:': ['Camera not available:', 'Caméra indisponible :'],
  'Abruf fehlgeschlagen:': ['Retrieval failed:', 'Échec de la récupération :'],
  'Abruf fehlgeschlagen': ['Retrieval failed', 'Échec de la récupération'],
  'Scannen fehlgeschlagen:': ['Scanning failed:', 'Échec du scan :'],
  'Keine Antwort': ['No answer', 'Aucune réponse'],
  'Keine antwortende LLM-Box im WLAN gefunden.': ['No responding LLM Box found on the Wi-Fi network.', 'Aucun LLM Box réactif trouvé sur le réseau Wi-Fi.'],
  'Rufe die Adresse ab …': ['Fetching the address …', 'Récupération de l’adresse …'],
  'Import fehlgeschlagen:': ['Import failed:', 'Échec de l’import :'],
  'Export fehlgeschlagen:': ['Export failed:', 'Échec de l’export :'],
  'Uebernahme fehlgeschlagen:': ['Takeover failed:', 'Échec de la reprise :'],
  'Fertig – Einstellungen und Chats wurden uebernommen.': ['Done – settings and chats were taken over.', 'Terminé – réglages et discussions ont été repris.'],
  'keine Datei gewaehlt': ['no file chosen', 'aucun fichier choisi'],
  'Datei konnte nicht gelesen werden:': ['The file could not be read:', 'Le fichier n’a pas pu être lu :'],
  'Workspace-Dateien': ['Workspace files', 'Fichiers de l’espace de travail'],

  /* ── handoff.js ── */
  'Übergabe wird erstellt …': ['Creating handover …', 'Création de la passation …'],
  'Übergabe eingefügt. Prüfe sie und sende mit Enter.': ['Handover inserted. Check it and press Enter to send.', 'Passation insérée. Vérifiez-la et envoyez avec Entrée.'],
  'Übergabe fehlgeschlagen:': ['Handover failed:', 'Échec de la passation :'],
  'Kontext leeren: Übergabe wird erstellt, der Chat bleibt (Umschalt+Klick: neue Session)': ['Clear context: a handover is created and the chat stays (Shift+click: new session)', 'Vider le contexte : une passation est créée, la discussion reste (Maj+clic : nouvelle session)'],
  'Neue Session mit Übergabe starten (Umschalt+Klick: Kontext leeren)': ['Start a new session with handover (Shift+click: clear context)', 'Démarrer une nouvelle session avec passation (Maj+clic : vider le contexte)'],
  'Kontext leeren und weiterarbeiten': ['Clear the context and continue', 'Vider le contexte et continuer'],
  'Neue Session mit Übergabe starten': ['Start a new session with handover', 'Démarrer une nouvelle session avec passation'],
  'Gleicher Chat: Der alte Verlauf bleibt sichtbar, die KI sieht nur noch die Übergabe.': ['Same chat: the old history stays visible, the AI only sees the handover.', 'Même discussion : l’ancien historique reste visible, l’IA ne voit que la passation.'],
  'Öffnet einen neuen Chat und übergibt Ziel, Stand und nächsten Schritt.': ['Opens a new chat and passes on goal, status and next step.', 'Ouvre une nouvelle discussion et transmet objectif, état et prochaine étape.'],
  'Später': ['Later', 'Plus tard'],
  'Übergabe ansehen': ['View handover', 'Voir la passation'],
  'Bereits geöffnet': ['Already open', 'Déjà ouverte'],
  'Das Modell hat keine Übergabe geliefert.': ['The model did not provide a handover.', 'Le modèle n’a pas fourni de passation.'],

  /* ── subagents.js ── */
  'läuft': ['running', 'en cours'],
  'Keine Unteragenten aufgezeichnet': ['No subagents recorded', 'Aucun sous-agent enregistré'],
  'Diesen Unteragenten abbrechen': ['Cancel this subagent', 'Annuler ce sous-agent'],

  /* ── livetools.js / thinktr.js – Schluessel aus thinktr.js:111-116 ── */
  'Dieses Programm beenden': ['Stop this program', 'Arrêter ce programme'],
  'Gedankengang': ['Reasoning', 'Raisonnement'],
  'Original (Englisch)': ['Original (English)', 'Original (anglais)'],
  'Ins Deutsche übersetzt': ['Translated into German', 'Traduit en allemand'],
  'Übersetzung anzeigen': ['Show translation', 'Afficher la traduction'],
  'Original anzeigen': ['Show original', 'Afficher l’original'],
  'Übersetze ins Deutsche …': ['Translating into German …', 'Traduction en allemand…'],
  'Übersetzung fehlgeschlagen:': ['Translation failed:', 'Échec de la traduction :'],

  /* ── llm.js: Werkzeugbeschreibungen (gegenueber dem Modell) ── */
  'Listet Dateien und Ordner eines Verzeichnisses im Workspace auf.': ['Lists the files and folders of a directory in the workspace.', 'Répertorie les fichiers et dossiers d’un répertoire de l’espace de travail.'],
  'Relativer Pfad, "." für den Workspace-Stamm': ['Relative path, "." for the workspace root', 'Chemin relatif, « . » pour la racine de l’espace de travail'],
  'Die Frage': ['The question', 'La question'],
  'Der vollständige Befehl': ['The full command', 'La commande complète'],
  'Standard: cmd': ['Default: cmd', 'Par défaut : cmd'],
  'Unterordner im Workspace als Arbeitsordner, optional': ['Subfolder in the workspace as working folder, optional', 'Sous-dossier de l’espace de travail comme dossier de travail, facultatif'],
  'Zeitlimit in Sekunden, optional': ['Time limit in seconds, optional', 'Limite de temps en secondes, facultative'],
  'Programmname ohne Endung, z. B. "apktool". Leer lassen für eine Übersicht.': ['Program name without extension, e.g. "apktool". Leave empty for an overview.', 'Nom du programme sans extension, p. ex. « apktool ». Laisser vide pour un aperçu.'],
  'Ein Satz: wofür das Programm gebraucht wird': ['One sentence: what the program is needed for', 'Une phrase : à quoi sert ce programme'],
  'Kurzer Titel (wenige Wörter)': ['Short title (a few words)', 'Titre court (quelques mots)'],
  'Vollständige, eigenständige Aufgabenbeschreibung inklusive gewünschter Ausgabe': ['Complete, self-contained task description including the desired output', 'Description de tâche complète et autonome, incluant la sortie souhaitée'],
  'Antwortvorschläge, kurz und konkret': ['Answer suggestions, short and concrete', 'Propositions de réponse, courtes et concrètes'],
  'true, wenn mehrere Vorschläge gleichzeitig gewählt werden dürfen': ['true if several suggestions may be selected at the same time', 'vrai si plusieurs propositions peuvent être choisies en même temps'],
  'Vollständiger neuer Dateiinhalt': ['Complete new file content', 'Contenu complet du nouveau fichier'],
  'Alle Vorkommen ersetzen (Standard: nur ein eindeutiges)': ['Replace all occurrences (default: only one unique match)', 'Remplacer toutes les occurrences (par défaut : une seule correspondance)'],
});

/* Dynamische Uebertragungstexte */
I18N_PAT.push(
  [/^Die gewählten Daten ergeben (.*?) QR-Bilder \((.*?) komprimiert\)\. Das ist zum Scannen zu viel\.$/, 'The selected data makes $1 QR images ($2 compressed). That is too many to scan.', 'Les données choisies donnent $1 images QR ($2 compressées). C’est trop pour un scan.'],
  [/^(\d+) Chat\(s\)$/, '$1 chat(s)', '$1 discussion(s)'],
  [/^· Zugangsdaten für (.*) gespeichert$/, '· credentials saved for $1', '· identifiants enregistrés pour $1']
);
