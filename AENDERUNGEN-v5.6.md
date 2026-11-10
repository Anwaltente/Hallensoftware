# HALLE//OS Version 5.6: Kein Konflikt am selben Fahrzeug, Bühnen-Filter, Freie Bühne finden

## Datenbank

Keine Änderung. Keine neuen Tabellen oder Spalten, bestehende Daten bleiben unberührt.

## 1. Konflikt nur bei unterschiedlichen Fahrzeugen

* Zwei Aufgaben auf derselben Bühne im selben Zeitraum sind **nur dann ein Konflikt, wenn sie zu verschiedenen Fahrzeugen gehören**.
  Mehrere Aufgaben am selben Auto (z. B. Boltcheck, Unterbodenbeleuchtung, Diff-Öl wechseln) lösen keinen Alarm aus.
* Aufgaben ohne Fahrzeug (Hallen- oder Event-Aufgaben) gelten untereinander weiter als verschieden.
* Bei „Beliebige Bühne“ zählen alle Aufgaben eines Fahrzeugs zusammen als eine belegte Bühne.
* Kalender und Belegungsliste fassen Aufgaben desselben Fahrzeugs auf derselben Bühne zu einem Block zusammen:
  „E46 Drift Coupé (3 Aufgaben: Boltcheck, Unterbodenbeleuchtung, Diff-Öl wechseln)“. Die einzelnen Aufgaben stehen darunter als Knöpfe zum Öffnen.

## 2. Bühnen-Filter im Kalender

Über der Belegung: **Alle Bühnen anzeigen** (Standard), **Nur Hebebühne 1**, **Nur Hebebühne 2** (je nach angelegten Bühnen),
**Nicht bühnengebundene Arbeiten** (Reservierungen mit „Beliebige Bühne“ und Aufgaben ohne Reservierung).
Der Filter gilt für Tag, Woche und Monat, für die Liste und für „Fällige Aufgaben“. Ein Klick zeichnet sofort neu, ohne Nachladen.

## 3. Freie Bühne finden

* Knopf **„Freie Bühne finden“** im Kalender und im Aufgaben-Formular (unter Von/Bis).
* Eingabe: Dauer (1 Tag, 2 Tage, 3 Tage, Wochenende) und Bühne (Egal, Bühne 1, Bühne 2).
* Ergebnis: die nächsten 5 freien Termine, z. B. „Frei: Sa, 21. Nov bis So, 22. Nov (Hebebühne 2)“. Die Termine überschneiden sich nicht untereinander.
  Wochenende heißt Samstag und Sonntag.
* Ein Klick auf einen Termin
  * im **Aufgaben-Formular** übernimmt Bühne, Von und Bis direkt in die Aufgabe (gespeichert wird erst mit „Speichern“),
  * im **Kalender** öffnet eine neue Hallen-Aufgabe mit dem Zeitraum vorbelegt.
* Bei der Suche aus dem Formular blockieren das eigene Fahrzeug und die gerade bearbeitete Aufgabe nicht.
* API: `GET /api/lift-free?days=1..14` oder `weekend=1`, `lift=ID` (leer = egal), `vehicle_id`, `exclude`.

## Geänderte Dateien

| Datei | |
| --- | --- |
| `server/lib/lifts.js` | Konfliktregel nach Fahrzeug, `findFree` / `freeSlots`, Selbsttest erweitert |
| `server/routes/workshop.js` | `GET /lift-free` |
| `public/js/liftfinder.js` | **neu**: Dialog „Freie Bühne finden“ |
| `public/js/calendar.js` | Filter, Zusammenfassung je Fahrzeug, Finder-Knopf |
| `public/js/workload.js` | Finder-Knopf im Aufgaben-Formular |
