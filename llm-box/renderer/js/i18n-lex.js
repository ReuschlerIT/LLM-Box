'use strict';
/* Woerterbuch Teil 1: Grundflaeche, Chatfenster, Dialoge
   Schluessel = exakter deutscher Text aus index.html, app.js, util.js.
   Wert = [englisch, franzoesisch]. Erzeugt mit tools-android\i18n-extrakt.js,
   damit jeder Schluessel wirklich im Quelltext vorkommt. */

Object.assign(I18N_LEX, {

  /* ── index.html: Kopf, Leisten, Knopfoberflaechen ── */
  'Chats durchsuchen': ['Search chats', 'Rechercher dans les discussions'],
  'Chats importieren (z. B. aus der Strata-Weboberfläche)': ['Import chats (e.g. from the Strata web interface)', 'Importer des discussions (p. ex. depuis l’interface web Strata)'],
  'Einstellungen (Strg+,)': ['Settings (Ctrl+,)', 'Réglages (Ctrl+,)'],
  'Verbindungsstatus': ['Connection status', 'État de la connexion'],
  'Verbindung': ['Connection', 'Connexion'],
  'Modell': ['Model', 'Modèle'],
  'Modelle neu laden': ['Reload models', 'Recharger les modèles'],
  'Unteragenten: wer arbeitet woran': ['Subagents: who is working on what', 'Sous-agents : qui travaille sur quoi'],
  'Server & Monitor: Modell starten, laden, überwachen': ['Server & monitor: start, load and watch the model', 'Serveur & moniteur : démarrer, charger, surveiller le modèle'],
  'Monitor unter dem Workspace-Panel ein- oder ausblenden': ['Show or hide the monitor below the workspace panel', 'Afficher ou masquer le moniteur sous le panneau de l’espace de travail'],
  'Kontextfenster': ['Context window', 'Fenêtre de contexte'],
  'Kontext leeren (Übergabe bleibt erhalten)': ['Clear context (handover is kept)', 'Vider le contexte (la passation est conservée)'],
  'Chat exportieren': ['Export chat', 'Exporter la discussion'],
  'Workspace-Panel': ['Workspace panel', 'Panneau de l’espace de travail'],
  'Nach unten': ['Scroll down', 'Vers le bas'],
  'Chats': ['Chats', 'Discussions'],
  'Neuer Chat': ['New chat', 'Nouvelle discussion'],
  /* Im HTML stehen zwei Leerzeichen vor der Klammer - Schluessel muss exakt passen. */
  'Nachricht schreiben …  (Dateien per Drag & Drop oder Strg+V)': ['Write a message …  (drag & drop files or press Ctrl+V)', 'Écrire un message …  (glisser-déposer des fichiers ou Ctrl+V)'],
  'Dateien anhängen': ['Attach files', 'Joindre des fichiers'],
  'Ordner anhängen': ['Attach folder', 'Joindre un dossier'],
  'KI darf Dateien im Workspace lesen und schreiben': ['AI may read and write files in the workspace', 'L’IA peut lire et écrire des fichiers dans l’espace de travail'],
  'Freigaben für diesen Chat': ['Approvals for this chat', 'Autorisations pour cette discussion'],
  'Pausieren': ['Pause', 'Mettre en pause'],
  'Senden': ['Send', 'Envoyer'],

  /* ── util.js: Dialog-Grundknöpfe ── */
  'Schließen': ['Close', 'Fermer'],
  'Abbrechen': ['Cancel', 'Annuler'],
  'OK': ['OK', 'OK'],

  /* ── app.js: Start, Verbindungen, Chatliste ── */
  'Dieser Rechner': ['This computer', 'Cet ordinateur'],
  'Keine Verbindung': ['No connection', 'Aucune connexion'],
  'Lege zuerst eine Verbindung zu deinem KI-Server an.': ['Set up a connection to your AI server first.', 'Commencez par configurer une connexion vers votre serveur IA.'],
  'Gründlich – dauert länger': ['Thorough – takes longer', 'Approfondi – plus long'],
  'Fenstermaterial wird von diesem System nicht unterstützt (Windows 11 22H2 oder neuer nötig).': ['This system does not support window material (Windows 11 22H2 or newer required).', 'Ce système ne prend pas en charge l’effet de matière de la fenêtre (Windows 11 22H2 ou plus récent requis).'],
  'Keine Modelle gefunden': ['No models found', 'Aucun modèle trouvé'],
  'Modell manuell eingeben …': ['Enter a model name manually …', 'Saisir un modèle manuellement …'],
  'Modell geladen': ['Model loaded', 'Modèle chargé'],
  'Modell entladen': ['Model unloaded', 'Modèle déchargé'],
  'Keine Verbindung eingerichtet': ['No connection set up', 'Aucune connexion configurée'],
  'Keine Treffer': ['No matches', 'Aucun résultat'],
  'Noch keine Chats': ['No chats yet', 'Aucune discussion pour l’instant'],
  'Älter': ['Older', 'Plus ancien'],
  'Aus der Strata-Weboberfläche importiert': ['Imported from the Strata web interface', 'Importé depuis l’interface web Strata'],
  'Wartet auf deine Antwort oder Freigabe': ['Waiting for your answer or approval', 'En attente de votre réponse ou autorisation'],
  'Die KI arbeitet hier gerade': ['The AI is working here right now', 'L’IA travaille ici actuellement'],
  'Löschen': ['Delete', 'Supprimer'],
  'Umbenennen': ['Rename', 'Renommer'],
  'Chat umbenennen': ['Rename chat', 'Renommer la discussion'],
  'Chat löschen': ['Delete chat', 'Supprimer la discussion'],
  'Bitte erst die Antwort stoppen.': ['Stop the answer first.', 'Arrêtez d’abord la réponse.'],
  'Chat konnte nicht gespeichert werden:': ['The chat could not be saved:', 'Impossible d’enregistrer la discussion :'],
  'Chat wurde auf einem anderen Rechner aktualisiert.': ['The chat was updated on another computer.', 'La discussion a été mise à jour sur un autre ordinateur.'],
  'Verbindung einrichten': ['Set up connection', 'Configurer une connexion'],

  /* ── app.js: Statuszeile und Kontext (Fragmente, weil HTML-Knoten) ── */
  'Chat:': ['Conversation:', 'Conversation :'],
  'Dauer:': ['Duration:', 'Durée :'],
  'Kosten': ['Cost', 'Coût'],
  'Tokens': ['tokens', 'jetons'],
  'Tokens/s': ['tok/s', 'tok/s'],
  'Modell:': ['Model:', 'Modèle :'],
  'Kein Modell gewählt': ['No model selected', 'Aucun modèle sélectionné'],
  'Läuft – Werte aktualisieren sich live': ['Running – values update live', 'En cours – les valeurs s’actualisent en direct'],

  /* ── app.js: Nachrichten, Werkzeuge, Übergaben ── */
  'ältere anzeigen': ['show older', 'afficher les plus anciennes'],
  'Kontext geleert – ab hier sieht die KI nur die Übergabe und was danach kommt': ['Context cleared – from here the AI only sees the handover and what follows', 'Contexte vidé – à partir d’ici l’IA ne voit que la passation et ce qui suit'],
  'Die KI hat nach dem Werkzeug-Ergebnis nicht weitergearbeitet.': ['The AI did not continue after the tool result.', 'L’IA n’a pas poursuivi après le résultat de l’outil.'],
  'Bearbeiten und neu senden': ['Edit and send again', 'Modifier et renvoyer'],
  'Antwort kopieren': ['Copy answer', 'Copier la réponse'],
  'Kopieren': ['Copy', 'Copier'],
  'Speichern': ['Save', 'Enregistrer'],
  'Als Datei speichern': ['Save as file', 'Enregistrer comme fichier'],
  'Gespeichert:': ['Saved:', 'Enregistré :'],
  'Vom Modell erzeugtes Bild': ['Image generated by the model', 'Image générée par le modèle'],
  'Klicken zum Vergrößern': ['Click to enlarge', 'Cliquer pour agrandir'],
  'Bild als Datei speichern': ['Save image as file', 'Enregistrer l’image comme fichier'],
  'Als Anhang an die nächste Nachricht hängen': ['Attach to the next message', 'Joindre au prochain message'],
  '(geschätzt – der Server liefert keine Token-Zahlen)': ['(estimated – the server provides no token counts)', '(estimé – le serveur ne fournit pas de nombre de jetons)'],
  'Kontext verschlankt': ['Context slimmed', 'Contexte allégé'],
  'Übergabe nach „Kontext leeren“': ['Handover after “Clear context”', 'Passation après « Vider le contexte »'],
  'Übergabe aus der vorherigen Sitzung': ['Handover from the previous session', 'Passation de la session précédente'],

  /* ── app.js: Statistik unter Antworten ── */
  'Antwort des Servers (Verbrauch und Zeiten, soweit er sie liefert):': ['Server answer (usage and timings, as far as it reports them):', 'Réponse du serveur (consommation et durées, selon ce qu’il fournit) :'],
  '(nicht gespeichert, nur bei neuen Antworten)': ['(not stored, only for new answers)', '(non enregistré, uniquement pour les nouvelles réponses)'],
  'Gemessen in der App vom ersten Token bis zum Ende der Antwort.': ['Measured in the app from the first token to the end of the answer.', 'Mesuré dans l’application du premier jeton jusqu’à la fin de la réponse.'],
  'Tokens im Prompt (System, Verlauf, Anhänge)': ['Tokens in the prompt (system, history, attachments)', 'Jetons dans le prompt (système, historique, pièces jointes)'],
  'Zeit bis zum ersten Token': ['Time to first token', 'Délai jusqu’au premier jeton'],
  'bis erstes Token': ['to first token', 'jusqu’au premier jeton'],
  'Gesamtdauer der Anfrage': ['Total request duration', 'Durée totale de la requête'],

  /* ── app.js: Pause, Warteschlange ── */
  'Pausiert. Mit „Fortsetzen“ macht die KI an derselben Stelle weiter.': ['Paused. “Resume” lets the AI continue at the same point.', 'En pause. « Reprendre » fait continuer l’IA au même endroit.'],
  'Pause wird wirksam, sobald der laufende Schritt (Programm oder Unteragent) fertig ist …': ['The pause takes effect as soon as the current step (program or subagent) finishes …', 'La pause prend effet dès que l’étape en cours (programme ou sous-agent) est terminée …'],
  'Fortsetzen: die KI macht an derselben Stelle weiter': ['Resume: the AI continues at the same point', 'Reprendre : l’IA continue au même endroit'],
  'Pausieren: die KI hält an und wartet': ['Pause: the AI stops and waits', 'Mettre en pause : l’IA s’arrête et attend'],
  'Fortsetzen': ['Resume', 'Reprendre'],
  /* Die beiden alten Schluessel zum Vormerken ("wird gesendet, sobald die KI fertig ist"
     und "Vormerken – …") standen nur noch hier, im Quelltext gab es sie nicht mehr - der
     Hinweis-Mechanismus (inbox, "wird nach dem aktuellen Schritt zugestellt", "Jetzt")
     uebersetzt heute in i18n-lex-settings.js. "Zurück ins Eingabefeld holen" bleibt. */
  'Zurück ins Eingabefeld holen': ['Back to the input field', 'Ramener dans le champ de saisie'],

  /* ── app.js: Freigaben und Rückfragen ── */
  'Rückfrage': ['Question', 'Question'],
  'Rückfragen': ['questions', 'questions'],
  'eine Rückfrage': ['one question', 'une question'],
  'Überspringen': ['Skip', 'Passer'],
  'Die KI trifft dann eigene Annahmen': ['The AI will then make its own assumptions', 'L’IA fera alors ses propres hypothèses'],
  'LLM Box – Rückfrage': ['LLM Box – question', 'LLM Box – question'],
  'Rückfrage der KI': ['Question from the AI', 'Question de l’IA'],
  'Freigabe erforderlich': ['Approval required', 'Autorisation requise'],
  'Die KI möchte ein Werkzeug nutzen': ['The AI wants to use a tool', 'L’IA souhaite utiliser un outil'],
  'Änderung ansehen': ['View change', 'Voir la modification'],
  'Immer in diesem Chat erlauben': ['Always allow in this chat', 'Toujours autoriser dans cette discussion'],
  'Freigabe in diesem Chat': ['Approval in this chat', 'Autorisation dans cette discussion'],
  'Standard aus Einstellungen': ['Default from settings', 'Valeur par défaut des réglages'],
  'Alles bestätigen': ['Approve everything', 'Tout approuver'],
  'Jedes Werkzeug und jeder Befehl fragt nach': ['Every tool and command asks first', 'Chaque outil et commande demande d’abord'],
  'Nur Schreiben und Befehle bestätigen': ['Confirm only writing and commands', 'Confirmer seulement écriture et commandes'],
  'Nur Schreiben bestätigen': ['Confirm writing only', 'Confirmer seulement l’écriture'],
  'Lesen läuft automatisch': ['Reading runs automatically', 'La lecture se fait automatiquement'],
  'Nichts bestätigen': ['No confirmation', 'Aucune confirmation'],
  'Datei-Werkzeuge und Befehle laufen ohne Rückfrage': ['File tools and commands run without asking', 'Outils de fichiers et commandes s’exécutent sans demander'],
  'Befehle und Programme': ['Commands and programs', 'Commandes et programmes'],
  'Alle Befehle in diesem Chat erlauben': ['Allow all commands in this chat', 'Autoriser toutes les commandes dans cette discussion'],

  /* ── app.js: Werkzeug-Namen (TOOL_LABEL) ── */
  'Unteragent starten': ['Start subagent', 'Démarrer un sous-agent'],
  'Ordner auflisten': ['List folder', 'Lister le dossier'],
  'Datei lesen': ['Read file', 'Lire un fichier'],
  'Datei schreiben': ['Write file', 'Écrire un fichier'],
  'Datei ändern': ['Edit file', 'Modifier un fichier'],
  'Text suchen': ['Search text', 'Rechercher du texte'],
  'Programm ausführen': ['Run program', 'Exécuter un programme'],
  'Tool suchen': ['Check tool', 'Vérifier un outil'],

  /* ── app.js: Workspace-Panel, Anhänge ── */
  'Wähle zuerst einen Workspace-Ordner.': ['Choose a workspace folder first.', 'Choisissez d’abord un dossier d’espace de travail.'],
  'KI darf den Workspace lesen und schreiben.': ['The AI may read and write in the workspace.', 'L’IA peut lire et écrire dans l’espace de travail.'],
  'Workspace-Ordner wählen': ['Choose workspace folder', 'Choisir le dossier de l’espace de travail'],
  'Ordner wählen': ['Choose folder', 'Choisir un dossier'],
  'Wähle einen Projektordner. Klicke Dateien an, um sie an die Nachricht zu hängen, oder erlaube der KI den Zugriff.': ['Pick a project folder. Click files to attach them to a message, or grant the AI access.', 'Choisissez un dossier de projet. Cliquez sur des fichiers pour les joindre à un message, ou autorisez l’accès à l’IA.'],
  'Wann die KI in diesem Chat nachfragen muss. Hier live umstellbar.': ['When the AI has to ask in this chat. Changeable here at any time.', 'Quand l’IA doit demander dans cette discussion. Modifiable ici en direct.'],
  'Wann die KI vor einem Werkzeug nachfragen muss': ['When the AI must ask before using a tool', 'Quand l’IA doit demander avant un outil'],
  'Ordner nicht lesbar:': ['Folder not readable:', 'Dossier illisible :'],
  'Der Ordner ist leer.': ['The folder is empty.', 'Le dossier est vide.'],
  'Ganzen Ordner anhängen': ['Attach whole folder', 'Joindre tout le dossier'],
  'Anhängen': ['Attach', 'Joindre'],
  'Workspace wählen': ['Choose workspace', 'Choisir l’espace de travail'],
  'Dieser Chat ist noch leer.': ['This chat is still empty.', 'Cette discussion est encore vide.'],
  'Modell eingeben': ['Enter model', 'Saisir un modèle'],

  /* ── app.js: Fehler- und Hinweistexte ── */
  'Bitte zuerst ein Modell wählen.': ['Please select a model first.', 'Veuillez d’abord sélectionner un modèle.'],
  'Unerwarteter Fehler:': ['Unexpected error:', 'Erreur inattendue :'],
  'Fehler:': ['Error:', 'Erreur :'],
  'Der Parameter command fehlt.': ['The parameter command is missing.', 'Le paramètre command est manquant.'],
  'In welchem Format soll der Chat gespeichert werden?': ['In which format should the chat be saved?', 'Dans quel format enregistrer la discussion ?'],
});

/* Texte mit eingebetteten Werten: [Regex, englisch, franzoesisch]. $1..$9 = Gruppen. */
I18N_PAT.push(
  [/^Noch (\d+) Chats?$/, 'Still $1 chats', 'Encore $1 discussions'],
  [/^(\d+) Datei\(en\)$/, '$1 file(s)', '$1 fichier(s)'],
  [/^\‹ (\d+) ältere anzeigen$/, '‹ show $1 older', '‹ afficher $1 plus anciennes'],
  [/^(\d+) ältere Nachrichten sind ausgeblendet\.$/, '$1 older messages are hidden.', '$1 messages plus anciens sont masqués.'],
  [/^Verbunden – (\d+) Modelle? gefunden\.$/, 'Connected – found $1 model(s).', 'Connecté – $1 modèle(s) trouvé(s).'],
  [/^\[\.\.\. gekürzt, (\d+) Zeichen\]$/, '[… truncated, $1 characters]', '[… tronqué, $1 caractères]'],
  [/^\[\.\.\. (\d+) Zeichen gekürzt\]$/, '[… $1 characters trimmed]', '[… $1 caractères retirés]'],
  [/^Inhalt ansehen \((\d+) Zeichen\) – vorhandene Datei wird überschrieben$/, 'View content ($1 characters) – existing file will be overwritten', 'Voir le contenu ($1 caractères) – le fichier existant sera écrasé'],
  [/^(\d+) Chat\(s\) kopiert(, [\s\S]*)?$/, '$1 chat(s) copied$2', '$1 discussion(s) copiée(s)$2']
);
