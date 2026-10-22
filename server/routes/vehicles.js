/**
 * /api/vehicles: Fuhrpark, Stellplatz-Wechsel (Drag & Drop), Cockpit-Daten,
 * Dokumente (Upload via Multer) und Admin-Konverter (Rad/Reifen, TÜV).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('../db');
const { requireRole } = require('../auth');
const { hasModel } = require('../lib/vehicleModels');
const { listVehicles } = require('../lib/queries');
const { outerWidth } = require('../lib/dims');
const { pick, insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, parseJSON, nowIso } = require('../lib/util');
const activity = require('../lib/activity');   // v5.3: Umparken im Aktivitäts-Log
const { historyPdf } = require('../lib/history-pdf');   // v5.3: Wartungshistorie als PDF

const router = express.Router();

const vehicleSchema = {
  name: (v) => strOrNull(v) || 'Neues Auto',
  model: (v) => (v && hasModel(v) ? v : 'dummy'),
  color: (v) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? v : '#9ca3af'),
  plate: strOrNull,
  vin: strOrNull,
  status: (v) => (['ready', 'work', 'parts'].includes(v) ? v : 'ready'),
  extern_location: (v) => strOrNull(v) || 'Paddock',
  mileage: toIntOrNull,
  notes: strOrNull,
  // v3: Gewicht / Maße für den Gespann-Rechner (leer = Werte des Modells)
  weight_kg: toIntOrNull,
  length_cm: toIntOrNull,
  width_cm: toIntOrNull,
  // v4.1: Radmaße in mm (für den Anhänger-Check). Unsinnige Werte werden verworfen.
  wheelbase_mm: (v) => mm(v, 1500, 4500),
  track_front_mm: (v) => mm(v, 1000, 2200),
  track_rear_mm: (v) => mm(v, 1000, 2200),
  tire_width_front_mm: (v) => mm(v, 100, 400),
  tire_width_rear_mm: (v) => mm(v, 100, 400)
};

function mm(v, min, max) {
  const n = toIntOrNull(v);
  return n !== null && n >= min && n <= max ? n : null;
}

/** Radaußenbreite neu berechnen (nur für dieses eine Fahrzeug, nur die neue Spalte) */
function recalcOuter(id) {
  const v = db.prepare('SELECT track_front_mm, track_rear_mm, tire_width_front_mm, tire_width_rear_mm FROM vehicles WHERE id = ?').get(id);
  if (v) db.prepare('UPDATE vehicles SET outer_width_calc_mm = ? WHERE id = ?').run(outerWidth(v), id);
}
const DIM_KEYS = ['track_front_mm', 'track_rear_mm', 'tire_width_front_mm', 'tire_width_rear_mm'];

router.get('/', (_req, res) => res.json(listVehicles()));

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const vehicle = listVehicles().find((v) => v.id === id);
  if (!vehicle) throw httpError(404, 'Fahrzeug nicht gefunden.');
  const tasks = db.prepare(`SELECT t.*, cu.name AS created_by_name, du.name AS done_by_name,
      au.name AS assigned_name, au.color AS assigned_color, pu.name AS paused_by_name FROM tasks t
    LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN users du ON du.id = t.done_by
    LEFT JOIN users au ON au.id = t.assigned_user LEFT JOIN users pu ON pu.id = t.paused_by
    WHERE t.vehicle_id = ? ORDER BY t.status, t.priority, t.created_at`).all(id);
  const log = db.prepare(`SELECT l.*, u.name AS user_name FROM maintenance_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.vehicle_id = ? ORDER BY l.done_at DESC`).all(id);
  const purchases = db.prepare('SELECT * FROM purchases WHERE vehicle_id = ? ORDER BY status DESC, created_at').all(id);
  const documents = db.prepare(`SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE d.vehicle_id = ? ORDER BY d.created_at DESC`).all(id);
  const events = db.prepare(`SELECT e.* FROM events e JOIN event_vehicles ev ON ev.event_id = e.id WHERE ev.vehicle_id = ? ORDER BY e.date_start DESC`).all(id);
  const parts = db.prepare(`SELECT p.*, lo.code AS shelf_code, b.label AS box_label FROM parts p
    LEFT JOIN layout_objects lo ON lo.id = p.shelf_id LEFT JOIN boxes b ON b.id = p.box_id WHERE p.vehicle_id = ? ORDER BY p.name`).all(id);
  const work = db.prepare(`SELECT w.*, u.name AS user_name, u.color AS user_color FROM work_sessions w JOIN users u ON u.id = w.user_id
    WHERE w.vehicle_id = ? AND w.ended_at IS NULL`).all(id);
  const sum = (status) => purchases.filter((p) => p.status === status).reduce((acc, p) => acc + p.price * p.qty, 0);
  res.json({
    vehicle, tasks, log, purchases, documents, events, parts, work,
    budget: { todo: sum('todo'), bought: sum('bought'), total: sum('todo') + sum('bought') }
  });
});

/* v5.3: Wartungshistorie als druckfertiges PDF (DIN A4). ?download=1 lädt herunter, sonst Anzeige im Browser */
router.get('/:id/history.pdf', (req, res) => {
  const out = historyPdf(Number(req.params.id), { exportedBy: req.user && req.user.name });
  if (!out) throw httpError(404, 'Fahrzeug nicht gefunden.');
  const v = db.prepare('SELECT name FROM vehicles WHERE id = ?').get(Number(req.params.id));
  activity.mark(req, 'pdf_export', `Wartungshistorie als PDF exportiert: ${v ? v.name : ''} (${out.rows} Einträge)`, { vehicle_id: Number(req.params.id) }, { high: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${out.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(out.buffer);
});

router.post('/', (req, res) => {
  const data = pick(req.body, vehicleSchema);
  const id = insertRow('vehicles', { ...data, slot_id: null });
  recalcOuter(id);
  res.status(201).json(listVehicles().find((v) => v.id === id));
});

router.put('/:id', (req, res) => {
  updateRow('vehicles', req.params.id, pick(req.body, vehicleSchema, { partial: true }));
  if (DIM_KEYS.some((k) => k in req.body)) recalcOuter(Number(req.params.id));
  res.json(listVehicles().find((v) => v.id === Number(req.params.id)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const docs = db.prepare('SELECT filename FROM documents WHERE vehicle_id = ?').all(req.params.id);
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  for (const d of docs) fs.promises.unlink(path.join(UPLOAD_DIR, d.filename)).catch(() => {});
  res.json({ ok: true });
});

/**
 * Stellplatz wechseln.
 * Body: { slotId: number|null, slotPos?: number, externLocation?: string, swap?: boolean }
 * slotId = null  => Auto wandert nach "Unterwegs / Paddock".
 * swap = true    => belegter Platz: das andere Auto tauscht mit dem bisherigen Platz.
 */
router.post('/:id/move', (req, res) => {
  const v = mustGet('vehicles', req.params.id, 'Fahrzeug');
  const { slotId, slotPos, externLocation, swap } = req.body || {};

  const where = (sid) => { const o = sid ? db.prepare('SELECT code, label FROM layout_objects WHERE id = ?').get(sid) : null; return o ? `${o.code || ''} ${o.label || ''}`.trim() : null; };
  const fromLabel = v.slot_id ? where(v.slot_id) : `draußen (${v.extern_location || 'Paddock'})`;
  const tx = db.transaction(() => {
    if (slotId === null || slotId === undefined || slotId === '') {
      const loc = strOrNull(externLocation) || (v.slot_id ? 'Paddock' : v.extern_location) || 'Paddock';
      db.prepare('UPDATE vehicles SET slot_id = NULL, slot_pos = 0, extern_location = ? WHERE id = ?').run(loc, v.id);
      activity.mark(req, 'vehicle_move', `Fahrzeug umgeparkt: ${v.name} von ${fromLabel} nach draußen (${loc})`, { vehicle_id: v.id, from: fromLabel, to: loc });
      return;
    }
    const slot = db.prepare("SELECT * FROM layout_objects WHERE id = ? AND type = 'slot'").get(slotId);
    if (!slot) throw httpError(404, 'Stellplatz nicht gefunden.');
    const cap = Math.max(1, Number(parseJSON(slot.props, {}).capacity) || 1);
    const others = db.prepare('SELECT id, slot_pos FROM vehicles WHERE slot_id = ? AND id != ?').all(slot.id, v.id);
    const taken = new Set(others.map((o) => o.slot_pos));

    let pos = Number.isInteger(slotPos) && slotPos >= 0 && slotPos < cap && !taken.has(slotPos) ? slotPos : -1;
    if (pos < 0) for (let i = 0; i < cap; i += 1) if (!taken.has(i)) { pos = i; break; }

    if (pos < 0) {
      if (!swap) throw httpError(409, `${slot.code || 'Platz'} ist belegt.`);
      // Tauschen: Belegendes Auto (an Wunschposition oder Position 0) geht auf den alten Platz
      const wanted = Number.isInteger(slotPos) && slotPos < cap ? slotPos : 0;
      const occupant = others.find((o) => o.slot_pos === wanted) || others[0];
      db.prepare('UPDATE vehicles SET slot_id = ?, slot_pos = ?, extern_location = ? WHERE id = ?')
        .run(v.slot_id, v.slot_pos, v.slot_id ? null : (v.extern_location || 'Paddock'), occupant.id);
      pos = occupant.slot_pos;
    }
    db.prepare('UPDATE vehicles SET slot_id = ?, slot_pos = ?, extern_location = NULL WHERE id = ?').run(slot.id, pos, v.id);
    const to = `${slot.code || ''} ${slot.label || ''}`.trim() + (cap > 1 ? (pos === 0 ? ' (oben)' : ' (unten)') : '');
    activity.mark(req, 'vehicle_move', v.slot_id === slot.id ? `Fahrzeug umgestellt: ${v.name} auf ${to}` : `Fahrzeug umgeparkt: ${v.name} von ${fromLabel} nach ${to}`,
      { vehicle_id: v.id, from: fromLabel, to, swap: !!swap });
  });
  tx();
  res.json(listVehicles());
});

/* ---------- Admin-Konverter: Rad-/Reifen-Kombis & TÜV in Textform ---------- */
/* ---------------- v5.2: Quick Specs (Spickzettel) ---------------- */
const QS_NUM = ['wheel_torque', 'engine_oil_l', 'gearbox_oil_l', 'diff_oil_l', 'coolant_l', 'spark_gap', 'p_cold_front', 'p_cold_rear', 'p_warm_front', 'p_warm_rear'];
const QS_TXT = ['wheel_bolt', 'engine_oil_type', 'gearbox_oil_type', 'diff_oil_type', 'coolant_type', 'spark_type', 'notes'];
router.put('/:id/quick-specs', (req, res) => {
  mustGet('vehicles', req.params.id, 'Fahrzeug');
  const b = req.body || {};
  const out = {};
  for (const k of QS_NUM) {
    const raw = b[k];
    if (raw === '' || raw === null || raw === undefined) continue;
    const n = Number(String(raw).replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n < 100000) out[k] = Math.round(n * 1000) / 1000;
  }
  for (const k of QS_TXT) { const v = strOrNull(b[k]); if (v) out[k] = v.slice(0, k === 'notes' ? 2000 : 120); }
  if (Array.isArray(b.extra)) {
    out.extra = b.extra.map((x) => ({ label: strOrNull(x && x.label), value: strOrNull(x && x.value) }))
      .filter((x) => x.label && x.value).slice(0, 30).map((x) => ({ label: x.label.slice(0, 60), value: x.value.slice(0, 120) }));
  }
  updateRow('vehicles', req.params.id, { quick_specs: JSON.stringify(out) });
  res.json({ quick_specs: out });
});

router.put('/:id/specs', requireRole('admin'), (req, res) => {
  mustGet('vehicles', req.params.id, 'Fahrzeug');
  const specs = Array.isArray(req.body.wheel_specs) ? req.body.wheel_specs : [];
  const clean = specs
    .map((s) => ({ axle: strOrNull(s.axle) || '', rim: strOrNull(s.rim) || '', tire: strOrNull(s.tire) || '', note: strOrNull(s.note) || '' }))
    .filter((s) => s.rim || s.tire);
  updateRow('vehicles', req.params.id, {
    tuev_until: strOrNull(req.body.tuev_until),
    wheel_specs: JSON.stringify(clean),
    spec_notes: strOrNull(req.body.spec_notes),
    vin: strOrNull(req.body.vin),
    plate: strOrNull(req.body.plate)
  });
  res.json(listVehicles().find((v) => v.id === Number(req.params.id)));
});

/* ---------------- Dokumente (Fahrzeugschein, Gutachten, Fotos) ---------------- */
const ALLOWED = /^(image\/(png|jpe?g|webp|gif|heic|heif)|application\/pdf)$/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.bin'])[0];
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(ALLOWED.test(file.mimetype) ? null : httpError(415, 'Nur Bilder (PNG/JPG/WEBP/HEIC) oder PDF erlaubt.'), ALLOWED.test(file.mimetype))
});

router.post('/:id/documents', upload.single('file'), (req, res) => {
  mustGet('vehicles', req.params.id, 'Fahrzeug');
  if (!req.file) throw httpError(400, 'Keine Datei empfangen.');
  const id = insertRow('documents', {
    vehicle_id: Number(req.params.id),
    kind: strOrNull(req.body.kind) || 'sonstiges',
    title: strOrNull(req.body.title) || req.file.originalname,
    filename: req.file.filename,
    original_name: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size,
    uploaded_by: req.user.id,
    created_at: nowIso()
  });
  res.status(201).json(mustGet('documents', id));
});

module.exports = router;
