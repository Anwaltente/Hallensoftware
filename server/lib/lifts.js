/**
 * v5.4: Hebebühnen-Reservierung
 * Eine Aufgabe reserviert eine Bühne über tasks.lift_slot (layout_objects.id, 0 = egal) und lift_from/lift_to
 * (lokale Zeit 'JJJJ-MM-TTTHH:MM', Strings sind direkt vergleichbar).
 */
const { db } = require('../db');
const { parseJSON, TZ } = require('./util');

/** Alle Hebebühnen der Halle (Stellplätze mit kind = lift) */
function listLifts() {
  return db.prepare("SELECT id, code, label, props FROM layout_objects WHERE type = 'slot' ORDER BY y, x").all()
    .filter((s) => parseJSON(s.props, {}).kind === 'lift')
    .map(({ id, code, label }) => ({ id, code, label }));
}

/** Jetzt in der Hallen-Zeitzone als 'JJJJ-MM-TTTHH:MM' */
function nowLocal() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date()).replace(' ', 'T');
}

const overlap = (a, b) => a.lift_from < b.lift_to && b.lift_from < a.lift_to;

/**
 * IDs der Reservierungen im Konflikt.
 * Feste Bühne: gleiche Bühne + Zeitüberschneidung. "Egal": Konflikt, wenn zur selben Zeit schon alle Bühnen vergeben sind.
 * shortcut: "egal"-Prüfung zählt alle überlappenden Buchungen gemeinsam, auch wenn sie sich untereinander nicht überlappen; reicht bei 2 Bühnen.
 */
function conflictIds(bookings, liftCount) {
  const ids = new Set();
  for (const a of bookings) {
    const others = bookings.filter((b) => b !== a && overlap(a, b));
    if (a.lift_slot) {
      if (others.some((b) => b.lift_slot === a.lift_slot)) ids.add(a.id);
    } else {
      const fixed = new Set(others.filter((b) => b.lift_slot).map((b) => b.lift_slot));
      const any = others.filter((b) => !b.lift_slot).length;
      if (fixed.size + any >= liftCount) ids.add(a.id);
    }
  }
  return ids;
}

const BOOKING_SELECT = `SELECT t.id, t.title, t.status, t.vehicle_id, t.event_id, t.lift_slot, t.lift_from, t.lift_to, t.assigned_user, t.priority,
    v.name AS vehicle_name, v.color AS vehicle_color, au.name AS assigned_name, au.color AS assigned_color
  FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN users au ON au.id = t.assigned_user
  WHERE t.status = 'open' AND t.lift_slot IS NOT NULL AND t.lift_from IS NOT NULL AND t.lift_to IS NOT NULL`;

/** Reservierungen im Zeitraum [from, to] (Tage JJJJ-MM-TT, inklusive) mit Konflikt-Kennzeichen */
function liftCalendar(from, to) {
  const lifts = listLifts();
  // Konflikte über alle offenen Reservierungen rechnen, damit Buchungen am Rand des Zeitraums richtig bewertet werden
  const all = db.prepare(BOOKING_SELECT).all();
  const conflicts = conflictIds(all, lifts.length);
  const bookings = all.filter((b) => b.lift_from < `${to}T24:00` && b.lift_to > `${from}T00:00`)
    .map((b) => ({ ...b, conflict: conflicts.has(b.id) }))
    .sort((a, b) => a.lift_from.localeCompare(b.lift_from));
  return { lifts, bookings, now: nowLocal() };
}

/** Gerade laufende Reservierungen (für Map und TV) */
function liftsNow() {
  const now = nowLocal();
  return liftCalendar(now.slice(0, 10), now.slice(0, 10)).bookings.filter((b) => b.lift_from <= now && b.lift_to > now);
}

const hasConflict = (taskId) => liftCalendar('0000-01-01', '9999-12-31').bookings.some((b) => b.id === Number(taskId) && b.conflict);

module.exports = { listLifts, liftCalendar, liftsNow, hasConflict, conflictIds, nowLocal };

// Selbsttest: node server/lib/lifts.js --selftest
if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  const b = (id, lift_slot, f, t) => ({ id, lift_slot, lift_from: `2026-11-02T${f}`, lift_to: `2026-11-02T${t}` });
  assert.deepStrictEqual([...conflictIds([b(1, 5, '08:00', '10:00'), b(2, 5, '09:00', '11:00'), b(3, 6, '09:00', '11:00')], 2)], [1, 2]);
  assert.deepStrictEqual([...conflictIds([b(1, 5, '08:00', '10:00'), b(2, 5, '10:00', '11:00')], 2)], []);   // direkt anschließend = ok
  assert.deepStrictEqual([...conflictIds([b(1, 5, '08:00', '10:00'), b(2, 6, '08:00', '10:00'), b(3, 0, '09:00', '09:30')], 2)], [3]);
  assert.deepStrictEqual([...conflictIds([b(1, 5, '08:00', '10:00'), b(3, 0, '09:00', '09:30')], 2)], []);
  console.log('lifts selftest ok');
  process.exit(0);
}
