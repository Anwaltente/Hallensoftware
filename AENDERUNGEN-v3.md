# HALLE//OS Version 3: Änderungsliste

Diese Datei zeigt genau, welche Dateien gegenüber Version 2 angepasst wurden und warum.
Der Ordner `data/` (deine `halle.db`, Uploads, Backups) wird vom Update **nicht** angefasst.
Neue npm-Pakete gibt es keine, `npm install` ist also nicht nötig.

## So spielst du das Update ein

1. Laufenden Server stoppen (Strg+C im Terminal bzw. `pm2 stop halle`).
2. Die Dateien unten in den Projektordner kopieren (überschreiben). `data/` bleibt, wie es ist.
3. `npm start`. Beim Start passiert automatisch:
   * Sicherungskopie von `halle.db`, `halle.db-wal` und `halle.db-shm` nach `data/backups/auto/<Zeitstempel>/`
   * neue Tabellen per `CREATE TABLE IF NOT EXISTS`, neue Spalten per `ALTER TABLE ... ADD COLUMN` (mit Fehlerabfangung)
   * die Standard-Fahrzeugmodelle werden per `INSERT OR IGNORE` in die neue Modell-Tabelle übernommen
   * es werden **keine** Beispiel-Anhänger in eine bestehende Datenbank geschrieben

Zurück zum alten Stand: Server stoppen, die drei Dateien aus dem jüngsten Ordner in `data/backups/auto/`
zurück nach `data/` kopieren, alten Code wieder einspielen.

## Datenbank (nur Ergänzungen)

| Was | Art | Inhalt |
|-----|-----|--------|
| `vehicles.weight_kg` | neue Spalte | Gewicht des Autos (leer = Wert vom Modell) |
| `vehicles.length_cm`, `vehicles.width_cm` | neue Spalten | Maße des Autos (leer = Wert vom Modell) |
| `vehicle_models` | neue Tabelle | Standardmodelle + eigene Modelle mit Silhouette, Maßen, Gewicht |
| `trailers` | neue Tabelle | Anhänger: Kennzeichen, Leergewicht, zGG, Ladefläche, Zugfahrzeug, Anhängelast |
| `event_loading` | neue Tabelle | gespeicherte Zuordnung Auto zu Hänger je Event |
| `settings` Schlüssel `tv` | neuer Eintrag | TV-Einstellungen, nur angelegt wenn noch nicht vorhanden |

## Server

| Datei | Status | Änderung |
|-------|--------|----------|
| `server.js` | geändert | bindet `fleet.js` und `tv.js` ein, liefert `/tv` und `/dashboard` aus |
| `server/db.js` | geändert | automatisches Start-Backup, `--reset` verschiebt statt zu löschen, `ensureColumn` mit try/catch, neue Spalten und Tabellen (siehe oben), Modelle per `INSERT OR IGNORE` |
| `server/auth.js` | geändert | `/api/tv/...` prüft den TV-Schlüssel selbst (kein Login am Fernseher nötig) |
| `server/lib/models.js` | geändert | Standardmodelle mit Gewicht, neue Silhouetten-Liste (Coupé, Limo, Touring, Cabrio, Kompakt, Transporter, Pick-up, Dummy) |
| `server/lib/vehicleModels.js` | **neu** | liest die Modell-Liste live aus der Datenbank |
| `server/lib/loading.js` | **neu** | Gespann-Rechner: Nutzlast, Anhängelast, Länge/Breite, automatischer Vorschlag |
| `server/lib/packlist.js` | geändert | nutzt die Modell-Liste aus der Datenbank |
| `server/routes/core.js` | geändert | liefert Modelle aus der Datenbank + Silhouetten an die Oberfläche |
| `server/routes/admin.js` | geändert | Modell-Abfrage aus der Datenbank |
| `server/routes/vehicles.js` | geändert | akzeptiert alle Modelle aus der Datenbank, speichert Gewicht/Länge/Breite |
| `server/routes/tyres.js` | geändert | **Bugfix** Entsorgen: nimmt `{ ids }` (einzeln) oder `{ all: true }`, löscht nur Reifen mit Status "abgefahren" |
| `server/routes/fleet.js` | **neu** | API für Fahrzeug-Modelle, Anhänger und Beladung je Event |
| `server/routes/tv.js` | **neu** | Daten für das Hallen-TV (inkl. Wetter von Open-Meteo, 15 Min Cache) und TV-Einstellungen |

## Oberfläche

| Datei | Status | Änderung |
|-------|--------|----------|
| `public/index.html` | geändert | neuer Reiter "Anhänger", am Handy neuer Button "Hänger" |
| `public/app.js` | geändert | registriert das Anhänger-Panel, lädt die Modell-Liste beim Start |
| `public/style.css` | geändert | Ampel-Stile (grün/gelb/rot, pulsierend), Handy-Ansicht für Anhänger |
| `public/js/state.js` | geändert | `refreshMeta()` lädt Modelle neu, sobald der Admin etwas ändert |
| `public/js/tyres.js` | geändert | **Bugfix** "Alle entsorgen" mit Sicherheitsabfrage, neuer Button [Entsorgen] je Reifen |
| `public/js/cockpit.js` | geändert | Modell-Dropdown live (Gruppen "Standard" und "Eigene"), Felder Gewicht/Länge/Breite, kleiner Bugfix beim Button "Teil hinzufügen" |
| `public/js/sprites.js` | geändert | neue Silhouetten Kompakt, Transporter, Pick-up |
| `public/js/events.js` | geändert | Button "Gespanne" mit Ampel-Badge je Event |
| `public/js/admin.js` | geändert | zwei neue Tabs: "Fahrzeug-Modelle" und "TV-Dashboard" |
| `public/js/admin-v3.js` | **neu** | Inhalt dieser beiden Admin-Tabs (Modelle mit Live-Vorschau, TV-Link, Intervall, Screens, Nachrichten, Wetter-Ort) |
| `public/js/trailers.js` | **neu** | Anhänger-Fuhrpark, Gespann-Plan mit Ampel, Warnton und Badges |
| `public/tv.html` | **neu** | Hallen-TV (Kiosk-Seite) |
| `public/tv.css` | **neu** | Stil des Hallen-TV |
| `public/tv.js` | **neu** | Slider, Countdown, Laufband, Uhr, automatische Aktualisierung |

## Doku

| Datei | Status | Änderung |
|-------|--------|----------|
| `README.md` | geändert | Abschnitt "Neu in Version 3", Projektstruktur und API ergänzt, Hinweis zu `reset-db` |
| `AENDERUNGEN-v3.md` | **neu** | diese Liste |

## Nachtrag v3.1

| Datei | Änderung |
|-------|----------|
| `public/style.css` | Reiter brechen in weitere Zeilen um statt seitlich verschluckt zu werden. Rechte Seitenleiste: alle 5 Reiter (inkl. "Anhänger") als gleich breite Spalten. Am Handy füllen die Reiter jede Zeile gleichmäßig. |
| `server/db.js` | Einmalige Migration: Stellplatz "Hebebühne 2" bekommt Kapazität 2 (Parkbühne, oben + unten). Geändert wird nur dieses eine Feld, alle anderen Eigenschaften bleiben. Ein Merker in `settings` sorgt dafür, dass das nur einmal passiert. Neue Datenbanken legen Hebebühne 2 direkt mit Kapazität 2 an. |
| `public/tv.js` | Hallen-TV zeigt bei Doppelplätzen beide Autos mit "oben" / "unten" bzw. "frei". |

Unverändert: `package.json`, `beispiel-import.csv` und alle übrigen Dateien.
