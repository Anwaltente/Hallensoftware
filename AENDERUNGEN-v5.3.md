# HALLE//OS Version 5.3: App, Aktivitäts-Log, Handy-Regal, PDF, Such-Pin, Team-Auslastung

## Datenbank (nur sichere Migrationen)

Bestehende Tabellen und Daten werden nicht verändert oder gelöscht. Neu sind ausschließlich:

| Art | Name | Zweck |
| --- | --- | --- |
| Spalte (`ALTER TABLE ... ADD COLUMN`, abgesichert) | `tasks.estimated_hours` | geschätzter Aufwand in Stunden |
| Spalte | `tasks.assigned_user` | zuständige Person (`users.id`), leer = offener Pool |
| Spalte | `tasks.target_date` | geplantes Fertigstellungsdatum |
| Spalte | `tasks.progress_note`, `tasks.paused_at`, `tasks.paused_by` | „Nicht fertig geworden“: was noch zu tun ist |
| Spalte | `maintenance_log.parts_used` | verwendete Teile / Flüssigkeiten (für den PDF-Export) |
| Tabelle (`CREATE TABLE IF NOT EXISTS`) | `activity_logs` | Aktivitäts- und Audit-Log |

Geprüft gegen eine Kopie der Datenbank: alle bisherigen Zeilen aller Tabellen unverändert.

**Turso:** `activity_logs` wird bewusst **nicht** in den Lese-Spiegel geladen (die Tabelle wächst mit jedem Klick).
Sie wird direkt in Turso gelesen und geschrieben; Klicks werden gesammelt und in einer Anweisung gespeichert
(etwa alle 1,5 s), damit nicht jeder Klick eine eigene Anfrage auslöst. Der Spiegel für alle anderen Tabellen bleibt unverändert schnell.

## 1. App auf dem Homescreen (PWA)

* `public/manifest.json`: Name „Hallen-Manager“, Kurzname „Halle“, Start `/`, `standalone`, Hochformat, Farben im Industrial-Dark-Look.
  Icons 192 und 512 px (normal und „maskable“ für Android), Apple Touch Icon 180 px, SVG. Kurzbefehle (lange auf das Icon drücken): Suche, Team-Auslastung.
* `public/index.html`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` = `black-translucent`, Apple Touch Icon, Manifest.
  Die Kopfzeile rückt auf dem iPhone unter die Statusleiste (Safe Area).
* `public/sw.js`: schlanker Service Worker. Seiten, JavaScript und CSS kommen immer zuerst frisch vom Server (Cache nur ohne Netz),
  Icons aus dem Cache, `/api` und `/files` werden **nie** zwischengespeichert.
* Profilmenü: „Als App auf den Homescreen“ (Android: Installations-Dialog, iPhone: kurze Anleitung über Teilen → Zum Home-Bildschirm).

Hinweis: Ein Service Worker funktioniert nur über HTTPS (bei Render automatisch) oder auf `localhost`.

## 2. Aktivitäts- & Audit-Log (Admin → Aktivität)

* **Meilensteine:** Anmeldungen, Abmeldungen / Profilwechsel, fehlgeschlagene PIN-Eingaben, Materialentnahmen (Schnell-Verbrauch),
  Fahrzeug umgeparkt (von wo nach wo), To-do erledigt, Arbeit pausiert, Setup angelegt / geändert (mit Vorher → Nachher je Wert) / aktiviert / gelöscht.
* **Alle Klicks & Ereignisse:** jeder Klick mit Zeitstempel und Ort („Klickte „Wartungsheft“ (E46 Drift Coupé)“), „Öffnete Regal B“,
  „Klickte auf Auto E46 (Hallenkarte)“, „Startete Suche nach „Querlenker““, außerdem jede Änderung über den Server („Teil geändert: „Bremsbeläge VA““).
* Filter: Person, Von / Bis, Heute / 7 Tage / 30 Tage / Alles, Suchtext. Zeile antippen zeigt Details. „Ältere Einträge laden“ blättert weiter.
* Datenschutz: PIN-Eingaben und der Anmeldebildschirm werden nie protokolliert, Inhalte von Eingabefeldern auch nicht.
  Felder wie PIN, Token, Passwort, Schlüssel werden vor dem Speichern entfernt. Es wird keine IP-Adresse gespeichert, nur grob das Gerät (z. B. „iPhone · Safari“).
* Das Protokoll löscht nichts automatisch.

## 3. Handy: verschachteltes Akkordeon-Regal

Auf schmalen Bildschirmen (bis 767 px) im Lager-Reiter und beim Öffnen eines Regals:

1. **Regal-Tabs** (Regal A | Regal B ...)
2. **Etagen** 1 bis 4 als aufklappbare Balken (mit Anzahl Boxen / Teile / lose Teile)
3. **Inhalt der Etage:** Euroboxen und „Freifläche“ (lose Teile) als kompakte Kacheln, Admins zusätzlich „+ Box“
4. **Box-Inhalt** erst nach Antippen, mit Suchzeile (ab 5 Einträgen), „Teil in diese Box“, QR-Code, Box bearbeiten

Standardmäßig ist alles eingeklappt. Kommt man über die Suche oder „Im Regal zeigen“, öffnen sich genau Etage und Box, das Teil blinkt.
Die lange Teileliste darunter erscheint am Handy erst bei Suche, Filter oder auf Knopfdruck. Am Desktop bleibt die Frontansicht.

## 4. Wartungshistorie als PDF

Cockpit → Wartungsheft → **„📄 Wartungshistorie als PDF exportieren“**. Erzeugt auf dem Server, ohne Zusatzpakete:

* Kopf: Fahrzeug / Spitzname, Modell, Kennzeichen, FIN, Kilometerstand, TÜV, Anzahl Einträge, Summe Kosten, Exportdatum
* Tabelle: Datum, Km-Stand, durchgeführte Arbeit, erledigt von, Teile & Flüssigkeiten, Notizen, Kosten (Seitenumbruch mit wiederholter Kopfzeile)
* Fußzeile mit Seitenzahl, Feld für Ort / Datum und Unterschrift / Stempel
* Teile & Flüssigkeiten: neues Feld „Verwendete Teile / Flüssigkeiten“ beim manuellen Eintrag, Schnell-Verbrauch-Buchungen und verknüpfte Einkäufe

## 5. Such-Pin auf der Hallenkarte

Suche (Strg+K oder Lupe) → Treffer wählen: Für Teile, Werkzeug, Euroboxen, Reifen und Kühlschrank-Vorräte erscheint am physischen Ort
ein pulsierender Neon-Pin mit Fahne „Hier: 10er Nuss“ (darunter z. B. „Regal A · Etage 2 · Elektrik“). Die Kamera fliegt hin.

* Pin antippen: Kamera zoomt ganz nah heran. Leiste oben: Zoom, **Öffnen** (Regal/Box mit markiertem Teil), ausblenden.
* Ort wird bestimmt aus: Regal + Box (Position entlang des Regals), Werkzeug „in Benutzung“ am Auto, Dinge die „rumliegen“,
  Freitext-Orten wie „Werkzeugwand“, „Werkbank“, „Kompressor“, „Regal A, Etage 3“. Verliehene Werkzeuge bekommen keinen Pin.
* In der Büro-Ansicht (ohne Karte) bleibt es beim direkten Öffnen.

## 6. Aufgaben: Zeit, Zuständigkeit, Zieldatum, Pause, Team-Auslastung

* Neue Felder je Aufgabe: **Zeit (Std.)**, **Zuständig** (Person oder „offen für alle“), **Zieldatum**. Im Cockpit beim Anlegen
  und über das Uhr-Symbol (Planen). Das Zieldatum zählt im Whiteboard wie eine Deadline (das frühere von Zieldatum und Event gewinnt).
* **Arbeit pausieren / Nicht fertig** (Pause-Symbol an der Aufgabe, im Whiteboard und an der eigenen Live-Karte):
  „Was ist noch zu tun?“ + geschätzt fertig am + Restaufwand. Die laufende Arbeit endet, das Auto bleibt „In Arbeit“ und bekommt
  auf der Hallenkarte einen orangefarbenen Rahmen mit Badge **„⏸ IN ARBEIT · TO-DO OFFEN“** (Rest-To-do auch in der Info beim Darüberfahren).
  Wer wieder „Ich schraube daran“ drückt, hebt die Pause auf; erledigt entfernt das Badge.
* **Team-Auslastung** (Whiteboard → „Team“, Profilmenü oder Homescreen-Kurzbefehl): eine Spalte je Person plus
  „Nicht zugewiesen (Offener Pool)“, jeweils mit Anzahl und Summe der geschätzten Restzeit, z. B. „Oliver: 3 Aufgaben (ca. 5,5 Std.)“.
  Aufgaben am Griff ⠿ per Drag & Drop verschieben (Maus und Touch), oder per Klick: „Ich mach das“, „Übernehmen“, „Zuweisen“.

## Geänderte / neue Dateien

| Datei | |
| --- | --- |
| `server/db.js` | neue Spalten, neue Tabelle `activity_logs` |
| `server/lib/activity.js`, `server/routes/activity.js` | **neu**: Aktivitäts-Log |
| `server/lib/pdf.js`, `server/lib/history-pdf.js` | **neu**: PDF-Erzeugung |
| `server/lib/locate.js` | **neu**: Lagerort für den Such-Pin |
| `server/lib/turso/replica.js` | `activity_logs` wird nicht gespiegelt |
| `server/routes/workshop.js` | Zeit, Zuständig, Zieldatum, Pause, Zuweisen, `/workload`, Teile im Wartungsheft |
| `server/routes/auth.js`, `hub.js`, `vehicles.js`, `chill.js` | Meilensteine im Log, PDF-Route |
| `server/routes/core.js` | Suche liefert den Pin-Ort |
| `server/lib/whiteboard.js`, `queries.js`, `server/auth.js`, `server.js` | Zieldatum als Deadline, Pause-Badge, Log-Middleware, PWA-Header |
| `public/manifest.json`, `public/sw.js`, `public/icons/*` | **neu**: PWA |
| `public/js/pwa.js`, `track.js`, `workload.js`, `admin-activity.js` | **neu** |
| `public/index.html`, `app.js`, `style.css`, `biz.css` | Meta-Tags, Pin-Leiste, Styles |
| `public/js/map.js`, `spotlight.js`, `storage.js`, `whiteboard.js`, `cockpit.js`, `admin.js`, `auth.js`, `biz.js`, `ui.js` | Funktionen oben |

## Getestet

* Browser-Tests Desktop und Handy, Werkstatt- und Büro-Ansicht: Such-Pin (Desktop und Handy), Zoom, Öffnen; Akkordeon (Panel und Dialog);
  Team-Auslastung mit Drag & Drop; Pause-Dialog; Cockpit-Planung; PDF-Knopf; Admin-Aktivität (beide Ebenen, Details)
* PDF: 1 Seite und 5 Seiten (52 Einträge, lange Texte, Umlaute, €), mit `qpdf` geprüft und gerendert
* Turso-Modus gegen den strengen Testserver: alle neuen Endpunkte, Aktivitäts-Log direkt in Turso, Lese-Spiegel lädt dadurch nichts nach
* Datensicherheit: Kopie der Datenbank migriert, alle Altzeilen aller Tabellen unverändert
* Bisherige Tests (Budget, Büro-Ansicht, Drag & Drop, v5.2) ohne Fehler
