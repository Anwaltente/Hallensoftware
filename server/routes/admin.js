/**
 * Admin-Konsole: Nutzer & Rechte, Hall Pass, Post-Event Quick-Checks,
 * CSV-Import (Google Sheets), Backup.
 * Quick-Check-Abfrage/Antwort ist auch für Schrauber erreichbar.
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, getSetting, setSetting, hashPin, BACKUP_DIR, USING_TURSO } = require('../db');
const { requireRole } = require('../auth');
const { parseCSV, suggestMapping } = require('../lib/csv');
const { getModels } = require('../lib/vehicleModels');
const { insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, toNumOrNull, parseJSON, nowIso, norm } = require('../lib/util');

const router = express.Router();
const admin = requireRole('admin');

/* ======================= Nutzerverwaltung ======================= */
router.get('/admin/users', admin, (_req, res) => {
  res.json(db.prepare('SELECT id, name, role, color, active, created_at FROM users ORDER BY id').all());
});

router.post('/admin/users', admin, (req, res) => {
  const name = strOrNull(req.body.name);
  const pin = String(req.body.pin || '');
  if (!name) throw httpError(400, 'Name fehlt.');
  if (!/^\d{4,8}$/.test(pin)) throw httpError(400, 'PIN muss 4 bis 8 Ziffern haben.');
  if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(name)) throw httpError(409, 'Name ist schon vergeben.');
  const id = insertRow('users', {
    name, role: ['admin', 'schrauber'].includes(req.body.role) ? req.body.role : 'schrauber',
    pin_hash: hashPin(pin), color: strOrNull(req.body.color) || '#22d3ee', created_at: nowIso()
  });
  res.status(201).json(db.prepare('SELECT id, name, role, color, active FROM users WHERE id = ?').get(id));
});

router.put('/admin/users/:id', admin, (req, res) => {
  const user = mustGet('users', req.params.id, 'Nutzer');
  const data = {};
  if (req.body.name !== undefined) data.name = strOrNull(req.body.name) || user.name;
  if (req.body.color !== undefined) data.color = strOrNull(req.body.color) || user.color;
  if (req.body.role !== undefined && ['admin', 'schrauber'].includes(req.body.role)) data.role = req.body.role;
  if (req.body.active !== undefined) data.active = req.body.active ? 1 : 0;
  if (req.body.pin) {
    if (!/^\d{4,8}$/.test(String(req.body.pin))) throw httpError(400, 'PIN muss 4 bis 8 Ziffern haben.');
    data.pin_hash = hashPin(req.body.pin);
  }
  // Mindestens ein aktiver Admin muss bleiben
  if ((data.role === 'schrauber' || data.active === 0) && user.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(user.id).c;
    if (!admins) throw httpError(400, 'Es muss mindestens ein aktiver Admin bleiben.');
  }
  updateRow('users', user.id, data);
  // Andere Nutzer nach Rechte-/PIN-Änderung neu anmelden lassen
  if (user.id !== req.user.id && (data.active === 0 || data.pin_hash || data.role)) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  }
  res.json(db.prepare('SELECT id, name, role, color, active FROM users WHERE id = ?').get(user.id));
});

router.delete('/admin/users/:id', admin, (req, res) => {
  const user = mustGet('users', req.params.id, 'Nutzer');
  if (user.id === req.user.id) throw httpError(400, 'Du kannst dich nicht selbst löschen.');
  if (user.role === 'admin' && !db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id != ?").get(user.id).c) {
    throw httpError(400, 'Letzter Admin kann nicht gelöscht werden.');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

/* ======================= Hall Pass (Gast-Link) ======================= */
router.get('/admin/hallpass', admin, (_req, res) => res.json(getSetting('hallpass', { enabled: false, token: '' })));

router.put('/admin/hallpass', admin, (req, res) => {
  const pass = getSetting('hallpass', { enabled: false, token: crypto.randomBytes(12).toString('hex') });
  pass.enabled = !!req.body.enabled;
  if (!pass.enabled) db.prepare("DELETE FROM sessions WHERE role = 'gast'").run();
  setSetting('hallpass', pass);
  res.json(pass);
});

router.post('/admin/hallpass/regenerate', admin, (_req, res) => {
  const pass = getSetting('hallpass', { enabled: true });
  pass.token = crypto.randomBytes(12).toString('hex');
  setSetting('hallpass', pass);
  db.prepare("DELETE FROM sessions WHERE role = 'gast'").run(); // alte Gast-Links fliegen raus
  res.json(pass);
});

/* ======================= Post-Event Quick-Check ======================= */
function serializeQc(q) { return { ...q, questions: parseJSON(q.questions, []) }; }

router.get('/quickchecks/pending', (req, res) => {
  if (!req.user.id) return res.json([]);
  const rows = db.prepare(`SELECT q.*, e.name AS event_name, v.name AS vehicle_name FROM quickchecks q
    LEFT JOIN events e ON e.id = q.event_id LEFT JOIN vehicles v ON v.id = q.vehicle_id
    WHERE q.active = 1 AND NOT EXISTS (SELECT 1 FROM quickcheck_answers a WHERE a.quickcheck_id = q.id AND a.user_id = ?)
    ORDER BY q.created_at`).all(req.user.id);
  res.json(rows.map(serializeQc));
});

router.post('/quickchecks/:id/answer', (req, res) => {
  const qc = serializeQc(mustGet('quickchecks', req.params.id, 'Quick-Check'));
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const createdTasks = [];
  db.transaction(() => {
    db.prepare(`INSERT INTO quickcheck_answers (quickcheck_id, user_id, answers, created_at) VALUES (?,?,?,?)
      ON CONFLICT(quickcheck_id, user_id) DO UPDATE SET answers = excluded.answers, created_at = excluded.created_at`)
      .run(qc.id, req.user.id, JSON.stringify(answers), nowIso());
    // Automatische Folge-Aufgaben (z. B. "Reifen abgefahren? Ja" => "Neue Reifen aufziehen")
    qc.questions.forEach((q, idx) => {
      const a = answers.find((x) => Number(x.index) === idx);
      if (!a || !q.taskOn || a.value !== q.taskOn) return;
      const title = q.taskTitle || q.text;
      const exists = db.prepare("SELECT 1 FROM tasks WHERE status = 'open' AND title = ? AND COALESCE(vehicle_id, 0) = COALESCE(?, 0)").get(title, qc.vehicle_id);
      if (exists) return;
      insertRow('tasks', {
        vehicle_id: qc.vehicle_id, title, priority: 1, created_by: req.user.id, created_at: nowIso(),
        description: `Aus Quick-Check „${qc.title}“${a.note ? `: ${a.note}` : ''}`
      });
      createdTasks.push(title);
    });
  })();
  res.json({ ok: true, createdTasks });
});

router.get('/admin/quickchecks', admin, (_req, res) => {
  const rows = db.prepare(`SELECT q.*, e.name AS event_name, v.name AS vehicle_name FROM quickchecks q
    LEFT JOIN events e ON e.id = q.event_id LEFT JOIN vehicles v ON v.id = q.vehicle_id ORDER BY q.created_at DESC`).all();
  const answers = db.prepare(`SELECT a.*, u.name AS user_name FROM quickcheck_answers a JOIN users u ON u.id = a.user_id WHERE a.quickcheck_id = ?`);
  res.json(rows.map((q) => ({ ...serializeQc(q), answers: answers.all(q.id).map((a) => ({ ...a, answers: parseJSON(a.answers, []) })) })));
});

function readQc(body) {
  const questions = (Array.isArray(body.questions) ? body.questions : [])
    .map((q) => ({ text: strOrNull(q.text), taskOn: ['yes', 'no'].includes(q.taskOn) ? q.taskOn : null, taskTitle: strOrNull(q.taskTitle) }))
    .filter((q) => q.text);
  if (!questions.length) throw httpError(400, 'Mindestens eine Frage nötig.');
  return {
    title: strOrNull(body.title) || 'Post-Event Quick-Check',
    event_id: toIntOrNull(body.event_id),
    vehicle_id: toIntOrNull(body.vehicle_id),
    questions: JSON.stringify(questions),
    active: body.active ? 1 : 0
  };
}

router.post('/admin/quickchecks', admin, (req, res) => {
  const id = insertRow('quickchecks', { ...readQc(req.body), created_by: req.user.id, created_at: nowIso() });
  res.status(201).json(serializeQc(mustGet('quickchecks', id)));
});

router.put('/admin/quickchecks/:id', admin, (req, res) => {
  const current = serializeQc(mustGet('quickchecks', req.params.id, 'Quick-Check'));
  const body = { ...current, ...req.body };
  updateRow('quickchecks', current.id, readQc(body));
  if (req.body.resetAnswers) db.prepare('DELETE FROM quickcheck_answers WHERE quickcheck_id = ?').run(current.id);
  res.json(serializeQc(mustGet('quickchecks', current.id)));
});

router.delete('/admin/quickchecks/:id', admin, (req, res) => {
  db.prepare('DELETE FROM quickchecks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ======================= CSV-Import (Google Sheets) ======================= */
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/admin/import/preview', admin, memUpload.single('file'), (req, res) => {
  if (!req.file) throw httpError(400, 'Keine CSV-Datei empfangen.');
  const parsed = parseCSV(req.file.buffer.toString('utf8'));
  if (!parsed.headers.length) throw httpError(400, 'CSV ist leer.');
  res.json({ ...parsed, rowCount: parsed.rows.length, mapping: suggestMapping(parsed.headers) });
});

const TRUTHY = new Set(['x', 'ja', 'j', 'yes', 'y', '1', 'true', 'wahr', '✓', '✔', 'event']);

router.post('/admin/import/commit', admin, (req, res) => {
  const { target, mapping = {}, rows = [] } = req.body || {};
  // v5.2: Zielfach für alle Zeilen ohne eigenen Lagerort (oder für alle, wenn override)
  const dflt = (req.body && req.body.defaults) || {};
  if (!['parts', 'tools'].includes(target)) throw httpError(400, 'Ziel muss "parts" oder "tools" sein.');
  if (!mapping.name) throw httpError(400, 'Die Spalte für "Name" muss zugeordnet sein.');

  const shelves = db.prepare("SELECT id, code, label, props FROM layout_objects WHERE type = 'shelf'").all();
  const vehicles = db.prepare('SELECT id, name, model FROM vehicles').all();
  const get = (row, field) => (mapping[field] ? String(row[mapping[field]] ?? '').trim() : '');

  const findShelf = (val) => {
    if (!val) return null;
    const n = norm(val).replace(/^regal\s*/, '');
    return shelves.find((s) => norm(s.code) === n || norm(s.label) === norm(val) || norm(s.label) === `regal ${n}`) || null;
  };
  const findOrCreateBox = (shelf, level, label) => {
    if (!shelf || !label) return null;
    const existing = db.prepare('SELECT * FROM boxes WHERE shelf_id = ? AND lower(label) = lower(?)').get(shelf.id, label);
    if (existing) return existing;
    const pos = (db.prepare('SELECT MAX(position) AS m FROM boxes WHERE shelf_id = ? AND level = ?').get(shelf.id, level || 1).m || 0) + 1;
    return mustGet('boxes', insertRow('boxes', { shelf_id: shelf.id, level: level || 1, position: pos, label, color: '#64748b' }));
  };
  const findVehicle = (val) => {
    const n = norm(val);
    if (!n) return null;
    return vehicles.find((v) => norm(v.name) === n) || vehicles.find((v) => norm(v.name).includes(n) || n.includes(norm(v.name))) || null;
  };

  const defShelf = toIntOrNull(dflt.shelf_id) ? shelves.find((x) => x.id === toIntOrNull(dflt.shelf_id)) || null : null;
  if (toIntOrNull(dflt.shelf_id) && !defShelf) throw httpError(400, 'Das gewählte Regal gibt es nicht.');
  const defLevel = defShelf ? (toIntOrNull(dflt.level) || null) : null;
  let defBox = null;
  if (defShelf && toIntOrNull(dflt.box_id)) {
    defBox = db.prepare('SELECT * FROM boxes WHERE id = ? AND shelf_id = ?').get(toIntOrNull(dflt.box_id), defShelf.id);
    if (!defBox) throw httpError(400, 'Die gewählte Eurobox gehört nicht zu diesem Regal.');
  }
  const defBoxLabel = defShelf && !defBox ? strOrNull(dflt.box_label) : null;   // neue Box, wird beim ersten Treffer angelegt
  const override = !!dflt.override;

  let imported = 0;
  const skipped = [];
  // v5.1: Mit Turso in Etappen speichern (eine Cloud-Transaktion darf nur wenige Sekunden dauern)
  const importRow = (row, idx) => {
      const name = get(row, 'name');
      if (!name) { skipped.push(idx + 2); return; }
      let shelf = override ? null : findShelf(get(row, 'shelf'));
      let level = override ? null : toIntOrNull(get(row, 'level').replace(/\D/g, ''));
      let box = null;
      const csvBox = override ? '' : get(row, 'box');
      if (shelf) box = findOrCreateBox(shelf, level, csvBox);
      else if (defShelf) {
        // kein (bekannter) Lagerort in der CSV: Standard-Zielfach; eine Box-Spalte ohne Regal landet im Standard-Regal
        shelf = defShelf;
        level = level || defLevel;
        if (csvBox) box = findOrCreateBox(shelf, level || defLevel, csvBox);
        else if (defBox) { box = defBox; level = defBox.level; }
        else if (defBoxLabel) { box = findOrCreateBox(shelf, defLevel, defBoxLabel); }
      }
      const base = {
        name,
        category: strOrNull(get(row, 'category')),
        qty: Math.max(target === 'tools' ? 1 : 0, toIntOrNull(get(row, 'qty').replace(/[^\d-]/g, '')) ?? 1),
        shelf_id: shelf ? shelf.id : null,
        level: box ? box.level : (shelf ? level : null),
        box_id: box ? box.id : null,
        event_relevant: TRUTHY.has(norm(get(row, 'event'))) ? 1 : 0,
        notes: strOrNull(get(row, 'notes')),
        created_at: nowIso()
      };
      if (target === 'parts') {
        const vText = get(row, 'vehicle');
        const isUniversal = /^(universal|alle|uni|allgemein)$/i.test(vText);
        const veh = isUniversal ? null : findVehicle(vText);
        insertRow('parts', {
          ...base,
          condition: strOrNull(get(row, 'condition')) || 'neu',
          part_number: strOrNull(get(row, 'part_number')),
          universal: isUniversal ? 1 : 0,
          vehicle_id: veh ? veh.id : null,
          foreign_model: !isUniversal && !veh && vText ? vText : null
        });
      } else {
        insertRow('tools', { ...base, location_text: strOrNull(get(row, 'location')), price: toNumOrNull(get(row, 'price')) });
      }
      imported += 1;
  };
  if (!USING_TURSO) db.transaction(() => rows.forEach(importRow))();
  else {
    let i = 0;
    while (i < rows.length) {
      db.transaction(() => {
        const t0 = Date.now();
        do { importRow(rows[i], i); i += 1; } while (i < rows.length && Date.now() - t0 < 1500);
      })();
    }
  }
  res.json({ imported, skipped });
});

/* ======================= Backup ======================= */
router.get('/admin/backup', admin, async (_req, res, next) => {
  try {
    const file = path.join(BACKUP_DIR, `halle-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await db.backup(file);
    res.download(file);
  } catch (err) { next(err); }
});

router.get('/admin/models', admin, (_req, res) => res.json(getModels()));

module.exports = router;
