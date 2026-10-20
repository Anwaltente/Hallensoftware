# HALLE//OS Version 5.2: TV-Baukasten, Werkzeug-Verleih, CSV-Zielfach, Quick Specs, Spur in mm, Blueprint-Layer

**Datenbank:** weiterhin `data/halle.db` (bzw. Turso, falls eingerichtet). Nur sichere Migrationen:
neue Spalten per `ALTER TABLE ... ADD COLUMN` (mit Fehlerabfangung) und eine neue Tabelle per `CREATE TABLE IF NOT EXISTS`.
Geprüft gegen eine Kopie der Datenbank: alle alten Zeilen aller Tabellen unverändert, die TV-Einstellungen bleiben, wie sie sind.

| Neu | Zweck |
| --- | --- |
| Tabelle `dashboard_configs` | Seiten des TV-Baukastens (Name, Raster, Kacheln als JSON, eigene Dauer, Reihenfolge, aktiv) |
| `tools.lent_to`, `lent_at`, `lent_due`, `lent_note` | Werkzeug außer Haus verliehen |
| `vehicles.quick_specs` | Spickzettel (JSON) |
| `setups.toe_front_mm`, `setups.toe_rear_mm` | Spur in mm je Achse |

## 1. No-Code TV-Dashboard (`/tv`, `/dashboard`)

Admin-Konsole → **TV-Dashboard** → **Dashboard-Baukasten**:
* **Raster** je Seite: Vollbild, Split-Screen, Oben/Unten, 3 Spalten, 2 × 2 Kacheln, Groß + 2 klein, 3 × 2 Kacheln.
* **Kacheln** per Auswahlliste oder **Drag & Drop** belegen (Widget aus der Palette in die Kachel ziehen, Kacheln untereinander tauschen):
  Event-Countdown & Packliste · Wer schraubt woran? · Heute zu tun · Mangel-Radar (kritische Stoffe & Getränke unter Mindestbestand) ·
  Werkzeug-Radar (verliehen / schwebend / überfällig) · Hallen-Belegung (freie Plätze) · Text-Banner / Laufband (Farbe wählbar) · Wetter.
  Optional eigene Überschrift je Kachel.
* **Mehrere Seiten** rotieren: allgemeines Intervall oder eigene Dauer je Seite, Reihenfolge per ▲▼, Seiten kopieren, aktiv/inaktiv,
  Vorschau einer einzelnen Seite (Auge-Symbol, `&slide=ID`).
* Schalter **„Eigene Seiten auf dem TV“**: aus = das TV zeigt wie bisher die Standard-Screens. Zwei Beispiel-Seiten sind angelegt.
* Alles wird sofort gespeichert (Tabelle `dashboard_configs`); das TV übernimmt Änderungen beim nächsten Abruf (spätestens 30 s).
* Texte und lange Event-Namen passen sich automatisch der Kachelgröße an.

## 2. Werkzeug: „Außerhalb der Halle / Verliehen“

* Neuer Knopf **Verleihen** an jedem Werkzeug: an wen (Name/Firma/Kumpel, mit Vorschlägen), Verleihdatum (heute vorausgefüllt),
  erwartete Rückgabe (Schnellwahl morgen, 3 Tage, 1 Woche, 2 Wochen, 1 Monat, offen), Notiz.
* **Überfällig** (Rückgabedatum vorbei): leuchtet im Werkzeug-Menü rot (Karte + Warnleiste „Überfällig: [Werkzeug] bei [Name] seit X Tagen!“),
  im HUD (roter Knopf, Klick öffnet das Werkzeug), auf dem TV (Werkzeug-Radar, Alarmstreifen, Laufband, Aufgaben-Screen).
* **1 Klick „Wieder in der Halle“**: Status zurück, das Werkzeug gilt wieder an seinem Stammplatz (Regal/Box/Ort bleiben gespeichert).
* Filter „Außer Haus“ in der Werkzeugliste; die Büro-Ansicht zeigt „Verliehen an …“ bzw. „Rückgabe überfällig“.

## 3. CSV-Import mit Zielfach

Admin-Konsole → CSV-Import → nach der Vorschau: **Zielfach** wählen (Regal, Ebene 1 bis 4, Eurobox oder „+ Neue Box …“).
* Zeilen **ohne** eigenen Lagerort landen im Zielfach. Steht nur eine Box (ohne Regal) in der CSV, wird sie im Zielregal angelegt.
* Zeilen **mit** Regal/Box in der CSV behalten ihren Lagerort (Spalten-Mapping „Regal“ und „Box“ wie bisher).
* Optional: „Lagerort aus der CSV ignorieren, ALLE Zeilen ins Zielfach“.

## 4. Quick Specs (Fahrzeug-Spickzettel)

Neuer Reiter im Cockpit direkt nach „Aufgaben“: Radschrauben-Drehmoment (Nm) + Schraube/Schlüssel, Füllmengen und Viskositäten
(Motoröl, Getriebeöl, Diff-Öl, Kühlmittel), Zündkerzentyp + Elektrodenabstand, Reifendrücke kalt/warm vorn/hinten, eigene Zusatzwerte, Notizen.
Große Kacheln, am Handy zweispaltig. Reifendrücke ohne eigenen Eintrag kommen automatisch aus dem aktuell gefahrenen Setup.

## 5. Setup: Spur in mm, Sturz in Grad

* **Spur (Toe)** jetzt in **Millimetern** als Summe je Achse (`+1,5 mm` Vorspur, `-2,0 mm` Nachspur): Eingabe „Spur vorn / hinten“,
  gespeichert in `toe_front_mm` / `toe_rear_mm`. **Sturz** bleibt in Grad.
* Die Draufsicht dreht die Räder proportional zu den mm-Werten (je Rad die halbe Achs-Spur, stark überhöht) und zeigt die Summen.
* Alte Setups mit Spur in Grad: Die Werte werden **nur zur Anzeige** in mm umgerechnet (Felgendurchmesser aus den Rad-Daten, sonst 17 Zoll)
  und mit Hinweis vorausgefüllt. Gespeichert wird erst, wenn du auf Speichern drückst; die alten Gradwerte bleiben in der Datenbank erhalten.
* Prüfprotokoll (Büro-Ansicht) und Strecken-Historie zeigen die Spur in mm.

## 6. Blueprint: Layer einzeln an- und abschalten

Im Blueprint-Modus unten links: Checkboxen je Layer, mit Anzahl der Elemente, „alle“/„keine“, Auswahl bleibt im Browser gespeichert.
| Layer | Farbe | Inhalt |
| --- | --- | --- |
| Druckluftnetz | Neon-Blau | Leitungen, Kompressor, Wasserabscheider, Kupplungen, **Schlauchtrommeln (neu)** |
| 230V Stromnetz | Gelb/Orange | Leitungen, Steckdosen, Licht, **Lichtschalter (neu)**, **Lampen (neu)** |
| 400V Starkstrom | Rot/Violett | Leitungen, CEE-Dosen |
| Sicherungskasten / Unterverteiler | Neon-Grün | Unterverteiler, **Sicherungskasten/Hauptverteilung (neu)** |
| Netzwerk / Daten | Lila | Datenleitungen |

Ausgeblendete Elemente sind nicht anklickbar; ein neu gezeichnetes Element schaltet seinen Layer automatisch wieder ein.
Die Art-Auswahl im Editor ist nach Layern gruppiert. Vorhandene Leitungen und Punkte bleiben unverändert (nur die Darstellungsfarben sind neu).

## Getestet

Chromium Desktop (1600 × 950, TV 1920 × 1080) und Handy (390 × 844), Spiel- und Büro-Ansicht, lokale Datenbank und Turso-Testserver:
Verleih-Dialog, Überfällig-Alarm (Werkzeug, HUD, TV), Rückgabe, Quick Specs speichern, Spur mm speichern + Umrechnung, CSV mit neuer Box,
Blueprint-Layer, Baukasten (Drag & Drop, Raster, Banner, Reihenfolge, TV-Schalter), TV-Rotation und Einzelvorschau, klassische TV-Screens.
