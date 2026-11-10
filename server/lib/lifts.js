/**
 * v5.4: Hebebühnen-Reservierung
 * Eine Aufgabe reserviert eine Bühne über tasks.lift_slot (layout_objects.id, 0 = egal) und lift_from/lift_to
 * (lokale Zeit 'JJJJ-MM-TTTHH:MM', Strings sind direkt vergleichbar).
 * Seit v5.5 reservieren Aufgaben ganze Tage: lift_from = Von-Tag 00:00, lift_to = Tag nach dem Bis-Tag 00:00 (Ende exklusiv).
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

const addDay = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Letzter belegter Tag: Reservierungen sind ganze Tage, lift_to ist der Folgetag 00:00 (alte Einträge mit Uhrzeit zählen bis zum Tag ihres Endes) */
const lastDay = (b) => {
  const von = b.lift_from.slice(0, 10);
  const bis = b.lift_to.slice(11) === '00:00' ? addDay(b.lift_to.slice(0, 10), -1) : b.lift_to.slice(0, 10);
  return bis < von ? von : bis;
};

const overlap = (a, b) => a.lift_from < b.lift_to && b.lift_from < a.lift_to;
/** Mehrere Aufgaben am selben Fahrzeug dürfen sich eine Bühne teilen (nur mit bekanntem Fahrzeug, Aufgaben ohne Fahrzeug sind immer verschieden) */
const sameCar = (a, b) => a.vehicle_id !== null && a.vehicle_id !== undefined && a.vehicle_id === b.vehicle_id;
const unit = (b) => (b.vehicle_id ? `v${b.vehicle_id}` : `t${b.id}`);   // eine belegte Bühne je Fahrzeug

/**
 * IDs der Reservierungen im Konflikt.
 * Feste Bühne: gleiche Bühne + Zeitüberschneidung bei UNTERSCHIEDLICHEN Fahrzeugen. "Egal": Konflikt, wenn zur selben Zeit schon alle Bühnen vergeben sind.
 * Aufgaben desselben Fahrzeugs stören sich nie (das Auto steht ohnehin auf der Bühne).
 * shortcut: "egal"-Prüfung zählt alle überlappenden Buchungen gemeinsam, auch wenn sie sich untereinander nicht überlappen; reicht bei 2 Bühnen.
 */
function conflictIds(bookings, liftCount) {
  const ids = new Set();
  for (const a of bookings) {
    const others = bookings.filter((b) => b !== a && overlap(a, b) && !sameCar(a, b));
    if (a.lift_slot) {
      if (others.some((b) => b.lift_slot === a.lift_slot)) ids.add(a.id);
    } else {
      const fixed = new Set(others.filter((b) => b.lift_slot).map((b) => b.lift_slot));
      const any = new Set(others.filter((b) => !b.lift_slot).map(unit)).size;
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
    .map((b) => ({ ...b, lift_bis: lastDay(b), conflict: conflicts.has(b.id) }))
    .sort((a, b) => a.lift_from.localeCompare(b.lift_from));
  return { lifts, bookings, now: nowLocal() };
}

/** Gerade laufende Reservierungen (für Map und TV) */
function liftsNow() {
  const now = nowLocal();
  return liftCalendar(now.slice(0, 10), now.slice(0, 10)).bookings.filter((b) => b.lift_from <= now && b.lift_to > now);
}

/**
 * Freie Bühnensuche: die nächsten `limit` freien Zeiträume mit `days` Tagen am Stück (Wochenende = Sa+So).
 * lift: Bühnen-ID oder 0/leer = egal (nimmt die erste freie). Buchungen desselben Fahrzeugs (vehicleId) und die gerade bearbeitete Aufgabe (excludeId) blockieren nicht.
 * Reine Funktion auf Listen, damit sie ohne Datenbank testbar ist. Zeiträume überschneiden sich nicht untereinander.
 */
function findFree(bookings, lifts, { days = 1, weekend = false, lift = 0, vehicleId = null, excludeId = null, from, limit = 5, horizon = 180 }) {
  const rel = bookings.filter((b) => b.id !== Number(excludeId) && !(vehicleId && b.vehicle_id === Number(vehicleId)));
  const cands = lift ? lifts.filter((l) => l.id === Number(lift)) : lifts;
  const n = weekend ? 2 : Math.max(1, Math.min(14, Number(days) || 1));
  const taken = (day) => {   // Bühnen, die an diesem Tag belegt sind; "egal"-Buchungen nehmen irgendeine
    const hit = rel.filter((b) => b.lift_from < `${addDay(day, 1)}T00:00` && b.lift_to > `${day}T00:00`);
    return { fixed: new Set(hit.filter((b) => b.lift_slot).map((b) => b.lift_slot)), egal: new Set(hit.filter((b) => !b.lift_slot).map(unit)).size };
  };
  const free = (l, day) => { const t = taken(day); return !t.fixed.has(l.id) && t.fixed.size + t.egal < lifts.length; };
  const out = [];
  for (let i = 0; i < horizon && out.length < limit; i += 1) {
    const start = addDay(from, i);
    if (weekend && new Date(`${start}T12:00:00Z`).getUTCDay() !== 6) continue;
    const l = cands.find((c) => Array.from({ length: n }, (_, k) => addDay(start, k)).every((d) => free(c, d)));
    if (l) { out.push({ von: start, bis: addDay(start, n - 1), lift_id: l.id, lift_label: l.label || l.code }); i += n - 1; }
  }
  return out;
}

function freeSlots(q) {
  const lifts = listLifts();
  return findFree(db.prepare(BOOKING_SELECT).all(), lifts, { ...q, from: q.from || nowLocal().slice(0, 10) });
}

const hasConflict = (taskId) => liftCalendar('0000-01-01', '9999-12-31').bookings.some((b) => b.id === Number(taskId) && b.conflict);

module.exports = { listLifts, liftCalendar, liftsNow, hasConflict, conflictIds, nowLocal, lastDay, findFree, freeSlots };

// Selbsttest: node server/lib/lifts.js --selftest
if (require.main === module && process.argv.includes('--selftest')) {
  const assert = require('assert');
  const b = (id, lift_slot, f, t) => ({ id, lift_slot, lift_from: `2026-11-02T${f}`, lift_to: `2026-11-02T${t}` });
  assert.deepStrictEqual([...conflictIds([b(1, 5, '08:00', '10:00'), b(2, 5, '09:00', '11:00'), b(3, 6, '09:00', '11:00')], 2)], [1, 2]);
  assert.deepStrictEqual([...conflictIds([b(1, 5, '08:00', '10:00'), b(2, 5, '10:00', '11:00')], 2)], []);   // direkt anschließend = ok
  assert.deepStrictEqual([...conflictIds([b(1, 5, '08:00', '10:00'), b(2, 6, '08:00', '10:00'), b(3, 0, '09:00', '09:30')], 2)], [3]);
  assert.deepStrictEqual([...conflictIds([b(1, 5, '08:00', '10:00'), b(3, 0, '09:00', '09:30')], 2)], []);
  // v5.5: ganze Tage. Sa bis Mo (to = Di 00:00) kollidiert mit Mo allein, nicht mit Di
  const d = (id, slot, von, bisExkl) => ({ id, lift_slot: slot, lift_from: `${von}T00:00`, lift_to: `${bisExkl}T00:00` });
  assert.deepStrictEqual([...conflictIds([d(1, 5, '2026-11-14', '2026-11-17'), d(2, 5, '2026-11-16', '2026-11-17'), d(3, 5, '2026-11-17', '2026-11-18')], 2)], [1, 2]);
  assert.deepStrictEqual([...conflictIds([d(1, 5, '2026-11-14', '2026-11-15'), d(2, 5, '2026-11-14', '2026-11-15')], 2)], [1, 2]);   // gleicher Tag = Konflikt
  assert.strictEqual(lastDay(d(1, 5, '2026-11-14', '2026-11-17')), '2026-11-16');
  assert.strictEqual(lastDay({ lift_from: '2026-11-14T09:00', lift_to: '2026-11-14T11:00' }), '2026-11-14');   // alte Uhrzeit-Reservierung
  // v5.6: gleiches Fahrzeug stört sich nicht, verschiedene Fahrzeuge schon, ohne Fahrzeug immer verschieden
  const c = (id, slot, veh, von, bisExkl) => ({ ...d(id, slot, von, bisExkl), vehicle_id: veh });
  assert.deepStrictEqual([...conflictIds([c(1, 5, 7, '2026-11-14', '2026-11-16'), c(2, 5, 7, '2026-11-14', '2026-11-16'), c(3, 5, 7, '2026-11-15', '2026-11-17')], 2)], []);
  assert.deepStrictEqual([...conflictIds([c(1, 5, 7, '2026-11-14', '2026-11-16'), c(2, 5, 7, '2026-11-14', '2026-11-16'), c(3, 5, 8, '2026-11-15', '2026-11-17')], 2)], [1, 2, 3]);
  assert.deepStrictEqual([...conflictIds([c(1, 5, null, '2026-11-14', '2026-11-16'), c(2, 5, null, '2026-11-14', '2026-11-16')], 2)], [1, 2]);
  // "egal": 2 Aufgaben am selben Auto belegen zusammen nur EINE Bühne
  assert.deepStrictEqual([...conflictIds([c(1, 0, 7, '2026-11-14', '2026-11-15'), c(2, 0, 7, '2026-11-14', '2026-11-15'), c(3, 0, 8, '2026-11-14', '2026-11-15')], 2)], []);
  // Bühnensuche
  const L = [{ id: 5, label: 'Bühne 1' }, { id: 6, label: 'Bühne 2' }];
  const bk = [c(1, 5, 7, '2026-11-09', '2026-11-12'), c(2, 6, 8, '2026-11-10', '2026-11-11')];
  assert.deepStrictEqual(findFree(bk, L, { days: 2, from: '2026-11-09', limit: 2 }).map((x) => [x.von, x.bis, x.lift_id]), [['2026-11-11', '2026-11-12', 6], ['2026-11-13', '2026-11-14', 5]]);
  assert.strictEqual(findFree(bk, L, { days: 1, lift: 5, from: '2026-11-09', limit: 1 })[0].von, '2026-11-12');
  assert.strictEqual(findFree(bk, L, { days: 1, lift: 5, vehicleId: 7, from: '2026-11-09', limit: 1 })[0].von, '2026-11-09');   // eigenes Auto blockiert nicht
  assert.strictEqual(findFree(bk, L, { days: 1, lift: 5, excludeId: 1, from: '2026-11-09', limit: 1 })[0].von, '2026-11-09');
  const we = findFree([], L, { weekend: true, from: '2026-11-09', limit: 2 });   // Mo 9.11.: erstes Wochenende 14./15.11., dann 21./22.11.
  assert.deepStrictEqual(we.map((x) => [x.von, x.bis]), [['2026-11-14', '2026-11-15'], ['2026-11-21', '2026-11-22']]);
  console.log('lifts selftest ok');
  process.exit(0);
}
