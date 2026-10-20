# HALLE//OS Version 5: Büro-Ansicht (Enterprise- / Stealth-Modus)

Eine zweite Oberfläche für dieselbe App: hell, sachlich, tabellarisch. Gleiche Daten, gleiche Funktionen.

**Datenbank:** bleibt exakt `data/halle.db`. Version 5 ändert **nichts** am Server und **nichts** an der Datenbank:
keine neue Tabelle, keine neue Spalte, keine Migration, keine Einstellung. Es wurden ausschließlich Dateien im Ordner `public/` angepasst.
Die gewählte Ansicht wird nur im Browser gespeichert (`localStorage`, Schlüssel `halle.view`), nicht in der Datenbank.

## Umschalten

| Weg | Wirkung |
| --- | --- |
| Klick auf den eigenen Namen (oben rechts) | Profilmenü mit `Ansicht: Werkstatt (Game)` / `Ansicht: Enterprise (Büro / ERP)`, Ton an/aus, Abmelden |
| **Alt + B** (Mac: Option + B) | wechselt hin und zurück, funktioniert auch während man in einem Feld tippt |
| **Esc** | schaltet sofort ins Büro, wenn kein Dialog offen ist. Ist ein Dialog offen, schließt Esc zuerst nur den Dialog. Im Baukasten / Blueprint-Editor bleibt Esc beim Zeichnen. |

Zurück in die Werkstatt geht es mit Alt + B oder über das Profilmenü (Esc schaltet bewusst nur in eine Richtung, damit
ein versehentliches Esc nie den Spiel-Look zurückholt). Die Ansicht bleibt nach Neuladen und auch auf dem Anmeldebildschirm erhalten.

## Design im Büro

* Heller Business-Look (Fiori / Linear): Systemschrift, `slate`-Grautöne, feine Linien, kompakte Abstände, dezente Icons.
* Keine Neon-Glows, kein Pulsieren, keine schwebenden Zahlen, keine Funken, keine Vibration. **Alle Sounds sind automatisch stumm**
  (die eigene Ton-Einstellung der Werkstatt-Ansicht bleibt dabei unverändert).
* Kopfzeile: **Fleet & Resource Management Portal v2.4**, eigener Browser-Tab-Titel und eigenes Favicon.
* Begriffe: Fahrbereit → Betriebsbereit, In Arbeit → In Wartung, Wartet auf Teile → Wartet auf Freigabe, Whiteboard → Aufgabenübersicht,
  Schnell-Verbrauch → Materialentnahme, "liegt rum" → Entnahmen, Einkaufen → Bedarf.

## Funktionen im Büro (Arbeitsbereich statt Hallenplan)

1. **Stellplatz- & Kapazitätsmatrix**
   Kennzahlen (Kapazität, Auslastung, Status-Zählung), Tabelle nach Zone (Hebebühnen, Stellplätze, Pufferflächen) mit Ebene oben/unten,
   Fahrzeug, Kennzeichen, Status-Auswahl und "Umsetzen nach …". Fahrzeuge lassen sich per **Drag & Drop** von Zeile zu Zeile ziehen.
   Belegte Plätze fragen wie gewohnt nach Tausch, "Außerhalb" fragt nach dem Standort. Dazu: Fahrzeuge außerhalb und Hallenressourcen
   (Regale, Reifenlager, Verpflegung, Werkzeug) mit "Öffnen".
2. **Inventar & Lagerbestand**
   Teile, Werkzeug und Euroboxen in einer Tabelle. Suchfeld, Filter nach Objektart, Lagerplatz und Status, Sortierung per Klick auf die
   Spaltenköpfe, CSV-Export. Zeile anklicken öffnet das bekannte Formular (Teil / Werkzeug) bzw. die Box im Regal.
3. **Materialentnahme / Verbrauchsbeleg erfassen**
   Buchungsmaske (Material, Menge, Kostenstelle / Fahrzeug, optional Restmenge). Bucht exakt wie der Schnell-Verbrauch
   (angebrochene, dann kleinste Gebinde), Fahrzeug-Buchungen landen im Wartungsheft. Bestandsübersicht mit Mindestbestand,
   Wareneingang und Gebinde, **Belegjournal** (Beleg-Nr. MB-000123) mit Storno innerhalb von 24 h, Bedarfsermittlung mit "Bedarf anmelden".
4. **Projekte & Termine**
   Projektliste nach Monat mit Zeitraum, Ort, Fahrzeugen, Fortschritt der **Ausrüstungs-Checkliste** (= Packliste) und Status,
   dazu ein Monatskalender. "Checkliste" öffnet die Packliste, "Neues Projekt" / "Bearbeiten" den Event-Editor.
5. **Fahrwerksgeometrie & Prüfprotokoll** (Cockpit, Reiter "Setup & Maße")
   Statt der Vektorgrafik eine Kennzahlentabelle: Sturz, Spur, Nachlauf, Fülldruck kalt/warm je Rad, Seitendifferenz links/rechts
   mit Bewertung "i. O." / "prüfen", Lenkung, Dämpfer, Stabis, Fahrhöhe. "Protokoll drucken" druckt nur die Tabelle.
   Die Werte werden weiter im Formular daneben gepflegt.

Seitenleisten (Aufgaben links, Events/Lager/Werkzeug/Fuhrpark/Anhänger rechts), Suche (Strg+K), QR-Scanner, Admin-Konsole und alle
Dialoge funktionieren unverändert, nur im hellen Look. Der Garage-Baukasten zeigt im Büro bei Bedarf den Hallenplan.
Am Handy: unterer Menüpunkt "Plätze" zeigt den Arbeitsbereich, das Dock bietet "Materialentnahme".

## Geänderte / neue Dateien

| Datei | Änderung |
| --- | --- |
| `public/biz.css` | **neu**: Büro-Design, nur aktiv bei `<html class="biz">` |
| `public/js/biz.js` | **neu**: Umschalten, Tastenkürzel, Profilmenü, Arbeitsbereich (Matrix, Inventar, Materialentnahme, Projekte) |
| `public/index.html` | Stylesheet + kleines Skript im `<head>` (Ansicht ohne Aufblitzen), Büro-Logo und -Titel, Arbeitsbereich-Container |
| `public/app.js` | startet `biz.js`, Profilmenü statt direktem Abmelde-Dialog |
| `public/js/state.js` | Status-Bezeichnungen je Ansicht |
| `public/js/hud.js` | HUD-Beschriftung im Büro |
| `public/js/setup.js` | Prüfprotokoll-Tabelle |
| `public/js/sfx.js`, `public/js/ui.js` | Stummschaltung von Ton, Vibration und Effekten im Büro |
| `public/js/auth.js` | Anmeldebildschirm im Büro-Look |

## Test

Getestet in Chromium (Desktop 1600 × 950 und 1400 × 900, Handy 390 × 844): Esc / Alt+B / Profilmenü, Neuladen, Drag & Drop und
Auswahlliste beim Umsetzen, Statuswechsel, Inventar-Filter und Sortierung, Verbrauchsbeleg mit Storno, Projektliste mit Checkliste,
Prüfprotokoll, Rückwechsel in die Werkstatt (Hallenplan, Sounds, Glows wieder da). Keine JavaScript-Fehler.
