/**
 * Gemeinsame Lese-Abfragen, die mehrere Routen nutzen.
 */
const { db } = require('../db');
const { parseJSON, today } = require('./util');

function listObjects() {
  return db.prepare('SELECT * FROM layout_objects ORDER BY sort, id').all()
    .map((o) => ({ ...o, props: parseJSON(o.props, {}) }));
}

function listVehicles() {
  const t = today();
  const rows = db.prepare(`
    SELECT v.*, lo.code AS slot_code, lo.label AS slot_label,
      (SELECT COUNT(*) FROM tasks t WHERE t.vehicle_id = v.id AND t.status = 'open') AS open_tasks,
      (SELECT COALESCE(SUM(price * qty), 0) FROM purchases p WHERE p.vehicle_id = v.id AND p.status = 'todo') AS budget_todo
    FROM vehicles v LEFT JOIN layout_objects lo ON lo.id = v.slot_id ORDER BY v.id`).all();
  const nextEv = db.prepare(`SELECT e.id, e.name, e.date_start FROM events e JOIN event_vehicles ev ON ev.event_id = e.id
    WHERE ev.vehicle_id = ? AND COALESCE(e.date_end, e.date_start) >= ? ORDER BY e.date_start LIMIT 1`);
  return rows.map((v) => ({ ...v, wheel_specs: parseJSON(v.wheel_specs, []), next_event: nextEv.get(v.id, t) || null }));
}

function activeWork() {
  return db.prepare(`SELECT w.*, u.name AS user_name, u.color AS user_color, v.name AS vehicle_name, t.title AS task_title
    FROM work_sessions w JOIN users u ON u.id = w.user_id
    LEFT JOIN vehicles v ON v.id = w.vehicle_id LEFT JOIN tasks t ON t.id = w.task_id
    WHERE w.ended_at IS NULL ORDER BY w.started_at DESC`).all();
}

function listEvents({ upcomingOnly = false } = {}) {
  const t = today();
  const rows = upcomingOnly
    ? db.prepare('SELECT * FROM events WHERE COALESCE(date_end, date_start) >= ? ORDER BY date_start').all(t)
    : db.prepare('SELECT * FROM events ORDER BY date_start DESC').all();
  const veh = db.prepare('SELECT vehicle_id FROM event_vehicles WHERE event_id = ?');
  const packed = db.prepare('SELECT COUNT(*) AS c FROM packlist_checks WHERE event_id = ? AND packed = 1');
  return rows.map((e) => ({
    ...e,
    vehicle_ids: veh.all(e.id).map((r) => r.vehicle_id),
    packed_count: packed.get(e.id).c,
    past: (e.date_end || e.date_start) < t
  }));
}

module.exports = { listObjects, listVehicles, activeWork, listEvents };
