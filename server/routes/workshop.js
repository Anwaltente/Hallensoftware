/**
 * Werkstatt-Alltag: Aufgaben, Wartungsheft, Budget/Einkauf, "Woran arbeite ich gerade?",
 * Whiteboard und Dokument-Löschung.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const { db, UPLOAD_DIR } = require('../db');
const { buildWhiteboard } = require('../lib/whiteboard');
const { activeWork } = require('../lib/queries');
const { pick, insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, toNumOrNull, nowIso } = require('../lib/util');
const budget = require('../lib/budget');   // v5.1: Kosten automatisch im Budget
const activity = require('../lib/activity');   // v5.3: Meilensteine im Aktivitäts-Log
const { today } = require('../lib/util');

const router = express.Router();

/* ---------------- Whiteboard ---------------- */
router.get('/whiteboard', (_req, res) => res.json({ ...buildWhiteboard(), work: activeWork() }));

/* ---------------- Aufgaben ---------------- */
/* v5.3: Zeitschätzung, Zuweisung, Zieldatum */
const hoursOrNull = (v) => { const n = toNumOrNull(v); return n !== null && n > 0 ? Math.min(999, Math.round(n * 100) / 100) : null; };
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);
function userOrNull(v) {
  const id = toIntOrNull(v);
  if (!id) return null;
  const u = db.prepare("SELECT id FROM users WHERE id = ? AND role != 'gast'").get(id);
  if (!u) throw httpError(400, 'Diese Person gibt es nicht.');
  return id;
}

const taskSchema = {
  vehicle_id: toIntOrNull,
  title: (v) => strOrNull(v) || 'Neue Aufgabe',
  description: strOrNull,
  priority: (v) => Math.min(3, Math.max(1, toIntOrNull(v) || 2)),
  cost: (v) => budget.money(toNumOrNull(v)),   // v5.1: Preis der Aufgabe (leer = keiner)
  estimated_hours: hoursOrNull,                // v5.3
  assigned_user: userOrNull,                   // v5.3: leer = offener Pool
  target_date: dateOrNull                      // v5.3
};

/** v5.3: Aufgaben-Abfrage inkl. Zuweisung und Pause (für Board, Cockpit, Workload) */
const TASK_SELECT = `SELECT t.*, v.name AS vehicle_name, v.color AS vehicle_color,
    au.name AS assigned_name, au.color AS assigned_color, pu.name AS paused_by_name
  FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN users au ON au.id = t.assigned_user LEFT JOIN users pu ON pu.id = t.paused_by`;

router.get('/tasks', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.vehicleId === 'hall') where.push('t.vehicle_id IS NULL');
  else if (req.query.vehicleId) { where.push('t.vehicle_id = ?'); args.push(Number(req.query.vehicleId)); }
  if (req.query.status) { where.push('t.status = ?'); args.push(req.query.status); }
  res.json(db.prepare(`${TASK_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.status, t.priority, t.created_at`).all(...args));
});

router.post('/tasks', (req, res) => {
  let id;
  db.transaction(() => {
    id = insertRow('tasks', { ...pick(req.body, taskSchema), created_by: req.user.id, created_at: nowIso() });
    budget.syncTask(id);
  })();
  res.status(201).json(mustGet('tasks', id));
});

router.put('/tasks/:id', (req, res) => {
  db.transaction(() => {
    updateRow('tasks', req.params.id, pick(req.body, taskSchema, { partial: true }));
    budget.syncTask(Number(req.params.id));
  })();
  res.json(mustGet('tasks', req.params.id));
});

router.delete('/tasks/:id', (req, res) => {
  db.transaction(() => {
    budget.taskDeleted(Number(req.params.id));
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});

/** Erledigt: 1 Klick, Datum + User automatisch, wandert ins Wartungsheft. */
router.post('/tasks/:id/done', (req, res) => {
  const task = mustGet('tasks', req.params.id, 'Aufgabe');
  if (task.status === 'done') throw httpError(409, 'Aufgabe ist bereits erledigt.');
  const ts = nowIso();
  // v5.1: Kosten = beim Abhaken angegeben, sonst der Preis der Aufgabe
  const cost = budget.money(toNumOrNull(req.body && req.body.cost)) || budget.money(task.cost);
  const tx = db.transaction(() => {
    db.prepare("UPDATE tasks SET status = 'done', done_by = ?, done_at = ?, paused_at = NULL WHERE id = ?").run(req.user.id, ts, task.id);
    let logId = null;
    if (task.vehicle_id) {
      const mileage = toIntOrNull(req.body && req.body.mileage);
      logId = insertRow('maintenance_log', {
        vehicle_id: task.vehicle_id, title: task.title,
        description: strOrNull(req.body && req.body.note) || task.description,
        mileage, cost,
        done_at: ts, user_id: req.user.id, task_id: task.id,
        parts_used: strOrNull(req.body && req.body.parts_used)   // v5.3
      });
      if (mileage) db.prepare('UPDATE vehicles SET mileage = MAX(COALESCE(mileage, 0), ?) WHERE id = ?').run(mileage, task.vehicle_id);
    }
    budget.taskDone(task, logId, cost, ts);
    db.prepare('UPDATE work_sessions SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL').run(ts, task.id);
  });
  tx();
  const vname = task.vehicle_id ? (db.prepare('SELECT name FROM vehicles WHERE id = ?').get(task.vehicle_id) || {}).name : null;
  activity.mark(req, 'task_done', `Aufgabe erledigt: ${task.title}${vname ? ` (${vname})` : ' (Halle)'}`, { task_id: task.id, vehicle_id: task.vehicle_id, cost: cost || null });
  res.json(mustGet('tasks', task.id));
});

/**
 * v5.3: "Arbeit pausieren / Nicht fertig": was ist noch zu tun + geschätzte Fertigstellung.
 * Laufende Arbeit an dieser Aufgabe endet, das Auto behält den Status "In Arbeit" und bekommt auf der Map ein Warn-Badge.
 */
router.post('/tasks/:id/pause', (req, res) => {
  const task = mustGet('tasks', req.params.id, 'Aufgabe');
  if (task.status === 'done') throw httpError(409, 'Aufgabe ist schon erledigt.');
  const note = strOrNull(req.body && req.body.note);
  if (!note) throw httpError(400, 'Bitte kurz notieren, was noch zu tun ist.');
  const target = dateOrNull(req.body && req.body.target_date);
  const hours = req.body && req.body.estimated_hours !== undefined ? hoursOrNull(req.body.estimated_hours) : task.estimated_hours;
  const ts = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE tasks SET paused_at = ?, paused_by = ?, progress_note = ?, target_date = COALESCE(?, target_date), estimated_hours = ? WHERE id = ?')
      .run(ts, req.user.id, note.slice(0, 1000), target, hours, task.id);
    db.prepare('UPDATE work_sessions SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL').run(ts, task.id);
    if (task.vehicle_id) db.prepare("UPDATE vehicles SET status = 'work' WHERE id = ? AND status = 'ready'").run(task.vehicle_id);
  })();
  const vname = task.vehicle_id ? (db.prepare('SELECT name FROM vehicles WHERE id = ?').get(task.vehicle_id) || {}).name : null;
  activity.mark(req, 'task_pause', `Arbeit pausiert: ${task.title}${vname ? ` (${vname})` : ''}. Noch zu tun: ${note}${target ? ` · fertig bis ${target.split('-').reverse().join('.')}` : ''}`,
    { task_id: task.id, vehicle_id: task.vehicle_id, note, target_date: target, estimated_hours: hours });
  res.json(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(task.id));
});

/** v5.3: Pause aufheben (z. B. wenn jemand weitermacht), Rest-Notiz bleibt als Hinweis stehen */
router.post('/tasks/:id/resume', (req, res) => {
  const task = mustGet('tasks', req.params.id, 'Aufgabe');
  db.prepare('UPDATE tasks SET paused_at = NULL WHERE id = ?').run(task.id);
  res.json(db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(task.id));
});

/** v5.3: Zuweisen (Workload-Board, Drag & Drop): { user_id } oder { user_id: null } = zurück in den offenen Pool */
router.post('/tasks/:id/assign', (req, res) => {
  const task = mustGet('tasks', req.params.id, 'Aufgabe');
  const uid = req.body && req.body.user_id === 'me' ? req.user.id : userOrNull(req.body && req.body.user_id);
  db.prepare('UPDATE tasks SET assigned_user = ? WHERE id = ?').run(uid, task.id);
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(task.id);
  activity.mark(req, 'task_assign', uid ? `Aufgabe zugewiesen: ${task.title} an ${row.assigned_name}${uid === req.user.id ? ' (selbst übernommen)' : ''}` : `Aufgabe in den offenen Pool: ${task.title}`,
    { task_id: task.id, user_id: uid }, { high: false });
  res.json(row);
});

/**
 * v5.3: Team-Auslastung: offene Aufgaben je Person + offener Pool, mit summierter Restzeit.
 * Deadline = Zieldatum der Aufgabe, sonst das nächste Event des Autos.
 */
router.get('/workload', (_req, res) => {
  const t = today();
  const users = db.prepare("SELECT id, name, color, role FROM users WHERE active = 1 AND role != 'gast' ORDER BY id").all();
  const tasks = db.prepare(`${TASK_SELECT} WHERE t.status = 'open' ORDER BY t.priority, t.created_at`).all();
  const nextEv = db.prepare(`SELECT e.name, e.date_start FROM events e JOIN event_vehicles ev ON ev.event_id = e.id
    WHERE ev.vehicle_id = ? AND COALESCE(e.date_end, e.date_start) >= ? ORDER BY e.date_start LIMIT 1`);
  const evCache = new Map();
  const work = activeWork();
  const enriched = tasks.map((x) => {
    let ev = null;
    if (x.vehicle_id) { if (!evCache.has(x.vehicle_id)) evCache.set(x.vehicle_id, nextEv.get(x.vehicle_id, t) || null); ev = evCache.get(x.vehicle_id); }
    const deadline = x.target_date && (!ev || x.target_date <= ev.date_start) ? x.target_date : ev ? ev.date_start : x.target_date || null;
    return { ...x, event_name: ev ? ev.name : null, event_date: ev ? ev.date_start : null, deadline, overdue: !!(x.target_date && x.target_date < t),
      working: work.filter((w) => w.task_id === x.id).map((w) => w.user_name) };
  });
  const byDeadline = (a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || a.priority - b.priority;
  const col = (list) => ({ tasks: list.sort(byDeadline), count: list.length, hours: Math.round(list.reduce((s, x) => s + (Number(x.estimated_hours) || 0), 0) * 100) / 100,
    unestimated: list.filter((x) => !x.estimated_hours).length });
  const known = new Set(users.map((u) => u.id));
  res.json({
    today: t,
    users: users.map((u) => ({ ...u, ...col(enriched.filter((x) => x.assigned_user === u.id)) })),
    pool: col(enriched.filter((x) => !x.assigned_user || !known.has(x.assigned_user)))
  });
});

router.post('/tasks/:id/reopen', (req, res) => {
  const task = mustGet('tasks', req.params.id, 'Aufgabe');
  db.transaction(() => {
    db.prepare("UPDATE tasks SET status = 'open', done_by = NULL, done_at = NULL WHERE id = ?").run(task.id);
    db.prepare('DELETE FROM maintenance_log WHERE task_id = ?').run(task.id);
    budget.taskReopened(task);
  })();
  res.json(mustGet('tasks', task.id));
});

/* ---------------- Wartungsheft (durchsuchbar) ---------------- */
router.get('/log', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.vehicleId) { where.push('l.vehicle_id = ?'); args.push(Number(req.query.vehicleId)); }
  if (req.query.q) { where.push('(l.title LIKE ? OR l.description LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  res.json(db.prepare(`SELECT l.*, u.name AS user_name, v.name AS vehicle_name FROM maintenance_log l
    LEFT JOIN users u ON u.id = l.user_id LEFT JOIN vehicles v ON v.id = l.vehicle_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.done_at DESC LIMIT 500`).all(...args));
});

router.post('/log', (req, res) => {
  const vehicleId = toIntOrNull(req.body.vehicle_id);
  if (!vehicleId) throw httpError(400, 'Fahrzeug fehlt.');
  let id;
  db.transaction(() => {
    id = insertRow('maintenance_log', {
      vehicle_id: vehicleId,
      title: strOrNull(req.body.title) || 'Eintrag',
      description: strOrNull(req.body.description),
      mileage: toIntOrNull(req.body.mileage),
      cost: budget.money(toNumOrNull(req.body.cost)),
      done_at: strOrNull(req.body.done_at) || nowIso(),
      user_id: req.user.id,
      parts_used: strOrNull(req.body.parts_used)   // v5.3: verwendete Teile / Flüssigkeiten
    });
    budget.syncLog(id);   // v5.1: Kosten stehen automatisch im Budget
  })();
  res.status(201).json(mustGet('maintenance_log', id));
});

router.delete('/log/:id', (req, res) => {
  db.transaction(() => {
    budget.logDeleted(Number(req.params.id));
    db.prepare('DELETE FROM maintenance_log WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});

/* ---------------- Budget & Einkaufsliste ---------------- */
const buySchema = {
  vehicle_id: toIntOrNull,
  name: (v) => strOrNull(v) || 'Artikel',
  price: (v) => toNumOrNull(v) ?? 0,
  qty: (v) => Math.max(1, toIntOrNull(v) || 1),
  url: strOrNull
};

router.get('/purchases', (req, res) => {
  const rows = req.query.vehicleId
    ? db.prepare('SELECT * FROM purchases WHERE vehicle_id = ? ORDER BY status DESC, created_at').all(Number(req.query.vehicleId))
    : db.prepare('SELECT p.*, v.name AS vehicle_name FROM purchases p LEFT JOIN vehicles v ON v.id = p.vehicle_id ORDER BY p.status DESC, p.created_at').all();
  res.json(rows);
});

router.post('/purchases', (req, res) => {
  const id = insertRow('purchases', { ...pick(req.body, buySchema), status: 'todo', created_at: nowIso() });
  res.status(201).json(mustGet('purchases', id));
});

// v5.1: Zeilen aus Aufgaben / Wartungsheft werden dort gepflegt (sonst entstünden wieder zwei Wahrheiten)
const LINKED_MSG = 'Dieser Betrag kommt automatisch aus einer Aufgabe bzw. dem Wartungsheft. Bitte dort ändern.';

router.put('/purchases/:id', (req, res) => {
  const cur = mustGet('purchases', req.params.id, 'Eintrag');
  const data = pick(req.body, buySchema, { partial: true });
  if (cur.task_id || cur.log_id) {
    // erlaubt: geplante Aufgaben-Kosten als "gekauft" markieren (Teil schon besorgt) und zurück
    if (cur.log_id || Object.keys(data).some((k) => req.body[k] !== undefined)) throw httpError(409, LINKED_MSG);
  }
  if (req.body.status === 'bought' || req.body.status === 'todo') {
    data.status = req.body.status;
    data.bought_at = req.body.status === 'bought' ? nowIso() : null;
  }
  updateRow('purchases', req.params.id, data);
  res.json(mustGet('purchases', req.params.id));
});

router.delete('/purchases/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  if (cur && (cur.task_id || cur.log_id)) throw httpError(409, LINKED_MSG);
  db.prepare('DELETE FROM purchases WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Woran arbeite ich gerade? ---------------- */
router.get('/work', (_req, res) => res.json(activeWork()));

router.post('/work', (req, res) => {
  const vehicleId = toIntOrNull(req.body.vehicle_id);
  const taskId = toIntOrNull(req.body.task_id);
  const task = taskId ? mustGet('tasks', taskId, 'Aufgabe') : null;
  const ts = nowIso();
  db.prepare('UPDATE work_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(ts, req.user.id);
  if (taskId) db.prepare('UPDATE tasks SET paused_at = NULL WHERE id = ? AND paused_at IS NOT NULL').run(taskId);   // v5.3: es geht weiter
  insertRow('work_sessions', {
    user_id: req.user.id,
    vehicle_id: vehicleId || (task && task.vehicle_id) || null,
    task_id: taskId,
    text: strOrNull(req.body.text) || (task && task.title) || null,
    started_at: ts
  });
  if (vehicleId || (task && task.vehicle_id)) {
    db.prepare("UPDATE vehicles SET status = 'work' WHERE id = ? AND status = 'ready'").run(vehicleId || task.vehicle_id);
  }
  res.status(201).json(activeWork());
});

router.post('/work/stop', (req, res) => {
  db.prepare('UPDATE work_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(nowIso(), req.user.id);
  res.json(activeWork());
});

/* ---------------- Dokumente löschen ---------------- */
router.delete('/documents/:id', (req, res) => {
  const doc = mustGet('documents', req.params.id, 'Dokument');
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  fs.promises.unlink(path.join(UPLOAD_DIR, doc.filename)).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
