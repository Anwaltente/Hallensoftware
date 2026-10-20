/**
 * /api/events: Event-Planer & automatische Trackside-Packliste
 */
const express = require('express');
const { db } = require('../db');
const { buildPacklist } = require('../lib/packlist');
const { listEvents } = require('../lib/queries');
const { insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, nowIso } = require('../lib/util');

const router = express.Router();

function readEventBody(body) {
  const dateStart = strOrNull(body.date_start);
  if (!dateStart || !/^\d{4}-\d{2}-\d{2}$/.test(dateStart)) throw httpError(400, 'Startdatum fehlt (JJJJ-MM-TT).');
  let dateEnd = strOrNull(body.date_end);
  if (dateEnd && dateEnd < dateStart) dateEnd = dateStart;
  return {
    name: strOrNull(body.name) || 'Neues Event',
    date_start: dateStart,
    date_end: dateEnd,
    location: strOrNull(body.location),
    notes: strOrNull(body.notes),
    start_time: /^\d{2}:\d{2}$/.test(String(body.start_time || '')) ? body.start_time : null
  };
}

function setVehicles(eventId, ids) {
  if (!Array.isArray(ids)) return;
  db.prepare('DELETE FROM event_vehicles WHERE event_id = ?').run(eventId);
  const ins = db.prepare('INSERT OR IGNORE INTO event_vehicles (event_id, vehicle_id) VALUES (?, ?)');
  for (const id of [...new Set(ids.map(Number).filter(Boolean))]) ins.run(eventId, id);
}

router.get('/', (req, res) => res.json(listEvents({ upcomingOnly: req.query.upcoming === '1' })));

router.get('/:id', (req, res) => {
  const ev = listEvents().find((e) => e.id === Number(req.params.id));
  if (!ev) throw httpError(404, 'Event nicht gefunden.');
  res.json(ev);
});

router.post('/', (req, res) => {
  const data = readEventBody(req.body);
  let id;
  db.transaction(() => {
    id = insertRow('events', { ...data, created_at: nowIso() });
    setVehicles(id, req.body.vehicle_ids || []);
  })();
  res.status(201).json(listEvents().find((e) => e.id === id));
});

router.put('/:id', (req, res) => {
  mustGet('events', req.params.id, 'Event');
  db.transaction(() => {
    updateRow('events', req.params.id, readEventBody(req.body));
    setVehicles(Number(req.params.id), req.body.vehicle_ids);
  })();
  res.json(listEvents().find((e) => e.id === Number(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Packliste ---------------- */
router.get('/:id/packlist', (req, res) => {
  const list = buildPacklist(Number(req.params.id));
  if (!list) throw httpError(404, 'Event nicht gefunden.');
  res.json(list);
});

router.post('/:id/packlist/check', (req, res) => {
  const key = strOrNull(req.body.itemKey);
  if (!key) throw httpError(400, 'itemKey fehlt.');
  const packed = req.body.packed ? 1 : 0;
  db.prepare(`INSERT INTO packlist_checks (event_id, item_key, packed, packed_by, packed_at) VALUES (?,?,?,?,?)
    ON CONFLICT(event_id, item_key) DO UPDATE SET packed = excluded.packed, packed_by = excluded.packed_by, packed_at = excluded.packed_at`)
    .run(Number(req.params.id), key, packed, req.user.id, nowIso());
  res.json({ ok: true, itemKey: key, packed: !!packed, packedBy: req.user.name });
});

router.post('/:id/packlist/reset', (req, res) => {
  db.prepare('DELETE FROM packlist_checks WHERE event_id = ?').run(req.params.id);
  res.json(buildPacklist(Number(req.params.id)));
});

router.post('/:id/packlist/custom', (req, res) => {
  const name = strOrNull(req.body.name);
  if (!name) throw httpError(400, 'Name fehlt.');
  insertRow('packlist_custom', { event_id: Number(req.params.id), name, qty: Math.max(1, toIntOrNull(req.body.qty) || 1) });
  res.status(201).json(buildPacklist(Number(req.params.id)));
});

router.delete('/:id/packlist/custom/:cid', (req, res) => {
  db.prepare('DELETE FROM packlist_custom WHERE id = ? AND event_id = ?').run(req.params.cid, req.params.id);
  db.prepare('DELETE FROM packlist_checks WHERE event_id = ? AND item_key = ?').run(req.params.id, `custom:${req.params.cid}`);
  res.json(buildPacklist(Number(req.params.id)));
});

module.exports = router;
