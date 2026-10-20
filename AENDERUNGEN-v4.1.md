# HALLE//OS Version 4.1: Änderungsliste

Anhänger-Check rechnet mit der Reifenaufstandsfläche statt mit der Karosserie, dazu Radmaße je Auto und KI-Auto-Fill via Google Gemini.

Datenbank bleibt `data/halle.db`. Es werden **nur neue Spalten** ergänzt (`ALTER TABLE ... ADD COLUMN` mit try/catch),
keine vorhandene Zeile wird geändert oder gelöscht. Vor dem Start legt die App wie immer eine Sicherungskopie an.
Neue npm-Pakete gibt es keine (Gemini wird per eingebautem `fetch` aufgerufen).

## Neue Berechnung im Anhänger-Check

Ein Auto passt auf den Anhänger, wenn

1. **Radstand** <= Nutzlänge der Auffahrfläche
2. **Radaußenbreite** <= Nutzbreite zwischen den Radkästen,
   Radaußenbreite = `MAX(Spur vorn + Reifenbreite vorn, Spur hinten + Reifenbreite hinten)`
3. **Gewicht** <= Nutzlast des Anhängers (wie bisher, dazu weiterhin die Anhängelast des Zugfahrzeugs)

Fehlen die Radmaße eines Autos, prüft die App ersatzweise die Karosserie: passt die, passen die Räder sicher (grün).
Passt sie nicht, gibt es nur eine gelbe Warnung "Radmaße eintragen" statt eines roten Fehlalarms.

## Datenbank (nur neue Spalten in `vehicles`)

Die Fahrzeugtabelle heißt in HALLE//OS `vehicles` (nicht `cars`).

| Spalte | Inhalt |
|--------|--------|
| `wheelbase_mm` | Radstand |
| `track_front_mm` / `track_rear_mm` | Spurweite vorn / hinten |
| `tire_width_front_mm` / `tire_width_rear_mm` | Reifenbreite vorn / hinten, z. B. 225 / 245 |
| `outer_width_calc_mm` | wird beim Speichern berechnet: MAX(Spur + Reifenbreite) von Vorder- und Hinterachse |

Bestehende Autos bekommen die Werte erst, wenn ihr sie eintragt oder per KI ladet und speichert.

## Gemini-Schlüssel

Der Schlüssel steht in der Datei `.env` im Projektordner (`GEMINI_API_KEY=...`). Er bleibt auf dem Server und wird nie an den Browser geschickt.
`.env` steht in `.gitignore`. Vorlage: `.env.example`. Nach einer Änderung an `.env` den Server neu starten.

## Dateien

| Datei | Status | Änderung |
|-------|--------|----------|
| `server.js` | geändert | liest `.env` ein (ohne Zusatzpaket), bindet `routes/dimensions.js` ein |
| `server/db.js` | geändert | sechs neue Spalten in `vehicles` per `ensureColumn` (ADD COLUMN mit try/catch) |
| `server/lib/dims.js` | **neu** | Berechnung der Radaußenbreite |
| `server/lib/loading.js` | geändert | Check: Radstand vs. Nutzlänge, Radaußenbreite vs. Nutzbreite, Gewicht vs. Nutzlast; Karosserie nur noch als Ersatz |
| `server/routes/vehicles.js` | geändert | nimmt die Radmaße an (mit Plausibilitätsgrenzen) und berechnet `outer_width_calc_mm` |
| `server/routes/dimensions.js` | **neu** | `POST /api/cars/fetch-dimensions { car_name }`: fragt `gemini-3.8-flash` (bei Abkündigung automatisch das von Google genannte Nachfolgemodell), striktes JSON, Werte werden auf Plausibilität geprüft, 24 h Zwischenspeicher |
| `public/js/dims.js` | **neu** | Maß-Felder, Live-Berechnung der Radaußenbreite, Button "✨ Serienmaße via KI laden" |
| `public/js/cockpit.js` | geändert | Reiter heißt jetzt "Setup & Maße" mit dem Maß-Block oben; Maße auch beim Anlegen eines Autos |
| `public/js/trailers.js` | geändert | Grafik zeigt die vier Reifen auf der Ladefläche, Feldnamen "Nutzlänge Auffahrfläche" / "Nutzbreite zwischen den Radkästen" |
| `public/style.css` | geändert | Stil für Maß-Block und KI-Button |
| `.gitignore` | geändert | `.env` wird nie committet |
| `.env.example` | **neu** | Vorlage für den Schlüssel |
| `README.md` | geändert | Abschnitt "Neu in Version 4.1" |
| `AENDERUNGEN-v4.1.md` | **neu** | diese Liste |
