'use strict';
/* Woerterbuch Teil 4: Android-eigene Texte.
   Die Hinweiskaelte und Knopfe stammen aus tools-android\android-adapter.js und die
   Fehlermeldungen aus tools-android\native-main.js; beide werden spaeter in die
   Oberflaeche eingefuegt, also uebersetzt sie der MutationObserver - noetig sind nur
   die passenden Woerterbuch-Eintraege. */

Object.assign(I18N_LEX, {

  /* ── android-adapter.js: Kopfzeile und Werkzeuge ── */
  'Chats anzeigen oder verbergen': ['Show or hide the chats', 'Afficher ou masquer les discussions'],
  'Chatliste ein- oder ausblenden': ['Show or hide the chat list', 'Afficher ou masquer la liste des discussions'],
  'Dateizugriff der KI an/aus. Programme ausführen gibt es auf Android nicht.': ['AI file access on/off. Running programs does not exist on Android.', 'Accès fichiers de l’IA activé/désactivé. L’exécution de programmes n’existe pas sur Android.'],
  'Denkaufwand des Modells wählen': ['Choose the model’s reasoning effort', 'Choisir l’effort de réflexion du modèle'],

  /* ── android-adapter.js: Workspace und Netzwerk ── */
  'Auf Android: Tippe „Ordner wählen“. Die LLM Box kopiert den Ordner in ihren App-Speicher; von dort liest und schreibt die KI.': ['On Android: tap “Choose folder”. LLM Box copies the folder into its app storage; the AI reads and writes from there.', 'Sur Android : touchez « Choisir un dossier ». LLM Box copie le dossier dans son stockage applicatif ; l’IA y lit et y écrit.'],
  '– Ordner ist leer': ['– folder is empty', '– le dossier est vide'],
  'Ein Passwort ist auf diesem Handy hinterlegt. Leer lassen behaelt es; nur zum Aendern neu tippen.': ['A password is stored on this phone. Leave it empty to keep it; type a new one only to change it.', 'Un mot de passe est enregistré sur ce téléphone. Laissez vide pour le conserver ; ne le ressaisissez que pour le modifier.'],
  'Windows-Freigabe im LAN direkt als Workspace nutzen – es wird nichts auf das Handy kopiert.': ['Use a Windows share on the LAN directly as workspace – nothing is copied to the phone.', 'Utilisez directement un partage Windows du LAN comme espace de travail – rien n’est copié sur le téléphone.'],
  'Die meisten Server erlauben keinen anonymen Zugriff: bitte Benutzername und Passwort eintragen.': ['Most servers do not allow anonymous access: please enter user name and password.', 'La plupart des serveurs refusent l’accès anonyme : veuillez saisir un nom d’utilisateur et un mot de passe.'],
  'Verbindung wird geprüft …': ['Checking connection …', 'Vérification de la connexion …'],
  'nicht erreichbar': ['not reachable', 'injoignable'],
  'Freigabe nicht erreichbar – Details stehen über dem Feld': ['Share not reachable – details are shown above the field', 'Partage injoignable – les détails s’affichent au-dessus du champ'],
  '– als Workspace übernommen.': ['– taken over as workspace.', '– repris comme espace de travail.'],
  'Netzwerkordner als Workspace gesetzt': ['Network folder set as workspace', 'Dossier réseau défini comme espace de travail'],
  'Nur Verbindung testen': ['Test connection only', 'Tester seulement la connexion'],
  'Prüfe Verbindung …': ['Checking connection …', 'Vérification de la connexion …'],
  '✓ ist als Workspace aktiv.': ['✓ is active as workspace.', '✓ actif comme espace de travail.'],
  '(noch nicht als Workspace gesetzt)': ['(not yet set as workspace)', '(pas encore défini comme espace de travail)'],
  'Netzwerk lösen': ['Disconnect network', 'Déconnecter le réseau'],
  'Netzwerkordner entfernt. Nutze wieder „Wählen …“ für einen Ordner auf dem Handy.': ['Network folder removed. Use “Choose …” again for a folder on the phone.', 'Dossier réseau retiré. Utilisez de nouveau « Choisir … » pour un dossier du téléphone.'],
  'Prüfe gespeicherten Netzwerkordner …': ['Checking saved network folder …', 'Vérification du dossier réseau enregistré …'],
  'Gespeicherter Ordner nicht erreichbar:': ['Saved folder not reachable:', 'Dossier enregistré injoignable :'],

  /* Der Hinweis des SMB-Felds (android-adapter.js) ist durch <code>-Elemente zerschnitten,
     der MutationObserver sieht also zwei getrennte Textknoten. Deshalb sind beide Teile
     als eigene Schlussel eingetragen – der Punkt am Ende bleibt im DOM stehen. */
  'Windows-Freigabe im LAN, direkt gelesen und beschrieben': ['Use a Windows share on the LAN, read from and written to directly', 'Partage Windows du LAN, lecture et écriture directes'],
  'Pfad wahlweise als': ['Path either as', 'Chemin au choix sous la forme'],

  /* ── android-adapter.js: Chat-Ordner auf Netzlaufwerk ── */
  'Ordner auf dem Handy …': ['Folder on this phone …', 'Dossier sur ce téléphone …'],
  'Kopiert den gewaehlten Ordner in den App-Speicher dieses Handys. Nichts wird mit anderen Geraeten geteilt – dafuer unten die Windows-Freigabe nutzen.': ['Copies the chosen folder into this phone’s app storage. Nothing is shared with other devices – use the Windows share below for that.', 'Copie le dossier choisi dans le stockage applicatif de ce téléphone. Rien n’est partagé avec d’autres appareils – utilisez pour cela le partage Windows ci-dessous.'],
  'Windows-Freigabe im LAN als gemeinsamer Chat-Ordner. Die App legt dort den Unterordner „LLM-Box-Chats“ an und liest/schreibt direkt – es wird nichts auf das Handy kopiert.': ['Use a Windows share on the LAN as shared chat folder. The app creates the subfolder “LLM-Box-Chats” there and reads/writes directly – nothing is copied to the phone.', 'Utilisez un partage Windows du LAN comme dossier de discussions partagé. L’application y crée le sous-dossier « LLM-Box-Chats » et lit/écrit directement – rien n’est copié sur le téléphone.'],
  'Ordner wird angelegt und gesetzt …': ['Creating and setting the folder …', 'Création et définition du dossier …'],
  'Freigabe erreichbar, aber nicht beschreibbar:': ['Share reachable but not writable:', 'Partage joignable mais non inscriptible :'],
  '– Chats liegen jetzt dort.': ['– chats are now stored there.', '– les discussions y sont désormais stockées.'],
  'Gemeinsamer Chat-Ordner gesetzt': ['Shared chat folder set', 'Dossier de discussions partagé défini'],
  'Sollen die Chats, die bisher nur auf diesem Handy liegen, in den gemeinsamen Ordner kopiert werden? Vorhandene Chats werden nicht überschrieben.': ['Should the chats that so far exist only on this phone be copied into the shared folder? Existing chats are not overwritten.', 'Les discussions qui ne se trouvent que sur ce téléphone doivent-elles être copiées dans le dossier partagé ? Les discussions existantes ne sont pas écrasées.'],
  'Kopieren fehlgeschlagen': ['Copying failed', 'Échec de la copie'],
  'Freigabe verbinden & übernehmen': ['Connect share and apply', 'Connecter le partage et appliquer'],
  '✓ ist als Chat-Ordner aktiv.': ['✓ is active as chat folder.', '✓ actif comme dossier de discussions.'],
  '(noch nicht als Chat-Ordner gesetzt)': ['(not yet set as chat folder)', '(pas encore défini comme dossier de discussions)'],
  'Wie Workspace-Ordner': ['Same as workspace folder', 'Identique au dossier de l’espace de travail'],
  'Prüfe gespeicherten Chat-Ordner …': ['Checking saved chat folder …', 'Vérification du dossier de discussions enregistré …'],

  /* ── android-adapter.js: Server-Fenster und Hinweise ── */
  'Hinweis: Auf Android läuft alles über die HTTP-Schnittstelle des Servers. Modell starten/entladen, Monitor und Chat funktionieren; die Strata-CLI auf diesem Gerät gibt es auf Android nicht.': ['Note: on Android everything runs through the server’s HTTP interface. Starting/unloading the model, monitor and chat work; the Strata CLI is not available on Android.', 'Remarque : sur Android tout passe par l’interface HTTP du serveur. Démarrage/déchargement du modèle, moniteur et discussion fonctionnent ; la CLI Strata n’existe pas sur Android.'],
  'Hinweis: Modell starten und entladen läuft auf Android über die HTTP-Schnittstelle des Servers (Knöpfe oben im Server-Fenster). Die Strata-Befehle der Desktop-Version gibt es hier nicht.': ['Note: starting and unloading the model runs on Android through the server’s HTTP interface (buttons at the top of the server window). The desktop Strata commands are not available here.', 'Remarque : le démarrage et le déchargement du modèle passent sur Android par l’interface HTTP du serveur (boutons en haut de la fenêtre serveur). Les commandes Strata de la version bureau ne sont pas disponibles ici.'],
  'Starte die App neu, wähle einmal eine andere Verbindung bzw. ein anderes Modell, oder schliesse diese Einstellungen und öffne sie erneut – jedes davon lädt die Modellliste neu.': ['Restart the app, switch connection or model once, or close and reopen these settings – each of these reloads the model list.', 'Redémarrez l’application, changez une fois de connexion ou de modèle, ou fermez et rouvrez ces réglages – chacune de ces actions recharge la liste des modèles.'],

  /* ── native-main.js: Fehlermeldungen der Bruecke ── */
  'Kein Workspace-Ordner gewählt': ['No workspace folder chosen', 'Aucun dossier d’espace de travail choisi'],
  'Pfad liegt außerhalb des Workspace': ['Path is outside the workspace', 'Le chemin est hors de l’espace de travail'],
  'Zeitüberschreitung': ['Timeout', 'Délai dépassé'],
  'Es ist kein gemeinsamer Ordner gewählt.': ['No shared folder has been chosen.', 'Aucun dossier partagé n’a été choisi.'],
  'Der Ordner ist nicht beschreibbar:': ['The folder is not writable:', 'Le dossier n’est pas inscriptible :'],
  'Kein Rechner angegeben': ['No computer given', 'Aucun ordinateur indiqué'],
  /* Grenzen so uebernommen, wie native-main.js sie wirklich meldet (Zeile 240 und 262) */
  'Datei ist größer als 200 MB.': ['The file is larger than 200 MB.', 'Le fichier dépasse 200 Mo.'],
  'Bild größer als 20 MB': ['Image larger than 20 MB', 'Image de plus de 20 Mo'],
});
