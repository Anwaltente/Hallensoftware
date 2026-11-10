# HALLE//OS Version 5.5: Bühne direkt in der Aufgabe (in Tagen), Fälligkeit schnell ändern, kein "-2 Burned" mehr

## Datenbank

Keine Änderung. Es gibt keine neuen Tabellen oder Spalten, bestehende Daten bleiben unberührt.
Bühnen-Reservierungen nutzen weiter `tasks.lift_slot`, `tasks.lift_from`, `tasks.lift_to`; Fälligkeit ist weiter `tasks.target_date`.

## 1. Bühne reservieren: in der Aufgabe, in Tagen

* Der eigene Knopf **„Reservieren“** im Kalender und die Bühnen-Symbole an den Aufgaben (Cockpit, Hallen-Board, Event-Aufgaben, Whiteboard) sind entfernt.
* Im Aufgaben-Formular (Auto-, Hallen- und Event-Aufgaben): **Benötigt Hebebühne**, Auswahl **Bühne 1 / Bühne 2 / Beliebige Bühne**,
  **Von** und **Bis** als reines Datum. Voreinstellung: gleicher Tag = 1 Tag geblockt. Keine Uhrzeit, keine Stunden.
* Gespeichert wird intern wie bisher: Von-Tag 00:00 bis Tag nach dem Bis-Tag 00:00 (Ende exklusiv). Dadurch bleibt die Konfliktprüfung unverändert.
  Alte Reservierungen mit Uhrzeit zählen als ganze Tage; sie ändern sich erst, wenn man die Aufgabe speichert.
* Kalender (Tag, Woche, Monat): ganztägige Tages-Blöcke je Bühne und eine Liste wie
  „Hebebühne 1 blockiert von Sa 14.11. bis Mo 16.11. durch E36 Diff-Tausch“.
  Überschneidung am selben Tag: roter Konflikt-Rahmen, Warnleiste oben und Hinweis beim Speichern. Aneinander anschließende Tage (Sa bis So, dann Mo) sind kein Konflikt.
* Hallenkarte und TV zeigen „bis 16.11.“ statt einer Uhrzeit.

## 2. Fälligkeit schnell ändern

* Überall, wo eine Aufgabe ihre Fälligkeit zeigt (Cockpit, Hallen-Board, Event-Aufgaben, Whiteboard, Team-Auslastung, Kalender), stehen am Datum
  **Datum anklicken** (öffnet die Datumsauswahl, ohne Datum: „Datum wählen“), **+1 Tag** und **+1 Woche**.
* +1 Tag und +1 Woche rechnen ab dem aktuellen Fälligkeitsdatum, bei überfälligen oder fehlenden Daten ab heute (also „+1 Tag“ = mindestens morgen).
* Speichert sofort per `PATCH /api/tasks/:id/due-date` mit `{ "date": "JJJJ-MM-TT" }` (`null` entfernt das Datum). Nur das Datums-Element wird ausgetauscht, die Seite lädt nicht neu.
* Kalender: unter der Belegung steht die Liste „Fällige Aufgaben im Zeitraum“ mit denselben Knöpfen. Drag & Drop im Kalender gibt es nicht.
* Im Aktivitäts-Log erscheint „Fälligkeit geändert: Aufgabe (alt → neu)“.

## 3. „-2 Burned“ entfernt

Der Knopf ist überall weg: Fahrzeug-Cockpit, Auswahlleiste auf der Map, Reifenlager, ebenso Rauch-Animation und die Route `POST /api/tyres/burn`.
Reifen abziehen, „Altreifen (abgefahren)“, Entsorgen und „Zurück in den Bestand“ laufen weiter im Reifenlager.

## Geänderte Dateien

| Datei | |
| --- | --- |
| `server/routes/workshop.js` | `PATCH /tasks/:id/due-date`, Meldungen für Von/Bis |
| `server/lib/lifts.js` | `lift_bis` (letzter Tag), Selbsttest für ganze Tage |
| `server/routes/tyres.js`, `server/lib/activity.js` | Burn-Route entfernt, Log-Text |
| `public/js/workload.js` | Fälligkeits-Steuerung, Bühnenfelder Von/Bis |
| `public/js/calendar.js` | Tages-Blöcke, Liste, fällige Aufgaben, kein „Reservieren“-Knopf |
| `public/js/cockpit.js`, `events.js`, `hallboard.js`, `whiteboard.js` | Bühnen-Symbole entfernt |
| `public/js/tyres.js`, `public/app.js` | Burned entfernt |
| `public/js/api.js`, `admin-activity.js`, `map.js`, `public/tv.js`, `style.css`, `biz.css` | kleine Anpassungen |
