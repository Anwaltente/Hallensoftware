/**
 * Kern-Routen: Meta-Daten, Bootstrap (Map-Zustand), Layout-Baukasten, Spotlight-Suche
 */
const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const { requireRole } = require('../auth');
const { SHAPES, STATUS, SLOT_KINDS, BLUEPRINT_KINDS } = require('../lib/models');
const { getModels } = require('../lib/vehicleModels');
const { listObjects, listVehicles, activeWork, listEvents } = require('../lib/queries');
const { pick, insertRow, updateRow, mustGet, toNumOrNull, strOrNull, toIntOrNull } = require('../lib/util');

const router = express.Router();

router.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get('/meta', (_req, res) => res.json({ models: getModels(), shapes: SHAPES, status: STATUS, slotKinds: SLOT_KINDS, blueprintKinds: BLUEPRINT_KINDS }));

/** Alles, was die Hallen-Map zum Start braucht, in einem Request. */
router.get('/bootstrap', (req, res) => {
  res.json({
    me: req.user,
    hall: getSetting('hall', { name: 'Halle', width: 8, depth: 19 }),
    objects: listObjects(),
    vehicles: listVehicles(),
    users: db.prepare("SELECT id, name, color, role FROM users WHERE active = 1 ORDER BY id").all(),
    work: activeWork(),
    events: listEvents({ upcomingOnly: true }),
    supplies: db.prepare("SELECT id, name, qty, min_qty, unit, category, pack_size FROM supplies WHERE category = 'kuehlschrank' ORDER BY sort").all().map((s) => ({ ...s, low: s.qty < s.min_qty })),
    settings: { publicUrl: getSetting('public_url', null) }
  });
});

/* ---------------- Layout / Garage-Builder (Admin) ---------------- */
const TYPES = ['slot', 'shelf', 'workbench', 'toolwall', 'zone', 'door', 'tyrestack', 'fridge'];
const objSchema = {
  type: (v) => (TYPES.includes(v) ? v : 'zone'),
  code: strOrNull,
  label: strOrNull,
  x: (v) => toNumOrNull(v) ?? 0,
  y: (v) => toNumOrNull(v) ?? 0,
  w: (v) => Math.max(0.1, toNumOrNull(v) ?? 2),
  h: (v) => Math.max(0.1, toNumOrNull(v) ?? 2),
  color: strOrNull,
  props: (v) => JSON.stringify(v && typeof v === 'object' ? v : {}),
  sort: (v) => toIntOrNull(v) ?? 0
};

router.get('/layout', (_req, res) => res.json({ hall: getSetting('hall'), objects: listObjects() }));

// Öffentliche Adresse für QR-Codes (z. B. https://halle.example.de oder http://192.168.0.20:3000)
router.put('/settings/public-url', requireRole('admin'), (req, res) => {
  const url = strOrNull(req.body.url);
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return res.status(400).json({ error: 'Adresse muss mit http:// oder https:// beginnen.' });
  setSetting('public_url', url ? url.replace(/\/$/, '') : null);
  res.json({ publicUrl: getSetting('public_url', null) });
});

router.put('/layout/hall', requireRole('admin'), (req, res) => {
  const cur = getSetting('hall', {});
  const hall = {
    name: strOrNull(req.body.name) || cur.name || 'Halle',
    width: Math.max(2, toNumOrNull(req.body.width) ?? cur.width ?? 8),
    depth: Math.max(2, toNumOrNull(req.body.depth) ?? cur.depth ?? 19)
  };
  setSetting('hall', hall);
  res.json(hall);
});

router.post('/layout/objects', requireRole('admin'), (req, res) => {
  const data = pick(req.body, objSchema);
  const id = insertRow('layout_objects', data);
  res.status(201).json({ ...mustGet('layout_objects', id), props: JSON.parse(data.props) });
});

// Mehrere Objekte auf einmal speichern (nach Drag im Editor)
router.put('/layout/objects', requireRole('admin'), (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const tx = db.transaction(() => {
    for (const o of list) updateRow('layout_objects', o.id, pick(o, objSchema, { partial: true }));
  });
  tx();
  res.json(listObjects());
});

router.put('/layout/objects/:id', requireRole('admin'), (req, res) => {
  updateRow('layout_objects', req.params.id, pick(req.body, objSchema, { partial: true }));
  res.json(listObjects().find((o) => o.id === Number(req.params.id)));
});

router.delete('/layout/objects/:id', requireRole('admin'), (req, res) => {
  const obj = mustGet('layout_objects', req.params.id, 'Objekt');
  if (obj.type === 'slot') {
    // Autos auf dem Platz wandern sicher in den Paddock
    db.prepare("UPDATE vehicles SET slot_id = NULL, extern_location = 'Paddock' WHERE slot_id = ?").run(obj.id);
  }
  db.prepare('DELETE FROM layout_objects WHERE id = ?').run(obj.id);
  res.json({ ok: true });
});

/* ---------------- Spotlight-Suche (Strg+K) ---------------- */
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;
  const out = [];

  for (const v of db.prepare(`SELECT id, name, model, plate, slot_id, extern_location FROM vehicles
      WHERE name LIKE ? OR plate LIKE ? OR model LIKE ? OR notes LIKE ? LIMIT 8`).all(like, like, like, like)) {
    out.push({ type: 'vehicle', id: v.id, title: v.name, subtitle: v.slot_id ? 'In der Halle' : `Außerhalb: ${v.extern_location || 'Paddock'}`, target: { kind: 'vehicle', vehicleId: v.id } });
  }
  for (const p of db.prepare(`SELECT p.id, p.name, p.qty, p.shelf_id, p.level, p.box_id, lo.code AS shelf_code, b.label AS box_label, v.name AS vehicle_name, p.universal
      FROM parts p LEFT JOIN layout_objects lo ON lo.id = p.shelf_id LEFT JOIN boxes b ON b.id = p.box_id LEFT JOIN vehicles v ON v.id = p.vehicle_id
      WHERE p.name LIKE ? OR p.category LIKE ? OR p.part_number LIKE ? OR p.notes LIKE ? LIMIT 12`).all(like, like, like, like)) {
    const where = p.shelf_code ? `Regal ${p.shelf_code}${p.level ? ` · Etage ${p.level}` : ''}${p.box_label ? ` · ${p.box_label}` : ''}` : 'ohne Lagerort';
    out.push({ type: 'part', id: p.id, title: `${p.qty}× ${p.name}`, subtitle: `${where} · ${p.universal ? 'Universal' : p.vehicle_name || 'ohne Auto'}`,
      target: p.shelf_id ? { kind: 'shelf', shelfId: p.shelf_id, level: p.level, boxId: p.box_id, highlight: `part:${p.id}` } : { kind: 'inventory', highlight: `part:${p.id}` } });
  }
  for (const t of db.prepare(`SELECT t.id, t.name, t.location_text, t.shelf_id, t.level, t.box_id, t.wishlist, lo.code AS shelf_code, u.name AS borrower
      FROM tools t LEFT JOIN layout_objects lo ON lo.id = t.shelf_id LEFT JOIN users u ON u.id = t.borrowed_by
      WHERE t.name LIKE ? OR t.category LIKE ? OR t.location_text LIKE ? LIMIT 8`).all(like, like, like)) {
    const where = t.wishlist ? 'Wunschliste' : t.borrower ? `In Benutzung von ${t.borrower}` : t.shelf_code ? `Regal ${t.shelf_code}` : t.location_text || 'ohne Ort';
    out.push({ type: 'tool', id: t.id, title: t.name, subtitle: where,
      target: t.shelf_id ? { kind: 'shelf', shelfId: t.shelf_id, level: t.level, boxId: t.box_id, highlight: `tool:${t.id}` } : { kind: 'tools', highlight: `tool:${t.id}` } });
  }
  for (const b of db.prepare(`SELECT b.*, lo.code AS shelf_code FROM boxes b JOIN layout_objects lo ON lo.id = b.shelf_id WHERE b.label LIKE ? LIMIT 6`).all(like)) {
    out.push({ type: 'box', id: b.id, title: `Box „${b.label}“`, subtitle: `Regal ${b.shelf_code} · Etage ${b.level}`, target: { kind: 'shelf', shelfId: b.shelf_id, level: b.level, boxId: b.id } });
  }
  for (const t of db.prepare(`SELECT t.id, t.title, t.status, t.vehicle_id, v.name AS vehicle_name FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.status = 'open' AND (t.title LIKE ? OR t.description LIKE ?) LIMIT 6`).all(like, like)) {
    out.push({ type: 'task', id: t.id, title: t.title, subtitle: t.vehicle_name || 'Hallen-To-Do', target: t.vehicle_id ? { kind: 'vehicle', vehicleId: t.vehicle_id, tab: 'tasks' } : { kind: 'whiteboard' } });
  }
  for (const l of db.prepare(`SELECT l.id, l.title, l.done_at, l.vehicle_id, v.name AS vehicle_name FROM maintenance_log l LEFT JOIN vehicles v ON v.id = l.vehicle_id
      WHERE l.title LIKE ? OR l.description LIKE ? ORDER BY l.done_at DESC LIMIT 6`).all(like, like)) {
    out.push({ type: 'log', id: l.id, title: l.title, subtitle: `Wartungsheft · ${l.vehicle_name || ''} · ${String(l.done_at).slice(0, 10)}`, target: { kind: 'vehicle', vehicleId: l.vehicle_id, tab: 'log', query: q } });
  }
  for (const t of db.prepare(`SELECT dimension, brand, model, class, COUNT(*) AS n FROM tyres WHERE status = 'aktiv'
      AND (dimension LIKE ? OR brand LIKE ? OR model LIKE ?) GROUP BY dimension, brand, model, class LIMIT 5`).all(like, like, like)) {
    out.push({ type: 'tyre', id: 0, title: `${t.n}× ${t.dimension} ${t.brand || ''} ${t.model || ''}`.trim(), subtitle: `Reifenlager · ${t.class === 'drift' ? 'Driftreifen' : 'Straße'}`, target: { kind: 'tyres' } });
  }
  for (const s of db.prepare("SELECT id, name, qty, unit, min_qty FROM supplies WHERE category = 'kuehlschrank' AND name LIKE ? LIMIT 4").all(like)) {
    out.push({ type: 'supply', id: s.id, title: `${s.name}: ${s.qty} ${s.unit}`, subtitle: s.qty < s.min_qty ? 'Kühlschrank-Radar · fast leer!' : 'Kühlschrank-Radar', target: { kind: 'fridge' } });
  }
  for (const e of db.prepare('SELECT id, name, date_start FROM events WHERE name LIKE ? OR location LIKE ? LIMIT 4').all(like, like)) {
    out.push({ type: 'event', id: e.id, title: e.name, subtitle: `Event · ${e.date_start}`, target: { kind: 'event', eventId: e.id } });
  }
  res.json(out);
});

module.exports = router;
