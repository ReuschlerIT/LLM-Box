# Live-Ansicht: Protokoll

Seit V71 kann eine LLM Box (Windows) ihre Chats im Netz **in Echtzeit** anbieten. Eine zweite LLM Box (Windows oder Android) zeigt sie schreibgeschützt an, während die KI schreibt.

## Einrichten

1. Quelle: **Einstellungen → Live-Ansicht → Live-Quelle anbieten** einschalten. Die Adresse (mit Schlüssel) und ein QR-Code erscheinen.
2. Empfänger: dieselbe Seite, Adresse einfügen (Android: QR-Code scannen) → **Verbinden**. In der Seitenleiste erscheint der Kasten „Live“ mit den Chats der Quelle.
3. Chat anklicken: Die Antwort läuft Wort für Wort mit. „Aktiven Chat automatisch anzeigen“ folgt der Quelle beim Chat-Wechsel. „Eigener Chat“ im Banner über dem Eingabefeld kehrt zurück.

## Protokoll (HTTP, Server-Sent-Events)

Alle Pfade liegen unter `/llmbox-live` und verlangen `?t=<Schlüssel>` (sonst 403).

| Pfad | Antwort |
|---|---|
| `GET /events` | SSE-Strom (siehe unten), alle 15 s ein Kommentar `: hb` als Lebenszeichen |
| `GET /chats` | `{ device, active, list: [{ id, title, updated, model, running }] }` |
| `GET /poll?since=<seq>` | Ersatz für den Strom (Long-Polling): `{ seq, events: [{ seq, type, data }], reset? }`; antwortet nach Ereignissen oder spätestens nach 20 s. `since=-1` = frisch verbinden (liefert `hello`, `reset: true`) |
| `POST /send` | `{ id, text, create? }` Nachricht an einen Chat der Quelle (nur mit Fernsteuerung; sonst 403). `create: true` legt den Chat mit dieser `id` an |
| `POST /stop` | `{ id }` stoppt die KI in diesem Chat (nur mit Fernsteuerung) |
| `GET /chat?id=…` | vollständiges Chat-Objekt (Dateien ohne große Binärdaten, Werkzeug-Ausgaben auf 6000 Zeichen gekürzt) |

Ereignisse im Strom (`event:` / `data:` als JSON):

| Ereignis | Inhalt |
|---|---|
| `hello` | `{ device, version, active, seq }` direkt nach dem Verbinden |
| `list` | `{ list }` Chatliste |
| `active` | `{ id }` Chat, den die Quelle gerade geöffnet hat |
| `chat` | `{ chat }` vollständiger Stand |
| `msg` | `{ id, index, message, title }` eine Nachricht neu oder geändert |
| `delta` | `{ id, index, cFrom, c, tFrom, t }` Text ab Position `cFrom` (Antwort) bzw. `tFrom` (Gedankengang) anhängen |
| `busy` | `{ id, running }` die KI arbeitet / ist fertig |

## Grenzen

- Ohne Fernsteuerung ist die Anzeige **schreibgeschützt**. Mit Fernsteuerung (auf der Quelle unter Einstellungen → Live-Ansicht → „Fernsteuerung erlauben“, Standard aus) kann der Empfänger Nachrichten senden, die KI stoppen und Chats beginnen. Die KI arbeitet dann mit den Workspace-Rechten der Quelle; Freigaben erscheinen dort.
- Laufende Programmausgaben und offene Rückfragen der Quelle erscheinen erst, wenn sie als Nachricht im Chat stehen.
- Die Android-App kann empfangen. Als Quelle bietet bisher nur Windows an.
- Der Schlüssel ist dauerhaft gespeichert (`live.json` im Datenordner der App) und lässt sich in den Einstellungen erneuern. Nur im eigenen WLAN verwenden.
- Der Empfänger versucht zuerst den Strom (`api.stream`, GET mit `Accept: text/event-stream`). Kommt innerhalb von 7 Sekunden nichts an (z. B. weil eine Brücke Teilantworten zurückhält), wechselt er selbst auf Long-Polling (`api.fetch`). Beides funktioniert ohne Änderung an der Android-Brücke, solange `api.fetch` GET und POST kann.

## Hub

Dasselbe Protokoll bietet auch der **LLM Box Hub** (Ordner `hub/`) an, ein Server ohne Oberfläche für Linux und Windows. Er speichert die Chats, ruft die Modelle auf und lässt die Antwort weiterlaufen, wenn Geräte ausgehen. Zusätzlich zu den Pfaden oben kennt er `GET /models`, `POST /delete` und `POST /rename`; `hello` und `/chats` enthalten `hub: true`. Siehe `hub/README.md`.
