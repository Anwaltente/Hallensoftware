# HALLE//OS Version 4: Änderungsliste

Schnell-Verbrauch, Game-Sounds und Haptik, kritische Ressourcen (Notfall-Radar) und Schwebe-Status ("liegt rum").
Diese Datei zeigt genau, welche Dateien gegenüber Version 3.1 angepasst wurden.

Der Ordner `data/` (deine `halle.db`, Uploads, Backups) wird vom Update **nicht** angefasst.
Neue npm-Pakete gibt es keine, `npm install` ist nicht nötig.

## So spielst du das Update ein

1. Laufenden Server stoppen (Strg+C im Terminal bzw. `pm2 stop halle`).
2. `npm start`. Beim Start passiert automatisch:
   * Sicherungskopie von `halle.db`, `halle.db-wal` und `halle.db-shm` nach `data/backups/auto/<Zeitstempel>/`
   * drei **neue** Tabellen per `CREATE TABLE IF NOT EXISTS` (siehe unten)
   * einmalig ein Start-Sortiment an Verbrauchsartikeln in der **neuen** Tabelle `consumables`
     (10W-60, 75W-140, ATF, Kühlmittel, Bremsflüssigkeit, Bremsenreiniger, WD-40, Kabelbinder, Flexscheiben,
     Panzertape, Sicherungen). Der Bestand ist zunächst "unbekannt", damit es keinen Fehlalarm gibt.
     Einmal "Inventur" antippen, dann rechnet die App weiter.
   * ein Merker `seed_v4` in der Tabelle `settings`, damit das Start-Sortiment nie doppelt angelegt wird

Bestehende Tabellen bekommen **keine** neuen Spalten. Keine vorhandene Zeile wird geändert oder gelöscht.

## Datenbank (nur neue Tabellen)

| Tabelle | Inhalt |
|---------|--------|
| `consumables` | Verbrauchsartikel: Art (Flüssigkeit/Stück), Einheit, Bestand, Mindestbestand, "darf nie ausgehen", Schnell-Tasten, Gebinde, Preis, Lagerort auf dem Hallenplan |
| `consumable_moves` | jede Buchung (Verbrauch, Gebinde leer, Nachkauf, Inventur) mit Person, Auto und Rückgängig-Merker |
| `float_items` | Dinge "in der Schwebe": was, wo es liegt, wer, seit wann, wann zurückgeräumt (Verlauf bleibt) |

Was die neuen Funktionen in **bestehenden** Tabellen tun (genau wie bisherige Bedienung auch):

* Verbrauch auf ein Auto gebucht: neuer Eintrag im Wartungsheft (`maintenance_log`), Rückgängig entfernt genau diesen Eintrag wieder
* "Liegt wieder im Fach" bzw. "Alles zurückgeräumt" bei ausgeliehenem Werkzeug: setzt die Ausleihe zurück, wie der bisherige Button "Zurückgegeben"
* Einkaufsliste: "Gekauft" bei Auto-Einkäufen und "+Kiste" bei Kühlschrank-Vorräten nutzen die bestehenden Funktionen

## Server

| Datei | Status | Änderung |
|-------|--------|----------|
| `server/db.js` | geändert | drei neue Tabellen (nur `CREATE TABLE IF NOT EXISTS`), einmaliges Start-Sortiment in der neuen Tabelle |
| `server/lib/hub.js` | **neu** | Logik: Restbestand, "Kanister leer" (Rest des angebrochenen Gebindes), kritischer Mangel, Einkaufsliste, Schwebe-Liste, HUD-Daten |
| `server/routes/hub.js` | **neu** | API: Verbrauch buchen, Nachkauf, Inventur, Rückgängig, Verlauf, Einkaufsliste, Admin-Verwaltung, Schwebe-Status |
| `server/routes/tv.js` | geändert | Hallen-TV bekommt kritische Ressourcen, Verbrauchsartikel und "liegt rum" |
| `server.js` | geändert | bindet `routes/hub.js` ein |

## Oberfläche

| Datei | Status | Änderung |
|-------|--------|----------|
| `public/js/sfx.js` | **neu** | Sounds per Web Audio API (keine Audiodateien): Pfft-Klack, Ratsche, Level-Up, tiefer Warnton, Klick. Ton an/aus wird lokal gemerkt. Vibration, schwebende Zahlen, Funken |
| `public/js/hud.js` | **neu** | HUD-Leiste (Kopfzeile am Desktop, Dock über der Navigation am Handy), Hallen-Ablage mit "Liegt wieder im Fach" / "Alles zurückgeräumt", 1-Tap-Schalter "Rausgeholt" |
| `public/js/quickuse.js` | **neu** | Schnell-Verbrauch: Großtasten-Kacheln, "Buchen auf" Halle oder Auto, Rückgängig, Einkaufsliste, Verlauf |
| `public/js/admin-v4.js` | **neu** | Admin-Tab "Verbrauch & Kritisch": kritische Ressourcen mit Schwellenwert, Artikel anlegen/bearbeiten |
| `public/js/admin.js` | geändert | neuer Tab "Verbrauch & Kritisch" |
| `public/js/storage.js` | geändert | Button "Rausgeholt" an Werkzeug, Kisten und Teilen; Ratsche bei "Nehme ich" |
| `public/js/map.js` | geändert | roter Neon-Rahmen am Lagerort bei kritischem Mangel, gelbe Marker für Dinge, die rumliegen |
| `public/js/ticker.js` | geändert | LED-Laufband zeigt kritischen Mangel und "liegt rum" ganz vorne |
| `public/js/supplies.js` | geändert | Text im Vorräte-Hinweis der Kopfzeile platzsparender |
| `public/js/trailers.js` | geändert | Warnton respektiert den Ton-Schalter |
| `public/js/state.js` | geändert | neuer Store-Eintrag `hud` |
| `public/app.js` | geändert | verdrahtet HUD, Schnell-Verbrauch und Polling |
| `public/index.html` | geändert | HUD-Platz in der Kopfzeile, HUD-Dock am Handy, Suchfeld kürzt sauber |
| `public/style.css` | geändert | elastische Buttons (scale .95), Zahlen-Popups, HUD, Kacheln mit Tank-Anzeige, Alarm-Puls |
| `public/tv.html`, `public/tv.css`, `public/tv.js` | geändert | roter Alarmstreifen über allen Screens, kritische Kacheln im Vorräte-Screen, "liegt rum" im Aufgaben-Screen |

## Doku

| Datei | Status | Änderung |
|-------|--------|----------|
| `README.md` | geändert | Abschnitt "Neu in Version 4", Projektstruktur und API ergänzt |
| `AENDERUNGEN-v4.md` | **neu** | diese Liste |
