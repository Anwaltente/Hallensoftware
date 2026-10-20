/**
 * Lager-Radar: Ersatzteile, Werkzeug (inkl. Verleih & Wunschliste), Euroboxen, Regal-Frontansicht
 */
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');
const { pick, insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, toNumOrNull, toBool, parseJSON, nowIso } = require('../lib/util');

const router = express.Router();

/** Box gesetzt => Regal/Etage automatisch aus der Box übernehmen. */
function resolveStorage(data) {
  if (data.box_id) {
    const box = db.prepare('SELECT * FROM boxes WHERE id = ?').get(data.box_id);
    if (box) { data.shelf_id = box.shelf_id; data.level = box.level; } else data.box_id = null;
  }
  if (data.shelf_id === null) { data.level = null; data.box_id = null; }
  return data;
}

/* ---------------- Ersatzteile ---------------- */
const partSchema = {
  name: (v) => strOrNull(v) || 'Neues Teil',
  category: strOrNull,
  qty: (v) => Math.max(0, toIntOrNull(v) ?? 1),
  condition: (v) => strOrNull(v) || 'neu',
  event_relevant: toBool,
  vehicle_id: toIntOrNull,
  universal: toBool,
  foreign_model: strOrNull,
  shelf_id: toIntOrNull,
  level: toIntOrNull,
  box_id: toIntOrNull,
  part_number: strOrNull,
  notes: strOrNull,
  // v4.2: Gebinde (z. B. 5 L Kanister) + Verknüpfung zur Kritischen Liste
  pack_size: (v) => { const n = toNumOrNull(v); return n && n > 0 ? n : null; },
  pack_unit: strOrNull,
  consumable_id: toIntOrNull,
  open_rest: (v) => { const n = toNumOrNull(v); return n !== null && n >= 0 ? n : null; }
};

function normalizePart(data) {
  // v4.2: Einheit eines verknüpften Gebindes = Einheit der Kategorie (sonst stimmt die Summe nicht)
  if (data.consumable_id) {
    const c = db.prepare('SELECT unit FROM consumables WHERE id = ?').get(data.consumable_id);
    if (c) data.pack_unit = c.unit; else data.consumable_id = null;
  }
  if (data.open_rest !== null && data.open_rest !== undefined && data.pack_size && data.open_rest > data.pack_size) data.open_rest = data.pack_size;
  // Zuordnung ist exklusiv: Auto ODER Universal ODER Freitext
  if (data.universal) { data.vehicle_id = null; data.foreign_model = null; }
  else if (data.vehicle_id) { data.foreign_model = null; }
  return resolveStorage(data);
}

const PART_SELECT = `SELECT p.*, v.name AS vehicle_name, lo.code AS shelf_code, b.label AS box_label, b.color AS box_color, c.name AS consumable_name, c.kind AS consumable_kind
  FROM parts p LEFT JOIN vehicles v ON v.id = p.vehicle_id LEFT JOIN layout_objects lo ON lo.id = p.shelf_id LEFT JOIN boxes b ON b.id = p.box_id
  LEFT JOIN consumables c ON c.id = p.consumable_id`;

router.get('/parts', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.q) { where.push('(p.name LIKE ? OR p.category LIKE ? OR p.part_number LIKE ? OR p.foreign_model LIKE ?)'); args.push(...Array(4).fill(`%${req.query.q}%`)); }
  if (req.query.vehicleId) { where.push('p.vehicle_id = ?'); args.push(Number(req.query.vehicleId)); }
  if (req.query.shelfId) { where.push('p.shelf_id = ?'); args.push(Number(req.query.shelfId)); }
  if (req.query.event === '1') where.push('p.event_relevant = 1');
  res.json(db.prepare(`${PART_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.category, p.name`).all(...args));
});

router.post('/parts', (req, res) => {
  const id = insertRow('parts', { ...normalizePart(pick(req.body, partSchema)), created_at: nowIso() });
  res.status(201).json(db.prepare(`${PART_SELECT} WHERE p.id = ?`).get(id));
});

router.put('/parts/:id', (req, res) => {
  const current = mustGet('parts', req.params.id, 'Teil');
  const merged = normalizePart({ ...current, ...pick(req.body, partSchema, { partial: true }) });
  delete merged.id; delete merged.created_at;
  updateRow('parts', req.params.id, merged);
  res.json(db.prepare(`${PART_SELECT} WHERE p.id = ?`).get(req.params.id));
});

router.delete('/parts/:id', (req, res) => {
  db.prepare('DELETE FROM parts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Werkzeug ---------------- */
const toolSchema = {
  name: (v) => strOrNull(v) || 'Neues Werkzeug',
  category: strOrNull,
  qty: (v) => Math.max(1, toIntOrNull(v) || 1),
  location_text: strOrNull,
  shelf_id: toIntOrNull,
  level: toIntOrNull,
  box_id: toIntOrNull,
  event_relevant: toBool,
  wishlist: toBool,
  price: toNumOrNull,
  url: strOrNull,
  notes: strOrNull
};

const TOOL_SELECT = `SELECT t.*, u.name AS borrowed_by_name, u.color AS borrowed_by_color, v.name AS borrowed_vehicle_name,
  lo.code AS shelf_code, b.label AS box_label
  FROM tools t LEFT JOIN users u ON u.id = t.borrowed_by LEFT JOIN vehicles v ON v.id = t.borrowed_vehicle_id
  LEFT JOIN layout_objects lo ON lo.id = t.shelf_id LEFT JOIN boxes b ON b.id = t.box_id`;

router.get('/tools', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.q) { where.push('(t.name LIKE ? OR t.category LIKE ? OR t.location_text LIKE ?)'); args.push(...Array(3).fill(`%${req.query.q}%`)); }
  if (req.query.wishlist === '1') where.push('t.wishlist = 1');
  if (req.query.wishlist === '0') where.push('t.wishlist = 0');
  res.json(db.prepare(`${TOOL_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.wishlist, t.category, t.name`).all(...args));
});

router.post('/tools', (req, res) => {
  const id = insertRow('tools', { ...resolveStorage(pick(req.body, toolSchema)), created_at: nowIso() });
  res.status(201).json(db.prepare(`${TOOL_SELECT} WHERE t.id = ?`).get(id));
});

router.put('/tools/:id', (req, res) => {
  const current = mustGet('tools', req.params.id, 'Werkzeug');
  const merged = resolveStorage({ ...current, ...pick(req.body, toolSchema, { partial: true }) });
  for (const k of ['id', 'created_at', 'borrowed_by', 'borrowed_vehicle_id', 'borrowed_at']) delete merged[k];
  updateRow('tools', req.params.id, merged);
  res.json(db.prepare(`${TOOL_SELECT} WHERE t.id = ?`).get(req.params.id));
});

router.delete('/tools/:id', (req, res) => {
  db.prepare('DELETE FROM tools WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** Verleih: "In Benutzung von [User] an [Auto]" */
router.post('/tools/:id/borrow', (req, res) => {
  const tool = mustGet('tools', req.params.id, 'Werkzeug');
  if (tool.wishlist) throw httpError(400, 'Wunschlisten-Werkzeug ist noch nicht vorhanden.');
  db.prepare('UPDATE tools SET borrowed_by = ?, borrowed_vehicle_id = ?, borrowed_at = ? WHERE id = ?')
    .run(req.user.id, toIntOrNull(req.body.vehicle_id), nowIso(), tool.id);
  res.json(db.prepare(`${TOOL_SELECT} WHERE t.id = ?`).get(tool.id));
});

router.post('/tools/:id/return', (req, res) => {
  mustGet('tools', req.params.id, 'Werkzeug');
  db.prepare('UPDATE tools SET borrowed_by = NULL, borrowed_vehicle_id = NULL, borrowed_at = NULL WHERE id = ?').run(req.params.id);
  res.json(db.prepare(`${TOOL_SELECT} WHERE t.id = ?`).get(req.params.id));
});

/** Wunschliste -> gekauft: wandert ins Inventar */
router.post('/tools/:id/acquire', (req, res) => {
  mustGet('tools', req.params.id, 'Werkzeug');
  db.prepare('UPDATE tools SET wishlist = 0 WHERE id = ?').run(req.params.id);
  res.json(db.prepare(`${TOOL_SELECT} WHERE t.id = ?`).get(req.params.id));
});

/* ---------------- Euroboxen ---------------- */
const boxSchema = {
  shelf_id: toIntOrNull,
  level: (v) => Math.max(1, toIntOrNull(v) || 1),
  position: (v) => Math.max(1, toIntOrNull(v) || 1),
  label: (v) => strOrNull(v) || 'Box',
  color: (v) => strOrNull(v) || '#3b82f6',
  notes: strOrNull
};

router.get('/boxes', (req, res) => {
  const rows = req.query.shelfId
    ? db.prepare('SELECT * FROM boxes WHERE shelf_id = ? ORDER BY level, position').all(Number(req.query.shelfId))
    : db.prepare('SELECT b.*, lo.code AS shelf_code FROM boxes b JOIN layout_objects lo ON lo.id = b.shelf_id ORDER BY lo.code, b.level, b.position').all();
  res.json(rows);
});

router.post('/boxes', requireRole('admin'), (req, res) => {
  const data = pick(req.body, boxSchema);
  if (!data.shelf_id) throw httpError(400, 'Regal fehlt.');
  const id = insertRow('boxes', data);
  res.status(201).json(mustGet('boxes', id));
});

router.put('/boxes/:id', requireRole('admin'), (req, res) => {
  const data = pick(req.body, boxSchema, { partial: true });
  updateRow('boxes', req.params.id, data);
  // Inhalte ziehen mit um
  const box = mustGet('boxes', req.params.id);
  db.prepare('UPDATE parts SET shelf_id = ?, level = ? WHERE box_id = ?').run(box.shelf_id, box.level, box.id);
  db.prepare('UPDATE tools SET shelf_id = ?, level = ? WHERE box_id = ?').run(box.shelf_id, box.level, box.id);
  res.json(box);
});

router.delete('/boxes/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM boxes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Regal-Frontansicht ---------------- */
router.get('/shelves', (_req, res) => {
  res.json(db.prepare("SELECT * FROM layout_objects WHERE type = 'shelf' ORDER BY code").all().map((s) => ({ ...s, props: parseJSON(s.props, {}) })));
});

router.get('/shelves/:id', (req, res) => {
  const shelf = db.prepare("SELECT * FROM layout_objects WHERE id = ? AND type = 'shelf'").get(req.params.id);
  if (!shelf) throw httpError(404, 'Regal nicht gefunden.');
  res.json({
    shelf: { ...shelf, props: parseJSON(shelf.props, {}) },
    boxes: db.prepare('SELECT * FROM boxes WHERE shelf_id = ? ORDER BY level, position').all(shelf.id),
    parts: db.prepare(`${PART_SELECT} WHERE p.shelf_id = ? ORDER BY p.level, p.name`).all(shelf.id),
    tools: db.prepare(`${TOOL_SELECT} WHERE t.shelf_id = ? ORDER BY t.level, t.name`).all(shelf.id)
  });
});

module.exports = router;
