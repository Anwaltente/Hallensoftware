/**
 * Event-Deadline-Algorithmus für das Hallen-Whiteboard
 * ------------------------------------------------------------
 * 1. Für jedes Auto wird das NÄCHSTE kommende Event ermittelt.
 * 2. Offene Aufgaben dieser Autos bekommen dessen Startdatum als Deadline.
 * 3. Sortierung: Deadline (früh zuerst) > Priorität > Alter der Aufgabe.
 * 4. Aufgaben ohne Event landen im Backlog.
 *    v5.3: Ein eigenes Zieldatum (target_date) zählt wie eine Deadline; das frühere Datum gewinnt.
 * 5. Haben die Event-Autos keine offenen Tasks, schlägt das Board
 *    allgemeine Hallen-To-Dos vor (z. B. "Kompressor entwässern").
 * v5.4: Nicht event-kritische Auto-Aufgaben (event_critical = 0) bekommen keine Event-Deadline und blockieren "startklar" nicht.
 *       Event-Aufgaben (event_id, ohne Auto) laufen mit der Deadline ihres Events.
 */
const { db } = require('../db');
const { today, daysBetween } = require('./util');
const { liftsNow } = require('./lifts');

function urgencyLevel(daysLeft) {
  if (daysLeft === null) return 'none';
  if (daysLeft <= 3) return 'critical';
  if (daysLeft <= 10) return 'soon';
  return 'planned';
}

function buildWhiteboard() {
  const t = today();

  const upcoming = db.prepare(`SELECT * FROM events WHERE COALESCE(date_end, date_start) >= ? ORDER BY date_start`).all(t);
  const links = db.prepare(`SELECT ev.vehicle_id, e.id AS event_id, e.name AS event_name, e.date_start
    FROM event_vehicles ev JOIN events e ON e.id = ev.event_id
    WHERE COALESCE(e.date_end, e.date_start) >= ? ORDER BY e.date_start`).all(t);

  const nextEvent = new Map();
  for (const l of links) if (!nextEvent.has(l.vehicle_id)) nextEvent.set(l.vehicle_id, l);

  // v5.3: inkl. Zuweisung (assigned_user) und Pause ("Nicht fertig geworden")
  const tasks = db.prepare(`SELECT t.*, v.name AS vehicle_name, v.color AS vehicle_color, v.model AS vehicle_model, v.status AS vehicle_status,
      au.name AS assigned_name, au.color AS assigned_color, pu.name AS paused_by_name
    FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN users au ON au.id = t.assigned_user LEFT JOIN users pu ON pu.id = t.paused_by
    WHERE t.status = 'open'`).all();

  const urgent = [];
  const backlog = [];
  const hall = [];
  for (const task of tasks) {
    // v5.3: eigenes Zieldatum zählt wie eine Deadline (das frühere von Zieldatum und Event gewinnt)
    const own = task.target_date ? { daysLeft: daysBetween(t, task.target_date), overdue: task.target_date < t } : null;
    if (task.event_id && !task.vehicle_id) {
      const ev = upcoming.find((e) => e.id === task.event_id);
      if (ev) {
        const daysLeft = Math.max(0, daysBetween(t, ev.date_start));
        urgent.push({ ...task, event_name: ev.name, deadline: ev.date_start, daysLeft, urgency: urgencyLevel(daysLeft), target_days: own ? own.daysLeft : null, target_overdue: own ? own.overdue : false });
      }
      continue;   // Aufgaben vergangener Events tauchen nicht mehr auf
    }
    if (!task.vehicle_id) { hall.push(own ? { ...task, target_days: own.daysLeft, target_overdue: own.overdue } : task); continue; }
    const ev = task.event_critical === 0 ? null : nextEvent.get(task.vehicle_id);
    if (ev && !(task.target_date && task.target_date < ev.date_start)) {
      const daysLeft = Math.max(0, daysBetween(t, ev.date_start));
      urgent.push({ ...task, event_id: ev.event_id, event_name: ev.event_name, deadline: ev.date_start, daysLeft, urgency: urgencyLevel(daysLeft),
        target_days: own ? own.daysLeft : null, target_overdue: own ? own.overdue : false });
    } else if (task.target_date) {
      const daysLeft = Math.max(0, own.daysLeft);
      urgent.push({ ...task, event_id: ev ? ev.event_id : null, event_name: ev ? ev.event_name : null, deadline: task.target_date, daysLeft,
        urgency: own.overdue ? 'critical' : urgencyLevel(daysLeft), deadline_kind: 'target', target_days: own.daysLeft, target_overdue: own.overdue });
    } else {
      backlog.push({ ...task, urgency: 'none' });
    }
  }

  const byPrioAge = (a, b) => a.priority - b.priority || String(a.created_at).localeCompare(String(b.created_at));
  urgent.sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)) || byPrioAge(a, b));
  backlog.sort(byPrioAge);
  hall.sort(byPrioAge);

  // Event-Autos ohne offene Aufgaben = "bereit"
  const busy = new Set(urgent.filter((u) => u.vehicle_id && u.event_critical !== 0).map((u) => u.vehicle_id));
  const readyForEvent = [];
  for (const [vehicleId, ev] of nextEvent) {
    if (busy.has(vehicleId)) continue;
    const v = db.prepare('SELECT id, name, color, status FROM vehicles WHERE id = ?').get(vehicleId);
    if (v) readyForEvent.push({ ...v, event_name: ev.event_name, deadline: ev.date_start, daysLeft: daysBetween(t, ev.date_start) });
  }

  return {
    today: t,
    mode: urgent.length ? 'events' : 'hall',
    urgent,
    backlog,
    hall,
    suggestions: urgent.length ? [] : hall.slice(0, 5),
    readyForEvent,
    liftsNow: liftsNow(),   // v5.4: laufende Bühnen-Reservierungen (Map + TV)
    nextEvent: upcoming[0] ? { ...upcoming[0], daysLeft: daysBetween(t, upcoming[0].date_start) } : null
  };
}

module.exports = { buildWhiteboard };
