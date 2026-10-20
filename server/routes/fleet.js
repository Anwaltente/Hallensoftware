/**
 * v3: Fuhrpark-Erweiterungen
 *   Fahrzeugmodelle (Admin):  GET /api/vehicle-models, POST/PUT/DELETE /api/admin/vehicle-models[/:id]
 *   Anhänger:                 GET/POST /api/trailers, PUT/DELETE /api/trailers/:id
 *   Beladung je Event:        GET/POST/DELETE /api/events/:id/loading, POST /api/events/:id/loading/preview
 */
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');
const { SHAPES } = require('../lib/models');
const { getModels } = require('../lib/vehicleModels');
const { loadingPlan, trailerSpecs } = require('../lib/loading');
const { pick, insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, toNumOrNull, toBool, nowIso } = require('../lib/util');

const router = express.Router();
const admin = requireRole('admin');

/* ======================= Fahrzeugmodelle ======================= */
const modelSchema = {
  label: (v) => strOrNull(v) || 'Neues Modell',
  chassis: strOrNull,
  shape: (v) => (SHAPES[v] ? v : 'coupe'),
  length: (v) => Math.min(8, Math.max(2, toNumOrNull(v) ?? 4.4)),
  width: (v) => Math.min(3, Math.max(1, toNumOrNull(v) ?? 1.8)),
  weight_kg: toIntOrNull,
  sort: (v) => toIntOrNull(v) ?? 100
};

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'modell';

function modelList() {
  const usage = new Map(db.prepare('SELECT model, COUNT(*) AS c FROM vehicles GROUP BY model').all().map((r) => [r.model, r.c]));
  return db.prepare('SELECT * FROM vehicle_models ORDER BY sort, label').all().map((m) => ({ ...m, builtin: !!m.builtin, used: usage.get(m.key) || 0 }));
}

router.get('/vehicle-models', (_req, res) => res.json({ models: modelList(), shapes: SHAPES }));

router.post('/admin/vehicle-models', admin, (req, res) => {
  const data = pick(req.body, modelSchema);
  let key = `custom_${slug(data.label)}`;
  for (let i = 2; db.prepare('SELECT 1 FROM vehicle_models WHERE key = ?').get(key); i += 1) key = `custom_${slug(data.label)}_${i}`;
  insertRow('vehicle_models', { ...data, key, builtin: 0, created_at: nowIso() });
  res.status(201).json({ models: modelList(), meta: getModels(), key });
});

router.put('/admin/vehicle-models/:id', admin, (req, res) => {
  mustGet('vehicle_models', req.params.id, 'Modell');
  updateRow('vehicle_models', req.params.id, pick(req.body, modelSchema, { partial: true }));
  res.json({ models: modelList(), meta: getModels() });
});

/** Löschen: Standardmodelle bleiben. Eigene Modelle in Benutzung nur mit force=1 (Autos werden auf "Dummy" gesetzt). */
router.delete('/admin/vehicle-models/:id', admin, (req, res) => {
  const m = mustGet('vehicle_models', req.params.id, 'Modell');
  if (m.builtin) throw httpError(400, 'Standardmodelle können nicht gelöscht werden (aber bearbeitet).');
  const used = db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE model = ?').get(m.key).c;
  if (used && req.query.force !== '1') throw httpError(409, `${used} Auto(s) nutzen dieses Modell.`);
  db.transaction(() => {
    if (used) db.prepare("UPDATE vehicles SET model = 'dummy' WHERE model = ?").run(m.key);
    db.prepare('DELETE FROM vehicle_models WHERE id = ?').run(m.id);
  })();
  res.json({ models: modelList(), meta: getModels(), moved: used });
});

/* ======================= Anhänger ======================= */
const trailerSchema = {
  name: (v) => strOrNull(v) || 'Anhänger',
  plate: strOrNull,
  empty_kg: (v) => Math.max(0, toIntOrNull(v) ?? 0),
  gvw_kg: (v) => Math.max(0, toIntOrNull(v) ?? 0),
  deck_length_cm: toIntOrNull,
  deck_width_cm: toIntOrNull,
  tow_vehicle_id: toIntOrNull,
  tow_name: strOrNull,
  tow_capacity_kg: toIntOrNull,
  notes: strOrNull,
  active: toBool
};

function trailerList() {
  return db.prepare('SELECT t.*, v.name AS tow_vehicle_name FROM trailers t LEFT JOIN vehicles v ON v.id = t.tow_vehicle_id ORDER BY t.active DESC, t.name').all().map(trailerSpecs);
}

router.get('/trailers', (_req, res) => res.json(trailerList()));

router.post('/trailers', (req, res) => {
  const data = pick(req.body, trailerSchema);
  if (req.body.active === undefined) data.active = 1;
  if (data.gvw_kg && data.empty_kg > data.gvw_kg) throw httpError(400, 'Leergewicht ist größer als das zulässige Gesamtgewicht.');
  insertRow('trailers', { ...data, created_at: nowIso() });
  res.status(201).json(trailerList());
});

router.put('/trailers/:id', (req, res) => {
  mustGet('trailers', req.params.id, 'Anhänger');
  const data = pick(req.body, trailerSchema, { partial: true });
  updateRow('trailers', req.params.id, data);
  res.json(trailerList());
});

router.delete('/trailers/:id', (req, res) => {
  db.prepare('DELETE FROM trailers WHERE id = ?').run(req.params.id);
  res.json(trailerList());
});

/* ======================= Beladung je Event ======================= */
router.get('/events/:id/loading', (req, res) => {
  const plan = loadingPlan(Number(req.params.id));
  if (!plan) throw httpError(404, 'Event nicht gefunden.');
  res.json(plan);
});

// Vorschau: bewertet eine Zuordnung, ohne sie zu speichern
router.post('/events/:id/loading/preview', (req, res) => {
  const list = (Array.isArray(req.body.assignments) ? req.body.assignments : [])
    .map((a) => ({ vehicle_id: toIntOrNull(a.vehicle_id), trailer_id: toIntOrNull(a.trailer_id) })).filter((a) => a.vehicle_id);
  const plan = loadingPlan(Number(req.params.id), { override: list });
  if (!plan) throw httpError(404, 'Event nicht gefunden.');
  res.json(plan);
});

router.post('/events/:id/loading', (req, res) => {
  const eventId = Number(req.params.id);
  mustGet('events', eventId, 'Event');
  const list = Array.isArray(req.body.assignments) ? req.body.assignments : [];
  db.transaction(() => {
    db.prepare('DELETE FROM event_loading WHERE event_id = ?').run(eventId); // betrifft nur den Beladungsplan dieses Events
    const ins = db.prepare('INSERT OR REPLACE INTO event_loading (event_id, vehicle_id, trailer_id) VALUES (?,?,?)');
    for (const a of list) {
      const vid = toIntOrNull(a.vehicle_id);
      if (!vid) continue;
      ins.run(eventId, vid, toIntOrNull(a.trailer_id));
    }
  })();
  res.json(loadingPlan(eventId));
});

router.delete('/events/:id/loading', (req, res) => {
  db.prepare('DELETE FROM event_loading WHERE event_id = ?').run(Number(req.params.id));
  res.json(loadingPlan(Number(req.params.id)));
});

module.exports = router;
