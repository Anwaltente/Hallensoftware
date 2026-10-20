# HALLE//OS

Werkstatt- und Hallen-Management im Look eines 2D Top-Down Werkstattspiels.
Event-Planer mit automatischer Trackside-Packliste, interaktive Hallen-Map mit Drag & Drop,
Lager-Radar mit Euroboxen, Fahrzeug-Cockpit, Whiteboard mit Event-Deadline-Algorithmus,
No-Code Garage-Builder und Blueprint-Modus für Elektrik und Druckluft.

## Schnellstart (lokal)

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm start
```

Dann im Browser: <http://localhost:3000>

Beim ersten Start wird `data/halle.db` automatisch angelegt und mit Beispieldaten befüllt.

| Profil   | Rolle     | PIN  |
|----------|-----------|------|
| Oliver   | Admin     | 1234 |
| Kumpel 1 | Schrauber | 0000 |
| Kumpel 2 | Schrauber | 0000 |

PINs bitte direkt in der Admin-Konsole (Nutzer) ändern.

Datenbank komplett neu aufsetzen: `npm run reset-db`. Seit Version 3 wird dabei nichts gelöscht: die alte Datenbank
wandert nach `data/backups/reset-<Zeitstempel>/` und kann jederzeit zurückkopiert werden.

Im gleichen WLAN ist die App auch vom Handy erreichbar: `http://<IP-des-Rechners>:3000`.

## Bedienung in Kürze

* **Hallen-Map:** Autos per Maus ziehen und auf einem Platz loslassen (Snap-to-Slot). Belegter Platz: Tauschen wird angeboten.
  Am Handy: Auto antippen, dann Zielplatz antippen. Klick (Desktop) auf ein Auto zoomt heran und öffnet das Cockpit.
* **Unterwegs / Paddock:** Parkbuchten rechts neben der Halle. Auto dorthin ziehen, Standort wählen (Hänger, Lackierer, Kumpel ...).
  Alle Daten bleiben erhalten.
* **Schneise:** Sind L1 oder L2 belegt, laufen Warnstreifen und Hebebühne 1 wird als "Ausfahrt zu" markiert.
* **Strg+K** (oder `/`): Spotlight-Suche über Autos, Teile, Werkzeug, Boxen, Aufgaben, Wartungsheft und Events. Springt per Kamera-Zoom ins Regal.
* **Events:** Event anlegen, Autos wählen, Packliste ist sofort fertig. Werkzeug und Universal-Teile erscheinen genau einmal.
* **Admin:** Button "Admin" (PIN wird erneut abgefragt) öffnet Baukasten, Blueprint-Editor, Nutzer, Hall Pass, Quick-Checks, CSV-Import, Geräte und Backup.

## Neu in Version 2

* **Reifenlager (Drift-Tyre Hub):** Reifenstapel rechts neben Regal B anklicken. Reifen, Felgen und Kompletträder getrennt,
  virtuelles Montieren und Abziehen (mit Zollgrößen-Prüfung), Einstufung Drift oder Straße, Zustand Neu / Training / Burner.
  **-2 Burned** im Reifenlager, im Fahrzeug-Cockpit und in der Auswahlleiste auf der Map (Handy) bucht zwei Driftreifen ab, mit Rückgängig.
* **QR-Codes:** "QR-Code drucken" im Cockpit, an jeder Eurobox und "Alle Box-Labels drucken" in der Regalansicht.
  Labels 62 × 29 mm (Etikettendrucker) oder groß (A6). Scanner über das Kamera-Symbol oben.
  Die Codes enthalten einen Link (`/?scan=box-12`), daher funktioniert auch die normale Handy-Kamera.
  Wichtig: In der Admin-Konsole unter System die Adresse eintragen, unter der Handys die App erreichen (z. B. `http://192.168.178.20:3000`).
  Der In-App-Scanner braucht HTTPS (oder localhost), sonst blockieren Handy-Browser die Kamera.
* **Kühlschrank-Radar:** Kühlschrank an der Chill-Ecke anklicken. Vorräte mit +1 / -1 / +Kiste und Mindestbestand.
  Fällt etwas darunter, pulsiert ein Hinweis in der Kopfzeile, am Kühlschrank auf der Map und im LED-Laufband.
* **Setup & Fahrwerk:** Neuer Reiter im Fahrzeug-Cockpit. Animierte Front-, Drauf- und Seitenansicht für Sturz, Spur,
  Nachlauf und Lenkeinschlag, dazu Reifendruck kalt/warm, Lenkwinkel-Kit, Dämpfer-Klicks, Stabis, Fahrhöhe
  und eine Strecken-Historie mit Bewertung.
* **LED-Laufband:** Über der Map. Live-Countdown (Tage : Stunden : Minuten) zum nächsten Event plus Laufschrift mit
  offenen To-Dos je Auto, Packlisten-Fortschritt, Driftreifen-Bestand und leeren Vorräten. Startzeit im Event-Editor einstellbar.
  Zusätzlich hängt ein kleines LED-Schild an der Hallenwand auf der Map.

Bestehende Datenbanken werden beim Start automatisch migriert (neue Tabellen, neue Map-Objekte, Beispielvorräte).

## Neu in Version 3

* **Datenschutz beim Update:** Vor jedem Serverstart legt HALLE//OS automatisch eine Kopie von `halle.db` (inklusive
  `-wal` und `-shm`) unter `data/backups/auto/<Zeitstempel>/` ab. Die letzten 20 Kopien bleiben erhalten.
  Neue Tabellen entstehen nur per `CREATE TABLE IF NOT EXISTS`, neue Spalten nur per `ALTER TABLE ... ADD COLUMN`
  mit Fehlerabfangung. Vorhandene Zeilen werden nie geändert oder gelöscht.
* **Altreifen entsorgen:** Im Reifenlager, Reiter "Burned", hat jeder abgefahrene Reifen einen eigenen Button
  [Entsorgen]. "Alle entsorgen" fragt vorher nach ("Möchtest du wirklich alle X Altreifen austragen?").
* **Fahrzeug-Modelle verwalten:** Admin-Konsole, Tab "Fahrzeug-Modelle". Eigene Modelle (z. B. Nissan S13) mit
  Bezeichnung, Chassis, Silhouette, Länge, Breite und Leergewicht anlegen, bearbeiten und löschen. Die Standardmodelle
  (E36, E46, G42, G21, Dummy) bleiben fest. Das Modell-Dropdown im Cockpit liest die Liste live aus der Datenbank.
* **Anhänger-Fuhrpark:** Neuer Reiter "Anhänger" (am Handy unten "Hänger"). Name, Kennzeichen, Leergewicht, zGG,
  Nutzlast (wird berechnet), Ladefläche und optional Zugfahrzeug mit Anhängelast.
* **Gespann-Rechner:** Im Event-Planer zeigt der Button "Gespanne" eine Ampel je Event. Die App schlägt automatisch vor,
  welches Auto auf welchen Hänger kommt (ein Auto pro Hänger), prüft Gewicht, Anhängelast, Länge und Breite und warnt
  mit Ton und Badges wie "Überladen um 120 kg!" oder "Fahrzeug zu lang für Hänger Y!". Zuordnungen lassen sich
  per Dropdown ändern und speichern. Gewicht und Maße je Auto im Cockpit unter "Bearbeiten" eintragen, sonst gelten
  die Werte des Modells (als Schätzung markiert).
* **Hallen-TV:** `http://<IP>:3000/tv` (oder `/dashboard`) auf einem Fernseher oder Tablet öffnen. Vier Screens wechseln
  automatisch: Aufgaben und wer gerade schraubt, Event-Radar mit Countdown und Packliste, Vorräte und Burner-Reifen,
  Hallenbelegung mit freien Plätzen und Wetter. Den fertigen Link (mit Zugangsschlüssel), Intervall, aktive Screens,
  eigene Nachrichten und den Wetter-Standort gibt es in der Admin-Konsole, Tab "TV-Dashboard".

* **Hebebühne 2 als Parkbühne:** Auf Hebebühne 2 passen jetzt zwei Autos, eins oben und eins unten (wie bei Hebebühne 1).
  Im Cockpit tauscht "Oben/Unten tauschen" die beiden. Die Kapazität lässt sich im Baukasten jederzeit wieder auf 1 stellen.
* **Reiter verschwinden nicht mehr:** Passen nicht alle Reiter in eine Zeile (Seitenleiste, Cockpit, Admin-Konsole, Handy),
  brechen sie in eine weitere Zeile um.

## Neu in Version 4

* **⚡ Schnell-Verbrauch:** Permanenter Button im HUD (Kopfzeile, am Handy unten über der Navigation).
  Tap 1 öffnet das Großtasten-Grid, Tap 2 bucht: `-0,5 L`, `-1,0 L`, `-2,0 L`, `Kanister leer!` bzw. `-1 Stk`, `-2 Stk`, `Dose leer!`.
  "Kanister leer" bucht genau den Rest des angebrochenen Gebindes aus. Der Restbestand rechnet sich automatisch weiter.
  Oben "Buchen auf": Halle / Allgemein oder ein Auto. Mit Auto landet der Posten im Wartungsheft (mit Kosten, wenn ein Preis hinterlegt ist).
  Jede Buchung lässt sich 24 Stunden lang rückgängig machen. Erst einmal "Inventur" antippen, damit die App den Startbestand kennt.
* **Sound, Haptik, Animation:** Pfft-Klack beim Abbuchen, Ratsche bei "Rausgeholt", Level-Up bei "Alles aufgeräumt",
  tiefer Warnton bei kritischem Mangel. Alles live per Web Audio erzeugt, ohne Audiodateien. Ton an/aus im HUD (🔊), wird gemerkt.
  Vibration am Handy, schwebende Zahlen (`-1,0 L`), elastische Buttons.
* **Kritische Ressourcen (Notfall-Radar):** Admin-Konsole, Tab "Verbrauch & Kritisch". Artikel als "darf nie ausgehen" markieren
  und Schwellenwert setzen (z. B. mindestens 5 L). Darunter: roter Neon-Alarm im HUD, roter Rahmen am Lagerort auf dem Hallenplan,
  roter Alarmstreifen auf dem Hallen-TV und ganz oben auf der Einkaufsliste.
* **Einkaufsliste:** Im Schnell-Verbrauch, Reiter "Einkaufsliste": Kritisches zuerst, dann Knappes, Kühlschrank-Vorräte und offene Auto-Einkäufe.
  "Liste kopieren" für den Gruppenchat.
* **Schwebe-Status / Hallen-Ablage:** "🛠️ Rausgeholt" an jedem Werkzeug, jeder Kiste und jedem Teil. Der Zähler im HUD zeigt,
  wie viele Dinge rumliegen. Antippen öffnet die Hallen-Ablage mit "Liegt wieder im Fach" und "Alles zurückgeräumt".
  Ausgeliehenes Werkzeug ("Nehme ich") zählt mit.

## Neu in Version 4.1

* **Anhänger-Check mit Radmaßen:** Geprüft wird die Reifenaufstandsfläche statt der Karosserie:
  Radstand <= Nutzlänge der Auffahrfläche, Radaußenbreite (`MAX(Spur + Reifenbreite)` vorn/hinten) <= Nutzbreite zwischen den Radkästen,
  Gewicht <= Nutzlast. Fehlen Radmaße, wird ersatzweise die Karosserie geprüft und gelb auf die fehlenden Werte hingewiesen.
* **Radmaße je Auto:** Im Cockpit, Reiter "Setup & Maße", und beim Anlegen eines Autos: Radstand, Spurweite vorn/hinten, Reifenbreite vorn/hinten
  (z. B. für Wisefab, Spurplatten, breitere Reifen). Die Radaußenbreite wird live berechnet.
* **✨ Serienmaße via KI laden:** Holt Radstand, Spurweiten, Serien-Reifenbreite (und, falls leer, das Leergewicht) über Google Gemini (`gemini-3.8-flash`, wechselt bei Abkündigung automatisch aufs Nachfolgemodell).
  Schlüssel in die Datei `.env` im Projektordner eintragen (Vorlage `.env.example`): `GEMINI_API_KEY=...`, dann Server neu starten.

## Neu in Version 4.2

* **Kühlschrank-Radar** zeigt nur noch Getränke & Snacks. Werkstatt-Material läuft über Inventar + Kritische Liste.
* **Gebinde im Inventar:** Beim Teil "Gebindemenge", "Einheit" und "Gehört zu (Kritische Liste)" eintragen, z. B. 2× "0W-60 (1 L Dose)" in Regal A, Ebene 2.
  Die Kritische Liste summiert alle Gebinde automatisch (2× 1 L + 1× 5 L = 7,0 L), der Admin legt nur noch das Soll fest.
* **Schnell-Verbrauch** zieht aus angebrochenen, dann aus den kleinsten Gebinden ab. Nachschub kommt per "Einlagern" mit Lagerort.
* **Demnächst einkaufen:** Mangel-Radar (Kritische Liste + Kühlschrank unter Soll) im Whiteboard und als 🛒 im HUD,
  mit 1 Klick auf die Hallen-Einkaufsliste. "Gekauft" lagert Betriebsstoffe direkt mit Lagerort ein.
* **Zuordnungs-Assistent** (Admin-Konsole, "Verbrauch & Kritisch"): vorhandene Öl-Teile verknüpfen, alte Werkstatt-Vorräte übernehmen.

## Neu in Version 5: Büro-Ansicht (Enterprise- / Stealth-Modus)

* **Umschalten:** Klick auf den eigenen Namen oben rechts, dort `Ansicht: Werkstatt (Game)` oder `Ansicht: Enterprise (Büro / ERP)`.
  Tastenkürzel: **Alt + B** wechselt hin und zurück (auf dem Mac Option + B), **Esc** schaltet sofort ins Büro,
  sofern gerade kein Dialog offen ist (sonst schließt Esc wie gewohnt zuerst den Dialog). Die Wahl bleibt im Browser gespeichert.
* **Look:** hell, Systemschrift, feine Linien, keine Glows, keine Animationen, keine Sounds. Kopfzeile "Fleet & Resource Management Portal v2.4",
  eigener Tab-Titel und eigenes Favicon.
* **Gleiche Funktionen als Tabellen:** Stellplatz- & Kapazitätsmatrix (Umsetzen per Drag & Drop oder Auswahlliste, Status ändern),
  Inventar (Teile, Werkzeug, Euroboxen mit Suche, Filter, Sortierung, CSV-Export), Materialentnahme (Verbrauchsbeleg erfassen,
  Bestand, Belegjournal mit Storno, Bedarfsermittlung), Projekte & Termine (Kalender + Ausrüstungs-Checkliste) und im Cockpit unter
  "Setup & Maße" die Kennzahlentabelle "Fahrwerksgeometrie & Prüfprotokoll" (druckbar).
* Rein optisch: keine Server- oder Datenbankänderung.

## Projektstruktur

```
package.json
server.js                  Express-Server, mountet alle Module
server/
  db.js                    SQLite-Schema (auto), Mini-Migrationen, Initialdaten
  auth.js                  Sessions (Cookie oder Bearer), Rollen gast < schrauber < admin
  lib/
    packlist.js            Packlisten-Logik mit strikter Deduplizierung
    whiteboard.js          Event-Deadline-Algorithmus
    csv.js                 CSV-Parser (Komma/Semikolon/Tab, Quotes) + Spalten-Vorschlag
    models.js              Standard-Modelle, Silhouetten, Status, Slot-Arten, Blueprint-Arten
    vehicleModels.js       v3: Modell-Liste live aus der Datenbank
    loading.js             v3: Gespann-Rechner (Gewicht, Anhängelast, Maße, Vorschlag)
    hub.js                 v4: Restbestand, kritischer Mangel, Einkaufsliste, Schwebe-Liste
    dims.js                v4.1: Radaußenbreite (Spur + Reifenbreite)
    stock.js               v4.2: Gebinde-Summe und Abzug (angebrochen zuerst, dann kleinstes Gebinde)
    queries.js, util.js    Gemeinsame Abfragen und Helfer
  routes/
    auth.js                Login, Hall Pass, PIN-Bestätigung
    core.js                Meta, Bootstrap, Layout (Builder), Spotlight-Suche
    vehicles.js            Fuhrpark, Umparken, Cockpit, Dokument-Upload, Konverter
    workshop.js            Aufgaben, Wartungsheft, Budget, "Woran arbeite ich", Whiteboard
    events.js              Events + Packliste
    inventory.js           Teile, Werkzeug (Verleih, Wunschliste), Euroboxen, Regale
    admin.js               Nutzer, Hall Pass, Quick-Checks, CSV-Import, Backup
    blueprint.js           Leitungen und Knoten
    devices.js             Smarte Steckdosen, Heizungen, Sensoren, Webcams
    tyres.js               v2: Reifen, Felgen, Kompletträder, Burner
    chill.js               v2: Vorräte (Kühlschrank-Radar), Setups, LED-Ticker
    fleet.js               v3: Fahrzeug-Modelle, Anhänger, Beladung je Event
    tv.js                  v3: Daten und Einstellungen für das Hallen-TV
    hub.js                 v4: Schnell-Verbrauch, kritische Ressourcen, Einkaufsliste, Schwebe-Status
    dimensions.js          v4.1: KI-Serienmaße via Gemini (POST /api/cars/fetch-dimensions)
  devices/drivers.js       Treiber: mock, shelly, tasmota, webhook
public/
  index.html               Layout (Tailwind CDN), Header, Map, Seitenleisten, Mobile-Navigation
  style.css                Industrieller Look, Warnstreifen, Glow, Blueprint, Druckansicht
  biz.css                  v5: Büro-Ansicht (heller Business-Look, aktiv bei <html class="biz">)
  app.js                   Einstieg: verdrahtet alle Module
  js/
    state.js               Store + Pub/Sub + Funktionsregistry
    api.js                 REST-Client
    ui.js                  Sicheres Templating, Icons, Modals, Toasts, PIN-Pad
    sprites.js             Top-Down Vektor-Sprites (E36/E46/G42/G21/Dummy)
    map.js                 Map-Engine: Kamera, Drag & Drop, Builder, Blueprint
    auth.js                Login, Hall Pass, Quick-Check-Abfrage
    whiteboard.js          Whiteboard + Live-Arbeit
    cockpit.js             Fahrzeug-Cockpit + Fuhrpark
    events.js              Event-Planer + Packliste
    storage.js             Lager, Regal-Frontansicht, Teile, Werkzeug
    admin.js               Admin-Konsole, Garage-Builder, Blueprint-Editor
    spotlight.js           Strg+K Suche
    tyres.js               v2: Drift-Tyre Hub
    qr.js                  v2: QR-Encoder (offline), Label-Druck, Scanner
    supplies.js            v2: Kühlschrank-Radar + Low-Stock-Alarm
    setup.js               v2: Animiertes Setup-Sheet
    ticker.js              v2: LED-Laufband
    trailers.js            v3: Anhänger-Fuhrpark + Gespann-Rechner
    admin-v3.js            v3: Admin-Tabs Fahrzeug-Modelle und TV-Dashboard
    sfx.js                 v4: Game-Sounds (Web Audio), Vibration, Zahlen-Popups
    hud.js                 v4: HUD-Schnellzugriff + Hallen-Ablage (Schwebe-Status)
    quickuse.js            v4: Schnell-Verbrauch + Einkaufsliste + Verlauf
    admin-v4.js            v4: Admin-Tab Verbrauch & Kritisch
    dims.js                v4.1: Radmaße-Formular + KI-Auto-Fill
    biz.js                 v5: Büro-Ansicht, Alt+B / Esc, Profilmenü, ERP-Tabellen
  tv.html, tv.css, tv.js   v3: Hallen-TV (eigenständige Kiosk-Seite unter /tv)
data/                      (wird automatisch erstellt) halle.db, uploads/, backups/
```

## Server / VPS

```bash
# Beispiel: eigener Port, nur lokal erreichbar hinter nginx
PORT=8080 HOST=127.0.0.1 TRUST_PROXY=loopback npm start
```

| Variable      | Standard          | Zweck                                                     |
|---------------|-------------------|-----------------------------------------------------------|
| `PORT`        | `3000`            | HTTP-Port                                                 |
| `HOST`        | `0.0.0.0`         | Bind-Adresse                                              |
| `DATA_DIR`    | `./data`          | Datenbank, Uploads, Backups                               |
| `HALLE_TZ`    | `Europe/Berlin`   | Zeitzone für "heute" (Deadlines, Countdown)               |
| `TRUST_PROXY` | nicht gesetzt     | z. B. `loopback` hinter nginx (echte IP, Secure-Cookies)  |
| `GEMINI_API_KEY` | nicht gesetzt  | v4.1: KI-Serienmaße (am einfachsten in `.env`)            |

Dauerbetrieb mit pm2:

```bash
npm install -g pm2
pm2 start server.js --name halle
pm2 save && pm2 startup
```

Oder als systemd-Dienst (`/etc/systemd/system/halle.service`):

```ini
[Unit]
Description=HALLE//OS
After=network.target

[Service]
WorkingDirectory=/opt/halle
ExecStart=/usr/bin/node server.js
Environment=PORT=8080 HOST=127.0.0.1 TRUST_PROXY=loopback
Restart=always
User=halle

[Install]
WantedBy=multi-user.target
```

nginx als Reverse Proxy (HTTPS z. B. per certbot):

```nginx
server {
  server_name halle.example.de;
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Backup: Admin-Konsole, Tab "System", oder einfach den Ordner `data/` sichern.

Hinweis: Tailwind läuft wie gewünscht über das Play-CDN. Die Browser-Konsole zeigt dazu einen Hinweis, das ist normal.
Für reinen Offline-Betrieb in der Halle kann später ein lokaler Tailwind-Build ergänzt werden.

## REST-API (Auszug)

Alle Endpunkte liegen unter `/api`. Lesen ab Rolle Gast, Schreiben ab Schrauber, Admin-Routen nur für Admins.

| Methode | Pfad                                   | Zweck                                         |
|---------|----------------------------------------|-----------------------------------------------|
| GET     | `/bootstrap`                           | Kompletter Map-Zustand in einem Request       |
| POST    | `/vehicles/:id/move`                   | Umparken `{ slotId \| null, slotPos, externLocation, swap }` |
| GET     | `/vehicles/:id`                        | Cockpit-Daten (Aufgaben, Log, Budget, Dokumente) |
| POST    | `/vehicles/:id/documents`              | Upload (multipart, Feld `file`)               |
| POST    | `/tasks/:id/done`                      | Erledigt, wandert ins Wartungsheft            |
| GET     | `/whiteboard`                          | Priorisierte Aufgaben nach Event-Deadline     |
| GET     | `/events/:id/packlist`                 | Deduplizierte Packliste                       |
| POST    | `/events/:id/packlist/check`           | `{ itemKey, packed }`                         |
| GET     | `/search?q=`                           | Spotlight                                     |
| GET     | `/shelves/:id`                         | Regal-Frontansicht                            |
| POST    | `/admin/import/preview` + `/commit`    | CSV-Import                                    |
| GET/POST| `/blueprint`                           | Leitungen und Knoten                          |
| POST    | `/devices/:id/action`                  | `{ action: "on" \| "off" \| "toggle" }`       |
| GET     | `/devices/:id/snapshot`                | Webcam-Standbild (Proxy)                      |
| GET     | `/tyrehub`                             | Reifenlager komplett                          |
| POST    | `/tyres/burn`                          | `{ vehicle_id, count }` Driftreifen abbuchen  |
| POST    | `/tyres/:id/mount` / `unmount`         | Komplettrad bauen / trennen                   |
| POST    | `/supplies/:id/adjust`                 | `{ delta }` Vorrat ändern                     |
| GET/POST| `/vehicles/:id/setups`, `/setups`      | Setup-Sheets                                  |
| GET     | `/ticker`                              | Daten für das LED-Laufband                    |
| POST    | `/tyres/dispose`                       | `{ ids: [...] }` oder `{ all: true }` Altreifen austragen |
| GET     | `/vehicle-models`                      | Modell-Liste (Standard + eigene)              |
| POST/PUT/DELETE | `/admin/vehicle-models[/:id]`  | Modelle verwalten (Admin)                     |
| GET/POST/PUT/DELETE | `/trailers[/:id]`          | Anhänger-Fuhrpark                             |
| GET/POST/DELETE | `/events/:id/loading`          | Gespann-Plan lesen, speichern, zurücksetzen   |
| POST    | `/events/:id/loading/preview`          | Zuordnung prüfen ohne zu speichern            |
| GET     | `/tv/data?key=`                        | Daten für das Hallen-TV                       |
| GET/PUT | `/admin/tv`                            | TV-Einstellungen (Admin)                      |
| GET     | `/hud`                                 | Kritischer Mangel, Verbrauch, "liegt rum"     |
| POST    | `/consumables/:id/use`                 | `{ amount }` oder `{ empty: true }`, optional `{ vehicle_id }` |
| POST    | `/consumables/:id/refill` / `count`    | Nachkauf `{ containers }` / Inventur `{ qty }` |
| POST    | `/consumable-moves/:id/undo`           | Buchung zurücknehmen                          |
| GET     | `/shopping`                            | Einkaufsliste (Kritisches zuerst)             |
| POST    | `/cars/fetch-dimensions`               | `{ car_name }` Serienmaße via Gemini          |
| GET     | `/shopping/radar`                      | Demnächst einkaufen (Mangel-Radar)            |
| POST    | `/shopping-list`, `/:id/bought`        | Hallen-Einkaufsliste                          |
| POST    | `/consumables/:id/stock-in`            | Einlagern (Gebinde +N oder neues Gebinde)     |
| GET/POST| `/floating`, `/floating/:id/return`, `/floating/return-all` | Schwebe-Status        |

Für Skripte oder Geräte: Header `Authorization: Bearer <Session-Token>`.

## Erweitern

* **Neue API:** Datei in `server/routes/` anlegen und in `server.js` mit `app.use(...)` einhängen.
* **Neue Tabelle oder Spalte:** in `server/db.js` (`CREATE TABLE IF NOT EXISTS` bzw. `ensureColumn(...)`).
* **Neues Fahrzeugmodell:** Admin-Konsole, Tab "Fahrzeug-Modelle". Der Sprite wird aus der gewählten Silhouette gezeichnet.
* **Smarte Steckdose / Heizung:** Treiber in `server/devices/drivers.js` ergänzen, Gerät in der Admin-Konsole anlegen.
* **Webcam:** Gerät vom Typ "Webcam" mit Snapshot-URL anlegen, Bild über `/api/devices/:id/snapshot`.
* **Neues Frontend-Panel:** Modul in `public/js/` anlegen und in `public/app.js` bei `PANELS` registrieren.

## CSV-Vorlage

`beispiel-import.csv` zeigt das erwartete Format. Spaltennamen werden automatisch erkannt
(Name/Bezeichnung, Kategorie, Anzahl, Zustand, Regal, Etage, Box, Auto, Event, Teilenummer, Notiz).
