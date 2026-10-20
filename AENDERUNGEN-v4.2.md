# HALLE//OS Version 4.2: Änderungsliste

Inventar, Kühlschrank und Kritische Liste greifen jetzt ineinander:
Werkstatt-Betriebsstoffe liegen als **Gebinde mit Lagerort** im Inventar, die Kritische Liste **summiert** sie automatisch.

Datenbank bleibt `data/halle.db`. Vor dem Start legt die App wie immer eine Sicherungskopie an.
Es werden nur **neue Spalten** (`ALTER TABLE ... ADD COLUMN` mit try/catch) und **eine neue Tabelle** angelegt.
Keine bestehende Zeile wird geändert oder gelöscht. Getestet gegen eine Kopie deiner aktuellen Datenbank:
alle alten Zeilen unverändert.

## Was sich fachlich ändert

1. **Kühlschrank-Radar = nur Getränke & Snacks.** Die zweite Tabelle "Werkstatt-Vorräte" ist aus der Chill-Ecke entfernt.
   Die alten Einträge (Bremsenreiniger, WD-40, Papiertücher) bleiben in der Datenbank, werden aber dort nicht mehr angezeigt.
   Übernehmen kannst du sie mit einem Klick im Zuordnungs-Assistenten (Admin-Konsole, "Verbrauch & Kritisch").
2. **Kritische Liste als Aggregator.** Kein "+1 Kanister aus dem Nichts" mehr. Jedes Teil im Inventar kann ein Gebinde sein:
   `Gebindemenge` + `Einheit` + "Gehört zu" (Kategorie der Kritischen Liste). Ist-Bestand = Summe aller Gebinde in der Halle,
   z. B. `2× 1 L + 1× 5 L = 7,0 L`. Der Admin pflegt in der Kritischen Liste nur noch das Soll.
3. **Einkaufs-Radar "Demnächst einkaufen"** im Whiteboard (links) und als 🛒-Knopf im HUD:
   Kritische Liste unter Soll + Kühlschrank unter Mindestbestand, jeweils mit 1 Klick auf die neue **Hallen-Einkaufsliste**.
   "Gekauft" bei einem Betriebsstoff öffnet direkt "Einlagern" (mit Lagerort), bei Getränken wird der Kühlschrank aufgefüllt.
4. **Schnell-Verbrauch** zieht zuerst aus angebrochenen Gebinden ab (kleinster Rest zuerst), dann wird das kleinste
   volle Gebinde angebrochen. Der Gesamtbestand sinkt sofort mit. Rückgängig setzt genau die betroffenen Gebinde zurück.
   "Angebrochenes leer!" bucht den Rest des angebrochenen Gebindes aus.

## Übernahme deiner bisherigen Bestände

In v4 per "Inventur" eingetragene Bestände (z. B. 8 L 0W-60, 24 Dosen Bremsenreiniger) werden beim ersten Start
**einmalig als Gebinde "(Bestand aus Inventur)" ohne Lagerort** ins Inventar übernommen (neue Zeilen in `parts`),
damit der summierte Ist-Bestand stimmt. Bitte dort später den Lagerort setzen oder in echte Gebinde aufteilen.

Deine vorhandenen Öl-Teile im Regal (z. B. "Dot 4 5L", "6HP ATF 4L", "Dextron 3 Automatic 1L") werden **nicht automatisch**
verknüpft. Der Zuordnungs-Assistent schlägt Kategorie und Gebindemenge vor, verknüpft wird erst auf deinen Klick.
Achtung beim Verknüpfen: Wenn eine Kategorie schon einen "Bestand aus Inventur" hat, nicht doppelt zählen
(dann das Inventur-Gebinde auf 0 setzen).

## Datenbank

| Was | Art | Inhalt |
|-----|-----|--------|
| `parts.pack_size` | neue Spalte | Gebindemenge, z. B. 5 |
| `parts.pack_unit` | neue Spalte | Einheit, z. B. L |
| `parts.consumable_id` | neue Spalte | Kategorie der Kritischen Liste |
| `parts.open_rest` | neue Spalte | Rest im angebrochenen Gebinde (leer = keins offen) |
| `consumable_moves.detail` | neue Spalte | welches Gebinde wie viel abgegeben hat (für Rückgängig) |
| `shopping_list` | neue Tabelle | Hallen-Einkaufsliste (offen, gekauft, entfernt) |
| `settings` | neue Merker | `mig_v42_stock`, `v42_imported_supplies` |

## Dateien

| Datei | Status | Änderung |
|-------|--------|----------|
| `server/db.js` | geändert | neue Spalten und Tabelle, einmalige Übernahme der Inventur-Bestände |
| `server/lib/stock.js` | **neu** | Gebinde-Summe, Abzug (angebrochen zuerst, dann kleinstes Gebinde), Rückgängig |
| `server/lib/hub.js` | geändert | Ist-Bestand aus dem Inventar, Einkaufs-Radar, Einkaufsliste, HUD-Daten |
| `server/routes/hub.js` | geändert | Verbrauch aus Gebinden, Einlagern, Einkaufsliste, Zuordnungs-Assistent; "Kanister +1" und "Inventur" an der Liste abgeschaltet |
| `server/routes/inventory.js` | geändert | Teile speichern Gebindemenge, Einheit, Kategorie, angebrochenen Rest |
| `server/routes/chill.js`, `core.js`, `tv.js` | geändert | Kühlschrank-Daten nur noch Getränke & Snacks |
| `public/js/quickuse.js` | geändert | Kacheln mit Gebinde-Aufschlüsselung, Gebinde-Ansicht, Einlagern mit Lagerort, Reiter "Einkauf" mit Radar und Liste |
| `public/js/storage.js` | geändert | Teile-Formular: Block "Gebinde & Kritische Liste", Anzeige im Lager |
| `public/js/supplies.js` | geändert | Chill-Ecke nur noch Getränke & Snacks, Knopf "Auf die Einkaufsliste" |
| `public/js/hud.js` | geändert | 🛒-Knopf im HUD |
| `public/js/whiteboard.js` | geändert | Karte "Demnächst einkaufen" mit 1-Klick-Übernahme |
| `public/js/admin-v4.js` | geändert | Soll statt Bestand, Gebinde-Anzeige, Zuordnungs-Assistent |
| `public/style.css` | geändert | Stil für 🛒 und HUD am Handy |
| `README.md` | geändert | Abschnitt "Neu in Version 4.2" |
| `AENDERUNGEN-v4.2.md` | **neu** | diese Liste |
