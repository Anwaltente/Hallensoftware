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

const router = express.Router();

/* ---------------- Whiteboard ---------------- */
router.get('/whiteboard', (_req, res) => res.json({ ...buildWhiteboard(), work: activeWork() }));

/* ---------------- Aufgaben ---------------- */
const taskSchema = {
  vehicle_id: toIntOrNull,
  title: (v) => strOrNull(v) || 'Neue Aufgabe',
  description: strOrNull,
  priority: (v) => Math.min(3, Math.max(1, toIntOrNull(v) || 2))
};

router.get('/tasks', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.vehicleId === 'hall') where.push('t.vehicle_id IS NULL');
  else if (req.query.vehicleId) { where.push('t.vehicle_id = ?'); args.push(Number(req.query.vehicleId)); }
  if (req.query.status) { where.push('t.status = ?'); args.push(req.query.status); }
  res.json(db.prepare(`SELECT t.*, v.name AS vehicle_name FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.status, t.priority, t.created_at`).all(...args));
});

router.post('/tasks', (req, res) => {
  const id = insertRow('tasks', { ...pick(req.body, taskSchema), created_by: req.user.id, created_at: nowIso() });
  res.status(201).json(mustGet('tasks', id));
});

router.put('/tasks/:id', (req, res) => {
  updateRow('tasks', req.params.id, pick(req.body, taskSchema, { partial: true }));
  res.json(mustGet('tasks', req.params.id));
});

router.delete('/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** Erledigt: 1 Klick, Datum + User automatisch, wandert ins Wartungsheft. */
router.post('/tasks/:id/done', (req, res) => {
  const task = mustGet('tasks', req.params.id, 'Aufgabe');
  if (task.status === 'done') throw httpError(409, 'Aufgabe ist bereits erledigt.');
  const ts = nowIso();
  const tx = db.transaction(() => {
    db.prepare("UPDATE tasks SET status = 'done', done_by = ?, done_at = ? WHERE id = ?").run(req.user.id, ts, task.id);
    if (task.vehicle_id) {
      const mileage = toIntOrNull(req.body && req.body.mileage);
      insertRow('maintenance_log', {
        vehicle_id: task.vehicle_id, title: task.title,
        description: strOrNull(req.body && req.body.note) || task.description,
        mileage, cost: toNumOrNull(req.body && req.body.cost),
        done_at: ts, user_id: req.user.id, task_id: task.id
      });
      if (mileage) db.prepare('UPDATE vehicles SET mileage = MAX(COALESCE(mileage, 0), ?) WHERE id = ?').run(mileage, task.vehicle_id);
    }
    db.prepare('UPDATE work_sessions SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL').run(ts, task.id);
  });
  tx();
  res.json(mustGet('tasks', task.id));
});

router.post('/tasks/:id/reopen', (req, res) => {
  const task = mustGet('tasks', req.params.id, 'Aufgabe');
  db.prepare("UPDATE tasks SET status = 'open', done_by = NULL, done_at = NULL WHERE id = ?").run(task.id);
  db.prepare('DELETE FROM maintenance_log WHERE task_id = ?').run(task.id);
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
  const id = insertRow('maintenance_log', {
    vehicle_id: vehicleId,
    title: strOrNull(req.body.title) || 'Eintrag',
    description: strOrNull(req.body.description),
    mileage: toIntOrNull(req.body.mileage),
    cost: toNumOrNull(req.body.cost),
    done_at: strOrNull(req.body.done_at) || nowIso(),
    user_id: req.user.id
  });
  res.status(201).json(mustGet('maintenance_log', id));
});

router.delete('/log/:id', (req, res) => {
  db.prepare('DELETE FROM maintenance_log WHERE id = ?').run(req.params.id);
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

router.put('/purchases/:id', (req, res) => {
  const data = pick(req.body, buySchema, { partial: true });
  if (req.body.status === 'bought' || req.body.status === 'todo') {
    data.status = req.body.status;
    data.bought_at = req.body.status === 'bought' ? nowIso() : null;
  }
  updateRow('purchases', req.params.id, data);
  res.json(mustGet('purchases', req.params.id));
});

router.delete('/purchases/:id', (req, res) => {
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
