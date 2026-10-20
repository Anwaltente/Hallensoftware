# HALLE//OS Version 5.1: Turso-Datenbank und Budget-Kopplung

## 1. Datenbank bei Turso

Sind die Umgebungsvariablen gesetzt, liegen alle Daten in Turso statt in `data/halle.db`:

```
TURSO_DATABASE_URL=libsql://halle-db-anwaltente.aws-eu-west-1.turso.io
TURSO_AUTH_TOKEN=<Token aus dem Turso-Dashboard>
```

Erkannt werden auch andere übliche Namen (`TURSO_URL`, `LIBSQL_URL`, `TURSO_TOKEN`, `DATABASE_AUTH_TOKEN` ...).
Beim Start steht im Log, welche Variablen benutzt wurden (der Token selbst wird nie ausgegeben).
Ohne diese Variablen arbeitet die App unverändert mit der lokalen Datei `data/halle.db`.

### Bestehende Daten nach Turso bringen (einmalig)

Auf dem Rechner, auf dem die echte `data/halle.db` liegt:

1. In die Datei `.env` im Projektordner `TURSO_DATABASE_URL` und `TURSO_AUTH_TOKEN` eintragen.
2. Optional erst prüfen: `npm run turso:import -- --pruefen` (schreibt nichts).
3. Übertragen: `npm run turso:import`

Das Skript
* liest `data/halle.db` nur (es öffnet eine Kopie in einem Temp-Ordner, das Original bleibt unberührt),
* überträgt alle Tabellen exakt (Ganzzahlen bleiben Ganzzahlen, Kommazahlen bleiben Kommazahlen, auch die ID-Zähler),
* vergleicht am Ende jede Tabelle Zeile für Zeile per Prüfsumme und meldet "stimmen exakt überein",
* bricht ab, wenn Turso schon Daten enthält. Sind das nur Test- oder Beispieldaten: `npm run turso:import -- --ersetzen`
  (der Turso-Inhalt wird vorher als Datei nach `data/backups/` gesichert).

Danach den Server auf Render neu starten (bzw. neu deployen).

### Schutz vor Datenverlust

* Eine **leere** Turso-Datenbank wird beim Start **nicht** automatisch mit Beispieldaten gefüllt. Der Server bricht mit einem
  klaren Hinweis ab (Render lässt dann die bisherige Version weiterlaufen). Wer bewusst neu anfangen will: `HALLE_TURSO_INIT=1`.
* Vor den Migrationen legt der Server wie bisher eine Sicherungskopie an (jetzt als SQLite-Datei aus Turso, `data/backups/auto`).
* `npm run turso:backup` sichert Turso jederzeit als normale `.db`-Datei; der Backup-Knopf in der Admin-Konsole funktioniert weiter.
* `npm run reset-db` ist mit Turso gesperrt.

### Technik

* Keine neuen npm-Pakete. Die Anbindung spricht das offizielle Turso-HTTP-Protokoll (Hrana, `/v2/pipeline`).
* **Schreiben** geht immer sofort und direkt in Turso (Turso ist die einzige Wahrheit), Transaktionen laufen echt auf dem Turso-Server.
* **Lesen** kommt aus einem Spiegel im Arbeitsspeicher des Servers: Seiten laden so schnell wie mit der lokalen Datei.
  Nach jedem Schreiben wird der Spiegel sofort nachgezogen; zusätzlich wird er spätestens alle 15 s komplett erneuert
  (`HALLE_TURSO_SYNC_S`), damit auch Änderungen von außen ankommen. Innerhalb einer Transaktion wird direkt in Turso gelesen.
* Große CSV-Importe werden mit Turso in Etappen gespeichert (eine Cloud-Transaktion darf nur wenige Sekunden dauern).
* Tipp: Render-Region **Frankfurt** wählen; die Turso-Datenbank liegt in `aws-eu-west-1` (Irland), das hält die Wege kurz.

**Wichtig für Render:** Hochgeladene Dateien (Fahrzeugschein, Dokumente) liegen weiterhin im Ordner `data/uploads`, nicht in der
Datenbank. Ohne "Persistent Disk" gehen sie bei Render bei jedem Neustart verloren.

## 2. Budget-Kopplung (keine doppelte Eingabe mehr)

| Wo eingetragen | Was im Budget passiert |
| --- | --- |
| Aufgabe mit **Preis** (neues Feld "Preis €" oder €-Knopf an jeder offenen Aufgabe) | erscheint automatisch unter **Noch zu kaufen** |
| Diese Aufgabe **erledigt** | dieselbe Zeile wandert nach **Bereits gekauft** und hängt am neuen Wartungsheft-Eintrag (Kosten = Preis) |
| Aufgabe wieder geöffnet | Zeile zurück nach "Noch zu kaufen" |
| Aufgabe gelöscht | geplante Ausgabe entfällt; schon getätigte bleibt |
| **Wartungsheft**, manueller Eintrag mit Kosten | erscheint automatisch unter **Bereits gekauft** |
| Wartungsheft-Eintrag gelöscht | seine Budget-Zeile entfällt |

* Pro Vorgang genau **eine** Budget-Zeile, markiert mit "aus Aufgabe" bzw. "aus Wartungsheft". Diese Zeilen werden an der Quelle
  geändert (Budget zeigt ein Ketten-Symbol statt Löschen). "Gekauft ✓" geht bei Aufgaben-Zeilen weiterhin (Teil schon besorgt).
* Verbrauchsbuchungen aus dem Schnell-Verbrauch zählen nicht ins Budget (das Material steht schon beim Einkauf drin).
* **Bisherige Einträge:** Beim ersten Start werden vorhandene Wartungsheft-Kosten einmalig ins Budget übernommen.
  Gab es im Budget desselben Autos schon einen gekauften Artikel mit genau diesem Betrag (also bisher doppelt eingetragen),
  wird er nur verknüpft statt verdoppelt. Bestehende Zeilen werden dabei nicht verändert oder gelöscht.

### Datenbank-Änderungen (nur sichere Migrationen)

* neue Spalten `tasks.cost`, `purchases.task_id`, `purchases.log_id` (`ALTER TABLE ... ADD COLUMN` mit try/catch)
* einmalige Übernahme (Merker `mig_v51_budget` in `settings`): nur neue Zeilen in `purchases` bzw. Eintrag in der neuen Spalte `log_id`
* geprüft gegen eine Kopie der Datenbank: alle alten Zeilen aller Tabellen unverändert

## Geänderte / neue Dateien

| Datei | |
| --- | --- |
| `server/lib/turso/config.js`, `database.js`, `replica.js`, `sync-http.js` | **neu**: Turso-Anbindung |
| `scripts/turso-import.js`, `scripts/turso-backup.js` | **neu**: Import und Sicherung (`npm run turso:import`, `npm run turso:backup`) |
| `server/lib/budget.js` | **neu**: Budget-Kopplung |
| `server/db.js` | wählt lokal oder Turso, neue Spalten, Budget-Übernahme |
| `server/routes/workshop.js` | Aufgaben/Wartungsheft halten das Budget aktuell |
| `server/routes/admin.js` | CSV-Import mit Turso in Etappen |
| `public/js/cockpit.js` | Preis bei Aufgaben, Kennzeichnung im Budget |
| `package.json`, `.env.example`, `README.md`, `server.js` | Skripte und Beschreibung |

## Getestet

* Turso-Protokoll gegen einen lokalen Hrana-Testserver: Import (prüfen, importieren, ersetzen), Vergleich jeder Tabelle inkl. Typen,
  ID-Zählern und Indizes: identisch, Quelle unverändert.
* 600 zufällige Schreib-Operationen (Einfügen, Ändern, Löschen mit Kaskaden, Upsert, Transaktionen, Rollback, verschachtelt):
  Spiegel stimmt nach jeder einzelnen Operation exakt mit Turso überein.
* Komplette App im Turso-Modus (Browser-Tests Desktop und Handy, API-Test): 26 Endpunkte liefern exakt dasselbe wie die App
  mit einer lokalen Kopie der Turso-Daten.
* Falscher Token, Turso nicht erreichbar, leere Datenbank: klare Fehlermeldungen, nichts wird angelegt.

## Nachtrag 5.1.1: Fehler "HTTP 400 ... expected internally tagged enum Value"

**Ursache:** Nach einem `UPDATE ... WHERE id = ?` holt die Turso-Anbindung die geänderte Zeile in derselben Anfrage nach
(für den Lese-Spiegel). Diese Folgeabfrage hat die ID als nackten Wert (`"12"` aus der URL) statt als Turso-Wert
`{ "type": "integer", "value": "12" }` gesendet. Turso lehnt dann die **ganze** Anfrage ab, also auch das eigentliche UPDATE.
Betroffen waren sporadisch alle Änderungen über eine ID (Status-Wechsel, Quick-Use/Gebinde, Setup, Aufgaben-Preis ...).
Daten wurden dabei nicht beschädigt: Die Anfrage wurde komplett abgewiesen.

**Behebung**
* `server/lib/turso/values.js` (neu): **jeder** Parameter wird direkt vor dem Senden geprüft und bei Bedarf umgewandelt:
  `undefined` und `NaN` werden `null`, Zahlen werden `integer`/`float`, Texte `text`, Objekte JSON-Text, Wahr/Falsch 1/0.
  Damit kann kein roher Wert mehr bei Turso ankommen, egal von welcher Stelle im Code.
* Die Folgeabfrage im Lese-Spiegel sendet die ID jetzt korrekt (und als Zahl).
* `server/lib/util.js`: IDs aus URL/Body (`"12"`) werden in `mustGet`/`updateRow` als Zahl übergeben, `undefined` in
  `insertRow`/`updateRow` als `NULL`.
* Bei einem HTTP-Fehler von Turso steht jetzt die betroffene SQL-Anweisung im Log.

Hinweis: Die App benutzt nicht `@libsql/client` / `db.execute`, sondern eine eigene, schlanke Turso-Anbindung mit der
gewohnten Schnittstelle (`db.prepare(...).run/get/all`). In `server.js` selbst gibt es keine Datenbankaufrufe.

Getestet gegen einen Testserver, der Parameter genauso streng prüft wie Turso: Die alte Version erzeugt dort exakt diese
Fehlermeldung, die neue nicht mehr (Zufallstest mit 600 Operationen, IDs abwechselnd als Text und Zahl, API- und Browser-Tests).
